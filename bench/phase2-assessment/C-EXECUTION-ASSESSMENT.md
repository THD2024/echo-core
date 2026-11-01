# C · Execution System 能力评估

任务编号：EC-PHASE2-01 / WP-03  
日期：2026-10-31  
审计方式：只读代码审计（explore-8）  
范围：工具执行链路、可靠性、反馈、检查点、子智能体

---

## 1. 执行链路

完整路径（`file:line` 锚定）：

```
模型流产出 tool-call 事件
  → processor.ts:586-637 注册 part（status=running，Deferred.succeed 放行）
  → AI SDK 调用 prompt.ts:1865 包装的 execute
  → whitelist 校验（:1879）
  → tool.execute.before hook（:1897，可 cancel）
  → item.execute（:1924）
  → ToolSettlement.record（:1940）
  → tool.execute.after hook（:1941）
  → processor.executeTool（:1976→processor.ts:451）
  → toolGate.run 准入 → completeToolCall/failToolCall 持久化
  → 返回值经 AI SDK 回传模型
```

**证据**：[已接入][有测试]（processor / gate / settlement 测试覆盖）

## 2. 各工具错误处理差异

| 工具 | 失败行为 | 对 Immune 的影响 |
|------|----------|-----------------|
| **bash** | exit≠0 **不抛错**——含 `<bash_metadata>` 的成功结果返回；Metrics 仍记 success | **L2 已知缺口**：C1/Immune 错误分类对最高频工具盲区 |
| **read** | `Effect.fail(Error)` → error ToolCall | 正确进入 Immune 分类 |
| **edit** | `throw` + `Effect.orDie`；not-found 附 closest-match | agent 可自纠 |
| **write** | `Effect.orDie`，无 Recoverable 区分 | fs 错误全变 defect |
| **actor** | 服务缺失 → `RecoverableError`（TUI 静音但全文给模型） | 正确 |
| **task** | not-found → `Effect.die(RecoverableError)` | 正确 |

## 3. 可靠性

| 项 | 现状 | 证据 |
|----|------|------|
| 超时 | bash 默认 2min 可传参（超时 kill+3s force）；actor blocking 600s；**本地工具无统一全局超时** | [已接入][有测试] |
| 重复调用防护 | 无幂等键；doom-loop 检测（连续 N 次相同输入触发权限询问） | [已接入] |
| 整步重放 | `ctx.retrySafe=false` 禁止 | [已接入] |
| 中断恢复 | ToolSettlement abort + 用已记录结果完成 ToolCall；orphan sweep 清理崩溃遗留 | [已接入][有测试] |
| 部分成功 | bash 输出截断落盘给 outputPath；actor 失败附 partial；同批失败级联取消 | [已接入] |

## 4. 反馈回传

- 输出统一经 `truncate.output` 截断并标 `metadata.truncated + outputPath`——**有落盘指针，非静默截断**
- 错误识别：bash 靠 metadata.exit 解析；MCP 靠 isError → ToolResultError；本地工具靠抛错
- **exit≠0 不生成 error ToolCall**——模型看到"成功"结果内嵌失败文本

**"执行成功但任务未完成"场景**：bash 失败被记为 success → 模型可能基于错误前提继续。这是当前最大的反馈失真点。

## 5. 检查点/恢复

| 机制 | 现状 | 证据 |
|------|------|------|
| checkpoint.ts | 上下文溢出时的会话摘要边界（非工具级） | [已接入][有测试 ×40] |
| task 状态机 | open→in_progress→blocked/done/abandoned；SQL 持久化；terminal 拒绝复活 | [已接入][有测试] |
| 崩溃恢复 | `recovery()` 识别未完成 assistant；`resumeMainCascading` 级联恢复 idle 子 agent（cascade epoch 防失效恢复） | [已接入][有测试] |
| auto-resume | 可重试传输错误+工具已全完成 → 自动开下一步 | [已接入][有测试] |

## 6. 子智能体执行

- spawn：fork fiber + Deferred<AgentOutcome>；spawn 模式立即返回，结果经 inbox 通知
- blocking run：等 Deferred，默认 10min 超时 → status:timeout
- 取消：递归级联子 actor
- 子 agent 禁止再 spawn

**证据**：[已接入][有测试 ×10]

## 7. 自主性

- 多步骤任务可独立完成（runLoop + todo + task 状态机 + auto-resume）
- 失败策略分层：传输错误自动重试；工具失败→模型自纠；bash exit≠0→模型看到文本自行判断；权限拒绝→ctx.blocked 可中断
- **无工具级自动重试**——依赖模型下轮重发

## 8. 证据分级汇总

| 能力 | 等级 |
|------|------|
| 执行链路/gate/settlement/orphan sweep | [已接入][有测试] |
| bash 超时 | [已接入][有测试] |
| checkpoint 重建 | [已接入][有测试] |
| 崩溃恢复 cascade | [已接入][有测试] |
| auto-resume after tools | [已接入][有测试] |
| 统一工具超时 | **不存在** |
| 工具幂等键 | **不存在** |
| bash error-ToolCall 化（L2） | [代码存在缺口，未修] |

## 9. 脆弱点 Top3

1. **L2 bash exit≠0 伪装成功**（`prompt.ts:1947-1968`）——Metrics 记 success、无 error part，Immune C1 对最高频工具盲区
2. **本地工具无统一超时**（`tool.ts:47-53` 无 timeout 字段）——read/edit/write/MCP 挂起可卡 gate 队列
3. **write/edit `Effect.orDie` 无 Recoverable 区分**——普通 fs 错误以 defect 呈现，模型看到的错误形态与真实可重试性可能不匹配

## 10. Execution Flow（简化）

```
模型决定调工具
  → processor 注册 part + Deferred
  → before hook（可 cancel）
  → 实际执行（bash/read/edit/write/actor/task）
  → Settlement 记录
  → after hook
  → gate 准入 → complete/fail 持久化
  → 结果截断 → 回传模型
  → 模型下轮决策（继续/重试/报告用户）
```

## 11. Failure and Recovery Analysis

| 故障类型 | 恢复路径 | 可靠性 |
|----------|----------|--------|
| 传输错误 | retry.ts 分类预算自动重试 | 高 |
| 工具可恢复错误 | RecoverableError → 模型看到全文自纠 | 中（依赖模型） |
| bash 非零退出 | 模型从文本判断（无 error 信号） | **低（L2）** |
| 权限拒绝 | ctx.blocked 中断 | 高 |
| 进程崩溃 | recovery + cascade resume | 中 |
| 长任务中断 | checkpoint + task 状态机 | 中 |

## 12. 评估结论

**Echo 当前具备**：完整的工具执行链路、gate 准入、settlement 记录、orphan sweep、崩溃级联恢复、auto-resume、doom-loop 检测、bash 超时、子智能体生命周期管理。执行骨架**扎实且有测试覆盖**。

**Echo 当前不具备**：统一工具超时、工具幂等键、bash 失败的 error 信号（L2）、write/edit 的 RecoverableError 区分。**执行可靠性的真实短板不在"能不能调工具"，而在"失败是否被正确感知和传播"**——bash 作为最高频工具，其失败被伪装成成功，是当前链路中最大的反馈失真。
