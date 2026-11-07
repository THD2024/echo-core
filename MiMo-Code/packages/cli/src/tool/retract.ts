import z from "zod"
import * as path from "path"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./retract.txt"
import { SessionCwd } from "./session-cwd"
import { retractMemoryRecord } from "./memory-retract"
import type { RecordRetractReason } from "../memory/record-meta"

const Parameters = z.object({
  file_path: z.string().describe("Canonical project MEMORY.md containing the record"),
  record_id: z.string().min(1).describe("Stable record_id of the record to retract"),
  reason: z.enum(["superseded", "incorrect", "withdrawn"]).describe("Why the record is being retracted"),
})

export const RetractTool = Tool.define(
  "memory_retract",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filepath = path.isAbsolute(params.file_path)
            ? params.file_path
            : path.join(SessionCwd.get(ctx.sessionID), params.file_path)
          const result = yield* retractMemoryRecord({
            ctx,
            filepath,
            recordId: params.record_id,
            reason: params.reason as RecordRetractReason,
          })
          return {
            title: params.record_id,
            metadata: result,
            output: `Retracted memory record '${params.record_id}' into retracted.md; source deletion completed only after tombstone verification.`,
          }
        }),
    }
  }),
)
