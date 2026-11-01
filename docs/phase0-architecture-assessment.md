# Echo 全架构评估与终极目标对齐（Phase 0 · 只读审计）

- 产出日期：2026-10-30
- 性质：**全面架构审计、历史优化复盘、未来重构规划**。本阶段严格只读，未修改任何源代码、配置、历史记录，未新增机制，未提前重构。
- 范围：MiMoCode 新版本源码审计（12 子系统）+ Echo 历史优化复盘（10 大类）+ 效率证据挖掘 + 架构边界重划 + 目标架构 + 本月路线图 + 效果验证方案。

## 0. 审计口径与证据纪律

| 项 | 实测值 |
|---|---|
| 本机运行版本 | `mimo --version` = **0.1.16**（`mimo.exe` 135,978,496 B，2026-10-26 08:45 更新） |
| 源码镜像 | `D:\EchoCore\MiMo-Code`，shallow clone，工作区干净，HEAD = `496bb8c`（2026-10-15 15:59） |
| tag `v0.1.15` | `14dfe68a`（2026-09-22 22:57） |
| tag `v0.1.16` | `b8dbe084`（2026-10-26 16:41）= **本机实际运行版本** |
| 快照差距 | HEAD(10-15) → v0.1.16 = **297 文件，+22,313 / −5,866**（v0.1.16 净增 16.4K 行） |

**版本口径纪律**：MiMoCode 存在两套不一致的版本号（PE `ProductVersion` 报 1.3.14、`mimo --version` 报 0.1.16、`builtin_skills` 按 0.1.x 分版）。本文所有版本判断**一律以 `mimo --version` + git tag 为准**，不混用。

**证据纪律**：
- 所有源码结论标注 `文件:行号`；标注 `(v16)` 者为 v0.1.16 行号，未标注者两快照一致。
- 上一次审计（`echo-core-initial-audit.md`，2026-10-15）以 HEAD(10-15) 为源码基线。本文**逐条复验了它的 8 条关键结论，7 条在 v0.1.16 仍成立**（仅行号平移），1 条被细化修正（ReAct 上限）。
- 无法确认的内容标注【未知】；缺少日志/真实任务证据的标注【证据缺口】并给最低成本验证方案。
- 本次为读取 v0.1.16 做过 `git fetch --depth 1 origin tag v0.1.16`（**仅新增 git 引用，未动工作区、未改历史、未升级运行版本**）。
- **不以代码数量、模块数量或架构复杂度衡量进步**；不把模型选择作为本次优化重点。

**本次审计的自我纠错（必须记录）**：初读 diff 时把 `git diff --numstat v0.1.16 HEAD` 的正负号读反，一度得出"v0.1.16 大幅净删、测试 −15133 行"的错误叙事。经 `git diff --shortstat 496bb8c v0.1.16` 复核，真相是 **v0.1.16 净增 22,313 行、测试净增 12,094 行**（+15,133/−3,039）。`prune.ts`/`compaction.ts`/`overflow.ts` 三文件确实净删，但那是**旧上下文剪除体系被整体废弃**的局部事实，不代表整体精简。教训：diff 方向必须先用 `--shortstat A B` 钉死 A→B 的增减含义，再解读分项。

---

# A. 当前架构全景图

## A.1 三层真实结构（实测，非设想）

```
┌─────────────────────────────────────────────────────────────────┐
│ 第三层：研发/实验层（不在生产运行路径）                              │
│   D:\EchoCore\echo-core\docs\     审计文档（本报告所在）             │
│   D:\EchoCore\MiMo-Code\          MiMoCode 源码镜像（只读审计用）    │
│   D:\AlroLab\temp\                150+ 实验产物（wp2…wp6、WP-R1/R2）│
└─────────────────────────────────────────────────────────────────┘
                              ↓ 仅产出文档/结论，不参与运行
┌─────────────────────────────────────────────────────────────────┐
│ 第二层：Echo 外层（人格 + 规则 + 记忆 + 桌面集成 + 投影插件）          │
│                                                                 │
│  [实存且在跑]                                                     │
│   C:\Users\微醺\.config\mimocode\context-gate\                    │
│       index.ts(413行)  chat.messages.transform 视图投影            │
│                       onEvent → stats.jsonl 观测账本               │
│       verify.ts       verify 预检（含 -File 误报缺陷）              │
│       gates.json      soft 75K / hard 110K token 闸               │
│       stats.jsonl     8,417 行（0 行 error ← 结构性盲区）            │
│   D:\MiMoMemory\identity\Echo.md  身份权威源「宿主是身体，我是身份」  │
│   D:\MiMoMemory\{projects,sessions,tools}\   四层记忆库            │
│   .mimocode\mimocode.json   tui 插件 + 7 条危险命令 deny           │
│   mimocode.jsonc            模型/compaction/checkpoint/MCP 配置     │
│   Set-MimoTerminalIcon.ps1 / echo-notify.ps1 / Echo.lnk  桌面集成  │
│                                                                 │
│  [仅文档约定，自动调用 0 次]                                        │
│   D:\AlroLab\orchestrator\{BRIEF-ANALYST,BRIEF-DOMAIN,            │
│       BRIEF-VERIFIER,TRIAGE,HANDOFF,RECOVERY}.md + wu.py          │
│                                                                 │
│  [死代码，从未注册]                                                │
│   C:\Users\微醺\.mimocode\tools\*.ts   30+ 个 TS（含 46.9KB        │
│       memory-manager.ts、读 auth.json 的 model-router.ts）         │
│   C:\Users\微醺\.mimocode\hooks\vision-routing.ts.disabled         │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 唯一接口：packages/plugin 的 24 个 Hooks
┌─────────────────────────────────────────────────────────────────┐
│ 第一层：MiMoCode 宿主（外部基础设施与执行环境）v0.1.16                │
│   packages/cli/src/                                             │
│     session/  prompt(主动脉) processor classify retry             │
│               checkpoint compaction prune resume revert          │
│     tool/     registry gate preview actor task mcp-tool-search   │
│     actor/    spawn waiter registry notification events          │
│     inbox/    controller schema sync scheduler events(持久化)     │
│     task/     registry schema     memory/  FTS 记忆               │
│     workflow/ runtime sandbox workspace（QuickJS 沙箱）            │
│     provider/ permission/ snapshot/ mcp/ server/ metrics/        │
│     effect/   runner  execution-ownership  run-state             │
│   packages/plugin/src/index.ts   24 个 Hooks（Echo↔宿主契约）      │
│   packages/{sdk,shared}                                          │
└─────────────────────────────────────────────────────────────────┘
```

## A.2 一次真实请求的调用链（源码级）

```
用户输入
 → SessionPrompt.prompt / continue (session/prompt.ts)
 → preparePrompt（组装系统提示 + 工具表 + MCP 工具名清单）
 → runLoop (prompt.ts:3993 v16)
 → executeLoop (prompt.ts:6400 v16)
      ├ executions.acquire / runTurn        ← 多实例执行归属（execution-ownership.ts:26-35）
      ├ leaseGuard (prompt.ts:6492 v16)     ← epoch 中断
      ├ llm.stream  →  provider/            ← 重试在 session/retry.ts
      ├ processor.ts  处理 assistant 消息
      │    ├ classifyAssistantStep (classify.ts:32)  纯函数判定停/续
      │    ├ tool/gate.ts  FIFO 准入 + 只读并行白名单 + FAIL_CASCADE
      │    ├ tool/preview.ts  工具输出截断（MAX_LINES=2000 / MAX_BYTES=50KB）
      │    └ bus.publish(Metrics.ModelCall)   ← ★ 仅成功路径
      ├ goalGate (prompt.ts:4464+，仅 main)   ← LLM 判官，内存 Map，fail-open
      ├ loop-streak 重复签名（阈值 3）+ text-ngram 重复检测
      └ maxSteps = agent.steps ?? Infinity   ← ★ 默认无硬上限

事件侧链：
 bus.publish(…)
 → plugin/index.ts:371 subscribeAll  全事件无差别转发
 → context-gate onEvent
      ├ metrics.model_call  → logStats({ev:"model"})   ← 有账
      ├ session.compacted   → logStats({ev:"compacted"})
      └ session.error       → 忽略 ✗                    ← ★ 失败不进账（C1 根因）

上下文侧链：
 chat.messages.transform（context-gate）
 → 视图投影：仅传"本步所需"子集（实测 380K→130K est，−65.78%）
 → 超过 checkpoint 阈值 → checkpoint-writer 子代理落档
 → 溢出/超阈 → rebuildFromCheckpoint (prompt.ts:923 v16) 重建上下文
```

## A.3 职责边界现状（实测）

