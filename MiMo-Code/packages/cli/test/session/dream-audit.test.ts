import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import * as path from "path"
import { auditInvariants } from "../../src/memory/audit"
import { computeMerge } from "../../src/memory/merge"
import {
  OBSERVER_STEP_TIMEOUT_MS,
  SNAPSHOT_MAX_BYTES,
  T_G_AUDIT_ENABLED,
  autoDreamAuditDeps,
  observeDreamRun,
  resolveSnapshotPaths,
} from "../../src/session/dream-audit"
import { DEFAULT_MEMORY_BUDGET_TOKENS } from "../../src/session/budgeted-read"
import { memoryPath } from "../../src/session/checkpoint-paths"

const FILE = path.join("/data", "memory", "projects", "p1", "MEMORY.md")
const TOMB = path.join("/data", "memory", "projects", "p1", "retracted.md")
const NOW = 1_700_000_000_000

const rec = (id: string, text: string, src = "u") => `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=${src}-->\n`
const S0 = `## Facts\n\n${rec("a1", "Alpha stays here as a fact")}\n${rec("b1", "Beta is another fact", "i")}\n${rec("c1", "Gamma is about deployment")}\n## Notes\n\n${rec("d1", "Delta describes the release process")}`

function world(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial))
  const reads: string[] = []
  return {
    files,
    reads,
    readText: async (file: string) => {
      reads.push(file)
      return files.get(file)
    },
  }
}

type Event = { level: "info" | "warn"; message: string; extra: any }
function sink(opts: { throws?: boolean } = {}) {
  const events: Event[] = []
  const push = (level: Event["level"]) => (message: string, extra?: Record<string, unknown>) => {
    if (opts.throws) throw new Error("log sink exploded")
    events.push({ level, message, extra })
  }
  return { events, log: { info: push("info"), warn: push("warn") } }
}

const run = <A, E>(inner: Effect.Effect<A, E>, deps: Record<string, any>) =>
  Effect.runPromiseExit(
    observeDreamRun(inner, { runID: "ses_dream", memoryFile: FILE, budgetTokens: 10_000, enabled: true, now: () => NOW, ...deps } as any),
  )

const value = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (!Exit.isSuccess(exit)) throw new Error("expected success")
  return exit.value
}

