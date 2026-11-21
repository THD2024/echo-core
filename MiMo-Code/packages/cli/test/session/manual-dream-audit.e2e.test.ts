import { Worktree } from "../../src/worktree"
import { Instance } from "../../src/project/instance"
import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { afterEach, describe, expect, spyOn } from "bun:test"
import { dynamicTool, jsonSchema, type Tool as AITool } from "ai"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { ResumeTestHooks } from "../../src/session/resume-test-hooks"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { Command } from "../../src/command"
import { Config } from "../../src/config"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider"
import { Env } from "../../src/env"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { SessionPrune } from "../../src/session/prune"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { Goal } from "../../src/session/goal"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Shell } from "../../src/shell/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool"
import { Truncate } from "../../src/tool"
import { ActorRegistry } from "../../src/actor/registry"
import { ActorWaiter } from "../../src/actor/waiter"
import { Memory } from "../../src/memory"
import { History } from "../../src/history"
import { Team } from "../../src/team"
import { SessionCheckpoint } from "../../src/session/checkpoint"
import { TaskRegistry } from "../../src/task/registry"
import { defaultLayer as SchedulerDefaultLayer } from "../../src/cron/scheduler"
import { Auth } from "../../src/auth"
import { Log } from "../../src/util"
import { Global } from "../../src/global"
import { EffectLogger } from "../../src/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import { provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { Inbox } from "../../src/inbox"
import { Metrics } from "../../src/metrics"
import { memoryPath } from "../../src/session/checkpoint-paths"
import { Flag } from "../../src/flag/flag"

/**
 * T-g.4 REAL end-to-end tests: the built-in manual /dream through SessionPrompt.command with the real
 * Config/Command/Agent/Tool/Session layers and a scripted LLM. Harness copied from prompt-effect.test.ts.
 * Requires MIMOCODE_EXPERIMENTAL_DREAM_AUDIT (set per test); the audit events are captured by spying the
 * shared `dream-audit` logger.
 */
void Log.init({ print: false })
const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

function mcpLayer(
  tools: (context?: MCP.TurnContext) => Record<string, AITool> = () => ({}),
  clients: () => Record<string, any> = () => ({}),
) {
  return Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.sync(clients),
      tools: (context) => Effect.sync(() => tools(context)),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: { status: "disabled" as const } }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed(undefined),
      startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      authenticate: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  )
}

const mcp = mcpLayer()

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
function makeHttp(mcpService = mcp, providerLayer = ProviderSvc.defaultLayer) {
  const taskRegistry = ActorRegistry.defaultLayer
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    providerLayer,
    lsp,
    mcpService,
    AppFileSystem.defaultLayer,
    status,
    taskRegistry,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const checkpoint = SessionCheckpoint.layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Memory.defaultLayer),
    Layer.provide(History.defaultLayer),
    Layer.provide(TaskRegistry.defaultLayer),
    Layer.provide(SchedulerDefaultLayer),
    Layer.provide(taskRegistry),
  )
  const taskWaiter = ActorWaiter.layer.pipe(Layer.provide(Bus.layer), Layer.provide(taskRegistry))
  const team = Team.defaultLayer
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Worktree.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(taskRegistry),
    Layer.provide(taskWaiter),
    Layer.provide(team),
    Layer.provide(checkpoint),
    Layer.provide(Memory.defaultLayer),
    Layer.provide(History.defaultLayer),
    Layer.provide(TaskRegistry.defaultLayer),
    Layer.provide(SchedulerDefaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const prune = SessionPrune.layer.pipe(
    Layer.provide(checkpoint),
    Layer.provide(taskRegistry),
    Layer.provideMerge(deps),
  )
  const proc = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
  const compaction = SessionCompaction.layer.pipe(
    Layer.provideMerge(proc),
    Layer.provide(AgentSvc.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(Goal.defaultLayer),
      Layer.provide(TaskRegistry.defaultLayer),
      Layer.provide(SchedulerDefaultLayer),
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(summary),
      Layer.provide(checkpoint),
      Layer.provide(team),
      Layer.provide(taskRegistry),
      Layer.provideMerge(run),
      Layer.provideMerge(prune),
      Layer.provideMerge(compaction),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provide(Inbox.defaultLayer),
      Layer.provideMerge(deps),
    ),
  ).pipe(Layer.provide(summary))
}

