/**
 * Memory V1 audit (task T-g.1). Pure and read-only: no filesystem, no Effect, no clock, no repair,
 * no truth arbitration. It judges two things from raw `MEMORY.md` / `retracted.md` text:
 *
 *  - auditTransition(before, after): what disappeared or changed between two snapshots, regardless of
 *    which tool (edit/write/apply_patch/bash/hand edit) did it. The window is the two snapshots, so
 *    findings say "between snapshots" and never claim to know WHO acted.
 *  - auditProvenance(S, R): whether every `refs` claim resolves (merged record -> source ids ->
 *    retracted history).
 *
 * Out of scope on purpose: records without an id (legacy, unmigrated) cannot be tracked by id; a
 * direct single-record delete has no audited path and is only detected here; nothing is blocked,
 * reverted or fixed. Wiring this into a run (T-g.2) is a separate, default-off step.
 */
import { parseMemoryDocument, type MemorySegment } from "./record-parse"
import { readRecordMeta, withRecordMeta, type RecordMetaRead } from "./record-meta"
import { deductRetracted } from "./retract-view"
import { MERGE_REFS_KEY, computeMerge, parseRefs } from "./merge"
import { readBudgetedSectionAwareText } from "../session/budgeted-read"

export type FindingCode =
  | "unexplained_disappearance"
  | "tombstone_lost"
  | "tombstone_mutated"
  // The id is present in BOTH MEMORY.md and retracted.md (the S+R double-store state T-d.3 repairs).
  | "retracted_without_tombstone_history"
  | "id_churn"
  // The heuristic id_churn pairing ran out of its computation budget: some candidate pairs were NOT checked.
  | "audit_limited"
  | "incomplete_merge"
  | "malformed_metadata"
  | "refs_unparseable"
  | "refs_orphan"
  | "refs_wrong_reason"
  | "refs_cycle"

export type RecoveryAction = "resume_merge" | "repair_double_store" | "manual_review"

export interface Finding {
  code: FindingCode
  severity: "error" | "warn"
  /** Record ids involved (first is the primary subject). */
  ids: string[]
  message: string
  /** Every finding has a deterministic next step (I-recover). */
  recovery: { action: RecoveryAction; detail: string }
  /** For incomplete_merge: the exact memory_merge input that resumes it. */
  replay?: { mergeId: string; sourceIds: string[]; pendingSourceIds: string[]; body: string }
}

export interface MemoryState {
  S: string
  R: string
}

/** Same threshold as the T-b2 reconcile pairing (record-identity.ts); duplicated because it is not exported. */
export const ID_CHURN_SIMILARITY_THRESHOLD = 0.5
export const PROVENANCE_MAX_DEPTH = 8
/**
 * Hard upper bound on LCS dynamic-programming cells spent by the heuristic id_churn pairing in ONE
 * auditTransition call (~0.2 s of CPU). It bounds only id_churn; the error-level checks are O(n) and never
 * consult it. When it runs out, the audit says so with an `audit_limited` warning.
 */
export const ID_CHURN_LCS_CELL_BUDGET = 25_000_000
const LCS_CHAR_CAP = 2000

/** Optional accounting for the bounded id_churn pairing; counters are added to, never reset. */
export interface AuditStats {
  lcsCells: number
  lcsPairs: number
  uncheckedPairs: number
}
export interface TransitionOptions {
  /** Defaults to ID_CHURN_LCS_CELL_BUDGET. 0 disables the LCS stage (exact-text matches still pair). */
  lcsCellBudget?: number
  stats?: AuditStats
}

const MANUAL = (detail: string) => ({ action: "manual_review" as const, detail })

type Entry = { id: string; segment: MemorySegment; read: RecordMetaRead }
type Index = {
  records: Map<string, Entry[]>
  tombs: Map<string, Entry[]>
  malformedS: number[]
  malformedR: number[]
}

