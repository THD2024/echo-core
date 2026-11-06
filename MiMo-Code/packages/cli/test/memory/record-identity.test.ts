import { describe, expect, test } from "bun:test"
import { stampMemoryRecords } from "@/memory/record-identity"

const options = (ids: string[]) => {
  let i = 0
  return {
    now: "2026-11-06T12:00:00.000Z",
    generateId: () => ids[i++] ?? "fallback" + i,
  }
}

describe("record identity stamping", () => {
  test("stamps every new record with unique id, timestamp and default source", () => {
    const raw = "## Rules\n- alpha\n- beta\n"
    const r = stampMemoryRecords("", raw, options(["aaaaaaaa", "bbbbbbbb"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain("id=aaaaaaaa")
    expect(r.text).toContain("id=bbbbbbbb")
    expect(r.text.match(/at=2026-11-06T12:00:00.000Z/g)?.length).toBe(2)
    expect(r.text.match(/src=i/g)?.length).toBe(2)
  })

  test("preserves id, at and src when marker is removed during an edit", () => {
    const oldText = "## Rules\n- keep this <!--m id=abc123 at=2026-11-05T09:12:00Z src=u-->\n- other <!--m id=def456 at=2026-11-05T09:13:00Z src=i-->\n"
    const newText = "## Rules\n- keep this edited\n- other <!--m id=def456 at=2026-11-05T09:13:00Z src=i-->\n"
    const r = stampMemoryRecords(oldText, newText, options(["newnew11"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain("id=abc123")
    expect(r.text).toContain("at=2026-11-05T09:12:00Z")
    expect(r.text).toContain("src=u")
    expect(r.text).toContain("id=def456")
    expect(r.text).not.toContain("id=newnew11")
  })

  test("keeps an existing complete marker byte-for-byte", () => {
    const raw = "## Rules\n- fact <!--m id=abc123 at=2026-11-05T09:12:00Z src=u-->\n"
    const r = stampMemoryRecords(raw, raw, options(["unused"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe(raw)
  })

  test("rejects malformed metadata without guessing", () => {
    const raw = "## Rules\n- fact <!--m id=bad id=dup-->\n"
    const r = stampMemoryRecords(raw, raw, options(["unused"]))
    expect(r.ok).toBe(false)
    expect(r.text).toBe(raw)
  })

  test("does not inject metadata into non-record segments", () => {
    const raw = "## Rules\n_guide_\n"
    const r = stampMemoryRecords("", raw, options(["unused"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe(raw)
  })

  test("preserves CRLF", () => {
    const raw = "## Rules\r\n- alpha\r\n"
    const r = stampMemoryRecords("", raw, options(["cccccccc"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain("\r\n")
    expect(r.text).toContain("\r\n-")
    expect(r.text).not.toMatch(/(^|[^\r])\n-/)
    expect(r.text).toContain("id=cccccccc")
  })

  test("restores identity for a safely corresponding edited record", () => {
    const oldText = "## Rules\n- existing <!--m id=abc123 at=2026-11-05T09:12:00Z src=u-->\n"
    const newText = "## Rules\n- existing edited\n"
    const r = stampMemoryRecords(oldText, newText, options(["zzzzzzzz"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain("id=abc123")
    expect(r.text).toContain("at=2026-11-05T09:12:00Z")
    expect(r.text).toContain("src=u")
    expect(r.text).not.toContain("id=zzzzzzzz")
  })


  test("does not inherit trust or retraction metadata across unsafe positional pairing", () => {
    const oldText =
      "## Rules\n- OLD user fact <!--m id=oldfact1 at=2026-02-01T00:00:00Z src=u retracted_at=2026-02-01T01:00:00Z retract_reason=incorrect-->\n"
    const newText = "## Rules\n- COMPLETELY UNRELATED model guess\n"
    const r = stampMemoryRecords(oldText, newText, options(["newfact1"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain("id=newfact1")
    expect(r.text).toContain("src=i")
    expect(r.text).toContain("at=2026-11-06T12:00:00.000Z")
    expect(r.text).not.toContain("retracted_at=")
    expect(r.text).not.toContain("retract_reason=")
  })

  test("does not reuse a conflicting existing id", () => {
    const oldText = "## Rules\n- old <!--m id=abc123 at=2026-11-05T09:12:00Z src=u-->\n"
    const newText = "## Rules\n- old edited\n- another <!--m id=abc123 at=2026-11-05T09:13:00Z src=i-->\n"
    const r = stampMemoryRecords(oldText, newText, options(["zzzzzzzz"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain("id=zzzzzzzz")
  })

  test("leaves fenced raw content untouched", () => {
    const raw = "## Rules\n```\n- code\n```\n"
    const r = stampMemoryRecords("", raw, options(["unused"]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe(raw)
  })
})
