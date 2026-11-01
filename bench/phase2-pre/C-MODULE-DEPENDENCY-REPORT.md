# Echo Core 模块依赖关系报告

任务编号：EC-PHASE2-PRE-01 / WP-02 交付物 C
审计日期：2026-10-31
性质：只读依赖分析（基于 import 关系与运行时调用实测）

---

## 1. 核心模块依赖图

```
                        ┌────────────┐
                        │  index.ts  │ (CLI 入口)
                        └─────┬──────┘
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        cli/cmd/tui      cli/cmd/run      server/routes
              │               │                │
              └───────┬───────┴────────────────┘
                      ▼
        ┌─────────────────────────────┐
        │     session/prompt.ts       │ ◄── 巨石枢纽(7234行)
        │  runLoop·工具包装·MCP·恢复  │
        └──┬──────────┬───────────┬───┘
           │          │           │
           ▼          ▼           ▼
   session/processor  tool/*    actor/* + task/*
   (流状态机)         (registry)  (子代理/任务树)
           │
     ┌─────┴──────┬────────────┐
     ▼            ▼            ▼
 session/llm   metrics/     session/{compaction,
 (streamText)  event.ts     checkpoint,session.sql}
               classify.ts      │
     │            │             ▼
     │            ▼          SQLite DB (权威)
     │      bus/ (PubSub)
     │            │
     └────────────┼────── 事件订阅
                  ▼
   C1 context-gate/index.ts（配置目录·插件钩子面）
     ├─ logStats → stats.jsonl（账本）
     ├─ transform（上下文投影）
     └─ verify.ts / roundtrip_hint（gates 门控）
```

**依赖方向总评**：Core → bus → C1 为单向（健康）；C1 不 import Core 源码，仅经插件钩子与事件 schema 消费。反向风险不存在。

## 2. 关键调用关系

| 调用链 | 位置 | 说明 |
|--------|------|------|
| prompt → processor.process | prompt.ts:5000, processor.ts:921 | runLoop 每轮建 processor |
| processor → llm.stream | processor.ts:943 → llm.ts:867 | streamText 封装 |
| prompt → tool.execute → executeTool | prompt.ts:1924 → processor.ts:451-484 | fiber + toolGate |
| **processor → classifyToolError** | **processor.ts:655** | **V1 核心：tool-error 注入 diagnostic（:665）** |
| prompt cancelled → classifyToolError | prompt.ts:1918（本地）/ :2087（MCP） | {cancelled:true} |
| Metrics.ToolCall/ModelCall → bus.publish | processor.ts:659/735/1289；prompt.ts:1963/2170 | 携带 agentID（+diagnostic 仅 error/cancel） |
| bus → C1 onEvent | context-gate/index.ts:477-581 | 消费 tool_call/model_call/session.error |
| C1 → stats.jsonl | index.ts:286-296 logStats | appendFileSync，4MB 轮转 1 代 |
| classify → isRecoverableError | classify.ts → tool/recoverable.ts:32 | 依赖上游判定函数（稳定接口） |
| overflow → compaction | overflow.ts:44-106 → compaction.ts | max_context 预算触发 |
| prune → checkpoint 写入 | prune.ts:282-301 → checkpoint.ts | thresholds 驱动 fireCheckpoints |
| actor.postStop → progress 检查 | plugin/subagent-progress-checker.ts:104-172 | 强制 progress.md 完整性 |
| reconcile 三源对账 | bench/reconcile.py:35-190 | stats.jsonl + DB task + 日志（离线） |

**metrics/barrel 缺口**：`metrics/index.ts` 仅导出 subscribe/installation/events；classify/immune-memory/tolerance 走深度路径 `@/metrics/classify`，未入 barrel——上游若重构 barrel 语义则 import 脆弱。

## 3. 单点故障清单

| # | 单点 | 影响 | 证据 | 缓解建议方向 |
|---|------|------|------|-------------|
| SP1 | **prompt.ts 巨石**（7234 行） | runLoop/工具/MCP/恢复全耦合；任一上游迭代高冲突；修改回归面大 | 文件实测行数 | Phase 2 中期考虑按域拆分（非紧急） |
| SP2 | **C1 唯一落账者** | gates c1:false 或插件加载失败 → V1 分类发布但无账本、观测链断 | Core 侧无 diagnostic 持久化；subscriber 不转发 | Core 侧提供官方落账兜底或 C1 健康探测 |
| SP3 | **stats.jsonl 单文件单写者** | 4MB 轮转仅 1 代，历史证据丢失；无压缩归档 | index.ts:286-296 | 轮转策略改多代/按日归档 |
| SP4 | **sliceStack 进程内存态** | 进程重启后 pre/post 失配 → 重启窗口内 tid 归因退化 | index.ts:374-411 | 重启时清栈并标记断代（V2） |
| SP5 | **DB 单文件 ~985MB** | 无分片/归档策略可见；增长无治理 | 磁盘实测 | 会话归档/导出策略（Phase 2） |
| SP6 | **types.gen.ts 手改生成物** | regen 即丢 agentID 类型；SDK 与 bus schema 已不同步（diagnostic 缺失） | git diff + gen 流程 | regen 流程加 patch 步骤或上游 PR |

