import { describe, expect, test } from "bun:test"
import { computeLegacyMigration, formatMigrationReport } from "../../src/memory/legacy-migration"
import { parseMemoryDocument } from "../../src/memory/record-parse"
import { readBudgetedSectionAwareText } from "../../src/session/budgeted-read"

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

  test("preserves complete and partial valid metadata byte-for-byte", () => {
    const raw = "## Facts\n\n- Full <!--m id=full123 at=2026-11-01T00:00:00Z src=u-->\n\n- Partial <!--m id=part123 src=u-->\n"
    const result = computeLegacyMigration(raw, "", opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Partial metadata is never completed (it would desync a record from its tombstone),
    // it is only reported.
    expect(result.report.migratedRecords).toBe(0)
    expect(result.report.skippedPartial).toBe(1)
    expect(result.report.changed).toBe(false)
    expect(result.text).toBe(raw)
  })

  test("partial metadata stays untouched while legacy neighbours are migrated", () => {
    const raw = "## Facts\n\n- Partial <!--m id=part123 src=u-->\n\n- Legacy\n"
    const result = computeLegacyMigration(raw, "", opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.migratedRecords).toBe(1)
    expect(result.report.skippedPartial).toBe(1)
    expect(result.text).toContain("- Partial <!--m id=part123 src=u-->\n")
    expect(result.text).toContain("- Legacy <!--m id=newfact1")
  })

  test("a record whose prose mentions the marker syntax is skipped, not fatal, and stays idempotent", () => {
    const raw = "## Facts\n\n- Marker docs\n  the syntax is <!--m id=x-->\n\n- Plain\n"
    const first = computeLegacyMigration(raw, "", opts())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.report.skippedDiagnostic).toBe(1)
    expect(first.report.migratedRecords).toBe(1)
    expect(first.text).toContain("- Marker docs\n  the syntax is <!--m id=x-->\n")
    expect(first.text).toContain("- Plain <!--m id=newfact1")
    const second = computeLegacyMigration(first.text, "", opts())
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.report.changed).toBe(false)
    expect(second.report.skippedDiagnostic).toBe(1)
    expect(second.text).toBe(first.text)
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

  // Pipeline used by both the guard and these fixtures: deductRetracted -> readBudgetedSectionAwareText.
  function visibleRecords(text: string, budget: number) {
    const out = readBudgetedSectionAwareText(text, budget, filePath)
    const records = parseMemoryDocument(text).segments.filter((segment) => segment.kind === "record")
    return {
      truncated: out.truncated,
      complete: records.filter((record) => out.text.includes(record.text)).length,
      // What a naive "re-parse the injected text and count records" would report.
      naive: parseMemoryDocument(out.text).segments.filter((segment) => segment.kind === "record").length,
    }
  }

  function padIds() {
    let n = 0
    return () => `new${String(++n).padStart(5, "0")}`
  }

  test("complete-visible guard does not count a cut-off record (naive count would pass)", () => {
    const raw = "## Facts\n\n" + Array.from({ length: 10 }, (_, i) => `- ${i} ${"A".repeat(150)}\n`).join("\n")
    const budgetTokens = 125

    // Precondition that makes this the M1 counterexample: counting records in the injected
    // text is equal before and after, yet the number of *complete* records drops.
    const unbounded = computeLegacyMigration(raw, "", { ...opts(), generateId: padIds(), budgetTokens: 1_000_000 })
    expect(unbounded.ok).toBe(true)
    if (!unbounded.ok) return
    const before = visibleRecords(raw, budgetTokens)
    const after = visibleRecords(unbounded.text, budgetTokens)
    expect(before.truncated).toBe(true)
    expect(after.naive).toBe(before.naive)
    expect(after.complete).toBeLessThan(before.complete)

    const result = computeLegacyMigration(raw, "", { ...opts(), generateId: padIds(), budgetTokens })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/complete-visible records would decrease \(3 -> 2;/)
    expect(result.error).toContain(`budget=${budgetTokens}`)
    expect(result.error).toMatch(/Trim about \d+ tokens from MEMORY\.md, then retry\./)
  })

  test("rejects newly introduced truncation when the old document fit", () => {
    const raw = "## Facts\n\n" + Array.from({ length: 10 }, (_, i) => `- ${i} ${"A".repeat(100)}\n`).join("\n")
    const total = readBudgetedSectionAwareText(raw, 1_000_000, filePath).totalTokens
    const result = computeLegacyMigration(raw, "", { ...opts(), budgetTokens: total })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/introduce new memory truncation/)
    expect(result.error).toMatch(/Trim about \d+ tokens/)
  })

  test("allows already-truncated memory when complete-visible records do not decrease", () => {
    // Small records come first; the oversized last record is what overflows the budget, so the
    // extra metadata tokens do not push any complete record out of the injected text.
    const raw = "## Facts\n\n- a\n\n- b\n\n- c\n\n- " + "B".repeat(4000) + "\n"
    const result = computeLegacyMigration(raw, "", { ...opts(), budgetTokens: 200 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.beforeTruncated).toBe(true)
    expect(result.report.afterTruncated).toBe(true)
    expect(result.report.afterCompleteVisibleRecords).toBeGreaterThanOrEqual(result.report.beforeCompleteVisibleRecords)
    expect(result.report.beforeCompleteVisibleRecords).toBeGreaterThan(0)
    expect(result.report.changed).toBe(true)
    expect(result.report.budgetTokens).toBe(200)
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
    const raw = "## Facts\r\n\r\n- Legacy\r\n"
    const tomb = "## Retracted records\r\n\r\n- Old <!--m id=old123 at=2026-11-01T00:00:00Z src=i ret=2026-11-02T00:00:00Z why=withdrawn-->\r\n"
    const result = computeLegacyMigration(raw, tomb, opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain("\r\n")
    expect(result.text).not.toContain("old123")
  })

  test("structure-only budget is reported", () => {
    const raw = "## Facts\n\n- " + "A".repeat(1000) + "\n"
    const result = computeLegacyMigration(raw, "", { ...opts(), budgetTokens: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.beforeStructureOnly).toBe(true)
    expect(result.report.afterStructureOnly).toBe(true)
    expect(result.report.beforeCompleteVisibleRecords).toBe(0)
    expect(result.report.afterCompleteVisibleRecords).toBe(0)
  })

  test("model-visible report carries budget, truncation and skip counts", () => {
    const raw = "## Facts\n\n- Partial <!--m id=part123 src=u-->\n\n- Legacy\n"
    const result = computeLegacyMigration(raw, "", opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = formatMigrationReport(result.report, { dryRun: true, written: false })
    expect(text).toContain("dry-run")
    expect(text).toContain("no file was written")
    expect(text).toContain("skippedPartial=1")
    expect(text).toContain("skippedDiagnostic=0")
    expect(text).toContain("budget=10000 tokens")
    expect(text).toContain("complete-visible records: before=")
    expect(text).toContain("not evidence of model inference")
    expect(formatMigrationReport(result.report, { dryRun: false, written: true })).toContain("completed")
    expect(formatMigrationReport({ ...result.report, changed: false }, { dryRun: false, written: false })).toContain(
      "already converged",
    )
  })
})
