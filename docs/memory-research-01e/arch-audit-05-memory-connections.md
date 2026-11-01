# Arch-Audit-05 · Memory 上下游连接与 11 问深度审计

> 审计对象：`D:\EchoCore\MiMo-Code\packages\cli\src\`（只读）
> 日期：2026-07-11
> 证据等级：**实际调用**（运行时代码路径可达）/ **接口声明**（类型/接口存在但无实现或无调用方）/ **理论关系**（设计意图、提示词引导、注释约定，无代码级连接）/ **不存在**（无任何证据）

---

## 0. Memory 模块 API 基线

`memory/service.ts:19-31` 定义的 **全部** Service 接口：

```ts
export interface Interface {
  readonly root: () => Effect.Effect<string>
  readonly reconcile: () => Effect.Effect<{ indexed: number; pruned: number }>
  readonly search: (input: {...}) => Effect.Effect<Array<{ path, snippet, score, scope, scope_id, type }>>
}
```

**没有 `write` / `append` / `remember` / `forget` API。** 一切写入发生在磁盘文件层，由 `tool/memory-path-guard.ts` 做路径级授权，由 `memory/reconcile.ts` 情性/启动时索引进 FTS。

存储布局（`memory/paths.ts:55`；`checkpoint-paths.ts:15-77`）：

```
<data>/memory/
  global/MEMORY.md
  projects/<projectID>/MEMORY.md          (+ memory-<topic>.md 溢出)
  sessions/<sid>/checkpoint.md            (+ checkpoint-<topic>.md)
  sessions/<sid>/notes.md
  sessions/<sid>/tasks/<TID>/*.md         (progress.md / 自由 md)
可选 CC 源：~/.claude/projects/<slug>/memory/**/*.md  (scope='cc')
```

---

## 1. Memory 读取方清单

| # | 读取方 | 机制 | 位置 | 证据等级 |
|---|---|---|---|---|
| R1 | `memory` 搜索工具（模型可调用） | `Memory.Service.search` → FTS5 BM25 | `tool/memory.ts:21,27`；`service.ts:52-138` | **实际调用** |
| R2 | checkpoint 重建 `renderRebuildContext` | `memory.root()` + 直接 `readBudgetedSectionAware(MEMORY.md / global MEMORY)` + `memory.reconcile()` | `checkpoint.ts:1252-1502`（读文件 :1346,:1356；reconcile :1497） | **实际调用** |
| R3 | checkpoint 重建后 FTS 剪枝 | 直查 `MemoryFtsTable`（**旁路 Service.search**） | `checkpoint.ts:1509-1519` | **实际调用** |
| R4 | 主/peer agent 系统提示 | `buildMemoryInstructions` 注入路径教学（非内容），模型随后用 read/grep 自取 | `llm.ts:84-167,351-364` | **实际调用**（教学注入 + 工具能力） |
| R5 | checkpoint-writer 读取既往记忆 | writer prompt 指示 "Read BOTH the prior checkpoint AND the prior memory" | `checkpoint.ts:771-773` | **实际调用**（经 write 工具的 read 能力，非 Service） |
| R6 | `hasMemoryOrTasks` | `memory.root()` + 目录存在性检查 | `checkpoint.ts:1202-1203` | **实际调用** |
| R7 | 启动/搜索时 reconcile 的隐式读 | walk 文件系统对比 FTS 行 | `bootstrap.ts:52`；`service.ts:59-64`；`reconcile.ts:94-143` | **实际调用** |
| R8 | dream / distill 后台会话 | 提示词指示读 memory 文件与 trajectory DB | `auto-dream.ts:27-43` | **理论关系**（agent 中介，代码只负责 spawn 与沙箱） |
| R9 | CC 记忆索引（`memory.cc_index`） | reconcile 纳入 `~/.claude/projects/**/memory` | `service.ts:40,48,62`；`reconcile.ts:29-44`；`paths.ts:66-78` | **实际调用**（配置默认关） |

**不在读取方**：`metrics/*`（零 import）、`skill/*`（零 import）、`task/*`（零 import）、`provider/*`（零 import）。

---

## 2. Memory 写入方清单

> 前提：写入 = 向 `<data>/memory/**/*.md` 写文件。`Memory.Service` 无写 API。

| # | 写入方 | 写入目标 | 授权路径 | 触发者 | 证据等级 |
|---|---|---|---|---|---|
| W1 | **checkpoint-writer 子代理** | `projects/<pid>/MEMORY.md`（±memory- 溢出）、`sessions/<sid>/checkpoint.md`（±溢出）、`sessions/<sid>/tasks/<TID>/*.md` | `assertMemoryWriteAllowed` 白名单 `isCheckpointWriterAllowed`（`memory-path-guard.ts:79-104,208-219`）；agent 沙箱仅 memory 树（:37-44） | `SessionPrune.fireCheckpoints` 阈值 / rebuild 启动等待 | **实际调用** |
| W2 | **主 agent（main/peer）** | `projects/<pid>/MEMORY.md`、`sessions/<sid>/notes.md`；有效 scope 下自由 `<key>.md` | 同上，非 writer 分支；`tasks/*` 被保留（:222-247） | 模型自主 write/edit；系统提示教学（`llm.ts:92-143`） | **实际调用** |
| W3 | **任务绑定子代理** | `sessions/<sid>/tasks/<taskId>/**/*.md` | `parts[3] === input.taskId` 校验（`memory-path-guard.ts:230-237`） | spawn 时传 `taskId`；progress checker nudge | **实际调用** |
| W4 | **dream / distill 系统代理** | memory 树 + `<worktree>/.mimocode/` | `WRITE_SANDBOXED_AGENTS` + `assertAgentWriteSandbox`（:9,46-56） | `shouldAutoDream/shouldAutoDistill`（`prompt.ts:4651`；`auto-dream.ts:110-134`） | **实际调用**（配置默认关） |
| W5 | **checkpoint 校验重试** | writer 重写 checkpoint 文件 | 同 W1；`buildReflectionMessage` / `buildExtractionReflection` 驱动 | `checkpoint-retry.ts:141,171`；`plugin/checkpoint-splitover.ts:40,47` | **实际调用** |
| W6 | 模板 bootstrap | 不存在时写空模板 | `ensureMemoryTemplate` 等（`checkpoint.ts:165-168,760-764`） | writer 启动前 | **实际调用** |
| W7 | `migrateProjectMemory` | `memory.md` → `MEMORY.md` 原子改名 | `checkpoint-paths.ts:48-59` | llm.ts:363、checkpoint.ts:758 | **实际调用** |
| W8 | Memory.Service | — | — | — | **不存在** |

**写入开关**：`memory.disable_write: true` 时，W1–W6 全部被 `isMemoryWriteEnabled` 拦截（checkpoint.ts:664；prompt.ts:986；auto-dream.ts:113,126；path-guard writeEnabled=false :186-195；progress-checker :139）。读取不受影响（read-gate 永不关闭）。

---

## 3. 十一个必答问题（逐条附证据）

### Q1. 哪些模块能够读取 Memory？

**判定：实际调用（多个模块）+ 教学放行（任意带 read/grep 的 agent）**

| 主体 | 路径 | 等级 |
|---|---|---|
| `tool/memory` → `Memory.Service.search` | `tool/memory.ts:27` | **实际调用** |
| `session/checkpoint`（rebuild） | 读文件 `checkpoint.ts:1346,1356` + FTS `:1509-1519` | **实际调用** |
| `session/llm` | `memory.root()` 仅取路径 `llm.ts:364` | **实际调用**（路径，非内容） |
| `project/bootstrap` | `reconcile` 索引 `bootstrap.ts:52` | **实际调用**（索引层） |
| checkpoint-writer / 主 agent / 任意子代理 | read/grep 工具直读磁盘；系统提示告知路径 | **实际调用**（工具层，非 Service） |
| Metrics / Skill / Task / Provider | 无 import | **不存在** |

### Q2. 哪些模块能够写入 Memory？

**判定：实际调用（全部经文件系统 + path-guard，无 Service 写入口）**

- **checkpoint-writer**（白名单路径）— `memory-path-guard.ts:208-219`
- **主 agent**（MEMORY.md / notes.md / 自由 key.md）— 同文件 :222-247 与提示教学
- **任务子代理**（自有 tasks/TID 子树）— :230-237
- **dream/distill**（memory + .mimocode 沙箱）— :9,46-56
- **模板/迁移辅助函数**（ensure*Template、migrateProjectMemory）— `checkpoint.ts:165-168`；`checkpoint-paths.ts:48-59`
- **Memory.Service 写 API** — **不存在**

注意：`bash` 工具**不受** path-guard 约束（`memory-path-guard.ts:18-21` 注释明确自认）——模型可用 bash 写任意 memory 路径，这是**实际能力缺口**（见问题清单 P8）。

### Q3. 写入由谁触发？

**判定：实际调用，四条独立触发链**

1. **上下文压力链（主路径）**：runLoop 每轮 → `SessionPrune.fireCheckpoints`（`prompt.ts:4782`）→ 阈值判定（`prune.ts:289-327`）→ `tryStartCheckpointWriter`（`checkpoint.ts:638+`）→ spawn writer 子代理写文件。
2. **重建/恢复链**：上下文溢出或会话恢复 → rebuild helper → `tryStartAndAwaitWriter` → 同上（`prompt.ts:1036`）。
3. **校验重试链**：writer 校验失败 → `buildReflectionMessage` / `buildExtractionReflection` → writer 重写（`checkpoint-retry.ts:141+`；`plugin/checkpoint-splitover.ts:40,47`）。
4. **后台整合链**：新会话启动 → `shouldAutoDream` / `shouldAutoDistill`（`prompt.ts:4651-4652`）→ spawn dream/distill 会话（配置默认关）。
5. **子代理收尾链**：子代理 postStop → `subagent-progress-checker` nudge 写 progress.md（`subagent-progress-checker.ts:48-139`）。

### Q4. 记忆检索发生在推理前、推理中还是推理后？

**判定：三段皆有实际调用，但形态不同**

| 时机 | 形态 | 证据 | 等级 |
|---|---|---|---|
| **推理前**（system 构建） | 注入记忆**路径教学**（非内容）到 system prompt | `llm.ts:343-364` | **实际调用** |
| **推理前**（上下文重建时） | 注入 MEMORY.md / global MEMORY **内容**到重建上下文 | `checkpoint.ts:1346,1356,1482-1485`；由 `prompt.ts` rebuild 调用 | **实际调用**（条件触发） |
| **推理中**（ReAct 循环内） | 模型调用 `memory` 工具 → FTS 检索 | `tool/registry.ts:248,279` 注册；`tool/memory.ts:27` | **实际调用** |
| **推理后** | writer 把本轮学到的写入记忆；reconcile 索引 | `checkpoint.ts:782+`；`service.ts:59-64` | **实际调用** |
| 每轮自动前置检索（无工具调用的隐式注入） | — | — | **不存在**（无自动 top-k 注入） |

### Q5. Memory 是否参与 Planning？

**判定：理论关系 / 接近不存在**

- `task/` 模块（TaskRegistry、task 工具）**零** memory import（grep 证实）。
- Memory 内容可**间接**出现在规划语境中：checkpoint.md §4 Task tree 由 writer 写入、重建时注入 —— 但这是**文本快照**，不是 Planning 子系统的数据接口。
- auto-distill 提示词让 agent 读 memory 挖掘可打包工作流（`auto-dream.ts:35-43`）—— **理论关系**（agent 中介，无代码接口）。
- **结论**：Memory **不**参与结构化 Planning；Planning（task 树）与 Memory 是两套存储，仅在 checkpoint 文本层面汇合。

### Q6. Memory 是否参与 Execution？

**判定：实际调用（工具层），非框架级**

- 执行循环中，`memory` 是注册工具之一（`registry.ts:248`），模型可在任何步调用 —— **实际调用**。
- 写栅栏在每次 write/edit 时执行 —— **实际调用**（`external-directory.ts:102-141`）。
- 无“执行前自动拉取相关记忆注入 tool call 上下文”的机制 —— **不存在**。

### Q7. Memory 是否接收执行结果？

**判定：实际调用（经 writer 子代理中介），无直接 API**

- 执行结果 → session 消息流 → 阈值触发 → checkpoint-writer 读消息并**选择性**写入 checkpoint.md / MEMORY.md / progress.md（`checkpoint.ts:354-400` writer prompt；:782+ spawn）。
- 无 `Memory.recordExecution(result)` 之类直接接口 —— **不存在**。
- 结果到记忆的转化是 **LLM 子代理中介**的，属于“实际调用但非确定性管道”。

### Q8. Reflection 是否能够改变长期记忆？

**判定：实际调用（限于 checkpoint 文件域）**

- `checkpoint-retry.ts` 的 reflection 消息（:141 `buildReflectionMessage`；:171 `buildExtractionReflection`）驱动 writer 在校验失败后**重写** checkpoint.md，成功路径下 writer 也会改写 MEMORY.md —— 这是改变持久记忆的实际回路。
- `plugin/checkpoint-splitover.ts:40,47` 把校验错误转成 reflection reason 回传 writer。
- **边界**：reflection 只能通过 writer 的写工具改变 memory 树内文件；不能直接改 FTS、不能越过 path-guard、不能改 trajectory DB（DB 对 writer 是只读纪律，`auto-dream.ts:31`）。
- 无独立“Reflection 服务”写 Memory.Service —— **不存在**。

### Q9. Recovery 是否依赖 Memory？

**判定：部分实际调用 + 部分不存在**

| Recovery 形态 | 是否依赖 Memory | 证据 | 等级 |
|---|---|---|---|
| `/recovery` 未完成轮恢复（`SessionPrompt.recovery`） | **否** — 只读 session 消息表找未完成 assistant | `prompt.ts:3591-3600` | **不存在**（对 Memory 依赖） |
| 上下文重建 rebuild | **是** — 读 checkpoint.md + MEMORY.md；`memory.disable_write` 时短路到 compaction | `prompt.ts:986`（"memory-write-off"）；`checkpoint.ts:656-657,1252+` | **实际调用** |
| prune 的 checkpoint recovery gate | **否** — 只是阈值重试门控 | `prune.ts:305-318` | **不存在** |
| 文本循环/n-gram 恢复 | **否** | `prompt/text-loop-recovery.ts`；`prompt.ts:4392+` | **不存在** |

**结论**：Recovery 机制主体不依赖 Memory；**上下文重建这一支 Recovery 强依赖 Memory 文件**，且写开关会同时砍掉重建能力（设计耦合，见 P3）。

### Q10. Immune 是否与 Memory 有真实接口和调用关系？

**判定：不存在（接口声明孤立）**

- `metrics/immune-memory.ts` 定义 `ImmuneMemoryEntry`（zod schema，:8-48）与 `ImmuneMemoryStore` 接口（:56-65）。
- 全库 grep `ImmuneMemory|immune-memory|immune`：**除该文件自身外，零 import、零实现、零调用方**。
- 文件头注释自认：“V1 只定义结构，不建设完整自主学习系统”（:1-3）；接口注释：“V1 只定义，不实现完整存储”（:52-54）。
- 与 `memory/` 模块**无任何代码连接**（不共享表、不共享路径、不共享 Service）。
- **结论**：命名上的“记忆”与运行时 Memory 系统是两个世界。Immune ↔ Memory = **不存在**（连理论接口桥都未建）。

### Q11. Skills 是否从 Memory 中学习或读取经验？

**判定：不存在（代码层）+ 理论关系（agent 层）**

- `skill/index.ts` 的 import 列表（:1-19）**无** memory；skill 加载走文件系统 discovery + builtin bundle 解压。
- `tool/skill.ts` / `tool/skill-search.ts` 无 memory 引用。
- **唯一间接路径**：auto-distill 会话提示词要求 agent“用 memory 文件发现跨会话模式，然后创建缺失的 skill/agent/command”（`auto-dream.ts:35-43`）—— 这是 **LLM 中介的理论关系**：代码只 spawn 会话并施加写沙箱，没有任何 Skill↔Memory 的结构化读写 API，也没有“技能经验回写 Memory”的反向管道。

---

## 4. 架构问题清单

### P1 · 读写路径分裂：Service 只读，写入走文件系统

| 项 | 内容 |
|---|---|
| **描述** | `Memory.Service` 仅有 root/reconcile/search；所有写入绕过 Service，直接经 write 工具落盘，再靠 reconcile 惰性索引。读有统一 API，写没有。 |
| **代码位置** | `memory/service.ts:19-31`（无写 API）；`tool/memory-path-guard.ts:159-248`（写授权）；`memory/reconcile.ts:94-143`（事后索引） |
| **证据** | grep `Memory.write|Memory.append` 零业务调用；写路径全部走 `assertWriteAllowed` |
| **影响** | 写入无审计钩子、无事务、无去重、无 schema 校验；绕过工具的写（bash）直到 reconcile 才可见且无权限检查 |
| **严重程度** | **高** |
| **影响下一代设计** | **是** — 需要统一 MemoryWrite 接口（append/merge/forget + 权限 + 审计），文件树可作为实现细节而非协议 |

### P2 · 写授权双层并存且存在 bash 逃逸

| 项 | 内容 |
|---|---|
| **描述** | `assertWriteAllowed` = external_directory（对 memory 树提前返回）+ memory-path-guard（细分授权）。write/edit/apply_patch/notebook_edit 全接入；**bash 未接入**，注释自认“trust the model, permission layer is a backstop”。 |
| **代码位置** | `tool/external-directory.ts:102-141`；`memory-path-guard.ts:16-21`（明确写明 bash 不覆盖） |
| **证据** | **实际调用**（四个写工具）+ **注释承认的缺口**（bash） |
| **影响** | 模型可用 `bash` 写 `checkpoint.md` / 篡改任意记忆，checkpoint-writer 的“memory-only 沙箱”形同虚设（对 bash）；安全模型依赖提示纪律 |
| **严重程度** | **高** |
| **影响下一代设计** | **是** — 下一代必须把文件系统能力（含 bash）纳入统一 Capability 模型，或对 memory 树做 OS 级隔离 |

### P3 · `memory.disable_write` 一开关砍三能力（写+重建+自动整合）

| 项 | 内容 |
|---|---|
| **描述** | 写开关同时：① 禁新 checkpoint/记忆写入；② 短路 rebuild 到 compaction（`memory-write-off`）；③ 禁 auto dream/distill。读工具仍可用，但自动注入路径全灭。 |
| **代码位置** | `checkpoint.ts:664`；`prompt.ts:968-986`；`auto-dream.ts:113,126`；`subagent-progress-checker.ts:139` |
| **证据** | **实际调用** |
| **影响** | “只读记忆”模式实际上退化为“无自动记忆”——已有 MEMORY.md 不再被注入上下文，用户预期（config 描述 :339 承诺 “Existing memory stays READABLE”）与自动行为（rebuild 不注入）之间存在落差；描述虽有解释但体验上是能力耦合 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — 读/写/重建/整合应是四个独立开关（或读写 + 注入策略两级） |

### P4 · 循环依赖靠 `*Ref` 延迟绑定，失败静默降级

| 项 | 内容 |
|---|---|
| **描述** | Actor↔SessionPrompt↔SessionCheckpoint↔ToolRegistry 环用 `spawnRef` / `prefixCaptureRef` / `toolScriptRef` 破解；ref 未就绪时 checkpoint **静默 skip**、actor 工具报错但不崩。 |
| **代码位置** | `checkpoint.ts:787-792`；`tool/actor.ts:47-62`；`prefix-capture-ref.ts:6-44`；`tool-script-ref.ts:5` |
| **证据** | **实际调用** + 注释多处承认环 |
| **影响** | 时序 bug 表现为“记忆悄悄不写了”，难以观测；测试环境若不跑完整 AppLayer 会得到不同行为 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — 下一代应显式分层（Infra ← Domain ← App），消除对 ref 时序的依赖，或用启动探针强制 fail-fast |

### P5 · Immune Memory 是零引用死接口

| 项 | 内容 |
|---|---|
| **描述** | `metrics/immune-memory.ts` 定义完整的免疫记忆 schema + store 接口，但全库零 import、零实现；与 `memory/` 系统零连接。 |
| **代码位置** | `metrics/immune-memory.ts:1-65`（全部）；metrics/index.ts 未 re-export 它 |
| **证据** | grep 仅命中定义文件自身 — **接口声明**，调用 **不存在** |
| **影响** | 造成“系统有免疫记忆”的认知偏差；bench/docs 中的 Immune 叙事与运行时代码脱节；下一代若沿用需从零实现 |
| **严重程度** | **中**（文档/认知债）；功能债视产品目标为 **高** |
| **影响下一代设计** | **是** — 要么删除并更正文档，要么定义 ImmuneStore ↔ MemoryService 的显式桥 |

### P6 · Skill ↔ Memory 无结构化学习管道

| 项 | 内容 |
|---|---|
| **描述** | Skills 不读 Memory；Memory 不记录技能使用效果；唯一桥梁是 auto-distill 的一段提示词，靠 LLM 自觉读文件再写 skill。 |
| **代码位置** | `skill/index.ts:1-19`（无 memory）；`auto-dream.ts:35-43`（提示词） |
| **证据** | 代码层 **不存在**；agent 层 **理论关系** |
| **影响** | “经验 → 技能”不可审计、不可复现、不可测试；distill 质量完全取决于模型当次发挥 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — 经验回路需要结构化事件（skill_invoked / outcome / memory_link）而非提示词约定 |

### P7 · FTS 索引与文件真相的最终一致性窗口

| 项 | 内容 |
|---|---|
| **描述** | 写文件 → 下次 search/reconcile 才进 FTS。`memory_reconcile_on_search` 默认 true（每次 search 全量 walk），可被关掉导致索引陈旧。无 fs watcher。 |
| **代码位置** | `service.ts:59-64`；`reconcile.ts:46-92`；`config.ts:326-327` |
| **证据** | **实际调用** |
| **影响** | 大语料下每次 search 全量 stat 的性能风险；关掉开关后读己之写不一致；无写后主动 invalidate |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — 需要写路径同步 enqueue 索引，或 FileWatcher 驱动 |

### P8 · 运行时能力限制：Bun API 硬编码

| 项 | 内容 |
|---|---|
| **描述** | `Bun.file` / `Bun.write` 直接用于 memory 读写与 checkpoint 检测，无 node:fs 抽象层（service.ts:121 有注释承认双驱动问题但仅限 SQL prepare）。 |
| **代码位置** | `reconcile.ts:60`；`checkpoint.ts:166,767-768`；`plugin/subagent-progress-checker.ts:79` |
| **证据** | **实际调用** |
| **影响** | 无法在纯 Node/Jest 环境独立验证 memory 模块；迁移到其他运行时成本高 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** |

### P9 · 对特定 OS / 目录结构的依赖

| 项 | 内容 |
|---|---|
| **描述** | ① 数据根 `<data>/memory` 布局是隐式协议（path-guard、llm 教学、checkpoint-paths、reconcile parsePath 四处硬编码同一布局）；② CC 索引依赖 `~/.claude/projects` 固定路径；③ win32 反斜杠规范化分支分散多处。 |
| **代码位置** | `paths.ts:47-78`；`checkpoint-paths.ts:15-77`；`service.ts:39-40`；`external-directory.ts:31,39,54`；`memory-path-guard.ts:35-36,61-64` |
| **证据** | **实际调用** |
| **影响** | 布局演进（如 v4→v5→v6）需同步改 4+ 处；parsePath 用正则解析路径而非单一 builder，存在漂移风险 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — 路径协议应单一模块 owning，其余模块只消费 `MemoryLayout` 类型 |

### P10 · 对特定供应商/产品的隐性依赖（CC 兼容层）

| 项 | 内容 |
|---|---|
| **描述** | `memory.cc_index` 把 Claude Code 的 `~/.claude/projects/*/memory` 纳入 FTS，frontmatter type 解析器硬编码 CC 格式假设（`METADATA_TYPE_RE` 注释自认脆弱）。 |
| **代码位置** | `service.ts:40,48,62`；`paths.ts:80-103`（:88-92 明确写明 limitation）；`config.ts:343`（安全警告） |
| **证据** | **实际调用**（默认关） |
| **影响** | CC 格式变更会静默降级 type 为 free；隐私面扩大（config 描述已警告 prompt-injection 风险） |
| **严重程度** | **低-中** |
| **影响下一代设计** | **是** — 第三方记忆源应为 adapter，不进核心 parsePath |

### P11 · 写栅栏 fail-open + Instance ALS 丢失回退

| 项 | 内容 |
|---|---|
| **描述** | 无 Config 服务时写视为开启（`external-directory.ts:82-88`）；无 ALS Instance 时 projectID 回退 `ProjectID.global`（:115-121；`checkpoint.ts:740-744`）——游离 fiber 可能把项目记忆写进 global 域。 |
| **代码位置** | `external-directory.ts:82-121`；`checkpoint.ts:738-744` |
| **证据** | **实际调用** |
| **影响** | 测试/后台 fiber 场景下权限与 scope 可能静默偏离；跨项目记忆污染风险 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — scope 应随 spawn 显式传递，不依赖 ALS |

### P12 · 子代理记忆教学不对称

| 项 | 内容 |
|---|---|
| **描述** | `servesCheckpoint` 门控使 **仅 main/peer** 收到记忆系统教学；普通子代理（explore/general）不被教 memory 工具/路径，但仍可调用已注册的 memory 工具（工具注册是全局的）。 |
| **代码位置** | `llm.ts:308-364`；`registry.ts:248`（memory 工具全局注册，无 actor 过滤——除非 permission 层另有白名单） |
| **证据** | **实际调用**（教学门控）+ **实际调用**（工具注册无 actor 过滤，需结合 agent tools 白名单，见 `agent.ts:327-342` 注释） |
| **影响** | 子代理对记忆系统的认知依赖继承的工具列表而非教学，行为不一致；checkpoint-writer 反向被教了 writer 专用提示但无常规记忆教学（它有独立 prompt） |
| **严重程度** | **低** |
| **影响下一代设计** | 是（能力矩阵应显式化） |

### P13 · 数据流不透明：结果→记忆的转化不可审计

| 项 | 内容 |
|---|---|
| **描述** | 执行结果进入记忆完全依赖 checkpoint-writer 子代理的 LLM 判断（读消息→写文件）。没有结构化“值得记住”的事件流，没有写入来源标注（哪条 tool result 触发了哪段 MEMORY 更新）。 |
| **代码位置** | `checkpoint.ts:354-400`（writer prompt 组装）；:782+（spawn） |
| **证据** | **实际调用** |
| **影响** | 记忆内容质量黑盒；无法做“记忆 provenance”审计；错误记忆无法定点回滚（只有整文件） |
| **严重程度** | **高**（对记忆可信度） |
| **影响下一代设计** | **是** — 记忆条目需要来源 ID、置信度、可撤销性（与 ImmuneMemoryEntry 设计稿的 verification_evidence 思想对齐，但当前未落地） |

### P14 · Task 系统与 Memory 系统双轨并行

| 项 | 内容 |
|---|---|
| **描述** | TaskRegistry（SQLite）与 memory 树的 tasks/*.md 是两套任务状态。writer 把任务树“誊写”进 checkpoint.md §4；progress.md 又是第三份。 |
| **代码位置** | `task/registry.ts`（零 memory import）；`checkpoint.ts:749`（taskMemDir）；`memory-path-guard.ts:97-99,134-138`（tasks 保留域） |
| **证据** | **实际调用**（双轨写入）+ **不存在**（Task↔Memory API） |
| **影响** | 任务状态三处冗余（DB + progress.md + checkpoint §4），一致性靠 writer 每次誊写 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — 单一任务真相源 + 投影 |

### P15 · Metrics 命名空间与 Memory 无边界说明

| 项 | 内容 |
|---|---|
| **描述** | `metrics/immune-memory.ts` 使用 “memory” 一词但与 `memory/` 模块无关；审计/新人极易混淆（本审计 Q10 即为此设）。 |
| **代码位置** | `metrics/immune-memory.ts` 全文 |
| **证据** | **接口声明**孤岛 |
| **影响** | 认知负担；架构图失真 |
| **严重程度** | **低** |
| **影响下一代设计** | 是（命名/文档） |

### P16 · 无法独立验证的模块（测试性）

| 项 | 内容 |
|---|---|
| **描述** | Memory.Service 依赖 Config + Database（bun:sqlite/node:sqlite 双驱动）+ Bun.file + Global.Path（进程级 home 解析）。memory-path-guard 是纯函数（好）；reconcile/service 需要完整运行时。 |
| **代码位置** | `service.ts:35-148`；`reconcile.ts`；`global/index.ts:8-33`（模块加载期 mkdir） |
| **证据** | **实际调用** |
| **影响** | 单元测试需要重运行时；Global 模块 top-level await + mkdir 副作用阻碍隔离测试 |
| **严重程度** | **中** |
| **影响下一代设计** | **是** — 依赖注入 FileSystem / DataRoot 接口 |

---

## 5. 11 问速查矩阵

| # | 问题 | 判定 | 一句话结论 |
|---|---|---|---|
| 1 | 谁能读 Memory | **实际调用** | memory 工具、checkpoint rebuild、writer、 bootstrap reconcile；经提示教学后任意 read/grep agent |
| 2 | 谁能写 Memory | **实际调用** | writer / 主 agent / 任务子代理 / dream-distill，全部经文件系统+path-guard；Service 无写 API |
| 3 | 写入由谁触发 | **实际调用** | prune 阈值、rebuild 等待、校验重试、auto dream/distill、progress postStop 五条链 |
| 4 | 检索时机 | **实际调用** | 前（路径教学+重建注入）/ 中（memory 工具）/ 后（writer 沉淀）三段皆有 |
| 5 | 参与 Planning？ | **理论关系/不存在** | TaskRegistry 零接入；仅 checkpoint 文本快照层面汇合 |
| 6 | 参与 Execution？ | **实际调用** | 工具级可调用 + 写栅栏；无框架级自动注入 |
| 7 | 接收执行结果？ | **实际调用**（中介） | 经 checkpoint-writer LLM 中介落盘；无直接 record API |
| 8 | Reflection 改长期记忆？ | **实际调用** | checkpoint-retry reflection 驱动 writer 重写记忆文件 |
| 9 | Recovery 依赖 Memory？ | **部分** | /recovery 否；上下文重建是，且被写开关连带砍掉 |
| 10 | Immune ↔ Memory | **不存在** | 零 import 零实现零桥；纯接口孤岛 |
| 11 | Skills 从 Memory 学习？ | **不存在**/理论 | 代码零连接；仅 auto-distill 提示词中介 |

---

## 6. 对下一代设计的优先级建议（源自本审计）

1. **P1/P13（最高）**：引入统一 MemoryWrite/Provenance 接口——写入带来源、置信度、可撤销；文件树降为实现。
2. **P2（最高）**：把 bash/任意 FS 写纳入 memory 树 Capability 边界，消除“工具栅栏 + bash 逃逸”的不对称。
3. **P3**：拆分 disable_write 的写/注入/自动整合三职责。
4. **P5/P6**：要么实现 ImmuneStore↔Memory 桥与 Skill 经验回路，要么从叙事中删除，避免认知债扩大。
5. **P7/P8/P9/P16**：索引失效、运行时抽象、布局单一 owner、可测试性——工程基座。
6. **P4/P11/P12/P14**：生命周期、scope 传递、能力矩阵、任务单真相源——架构收敛。

---

*本报告为只读审计产物，未修改任何源码。*
