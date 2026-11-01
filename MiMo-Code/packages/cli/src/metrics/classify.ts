// Echo Immune System V1 · 错误分类辅助
// 在最接近异常发生的位置识别错误性质，保留原始异常信息。
// 不通过工具名称猜测错误；不把 recoverable 直接等同于参数错误。

import { isRecoverableError } from "@/tool/recoverable"
import type { DiagnosticInfoType, ErrorCategoryType, ErrorStageType, RecoverabilityType } from "./event"

/**
 * 根据错误对象和上下文分类工具错误。
 * 在 processor.ts 的 tool-error handler 中调用，是最接近异常发生的位置。
 */
export function classifyToolError(
  error: unknown,
  toolName: string,
  options?: {
    /** 工具是否在注册表中存在（用于区分 tool_not_found vs tool_parameter） */
    toolRegistered?: boolean
    /** 是否为取消操作 */
    cancelled?: boolean
  },
): DiagnosticInfoType {
  const errorName = getErrorName(error)
  const errorMessage = getErrorMessage(error)
  const recoverability = getRecoverability(error)

  // 1. 取消事件
  // 覆盖理由：取消信号来自 options.cancelled（上下文），不在 error 对象里，
  // getRecoverability 无法从 error 推断。取消可由调用方重新发起 → recoverable。
  if (options?.cancelled) {
    return {
      error_category: "tool_cancelled",
      error_stage: "unknown",
      error_name: errorName,
      severity: "info",
      recoverability: "recoverable",
      diagnosis_status: "classified",
      error_source: "processor:tool-error",
    }
  }

  // 2. 工具未注册
  // 覆盖理由：未注册信号来自 options.toolRegistered（上下文），不在 error 对象里。
  // 同一 toolName 重试必然同样失败，除非先注册工具 → non_recoverable。
  if (options?.toolRegistered === false) {
    return {
      error_category: "tool_not_found",
      error_stage: "validation",
      error_name: errorName,
      severity: "error",
      recoverability: "non_recoverable",
      diagnosis_status: "classified",
      error_source: "ai-sdk:NoSuchTool",
    }
  }

  // 3. RecoverableError（参数校验失败、格式错误、未知 ID 等）
  // 注意：RecoverableError 覆盖多种可恢复场景，不完全等价于 tool_parameter。
  // 参数校验失败一定产生 RecoverableError，这是最可靠的信号。
  // 无法可靠识别错误性质时 → unknown（不因发生在执行阶段就推断为 tool_execution）。
  // recoverability 统一取自 getRecoverability（单一真相源），不再分支硬编码。
  if (isRecoverableError(error)) {
    const isParamError = isParameterValidationError(error, errorMessage)
    if (isParamError) {
      return {
        error_category: "tool_parameter",
        error_stage: "validation",
        error_name: errorName,
        severity: "warning",
        recoverability,
        diagnosis_status: "classified",
        error_source: "tool.ts:wrap",
      }
    }
    // RecoverableError 但非参数错误：无法可靠识别错误性质 → unknown
    return {
      error_category: "unknown",
      error_stage: "execution",
      error_name: errorName,
      severity: "warning",
      recoverability,
      diagnosis_status: "classified",
      error_source: "tool.ts:wrap",
    }
  }

  // 4. ZodError（直接抛出的 schema 校验错误）
  if (errorName === "ZodError" || errorName === "Error" && errorMessage?.includes("Invalid input")) {
    return {
      error_category: "tool_parameter",
      error_stage: "validation",
      error_name: errorName,
      severity: "warning",
      recoverability,
      diagnosis_status: "classified",
      error_source: "zod:parse",
    }
  }

  // 5. 权限拒绝
  if (isPermissionDenied(errorName, errorMessage)) {
    return {
      error_category: "permission_denied",
      error_stage: "permission",
      error_name: errorName,
      severity: "warning",
      recoverability,
      diagnosis_status: "classified",
      error_source: "permission:check",
    }
  }

  // 6. 超时
  if (isTimeoutError(errorName, errorMessage)) {
    return {
      error_category: "timeout",
      error_stage: "execution",
      error_name: errorName,
      severity: "error",
      recoverability,
      diagnosis_status: "classified",
      error_source: "executor:timeout",
    }
  }

  // 7. 可识别的执行失败（精确匹配，非模糊推断）
  // 仅当错误信息明确指向执行阶段的具体失败模式时才归为 tool_execution。
  if (isIdentifiableExecutionFailure(errorName, errorMessage)) {
    return {
      error_category: "tool_execution",
      error_stage: "execution",
      error_name: errorName,
      severity: "error",
      recoverability: recoverability,
      diagnosis_status: "classified",
      error_source: "tool:execute",
    }
  }

  // 8. 无法可靠识别错误性质 → unknown
  // 不因错误发生在执行阶段就推断为 tool_execution。
  // error_stage 可以是 execution，但 error_category 保持 unknown。
  return {
    error_category: "unknown",
    error_stage: "execution",
    error_name: errorName,
    severity: "error",
    recoverability: recoverability,
    diagnosis_status: "classified",
    error_source: "tool:execute",
  }
}

