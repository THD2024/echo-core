import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import {
  countByKind,
  listRecords,
  parseMemoryDocument,
  serializeMemoryDocument,
  type MemoryDocument,
} from "../../src/memory/record-parse"
import { MEMORY_TEMPLATE } from "../../src/session/checkpoint-templates"
import { parseSections } from "../../src/session/budgeted-read"

const kinds = (doc: MemoryDocument) => doc.segments.map((s) => s.kind)
const records = (raw: string) => listRecords(parseMemoryDocument(raw)).map((s) => s.text)

/** Invariants every parse must satisfy, for any input. */
function checkInvariants(raw: string): MemoryDocument {
  const doc = parseMemoryDocument(raw)
  expect(serializeMemoryDocument(doc)).toBe(raw)
  let pos = 0
  for (const s of doc.segments) {
    expect(s.start).toBe(pos)
    expect(s.end).toBe(s.start + s.text.length)
    expect(raw.slice(s.start, s.end)).toBe(s.text)
    expect(s.text.length).toBeGreaterThan(0)
    expect(s.meta).toEqual({})
    pos = s.end
  }
  expect(pos).toBe(raw.length)
  // Section parity with the budgeted reader: same header lines, same order.
  const norm = (t: string) => t.replace(/\n$/, "").replace(/\r$/, "")
  const theirs = parseSections(raw).sections.map((s) => norm(s.header))
  const ours = doc.segments.filter((s) => s.kind === "section-header").map((s) => norm(s.text))
  expect(ours).toEqual(theirs)
  expectItalicParity(raw, doc)
  return doc
}

/**
 * Per-section italic line must equal the budgeted reader's `italic`. The two scans differ
 * only where documented in record-parse.ts: CRLF input (the reader's endsWith("_") misses
 * "\r"), and sections containing fenced code or an HTML comment (the reader also looks inside them).
 */
