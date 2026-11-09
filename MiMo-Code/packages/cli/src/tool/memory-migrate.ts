import z from "zod"
import * as path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Global } from "../global"
import { Config } from "../config"
import { computeLegacyMigration, canonicalProjectMemoryPath, newLegacyRecordId, secondPrecisionUtc } from "../memory/legacy-migration"
import { assertWriteAllowed } from "./external-directory"
import * as Tool from "./tool"
import { SessionCwd } from "./session-cwd"
import DESCRIPTION from "./memory-migrate.txt"

export const T_E_MIGRATION_ENABLED = false

const Parameters = z.object({
  file_path: z.string().describe("Canonical project MEMORY.md to migrate"),
  dry_run: z.boolean().default(false).describe("Preview the migration without writing"),
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
          const canonical = canonicalProjectMemoryPath(filepath, Global.Path.data)
          if (!canonical) throw new Error("T-e migration currently supports only canonical project MEMORY.md; global, nested, and spillover paths are fail-closed.")

          // The gate is intentionally first, even for dry-run: dry-run still needs a legal
          // migration execution context and must remain blocked by memory.disable_write.
          yield* assertWriteAllowed(ctx, canonical)

          const cfg = yield* config.get()
          const caps = cfg.checkpoint?.push_caps ?? {}
          const budgetTokens = caps.memory ?? DEFAULT_MEMORY_BUDGET_TOKENS
          const tombstonePath = path.join(path.dirname(canonical), "retracted.md")
          const raw = yield* fs.readFileString(canonical)
          const tombstoneRaw = (yield* fs.existsSafe(tombstonePath)) ? yield* fs.readFileString(tombstonePath) : ""
          const computation = computeLegacyMigration(raw, tombstoneRaw, {
            now: secondPrecisionUtc(),
            generateId: newLegacyRecordId,
            budgetTokens,
            filePath: canonical,
          })
          if (!computation.ok) throw new Error(computation.error)

          if (!params.dry_run && computation.report.changed) {
            const reread = yield* fs.readFileString(canonical)
            if (reread !== raw) throw new Error("T-e migration refused: canonical MEMORY.md changed during migration (CAS mismatch).")
            yield* fs.writeWithDirs(canonical, computation.text)
          }

          return {
            title: path.basename(canonical),
            metadata: { ...computation.report, dryRun: params.dry_run },
            output: params.dry_run
              ? `Legacy migration dry-run: ${computation.report.migratedRecords} records would receive metadata; no file was written.`
              : computation.report.changed
                ? `Legacy migration completed: ${computation.report.migratedRecords} legacy records migrated.`
                : "Legacy migration is already converged; no file changes were needed.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
