/**
 * Immune System V1 — 冻结前最终验证（真实链路）
 *
 * 与旧的 immune-core-c1-integration-test.ts 的关键区别：本文件不复刻、不模拟。
 * 一律走真实生产代码：
 *   - 真实 Session.prompt(...) 驱动真实 runLoop
 *   - 真实内置 read 工具执行（成功 / 执行失败）
 *   - 真实 processor.ts tool-error handler 调用真实 classifyToolError
 *   - 真实 bus.publish(Metrics.ToolCall, {..., diagnostic})
 *   - 真实 Bus.subscribeCallback(Metrics.ToolCall, ...) 捕获生产代码发布的事件
 *
 * T2（真实正常路径控制组）：正常 read 成功 → 断言真实 success 事件
 *   tool_call_status === "success"、无 diagnostic、窗口内无任何 error 事件。
 * T3（真实 Core→C1）：read 执行失败 → 真实 error 事件携带 7 个诊断字段，
 *   tool_call_id/cid 一致，未走 legacy（无 diagnostic）分支，不重复发布。
 *
 * 运行：cd packages/cli && bun test ./test/session/immune-real-path.test.ts
 */

import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Deferred, Fiber } from "effect"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Bus } from "../../src/bus"
import { Metrics } from "../../src/metrics"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import {
  startScriptedLLMServer,
  toolCallResponse,
  textStopResponse,
} from "../lib/scripted-llm-server"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

// 真实生产层：SessionPrompt.defaultLayer 内部 memoize 了单例 Bus（runLoop 用的同一个）。
// 显式提供 Bus.layer 让测试 generator 能 yield* Bus.Service；由于 Bus.layer 基于
// InstanceState（per-Instance 单例），resolve 到的正是 runLoop publish 用的那个 Bus 实例。
function run<A, E>(
  fx: Effect.Effect<A, E, SessionPrompt.Service | Session.Service | Bus.Service>,
) {
  return Effect.runPromise(
    fx.pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer, Bus.layer)),
    ),
  )
}

function writeConfig(dir: string, origin: string) {
  return Bun.write(
    path.join(dir, "mimocode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      enabled_providers: ["alibaba"],
      provider: {
        alibaba: { options: { apiKey: "test-key", baseURL: `${origin}/v1` } },
      },
      agent: { build: { model: "alibaba/qwen-plus" } },
    }),
  )
}

// 收集一个会话窗口内真实发布的所有 Metrics.ToolCall 事件。
interface CapturedToolCall {
  tool_name: string
  tool_call_id: string
  tool_call_status: "success" | "error" | "cancelled"
  diagnostic?: Record<string, unknown>
  agentID?: string
  input_bytes: number
  output_bytes: number
}