function expectItalicParity(raw: string, doc: MemoryDocument) {
  const reader = parseSections(raw).sections
  const ours: string[] = []
  for (const s of doc.segments) {
    if (s.kind === "section-header") ours.push("")
    else if (s.kind === "italic") ours[ours.length - 1] = s.text.replace(/\r?\n$/, "")
  }
  expect(ours).toHaveLength(reader.length)
  const sectionTexts = raw.split(/^## /m).slice(1)
  for (let k = 0; k < reader.length; k++) {
    if (ours[k] === reader[k].italic) continue
    const explained = /\r\n/.test(sectionTexts[k] ?? "") || /^[ \t]*(```|~~~|<!--)/m.test(sectionTexts[k] ?? "")
    expect(explained).toBe(true)
  }
}

describe("template", () => {
  test("current MEMORY.md template: no records, placeholders and instructions classified", () => {
    const doc = checkInvariants(MEMORY_TEMPLATE)
    expect(doc.segments[0].kind).toBe("preamble")
    const counts = countByKind(doc)
    expect(counts["section-header"]).toBe(4)
    expect(counts.italic).toBe(4)
    expect(counts.placeholder).toBe(4)
    expect(counts.record).toBe(0)
    expect(counts.raw).toBe(0)
    expect(doc.segments.filter((s) => s.kind === "section-header").map((s) => s.section)).toEqual([
      "Project context",
      "Rules",
      "Architecture decisions",
      "Discovered durable knowledge",
    ])
  })

  test("CRLF version of the template parses the same shape and round-trips", () => {
    const crlf = MEMORY_TEMPLATE.replace(/\n/g, "\r\n")
    const doc = checkInvariants(crlf)
    expect(countByKind(doc)).toEqual(countByKind(parseMemoryDocument(MEMORY_TEMPLATE)))
  })
})

describe("records", () => {
  test("empty section", () => {
    const doc = checkInvariants("## Rules\n")
    expect(kinds(doc)).toEqual(["section-header"])
  })

  test("several records under their section; section name recorded", () => {
    const raw = `## Rules
_Hard constraints from user that every session must respect._

- never force push
- ask before deleting data

## Architecture decisions
- use sqlite for the index
`
    const doc = checkInvariants(raw)
    const recs = listRecords(doc)
    expect(recs.map((r) => [r.section, r.text])).toEqual([
      ["Rules", "- never force push\n"],
      ["Rules", "- ask before deleting data\n"],
      ["Architecture decisions", "- use sqlite for the index\n"],
    ])
    expect(recs[0].line).toBe(4)
  })

  test("placeholder next to a real record are both kept", () => {
    const doc = checkInvariants("## Rules\n(none yet)\n- a rule\n")
    expect(kinds(doc)).toEqual(["section-header", "placeholder", "record"])
  })

  test("bullet and ordered markers, checkbox", () => {
    const raw = "## Rules\n- a\n* b\n+ c\n1. d\n2) e\n- [ ] f\n- [x] g\n"
    expect(records(raw)).toEqual(["- a\n", "* b\n", "+ c\n", "1. d\n", "2) e\n", "- [ ] f\n", "- [x] g\n"])
    checkInvariants(raw)
  })

  test("not bullets: bold, negative number, dashes inside words", () => {
    const raw = "## Rules\n**bold** start\n-5 degrees is cold\nwell-known thing\n"
    // one paragraph: no line is a bullet start
    expect(records(raw)).toEqual(["**bold** start\n-5 degrees is cold\nwell-known thing\n"])
  })

  test("multi-line bullet: indented continuation and nested bullets are one record", () => {
    const raw = "## Rules\n- top\n  continued\n  - nested\n    - deeper\n- next\n"
    expect(records(raw)).toEqual(["- top\n  continued\n  - nested\n    - deeper\n", "- next\n"])
    checkInvariants(raw)
  })

  test("lazy continuation line stays with its bullet; a blank line ends it", () => {
    const raw = "## Rules\n- wrapped\nlazy tail\n\n- other\n"
    expect(records(raw)).toEqual(["- wrapped\nlazy tail\n", "- other\n"])
  })

  test("blank line inside an item when the next line is indented", () => {
    const raw = "## Rules\n- item\n\n  second paragraph\n\n- next\n"
    expect(records(raw)).toEqual(["- item\n\n  second paragraph\n", "- next\n"])
    const doc = checkInvariants(raw)
    expect(kinds(doc)).toEqual(["section-header", "record", "blank", "record"])
  })

  test("paragraphs: blank-separated paragraphs are separate records", () => {
    const raw = "## Project context\nFirst para\nsecond line\n\nSecond para\n"
    expect(records(raw)).toEqual(["First para\nsecond line\n", "Second para\n"])
  })

  test("fenced code inside an item keeps the item whole, even with bullets and pipes inside", () => {
    const raw = "## Rules\n- run this\n  ```sh\n  - not a bullet\n  | not a table\n\n  echo hi\n  ```\n- next\n"
    expect(records(raw)).toEqual(["- run this\n  ```sh\n  - not a bullet\n  | not a table\n\n  echo hi\n  ```\n", "- next\n"])
    checkInvariants(raw)
  })

  test("unterminated fence inside an item is noted, not thrown", () => {
    const raw = "## Rules\n- run\n  ```\n  oops\n"
    const doc = checkInvariants(raw)
    expect(listRecords(doc)[0].notes).toEqual(["unterminated-fence"])
  })

  test("blockquote is a record", () => {
    const doc = checkInvariants("## Rules\n> quoted\n> more\n")
    expect(listRecords(doc)[0].notes).toEqual(["blockquote"])
  })
})

