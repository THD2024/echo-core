import z from "zod"
import * as path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Global } from "../global"
import { Config } from "../config"
import { canonicalProjectMemoryPath, secondPrecisionUtc } from "../memory/legacy-migration"
import {
  MERGE_MAX_SOURCES,
  MERGE_MIN_SOURCES,
  computeMerge,
  formatMergeReport,
  verifyMergeConverged,
} from "../memory/merge"
import { DEFAULT_MEMORY_BUDGET_TOKENS } from "../session/budgeted-read"
import { assertWriteAllowed } from "./external-directory"
import { retractMemoryRecord } from "./memory-retract"
import * as Tool from "./tool"
import { SessionCwd } from "./session-cwd"
import DESCRIPTION from "./memory-merge.txt"

/** Independent default-off exposure flag (T_C_RETRACT_ENABLED and T_E_MIGRATION_ENABLED stay separate). */
export const T_F_MERGE_ENABLED = false

const Parameters = z.object({
  file_path: z.string().describe("Canonical project MEMORY.md containing the source records"),
  source_ids: z
    .array(z.string())
    .min(MERGE_MIN_SOURCES)
    .max(MERGE_MAX_SOURCES)
    .describe("record_ids of the records to supersede (2-8)"),
  body: z.string().describe("The merged record: exactly one bullet or paragraph, without metadata markers"),
  dry_run: z.boolean().default(false).describe("Preview the merge without writing"),
})

type MemoryBudgetConfig = {
  get: () => Effect.Effect<{ checkpoint?: { push_caps?: { memory?: number } } | undefined }, unknown, never>
}

/**
 * Executor kept separate from the tool wrapper so the gate, filesystem, Config and the retract
 * executor can be injected in tests without module mocks.
 *
 * Order (frozen): gate -> read -> pure plan -> Phase A (write M, CAS) -> Phase B (retract each
 * pending source through the frozen retractMemoryRecord, reason=superseded) -> final verification.
 * This executor never writes retracted.md itself.
 */
export const mergeMemoryRecords = Effect.fn("Memory.mergeRecords")(function* (input: {
  ctx: Tool.Context
  fs: AppFileSystem.Interface
  config: MemoryBudgetConfig
  filepath: string
  dataRoot: string
  sourceIds: string[]
  body: string
  dryRun: boolean
  now?: string
  assertWriteAllowedFn?: typeof assertWriteAllowed
  retract?: typeof retractMemoryRecord
}) {
  const canonical = canonicalProjectMemoryPath(input.filepath, input.dataRoot)
  if (!canonical) {
    throw new Error(
      "T-f merge supports only canonical project MEMORY.md; global, nested, spillover and out-of-root paths are fail-closed.",
    )
  }

  // The gate is first, even for dry-run: dry-run still needs a legal write context.
  const gate = input.assertWriteAllowedFn ?? assertWriteAllowed
  yield* gate(input.ctx, canonical)

  const cfg = yield* input.config.get()
  const budgetTokens = cfg.checkpoint?.push_caps?.memory ?? DEFAULT_MEMORY_BUDGET_TOKENS
  const tombstonePath = path.join(path.dirname(canonical), "retracted.md")
  const raw = yield* input.fs.readFileString(canonical)
  const tombRaw = (yield* input.fs.existsSafe(tombstonePath)) ? yield* input.fs.readFileString(tombstonePath) : ""

  const plan = computeMerge(raw, tombRaw, {
    sourceIds: input.sourceIds,
    body: input.body,
    now: input.now ?? secondPrecisionUtc(),
    budgetTokens,
    filePath: canonical,
  })
  if (!plan.ok) throw new Error(plan.error)

  if (input.dryRun) {
    return {
      canonical,
      report: plan.report,
      written: false,
      retracted: [] as string[],
      output: formatMergeReport(plan.report, { dryRun: true, written: false, retracted: [] }),
    }
  }

  // Phase A: M first. Between the phases MEMORY.md holds M and the sources (duplicate, never lossy).
  let written = false
  if (plan.mode === "fresh") {
    const reread = yield* input.fs.readFileString(canonical)
    if (reread !== raw) {
      throw new Error("T-f merge refused: canonical MEMORY.md changed during merge (CAS mismatch).")
    }
    yield* input.fs.writeWithDirs(canonical, plan.text)
    written = true
  }

  // Phase B: the only way sources leave MEMORY.md. A failure keeps M; re-running resumes.
  const retract = input.retract ?? retractMemoryRecord
  const retracted: string[] = []
  for (const id of plan.report.pendingSourceIds) {
    const attempt = yield* Effect.exit(
      retract({
        ctx: input.ctx,
        fs: input.fs,
        filepath: canonical,
        recordId: id,
        reason: "superseded",
        assertWriteAllowedFn: input.assertWriteAllowedFn,
      }),
    )
    if (attempt._tag === "Failure") {
      const remaining = plan.report.pendingSourceIds.filter((p) => !retracted.includes(p))
      const cause = String(attempt.cause).split("\n")[0]
      throw new Error(
        `T-f merge incomplete: merged record '${plan.mergeId}' is written but retracting '${id}' failed (${cause}). ` +
          `Superseded so far: ${retracted.join(", ") || "none"}. Still pending: ${remaining.join(", ")}. ` +
          `Re-run with the same source_ids and body to resume.`,
      )
    }
    retracted.push(id)
  }

  const finalRaw = yield* input.fs.readFileString(canonical)
  const finalTomb = (yield* input.fs.existsSafe(tombstonePath)) ? yield* input.fs.readFileString(tombstonePath) : ""
  const verified = verifyMergeConverged(finalRaw, finalTomb, { mergeId: plan.mergeId, sourceIds: input.sourceIds })
  if (!verified.ok) throw new Error(`T-f merge final verification failed: ${verified.error}`)

  return {
    canonical,
    report: plan.report,
    written,
    retracted,
    output: formatMergeReport(plan.report, { dryRun: false, written, retracted }),
  }
})

export const MemoryMergeTool = Tool.define(
  "memory_merge",
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
          const result = yield* mergeMemoryRecords({
            ctx,
            fs,
            config,
            filepath,
            dataRoot: Global.Path.data,
            sourceIds: params.source_ids,
            body: params.body,
            dryRun: params.dry_run,
          })
          return {
            title: result.report.mergeId,
            metadata: { ...result.report, dryRun: params.dry_run, written: result.written, retracted: result.retracted },
            output: result.output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
