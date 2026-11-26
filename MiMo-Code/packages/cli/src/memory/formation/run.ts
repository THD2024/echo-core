/**
 * Memory Formation Phase 1 — the formation step (experience -> candidate -> validation -> shadow).
 *
 * Plain async functions with injected IO: no Effect, no Database, no Global imports, so the whole pipeline is
 * testable with stubs. Nothing here ever throws (every entry point is wrapped), never touches MEMORY.md /
 * retracted.md / FTS / injection (read-only access to the two snapshot files), and writes only through `store.ts`.
 *
 * Candidate source (Phase 1): records that appear in the project MEMORY.md between the before/after snapshots of a
 * manual `/dream`. Their text is the only thing taken; any `<!--m ...-->` marker, id, timestamp or source on them is
 * model-supplied, is stripped and counted, and is never used. Evidence is assigned by the Body (a `dream_run`
 * system_event referencing the session), attribution is always `inferred`.
 */
import { normalizeCandidate, type BodyContext } from "./candidate"
import type { Evidence, EvidenceResolver } from "./evidence"
import { buildEntry, listIds, writeEntry } from "./store"
import { normText, validateCandidate } from "./validate"
import { listRecords, parseMemoryDocument } from "../record-parse"

export const MAX_CANDIDATES_PER_RUN = 20
export const STEP_TIMEOUT_MS = 5_000

export interface FormationLog {
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
}

export interface FormationDeps {
  base: string
  projectID: string
  sessionID: string
  memoryFile: string
  retractedFile: string
  /** Returns undefined when the file is absent, unreadable or over the snapshot cap. */
  readText(file: string): Promise<string | undefined>
  resolver: EvidenceResolver
  readTaskState(): Promise<string[]> | string[]
  now: () => number
  log: FormationLog
}

export interface FormationSummary {
  skipped?: string
  candidates: number
  accepted: number
  rejected: Record<string, number>
  written: number
  exists: number
  full: number
  rejectedWrites: number
  droppedMarkers: number
  overCap: number
}

const empty = (skipped?: string): FormationSummary => ({
  ...(skipped ? { skipped } : {}),
  candidates: 0, accepted: 0, rejected: {}, written: 0, exists: 0, full: 0, rejectedWrites: 0, droppedMarkers: 0, overCap: 0,
})

const MARKER_TAIL = /\s*<!--m\b[^>]*-->\s*$/
const BULLET = /^\s{0,3}(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/

/** Record bodies of a MEMORY-style document (bullet stripped, trailing first-line marker stripped and counted). */
export function recordContents(raw: string): { contents: string[]; markers: number } {
  const contents: string[] = []
  let markers = 0
  for (const seg of listRecords(parseMemoryDocument(raw))) {
    if (seg.kind !== "record") continue
    let t = seg.text.replace(/\r\n/g, "\n").replace(/\n+$/, "")
    const nl = t.indexOf("\n")
    let first = nl === -1 ? t : t.slice(0, nl)
    const rest = nl === -1 ? "" : t.slice(nl)
    if (MARKER_TAIL.test(first)) {
      first = first.replace(MARKER_TAIL, "")
      markers++
    }
    t = (first + rest).replace(BULLET, "")
    contents.push(t.trim())
  }
  return { contents, markers }
}

/** Snapshot of the project MEMORY.md before the dream. Never throws; undefined = cannot diff (formation is skipped). */
export async function takeSnapshot(deps: Pick<FormationDeps, "readText" | "memoryFile">): Promise<string | undefined> {
  try {
    return await deps.readText(deps.memoryFile)
  } catch {
    return undefined
  }
}

async function step(deps: FormationDeps, before: string): Promise<FormationSummary> {
  const sum = empty()
  const after = await deps.readText(deps.memoryFile)
  if (after === undefined) return empty("no_after_snapshot")
  const b = recordContents(before)
  const a = recordContents(after)
  const beforeSet = new Set(b.contents.map(normText))
  const seen = new Set<string>()
  const fresh: string[] = []
  for (const c of a.contents) {
    const n = normText(c)
    if (!n || beforeSet.has(n) || seen.has(n)) continue
    seen.add(n)
    fresh.push(c)
  }
  sum.droppedMarkers = a.markers
  if (fresh.length === 0) return sum
  if (fresh.length > MAX_CANDIDATES_PER_RUN) {
    sum.overCap = fresh.length - MAX_CANDIDATES_PER_RUN
    fresh.length = MAX_CANDIDATES_PER_RUN
  }

  const retractedRaw = (await deps.readText(deps.retractedFile)) ?? ""
  const retracted = recordContents(retractedRaw).contents
  let tasks: string[] = []
  try {
    tasks = await deps.readTaskState()
  } catch {
    tasks = []
  }
  const known = await listIds(deps.base, deps.projectID)
  const bodyEvidence: Evidence[] = [{ type: "system_event", name: "dream_run", ref: deps.sessionID }]
  const ctx: BodyContext = {
    projectID: deps.projectID,
    sessionID: deps.sessionID,
    channel: "dream_snapshot",
    proposedBy: "dream",
    now: deps.now,
    bodyEvidence,
  }
  const reject = (reason: string) => {
    sum.rejected[reason] = (sum.rejected[reason] ?? 0) + 1
  }
  for (const content of fresh) {
    sum.candidates++
    const n = normalizeCandidate({ content }, ctx)
    if (!n.ok) {
      for (const r of n.reasons) reject(r)
      continue
    }
    const v = validateCandidate(n.candidate, {
      resolver: deps.resolver,
      memoryRecords: b.contents,
      retractedRecords: retracted,
      taskStateTexts: tasks,
      knownCandidateIds: known,
    })
    if (v.verdict !== "accept") {
      for (const r of v.reasons) reject(r)
      continue
    }
    sum.accepted++
    const res = await writeEntry(deps.base, buildEntry(n.candidate, v))
    if (res === "written") sum.written++
    else if (res === "exists") sum.exists++
    else if (res === "full") sum.full++
    else sum.rejectedWrites++
    known.add(n.candidate.candidate_id)
  }
  return sum
}

/** The formation step with a hard timeout and total failure isolation. Never throws, never rejects. */
export async function runFormationStep(deps: FormationDeps, before: string, timeoutMs = STEP_TIMEOUT_MS): Promise<FormationSummary> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const out = await Promise.race([
      step(deps, before),
      new Promise<FormationSummary>((resolve) => {
        timer = setTimeout(() => resolve(empty("timeout")), timeoutMs)
      }),
    ])
    try {
      deps.log.info("memory.formation", { phase: 1, sessionID: deps.sessionID, ...out })
    } catch {}
    return out
  } catch {
    const out = empty("error")
    try {
      deps.log.warn("memory.formation", { phase: 1, sessionID: deps.sessionID, ...out })
    } catch {}
    return out
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type { EvidenceResolver }
