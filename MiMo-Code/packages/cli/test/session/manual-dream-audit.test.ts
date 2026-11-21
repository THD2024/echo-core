import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import * as path from "path"
import { auditInvariants } from "../../src/memory/audit"
import { DEFAULT_MEMORY_BUDGET_TOKENS } from "../../src/session/budgeted-read"
import { memoryPath } from "../../src/session/checkpoint-paths"
import { T_G_AUDIT_ENABLED, observeDreamRun } from "../../src/session/dream-audit"
import {
  MANUAL_DREAM_RUN_KIND,
  manualDreamAuditDeps,
  observeManualDream,
  relabelRunKind,
  shouldObserveManualDream,
  type ManualDreamObserveInput,
} from "../../src/session/manual-dream-audit"
import type { ProjectID } from "../../src/project/schema"

const FILE = path.join("/data", "memory", "projects", "p1", "MEMORY.md")
const NOW = 1_700_000_000_000
const PROJECT = "p1" as unknown as ProjectID

const rec = (id: string, text: string) => `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=u-->\n`
const S0 = `## Facts\n\n${rec("a1", "Alpha stays here as a fact")}\n${rec("b1", "Beta is another fact")}\n${rec("c1", "Gamma is about deployment")}\n`
const S1 = S0.replace(rec("c1", "Gamma is about deployment"), "") // a direct delete

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

const BUILTIN = { isDreamCommand: true, source: "command", agentName: "dream", isSubtask: false } as const

/** A fully observable input over a fake file system; every call to getBudget is counted. */
function observed(over: Partial<ManualDreamObserveInput> = {}, w = world({ [FILE]: S0 }), s = sink()) {
  const budgetCalls = { n: 0 }
  const budgetsSeen: number[] = []
  const input: ManualDreamObserveInput = {
    ...BUILTIN,
    sessionID: "ses_user",
    projectID: PROJECT,
    enabled: true,
    getBudget: () => {
      budgetCalls.n++
      return Effect.succeed(777)
    },
    overrides: {
      memoryFile: FILE,
      readText: w.readText,
      log: s.log,
      now: () => NOW,
      audit: (after, options) => {
        budgetsSeen.push(options.budgetTokens)
        return auditInvariants(after, options)
      },
    },
    ...over,
  }
  return { input, w, s, budgetCalls, budgetsSeen }
}

const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff)
const value = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (!Exit.isSuccess(exit)) throw new Error("expected success")
  return exit.value
}

describe("T-g.3 manual /dream predicate", () => {
  test("the true built-in manual /dream passes", () => {
    expect(shouldObserveManualDream(BUILTIN)).toBe(true)
  })

  test("everything else fails closed: wrong command, config/MCP/skill source, other agents, subtask", () => {
    const no = (over: Partial<typeof BUILTIN> | Record<string, unknown>) =>
      expect(shouldObserveManualDream({ ...BUILTIN, ...over } as never)).toBe(false)
    no({ isDreamCommand: false }) // another command (even if it somehow ran the dream agent)
    no({ source: "mcp" }) // MCP prompt registered under the same name
    no({ source: "skill" })
    no({ source: undefined })
    no({ agentName: "build" }) // config command.dream override pointing at another / the default agent
    no({ agentName: "distill" })
    no({ agentName: "" })
    no({ isSubtask: true }) // config override with subtask:true runs as a sub-agent task
  })

  test("documented limit: a config override that keeps agent 'dream' is indistinguishable from the built-in", () => {
    // Config commands also carry source "command"; only the agent/subtask fields can tell them apart. Such a run
    // is still the dream agent in the user's own session, so observing it is the same observe-only behavior.
    expect(shouldObserveManualDream({ ...BUILTIN })).toBe(true)
  })
})

