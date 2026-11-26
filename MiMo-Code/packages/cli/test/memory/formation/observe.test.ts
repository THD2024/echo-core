import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { T_H_FORMATION_ENABLED, observeFormation, type FormationObserveInput } from "../../../src/memory/formation/observe"
import { readAll } from "../../../src/memory/formation/store"
import type { EvidenceResolver } from "../../../src/memory/formation/evidence"
import type { ProjectID } from "../../../src/project/schema"

// NOTE: Effect-based; needs the workspace dependencies (not runnable in a bare checkout). Native verification: MiMo.

const NOW = 1_700_000_000_000
const PROJECT = "p1" as unknown as ProjectID
const MEM = path.join("/data", "memory", "projects", "p1", "MEMORY.md")
const RET = path.join("/data", "memory", "projects", "p1", "retracted.md")
const BEFORE = "## Facts\n\n- Existing fact <!--m id=a1 at=2026-11-01T00:00:00Z src=u-->\n"
const AFTER = BEFORE + "- Team deploys on Fridays <!--m id=zz at=1999-01-01T00:00:00Z src=u-->\n"
const OK = { info: { role: "assistant", time: { created: NOW + 5 } } }
const resolver: EvidenceResolver = { exists: () => true, quoteMatches: () => true }
const tmpBase = () => fs.mkdtempSync(path.join(os.tmpdir(), "formation-obs-"))

function rig(over: Partial<NonNullable<FormationObserveInput["overrides"]>> = {}, input: Partial<FormationObserveInput> = {}) {
  const files = new Map<string, string>([[MEM, BEFORE], [RET, ""]])
  const reads: string[] = []
  const base = tmpBase()
  const logs: any[] = []
  const full: FormationObserveInput = {
    isDreamCommand: true, source: "command", agentName: "dream", isSubtask: false,
    sessionID: "ses_abc123", projectID: PROJECT, getInstanceProjectID: () => "p1", enabled: true,
    overrides: {
      base, memoryFile: MEM, retractedFile: RET, resolver, readTaskState: () => [], now: () => NOW,
      readText: async (f) => { reads.push(f); return files.get(f) },
      log: { info: (m, e) => logs.push({ m, e }), warn: (m, e) => logs.push({ m, e }) },
      ...over,
    },
    ...input,
  }
  const ledger = () => readAll(base, "p1", () => ({ resolver, memoryRecords: [], retractedRecords: [], taskStateTexts: [] }))
  return { files, reads, base, logs, input: full, ledger }
}
const ranLedger = (base: string) => fs.existsSync(path.join(base, "projects"))

afterEach(() => {})

describe("observeFormation: when it must be a no-op (same Effect object, zero side effects)", () => {
  test("default constant is off", () => expect(T_H_FORMATION_ENABLED).toBe(false))
  test("flag off", () => {
    const r = rig({}, { enabled: false })
    const run = Effect.succeed(OK)
    expect(observeFormation(run, r.input)).toBe(run)
    expect(r.reads).toEqual([])
    expect(ranLedger(r.base)).toBe(false)
  })
  test("not the built-in /dream, subtask, wrong agent/source", () => {
    for (const patch of [{ isDreamCommand: false }, { isSubtask: true }, { agentName: "build" }, { source: "mcp" }] as Partial<FormationObserveInput>[]) {
      const r = rig({}, patch)
      const run = Effect.succeed(OK)
      expect(observeFormation(run, r.input)).toBe(run)
      expect(r.reads).toEqual([])
    }
  })
  test("project guard: instance project missing / global / different", () => {
    for (const p of [undefined, "global", "other"]) {
      const r = rig({}, { getInstanceProjectID: () => p })
      const run = Effect.succeed(OK)
      expect(observeFormation(run, r.input)).toBe(run)
      expect(r.reads).toEqual([])
    }
  })
  test("a throwing guard input returns run unobserved", () => {
    const r = rig({}, { getInstanceProjectID: () => { throw new Error("x") } })
    const run = Effect.succeed(OK)
    expect(observeFormation(run, r.input)).toBe(run)
  })
})