| 能力 | 现在实际归属 | 说明 |
|---|---|---|
| 模型 API 接入、provider 路由 | MiMoCode | `provider/`，外层只能配 `provider` 键 |
| **换模型 / 模型降级** | **无归属** | `chat.params` 钩子输出**无 model 字段**（`packages/plugin/src/index.ts`）→ 外层换不了模型，核心 `retry.ts:323` 也只做同模型重试 |
| 工具注册/调度/并发门禁 | MiMoCode | `tool/registry.ts:173-221` 唯一来源是插件 `tool` 导出 |
| 工具输出剪除 | **已废弃** | v0.1.16 删除 `prune()`（PRUNE_MINIMUM=20k/PRUNE_PROTECT=40k）、`pressureLevel`、`compaction.prune` 配置（`config.ts:65-68` 显式告警"was removed and is ignored"） |
| 上下文压缩/重建 | MiMoCode | v0.1.16 改为 checkpoint 阈值梯 + rebuild-from-checkpoint + compaction 降级 |
| 上下文"传什么给模型" | **Echo（外层投影）** | context-gate `chat.messages.transform`，实测 −65.78% |
| 任务状态/生命周期 | MiMoCode（task 树） | 但**不参与"任务完成"判定**——完成判定走 goal 判官 |
| 任务完成判定 | MiMoCode（goal 判官） | 内存 Map、fail-open、MAX_GOAL_REACT=12 超限放行 |
| 子代理委派 | MiMoCode（actor） | **无运行时预算字段**，wait 超时只放行不杀 |
| 失败分类/重试 | MiMoCode（retry.ts） | 真分类器；但**永不换模型** |
| 失败计量/账本 | **无人负责** | 核心只发成功 ModelCall；外层账本忽略 `session.error` |
| 记忆存储/检索 | MiMoCode（memory FTS） | 四层库由 CLI 会话旁路直写，外层 memory-manager 闸门是死代码 |
| 记忆治理/人格/身份 | **Echo（唯一无重复资产）** | `D:\MiMoMemory\identity\Echo.md` |
| 危险命令拦截 | **Echo（配置层）** | 7 条 deny 规则，无实战拦截样本 |
| 执行沙箱/隔离 | MiMoCode（弱） | QuickJS workflow 沙箱 + MIMOCODE_HOME；**无强制 worktree 隔离**，词法 jail 不解 symlink |
| 桌面/终端集成 | **Echo** | 图标守护、toast、快捷方式 |

**结论**：A.3 的"无归属"与"无人负责"三行，就是当前架构最硬的三个洞。

---

# B. MiMoCode 新版本能力对照表

审计对象 = v0.1.16（`b8dbe084`），对比基线 = 本机旧源码快照 HEAD(10-15) 与 Echo 外层现状。

| # | 能力 | MiMoCode v0.1.16 实现（源码） | Echo 现状 | 差异 | 复用建议 |
|---|---|---|---|---|---|
| 1 | **Agent 主循环** | `prompt.ts:3993` runLoop → `:6400` executeLoop；停/续由 `classify.ts:32` 纯函数判定（final/continue/text-tool-call/filtered/think-only/invalid/failed）；**pending 客户端工具 ⇒ continue 优先于一切**（classify.ts:46-73）。v16 新增 leaseGuard epoch 中断、autoContinueOutputLength、autoRetryTextToolCall/StructuredOutput | 无自己的循环，直接消费宿主 | Echo 零实现 | **全量复用**。不要自建循环 |
| 2 | **停机/步骤上限** | `maxSteps = agent.steps ?? Infinity`（prompt.ts:5503 v16）；loop-streak 三步重复仅**注入提醒不强制停**（:5333-5355，REPEATED_STEP_THRESHOLD=3）；text-ngram 连续重复（TEXT_NGRAM_MAX_RECOVERY=2） | 无硬熔断 | ★ 无上限 = 最坏损失无界 | **必须外补**硬步数/token 熔断（属 Echo 预算管理） |
| 3 | **任务树** | `task/schema.ts:4-14`（TaskID `Tn.m`、parent_task_id、open/in_progress/blocked/done/abandoned）；`tool/task.ts:199-211` 状态操作；actor 绑定 `task_id`，postStop 校验 `tasks/<id>/progress.md`（tool/actor.ts:117-152） | 无任务树；用 wu.py 台账（人工 12+ 条，自动 0） | ★ **任务树不参与完成判定** | **复用 task 树做状态管理**；但完成判定需 Echo 介入 |
| 4 | **完成判定** | goal 判官（`goal.ts:33` Verdict{ok,impossible}，只读 condition+transcript）；状态**仅内存 Map**（goal.ts:113）；判官失败 **fail-open**（prompt.ts:4485-4493 `judgeFailed→allowing stop`）；MAX_GOAL_REACT=12 超限**放行停机**（:4530-4543） | 无 | ★ 判官 fail-open + 状态不持久 | **必须外补**：判官失败策略可配、goal 持久化、任务树↔判官联动 |
| 5 | **工具发现/注册** | `tool/registry.ts:250` 注册；`:324` permission!=deny 过滤；`Tool.define` + 插件 `tool` 导出是**唯一来源**（registry.ts:173-221） | 30+ 个 `~/.mimocode/tools/*.ts` **从未被扫描/注册** | Echo 的"工具扩展"全部落空 | **复用插件 `tool` 钩子**；删除 tools/ 目录幻觉 |
| 6 | **工具输出治理** | `tool/preview.ts:6-7` 截断 MAX_LINES=2000/MAX_BYTES=50KB（硬编码）；**v0.1.16 已删除工具输出剪除 `prune()`** | 投影插件在消息层做子集选择 | 两个不同层次 | **复用 preview**；Echo 投影留外层（层次不重复） |
| 7 | **并发门禁** | `tool/gate.ts:2` FIFO 准入、`:19` FAIL_CASCADE_MESSAGE、`:58` cascade=`!MIMOCODE_DISABLE_FAIL_CASCADE`；只读并行白名单（EnterOptions） | 外层"独立性三检"纯文档 | 真门在核心 | **全量复用**；外层三检降为低优先纪律 |
| 8 | **MCP 工具懒加载** | `tool/mcp-tool-search.ts`（v16 +295/−61）：deferred 工具只随 user 消息发**名字**（`<system-reminder>`），完整 JSONSchema 由模型调 `mcp_tool_search` 按需拉取（BM25 + 模块级缓存 index :72-78），经 `mcp_tool_use` 分发（prompt.ts:2327-2365）。模式 `MIMOCODE_MCP_TOOL_SEARCH`：always(默认)/never/auto:N%（:279-293）；sticky 防缓存抖动（:310-322）。预算 CATALOG_MAX_TOKENS=20_000 | 无 | ★ 这是 v0.1.16 最实在的效率改进 | **全量复用**。本会话 `mcp_tool_search`/`mcp_tool_use` 即活体证据 |
| 9 | **MCP 连接就绪** | `mcp/index.ts:1255-1286` 新增非阻塞 `readiness()` 连接快照 | 无 | 新增 | 复用 |
| 10 | **上下文压缩/重建** | v0.1.16 **整体换代**：删除 `compaction.prune`/`pressureLevel`；`session/prune.ts` **语义替换**为 checkpoint 阈值梯调度器（fireCheckpoints，阈值 <25K 禁用 / 25-200K 4×20% / 200-500K 9×10% / >500K 18×5%，prune.ts:22-33；CHECKPOINT_RESERVED=13_000）；`rebuildFromCheckpoint`/`rebuildEnsuringCheckpoint`（prompt.ts:923/:1013）统一自动 overflow 与 /rebuild；`filterCompacted`（message-v2.ts:1484）+ RetryPart(:355) + AgentProvenance(:537) + renderedOrder(:1491) | context-gate 投影 + `compaction.max_context=200K` + `checkpoint.thresholds=["70K","140K"]` + push_caps | Echo 的阈值配置与核心阈值梯**是两套并行机制** | **复用核心阈值梯**；Echo 只保留"传什么"的投影，不再自设压缩阈值 |
| 11 | **Token 预算/成本计量** | `metrics/event.ts:4-17` ModelCall schema **无错误字段**；**仅成功路径发布**（processor.ts:789/1454 v16、prompt.ts:1454 v16；预测调用失败仅 `elog.warn` 后吞掉 prompt.ts:1440-1445）；`AgentRequest.validation_status` **恒 "skipped"**（prompt.ts:4399 v16）；新增 TryBestDetected（event.ts:47-56）；subscriber 由 `MIMOCODE_ENABLE_ANALYSIS` 门控 | stats.jsonl 只记 `{ev:"model"}` 成功行，**8,417 行 0 行 error** | ★ **失败调用两边都不计量** = 观测盲区 | **Echo 必须补**：失败计量 + 真实 validation_status（C1） |
| 12 | **重试/失败恢复** | `retry.ts:323` decide **只判同模型可否再试**；预算+指数退避（llm.ts:962-970）；402/501/505/401/404/quota/safety/ContextOverflow = **terminal**（retry.ts:393-405，402 现 :404）；InvalidOutputError 并入 SessionRetry 预算（processor.ts:1050-1095）；resume 体系重写（prompt.ts:6600+：planResume/launchResume/cascadeSubagentResume/resumeMainCascading） | 无 | ★ **全仓无 escalation/fallback model 逻辑** | **Echo 必须补**模型升级/降级链与跨 provider 容灾（C3） |
| 13 | **多 Agent/委派** | `actor/spawn.ts:194` SpawnInput **无预算字段**；ReAct 上限硬编码 **MAX_PRE_REACT=3 / MAX_POST_REACT=3**（spawn.ts:37-39 v16，TODO 注释"lift to mimocode.json"）；`tool/actor.ts:99` wait 有 timeout_ms（默认 600000ms）但**超时只放行等待、不杀子代理**（:105）；`parent_actor_id` 归因已存在（actor.sql.ts:15、registry.ts:175） | 四角色实体化**已证伪**（A/B：墙钟 2.74×、成本 2.01×） | 归因字段有，预算无 | **复用 actor/task 归因**；**必须外补** time/turn/token 预算 + 超时取消（C2） |
| 14 | **inbox/通知** | v0.1.16 **重写为持久化收件箱**：`inbox/controller.ts`(+649) accept/claimNext/ack + `inbox.sql.ts`/`schema.ts`（MAX_CLAIM_PER_STEP=100）+ `inbox/sync.ts`(+225)，旧 `inbox.ts` −338 | 无 | 新机制 | 复用（供经验积累/待办） |
| 15 | **上下文/会话持久化** | checkpoint-writer 子代理 fork 语义（spawn.ts:60-98 ForkContext：parentPermission 继承、watermarkMsgID）；snapshot/ = **影子 git 对象库**（snapshot/index.ts:85-90 `--git-dir <data>/snapshot/<proj>/<hash>` + `--work-tree <真目录>`）用于快照/回卷 | 四层记忆库 + MEMORY.md 治理 | 层次不同 | **复用 snapshot 回卷**；记忆治理留 Echo |
| 16 | **执行隔离/安全** | **无运行时强制 worktree 隔离**（spawn.ts:223-224 注释："whether to CREATE one is the caller's policy"，全 src 无 `git worktree add` 调用）；workflow QuickJS 沙箱（sandbox.ts:43-44 deadline 12h / memory 64MiB）；workspace 词法 jail **不解 symlink**（workspace.ts:12-17 自述 LIMITATION）；`MIMOCODE_HOME` 隔离（flag.ts:460-461）；execution-ownership 按 directory/workspaceID 断言 OwnershipError（:26-35） | 7 条 deny 规则 + 隔离实验惯例 | ★ 沙箱边界弱 | **Echo 必须补**强制 worktree / symlink 加固；容器级沙箱暂缓 |
| 17 | **Compose / compose-next** | **不是引擎，是内置 skill 提示词**（`skill/builtin/.bundle/compose-next/SKILL.md`：grill→workspace→spec→implement→verify→review→finalize→finish）；worktree 由 skill **文本指令**执行 `git worktree add`，**运行时无强制**。`docs/compose/spec/` = 设计文档库（v16 新增 13 篇）。真正的编排引擎是 `workflow/`（QuickJS 沙箱 + `agent()` hook 派生 actor） | 编排七步包（TRIAGE/HANDOFF/RECOVERY/wu.py）**自动调用 0 次** | 两边都是"文档约定" | Echo 编排七步包**删除/归档**；需要编排时用 compose-next skill 或 workflow |
| 18 | **插件接口面** | `packages/plugin/src/index.ts` 594 行，**约 24 个 Hooks**：event / config / tool / tool.definition / auth / provider / chat.message / chat.params / chat.headers / permission.ask / command.execute.before / tool.execute.before / tool.execute.after / shell.env / experimental.chat.messages.transform / experimental.chat.system.transform / experimental.session.compacting / experimental.compaction.autocontinue / experimental.text.complete / **actor.preStop / actor.postStop** / **session.pre / session.post** / **session.llm.request** | 只用了 chat.messages.transform + event | ★ **`session.post` 带 `task_id`、`outcome`、完整 `trajectory`、`systemPrompt`**——这是 Echo 做经验积累与结果验证的现成通道 | **优先复用 session.pre/post 与 actor.pre/postStop**，而非自建机制 |
| 19 | **会话恢复/多实例** | v16 新增 `session/execution-ownership.ts`（39 行，按 directory/workspaceID 断言归属）、run-state ownedRunner + 取消代数（+63/−11）、leaseGuard | 无 | 新增 | 复用 |
| 20 | **已废弃机制（勿再依赖）** | ①工具输出剪除 `prune()`/PRUNE_*/`pressureLevel`/`compaction.prune`（config.ts:65-68 显式告警"ignored"）②空/坏输出平行计数器（统一为 InvalidOutputError→SessionRetry）③旧内存态 inbox ④`maxSteps`→`steps`（agent.ts:62 `@deprecated`） | Echo 的 B0 动态预算、tail_turns 配置字段（代码不读） | 两边都有过期货 | **明确删除** Echo 侧过期货 |

