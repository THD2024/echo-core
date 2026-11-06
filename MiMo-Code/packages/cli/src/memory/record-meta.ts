/**
 * Record metadata codec (Memory V1, task T-b).
 *
 * Pure functions that define WHERE metadata lives on a MEMORY.md record, HOW it is spelled,
 * and what happens when it is broken. It never touches the filesystem, never generates a
 * record_id or a timestamp, never reads the clock or a random source (callers pass values in),
 * and has no production call site. Only T-a TYPES are imported (a type-only import has no
 * runtime effect), so T-a stays frozen: `segment.meta` is still always `{}`.
 * Filling `segment.meta` would mean changing the frozen T-a file `record-parse.ts` and must be
 * opened as its own task that explicitly unfreezes T-a. It is NOT part of T-b or T-b2.
 *
 * Carrier (frozen decision D1 = A): exactly one `<!--m key=value ...-->` at the ABSOLUTE END of
 * the FIRST line of a `record` segment, e.g.
 *
 *     - never force-push <!--m id=8k2f9q3x at=2026-11-05T09:12:00Z src=u-->
 *
 *  - Only `kind === "record"` segments carry metadata. Every other kind is rejected on write
 *    and left byte-for-byte unchanged (a marker on the section's italic line would make T-a
 *    reclassify that line as a record, because it no longer ends with "_").
 *  - The marker is the last thing on the first line: the terminator (`\n` or `\r\n`) follows it
 *    directly. A marker in the middle of the line, or followed by trailing whitespace, is
 *    malformed. Writing inserts " " + marker at the end of the first line's content, AFTER any
 *    trailing whitespace the line already had; that whitespace is never trimmed. Removing a
 *    marker deletes it plus exactly one space directly before it, so insert-then-remove restores
 *    the original bytes.
 *  - Wire keys: `id` record_id, `at` recorded_at, `src` source_type (one letter code),
 *    `ret` retracted_at, `why` retract_reason. Any other well-formed key is an opaque EXTRA: kept
 *    verbatim and in order, never interpreted (this covers refs / valid_* / disputed / author /
 *    mig: their key names are reserved, their parsing belongs to later tasks. In particular
 *    `source_refs` already has frozen V1 semantics; T-f, not T-b, parses it).
 *  - `src` codes: u = user_statement, t = tool_output, o = model_observation,
 *    i = model_inference. SELF-REPORTED: a marker is plain text the model can copy or forge, so
 *    `source_type` read here is a claim, not proof. No default is ever filled in by this module.
 *  - `recorded_at` is only checked to be a valid ISO-8601 UTC timestamp (minutes, seconds, or
 *    seconds with a fraction, always ending in "Z"). Precision is NOT locked here; which precision
 *    gets generated is a T-b2 decision.
 *
 * Failure model: all-or-nothing per marker. Never throws, never guesses, never repairs. A broken
 * marker yields empty meta, a deterministic diagnostic, and untouched bytes. A write refuses to
 * run over a broken marker (repairing is a later task).
 */
import type { MemoryDocument, MemoryRecordMetadata, MemorySegment } from "./record-parse"

export type RecordSourceType = "user_statement" | "tool_output" | "model_observation" | "model_inference"

const SRC_CODE_TO_TYPE: Record<string, RecordSourceType> = {
  u: "user_statement",
  t: "tool_output",
  o: "model_observation",
  i: "model_inference",
}
const SRC_TYPE_TO_CODE: Record<RecordSourceType, string> = {
  user_statement: "u",
  tool_output: "t",
  model_observation: "o",
  model_inference: "i",
}

