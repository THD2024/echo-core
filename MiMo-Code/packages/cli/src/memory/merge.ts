/**
 * Memory merge primitive (Memory V1, task T-f). Pure: no filesystem, no Effect, no clock, no
 * randomness (callers pass `now`). It plans "provenance + replacement": N valid source records
 * of the canonical project MEMORY.md are superseded by ONE new record M that carries
 * `refs=<source ids>`. It does not judge whether the merged text is true or consistent.
 *
 * Contract (frozen in the T-f design, seq 36):
 *  - 2..8 sources; each must be a valid record with id + at + src, no ret/why, no diagnostics,
 *    exactly once in MEMORY.md, absent from retracted.md; ids must match [a-z0-9_-]{1,64}.
 *  - M's id is derived from the sorted source set, so the same set always yields the same id
 *    (idempotency / duplicate-merge detection). A different record under that id is a collision.
 *  - M's `src` is the weakest of the sources' (all equal -> kept, otherwise model_inference);
 *    a merge never raises trust.
 *  - `refs` is the only extra T-f writes: sorted, de-duplicated, comma separated, <= 256 chars.
 *  - Phase A writes M (this module returns the candidate text); Phase B retracts each pending
 *    source through the frozen `retractMemoryRecord`. This module never writes retracted.md.
 *  - A re-run with the same input after a crash between the phases is a roll-forward ("resume").
 *  - The budget guard simulates the FINAL state (M added, all pending sources removed) on the
 *    real injection pipeline; the double-visible intermediate state is not the acceptance basis.
 */
import { createHash } from "crypto"
import { parseMemoryDocument, serializeMemoryDocument, type MemorySegment } from "./record-parse"
import { readRecordMeta, withRecordMeta, type RecordSourceType } from "./record-meta"
import { deductRetracted } from "./retract-view"
import { readBudgetedSectionAwareText } from "../session/budgeted-read"

export const MERGE_MIN_SOURCES = 2
export const MERGE_MAX_SOURCES = 8
export const MERGE_REFS_MAX_LENGTH = 256
export const MERGE_BODY_MAX_CHARS = 2000
export const MERGE_REFS_KEY = "refs"

const SAFE_ID = /^[a-z0-9_-]{1,64}$/
const SRC_CODE: Record<RecordSourceType, string> = {
  user_statement: "u",
  tool_output: "t",
  model_observation: "o",
  model_inference: "i",
}

export type MergeMode = "fresh" | "resume" | "converged"

export interface MergeReport {
  mode: MergeMode
  mergeId: string
  refs: string
  sourceType: RecordSourceType
  pendingSourceIds: string[]
  doneSourceIds: string[]
  budgetTokens: number
  beforeTokens: number
  afterTokens: number
  beforeTruncated: boolean
  afterTruncated: boolean
  mergedRecordVisible: boolean
}

export type MergeComputation =
  | { ok: true; mode: MergeMode; text: string; mergeId: string; report: MergeReport }
  | { ok: false; error: string }

export interface MergeOptions {
  sourceIds: string[]
  body: string
  now: string
  budgetTokens: number
  filePath: string
}

const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error: `Merge refused: ${error}` })

export function isSafeMergeId(id: string): boolean {
  return SAFE_ID.test(id)
}

/** Validate + canonicalize a source id set into the `refs` wire value. */
export function encodeRefs(ids: readonly string[]): { ok: true; ids: string[]; value: string } | { ok: false; error: string } {
  if (ids.length < MERGE_MIN_SOURCES || ids.length > MERGE_MAX_SOURCES) {
    return { ok: false, error: `source count must be ${MERGE_MIN_SOURCES}..${MERGE_MAX_SOURCES}, got ${ids.length}` }
  }
  for (const id of ids) {
    if (typeof id !== "string" || !SAFE_ID.test(id)) {
      return { ok: false, error: `source id '${String(id)}' is outside the safe set [a-z0-9_-]{1,64}` }
    }
  }
  if (new Set(ids).size !== ids.length) return { ok: false, error: "duplicate source ids" }
  const sorted = [...ids].sort()
  const value = sorted.join(",")
  if (value.length > MERGE_REFS_MAX_LENGTH) {
    return {
      ok: false,
      error: `refs value is ${value.length} chars for ${ids.length} sources, limit is ${MERGE_REFS_MAX_LENGTH}`,
    }
  }
  return { ok: true, ids: sorted, value }
}

/** Strict inverse of encodeRefs: null unless the value is a sorted, unique list of safe ids. */
export function parseRefs(value: string): string[] | null {
  if (!value || value.length > MERGE_REFS_MAX_LENGTH) return null
  const parts = value.split(",")
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (!SAFE_ID.test(part)) return null
    if (i > 0 && !(parts[i - 1]! < part)) return null
  }
  return parts
}