describe("Immune V1 — 真实正常路径 (T2) 与 真实 Core→C1 (T3)", () => {
  test("T2: 真实 read 成功 → success 事件无 diagnostic，窗口内无 error 事件", { timeout: 60_000 }, async () => {
    await using tmp = await tmpdir({ git: true })
    const readmePath = path.join(tmp.path, "README.md")
    // 真实成功：read 一个存在的文件。
    const stub = startScriptedLLMServer([
      { lines: toolCallResponse({ id: "call_t2_ok", name: "read", args: JSON.stringify({ file_path: readmePath }) }) },
      { lines: textStopResponse("done.") },
    ])
    try {
      await Bun.write(readmePath, "# Hello T2\n")
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const bus = yield* Bus.Service
              const session = yield* sessions.create({ title: "immune-t2-success" })

              const captured: CapturedToolCall[] = []
              const off = yield* bus.subscribeCallback(Metrics.ToolCall, (event) => {
                if (event.properties.sessionID !== session.id) return
                captured.push(event.properties as unknown as CapturedToolCall)
              })
              yield* Effect.addFinalizer(() => Effect.sync(off))

              const result = yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                parts: [{ type: "text", text: "Read the README." }],
              })
              expect(result.info.role).toBe("assistant")

              // 真实发布被捕获：至少有一次 read 调用。
              const readCalls = captured.filter((c) => c.tool_name === "read")
              expect(readCalls.length).toBeGreaterThanOrEqual(1)

              for (const c of readCalls) {
                // T2 核心断言 1：真实成功事件 status = success。
                expect(c.tool_call_status).toBe("success")
                // T2 核心断言 2：成功事件不携带错误诊断（正常不产生诊断）。
                expect(c.diagnostic).toBeUndefined()
                // tool_call_id 非空（cid 归因可关联）。
                expect(typeof c.tool_call_id).toBe("string")
                expect(c.tool_call_id.length).toBeGreaterThan(0)
              }

              // T2 核心断言 3：正常成功窗口内不产生任何 error 事件（C1 无从写错误账本）。
              const errorEvents = captured.filter((c) => c.tool_call_status === "error")
              expect(errorEvents).toHaveLength(0)

              // T2 核心断言 4：无 cancelled 误报。
              const cancelled = captured.filter((c) => c.tool_call_status === "cancelled")
              expect(cancelled).toHaveLength(0)
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })

  test("T3: 真实 read 执行失败 → error 事件携带完整 7 字段 diagnostic + cid，未走 legacy，不重复发布", { timeout: 60_000 }, async () => {
    await using tmp = await tmpdir({ git: true })
    const missingPath = path.join(tmp.path, "NO_SUCH_IMMUNE_FILE.txt")
    // 真实执行失败：read 一个 schema 合法但不存在的文件。
    // read 工具内部真实抛错 → 真实 processor.ts tool-error → classifyToolError → bus.publish。
    const stub = startScriptedLLMServer([
      { lines: toolCallResponse({ id: "call_t3_err", name: "read", args: JSON.stringify({ file_path: missingPath }) }) },
      { lines: textStopResponse("handled.") },
    ])
    try {
      await writeConfig(tmp.path, stub.origin)
      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          run(
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const bus = yield* Bus.Service
              const session = yield* sessions.create({ title: "immune-t3-error" })

              const captured: CapturedToolCall[] = []
              const done = yield* Deferred.make<void>()
              const off = yield* bus.subscribeCallback(Metrics.ToolCall, (event) => {
                if (event.properties.sessionID !== session.id) return
                const p = event.properties as unknown as CapturedToolCall
                captured.push(p)
                if (p.tool_name === "read" && p.tool_call_status === "error") {
                  Deferred.done(done, undefined as void)
                }
              })
              yield* Effect.addFinalizer(() => Effect.sync(off))

              yield* prompt.prompt({
                sessionID: session.id,
                agent: "build",
                parts: [{ type: "text", text: "Read the missing file." }],
              })

              // 等待真实 error 事件发布（避免 loop 返回后事件未落地）。
              yield* Deferred.await(done).pipe(
                Effect.timeoutOption(15000),
              )

              const readErrors = captured.filter(
                (c) => c.tool_name === "read" && c.tool_call_status === "error",
              )
              // 真实 error 事件至少一次。
              expect(readErrors.length).toBeGreaterThanOrEqual(1)

              // 不重复发布：同 tool_call_id 的 error 事件只应有一条。
              const byId = new Map<string, number>()
              for (const c of readErrors) {
                byId.set(c.tool_call_id, (byId.get(c.tool_call_id) ?? 0) + 1)
              }
              for (const [, count] of byId) {
                expect(count).toBe(1)
              }

              for (const c of readErrors) {
                // T3 核心断言：真实 diagnostic 存在且非 legacy（legacy 无 diagnostic）。
                expect(c.diagnostic).toBeDefined()
                const d = c.diagnostic as Record<string, unknown>
                // 7 个诊断字段全部存在。
                expect(d.error_category).toBeDefined()
                expect(d.error_stage).toBeDefined()
                expect(d.error_name).toBeDefined()
                expect(d.severity).toBeDefined()
                expect(d.recoverability).toBeDefined()
                expect(d.diagnosis_status).toBeDefined()
                expect(d.error_source).toBeDefined()
                // 三态 recoverability 合法值。
                expect(["recoverable", "non_recoverable", "unknown"]).toContain(d.recoverability)
                // 诊断状态合法值。
                expect(["detected", "classified", "investigated", "verified", "unresolved"]).toContain(
                  d.diagnosis_status,
                )
                // tool_call_id / cid 关联一致（事件自带 id 非空）。
                expect(typeof c.tool_call_id).toBe("string")
                expect(c.tool_call_id.length).toBeGreaterThan(0)
              }
            }),
          ),
      })
    } finally {
      await stub.stop()
    }
  })
})
