import { parseMemoryDocument, serializeMemoryDocument, type MemorySegment } from "./record-parse"
import { readRecordMeta, withRecordMeta, type RecordMetaPatch, type RecordMetaRead } from "./record-meta"

export type RecordIdentityOptions = {
  generateId: () => string
  now: string
  defaultSourceType?: "user_statement" | "tool_output" | "model_observation" | "model_inference"
}

export type RecordIdentityResult =
  | { ok: true; text: string; changed: boolean; stamped: number; preserved: number; generated: number }
  | { ok: false; text: string; error: string }

type Pair = { oldIndex: number; newIndex: number }
const DEFAULT_SOURCE = "model_inference" as const

function markerlessText(segment: MemorySegment): string {
  const read = readRecordMeta(segment)
  if (read.status !== "valid") return segment.text
  const patch: RecordMetaPatch = {
    record_id: null, recorded_at: null, source_type: null, retracted_at: null, retract_reason: null,
    extras: Object.fromEntries(Object.keys(read.extras).map((k) => [k, null])),
  }
  const removed = withRecordMeta(segment, patch)
  return removed.ok ? removed.text : segment.text
}

function lcsPairs(oldRecords: MemorySegment[], newRecords: MemorySegment[]): Pair[] {
  const n = oldRecords.length, m = newRecords.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i]![j] = markerlessText(oldRecords[i]!) === markerlessText(newRecords[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const anchors: Pair[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (markerlessText(oldRecords[i]!) === markerlessText(newRecords[j]!)) {
      anchors.push({ oldIndex: i, newIndex: j }); i++; j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  const all = [...anchors]
  let prevOld = -1, prevNew = -1
  for (const a of anchors) {
    if (a.oldIndex - prevOld - 1 === 1 && a.newIndex - prevNew - 1 === 1)
      all.push({ oldIndex: prevOld + 1, newIndex: prevNew + 1 })
    prevOld = a.oldIndex; prevNew = a.newIndex
  }
  if (n - prevOld - 1 === 1 && m - prevNew - 1 === 1)
    all.push({ oldIndex: prevOld + 1, newIndex: prevNew + 1 })
  return all
}

function correspondence(oldDoc: ReturnType<typeof parseMemoryDocument>, newDoc: ReturnType<typeof parseMemoryDocument>): Map<number, number> {
  const oldBySection = new Map<string | null, { index: number; segment: MemorySegment }[]>()
  const newBySection = new Map<string | null, { index: number; segment: MemorySegment }[]>()
  oldDoc.segments.forEach((s, index) => {
    if (s.kind !== "record") return
    const list = oldBySection.get(s.section) ?? []; list.push({ index, segment: s }); oldBySection.set(s.section, list)
  })
  newDoc.segments.forEach((s, index) => {
    if (s.kind !== "record") return
    const list = newBySection.get(s.section) ?? []; list.push({ index, segment: s }); newBySection.set(s.section, list)
  })
  const out = new Map<number, number>()
  for (const [section, news] of newBySection) {
    const olds = oldBySection.get(section) ?? []
    for (const p of lcsPairs(olds.map((x) => x.segment), news.map((x) => x.segment)))
      out.set(news[p.newIndex]!.index, olds[p.oldIndex]!.index)
  }
  return out
}

function mergeMissing(current: RecordMetaRead, old: RecordMetaRead): RecordMetaPatch {
  const patch: RecordMetaPatch = {}
  if (current.meta.record_id === undefined && old.meta.record_id !== undefined) patch.record_id = old.meta.record_id
  if (current.meta.recorded_at === undefined && old.meta.recorded_at !== undefined) patch.recorded_at = old.meta.recorded_at
  if (current.meta.source_type === undefined && old.meta.source_type !== undefined) patch.source_type = old.meta.source_type
  if (current.meta.retracted_at === undefined && old.meta.retracted_at !== undefined) patch.retracted_at = old.meta.retracted_at
  if (current.meta.retract_reason === undefined && old.meta.retract_reason !== undefined) patch.retract_reason = old.meta.retract_reason
  const extras: Record<string, string> = {}
  for (const [k, v] of Object.entries(old.extras)) if (!(k in current.extras)) extras[k] = v
  if (Object.keys(extras).length) patch.extras = extras
  return patch
}

export function stampMemoryRecords(rawOld: string, rawNew: string, options: RecordIdentityOptions): RecordIdentityResult {
  const oldDoc = parseMemoryDocument(rawOld)
  const newDoc = parseMemoryDocument(rawNew)

  for (const segment of [...oldDoc.segments, ...newDoc.segments]) {
    if (segment.kind !== "record") continue
    if (readRecordMeta(segment).status === "malformed")
      return { ok: false, text: rawNew, error: `Malformed record metadata at line ${segment.line}; refusing to guess or rewrite it.` }
  }

  const oldRecords = oldDoc.segments.filter((s) => s.kind === "record")
  const newRecords = newDoc.segments.filter((s) => s.kind === "record")
  const oldById = new Map<string, RecordMetaRead>()
  for (const s of oldRecords) {
    const r = readRecordMeta(s)
    if (r.status === "valid" && r.meta.record_id && !oldById.has(r.meta.record_id)) oldById.set(r.meta.record_id, r)
  }

  const pairs = correspondence(oldDoc, newDoc)
  const usedIds = new Set<string>()
  for (const s of newRecords) {
    const r = readRecordMeta(s)
    if (r.status === "valid" && r.meta.record_id) usedIds.add(r.meta.record_id)
  }

  const newId = (): string => {
    for (let i = 0; i < 100; i++) {
      const id = options.generateId()
      if (id && !/\s/.test(id) && !usedIds.has(id)) { usedIds.add(id); return id }
    }
    throw new Error("record_id generator failed to produce a unique non-empty ID")
  }

  const seenExisting = new Set<string>()
  const replacements = new Map<number, string>()
  let stamped = 0, preserved = 0, generated = 0
  const source = options.defaultSourceType ?? DEFAULT_SOURCE

  for (let i = 0; i < newDoc.segments.length; i++) {
    const segment = newDoc.segments[i]!
    if (segment.kind !== "record") continue
    const current = readRecordMeta(segment)
    let patch: RecordMetaPatch = {}

    if (current.status === "valid" && current.meta.record_id) {
      const id = current.meta.record_id
      if (seenExisting.has(id)) patch.record_id = newId()
      else {
        seenExisting.add(id)
        const oldSameId = oldById.get(id)
        if (oldSameId) patch = mergeMissing(current, oldSameId)
      }
    } else {
      const oldIndex = pairs.get(i)
      const oldSegment = oldIndex === undefined ? undefined : oldDoc.segments[oldIndex]
      const oldRead = oldSegment?.kind === "record" ? readRecordMeta(oldSegment) : undefined
      if (oldRead?.status === "valid") patch = mergeMissing(current, oldRead)
    }

    if (current.meta.record_id === undefined) {
      if (patch.record_id === undefined || typeof patch.record_id !== "string" || usedIds.has(patch.record_id)) {
        patch.record_id = newId()
      } else {
        usedIds.add(patch.record_id)
      }
      generated++
    }
    if (current.meta.recorded_at === undefined && patch.recorded_at === undefined) patch.recorded_at = options.now
    if (current.meta.source_type === undefined && patch.source_type === undefined) patch.source_type = source

    const result = withRecordMeta(segment, patch)
    if (!result.ok) return { ok: false, text: rawNew, error: `Failed to stamp record at line ${segment.line}: ${result.diagnostics.map((d) => d.message).join("; ")}` }
    if (result.changed) { replacements.set(i, result.text); stamped++ } else preserved++
  }

  if (replacements.size === 0) return { ok: true, text: rawNew, changed: false, stamped, preserved, generated }
  const text = serializeMemoryDocument({ segments: newDoc.segments.map((s, i) => replacements.has(i) ? { ...s, text: replacements.get(i)! } : s) })
  return { ok: true, text, changed: text !== rawNew, stamped, preserved, generated }
}