describe("T-g.2 dream audit wiring", () => {
  test("the flag is default-off, and when off nothing is read, logged or started", async () => {
    expect(T_G_AUDIT_ENABLED).toBe(false)
    const w = world({ [FILE]: S0 })
    const s = sink()
    const inner = Effect.succeed(7)
    const wrapped = observeDreamRun(inner, { runID: "x", memoryFile: FILE, budgetTokens: 1, readText: w.readText, log: s.log } as any)
    expect(wrapped).toBe(inner) // same Effect: the execution path is untouched
    expect(value(await Effect.runPromiseExit(wrapped))).toBe(7)
    expect(w.reads).toEqual([])
    expect(s.events).toEqual([])
  })

  test("dream success + audit success: value is untouched and exactly one structured event is logged", async () => {
    const w = world({ [FILE]: S0 })
    const s = sink()
    const dream = Effect.sync(() => {
      w.files.set(FILE, S0.replace(rec("d1", "Delta describes the release process"), "")) // a direct delete
      return { text: "dream done" }
    })
    const exit = await run(dream, { readText: w.readText, log: s.log })
    expect(value(exit)).toEqual({ text: "dream done" })
    expect(s.events).toHaveLength(1)
    const e = s.events[0]!
    expect(e.message).toBe("memory.audit")
    expect(e.level).toBe("warn") // an error-severity finding
    expect(e.extra).toMatchObject({
      schema: 1,
      auditVersion: "t-g.1",
      window: "between_snapshots",
      scope: "project",
      run: { kind: "auto-dream", sessionID: "ses_dream" },
      dream: { outcome: "success" },
      changed: true,
      result: { status: "audited", counts: { error: 1, warn: 0 } },
    })
    expect(e.extra.result.findings[0]).toMatchObject({ code: "unexplained_disappearance", severity: "error", ids: ["d1"], recovery: "manual_review" })
    expect(e.extra.result.findings[0].message.startsWith("observed between snapshots:")).toBe(true)
    expect(e.extra.result.invariants).toMatchObject({ nodisappear: false, trace: true })
    expect(e.extra.snapshots.before).toMatchObject({ ok: true, existed: { S: true, R: false } })
    expect(e.extra.snapshots.before.sha.S).not.toBe(e.extra.snapshots.after.sha.S)
    expect(w.reads).toEqual([FILE, TOMB, FILE, TOMB]) // two files, before and after, nothing else
  })

  test("no change between snapshots: unchanged, info level, the audit is not run", async () => {
    const w = world({ [FILE]: S0 })
    const s = sink()
    let audits = 0
    const exit = await run(Effect.succeed("ok"), {
      readText: w.readText,
      log: s.log,
      audit: () => {
        audits++
        return auditInvariants({ S: S0, R: "" }, { budgetTokens: 10_000, filePath: FILE })
      },
    })
    expect(value(exit)).toBe("ok")
    expect(audits).toBe(0)
    expect(s.events[0]!.level).toBe("info")
    expect(s.events[0]!.extra).toMatchObject({ changed: false, result: { status: "unchanged" } })
  })

  test("a missing MEMORY.md is a valid empty state, not a failure", async () => {
    const w = world({})
    const s = sink()
    const dream = Effect.sync(() => void w.files.set(FILE, S0))
    await run(dream, { readText: w.readText, log: s.log })
    expect(s.events[0]!.extra.snapshots.before).toMatchObject({ ok: true, existed: { S: false, R: false }, bytes: { S: 0, R: 0 } })
    expect(s.events[0]!.extra.result.status).toBe("audited")
  })

  test("dream success + before-snapshot failure: value untouched, event says skipped, after is never read", async () => {
    const s = sink()
    let calls = 0
    const exit = await run(Effect.succeed("ok"), {
      readText: async () => {
        calls++
        throw new Error("disk on fire")
      },
      log: s.log,
    })
    expect(value(exit)).toBe("ok")
    expect(s.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "before_failed", detail: "read_failed" })
    expect(calls).toBe(2) // only the before pair
  })

  test("dream success + after-snapshot failure and oversize files are skipped, never audited", async () => {
    const s = sink()
    let round = 0
    const w = world({ [FILE]: S0 })
    const exit = await run(Effect.succeed("ok"), {
      readText: async (f: string) => {
        if (f === FILE && ++round === 2) throw new Error("gone")
        return w.files.get(f)
      },
      log: s.log,
    })
    expect(value(exit)).toBe("ok")
    expect(s.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "after_failed" })

    const big = sink()
    await run(Effect.succeed(1), { readText: async () => "x".repeat(2048), log: big.log, maxBytes: 1024 })
    expect(big.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "before_failed", detail: "too_large" })
    expect(SNAPSHOT_MAX_BYTES).toBe(256 * 1024)
  })

  test("a hanging after-snapshot times out instead of stalling the run", async () => {
    const s = sink()
    let round = 0
    const exit = await run(Effect.succeed("ok"), {
      readText: (f: string) => (f === FILE && ++round === 2 ? new Promise<string | undefined>(() => {}) : Promise.resolve("")),
      log: s.log,
      stepTimeoutMs: 20,
    })
    expect(value(exit)).toBe("ok")
    expect(s.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "after_failed", detail: "timeout" })
    expect(OBSERVER_STEP_TIMEOUT_MS).toBe(5000)
  })

  test("dream failure + audit success: the original failure is re-raised untouched and the audit is still logged", async () => {
    const w = world({ [FILE]: S0 })
    const s = sink()
    const boom = new Error("dream boom")
    const dream = Effect.suspend(() => {
      w.files.set(FILE, S0.replace(rec("d1", "Delta describes the release process"), ""))
      return Effect.fail(boom)
    })
    const exit = await run(dream, { readText: w.readText, log: s.log })
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("dream boom")
    expect(s.events[0]!.extra.dream.outcome).toBe("failure")
    expect(s.events[0]!.extra.dream.error).toContain("dream boom")
    expect(s.events[0]!.extra.result.status).toBe("audited")
  })

  test("dream failure + audit failure: both are independent, the dream failure is what comes out", async () => {
    const w = world({ [FILE]: S0 })
    const s = sink()
    const dream = Effect.suspend(() => {
      w.files.set(FILE, S0 + rec("e1", "Epsilon was added"))
      return Effect.fail(new Error("dream boom"))
    })
    const exit = await run(dream, {
      readText: w.readText,
      log: s.log,
      audit: () => {
        throw new Error("audit exploded")
      },
    })
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain("dream boom")
      expect(Cause.pretty(exit.cause)).not.toContain("audit exploded")
    }
    expect(s.events[0]!.level).toBe("warn")
    expect(s.events[0]!.extra.dream.outcome).toBe("failure")
    expect(s.events[0]!.extra.result).toMatchObject({ status: "audit_failed", reason: "audit_threw" })
  })

  test("a throwing log sink never changes the result", async () => {
    const w = world({ [FILE]: S0 })
    const exit = await run(Effect.succeed("ok"), { readText: w.readText, log: sink({ throws: true }).log })
    expect(value(exit)).toBe("ok")
  })

  test("an interrupted dream is passed through, only 'interrupted' is logged, and no after-read happens", async () => {
    const w = world({ [FILE]: S0 })
    const s = sink()
    const exit = await run(Effect.interrupt, { readText: w.readText, log: s.log })
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(s.events[0]!.extra.dream.outcome).toBe("interrupted")
    expect(s.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "interrupted" })
    expect(w.reads).toEqual([FILE, TOMB])
  })

  test("findings go only to the log: the result carries none, and the log holds no memory text", async () => {
    const w = world({ [FILE]: S0 })
    const s = sink()
    const SECRET = "SECRET-BODY-9f3a"
    const dream = Effect.sync(() => {
      // Phase A of a merge only: M is written, nothing is retracted -> incomplete_merge with a replay body.
      const plan = computeMerge(S0, "", { sourceIds: ["a1", "b1"], body: `- ${SECRET}`, now: "2026-11-14T08:00:00Z", budgetTokens: 10_000, filePath: FILE })
      if (!plan.ok) throw new Error(plan.error)
      w.files.set(FILE, plan.text)
      return { finalText: "done" }
    })
    const exit = await run(dream, { readText: w.readText, log: s.log })
    expect(value(exit)).toEqual({ finalText: "done" }) // nothing from the audit leaks into the result
    const logged = JSON.stringify(s.events)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain("Alpha stays here") // no memory bodies at all
    const finding = s.events[0]!.extra.result.findings.find((f: any) => f.code === "incomplete_merge")
    expect(finding.replayBodyBytes).toBe(Buffer.byteLength(`- ${SECRET}\n`))
    expect(finding.ids.length).toBeLessThanOrEqual(8)
  })

  test("the snapshot scope is only a project MEMORY.md and its sibling retracted.md", async () => {
    expect(resolveSnapshotPaths(FILE)).toEqual({ S: FILE, R: TOMB })
    for (const bad of [
      path.join("/data", "memory", "global", "MEMORY.md"),
      path.join("/data", "memory", "projects", "p1", "NOTES.md"),
      path.join("/data", "projects", "p1", "MEMORY.md"),
      path.join("/data", "memory", "projects", "MEMORY.md"),
      path.join("/data", "memory", "projects", "p1", "retracted.md"),
    ]) {
      expect(resolveSnapshotPaths(bad), bad).toBeUndefined()
      const w = world({ [bad]: S0 })
      const s = sink()
      const exit = await run(Effect.succeed("ok"), { memoryFile: bad, readText: w.readText, log: s.log })
      expect(value(exit)).toBe("ok")
      expect(w.reads).toEqual([])
      expect(s.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "before_failed", detail: "scope" })
    }
  })

  test("CRLF and LF give the same findings; a pure line-ending change is a 'changed' audit with no error findings", async () => {
    const crlf = (t: string) => t.replace(/\n/g, "\r\n")
    const codesFor = async (toText: (t: string) => string) => {
      const w = world({ [FILE]: toText(S0) })
      const s = sink()
      await run(
        Effect.sync(() => void w.files.set(FILE, toText(S0.replace(rec("d1", "Delta describes the release process"), "")))),
        { readText: w.readText, log: s.log },
      )
      return s.events[0]!.extra.result.findings.map((f: any) => f.code)
    }
    expect(await codesFor((t) => t)).toEqual(["unexplained_disappearance"])
    expect(await codesFor(crlf)).toEqual(["unexplained_disappearance"])

    const w = world({ [FILE]: S0 })
    const s = sink()
    await run(Effect.sync(() => void w.files.set(FILE, crlf(S0))), { readText: w.readText, log: s.log })
    expect(s.events[0]!.extra.changed).toBe(true) // byte-level identity
    expect(s.events[0]!.extra.result.counts.error).toBe(0)
  })

  test("the observer cannot mutate: its reader is the only I/O it is given, and its source imports no tool or write API", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "../../src/session/dream-audit.ts")).text()
    const imports = source.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n")
    for (const banned of [/tool\//, /memory\/merge/, /memory-merge/, /memory-retract/, /retract/i, /writeFile/, /appendFile/, /writeWithDirs/, /Bun\.write/, /node:fs"$/m]) {
      expect(imports).not.toMatch(banned)
    }
    expect(source).not.toMatch(/writeFile|appendFile|writeWithDirs|Bun\.write|rename\(|unlink\(|rm\(/)
    expect(imports).toContain('from "node:fs/promises"')
    expect(imports).toContain('from "@/memory/audit"')
  })

  test("autoDreamAuditDeps points at the project memory file and falls back to the shared budget", () => {
    const deps = autoDreamAuditDeps({ sessionID: "ses_1", projectID: "p1" as any })
    expect(deps.memoryFile).toBe(memoryPath("p1" as any))
    expect(deps.runID).toBe("ses_1")
    expect(deps.budgetTokens).toBe(DEFAULT_MEMORY_BUDGET_TOKENS)
    expect(autoDreamAuditDeps({ sessionID: "s", projectID: "p1" as any, memoryBudgetTokens: 123 }).budgetTokens).toBe(123)
    expect(resolveSnapshotPaths(deps.memoryFile)).toBeDefined() // the real path shape passes the scope guard
  })

  test("P1-1 performance bound: auditInvariants on a worst-case realistic rewrite stays under 2s", () => {
    // 200 records vanish and 200 similar-but-new records appear, ~300 chars each, inside the 256 KiB cap.
    const filler = (i: number) => `topic ${i} `.repeat(40).slice(0, 300)
    const mk = (prefix: string, tag: string) => {
      let s = "## Facts\n\n"
      for (let i = 0; i < 200; i++) s += `- ${filler(i)}${tag} <!--m id=${prefix}${String(i).padStart(3, "0")} at=2026-11-01T00:00:00Z src=i-->\n\n`
      return s
    }
    const before = { S: mk("old", ""), R: "" }
    const after = { S: mk("new", " revised"), R: "" }
    expect(Buffer.byteLength(before.S)).toBeLessThan(SNAPSHOT_MAX_BYTES)
    const start = performance.now()
    const report = auditInvariants(after, { budgetTokens: 10_000, filePath: FILE, before })
    const elapsed = performance.now() - start
    expect(report.findings.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2000)
  })
})
