import { describe, expect, test } from "bun:test"
import {
  PROVENANCE_MAX_DEPTH,
  auditInvariants,
  auditProvenance,
  auditTransition,
  type Finding,
  type MemoryState,
} from "../../src/memory/audit"
import { computeMerge, deriveMergeId } from "../../src/memory/merge"
import { parseMemoryDocument, serializeMemoryDocument } from "../../src/memory/record-parse"
import { readRecordMeta, withRecordMeta } from "../../src/memory/record-meta"

const filePath = "/memory/projects/p1/MEMORY.md"
const NOW = "2026-11-14T08:00:00Z"
const RET = "2026-11-14T09:00:00Z"
const TOMB_HEAD = "## Retracted records\n\n"

const rec = (id: string, text: string, src = "u", extra = "") =>
  `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=${src}${extra}-->\n`
const tomb = (id: string, text: string, why = "superseded", src = "u", extra = "") =>
  `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=${src}${extra} ret=${RET} why=${why}-->\n`

const S0 = `## Facts\n\n${rec("a1", "Alpha stays here as a fact")}\n${rec("b1", "Beta is another fact", "i")}\n${rec("c1", "Gamma is about deployment")}\n## Notes\n\n${rec("d1", "Delta describes the release process")}`
const before0: MemoryState = { S: S0, R: "" }

/** Pure stand-in for retractMemoryRecord's observable result (the real one is exercised in the tool E2E). */
function retractPure(state: MemoryState, id: string, why = "superseded"): MemoryState {
  const doc = parseMemoryDocument(state.S)
  let tombText = ""
  const segments = doc.segments.map((s) => {
    if (s.kind !== "record" || readRecordMeta(s).meta.record_id !== id) return s
    const stamped = withRecordMeta(s, { retracted_at: RET, retract_reason: why as any })
    if (!stamped.ok) throw new Error("fixture: cannot tombstone")
    tombText = stamped.text
    return { ...s, text: "" }
  })
  if (!tombText) throw new Error(`fixture: ${id} not in S`)
  const R = state.R === "" ? TOMB_HEAD + tombText : state.R + "\n" + tombText
  return { S: serializeMemoryDocument({ segments }), R }
}

function mergeA(state: MemoryState, sourceIds: string[], body: string): { state: MemoryState; mergeId: string } {
  const r = computeMerge(state.S, state.R, { sourceIds, body, now: NOW, budgetTokens: 10_000, filePath })
  if (!r.ok) throw new Error(r.error)
  return { state: { S: r.text, R: state.R }, mergeId: r.mergeId }
}

const codes = (findings: Finding[]) => findings.map((f) => f.code)
const inv = (after: MemoryState, before?: MemoryState) => auditInvariants(after, { budgetTokens: 10_000, filePath, before, now: NOW })

