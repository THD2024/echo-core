import { describe, expect, test } from "bun:test"
import {
  MERGE_MAX_SOURCES,
  MERGE_REFS_MAX_LENGTH,
  computeMerge,
  deriveMergeId,
  encodeRefs,
  formatMergeReport,
  isSafeMergeId,
  parseRefs,
  verifyMergeConverged,
  weakestSourceType,
} from "../../src/memory/merge"
import { parseMemoryDocument } from "../../src/memory/record-parse"
import { readRecordMeta } from "../../src/memory/record-meta"

const filePath = "/memory/projects/p1/MEMORY.md"
const NOW = "2026-11-14T08:00:00Z"

const rec = (id: string, text: string, src = "u", at = "2026-11-01T00:00:00Z") =>
  `- ${text} <!--m id=${id} at=${at} src=${src}-->\n`
const tomb = (id: string, text: string, why = "superseded", src = "u") =>
  `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=${src} ret=2026-11-13T00:00:00Z why=${why}-->\n`
const TOMB_HEAD = "## Retracted records\n\n"

const S = `## Facts\n\n${rec("a1", "Alpha", "u")}\n${rec("b1", "Beta", "i")}\n${rec("c1", "Gamma", "u")}`
const BODY = "- Alpha and Beta combined"

function opts(over: Partial<Parameters<typeof computeMerge>[2]> = {}) {
  return { sourceIds: ["b1", "a1"], body: BODY, now: NOW, budgetTokens: 10_000, filePath, ...over }
}

function recordsOf(text: string) {
  return parseMemoryDocument(text)
    .segments.filter((s) => s.kind === "record")
    .map((s) => ({ text: s.text, read: readRecordMeta(s), section: s.section }))
}

describe("T-f refs carrier", () => {
  test("encodeRefs sorts, de-duplicates by rejecting, and joins with commas", () => {
    const r = encodeRefs(["b1", "a1", "c_1"])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ids).toEqual(["a1", "b1", "c_1"])
      expect(r.value).toBe("a1,b1,c_1")
    }
  })

  test("encodeRefs rejects bad counts, unsafe ids, duplicates and oversize values", () => {
    expect(encodeRefs(["a1"]).ok).toBe(false)
    expect(encodeRefs(Array.from({ length: MERGE_MAX_SOURCES + 1 }, (_, i) => `id${i}`)).ok).toBe(false)
    for (const bad of ["A1", "a,b", "a b", "", "a=1", "a>b", "x".repeat(65)]) {
      expect(encodeRefs(["ok", bad]).ok).toBe(false)
    }
    expect(encodeRefs(["a1", "a1"]).ok).toBe(false)
    // 8 ids of 40 chars = 327 chars > 256: count limit alone is not enough.
    const long = Array.from({ length: 8 }, (_, i) => String(i).repeat(40))
    const r = encodeRefs(long)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(String(MERGE_REFS_MAX_LENGTH))
    // Exactly at the limit is fine: 7 ids * 36 + 6 commas = 258 -> too long; 7*35+6 = 251 -> ok.
    const fits = Array.from({ length: 7 }, (_, i) => String(i).repeat(35))
    expect(encodeRefs(fits).ok).toBe(true)
  })

  test("parseRefs is the strict inverse of encodeRefs", () => {
    expect(parseRefs("a1,b1,c1")).toEqual(["a1", "b1", "c1"])
    for (const bad of ["", "b1,a1", "a1,a1", "a1,,b1", "a1, b1", "a1,B1", "a1,", ",a1"]) {
      expect(parseRefs(bad)).toBeNull()
    }
    expect(parseRefs("x".repeat(257))).toBeNull()
  })

  test("deriveMergeId is order independent, safe and set specific", () => {
    const a = deriveMergeId(["a1", "b1"])
    expect(deriveMergeId(["b1", "a1"])).toBe(a)
    expect(isSafeMergeId(a)).toBe(true)
    expect(deriveMergeId(["a1", "b1", "c1"])).not.toBe(a)
    expect(deriveMergeId(["a1", "b2"])).not.toBe(a)
  })

  test("weakestSourceType never raises trust", () => {
    expect(weakestSourceType(["user_statement", "user_statement"])).toBe("user_statement")
    expect(weakestSourceType(["tool_output", "tool_output"])).toBe("tool_output")
    expect(weakestSourceType(["user_statement", "model_inference"])).toBe("model_inference")
    expect(weakestSourceType(["user_statement", "tool_output"])).toBe("model_inference")
    expect(weakestSourceType(["model_observation", "user_statement"])).toBe("model_inference")
  })
})