describe("non-record content stays verbatim as raw", () => {
  const rawOf = (raw: string) => {
    const doc = checkInvariants(raw)
    return doc.segments.filter((s) => s.kind === "raw")
  }

  test("top-level fenced code (backticks and tildes)", () => {
    expect(rawOf("## Rules\n```\ncode\n```\n")[0].notes).toEqual(["fenced-code"])
    expect(rawOf("## Rules\n~~~~\ncode\n~~~~\n")[0].notes).toEqual(["fenced-code"])
  })

  test("a longer fence is not closed by a shorter one", () => {
    const raws = rawOf("## Rules\n````\n```\nstill code\n```\n````\n- real\n")
    expect(raws).toHaveLength(1)
    expect(raws[0].text).toBe("````\n```\nstill code\n```\n````\n")
  })

  test("unterminated top-level fence runs to the end of the section", () => {
    const raws = rawOf("## Rules\n```\ncode\n## Next\n- ok\n")
    expect(raws[0].notes).toEqual(["fenced-code", "unterminated-fence"])
  })

  test("a '## ' line inside a fence is still a section header (budgeted-read parity)", () => {
    const doc = checkInvariants("## A\n```\n## B\n- x\n```\n")
    expect(doc.segments.filter((s) => s.kind === "section-header").map((s) => s.section)).toEqual(["A", "B"])
  })

  test("table, headings, rule, html comment, orphan indented", () => {
    expect(rawOf("## Rules\n| a | b |\n|---|---|\n| 1 | 2 |\n")[0].notes).toEqual(["table"])
    expect(rawOf("## Rules\n### Sub\n- x\n")[0].notes).toEqual(["subheading"])
    expect(rawOf("## Rules\n# Title\n")[0].notes).toEqual(["heading"])
    expect(rawOf("## Rules\n---\n")[0].notes).toEqual(["rule"])
    expect(rawOf("## Rules\n<!-- note\nmore -->\n")[0].notes).toEqual(["html-comment"])
    expect(rawOf("## Rules\n    code block\n\n    more\n")[0].notes).toEqual(["orphan-indented"])
  })

  test("an unterminated HTML comment only claims its own line; the rest still parses", () => {
    const doc = checkInvariants("## Rules\n<!-- stray\n- a\n- b\n")
    expect(kinds(doc)).toEqual(["section-header", "raw", "record", "record"])
    expect(doc.segments[1].notes).toEqual(["html-comment", "unterminated-comment"])
  })

  test("records after a subheading are still records of the same section", () => {
    const doc = checkInvariants("## Rules\n### Sub\n- x\n- y\n")
    expect(listRecords(doc).map((r) => r.section)).toEqual(["Rules", "Rules"])
  })
})

describe("italic line: structural, same rule as budgeted-read", () => {
  const OLD = "_An older wording of the instruction that no template contains any more._"

  test("current template: each section's instruction is the italic line", () => {
    const doc = checkInvariants(MEMORY_TEMPLATE)
    expect(doc.segments.filter((s) => s.kind === "italic")).toHaveLength(4)
  })

  test("old / unknown first italic line is still the italic line, not a record", () => {
    const doc = checkInvariants("## Rules\n" + OLD + "\n\n- a\n")
    expect(kinds(doc)).toEqual(["section-header", "italic", "blank", "record"])
    expect(listRecords(doc).map((r) => r.text)).toEqual(["- a\n"])
  })

  test("any text qualifies: it is the structure, not the wording", () => {
    for (const line of ["_x_", "_anything at all, even content-like_", "__dunder__", "_"]) {
      const doc = checkInvariants("## Rules\n" + line + "\n- a\n")
      expect(doc.segments[1].kind).toBe("italic")
    }
  })

  test("an ordinary first record that is not italic stays a record", () => {
    const doc = checkInvariants("## Rules\n- a rule\n- another\n")
    expect(kinds(doc)).toEqual(["section-header", "record", "record"])
    expect(doc.segments.some((s) => s.kind === "italic")).toBe(false)
  })

  test("only the FIRST italic line of a section is the italic line; later ones are content", () => {
    const doc = checkInvariants("## Rules\n_first_\n\n_second_\n- a\n")
    expect(doc.segments.filter((s) => s.kind === "italic").map((s) => s.text)).toEqual(["_first_\n"])
    expect(listRecords(doc).map((r) => r.text)).toEqual(["_second_\n", "- a\n"])
  })

  test("the italic line need not be the first non-blank line (reader scans the whole section)", () => {
    const raw = "## Rules\n- a\n\n_emphasis only_\n- b\n"
    const doc = checkInvariants(raw)
    expect(doc.segments.filter((s) => s.kind === "italic").map((s) => s.text)).toEqual(["_emphasis only_\n"])
    expect(parseSections(raw).sections[0].italic).toBe("_emphasis only_")
  })

  test("a lazy italic-looking line right after a bullet is the italic line, not a continuation", () => {
    const raw = "## Rules\n- wrapped\n_note_\n"
    const doc = checkInvariants(raw)
    expect(kinds(doc)).toEqual(["section-header", "record", "italic"])
    expect(parseSections(raw).sections[0].italic).toBe("_note_")
  })

  test("a paragraph is cut at an italic-looking line while the section still has none", () => {
    const doc = checkInvariants("## Rules\ntext\n_note_\nmore\n")
    expect(kinds(doc)).toEqual(["section-header", "record", "italic", "record"])
  })

  test("each section has its own italic line", () => {
    const doc = checkInvariants("## A\n_a_\n- x\n## B\n- y\n_b_\n")
    expect(doc.segments.filter((s) => s.kind === "italic").map((s) => [s.section, s.text.trim()])).toEqual([
      ["A", "_a_"],
      ["B", "_b_"],
    ])
  })

  test("lines that merely contain underscores are not italic", () => {
    const doc = checkInvariants("## Rules\nsnake_case_name\n_leading only\ntrailing only_\n  _indented_\n")
    expect(doc.segments.some((s) => s.kind === "italic")).toBe(false)
  })

  test("documented divergence: CRLF italic is recognised here, the reader's endsWith misses it", () => {
    const raw = "## Rules\r\n_note_\r\n- a\r\n"
    const doc = checkInvariants(raw)
    expect(doc.segments[1].kind).toBe("italic")
    expect(parseSections(raw).sections[0].italic).toBe("")
  })

  describe("CRLF: the structural rule does not depend on the line ending", () => {
    const crlf = (s: string) => s.replace(/\n/g, "\r\n")
    const italicTexts = (raw: string) =>
      checkInvariants(raw)
        .segments.filter((s) => s.kind === "italic")
        .map((s) => s.text.replace(/\r?\n$/, ""))

    test("current template", () => {
      const doc = checkInvariants(crlf(MEMORY_TEMPLATE))
      expect(doc.segments.filter((s) => s.kind === "italic")).toHaveLength(4)
      expect(listRecords(doc)).toHaveLength(0)
    })

    test("old / unknown first italic text", () => {
      expect(italicTexts(crlf("## Rules\n" + OLD + "\n\n- a\n"))).toEqual([OLD])
    })

    test("italic after other records is still the section's first italic", () => {
      const doc = checkInvariants(crlf("## Rules\n- a\n\n_emphasis only_\n- b\n"))
      expect(doc.segments.filter((s) => s.kind === "italic").map((s) => s.text)).toEqual(["_emphasis only_\r\n"])
      expect(listRecords(doc).map((r) => r.text)).toEqual(["- a\r\n", "- b\r\n"])
    })

    test("plain first content stays a record; only the first italic counts", () => {
      const doc = checkInvariants(crlf("## Rules\n- a rule\n\n_first_\n\n_second_\n"))
      expect(kinds(doc)).toEqual(["section-header", "record", "blank", "italic", "blank", "record"])
    })

    test("lazy italic-looking line after a bullet", () => {
      const doc = checkInvariants(crlf("## Rules\n- wrapped\n_note_\n"))
      expect(kinds(doc)).toEqual(["section-header", "record", "italic"])
    })

    test("mixed LF / CRLF in one file", () => {
      const doc = checkInvariants("## Rules\r\n_note_\n- a\r\n")
      expect(kinds(doc)).toEqual(["section-header", "italic", "record"])
    })
  })

  test("documented divergence: an italic-looking line inside fenced code stays code", () => {
    const raw = "## Rules\n```\n_x_\n```\n"
    const doc = checkInvariants(raw)
    expect(doc.segments.some((s) => s.kind === "italic")).toBe(false)
    expect(parseSections(raw).sections[0].italic).toBe("_x_")
  })
})

