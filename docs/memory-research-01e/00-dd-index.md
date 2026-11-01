# Echo Core Memory 前置尽调交付物索引

> 日期：2026-10-31
> 状态：✅ 全部完成
> 约束：只读调查，未修改任何生产代码/数据/配置

---

## 交付物清单（9 份）

| # | 文件 | 内容 | 状态 |
|---|------|------|------|
| 1 | `memory-current-state.md` | 当前 Memory 技术现状（能力分级+缺陷） | ✅ |
| 2 | `memory-runtime-flow.md` | 真实运行链路（输入→检索→写入→持久化） | ✅ |
| 3 | `memory-data-model.md` | 完整 SQLite schema+迁移+FTS5 定义 | ✅ |
| 4 | `memory-system-dependencies.md` | Memory↔Session/Tool/Immune/Agent 依赖 | ✅ |
| 5 | `memory-failure-cases.md` | 测试覆盖矩阵+实测结果（180P/30F） | ✅ |
| 6 | `memory-environment-constraints.md` | 运行环境+模型+存储+成本约束 | ✅ |
| 7 | `memory-research-01e/` | 完整研究文档（10 份学术+架构） | ✅ |
| 8 | `memory-hlm-v1-revised.md` | HLM-v1 修订稿（7 处修订+原因） | ✅ |
| 9 | `memory-evidence-index.md` | 所有结论的代码路径+证据等级索引 | ✅ |

---

## 关键发现摘要

### 架构事实（VERIFIED）
- Memory 是**文件优先**系统，SQLite 仅作 FTS5 索引
- Memory.Service **无写 API**，写入走文件系统+守卫+reconcile
- reconcile **单向**磁盘→SQLite
- Immune 与 Memory **零耦合**

### 已知缺陷（VERIFIED）
- **Windows 路径守卫失效**：`assertMemoryWriteAllowed` 缺 path.resolve，29 测试失败
- **bash 绕过守卫**：不走 assertWriteAllowed
- **无并发锁**：last-writer-wins
- **源码↔DB 迁移漂移**

### 测试实测
- 180 pass / 30 fail / 2 skip
- 冲突处理/过期/错误记忆/并发 = **未测试且未实现**

---

## 证据纪律声明

- 所有结论标注：VERIFIED / IMPLEMENTED_UNVERIFIED / PARTIAL / DESIGN_ONLY / NOT_IMPLEMENTED / UNKNOWN
- 未将设计意图描述为已实现
- 未编造测试结果/性能数据/成本数据
- 未修改任何生产文件
- 未启动任何实施阶段
