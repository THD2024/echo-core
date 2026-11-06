import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { MEMORY_TEMPLATE } from "../../src/session/checkpoint-templates"
import {
  listRecords,
  parseMemoryDocument,
  serializeMemoryDocument,
  type MemoryDocument,
  type MemorySegment,
} from "../../src/memory/record-parse"
import { readDocumentMeta, readRecordMeta, withRecordMeta, type RecordMetaPatch } from "../../src/memory/record-meta"

const ID = "8k2f9q3x"
const AT = "2026-11-05T09:12:00Z"
const MARKER = `<!--m id=${ID} at=${AT} src=u-->`
const FULL: RecordMetaPatch = { record_id: ID, recorded_at: AT, source_type: "user_statement" }

const rec = (text: string, line = 1): Pick<MemorySegment, "kind" | "text" | "line"> => ({ kind: "record", text, line })
const kinds = (doc: MemoryDocument) => doc.segments.map((s) => s.kind)
const lineCounts = (doc: MemoryDocument) => doc.segments.map((s) => s.text.split("\n").length)
const diagCodes = (text: string) => readRecordMeta(rec(text)).diagnostics.map((d) => d.code)
const mustWrite = (text: string, patch: RecordMetaPatch) => {
  const w = withRecordMeta(rec(text), patch)
  if (!w.ok) throw new Error("write refused: " + w.diagnostics.map((d) => d.code).join(","))
  return w
}
/** Reverse of an insert: delete the marker plus exactly one space directly before it. */
const strip = (text: string) => {
  const i = text.indexOf("<!--m")
  const j = text.indexOf("-->", i) + 3
  return text.slice(0, i > 0 && text[i - 1] === " " ? i - 1 : i) + text.slice(j)
}

const SAMPLE = [
  "# Notes\r\n",
  "\n",
  "## Facts\n",
  "_What to remember._\n",
  "\n",
  "- single line fact\n",
  "- multi line fact\n",
  "  continues here\n",
  "  - nested child\n",
  "* star bullet\n",
  "1. ordered item\n",
  "\n",
  "A plain paragraph record\n",
  "that spans two lines.\n",
  "\n",
  "> quoted record\n",
  "\n",
  "- fenced item\n",
  "  ```\n",
  "  code\n",
  "  ```\n",
  "\n",
  "## Empty\n",
  "(none yet)\n",
  "\n",
  "| a | b |\n",
  "|---|---|\n",
  "\n",
  "<!-- user comment -->\n",
].join("")

describe("1. legacy / no metadata: zero change", () => {
  test("records without a marker read as absent with empty meta", () => {
    for (const raw of [SAMPLE, MEMORY_TEMPLATE, "", "\n", "- a", "## H\n- x\n- y"]) {
      const doc = parseMemoryDocument(raw)
      for (const s of listRecords(doc)) {
        const r = readRecordMeta(s)
        expect(r.status).toBe("absent")
        expect(r.meta).toEqual({})
        expect(r.extras).toEqual({})
        expect(r.diagnostics).toEqual([])
      }
      expect(serializeMemoryDocument(doc)).toBe(raw)
    }
  })

  test("reading never changes the document (no write happened)", () => {
    const doc = parseMemoryDocument(SAMPLE)
    const before = serializeMemoryDocument(doc)
    readDocumentMeta(doc)
    expect(serializeMemoryDocument(doc)).toBe(before)
  })

  test("setting nothing is a no-op", () => {
    const w = mustWrite("- a\n", {})
    expect(w).toEqual({ ok: true, text: "- a\n", changed: false })
  })

  test("a user comment that merely starts with <!--m is not ours", () => {
    for (const t of ["- note <!--made by hand-->\n", "- x <!--mark-->\n", "- x <!--m2 a=b-->\n"]) {
      expect(readRecordMeta(rec(t)).status).toBe("absent")
      expect(readRecordMeta(rec(t)).diagnostics).toEqual([])
    }
  })
})