describe("T-g.1 scripted dream E2E (pure)", () => {
  test("1. a normal merge (Phase A then every retract) produces no findings and all invariants hold", () => {
    const a = mergeA(before0, ["a1", "b1"], "- Alpha and Beta combined")
    let s = a.state
    s = retractPure(s, "a1")
    s = retractPure(s, "b1")
    expect(auditTransition(before0, s)).toEqual([])
    expect(auditProvenance(s.S, s.R)).toEqual([])
    const report = inv(s, before0)
    expect(report.ok).toBe(true)
    expect(report.trace.ok && report.inject.ok && report.converge.ok && report.recover.ok).toBe(true)
    expect(report.nodisappear?.ok).toBe(true)
    expect(report.findings).toEqual([])
  })

  test("2. an interrupted Phase B yields exactly one incomplete_merge with a resumable replay; finishing clears it", () => {
    const a = mergeA(before0, ["a1", "b1"], "- Alpha and Beta combined")
    const half = retractPure(a.state, "a1")
    const findings = auditTransition(before0, half)
    expect(codes(findings)).toEqual(["incomplete_merge"])
    const f = findings[0]!
    expect(f.recovery.action).toBe("resume_merge")
    expect(f.replay).toEqual({
      mergeId: a.mergeId,
      sourceIds: ["a1", "b1"],
      pendingSourceIds: ["b1"],
      body: "- Alpha and Beta combined\n",
    })
    const report = inv(half, before0)
    expect(report.recover.ok).toBe(true) // the replay really resumes
    const done = retractPure(half, "b1")
    expect(auditTransition(before0, done)).toEqual([])
  })

  test("3. a direct delete (edit-style) is an unexplained_disappearance", () => {
    const s = { S: S0.replace(rec("d1", "Delta describes the release process"), ""), R: "" }
    const findings = auditTransition(before0, s)
    expect(codes(findings)).toEqual(["unexplained_disappearance"])
    expect(findings[0]!.ids).toEqual(["d1"])
    expect(findings[0]!.severity).toBe("error")
    expect(findings[0]!.recovery.action).toBe("manual_review")
    expect(inv(s, before0).nodisappear?.ok).toBe(false)
    expect(inv(s, before0).ok).toBe(false)
  })

  test("3b. a record retracted properly is explained, not a disappearance", () => {
    const s = retractPure(before0, "d1", "withdrawn")
    expect(auditTransition(before0, s)).toEqual([])
  })

  test("4. a bash-style removal of a tombstone is tombstone_lost (history is append-only)", () => {
    const a = mergeA(before0, ["a1", "b1"], "- Alpha and Beta combined")
    const merged = retractPure(retractPure(a.state, "a1"), "b1")
    const lostR = TOMB_HEAD + merged.R.split("\n").filter((l) => !l.includes("id=a1 ") && !l.startsWith("## ")).join("\n").replace(/^\n+/, "")
    const after = { S: merged.S, R: lostR }
    const findings = auditTransition(merged, after)
    expect(codes(findings)).toContain("tombstone_lost")
    expect(findings.find((f) => f.code === "tombstone_lost")!.ids).toEqual(["a1"])
    expect(findings.find((f) => f.code === "tombstone_lost")!.severity).toBe("error")
    // a1 is in neither file now, but it was already tombstoned before, so it is not a live disappearance
    expect(codes(findings)).not.toContain("unexplained_disappearance")
    // also the provenance of the merge is now broken
    expect(codes(auditProvenance(after.S, after.R))).toContain("refs_orphan")
  })

  test("5. rewriting a tombstone is tombstone_mutated", () => {
    const s = retractPure(before0, "d1", "withdrawn")
    const after = { S: s.S, R: s.R.replace("Delta describes the release process", "Delta now says something else") }
    expect(codes(auditTransition(s, after))).toEqual(["tombstone_mutated"])
    const meta = { S: s.S, R: s.R.replace("why=withdrawn", "why=incorrect") }
    expect(codes(auditTransition(s, meta))).toEqual(["tombstone_mutated"])
    const time = { S: s.S, R: s.R.replace(RET, "2026-11-14T09:30:00Z") }
    expect(codes(auditTransition(s, time))).toEqual(["tombstone_mutated"])
  })

  test("6. an in-place edit that keeps the id is clean", () => {
    const after = { S: S0.replace("Gamma is about deployment", "Gamma is about deployment and rollbacks"), R: "" }
    expect(auditTransition(before0, after)).toEqual([])
    expect(inv(after, before0).ok).toBe(true)
  })

  test("7. an edit that lost its id is unexplained_disappearance plus id_churn", () => {
    const after = {
      S: S0.replace(rec("d1", "Delta describes the release process"), rec("zz9", "Delta describes the release process and rollout")),
      R: "",
    }
    const findings = auditTransition(before0, after)
    expect(codes(findings)).toEqual(["id_churn", "unexplained_disappearance"])
    expect(findings.find((f) => f.code === "id_churn")!.ids).toEqual(["d1", "zz9"])
    expect(findings.find((f) => f.code === "id_churn")!.severity).toBe("warn")
  })

  test("7b. a vanished record plus an unrelated new record is NOT id_churn", () => {
    const after = {
      S: S0.replace(rec("d1", "Delta describes the release process"), rec("zz9", "Completely different topic: database indexes")),
      R: "",
    }
    expect(codes(auditTransition(before0, after))).toEqual(["unexplained_disappearance"])
  })

  test("7c. a new merge record (with refs) is never id_churn", () => {
    const a = mergeA(before0, ["a1", "b1"], "- Alpha stays here as a fact and Beta is another fact")
    const s = { S: a.state.S, R: "" }
    expect(codes(auditTransition(before0, s))).toEqual(["incomplete_merge"])
  })

  test("7d. a merge record that replaced vanished sources is not mistaken for id churn (but the vanished sources are reported)", () => {
    const a = mergeA(before0, ["a1", "b1"], "- Alpha stays here as a fact")
    const direct = { S: a.state.S.replace(rec("a1", "Alpha stays here as a fact"), "").replace(rec("b1", "Beta is another fact", "i"), ""), R: "" }
    const findings = auditTransition(before0, direct)
    expect(codes(findings)).toEqual(["unexplained_disappearance", "unexplained_disappearance"])
  })

  test("8. a hand-written refs pointing at a missing id is refs_orphan", () => {
    const s = {
      S: `## Facts\n\n${rec("a1", "Alpha")}\n${rec("m1", "Merged", "i", " refs=a1,zz")}`,
      R: "",
    }
    const findings = auditProvenance(s.S, s.R)
    expect(codes(findings)).toEqual(["refs_orphan"])
    expect(findings[0]!.ids).toEqual(["m1", "zz"])
    expect(inv(s).trace.ok).toBe(false)
  })
})