describe("T-f computeMerge (fresh)", () => {
  test("writes one record after the first source with id/at/src/refs and leaves others byte-identical", () => {
    const r = computeMerge(S, "", opts())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mode).toBe("fresh")
    expect(r.mergeId).toBe(deriveMergeId(["a1", "b1"]))
    const after = recordsOf(r.text)
    const m = after.filter((x) => x.read.meta.record_id === r.mergeId)
    expect(m).toHaveLength(1)
    expect(m[0]!.read.meta.recorded_at).toBe(NOW)
    expect(m[0]!.read.meta.source_type).toBe("model_inference") // u + i -> i
    expect(m[0]!.read.extras.refs).toBe("a1,b1")
    expect(Object.keys(m[0]!.read.extras)).toEqual(["refs"])
    expect(m[0]!.section).toBe("Facts")
    // order: a1, M, b1, c1 (M directly after the first source in document order)
    expect(after.map((x) => x.read.meta.record_id)).toEqual(["a1", r.mergeId, "b1", "c1"])
    // original records are untouched
    const before = recordsOf(S).map((x) => x.text)
    expect(after.filter((x) => x.read.meta.record_id !== r.mergeId).map((x) => x.text)).toEqual(before)
    expect(r.report.pendingSourceIds).toEqual(["a1", "b1"])
    expect(r.report.mergedRecordVisible).toBe(true)
  })

  test("source type is kept only when every source has it", () => {
    const allU = `## Facts\n\n${rec("a1", "A", "u")}\n${rec("b1", "B", "u")}`
    const r = computeMerge(allU, "", opts())
    expect(r.ok).toBe(true)
    if (r.ok) {
      const m = recordsOf(r.text).find((x) => x.read.meta.record_id === r.mergeId)!
      expect(m.read.meta.source_type).toBe("user_statement")
    }
    const mixed = `## Facts\n\n${rec("a1", "A", "t")}\n${rec("b1", "B", "u")}`
    const r2 = computeMerge(mixed, "", opts())
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      const m = recordsOf(r2.text).find((x) => x.read.meta.record_id === r2.mergeId)!
      expect(m.read.meta.source_type).toBe("model_inference")
    }
  })

  test("works when the last record has no trailing newline and with CRLF files", () => {
    const noEol = `## Facts\n\n${rec("a1", "A")}\n- B <!--m id=b1 at=2026-11-01T00:00:00Z src=u-->`
    const r = computeMerge(noEol, "", opts())
    expect(r.ok).toBe(true)
    const crlf = "## Facts\r\n\r\n- A <!--m id=a1 at=2026-11-01T00:00:00Z src=u-->\r\n\r\n- B <!--m id=b1 at=2026-11-01T00:00:00Z src=u-->\r\n"
    const r2 = computeMerge(crlf, "", opts())
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(recordsOf(r2.text).map((x) => x.read.meta.record_id)).toEqual(["a1", r2.mergeId, "b1"])
  })

  test("merging a previous merge result works (id stays in the safe set)", () => {
    const first = computeMerge(S, "", opts())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const next = computeMerge(first.text, "", opts({ sourceIds: [first.mergeId, "c1"], body: "- Everything" }))
    expect(next.ok).toBe(true)
  })

  test("refuses ineligible sources and leaves no partial plan", () => {
    const cases: Array<[string, string, string, Partial<Parameters<typeof computeMerge>[2]>?]> = [
      ["missing source", S, "", { sourceIds: ["a1", "zz"] }],
      ["unsafe source id", S, "", { sourceIds: ["a1", "B1"] }],
      ["single source", S, "", { sourceIds: ["a1"] }],
      [
        "partial metadata",
        `## Facts\n\n- A <!--m id=a1 src=u-->\n\n${rec("b1", "B")}`,
        "",
      ],
      [
        "already carries ret",
        `## Facts\n\n- A <!--m id=a1 at=2026-11-01T00:00:00Z src=u ret=2026-11-02T00:00:00Z why=withdrawn-->\n\n${rec("b1", "B")}`,
        "",
      ],
      ["duplicate source in S", `## Facts\n\n${rec("a1", "A")}\n${rec("a1", "A2")}\n${rec("b1", "B")}`, ""],
      ["malformed metadata elsewhere", `## Facts\n\n${rec("a1", "A")}\n${rec("b1", "B")}\n- X <!--m id=x1 at=bad src=u-->\n`, ""],
      ["malformed retracted.md", S, `${TOMB_HEAD}- X <!--m id=x1 at=bad src=u ret=2026-11-13T00:00:00Z why=withdrawn-->\n`],
      ["source already retracted (no M)", S, TOMB_HEAD + tomb("b1", "Beta")],
      ["retracted source with different reason", S, TOMB_HEAD + tomb("a1", "Alpha", "incorrect")],
      ["no metadata (legacy) source", `## Facts\n\n- A\n\n${rec("b1", "B")}`, "", { sourceIds: ["b1", "a1"] }],
    ]
    for (const [name, raw, t, over] of cases) {
      const r = computeMerge(raw, t, opts(over))
      expect(r.ok, name).toBe(false)
      if (!r.ok) expect(r.error, name).toContain("Merge refused")
    }
  })

  test("a source present in both MEMORY.md and retracted.md is refused (needs repair first)", () => {
    const r = computeMerge(S, TOMB_HEAD + tomb("a1", "Alpha"), opts())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("both MEMORY.md and retracted.md")
  })

  test("refuses invalid bodies", () => {
    const bodies = [
      "",
      "   \n",
      "- one\n- two",
      "## Header\n- x",
      "- has <!--m id=zz at=2026-11-01T00:00:00Z src=u--> marker",
      "x".repeat(2001),
    ]
    for (const body of bodies) {
      const r = computeMerge(S, "", opts({ body }))
      expect(r.ok, JSON.stringify(body.slice(0, 20))).toBe(false)
    }
    expect(computeMerge(S, "", opts({ body: "plain paragraph body" })).ok).toBe(true)
    expect(computeMerge(S, "", opts({ body: "- body with trailing newline\n" })).ok).toBe(true)
  })

  test("refuses when the merged id already exists in retracted.md", () => {
    const id = deriveMergeId(["a1", "b1"])
    const r = computeMerge(S, TOMB_HEAD + tomb(id, "old merge"), opts())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("id collision")
  })
})