## B.1 对上一轮审计结论的逐条复验（v0.1.16）

| 上一轮断言（2026-10-15，基于 HEAD） | v0.1.16 结论 |
|---|---|
| ModelCall 无错误字段、仅成功发布 | **成立**（行号→processor.ts:789/1454、prompt.ts:1454） |
| `validation_status` 恒 "skipped" | **成立**（prompt.ts:4399 v16） |
| retry decide 仅同模型、无升级；402 terminal | **成立**（402 现 :404） |
| spawn 无预算；ReAct 硬编码 3 | **部分修正**：现 MAX_PRE_REACT=3 + MAX_POST_REACT=3（spawn.ts:37-39 v16），仍硬编码 |
| goal 仅内存 Map、fail-open、MAX_GOAL_REACT=12 | **成立**（goal.ts:113；prompt.ts:4485-4493/274 v16） |
| maxSteps 默认 Infinity | **成立**（:5503 v16） |
| `bus.subscribeAll` 全事件转发给插件 | **成立**（plugin/index.ts:371-381 v16；另有 :454 fileHooks 第二处订阅） |
| REPEATED_STEP_THRESHOLD=3 | **成立**（prompt.ts:281 v16） |

**净判断**：MiMoCode v0.1.16 在**上下文治理、MCP 懒加载、inbox 持久化、子代理恢复链、多实例归属**上是实打实的进步；但在**失败可观测、预算强制、模型容灾、执行隔离**这四个"Agent 独立性"要害上**没有任何进展**——这四件事必须由 Echo 自己掌握。

---

# C. Echo 历史优化复盘表

**证据基础**：实存文件 + 脚本输出直接验证；记忆档案仅作线索并已抽查核对。
**首要证据缺口**：Echo 自身几乎没有 git 历史（`D:\EchoCore\echo-core` 仅 1 commit `1fb512e` "chore: establish Echo Core research baseline"）。历史证据主要存在于 166 个记忆档案 + `D:\AlroLab\temp`（150+ 实验目录）+ `D:\AlroLab\logs`。**因此"是否真有效果"的证据强度普遍低于代码审计**，下表已逐项标注。

## C.1 十大类处置表