describe("lossless edge cases", () => {
  const cases: Record<string, string> = {
    empty: "",
    "only newline": "\n",
    "only blanks": "\n\n  \n",
    "no trailing newline": "## Rules\n- a",
    "no trailing newline, template": MEMORY_TEMPLATE.trimEnd(),
    "preamble only": "just text\nmore text\n",
    "header only, no body": "## Rules",
    BOM: "﻿# Project memory\n## Rules\n- a\n",
    "BOM before header": "﻿## Rules\n- a\n",
    "CRLF mixed with LF": "## Rules\r\n- a\r\n- b\n- c\r\n",
    "bare CR": "## Rules\r- a\r",
    "'##' without space is not a header": "##Rules\n- a\n",
    "### is not a section header": "### Rules\n- a\n",
    "duplicate and renamed sections": "## Rules\n- a\n## Rules\n- b\n## Whatever I renamed\n- c\n",
    "trailing spaces and tabs": "## Rules  \n- a  \n\t- tab nested\n",
    "unicode": "## 规则\n- 永远不要强推\n- emoji 🎯 line\n",
  }
  for (const [name, raw] of Object.entries(cases)) {
    test(name, () => {
      checkInvariants(raw)
    })
  }

  test("section name is trimmed and recorded (also for CRLF)", () => {
    const doc = checkInvariants("## Rules  \r\n- a\r\n")
    expect(doc.segments[0].section).toBe("Rules")
    expect(listRecords(doc)[0].section).toBe("Rules")
  })
})