describe("2. roundtrip with markers present (seeded fuzz)", () => {
  function rng(seed: number) {
    let s = seed >>> 0
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 2 ** 32
    }
  }
  const vocab = [
    "## Section\n",
    "_italic instruction_\n",
    `- bullet ${MARKER}\n`,
    "- bullet plain\n",
    `- crlf bullet ${MARKER}\r\n`,
    "  continuation <!--m id=bad-->\n",
    `paragraph ${MARKER}\n`,
    "paragraph line two\n",
    "\n",
    "(none yet)\n",
    "> quote\n",
    "```\n",
    "| t |\n",
    "<!--m\n",
    `- x <!--m id=a id=b--> tail\n`,
    "- trailing space \n",
  ]

  test("2000 documents: parse/serialize lossless, read never throws, write+strip restores bytes", () => {
    const rand = rng(20261105)
    for (let n = 0; n < 2000; n++) {
      const parts: string[] = []
      for (let i = 0, len = 1 + Math.floor(rand() * 10); i < len; i++) parts.push(vocab[Math.floor(rand() * vocab.length)])
      const raw = parts.join("")
      const doc = parseMemoryDocument(raw)
      expect(serializeMemoryDocument(doc)).toBe(raw)
      for (const s of doc.segments) {
        const r = readRecordMeta(s)
        expect(["absent", "valid", "malformed", "not-record"]).toContain(r.status)
        if (r.status !== "valid") expect(r.meta).toEqual({})
        if (s.kind !== "record") {
          const w = withRecordMeta(s, FULL)
          expect(w.ok).toBe(false)
          expect(w.text).toBe(s.text)
        }
      }
    }
  })

  test("attaching a marker to every plain record keeps boundaries, kinds and line counts", () => {
    const doc = parseMemoryDocument(SAMPLE)
    const out = doc.segments.map((s) => {
      if (s.kind !== "record") return s.text
      const w = withRecordMeta(s, FULL)
      expect(w.ok).toBe(true)
      return w.text
    })
    const raw2 = out.join("")
    const doc2 = parseMemoryDocument(raw2)
    expect(serializeMemoryDocument(doc2)).toBe(raw2)
    expect(kinds(doc2)).toEqual(kinds(doc))
    expect(lineCounts(doc2)).toEqual(lineCounts(doc))
    // strip every marker -> original bytes
    expect(
      doc2.segments.map((s) => (s.kind === "record" ? strip(s.text) : s.text)).join(""),
    ).toBe(SAMPLE)
    for (const { read } of readDocumentMeta(doc2)) {
      expect(read.status).toBe("valid")
      expect(read.meta).toEqual({ record_id: ID, recorded_at: AT, source_type: "user_statement" })
    }
  })

  test("T-a still reads a marker as part of the record text (segment.meta stays {})", () => {
    const doc = parseMemoryDocument(`## S\n- fact ${MARKER}\n`)
    const [r] = listRecords(doc)
    expect(r.text).toBe(`- fact ${MARKER}\n`)
    expect(r.meta).toEqual({})
  })
})

