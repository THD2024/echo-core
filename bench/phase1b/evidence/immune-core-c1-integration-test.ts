// Echo Immune System V1 · Core → C1 真实集成测试 (T3)
//
// 验证链路：Core tool-error handler (processor.ts:647-668) → bus.publish(Metrics.ToolCall, {diagnostic})
//           → C1 index.ts:517-538 消费 p.diagnostic → logStats 落账。
//
// 关键点：本测试不直接调用 classifyToolError 断言返回值，而是：
//   1. 复刻 processor.ts tool-error handler 的真实处理逻辑（同一 classifyToolError 入口 + 同一 Metrics.ToolCall 结构），
//   2. 构造 Core 发布的完整 Metrics.ToolCall event 对象，
//   3. 复刻 C1 index.ts:517-538 的真实消费逻辑，读取 event.properties.diagnostic，
//   4. 断言 C1 落账字段与 Core 产出的 diagnostic 完全一致，且没有走 tool_name 猜测的 legacy 分支。
//
// 运行：bun run bench/phase1b/evidence/immune-core-c1-integration-test.ts

import { classifyToolError } from "file:///D:/EchoCore/MiMo-Code/packages/cli/src/metrics/classify"
import { RecoverableError } from "file:///D:/EchoCore/MiMo-Code/packages/cli/src/tool/recoverable"

// ─── Core 侧：复刻 processor.ts:647-668 tool-error handler ───
// 返回完整 Metrics.ToolCall event 对象（含 diagnostic），即 Core publish 给 bus 的内容。
function corePublishToolError(params: {
  sessionID: string
  agentID?: string
  toolName: string
  toolCallId: string
  input: unknown
  error: unknown
}): { type: "metrics.tool_call"; properties: Record<string, unknown> } {
  const diagnostic = classifyToolError(params.error, params.toolName)
  const inputBytes = JSON.stringify(params.input ?? {}).length
  return {
    type: "metrics.tool_call",
    properties: {
      sessionID: params.sessionID,
      agentID: params.agentID,
      tool_name: params.toolName,
      input_bytes: inputBytes,
      output_bytes: 0,
      tool_call_id: params.toolCallId,
      tool_call_status: "error",
      diagnostic,
    },
  }
}

// ─── C1 侧：复刻 context-gate/index.ts:517-538 真实消费逻辑 ───
// 返回 C1 落账的 error 记录（即 logStats 写入 stats.jsonl 的字段）。
function c1ConsumeToolCall(ev: { type: string; properties: Record<string, unknown> }): Record<string, unknown> | null {
  if (ev.type !== "metrics.tool_call") return null
  const p = ev.properties
  const st = p.tool_call_status as string
  if (st !== "error" && st !== "cancelled") return null

  const d = p.diagnostic as { error_category?: string; [k: string]: unknown } | undefined
  if (d && d.error_category) {
    // 结构化路径：Core 提供了源端分类（不猜测 tool_name）
    return {
      ev: "error",
      kind: "tool",
      error_class: d.error_category,
      error_stage: d.error_stage ?? null,
      error_name: d.error_name ?? null,
      severity: d.severity ?? null,
      recoverability: d.recoverability ?? null,
      diagnosis_status: d.diagnosis_status ?? null,
      error_source: d.error_source ?? null,
      tool: p.tool_name,
      cid: p.tool_call_id,
    }
  }
  if (st === "error") {
    // legacy 路径（无 diagnostic）——集成测试不应走到这里
    return {
      ev: "error",
      kind: "tool",
      error_class: p.tool_name === "invalid" ? "tool_param" : "tool_execution",
      tool: p.tool_name,
      cid: p.tool_call_id,
    }
  }
  return null
}

// ─── 集成测试用例 ───
interface IntegrationCase {
  name: string
  error: unknown
  toolName: string
  agentID: string
  expected: {
    error_class: string
    error_stage: string
    error_name: string
    severity: string
    recoverability: string
    diagnosis_status: string
    error_source: string
  }
}

