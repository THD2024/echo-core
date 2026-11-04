# Memory 系统测试覆盖与失败案例审计

审计日期：2026-11-03
测试运行环境：Windows 11 / PowerShell / bun v1.3.14 / effect 4.0.0-beta.48
运行方式：`bun test <file>`（`--timeout 30000` 默认）
方法：逐文件运行并记录 pass/fail；只读源码分析覆盖矩阵

**总览（本次实测）**：

| 文件 | pass | fail | skip | 备注 |
|------|------|------|------|------|
| test/tool/memory.test.ts | 2 | 0 | 0 | |
| test/tool/memory-write-gate.test.ts | 4 | 1 | 0 | 见 §4.1 |
| test/tool/memory-path-guard.test.ts | 50 | 29 | 0 | 见 §4.2（Windows 路径缺陷） |
| test/tool/memory-edit-ask-skip.test.ts | 2 | 0 | 0 | |
| test/session/checkpoint-memory-write.test.ts | 6 | 0 | 0 | |
| test/session/auto-dream-memory-write.test.ts | 4 | 0 | 0 | |
| test/config/memory-disable-write.test.ts | 11 | 0 | 0 | |
| test/memory/service.test.ts | 6 | 0 | 0 | |
| test/memory/reconcile.test.ts | 5 | 0 | 0 | |
| test/memory/paths.test.ts | 44 | 0 | 1 | 1 skip = POSIX-only backslash 用例；与 fts-query 等 4 文件合跑得 64 pass/1 skip |
| test/memory/fts-query.test.ts | 9 | 0 | 0 | |
| test/memory/fts-rowid-stability.test.ts | 5 | 0 | 0 | 见 §4.3 警告 |
| test/memory/cc-search.test.ts | 3 | 0 | 0 | |
| test/memory/cc-reconcile.test.ts | 10 | 0 | 0 | 与 cc-* 4 文件合跑得 32 pass/1 skip（skip 在 cc-paths） |
| test/memory/cc-paths.test.ts | 9 | 0 | 1 | |
| test/memory/cc-frontmatter.test.ts | 10 | 0 | 0 | |
| test/memory/abort-leak.test.ts | 2 | 0 | 0 | 名字含 memory 但测的是 webfetch AbortController 泄漏，与 Memory 系统无关 |
| **合计（与 Memory 相关，不含 abort-leak）** | **180** | **30** | **2** | |

> abort-leak.test.ts 虽位于 `test/memory/` 目录，实际测试 webfetch 工具的 AbortController 内存泄漏（`abort-leak.test.ts:15-49`），**不属于 Memory 系统能力**，下文覆盖矩阵不计入其能力映射。

---

## 1. 现有测试清单

### 1.1 `test/tool/memory.test.ts`（2 pass / 0 fail）

测试对象：`src/tool/memory.ts` 的 `memory` 工具（VERIFIED）。
- search 返回格式化结果且包含命中文件名（`:38-54`）
- 空结果返回 "No matches"（`:56-70`）

未覆盖：scope/type 过滤、score floor、多结果排序提示文案。

### 1.2 `test/tool/memory-write-gate.test.ts`（4 pass / 1 fail）

测试对象：`assertWriteAllowed` × `memory.disable_write` 开关（W5 集成门禁）（VERIFIED）。
- disable_write=true → 拒绝 MEMORY.md 写，文案含 "Memory WRITING is disabled"、禁重试、可读、必须显式 search/read、不含 "loads into context"（`:38-70`）——**本用例在本机 FAIL**（§4.1）
- disable_write=true → notes.md 同样拒绝（`:72-84`）
- disable_write=true → memory 树外写不受影响（`:86-96`）
- 缺省 config → 默认允许写（`:98-108`）
- disable_write=false → 允许写（`:110-120`）

### 1.3 `test/tool/memory-path-guard.test.ts`（50 pass / 29 fail）

