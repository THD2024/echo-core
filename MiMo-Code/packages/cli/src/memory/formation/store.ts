/**
 * Memory Formation Phase 1 — the ONLY writer of `<data>/formation/**`.
 *
 * `<data>/formation/` is a Body-owned STORAGE LOCATION, not a security isolation zone. agent write/edit-class tools are
 * denied there by an `external_directory` hardPermission rule; bash and other shell capabilities are NOT covered, so
 * everything under this directory is UNTRUSTED, UNAUTHENTICATED HINT data:
 *   - body_hash is an unkeyed digest: it detects accidental corruption / id-content mismatch, it is NOT authentication;
 *   - the presence of a ledger file does not mean the candidate is trusted, and no ledger field is provenance;
 *   - every file is fully re-validated on read (shape, recomputed id and hash, the whole validator); failures are dropped
 *     and counted, enumeration is bounded, and a later phase must re-derive from original evidence, never from this ledger.
 *
 * Path rule: base (caller-fixed) + the literal "projects" + a validated project id + `<candidate_id>.json` where the id is
 * body-generated (`cand_` + 32 hex). No model-controlled string ever reaches a path. Writes are no-overwrite (same id =>
 * "exists") and atomic (tmp file + hard link; the tmp is removed).
 */
import { createHash, randomBytes } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { CANDIDATE_ID_RE, PROJECT_ID_RE, checkCandidateShape, type Candidate } from "./candidate"
import { renderShadow } from "./shadow"
import { validateCandidate, type ValidateContext, type Verdict } from "./validate"

export const LEDGER_TRUST = "hint" as const

export const LIMITS = {
  maxFiles: 500,
  maxFileBytes: 16 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
} as const

export interface LedgerEntry {
  v: 1
  candidate: Candidate
  verdict: Verdict
  shadow: string
  body_hash: string
}

export function stableStringify(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]"
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}"
  }
  return JSON.stringify(x)
}

export function bodyHash(parts: { candidate: Candidate; verdict: Verdict; shadow: string }): string {
  return createHash("sha256").update(stableStringify(parts)).digest("hex")
}

/** Build the envelope for an ACCEPTED candidate (annotations from the verdict are folded into the envelope). */
export function buildEntry(candidate: Candidate, verdict: Verdict): LedgerEntry {
  const c: Candidate = { ...candidate, conflicts_with: [...verdict.conflicts_with] }
  const shadow = renderShadow(c.content)
  return { v: 1, candidate: c, verdict, shadow, body_hash: bodyHash({ candidate: c, verdict, shadow }) }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)

/** Structural + integrity check of an envelope (does NOT run the validator). Empty = ok. */
export function checkEntry(e: unknown): string[] {
  if (!isObj(e)) return ["malformed"]
  if (e.v !== 1) return ["bad_entry_version"]
  const shape = checkCandidateShape(e.candidate)
  if (shape.length) return shape
  if (!isObj(e.verdict) || (e.verdict.verdict !== "accept" && e.verdict.verdict !== "reject")) return ["bad_verdict"]
  if (typeof e.shadow !== "string" || typeof e.body_hash !== "string") return ["malformed"]
  const c = e.candidate as Candidate
  if (e.shadow !== renderShadow(c.content)) return ["shadow_mismatch"]
  if (bodyHash({ candidate: c, verdict: e.verdict as unknown as Verdict, shadow: e.shadow }) !== e.body_hash) return ["hash_mismatch"]
  return []
}

const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p)

/** realpath of the deepest existing ancestor + the not-yet-existing remainder. */
async function canonical(p: string): Promise<string> {
  let cur = path.resolve(p)
  const rest: string[] = []
  for (;;) {
    try {
      const real = await fs.realpath(cur)
      return rest.length ? path.join(real, ...rest.reverse()) : real
    } catch (e) {
      const parent = path.dirname(cur)
      if (parent === cur) return path.resolve(p)
      rest.push(path.basename(cur))
      cur = parent
    }
  }
}