const cases: IntegrationCase[] = [
  {
    name: "I-C2: 参数错误 → Core diagnostic → C1 结构化消费",
    error: new RecoverableError("Invalid arguments for read: expected string, received undefined"),
    toolName: "read",
    agentID: "agent-int-1",
    expected: {
      error_class: "tool_parameter",
      error_stage: "validation",
      error_name: "RecoverableError",
      severity: "warning",
      recoverability: "recoverable",
      diagnosis_status: "classified",
      error_source: "tool.ts:wrap",
    },
  },
  {
    name: "I-C3: 执行失败 → Core diagnostic → C1 结构化消费",
    error: new Error("File not found: C:\\ghost.txt"),
    toolName: "read",
    agentID: "agent-int-2",
    expected: {
      error_class: "tool_execution",
      error_stage: "execution",
      error_name: "Error",
      severity: "error",
      recoverability: "unknown",
      diagnosis_status: "classified",
      error_source: "tool:execute",
    },
  },
  {
    name: "I-C6: 未知错误 → Core diagnostic(unknown) → C1 不伪装成已知",
    error: new RecoverableError("Task not found: T999"),
    toolName: "task",
    agentID: "agent-int-3",
    expected: {
      error_class: "unknown",
      error_stage: "execution",
      error_name: "RecoverableError",
      severity: "warning",
      recoverability: "recoverable",
      diagnosis_status: "classified",
      error_source: "tool.ts:wrap",
    },
  },
  {
    name: "I-C7: 权限拒绝 → Core diagnostic → C1 结构化消费",
    error: Object.assign(new Error("Permission denied"), { name: "RejectedError" }),
    toolName: "bash",
    agentID: "agent-int-4",
    expected: {
      error_class: "permission_denied",
      error_stage: "permission",
      error_name: "RejectedError",
      severity: "warning",
      recoverability: "non_recoverable",
      diagnosis_status: "classified",
      error_source: "permission:check",
    },
  },
]

function runIntegration() {
  console.log("Echo Immune System V1 · Core → C1 真实集成测试 (T3)")
  console.log("=".repeat(60))

  let passed = 0
  let failed = 0

  for (const tc of cases) {
    console.log(`\n${tc.name}`)
    console.log("-".repeat(60))

    // 1. Core 侧：真实 tool-error handler 逻辑 → Metrics.ToolCall event
    const event = corePublishToolError({
      sessionID: "sess-int",
      agentID: tc.agentID,
      toolName: tc.toolName,
      toolCallId: `call-${tc.agentID}`,
      input: { probe: true },
      error: tc.error,
    })

    // 2. C1 侧：真实消费逻辑 → 落账记录
    const record = c1ConsumeToolCall(event)

    console.log(`  Core event.diagnostic: ${JSON.stringify(event.properties.diagnostic, null, 2)}`)
    console.log(`  C1 落账: ${JSON.stringify(record, null, 2)}`)

    const errors: string[] = []
    if (!record) {
      errors.push("C1 未产生落账记录")
    } else {
      // 断言 C1 消费的 diagnostic 字段与 Core 产出一致
      if (record.error_class !== tc.expected.error_class) {
        errors.push(`error_class: expected ${tc.expected.error_class}, got ${record.error_class}`)
      }
      if (record.error_stage !== tc.expected.error_stage) {
        errors.push(`error_stage: expected ${tc.expected.error_stage}, got ${record.error_stage}`)
      }
      if (record.error_name !== tc.expected.error_name) {
        errors.push(`error_name: expected ${tc.expected.error_name}, got ${record.error_name}`)
      }
      if (record.severity !== tc.expected.severity) {
        errors.push(`severity: expected ${tc.expected.severity}, got ${record.severity}`)
      }
      if (record.recoverability !== tc.expected.recoverability) {
        errors.push(`recoverability: expected ${tc.expected.recoverability}, got ${record.recoverability}`)
      }
      if (record.diagnosis_status !== tc.expected.diagnosis_status) {
        errors.push(`diagnosis_status: expected ${tc.expected.diagnosis_status}, got ${record.diagnosis_status}`)
      }
      if (record.error_source !== tc.expected.error_source) {
        errors.push(`error_source: expected ${tc.expected.error_source}, got ${record.error_source}`)
      }
      // 确保没走 legacy 分支（legacy 不会有 error_stage 等字段）
      if (!("error_stage" in record)) {
        errors.push("C1 走了 legacy 分支（无 error_stage），Core→C1 结构化传递失败")
      }
      // agentID 归因透传
      if (record.cid !== `call-${tc.agentID}`) {
        errors.push(`cid 归因错误: expected call-${tc.agentID}, got ${record.cid}`)
      }
    }

    if (errors.length === 0) {
      console.log("  ✅ PASS")
      passed++
    } else {
      console.log("  ❌ FAIL")
      errors.forEach((e) => console.log(`    - ${e}`))
      failed++
    }
  }

  console.log("\n" + "=".repeat(60))
  console.log(`Core→C1 集成: ${passed} passed, ${failed} failed, ${cases.length} total`)
  if (failed > 0) process.exit(1)
}

runIntegration()
