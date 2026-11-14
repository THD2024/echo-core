import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as path from "path"
import { Global } from "../../src/global"
import { DEFAULT_MEMORY_BUDGET_TOKENS } from "../../src/session/budgeted-read"
import { deriveMergeId } from "../../src/memory/merge"
import { parseMemoryDocument } from "../../src/memory/record-parse"
import { readRecordMeta } from "../../src/memory/record-meta"

const { mergeMemoryRecords, T_F_MERGE_ENABLED } = await import("../../src/tool/memory-merge")
const { retractMemoryRecord } = await import("../../src/tool/memory-retract")
const { T_C_RETRACT_ENABLED } = await import("../../src/tool/retract")
const { T_E_MIGRATION_ENABLED } = await import("../../src/tool/memory-migrate")

const dataRoot = Global.Path.data
const projectDir = path.join(dataRoot, "memory", "projects", "t-f-test")
const sourcePath = path.join(projectDir, "MEMORY.md")
const tombstonePath = path.join(projectDir, "retracted.md")

const ctx = {
  agent: "dream",
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
  const snapshots: Array<{ file: string; source: string | undefined }> = []
  return {
    files,
    reads,
    writes,
    snapshots,
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
      snapshots.push({ file, source: files.get(sourcePath) })
      return Effect.void
    },
  } as any
}

const fakeConfig = (memory?: number) => ({
  get: () => Effect.succeed(memory === undefined ? {} : { checkpoint: { push_caps: { memory } } }),
})

const NOW = "2026-11-14T08:00:00Z"
const rec = (id: string, text: string, src = "u") => `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=${src}-->\n`
const S = `## Facts\n\n${rec("a1", "Alpha", "u")}\n${rec("b1", "Beta", "i")}\n${rec("c1", "Gamma", "u")}`
const BODY = "- Alpha and Beta combined"
const MERGE_ID = deriveMergeId(["a1", "b1"])
const allowGate = () => Effect.void

const input = (over: Record<string, any> = {}): any => ({
  ctx,
  fs: undefined as any,
  config: fakeConfig(),
  filepath: sourcePath,
  dataRoot,
  sourceIds: ["b1", "a1"],
  body: BODY,
  dryRun: false,
  now: NOW,
  assertWriteAllowedFn: allowGate as any,
  ...over,
})

const run = (fs: any, over: Record<string, any> = {}) => Effect.runPromise(mergeMemoryRecords(input({ fs, ...over })))
const idsOf = (text: string) =>
  parseMemoryDocument(text)
    .segments.filter((s) => s.kind === "record")
    .map((s) => readRecordMeta(s).meta.record_id)
    .filter(Boolean)

function spyRetract(fs: any, failOn?: string, realBefore = false) {
  const calls: Array<{ id: string; reason: string; mInSource: boolean; sourceStillThere: boolean; gate: unknown }> = []
  const retract = ((arg: any) => {
    const source = fs.files.get(sourcePath) ?? ""
    calls.push({
      id: arg.recordId,
      reason: arg.reason,
      mInSource: source.includes(`id=${MERGE_ID}`),
      sourceStillThere: source.includes(`id=${arg.recordId} `),
      gate: arg.assertWriteAllowedFn,
    })
    if (arg.recordId === failOn) return Effect.fail(new Error("injected retract failure"))
    return realBefore ? retractMemoryRecord(arg) : Effect.succeed({ alreadyConverged: false })
  }) as any
  return { calls, retract }
}

