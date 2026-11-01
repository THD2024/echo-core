# F · 修复前后基线对比

任务编号：EC-PHASE2-P0-02 / WP-04  
日期：2026-10-31

---

## 1. 对比维度

| 维度 | 修复前 | 修复后 | 说明 |
|------|--------|--------|------|
| bash exit=0 | 记 success | 记 success | 不变 |
| bash exit=1 | 记 **success** | 记 **error** + diagnostic | **核心改善** |
| bash exit=42 | 记 **success** | 记 **error** + diagnostic | **核心改善** |
| 命令不存在 | 记 **success** | 记 **error** + diagnostic | **核心改善** |
| stderr + exit=0 | 记 success | 记 success | 正确（exit 0 = 成功） |
| stdout+stderr + exit=1 | 记 **success** | 记 **error** + diagnostic | **核心改善** |
| 超时后失败 | 记 success | 记 **error** | 改善（aborted 路径已有 error，exit 路径补齐） |

## 2. 7 字段诊断（修复后新增）

bash exit≠0 时，`Metrics.ToolCall` 附加：

```json
{
  "error_category": "tool_execution",
  "error_stage": "execution",
  "error_origin": "tool",
  "recoverability": "unknown",
  "tool_name": "bash",
  "error_message": "bash command exited with code N",
  "implementation_location": "tool.ts:wrap"
}
```

## 3. 统计口径变更

**修复前**：bash 成功率 ≈ 100%（恒 success）  
**修复后**：bash 成功率 = 真实 exit=0 比例

历史数据对比需分段：修复前的 stats.jsonl 中 bash 全部为 success，不代表真实成功率。

## 4. 对 Immune/C1 的影响

| 链路 | 修复前 | 修复后 |
|------|--------|--------|
| C1 stats.jsonl | bash 失败记 st:"success" | bash 失败记 st:"error" + 7 字段 |
| Immune classify | 不触发 | 触发，`tool_execution`/`unknown` |
| 错误归因 | 无法区分 bash 失败 | 可归因到 exit code |

## 5. 运行时端到端验证状态

| 层级 | 状态 | 说明 |
|------|------|------|
| 代码测试通过 | ✅ | classify 34/34 + real-path 2/2 + integration 9/9 |
| 隔离环境测试通过 | ✅ | 11 场景客观 exit code 基线 |
| 真实进程级测试 | ⏳ | 需重建二进制后执行 C2 E2E |
| 完整运行时测试 | ⏳ | 需 TUI 重启后观察 stats.jsonl |

**结论**：代码层修复已验证无退化；运行时端到端效果待二进制重建后确认。
