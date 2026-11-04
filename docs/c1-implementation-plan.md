# C1 实施方案（封存版）——失败模型调用观测与账本对账修复

- 状态：**方案封存，未实施**。核心代码零改动；生产插件零改动。
- 依据：阶段一审计（`echo-core-initial-audit.md` §8-C1）+ 收尾任务 P3 现场复核（2026-10-16）。
- 源码基线：`D:\EchoCore\MiMo-Code` @ `496bb8cb`（main，含 tag v0.1.15=`14dfe68a`）。
- 路径均相对 `packages/cli/src/` 或标注绝对路径。

---

## 1. 根因与准确源码位置（双层）

### L1 账本层（外层插件，已实证）
`C:\Users\<user>\.config\mimocode\context-gate\index.ts:369-392` `onEvent()` **只处理两类事件**：
- `metrics.model_call` → `logStats({ev:"model", ...})`（:374-385）
- `session.compacted` → `logStats({ev:"compacted"})`（:386-389）

**完全忽略 `session.error`** → `stats.jsonl` 结构性没有失败行。这解释了 WP-R2 的 [M] 观测：1,053 行账本 0 行失败、4 次 402 无痕迹。

### L2 核心事件层（上游，已实证）
- `metrics/event.ts:4-17` `ModelCall` schema **无错误字段**（finish_reason/tokens 必填）。
- `ModelCall` **仅成功路径发布**：`session/processor.ts:725-737`（step-finish 成功后）、`session/prompt.ts:1394-1406`（预测调用成功后；失败仅 `elog.warn` 后吞掉 :1387-1392）。
- `AgentRequest.validation_status` 恒 `"skipped"`（`session/prompt.ts:4004`）→ 完成验证状态同样不可观测。

### 事件可达性（关键打通，本次新证）
- `plugin/index.ts:370-381`：`bus.subscribeAll()` → **全部总线事件无差别转发**给每个插件的 `event` 钩子。
- `session/session.ts:335`：`Session.Event.Error` 事件类型字符串 = **`"session.error"`**；SDK 事件联合含 `EventSessionError`（`packages/sdk/src/gen/types.gen.ts:728`）。
- 结论：**失败事件早已在总线上、插件钩子也收得到，只是账本不记、核心无计量事件**。

## 2. 成功调用 vs 失败调用的实际代码路径

```
成功：llm.stream 正常结束
 → processor.ts:683-700 usage 累积 + step-finish part 落库
 → processor.ts:725-737 bus.publish(Metrics.ModelCall)   ← 有计量
 → plugin subscribeAll → context-gate onEvent → stats.jsonl {ev:"model"}  ← 有账本

失败（请求/流错误）：llm.stream 抛错 → processor.ts:892-904 halt()
 → slog.error("process", {error, stack})                     ← 有日志（log/*.active.log ERROR 行）
 → ctx.assistantMessage.error = error; session.updateMessage  ← 有 DB 落库（assistant.error）
 → bus.publish(Session.Event.Error)  [type="session.error"]   ← 有事件（但无计量字段）
 → plugin subscribeAll → context-gate onEvent → 忽略 ✗        ← 无账本  ←【缺口】
 →（无 Metrics.ModelCall、无失败计数）                        ← 指标体系盲区 ←【缺口】

失败（无效输出耗尽，另一路径）：prompt.ts:4195-4201
 → InvalidOutputError 写入 assistant + bus.publish(Session.Event.Error)  ← 同上无账本
```

`session.error` 还有 **20+ 个其他发布点**（skill/config/plugin/command 加载失败等）——**非模型错误**，对账时必须与模型失败区分（见 §5 验收第 3 条）。

## 3. 事件、日志、账本三者关系（现状）

