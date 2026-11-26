/**
 * Memory Formation Phase 1 — shadow rendering (pure).
 *
 * The shadow of an accepted candidate is one section header plus ONE plain bullet line that the frozen T-a parser reads back as exactly
 * one `record` segment. It carries no `<!--m ...-->` marker (identity/provenance live in the ledger envelope,
 * Body-derived) and is never written to MEMORY.md, the FTS index or injection; this module has no IO and imports
 * only the frozen parser.
 */
import { parseMemoryDocument } from "../record-parse"

const SHADOW_HEADER = "## Shadow candidate (not memory)"

export function renderShadow(content: string): string {
  // The T-a parser classifies text before the first `## ` header as `preamble`, so a bare bullet would not be a record.
  return `${SHADOW_HEADER}\n- ${content}\n`
}

/** True iff `content`, rendered as a shadow, parses as exactly one record and nothing else (CRLF/LF identical). */
export function isSingleRecordShadow(content: string): boolean {
  try {
    for (const eol of ["\n", "\r\n"]) {
      const doc = parseMemoryDocument(renderShadow(content).replace(/\n/g, eol))
      const real = doc.segments.filter((s) => s.kind !== "blank")
      if (real.length !== 2 || real[0].kind !== "section-header" || real[1].kind !== "record") return false
      const text = real[1].text.replace(/\r?\n$/, "")
      if (text !== `- ${content}`) return false
    }
    return true
  } catch {
    return false
  }
}