describe("T-g.1 provenance (G3)", () => {
  test("refs_unparseable: unsorted, duplicate, unsafe or oversize values", () => {
    for (const refs of ["b1,a1", "a1,a1", "a1,B1", "a1,,b1"]) {
      const s = `## Facts\n\n${rec("a1", "A")}\n${rec("b1", "B")}\n${rec("m1", "M", "i", ` refs=${refs}`)}`
      expect(codes(auditProvenance(s, "")), refs).toEqual(["refs_unparseable"])
    }
  })

  test("an oversize refs value is rejected by the metadata codec itself and surfaces as malformed_metadata", () => {
    const s = `## Facts\n\n${rec("a1", "A")}\n${rec("m1", "M", "i", ` refs=${"x".repeat(257)}`)}`
    expect(codes(auditTransition({ S: s, R: "" }, { S: s, R: "" }))).toEqual(["malformed_metadata"])
    expect(auditProvenance(s, "")).toEqual([])
  })

  test("refs_wrong_reason: source retracted for another reason", () => {
    const r = TOMB_HEAD + tomb("a1", "A", "incorrect")
    const s = `## Facts\n\n${rec("m1", "M", "i", " refs=a1,b1")}\n${rec("b1", "B")}`
    const findings = auditProvenance(s, r)
    expect(codes(findings)).toEqual(["refs_wrong_reason"])
    expect(findings[0]!.severity).toBe("warn")
  })

  test("refs_cycle: self reference and a two-record cycle (through tombstones)", () => {
    const self = `## Facts\n\n${rec("m1", "M", "i", " refs=m1,x1")}\n${rec("x1", "X")}`
    expect(codes(auditProvenance(self, ""))).toContain("refs_cycle")
    const r = TOMB_HEAD + tomb("p1", "P", "superseded", "i", " refs=q1,z0") + "\n" + tomb("q1", "Q", "superseded", "i", " refs=p1,z0") + "\n" + tomb("z0", "Z")
    const cycle = auditProvenance(`## Facts\n\n${rec("keep", "K")}`, r)
    expect(codes(cycle)).toEqual(["refs_cycle"])
    expect(cycle[0]!.ids.slice().sort()).toEqual(["p1", "p1", "q1"].sort())
  })

  test("a chained merge (M2 of M1) resolves through the tombstone's own refs", () => {
    const s1 = mergeA(before0, ["a1", "b1"], "- Alpha and Beta combined")
    const done1 = retractPure(retractPure(s1.state, "a1"), "b1")
    const s2 = mergeA(done1, [s1.mergeId, "c1"], "- Everything about A, B and C")
    const done2 = retractPure(retractPure(s2.state, s1.mergeId), "c1")
    expect(auditProvenance(done2.S, done2.R)).toEqual([])
    expect(auditTransition(before0, done2)).toEqual([])
    expect(inv(done2, before0).ok).toBe(true)
  })

  test("a chain deeper than the limit is refs_cycle (depth)", () => {
    let r = TOMB_HEAD
    const n = PROVENANCE_MAX_DEPTH + 3
    for (let i = 0; i < n; i++) {
      const refs = i === n - 1 ? "" : ` refs=n${String(i + 1).padStart(2, "0")},zz`
      r += tomb(`n${String(i).padStart(2, "0")}`, `N${i}`, "superseded", "i", refs) + "\n"
    }
    r += tomb("zz", "Z") + "\n"
    const findings = auditProvenance(`## Facts\n\n${rec("keep", "K")}`, r)
    expect(findings.some((f) => f.code === "refs_cycle" && f.message.includes("deeper"))).toBe(true)
  })

  test("records without refs and a clean merge are quiet", () => {
    expect(auditProvenance(S0, "")).toEqual([])
  })
})

