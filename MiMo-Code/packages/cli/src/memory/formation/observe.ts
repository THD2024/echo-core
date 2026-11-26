/**
 * Memory Formation Phase 1 — observation hook for the built-in MANUAL `/dream` command.
 *
 * `observeFormation(run, input)` returns an Effect that is result-equivalent to `run` in EVERY case (same success
 * value, same failure, same interruption). When the flag is off, the run is not the built-in `/dream`, the project
 * guard fails, or any setup step throws, the SAME `run` Effect object is returned: no reads, no hashing, no logs,
 * no `<data>/formation` access (not even mkdir).
 *
 * It composes OUTSIDE the frozen T-g.4 wrapper and reads its own before/after MEMORY.md snapshots, so no frozen file
 * is changed. The formation step runs only after a normal successful dream return (classifyDreamResult === success),
 * is a plain async function that never rejects, and has a hard timeout.
 *
 * Effect rules inherited from T-g.4: observed Effects are handed around as values (never flattened by `suspend`
 * during setup); nothing here uses a bare `Effect.try(fn)`.
 */
import * as path from "node:path"
import * as fs from "node:fs/promises"
import { Effect } from "effect"
import { Log } from "@/util"
import { Global } from "../../global"
import { memoryPath } from "../../session/checkpoint-paths"
import { classifyDreamResult, shouldObserveManualDream, type ManualDreamRun } from "../../session/manual-dream-audit"
import { dbResolver, dbTaskState } from "./evidence-db"
import { runFormationStep, takeSnapshot, type FormationDeps } from "./run"

/** Independent default-off switch (the Flag getter is passed in by the call site; NOT part of any umbrella). */
export const T_H_FORMATION_ENABLED = false

export const FORMATION_SNAPSHOT_MAX_BYTES = 256 * 1024

type ProjectID = Parameters<typeof memoryPath>[0]

export interface FormationObserveInput extends ManualDreamRun {
  sessionID: string
  projectID: ProjectID
  /** The current Instance project id (what the dream's tools resolve against). Lazy and fail-closed. */
  getInstanceProjectID: () => string | undefined
  /** Defaults to T_H_FORMATION_ENABLED. */
  enabled?: boolean
  /** Project worktree, used only to bound `file_range` evidence. */
  worktree?: string
  /** Test seams; production callers never pass these. */
  overrides?: Partial<FormationDeps>
}

const defaultRead = async (file: string): Promise<string | undefined> => {
  try {
    const st = await fs.stat(file)
    if (!st.isFile() || st.size > FORMATION_SNAPSHOT_MAX_BYTES) return undefined
    return await fs.readFile(file, "utf8")
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "ENOENT" ? "" : undefined
  }
}

function buildDeps(input: FormationObserveInput): FormationDeps {
  const memoryFile = input.overrides?.memoryFile ?? memoryPath(input.projectID)
  const o = input.overrides ?? {}
  return {
    base: o.base ?? path.join(Global.Path.data, "formation"),
    projectID: String(input.projectID),
    sessionID: input.sessionID,
    memoryFile,
    retractedFile: o.retractedFile ?? path.join(path.dirname(memoryFile), "retracted.md"),
    readText: o.readText ?? defaultRead,
    resolver: o.resolver ?? dbResolver({ worktree: input.worktree }),
    readTaskState: o.readTaskState ?? (() => dbTaskState(input.sessionID)),
    now: o.now ?? Date.now,
    log: o.log ?? Log.create({ service: "memory-formation" }),
  }
}

export const observeFormation = <A, E, R>(run: Effect.Effect<A, E, R>, input: FormationObserveInput): Effect.Effect<A, E, R> => {
  let deps: FormationDeps
  try {
    if (!(input.enabled ?? T_H_FORMATION_ENABLED)) return run
    if (!shouldObserveManualDream(input)) return run
    const instanceProject = input.getInstanceProjectID()
    if (!instanceProject || instanceProject === "global" || instanceProject !== String(input.projectID)) return run
    deps = buildDeps(input)
  } catch {
    return run
  }
  const d = deps
  let startedAt = Number.POSITIVE_INFINITY
  // takeSnapshot / runFormationStep never reject, so these promises can never turn into a defect that alters `run`.
  const before = Effect.promise(() => takeSnapshot(d))
  return before.pipe(
    Effect.flatMap((snap) => {
      if (snap === undefined) return run
      return Effect.suspend(() => {
        try {
          startedAt = d.now()
        } catch {
          startedAt = Date.now()
        }
        return run
      }).pipe(
        Effect.tap((result) =>
          Effect.promise(async () => {
            try {
              const outcome = classifyDreamResult(result, startedAt)
              if (outcome?.outcome === "success") await runFormationStep(d, snap)
            } catch {}
          }),
        ),
      )
    }),
  )
}
