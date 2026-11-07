import { describe, expect, test } from "bun:test"
import { deductRetracted } from "../../src/memory/retract-view"

const tomb = (body: string, id: string, reason = "withdrawn") =>
  `- ${body} <!--m id=${id} at=2026-11-07T10:00:00Z src=u ret=2026-11-07T10:01:00Z why=${reason}-->`

describe("deductRetracted", () => {
  test("removes an active record when source and tombstone coexist", () => {
    const source = [
      "## Knowledge",
      "_instruction_",
      "",
      "- keep this <!--m id=keep01 at=2026-11-07T09:00:00Z src=u-->",
      "- remove this <!--m id=drop01 at=2026-11-07T09:01:00Z src=u-->",
      "- keep this too <!--m id=keep02 at=2026-11-07T09:02:00Z src=i-->",
      "",
    ].join("\n")
    const result = deductRetracted(source, `## Retracted records\n\n${tomb("removed history", "drop01")}\n`)
    expect(result.text).not.toContain("remove this")
    expect(result.text).toContain("keep this")
    expect(result.text).toContain("keep this too")
    expect(result.deducted).toEqual(["drop01"])
  })

  test("hides by id even when the active body changed after phase one", () => {
    const source = "## Knowledge\n_instruction_\n\n- changed body <!--m id=drop02 at=2026-11-07T09:00:00Z src=i-->\n"
    const result = deductRetracted(source, `## Retracted records\n\n${tomb("original body", "drop02")}\n`)
    expect(result.text).not.toContain("changed body")
    expect(result.deducted).toEqual(["drop02"])
  })

  test("ignores malformed tombstones without hiding unrelated active records", () => {
    const source = "## Knowledge\n_instruction_\n\n- keep <!--m id=keep03 at=2026-11-07T09:00:00Z src=u-->\n"
    const malformed = "## Retracted records\n\n- broken <!--m id=drop03 ret=bad why=withdrawn-->\n"
    const result = deductRetracted(source, malformed)
    expect(result.text).toBe(source)
    expect(result.deducted).toEqual([])
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  test("hides a malformed source carrier when its exact retracted id survives in the marker", () => {
    const source = "## Knowledge\n_instruction_\n\n- broken carrier <!--m id=drop06 ret=bad why=withdrawn-->\n"
    const result = deductRetracted(
      source,
      `## Retracted records\n\n${tomb("removed", "drop06")}\n`,
    )
    expect(result.text).not.toContain("broken carrier")
    expect(result.deducted).toEqual(["drop06"])
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  test("does not subtract records without a valid tombstone", () => {
    const source = "## Knowledge\n_instruction_\n\n- active <!--m id=keep04 at=2026-11-07T09:00:00Z src=u-->\n"
    const result = deductRetracted(source, "")
    expect(result.text).toBe(source)
    expect(result.deducted).toEqual([])
  })

  test("preserves CRLF for the surviving source bytes", () => {
    const source = "## Knowledge\r\n_instruction_\r\n\r\n- keep <!--m id=keep05 at=2026-11-07T09:00:00Z src=u-->\r\n- drop <!--m id=drop05 at=2026-11-07T09:01:00Z src=u-->\r\n"
    const result = deductRetracted(source, `## Retracted records\r\n\r\n${tomb("removed", "drop05")}\r\n`)
    expect(result.text).not.toContain("drop <!--m id=drop05")
    expect(result.text).toContain("\r\n")
  })
})
