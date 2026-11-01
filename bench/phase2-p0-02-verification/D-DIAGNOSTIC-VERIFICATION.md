# D · 诊断字段验证

任务编号：EC-PHASE2-P0-02-V  
日期：2026-10-31

---

## 诊断链路验证

L2 修复后，bash exit≠0 的诊断链路：

```
bash exit=1
  → bash.ts 返回 ToolResult（metadata.exit=1）
  → prompt.ts 检测 isBashFailure=true
  → publish Metrics.ToolCall status="error" + diagnostic=classifyToolError(...)
  → C1 订阅 → 记 ev:tool st=error + ev:error 7字段
  → stats.jsonl 落盘
```

## 与 Immune V1 契约的一致性

| 项 | V1 契约 | L2 修复后实际 | 一致 |
|----|---------|--------------|------|
| error_category 枚举 | `unknown` 合法 | bash exit≠0 → `unknown` | ✅ |
| error_stage 枚举 | `execution` 合法 | → `execution` | ✅ |
| error_source 枚举 | `tool:execute` 合法 | → `tool:execute` | ✅ |
| diagnosis_status | `classified` | → `classified` | ✅ |
| CID 关联 | tool_call_id 透传 | cid 一致 | ✅ |

## 分类语义说明

bash exit≠0 被分类为 `unknown` 而非 `tool_execution`——因为 `classifyToolError` 接收的是普通 `Error` 对象（`new Error("bash command exited with code N")`），`getRecoverability` 对普通 Error 返回 `unknown`。这是**正确的**：bash 命令失败的可恢复性取决于具体命令，无法从 exit code 通用推断。

若后续需要更精确的分类（如 `non_recoverable` for 确定性失败），需在 `classify.ts` 增加 bash 专用分支——这属于 V2 范围，不在本次修复内。