describe("3. codec roundtrip and idempotence", () => {
  test("read(write(m)) equals m", () => {
    const w = mustWrite("- fact\n", {
      ...FULL,
      retracted_at: "2026-11-06T00:00:00Z",
      retract_reason: "withdrawn",
      extras: { refs: "a:event,b:record", mig: "v1" },
    })
    expect(w.text).toBe(
      `- fact <!--m id=${ID} at=${AT} src=u ret=2026-11-06T00:00:00Z why=withdrawn refs=a:event,b:record mig=v1-->\n`,
    )
    const r = readRecordMeta(rec(w.text))
    expect(r.status).toBe("valid")
    expect(r.meta).toEqual({
      record_id: ID,
      recorded_at: AT,
      source_type: "user_statement",
      retracted_at: "2026-11-06T00:00:00Z",
      retract_reason: "withdrawn",
    })
    expect(r.extras).toEqual({ refs: "a:event,b:record", mig: "v1" })
  })

  test("setting the same values again is a byte-for-byte no-op", () => {
    const once = mustWrite("- fact\n", FULL)
    const twice = mustWrite(once.text, FULL)
    expect(twice.changed).toBe(false)
    expect(twice.text).toBe(once.text)
  })

  test("a hand-written marker with a different key order is not rewritten for an identical value", () => {
    const t = `- fact <!--m src=u at=${AT} id=${ID}-->\n`
    const w = mustWrite(t, FULL)
    expect(w.changed).toBe(false)
    expect(w.text).toBe(t)
  })

  test("patch semantics: undefined keeps, null removes, a value replaces", () => {
    const base = mustWrite("- fact\n", { ...FULL, extras: { fut: "1" } }).text
    const a = mustWrite(base, { source_type: "tool_output" })
    expect(readRecordMeta(rec(a.text)).meta.source_type).toBe("tool_output")
    expect(readRecordMeta(rec(a.text)).meta.record_id).toBe(ID)
    expect(readRecordMeta(rec(a.text)).extras).toEqual({ fut: "1" })
    const b = mustWrite(a.text, { source_type: null, extras: { fut: null } })
    expect(readRecordMeta(rec(b.text)).meta).toEqual({ record_id: ID, recorded_at: AT })
    expect(readRecordMeta(rec(b.text)).extras).toEqual({})
  })

  test("removing every field removes the marker and restores the original bytes", () => {
    for (const orig of ["- fact\n", "- fact  \n", "- fact\r\n", "- fact"]) {
      const withMeta = mustWrite(orig, FULL).text
      const cleared = mustWrite(withMeta, { record_id: null, recorded_at: null, source_type: null })
      expect(cleared.changed).toBe(true)
      expect(cleared.text).toBe(orig)
    }
  })
})

describe("4. minimal change", () => {
  test("only the marker region changes (insert, replace, delete)", () => {
    const orig = "- fact one\n  continuation\n"
    const ins = mustWrite(orig, FULL).text
    expect(strip(ins)).toBe(orig)
    const rep = mustWrite(ins, { recorded_at: "2026-11-07T10:00:00Z" }).text
    expect(rep.replace("2026-11-07T10:00:00Z", AT)).toBe(ins)
    expect(rep.startsWith("- fact one ")).toBe(true)
    expect(rep.endsWith("\n  continuation\n")).toBe(true)
  })
})

describe("5. line endings and trailing whitespace", () => {
  test("LF, CRLF, no final newline, trailing spaces/tabs", () => {
    const cases: Record<string, string> = {
      lf: "- fact\n",
      crlf: "- fact\r\n",
      nofinal: "- fact",
      spaces: "- fact   \n",
      tab: "- fact\t\n",
      mixed: "- fact\r\n  cont\n  cont2\r\n",
    }
    for (const [name, orig] of Object.entries(cases)) {
      const w = mustWrite(orig, FULL).text
      expect(strip(w)).toBe(orig)
      const nl = orig.includes("\r\n") && name !== "mixed" ? "\r\n" : orig.endsWith("\n") ? "\n" : ""
      if (name === "mixed") expect(w.startsWith(`- fact ${MARKER}\r\n`)).toBe(true)
      else expect(w.endsWith(`${MARKER}${nl}`)).toBe(true)
      expect(readRecordMeta(rec(w)).status).toBe("valid")
    }
  })

  test("trailing whitespace is kept BEFORE the marker, never trimmed", () => {
    expect(mustWrite("- fact   \n", FULL).text).toBe(`- fact    ${MARKER}\n`)
  })

  test("a marker followed by trailing whitespace is not at the absolute end -> malformed", () => {
    for (const t of [`- fact ${MARKER} \n`, `- fact ${MARKER}\t\r\n`, `- fact ${MARKER}  `]) {
      const r = readRecordMeta(rec(t))
      expect(r.status).toBe("malformed")
      expect(r.diagnostics.map((d) => d.code)).toContain("marker-not-at-line-end")
    }
  })
})