describe("T-f computeMerge (resume / converged / collision)", () => {
  const fresh = (() => {
    const r = computeMerge(S, "", opts())
    if (!r.ok) throw new Error(r.error)
    return r
  })()

  test("M present with sources still there resumes with every source pending", () => {
    const r = computeMerge(fresh.text, "", opts())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mode).toBe("resume")
    expect(r.text).toBe(fresh.text)
    expect(r.report.pendingSourceIds).toEqual(["a1", "b1"])
  })

  test("half-way state: a1 already superseded, b1 pending", () => {
    const withoutA1 = fresh.text.replace(rec("a1", "Alpha", "u"), "")
    const r = computeMerge(withoutA1, TOMB_HEAD + tomb("a1", "Alpha"), opts())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mode).toBe("resume")
    expect(r.report.pendingSourceIds).toEqual(["b1"])
    expect(r.report.doneSourceIds).toEqual(["a1"])
    // src is computed over pending + done, so the done source still counts (u + i -> i)
    expect(r.report.sourceType).toBe("model_inference")
  })

  test("everything done is converged and writes nothing", () => {
    const s2 = fresh.text.replace(rec("a1", "Alpha", "u"), "").replace(rec("b1", "Beta", "i"), "")
    const t = TOMB_HEAD + tomb("a1", "Alpha") + "\n" + tomb("b1", "Beta", "superseded", "i")
    const r = computeMerge(s2, t, opts())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe("converged")
      expect(r.text).toBe(s2)
    }
  })

  test("sources retracted but M missing is refused", () => {
    const s2 = S.replace(rec("a1", "Alpha", "u"), "")
    const r = computeMerge(s2, TOMB_HEAD + tomb("a1", "Alpha"), opts())
    expect(r.ok).toBe(false)
  })

  test("existing M with a different body, wrong refs or extra extras is a collision", () => {
    const id = fresh.mergeId
    const base = `## Facts\n\n${rec("a1", "Alpha")}\n`
    const m = (text: string, extra: string) =>
      `- ${text} <!--m id=${id} at=${NOW} src=i refs=a1,b1${extra}-->\n`
    for (const body of [m("Different body", ""), m("Alpha and Beta combined", " mig=legacy-v1")]) {
      const r = computeMerge(base + `\n${body}\n${rec("b1", "Beta", "i")}`, "", opts())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain("different content")
    }
    const wrongRefs = `- Alpha and Beta combined <!--m id=${id} at=${NOW} src=i refs=a1,zz-->\n`
    expect(computeMerge(base + `\n${wrongRefs}\n${rec("b1", "Beta", "i")}`, "", opts()).ok).toBe(false)
    const wrongSrc = `- Alpha and Beta combined <!--m id=${id} at=${NOW} src=u refs=a1,b1-->\n`
    expect(computeMerge(base + `\n${wrongSrc}\n${rec("b1", "Beta", "i")}`, "", opts()).ok).toBe(false)
  })

  test("duplicated M is refused", () => {
    const dup = fresh.text + "\n" + recordsOf(fresh.text).find((x) => x.read.meta.record_id === fresh.mergeId)!.text
    const r = computeMerge(dup, "", opts())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("duplicated")
  })

  test("overlapping concurrent merge: a source already superseded by a different merge is refused", () => {
    const other = deriveMergeId(["a1", "c1"])
    const s2 = `## Facts\n\n- AC <!--m id=${other} at=${NOW} src=u refs=a1,c1-->\n\n${rec("b1", "Beta", "i")}`
    const r = computeMerge(s2, TOMB_HEAD + tomb("a1", "Alpha") + "\n" + tomb("c1", "Gamma"), opts())
    expect(r.ok).toBe(false)
  })
})