const cfg = {
  checkpoint: { thresholds: [] as string[] },
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
        "gpt-5-test": {
          id: "gpt-5-test",
          name: "GPT 5 Test",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}


const it = testEffect(Layer.provideMerge(makeHttp(), EffectLogger.layer))

const FLAG = "MIMOCODE_EXPERIMENTAL_DREAM_AUDIT"
const withFlag = <A, E, R>(value: string | undefined, fx: () => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env[FLAG]
      if (value === undefined) delete process.env[FLAG]
      else process.env[FLAG] = value
      return prev
    }),
    () => fx(),
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env[FLAG]
        else process.env[FLAG] = prev
      }),
  )

type Captured = { level: "info" | "warn"; message: string; extra: any }
/** Capture `memory.audit` events from the cached `dream-audit` logger. */
function capture() {
  const logger = Log.create({ service: "dream-audit" }) as any
  const events: Captured[] = []
  const spies = (["info", "warn"] as const).map((level) =>
    spyOn(logger, level).mockImplementation((message: string, extra?: any) => {
      events.push({ level, message, extra })
    }),
  )
  return { events, restore: () => spies.forEach((s) => s.mockRestore()) }
}
const audits = (events: Captured[]) => events.filter((e) => e.message === "memory.audit")

const REC = (id: string, text: string) => `- ${text} <!--m id=${id} at=2026-11-01T00:00:00Z src=u-->\n`
const MEMORY_V1 = `## Facts\n\n${REC("a1", "Alpha is a stable fact about the project")}`
const MEMORY_V2 = `${MEMORY_V1}\n${REC("b1", "Beta was added by the dream run")}`

const runDream = (chatID: SessionID) =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    return yield* prompt.command({
      sessionID: chatID,
      agent: "build",
      model: `${ref.providerID}/${ref.modelID}`,
      command: "dream",
      arguments: "",
    })
  })

const seedMemory = (file: string, text: string) =>
  Effect.promise(async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  })
const readMemory = (file: string) =>
  Effect.promise(async () => {
    const { readFileSync, existsSync } = await import("node:fs")
    return existsSync(file) ? readFileSync(file, "utf8") : undefined
  })