describe("6. position: only the first line, only at its absolute end", () => {
  test("multi-line bullet, nested, paragraph, blockquote and fenced records carry the marker on line 1", () => {
    const doc = parseMemoryDocument(SAMPLE)
    for (const s of listRecords(doc)) {
      const w = withRecordMeta(s, FULL)
      expect(w.ok).toBe(true)
      if (!w.ok) continue
      const firstLine = w.text.split("\n")[0].replace(/\r$/, "")
      expect(firstLine.endsWith(MARKER)).toBe(true)
      expect(w.text.split("\n").slice(1).join("\n")).toBe(s.text.split("\n").slice(1).join("\n"))
    }
  })

  test("a marker on a continuation line is reported and ignored", () => {
    const t = `- fact\n  more ${MARKER}\n`
    const r = readRecordMeta(rec(t, 10))
    expect(r.status).toBe("absent")
    expect(r.meta).toEqual({})
    expect(r.diagnostics).toEqual([
      { code: "marker-not-on-first-line", line: 11, message: expect.any(String) },
    ])
  })

  test("a valid first-line marker plus a stray later marker: valid, with a diagnostic", () => {
    const r = readRecordMeta(rec(`- fact ${MARKER}\n  again ${MARKER}\n`))
    expect(r.status).toBe("valid")
    expect(r.meta.record_id).toBe(ID)
    expect(r.diagnostics.map((d) => d.code)).toEqual(["marker-not-on-first-line"])
  })

  test("a marker in the middle of the first line is malformed, not truncated or guessed", () => {
    const t = `- before ${MARKER} after\n`
    const r = readRecordMeta(rec(t))
    expect(r.status).toBe("malformed")
    expect(r.diagnostics.map((d) => d.code)).toEqual(["marker-not-at-line-end"])
    const w = withRecordMeta(rec(t), FULL)
    expect(w.ok).toBe(false)
    expect(w.text).toBe(t)
  })
})

describe("7. malformed markers: all-or-nothing, deterministic, never throw", () => {
  const cases: [string, string, string][] = [
    ["two markers", `- x ${MARKER} ${MARKER}\n`, "duplicate-marker"],
    ["unclosed", "- x <!--m id=8k2f9q3x\n", "unclosed-marker"],
    ["unclosed at EOF", "- x <!--m", "unclosed-marker"],
    ["empty marker", "- x <!--m-->\n", "marker-empty"],
    ["bare token", "- x <!--m id=8k2f9q3x oops-->\n", "bad-token"],
    ["bad key", "- x <!--m ID=8k2f9q3x-->\n", "bad-key"],
    ["duplicate key", "- x <!--m id=8k2f9q3x id=zzzzzzzz-->\n", "duplicate-key"],
    ["bad timestamp", "- x <!--m at=not-a-time-->\n", "invalid-recorded-at"],
    ["non-UTC timestamp", "- x <!--m at=2026-11-05T09:12:00+08:00-->\n", "invalid-recorded-at"],
    ["impossible date", "- x <!--m at=2026-02-30T09:12Z-->\n", "invalid-recorded-at"],
    ["bad src", "- x <!--m src=x-->\n", "invalid-source-type"],
    ["full-name src", "- x <!--m src=user_statement-->\n", "invalid-source-type"],
    ["ret without why", `- x <!--m ret=${AT}-->\n`, "retract-unpaired"],
    ["why without ret", "- x <!--m why=incorrect-->\n", "retract-unpaired"],
    ["bad why", `- x <!--m ret=${AT} why=a/b-->\n`, "invalid-retract-reason"],
    ["free-text why", `- x <!--m ret=${AT} why=stale-->\n`, "invalid-retract-reason"],
    ["wrong-case why", `- x <!--m ret=${AT} why=Withdrawn-->\n`, "invalid-retract-reason"],
    ["empty value", "- x <!--m id=-->\n", "invalid-id"],
    ["over-long extra", `- x <!--m fut=${"a".repeat(257)}-->\n`, "invalid-extra-value"],
  ]
  for (const [name, text, code] of cases) {
    test(name, () => {
      const r = readRecordMeta(rec(text))
      expect(r.status).toBe("malformed")
      expect(r.meta).toEqual({})
      expect(r.extras).toEqual({})
      expect(r.diagnostics.map((d) => d.code)).toContain(code as never)
      // deterministic
      expect(readRecordMeta(rec(text))).toEqual(r)
      // never rewrites over a broken marker
      const w = withRecordMeta(rec(text), FULL)
      expect(w.ok).toBe(false)
      expect(w.text).toBe(text)
      if (!w.ok) expect(w.diagnostics[0].code).toBe("existing-marker-malformed")
    })
  }

  test("valid fields mixed with an invalid one: the WHOLE marker is rejected (no half parse)", () => {
    const r = readRecordMeta(rec(`- x <!--m id=${ID} at=garbage src=u-->\n`))
    expect(r.status).toBe("malformed")
    expect(r.meta).toEqual({})
  })

  test("unknown keys mixed with valid keys are fine (forward compatible), not malformed", () => {
    const r = readRecordMeta(rec(`- x <!--m id=${ID} fut=1 other=a:b-->\n`))
    expect(r.status).toBe("valid")
    expect(r.meta).toEqual({ record_id: ID })
    expect(r.extras).toEqual({ fut: "1", other: "a:b" })
  })

  test("diagnostic line numbers are offset from the segment line", () => {
    expect(readRecordMeta(rec("- x <!--m id=a id=b-->\n", 42)).diagnostics[0].line).toBe(42)
  })
})