export async function isInside(base: string, target: string): Promise<boolean> {
  const b = fold(await canonical(base))
  const t = fold(await canonical(target))
  const rel = path.relative(b, t)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

export function ledgerDir(base: string, projectID: string): string | undefined {
  if (!PROJECT_ID_RE.test(projectID) || projectID === "global") return undefined
  return path.join(base, "projects", projectID)
}

export type WriteResult = "written" | "exists" | "rejected" | "full"

export async function writeEntry(base: string, entry: LedgerEntry): Promise<WriteResult> {
  try {
    if (checkEntry(entry).length || entry.verdict.verdict !== "accept") return "rejected"
    const id = entry.candidate.candidate_id
    if (!CANDIDATE_ID_RE.test(id)) return "rejected"
    const dir = ledgerDir(base, entry.candidate.project_id)
    if (!dir) return "rejected"
    const line = JSON.stringify(entry) + "\n"
    if (Buffer.byteLength(line) > LIMITS.maxFileBytes) return "rejected"
    const file = path.join(dir, `${id}.json`)
    await fs.mkdir(dir, { recursive: true })
    if (!(await isInside(base, file))) return "rejected"
    const existing = await fs.readdir(dir).catch(() => [] as string[])
    if (existing.length >= LIMITS.maxFiles) return "full"
    if (await fs.lstat(file).then(() => true, () => false)) return "exists"
    const tmp = path.join(dir, `${id}.${randomBytes(6).toString("hex")}.tmp`)
    await fs.writeFile(tmp, line, { flag: "wx" })
    try {
      await fs.link(tmp, file)
      return "written"
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === "EEXIST") return "exists"
      // Hard links unsupported on this filesystem: fall back to rename only when the target is still absent.
      if (await fs.lstat(file).then(() => true, () => false)) return "exists"
      await fs.rename(tmp, file)
      return "written"
    } finally {
      await fs.unlink(tmp).catch(() => {})
    }
  } catch {
    return "rejected"
  }
}

/** Candidate ids currently in the ledger (names only; bounded; nothing is read or trusted). */
export async function listIds(base: string, projectID: string): Promise<Set<string>> {
  const out = new Set<string>()
  const dir = ledgerDir(base, projectID)
  if (!dir) return out
  const names = await fs.readdir(dir).catch(() => [] as string[])
  for (const n of names.slice(0, LIMITS.maxFiles)) {
    const m = /^(cand_[0-9a-f]{32})\.json$/.exec(n)
    if (m) out.add(m[1])
  }
  return out
}

export interface ReadResult {
  trust: typeof LEDGER_TRUST
  entries: LedgerEntry[]
  dropped: Record<string, number>
  truncated: boolean
}

/**
 * Read + fully re-validate the ledger for a project. `makeCtx` supplies the validator context (resolver, memory,
 * retracted, task state); `knownCandidateIds` is forced empty here (the ledger must not be its own duplicate check).
 */
export async function readAll(base: string, projectID: string, makeCtx: () => Omit<ValidateContext, "knownCandidateIds">): Promise<ReadResult> {
  const res: ReadResult = { trust: LEDGER_TRUST, entries: [], dropped: {}, truncated: false }
  const drop = (reason: string) => {
    res.dropped[reason] = (res.dropped[reason] ?? 0) + 1
  }
  const dir = ledgerDir(base, projectID)
  if (!dir) return res
  let names: string[]
  try {
    names = (await fs.readdir(dir)).sort()
  } catch {
    return res
  }
  if (names.length > LIMITS.maxFiles) {
    res.truncated = true
    for (let i = LIMITS.maxFiles; i < names.length; i++) drop("over_limit")
    names = names.slice(0, LIMITS.maxFiles)
  }
  let total = 0
  let ctx: Omit<ValidateContext, "knownCandidateIds"> | undefined
  for (const name of names) {
    const m = /^(cand_[0-9a-f]{32})\.json$/.exec(name)
    if (!m) {
      drop("unexpected_file")
      continue
    }
    try {
      const file = path.join(dir, name)
      const st = await fs.lstat(file)
      if (!st.isFile()) {
        drop("not_regular_file")
        continue
      }
      if (st.size > LIMITS.maxFileBytes) {
        drop("oversize")
        continue
      }
      if (total + st.size > LIMITS.maxTotalBytes) {
        res.truncated = true
        drop("over_limit")
        continue
      }
      total += st.size
      const text = await fs.readFile(file, "utf8")
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        drop("unparseable")
        continue
      }
      const bad = checkEntry(parsed)
      if (bad.length) {
        drop(bad[0])
        continue
      }
      const entry = parsed as LedgerEntry
      if (entry.candidate.candidate_id !== m[1]) {
        drop("filename_mismatch")
        continue
      }
      if (entry.candidate.project_id !== projectID) {
        drop("project_mismatch")
        continue
      }
      ctx ??= makeCtx()
      const v = validateCandidate(entry.candidate, { ...ctx, knownCandidateIds: new Set() })
      if (v.verdict !== "accept") {
        drop("revalidation_rejected")
        continue
      }
      res.entries.push(entry)
    } catch {
      drop("read_error")
    }
  }
  return res
}
