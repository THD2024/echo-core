# C · L2 根因分析

任务编号：EC-PHASE2-P0-02 / WP-03  
日期：2026-10-31  
关联：`bench/phase2-assessment/C-EXECUTION-ASSESSMENT.md` §9-1、`D-LEGACY-ISSUES-RISKS.md` L2

---

## 1. 缺陷描述

bash 工具在进程退出码非零时，仍向上层（Metrics/Immune/C1）发布 `tool_call_status: "success"`，导致失败被伪装为成功。

## 2. 根因定位

### 2.1 bash.ts 层（工具本体）

**位置**：`packages/cli/src/tool/bash.ts:780-795`

```typescript
const exit = yield* Effect.raceAll([
  handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
  abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
  timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
])
// ...
return exit.kind === "exit" ? exit.code : null
```

exit code 被正确捕获并返回。但后续组装输出时（`bash.ts:799-858`）：
- `<bash_metadata>` 仅在 `expired` 或 `aborted` 时追加
- **exit code 本身从未进入 metadata**
- 工具返回的是"成功"的 `ToolResult`（含 output 文本），exit code 只是 `metadata.exit` 字段

### 2.2 prompt.ts 层（Metrics 发布）——**核心缺陷**

**位置**：`packages/cli/src/session/prompt.ts:1960-1970`（修复前）

```typescript
yield* bus.publish(Metrics.ToolCall, {
  // ...
  tool_call_status: "success",  // ← 硬编码，不检查 exit code
})
```

无论 bash exit code 是 0 还是非零，`tool_call_status` 恒为 `"success"`。

### 2.3 下游影响链

```
bash exit≠0
  → bash.ts 返回"成功" ToolResult（exit code 在 metadata.exit）
  → prompt.ts 发布 Metrics.ToolCall status="success"  ← 缺陷点
  → C1 订阅 metrics.tool_call → 记 st:"success"
  → Immune classifyToolError 从未被调用
  → stats.jsonl 记录 success
  → 成功率统计虚高
```

## 3. 影响范围

| 影响面 | 说明 |
|--------|------|
| 统计失真 | bash 是最高频工具；exit≠0 全部记 success → 成功率虚高 |
| Immune 盲区 | 7 字段分类链路对 bash 失败完全不触发 |
| C1 观测缺失 | stats.jsonl 无 bash 失败记录，无法归因 |
| 上层决策 | Plan/Goal 无法从 Metrics 感知 bash 失败 |

## 4. 与 Immune V1 的关系

- Immune V1 的 `classifyToolError` 本身**无缺陷**——它被正确调用时能正确分类
- 缺陷在调用链上游：`prompt.ts` 从未在 bash exit≠0 时调用 `classifyToolError`
- 修复不影响 V1 冻结契约（不改 classify.ts / event.ts / processor.ts）

## 5. 证据

- 基线数据：`evidence/l2-baseline-raw.json`（11 场景客观 exit code）
- 代码位置：`bash.ts:780-795`（exit 捕获）、`prompt.ts:1968`（硬编码 success）
- 历史审计：`bench/phase2-assessment/C-EXECUTION-ASSESSMENT.md` §9-1