| # | 机制 | 真实状态 | 位置 | 当时的问题 | 效果证据 | 与 MiMoCode 重复度 | 处置 |
|---|---|---|---|---|---|---|---|
| 1 | Analyst/Executor/Verifier/Domain Expert 四角色分工 | **仅文档约定**（3 个 BRIEF 模板实存，零运行） | `D:\AlroLab\orchestrator\BRIEF-{ANALYST,VERIFIER,DOMAIN}.md`（**无 BRIEF-EXECUTOR.md**） | 执行者自检漏缺陷 | **反证**：WP5.3-B 受控 A/B（6/6 质量全 1.0）多 Agent 墙钟 **2.74×**、成本 **2.01×**、多 1 次超时；E6 三对质量全满分 = 无增益 | 高（actor/task 可扮演） | 模板**精简后留外层**；**角色实体化删除** |
| 2 | 任务分类/规划/子任务委派 | **仅文档**（TRIAGE T1–T9），自动调用 0 | `orchestrator\TRIAGE.md`、`README.md` 七步 | 任务定型防过度调度 | 【无证据】收益门槛三问纯自觉 | 高（task 树/plan→build/actor） | **删除或归档**；任务状态迁原生 task 树 |
| 3 | 并行执行与"三检" | 双层：外层约定 + **底层真门** | `README.md`"独立性三检"；`tool/gate.ts`（原生） | 并发竞态、串行耗时 | E2 并发 **−43%**（`temp\wp4.1\experiments\e2-parallel`） | 高（gate.ts 已管） | 三检**留外层低优先**，不迁移 |
| 4 | 任务账本与状态管理 | **实存但链路死**：wu.py 人工用过、自动 0；stats.jsonl 才是真账本 | `orchestrator\wu.py` + `workunits.json`（12+ 条，5 条 EXCEEDED）；`context-gate\stats.jsonl` | 可追溯台账 | wu 无实效证据；stats **0 行 error** | 中（task 树重复状态管理） | wu.py **归档**；stats **扩展 error 行（C1）**；任务归因**迁核心** |
| 5 | 失败分类与错误恢复 | RECOVERY 四分类=**仅文档**；verify-gate=**实存在跑** | `orchestrator\RECOVERY.md`；`context-gate\verify.ts`（99 verify 事件） | 失败不可见、自检漏 | verify 有 BOM 自动修复，但 **-File 误报实证 4+ 次**（2026-10-15/10-19） | 高（retry.ts/classify.ts 原生真分类器） | RECOVERY **删除**；verify.ts **修 -File 后保留** |
| 6 | Token 预算意识 | 多点半成品：context-gate 闸**在跑**；B0 断链；cost_gate / watchdog **隔离未部署** | `gates.json`（soft 75K/hard 110K）；`wp4.9` allocator 链断裂；`wp6-final\src\cost_gate.py`（测试 46/0）；`wp4.2/4.7\implement\budget_watchdog.py`（24/24，未部署） | 超支无闸、成本低估 | 投影 65.78% 有效；B0 实测 84/84 `tool_call_limit=null`、drive58 从不调 allocator | 中（core 180K 才是真边界） | cost_gate 三态语义**并入核心**；watchdog 语义**重构进 C2**；B0 **删除** |
| 7 | 工具与角色调度 | **死代码**（30+ TS 从未加载） | `C:\Users\微醺\.mimocode\tools\{model-router,circuit-breaker,task-state,gui-agent,semantic-gui,memory-manager,vision-gateway,...}.ts` | 模型分档、熔断、任务态 | 【无证据】0 次加载；DB 中 memory-manager 调用全集中在 2026-09-23、其后归零 | 全部重复或需底层接口 | **删除/归档**；有效语义在核心**重写** |
| 8 | 上下文与记忆管理 | 投影 + roundtrip_hint **实证有效**；memory-manager 闸**死代码**；四层库在但旁路直写 | `context-gate\{index.ts 413行, gates.json}`；`~/.mimocode\tools\memory-manager.ts`（未注册）；`D:\MiMoCodeMemory\` 5 层实存 | 上下文长变慢变贵、记忆无治理 | 投影 65.78% / errs=0（实测 8,417 行）；四层库工具路径 09-23 后 0 写入 | 中（compaction/checkpoint/memory FTS 原生） | 投影**留外层**；memory-manager **删除、核心重写**；gates-changelog 治理**保留** |
| 9 | 人格、执行风格与行为规则 | **实存生效**（文件 + 脚本 + 记忆规则） | `D:\MiMoMemory\identity\Echo.md`（2026-10-15 权威源）、`echo-avatar.*`、`Set-MimoTerminalIcon.ps1`（E2E PASS）、MEMORY.md Rules 协作纪律 | 人格一致性、协作边界 | 行为层真实（用户硬要求跨会话）；无自动度量 | **无重复**（MiMoCode 无人格层） | **保留并迁入 Echo 独立核心**（最有价值差异化资产） |
| 10 | 安全、稳定与流程控制 | deny 规则**在跑**；MIMOCODE_HOME=原生能力；steward **已删**；保护清单=记忆约定 | `.mimocode\mimocode.json`（7 条 shutdown 族 deny）；`PHASE-STATUS.md` §5；`MEMORY-rules-protection-lists.md` | 误破坏、误触高危 | deny 在配置层生效（**无触发样本 = 【无证据】实战拦截**） | 低（permission 系统原生但规则是 Echo 的） | deny / 保护清单**保留**；MIMOCODE_HOME **保留用于隔离**；steward **维持删除** |

## C.2 上表未列但确实存在的机制

| 机制 | 状态 | 位置 | 处置 |
|---|---|---|---|
| stats.jsonl 观测账本（transform/model/verify/rth 四类事件） | 在跑，8,417 行 | `context-gate\stats.jsonl`（997KB） | 保留，C1 扩 error 行 |
| gates-changelog 配置治理（过渡配置 + 口径校准 + 复审日期） | 在跑 | `context-gate\gates-changelog.jsonl` | **保留（好实践）** |
| roundtrip_hint 复用锚点 | 在跑（2,755 行 rth） | `index.ts` `roundtrip_hint:true` | 保留 |
| 自优化探针 probe.py（探针先行，防"先断言后看数据"） | 测试回放 20/0 | `D:\AlroLab\temp\self-opt\src\probe.py` | **迁入 Echo 核心**（工具化经验积累） |
| safe_read.py / cost_gate.py 读侧不确定性语义 | 30/0 与 46/0 | `temp\wp6-final\src\` | 语义迁核心 |
| 多进程 JSON 状态文件 msvcrt 锁模式 | 实证竞态修复 | `temp\wp4\wp4.2`（call-ledger.json.lock） | 作为可复用知识保留 |
| TUI agent-panel.tsx、AlroChannel 8088/4097 自启链 | 在跑 | `.mimocode\tui\`、`AlroChannel.vbs` | 留外层 |
| 基准 B1–B5 + 指标体系设计 | 纯文档 | `echo-core-initial-audit.md` §6 | **保留（验证一切优化的前置）** |
| ~150 个个人 skills | 在跑 | `.mimocode\skills\` | 保留 |

## C.3 死代码 / 失效 / 已删除清单（证据）

1. **`~/.mimocode/tools/` 全部 30+ 个 TS**（含 `memory-manager.ts` 46.9KB、`model-router.ts`、`gui-agent.ts`、`standing-orders.ts`、`semantic-gui.ts` 58KB、`vision-gateway.ts` 等）——MiMoCode custom tool 唯一来源是插件 `tool` 导出（`registry.ts:173-221`），**无 tools/ 目录扫描**；E2E 实证"没有名为 recall 的工具"。`model-router.ts` 读 `auth.json`，**存在密钥暴露面**。
2. **memory-manager 四层写入闸门**——仅工具路径生效，工具 09-23 后零调用；四层库实际由 CLI 会话旁路直写。
3. **wu.py 自动链路、TRIAGE/RECOVERY/HANDOFF 自动调用**——0 次（`drive*.py` 引用 = 0）。实验链路与主控链路完全脱耦。
4. **四角色实体化、BRIEF-DOMAIN 增量收益**——已证伪（A/B 与 E6 实测）。
5. **B1 动态预算**——裁定不部署；WP4.9/WP4.10 预算数值优化均判 C；allocator→drive 链断裂（`--tools`/`--global-budget` 从未接线）。
6. **steward 管家系统**（计划任务 + 4 脚本）——2026-10-14 整套删除（实测路径不存在）。
7. **budget_watchdog（4 个版本）与 cost_gate.py**——测试全绿（24/24、46/0）但**无生产部署授权**，仅隔离候选。
8. **call-ledger.json**（wp4.8–4.13）实验残留；`tail_turns` 废弃配置字段（代码不读）；手绘审美 legacy 已删；`index.ts.pre-rth`/`.pre-verify`/`verify.ts.pre-v3s3` 死备份。

## C.4 证据缺口与最低成本验证

| # | 缺口 | 影响 | 最低成本验证方案 |
|---|---|---|---|
| 1 | **Echo 无 git 历史**（仅 baseline 1 commit） | 复盘只能靠记忆 + temp 实验产物，无法精确归因"何时改、为何改" | 对 `D:\AlroLab\logs\` 150+ 报告做一次性索引（零成本） |
| 2 | **stats.jsonl 无 error 行** | 84min 空轮悬案、402×4 之谜（retry.ts 列 402 为 terminal 却观测 4 次）无法裁决 | C1 A 档：`onEvent` 加 `session.error` 分支 + 对账脚本（预计 ≤¥10） |
| 3 | step-finish part 源码写而 DB 空 | 计量口径不确定 | C1 实施时顺带裁决 |
| 4 | **4097 serve 未接入 context-gate**（不热加载插件，重启需批准） | 桌面/手机通道效果数据缺失 | 维持用户指令"勿擅自重启"；接入需专门批准 |
| 5 | deny 规则无实战拦截样本 | 无法证明有效性（配置在 = 最坏无害） | 保留，不投入验证 |
| 6 | tools/ 09-23 注册源失传 | 不能 100% 排除历史加载入口 | 现行 registry 源码 + 配置双证未注册（置信度高），删除前再跑一次运行时探针 |
| 7 | `tool/session.ts` 提及的 "session tool creates a worktree"（spawn.ts:224 注释）在 src 中找不到创建实现 | 疑为注释滞后 | 【未知】，改造 worktree 隔离前先确认 |

---

# D. 核心问题清单

证据基础见 A/B/C 与下文效率数据。排序 = 影响程度 × 修复可行性。

## D.0 效率量化事实（本次实测，读取时点 2026-10-30 21:50）

| 指标 | 数值 | 来源 | 可信度 |
|---|---|---|---|
| 账本总行数 / ev 分布 | 8,373 行：model 4,186 / rth 2,755 / transform 1,333 / verify 99；**`ev:'compacted'`=0** | stats.jsonl 逐行聚合 | 高 |
| 时间跨度 | 2026-10-14 21:50 → 10-30 21:51（16 天） | stats.jsonl `t` | 高 |
| **每会话模型调用数** | n=170 会话：**中位 6 / 均值 24.6 / P75 17 / P90 34 / P95 85 / 最大 673** | stats.jsonl `ev:model`+`sid` | 高 |
| 每会话 assistant 消息（DB 全史） | 1,004 会话：中位 7 / P90 22 / **最大 1,310** | mimocode.db | 高 |
| 单任务量级实测 | 48 / 323 / 425 / 528 / 1,101 次请求/任务会话（合计 2,425，5 样本） | v3_stage1_roundtrip.md | 高 |
| **账本 task id 字段** | **0 行**（8,373 行全验证） | stats.jsonl | 高 |
| 账本失败调用 | tin==0 仅 2 行（0.05%）；**6 次 402「Insufficient Balance」在日志中、账本几乎无痕** | stats.jsonl + log | 高 |
| DB 失败消息 | `assistant.error` 非空 **273 行（1.5%）**：Aborted 252 / ContentFilter 8 / APIError 7（402×4、403×2、断连×1）/ UnknownError 6 | message.data | 高 |
| 累计消耗 | input 142.8M / output 9.2M / cache_read 3,397M / **cost $38.54**（9-23→10-30） | DB SUM | 中（cost 迟到回填） |
| **单次调用输入 token** | **中位 100,589** / P90 171,666 / P99 232,853 / max 270,291 | stats.jsonl | 高 |
| **固定税（系统提示+工具 schema）** | 每会话最低 tin 的 p25 = **38,639**（38.5–38.7K 精确聚类，96 会话复现）→ **占中位调用 ~38%**；缓存命中 87.9% | stats.jsonl | 高 |
| 投影收益 | transform 1,335：trimmed 88%、over_hard 241、pass2 806、**errs=0**；WP-R2 加权缩减 **25.83%**；**65.0% 调用 >75K**、43.6% >110K | stats.jsonl + WP-R2 | 高 |
| **空轮（零产出）** | DB `tokens.total==0` 的 assistant 消息 **295 条**（10-11～10-30 持续）；V3 判定 18 例纯空轮 = **5,055s（84min）/5 会话**，**+8ms 系统自动注入「继续」原样重试** | DB + v3_stage1 | 高 |
| 重复分析 | 原始同参重复工具调用 1,904/22,835 = 8.3%；**精修后真冗余 ≈35–37 次 + 18 空轮 ≈ 2.2%**（分页续读/图像核验/紧邻重复均判为必要） | DB part.state + v3_stage1 | 中-高 |
| 委派成本 | task 工具 1,974 次、actor 207 次；actor_registry 1,684（main 1,009、**checkpoint-writer 583=宿主自动**、general 53、explore 39） | DB | 高 |
| **工具失败率** | **730/22,717 = 3.2%**：级联取消 238、**edit 无匹配 178**、aborted 61、权限拦 46、rg 拒绝 34、**invalid 66（大小写 'read'/'Read' 误写 ~30）**、无效 edit 14 | part.state.error | 高 |
| **verify-gate 误拦** | verify 99 事件：ps1_preflight **cancel 82 / pass 8**、artifact fail 4。**85 个 path 中 54 个（64%）为提取坏路径**（`C:\用户\|`、`-ErrorAction`、`-Recurse`…） | stats.jsonl verify | 高 |
| 上下文压缩频率 | compaction part 全史仅 **1**；投影 transform 1,335 次；rth 注入 2,755 次 | DB + stats.jsonl | 高 |
| HITL/确认 | question 工具 31 次；permission 表 0 行；3 天日志 permission/ask 18 行 | DB + log | 中 |
| **完成 vs 验证** | task 666 创建 / **415 done / 180 open / 69 in_progress / 1 blocked / 1 abandoned（37.8% 未收口）**；**无验收字段** | task 表 | 高 |
| **记忆降本** | memory 类工具 88 次/42 会话（占工具 0.4%）、history 104；**记忆已记「先测再断言」仍复发 ≥6 次**；无前后对照数据 | DB + MEMORY-selfopt | 高（复发）/缺口（降本） |
| 日志错误 | 保留 16 文件仅覆盖 10-28→10-30（27.5K 行）：INFO 27,590 / WARN 117 / ERROR 10；402×6；**10-15 前日志已轮转消失** | log/*.log | 高（窗口） |
| actor 结局污染 | last_outcome: failure 1,033 / success 605 / cancelled 42——其中 **1,022 条 last_error=「Process restarted while actor was active」**，失败率被进程重启噪声主导 | actor_registry | 高 |

## D.1 五类归因（禁止笼统怪模型）

| 归因 | 问题 | 证据 | 权重 |
|---|---|---|---|
| **架构设计** | ①失败调用不进账本（402×6 → 账本 tin==0 仅 2 行；DB error 273 行不进 stats）②同模型重试无换挡（402 四连打同一模型）③空轮 +8ms 注入「继续」原样撞墙（18 例/84min 根因未裁决）④无任务预算/超时强制、task/成本无归因（0 行 task id）⑤每工具一次模型往返是**结构性**开销（工具批 1.41/请求，V3 判定不属冗余） | WP-R2 F-1、echo-core §C3、wp42（0 命中 budget 字段）、v3_stage1 | **首要** |
| **上下文质量** | ①固定税 **38.6K/次**（占中位调用 38%），65% 调用 >75K，**投影看不见系统提示+工具 schema**（门限设在测不到的尺度上）②缓存 87.9% 只摊钱不省延迟与注意力③compaction 全史仅 1 次，超长会话靠投影硬扛（最大 1,310 轮） | stats.jsonl、WP-R2 §5-D1 | **收益上限最大** |
| **工具质量** | ①verify-gate `-File` 提取缺陷：82 次 cancel 中 64% 是管道符/参数碎片坏路径 → 误拦 + 诱导自我降级②edit 精确匹配失败 178 次③invalid 工具 66（大小写误写）④PS `>` 重定向写 UTF-16LE → 验收假阴性（已证 1 例） | stats.jsonl verify、part.state.error | **性价比最高快赢** |
| **模型能力**（有限，勿扩大） | 空轮的「请求即死/流中断」9+9 例、ContentFilter 8、edit 无匹配、工具名误写；但 **V3 显示失败后重分析 40/56 是局部正确恢复，无系统性「失败全量重走」** | v3_stage1 | **非主要矛盾** |
| **执行策略** | ①多 Agent 委派已证负收益（2.74×/2.01×/1 超时，质量无差）→ 现已改「单 Agent 默认」，属**已纠正**项；但 actor 成本仍不可归集②「先断言后看数据」返工（自优化轮 10–12 轮测试返工、94K token 文档），**记忆规则记录后仍复发 ≥6 次** → 靠记忆自律无效，需工具化③任务收尾率 62%，37.8% 滞留 | MEMORY-wp53b、MEMORY-selfopt、task 表 | 中 |

## D.2 核心问题清单（排序 = 影响 × 可行性）

| # | 问题 | 影响 | 修复成本 | 收益 | 风险 | 归因 |
|---|---|---|---|---|---|---|
| **P1** | **失败与空转不可观测，且失败后原样重试**（84min/5 会话空轮、402×6 无账、0 行 task id） | ★★★★★ | 低-中 | 一切优化收益变得可测；悬案可裁决 | ≈0（纯观测） | 架构 |
| **P2** | **每调用 38.6K 固定税 + 65% 请求 >75K**（投影对此盲区） | ★★★★★ | 高（改动面宽） | 地板成本下降，作用于全部 4,186+ 次调用 | 中（影响每次请求） | 上下文 |
| **P3** | **无预算强制与任务归因**（子代理/任务超支无闸、成本无处记账） | ★★★★ | 中 | 最坏损失有界；成本可归集 | 中（误杀风险，需宽限期） | 架构 |
| **P4** | **模型容灾缺失**（同模型重试撞死，402 整段死局 2min31s） | ★★★★ | 中-高 | 可用性提升、死局时长有界 | 中（档位漂移、振荡） | 架构 |
| **P5** | **工具误报/误用往返税**（verify 误拦 82、edit 无匹配 178、invalid 66） | ★★★ | **低** | 每次省 1 个模型往返 | 低 | 工具质量 |
| **P6** | **完成判定 fail-open + 任务收口率 62%**（goal 判官内存态、判官失败放行停机、37.8% 任务滞留、无验收字段） | ★★★★ | 中 | 假完成消失；任务真正闭环 | 中（过度严格会卡死） | 架构 |
| **P7** | **死代码与幻影机制的认知负担**（30+ tools TS 从未加载、四角色已证伪、TRIAGE/RECOVERY 自动调用 0） | ★★★ | **低**（纯清理） | 消除误导，回收注意力 | 低（删除前再探针一次） | 架构 |
| **P8** | **执行隔离弱**（无强制 worktree、词法 jail 不解 symlink） | ★★★ | 中-高 | 并行任务安全 | 中 | 架构 |
| **P9** | **记忆自律无效**（「先测再断言」记了仍复发 ≥6 次；memory 工具仅占 0.4%） | ★★★ | 中 | 经验真正降本 | 中（记忆污染） | 执行策略 |
| **P10** | **Echo 无 git 历史**，10-15 前日志已轮转 | ★★ | 低（今后养成） | 可归因、可复盘 | 低 | 流程 |

**明确不立项**：①「增加角色/增加规划步骤」——已被 A/B 证伪（2.74×/2.01×/质量无差）；②「减少重复分析」——精修后仅 ≈2.2%，非主要矛盾；③「模型能力提升」——非主要矛盾且不属本次范围。

---

# E. 目标架构设计

## E.1 设计原则（三条，不可违反）

1. **不重写 MiMoCode，不重复造轮子。** 宿主已提供且够用的能力一律通过接口复用。
2. **要害能力必须自己掌握。** 凡是关系到「自主性、可测性、责任归属」的（观测、预算、容灾、验证、经验、扩展），不交给宿主的隐式行为。
3. **不为架构图好看而拆模块。** 下列 7 个模块各自对应一个已被证据证明的独立问题域，删掉任何一个都会留下已知缺口。

## E.2 Echo Core 七模块（职责 / 接口 / 数据流）

```
                        ┌──────────────────────────────┐
   用户目标 ────────────▶│  1. Goal & Task Gate         │ 目标理解 · 任务树 · 完成闸
                        │     （任务状态与生命周期）      │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  2. Strategist               │ 自主规划 · 路径选择 · 复杂度分档
                        │     （执行策略）               │
                        └──────────────┬───────────────┘
                                       │
        ┌──────────────────────────────▼──────────────────────────────┐
        │  3. Budget Governor（预算治理）                              │
        │     步数 / token / 时间三维硬熔断 · 子代理预算 · 成本归因      │
        └──────────────────────────────┬──────────────────────────────┘
                                       │
   ┌───────────────┐   ┌───────────────▼───────────────┐   ┌───────────────┐
   │ 4. Model      │◀──│  5. Executor（执行与工具调度）  │──▶│ 6. Verifier   │
   │   Fallback    │   │     复用宿主 tool/gate/preview  │   │  （结果验证）  │
   │  （模型容灾）  │   │     + actor/task + MCP 懒加载   │   │  验收证据闸    │
   └───────┬───────┘   └───────────────┬───────────────┘   └───────┬───────┘
           │                           │                           │
           │            ┌──────────────▼──────────────┐            │
           │            │  0. Observer / Ledger       │◀───────────┘
           │            │     （观测与账本）★前置设施   │
           │            │  失败进账 · task 归因 · 固定税│
           │            │  分项计量 · 对账器            │
           │            └──────────────┬──────────────┘
           │                           │
           │            ┌──────────────▼──────────────┐
           └───────────▶│  7. Experience Store        │
                        │     （经验积累与能力扩展）     │
                        │  trajectory 提取 · 有效期 ·   │
                        │  复核 · 缺口识别 · 扩展评估    │
                        └─────────────────────────────┘

      宿主边界 ═══════════════════════════════════════════════════
      MiMoCode v0.1.16：模型 API / 工具注册表 / 并发门 / 上下文压缩
      重建 / snapshot 回卷 / inbox / workflow 沙箱 / permission