export type RecordMetaDiagnosticCode =
  | "duplicate-marker"
  | "unclosed-marker"
  | "marker-not-at-line-end"
  | "marker-not-on-first-line"
  | "marker-empty"
  | "bad-token"
  | "bad-key"
  | "duplicate-key"
  | "invalid-id"
  | "invalid-recorded-at"
  | "invalid-source-type"
  | "invalid-retracted-at"
  | "invalid-retract-reason"
  | "invalid-extra-value"
  | "retract-unpaired"
  | "not-a-record"
  | "existing-marker-malformed"
  | "reserved-extra-key"
  | "internal-error"

export interface RecordMetaDiagnostic {
  code: RecordMetaDiagnosticCode
  /** 1-based line of the problem (offset from the segment's own `line` when it has one). */
  line: number
  message: string
}

/** Metadata the codec understands; `source_type` is narrowed from the T-a slot's `string`. */
export type RecordMeta = Omit<MemoryRecordMetadata, "source_type"> & { source_type?: RecordSourceType }

export interface RecordMetaRead {
  /**
   * absent     – no marker on the first line (legacy record; a `<!--m` on a later line is only reported in diagnostics)
   * valid      – one well-formed marker (`diagnostics` may still note a stray `<!--m` on a later line)
   * malformed  – a marker was found but rejected; `meta` / `extras` are empty, see diagnostics
   * not-record – the segment is not a `record`; metadata does not apply
   */
  status: "absent" | "valid" | "malformed" | "not-record"
  meta: RecordMeta
  /** Well-formed keys this codec does not interpret, in marker order. Preserved on write. */
  extras: Record<string, string>
  diagnostics: RecordMetaDiagnostic[]
}

/** `null` removes a field; `undefined` (or omitted) keeps it. `extras` merge the same way. */
export interface RecordMetaPatch {
  record_id?: string | null
  recorded_at?: string | null
  source_type?: RecordSourceType | null
  retracted_at?: string | null
  retract_reason?: string | null
  extras?: Record<string, string | null>
}

export type RecordMetaWrite =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; text: string; diagnostics: RecordMetaDiagnostic[] }

type SegmentLike = Pick<MemorySegment, "kind" | "text"> & { line?: number }

const OPEN = "<!--m"
const CLOSE = "-->"
// `<!--m` only counts as ours when followed by whitespace, `-->` or the end of the line;
// `<!--made by hand-->` and friends are ordinary user comments.
const CANDIDATE = /<!--m(?=\s|-->|$)/g
const KEY = /^[a-z][a-z0-9_]{0,31}$/
const ID = /^[0-9a-z]{8,32}$/
const REASON = /^[A-Za-z0-9_.:-]{1,64}$/
const EXTRA_VALUE = /^\S{1,256}$/
const TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?Z$/
const RESERVED = new Set(["id", "at", "src", "ret", "why"])

function validTimestamp(v: string): boolean {
  const m = TS.exec(v)
  if (!m) return false
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number)
  if (h > 23 || mi > 59 || s > 59) return false
  const dt = new Date(0)
  dt.setUTCFullYear(y, mo - 1, d)
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

interface State {
  id?: string
  at?: string
  src?: RecordSourceType
  ret?: string
  why?: string
  extras: Record<string, string>
}

const emptyMeta = (): RecordMeta => ({})
const isEmptyState = (s: State) =>
  s.id === undefined &&
  s.at === undefined &&
  s.src === undefined &&
  s.ret === undefined &&
  s.why === undefined &&
  Object.keys(s.extras).length === 0

function stateEquals(a: State, b: State): boolean {
  if (a.id !== b.id || a.at !== b.at || a.src !== b.src || a.ret !== b.ret || a.why !== b.why) return false
  const ka = Object.keys(a.extras)
  const kb = Object.keys(b.extras)
  if (ka.length !== kb.length) return false
  return ka.every((k) => a.extras[k] === b.extras[k])
}

function toMeta(s: State): RecordMeta {
  const m: RecordMeta = {}
  if (s.id !== undefined) m.record_id = s.id
  if (s.at !== undefined) m.recorded_at = s.at
  if (s.src !== undefined) m.source_type = s.src
  if (s.ret !== undefined) m.retracted_at = s.ret
  if (s.why !== undefined) m.retract_reason = s.why
  return m
}

