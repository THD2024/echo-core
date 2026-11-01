import z from "zod"
import { BusEvent } from "@/bus/bus-event"

// ─── Echo Immune System V1 · 统一异常诊断数据结构 ───
// 可复用于模型调用、工具调用、任务执行、上下文治理等环节。
// 所有字段 optional，保持向后兼容。

/** 异常类别：尽可能在最接近异常发生的位置识别 */
export const ErrorCategory = z.enum([
  "tool_not_found",    // 未注册工具
  "tool_parameter",    // 参数校验失败
  "tool_execution",    // 执行阶段异常
  "tool_cancelled",    // 用户/系统取消
  "model_error",       // 模型调用异常
  "permission_denied", // 权限拒绝
  "timeout",           // 超时
  "unknown",           // 无法确定
])
export type ErrorCategoryType = z.infer<typeof ErrorCategory>

/** 错误发生阶段 */
export const ErrorStage = z.enum([
  "validation",   // 参数/schema 校验
  "execution",    // 工具实际执行
  "permission",   // 权限检查
  "model",        // 模型调用
  "transport",    // 网络/传输
  "unknown",
])
export type ErrorStageType = z.infer<typeof ErrorStage>

/** 恢复能力：与 error_category 独立 */
export const Recoverability = z.enum(["recoverable", "non_recoverable", "unknown"])
export type RecoverabilityType = z.infer<typeof Recoverability>

/** 诊断状态：区分"发现"与"根因已确认" */
export const DiagnosisStatus = z.enum([
  "detected",      // 已发现
  "classified",    // 已分类
  "investigated",  // 已调查
  "verified",      // 根因已验证
  "unresolved",    // 尚未解决
])
export type DiagnosisStatusType = z.infer<typeof DiagnosisStatus>

/** 免疫系统 V1 诊断信息（嵌入 Metrics.ToolCall 的可选字段） */
export const DiagnosticInfo = z.object({
  error_category: ErrorCategory.optional(),
  error_stage: ErrorStage.optional(),
  error_name: z.string().optional(),       // 原始错误类名（如 RecoverableError）
  severity: z.enum(["info", "warning", "error", "critical"]).optional(),
  recoverability: Recoverability.optional(),
  diagnosis_status: DiagnosisStatus.optional(),
  error_source: z.string().optional(),     // 错误来源组件（如 "tool.ts:wrap", "ai-sdk"）
})
export type DiagnosticInfoType = z.infer<typeof DiagnosticInfo>

export const ModelCall = BusEvent.define(
  "metrics.model_call",
  z.object({
    sessionID: z.string(),
    // Phase1B: optional actor attribution — parallel subagents share sessionID;
    // without agentID, token metrics cannot be attributed to a specific task.
    // Main agent: agentID is "main" or undefined (tid stays null by design).
    agentID: z.string().optional(),
    finish_reason: z.string(),
    ttft_ms: z.number().optional(),
    latency_ms: z.number(),
    cached_read_tokens: z.number(),
    model_id: z.string(),
    provider: z.string(),
    total_tokens_in: z.number(),
    total_tokens_out: z.number(),
    // Immune System V1: optional diagnostic info for model errors
    diagnostic: DiagnosticInfo.optional(),
  }),
)

export const ToolCall = BusEvent.define(
  "metrics.tool_call",
  z.object({
    sessionID: z.string(),
    // Phase1B: same attribution gap as ModelCall — parallel subagents share sessionID.
    agentID: z.string().optional(),
    tool_name: z.string(),
    input_bytes: z.number(),
    output_bytes: z.number(),
    tool_call_id: z.string(),
    tool_call_status: z.enum(["success", "error", "cancelled"]),
    // Immune System V1: structured error classification at the source.
    // C1 consumes these fields directly instead of guessing from tool_name.
    diagnostic: DiagnosticInfo.optional(),
  }),
)

export const AgentRequest = BusEvent.define(
  "metrics.agent_request",
  z.object({
    sessionID: z.string(),
    phase: z.string(),
    task_type: z.string(),
    surface: z.string(),
    total_tokens_in: z.number(),
    total_tokens_out: z.number(),
    files_changed: z.number(),
    validation_status: z.string(),
  }),
)

export const TryBestDetected = BusEvent.define(
  "metrics.try_best_detected",
  z.object({
    sessionID: z.string(),
    reason: z.enum(["edit_repeat", "bash_retry", "action_streak"]),
    provider: z.string(),
    model_id: z.string(),
    count: z.number().int().positive(),
    similarity: z.number().optional(),
    action: z.enum(["edit", "verify"]).optional(),
  }),
)
