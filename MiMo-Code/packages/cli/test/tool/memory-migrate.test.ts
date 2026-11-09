import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as path from "path"
import { Global } from "../../src/global"
import { MemoryMigrateTool } from "../../src/tool/memory-migrate"
import { T_E_MIGRATION_ENABLED } from "../../src/tool/memory-migrate"

describe("T-e migration tool boundary", () => {
  test("production gate is default-off", () => {
    expect(T_E_MIGRATION_ENABLED).toBe(false)
  })
})
