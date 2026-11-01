# Echo Core / MiMoCode 核心功能模块架构审计报告

> **审计类型**: 只读深度审计（禁止修改源码）
> **源码根**: `D:\EchoCore\MiMo-Code\packages\cli\src\`
> **审计日期**: 2026-10-31
> **方法**: 逐模块读取关键实现 + 全局 Grep 交叉验证调用关系 + 测试文件存在性核对
> **实现状态枚举**: `VERIFIED` / `IMPLEMENTED_UNVERIFIED` / `PARTIAL` / `DESIGN_ONLY` / `NOT_IMPLEMENTED` / `UNKNOWN`

---

## 审计总览

| # | Echo Core 概念名 | 代码真实名称 | 实现状态 |
|---|-----------------|--------------|----------|
| 1 | Context / Prompt | `SessionPrompt` + `MessageV2` + `SessionPrune` + `SessionCompaction` | VERIFIED |
| 2 | Planning / Task | `TaskRegistry`（主）+ `SessionTodo`（辅） | VERIFIED |
| 3 | Execution / Tool | `ToolRegistry` + `SessionProcessor` + `Tool.*` | VERIFIED |
| 4 | Reflection | `AutoDream` 触发器 + `dream`/`distill` 隐藏 agent（prompt 驱动） | PARTIAL |
| 5 | Recovery | `SessionRetry` + `checkpoint-retry` + `RecoverableError` | PARTIAL |
| 6 | Immune | `metrics/classify` + `DiagnosticInfo`（半实现）；`ImmuneMemoryStore` 仅接口 | PARTIAL |
| 7 | Skills | `Skill` Service + `skill`/`skill_search` 工具 | VERIFIED |

---

## 1. Context / Prompt（上下文组装 / 压缩 / 溢出）

| 字段 | 内容 |
|------|------|
| 模块名称 | `SessionPrompt`（`@opencode/SessionPrompt`）；配套 `MessageV2`、`SessionPrune`、`SessionCompaction`、`Overflow`、`SessionCheckpoint` |
| 核心职责 | 驱动 agent 主循环 `runLoop`：从 DB 组装会话切片 → 判断继续/结束 → 调用 LLM → 处理工具 → 触发 checkpoint / 溢出重建 / 压缩边界 |
| 代码位置 | `session/prompt.ts`（约 7248 行，`runLoop` 在 `prompt.ts:3625`）；`session/message-v2.ts`；`session/overflow.ts`；`session/compaction.ts`；`session/prune.ts`；`session/checkpoint.ts` |
| 对外接口 | `Service.prompt` / `Service.loop` / `PromptInput`（`prompt.ts:6992`）/ `LoopInput`（`prompt.ts:7082`）/ `injectScheduledPrompt`（`prompt.ts:7226`）；`MessageV2.filterCompacted`（`message-v2.ts:1442`）、`filterCompactedEffect`（`message-v2.ts:1452`）、`toModelMessagesEffect`（`message-v2.ts:977`）；`Overflow.isOverflow`（`overflow.ts:99`）、`contextWindow`（`overflow.ts:80`）；`SessionPrune.fireCheckpoints`（`prune.ts:241`） |
| 调用者 | TUI/CLI prompt 路径、`server/routes`、`cron-bridge`、`command/index.ts`（`/dream` `/distill`）、`auto-dream` 触发的 detached `sp.prompt`（`prompt.ts:4661-4681`）、`injectScheduledPrompt` |
| 被依赖对象 | `MessageV2`、`Session`、`SessionProcessor`、`LLM`、`Agent`、`SessionPrune`、`SessionCompaction`、`SessionCheckpoint`、`ActorRegistry`、`Inbox`、`Plugin`、`MCP`、`Config`、`TaskRegistry`（layer 装配 `prompt.ts:6970`）、`AutoDream` |
| 生命周期 | 用户/调度输入 → `prompt()`/`loop()` 进入 `runLoop` → 每步：inbox drain → `filterCompactedEffect` 重载切片 → 分类助手步 → 可选 dream/distill 钩子（step===1 且无 parent，`prompt.ts:4649-4697`）→ `fireCheckpoints` / `overflowCheck` → 建 processor 流式处理 → 循环直至 final/filtered/failed → `session.post`（`firePostSession`，`prompt.ts:3709`） |
| 数据输入 | 用户文本/附件、`PromptInput`（model、agent、parts）、会话历史（SQLite `MessageV2`）、config（compaction/checkpoint 阈值） |
| 数据输出 | `MessageV2.User/Assistant` + Parts（text/reasoning/tool/step-start/step-finish/checkpoint/compaction/subtask）；Bus 事件（`Session.Event.*`）；状态（busy/retry）；checkpoint / MEMORY 文件写入（经 writer 子代理） |
| 测试覆盖 | `test/session/prompt*.test.ts`、`prompt-rebuild-*.test.ts`、`prompt-effect.test.ts`、`processor-effect.test.ts`、`checkpoint-*.test.ts`（约 30+）、`overflow` 相关经 checkpoint/prune 间接覆盖 |
| 实现状态 | **VERIFIED** — 完整实现且有大量生产路径测试 |

### 1.1 上下文如何组装

1. **切片加载**：`runLoop` 每步调用 `MessageV2.filterCompactedEffect(sessionID, { contextFrom, contextWatermark, agentID })`（`prompt.ts:4494-4498`）。
2. **压缩边界过滤**：`filterCompacted`（`message-v2.ts:1442-1450`）从流尾向前收集，遇到含 `checkpoint` 或 `compaction` part 的 user 消息即截断，再 `compactionProjection`。
3. **父会话继承**：若设置 `contextFrom`，拼接父会话 main 切片并用 `contextWatermark` 截断（`message-v2.ts:1452-1476`）。
4. **Agent 隔离**：`agentID` 过滤保证子代理只看到自己的切片（F37，`prompt.ts:4488-4493`）。
5. **合成提醒**：记忆召回提示（`RECALL_REMINDER_MARKER`，`prompt.ts:4569-4582`）、循环停滞提醒（`LOOP_STREAK_REMINDER_MARKER`，`prompt.ts:4737-4762`）以 marker 去重后持久化到 last user。
6. **模型消息转换**：`toModelMessagesEffect`（`message-v2.ts:977`）做 compaction 投影、媒体剥离、checkpoint 尾折叠。

### 1.2 压缩路径

| 路径 | 触发 | 实现 |
|------|------|------|
| **Checkpoint 重建（主代理，首选）** | `overflowCheck` 为真且 agentID 为 main/空（`prompt.ts:4825-4849`） | `rebuildEnsuringCheckpoint` → 插入 checkpoint 边界；无 writer 时有界等待；失败降级 compaction |
| **有损压缩（子代理 / 降级）** | 子代理溢出（`prompt.ts:4807-4822`）或主路径降级 | `compaction.create` → 下次 `runLoop` 命中 compaction part → `compaction.process`（`prompt.ts:4712-4734`） |
| **阈值 checkpoint（保鲜）** | token 越过配置阶梯 | `SessionPrune.fireCheckpoints`（`prune.ts:241`；调用点 `prompt.ts:4781-4788`） |

### 1.3 溢出处理

- **窗口解析**：`overflow.contextWindow`（`overflow.ts:80-93`）计算 hard/effective/usable；usable = effective × `MIMOCODE_COMPACTION_TRIGGER_RATIO`（默认约 0.9）。
- **触发**：`overflow.isOverflow`（`overflow.ts:99-106`）对比 lastFinished tokens 与 usable。
- **压力分级**：`pressureLevel` 0–3（`overflow.ts:108-137`）。
- **处理**：见 1.2；`skipOverflowCheck` 防止重建后立即再次触发（`prompt.ts:4821`、`4849`）。

---

## 2. Planning / Task（任务规划）

| 字段 | 内容 |
|------|------|
| 模块名称 | `TaskRegistry`（`@opencode/TaskRegistry`）；辅：`SessionTodo`（`@opencode/SessionTodo`） |
| 核心职责 | 会话级任务注册表：树形 ID（`T1`、`T1.2`）、状态机（open→in_progress→blocked/done/abandoned）、事件审计日志、归档清理窗口 |
| 代码位置 | `task/registry.ts`；`task/schema.ts`；`task/task.sql.ts`；`task/events.ts`；工具面 `tool/task.ts`；辅系统 `session/todo.ts` |
| 对外接口 | `create` / `list` / `get` / `events` / `start` / `block` / `unblock` / `done` / `abandon` / `rename`（`registry.ts:59-86`）；Bus：`TaskCreated` / `TaskUpdated`；工具：`TaskTool` action 联合（`tool/task.ts:75-94`） |
| 调用者 | `tool/task.ts`（agent `task` 工具）；`tool/actor.ts:45`（spawn 自动 `start`）；`actor/spawn.ts:285`（`TaskRegistry.start` 自动启动）；`session/checkpoint.ts:630`（进度 reconcile）；`server/routes/instance/session.ts:252,290`（HTTP）；`session/prompt.ts` layer 装配 |
| 被依赖对象 | `Database`（SQLite）、`Bus`、`Config`（`task_archive_days`/`task_cleanup_days`）、`RecoverableError` |
| 生命周期 | `create`（插入行 + created 事件 + publish）→ 状态转换写 `TaskEvent` → `done`/`abandon` 写 `ended_at`+`cleanup_after` → `list` 默认过滤终态与过期归档 |
| 数据输入 | `{ session_id, summary, parent_id?, owner? }`；状态操作 `{ session_id, id, event_summary? }` |
| 数据输出 | `Task` 行、`TaskEvent` 行、Bus 任务事件 |
| 测试覆盖 | `test/tool/task.test.ts`、`test/server/session-task-route.test.ts`、`test/actor/spawn-task-autostart.test.ts`、`test/cron/cron-task.test.ts` |
| 实现状态 | **VERIFIED** — 完整实现 |

### 2.1 任务注册与状态管理

- **ID 方案**：`TaskID = /^T\d+(\.\d+)*$/`（`schema.ts:4`）；`nextChildId` 按兄弟最大序号 +1（`registry.ts:47-57`）。
- **状态机**：`TaskStatus = open | in_progress | blocked | done | abandoned`（`schema.ts:7`）。
- **终态保护**：`start` 拒绝复活 done/abandoned（`registry.ts:285-288`）。
- **幂等 start**：同 owner 且已 in_progress 则 no-op（`registry.ts:290-295`）。
- **事件日志**：每次转换 `insertEvent`（`registry.ts:102-115`）。

### 2.2 依赖处理

- **无独立依赖图**。层级仅通过 `parent_task_id` 表达父子结构（`schema.ts:14`）。
- 无跨任务依赖边、无阻塞依赖传播、无拓扑调度。
- `blocked` 是人工/agent 标记的状态，不驱动自动调度。

### 2.3 与 Todo 的关系

`SessionTodo`（`session/todo.ts`）是**另一套**更简单的待办：`{content, status}` 列表，全量 delete+insert，无 ID/父子/事件。二者并存，不互通。

---

## 3. Execution / Tool（工具执行）

| 字段 | 内容 |
|------|------|
| 模块名称 | `ToolRegistry`（`@opencode/ToolRegistry`）+ `SessionProcessor`（`@opencode/SessionProcessor`）+ `Tool` 基础设施 |
| 核心职责 | 内置/插件工具注册与按模型/agent 过滤；流式事件驱动的工具调用生命周期（pending→running→completed/error）；权限门、doom-loop 防护、输出截断 |
| 代码位置 | `tool/registry.ts`；`session/processor.ts`；`tool/tool.ts`；`tool/recoverable.ts`；代表性工具：`tool/bash.ts`、`tool/read.ts`、`tool/edit.ts`、`tool/task.ts` |
| 对外接口 | Registry：`ids` / `all` / `named` / `tools` / `registered` / `reload`（`registry.ts:106-127`）；Processor Handle：`executeTool` / `process` / `replay` / `updateToolCall` / `completeToolCall`（`processor.ts:161-190`）；`Tool.define` / `Tool.Context` / `ExecuteResult`（`tool.ts:17-53`） |
| 调用者 | `session/prompt.ts`（runLoop 内创建 processor、驱动 `process`）；AI SDK 流式事件；插件工具定义 hook `tool.definition`（`registry.ts:451`） |
| 被依赖对象 | Config、Plugin、Agent、Skill、Truncate、Provider、Permission、Session、Snapshot、LLM、Bus、LSP、Memory、History、SessionCheckpoint、TaskRegistry、MCP、Team 等（layer 装配 `registry.ts:495-526`） |
| 生命周期 | Layer 初始化实例化全部内置工具（`registry.ts:227-288`）→ `available`/`definitions` 按 model/agent 过滤 → `SessionProcessor.create` 每 assistant 消息一个 Handle → `tool-input-start` 注册 part → `tool-call` 置 running + `Deferred.succeed(toolReady)` → `executeTool` fiber 执行 → `completeToolCall`/`failToolCall` → `finish-step` 结算 usage |
| 数据输入 | 模型输出的 tool_use（name + JSON args）；`Tool.Context`（sessionID、abort、ask 权限请求等） |
| 数据输出 | `ExecuteResult { title, output, metadata, attachments? }`；DB ToolPart；Metrics.ToolCall；权限拒绝/RecoverableError 作为工具结果回传模型 |
| 测试覆盖 | `test/session/processor-effect.test.ts`、大量 `test/tool/*.test.ts`（含 `task.test.ts`、`skill.test.ts`） |
| 实现状态 | **VERIFIED** — 完整实现 |

### 3.1 工具注册

- 内置约 25+ 工具在 `InstanceState` 内 `Tool.init`（`registry.ts:227-254`）。
- 插件工具经 `fromPlugin` 注入（`registry.ts:175-221`），保留 id 冲突告警。
- **可用性过滤**：GPT toolset 分叉（`usesGPTToolset`）、provider 绑定（WebSearch/CodeSearch）、`toolAllowlist`、**子代理禁止 actor 递归**（`registry.ts:387-404`）。

### 3.2 执行与错误处理

```
executeTool (processor.ts:451)
  ├─ toolsClosed / abort 检查
  ├─ Deferred.await(toolReady(callID))   // 等 tool-call 事件注册
  ├─ toolGate.run 并发门
  ├─ mutateToolPart: not-started → started（可信输入边界校验）
  └─ Effect.uninterruptibleMask(body)
       ├─ tap → completeToolCall
       ├─ onExit failure → failToolCall
       └─ tapError → failToolCall
```

- **校验失败**：`Tool.wrap` 将 ZodError 转为 `RecoverableError`（`tool.ts:110-120`），TUI 静音、模型可修正。
- **Doom loop**：连续 `DOOM_LOOP_THRESHOLD` 次相同 tool+input → `permission.ask("doom_loop")`（`processor.ts:612-636`）。
- **Try-best 检测**：`detectTryBest` 阻断异常编辑/重试循环（`processor.ts:330-359`）。
- **工具错误指标**：`tool-error` 分支调用 `classifyToolError` 并 publish `Metrics.ToolCall`（`processor.ts:647-668`）。
- **重试**：工具失败**不自动重试**；由模型下一轮改写。流级重试见模块 5。

### 3.3 代表性工具说明

| 工具 | 角色 |
|------|------|
| `bash.ts` | 命令执行 + 交互式 bash + token 效率启发式 |
| `read.ts` / `edit.ts` / `write.ts` | 文件读写编辑基础面 |
| `task.ts` | Planning 的模型接口 |
| `skill.ts` / `skill-search.ts` | Skills 的模型接口 |
| `actor.ts` | 子代理 spawn（唯一可再委托入口，对 subagent 掩蔽） |

---

## 4. Reflection（反思 / 记忆巩固）

| 字段 | 内容 |
|------|------|
| 模块名称 | `AutoDream`（`session/auto-dream.ts`）+ 隐藏 agent `dream` / `distill`（`agent/agent.ts:350-424`）；`checkpoint-retry.buildReflectionMessage` 仅是校验失败提示构造器 |
| 核心职责 | **触发**定期记忆巩固（dream）与工作流提炼（distill）；**不是**独立的代码级反思引擎 |
| 代码位置 | `session/auto-dream.ts`（全文 136 行）；`agent/prompt/dream.txt`、`distill.txt`；`agent/agent.ts:350+`；调用点 `session/prompt.ts:4649-4681`；`command/index.ts` 手动 `/dream` `/distill` |
| 对外接口 | `shouldAutoDream(cfg)`、`shouldAutoDistill(cfg)`、`DREAM_TASK`、`DISTILL_TASK`、`isSystemSession`（`auto-dream.ts:20-134`） |
| 调用者 | `runLoop` step===1 顶层会话钩子（`prompt.ts:4651-4681`）；用户 slash 命令 |
| 被依赖对象 | `isMemoryWriteEnabled`（memory write-gate）、`Database`（查最近同名 session 的 `time_created`）、动态 import 的 `AppRuntime` + `Session` + `SessionPrompt` |
| 生命周期 | 配置门（`cfg.dream.auto` / `cfg.distill.auto`）+ 最小间隔 10s 防抖（`auto-dream.ts:13,117`）+ 默认 dream 7 天 / distill 30 天 → 触发后 **fire-and-forget** 创建新会话并 `prompt({ agent: "dream"|"distill", source: "hook" })` |
| 数据输入 | Config（`dream.auto`、`interval_days` 等）；Session 表时间戳 |
| 数据输出 | 新 Session 标题 `Auto Dream` / `Auto Distill`；由 dream/distill agent 用 memory 工具**写 MEMORY.md / 打包 skill**（agent 工具白名单含 write/edit/memory/bash，`agent.ts:376-387`） |
| 测试覆盖 | `test/session/auto-dream-memory-write.test.ts`（写门联动）；触发逻辑本身以单元可测函数形式存在 |
| 实现状态 | **PARTIAL** — 触发与 agent 定义真实存在；「Reflection」作为闭环自省引擎**不存在**，本质是 **prompt 约定 + 隐藏 subagent** |

### 4.1 判断依据

1. **无 `reflect` 核心模块**：Grep `reflection|reflect|dream|distill` 无独立 Reflection service；命中集中在 dream/distill 触发、checkpoint 校验提示文案、以及 `workflow/builtin/deep-research.js` 内的脚本级 reflect 步骤（非运行时内核）。
2. **`buildReflectionMessage`**（`checkpoint-retry.ts:141-164`）仅拼接 system-reminder 文本给 checkpoint writer 重试，不是反思计算。
3. **dream/distill 实现方式**：`SYSTEM_SPAWNED_AGENT_TYPES`（`agent/config.ts:7`）注册为 native+hidden subagent，靠 `dream.txt`/`distill.txt` 提示词 + 工具白名单约束行为；记忆写路径还受 `memory-path-guard` 沙箱限制。
4. **配置默认关**：config 描述写明 dream/distill auto 默认 false（`config/config.ts:347-365`）。

---

## 5. Recovery（恢复）

| 字段 | 内容 |
|------|------|
| 模块名称 | `SessionRetry`（`session/retry.ts`）+ `checkpoint-retry`（校验重试）+ `RecoverableError`（工具层）+ processor 流重试/自动 resume |
| 核心职责 | 多层故障恢复：LLM 传输/流重试阶梯；checkpoint 写出校验-修复循环；工具错误标为 agent 可恢复；不安全重放保护 |
| 代码位置 | `session/retry.ts`（551 行）；`session/checkpoint-retry.ts`（192 行）；`tool/recoverable.ts`；`session/processor.ts` 重试接线（`processor.ts:926-1058`） |
| 对外接口 | `SessionRetry.decide`（`retry.ts:323`）、`resolve`、`budgetFor`（`retry.ts:183`）、`policy`、`retryable`、`isRateLimitMessage`；`runValidatorsForCkpt`、`quarantineCheckpoint`、`buildReflectionMessage`、`buildExtractionReflection`（`checkpoint-retry.ts`）；`RecoverableError` / `isRecoverableError`（`recoverable.ts:15-35`） |
| 调用者 | `session/processor.ts`（stream 阶段 `SessionRetry.policy`，`processor.ts:995-1038`）；`session/llm.ts`（request 阶段，`llm.ts:902-964`）；`session/max-mode.ts`（candidate/judge）；`actor/spawn.ts`（`retryable` 判定子代理失败）；`plugin/checkpoint-splitover.ts`；`checkpoint.ts`（writer 循环） |
| 被依赖对象 | `ProviderError`、`MessageV2` 错误类型、`error/host-registry`（hostRetryClass）、`config/retry` |
| 生命周期 | 错误发生 → `decide` 分类（terminal / network / rate_limit / server / stream / unknown）→ `budgetFor` 选预算 → `Effect.retry` + delay → 耗尽或 terminal 则落错误卡；工具侧失败进模型上下文由下一轮修正 |
| 数据输入 | 异常对象、phase（request/stream）、scope；config 的 per-provider retry 覆盖 |
| 数据输出 | `RetryDecision`；`Session.Event.RetryAttempt` Bus 事件；session status retry 横幅；checkpoint 校验 `Violation[]` 与 reflection 提示 |
| 测试覆盖 | `test/session/retry.test.ts`、`retry-status-density-*.test.ts`、`llm-retry.test.ts`、`etimedout-persist-retry.test.ts`、`checkpoint-retry.test.ts`、`structured-output-retry.test.ts` |
| 实现状态 | **PARTIAL** — 传输层与 checkpoint 层完整；**不存在**统一的「会话级 Recovery 编排器」模块名 |

### 5.1 能力边界

| 层 | 能力 | 边界 |
|----|------|------|
| **网络/流重试** | `decide`：401/overflow/abort/auth 永不重试（`retry.ts:333-341`）；network/rate_limit/server 持久指数退避；request 4 次 / stream 5 次默认 | 不重试已产生副作用的工具步（`ctx.retrySafe`，`processor.ts:592`） |
| **工具错误** | `RecoverableError` 标记参数类错误 → 模型改写 | 无自动二次执行 |
| **Checkpoint** | writer 校验失败 → 组 reflection 消息重试；超预算 → spillover 提取提示 | 失败 quarantine 为 `checkpoint.invalid.md`（`checkpoint-retry.ts:124-131`），不无限重试 |
| **上下文重建** | overflow 时 checkpoint rebuild / compaction 降级 | 属 Context 模块，非独立 Recovery |
| **进程/会话崩溃恢复** | 未见独立 crash-recovery 编排；resume 逻辑在 runLoop parent-lock / user-resume 参数路径（`prompt.ts:3637-3646,4508-4533`） | 无跨进程自动续跑状态机 |

---

## 6. Immune（免疫 / 错误诊断）

| 字段 | 内容 |
|------|------|
| 模块名称 | `metrics/classify`（`classifyToolError`）+ `metrics/event`（`DiagnosticInfo`）+ `metrics/tolerance` + **仅接口**的 `metrics/immune-memory`（`ImmuneMemoryStore`） |
| 核心职责 | 在错误发生点结构化分类工具错误（类别/阶段/可恢复性/严重度），随 `Metrics.ToolCall`/`ModelCall` 上报；免疫记忆**仅定义 schema，无存储实现** |
| 代码位置 | `metrics/classify.ts`（256 行）；`metrics/event.ts`（`DiagnosticInfo` 在 `:47`）；`metrics/immune-memory.ts`（65 行，仅类型）；`metrics/tolerance.ts`（原则常量）；`metrics/subscriber.ts`（远程上报） |
| 对外接口 | `classifyToolError(error, toolName, options?)`（`classify.ts:12`）；`DiagnosticInfo` zod schema（`event.ts:47-55`）；`ImmuneMemoryStore` interface（`immune-memory.ts:56-65`，**无实现类**） |
| 调用者 | `session/processor.ts:655`（tool-error 真实路径）；`session/prompt.ts:1918,1976,2101`（取消路径带 `cancelled: true`）；`metrics/subscriber.ts` 转发 diagnostic 到分析端 |
| 被依赖对象 | `tool/recoverable`（`isRecoverableError`）、`metrics/event` 类型 |
| 生命周期 | 错误 → 最近分类点 `classifyToolError` → publish Bus → subscriber 可选远程 post（`MIMOCODE_ENABLE_ANALYSIS` 门控） |
| 数据输入 | `error: unknown`、`toolName`、`options.toolRegistered` / `options.cancelled` |
| 数据输出 | `DiagnosticInfoType`（error_category、error_stage、error_name、severity、recoverability、diagnosis_status、error_source） |
| 测试覆盖 | `test/session/immune-real-path.test.ts`（真实 prompt→processor→classify→Bus 链路，T2/T3）；分类逻辑见同套件 |
| 实现状态 | **PARTIAL** — 分类+事件 **IMPLEMENTED**；**免疫记忆存储 DESIGN_ONLY**（仅 interface，全库无实现引用） |

### 6.1 分类决策树（classify.ts）

```
cancelled? → tool_cancelled / recoverable
toolRegistered === false? → tool_not_found / non_recoverable
isRecoverableError?
  ├─ 参数校验特征 → tool_parameter / recoverable
  └─ 否则 → unknown / recoverability 取自 getRecoverability
ZodError → tool_parameter
permission/rejected → permission_denied / non_recoverable
timeout → timeout / recoverable
明确执行失败模式（ENOENT/ECONNREFUSED 等）→ tool_execution
其余 → unknown（禁止把未知伪装成不可恢复）
```

`getRecoverability` 是单一真相源（`classify.ts:236-256`）。

### 6.2 免疫耐受

`tolerance.ts` 定义 `TOLERANCE_PRINCIPLES` 与 `isWithinNormalBaseline`（成功/取消/info 视为正常）。当前为原则常量 + 简单基线函数，**未见**复杂异常检测或自动响应策略接入主循环。

---

## 7. Skills（技能）

| 字段 | 内容 |
|------|------|
| 模块名称 | `Skill`（`@opencode` Skill Service）+ 工具 `skill` / `skill_search` |
| 核心职责 | 发现/解析/权限过滤 SKILL.md 技能目录；向模型暴露目录与内容加载；跨品牌根兼容（Claude/Codex/OpenCode/.agents） |
| 代码位置 | `skill/index.ts`（392 行）；`skill/discovery.ts`；`skill/search.ts`；`skill/builtin/`（官方打包技能）；`tool/skill.ts`；`tool/skill-search.ts`；系统提示注入 `session/system.ts:180-186`；catalog 标记 `session/skill-catalog.ts` |
| 对外接口 | `get` / `all` / `dirs` / `available` / `modelInvocable` / `reload`（`skill/index.ts:98-105`）；`searchSkills`（`search.ts:64`）；工具 `skill({name})`、`skill_search` |
| 调用者 | `ToolRegistry`（注册 skill 工具、reload 联动 `registry.ts:486`）；`session/system.ts` 系统提示目录；用户 slash `/<skill>`；`command` / TUI skill picker |
| 被依赖对象 | Config、ConfigMarkdown（frontmatter）、Glob、Bus、Permission、AppFileSystem、内置 bundle extract |
| 生命周期 | 启动扫描根（`.claude`/`.codex`/`.opencode`/`.agents`/`.mimocode` skill patterns，`skill/index.ts:25-40`）→ 解析 frontmatter → `available(agent)` 权限过滤 → `modelInvocable` 再滤 `disable_model_invocation` → 模型 `skill` 工具 `ctx.ask` 权限 → `renderSkillContent` 注入正文 |
| 数据输入 | SKILL.md（name/description/aliases/`disable-model-invocation`）；查询字符串（search） |
| 数据输出 | `Skill.Info[]` 目录；渲染后的技能正文（工具 output）；检索分数列表 |
| 测试覆盖 | `test/skill/skill.test.ts`、`skill-external-roots.test.ts`、`skill-description.test.ts`、`test/tool/skill.test.ts`、`skill-search.test.ts`、`test/session/prompt-skill-*.test.ts`、`test/cli/.../skill-picker-*.test.ts` |
| 实现状态 | **VERIFIED** — 完整实现；既是 Echo Core 自有能力，又**兼容外部技能根格式** |

### 7.1 自有能力 vs 外部机制

| 维度 | 判定 |
|------|------|
| 扫描/加载/权限/搜索/系统提示注入 | **Echo Core 内核**（TypeScript 服务） |
| 技能文件格式与目录约定 | **兼容开放标准**：`.agents/skills/**/SKILL.md` 默认开启；`.claude`/`.codex`/`.opencode` 需 flag 显式开启（`skill/index.ts:33-40`） |
| 模型调用面 | 内核工具 `skill` / `skill_search` + 系统提示 `available_skills` 目录 |
| 内容 | 大量 `skill/builtin/.bundle/**` 官方技能随二进制分发 |

**结论**：Skills 是 Echo Core 的一等模块，同时设计上对外开放外部技能根；不是纯外部插件机制。

---

## 模块状态汇总表

| 模块 | 真实名称 | 实现状态 | 一句话结论 |
|------|----------|----------|------------|
| Context / Prompt | SessionPrompt + MessageV2 + Prune + Compaction | **VERIFIED** | 完整主循环 + 压缩/溢出/重建 |
| Planning / Task | TaskRegistry（+ SessionTodo） | **VERIFIED** | 树形任务状态机完整；无依赖图调度 |
| Execution / Tool | ToolRegistry + SessionProcessor | **VERIFIED** | 注册/过滤/执行/错误边界完整 |
| Reflection | AutoDream + dream/distill agents | **PARTIAL** | 触发器真实；反思是 prompt 驱动 agent，非代码引擎 |
| Recovery | SessionRetry + checkpoint-retry + RecoverableError | **PARTIAL** | 传输/校验层强；无统一会话恢复编排器 |
| Immune | metrics classify + DiagnosticInfo；immune-memory 接口 | **PARTIAL** | 分类与事件已落地；记忆存储仅 DESIGN_ONLY |
| Skills | Skill Service + skill 工具 | **VERIFIED** | 内核完整 + 外部根兼容 |

### 状态图例

| 状态 | 含义 |
|------|------|
| VERIFIED | 有完整实现 + 生产调用路径 + 可指认测试 |
| IMPLEMENTED_UNVERIFIED | 有实现但缺直接测试证据 |
| PARTIAL | 部分真实能力 + 部分仅约定/接口/缺失子系统 |
| DESIGN_ONLY | 仅类型/接口/文档，无实现 |
| NOT_IMPLEMENTED | 完全缺失 |
| UNKNOWN | 证据不足 |

---

## 交叉发现（审计备注）

1. **Reflection ≠ 代码模块**：Echo 叙事中的「反思」在运行时拆成 (a) checkpoint writer 的校验-重试提示、(b) dream/distill 隐藏 agent 的 prompt 约定。
2. **Recovery 分层清晰但无总控**：`decide` 是纯函数策略，重试真正执行在 `processor`/`llm` 的 `Effect.retry`；工具失败靠模型回路而非自动重放。
3. **Immune 的「记忆」尚未闭环**：`ImmuneMemoryStore` 注释写明「V1 只定义结构」（`immune-memory.ts:52-55`），全库无实现；当前可验证链路止于 DiagnosticInfo 上报。
4. **Task 与 Todo 双轨**：Planning 以 TaskRegistry 为准；Todo 是无层级 UI 待办。
5. **prompt.ts 体量**（~7248 行 / ~355KB）：Context 模块是系统最重单体，审计时已按 runLoop / fireCheckpoints / overflow / compaction 分段定位。

---

## 附录：关键 path:line 索引

| 主题 | 位置 |
|------|------|
| runLoop 定义 | `session/prompt.ts:3625` |
| filterCompacted | `session/message-v2.ts:1442` |
| filterCompactedEffect | `session/message-v2.ts:1452` |
| toModelMessagesEffect | `session/message-v2.ts:977` |
| fireCheckpoints 调用 | `session/prompt.ts:4781`；实现 `session/prune.ts:241` |
| overflow 分支 | `session/prompt.ts:4792-4849`；`session/overflow.ts:99` |
| TaskRegistry.create | `task/registry.ts:129` |
| Task 终态保护 | `task/registry.ts:285` |
| executeTool | `session/processor.ts:451` |
| tool-error + classify | `session/processor.ts:647-668` |
| Tool.wrap RecoverableError | `tool/tool.ts:110-120` |
| AutoDream 触发 | `session/auto-dream.ts:110`；`prompt.ts:4651-4681` |
| dream agent 定义 | `agent/agent.ts:350` |
| SessionRetry.decide | `session/retry.ts:323` |
| stream 重试接线 | `session/processor.ts:995` |
| checkpoint 校验重试 | `session/checkpoint-retry.ts:44,141` |
| classifyToolError | `metrics/classify.ts:12` |
| ImmuneMemoryStore（无实现） | `metrics/immune-memory.ts:56` |
| Skill 服务接口 | `skill/index.ts:98` |
| skill 工具 | `tool/skill.ts:15` |

---

*报告结束。审计过程只读，未修改任何源码。*