describe("T-g.4 manual /dream audit: real end-to-end", () => {
  afterEach(() => {})

  it.live("success: the dream really wrote canonical MEMORY.md and the event proves it (changed:true, manual-dream, success)", () =>
    withFlag("1", () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "manual-dream-success" })
          const file = memoryPath(chat.projectID)
          yield* seedMemory(file, MEMORY_V1)
          yield* llm.tool("write", { file_path: file, content: MEMORY_V2 })
          yield* llm.text("consolidated")
          const cap = capture()
          try {
            const result = yield* runDream(chat.id)
            expect(result.info.role).toBe("assistant")
            expect(yield* readMemory(file)).toBe(MEMORY_V2) // the file audited is the file the dream wrote
            const [event] = audits(cap.events)
            expect(audits(cap.events)).toHaveLength(1)
            expect(event!.extra.run).toEqual({ kind: "manual-dream", sessionID: chat.id })
            expect(event!.extra.scope).toBe("project")
            expect(event!.extra.dream).toEqual({ outcome: "success" })
            expect(event!.extra.changed).toBe(true)
            expect(event!.extra.result.status).toBe("audited")
            expect(JSON.stringify(event)).not.toContain("Beta was added") // memory text is never logged
          } finally {
            cap.restore()
          }
        }),
        { git: true, config: providerCfg },
      ),
    ),
  )

  it.live("business failure returned as an assistant error is logged as failure, not success", () =>
    withFlag("1", () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "manual-dream-failure" })
          yield* seedMemory(memoryPath(chat.projectID), MEMORY_V1)
          yield* llm.error(400, { error: { message: "upstream exploded" } })
          const cap = capture()
          try {
            const result = yield* runDream(chat.id)
            expect(result.info.role === "assistant" && result.info.error).toBeTruthy() // returned normally, error on info
            const [event] = audits(cap.events)
            expect(event!.extra.run.kind).toBe("manual-dream")
            expect(event!.extra.dream.outcome).toBe("failure")
            expect(typeof event!.extra.dream.error).toBe("string")
            expect(event!.extra.changed).toBe(false)
          } finally {
            cap.restore()
          }
        }),
        { git: true, config: providerCfg },
      ),
    ),
    20_000,
  )

  it.live("Esc/cancel (prompt.cancel) is logged as interrupted, never success", () =>
    withFlag("1", () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "manual-dream-cancel" })
          yield* seedMemory(memoryPath(chat.projectID), MEMORY_V1)
          yield* llm.hang
          const cap = capture()
          try {
            const fiber = yield* runDream(chat.id).pipe(Effect.forkChild)
            yield* llm.wait(1)
            yield* prompt.cancel(chat.id)
            const exit = yield* Fiber.await(fiber)
            expect(Exit.isSuccess(exit)).toBe(true) // cancel returns normally (runner substitutes the last assistant)
            const [event] = audits(cap.events)
            expect(audits(cap.events)).toHaveLength(1)
            expect(event!.extra.run.kind).toBe("manual-dream")
            expect(event!.extra.dream.outcome).toBe("interrupted")
            expect(event!.extra.dream.outcome).not.toBe("success")
          } finally {
            cap.restore()
          }
        }),
        { git: true, config: providerCfg },
      ),
    ),
    20_000,
  )

  it.live("caller-fiber interruption is a real interrupt and is logged as interrupted", () =>
    withFlag("1", () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "manual-dream-fiber" })
          yield* seedMemory(memoryPath(chat.projectID), MEMORY_V1)
          yield* llm.hang
          const cap = capture()
          try {
            const fiber = yield* runDream(chat.id).pipe(Effect.forkChild)
            yield* llm.wait(1)
            yield* Fiber.interrupt(fiber)
            const exit = yield* Fiber.await(fiber)
            expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
            const [event] = audits(cap.events)
            expect(event!.extra.dream.outcome).toBe("interrupted")
          } finally {
            cap.restore()
          }
        }),
        { git: true, config: providerCfg },
      ),
    ),
    20_000,
  )

  it.live("flag off (default): no audit event, no change in behavior", () =>
    withFlag(undefined, () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "manual-dream-flag-off" })
          const file = memoryPath(chat.projectID)
          yield* seedMemory(file, MEMORY_V1)
          yield* llm.tool("write", { file_path: file, content: MEMORY_V2 })
          yield* llm.text("consolidated")
          expect(Flag.MIMOCODE_EXPERIMENTAL_DREAM_AUDIT).toBe(false)
          const cap = capture()
          try {
            yield* runDream(chat.id)
            expect(yield* readMemory(file)).toBe(MEMORY_V2)
            expect(audits(cap.events)).toEqual([])
          } finally {
            cap.restore()
          }
        }),
        { git: true, config: providerCfg },
      ),
    ),
  )

  it.live("config command.dream override (agent=dream) is NOT observed even with the flag on", () =>
    withFlag("1", () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "manual-dream-override" })
          yield* seedMemory(memoryPath(chat.projectID), MEMORY_V1)
          yield* llm.text("custom dream ran")
          const cap = capture()
          try {
            yield* runDream(chat.id)
            expect(audits(cap.events)).toEqual([])
          } finally {
            cap.restore()
          }
        }),
        {
          git: true,
          config: (url: string) => ({
            ...providerCfg(url),
            command: { dream: { template: "My own consolidation", agent: "dream", subtask: false } },
          }),
        },
      ),
    ),
  )
})