describe("T-f merge executor", () => {
  test("all three exposure flags are default-off and independent", () => {
    expect(T_F_MERGE_ENABLED).toBe(false)
    expect(T_C_RETRACT_ENABLED).toBe(false)
    expect(T_E_MIGRATION_ENABLED).toBe(false)
  })

  test("end to end with the real retract: M once, sources superseded in retracted.md, others untouched", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    const result = await run(fs)
    expect(result.written).toBe(true)
    expect(result.retracted).toEqual(["a1", "b1"])
    const source = fs.files.get(sourcePath)!
    expect(idsOf(source).sort()).toEqual([MERGE_ID, "c1"].sort())
    expect(source).toContain("Gamma")
    const tomb = fs.files.get(tombstonePath)!
    expect(idsOf(tomb).sort()).toEqual(["a1", "b1"])
    expect(tomb.match(/why=superseded/g)).toHaveLength(2)
    expect(source).toContain(`refs=a1,b1`)
    expect(result.output).toContain("completed")
  })

  test("Phase A strictly precedes Phase B: M is written before the first retract and sources are still present then", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    const spy = spyRetract(fs, undefined, true) // delegate to the real retract so the run converges
    await run(fs, { retract: spy.retract })
    expect(fs.writes[0]).toBe(sourcePath)
    expect(fs.snapshots[0]!.source).toContain(`id=${MERGE_ID}`)
    expect(fs.snapshots[0]!.source).toContain("id=a1 ")
    expect(spy.calls.map((c) => c.id)).toEqual(["a1", "b1"])
    for (const call of spy.calls) {
      expect(call.reason).toBe("superseded")
      expect(call.mInSource).toBe(true)
      expect(call.gate).toBe(allowGate)
    }
    // Only Phase A (the first write) is the executor's own; everything after goes through retract.
    expect(fs.writes.filter((w) => w === sourcePath).length).toBeGreaterThanOrEqual(3)
  })

  test("a Phase B failure keeps M and reports what is pending; re-running resumes and converges", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    const spy = spyRetract(fs, "b1", true)
    await expect(run(fs, { retract: spy.retract })).rejects.toThrow(/incomplete[\s\S]*Superseded so far: a1[\s\S]*Still pending: b1/)
    // Half-way: M present, a1 superseded, b1 still in MEMORY.md.
    const half = fs.files.get(sourcePath)!
    expect(idsOf(half)).toContain(MERGE_ID)
    expect(idsOf(half)).toContain("b1")
    expect(idsOf(half)).not.toContain("a1")
    expect(idsOf(fs.files.get(tombstonePath)!)).toEqual(["a1"])

    const result = await run(fs) // real retract, same input
    expect(result.report.mode).toBe("resume")
    expect(result.written).toBe(false)
    expect(result.retracted).toEqual(["b1"])
    expect(idsOf(fs.files.get(sourcePath)!).sort()).toEqual([MERGE_ID, "c1"].sort())
    expect(idsOf(fs.files.get(tombstonePath)!).sort()).toEqual(["a1", "b1"])
  })

  test("resuming with a different body is refused as a collision and writes nothing", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    await expect(run(fs, { retract: spyRetract(fs, "a1").retract })).rejects.toThrow(/incomplete/)
    const before = fs.files.get(sourcePath)
    fs.writes.length = 0
    await expect(run(fs, { body: "- A different merged text" })).rejects.toThrow(/different content/)
    expect(fs.writes).toEqual([])
    expect(fs.files.get(sourcePath)).toBe(before)
  })

  test("a second identical run after convergence changes nothing and does not call retract", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    await run(fs)
    const snapshot = [fs.files.get(sourcePath), fs.files.get(tombstonePath)]
    fs.writes.length = 0
    const spy = spyRetract(fs)
    const again = await run(fs, { retract: spy.retract })
    expect(again.report.mode).toBe("converged")
    expect(again.written).toBe(false)
    expect(again.retracted).toEqual([])
    expect(spy.calls).toEqual([])
    expect(fs.writes).toEqual([])
    expect([fs.files.get(sourcePath), fs.files.get(tombstonePath)]).toEqual(snapshot)
  })

  test("dry_run reports the plan, writes nothing and never calls retract", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    const spy = spyRetract(fs)
    const result = await run(fs, { dryRun: true, retract: spy.retract })
    expect(result.written).toBe(false)
    expect(result.report.mode).toBe("fresh")
    expect(result.output).toContain("dry-run")
    expect(fs.writes).toEqual([])
    expect(spy.calls).toEqual([])
    expect(fs.files.get(sourcePath)).toBe(S)
  })

  test("gate rejection (also for dry_run) fails before any read or write", async () => {
    for (const dryRun of [false, true]) {
      const fs = fakeFs({ [sourcePath]: S })
      const spy = spyRetract(fs)
      const deny = () => Effect.fail(new Error("Memory WRITING is disabled"))
      await expect(run(fs, { dryRun, assertWriteAllowedFn: deny, retract: spy.retract })).rejects.toThrow(/disabled/)
      expect(fs.reads).toEqual([])
      expect(fs.writes).toEqual([])
      expect(spy.calls).toEqual([])
    }
  })

  test("a CAS mismatch between plan and Phase A refuses without writing or retracting", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    const original = fs.readFileString
    let sourceReads = 0
    fs.readFileString = (file: string) => {
      if (file === sourcePath && ++sourceReads === 2) return Effect.succeed(S + "\n- sneaky concurrent edit\n")
      return original(file)
    }
    const spy = spyRetract(fs)
    await expect(run(fs, { retract: spy.retract })).rejects.toThrow(/CAS mismatch/)
    expect(fs.writes).toEqual([])
    expect(spy.calls).toEqual([])
  })

  test("ineligible input fails closed with zero writes (missing source, retracted source, legacy source)", async () => {
    const cases: Array<Record<string, string>> = [
      { [sourcePath]: `## Facts\n\n${rec("a1", "Alpha")}` }, // b1 missing
      { [sourcePath]: S, [tombstonePath]: `## Retracted records\n\n- B <!--m id=b1 at=2026-11-01T00:00:00Z src=i ret=2026-11-13T00:00:00Z why=superseded-->\n` },
      { [sourcePath]: `## Facts\n\n- legacy line\n\n${rec("b1", "Beta")}` },
    ]
    for (const files of cases) {
      const fs = fakeFs(files)
      const spy = spyRetract(fs)
      await expect(run(fs, { retract: spy.retract })).rejects.toThrow(/Merge refused/)
      expect(fs.writes).toEqual([])
      expect(spy.calls).toEqual([])
    }
  })

  test("overlapping merge after a completed one is refused", async () => {
    const fs = fakeFs({ [sourcePath]: S })
    await run(fs)
    fs.writes.length = 0
    await expect(run(fs, { sourceIds: ["a1", "c1"], body: "- other" })).rejects.toThrow(/Merge refused/)
    expect(fs.writes).toEqual([])
  })

  test("the memory budget cap comes from Config, with the shared default as fallback", async () => {
    const dry = fakeFs({ [sourcePath]: S })
    const fallback = await run(dry, { dryRun: true })
    expect(fallback.report.budgetTokens).toBe(DEFAULT_MEMORY_BUDGET_TOKENS)
    const small = fakeFs({ [sourcePath]: S })
    await expect(run(small, { config: fakeConfig(10) })).rejects.toThrow(/budget=10/)
    expect(small.writes).toEqual([])
  })

  test("non-canonical paths are rejected before the gate and before any read", async () => {
    const bad = [
      path.join(dataRoot, "memory", "global", "MEMORY.md"),
      path.join(projectDir, "nested", "MEMORY.md"),
      tombstonePath,
      path.join(projectDir, "NOTES.md"),
      path.join(dataRoot, "elsewhere", "projects", "p", "MEMORY.md"),
    ]
    for (const filepath of bad) {
      const fs = fakeFs({ [filepath]: S })
      let gateCalls = 0
      const gate = () => ((gateCalls += 1), Effect.void)
      await expect(run(fs, { filepath, assertWriteAllowedFn: gate })).rejects.toThrow(/fail-closed/)
      expect(gateCalls).toBe(0)
      expect(fs.reads).toEqual([])
      expect(fs.writes).toEqual([])
    }
  })
})