describe("T-g.3 flag off / not applicable: exact no-side-effect fast path", () => {
  test("the module flag is the existing default-off T_G_AUDIT_ENABLED", () => {
    expect(T_G_AUDIT_ENABLED).toBe(false)
  })

  test("flag off (default): the SAME Effect object comes back; no read, no budget resolution, no log", async () => {
    const { input, w, s, budgetCalls } = observed({ enabled: undefined })
    const run = Effect.succeed("done")
    const wrapped = observeManualDream(run, input)
    expect(wrapped).toBe(run)
    expect(value(await runExit(wrapped))).toBe("done")
    expect(w.reads).toEqual([])
    expect(s.events).toEqual([])
    expect(budgetCalls.n).toBe(0)
  })

  test("explicitly disabled behaves the same, even for the built-in /dream", async () => {
    const { input, w, s, budgetCalls } = observed({ enabled: false })
    const run = Effect.succeed(1)
    expect(observeManualDream(run, input)).toBe(run)
    expect(w.reads).toEqual([])
    expect(s.events).toEqual([])
    expect(budgetCalls.n).toBe(0)
  })

  test("flag on but not the built-in /dream: also the same Effect, and still zero side effects", async () => {
    for (const over of [{ isDreamCommand: false }, { source: "mcp" }, { agentName: "build" }, { isSubtask: true }]) {
      const { input, w, s, budgetCalls } = observed(over)
      const run = Effect.succeed("x")
      const wrapped = observeManualDream(run, input)
      expect(wrapped).toBe(run)
      expect(value(await runExit(wrapped))).toBe("x")
      expect(w.reads).toEqual([])
      expect(s.events).toEqual([])
      expect(budgetCalls.n).toBe(0)
    }
  })
})