describe("observeFormation: observed runs", () => {
  test("success: result is the SAME value, ledger gets the shadow, MEMORY.md is untouched by formation", async () => {
    const r = rig()
    const run = Effect.sync(() => { r.files.set(MEM, AFTER); return OK })
    const out = await Effect.runPromise(observeFormation(run, r.input))
    expect(out).toBe(OK)
    const l = await r.ledger()
    expect(l.entries.map((e) => e.candidate.content)).toEqual(["Team deploys on Fridays"])
    expect(r.files.get(MEM)).toBe(AFTER)
  })
  test("the dream runs exactly once", async () => {
    const r = rig()
    let n = 0
    const run = Effect.sync(() => { n++; r.files.set(MEM, AFTER); return OK })
    await Effect.runPromise(observeFormation(run, r.input))
    expect(n).toBe(1)
  })
  test("business failure / Esc / stale message => no ledger, result unchanged", async () => {
    for (const result of [
      { info: { role: "assistant", time: { created: NOW + 5 }, error: { name: "APIError" } } },
      { info: { role: "assistant", time: { created: NOW + 5 }, error: { name: "MessageAbortedError" } } },
      { info: { role: "assistant", time: { created: NOW - 5 } } },
    ]) {
      const r = rig()
      const run = Effect.sync(() => { r.files.set(MEM, AFTER); return result })
      expect(await Effect.runPromise(observeFormation(run, r.input))).toBe(result)
      expect(ranLedger(r.base)).toBe(false)
    }
  })
  test("run failure propagates unchanged; no ledger", async () => {
    const r = rig()
    const exit = await Effect.runPromiseExit(observeFormation(Effect.fail("boom" as const), r.input))
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe("boom")
    expect(ranLedger(r.base)).toBe(false)
  })
  test("caller interrupt propagates; no ledger", async () => {
    const r = rig()
    const started = await Effect.runPromise(Deferred.make<void>())
    const run = Effect.gen(function* () {
      yield* Deferred.succeed(started, undefined)
      yield* Effect.never
      return OK
    })
    const fiber = Effect.runFork(observeFormation(run, r.input))
    await Effect.runPromise(Deferred.await(started))
    const exit = await Effect.runPromise(Fiber.interrupt(fiber))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(ranLedger(r.base)).toBe(false)
  })
  test("a throwing/failing before-snapshot leaves the run untouched", async () => {
    const r = rig({ readText: async () => { throw new Error("io") } })
    let n = 0
    const out = await Effect.runPromise(observeFormation(Effect.sync(() => { n++; return OK }), r.input))
    expect(out).toBe(OK)
    expect(n).toBe(1)
    expect(ranLedger(r.base)).toBe(false)
  })
  test("a throwing clock, resolver and logger never alter the result", async () => {
    const r = rig({
      now: () => { throw new Error("clock") },
      resolver: { exists: () => { throw new Error("r") }, quoteMatches: () => { throw new Error("r") } },
      log: { info: () => { throw new Error("l") }, warn: () => { throw new Error("l") } },
    })
    const run = Effect.sync(() => { r.files.set(MEM, AFTER); return OK })
    // The clock throws => startedAt falls back to Date.now(), so OK (created NOW+5 < Date.now()) classifies as stale: no ledger.
    expect(await Effect.runPromise(observeFormation(run, r.input))).toBe(OK)
  })
  test("candidate rejection leaves no ledger directory", async () => {
    const r = rig()
    const run = Effect.sync(() => { r.files.set(MEM, BEFORE + "- key sk-abcdefghijklmnopqrstuv1234\n"); return OK })
    await Effect.runPromise(observeFormation(run, r.input))
    expect(ranLedger(r.base)).toBe(false)
    expect(JSON.stringify(r.logs)).not.toContain("sk-abc")
  })
})
