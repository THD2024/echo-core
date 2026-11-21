/**
 * Observe-only audit of the built-in MANUAL `/dream` command (task T-g.3).
 *
 * This is a thin adapter over the frozen T-g.2 `observeDreamRun`: it decides WHETHER a command run is
 * the true built-in `/dream`, resolves the project memory budget lazily, and re-labels the emitted event
 * `run.kind` from "auto-dream" to "manual-dream". It does not read, hash, log or audit anything itself,
 * and it never changes the result of the wrapped prompt Effect.
 *
 * Boundaries:
 *  - same independent flag as T-g.2 (`T_G_AUDIT_ENABLED`, default false). When off, or when the run is
 *    not the built-in `/dream`, the SAME Effect object is returned: no reads, no budget resolution, no logs;
 *  - fail-closed predicate: anything that is not command "dream" + source "command" + agent "dream" +
 *    not a subtask is left alone (non-command dream-agent invocations never reach this hook at all);
 *  - project scope, snapshot cap, step timeout and window semantics are all inherited from T-g.2.
 * This module must not import tools, merge/retract code or any write API (a test pins that).
 */
import { Effect } from "effect"
import { Log } from "@/util"
import { T_G_AUDIT_ENABLED, autoDreamAuditDeps, observeDreamRun, type AuditLog, type ObserveDeps } from "./dream-audit"

export const MANUAL_DREAM_RUN_KIND = "manual-dream"

type ProjectID = Parameters<typeof autoDreamAuditDeps>[0]["projectID"]

/** Test seams forwarded to T-g.2; production callers never pass these. */
export type ManualDreamOverrides = Pick<
  ObserveDeps,
  "readText" | "log" | "now" | "audit" | "stepTimeoutMs" | "maxBytes" | "memoryFile"
>

export interface ManualDreamRun {
  /** `input.command === Command.Default.DREAM` (computed by the caller so this module stays import-light). */
  isDreamCommand: boolean
  /** `cmd.source` of the resolved command. */
  source: string | undefined
  /** The agent the command resolved to. */
  agentName: string
  isSubtask: boolean
}

/** True only for the built-in manual `/dream` run. Every other shape is fail-closed. */
export function shouldObserveManualDream(run: ManualDreamRun): boolean {
  return run.isDreamCommand && run.source === "command" && run.agentName === "dream" && !run.isSubtask
}

/** Forward every event unchanged except `run.kind`, which becomes "manual-dream". */
export function relabelRunKind(base: AuditLog): AuditLog {
  const relabel = (extra?: Record<string, unknown>): Record<string, unknown> | undefined => {
    const run = extra?.run
    if (!run || typeof run !== "object") return extra
    return { ...extra, run: { ...(run as Record<string, unknown>), kind: MANUAL_DREAM_RUN_KIND } }
  }
  return {
    info: (message, extra) => base.info(message, relabel(extra)),
    warn: (message, extra) => base.warn(message, relabel(extra)),
  }
}

/** T-g.2 deps for a manual run: same file/budget rules as auto-dream, but the user's session identifies the run. */
export function manualDreamAuditDeps(input: {
  sessionID: string
  projectID: ProjectID
  memoryBudgetTokens?: number
  overrides?: ManualDreamOverrides
}): ObserveDeps {
  const base = autoDreamAuditDeps({
    sessionID: input.sessionID,
    projectID: input.projectID,
    memoryBudgetTokens: input.memoryBudgetTokens,
  })
  const { log, ...rest } = input.overrides ?? {}
  return { ...base, ...rest, enabled: true, log: relabelRunKind(log ?? Log.create({ service: "dream-audit" })) }
}

export interface ManualDreamObserveInput extends ManualDreamRun {
  /** `input.sessionID` of the command. */
  sessionID: string
  /** `session.projectID`. */
  projectID: ProjectID
  /** Lazy: only called when the run is actually observed. A failure falls back to the shared default budget. */
  getBudget: () => Effect.Effect<number | undefined, unknown>
  /** Defaults to T_G_AUDIT_ENABLED. */
  enabled?: boolean
  overrides?: ManualDreamOverrides
}

/**
 * Wrap the manual `/dream` prompt Effect. Result-equivalent to `run` in every case; when observation does
 * not apply it returns `run` itself.
 */
export const observeManualDream = <A, E, R>(run: Effect.Effect<A, E, R>, input: ManualDreamObserveInput): Effect.Effect<A, E, R> => {
  if (!(input.enabled ?? T_G_AUDIT_ENABLED)) return run
  if (!shouldObserveManualDream(input)) return run
  return input.getBudget().pipe(
    Effect.catchCause(() => Effect.succeed(undefined)),
    Effect.flatMap((memoryBudgetTokens) =>
      observeDreamRun(
        run,
        manualDreamAuditDeps({
          sessionID: input.sessionID,
          projectID: input.projectID,
          memoryBudgetTokens,
          overrides: input.overrides,
        }),
      ),
    ),
  )
}
