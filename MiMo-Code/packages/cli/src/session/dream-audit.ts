/**
 * Observe-only wiring of the Memory audit (task T-g.2) around ONE auto-dream run.
 *
 * `observeDreamRun(inner, deps)` returns an Effect equivalent to `inner`: same success value, same
 * failure cause. Around it, the observer reads a before/after snapshot of the canonical project
 * `MEMORY.md` + `retracted.md`, runs the frozen T-g.1 `auditInvariants`, and writes ONE bounded,
 * structured log line. It never feeds anything back to the model, never writes any file, never
 * calls a memory tool, and every observer failure is swallowed into the log.
 *
 * Boundaries (frozen in the T-g.2 design):
 *  - default OFF (`T_G_AUDIT_ENABLED = false`): when off nothing is read, hashed, logged or started;
 *  - window semantics: findings are "observed between snapshots", never attributed to the dream;
 *  - project scope only (global memory is out of scope), auto-dream only (manual /dream is not);
 *  - snapshot identity = sha256 + bytes + time. No CAS, no lock.
 * This module must not import tools, merge/retract code or any write API (a test pins that).
 */
import { Cause, Effect, Exit } from "effect"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { Log } from "@/util"
import { auditInvariants, type Finding, type InvariantReport } from "@/memory/audit"
import { DEFAULT_MEMORY_BUDGET_TOKENS } from "./budgeted-read"
import { memoryPath } from "./checkpoint-paths"

/** Independent default-off flag (T_C_RETRACT_ENABLED / T_E_MIGRATION_ENABLED / T_F_MERGE_ENABLED stay separate). */
export const T_G_AUDIT_ENABLED = false

export const AUDIT_SCHEMA_VERSION = 1
export const AUDIT_VERSION = "t-g.1"
export const SNAPSHOT_MAX_BYTES = 256 * 1024
export const OBSERVER_STEP_TIMEOUT_MS = 5_000
export const MAX_LOGGED_FINDINGS = 50
const MAX_IDS = 8
const MAX_TEXT = 200

export interface AuditLog {
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
}

export interface ObserveDeps {
  /** The dream session id; identifies the run in the log. */
  runID: string
  /** Canonical project MEMORY.md (retracted.md is read from the same directory). */
  memoryFile: string
  budgetTokens: number
  /** Defaults to T_G_AUDIT_ENABLED. When false the combinator returns `inner` untouched. */
  enabled?: boolean
  /** Returns undefined when the file does not exist; rejects on any other error. */
  readText?: (file: string) => Promise<string | undefined>
  log?: AuditLog
  now?: () => number
  audit?: (after: { S: string; R: string }, options: { budgetTokens: number; filePath: string; before: { S: string; R: string } }) => InvariantReport
  stepTimeoutMs?: number
  maxBytes?: number
}

type SnapshotInfo = {
  ok: true
  existed: { S: boolean; R: boolean }
  bytes: { S: number; R: number }
  sha: { S: string; R: string }
  capturedAt: string
}
type SnapshotFailure = { ok: false; reason: "scope" | "read_failed" | "too_large" | "observer_error" | "timeout" }
type Snapshot = { state: { S: string; R: string }; info: SnapshotInfo }

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)

const defaultRead = (file: string): Promise<string | undefined> =>
  readFile(file, "utf8").catch((err: unknown) =>
    (err as { code?: string } | null)?.code === "ENOENT" ? undefined : Promise.reject(err),
  )

/** Only a project MEMORY.md under .../memory/projects/<id>/ is ever read; retracted.md is its sibling. */
export function resolveSnapshotPaths(memoryFile: string): { S: string; R: string } | undefined {
  if (path.basename(memoryFile) !== "MEMORY.md") return undefined
  const dir = path.dirname(memoryFile)
  if (path.basename(path.dirname(dir)) !== "projects") return undefined
  if (path.basename(path.dirname(path.dirname(dir))) !== "memory") return undefined
  return { S: memoryFile, R: path.join(dir, "retracted.md") }
}

