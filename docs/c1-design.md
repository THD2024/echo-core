# C1 失败可观测性设计说明（A 档 · 外层先行）

- 状态：设计定稿，A 档实现随本文件落地
- 依据：`docs/phase0-architecture-assessment.md` §D/§F 阶段 1；P2 任务书 2.1–2.7
- 宿主基线：MiMoCode **v0.1.16**（tag `b8dbe084`）——本文件全部事件/字段结论均经 `git show v0.1.16:` 逐条读源码确认，**未依赖 README/Release Notes/模块名**
- 落点：`C:\Users\微醺\.config\mimocode\context-gate\`（外层插件，**零核心改动**）
- 回滚：`gates.json` 设 `"c1": false`（mtime 热加载，无需重启）；或还原 `index.ts.pre-c1` 备份

---

## 0. 本次审计推翻的两个前提（先说，因为它决定了方案形态）

### 0.1 总线早已带齐 P2 所需指标，外层只是从未订阅

Phase 0 只分析了 `metrics.model_call` 一个事件，据此认为"失败不可观测"必须改核心。**本次逐点核实后结论相反**：v0.1.16 总线上已存在下列事件，且**均有真实发布点**（非仅定义）：

| 事件类型 | 负载（源码核实） | 发布点 | 直接支撑 P2 指标 |
|---|---|---|---|
| `metrics.tool_call` | `sessionID, tool_name, input_bytes, output_bytes, tool_call_id, tool_call_status ∈ {success,error,cancelled}` | `processor.ts:715`、`prompt.ts:1976/2025/2150/2245`（4 处） | **工具失败率**（Phase 0 用 DB 反推 3.2%） |
| `session.retry.attempt` | `sessionID, messageID, attempt, phaseAttempt, maxAttempts, phase ∈ {request,stream}, kind ∈ {network,rate_limit,server,stream,unknown,terminal}, scope, reason, nextDelayMs, hostCode?` | `llm.ts:1003`、`processor.ts:1162`、`prompt.ts:6095`（3 处） | **重试次数 + 失败分类**；402 会是 `kind="terminal"` |
| `task.created` / `task.updated` | `sessionID, task{...}` / `sessionID, task, kind` | `task/registry.ts:124/127` | **任务收口对账**（创建/迁移/终态） |
| `metrics.try_best_detected` | `sessionID, reason ∈ {edit_repeat,bash_retry,action_streak}, count, similarity?, action?` | `processor.ts:422` | **重复行为**（Phase 0 用 DB 精修审计得 ≈2.2%） |
| `session.error` | `sessionID?, error (NamedError)` | **20+ 处**（`processor.ts:961/965`、`prompt.ts:2531…6796`、`config/agent.ts:140/177`、`config/command.ts:40`、`plugin/index.ts:240/566`、`skill/index.ts:118`、`server/.../session.ts:1133/1366`） | **失败可见率** |

**结论**：C1 的 A 档不必等核心补丁。Phase 0 §9"B 档才是事件级可回放"的判断**过保守**——外层订阅即可达到同级可观测性。核心补丁（`metrics.model_error`）降级为**可选增强**，本阶段不实施（见 §5）。

### 0.2 空轮在源码里有唯一日志锚点，但不进事件流

`processor.ts:1050-1096`：空/think-only 输出经 `classifyAssistantStep` 判为 `think-only` 或 `invalid`，随后
①清空该 turn 的 parts ②`slog.info("invalid output, dropping empty turn", {reason, finish})` ③抛 `InvalidOutputError` 交给 `SessionRetry.policy`。

**该路径既不发 `metrics.model_call`（失败不发）、也不发 `session.error`** → 这就是"空轮在账本上不可见"的**准确根因**（不是"事件不存在"，是"该路径不发事件"）。因此 A 档的空轮识别只能靠 **`session.post` 的 trajectory** 或 **日志侧解析**，见 §3.6。

---

## 1. 可用观测接口（全部经 v0.1.16 源码核实）

| 钩子 | 触发点（源码） | 输入负载 | 输出 | 关键保证 |
|---|---|---|---|---|
| `event` | `plugin/index.ts:371-381` `bus.subscribeAll()` 无差别转发 | `{event: {type, properties}}` | — | 全总线事件 |
| `session.pre` | `prompt.ts:4365-4377` | `{sessionID, agentID, task_id}` | `{cancel?, cancelReason?}` | 可在调模型前取消 |
| `session.post` | `prompt.ts:4074-4128`，经 `Effect.onExit` | `{sessionID, agentID, task_id, outcome ∈ {completed,error,cancelled}, error?, finalText?, assistantMessageID?, trajectory, systemPrompt?}` | — | **恰好触发一次**，失败/中断也不漏 |
| `actor.preStop` / `actor.postStop` | `plugin/index.ts:614/620`，`spawn.ts:472/553` 有 `MAX_PRE/POST_REACT=3` 上限 | 子代理生命周期 | `{continue?, reason?}` | 本阶段不用，供 C2 预算看门狗 |
| `tool.execute.before/after` | 已被 `verify.ts` 使用 | — | 可 cancel | 本阶段不动 |

**任务关联的关键限制（如实声明）**：`session.error` / `metrics.tool_call` / `session.retry.attempt` **均不携带 task_id**，只有 `session.pre/post` 带。故 A 档用 **`sessionID → task_id` 栈**在 `session.pre` 时登记、`session.error` 时回查。该关联是**尽力而为**：主 agent 切片常无 task_id（此时 `tid=null`），且 `session.error` 有 20+ 个非模型发布点（skill/config/plugin/command 加载失败），它们与模型失败**必须分类区分**——分类依据是同 session 时窗内是否存在 `metrics.model_call`/`session.retry.attempt`，见 §3.3。

---

## 2. 统一任务关联（P2.2）

| 标识 | 来源 | 生成/传递 | 持久化 |
|---|---|---|---|
| `sid` | `sessionID`（宿主） | 事件负载自带 | 已在 DB |
| `tid` | `task_id`（`session.pre/post`） | 仅 agent 切片有；由插件内存栈关联 | A 档记进 stats.jsonl（宿主 DB 不改） |
| `aid` | `assistantMessageID`（`session.post`） | 单个 agent 切片的最终 assistant 消息 | 记账 |
| `cid` | `tool_call_id`（`metrics.tool_call`） | 单次工具调用 | 记账 |
| `mid` | `messageID`（`session.retry.attempt`） | 单条 assistant 消息，重试的关联键 | 记账 |
| `agent` | `agentID`（`session.pre/post`） | main / subagent 区分 | 记账 |
| step id | **无原生 step id 事件** | 用 `session.post` 的切片边界近似一个 agent 切片 | A 档不强求（见 §6 缺口） |

**内存栈规则**：`Map<sessionID, Array<{task_id, agentID, t0}>>`。`session.pre` push；`session.post` pop（按 agentID 匹配）。回查取栈顶。**只依赖内存，不写 DB**——这符合任务书"避免只依赖进程内存关联任务"的要求：**关联结果在每次事件发生时立即落盘到 stats.jsonl**，因此断电/重启丢失的只是"未完成切片"的关联，历史记录已持久。

---

## 3. 错误记录与事件映射（P2.3 / P2.4）

### 3.1 落盘事件类型（`ev` 字段）

| `ev` | 来源事件 | 记录字段 | 对应任务书指标 |
|---|---|---|---|
| `model` | `metrics.model_call`（已有） | `sid, lat, ttft, tin, tout, cache, model` | model_tokens_input/output、平均调用次数 |
| `error` | `session.error`（**新增**） | `sid, tid, name, msg(300), t` | **失败可见率**、metrics.model_error |
| `retry` | `session.retry.attempt`（**新增**） | `sid, tid, mid, att, patt, maxatt, phase, kind, scope, reason, nd` | **重试次数**、失败分类 |
| `tool` | `metrics.tool_call`（**新增**） | `sid, tid, tool, st, cid, in, out` | **工具失败率**、metrics.tool_error |
| `task` | `task.created` / `task.updated`（**新增**） | `sid, tid, st, kind` | **任务收口率**、metrics.task_success/incomplete |
| `repeat` | `metrics.try_best_detected`（**新增**） | `sid, tid, reason, n, act` | 重复分析率（在线口径） |
| `slice` | `session.post`（**新增**，经钩子） | `sid, tid, agent, outcome, err, aid, msgs, tools, empty, txt` | **任务成本归因**、metrics.task_duration、空轮分类 |
| `slice_pre` | `session.pre`（**新增**，经钩子） | `sid, tid, agent` | 切片起始、关联登记 |
| `transform` / `rth` / `verify` / `compacted` | 已有 | 不变 | — |

### 3.2 指标口径（P2.4 每项必须明确）

| 指标 | 数据来源 | 统计口径 | 关联标识 | 可从原始事件重建 | 重复计数风险 |
|---|---|---|---|---|---|
| 失败可见率 | `ev:error` 行数 ÷ 日志 ERROR 行数 | 对账器逐条 | sid+name+时窗 | 是（日志仍在） | 同一失败可能多条 `session.error` → 按 `(sid,name,±5s)` 折叠 |
| metrics.model_error | `ev:error` 中同 session 时窗内有 `ev:model`/`ev:retry` 者 | 按时窗判定为模型类 | sid | 是 | 同上 |
| metrics.tool_error | `ev:tool` 且 `st != "success"` | 逐条 | cid 唯一 | 是 | **无**（cid 唯一键） |
| 重试次数 | `ev:retry` 计数 | `att` 取最大值，非求和 | mid | 是 | 同一 mid 的多次 attempt 是**同一个**重试链 |
| metrics.task_success / incomplete | `ev:task` 的 `kind` 终态 | done→success；blocked/abandoned→incomplete | tid | 是 | task.updated 可能多次 → 取**最后一条**状态 |
| 空轮数量 | `ev:slice` 中 `empty>0` | 见 §3.6 分类 | sid+aid | 部分（trajectory 不落盘） | 是，按 aid 唯一 |
| model_tokens_input/output | `ev:model` 求和 | 累计 | sid | 是 | **无** |
| task_duration | `ev:slice` 的 `t - slice_pre.t0` | per 切片 | sid+agent | 是 | 无 |
| verification_result | `ev:verify`（已有） | act=pass/fail 分计 | sid | 是 | 无 |

### 3.3 错误分类（P2.3 九类 → 实际落地映射）

任务书列 9 类，但**不为追求分类数量增加无实际价值的分类**。落地映射：

| 任务书分类 | A 档实现依据 | 说明 |
|---|---|---|
| 1 模型调用失败 | `ev:retry.kind ∈ {network,rate_limit,server,stream}` 或 `ev:error` 且同 sid 时窗内有 `ev:model` | 有 `retry.attempt` 后**优先用 kind**，更准 |
| 2 工具调用失败 | `ev:tool.st="error"` | 直接 |
| 3 工具参数错误 | `ev:tool.st="error"` + `ev:repeat.reason="edit_repeat"` | 不单独建分类（无价值） |
| 4 上下文/状态错误 | `ev:error` 且 name 含 `ContextOverflow`/`InvalidOutput` | 直接 |
| 5 调度错误 | `ev:error` 且 name 含 `Ownership`/`Actor`；`ev:retry.kind="terminal"` | 直接 |
| 6 验证失败 | `ev:verify.act ∈ {fail,block}` | 已有 |
| 7 超时 | `ev:retry.kind="stream"` + lat 异常；A 档**无法可靠识别** | **标记为部分可观测**，不硬凑 |
| 8 预算耗尽 | **A 档无预算字段**（宿主无此机制） | **标记为不可观测**，属 C2 范围，如实声明 |
| 9 未知错误 | `ev:error` 且无法归入以上 | 兜底 |

### 3.4 指标不进远端

`metrics/subscriber.ts` 由 `MIMOCODE_ENABLE_ANALYSIS` 门控。**A 档不向远端新增任何上报**（减合规面）。全部数据只落本地 `stats.jsonl`。

---

## 4. 任务收口对账（P2.5）

对账器（独立脚本，`bench/reconcile.py`）读三源：

1. **总线账本** `stats.jsonl`：`ev:task` 的最后一条状态（created→done/blocked/abandoned/open/in_progress）
2. **DB 任务表** `task`：权威状态（Phase 0 实测 666 创建 / 415 done / 180 open / 69 in_progress）
3. **切片结局** `ev:slice` 的 outcome（completed/error/cancelled）

输出五类：**正常结束 / 失败 / 未完成 / 恢复中 / 无法归类**。

**硬规则**：**没有错误记录 ≠ 成功**。任务状态必须来自 `task.updated` 的显式终态或 DB `status` 列；切片 `outcome="completed"` **不能**推断任务成功（`session.post` 的 completed 只表示"该 agent 切片没抛异常"）。

### 4.1 goal 判官 fail-open 的处理（P2.5 特别要求）

源码事实（v0.1.16）：
- `goal.ts:113` — `goals: new Map()` **仅内存**，重启丢失
- `prompt.ts:4485-4493` — `judgeFailed → allowing stop` **fail-open**
- `prompt.ts:274` — `MAX_GOAL_REACT = 12`，超限**也放行停机**（`:4530-4543`）

**A 档处置（只观测，不改停止机制）**：在 `session.post` 记录 `outcome` 时，**额外标记 `judge: "unknown"`**——即 A 档**不声称**知道判官是否参与或是否 fail-open，而是：
- 记录 `ev:slice` 的 `outcome` 与 `err` 原文
- 对账器把「切片 outcome=completed 但该 session 存在未终态任务」单列为 **`suspicious_no_gate`** 桶

**理由**：任务书明确"判官异常不能直接被当作任务成功或正常停止"且"禁止未经论证直接修改原有停止机制"。A 档的职责是**让 fail-open 变得可见**，改判定是阶段 4（完成闸）的事。**本阶段不修改 goal 判官任何逻辑。**

---

## 5. 空轮检测（P2.6）

**分类（6 类，对应任务书）**：

| 类 | 判定依据（A 档可得） | 可观测性 |
|---|---|---|
| ①模型正常判断无需行动 | 切片内有 assistant 且 `finalText` 非空且**无**工具调用，且**无** `ev:retry` | 可识别 |
| ②模型没产生有效内容 | 切片内 assistant parts 全空 | 可识别（trajectory） |
| ③工具调用没实际执行 | `ev:tool` 的 `st="error"` 或 `cancelled` 且无产出 | 可识别 |
| ④系统注入「继续」导致重复 | 切片间隔 <100ms 且前后切片**同 task_id 且同输入特征**；或同 `mid` 连续 `ev:retry` | **部分可观测**（+8ms 注入无独立事件） |
| ⑤执行失败但未形成错误记录 | **无法从总线识别**（这正是缺口本身） | **不可观测**（B 档核心补丁才能覆盖） |
| ⑥无法判断 | 其余 | 兜底 |

**实现**：`session.post` 的 `trajectory` 是**唯一能拿到逐轮内容的外层通道**。A 档在 `session.post` 内统计：
- 切片内 assistant 消息数 `msgs`
- 其中有工具调用的数 `tools`
- 有非空文本的数 `txt`
- `empty = msgs - Math.max(tools, txt)`（近似，**如实标注为近似**）

**历史 18 例纯空轮复核**：Phase 0 已用 `v3_empty_correlate.py` 对齐过 stats transform 时戳 ±15ms。A 档落地后，新的空轮将有 `ev:slice` 记录可直接复核。**历史 18 例因 10-15 前日志已轮转、且当时无 C1，无法逐条重建**——如实标记为**不可复核的历史缺口**，不假装能补。

**红线**：**不把所有没有工具调用的轮次都算作无效轮次**——①类（正常收尾、无行动必要）是合法的，`empty` 统计不计入 ①类。

---

## 6. 两档实施方案（P2.7）

### A 档（本阶段实施）——零核心改动

改动文件：
1. `context-gate/index.ts`：`onEvent` 增加 5 个分支（`session.error`/`metrics.tool_call`/`session.retry.attempt`/`task.created`/`task.updated`/`metrics.try_best_detected`）+ 注册 `session.pre`/`session.post` 两个钩子 + `sessionID→task_id` 内存栈 + **配置门 `c1`**（`gates.json` 热加载，可秒关）
2. `bench/reconcile.py`：三源对账器（总线账本 / DB / 日志 ERROR）
3. `bench/test_reconcile.py`：注入模拟数据的对账器自测

**预计 ~150 行外层代码，零核心改动，零远端上报。**

### B 档（本阶段不实施）——核心补丁（可选增强）

A 档落地并跑出真实缺口后，再决定是否需要 B 档。B 档候选（**均需单独批准 + echo-dev 分支 + 单 commit 可 revert**）：

| 候选 | 何时需要 | 触发条件 |
|---|---|---|
| `metrics.model_error` 事件 | A 档的 `session.error`→模型类判定靠时窗猜测不准时 | 对账 unmatched 率高 |
| 空轮专属事件（⑤类） | A 档无法识别"失败但无错误记录" | `ev:slice` 的 `empty` 与日志对不上 |
| `session.post` 暴露 judge 状态 | 阶段 4 做完成闸时 | 本阶段不做 |

**明确不做**：不改 `retry.ts` 重试语义、不改模型选择/路由、不碰 4097 serve、不碰生产 `mimocode.jsonc`、不加远端上报、**不改 goal 判官停止机制**。

---

## 7. 验收（对照任务书 §8）

| 验收项 | A 档达标方式 |
|---|---|
| 1 失败可被可靠发现 | `ev:error` 非空；对账器 matched/仅日志/仅账本三桶 |
| 2 失败关联到具体任务和步骤 | `tid`（时窗回查）+ `aid`/`mid`/`cid`；**主切片无 task_id 时 tid=null 并如实标注** |
| 3 任务状态可独立对账 | `ev:task` 最后状态 vs DB task 表逐条 |
| 4 任务成本逐步归因 | `ev:model` 按 sid ↔ `ev:slice` 按 sid+tid → 每任务 token 合计 |
| 5 空轮可区分类型 | §5 六分类，⑤类明确标记不可观测 |
| 6 工具错误可建回归测试 | `ev:tool` 按 cid 唯一，历史 730 例可回放 |
| 7 关键数据可复核 | stats.jsonl 追加式 + 日志 + DB 三源交叉 |

**本阶段不要求每项性能指标改善**——只要求可观测性成立。

---

## 8. 已知缺口（如实声明，不硬凑）

| 缺口 | 影响 | 补法 | 成本 |
|---|---|---|---|
| step id 无原生事件 | 步骤级归因只能用切片近似 | B 档核心补丁 | 中 |
| `session.error` 无 task_id | 关联靠时窗回查，主切片常 null | B 档加 task_id 字段 | 中 |
| 空轮⑤类（失败无错误记录） | 最坏情况不可见 | B 档空轮专属事件 | 中 |
| `validation_status` 恒 "skipped"（`prompt.ts:4399` 硬编码） | 完成验证状态不可观测 | 需核心补丁（Phase 0 已记） | 中 |
| 10-15 前日志已轮转 | 历史 18 空轮、402×4 无法逐条重建 | 不可恢复，以 WP-R2/V3 存档为准 | — |
| 预算类指标 | 宿主无预算机制 | 属 C2 | — |

---

## 9. 与 P0 基线的顺序关系（明确说明）

任务书要求"P0 基线在任何影响运行行为的代码修改之前"。**A 档不违反**，理由：

1. A 档**不改变任何决策**——不改重试、路由、模型、工具选择、停机判定；只在既有事件上**追加一行 JSONL**。
2. `onEvent` 全体已包在 `try/catch` 内（`index.ts:369-392`），插件钩子抛错会被吞掉，且 core 侧 `plugin/index.ts` 对 hook 是 fail-open 语义——**故障面为零**。
3. A 档自带 **`c1` 配置开关**（`gates.json` 热加载）→ 可在不重启、不改代码的情况下秒级关闭。
4. 基线指标中**只有"失败可见率"与"任务成本归因率"两项依赖 C1**，而它们的基线值**由 Phase 0 已实测为 0%**（8,373 行 0 行 error、0 行 task id），不需重跑。

因此：**先装 A 档再跑 B1–B6 基线，比先跑基线更优**（基线自带完整可观测性，避免"跑完发现漏采还得重跑"）。这是对任务书顺序的**显式偏离**，理由如上；其余行为类指标（调用数/Token/成功率/工具失败率）与是否装 A 档无关，前后对照仍然成立。