export function deriveMergeId(sourceIds: readonly string[]): string {
  const sorted = [...sourceIds].sort()
  return "m" + createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 15)
}

export function weakestSourceType(types: readonly RecordSourceType[]): RecordSourceType {
  if (types.length > 0 && types.every((t) => t === types[0])) return types[0]!
  return "model_inference"
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

function validateBody(body: string): { ok: true; segment: MemorySegment } | { ok: false; error: string } {
  if (typeof body !== "string" || body.trim() === "") return { ok: false, error: "merged body is empty" }
  if (body.length > MERGE_BODY_MAX_CHARS) {
    return { ok: false, error: `merged body is ${body.length} chars, limit is ${MERGE_BODY_MAX_CHARS}` }
  }
  if (body.includes("<!--m")) return { ok: false, error: "merged body must not contain a metadata marker" }
  // Parsed under a throwaway section header: without one the parser files everything as preamble.
  const doc = parseMemoryDocument("## Body\n\n" + (body.endsWith("\n") ? body : body + "\n"))
  // segments[0] is the throwaway header; a second header in the body shows up as a non-record segment.
  const meaningful = doc.segments.slice(1).filter((s) => s.kind !== "blank")
  if (meaningful.length !== 1 || meaningful[0]!.kind !== "record") {
    return { ok: false, error: "merged body must be exactly one record (a single bullet or paragraph, no section header)" }
  }
  return { ok: true, segment: meaningful[0]! }
}

type TombEntry = { sourceType?: RecordSourceType; reason?: string; count: number }

function scanTombstones(tombRaw: string): { ok: true; byId: Map<string, TombEntry> } | { ok: false; error: string } {
  const byId = new Map<string, TombEntry>()
  for (const segment of parseMemoryDocument(tombRaw).segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    if (read.status === "malformed") return { ok: false, error: `malformed metadata in retracted.md at line ${segment.line}` }
    if (read.status !== "valid" || !read.meta.record_id) continue
    if (read.meta.retracted_at === undefined || read.meta.retract_reason === undefined) continue
    const prior = byId.get(read.meta.record_id)
    byId.set(read.meta.record_id, {
      sourceType: read.meta.source_type,
      reason: read.meta.retract_reason,
      count: (prior?.count ?? 0) + 1,
    })
  }
  return { ok: true, byId }
}

type SourceEntry = { index: number; segment: MemorySegment }

function completeVisible(texts: string[], budgetText: string): number {
  return texts.filter((t) => t.length > 0 && budgetText.includes(t)).length
}

export function computeMerge(raw: string, tombRaw: string, options: MergeOptions): MergeComputation {
  const refs = encodeRefs(options.sourceIds)
  if (!refs.ok) return refuse(refs.error + ".")
  const body = validateBody(options.body)
  if (!body.ok) return refuse(body.error + ".")
  const bodyText = body.segment.text
  const sourceSet = new Set(refs.ids)
  const mergeId = deriveMergeId(refs.ids)

  const tomb = scanTombstones(tombRaw)
  if (!tomb.ok) return refuse(tomb.error + ".")

  const doc = parseMemoryDocument(raw)
  const byId = new Map<string, SourceEntry[]>()
  doc.segments.forEach((segment, index) => {
    if (segment.kind !== "record") return
    const read = readRecordMeta(segment)
    if (read.status === "malformed") return
    const id = read.status === "valid" ? read.meta.record_id : undefined
    if (id) byId.set(id, [...(byId.get(id) ?? []), { index, segment }])
  })
  for (const segment of doc.segments) {
    if (segment.kind === "record" && readRecordMeta(segment).status === "malformed") {
      return refuse(`malformed metadata at MEMORY.md line ${segment.line}.`)
    }
  }

  if ((tomb.byId.get(mergeId)?.count ?? 0) > 0) {
    return refuse(`merged record id '${mergeId}' already exists in retracted.md (id collision).`)
  }

  const mEntries = byId.get(mergeId) ?? []
  if (mEntries.length > 1) return refuse(`merged record id '${mergeId}' is duplicated in MEMORY.md.`)

  // Classify every source: pending (still in MEMORY.md) or done (already superseded in retracted.md).
  const pending: string[] = []
  const done: string[] = []
  const types: RecordSourceType[] = []
  const hasM = mEntries.length === 1
  for (const id of refs.ids) {
    const entries = byId.get(id) ?? []
    const t = tomb.byId.get(id)
    if (entries.length > 1) return refuse(`source id '${id}' is duplicated in MEMORY.md.`)
    if (entries.length === 1) {
      if (t) return refuse(`source id '${id}' exists in both MEMORY.md and retracted.md; run the retract repair first.`)
      const seg = entries[0]!.segment
      const read = readRecordMeta(seg)
      if (read.diagnostics.length > 0) return refuse(`source '${id}' has metadata diagnostics.`)
      const m = read.meta
      if (!m.record_id || !m.recorded_at || !m.source_type) {
        return refuse(`source '${id}' has incomplete metadata (id, at and src are all required).`)
      }
      if (m.retracted_at !== undefined || m.retract_reason !== undefined) {
        return refuse(`source '${id}' already carries retract metadata.`)
      }
      pending.push(id)
      types.push(m.source_type)
    } else if (hasM && t && t.count === 1 && t.reason === "superseded" && t.sourceType) {
      done.push(id)
      types.push(t.sourceType)
    } else if (t) {
      return refuse(`source '${id}' is already retracted${t.reason ? ` (${t.reason})` : ""} and cannot be merged.`)
    } else {
      return refuse(`source id '${id}' is not present in MEMORY.md.`)
    }
  }
  if (!hasM && done.length > 0) {
    return refuse(`sources ${done.join(", ")} are already retracted but merged record '${mergeId}' is missing.`)
  }

  const sourceType = weakestSourceType(types)
  const baseView = deductRetracted(raw, tombRaw)
  const baseBudget = readBudgetedSectionAwareText(baseView.text, options.budgetTokens, options.filePath)

  const report = (
    mode: MergeMode,
    after: { totalTokens: number; truncated: boolean },
    visible: boolean,
  ): MergeReport => ({
    mode,
    mergeId,
    refs: refs.value,
    sourceType,
    pendingSourceIds: pending,
    doneSourceIds: done,
    budgetTokens: options.budgetTokens,
    beforeTokens: baseBudget.totalTokens,
    afterTokens: after.totalTokens,
    beforeTruncated: baseBudget.truncated,
    afterTruncated: after.truncated,
    mergedRecordVisible: visible,
  })

  if (hasM) {
    // Existing M: must be exactly what this input would have produced (at is the only free field).
    const seg = mEntries[0]!.segment
    const read = readRecordMeta(seg)
    const consistent =
      read.status === "valid" &&
      read.diagnostics.length === 0 &&
      read.meta.record_id === mergeId &&
      read.meta.recorded_at !== undefined &&
      read.meta.source_type === sourceType &&
      read.meta.retracted_at === undefined &&
      read.meta.retract_reason === undefined &&
      Object.keys(read.extras).length === 1 &&
      read.extras[MERGE_REFS_KEY] === refs.value &&
      markerlessText(seg) === bodyText
    if (!consistent) {
      return refuse(`record '${mergeId}' already exists with different content (id collision or a different merge body).`)
    }
    const visible = baseBudget.text.includes(seg.text)
    // Resume never re-applies the budget guard: M is already written, finishing the retracts only
    // removes records.
    return {
      ok: true,
      mode: pending.length === 0 ? "converged" : "resume",
      text: raw,
      mergeId,
      report: report(pending.length === 0 ? "converged" : "resume", baseBudget, visible),
    }
  }

  // Fresh merge: build M and insert it directly after the first source in document order.
  const firstIndex = Math.min(...pending.map((id) => byId.get(id)![0]!.index))
  const first = doc.segments[firstIndex]!
  const stamped = withRecordMeta(body.segment, {
    record_id: mergeId,
    recorded_at: options.now,
    source_type: sourceType,
    extras: { [MERGE_REFS_KEY]: refs.value },
  })
  if (!stamped.ok) return refuse("could not attach metadata to the merged record (check the timestamp).")
  const mText = stamped.text.endsWith("\n") ? stamped.text : stamped.text + "\n"
  const eol = first.text.endsWith("\r\n") ? "\r\n" : "\n"
  let prefix = raw.slice(0, first.end)
  if (!prefix.endsWith("\n")) prefix += eol
  const candidate = prefix + eol + mText + eol + raw.slice(first.end)

  // Post-condition: inserting must not disturb any existing record, and M must parse as one record
  // in the first source's section.
  const candDoc = parseMemoryDocument(candidate)
  const candRecords = candDoc.segments.filter((s) => s.kind === "record")
  const mSeg = candRecords.filter((s) => readRecordMeta(s).meta.record_id === mergeId)
  const others = candRecords.filter((s) => readRecordMeta(s).meta.record_id !== mergeId).map((s) => s.text)
  const originals = doc.segments.filter((s) => s.kind === "record").map((s) => s.text)
  if (
    mSeg.length !== 1 ||
    mSeg[0]!.section !== first.section ||
    markerlessText(mSeg[0]!) !== bodyText ||
    others.length !== originals.length ||
    others.some((t, i) => t !== originals[i])
  ) {
    return refuse("inserting the merged record would change the document structure.")
  }

  // Final-state simulation: M present, every pending source removed (as retract leaves it).
  const pendingSet = new Set(pending)
  const finalText = serializeMemoryDocument({
    segments: candDoc.segments.map((segment) => {
      if (segment.kind !== "record") return segment
      const id = readRecordMeta(segment).meta.record_id
      return id && sourceSet.has(id) && pendingSet.has(id) ? { ...segment, text: "" } : segment
    }),
  })
  const finalView = deductRetracted(finalText, tombRaw)
  const finalBudget = readBudgetedSectionAwareText(finalView.text, options.budgetTokens, options.filePath)
  const visible = finalBudget.text.includes(mText)

  if (!baseBudget.truncated && finalBudget.truncated) {
    return refuse(
      `the merged state would introduce new memory truncation (budget=${options.budgetTokens}, ` +
        `before=${baseBudget.totalTokens}, after=${finalBudget.totalTokens} tokens). Use a shorter merged body.`,
    )
  }
  if (!visible) {
    return refuse(
      `the merged record would not be fully visible in the injected memory (budget=${options.budgetTokens}, ` +
        `after=${finalBudget.totalTokens} tokens). Use a shorter merged body.`,
    )
  }
  const otherTexts = doc.segments
    .filter((s) => s.kind === "record" && !sourceSet.has(readRecordMeta(s).meta.record_id ?? ""))
    .map((s) => s.text)
  const beforeOthers = completeVisible(otherTexts, baseBudget.text)
  const afterOthers = completeVisible(otherTexts, finalBudget.text)
  if (afterOthers < beforeOthers) {
    return refuse(
      `other records fully visible in injected memory would decrease (${beforeOthers} -> ${afterOthers}; ` +
        `budget=${options.budgetTokens}). Use a shorter merged body.`,
    )
  }

  return { ok: true, mode: "fresh", text: candidate, mergeId, report: report("fresh", finalBudget, visible) }
}

/** Final check after Phase B: M once, no source left in MEMORY.md, each source superseded once in retracted.md. */
export function verifyMergeConverged(
  raw: string,
  tombRaw: string,
  input: { mergeId: string; sourceIds: readonly string[] },
): { ok: true } | { ok: false; error: string } {
  const tomb = scanTombstones(tombRaw)
  if (!tomb.ok) return { ok: false, error: tomb.error }
  const sourceSet = new Set(input.sourceIds)
  let mCount = 0
  for (const segment of parseMemoryDocument(raw).segments) {
    if (segment.kind !== "record") continue
    const read = readRecordMeta(segment)
    const id = read.status === "valid" ? read.meta.record_id : undefined
    if (id === input.mergeId) mCount++
    if (id && sourceSet.has(id)) return { ok: false, error: `source '${id}' is still present in MEMORY.md.` }
  }
  if (mCount !== 1) return { ok: false, error: `merged record '${input.mergeId}' appears ${mCount} times in MEMORY.md.` }
  for (const id of input.sourceIds) {
    const t = tomb.byId.get(id)
    if (!t || t.count !== 1 || t.reason !== "superseded") {
      return { ok: false, error: `source '${id}' has no single superseded tombstone in retracted.md.` }
    }
  }
  return { ok: true }
}

export function formatMergeReport(report: MergeReport, mode: { dryRun: boolean; written: boolean; retracted: string[] }): string {
  const head = mode.dryRun
    ? `Merge dry-run (${report.mode}): would ${report.mode === "fresh" ? "write" : "keep"} record '${report.mergeId}' and supersede ${report.pendingSourceIds.length} source(s); nothing was written.`
    : report.mode === "converged"
      ? `Merge already complete: record '${report.mergeId}' exists and all ${report.doneSourceIds.length} source(s) are superseded; nothing changed.`
      : `Merge ${report.mode === "resume" ? "resumed" : "completed"}: record '${report.mergeId}' supersedes ${report.pendingSourceIds.length + report.doneSourceIds.length} source(s).`
  return [
    head,
    `refs=${report.refs} src=${SRC_CODE[report.sourceType]}`,
    `Superseded now: ${mode.retracted.length > 0 ? mode.retracted.join(", ") : report.pendingSourceIds.join(", ") || "none"}${mode.dryRun ? " (planned)" : ""}.`,
    report.doneSourceIds.length > 0 ? `Already superseded earlier: ${report.doneSourceIds.join(", ")}.` : "",
    `Budget: ${report.budgetTokens} tokens; injected view ${report.beforeTokens} -> ${report.afterTokens} tokens` +
      `${report.afterTruncated ? " (truncated)" : ""}; merged record fully visible: ${report.mergedRecordVisible ? "yes" : "no"}.`,
    "Merge records provenance and replacement only; it does not verify that the merged text is true or consistent. " +
      "Direct deletions made with edit/write are not audited by this tool.",
  ]
    .filter(Boolean)
    .join("\n")
}
