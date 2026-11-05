/**
 * Read-only structural view of a project/global MEMORY.md (Memory V1, task T-a).
 *
 * This module only PARSES and SERIALIZES. It never touches the filesystem, never
 * generates a record_id, never rewrites MEMORY.md, and imports nothing — later tasks
 * (detect / search tagging / migration / repair) share this one boundary instead of
 * each carrying a one-off parser.
 *
 * Contract:
 *  - Lossless: the segments tile the input exactly, so
 *    `serializeMemoryDocument(parseMemoryDocument(raw)) === raw` byte for byte
 *    (CRLF, missing final newline, BOM, anything).
 *  - Total: never throws. Anything it cannot classify becomes a `raw` segment (kept
 *    verbatim, with `notes` saying why); even an internal bug degrades to a single
 *    `raw` segment rather than an exception.
 *  - Section parity: section boundaries are EXACTLY the ones `parseSections` in
 *    `session/budgeted-read.ts` uses — a line that starts with "## ". That includes a
 *    "## " line inside a fenced code block, because that is what the budgeted reader
 *    (and therefore injection) does. Fence tracking never crosses a section boundary.
 *
 * Boundary rules inside a section (T-a defines them; they do not change the file layout):
 *  - blank lines                      -> `blank`
 *  - the section's italic line        -> `italic`. Structural, same rule as the budgeted
 *                                        reader's `parseSections`: the FIRST line of the section
 *                                        that starts and ends with "_" (any text, so an old or
 *                                        edited template instruction is still an instruction).
 *                                        Later `_..._` lines are ordinary content. No template
 *                                        text is consulted.
 *  - a bare `(none yet)` line         -> `placeholder`
 *  - bullet (`-`, `*`, `+`, with or without a `[ ]` checkbox) or ordered (`1.` / `1)`)
 *    item at indent <= 3, plus its continuation (indented lines, blank lines followed by
 *    an indented line, lazy plain-text continuation lines, and fenced code opened inside)
 *                                     -> one `record`
 *  - a plain paragraph (consecutive non-blank lines up to the next block start)
 *                                     -> one `record`
 *  - a blockquote run (`>` lines)     -> one `record` (note `blockquote`)
 *  - fenced code at top level, tables, `#`/`###`+ headings, horizontal rules, HTML
 *    comments, orphan indented blocks -> `raw` (not memory content; no id will ever be
 *    attached to them)
 *
 * Known, deliberate divergences from the reader's raw-line scan (the reader looks at every
 * line; this parser only looks where a block can start): an italic-looking line buried in
 * fenced code or inside a closed HTML comment stays part of that raw block, and a CRLF italic
 * line is recognised here while the reader's `endsWith("_")` misses it because of the
 * trailing "\r".
 */

export type MemorySegmentKind =
  | "preamble"
  | "section-header"
  | "italic"
  | "placeholder"
  | "record"
  | "raw"
  | "blank"

/** Slot for later-task metadata. T-a never fills it: it is always `{}`. */
export interface MemoryRecordMetadata {
  record_id?: string
  recorded_at?: string
  source_type?: string
  retracted_at?: string
  retract_reason?: string
}

export interface MemorySegment {
  kind: MemorySegmentKind
  /** Section NAME (the "## " header text without the prefix); null before the first header. */
  section: string | null
  /** Verbatim source text of this segment, line terminators included. */
  text: string
  /** Character offsets into the parsed input: `raw.slice(start, end) === text`. */
  start: number
  end: number
  /** 1-based line number of the first line. */
  line: number
  /** Why a segment was classified the way it was, when that is not obvious. */
  notes?: string[]
  meta: MemoryRecordMetadata
}

/**
 * Parse result. `start` / `end` / `line` describe the SOURCE that was parsed; once a
 * later task edits a segment's `text`, they are stale and `serialize` ignores them.
 */
export interface MemoryDocument {
  segments: MemorySegment[]
}

const PLACEHOLDER = "(none yet)"

type Line = {
  /** Text including the terminator. */
  text: string
  /** Text without the terminator ("\n" or "\r\n"). */
  content: string
  start: number
  no: number
}

function splitLines(raw: string): Line[] {
  const out: Line[] = []
  let pos = 0
  let no = 1
  while (pos < raw.length) {
    const nl = raw.indexOf("\n", pos)
    const end = nl === -1 ? raw.length : nl + 1
    const text = raw.slice(pos, end)
    const content = text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text
    out.push({ text, content, start: pos, no })
    pos = end
    no++
  }
  return out
}

const isBlank = (l: Line) => l.content.trim() === ""
const isIndented = (l: Line) => /^[ \t]/.test(l.content)