function markerlessText(segment: Pick<MemorySegment, "kind" | "text">): string {
  const read = readRecordMeta(segment)
  if (read.status !== "valid") return segment.text
  const removed = withRecordMeta(segment, {
    record_id: null,
    recorded_at: null,
    source_type: null,
    retracted_at: null,
    retract_reason: null,
    extras: Object.fromEntries(Object.keys(read.extras).map((k) => [k, null])),
  })
  return removed.ok ? removed.text : segment.text
}

function lcsSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const x = a.slice(0, LCS_CHAR_CAP)
  const y = b.slice(0, LCS_CHAR_CAP)
  const dp = new Array<number>(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i++) {
    let diagonal = 0
    for (let j = 1; j <= y.length; j++) {
      const above = dp[j]!
      if (x[i - 1] === y[j - 1]) dp[j] = diagonal + 1
      else dp[j] = Math.max(dp[j]!, dp[j - 1]!)
      diagonal = above
    }
  }
  return dp[y.length]! / Math.max(x.length, y.length)
}

function indexState(state: MemoryState): Index {
  const index: Index = { records: new Map(), tombs: new Map(), malformedS: [], malformedR: [] }
  for (const segment of parseMemoryDocument(state.S).segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") index.malformedS.push(segment.line)
    else if (read.status === "valid" && read.meta.record_id) {
      const id = read.meta.record_id
      index.records.set(id, [...(index.records.get(id) ?? []), { id, segment, read }])
    }
  }
  for (const segment of parseMemoryDocument(state.R).segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") index.malformedR.push(segment.line)
    else if (
      read.status === "valid" &&
      read.meta.record_id &&
      read.meta.retracted_at !== undefined &&
      read.meta.retract_reason !== undefined
    ) {
      const id = read.meta.record_id
      index.tombs.set(id, [...(index.tombs.get(id) ?? []), { id, segment, read }])
    }
  }
  return index
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) =>
    a.code !== b.code ? (a.code < b.code ? -1 : 1) : a.ids.join(",") < b.ids.join(",") ? -1 : a.ids.join(",") > b.ids.join(",") ? 1 : 0,
  )
}

function stateFindings(index: Index): Finding[] {
  const findings: Finding[] = []
  if (index.malformedS.length > 0) {
    findings.push({
      code: "malformed_metadata",
      severity: "warn",
      ids: [],
      message: `MEMORY.md has malformed metadata at line(s) ${index.malformedS.join(", ")}; those records cannot be tracked by id.`,
      recovery: MANUAL("Fix or remove the broken <!--m ...--> markers by hand."),
    })
  }
  if (index.malformedR.length > 0) {
    findings.push({
      code: "malformed_metadata",
      severity: "error",
      ids: [],
      message: `retracted.md has malformed metadata at line(s) ${index.malformedR.join(", ")}; retraction history is not trustworthy.`,
      recovery: MANUAL("Restore retracted.md from backup; do not edit it by hand."),
    })
  }
  for (const id of [...index.records.keys()].sort()) {
    if (index.tombs.has(id)) {
      findings.push({
        code: "retracted_without_tombstone_history",
        severity: "warn",
        ids: [id],
        message: `Record '${id}' is present in both MEMORY.md and retracted.md (double-store state).`,
        recovery: {
          action: "repair_double_store",
          detail: `Re-run memory_retract for '${id}'; the T-d.3 roll-forward removes the source copy.`,
        },
      })
    }
  }
  return findings
}

