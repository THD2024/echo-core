import z from "zod"
import * as path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Global } from "../global"
import { Config } from "../config"
import {
  computeLegacyMigration,
  canonicalProjectMemoryPath,
  formatMigrationReport,
  newLegacyRecordId,
  secondPrecisionUtc,
} from "../memory/legacy-migration"
import { DEFAULT_MEMORY_BUDGET_TOKENS } from "../session/budgeted-read"
import { assertWriteAllowed } from "./external-directory"
import * as Tool from "./tool"
import { SessionCwd } from "./session-cwd"
import DESCRIPTION from "./memory-migrate.txt"

export const T_E_MIGRATION_ENABLED = false

const Parameters = z.object({
  file_path: z.string().describe("Canonical project MEMORY.md to migrate"),
  dry_run: z.boolean().default(false).describe("Preview the migration without writing"),
})

type MemoryBudgetConfig = {
  get: () => Effect.Effect<{ checkpoint?: { push_caps?: { memory?: number } } | undefined }, unknown, never>
}

/**
 * Executor kept separate from the tool wrapper so the gate, filesystem and Config can be
 * injected in tests without module mocks (same shape as `retractMemoryRecord`).
 */
export const migrateLegacyMemory = Effect.fn("Memory.migrateLegacy")(function* (input: {
  ctx: Tool.Context
  fs: AppFileSystem.Interface
  config: MemoryBudgetConfig
  filepath: string
  dataRoot: string
  dryRun: boolean
  now?: string
  generateId?: () => string
  assertWriteAllowedFn?: typeof assertWriteAllowed
}) {
  const canonical = canonicalProjectMemoryPath(input.filepath, input.dataRoot)
  if (!canonical) {
    throw new Error(
      "T-e migration currently supports only canonical project MEMORY.md; global, nested, spillover and out-of-root paths are fail-closed.",
    )
  }

  // The gate is intentionally first, even for dry-run: dry-run still needs a legal
  // migration execution context and must remain blocked by memory.disable_write.
  const gate = input.assertWriteAllowedFn ?? assertWriteAllowed
  yield* gate(input.ctx, canonical)

  const cfg = yield* input.config.get()
  const budgetTokens = cfg.checkpoint?.push_caps?.memory ?? DEFAULT_MEMORY_BUDGET_TOKENS
  const tombstonePath = path.join(path.dirname(canonical), "retracted.md")
  const raw = yield* input.fs.readFileString(canonical)
  // retracted.md is only ever read here: its IDs are reserved, the file is never written.
  const tombstoneRaw = (yield* input.fs.existsSafe(tombstonePath)) ? yield* input.fs.readFileString(tombstonePath) : ""
  const computation = computeLegacyMigration(raw, tombstoneRaw, {
    now: input.now ?? secondPrecisionUtc(),
    generateId: input.generateId ?? newLegacyRecordId,
    budgetTokens,
    filePath: canonical,
  })
  if (!computation.ok) throw new Error(computation.error)

  let written = false
  if (!input.dryRun && computation.report.changed) {
    const reread = yield* input.fs.readFileString(canonical)
    if (reread !== raw) {
      throw new Error("T-e migration refused: canonical MEMORY.md changed during migration (CAS mismatch).")
    }
    yield* input.fs.writeWithDirs(canonical, computation.text)
    written = true
  }

  return {
    canonical,
    report: computation.report,
    written,
    output: formatMigrationReport(computation.report, { dryRun: input.dryRun, written }),
  }
})

export const MemoryMigrateTool = Tool.define(
  "memory_migrate_legacy",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filepath = path.isAbsolute(params.file_path)
            ? params.file_path
            : path.join(SessionCwd.get(ctx.sessionID), params.file_path)
          const result = yield* migrateLegacyMemory({
            ctx,
            fs,
            config,
            filepath,
            dataRoot: Global.Path.data,
            dryRun: params.dry_run,
          })
          return {
            title: path.basename(result.canonical),
            metadata: { ...result.report, dryRun: params.dry_run, written: result.written },
            output: result.output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