const failureOf = (cause: Cause.Cause<unknown>): SnapshotFailure["reason"] =>
  /timeout|timed out/i.test(Cause.pretty(cause)) ? "timeout" : "observer_error"

function takeSnapshot(deps: ObserveDeps, now: () => number): Effect.Effect<Snapshot | SnapshotFailure> {
  const paths = resolveSnapshotPaths(deps.memoryFile)
  if (!paths) return Effect.succeed({ ok: false, reason: "scope" })
  const read = deps.readText ?? defaultRead
  const limit = deps.maxBytes ?? SNAPSHOT_MAX_BYTES
  return Effect.tryPromise({
    try: async (): Promise<Snapshot | SnapshotFailure> => {
      const [S, R] = await Promise.all([read(paths.S), read(paths.R)])
      const s = S ?? ""
      const r = R ?? ""
      const bs = Buffer.byteLength(s)
      const br = Buffer.byteLength(r)
      if (bs > limit || br > limit) return { ok: false, reason: "too_large" }
      return {
        state: { S: s, R: r },
        info: {
          ok: true,
          existed: { S: S !== undefined, R: R !== undefined },
          bytes: { S: bs, R: br },
          sha: { S: sha(s), R: sha(r) },
          capturedAt: new Date(now()).toISOString(),
        },
      }
    },
    catch: (err) => err,
  }).pipe(
    Effect.timeout(deps.stepTimeoutMs ?? OBSERVER_STEP_TIMEOUT_MS),
    Effect.catchCause((cause) => Effect.succeed<SnapshotFailure>({ ok: false, reason: failureOf(cause) === "timeout" ? "timeout" : "read_failed" })),
  )
}

function serializeFinding(f: Finding) {
  return {
    code: f.code,
    severity: f.severity,
    ids: f.ids.slice(0, MAX_IDS),
    recovery: f.recovery.action,
    message: `observed between snapshots: ${f.message}`.slice(0, MAX_TEXT),
    // The replay body is memory text: log its size only.
    ...(f.replay ? { replayBodyBytes: Buffer.byteLength(f.replay.body) } : {}),
  }
}

type Outcome = { outcome: "success" | "failure" | "interrupted"; error?: string }

function buildEvent(input: {
  deps: ObserveDeps
  dream: Outcome
  before: Snapshot | SnapshotFailure | undefined
  after: Snapshot | SnapshotFailure | undefined
  audited?: { report: InvariantReport } | { failed: "audit_threw" | "timeout" }
  durationMs: number
}) {
  const { before, after } = input
  const snap = (s: Snapshot | SnapshotFailure | undefined) =>
    s === undefined ? { ok: false, reason: "not_taken" } : "info" in s ? s.info : { ok: false, reason: s.reason }
  const b = before && "info" in before ? before : undefined
  const a = after && "info" in after ? after : undefined
  const changed = b && a ? b.info.sha.S !== a.info.sha.S || b.info.sha.R !== a.info.sha.R : undefined

  let result: Record<string, unknown>
  if (input.dream.outcome === "interrupted") result = { status: "skipped", reason: "interrupted" }
  else if (!b) result = { status: "skipped", reason: "before_failed", detail: before && "reason" in before ? before.reason : "not_taken" }
  else if (!a) result = { status: "skipped", reason: "after_failed", detail: after && "reason" in after ? after.reason : "not_taken" }
  else if (!changed) result = { status: "unchanged" }
  else if (input.audited && "failed" in input.audited) result = { status: "audit_failed", reason: input.audited.failed }
  else if (input.audited) {
    const report = input.audited.report
    const findings = report.findings.slice(0, MAX_LOGGED_FINDINGS).map(serializeFinding)
    result = {
      status: "audited",
      counts: {
        error: report.findings.filter((f) => f.severity === "error").length,
        warn: report.findings.filter((f) => f.severity === "warn").length,
      },
      invariants: {
        trace: report.trace.ok,
        nodisappear: report.nodisappear?.ok ?? null,
        inject: report.inject.ok,
        converge: report.converge.ok,
        recover: report.recover.ok,
      },
      findings,
      truncated: report.findings.length > MAX_LOGGED_FINDINGS,
    }
  } else result = { status: "skipped", reason: "audit_not_run" }

  return {
    schema: AUDIT_SCHEMA_VERSION,
    auditVersion: AUDIT_VERSION,
    window: "between_snapshots",
    scope: "project",
    run: { kind: "auto-dream", sessionID: input.deps.runID },
    dream: input.dream,
    snapshots: { before: snap(before), after: snap(after) },
    changed: changed ?? false,
    result,
    durationMs: input.durationMs,
  }
}

