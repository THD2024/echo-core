/**
 * Memory Formation Phase 1 — candidate validator (pure, fail-closed).
 *
 * Every rule that can reject does so; any exception rejects ("validator_error"). Duplicate-of-memory and
 * conflict only ANNOTATE. The verdict never depends on model-supplied ids / timestamps / sources (the
 * candidate has none: normalizeCandidate dropped them). `confidence` is not read.
 *
 * Reasons are fixed codes: no matched text (in particular no secret) is ever copied into a reason.
 */
import { createHash } from "node:crypto"
import { checkCandidateShape, MAX_CONTENT_CHARS, type Candidate } from "./candidate"
import { parseEvidence, verifyEvidence, type EvidenceResolver } from "./evidence"
import { isSingleRecordShadow } from "./shadow"

export interface ValidateContext {
  resolver: EvidenceResolver
  /** Current project MEMORY.md record texts (bullet marker already stripped). */
  memoryRecords: readonly string[]
  /** Retracted record texts. */
  retractedRecords: readonly string[]
  /** Task-state texts (todos etc.) for the owning session. */
  taskStateTexts: readonly string[]
  /** Candidate ids already in the ledger. */
  knownCandidateIds: ReadonlySet<string>
}

export interface Verdict {
  verdict: "accept" | "reject"
  reasons: string[]
  annotations: string[]
  conflicts_with: string[]
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|passwd|password|credential|bearer)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{8,}/i,
  /\bBearer\s+[A-Za-z0-9_\-./+=]{16,}/,
  /(?<![A-Za-z0-9])[A-Fa-f0-9]{40,}(?![A-Za-z0-9])/,
  /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{48,}={0,2}(?![A-Za-z0-9+/=])/,
]

const TRANSIENT_PATTERNS: RegExp[] = [
  /\b(?:right now|at the moment|just now|this (?:session|turn|conversation)|currently (?:running|in progress|working on|debugging))\b/i,
  /(?:刚刚|目前正在|这次会话|本轮|当前会话|现在正在)/,
  /\bpid\s*[:=]?\s*\d{2,}\b/i,
  /\b(?:localhost|127\.0\.0\.1):\d{2,5}\b/,
]

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\b/i,
  /\b(?:you\s+(?:must|should|need to)\s+(?:now\s+)?(?:run|execute|call|delete|send|write|ignore))\b/i,
  /\b(?:system prompt|developer message|new instructions?)\b/i,
  /(?:忽略(?:之前|以上|前面)|无视(?:之前|以上)|你必须(?:立即|现在)?(?:执行|运行|删除))/,
]

const NEGATION = /\b(?:not|never|no|don't|do not|avoid|without)\b|(?:不要|不能|不得|禁止|从不|别)/i

export function normText(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ")
}

function tokens(s: string): Set<string> {
  const out = new Set<string>()
  for (const tok of normText(s).split(" ")) {
    if (!tok) continue
    if (/[㐀-鿿]/.test(tok)) {
      const chars = [...tok]
      if (chars.length === 1) out.add(tok)
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1])
    } else out.add(tok)
  }
  return out
}

export function similarity(a: string, b: string): number {
  const na = normText(a)
  const nb = normText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = tokens(a)
  const tb = tokens(b)
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : inter / union
}

const memTag = (text: string) => "mem:" + createHash("sha1").update(normText(text)).digest("hex").slice(0, 8)

export function validateCandidate(c: Candidate, ctx: ValidateContext): Verdict {
  try {
    return validateInner(c, ctx)
  } catch {
    return { verdict: "reject", reasons: ["validator_error"], annotations: [], conflicts_with: [] }
  }
}

function validateInner(c: Candidate, ctx: ValidateContext): Verdict {
  const reasons: string[] = []
  const annotations: string[] = []
  const conflicts: string[] = []

  // 1. Structure first: a candidate that is not well-formed gets no further (untrusted-file path included).
  const shape = checkCandidateShape(c)
  if (shape.length) return { verdict: "reject", reasons: shape, annotations, conflicts_with: conflicts }

  // 2. Content rules.
  const content = c.content
  if (content.length === 0) reasons.push("empty")
  if (content.length > MAX_CONTENT_CHARS) reasons.push("oversized")
  if (content.includes("\u0000")) reasons.push("malformed")
  if (content.includes("\n")) reasons.push("multi_line")
  if (content.includes("<!--") || content.includes("-->")) reasons.push("marker_injection")
  // A record body must not itself open a heading / quote / fence / table / nested list item.
  if (/^(?:#{1,6}(?:\s|$)|>|```|~~~|\||[-*+]\s|\d+[.)]\s)/.test(content)) reasons.push("structure_injection")
  if (!reasons.includes("empty") && !reasons.includes("multi_line") && !reasons.includes("marker_injection") && !reasons.includes("oversized") && !isSingleRecordShadow(content)) {
    reasons.push("not_single_record")
  }
  if (SECRET_PATTERNS.some((re) => re.test(content))) reasons.push("secret")
  if (TRANSIENT_PATTERNS.some((re) => re.test(content))) reasons.push("transient")
  if (INSTRUCTION_PATTERNS.some((re) => re.test(content))) reasons.push("instruction_shape")

  // 3. Evidence (re-parse: the envelope may have come from a file).
  const evidence = c.evidence.map((e) => parseEvidence(e)).filter((e): e is NonNullable<typeof e> => !!e)
  if (evidence.length === 0) reasons.push("no_evidence")
  const v = verifyEvidence(evidence, ctx.resolver)
  if (evidence.length > 0) {
    if (v.quoteMismatch) reasons.push("quote_mismatch")
    if (v.unverifiable > 0) reasons.push("evidence_unverifiable")
    if (v.verified.length === 0 && !v.quoteMismatch && v.unverifiable === 0) reasons.push("no_evidence")
  }
  if (c.attribution === "user") {
    if (!v.userBacked) reasons.push("user_claim_unsupported")
    else if ((c.kind === "rule" || c.kind === "preference") && !v.userQuoteMatched) reasons.push("user_claim_needs_quote")
  } else if (c.attribution === "observed") {
    if (!v.observedBacked) reasons.push("observation_unsupported")
  } else {
    annotations.push("inference")
  }

  // 4. Ledger / memory relations.
  if (ctx.knownCandidateIds.has(c.candidate_id)) reasons.push("duplicate_candidate")
  for (const r of ctx.retractedRecords) {
    if (similarity(content, r) >= 0.85) {
      reasons.push("retracted_resurrection")
      break
    }
  }
  for (const t of ctx.taskStateTexts) {
    if (similarity(content, t) >= 0.8) {
      reasons.push("task_state_duplicate")
      break
    }
  }
  const cNeg = NEGATION.test(content)
  for (const m of ctx.memoryRecords) {
    const s = similarity(content, m)
    if (s >= 0.9) {
      if (!annotations.includes("duplicate_of_memory")) annotations.push("duplicate_of_memory")
    } else if (s >= 0.5 && NEGATION.test(m) !== cNeg) {
      if (!annotations.includes("possible_conflict")) annotations.push("possible_conflict")
      if (conflicts.length < 20) conflicts.push(memTag(m))
    }
  }

  const uniq = [...new Set(reasons)]
  return { verdict: uniq.length ? "reject" : "accept", reasons: uniq, annotations, conflicts_with: conflicts }
}