| 通道 | 成功调用 | 失败调用 | 说明 |
|---|---|---|---|
| 日志 log/*.active.log | 无专门行 | `slog.error("process")` 等 ERROR 行 | 唯一现状失败痕迹 |
| DB mimocode.db | message.tokens/cost、step-finish | `assistant.error` 非空 | 可 SQL 查询但无聚合工具 |
| bus 事件 | `metrics.model_call` | `session.error`（+`message.updated`） | 事件都在，处理不对称 |
| 远端遥测（MIMOCODE_ENABLE_ANALYSIS） | `model_call` 上报（subscriber.ts:21-33） | 无 | **B 档不向远端新增上报**（减合规面） |
| 本地账本 stats.jsonl | `ev:"model"` | **无** | 缺口 |

## 4. 最小修改范围与禁止触碰

### A 档（外层先行，零核心改动；**需单独批准后才可动生产插件**）
1. `context-gate/index.ts` `onEvent` 增加 `session.error` 分支：
   `logStats({ev:"error", sid, name: error.name, msg: 截断300, t: Date.now()})`（约 10 行）。
2. 对账脚本（新建，放 `D:\EchoCore\bench\reconcile-errors.py` 或 .ps1）：解析日志 ERROR 行 + stats.jsonl `ev:"error"` 行，逐条匹配（规则见 §5）。

### B 档（核心级，echo-dev 分支；**本次不实施**）
| 文件 | 改动 | 行数量级 |
|---|---|---|
| `metrics/event.ts` | 新增 `ModelError = BusEvent.define("metrics.model_error", schema)`：sessionID/error_name/error_message/latency_ms/model_id/provider/phase("request"\|"invalid-output"\|"stream") | ~20 |
| `session/processor.ts` halt（:892-904） | 在既有 publish(Session.Event.Error) 旁补发 `Metrics.ModelError`（phase 按来源标注） | ~10 |
| `session/prompt.ts` :4198 | 无效输出耗尽处补发 `Metrics.ModelError`（phase:"invalid-output"） | ~5 |
| `packages/cli/test/` | 新增单测：halt 路径发布 ModelError | ~40 |

**禁止触碰**：`session/retry.ts`（重试语义）、`session/llm.ts` maxRetries、`session/prompt.ts` 除 :4198 一处外的任何逻辑、模型选择/provider 路由、`tool/`、生产 `mimocode.jsonc`、4097 serve、`metrics/subscriber.ts`（不加远端上报）。

## 5. 最小实验（实施前置，隔离环境内）

| # | 假设 | 判定方法 | 通过标准 |
|---|---|---|---|
| H1 | 运行时 plugin `event` 钩子确实收到 `session.error`（源码 subscribeAll 强证，仅缺运行时确认） | 隔离环境挂临时测试插件，记录 event.type 直方图；触发一次失败（如无效模型配置） | 直方图含 `session.error` |
| H3 | WP-R2「4 次 402」的重试层级：`retry.ts:397` 将 402 列为 **terminal**，与观测 4 次矛盾——4 次来自 AI-SDK 层还是多轮重放？ | mock provider 固定返回 402，记录实际请求数与 halt 行为 | 得出唯一解释（请求次数 N 与层级） |
| H4 | 同一失败可能产生多条 `session.error`（如 prompt.ts:5664 对既有 message.error 重发布）→ 重复事件 | H3 实验中统计单次失败的事件数；resume 场景复测 | 明确去重键（优先 messageID，无则 time+name+hash） |
| H2 | 日志 ERROR 行格式（slog 结构化字段名）足以逐条匹配 | 从真实 log 采样 10 行 ERROR，固化解析器 | 解析成功率 100%（样本内） |

**对账匹配规则**（逐条，非总数）：`(sessionID, error.name, 时间窗 ±5s, messageID 优先)` 三通道对齐；输出三类：matched / 仅日志 / 仅账本，并对 unmatched 给出分类（非模型错误按发布点归 plugin/config/skill/other）。

## 6. 测试、验收、回滚

**测试**：① `bun run --cwd packages/cli test` 上游全量绿（B 档改动前后各一次）② 新增 ModelError 单测 ③ 对账脚本自测（注入模拟日志+stats → 期望 diff）。

**验收**（对照任务书五条）：
1. **可靠查询**：失败可从 ① stats.jsonl `ev:"error"`（A 档）② `metrics.model_error` 事件/落账（B 档）③ SQL `SELECT ... WHERE assistant.error IS NOT NULL`（文档化）三途径查询。
2. **逐条对账**：reconcile 报告 matched/仅日志/仅账本逐条列出；模型类 unmatched=0。
3. **区分性**：每条失败带来源分类（model-request / invalid-output / plugin / config / skill / other）；重复事件按去重键折叠并单独计数。
4. **行为不变**：重试语义、路由、模型选择、插件行为零变化——diff 审查确认只新增事件发布与外层记账；正常任务前后对照跑一次无行为差异。
5. **独立可回滚**：echo-dev 上单一分支 `feat/c1-failure-observability`，一 commit 一事；`git revert` 即回滚；A 档回滚=删除 onEvent 分支代码（或配置 `enabled:false`）。

## 7. 未证实假设与剩余风险

| 项 | 状态 |
|---|---|
| H1 运行时确认 | 源码强证，待运行时实验 |
| H3 402 四次之谜 | **未解决**，实验裁决 |
| H4 重复事件频率 | 未量化 |
| slog ERROR 行确切字段名 | 待真实采样（H2） |
| WP-R2 历史 4×402 现场完整重放 | 日志/账本可能不全，允许以新实验为准 |
| A 档动生产 context-gate | 需专门批准；在此之前 A 档只可在隔离环境跑 |
| 预算 | 全部实验在隔离环境 + deepseek-flash：预计 ≤¥10；基准不在本轮范围 |

## 8. 实施顺序（获批后）

1. `bun ci`（`D:\EchoCore\echo-core` fork 副本内；建议同时配置 bunfig 镜像 registry=npmmirror）→ 上游测试基线绿。
2. H2/H3/H4/H1 实验（隔离 MIMOCODE_HOME + 端口 4098）→ 修订对账规则。
3. B 档核心改动（echo-dev，4 文件）→ 单测 + 全量测试绿。
4. 对账脚本跑真实失败场景 → 验收五条逐条打勾。
5. （另行批准后）A 档接入生产 context-gate → 用既有对账器验证 84min 类事件开始可见。
