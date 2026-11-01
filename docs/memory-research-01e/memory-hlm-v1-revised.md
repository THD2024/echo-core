# HLM-v1 修订稿（memory-hlm-v1-revised.md）

> 修订日期：2026-10-31
> 基于：前置尽调发现（memory-runtime-flow / memory-data-model / memory-system-dependencies / memory-failure-cases）
> 变更：对原 HLM-v1（06-recommended-architecture.md）的修订，标注每处修订原因

---

## 1. 修订摘要

| # | 原方案 | 修订后 | 原因 |
|---|--------|--------|------|
| R1 | 未考虑 Windows 路径守卫缺陷 | Phase 0 增加守卫修复为前置任务 | 29 测试失败证实守卫在主平台失效 |
| R2 | 未明确 bash 绕过风险 | 新增 bash 守卫接入为 P0 依赖 | `memory-path-guard.ts:18-21` 注释承认缺口 |
| R3 | 假设有 Service 级写 API | 明确"文件优先"架构，不引入 Service 写 API | 现有架构是文件权威+SQLite 索引，不应推翻 |
| R4 | 版本化在语义层 | 版本化扩展到情景层和语义层 | 尽调确认现有 upsert 无版本比较 |
| R5 | 未考虑并发锁 | 新增 SQLite WAL + 文件锁策略 | 尽调确认无锁，last-writer-wins |
| R6 | Immune 作为独立系统 | 明确 ImmuneMemoryStore 可作为冲突审计起点 | 零耦合但接口已定义 |
| R7 | 未考虑源码↔DB 漂移 | Phase 0 增加迁移对齐检查 | 尽调发现漂移 |

---

## 2. 架构不变项（与原 HLM-v1 一致）

以下核心设计保持不变：

- **三层记忆**：情景层（不可变事件）+ 语义层（时序知识图）+ 程序层（技能库）
- **混合检索**：BM25 + 向量 + 图 PPR
- **Post-Retrieval Assembly**：独立后检索装配层
- **巩固管道**：离线反思/冲突审计/衰减/技能提炼
- **渐进兼容**：现有 Memory 系统作为文件后端共存

---

## 3. 修订详情

### R1: Phase 0 增加守卫修复（P0 前置）

**问题**：`assertMemoryWriteAllowed` 在 Windows 上静默失效。

**证据**：29 个 path-guard 测试失败，根因是 `path.join("/data/memory",...)` 与字符串 `startsWith` 不匹配。

**修订**：Phase 0 第一个任务是修复 `memory-path-guard.ts`，添加 `path.resolve`。

**验收**：path-guard 测试全绿（30/30 pass）。

---

### R2: bash 守卫接入

**问题**：bash 工具不走 `assertWriteAllowed`，可绕过路径守卫。

**证据**：`memory-path-guard.ts:18-21` 注释明确承认。

**修订**：Phase 1 增加 bash 命令解析 + 写路径检测。解析失败时降级为 prompt 约定（DESIGN_ONLY）。

**验收**：bash 写 memory 路径时被拦截（至少覆盖常见模式）。

---

### R3: 文件优先架构确认

**问题**：原方案未明确是否引入 Service 级写 API。

**修订**：明确不引入。保持"工具写文件 → 守卫放行 → reconcile 建索引"三段式。

**理由**：现有架构已验证可靠（writer 水位事务性不变量），推翻成本高。

**新模块接入方式**：新模块（如语义层）通过独立 SQLite 表 + 独立 reconcile 路径接入，不修改现有 Service。

---

### R4: 版本化扩展到三层

**问题**：原方案仅在语义层做版本化。

**修订**：三层统一版本化。

| 层 | 版本化方式 | 实现 |
|----|-----------|------|
| 情景层 | 不可变事件 + supersede 指针 | 新事件引用旧事件 ID，不修改旧事件 |
| 语义层 | fact + valid_from/valid_to/status | 沿用 Graphiti 模式 |
| 程序层 | skill version + utility | 新版本引用旧版本，utility 按成功率更新 |

---

### R5: 并发与锁策略

**问题**：现有系统无锁，last-writer-wins。

**修订**：
- SQLite 开启 WAL 模式（读写不互斥）
- 文件写入使用临时文件+原子重命名
- 跨进程协调使用 SQLite 事务（非文件锁）

**理由**：SQLite 已在用，WAL 是零成本升级；文件锁在 Windows 上不可靠。

---

### R6: Immune 接口复用

**问题**：ImmuneMemoryStore 与 Memory 零耦合。

**修订**：不强制接线，但将 ImmuneMemoryStore 接口作为冲突审计模块的**参考设计**。

**理由**：
- 接口已定义（`immune-memory.ts:56-65`），字段合理
- 零耦合是优点（关注点分离）
- 冲突审计模块可独立实现，不必依赖 Immune

---

### R7: 迁移对齐检查

**问题**：源码 migration 目录与运行时 DB 不一致。

**修订**：Phase 0 增加迁移对齐检查脚本，确保：
- 运行时 DB 的迁移集 ⊆ 源码 migration 目录
- 新迁移必须同时更新 DB 和源码

**验收**：对齐检查脚本通过。

---

## 4. 修订后路线图

```
Phase 0 (3周)              Phase 1 (4周)           Phase 2 (4周)           Phase 3 (4周)
修复+基线            →     核心数据层        →     检索与装配       →     巩固管道

· 守卫修复(R1)            · SQLite schema          · 混合检索              · 冲突审计
· 迁移对齐(R7)            · 情景层写入             · Assembly              · 反思抽象
· 评测集准备              · 语义层抽取             · 向量索引              · 技能提炼
· Raw-RAG 基线            · 版本化(R4)             · bash 守卫(R2)         · 衰减归档
· 性能基线                · 并发锁(R5)                                       · WAL 优化
```

**总工期**：15 周（原 14 周 + Phase 0 多 1 周）

---

## 5. 新增验收标准

| # | 标准 | 阶段 |
|---|------|------|
| A1 | path-guard 测试 30/30 pass | Phase 0 |
| A2 | 迁移对齐检查通过 | Phase 0 |
| A3 | bash 写 memory 路径被拦截 | Phase 1 |
| A4 | 并发写入不产生脏数据 | Phase 1 |
| A5 | 版本链可追溯（情景+语义） | Phase 2 |
| A6 | 现有 memory 测试不回归 | 全程 |

---

## 6. 风险更新

| 新增风险 | 等级 | 缓解 |
|---------|------|------|
| 守卫修复引入回归 | 中 | 修复后全量测试 + 人工审查 |
| bash 解析误判 | 中 | 保守策略（解析失败不拦截，记日志） |
| WAL 模式兼容性 | 低 | SQLite 3.7+ 均支持，Bun bundled 版本足够新 |
| 迁移对齐遗漏 | 低 | 自动化检查脚本 |

---

*本修订稿基于前置尽调的 4 份子报告（runtime-flow / data-model / dependencies / failure-cases）综合提炼。所有修订均附证据来源。*
