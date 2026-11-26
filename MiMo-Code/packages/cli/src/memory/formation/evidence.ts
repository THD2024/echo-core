/**
 * Memory Formation Phase 1 — structured evidence (pure).
 *
 * Evidence is a REFERENCE to something that happened, never proof that a claim is true. The resolver
 * is injected and only answers booleans (existence / quote-substring), so nothing here reads content
 * out to the model or to a log. Residual risk (accepted, documented): the resolver is a read-only,
 * bounded existence oracle.
 *
 * Tiers: T1 = user_message (can back a claim attributed to the user), T2 = every other structured
 * reference (existence verified only), T3 = no/unverifiable evidence (rejected by the validator).
 */

export const MAX_EVIDENCE = 8
const ID = /^(ses|msg|prt)_[A-Za-z0-9]{1,64}$/
const NAME = /^[a-z][a-z0-9_]{0,63}$/
const MAX_REF = 128
const MAX_PATH = 512
const MAX_QUOTE = 300

export type Evidence =
  | { type: "user_message"; session_id: string; message_id: string; quote?: string }
  | { type: "tool_result"; session_id: string; message_id: string; part_id: string }
  | { type: "command_result"; session_id: string; message_id: string; part_id: string }
  | { type: "system_event"; name: string; ref: string }
  | { type: "file_range"; path: string; start_line: number; end_line: number }

export type EvidenceTier = "T1" | "T2"

export interface EvidenceResolver {
  /** True iff the referenced thing exists. Must not throw (callers also guard). */
  exists(e: Evidence): boolean
  /** True iff the user message contains `quote` verbatim. Returns a boolean only. */
  quoteMatches(e: Extract<Evidence, { type: "user_message" }>, quote: string): boolean
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const str = (x: unknown, max: number): string | undefined =>
  typeof x === "string" && x.length > 0 && x.length <= max && !x.includes("\u0000") ? x : undefined

/** Strict parse; unknown keys are dropped, any violation returns undefined. */
export function parseEvidence(x: unknown): Evidence | undefined {
  if (!isObj(x)) return undefined
  switch (x.type) {
    case "user_message": {
      const session_id = str(x.session_id, 80)
      const message_id = str(x.message_id, 80)
      if (!session_id || !message_id || !ID.test(session_id) || !ID.test(message_id)) return undefined
      if (!session_id.startsWith("ses_") || !message_id.startsWith("msg_")) return undefined
      if (x.quote === undefined) return { type: "user_message", session_id, message_id }
      const quote = str(x.quote, MAX_QUOTE)
      return quote ? { type: "user_message", session_id, message_id, quote } : undefined
    }
    case "tool_result":
    case "command_result": {
      const session_id = str(x.session_id, 80)
      const message_id = str(x.message_id, 80)
      const part_id = str(x.part_id, 80)
      if (!session_id || !message_id || !part_id) return undefined
      if (!session_id.startsWith("ses_") || !message_id.startsWith("msg_") || !part_id.startsWith("prt_")) return undefined
      if (!ID.test(session_id) || !ID.test(message_id) || !ID.test(part_id)) return undefined
      return { type: x.type, session_id, message_id, part_id }
    }
    case "system_event": {
      const name = str(x.name, 64)
      const ref = str(x.ref, MAX_REF)
      if (!name || !ref || !NAME.test(name)) return undefined
      return { type: "system_event", name, ref }
    }
    case "file_range": {
      const p = str(x.path, MAX_PATH)
      const s = x.start_line
      const e = x.end_line
      if (!p || !Number.isInteger(s) || !Number.isInteger(e)) return undefined
      if ((s as number) < 1 || (e as number) < (s as number) || (e as number) - (s as number) > 10_000) return undefined
      return { type: "file_range", path: p, start_line: s as number, end_line: e as number }
    }
    default:
      return undefined
  }
}

export function tierOf(e: Evidence): EvidenceTier {
  return e.type === "user_message" ? "T1" : "T2"
}

export interface EvidenceVerification {
  total: number
  verified: Evidence[]
  /** Evidence entries whose referenced object was not found / resolver threw. */
  unverifiable: number
  /** A user_message evidence verified (and, if it carried a quote, the quote matched). */
  userBacked: boolean
  /** A user_message quote was present and verified to match. */
  userQuoteMatched: boolean
  /** A quote was present and did NOT match. */
  quoteMismatch: boolean
  /** A tool_result / command_result / file_range evidence verified (system_event does not count). */
  observedBacked: boolean
}

export function verifyEvidence(list: readonly Evidence[], resolver: EvidenceResolver): EvidenceVerification {
  const out: EvidenceVerification = {
    total: list.length,
    verified: [],
    unverifiable: 0,
    userBacked: false,
    userQuoteMatched: false,
    quoteMismatch: false,
    observedBacked: false,
  }
  for (const e of list) {
    let ok = false
    try {
      ok = resolver.exists(e) === true
    } catch {
      ok = false
    }
    if (!ok) {
      out.unverifiable++
      continue
    }
    if (e.type === "user_message" && e.quote !== undefined) {
      let match = false
      try {
        match = resolver.quoteMatches(e, e.quote) === true
      } catch {
        match = false
      }
      if (!match) {
        out.quoteMismatch = true
        continue
      }
      out.userQuoteMatched = true
    }
    out.verified.push(e)
    if (e.type === "user_message") out.userBacked = true
    // A system_event (e.g. "a dream ran") shows that something happened, not that a fact was observed: it never backs an
    // `observed` claim. Only tool / command results and file ranges do.
    else if (e.type !== "system_event") out.observedBacked = true
  }
  return out
}
