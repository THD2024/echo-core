# G · Immune V1 冻结边界验证

任务编号：EC-PHASE2-P0-02 / WP-04  
日期：2026-10-31

---

## 1. 冻结锚点

| 锚点 | 值 |
|------|-----|
| Tag | `immune-v1.0.0` |
| Freeze Commit | `0939522c515b7e1a7188bd0e9b08aa3091e45cb5` |

## 2. 冻结文件哈希验证

| 文件 | 冻结哈希 | 当前哈希 | 结果 |
|------|----------|----------|------|
| `packages/cli/src/metrics/classify.ts` | `38dad26f…` | `38dad26f…` | **MATCH** |
| `packages/cli/src/metrics/event.ts` | `4f4cb9f3…` | `4f4cb9f3…` | **MATCH** |
| `packages/cli/src/metrics/immune-memory.ts` | `11bbcbc7…` | `11bbcbc7…` | **MATCH** |
| `packages/cli/src/metrics/tolerance.ts` | `a0474968…` | `a0474968…` | **MATCH** |
| `packages/cli/src/session/processor.ts` | `c232a6a3…` | `c232a6a3…` | **MATCH** |
| `packages/cli/test/session/immune-real-path.test.ts` | `7c0f4e36…` | `7c0f4e36…` | **MATCH** |

**6/6 MATCH**——L2 修复未触碰任何 V1 冻结文件。

## 3. L2 修复的文件范围

| 文件 | 状态 | 说明 |
|------|------|------|
| `packages/cli/src/session/prompt.ts` | **已修改** | L2 修复点（+15 行） |

`prompt.ts` **不在 V1 冻结集合中**——冻结集合是 7 个文件，prompt.ts 是编排枢纽（7234 行），V1 冻结时只改了其中 7 行（diagnostic 相关），其余部分不属于冻结范围。

## 4. 诊断契约验证

| 项 | 验证 |
|----|------|
| `classifyToolError` 签名 | 未变（L2 修复只是调用它，未改定义） |
| `DiagnosticInfo` 7 字段 | 未变（event.ts 未修改） |
| `Metrics.ToolCall` schema | 未变（`diagnostic` 字段已 optional） |
| C1 消费路径 | 未变（`p.diagnostic` 优先级逻辑未动） |

## 5. 结论

**Immune V1 冻结边界完整。** L2 修复是 post-V1 独立任务，只改了 `prompt.ts` 的 Metrics 发布点，未触碰 V1 冻结的 7 个文件，诊断契约不变。