```

## E.3 逐模块：必须自建 / 可安全复用 / 需接口解耦

| 模块 | 必须自建（Echo 核心） | 可安全复用（宿主） | 需接口解耦（补丁或新钩子） | 挂载点 |
|---|---|---|---|---|
| **0. Observer / Ledger** | 失败事件落账、`task_id` 归因、固定税分项计量、对账器 | `bus.subscribeAll` 事件转发、metrics 事件总线、DB | 核心需补 `metrics.model_error` 事件（B 档）；外层 `onEvent` 加 `session.error` 分支（A 档） | `event` / `session.llm.request` / `session.post` |
| **1. Goal & Task Gate** | 完成判定必须有验收证据；goal 状态持久化；任务树↔判官联动 | task 树（schema/registry/tool）、postStop 的 `tasks/<id>/progress.md` 校验 | goal 判官 fail-open 策略需可配 | `session.post`（outcome） |
| **2. Strategist** | 复杂度分档、路径选择、何时规划/拆分/委派/并行的决策 | plan→build 模式、compose-next skill、workflow 沙箱 | 无 | `session.pre`（可 cancel） |
| **3. Budget Governor** | 步数/token/时间三维硬熔断、子代理预算、超限自动终止 | wait 的 `timeout_ms`、`parent_actor_id` 归因、execution-ownership | **spawn 无预算字段**（spawn.ts:194）→ 需核心补丁或 `actor.preStop` 外层看门狗 | `session.pre` / `actor.preStop` / `actor.postStop` |
| **4. Model Fallback** | 升级/降级策略、防振荡、故障分类→档位映射 | `retry.ts` 的错误分类与退避、`model_groups`(ultra/standard/lite) 分档地基 | **`chat.params` 无 model 字段** → 外层换不了模型。**这是唯一必须动核心接口的能力**（新增 model 换挡点或 provider 级 fallback） | `retry` 决策点（核心补丁） |
| **5. Executor** | 工具选择策略、失败根因判定 | **全量复用**：registry / gate(FIFO+FAIL_CASCADE) / preview / actor / task / MCP 懒加载 / snapshot 回卷 | 无 | 插件 `tool` / `tool.execute.before/after` |
| **6. Verifier** | 验收标准定义、结果核验、假完成拦截 | 上游测试基线、verify-gate（修 -File 后） | 无 | `session.post`（finalText + trajectory） |
| **7. Experience Store** | 经验提取/去重/有效期/复核/检索；能力缺口识别与扩展评估 | memory FTS、inbox 持久化收件箱、`session.post` 的完整 trajectory | 无 | `session.post`（trajectory） |

**关键判断**：七模块中六个可以用**纯外层插件**（挂 24 个 Hooks）实现，**只有 Model Fallback 一处必须动核心**。这说明「Echo 独立核心」≠「重写 MiMoCode」，而是**在插件接口面之上建立自己的认知与治理层**，并在接口不足时做最小核心补丁（echo-dev 分支、单 commit 可 revert）。

## E.4 执行风格（对应终极目标第 9 条）

不是新模块，而是七模块的**行为约定**（继续留在记忆规则层，但配工具化闸门）：信息足够立即行动；不重复询问；不为完美计划拖延；不确定性优先低风险验证；只有缺关键条件才提问；完成后给可验证结果。**其中「先测再断言」一条已证明靠记忆自律无效（复发 ≥6 次），必须由 Verifier 模块工具化强制。**

---

# F. 本月重构路线图

**总原则**：先观测，再预算，再容灾，最后经验。**不平均分配开发工作**。每一阶段独立可验收、单 commit 可 revert、新机制默认 OFF。

## 阶段 1（前置设施）：C1 失败可观测与账本对账 ★本月唯一必须完成

- **要解决的问题**：P1——失败与空转不可观测（84min 悬案、402×6 无账、0 行 task id），一切优化收益不可测。
- **修改范围**：
  - A 档（外层，零核心改动）：`context-gate/index.ts` `onEvent` 增加 `session.error` 分支（约 10 行）+ 对账脚本 `reconcile-errors`（解析日志 ERROR 行 ↔ stats `ev:"error"` 逐条匹配）。
  - B 档（核心，echo-dev 分支）：`metrics/event.ts` 新增 `metrics.model_error`（~20 行）；`session/processor.ts` halt 处补发（~10 行）；`session/prompt.ts` 无效输出耗尽处补发（~5 行）；新增单测（~40 行）。
  - 顺带：账本行加 `task_id` 字段（复用 `session.post` 已有 task_id）。
- **理由**：这是**验证一切后续优化的前置设施**。没有它，本报告 D.2 的任何一项收益都无法被证明。
- **预期能力提升**：失败可查、账本与日志逐条对账零偏差、"无效重试"指标摆脱【待验证】。
- **风险**：≈0（纯观测层，不改重试/路由/模型/插件行为）。A 档动生产插件需专门批准。
- **验收**：①对账零偏差；②402/空轮现场可重放查询；③账本 error 行非空且分类正确；④上游测试 `bun run --cwd packages/cli test` 不回归。
- **依赖**：无。**它是所有后续阶段的依赖。**

## 阶段 2（并行快赢）：工具质量三修

- **要解决的问题**：P5——verify-gate `-File` 提取缺陷（64% 坏路径）、edit 无匹配 178 次、invalid 工具名 66 次。
- **修改范围**：`context-gate/verify.ts` 提取逻辑（根因已精确锁定 WP-R2 §5-C3）；`tool/edit.ts` 无匹配时给定位提示；工具名大小写容错或更清晰报错。
- **理由**：**性价比最高**——单点、低风险、每次省 1 个模型往返，作用于 730 次失败/16 天。
- **预期能力提升**：工具失败率 3.2% 显著下降；误拦消失。
- **风险**：低。verify.ts 改动需回归既有 99 事件场景。
- **验收**：重放 85 个真实 path，坏路径提取率 0；edit 无匹配场景给出可行动提示。
- **依赖**：无（与阶段 1 并行）。

## 阶段 3：C2 预算强制与任务归因

- **要解决的问题**：P3——子代理/任务超支无闸（415.6s 实例）、成本 0 行 task id、最坏损失无界。
- **修改范围**：`actor/spawn.ts` 增加 time/turn/token 预算字段（默认 OFF，config 开关）；`actor.preStop` 外层看门狗（超限 cancel + 落账）；ReAct 上限 `MAX_PRE_REACT/MAX_POST_REACT` 配置化（现硬编码 3，源码 TODO 已注明）；`maxSteps`/`steps` 硬熔断接入 Budget Governor。
- **理由**：长任务最坏损失无闸，用户非程序员，更依赖机制而非自觉。
- **预期能力提升**：超支自动终止 + 落账，最坏损失有界；成本可归集到 task。
- **风险**：**误杀风险**（需宽限期/分级：先通知后强杀）；对"模型能力不足导致的慢"可能过早终止。
- **验收**：B4 基准加"超时子任务"变体——超限必须自动 cancel 且父代理收到通知、账本有终止记录；现有 B4 不回归。
- **依赖**：阶段 1（否则终止记录无法验证）。

## 阶段 4：完成闸与任务收口

- **要解决的问题**：P6——goal 判官 fail-open、内存态、MAX_GOAL_REACT=12 超限放行停机；任务收口率仅 62%，37.8% 滞留，无验收字段。
- **修改范围**：task schema 增加 `acceptance`（验收证据）字段；goal 状态持久化（当前 `goal.ts:113` 仅内存 Map）；判官失败策略可配（当前 prompt.ts:4485-4493 fail-open）；Verifier 模块强制「先测再断言」闸门。
- **理由**：假完成是"对任务结果负责"的最大敌人；记忆自律已证无效。
- **预期能力提升**：任务真正闭环；假完成可拦截；「先测再断言」复发消失。
- **风险**：过度严格会卡死简单任务 → 验收要求必须按任务复杂度分档。
- **验收**：①任务收口率 62%→85%+；②抽样 20 个 done 任务，验收证据齐全率 100%；③「先测再断言」类返工 0 复发。
- **依赖**：阶段 1（task 归因字段）。

## 阶段 5：C3 模型容灾 ★需要先裁决接口

- **要解决的问题**：P4——同模型重试撞死（402 四连打同一模型、2min31s 死局），全仓无 fallback。
- **修改范围**：先做**接口裁决实验**：`chat.params` 无 model 字段 → 外层换不了模型。两条路：(a) 核心新增 fallback 决策点（`retry.ts:323` decide 接入 model_groups 档位）；(b) 外层通过 `session.pre` cancel + 重启会话换模型。**先实验再定**，不预设。
- **理由**：可用性；但改动面比 C1/C2 大，且有档位漂移/振荡风险。
- **预期能力提升**：故障死局时长有界；402 类死局可自愈。
- **风险**：质量/成本档位漂移、防振荡、402 欠费应降级不该升级的语义要先定义。
- **验收**：mock 402/503 故障注入，断言按策略换挡并落账；B3 同价位对照跑。
- **依赖**：阶段 1（失败计量）、阶段 3（预算限幅防止换挡震荡失控）。

## 阶段 6：经验积累工具化

- **要解决的问题**：P9——记忆自律无效（复发 ≥6 次）、memory 工具仅占 0.4%、无前后对照数据。
- **修改范围**：Experience Store 挂 `session.post`（trajectory）提取经验；经验带**有效期与复核状态**（避免过期污染）；能力缺口识别→扩展需求→成本收益评估→授权下实现。
- **理由**：终极目标第 5、6 条（经验积累、自主扩展）目前几乎为零实现。
- **预期能力提升**：相似任务调用数/token 下降（这是唯一能证明"记忆降本"的方式）。
- **风险**：记忆污染、无效记忆堆积 → 必须有淘汰机制。
- **验收**：同类任务前后 2 对会话对比 assistant 轮数与 tin 总量；经验检索命中率可测。
- **依赖**：阶段 1（trajectory 与 task 归因）。

## 阶段 7：清理与固化（随时可做，低风险）

- **要解决的问题**：P7/P10——死代码与幻影机制认知负担、无 git 历史。
- **修改范围**：删除/归档 `~/.mimocode/tools/` 30+ TS（**删除前再跑一次运行时探针**，因 09-23 注册源失传）；归档 wu.py/TRIAGE/RECOVERY/HANDOFF；删除 B0、`tail_turns` 过期配置字段；`model-router.ts` 的 auth.json 读取面**必须移除**（密钥暴露）；此后 Echo 所有改动进 git。
- **理由**：消除误导、回收注意力、建立可归因性。
- **风险**：低（但删除前探针一次，成本 ≈0）。
- **依赖**：无。

## 阶段依赖图

```
阶段 1（C1 观测）────────┬──────────────┬──────────────┬──────────▶ 阶段 6（经验）
   ★ 前置，本月必成      │              │              │
                        ▼              ▼              ▼
                   阶段 3（C2 预算）─▶ 阶段 4（完成闸）─▶ 阶段 5（C3 容灾）
                                                        （先裁决接口）