describe("fuzz: any line soup still satisfies the invariants", () => {
  const vocab = [
    "## Rules",
    "## Architecture decisions",
    "##x",
    "### sub",
    "# H1",
    "- item",
    "* item",
    "+ item",
    "1. item",
    "2) item",
    "  continued",
    "    deep code",
    "\tTabbed",
    "  - nested",
    "- [ ] todo",
    "(none yet)",
    "_italic_",
    "_Some instruction wording that no template contains._",
    "snake_case_line",
    "```",
    "~~~",
    "````",
    "```js",
    "> quote",
    "| a | b |",
    "|---|---|",
    "---",
    "***",
    "<!-- c",
    "c -->",
    "plain text line",
    "",
    "",
    "   ",
  ]
  function lcg(seed: number) {
    let s = seed >>> 0
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 0x100000000
    }
  }
  test("2000 random documents", () => {
    const rnd = lcg(20260505)
    for (let n = 0; n < 2000; n++) {
      const len = Math.floor(rnd() * 25)
      const eol = rnd() < 0.2 ? "\r\n" : "\n"
      let raw = ""
      for (let i = 0; i < len; i++) raw += vocab[Math.floor(rnd() * vocab.length)] + eol
      if (rnd() < 0.3) raw = raw.replace(/\r?\n$/, "")
      checkInvariants(raw)
    }
  })
})

/**
 * Stress corpus. NOT real MEMORY.md files: these are the repository's own markdown
 * documents (research reports, specs), chosen because they contain every construct
 * the boundary rules must survive (fences, tables, nested lists, "## " headers).
 * Real MEMORY.md files are checked when ECHO_MEMORY_CORPUS_DIR points at a memory
 * directory (e.g. <data>/memory); that run is read-only.
 */
async function walkMd(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walkMd(p, out)
    else if (e.name.endsWith(".md")) out.push(p)
  }
  return out
}

function summarize(files: { file: string; doc: MemoryDocument; raw: string }[]) {
  let total = 0
  let rawChars = 0
  let recChars = 0
  const rawNotes: Record<string, number> = {}
  for (const f of files) {
    for (const s of f.doc.segments) {
      if (s.kind === "blank") continue
      total += s.text.length
      if (s.kind === "raw") {
        rawChars += s.text.length
        for (const n of s.notes ?? []) rawNotes[n] = (rawNotes[n] ?? 0) + 1
      }
      if (s.kind === "record") recChars += s.text.length
    }
  }
  return { files: files.length, rawShare: total ? rawChars / total : 0, recordShare: total ? recChars / total : 0, rawNotes }
}

describe("corpus round-trip (read-only)", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../../../..")

  test("repository markdown documents (stress corpus, not real MEMORY.md)", async () => {
    const files = [...(await walkMd(path.join(repoRoot, "docs"))), ...(await walkMd(path.join(repoRoot, "MiMo-Code/docs")))]
    if (files.length === 0) {
      console.warn("[record-parse] stress corpus: no docs found, skipped")
      return
    }
    const parsed: { file: string; doc: MemoryDocument; raw: string }[] = []
    for (const file of files) {
      const raw = await Bun.file(file).text()
      parsed.push({ file, raw, doc: checkInvariants(raw) })
    }
    console.log("[record-parse] stress corpus:", JSON.stringify(summarize(parsed)))
  })

  test("real memory directory, when ECHO_MEMORY_CORPUS_DIR is set", async () => {
    const dir = process.env.ECHO_MEMORY_CORPUS_DIR
    if (!dir) {
      console.warn("[record-parse] ECHO_MEMORY_CORPUS_DIR not set: real MEMORY.md corpus NOT checked")
      return
    }
    const files = await walkMd(dir)
    const parsed: { file: string; doc: MemoryDocument; raw: string }[] = []
    for (const file of files) {
      const raw = await Bun.file(file).text()
      parsed.push({ file, raw, doc: checkInvariants(raw) })
    }
    const memoryFiles = parsed.filter((p) => /(^|[\\/])MEMORY\.md$/i.test(p.file))
    console.log("[record-parse] real corpus (all .md):", JSON.stringify(summarize(parsed)))
    console.log("[record-parse] real corpus (MEMORY.md only):", JSON.stringify(summarize(memoryFiles)))
    for (const f of memoryFiles) {
      const c = countByKind(f.doc)
      console.log(`[record-parse] ${f.file}: ${JSON.stringify(c)}`)
    }
  })
})