## 4. 架构风险登记（按严重程度）

### 高

| 风险 | 影响范围 | 证据 | 潜在后果 | 建议方向 |
|------|---------|------|---------|---------|
| R1 processor/prompt 热路径自研侵入 | 上游 rebase 冲突面最大 | 各 +9/+7 行于 6 个 publish/handler 点 | 升级时补丁丢失或语义回退 | 冻结补丁 diff 归档（已做 core-agentid.diff）；升级 SOP 强制重放 |
| R2 SDK diagnostic 类型缺失 | 远程 API 消费方拿不到 7 字段 | types.gen.ts 仅 +agentID | 分析链路诊断断链 | regen 时同步 schema（Phase 2 小任务） |
| R3 bash 非零退出不发 error ToolCall | 执行失败统计口径失真 | prompt.ts:1947-1948 仅 gate.fail | "成功率"虚高；Immune 分类漏一类真实失败 | 独立 PR 评估（V1 外） |

### 中

| 风险 | 影响范围 | 证据 | 潜在后果 | 建议方向 |
|------|---------|------|---------|---------|
| R4 Metrics 三路径分散发布 | success/error/cancel 分三处，易漏发 | prompt.ts:1960/1910/2079 + processor.ts:657 | 语义漂移、审计困难 | 收敛为统一 publish helper（V2） |
| R5 tool_not_found 生产不可达 | 分类枚举有名无实 | toolRegistered 零调用方；processor:654 注释 | 免疫覆盖面与设计文档不符 | 文档如实标注或 V2 接线 |
| R6 双存储无事务（DB vs memory 文件） | checkpoint 滞后 DB | session.sql vs checkpoint-paths | 恢复时记忆窗口偏差 | 接受最终一致；reconcile 已部分覆盖 |
| R7 ModelCall.diagnostic 空置 | schema 预留、生产不填 | processor:733-744 不带 diagnostic | LLM/API 错误无 7 字段结构化 | V2 决策是否需要 |
| R8 估算成本≠账单 | 成本决策误导 | session.ts:431-446 本地单价表 | 预算报告偏差 | 账本补 cost 字段（见 D-8） |

### 低

| 风险 | 证据 | 建议 |
|------|------|------|
| R9 tail_turns 死配置 | config.ts:240-243 仅 schema | 清理注释或移除 |
| R10 sdk gen 双份（v1/v2） | src/gen 与 src/v2/gen 并存 | 确认 run.ts 只用 v2（已确认 run.ts:11）；长期统一 |
| R11 classify 未入 barrel | metrics/index.ts | V2 补导出 |
| R12 bun.lock 漂移 | M bun.lock | 升级时留意 merge 噪声 |
| R13 subscriber 默认开启且不转发 diagnostic | flag.ts:107；subscriber:36-42 | 远程分析需 diagnostic 时补转发字段 |

## 5. 重复实现登记

| 重复对 | 现状 | 判定 |
|--------|------|------|
| classify 7 字段 vs C1 legacy `tool_name==='invalid'` 回退 | 并存；C1 diagnostic 优先、legacy 兜底 | **有意的兼容设计**，非缺陷；旧二进制仍需回退。双真相源风险低（新路径已全覆盖） |
| cancelled 三处语义 | prompt 合成 Error+classify / C1 硬编码 / schema 枚举 | 轻度冗余；行为一致，审计时注意三处对照 |
| metrics/subscriber 远程上报 vs C1 stats.jsonl 本地账本 | 两套落账；前者不转发 diagnostic | **职责不同**（分析上报 vs 本地账本）；但 diagnostic 不进前者=远程链路缺口（R13） |

## 6. 上游升级影响评估

**若 rebase/merge 新上游，预计冲突与回归焦点**：

1. `processor.ts` tool-error handler 与 ModelCall publish（必查行 :647-668/:732-745/:1286-1290）
2. `prompt.ts` 4 处 ToolCall publish（:1909-1918/:1957-1963/:2078-2087/:2161-2170）
3. `event.ts` schema 插入块（低冲突）
4. `types.gen.ts`（regen 覆盖 → 手改丢失）
5. `bun.lock`（噪声）

**升级后强制回归**（冻结规则 §8.4）：classify 单测 43/43 + immune-e2e 8/8 + immune-real-path 2/2 + 正式安装 C4/C2 基线（7 字段不变）。
