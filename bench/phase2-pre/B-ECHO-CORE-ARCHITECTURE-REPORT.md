# Echo Core 当前架构报告

任务编号：EC-PHASE2-PRE-01 / WP-02 交付物 B
审计日期：2026-10-31
性质：只读架构审计（以实际代码为准，非设计文档）
证据基线：`D:\EchoCore\MiMo-Code` @ `496bb8c` + 工作区自研改动；`D:\EchoCore\echo-core`；`~/.config/mimocode/`

---

## 1. 整体架构图

```
┌─────────────────────────── 用户侧 ───────────────────────────┐
│  TUI (thread→worker→Server)   Headless `mimo run`   HTTP API  │
└──────────────┬──────────────────────┬─────────────────┬───────┘
               ▼                      ▼                 ▼
┌─────────────────────────── CLI 主运行时 (@mimo-ai/cli) ──────┐
│                                                               │
│  session/prompt.ts (7234行·编排核心)                          │
│    ├─ runLoop ──► session/processor.ts (流→状态机)            │
│    │                ├─ llm.ts (streamText) ──► Provider       │
│    │                ├─ executeTool (fiber+toolGate)           │
│    │                └─ tool-error handler ──► classify.ts ◄── Immune V1 │
│    ├─ tool/registry (bash/read/edit/actor/task/… + MCP)       │
│    ├─ actor/ (子智能体 spawn/execution)                       │
│    └─ session/ (compaction/checkpoint/prune/resume)           │
│                                                               │
│  bus/ (Effect PubSub 事件总线)                                │
│    └─ metrics/event.ts (ModelCall/ToolCall+diagnostic/agentID)│
│                                                               │
│  task/ (任务树 CRUD·DB)     config/ (mimocode.jsonc)          │
│  session.sql.ts (SQLite 权威状态)                             │
└───────────────────────────────┬───────────────────────────────┘
                                │ 事件订阅 (Bus)
                                ▼
┌─────────────────── C1 插件（配置目录·热加载） ────────────────┐
│  context-gate/index.ts (604行)                                │
│    ├─ 消费 metrics.tool_call/model_call/session.error         │
│    ├─ diagnostic 优先 → legacy 回退                           │
│    ├─ logStats → stats.jsonl (唯一账本·appendFileSync)        │
│    ├─ transform 钩子（上下文投影·不动DB）                     │
│    └─ verify.ts / roundtrip_hint（gates.json 门控）           │
└───────────────────────────────────────────────────────────────┘
```

## 2. 目录及模块组织

### 2.1 packages/ 顶层

| 包 | 职责 | 上游/自研 |
|---|---|---|
| `@mimo-ai/cli` | 主运行时：TUI/headless/server、session、工具、actor、config、metrics | 上游 + 自研改动 |
| `@mimo-ai/sdk` | HTTP 客户端 + OpenAPI 生成类型（v1 与 v2 双份） | 上游 + 手改 v2 类型 |
| `@mimo-ai/plugin` | 插件宿主类型与钩子面 | 上游 |
| `@mimo-ai/shared` | 跨包共享 util | 上游 |

### 2.2 cli/src/ 关键目录

| 目录 | 职责 | 备注 |
|---|---|---|
| `session/` | 会话核心：prompt.ts（编排）、processor.ts（状态机）、llm.ts、session.ts（DB 持久化）、compaction/checkpoint/prune | **prompt.ts 7234 行，巨石** |
| `tool/` | 内置工具 + registry 注册 + recoverable 判定 | classify 依赖其 isRecoverableError |
| `bus/` | Effect PubSub 类型化事件总线 | Immune 事件通道 |
| `metrics/` | event.ts（事件 schema）、classify.ts（**自研新文件**）、subscriber.ts（远程上报）、immune-memory/tolerance（**自研·仅定义**） | V1 主战场 |
| `actor/` + `task/` | 子智能体编排 / 任务树（DB 表） | 两套体系解耦 |
| `config/` | mimocode.jsonc 加载与 schema | autoupdate 等开关 |
| `server/` | HTTP API → SessionPrompt | |
| 其余 | memory/、workflow/、mcp/、permission/、provider/、plugin/、project/ 等 | 支撑域 |

### 2.3 数据与配置位置（运行时）