阶段 2（工具快赢）── 独立并行，随时可做
阶段 7（清理固化）── 独立并行，随时可做
```

## 明确不做（本月）

- 不重写 MiMoCode；不自建 Agent 主循环、工具注册表、并发门、上下文压缩（宿主已够用）。
- 不增加角色/规划步骤（已证伪）。
- 不切换模型、不升级依赖、不动 4097 serve、不删任何未探针确认的文件。
- 不做容器级沙箱（P8 的 worktree 隔离列为下月候选，先不占本月资源）。

---

# G. 效果验证方案

**总则**：在**相同模型（`deepseek/deepseek-flash`）、相同任务集、尽可能一致的运行环境**下做优化前后对照。**不能仅凭主观感受判断 Echo 是否变强。** 每项优化必须先跑基线再改动，改完重跑同任务集。

## G.1 六类基准任务（B1–B5 扩充为 B1–B6）

| # | 任务类型 | 任务设计 | 考察能力 | 对应优化 |
|---|---|---|---|---|
| **B1** | **简单任务** | 单文件单点修改 + 一次验证（如改一个常量并跑测试） | 效率、不把简单任务复杂化 | 全部 |
| **B2** | **多步骤任务** | 跨 3–5 步的目标（如"统计 X 并产出报告"） | 规划、持续推进、收口 | 阶段 3/4 |
| **B3** | **多文件代码修改** | 一处改动波及 3+ 文件（含测试） | 上下文组织、结果验证 | 阶段 4/6 |
| **B4** | **工具密集型任务** | 需 20+ 次工具调用（搜索/读/改/跑） | 工具选择准确性、并发门、上下文税 | 阶段 2、P2 |
| **B5** | **失败恢复任务** | 注入故障（mock 402 / 无效工具名 / edit 无匹配 / 超时子任务） | 失败可观测、恢复策略、容灾 | 阶段 1/3/5 |
| **B6** | **需要历史经验的任务** | 重复执行同类任务两次（如两次架构审计） | 记忆降本、经验复用 | 阶段 6 |

**B5 故障注入变体**（每个至少 1 例）：①mock 402 → 考察换挡与落账；②注入无效工具名 → 考察错误提示与恢复；③edit 无匹配 → 考察定位提示；④超时子任务 → 考察自动 cancel 与通知；⑤空轮触发 → 考察是否原样撞墙。

## G.2 指标（每项前后对照）

| 指标 | 口径 | 采集方式 | 现状基线（本次实测） |
|---|---|---|---|
| **任务成功率** | 验收通过的任务数 / 总任务数 | task 表 + 验收字段（阶段 4 落地后） | 收口率 62%（415/666），**无验收字段** |
| **完成时间** | 墙钟（起→验收通过） | stats.jsonl `t` + 任务起止 | 单任务 48–1,101 次请求（5 样本） |
| **Token 消耗** | tin / tout / cache_read 总量 | stats.jsonl + DB | 全史 input 142.8M / $38.54 |
| **无效调用** | 零产出轮 + 失败调用 + 无匹配工具 | DB `tokens.total==0` + error + part.state.error | 空轮 295 条；工具失败 730/22,717=3.2% |
| **重试次数** | 同签名重复调用 | DB 同 tool 同参数 | 原始 8.3%，真冗余 ≈2.2% |
| **验证通过率** | 首次提交即通过验收的比例 | Verifier 记录 | **当前无此度量** |
| **每调用输入 token** | 中位 / P90 | stats.jsonl | **中位 100,589** / P90 171,666 |
| **固定税** | 每会话最低 tin 的 p25 | stats.jsonl | **38,639** |
| **失败可见率** | 落账的失败 / 日志 ERROR 行 | 对账器（阶段 1 产出） | **当前 ≈0%（402×6 → 账本 2 行 tin==0）** |
| **任务成本归因率** | 带 task_id 的账本行 / 总行 | stats.jsonl | **当前 0%** |

## G.3 对照实验纪律

1. **同模型同环境**：固定 `deepseek/deepseek-flash`；固定 `MIMOCODE_HOME` 隔离目录；固定配置快照（改配置即换实验组）。
2. **先基线后改动**：阶段 1 开工前先跑一轮 B1–B6 拿基线（预算 ¥4–12/轮，月 2–4 轮）。**没有基线就不宣称任何优化收益**——这是本次审计最大的教训（84min 悬案正是因为没有失败计量）。
3. **每阶段独立验收**：按 F 各阶段的验收条款逐条打勾，不通过不进入下一阶段。
4. **禁用主观判断**：报告必须给数字对照表；"感觉更强"不构成验收。
5. **成本约束**：月度上限 ¥200；本阶段实际额外费用 ≈¥0（仅 git fetch 免费流量）；基准与实验在隔离环境跑，预计全月 ≤¥70。

## G.4 证据缺口的最低成本补法

| 缺口 | 补法 | 成本 |
|---|---|---|
| 空轮 18 例根因（provider 流中断 vs transform） | 离线对齐 stats transform 时戳 ±15ms 与 DB 空轮时戳（`v3_empty_correlate.py` 已有） | ≈0 |
| 插件 `event` 钩子能否收到失败事件 | 隔离 MIMOCODE_HOME 注入 1 次 mock 402，看 stats 是否落行 | ≤¥5 |
| 记忆检索命中率/降本 | 取 2 对同类任务会话，比 assistant 轮数/tin 总量；`memory_fts` 873 条可离线算召回重合度 | ≈0 |
| 10-15 以前日志 | **已轮转，不可恢复** → 空轮/402 历史只能以 WP-R2/V3 已存报告为准，今后必须留住日志 | — |

---

# H. 最终结论（回答任务书 §8 的八个问题）

### 1. 当前 Echo 距离终极目标还有多远？

**一句话：Echo 现在是一个「人格 + 记忆 + 上下文投影 + 桌面集成」的外层，不是一个 Agent 核心。** 九项终极能力中，**零项**由 Echo 自己掌握：

| 终极能力 | 现状 | 判定 |
|---|---|---|
| 1 高效率 | 中位 6 次调用/会话尚可，但单次 100K token、38.6K 固定税、84min 空轮 | **不达标** |
| 2 高灵活性 | 完全依赖宿主循环，无自己的流程编排（编排包自动调用 0 次） | **不达标** |
| 3 真正的自主性 | maxSteps 默认 Infinity、判官 fail-open、37.8% 任务不收口 | **不达标** |
| 4 工具调用能力 | 工具失败率 3.2%，verify 误拦 64% 坏路径，30+ 自建工具从未注册 | **不达标** |
| 5 经验积累 | 记忆规则记了仍复发 ≥6 次；memory 工具占 0.4%；无降本证据 | **接近零** |
| 6 自主扩展 | 无缺口识别、无扩展评估机制 | **零** |
| 7 记忆管理 | 四层库存在但旁路直写、闸门是死代码；有过期/污染风险 | **部分** |
| 8 问题解决能力 | 无根因纪律工具化、失败后原样重试 | **不达标** |
| 9 执行风格 | 规则在记忆里，但靠自律（已证会失效） | **部分** |

**差距不在模型，在架构**：四类要害（观测、预算、容灾、验证）全部空缺。

### 2. 现有架构中哪些东西是真正有价值的？

**四件，其余都是负担**：
1. **context-gate 视图投影**（实测 −65.78% est / 加权 −25.83%、errs=0）——唯一实证有效的性能机制，层次正确（"传什么"属 Echo）。
2. **人格身份层**（`identity/Echo.md` + 形象 + 桌面集成 + 协作纪律）——与 MiMoCode **零重复**的差异化资产。
3. **gates-changelog 配置治理**（过渡配置 + 口径校准 + 复审日期）——好实践，应推广。
4. **自优化探针 probe.py**（探针先行，防"先断言后看数据"）——应工具化为核心能力。

### 3. 过去的优化中哪些应该迁移，哪些应该淘汰？

- **迁移到 Echo 核心**（4）：失败进账本（C1）、task/成本归因、cost_gate 三态语义、probe.py 经验探针。
- **重构后保留**（2）：budget_watchdog 语义并入 C2；memory-manager 语义在核心重写。
- **保留原样（外层）**（5）：context-gate 投影、deny 危险命令、gates-changelog、人格身份、~150 skills。
- **删除**（6）：`~/.mimocode/tools/` 30+ 死代码（**含 model-router 的 auth.json 密钥面，必须先删**）、四角色实体化、TRIAGE/RECOVERY/HANDOFF 自动化幻影、B1/B0 动态预算、`tail_turns` 过期字段、wu.py 自动链路（**归档不删**，它是用户作品与纪律载体）。
- **暂缓**（2）：容器级沙箱、MiMo-V2.6 接入。

### 4. MiMoCode 新版本解决了哪些旧问题？

**解决了**：MCP 工具 schema 全量发送（→ 懒加载 `mcp_tool_search`/`mcp_tool_use`，工具表字节稳定）；旧上下文剪除体系的误伤（→ checkpoint 阈值梯 + rebuild-from-checkpoint）；内存态 inbox（→ 持久化收件箱）；子代理恢复链（cascadeSubagentResume）；多实例执行归属冲突（execution-ownership + leaseGuard）；空/坏输出处理不统一（→ InvalidOutputError 并入统一 retry）。
**没解决**：失败可观测、预算强制、模型容灾、执行隔离、完成判定的 fail-open、任务成本归因。

### 5. Echo 必须独立掌握哪些核心能力？

**七模块（见 E.2）**，其中**六模块可用纯外层插件实现**，只有 **Model Fallback 一处必须动核心接口**（`chat.params` 无 model 字段）。因此「独立核心」的正确含义是：**在插件接口面之上建立自己的认知与治理层**，接口不足时做最小核心补丁——不是重写 MiMoCode。

### 6. 当前最值得投入资源解决的三个瓶颈是什么？

1. **P1 失败与空转不可观测**（架构）——前置设施，不修它一切收益不可测。
2. **P2 每调用 38.6K 固定税 + 65% 请求 >75K**（上下文）——收益上限最大，但须先做"固定税分项计量"再动刀。
3. **P5 工具误报/误用往返税**（工具质量）——性价比最高快赢，单点低风险。

（P3/P4/P6 紧随其后，但 P2 收益上限最大、P5 修复成本最低，与 P1 构成"一前置 + 一大收益 + 一快赢"的最优组合。）

### 7. 本月应该优先改动哪些模块？

**阶段 1（C1 观测）是本月唯一必须完成**；阶段 2（工具快赢）与阶段 7（清理固化）并行做。阶段 3/4/5/6 按依赖顺序排在后续月份。**不要平均分配开发工作。**

### 8. 改完之后如何证明 Echo 真的更强？

跑 **B1–B6 六类基准任务的优化前后对照**，比十个数字：任务成功率、完成时间、Token 消耗、无效调用、重试次数、验证通过率、每调用输入 token、固定税、失败可见率、任务成本归因率。**其中"失败可见率"从 0% 变成可对账、"任务成本归因率"从 0% 变成可归集，就是 Echo 迈出独立核心第一步的硬证据。** 没有基线对照，任何"变强了"的说法都不成立——这正是本次审计最大的教训。

---

## 附：本次审计的越界声明

**未修改**任何源代码、配置、记忆、历史记录、服务；**未执行** Git Reset/Rebase/Clean/checkout；**未删除**任何历史机制；**未升级**依赖或切换运行版本。唯一网络操作为 `git fetch --depth 1 origin tag v0.1.16`（仅新增 git 引用，不动工作区、不改历史），目的为取得本机实际运行版本的源码以完成"必须结合源码判断"的审计要求。本文件（报告）是本次审计的交付物，不属源代码/配置/历史改动。

**本次实际额外费用 ≈¥0**（git fetch 免费流量；审计用 token 属既有订阅内消耗）。