describe("8. free editing", () => {
  const written = mustWrite("- fact\n", FULL).text
  test("body edited, marker kept -> meta unchanged", () => {
    const edited = written.replace("fact", "a rewritten fact")
    expect(readRecordMeta(rec(edited)).meta).toEqual(readRecordMeta(rec(written)).meta)
  })
  test("marker deleted -> back to a legacy record", () => {
    expect(readRecordMeta(rec(strip(written))).status).toBe("absent")
  })
  test("marker damaged -> diagnostic, bytes untouched", () => {
    const broken = written.replace("-->", "")
    const r = readRecordMeta(rec(broken))
    expect(r.status).toBe("malformed")
    expect(withRecordMeta(rec(broken), { source_type: "tool_output" }).text).toBe(broken)
  })
})

describe("9. non-record segments are refused and untouched", () => {
  const raw = [
    "preamble line\n",
    "## S\n",
    "_instruction_\n",
    "\n",
    "(none yet)\n",
    "| a |\n",
    "|---|\n",
    "\n",
    "<!-- c -->\n",
    "\n",
    "### sub\n",
    "\n",
    "- real\n",
  ].join("")
  const doc = parseMemoryDocument(raw)

  test("every non-record kind: not-record on read, refused on write, same bytes", () => {
    for (const s of doc.segments) {
      if (s.kind === "record") continue
      expect(readRecordMeta(s)).toEqual({ status: "not-record", meta: {}, extras: {}, diagnostics: [] })
      const w = withRecordMeta(s, FULL)
      expect(w.ok).toBe(false)
      expect(w.text).toBe(s.text)
      if (!w.ok) expect(w.diagnostics.map((d) => d.code)).toEqual(["not-a-record"])
    }
    expect(new Set(doc.segments.map((s) => s.kind)).size).toBeGreaterThanOrEqual(6)
  })

  test("why this is required: a marker on the italic line makes T-a reclassify it as a record", () => {
    const hacked = parseMemoryDocument("## S\n_instruction_ " + MARKER + "\n")
    expect(kinds(hacked)).toEqual(["section-header", "record"])
    expect(kinds(parseMemoryDocument("## S\n_instruction_\n"))).toEqual(["section-header", "italic"])
  })

  test("section header and preamble are refused too", () => {
    expect(withRecordMeta({ kind: "section-header", text: "## S\n" }, FULL).ok).toBe(false)
    expect(withRecordMeta({ kind: "preamble", text: "intro\n" }, FULL).ok).toBe(false)
  })
})

