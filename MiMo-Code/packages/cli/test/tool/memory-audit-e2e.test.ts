import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as path from "path"
import { Global } from "../../src/global"
import { auditInvariants, auditProvenance, auditTransition } from "../../src/memory/audit"

const { mergeMemoryRecords } = await import("../../src/tool/memory-merge")
const { retractMemoryRecord } = await import("../../src/tool/memory-retract")

const dataRoot = Global.Path.data
const projectDir = path.join(dataRoot, "memory", "projects", "t-g-test")
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
  return {
    files,
    existsSafe: (file: string) => Effect.succeed(files.has(file)),
    readFileString: (file: string) => {
      const value = files.get(file)
      return value === undefined ? Effect.fail(new Error(`missing file: ${file}`)) : Effect.succeed(value)
    },
    writeWithDirs: (file: string, value: string) => {
      files.set(file, value)
      return Effect.void
    },
  } as any
}

const rec = (id: string, text: string, src = "u") => `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=${src}-->\n`
const S0 = `## Facts\n\n${rec("a1", "Alpha stays here as a fact")}\n${rec("b1", "Beta is another fact", "i")}\n${rec("c1", "Gamma is about deployment")}\n## Notes\n\n${rec("d1", "Delta describes the release process")}`
const allow = () => Effect.void
const state = (fs: any) => ({ S: fs.files.get(sourcePath) as string, R: (fs.files.get(tombstonePath) as string | undefined) ?? "" })
const codes = (f: Array<{ code: string }>) => f.map((x) => x.code)

const merge = (fs: any, over: Record<string, any> = {}) =>
  Effect.runPromise(
    mergeMemoryRecords({
      ctx,
      fs,
      config: { get: () => Effect.succeed({}) },
      filepath: sourcePath,
      dataRoot,
      sourceIds: ["a1", "b1"],
      body: "- Alpha and Beta combined",
      dryRun: false,
      now: "2026-11-14T08:00:00Z",
      assertWriteAllowedFn: allow as any,
      ...over,
    } as any),
  )

const opts = (before?: { S: string; R: string }) => ({ budgetTokens: 10_000, filePath: sourcePath, before })

describe("T-g.1 scripted dream E2E (real merge + retract executors)", () => {
  test("a completed memory_merge leaves a clean audit and all invariants hold", async () => {
    const fs = fakeFs({ [sourcePath]: S0 })
    const before = state(fs)
    await merge(fs)
    const after = state(fs)
    expect(auditTransition(before, after)).toEqual([])
    expect(auditProvenance(after.S, after.R)).toEqual([])
    const report = auditInvariants(after, opts(before))
    expect(report.ok).toBe(true)
    expect(report.findings).toEqual([])
  })

  test("an interrupted merge is exactly one incomplete_merge whose replay input resumes it to a clean state", async () => {
    const fs = fakeFs({ [sourcePath]: S0 })
    const before = state(fs)
    const failB1 = ((arg: any) =>
      arg.recordId === "b1" ? Effect.fail(new Error("interrupted")) : retractMemoryRecord(arg)) as any
    await expect(merge(fs, { retract: failB1 })).rejects.toThrow(/incomplete/)
    const half = state(fs)
    const findings = auditTransition(before, half)
    expect(codes(findings)).toEqual(["incomplete_merge"])
    const replay = findings[0]!.replay!
    expect(replay.pendingSourceIds).toEqual(["b1"])
    expect(auditInvariants(half, opts(before)).recover.ok).toBe(true)

    await merge(fs, { sourceIds: replay.sourceIds, body: replay.body }) // resume with the audit's own replay input
    const done = state(fs)
    expect(auditTransition(before, done)).toEqual([])
    expect(auditInvariants(done, opts(before)).ok).toBe(true)
  })

  test("a direct delete after a completed merge is reported; so is removing a tombstone behind the tools' back", async () => {
    const fs = fakeFs({ [sourcePath]: S0 })
    await merge(fs)
    const merged = state(fs)

    const deleted = { S: merged.S.replace(rec("d1", "Delta describes the release process"), ""), R: merged.R }
    expect(codes(auditTransition(merged, deleted))).toEqual(["unexplained_disappearance"])

    const kept = merged.R.split("\n").filter((line) => !line.includes("id=a1 "))
    const tombLost = { S: merged.S, R: kept.join("\n") }
    const lost = auditTransition(merged, tombLost)
    expect(codes(lost)).toContain("tombstone_lost")
    expect(codes(lost)).not.toContain("unexplained_disappearance")
    expect(codes(auditProvenance(tombLost.S, tombLost.R))).toContain("refs_orphan")
  })

  test("a source copy that reappears next to its tombstone is reported as a double-store with the T-d.3 repair action", async () => {
    const fs = fakeFs({ [sourcePath]: S0 })
    const before = state(fs)
    await merge(fs)
    const done = state(fs)
    // Re-introduce the source copy of a1 while its tombstone exists.
    const double = { S: done.S + rec("a1", "Alpha stays here as a fact"), R: done.R }
    const findings = auditTransition(before, double)
    expect(codes(findings)).toEqual(["retracted_without_tombstone_history"])
    expect(findings[0]!.recovery.action).toBe("repair_double_store")
  })
})
