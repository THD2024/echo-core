import { describe, expect, test } from "bun:test"
import { computeLegacyMigration } from "../../src/memory/legacy-migration"

const filePath = "/memory/projects/p1/MEMORY.md"

function opts(now = "2026-11-09T10:38:00Z") {
  let n = 0
  return {
    now,
    filePath,
    generateId: () => `newfact${++n}`,
  }
}

describe("T-e legacy memory migration", () => {
  test("migrates legacy records and is idempotent", () => {
    const raw = "## Facts\n\n- Alpha\n\n- Beta\n"
    const first = computeLegacyMigration(raw, "", opts())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.report.migratedRecords).toBe(2)
    expect(first.text).toContain("id=newfact1")
    expect(first.text).toContain("src=i")
    expect(first.text).toContain("mig=legacy-v1")
    const second = computeLegacyMigration(first.text, "", opts())
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.report.changed).toBe(false)
    expect(second.text).toBe(first.text)
  })

  test("preserves complete and partial valid metadata", () => {
    const raw = "## Facts\n\n- Full <!--m id=full123 at=2026-11-01T00:00:00Z src=u-->\n\n- Partial <!--m id=part123 src=u-->\n"
    const result = computeLegacyMigration(raw, "", opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.migratedRecords).toBe(1)
    expect(result.report.skippedPartial).toBe(1)
    expect(result.text).toContain("id=part123 src=u-->")
  })

  test("duplicate source IDs reject without changing source", () => {
    const raw = "## Facts\n\n- A <!--m id=same123 at=2026-11-01T00:00:00Z src=i-->\n\n- B <!--m id=same123 at=2026-11-01T00:00:00Z src=i-->\n"
    const result = computeLegacyMigration(raw, "", opts())
    expect(result.ok).toBe(false)
  })

  test("retracted IDs are reserved and never reissued", () => {
    const raw = "## Facts\n\n- Legacy\n"
    const tomb = "## Retracted records\n\n- Old <!--m id=newfact1 at=2026-11-01T00:00:00Z src=i ret=2026-11-02T00:00:00Z why=withdrawn-->\n"
    const result = computeLegacyMigration(raw, tomb, opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).not.toContain("id=newfact1")
    expect(result.text).toContain("id=newfact2")
  })

  test("malformed metadata fails closed", () => {
    const raw = "## Facts\n\n- Bad <!--m id=x at=bad src=i-->\n"
    expect(computeLegacyMigration(raw, "", opts()).ok).toBe(false)
  })

  test("non-record structures are untouched", () => {
    const raw = "# Title\n\n## Facts\n\n| a | b |\n\n- A\n"
    const result = computeLegacyMigration(raw, "", opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain("| a | b |")
    expect(result.text).toContain("- A <!--m")
  })

  test("rejects a migration that reduces complete-visible records", () => {
    const raw = "## Facts\\n\\n" + Array.from({ length: 10 }, (_, i) => `- ${String(i)} ${"A".repeat(100)}\\n`).join("\\n")
    const result = computeLegacyMigration(raw, "", { ...opts(), budgetTokens: 240 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/complete-visible records|new memory truncation/)
  })

  test("second precision and mig are generated only for bootstrap", () => {
    const raw = "## Facts\n\n- A\n"
    const result = computeLegacyMigration(raw, "", opts("2026-11-09T10:38:00Z"))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain("at=2026-11-09T10:38:00Z")
    expect(result.text).toContain("mig=legacy-v1")
  })

  test("preserves CRLF and leaves retracted.md untouched", () => {
    const raw = "## Facts\\r\\n\\r\\n- Legacy\\r\\n"
    const tomb = "## Retracted records\\r\\n\\r\\n- Old <!--m id=old123 at=2026-11-01T00:00:00Z src=i ret=2026-11-02T00:00:00Z why=withdrawn-->\\r\\n"
    const result = computeLegacyMigration(raw, tomb, opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain("\\r\\n")
    expect(result.text).not.toContain("old123")
  })

  test("structure-only budget is reported", () => {
    const raw = "## Facts\n\n- " + "A".repeat(1000) + "\n"
    const result = computeLegacyMigration(raw, "", { ...opts(), budgetTokens: 10 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.afterStructureOnly).toBe(true)
  })
})