describe("T-g.3 flag on: manual events", () => {
  test("event kind is manual-dream; session, project file and budget are the manual run's", async () => {
    const { input, w, s, budgetsSeen, budgetCalls } = observed()
    const dream = Effect.sync(() => {
      w.files.set(FILE, S1)
      return { text: "dream done" }
    })
    const exit = await runExit(observeManualDream(dream, input))
    expect(value(exit)).toEqual({ text: "dream done" })
    expect(s.events).toHaveLength(1)
    expect(s.events[0]!.message).toBe("memory.audit")
    expect(s.events[0]!.extra.run).toEqual({ kind: MANUAL_DREAM_RUN_KIND, sessionID: "ses_user" })
    expect(MANUAL_DREAM_RUN_KIND).toBe("manual-dream")
    expect(budgetCalls.n).toBe(1)
    expect(budgetsSeen).toEqual([777]) // cfg.checkpoint.push_caps.memory reached the audit
    expect(s.events[0]!.extra.result.status).toBe("audited")
    expect(s.events[0]!.extra.result.counts.error).toBeGreaterThan(0) // the unexplained disappearance of c1
  })

  test("all other event fields are exactly what T-g.2 emits for an auto-dream over the same window", async () => {
    const run = (label: "auto" | "manual") => {
      const w = world({ [FILE]: S0 })
      const s = sink()
      const dream = Effect.sync(() => void w.files.set(FILE, S1))
      const seen: number[] = []
      const audit = (after: { S: string; R: string }, options: Parameters<typeof auditInvariants>[1]) => {
        seen.push(options.budgetTokens)
        return auditInvariants(after, options)
      }
      const eff =
        label === "auto"
          ? observeDreamRun(dream, { runID: "ses_user", memoryFile: FILE, budgetTokens: 777, enabled: true, now: () => NOW, readText: w.readText, log: s.log, audit })
          : observeManualDream(dream, observed({}, w, s).input)
      return runExit(eff).then(() => ({ event: s.events[0]!, w }))
    }
    const auto = await run("auto")
    const manual = await run("manual")
    expect(auto.event.extra.run.kind).toBe("auto-dream") // T-g.2 itself is untouched
    expect(manual.event.extra.run.kind).toBe("manual-dream")
    const strip = (e: Event) => ({ level: e.level, message: e.message, extra: { ...e.extra, run: { sessionID: e.extra.run.sessionID } } })
    expect(strip(manual.event)).toEqual(strip(auto.event))
  })

  test("manualDreamAuditDeps points at the project memory file of the session's project and the shared default budget", () => {
    const deps = manualDreamAuditDeps({ sessionID: "ses_user", projectID: PROJECT })
    expect(deps.memoryFile).toBe(memoryPath(PROJECT))
    expect(deps.runID).toBe("ses_user")
    expect(deps.budgetTokens).toBe(DEFAULT_MEMORY_BUDGET_TOKENS)
    expect(deps.enabled).toBe(true)
    expect(manualDreamAuditDeps({ sessionID: "s", projectID: PROJECT, memoryBudgetTokens: 123 }).budgetTokens).toBe(123)
  })

  test("a missing or failing budget lookup falls back to the shared default and never touches the dream", async () => {
    for (const getBudget of [
      () => Effect.succeed(undefined),
      () => Effect.fail(new Error("config unavailable")),
      () => Effect.die(new Error("config exploded")),
    ]) {
      const { input, w, budgetsSeen } = observed({ getBudget })
      const dream = Effect.sync(() => {
        w.files.set(FILE, S1)
        return "fine"
      })
      expect(value(await runExit(observeManualDream(dream, input)))).toBe("fine")
      expect(budgetsSeen).toEqual([DEFAULT_MEMORY_BUDGET_TOKENS])
    }
  })

  test("relabelRunKind rewrites only run.kind and passes everything else through", () => {
    const seen: Array<{ message: string; extra: unknown }> = []
    const log = relabelRunKind({
      info: (message, extra) => void seen.push({ message, extra }),
      warn: (message, extra) => void seen.push({ message, extra }),
    })
    log.info("memory.audit", { schema: 1, run: { kind: "auto-dream", sessionID: "s" }, result: { status: "unchanged" } })
    log.warn("memory.audit", { run: { kind: "auto-dream", sessionID: "s", extra: true }, other: 1 })
    log.info("no run field", { other: 2 })
    log.info("no extra")
    expect(seen).toEqual([
      { message: "memory.audit", extra: { schema: 1, run: { kind: "manual-dream", sessionID: "s" }, result: { status: "unchanged" } } },
      { message: "memory.audit", extra: { run: { kind: "manual-dream", sessionID: "s", extra: true }, other: 1 } },
      { message: "no run field", extra: { other: 2 } },
      { message: "no extra", extra: undefined },
    ])
  })
})

