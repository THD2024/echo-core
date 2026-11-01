// Echo Immune System V1 · 免疫记忆数据结构
// V1 只定义结构，不建设完整自主学习系统。
// 未经验证的模型推测不得直接成为正式经验。

import z from "zod"

/** 免疫记忆条目：经过验证的异常案例和处理经验 */
export const ImmuneMemoryEntry = z.object({
  /** 唯一标识 */
  id: z.string(),
  /** 异常特征（用于匹配未来类似异常） */
  anomaly_signature: z.object({
    error_category: z.string(),
    error_name: z.string(),
    tool_name: z.string().optional(),
    error_stage: z.string().optional(),
    /** 可选：错误消息的模式（正则或关键词） */
    message_pattern: z.string().optional(),
  }),
  /** 经过验证的根因 */
  verified_root_cause: z.string(),
  /** 有效处理方式 */
  effective_handling: z.string(),
  /** 验证证据（E2E 测试结果、日志片段等） */
  verification_evidence: z.array(z.object({
    type: z.enum(["e2e_test", "log", "code_review", "manual"]),
    description: z.string(),
    timestamp: z.string(),
    result: z.string(),
  })),
  /** 适用范围 */
  applicability: z.object({
    /** 适用于哪些组件/工具 */
    components: z.array(z.string()),
    /** 不适用的场景 */
    exclusions: z.array(z.string()).optional(),
  }),
  /** 失败案例与限制 */
  limitations: z.array(z.string()).optional(),
  /** 经验可信状态 */
  confidence: z.enum(["verified", "probable", "unverified"]),
  /** 创建时间 */
  created_at: z.string(),
  /** 最后验证时间 */
  last_verified_at: z.string().optional(),
  /** 关联的 E2E 测试用例 */
  related_tests: z.array(z.string()).optional(),
})

export type ImmuneMemoryEntryType = z.infer<typeof ImmuneMemoryEntry>

/**
 * 免疫记忆存储接口（V1 只定义，不实现完整存储）
 * 未来可接入 SQLite 或文件系统
 */
export interface ImmuneMemoryStore {
  /** 记录新经验（必须经过验证才能标记为 verified） */
  add(entry: ImmuneMemoryEntry): Promise<void>
  /** 按异常特征查找匹配的经验 */
  find(signature: ImmuneMemoryEntry["anomaly_signature"]): Promise<ImmuneMemoryEntry[]>
  /** 更新经验状态（如从 probable 升级为 verified） */
  updateConfidence(id: string, confidence: ImmuneMemoryEntry["confidence"]): Promise<void>
  /** 获取所有已验证的经验 */
  getVerified(): Promise<ImmuneMemoryEntry[]>
}
