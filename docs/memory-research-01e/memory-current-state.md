# 当前 Memory 技术现状（memory-current-state.md）

> 尽调日期：2026-10-31
> 证据纪律：每项结论标注 VERIFIED / IMPLEMENTED_UNVERIFIED / PARTIAL / DESIGN_ONLY / NOT_IMPLEMENTED / UNKNOWN

---

## 1. 架构总览

**核心架构事实（VERIFIED）**：Memory 是**文件优先**系统。Markdown 文件是权威数据源，SQLite 仅作 FTS5 全文索引缓存，由 reconcile 单向同步（磁盘→SQLite）。

```
Agent 工具调用 → 写 .md 文件（经三级守卫）→ reconcile 建索引 → search 时从索引检索
```

**Memory.Service 无写 API（VERIFIED）**。所有写入路径是：工具写文件 → 守卫放行 → reconcile 建索引。`service.ts` 仅导出 `root` / `reconcile` / `search` 三个方法。

---

## 2. 核心模块清单

| 模块 | 文件 | 职责 | 证据等级 |
|------|------|------|---------|
| Service | `memory/service.ts` (148行) | FTS5+BM25 搜索、reconcile 调度、root 定位 | VERIFIED |
| Paths | `memory/paths.ts` (125行) | 路径↔locator 解析、类型探测、穿越防护 | VERIFIED |
| Reconcile | `memory/reconcile.ts` (144行) | 磁盘↔SQLite 同步、fingerprint 比对 | VERIFIED |
| Write Gate | `memory/write-gate.ts` (33行) | `memory.disable_write` 唯一 accessor | VERIFIED |
| FTS Query | `memory/fts-query.ts` (38行) | 自由文本→FTS5 OR 短语 MATCH | VERIFIED |
| FTS Schema | `memory/fts.sql.ts` (19行) | `memory_fts` Drizzle 表定义 | VERIFIED |
| Memory Tool | `tool/memory.ts` (77行) | 内置工具，仅 `operation=search` | VERIFIED |
| Path Guard | `tool/memory-path-guard.ts` (248行) | 写路径守卫 + 子代理沙箱 | VERIFIED |
| Immune Memory | `metrics/immune-memory.ts` (65行) | Zod 类型骨架，零引用 | DESIGN_ONLY |

---

## 3. 已实现能力（VERIFIED）

### 3.1 文件持久记忆
- 目录结构：`global/` / `projects/<id>/` / `sessions/<sid>/`
- 文件类型：`MEMORY.md` / `checkpoint.md` / `notes.md` / `tasks/<id>/progress.md`
- 路径解析：`paths.ts:24-56` 的 `parsePath` / `buildPath`

### 3.2 SQLite FTS5 检索
- 表结构：`memory_fts`（content 普通表）+ `memory_fts_idx`（FTS5 虚表，external-content）
- 查询：`memory_fts_idx MATCH ? JOIN memory_fts`（`service.ts:102-112`）
- 排序：BM25 + 相对分数地板 0.15（`service.ts:119-132`）
- 分词：unicode61（memory），cjk_unigram（history 有额外索引）

### 3.3 写入门禁
- 唯一开关：`memory.disable_write`（`write-gate.ts:12`）
- 调用点：`prompt.ts:986`（checkpoint）、`auto-dream.ts:113,126`、`external-directory.ts:88`、`subagent-progress-checker.ts:99`
- 行为：write-off 时不 spawn checkpoint writer，rebuild 短路到 compaction

### 3.4 路径守卫
- 三级守卫链：`assertWriteAllowed` → `assertAgentWriteSandbox` + `assertMemoryWriteAllowed`
- 入口：`external-directory.ts:125-132`
- 保留路径：checkpoint.md、notes.md 等主代理不可直接写（`memory-path-guard.ts:108-132`）
- **已知缺陷**：`assertMemoryWriteAllowed` 缺 `path.resolve`，Windows 上守卫可静默失效（见 §6）

### 3.5 Checkpoint Writer
- Spawn：`checkpoint.ts:664` 检查 write-gate → spawn writer 子代理
- 水位推进：`last_checkpoint_message_id` 仅在 writer 成功时推进（事务性不变量）
- 恢复：bootstrap reconcile 恢复中断的 checkpoint

### 3.6 Reconcile 同步
- 触发：bootstrap 后台 + search 前 lazy + rebuild 前
- 机制：walk 磁盘 → fingerprint（size-mtime）比对 → upsert/delete SQLite
- 方向：单向磁盘→SQLite（`reconcile.ts:78-88`）

---

## 4. 缺失能力（NOT_IMPLEMENTED）

| 能力 | 现状 | 证据 |
|------|------|------|
| 遗忘/过期 | 完全没有，记忆只增不删 | 无任何 decay/expire 代码 |
| 冲突检测 | 无，同路径覆盖写 | `reconcile.ts:78-88` upsert 无版本比较 |
| 版本管理 | 无 | 无 version/supersede 字段 |
| 关联图谱 | 无 | 搜索返回扁平行，无图结构 |
| 经验抽象 | 仅 prompt 约定 | auto-dream 依赖模型自律，无结构化抽取 |
| 来源追溯 | 仅 path | 无提炼链路元数据 |
| 程序性技能库 | 无积累机制 | skills/ 目录存在但无 utility 更新 |

---

## 5. 设计意图但未实现（DESIGN_ONLY）

| 能力 | 设计位置 | 现状 |
|------|---------|------|
| Immune 记忆 | `immune-memory.ts:56-65` ImmuneMemoryStore | 仅接口声明，零 import 零测试 |
| 主代理不编辑 checkpoint.md | 系统提示约定 | path-guard 实际允许（`memory-path-guard.ts:130-132` 注释确认） |
| Dream 反思 | `auto-dream.ts` | 依赖模型自律写 notes.md，无结构化输出 |

---

## 6. 已知缺陷（VERIFIED）

### 6.1 Windows 路径守卫失效
- **根因**：`assertMemoryWriteAllowed` 未调用 `path.resolve`（对比 `assertAgentWriteSandbox:35` 有 resolve）
- **影响**：Windows 上 `path.join("/data/memory",...)` 与字符串 `startsWith` 不匹配 → 守卫静默放行全部应拒绝路径
- **证据**：29 个 path-guard 测试失败（`memory-failure-cases.md`）
- **严重性**：高——安全守卫在主要运行平台失效

### 6.2 源码↔运行时漂移
- 本机 DB 有 `20261013000000_inbox_queue` 迁移，当前 checkout migration 目录无此文件
- 影响：版本追溯不完整

### 6.3 bash 不经守卫
- `memory-path-guard.ts:18-21` 注释明确承认：bash 工具不走 `assertWriteAllowed`
- 依赖 prompt 层纪律约束（DESIGN_ONLY）

---

## 7. 运行时数据规模

从 `mimocode.db` 只读抽样（2026-10-31）：
- `memory_fts`：897 行（sessions/checkpoint 362, free 338, projects/memory 168, progress 29）
- `memory_fts_idx`：同 897 行
- 迁移：56 条（`__drizzle_migrations`）

---

## 8. 与 Immune V1 的关系

**零耦合（VERIFIED）**：
- `ImmuneMemoryStore` 仅接口声明（`immune-memory.ts:56-65`）
- 全 src/test 零 import 零测试
- 与 `Memory.Service` 无任何数据流
- Immune V1 的 `classifyToolError` 是独立模块，不写入 Memory

---

*本报告基于 memory-research-01e/ 下 01-current-audit、memory-runtime-flow、memory-data-model、memory-system-dependencies、memory-failure-cases 五份子报告综合提炼。*
