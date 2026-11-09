import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as path from "path"
import { Global } from "../../src/global"
import { DEFAULT_MEMORY_BUDGET_TOKENS } from "../../src/session/budgeted-read"
import { canonicalProjectMemoryPath } from "../../src/memory/legacy-migration"

const { migrateLegacyMemory, T_E_MIGRATION_ENABLED } = await import("../../src/tool/memory-migrate")

const dataRoot = Global.Path.data
const projectDir = path.join(dataRoot, "memory", "projects", "t-e-test")
const sourcePath = path.join(projectDir, "MEMORY.md")
const tombstonePath = path.join(projectDir, "retracted.md")

const ctx = {
  agent: "build",
  sessionID: "test-session",
  messageID: "test-message",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} as any

function fakeFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial))
  const reads: string[] = []
  const writes: string[] = []
  return {
    files,
    reads,
    writes,
    existsSafe: (file: string) => Effect.succeed(files.has(file)),
    readFileString: (file: string) => {
      reads.push(file)
      const value = files.get(file)
      if (value === undefined) return Effect.fail(new Error(`missing file: ${file}`))
      return Effect.succeed(value)
    },
    writeWithDirs: (file: string, value: string) => {
      writes.push(file)
      files.set(file, value)
      return Effect.void
    },
  } as any
}

function fakeConfig(memory?: number) {
  return {
    get: () => Effect.succeed(memory === undefined ? {} : { checkpoint: { push_caps: { memory } } }),
  }
}

const allowGate = () => Effect.void
const legacy = "## Facts\n\n- Alpha\n\n- Beta\n"
let counter = 0
const input = (over: Record<string, any> = {}): any => {
  counter = 0
  return {
    ctx,
    fs: undefined as any,
    config: fakeConfig(),
    filepath: sourcePath,
    dataRoot,
    dryRun: false,
    now: "2026-11-09T10:38:00Z",
    generateId: () => `newfact${++counter}`,
    assertWriteAllowedFn: allowGate as any,
    ...over,
  }
}