describe("T-g.3 lifecycle: the prompt result is never altered", () => {
  test("success: the very same value comes out", async () => {
    const { input, w } = observed()
    const result = { text: "dream done" }
    const dream = Effect.sync(() => {
      w.files.set(FILE, S1)
      return result
    })
    expect(value(await runExit(observeManualDream(dream, input)))).toBe(result)
  })

  test("dream failure is re-raised untouched, and the audit is still logged as a manual run", async () => {
    const { input, w, s } = observed()
    const dream = Effect.suspend(() => {
      w.files.set(FILE, S1)
      return Effect.fail(new Error("dream boom"))
    })
    const exit = await runExit(observeManualDream(dream, input))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("dream boom")
    expect(s.events[0]!.extra.run.kind).toBe("manual-dream")
    expect(s.events[0]!.extra.dream.outcome).toBe("failure")
    expect(s.events[0]!.extra.result.status).toBe("audited")
  })

  test("audit failure never replaces the dream failure", async () => {
    const { input, w, s } = observed()
    input.overrides = {
      ...input.overrides,
      audit: () => {
        throw new Error("audit exploded")
      },
    }
    const dream = Effect.suspend(() => {
      w.files.set(FILE, S1)
      return Effect.fail(new Error("dream boom"))
    })
    const exit = await runExit(observeManualDream(dream, input))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain("dream boom")
      expect(Cause.pretty(exit.cause)).not.toContain("audit exploded")
    }
    expect(s.events[0]!.extra.result).toMatchObject({ status: "audit_failed", reason: "audit_threw" })
  })

  test("interruption is passed through; only 'interrupted' is logged and no after-snapshot is read", async () => {
    const { input, w, s } = observed()
    const exit = await runExit(observeManualDream(Effect.interrupt, input))
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(s.events[0]!.extra.run.kind).toBe("manual-dream")
    expect(s.events[0]!.extra.dream.outcome).toBe("interrupted")
    expect(s.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "interrupted" })
    expect(w.reads).toHaveLength(2) // the before snapshot (MEMORY.md + retracted.md) only
  })

  test("a throwing log sink never changes the result", async () => {
    const { input } = observed({}, world({ [FILE]: S0 }), sink({ throws: true }))
    expect(value(await runExit(observeManualDream(Effect.succeed("ok"), input)))).toBe("ok")
    const failing = await runExit(observeManualDream(Effect.fail(new Error("dream boom")), input))
    expect(Exit.isFailure(failing)).toBe(true)
  })

  test("a failing snapshot reader never changes the result", async () => {
    const { input, s } = observed()
    input.overrides = {
      ...input.overrides,
      readText: async () => {
        throw new Error("disk on fire")
      },
    }
    expect(value(await runExit(observeManualDream(Effect.succeed(42), input)))).toBe(42)
    expect(s.events[0]!.extra.result).toMatchObject({ status: "skipped", reason: "before_failed" })
  })
})

describe("T-g.3 boundaries", () => {
  const read = (rel: string) => Bun.file(path.join(import.meta.dir, "../../src/session", rel)).text()

  test("the manual adapter imports no tool, merge, retract or write API and no new I/O", async () => {
    const source = await read("manual-dream-audit.ts")
    const imports = source.split("\n").filter((l) => /^\s*import\b/.test(l))
    const specs = imports.map((l) => /from\s+"([^"]+)"/.exec(l)?.[1])
    expect(specs.sort()).toEqual(["./dream-audit", "@/util", "effect"].sort())
    expect(source).not.toMatch(/writeFile|appendFile|writeWithDirs|Bun\.write|Bun\.file|rename\(|unlink\(|rm\(|node:fs/)
    expect(source).not.toMatch(/memory-merge|memory-retract|registry|allowlist/)
  })

  test("T-g.2 is reused, not modified: auto-dream events keep their own kind", async () => {
    const source = await read("dream-audit.ts")
    expect(source).toContain('run: { kind: "auto-dream", sessionID: input.deps.runID }')
    expect(source).not.toContain("manual-dream")
    expect(source).toContain("export const T_G_AUDIT_ENABLED = false")
  })

  test("prompt.ts: one manual hook in command(), auto-dream wiring untouched", async () => {
    const source = await read("prompt.ts")
    expect(source.match(/observeManualDream\(/g)).toHaveLength(1)
    expect(source.match(/observeDreamRun\(dream, autoDreamAuditDeps\(/g)).toHaveLength(1)
    expect(source).toContain('import { observeManualDream } from "./manual-dream-audit"')
    const hook = source.indexOf("observeManualDream(run, {")
    expect(source.lastIndexOf("const run = prompt({", hook)).toBeGreaterThan(source.indexOf("SessionPrompt.command"))
    expect(source.indexOf("Command.Event.Executed", hook)).toBeGreaterThan(hook)
    // The hook is fed exactly the approved sources.
    const call = source.slice(hook, source.indexOf("})\n", hook))
    for (const needle of [
      "input.command === Command.Default.DREAM",
      "source: cmd.source",
      "agentName",
      "isSubtask",
      "sessionID: input.sessionID",
      "projectID: session.projectID",
      "c.checkpoint?.push_caps?.memory",
    ]) {
      expect(call).toContain(needle)
    }
  })
})