function serializeMarker(s: State): string {
  const parts: string[] = []
  if (s.id !== undefined) parts.push(`id=${s.id}`)
  if (s.at !== undefined) parts.push(`at=${s.at}`)
  if (s.src !== undefined) parts.push(`src=${SRC_TYPE_TO_CODE[s.src]}`)
  if (s.ret !== undefined) parts.push(`ret=${s.ret}`)
  if (s.why !== undefined) parts.push(`why=${s.why}`)
  for (const [k, v] of Object.entries(s.extras)) parts.push(`${k}=${v}`)
  return `${OPEN} ${parts.join(" ")}${CLOSE}`
}

/** Index of the end of the first line's CONTENT (before "\n" or "\r\n"), and of its terminator. */
function firstLine(text: string): { contentEnd: number; lineEnd: number } {
  const nl = text.indexOf("\n")
  if (nl === -1) return { contentEnd: text.length, lineEnd: text.length }
  return { contentEnd: nl > 0 && text[nl - 1] === "\r" ? nl - 1 : nl, lineEnd: nl }
}

interface Scan {
  status: "absent" | "valid" | "malformed"
  /** [start, end) of the marker inside `text`, when exactly one candidate was found. */
  range?: [number, number]
  state: State
  diagnostics: RecordMetaDiagnostic[]
}

function scanRecord(text: string, baseLine: number): Scan {
  const diagnostics: RecordMetaDiagnostic[] = []
  const diag = (code: RecordMetaDiagnosticCode, line: number, message: string) =>
    diagnostics.push({ code, line, message })
  const empty: State = { extras: {} }
  const { contentEnd, lineEnd } = firstLine(text)
  const first = text.slice(0, contentEnd)

  // A candidate anywhere after the first line: not a carrier position, report it, never guess.
  const rest = text.slice(lineEnd)
  if (rest.length > 0) {
    const lines = rest.split("\n")
    lines.forEach((ln, idx) => {
      if (idx === 0) return // the remainder of the first line's terminator
      CANDIDATE.lastIndex = 0
      if (CANDIDATE.test(ln))
        diag("marker-not-on-first-line", baseLine + idx, "metadata marker is only recognised on the record's first line")
    })
  }

  const found: number[] = []
  CANDIDATE.lastIndex = 0
  for (let m = CANDIDATE.exec(first); m; m = CANDIDATE.exec(first)) found.push(m.index)
  // No candidate on the first line: the record has no metadata. A candidate on a later line (if
  // any) is only reported in `diagnostics`; it does not make the first line malformed.
  if (found.length === 0) return { status: "absent", state: empty, diagnostics }
  if (found.length > 1) {
    diag("duplicate-marker", baseLine, "more than one metadata marker on the first line")
    return { status: "malformed", state: empty, diagnostics }
  }

  const p = found[0]
  const q = first.indexOf(CLOSE, p + OPEN.length)
  if (q === -1) {
    diag("unclosed-marker", baseLine, "metadata marker is not closed with -->")
    return { status: "malformed", state: empty, diagnostics }
  }
  if (q + CLOSE.length !== first.length) {
    diag("marker-not-at-line-end", baseLine, "metadata marker must be the last thing on the first line")
    return { status: "malformed", state: empty, diagnostics }
  }

  const body = first.slice(p + OPEN.length, q)
  const tokens = body.split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 0) {
    diag("marker-empty", baseLine, "metadata marker has no key=value pairs")
    return { status: "malformed", state: empty, diagnostics }
  }

  const state: State = { extras: {} }
  const seen = new Set<string>()
  let bad = false
  for (const tok of tokens) {
    const eq = tok.indexOf("=")
    if (eq === -1) {
      diag("bad-token", baseLine, `token "${tok}" is not key=value`)
      bad = true
      continue
    }
    const key = tok.slice(0, eq)
    const val = tok.slice(eq + 1)
    if (!KEY.test(key)) {
      diag("bad-key", baseLine, `invalid key "${key}"`)
      bad = true
      continue
    }
    if (seen.has(key)) {
      diag("duplicate-key", baseLine, `key "${key}" appears more than once`)
      bad = true
      continue
    }
    seen.add(key)
    switch (key) {
      case "id":
        if (ID.test(val)) state.id = val
        else (diag("invalid-id", baseLine, "id must match [0-9a-z]{8,32}"), (bad = true))
        break
      case "at":
        if (validTimestamp(val)) state.at = val
        else (diag("invalid-recorded-at", baseLine, "at must be an ISO-8601 UTC timestamp ending in Z"), (bad = true))
        break
      case "src":
        if (Object.hasOwn(SRC_CODE_TO_TYPE, val)) state.src = SRC_CODE_TO_TYPE[val]
        else (diag("invalid-source-type", baseLine, "src must be one of u, t, o, i"), (bad = true))
        break
      case "ret":
        if (validTimestamp(val)) state.ret = val
        else (diag("invalid-retracted-at", baseLine, "ret must be an ISO-8601 UTC timestamp ending in Z"), (bad = true))
        break
      case "why":
        if (REASON.test(val)) state.why = val
        else (diag("invalid-retract-reason", baseLine, "why must match [A-Za-z0-9_.:-]{1,64}"), (bad = true))
        break
      default:
        if (EXTRA_VALUE.test(val)) state.extras[key] = val
        else (diag("invalid-extra-value", baseLine, `value of "${key}" must be 1-256 non-space characters`), (bad = true))
    }
  }
  if (!bad && (state.ret === undefined) !== (state.why === undefined)) {
    diag("retract-unpaired", baseLine, "ret and why must appear together")
    bad = true
  }
  if (bad) return { status: "malformed", state: empty, diagnostics }
  return { status: "valid", range: [p, q + CLOSE.length], state, diagnostics }
}