describe("T-e migration executor", () => {
  test("production gate is default-off", () => {
    expect(T_E_MIGRATION_ENABLED).toBe(false)
  })

  test("migrates legacy records, writes only MEMORY.md and never creates retracted.md", async () => {
    const fs = fakeFs({ [sourcePath]: legacy })
    const result = await Effect.runPromise(migrateLegacyMemory({ ...input(), fs }))
    expect(result.written).toBe(true)
    expect(result.report.migratedRecords).toBe(2)
    expect(fs.files.get(sourcePath)).toContain("- Alpha <!--m id=newfact1 at=2026-11-09T10:38:00Z src=i mig=legacy-v1-->")
    expect(fs.writes).toEqual([sourcePath])
    expect(fs.files.has(tombstonePath)).toBe(false)
    expect(result.output).toContain("completed")
  })

  test("an existing retracted.md is read for reserved IDs but left byte-identical", async () => {
    const tomb = `## Retracted records\n\n- Old <!--m id=newfact1 at=2026-11-01T00:00:00Z src=i ret=2026-11-02T00:00:00Z why=withdrawn-->\n`
    const fs = fakeFs({ [sourcePath]: legacy, [tombstonePath]: tomb })
    await Effect.runPromise(migrateLegacyMemory({ ...input(), fs }))
    expect(fs.files.get(tombstonePath)).toBe(tomb)
    expect(fs.writes).toEqual([sourcePath])
    expect(fs.files.get(sourcePath)).not.toContain("id=newfact1")
    expect(fs.files.get(sourcePath)).toContain("id=newfact2")
  })

  test("dry_run reports the same computation but writes nothing", async () => {
    const real = fakeFs({ [sourcePath]: legacy })
    const dry = fakeFs({ [sourcePath]: legacy })
    const realResult = await Effect.runPromise(migrateLegacyMemory({ ...input(), fs: real }))
    const dryResult = await Effect.runPromise(migrateLegacyMemory({ ...input({ dryRun: true }), fs: dry }))
    expect(dry.writes).toEqual([])
    expect(dry.files.get(sourcePath)).toBe(legacy)
    expect(dryResult.written).toBe(false)
    expect(dryResult.report).toEqual(realResult.report)
    expect(dryResult.output).toContain("dry-run")
  })

  test("second run is already converged and does not write", async () => {
    const fs = fakeFs({ [sourcePath]: legacy })
    await Effect.runPromise(migrateLegacyMemory({ ...input(), fs }))
    const converged = fs.files.get(sourcePath)
    fs.writes.length = 0
    const second = await Effect.runPromise(migrateLegacyMemory({ ...input(), fs }))
    expect(second.written).toBe(false)
    expect(second.report.changed).toBe(false)
    expect(fs.writes).toEqual([])
    expect(fs.files.get(sourcePath)).toBe(converged)
    expect(second.output).toContain("already converged")
  })

  test("write gate rejection (including dry_run) fails before any read or write", async () => {
    const denyGate = () => Effect.fail(new Error("Memory WRITING is disabled"))
    for (const dryRun of [false, true]) {
      const fs = fakeFs({ [sourcePath]: legacy })
      await expect(
        Effect.runPromise(migrateLegacyMemory({ ...input({ dryRun, assertWriteAllowedFn: denyGate as any }), fs })),
      ).rejects.toThrow(/disabled/)
      expect(fs.reads).toEqual([])
      expect(fs.writes).toEqual([])
      expect(fs.files.get(sourcePath)).toBe(legacy)
    }
  })

  test("CAS: a source change between compute and write aborts without writing", async () => {
    const fs = fakeFs({ [sourcePath]: legacy })
    const originalRead = fs.readFileString
    let sourceReads = 0
    fs.readFileString = (file: string) => {
      if (file === sourcePath) {
        sourceReads += 1
        if (sourceReads >= 2) return Effect.succeed(legacy + "\n- Concurrent edit\n")
      }
      return originalRead(file)
    }
    await expect(Effect.runPromise(migrateLegacyMemory({ ...input(), fs }))).rejects.toThrow(/CAS mismatch/)
    expect(fs.writes).toEqual([])
    expect(fs.files.get(sourcePath)).toBe(legacy)
  })

  test("budget cap comes from Config and falls back to the shared default", async () => {
    const withCap = await Effect.runPromise(
      migrateLegacyMemory({ ...input({ dryRun: true, config: fakeConfig(123) }), fs: fakeFs({ [sourcePath]: legacy }) }),
    )
    expect(withCap.report.budgetTokens).toBe(123)
    const fallback = await Effect.runPromise(
      migrateLegacyMemory({ ...input({ dryRun: true }), fs: fakeFs({ [sourcePath]: legacy }) }),
    )
    expect(fallback.report.budgetTokens).toBe(DEFAULT_MEMORY_BUDGET_TOKENS)
  })

  test("a Config cap that the added metadata would exceed refuses without writing", async () => {
    const fs = fakeFs({ [sourcePath]: legacy })
    // `legacy` is ~7 tokens; migrated it is far larger than a 10 token cap that it fit before.
    await expect(
      Effect.runPromise(migrateLegacyMemory({ ...input({ config: fakeConfig(10) }), fs })),
    ).rejects.toThrow(/new memory truncation \(budget=10/)
    expect(fs.writes).toEqual([])
    expect(fs.files.get(sourcePath)).toBe(legacy)
  })

  test("non-canonical paths are rejected before the gate runs", async () => {
    let gateCalls = 0
    const countingGate = () => {
      gateCalls += 1
      return Effect.void
    }
    const bad = [
      path.join(dataRoot, "memory", "global", "MEMORY.md"),
      path.join(dataRoot, "memory", "projects", "t-e-test", "sub", "MEMORY.md"),
      path.join(dataRoot, "memory", "projects", "t-e-test", "MEMORY-topic.md"),
      path.join(dataRoot, "memory", "projects", "t-e-test", "retracted.md"),
    ]
    for (const filepath of bad) {
      const fs = fakeFs({ [filepath]: legacy })
      await expect(
        Effect.runPromise(migrateLegacyMemory({ ...input({ filepath, assertWriteAllowedFn: countingGate as any }), fs })),
      ).rejects.toThrow(/fail-closed/)
      expect(fs.writes).toEqual([])
    }
    expect(gateCalls).toBe(0)
  })
})

describe("T-e canonical project path", () => {
  const root = path.resolve("/data-root")
  const ok = path.join(root, "memory", "projects", "p1", "MEMORY.md")

  test("only projects/<pid>/MEMORY.md is canonical", () => {
    expect(canonicalProjectMemoryPath(ok, root)).toBe(ok)
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "MEMORY.md"), root)).toBeNull()
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "global", "MEMORY.md"), root)).toBeNull()
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "projects", "p1", "sub", "MEMORY.md"), root)).toBeNull()
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "projects", "p1", "MEMORY-topic.md"), root)).toBeNull()
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "projects", "p1", "retracted.md"), root)).toBeNull()
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "projects", "MEMORY.md"), root)).toBeNull()
  })

  test("a relative path with .. that escapes the projects root is rejected", () => {
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "projects", "..", "MEMORY.md"), root)).toBeNull()
    expect(canonicalProjectMemoryPath(path.join(root, "memory", "projects", "p1", "..", "..", "x", "MEMORY.md"), root)).toBeNull()
  })

  const onWindows = process.platform === "win32" ? test : test.skip
  onWindows("another drive root and UNC paths are rejected, drive letter case is ignored", () => {
    const winRoot = "C:\\data"
    const winOk = "C:\\data\\memory\\projects\\p1\\MEMORY.md"
    expect(canonicalProjectMemoryPath(winOk, winRoot)).toBe(winOk)
    expect(canonicalProjectMemoryPath("c:\\DATA\\memory\\projects\\p1\\MEMORY.md", winRoot)).not.toBeNull()
    expect(canonicalProjectMemoryPath("D:\\MEMORY.md", winRoot)).toBeNull()
    expect(canonicalProjectMemoryPath("D:\\p1\\MEMORY.md", winRoot)).toBeNull()
    expect(canonicalProjectMemoryPath("\\\\server\\share\\MEMORY.md", winRoot)).toBeNull()
  })
})
