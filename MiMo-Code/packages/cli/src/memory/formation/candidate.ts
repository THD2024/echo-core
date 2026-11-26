/**
 * Memory Formation Phase 1 — candidate envelope (pure).
 *
 * A candidate is NEVER a committed MemoryRecord. Body-generated / derived fields (candidate_id,
 * observed_at, channel, proposed_by, scope, owner, project_id, session_id) come ONLY from the Body
 * context. The only model-claimable inputs are: content, kind, attribution, evidence, confidence
 * (advisory). Anything else the model supplies (id / at / src / provenance / marker / candidate_id /
 * observed_at / scope / owner / channel ...) is DROPPED and counted, never read.
 */
import { createHash } from "node:crypto"
import { parseEvidence, MAX_EVIDENCE, type Evidence } from "./evidence"

export const FORMATION_SCHEMA_VERSION = 1
export const MAX_CONTENT_CHARS = 1000

export const KINDS = ["fact", "preference", "rule", "decision", "reference"] as const
export type CandidateKind = (typeof KINDS)[number]
export const ATTRIBUTIONS = ["user", "observed", "inferred"] as const
export type Attribution = (typeof ATTRIBUTIONS)[number]
export const CHANNELS = ["dream_snapshot", "user_message", "tool_result", "system_event"] as const
export type Channel = (typeof CHANNELS)[number]
export const PROPOSERS = ["dream", "user", "tool", "system"] as const
export type Proposer = (typeof PROPOSERS)[number]

export const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
export const SESSION_ID_RE = /^ses_[A-Za-z0-9]{1,64}$/
export const CANDIDATE_ID_RE = /^cand_[0-9a-f]{32}$/

export interface Candidate {
  schema_version: 1
  candidate_id: string
  proposed_by: Proposer
  channel: Channel
  kind: CandidateKind
  attribution: Attribution
  content: string
  observed_at: string
  scope: "projects"
  owner: string
  project_id: string
  session_id: string
  lifecycle_intent: "create"
  evidence: Evidence[]
  /** Advisory only; never used for admission, ranking or provenance. */
  confidence?: number
  /** Filled by the validator as an annotation. */
  conflicts_with: string[]
}

export interface BodyContext {
  projectID: string
  sessionID: string
  channel: Channel
  proposedBy: Proposer
  now: () => number
  /** Evidence assigned by the Body (dream channel). Model-supplied evidence is only honoured when this is undefined. */
  bodyEvidence?: Evidence[]
}

/** Names whose presence in model output is dropped (not read) and counted. */
const FORBIDDEN_CLAIMS = new Set([
  "id", "at", "src", "provenance", "candidate_id", "observed_at", "scope", "owner", "channel", "proposed_by",
  "record_id", "recorded_at", "source_type", "project_id", "session_id", "schema_version", "lifecycle_intent",
  "conflicts_with", "marker", "meta",
])
const CLAIMABLE = new Set(["content", "kind", "attribution", "evidence", "confidence"])

export function normalizeContent(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
}

export function expectedCandidateId(input: { content: string; project_id: string; session_id: string }): string {
  const h = createHash("sha256")
  h.update([input.content, "projects", input.project_id, input.session_id].join("\u0000"))
  return "cand_" + h.digest("hex").slice(0, 32)
}

export type NormalizeResult =
  | { ok: true; candidate: Candidate; dropped: string[] }
  | { ok: false; reasons: string[]; dropped: string[] }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)

function safeNow(now: () => number): string {
  let t: number
  try {
    t = now()
  } catch {
    t = Date.now()
  }
  if (!Number.isFinite(t)) t = Date.now()
  return new Date(t).toISOString()
}