const BULLET = /^ {0,3}[-*+](?:[ \t]+|$)/
const ORDERED = /^ {0,3}\d{1,9}[.)](?:[ \t]+|$)/
const HRULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/
const TABLE_ROW = /^ {0,3}\|/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const QUOTE = /^ {0,3}>/
const COMMENT_OPEN = /^ {0,3}<!--/

function fenceOf(content: string): { ch: string; len: number } | null {
  const m = FENCE_OPEN.exec(content)
  if (!m) return null
  const marker = m[1]
  // CommonMark: a backtick fence's info string may not contain a backtick.
  if (marker[0] === "`" && content.slice(m[0].length).includes("`")) return null
  return { ch: marker[0], len: marker.length }
}

function closesFence(content: string, open: { ch: string; len: number }): boolean {
  const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(content)
  return !!m && m[1][0] === open.ch && m[1].length >= open.len
}

/** Same predicate as `parseSections` in session/budgeted-read.ts (CR already stripped). */
const isItalicLine = (l: Line) => l.content.startsWith("_") && l.content.endsWith("_")

/**
 * Whether a zero/low-indent line begins a new top-level block (so it ends a lazy run).
 * `italicOpen`: this section has not produced its italic line yet, so an italic-looking
 * line starts one (keeps parity with the reader instead of burying it in a lazy run).
 */
function startsBlock(l: Line, italicOpen: boolean): boolean {
  const c = l.content
  return (
    (italicOpen && isItalicLine(l)) ||
    c.trim() === PLACEHOLDER ||
    BULLET.test(c) ||
    ORDERED.test(c) ||
    HRULE.test(c) ||
    fenceOf(c) !== null ||
    TABLE_ROW.test(c) ||
    HEADING.test(c) ||
    QUOTE.test(c) ||
    COMMENT_OPEN.test(c)
  )
}

type Emit = (kind: MemorySegmentKind, lines: Line[], notes?: string[]) => void

/** Consume a fenced block starting at `lines[i]`; returns the index after it and whether it closed. */
function consumeFence(lines: Line[], i: number): { next: number; closed: boolean } {
  const open = fenceOf(lines[i].content)!
  let j = i + 1
  while (j < lines.length) {
    if (closesFence(lines[j].content, open)) return { next: j + 1, closed: true }
    j++
  }
  return { next: j, closed: false }
}