/**
 * 判断是否为参数校验错误。
 * RecoverableError 的 message 中包含 "Invalid arguments" 或 "Invalid input" 时判定为参数错误。
 * ZodError（schema 校验）本质也是参数校验失败，故一并纳入，保证 getRecoverability 与分支 4 口径一致。
 */
function isParameterValidationError(error: unknown, message?: string): boolean {
  if (getErrorName(error) === "ZodError") return true
  if (!message) return false
  return (
    message.includes("Invalid arguments") ||
    message.includes("Invalid input") ||
    message.includes("expected") && message.includes("received") ||
    message.includes("Required") ||
    message.includes("formatValidationError")
  )
}

/** 超时信号：类名 TimeoutError 或消息含 timeout / aborted。helper 与分支 6 共用，保证口径一致。 */
function isTimeoutError(errorName: string, message?: string): boolean {
  return errorName === "TimeoutError" || !!message && (message.includes("timeout") || message.includes("aborted"))
}

/** 权限拒绝信号：类名 RejectedError 或消息含 permission / rejected。helper 与分支 5 共用，保证口径一致。 */
function isPermissionDenied(errorName: string, message?: string): boolean {
  return errorName === "RejectedError" || !!message && (message.includes("permission") || message.includes("rejected"))
}

/** 工具未注册信号：类名 NoSuchToolError。helper 与分支 2（toolRegistered=false）语义一致。 */
function isNoSuchToolError(errorName: string): boolean {
  return errorName === "NoSuchToolError"
}

/**
 * 判断是否为可识别的执行失败。
 * 仅匹配明确指向执行阶段具体失败模式的错误，不做模糊推断。
 */
function isIdentifiableExecutionFailure(errorName: string, message?: string): boolean {
  if (!message) return false
  // 文件操作失败
  if (message.includes("File not found") || message.includes("ENOENT")) return true
  if (message.includes("No such file") || message.includes("directory")) return true
  // 网络/连接失败
  if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) return true
  if (message.includes("connection refused") || message.includes("network")) return true
  // 权限/访问失败（执行阶段的文件权限）
  if (message.includes("EACCES") || message.includes("permission denied")) return true
  // 命令/进程失败
  if (message.includes("command not found") || message.includes("exit code")) return true
  return false
}

function getErrorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    return String((error as any).name)
  }
  return "Unknown"
}

function getErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as any).message)
  }
  if (typeof error === "string") return error
  return undefined
}

/**
 * 三态恢复能力判断 —— 分类器内 recoverability 的唯一真相源。
 * classifyToolError 各基于错误对象的分支一律取本函数结果，不再各自硬编码，
 * 从而保证"同一错误对象 → helper 与最终 DiagnosticInfo 结论一致"。
 *
 * 判断依据（按优先级）：
 * 1. recoverable：RecoverableError 实例/结构标记（模型可在下一轮修正），
 *    或参数校验错误（改对参数即成功），或超时（重试通常成功）。
 * 2. non_recoverable：工具未注册（NoSuchToolError）、权限拒绝（RejectedError / permission / rejected）——
 *    同一输入重试必然同样失败。
 * 3. unknown：证据不足，不做推断（如普通 Error("File not found")、自定义错误）。
 *
 * 不允许把所有非 RecoverableError 统一归为 non_recoverable——那会把"未知"伪装成"确定不可恢复"。
 *
 * 注：取消（options.cancelled）与 toolRegistered=false 两个分支的信号不在 error 对象里，
 * 由 classifyToolError 用 options 显式覆盖，不经本函数。
 */
function getRecoverability(error: unknown): RecoverabilityType {
  // 证据充分：RecoverableError（agent 可修正）
  if (isRecoverableError(error)) return "recoverable"

  const errorName = getErrorName(error)
  const message = getErrorMessage(error) ?? ""

  // 证据充分：参数校验失败（含 ZodError）→ 改对参数即成功
  if (isParameterValidationError(error, message)) return "recoverable"
  // 证据充分：超时 → 重试通常成功
  if (isTimeoutError(errorName, message)) return "recoverable"

  // 证据充分：工具未注册 → 重试无意义
  if (isNoSuchToolError(errorName)) return "non_recoverable"
  // 证据充分：权限拒绝 → 同一权限下重试结果相同
  if (isPermissionDenied(errorName, message)) return "non_recoverable"

  // 证据不足 → unknown
  // 例如：普通 Error("File not found")、自定义错误等，仅凭错误对象无法可靠判断。
  return "unknown"
}