describe("T-f budget guard (final state, real pipeline)", () => {
  test("refuses a merge whose final state introduces new truncation", () => {
    // The source file is ~320 chars and fits in 100 tokens; a 900-char merged body does not.
    const raw = `## Facts\n\n${rec("a1", "Alpha")}\n${rec("b1", "Beta")}`
    expect(computeMerge(raw, "", opts({ budgetTokens: 100 })).ok).toBe(true)
    const r = computeMerge(raw, "", opts({ budgetTokens: 100, body: "- " + "z".repeat(900) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("new memory truncation")
  })

  test("the double-visible intermediate state is not the acceptance basis", () => {
    // Both sources + M together exceed the budget, but the final state (M only) fits.
    const a = rec("a1", "x".repeat(400))
    const b = rec("b1", "y".repeat(400))
    const raw = `## Facts\n\n${a}\n${b}`
    const budget = 260 // raw ~ 880 chars = 220 tokens fits; raw + 450-char M would be ~340 tokens
    const r = computeMerge(raw, "", opts({ budgetTokens: budget, body: "- " + "m".repeat(450) }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.report.afterTruncated).toBe(false)
  })

  test("refuses when the merged record would not be fully visible in an already truncated file", () => {
    const big = rec("big1", "B".repeat(3000))
    const raw = `## Facts\n\n${big}\n${rec("a1", "Alpha")}\n${rec("b1", "Beta")}`
    const r = computeMerge(raw, "", opts({ budgetTokens: 300 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("not be fully visible")
  })

  test("an already truncated file can still merge when M is visible and nothing visible is lost", () => {
    // M lands right after the first source, ahead of the big tail record that is already cut.
    const tail = rec("big1", "T".repeat(4000))
    const raw = `## Facts\n\n${rec("a1", "Alpha")}\n${rec("b1", "Beta")}\n${tail}`
    const r = computeMerge(raw, "", opts({ budgetTokens: 300 }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.report.beforeTruncated).toBe(true)
      expect(r.report.mergedRecordVisible).toBe(true)
    }
  })

  test("refuses when other fully-visible records would be pushed out (M itself still visible)", () => {
    // Before: keep1 is fully visible although the file is truncated by a huge tail.
    // After: a long M sits ahead of keep1 and cuts it, while removing the tiny sources frees too little.
    const keep = rec("keep1", "K".repeat(200))
    const tail = rec("tail1", "T".repeat(4000))
    const raw = `## Facts\n\n${rec("a1", "A")}\n${rec("b1", "B")}\n${keep}\n${tail}`
    const ok = computeMerge(raw, "", opts({ budgetTokens: 130, body: "- " + "L".repeat(150) }))
    expect(ok.ok).toBe(true)
    const r = computeMerge(raw, "", opts({ budgetTokens: 130, body: "- " + "L".repeat(250) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("other records fully visible")
  })
})

describe("T-f verifyMergeConverged", () => {
  const id = deriveMergeId(["a1", "b1"])
  const sOk = `## Facts\n\n- M <!--m id=${id} at=${NOW} src=i refs=a1,b1-->\n\n${rec("c1", "Gamma")}`
  const tOk = TOMB_HEAD + tomb("a1", "Alpha") + "\n" + tomb("b1", "Beta")
  const input = { mergeId: id, sourceIds: ["a1", "b1"] }

  test("accepts the converged state", () => {
    expect(verifyMergeConverged(sOk, tOk, input).ok).toBe(true)
  })

  test("rejects a leftover source, a missing tombstone, a wrong reason, a duplicate tombstone and a missing/duplicated M", () => {
    expect(verifyMergeConverged(sOk + "\n" + rec("a1", "Alpha"), tOk, input).ok).toBe(false)
    expect(verifyMergeConverged(sOk, TOMB_HEAD + tomb("a1", "Alpha"), input).ok).toBe(false)
    expect(verifyMergeConverged(sOk, TOMB_HEAD + tomb("a1", "Alpha") + "\n" + tomb("b1", "Beta", "withdrawn"), input).ok).toBe(false)
    expect(verifyMergeConverged(sOk, tOk + "\n" + tomb("a1", "Alpha"), input).ok).toBe(false)
    expect(verifyMergeConverged(`## Facts\n\n${rec("c1", "Gamma")}`, tOk, input).ok).toBe(false)
    const m = `- M <!--m id=${id} at=${NOW} src=i refs=a1,b1-->\n`
    expect(verifyMergeConverged(sOk + "\n" + m, tOk, input).ok).toBe(false)
  })
})

describe("T-f report", () => {
  test("states provenance-only semantics and the audit scope", () => {
    const r = computeMerge(S, "", opts())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = formatMergeReport(r.report, { dryRun: true, written: false, retracted: [] })
    expect(out).toContain("dry-run")
    expect(out).toContain("refs=a1,b1")
    expect(out).toContain("does not verify that the merged text is true")
    expect(out).toContain("Direct deletions")
    const done = formatMergeReport(r.report, { dryRun: false, written: true, retracted: ["a1", "b1"] })
    expect(done).toContain("completed")
    expect(done).toContain("a1, b1")
  })
})
