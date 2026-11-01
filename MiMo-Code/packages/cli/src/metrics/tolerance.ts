// Echo Immune System V1 · 免疫耐受原则
// 建立基本的正常行为和未知行为处理原则。
// 目标：识别正常行为，避免误报和错误干预。

/**
 * 免疫耐受原则（V1）
 * 
 * 这些原则指导免疫系统如何区分正常行为和异常行为，
 * 以及如何处理未知事件。
 */
export const TOLERANCE_PRINCIPLES = {
  /**
   * 1. 正常事件不产生错误告警
   * 成功的工具调用、正常的模型响应、预期的空结果等
   * 都不应触发错误事件。
   */
  NO_FALSE_POSITIVES: "正常事件不产生错误告警",

  /**
   * 2. 合法的空结果不能被默认视为故障
   * 例如：搜索无结果、文件为空、列表为空等
   * 这些是合法的业务结果，不是系统故障。
   */
  LEGITIMATE_EMPTY_RESULTS: "合法的空结果不能被默认视为故障",

  /**
   * 3. 重复事件需要有明确关联，避免重复诊断
   * 同一个 cid 的多次错误事件应合并诊断，
   * 不应产生重复的告警。
   */
  DEDUPLICATE_CORRELATED_EVENTS: "重复事件需要有明确关联，避免重复诊断",

  /**
   * 4. 未知事件保留证据，不擅自归为已知故障
   * 无法分类的错误应标记为 unknown，
   * 保留原始证据，等待进一步调查。
   */
  PRESERVE_UNKNOWN_EVIDENCE: "未知事件保留证据，不擅自归为已知故障",

  /**
   * 5. 不得通过屏蔽告警或放宽阈值制造健康假象
   * 免疫系统的目的是发现问题，不是掩盖问题。
   * 任何抑制告警的行为都必须有明确的理由和记录。
   */
  NO_HEALTH_WASHING: "不得通过屏蔽告警或放宽阈值制造健康假象",
} as const

/**
 * 正常行为基线（V1 简化版）
 * 用于判断事件是否异常。
 */
export const NORMAL_BASELINE = {
  /** 成功的工具调用 */
  tool_success: { expected: true, severity: "none" },
  /** 模型正常响应 */
  model_normal: { expected: true, severity: "none" },
  /** 任务正常完成 */
  task_completed: { expected: true, severity: "none" },
  /** 合法的空结果 */
  empty_result: { expected: true, severity: "none" },
  /** 用户主动取消 */
  user_cancelled: { expected: true, severity: "info" },
} as const

/**
 * 判断一个事件是否在正常基线内。
 * V1 只做简单判断，不引入复杂的异常检测算法。
 */
export function isWithinNormalBaseline(event: {
  type: string
  status?: string
  severity?: string
}): boolean {
  // 成功事件永远在基线内
  if (event.status === "success") return true
  
  // 取消事件在基线内（用户主动行为）
  if (event.status === "cancelled" || event.type === "cancelled") return true
  
  // info 级别事件在基线内
  if (event.severity === "info") return true
  
  // 其他情况需要进一步判断
  return false
}

/**
 * 未知事件处理原则
 * 当无法确定事件性质时，应遵循以下原则：
 */
export const UNKNOWN_EVENT_PRINCIPLES = {
  /** 保留原始证据 */
  preserve_evidence: true,
  /** 标记为 unknown，不猜测分类 */
  mark_as_unknown: true,
  /** 记录上下文（cid, agent, tid 等） */
  record_context: true,
  /** 不触发自动响应 */
  no_auto_response: true,
  /** 等待人工或进一步调查 */
  await_investigation: true,
} as const