function parseSectionBody(lines: Line[], emit: Emit): void {
  let i = 0
  let italicSeen = false // the section's single italic line has been emitted
  while (i < lines.length) {
    const l = lines[i]
    const c = l.content

    if (isBlank(l)) {
      let j = i
      while (j < lines.length && isBlank(lines[j])) j++
      emit("blank", lines.slice(i, j))
      i = j
      continue
    }

    if (c.trim() === PLACEHOLDER && !isIndented(l)) {
      emit("placeholder", [l])
      i++
      continue
    }

    // The section's italic line: first block-start line that starts and ends with "_".
    if (!italicSeen && isItalicLine(l)) {
      italicSeen = true
      emit("italic", [l])
      i++
      continue
    }

    // Top-level fenced code (up to 3 spaces of indent).
    if (!/^ {4}|^\t/.test(c) && fenceOf(c)) {
      const { next, closed } = consumeFence(lines, i)
      emit("raw", lines.slice(i, next), closed ? ["fenced-code"] : ["fenced-code", "unterminated-fence"])
      i = next
      continue
    }

    if (HRULE.test(c)) {
      emit("raw", [l], ["rule"])
      i++
      continue
    }

    if (TABLE_ROW.test(c)) {
      let j = i
      while (j < lines.length && TABLE_ROW.test(lines[j].content)) j++
      emit("raw", lines.slice(i, j), ["table"])
      i = j
      continue
    }

    if (HEADING.test(c)) {
      emit("raw", [l], [/^ {0,3}#(?:[ \t]|$)/.test(c) ? "heading" : "subheading"])
      i++
      continue
    }

    if (COMMENT_OPEN.test(c)) {
      let j = i
      while (j < lines.length && !lines[j].content.includes("-->")) j++
      if (j < lines.length) {
        emit("raw", lines.slice(i, j + 1), ["html-comment"])
        i = j + 1
      } else {
        // A stray "<!--" with no close must not swallow the rest of the section: keep only
        // its own line as raw and parse everything after it normally.
        emit("raw", [l], ["html-comment", "unterminated-comment"])
        i++
      }
      continue
    }

    if (BULLET.test(c) || ORDERED.test(c)) {
      i = consumeListItem(lines, i, emit, !italicSeen)
      continue
    }

    if (QUOTE.test(c)) {
      let j = i
      while (j < lines.length && QUOTE.test(lines[j].content)) j++
      emit("record", lines.slice(i, j), ["blockquote"])
      i = j
      continue
    }

    // Indented 4+ spaces / tab with no parent block (1-3 spaces fall through to paragraph).
    if (/^ {4}|^\t/.test(c)) {
      let j = i + 1
      while (j < lines.length) {
        if (isBlank(lines[j])) {
          // a blank run stays inside the block only when indented text follows it
          let k = j
          while (k < lines.length && isBlank(lines[k])) k++
          if (k < lines.length && isIndented(lines[k])) {
            j = k
            continue
          }
          break
        }
        if (!isIndented(lines[j])) break
        j++
      }
      emit("raw", lines.slice(i, j), ["orphan-indented"])
      i = j
      continue
    }

    // Plain paragraph: consecutive non-blank lines up to the next block start.
    let j = i + 1
    while (j < lines.length && !isBlank(lines[j]) && !startsBlock(lines[j], !italicSeen)) j++
    emit("record", lines.slice(i, j))
    i = j
  }
}

/** Consume one bullet/ordered item and its continuation; emits one `record`; returns next index. */
function consumeListItem(lines: Line[], i: number, emit: Emit, italicOpen: boolean): number {
  const notes: string[] = []
  let j = i + 1
  // A fence opened on the item line itself is not valid markdown; ignore. Continuation scan:
  while (j < lines.length) {
    const l = lines[j]
    if (isBlank(l)) {
      let k = j
      while (k < lines.length && isBlank(lines[k])) k++
      if (k < lines.length && isIndented(lines[k])) {
        j = k // blank run is inside the item: the next line is indented continuation
        continue
      }
      break
    }
    if (isIndented(l)) {
      const open = fenceOf(l.content)
      if (open) {
        const { next, closed } = consumeFence(lines, j)
        if (!closed) notes.push("unterminated-fence")
        j = next
        continue
      }
      j++
      continue
    }
    // zero-indent, non-blank: lazy continuation unless it starts a new block
    if (startsBlock(l, italicOpen)) break
    j++
  }
  emit("record", lines.slice(i, j), notes.length ? notes : undefined)
  return j
}

function degradeToRaw(raw: string, reason: string): MemoryDocument {
  return {
    segments:
      raw.length === 0
        ? []
        : [{ kind: "raw", section: null, text: raw, start: 0, end: raw.length, line: 1, notes: [reason], meta: {} }],
  }
}

export function parseMemoryDocument(raw: string): MemoryDocument {
  try {
    const lines = splitLines(raw)
    const segments: MemorySegment[] = []
    let section: string | null = null

    const emit: Emit = (kind, ls, notes) => {
      if (ls.length === 0) return
      const first = ls[0]
      const last = ls[ls.length - 1]
      const seg: MemorySegment = {
        kind,
        section,
        text: ls.map((x) => x.text).join(""),
        start: first.start,
        end: last.start + last.text.length,
        line: first.no,
        meta: {},
      }
      if (notes && notes.length) seg.notes = notes
      segments.push(seg)
    }

    let i = 0
    // Preamble: everything before the first "## " line (parity with budgeted-read).
    let p = 0
    while (p < lines.length && !lines[p].content.startsWith("## ")) p++
    if (p > 0) emit("preamble", lines.slice(0, p))
    i = p

    while (i < lines.length) {
      // lines[i] is a section header by construction
      const header = lines[i]
      section = header.content.slice(3).trim()
      emit("section-header", [header])
      let j = i + 1
      while (j < lines.length && !lines[j].content.startsWith("## ")) j++
      parseSectionBody(lines.slice(i + 1, j), emit)
      i = j
    }

    const doc = { segments }
    // Defensive: the tiling invariant is the whole point; if it ever fails, degrade.
    if (serializeMemoryDocument(doc) !== raw) return degradeToRaw(raw, "parser-invariant-violated")
    return doc
  } catch {
    return degradeToRaw(raw, "parser-error")
  }
}

export function serializeMemoryDocument(doc: MemoryDocument): string {
  return doc.segments.map((s) => s.text).join("")
}

export function listRecords(doc: MemoryDocument): MemorySegment[] {
  return doc.segments.filter((s) => s.kind === "record")
}

export function countByKind(doc: MemoryDocument): Record<MemorySegmentKind, number> {
  const out: Record<MemorySegmentKind, number> = {
    preamble: 0,
    "section-header": 0,
    italic: 0,
    placeholder: 0,
    record: 0,
    raw: 0,
    blank: 0,
  }
  for (const s of doc.segments) out[s.kind]++
  return out
}