describe("10. unknown and reserved keys", () => {
  test("extras round-trip verbatim and in order when other fields change", () => {
    const t = `- x <!--m zeta=1 id=${ID} alpha=2 refs=a:event valid_from=2026-01-01 disputed=1 author=me mig=v1-->\n`
    const r = readRecordMeta(rec(t))
    expect(Object.keys(r.extras)).toEqual(["zeta", "alpha", "refs", "valid_from", "disputed", "author", "mig"])
    const w = mustWrite(t, { recorded_at: AT })
    expect(readRecordMeta(rec(w.text)).extras).toEqual(r.extras)
    expect(Object.keys(readRecordMeta(rec(w.text)).extras)).toEqual(Object.keys(r.extras))
  })

  test("reserved wire keys cannot be smuggled in as extras; bad extras are refused", () => {
    for (const k of ["id", "at", "src", "ret", "why"]) {
      const w = withRecordMeta(rec("- x\n"), { extras: { [k]: "v" } })
      expect(w.ok).toBe(false)
      if (!w.ok) expect(w.diagnostics[0].code).toBe("reserved-extra-key")
    }
    expect(withRecordMeta(rec("- x\n"), { extras: { "Bad Key": "v" } }).ok).toBe(false)
    expect(withRecordMeta(rec("- x\n"), { extras: { k: "has space" } }).ok).toBe(false)
  })

  test("invalid patch values are refused and the text is untouched", () => {
    const t = "- x\n"
    for (const patch of [
      { record_id: "has space" },
      { record_id: "" },
      { recorded_at: "yesterday" },
      { source_type: "guess" as never },
      { retract_reason: "stale" as never },
      { retract_reason: "has space" as never },
      { retracted_at: AT },
    ] as RecordMetaPatch[]) {
      const w = withRecordMeta(rec(t), patch)
      expect(w.ok).toBe(false)
      expect(w.text).toBe(t)
    }
  })

  test("retraction fields must be set and cleared together", () => {
    const set = mustWrite("- x\n", { retracted_at: AT, retract_reason: "superseded" }).text
    expect(withRecordMeta(rec(set), { retract_reason: null }).ok).toBe(false)
    const cleared = mustWrite(set, { retracted_at: null, retract_reason: null })
    expect(cleared.text).toBe("- x\n")
  })
})

describe("record_id: any non-empty single token (shape is T-b2 policy)", () => {
  test("short, uppercase, punctuated and numeric ids are all carried verbatim", () => {
    for (const id of ["a", "abc", "8K2F9Q3X", "id-1.2:3_x", "0001", "x".repeat(64), "a=b", "<z>"]) {
      const w = mustWrite("- x\n", { record_id: id })
      expect(w.text).toBe(`- x <!--m id=${id}-->\n`)
      expect(readRecordMeta(rec(w.text)).meta.record_id).toBe(id)
    }
  })
  test("empty or whitespace-containing ids are refused", () => {
    expect(readRecordMeta(rec("- x <!--m id=-->\n")).status).toBe("malformed")
    for (const id of ["", " ", "a b", "a\tb"]) expect(withRecordMeta(rec("- x\n"), { record_id: id }).ok).toBe(false)
  })
})

describe("retract_reason: frozen enum superseded | incorrect | withdrawn", () => {
  test("each enum value round-trips", () => {
    for (const why of ["superseded", "incorrect", "withdrawn"] as const) {
      const w = mustWrite("- x\n", { retracted_at: AT, retract_reason: why })
      expect(readRecordMeta(rec(w.text)).meta).toEqual({ retracted_at: AT, retract_reason: why })
    }
  })
  test("anything else is rejected on read and on write", () => {
    for (const why of ["stale", "user-request", "SUPERSEDED", "", "superseded,incorrect"]) {
      expect(readRecordMeta(rec(`- x <!--m ret=${AT} why=${why}-->\n`)).status).toBe("malformed")
      expect(withRecordMeta(rec("- x\n"), { retracted_at: AT, retract_reason: why as never }).ok).toBe(false)
    }
  })
})