/**
 * Wrap one auto-dream `prompt` Effect. The returned Effect is result-equivalent to `inner`; every
 * observer step is best-effort and bounded, and can only ever produce a log line.
 */
export const observeDreamRun = <A, E, R>(inner: Effect.Effect<A, E, R>, deps: ObserveDeps): Effect.Effect<A, E, R> => {
  if (!(deps.enabled ?? T_G_AUDIT_ENABLED)) return inner
  return Effect.gen(function* () {
    const now = deps.now ?? Date.now
    const started = now()
    const timeoutMs = deps.stepTimeoutMs ?? OBSERVER_STEP_TIMEOUT_MS
    const log: AuditLog = deps.log ?? Log.create({ service: "dream-audit" })
    const emit = (event: ReturnType<typeof buildEvent>, quiet: boolean) =>
      Effect.sync(() => (quiet ? log.info("memory.audit", event) : log.warn("memory.audit", event))).pipe(
        Effect.catchCause(() => Effect.void),
      )

    const before = yield* takeSnapshot(deps, now)
    const exit = yield* Effect.exit(inner)

    const outcome: Outcome = Exit.isSuccess(exit)
      ? { outcome: "success" }
      : Cause.hasInterruptsOnly(exit.cause)
        ? { outcome: "interrupted" }
        : { outcome: "failure", error: Cause.pretty(exit.cause).slice(0, MAX_TEXT) }

    // Never delay shutdown or add reads after an interruption.
    if (outcome.outcome === "interrupted") {
      yield* emit(buildEvent({ deps, dream: outcome, before, after: undefined, durationMs: now() - started }), true)
    } else {
      const after = "info" in before ? yield* takeSnapshot(deps, now) : undefined
      let audited: { report: InvariantReport } | { failed: "audit_threw" | "timeout" } | undefined
      if (
        "info" in before &&
        after &&
        "info" in after &&
        (before.info.sha.S !== after.info.sha.S || before.info.sha.R !== after.info.sha.R)
      ) {
        const run = deps.audit ?? auditInvariants
        audited = yield* Effect.sync(() =>
          run(after.state, { budgetTokens: deps.budgetTokens, filePath: deps.memoryFile, before: before.state }),
        ).pipe(
          Effect.timeout(timeoutMs),
          Effect.map((report) => ({ report })),
          Effect.catchCause((cause) =>
            Effect.succeed<{ failed: "audit_threw" | "timeout" }>({ failed: failureOf(cause) === "timeout" ? "timeout" : "audit_threw" }),
          ),
        )
      }
      const event = buildEvent({ deps, dream: outcome, before, after, audited, durationMs: now() - started })
      const result = event.result as { status: string; counts?: { error: number }; invariants?: Record<string, boolean | null> }
      const noisy =
        result.status === "audit_failed" ||
        (result.counts?.error ?? 0) > 0 ||
        Object.values(result.invariants ?? {}).some((v) => v === false)
      yield* emit(event, !noisy)
    }

    // Result-equivalence: hand back exactly what `inner` produced.
    if (Exit.isSuccess(exit)) return exit.value
    return yield* Effect.failCause(exit.cause)
  })
}

/** Deps for the auto-dream call site: the dream session's own project id picks the memory file. */
export function autoDreamAuditDeps(input: {
  sessionID: string
  projectID: Parameters<typeof memoryPath>[0]
  memoryBudgetTokens?: number
}): ObserveDeps {
  return {
    runID: input.sessionID,
    memoryFile: memoryPath(input.projectID),
    budgetTokens: input.memoryBudgetTokens ?? DEFAULT_MEMORY_BUDGET_TOKENS,
  }
}
