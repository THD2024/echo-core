import { describe, expect, test } from "bun:test"
import { T_E_MIGRATION_ENABLED } from "../../src/tool/memory-migrate"
import { canonicalProjectMemoryPath } from "../../src/memory/legacy-migration"

describe("T-e migration tool boundary", () => {
  test("production gate is default-off", () => {
    expect(T_E_MIGRATION_ENABLED).toBe(false)
  })

  test("only canonical project MEMORY.md is accepted", () => {
    const root = "/data/memory"
    expect(canonicalProjectMemoryPath("/data/memory/projects/p1/MEMORY.md", root)).toBe(
      "/data/memory/projects/p1/MEMORY.md",
    )
    expect(canonicalProjectMemoryPath("/data/memory/MEMORY.md", root)).toBeNull()
    expect(canonicalProjectMemoryPath("/data/memory/projects/p1/sub/MEMORY.md", root)).toBeNull()
    expect(canonicalProjectMemoryPath("/data/memory/projects/p1/MEMORY-copy.md", root)).toBeNull()
  })
})
