import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { dbResolver } from "../../../src/memory/formation/evidence-db"

// Only the `file_range` branch (fs only, no DB access) is exercised here; the DB-backed branches are covered by the N2 harness.
describe("evidence-db: resolver contract (never throws)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "formation-ev-"))
  fs.writeFileSync(path.join(root, "note.txt"), "line1\nline2\nline3\n")
  const r = dbResolver({ worktree: root })
  const range = (p: string, s: number, e: number) => ({ type: "file_range" as const, path: p, start_line: s, end_line: e })

  test("an existing in-worktree file with a valid range exists", () => {
    expect(r.exists(range("note.txt", 1, 2))).toBe(true)
  })
  test("missing file, out-of-range, traversal, absolute outside, directory => false and NEVER throw", () => {
    for (const e of [
      range("missing.txt", 1, 1),
      range("note.txt", 1, 99),
      range("../outside.txt", 1, 1),
      range(path.join(os.tmpdir(), "formation-nonexistent-x", "a.txt"), 1, 1),
      range(".", 1, 1),
    ]) {
      expect(() => r.exists(e)).not.toThrow()
      expect(r.exists(e)).toBe(false)
    }
  })
  test("no worktree => false", () => {
    expect(dbResolver({}).exists(range("note.txt", 1, 1))).toBe(false)
  })
})