/** Read the metadata marker of one segment. Never throws; never changes bytes. */
export function readRecordMeta(segment: SegmentLike): RecordMetaRead {
  try {
    if (segment.kind !== "record") return { status: "not-record", meta: emptyMeta(), extras: {}, diagnostics: [] }
    const scan = scanRecord(segment.text, segment.line ?? 1)
    if (scan.status === "valid")
      return { status: "valid", meta: toMeta(scan.state), extras: { ...scan.state.extras }, diagnostics: scan.diagnostics }
    return { status: scan.status, meta: emptyMeta(), extras: {}, diagnostics: scan.diagnostics }
  } catch {
    return {
      status: "malformed",
      meta: emptyMeta(),
      extras: {},
      diagnostics: [{ code: "internal-error", line: segment.line ?? 1, message: "internal error while reading metadata" }],
    }
  }
}

/** Read every record of a parsed document. Pure convenience over `readRecordMeta`. */
export function readDocumentMeta(doc: MemoryDocument): { index: number; line: number; read: RecordMetaRead }[] {
  const out: { index: number; line: number; read: RecordMetaRead }[] = []
  doc.segments.forEach((s, index) => {
    if (s.kind === "record") out.push({ index, line: s.line, read: readRecordMeta(s) })
  })
  return out
}

function reject(text: string, diagnostics: RecordMetaDiagnostic[]): RecordMetaWrite {
  return { ok: false, text, diagnostics }
}

/**
 * Return `segment.text` with metadata set/updated/removed. Only the marker region changes
 * (insert, replace in place, or delete together with one preceding space); every other byte is
 * kept. Setting the values a record already has is a no-op (`changed:false`, same bytes). Refuses
 * (text unchanged, `ok:false`) for non-record segments, over a malformed existing marker, and for
 * invalid patch values.
 */