describe("recorded_at: valid ISO-8601 UTC only, precision NOT locked", () => {
  test("minute, second and fractional-second precision all accepted", () => {
    for (const at of ["2026-11-05T09:12Z", "2026-11-05T09:12:00Z", "2026-11-05T09:12:00.5Z", "2026-11-05T09:12:00.123456789Z"])
      expect(readRecordMeta(rec(`- x <!--m at=${at}-->\n`)).meta.recorded_at).toBe(at)
  })
  test("leap day handled, impossible values rejected", () => {
    expect(readRecordMeta(rec("- x <!--m at=2028-02-29T00:00:00Z-->\n")).status).toBe("valid")
    for (const at of ["2026-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-11-05T24:00:00Z", "2026-11-05T09:60Z", "2026-11-05T09:12:60Z", "2026-11-05 09:12Z", "2026-11-05T09:12:00"])
      expect(readRecordMeta(rec(`- x <!--m at=${at}-->\n`)).status).toBe("malformed")
  })
})

describe("11. freeze guards", () => {
  const src = path.join(import.meta.dir, "../../src/memory/record-meta.ts")

  test("only a type-only import of T-a; no fs / clock / random / process", async () => {
    const text = await fs.readFile(src, "utf8")
    const imports = text.split("\n").filter((l) => /^\s*import\b/.test(l))
    expect(imports).toEqual(['import type { MemoryDocument, MemoryRecordMetadata, MemorySegment } from "./record-parse"'])
    for (const banned of ["Date.now", "new Date()", "Math.random", "process.", "node:fs", "crypto", "require("])
      expect(text.includes(banned)).toBe(false)
  })

  test("the codec is the only importer of itself: no src file imports record-meta", async () => {
    const srcDir = path.join(import.meta.dir, "../../src")
    const hits: string[] = []
    const walk = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) await walk(p)
        else if (/\.(ts|tsx)$/.test(e.name) && p !== src) {
          if ((await fs.readFile(p, "utf8")).includes("record-meta")) hits.push(path.relative(srcDir, p))
        }
      }
    }
    await walk(srcDir)
    expect(hits).toEqual([])
  })
})

describe("12. real-corpus-shaped data (constructed; real MEMORY.md must be verified natively)", () => {
  // Shaped like the two real MEMORY.md files: single-line bullets, one paragraph guide line.
  // NOTE: the real corpus has 0 multi-line records (0/64), so multi-line / continuation
  // behaviour above is covered by CONSTRUCTED samples only.
  const corpus =
    "## Rules\n_Hard rules._\n\n" +
    Array.from({ length: 40 }, (_, i) => `- rule number ${i} about not doing a thing`).join("\n") +
    "\n\n## Project\nArchitecture:\n" +
    Array.from({ length: 21 }, (_, i) => `- component ${i}: does a thing`).join("\n") +
    "\n"

  test("insert a marker into every record then strip it: bytes equal the original; cost is reported", () => {
    const doc = parseMemoryDocument(corpus)
    const recs = listRecords(doc)
    expect(recs.length).toBe(62)
    let added = 0
    const out = doc.segments
      .map((s) => {
        if (s.kind !== "record") return s.text
        const w = mustWrite(s.text, FULL)
        added += w.text.length - s.text.length
        return w.text
      })
      .join("")
    expect(parseMemoryDocument(out).segments.map((s) => (s.kind === "record" ? strip(s.text) : s.text)).join("")).toBe(corpus)
    const perRecord = added / recs.length
    expect(perRecord).toBe(` ${MARKER}`.length)
    // Fact only (no budget conclusion): chars added per record for this exact marker.
    console.log(`marker cost: ${perRecord} chars/record, ${added} chars for ${recs.length} records`)
  })
})
