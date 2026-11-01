# E · Immune V1 冻结验证

任务编号：EC-PHASE2-P0-02-V  
日期：2026-10-31

---

## 冻结锚点

| 锚点 | 值 |
|------|-----|
| Tag | `immune-v1.0.0` |
| Freeze Commit | `0939522c515b7e1a7188bd0e9b08aa3091e45cb5` |

## 冻结文件哈希验证（E2E 后）

| 文件 | 冻结哈希 | 当前哈希 | 结果 |
|------|----------|----------|------|
| `classify.ts` | `38dad26f…` | `38dad26f…` | **MATCH** |
| `event.ts` | `4f4cb9f3…` | `4f4cb9f3…` | **MATCH** |
| `immune-memory.ts` | `11bbcbc7…` | `11bbcbc7…` | **MATCH** |
| `tolerance.ts` | `a0474968…` | `a0474968…` | **MATCH** |
| `processor.ts` | `c232a6a3…` | `c232a6a3…` | **MATCH** |
| `immune-real-path.test.ts` | `7c0f4e36…` | `7c0f4e36…` | **MATCH** |

**6/6 MATCH**——重建 + E2E 全程未触碰 V1 冻结文件。

## 本次修改的文件范围

| 文件 | 状态 | 说明 |
|------|------|------|
| `packages/cli/src/session/prompt.ts` | **已修改**（a5d7813） | L2 修复点，不在冻结集合 |

## 诊断契约验证

| 项 | 验证 |
|----|------|
| `classifyToolError` 签名 | 未变 |
| `DiagnosticInfo` 7 字段 | 未变（event.ts 未修改） |
| `Metrics.ToolCall` schema | 未变 |
| C1 消费路径 | 未变 |

**Immune V1 冻结边界完整。**