export function withRecordMeta(segment: SegmentLike, patch: RecordMetaPatch): RecordMetaWrite {
  const text = segment.text
  const baseLine = segment.line ?? 1
  try {
    if (segment.kind !== "record")
      return reject(text, [{ code: "not-a-record", line: baseLine, message: "metadata can only be attached to record segments" }])

    const scan = scanRecord(text, baseLine)
    if (scan.status === "malformed")
      return reject(text, [
        { code: "existing-marker-malformed", line: baseLine, message: "refusing to write over a malformed marker" },
        ...scan.diagnostics,
      ])

    const before = scan.state
    const next: State = { ...before, extras: { ...before.extras } }
    const errs: RecordMetaDiagnostic[] = []
    const bad = (code: RecordMetaDiagnosticCode, message: string) => errs.push({ code, line: baseLine, message })

    if (patch.record_id !== undefined) {
      if (patch.record_id === null) delete next.id
      else if (ID.test(patch.record_id)) next.id = patch.record_id
      else bad("invalid-id", "record_id must match [0-9a-z]{8,32}")
    }
    if (patch.recorded_at !== undefined) {
      if (patch.recorded_at === null) delete next.at
      else if (validTimestamp(patch.recorded_at)) next.at = patch.recorded_at
      else bad("invalid-recorded-at", "recorded_at must be an ISO-8601 UTC timestamp ending in Z")
    }
    if (patch.source_type !== undefined) {
      if (patch.source_type === null) delete next.src
      else if (Object.hasOwn(SRC_TYPE_TO_CODE, patch.source_type)) next.src = patch.source_type
      else bad("invalid-source-type", "source_type must be a known source type")
    }
    if (patch.retracted_at !== undefined) {
      if (patch.retracted_at === null) delete next.ret
      else if (validTimestamp(patch.retracted_at)) next.ret = patch.retracted_at
      else bad("invalid-retracted-at", "retracted_at must be an ISO-8601 UTC timestamp ending in Z")
    }
    if (patch.retract_reason !== undefined) {
      if (patch.retract_reason === null) delete next.why
      else if (REASON.test(patch.retract_reason)) next.why = patch.retract_reason
      else bad("invalid-retract-reason", "retract_reason must match [A-Za-z0-9_.:-]{1,64}")
    }
    for (const [k, v] of Object.entries(patch.extras ?? {})) {
      if (!KEY.test(k)) bad("bad-key", `invalid extra key "${k}"`)
      else if (RESERVED.has(k)) bad("reserved-extra-key", `"${k}" is a reserved key, use its named field`)
      else if (v === null) delete next.extras[k]
      else if (EXTRA_VALUE.test(v)) next.extras[k] = v
      else bad("invalid-extra-value", `value of "${k}" must be 1-256 non-space characters`)
    }
    if ((next.ret === undefined) !== (next.why === undefined))
      bad("retract-unpaired", "retracted_at and retract_reason must be set together")
    if (errs.length) return reject(text, errs)

    if (stateEquals(before, next)) return { ok: true, text, changed: false }

    const { contentEnd } = firstLine(text)
    if (isEmptyState(next)) {
      // Only reachable when a valid marker exists (an absent marker means before was empty too).
      const [s, e] = scan.range!
      const cut = s > 0 && text[s - 1] === " " ? s - 1 : s
      return { ok: true, text: text.slice(0, cut) + text.slice(e), changed: true }
    }
    const marker = serializeMarker(next)
    if (scan.range) {
      const [s, e] = scan.range
      return { ok: true, text: text.slice(0, s) + marker + text.slice(e), changed: true }
    }
    return { ok: true, text: text.slice(0, contentEnd) + " " + marker + text.slice(contentEnd), changed: true }
  } catch {
    return reject(text, [{ code: "internal-error", line: baseLine, message: "internal error while writing metadata" }])
  }
}
