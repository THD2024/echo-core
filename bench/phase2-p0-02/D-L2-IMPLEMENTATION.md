# D · L2 修复方案与实现记录

任务编号：EC-PHASE2-P0-02 / WP-03  
日期：2026-10-31  
Commit：`a5d7813`  
批准依据：任务书 WP-03 授权范围

---

## 1. 修复方案

**最小改动原则**：只改 `prompt.ts` 的 Metrics 发布点，不动 bash.ts 工具本体，不动 Immune V1 冻结文件。

### 修改前（prompt.ts:1960-1970）

```typescript
yield* bus.publish(Metrics.ToolCall, {
  sessionID: ctx.sessionID,
  agentID: ctx.actorID,
  tool_name: item.id,
  input_bytes: Metrics.jsonByteLength(beforeOutput.args),
  output_bytes: Buffer.byteLength(output.output ?? "", "utf8"),
  tool_call_id: options.toolCallId,
  tool_call_status: "success",  // ← 硬编码
})
```

### 修改后（prompt.ts:1960-1985）

```typescript
// L2 (EC-PHASE2-P0-02): bash exit≠0 must publish error ToolCall, not success.
const bashExit = output.metadata.exit
const isBashFailure = item.id === "bash" && typeof bashExit === "number" && bashExit !== 0
yield* bus.publish(Metrics.ToolCall, {
  sessionID: ctx.sessionID,
  agentID: ctx.actorID,
  tool_name: item.id,
  input_bytes: Metrics.jsonByteLength(beforeOutput.args),
  output_bytes: Buffer.byteLength(output.output ?? "", "utf8"),
  tool_call_id: options.toolCallId,
  tool_call_status: isBashFailure ? "error" : "success",
  ...(isBashFailure
    ? {
        diagnostic: classifyToolError(
          new Error(`bash command exited with code ${bashExit}`),
          item.id,
          { toolRegistered: true },
        ),
      }
    : {}),
})
```

## 2. 改动分析

| 项 | 说明 |
|----|------|
| 文件 | `packages/cli/src/session/prompt.ts`（+15 行，-1 行） |
| 语义变更 | bash exit≠0 时 `tool_call_status` 从 `"success"` → `"error"` |
| diagnostic | 附加 `classifyToolError` 7 字段（`tool_execution` / `unknown` / `tool.ts:wrap`） |
| 不变项 | bash.ts 工具本体、返回给模型的 output 文本、`gate.fail` 调用 |
| 冻结边界 | 未触碰 classify.ts / event.ts / processor.ts / immune-memory.ts / tolerance.ts |

## 3. 语义变更声明

- bash 失败率统计口径将**真实化**——历史数据中 bash 全部为 success，修复后 exit≠0 记 error
- 历史对比需分段：修复前 vs 修复后
- 模型看到的 output 文本不变（仍是含 exit code 的完整输出）——修复只影响 Metrics/Immune 链路

## 4. 测试验证

| 检查 | 结果 |
|------|------|
| typecheck（cli） | 无新错误（存量错误在冻结文件，与本次无关） |
| classify.test | 34/34 pass |
| immune-real-path.test | 2/2 pass |
| classify-integration.test | 9/9 pass |
| 冻结文件哈希 | 6/6 MATCH（未触碰） |

## 5. 未解决问题

- 修复效果的**运行时端到端验证**需重建二进制后执行 C2 E2E——本轮不重建二进制（dc28dff1 保持）
- 修复后的 stats.jsonl 中 bash exit≠0 记录需下次 TUI 重启后验证