测试对象：`assertMemoryWriteAllowed` / `assertAgentWriteSandbox` 纯函数（VERIFIED）。
覆盖面（设计意图 79 用例）：
- 非 memory 路径放行、自由 key、_meta.json（`:18-54`）
- 无 scope 目录 / 非法 scope 拒绝（`:56-80`）——**Windows 上 FAIL**
- `..` 遍历落 tasks 拒绝（`:99-110`）——**Windows 上 FAIL**
- checkpoint-writer v5 allowlist 全套（memory.md / spillover / checkpoint.md / tasks/*/progress.md）+ 拒绝 v4 pinned.md、子目录、非 .md（`:112-319`）
- 主 agent 可写 MEMORY.md/checkpoint.md、拒写 tasks/（`:322-374`）
- 错误消息内容断言（`:376-514`）
- 任务绑定子代理 own-TID 放行 / 跨任务拒绝 / 非 .md 拒绝（`:516-570`）
- checkpoint-paths 尾段字节相等（`:572-593`）
- `assertAgentWriteSandbox`：checkpoint-writer memory-only；dream/distill memory+`.mimocode`；逃逸与前缀兄弟目录拒绝（`:596-732`）
- writeEnabled:false 对四类规范路径拒绝、true/缺省放行、非 memory 路径不受影响（`:734-838`）

**29 个 FAIL 全部集中在"期望 throw 但函数静默返回"的用例**，根因见 §4.2。

### 1.4 `test/tool/memory-edit-ask-skip.test.ts`（2 pass / 0 fail）

测试对象：`askEditUnlessMemory`（VERIFIED）。
- `<data>/memory/` 下跳过 edit ask（`:39-49`）
- 非 memory 路径仍 ask（`:51-61`）

### 1.5 `test/session/checkpoint-memory-write.test.ts`（6 pass / 0 fail）

测试对象：`SessionCheckpoint.tryStartCheckpointWriter` × 写开关（W1）+ 读路径完整性（VERIFIED）。
- `MIMOCODE_DISABLE_CHECKPOINT=true` → skip、不 spawn、无文件（`:110-140`）
- 缺省 config → started、spawn=1、checkpoint.md+notes.md 创建（`:142-164`）
- disable_write=false → 同缺省（`:166-187`）
- disable_write=true → skip、零 spawn、零文件（`:189-216`）
- disable_write=true → 已有 checkpoint 仍能 renderRebuildContext（`:220-243`）
- disable_write=true → memory search 仍能找到预写入记忆（`:245-264`）

### 1.6 `test/session/auto-dream-memory-write.test.ts`（4 pass / 0 fail）

测试对象：`shouldAutoDream` / `shouldAutoDistill` × 写开关（W6）（VERIFIED）。
- disable_write=true → 项目足够老也不 dream/distill（`:56-67`、`:86-97`）
- 写开关优先于显式 `dream.auto:true` / `distill.auto:true`（`:71-82`、`:99-110`）

注释（`:46-54`）说明**只断言 DISABLED 方向**——enabled 方向受进程级 10s spawn 节流跨文件顺序影响，被有意跳过，由 config 层测试补位。

### 1.7 `test/config/memory-disable-write.test.ts`（11 pass / 0 fail）

测试对象：config schema 解析 + `isMemoryWriteEnabled` 访问器（VERIFIED）。
- schema：缺省/空 section/布尔/非布尔拒绝/与 cc_index 共存（`:6-27`）
- 访问器：4 种 enabled 形态 + `disable_write:true` 禁用 + 非字面 true 不禁用（`:33-59`）

### 1.8 `test/memory/` 目录（101 pass / 0 fail / 2 skip，不含 abort-leak 的 2 pass）

| 文件 | 测试了什么 | 等级 |
|------|-----------|------|
| `service.test.ts` (6) | `Memory.search`：BM25 跨 scope 排序、scope/scope_id/type 过滤、limit、FTS5 特殊字符不崩、多词 OR 语义（含 DSN 召回回归注释 `:151-157`）、空查询返回空 | VERIFIED |
| `reconcile.test.ts` (5) | 6 种原生布局索引+搜索+更新+删除 [TP-R6-06]、新文件索引、删除 prune、fingerprint 跳过、内容变更重索引 | VERIFIED |
| `paths.test.ts` (28+1 skip) | `parsePath` 全类型矩阵（memory/checkpoint/progress/notes/free/legacy v4）、`buildPath` 遍历拒绝、Windows/UNC 原生路径 [TP-R6-06]、`resolveProjectId` 确定性 | VERIFIED |
| `fts-query.test.ts` (9) | `buildFtsQuery`：OR 拼接、`_`/`-` 边界、CJK 单 token、日文空白切分、标识符切分、FTS5 标点剥离、SQL 关键字字面化、DSN OR 召回回归 | VERIFIED |
| `fts-rowid-stability.test.ts` (5) | v6.1 AUTOINCREMENT rowid 单调、100 删插循环、v6.0 负对照（软断言）、v6.1 坏 trigger UPSERT 即腐、v6.1.1 'delete' magic 修复 + 无陈旧 token | VERIFIED |
| `cc-search.test.ts` (3) | cc+mimo 混合排名、scope=cc 过滤、type=feedback/project 过滤 | VERIFIED |
| `cc-reconcile.test.ts` (8+1 skip) | walkCcRoot（缺目录/多 slug/无 memory 子目录/非 md）、cc 索引 frontmatter type、union prune 不误删 mimo 行、cc_index 关闭 prune、ENOENT 静默 | VERIFIED |
| `cc-paths.test.ts` (11+1 skip) | `parseCcPath` slug/嵌套/MEMORY.md/Windows 路径/排除规则 | VERIFIED |
| `cc-frontmatter.test.ts` (10) | `parseCcFrontmatterType`：feedback/project/reference/user、无 frontmatter、缺 metadata.type、未知 type、畸形、顶层 type 忽略 | VERIFIED |
| `abort-leak.test.ts` (2) | webfetch AbortController 泄漏 + closure vs bind 模式对比——**与 Memory 系统无关** | VERIFIED（排除） |

---

## 2. 测试覆盖矩阵

| 能力 | 测试文件 | 覆盖状态 | 说明 |
|------|---------|---------|------|
| **精确回忆**（字面精确检索） | `memory.test.ts`、`service.test.ts` | **PARTIAL** | BM25 短语引号 + snippet；工具文案（`tool/memory.ts:58`）明确承认"精确字面量需转 history 工具"——精确回忆**被设计为不在 Memory 内完成**。无逐字全文匹配测试。 |
| **关联检索**（OR/多词/模糊） | `service.test.ts:122-168`、`fts-query.test.ts:42-47` | **覆盖（VERIFIED）** | OR 语义、score floor、DSN 回归均有断言 |
| **冲突处理**（矛盾记忆仲裁） | — | **未测试** | 代码亦无冲突检测/仲裁逻辑（NOT_IMPLEMENTED） |
| **过期信息**（staleness / TTL） | — | **未测试** | 无 TTL 机制；reconcile 仅按文件存在性 prune，不判断内容时效。工具文案提示"verify before acting"是 prompt 层缓解，无测试 |
| **错误记忆**（写错/幻觉条目的检测与纠正） | — | **未测试** | 无置信度字段、无纠错机制（对比 ImmuneMemoryEntry 的 confidence 设计——未接线） |
| **重复记忆**（dedup） | `reconcile.test.ts:114-136`（fingerprint 跳过）、`fts-rowid-stability.test.ts`（同 path 重插） | **PARTIAL** | 索引级 dedup 有覆盖；**内容级**（两条笔记写同一件事）无去重、无测试 |
| **信息遗漏**（该记没记 / recall miss） | `fts-query.test.ts:42-47`（OR 防漏召） | **PARTIAL** | 仅覆盖"查询词不全导致 0 结果"一类；无"写入遗漏"检测 |
| **证据追溯**（claim → source） | `service.test.ts`（结果含 path+snippet）、`memory.test.ts:51` | **PARTIAL** | 返回 path/snippet 可追溯到文件；但 snippet 是 FTS 片段而非结构化 evidence chain；无 provenance 元数据测试 |
| **崩溃恢复**（索引损坏/中断恢复） | `fts-rowid-stability.test.ts`（全部 5 用例） | **覆盖（VERIFIED）** | 专门针对 v6.0/v6.1 触发器腐坏与修复；含 integrity-check |
| **并发读写** | — | **未测试** | 无多进程/多 session 并发写 memory 或并发 reconcile 测试。`service.ts:121` 的 prepare 语句非线程级防护 |
| **索引重建**（reconcile 增量/全量） | `reconcile.test.ts`（5）、`cc-reconcile.test.ts`（8） | **覆盖（VERIFIED）** | 索引/更新/删除/fingerprint/跨 root/开关翻转全覆盖 |
| 写路径守卫（scope/allowlist/沙箱） | `memory-path-guard.test.ts` | **PARTIAL（Windows 失效）** | 设计覆盖极全（79 用例），但本机 29 fail——见 §4.2 |
| 写开关端到端 | `memory-write-gate.test.ts`、`checkpoint-memory-write.test.ts`、`auto-dream-memory-write.test.ts`、`memory-disable-write.test.ts` | **覆盖（VERIFIED）** | W1/W5/W6 + config schema + 访问器四层齐备 |
| CC 外部记忆索引 | `cc-*.test.ts`（4 文件 32+3 skip） | **覆盖（VERIFIED）** | |
| 路径解析跨平台 | `paths.test.ts`、`cc-paths.test.ts` | **覆盖（VERIFIED）** | Windows/UNC/混合分隔符 [TP-R6-06] |

**未测试项汇总（明确标记「未测试」）**：
1. 冲突处理
2. 过期信息（TTL/staleness 自动检测）
3. 错误记忆检测与纠正
4. 内容级重复合并
5. 信息遗漏的主动补全
6. 结构化证据链（provenance graph）
7. 并发读写（多 writer、search 期间写入）
8. memory 工具的 type 参数在 mimo scope 的行为（type 过滤只在 cc 测过）
9. `memory_search_score_floor` 配置的实际过滤行为（代码 `service.ts:83-137` 有实现，无专项测试）
10. auto-dream/auto-distill 的 **enabled** 方向（有意推迟到 config 层，见 §1.6）
11. dream/distill 子代理真实 spawn 后的写入行为（仅测 should* 谓词与沙箱纯函数）
12. bootstrap reconcile 失败降级路径（`bootstrap.ts:54` 的 warn 分支）

---

## 3. 能力 → 已实现但未验证（IMPLEMENTED_UNVERIFIED）清单

以下代码能力存在、有部分间接测试，但缺少直接断言：

| 能力 | 实现位置 | 缺口 |
|------|---------|------|
| score floor 相对过滤 | `memory/service.ts:83-137` | 无阈值边界测试 |
| over-fetch 3x cap | `memory/service.ts:116` | 无 |
| `memory_reconcile_on_search=false` 跳过懒 reconcile | `memory/service.ts:61`；cc 测试中仅作为 fixture 开关使用，未断言"跳过"本身 | 无正面断言 |
| migrateProjectMemory（memory.md→MEMORY.md） | `session/checkpoint-paths.ts:48`；llm.ts/checkpoint.ts 启动调用 | 无专项测试（paths.test 测了 parse 大小写，未测迁移副作用） |
| hasMemoryOrTasks | `checkpoint.ts:1202` | checkpoint-memory-write 间接依赖，无直接断言 |
| 预算化 rebuild 渲染（push_caps.*） | `checkpoint.ts:1340-1351` | 无预算截断测试 |
| subagent-progress-checker 的 memory 提示抑制 | `plugin/subagent-progress-checker.ts:134-139` | 无插件侧测试 |

---

## 4. 已知失败案例

### 4.1 `memory-write-gate.test.ts` 单点失败：CJK 路径污染「纯英文」断言

- **失败用例**：`disable_write: true → memory write is refused with an explicit 'disabled' message`（`:38-70`）
- **断言**：`expect(message).not.toMatch(/[\u4e00-\u9fff]/)`（`:52`）
- **实际**：拒绝消息内嵌绝对路径 `C:\Users\<user>\AppData\Local\Temp\...`——用户名含汉字"<user>"，触发假阳性失败。
- **根因判断**：测试假设拒绝消息只含 ASCII；在非 ASCII 用户名的 Windows 机上路径部分必然含 CJK。**产品文案本身是英文**（源码 `memory-path-guard.ts:186-193`），失败源于测试对路径内容的过度断言。
- **影响**：测试环境脆弱性，非功能缺陷。证据等级：VERIFIED（本次运行复现）。

### 4.2 `memory-path-guard.test.ts` 29 连败：Windows 下 `path.sep` 与字面量 `MEMORY_ROOT` 不一致导致守卫早退

- **现象**：所有"期望 throw"的用例收到 `Received function did not throw`。
- **根因**（源码级）：
  1. 测试固定 `MEMORY_ROOT = "/data/memory"`（`memory-path-guard.test.ts:13`），target 用 `path.join(MEMORY_ROOT, ...)` 构造——Windows 上 `path.join` 产出 `\data\memory\sessions\...`（盘符相对路径，前导反斜杠）。
  2. `assertMemoryWriteAllowed` 中 `normalizedRoot = memoryRoot + path.sep` → `"/data/memory\"`（正斜杠根 + 反斜杠 sep 混拼）；`if (!target.startsWith(normalizedRoot)) return`（`memory-path-guard.ts:174-175`）用**字符串前缀**判断"是否在 memory 树内"。
  3. Windows 上 `target`（`\data\memory\...`）不以 `"/data/memory\"` 开头 → **函数把合法 memory 路径判为"非 memory 路径"直接放行**，后续 writeEnabled/allowlist/reserved 检查全部跳过。
- **对比**：`assertAgentWriteSandbox` 用 `path.resolve` 归一后再比较（`:35-36`），因此同文件的沙箱 describe 全部通过。`assertMemoryWriteAllowed` 未 resolve，是不对称的实现缺陷。
- **生产影响评估**：
  - 生产中 memoryRoot 来自 `path.join(Global.Path.data, "memory")`（`memory/service.ts:39`），target 来自工具传入的绝对路径——两者同为原生 Windows 路径时 `startsWith` 通常成立，**生产主路径大概率不受影响**。
  - 但若 memoryRoot 与 target 一方未归一（例如 API 调用方传入正斜杠路径、或 `C:\` vs `c:\` 大小写差异），守卫会**静默放行**而非拒绝——这是安全隐患，不只是测试问题。`path.resolve` 不对称已暴露该模式。
- **结论**：29 个失败是**真实的平台缺陷在测试层的投影**；不能简单归为"测试太挑"。修复方向应为在 `assertMemoryWriteAllowed` 入口对 target 与 memoryRoot 做 `path.resolve`（与 `assertAgentWriteSandbox` 对齐），而非放宽测试。证据等级：VERIFIED（源码逻辑 + 本次 29 fail 复现）。

### 4.3 `fts-rowid-stability.test.ts` 软警告：v6.0 负对照未复现腐坏

- 测试 `(c)` 输出：`v6.0 schema did NOT reproduce corruption in 200 cycles — hypothesis weaker than expected`（`fts-rowid-stability.test.ts:194-197`）。
- 断言仍为 `expect(true).toBe(true)`（`:205`）——**永不失败**，属探索性测试。
- 含义：AUTOINCREMENT 修复的"必要性"在当前 bun:sqlite 版本上证据弱化；修复本身（(a)(b)(d)(e)）仍被正向验证。证据等级：VERIFIED。

### 4.4 其他从代码/注释提取的已知薄弱点（非测试失败，属已知风险）

| 项 | 来源 | 等级 |
|----|------|------|
| bash 可绕过 memory 写守卫（prompt 纪律 only） | `memory-path-guard.ts:18-21` | VERIFIED（设计声明） |
| dream/distill enabled 方向跨测试文件顺序依赖（10s 进程级节流） | `auto-dream-memory-write.test.ts:46-54` | VERIFIED |
| CC `type:user/feedback` 开启 cc_index 后对 prompt-injection 脆弱 agent 可读 | `config.ts:343` 配置 description | VERIFIED（文档级风险声明） |
| v4 遗留布局（checkpoint/ 子目录、pinned.md）解析为 free 但无迁移测试 | `paths.test.ts:69-85` | VERIFIED |

---

## 5. 运行环境约束

### 5.1 模型与 API（对 memory 质量的影响）

| 约束 | 证据 | 影响 |
|------|------|------|
| checkpoint-writer / dream / distill 均为 LLM 子代理 | `auto-dream.ts:28-39` prompt；`checkpoint-memory-write.test.ts:127-131` spawn | memory 写入内容质量 = 模型能力；测试全部用 fake provider（`ProviderTest.fake()`，checkpoint-memory-write.test.ts:29-31），**真实模型写入质量零覆盖** |
| 无 embedding 模型依赖 | `package.json:83-191` 无 vector/embedding SDK | 检索纯 lexical（FTS5 BM25）；语义召回能力受词面匹配上限约束 |
| provider 众多（Anthropic/OpenAI/xAI/…）但 memory 层不感知 | `package.json:89-106` | 模型差异只通过 spawn 的 provider 间接影响 writer |

### 5.2 上下文窗口

| 约束 | 证据 |
|------|------|
| rebuild 预算：checkpoint 11k / project memory 10k / global 6k / notes 6k / titles 500 tokens（默认） | `config.ts:286-302`、`checkpoint.ts:1340-1351` 默认值 |
| 写关闭时 rebuild 降级 compaction，memory dump 不再自动进上下文 | `prompt.ts:1062-1094`、`memory-write-gate.test.ts:57-66` 断言 |
| compaction 触发默认模型窗口 90%（`MIMOCODE_COMPACTION_TRIGGER_RATIO`） | `flag/flag.ts:160-168` |

### 5.3 存储

| 约束 | 证据 |
|------|------|
| 存储介质：SQLite（FTS5 external-content 虚表 `memory_fts_idx` + 内容表 `memory_fts`）+ 文件系统 markdown | `memory/fts.sql.ts:4-17`、`service.ts:102-121` |
| 驱动双栈：bun:sqlite / node:sqlite 经 `#db` import 条件解析；search 用 `prepare` 兼容两者 | `package.json:28-32`、`service.ts:117-121` |
| root 固定 `<Global.Path.data>/memory` | `service.ts:39` |
| CC 外部索引根 `~/.claude/projects`，opt-in | `service.ts:40`、`config.ts:341-344` |
| 删除永不发生于写开关关闭时（"Nothing is ever deleted"） | `config.ts:339` |
| fingerprint 跳过避免无变更重索引 | `reconcile.test.ts:114-136` |

### 5.4 成本

| 成本项 | 证据 |
|--------|------|
| auto dream 默认 7 天间隔、distill 30 天；每次 = 一次完整 agent 运行 | `auto-dream.ts` DEFAULT 间隔、`config.ts:353-355` |
| spawn 节流 10s 进程级（防测试/热路径抖动） | `auto-dream-memory-write.test.ts:46-54` 注释 |
| search 前懒 reconcile：每次 search 最多全树 stat | `service.ts:59-64`；可用 `memory_reconcile_on_search:false` 关闭 |
| checkpoint writer 常驻成本与 `MIMOCODE_DISABLE_CHECKPOINT` 可关 | `flag.ts:137-143`、W1 测试 |
| 子代理并发上限默认 min(16, 2×CPU)，间接约束并行 memory 写者数量 | `config.ts:454` |

### 5.5 本机测试平台约束（影响审计结论复现）

- Windows + 中文用户名：触发 §4.1；POSIX 字面量 root 触发 §4.2。
- `paths.test.ts` / `cc-paths.test.ts` / `cc-reconcile.test.ts` 各有 1 个 `process.platform === "win32"` skip（POSIX backslash 语义用例），属预期。
- 本次**未在 POSIX/CI 环境**复跑；§4.2 在 Linux/macOS 上预计不出现（`path.join` 与字面量根一致），但 `assertMemoryWriteAllowed` 的 resolve 缺口仍是代码级事实。

---

## 6. 审计结论摘要

1. **测试资产厚度**：写开关（W1/W5/W6）与索引/检索（FTS/reconcile/CC）是覆盖最强的两块，共 160+ 用例，端到端链路（config → predicate → 守卫 → 文件系统）可验证。
2. **记忆质量闭环几乎空白**：冲突、过期、错误记忆、内容去重、遗漏补全、并发——这些"记忆系统作为认知组件"的核心能力全部「未测试」且多数「未实现」。当前系统定位更接近"可检索的会话文件缓存 + 写守卫"，而非具备自我修正能力的记忆系统。
3. **一个真实平台缺陷**：`assertMemoryWriteAllowed` 缺 `path.resolve` 导致 Windows 上守卫可静默失效（§4.2），建议优先修复并重跑 29 用例。
4. **Immune 交叉验证**：`ImmuneMemoryStore` 零实现、零引用、零测试（见 dependencies 报告 §6），其 confidence/evidence 模型与 agent Memory 无任何接线——若未来要"错误记忆纠正"，该结构是现成的 DESIGN_ONLY 起点。
5. **测试诚实度**：代码注释对"为何只测 DISABLED 方向"（auto-dream）、"为何 v6.0 对照是软断言"（fts-rowid）有明确解释，未掩盖缺口；`memory.ts` 工具文案主动承认精确字面量召回的边界并导流 history 工具——设计边界与测试边界基本对齐。