describe("T-g.1 state findings and invariants", () => {
  test("a double-store state is reported with the T-d.3 repair action", () => {
    const r = TOMB_HEAD + tomb("a1", "Alpha stays here as a fact")
    const findings = auditTransition(before0, { S: S0, R: r })
    expect(codes(findings)).toEqual(["retracted_without_tombstone_history"])
    expect(findings[0]!.recovery.action).toBe("repair_double_store")
  })

  test("malformed metadata: warn for MEMORY.md, error for retracted.md", () => {
    const badS = { S: S0 + "- X <!--m id=x1 at=bad src=u-->\n", R: "" }
    const f1 = auditTransition(before0, badS)
    expect(f1.find((f) => f.code === "malformed_metadata")!.severity).toBe("warn")
    const badR = { S: S0, R: TOMB_HEAD + "- X <!--m id=x1 at=bad src=u ret=2026-11-14T09:00:00Z why=withdrawn-->\n" }
    const f2 = auditTransition(before0, badR)
    expect(f2.find((f) => f.code === "malformed_metadata")!.severity).toBe("error")
  })

  test("the audit is deterministic and idempotent", () => {
    const after = { S: S0.replace(rec("d1", "Delta describes the release process"), ""), R: "" }
    expect(auditTransition(before0, after)).toEqual(auditTransition(before0, after))
    expect(inv(after, before0)).toEqual(inv(after, before0))
  })

  test("I-inject: nothing retracted is visible, prose mentioning an id does not count", () => {
    const withProse = `## Facts\n\n${rec("c1", "talks about id=a1 in prose")}`
    const r = TOMB_HEAD + tomb("a1", "Alpha")
    expect(inv({ S: withProse, R: r }).inject.ok).toBe(true)
    const s = retractPure(before0, "d1", "withdrawn")
    expect(inv(s, before0).inject.ok).toBe(true)
  })

  test("I-converge: a record whose refs/src disagree with its own sources does not converge", () => {
    const a = mergeA(before0, ["a1", "b1"], "- Alpha and Beta combined")
    const done = retractPure(retractPure(a.state, "a1"), "b1")
    // Hand-edit: claim a higher trust than the weakest source allows.
    const lied = { S: done.S.replace(`id=${a.mergeId} at=${NOW} src=i`, `id=${a.mergeId} at=${NOW} src=u`), R: done.R }
    expect(lied.S).not.toBe(done.S)
    const report = inv(lied, before0)
    expect(report.converge.ok).toBe(false)
    expect(report.converge.details.join(" ")).toContain("cannot be replayed")
  })

  test("I-recover: every finding carries a recovery action", () => {
    const after = {
      S: S0.replace(rec("d1", "Delta describes the release process"), rec("zz9", "Delta describes the release process and rollout")),
      R: "",
    }
    for (const f of inv(after, before0).findings) {
      expect(["resume_merge", "repair_double_store", "manual_review"]).toContain(f.recovery.action)
      expect(f.recovery.detail.length).toBeGreaterThan(0)
    }
  })

  test("deriveMergeId stays in sync with the merge the audit replays", () => {
    const a = mergeA(before0, ["a1", "b1"], "- Alpha and Beta combined")
    expect(a.mergeId).toBe(deriveMergeId(["a1", "b1"]))
  })
})