export function normalizeCandidate(raw: unknown, ctx: BodyContext): NormalizeResult {
  const dropped: string[] = []
  if (!PROJECT_ID_RE.test(ctx.projectID) || ctx.projectID === "global" || !SESSION_ID_RE.test(ctx.sessionID)) {
    return { ok: false, reasons: ["invalid_context"], dropped }
  }
  if (!isObj(raw)) return { ok: false, reasons: ["malformed"], dropped }
  for (const key of Object.keys(raw)) {
    if (CLAIMABLE.has(key)) continue
    // Names only, sanitised and capped; values are never looked at.
    if (dropped.length < 20) dropped.push(FORBIDDEN_CLAIMS.has(key) ? key : "unknown_field")
  }
  if (typeof raw.content !== "string") return { ok: false, reasons: ["malformed"], dropped }
  const content = normalizeContent(raw.content)
  const kind = raw.kind === undefined ? "fact" : raw.kind
  if (!(KINDS as readonly unknown[]).includes(kind)) return { ok: false, reasons: ["invalid_kind"], dropped }
  const attribution = raw.attribution === undefined ? "inferred" : raw.attribution
  if (!(ATTRIBUTIONS as readonly unknown[]).includes(attribution)) return { ok: false, reasons: ["invalid_attribution"], dropped }

  let evidence: Evidence[] = []
  if (ctx.bodyEvidence) {
    evidence = ctx.bodyEvidence
  } else if (raw.evidence !== undefined) {
    if (!Array.isArray(raw.evidence) || raw.evidence.length > MAX_EVIDENCE) return { ok: false, reasons: ["evidence_malformed"], dropped }
    for (const item of raw.evidence) {
      const e = parseEvidence(item)
      if (!e) return { ok: false, reasons: ["evidence_malformed"], dropped }
      evidence.push(e)
    }
  }

  let confidence: number | undefined
  if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) confidence = Math.min(1, Math.max(0, raw.confidence))

  const candidate: Candidate = {
    schema_version: FORMATION_SCHEMA_VERSION,
    candidate_id: expectedCandidateId({ content, project_id: ctx.projectID, session_id: ctx.sessionID }),
    proposed_by: ctx.proposedBy,
    channel: ctx.channel,
    kind: kind as CandidateKind,
    attribution: attribution as Attribution,
    content,
    observed_at: safeNow(ctx.now),
    scope: "projects",
    owner: `project:${ctx.projectID}`,
    project_id: ctx.projectID,
    session_id: ctx.sessionID,
    lifecycle_intent: "create",
    evidence,
    ...(confidence === undefined ? {} : { confidence }),
    conflicts_with: [],
  }
  return { ok: true, candidate, dropped }
}

/**
 * Shape check for a candidate that arrives from an UNTRUSTED source (a file in the formation ledger).
 * Never trusts the stored id: it is recomputed. Returns reason codes; empty = well-formed.
 */
export function checkCandidateShape(c: unknown): string[] {
  const r: string[] = []
  if (!isObj(c)) return ["malformed"]
  if (c.schema_version !== FORMATION_SCHEMA_VERSION) r.push("bad_schema_version")
  if (typeof c.content !== "string") return [...r, "malformed"]
  if (typeof c.project_id !== "string" || !PROJECT_ID_RE.test(c.project_id) || c.project_id === "global") r.push("bad_project_id")
  if (typeof c.session_id !== "string" || !SESSION_ID_RE.test(c.session_id)) r.push("bad_session_id")
  if (typeof c.candidate_id !== "string" || !CANDIDATE_ID_RE.test(c.candidate_id)) r.push("bad_candidate_id")
  if (!(PROPOSERS as readonly unknown[]).includes(c.proposed_by)) r.push("bad_proposer")
  if (!(CHANNELS as readonly unknown[]).includes(c.channel)) r.push("bad_channel")
  if (!(KINDS as readonly unknown[]).includes(c.kind)) r.push("invalid_kind")
  if (!(ATTRIBUTIONS as readonly unknown[]).includes(c.attribution)) r.push("invalid_attribution")
  if (c.scope !== "projects") r.push("bad_scope")
  if (c.lifecycle_intent !== "create") r.push("bad_lifecycle")
  if (typeof c.observed_at !== "string" || Number.isNaN(Date.parse(c.observed_at))) r.push("bad_observed_at")
  if (typeof c.owner !== "string" || c.owner !== `project:${String(c.project_id)}`) r.push("bad_owner")
  if (!Array.isArray(c.evidence) || c.evidence.length > MAX_EVIDENCE || c.evidence.some((e) => !parseEvidence(e))) r.push("evidence_malformed")
  if (c.confidence !== undefined && (typeof c.confidence !== "number" || !Number.isFinite(c.confidence) || c.confidence < 0 || c.confidence > 1)) r.push("bad_confidence")
  if (!Array.isArray(c.conflicts_with) || c.conflicts_with.length > 20 || c.conflicts_with.some((x) => typeof x !== "string" || x.length > 40)) r.push("bad_conflicts")
  if (r.length === 0) {
    const want = expectedCandidateId({ content: c.content as string, project_id: c.project_id as string, session_id: c.session_id as string })
    if (want !== c.candidate_id) r.push("id_mismatch")
    if (normalizeContent(c.content as string) !== c.content) r.push("content_not_normalized")
  }
  return r
}