| 资产 | 位置 | 性质 |
|---|---|---|
| 权威状态 DB | `~/.local/share/mimocode/mimocode.db`（实测 ~985MB） | session/message/part/task 表 |
| 记忆投影 | `~/.local/share/mimocode/memory/`（projects/sessions/global .md） | checkpoint writer 产出 |
| 配置 | `~/.config/mimocode/mimocode.jsonc` | 含 autoupdate:false（2026-10-31 加固） |
| C1 插件 + 账本 | `~/.config/mimocode/context-gate/{index.ts,gates.json,stats.jsonl}` | 热加载；账本 ~1.95MB 活跃 |
| 正式二进制 | `~/.mimocode/bin/mimo.exe` = dc28dff1 | Immune V1 载体 |

## 3. 核心运行链路

### 3.1 用户输入 → 任务执行

1. 入口分发：`index.ts:65-238`（yargs）→ TUI（`cli/cmd/tui/thread.ts:158` → worker 起 Server）/ headless（`cli/cmd/run.ts:700`）/ HTTP（`server/routes/instance/session.ts:1315`）
2. `SessionPrompt.prompt`（`prompt.ts:3430-3474`）：校验、建 user 消息
3. runLoop（`prompt.ts:3633`，loop 包装 :5773）：每轮 checkpoint 触发（:4761）
4. processor.create（:5000）→ resolveTools（:5011）→ buildLLMRequestPrefix（:5349）
5. processor.process（`processor.ts:921-967`）→ llm.stream（:943 → `llm.ts:867`）
6. 结果经 bus 事件回流；C1 订阅落账

### 3.2 任务规划 → 子智能体调度

- actor 工具（`tool/actor.ts:36-80`）动态枚举 subagent_type，spawnRef 晚绑定防层环（:47-62）
- spawn（`actor/spawn.ts`）建子会话，子 actor 复用 SessionPrompt.runLoop
- 执行槽 `sessionID:actorID` 唯一（`actor/execution.ts:21-55`）
- task 工具独立任务树 CRUD（DB），与 actor 解耦

### 3.3 工具调用与结果回传

- 注册：`tool/registry.ts:227-249`（内置）+ 插件/MCP 运行时挂载（`prompt.ts:1991-2195`）
- 执行包装（`prompt.ts:1880-1981`）：plugin before 钩子 → item.execute（:1924）→ processor.executeTool（fiber+toolGate，`processor.ts:451-484`）
- 成功：completeToolCall（:383+）+ Metrics.ToolCall success（`prompt.ts:1960-1969`，带 agentID）
- **失败（V1 注入点）**：tool-error handler（`processor.ts:647-668`）→ `classifyToolError`（:655）→ 事件带 diagnostic（:665）
- 取消：cancelled 路径带 `{cancelled:true}` diagnostic（`prompt.ts:1911-1918` 本地 / :2080-2087 MCP）
- 注意：bash exit≠0 仅 gate.fail（:1947），**不发 error ToolCall**（统计口径偏差，见遗留）

### 3.4 记忆读写与上下文更新

- 权威：SQLite（`session.sql.ts:15-120`，含 last_checkpoint_message_id）
- 压缩：compaction.ts（LLM 摘要 :397 + prune :286）；触发：overflow.ts budget（`compaction.max_context` :44-72）
- 检查点：prune.ts resolveThresholds（`checkpoint.thresholds` :282-301）→ checkpoint.ts 写 `memory/sessions/<sid>/checkpoint.md` 等（checkpoint-paths.ts:15-86）；rebuild 注入预算化（checkpoint.ts:1322-1397）
- resume：prompt.ts:565-574 + :6219-6302

### 3.5 任务树、检查点与恢复

- 任务树：DB TaskTable + TaskEventTable（`task/task.sql.ts:5-50`）
- progress.md：subagent 自写 + `plugin/subagent-progress-checker.ts:104-172` postStop 强制（缺 section → ReAct 逼写）
- checkpoint 校验：`plugin/checkpoint-splitover.ts` 挂 actor.preStop
- 恢复：session resume 机制 + memory 文件投影

### 3.6 评判与完成判定

- 会话切片：C1 维护 slice_pre/slice（outcome=completed/error）；main tid=null
- 对账：`bench/reconcile.py` 三源（stats.jsonl + DB task 表 + 日志）五桶归类；suspicious_no_gate 按切片自身 tid 判定（:164-190，Phase1B 修复）
- 任务完成：task status 终态 + progress.md 校验，无自动"质量评分"体系

### 3.7 Immune V1 接入方式

