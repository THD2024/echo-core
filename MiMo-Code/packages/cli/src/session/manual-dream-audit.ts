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
import { Cause, Effect, Exit } from "effect"
import { Log } from "@/util"
import { AUDIT_SCHEMA_VERSION, AUDIT_VERSION, T_G_AUDIT_ENABLED, autoDreamAuditDeps, observeDreamRun, type AuditLog, type ObserveDeps } from "./dream-audit"

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

export type DreamOutcome = { outcome: "success" | "failure" | "interrupted"; error?: string }

/**
 * Classify what the manual `/dream` prompt RETURNED. `prompt` has error channel `never`: model/business
 * errors and Esc-cancel come back as a normal assistant message (`info.error`), and a cancel before the
 * dream produced any message returns a STALE earlier assistant message. Only the error NAME is kept
 * (no message text), so nothing from the error body reaches the log.
 */
export function classifyDreamResult(result: unknown, startedAt: number): DreamOutcome | undefined {
  try {
    const info = (result as { info?: Record<string, any> } | null | undefined)?.info
    if (!info || typeof info !== "object") return { outcome: "failure", error: "unexpected_result" }
    if (info.role !== "assistant") return { outcome: "failure", error: "unexpected_result" }
    const err = info.error as { name?: unknown } | undefined
    if (err) {
      const name = typeof err.name === "string" ? err.name.slice(0, 80) : "unknown_error"
      return name === "MessageAbortedError" ? { outcome: "interrupted", error: name } : { outcome: "failure", error: name }
    }
    const created = info.time?.created
    if (typeof created !== "number" || created < startedAt) return { outcome: "interrupted", error: "no_new_assistant_message" }
    return { outcome: "success" }
  } catch {
    return undefined
  }
}

/**
 * Forward every event unchanged except `run.kind` (becomes "manual-dream") and, when `outcomeOf()` yields a
 * classification, `dream` (the T-g.2 combinator only sees a normal return and would say "success").
 */
export function relabelRunKind(base: AuditLog, outcomeOf?: () => DreamOutcome | undefined): AuditLog {
  const relabel = (extra?: Record<string, unknown>): Record<string, unknown> | undefined => {
    const run = extra?.run
    if (!run || typeof run !== "object") return extra
    const o = outcomeOf?.()
    return {
      ...extra,
      run: { ...(run as Record<string, unknown>), kind: MANUAL_DREAM_RUN_KIND },
      ...(o && extra?.dream && typeof extra.dream === "object" ? { dream: o } : {}),
    }
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
  outcomeOf?: () => DreamOutcome | undefined
}): ObserveDeps {
  const base = autoDreamAuditDeps({
    sessionID: input.sessionID,
    projectID: input.projectID,
    memoryBudgetTokens: input.memoryBudgetTokens,
  })
  const { log, ...rest } = input.overrides ?? {}
  return { ...base, ...rest, enabled: true, log: relabelRunKind(log ?? Log.create({ service: "dream-audit" }), input.outcomeOf) }
}

export interface ManualDreamObserveInput extends ManualDreamRun {
  /** `input.sessionID` of the command. */
  sessionID: string
  /** `session.projectID`. */
  projectID: ProjectID
  /** Lazy: only called when the run is actually observed. A failure falls back to the shared default budget. */
  getBudget: () => Effect.Effect<number | undefined, unknown>
  /** The current Instance project id (what the dream's memory tools and checkpoint paths resolve against). Lazy and fail-closed. */
  getInstanceProjectID: () => string | undefined
  /** Defaults to T_G_AUDIT_ENABLED. */
  enabled?: boolean
  overrides?: ManualDreamOverrides
}

/**
 * Wrap the manual `/dream` prompt Effect. Result-equivalent to `run` in every case; when observation does
 * not apply, or ANY observer setup step fails/throws, it runs `run` itself (fail-closed).
 *
 * Project guard: the audited file is `memoryPath(session.projectID)`, while the dream's tools write under
 * the Instance project. Observe only when the two are the same and not the global fallback.
 */