function incompleteMerges(index: Index): Finding[] {
  const findings: Finding[] = []
  for (const [id, entries] of index.records) {
    if (entries.length !== 1) continue
    const refsValue = entries[0]!.read.extras[MERGE_REFS_KEY]
    if (refsValue === undefined) continue
    const sourceIds = parseRefs(refsValue)
    if (!sourceIds) continue // reported by auditProvenance
    const pending = sourceIds.filter((s) => index.records.has(s) && !index.tombs.has(s))
    if (pending.length === 0) continue
    const body = markerlessText(entries[0]!.segment)
    findings.push({
      code: "incomplete_merge",
      severity: "warn",
      ids: [id, ...pending],
      message: `Merged record '${id}' still has ${pending.length} un-retracted source(s): ${pending.join(", ")}.`,
      recovery: {
        action: "resume_merge",
        detail: `Call memory_merge with source_ids=[${sourceIds.join(", ")}] and the merged record's text to resume.`,
      },
      replay: { mergeId: id, sourceIds, pendingSourceIds: pending, body },
    })
  }
  return findings
}

/**
 * What changed between two snapshots. Reports only; nothing is repaired. The window is the two
 * snapshots, so a finding does not say who acted.
 */
export function auditTransition(before: MemoryState, after: MemoryState, options: TransitionOptions = {}): Finding[] {
  const b = indexState(before)
  const a = indexState(after)
  const findings: Finding[] = [...stateFindings(a), ...incompleteMerges(a)]

  // Retraction history is append-only: every earlier tombstone must survive byte for byte.
  for (const id of [...b.tombs.keys()].sort()) {
    const now = a.tombs.get(id) ?? []
    if (now.length === 0) {
      findings.push({
        code: "tombstone_lost",
        severity: "error",
        ids: [id],
        message: `Tombstone for '${id}' existed in retracted.md before and is gone between snapshots.`,
        recovery: MANUAL("Restore retracted.md from backup; the retraction history is append-only."),
      })
      continue
    }
    const remaining = now.map((e) => e.segment.text)
    for (const old of b.tombs.get(id)!) {
      const at = remaining.indexOf(old.segment.text)
      if (at >= 0) remaining.splice(at, 1)
      else {
        findings.push({
          code: "tombstone_mutated",
          severity: "error",
          ids: [id],
          message: `Tombstone for '${id}' was modified between snapshots (content or metadata differs).`,
          recovery: MANUAL("Restore retracted.md from backup; tombstones must never be edited."),
        })
        break
      }
    }
  }

  // An id that was live before must still be live or explained by a tombstone.
  const disappeared: string[] = []
  for (const id of [...b.records.keys()].sort()) {
    if (a.records.has(id) || a.tombs.has(id)) continue
    disappeared.push(id)
    findings.push({
      code: "unexplained_disappearance",
      severity: "error",
      ids: [id],
      message: `Record '${id}' was in MEMORY.md before and is in neither MEMORY.md nor retracted.md between snapshots.`,
      recovery: MANUAL("Restore the record from history/backup, or retract it properly with memory_retract."),
    })
  }

  // A vanished id plus a brand-new, similar, non-merge record usually means an edit lost its identity.
  // Bounded: exact-text matches pair in O(n); the rest are pruned by a sound length bound and then share ONE
  // global LCS cell budget. Pairs the budget cannot afford are counted and reported (audit_limited).
  const budget = Math.max(0, options.lcsCellBudget ?? ID_CHURN_LCS_CELL_BUDGET)
  let cellsUsed = 0
  let pairsDone = 0
  let unchecked = 0
  const taken = new Set<string>()
  const oldText = new Map<string, string>()
  const exactByText = new Map<string, string[]>()
  for (const id of disappeared) {
    const text = markerlessText(b.records.get(id)![0]!.segment)
    oldText.set(id, text)
    exactByText.set(text, [...(exactByText.get(text) ?? []), id])
  }
  for (const [newId, entries] of [...a.records].sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (b.records.has(newId) || b.tombs.has(newId) || entries.length !== 1) continue
    if (entries[0]!.read.extras[MERGE_REFS_KEY] !== undefined) continue
    const newText = markerlessText(entries[0]!.segment)
    let best: { id: string; score: number } | undefined
    const exactId = exactByText.get(newText)?.find((id) => !taken.has(id))
    if (exactId !== undefined) best = { id: exactId, score: 1 }
    else {
      for (const oldId of disappeared) {
        if (taken.has(oldId)) continue
        const text = oldText.get(oldId)!
        const x = Math.min(text.length, LCS_CHAR_CAP)
        const y = Math.min(newText.length, LCS_CHAR_CAP)
        if (x === 0 || y === 0) continue
        // lcs <= min(x, y), so similarity <= min/max: below the threshold it can never pair (exact pruning).
        if (Math.min(x, y) / Math.max(x, y) < ID_CHURN_SIMILARITY_THRESHOLD) continue
        if (cellsUsed + x * y > budget) {
          unchecked++
          continue
        }
        cellsUsed += x * y
        pairsDone++
        const score = lcsSimilarity(text, newText)
        if (score >= ID_CHURN_SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { id: oldId, score }
      }
    }
    if (best) {
      taken.add(best.id)
      findings.push({
        code: "id_churn",
        severity: "warn",
        ids: [best.id, newId],
        message: `Record '${best.id}' vanished and similar record '${newId}' appeared between snapshots (similarity ${best.score.toFixed(2)}); an edit may have lost its identity.`,
        recovery: MANUAL(`Check whether '${newId}' is the edited '${best.id}' and restore the original id if so.`),
      })
    }
  }
  if (options.stats) {
    options.stats.lcsCells += cellsUsed
    options.stats.lcsPairs += pairsDone
    options.stats.uncheckedPairs += unchecked
  }
  if (unchecked > 0) {
    findings.push({
      code: "audit_limited",
      severity: "warn",
      ids: [],
      message: `id_churn check was limited: its computation budget (${budget} cells) ran out, so ${unchecked} candidate pair(s) were not checked; absence of id_churn findings is not a guarantee.`,
      recovery: MANUAL("Compare vanished and newly added records by hand, or audit smaller snapshots."),
    })
  }
  return sortFindings(findings)
}

/** Whether every `refs` claim resolves: record -> source ids -> retracted history, without cycles. */
export function auditProvenance(S: string, R: string): Finding[] {
  const index = indexState({ S, R })
  const findings: Finding[] = []
  const known = (id: string) => index.records.has(id) || index.tombs.has(id)
  const refsOf = (id: string): string | undefined => {
    const t = index.tombs.get(id)?.[0]
    if (t) return t.read.extras[MERGE_REFS_KEY]
    return index.records.get(id)?.[0]?.read.extras[MERGE_REFS_KEY]
  }
  const reasonOf = (id: string): string | undefined => index.tombs.get(id)?.[0]?.read.meta.retract_reason

  const claimants = new Map<string, string>()
  for (const [id, entries] of index.records) {
    const v = entries[0]!.read.extras[MERGE_REFS_KEY]
    if (v !== undefined) claimants.set(id, v)
  }
  for (const [id, entries] of index.tombs) {
    const v = entries[0]!.read.extras[MERGE_REFS_KEY]
    if (v !== undefined) claimants.set(id, v)
  }

  const bad = new Set<string>()
  for (const [id, value] of [...claimants].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const ids = parseRefs(value)
    if (!ids) {
      bad.add(id)
      findings.push({
        code: "refs_unparseable",
        severity: "error",
        ids: [id],
        message: `Record '${id}' has a refs value that is not a sorted, unique list of safe ids.`,
        recovery: MANUAL("Rewrite refs by hand or re-create the merge with memory_merge."),
      })
      continue
    }
    for (const ref of ids) {
      if (ref === id) {
        findings.push({
          code: "refs_cycle",
          severity: "error",
          ids: [id, ref],
          message: `Record '${id}' lists itself as a source.`,
          recovery: MANUAL("Remove the self reference."),
        })
      } else if (!known(ref)) {
        findings.push({
          code: "refs_orphan",
          severity: "error",
          ids: [id, ref],
          message: `Record '${id}' cites source '${ref}', which is in neither MEMORY.md nor retracted.md.`,
          recovery: MANUAL(`Restore the history of '${ref}' or correct refs on '${id}'.`),
        })
      } else if (index.tombs.has(ref) && reasonOf(ref) !== "superseded") {
        findings.push({
          code: "refs_wrong_reason",
          severity: "warn",
          ids: [id, ref],
          message: `Record '${id}' cites source '${ref}', which was retracted as '${reasonOf(ref)}', not 'superseded'.`,
          recovery: MANUAL(`Confirm '${ref}' was really merged into '${id}'.`),
        })
      }
    }
  }

  // Cycles and over-deep chains along refs (a source's own refs come from its tombstone when retracted).
  const reported = new Set<string>()
  const walk = (id: string, stack: string[]): void => {
    if (bad.has(id)) return
    const value = refsOf(id)
    if (value === undefined) return
    const ids = parseRefs(value)
    if (!ids) return
    for (const ref of ids) {
      if (ref === id || !known(ref)) continue
      const at = stack.indexOf(ref)
      if (at >= 0) {
        const cycle = [...stack.slice(at), ref]
        const key = [...new Set(cycle)].sort().join(",")
        if (!reported.has(key)) {
          reported.add(key)
          findings.push({
            code: "refs_cycle",
            severity: "error",
            ids: cycle,
            message: `refs form a cycle: ${cycle.join(" -> ")}.`,
            recovery: MANUAL("Break the cycle; a source cannot (transitively) cite its own merge."),
          })
        }
        continue
      }
      if (stack.length >= PROVENANCE_MAX_DEPTH) {
        const key = `depth:${stack[0]}`
        if (!reported.has(key)) {
          reported.add(key)
          findings.push({
            code: "refs_cycle",
            severity: "error",
            ids: [stack[0]!, ref],
            message: `refs chain from '${stack[0]}' is deeper than ${PROVENANCE_MAX_DEPTH}.`,
            recovery: MANUAL("Flatten the provenance chain."),
          })
        }
        continue
      }
      walk(ref, [...stack, ref])
    }
  }
  for (const id of [...claimants.keys()].sort()) walk(id, [id])
  return sortFindings(findings)
}

export interface InvariantCheck {
  ok: boolean
  details: string[]
}

export interface InvariantReport {
  ok: boolean
  /** I-trace: provenance has no error. */
  trace: InvariantCheck
  /** I-nodisappear: only evaluated when a `before` snapshot is given. */
  nodisappear: InvariantCheck | null
  /** I-inject: the real injection pipeline shows no retracted id. */
  inject: InvariantCheck
  /** I-converge: replaying each merge is converged (or a reported incomplete merge) and the audit is idempotent. */
  converge: InvariantCheck
  /** I-recover: every finding has a deterministic recovery action and incomplete merges are resumable. */
  recover: InvariantCheck
  findings: Finding[]
}

const check = (details: string[]): InvariantCheck => ({ ok: details.length === 0, details })
const RECOVERY_ACTIONS = new Set<RecoveryAction>(["resume_merge", "repair_double_store", "manual_review"])

/** Memory V1 minimal measurable invariants on a state, optionally relative to an earlier snapshot. */
export function auditInvariants(
  after: MemoryState,
  options: {
    budgetTokens: number
    filePath: string
    before?: MemoryState
    now?: string
    lcsCellBudget?: number
    stats?: AuditStats
  },
): InvariantReport {
  const provenance = auditProvenance(after.S, after.R)
  // The one and only full transition audit of this call (its result is reused below).
  const transition = options.before
    ? auditTransition(options.before, after, { lcsCellBudget: options.lcsCellBudget, stats: options.stats })
    : null
  const index = indexState(after)
  const findings = sortFindings([
    ...provenance,
    ...(transition ?? [...stateFindings(index), ...incompleteMerges(index)]),
  ])
  const dedup = findings.filter(
    (f, i) => findings.findIndex((g) => g.code === f.code && g.ids.join(",") === f.ids.join(",")) === i,
  )

  const trace = check(provenance.filter((f) => f.severity === "error").map((f) => `${f.code}: ${f.message}`))

  const nodisappear = transition
    ? check(
        transition
          .filter((f) => ["unexplained_disappearance", "tombstone_lost", "tombstone_mutated"].includes(f.code))
          .map((f) => `${f.code}: ${f.message}`),
      )
    : null

  const injectDetails: string[] = []
  const view = deductRetracted(after.S, after.R)
  const injected = readBudgetedSectionAwareText(view.text, options.budgetTokens, options.filePath).text
  // Structural check (not a text search): prose that merely mentions "id=..." must not count.
  const visibleIds = new Set<string>()
  for (const segment of parseMemoryDocument(injected).segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "valid" && read.meta.record_id) visibleIds.add(read.meta.record_id)
  }
  for (const id of [...index.tombs.keys()].sort()) {
    if (visibleIds.has(id)) injectDetails.push(`retracted id '${id}' is still visible in the injected memory`)
  }

  const convergeDetails: string[] = []
  for (const [id, entries] of [...index.records].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const value = entries[0]!.read.extras[MERGE_REFS_KEY]
    if (entries.length !== 1 || value === undefined) continue
    const sourceIds = parseRefs(value)
    if (!sourceIds) continue // trace covers it
    const replay = computeMerge(after.S, after.R, {
      sourceIds,
      body: markerlessText(entries[0]!.segment),
      now: options.now ?? "1970-01-01T00:00:00Z",
      budgetTokens: options.budgetTokens,
      filePath: options.filePath,
    })
    if (!replay.ok) convergeDetails.push(`merge '${id}' cannot be replayed: ${replay.error}`)
    else if (replay.mergeId !== id) convergeDetails.push(`merge '${id}' does not match the id derived from its refs (${replay.mergeId})`)
    else if (replay.mode === "fresh") convergeDetails.push(`merge '${id}' replays as a fresh merge`)
  }
  // Idempotency of the exact (non-heuristic) findings, rechecked WITHOUT the LCS stage so it costs O(n),
  // not a second full id_churn pass.
  const exactLevel = (fs: Finding[]) => fs.filter((f) => f.code !== "id_churn" && f.code !== "audit_limited")
  const again = options.before ? auditTransition(options.before, after, { lcsCellBudget: 0 }) : null
  if (transition && JSON.stringify(exactLevel(again!)) !== JSON.stringify(exactLevel(transition))) {
    convergeDetails.push("audit is not idempotent")
  }
  if (JSON.stringify(auditProvenance(after.S, after.R)) !== JSON.stringify(provenance)) {
    convergeDetails.push("provenance audit is not idempotent")
  }

  const recoverDetails: string[] = []
  for (const f of dedup) {
    if (!RECOVERY_ACTIONS.has(f.recovery.action) || !f.recovery.detail) recoverDetails.push(`${f.code} has no recovery action`)
    if (f.code === "incomplete_merge") {
      const r = f.replay!
      const replay = computeMerge(after.S, after.R, {
        sourceIds: r.sourceIds,
        body: r.body,
        now: options.now ?? "1970-01-01T00:00:00Z",
        budgetTokens: options.budgetTokens,
        filePath: options.filePath,
      })
      if (!replay.ok || replay.mode !== "resume") {
        recoverDetails.push(`incomplete merge '${r.mergeId}' is not resumable: ${replay.ok ? replay.mode : replay.error}`)
      }
    }
  }

  const report = {
    trace,
    nodisappear,
    inject: check(injectDetails),
    converge: check(convergeDetails),
    recover: check(recoverDetails),
  }
  return {
    ...report,
    ok:
      report.trace.ok &&
      (report.nodisappear?.ok ?? true) &&
      report.inject.ok &&
      report.converge.ok &&
      report.recover.ok,
    findings: dedup,
  }
}