- **接入点唯一**：Core 在 tool-error/cancelled 路径发布带 diagnostic 的 Metrics.ToolCall；C1（配置目录插件）订阅消费 → stats.jsonl
- Core 不落账 diagnostic（subscriber.ts 上报体亦未转发 diagnostic/agentID —— 远程分析链路缺字段）
- C1 禁用（gates.json c1:false）时 V1 分类发布但无人消费

### 3.8 日志/诊断/状态持久化

- stats.jsonl（C1 单写者）：ev 全集含 tool/error/model/task/retry/slice_pre/slice/verify/rth/transform/compacted 等（15+ 种）
- DB：会话权威 + assistantMessage.cost（本地估算）
- memory/*.md：checkpoint 投影
- 三层（DB / 文件 / 内存 sliceStack）无统一事务，见风险

## 4. 核心能力矩阵

| 系统 | 状态 | 证据与说明 |
|------|------|-----------|
| **Cognitive 认知** | 部分实现 | 依赖上游 LLM loop（runLoop+streamText）；规划=模型行为+task/actor 工具，无独立规划模块；无自研推理/决策引擎 |
| **Memory 记忆** | 已实现·已验证 | DB 权威 + compaction/checkpoint/resume 全链路（§3.4）；配置消费链完整；已验证：本会话 checkpoint/memory 实际注入；风险=双存储无事务 |
| **Nervous 神经** | 已实现·已接入 | bus/ Effect PubSub 类型化总线；Metrics 事件 ModelCall/ToolCall/AgentRequest；C1 经插件事件钩子消费；已验证：V1 E2E 事件流 |
| **Sensory 感觉** | 部分实现 | 输入=用户消息/MCP/文件读取；C1 verify.ts 拦截 bash -File、图像产物验证（gates.verify=true 已部署）；无独立环境感知层 |
| **Execution 执行** | 已实现·已验证 | 工具注册/执行/fiber 并发/actor 子代理/MCP；Phase1B serial 12/12 + 双 tid E2E 验证；薄弱点=bash 非零退出不发 error 事件 |
| **Immune 免疫** | 已实现·已验证（V1 冻结） | classify 7 字段 + C1 落账闭环（正式安装 dc28dff1 C4/C2 E2E）；**部分未接线**：immune-memory/tolerance 零调用、ModelCall.diagnostic 空置、tool_not_found 生产近乎不可达 |
| **Metabolism 代谢** | 部分实现 | Token 全链路（usage→model_call→账本 tin/tout/cache）已验证（serial 88% cache）；**货币成本仅 DB 内估算，账本无字段**（actual_cost_cny=null）；无预算执行器 |
| **Homeostasis 稳态** | 部分实现 | reconcile 对账（suspicious_no_gate 已修）、gates 门控、compaction 预算、checkpoint 阈值；**无自动闭环**（离线对账）、sliceStack 内存态重启脆弱、fail-open 账本 |

## 5. 自研模块与上游边界

### 5.1 改动清单（git 实测）

| 文件 | 相对 496bb8c | 性质 |
|---|---|---|
| metrics/event.ts | +65 行 | Schema 扩展（DiagnosticInfo + agentID/diagnostic，全 optional） |
| session/processor.ts | +9 行 | 热路径：classifyToolError 调用 + diagnostic/agentID 注入 |
| session/prompt.ts | +7 行 | 热路径：4 处 publish 点（cancelled×2 + success×2） |
| sdk v2/types.gen.ts | +4 行 | **生成物手改**（仅 agentID，未含 diagnostic） |
| metrics/classify.ts | 新增 256 行 | V1 分类器（核心自研） |
| metrics/immune-memory.ts | 新增 | 仅 schema 定义（V1 占位） |
| metrics/tolerance.ts | 新增 | 仅原则常量+纯函数（V1 占位） |
| test/session/immune-real-path.test.ts | 新增 | 真实链路测试 |
| C1 context-gate/（配置目录） | 独立于仓 | 604 行插件：消费+落账+transform+verify |

### 5.2 边界判定

- **改动方式**：全部 additive（diff 仅 insertions），未删除上游行为；C1 经官方插件钩子面接入，无对 Core 源码反向依赖——**边界策略健康**
- **例外风险**：types.gen.ts 为 OpenAPI 生成物，手改会被下次 regen 覆盖；且 SDK 类型缺 diagnostic 同步（bus zod 有、SDK 无）
- **上游冲突热点**：processor.ts tool-error handler、prompt.ts 4 处 publish、event.ts schema 头、types.gen.ts
- **V1 部分接线**：工具错误+取消已闭环；记忆存储/耐受/Model 诊断/远程上报 diagnostic 转发未接线（见 D 清单）