export const observeManualDream = <A, E, R>(run: Effect.Effect<A, E, R>, input: ManualDreamObserveInput): Effect.Effect<A, E, R> => {
  try {
    if (!(input.enabled ?? T_G_AUDIT_ENABLED)) return run
    if (!shouldObserveManualDream(input)) return run
  } catch {
    return run
  }
  const prepared = Effect.suspend((): Effect.Effect<Effect.Effect<A, E, R>> => {
    const instanceProject = input.getInstanceProjectID()
    if (!instanceProject || instanceProject === "global" || instanceProject !== String(input.projectID)) {
      return Effect.succeed(run)
    }
    // Non-interrupt budget failures are recovered below; the cast only narrows the error channel back to never.
    const budget = Effect.suspend(() => input.getBudget()).pipe(
      Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.succeed(undefined))),
    ) as Effect.Effect<number | undefined>
    return budget.pipe(
      // Effect.sync, NOT Effect.suspend: `suspend` flattens, so it would EXECUTE the observed Effect here (inside
      // the setup guard). `sync` hands it back as a VALUE that only the final flatMap runs, so a dream failure can
      // never be mistaken for a setup failure (no re-run) and the result is never altered. A sync throw while
      // building is a defect that the guard below turns into "run unobserved".
      Effect.map((memoryBudgetTokens) =>
        (() => {
          const rawNow = input.overrides?.now ?? Date.now
          // A throwing clock must never reach T-g.2 (its `started = now()` runs inside its own gen).
          const now = () => {
            try {
              return rawNow()
            } catch {
              return Date.now()
            }
          }
          const baseLog = input.overrides?.log ?? Log.create({ service: "dream-audit" })
          let started = false
          let emitted = false
          let startedAt = Number.POSITIVE_INFINITY
          let outcome: DreamOutcome | undefined
          const trackedLog: AuditLog = {
            info: (m, e) => {
              emitted = true
              baseLog.info(m, e)
            },
            warn: (m, e) => {
              emitted = true
              baseLog.warn(m, e)
            },
          }
          const tracked = Effect.suspend(() => {
            started = true
            startedAt = now()
            return run
          }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                outcome = classifyDreamResult(result, startedAt)
              }),
            ),
          )
          const observed = observeDreamRun(
            tracked,
            manualDreamAuditDeps({
              sessionID: input.sessionID,
              projectID: input.projectID,
              memoryBudgetTokens,
              overrides: { ...input.overrides, now, log: trackedLog } as ManualDreamOverrides,
              outcomeOf: () => outcome,
            }),
          )
          // `Effect.exit(inner)` inside T-g.2 never returns when the CALLER fiber is interrupted, so its own
          // "interrupted" event is lost. onExit still runs: emit the minimal event here (never alters the exit).
          return observed.pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) && started && !emitted
                ? Effect.sync(() => {
                    try {
                      baseLog.info("memory.audit", {
                        schema: AUDIT_SCHEMA_VERSION,
                        auditVersion: AUDIT_VERSION,
                        window: "between_snapshots",
                        scope: "project",
                        run: { kind: MANUAL_DREAM_RUN_KIND, sessionID: input.sessionID },
                        dream: { outcome: "interrupted" },
                        snapshots: { before: { ok: false, reason: "not_taken" }, after: { ok: false, reason: "not_taken" } },
                        changed: false,
                        result: { status: "skipped", reason: "interrupted" },
                        durationMs: Math.max(0, now() - (Number.isFinite(startedAt) ? startedAt : now())),
                      })
                    } catch {}
                  })
                : Effect.void,
            ),
          )
        })(),
      ),
    )
  }).pipe(Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.succeed(run))))
  return prepared.pipe(Effect.flatMap((observed) => observed))
}
