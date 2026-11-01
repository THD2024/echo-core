# 分阶段实施路线图（09）

> 基于：06-recommended-architecture（HLM-v1）、07-data-model-lifecycle、08-risks-open-questions
> 本文件定义 HLM-v1 的分阶段实施路线图，每个阶段有明确的交付物、验收标准和回滚点

---

## 总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    HLM-v1 实施路线图                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Phase 0          Phase 1          Phase 2          Phase 3      │
│  基线建立    →    核心数据层   →   检索与装配  →   巩固管道      │
│  (2 周)           (4 周)           (4 周)           (4 周)       │
│                                                                   │
│  · 评测集准备     · SQLite schema  · 混合检索     · 冲突审计    │
│  · Raw-RAG 基线   · 情景层写入     · Post-Retrieval· 反思抽象    │
│  · 性能基线       · 语义层抽取     · Assembly     · 技能提炼    │
│                   · 版本化机制     · 向量索引     · 衰减归档    │
│                                                                   │
│  交付物：          交付物：          交付物：          交付物：    │
│  · 评测集         · HLM DB schema  · 检索 API      · 巩固管道  │
│  · 基线报告       · 写入 API       · Assembly 层   · 监控告警  │
│  · 性能报告       · 兼容层         · 性能报告       · 评测报告  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 0：基线建立（2 周）

### 目标
- 建立评测基线，为后续验证提供对照
- 准备评测数据集
- 记录现有系统性能

### 任务清单

#### Week 1：评测集准备

| 任务 | 产出 | 负责 |
|------|------|------|
| LongMemEval 子集筛选 | `benchmarks/longmemeval_subset/` | 评测组 |
| MemoryAgentBench 子集筛选 | `benchmarks/memoryagentbench_subset/` | 评测组 |
| 冲突标注集构建 | `benchmarks/conflict_resolution/` | 评测组 |
| 评测脚本开发 | `scripts/evaluate_memory.py` | 工程组 |

#### Week 2：基线测量

| 任务 | 产出 | 负责 |
|------|------|------|
| 现有 Memory 系统测试 | `benchmarks/baseline/existing_system.md` | 工程组 |
| Raw-RAG baseline 运行 | `benchmarks/baseline/raw_rag.md` | 评测组 |
| 性能基线测量 | `benchmarks/baseline/performance.md` | 工程组 |
| 基线报告汇总 | `benchmarks/baseline/REPORT.md` | 评测组 |

### 验收标准

- [ ] 评测集覆盖 5 类能力（信息抽取、多会话推理、时间推理、知识更新、拒答）
- [ ] 冲突标注集 ≥ 100 条，人工校验完成
- [ ] Raw-RAG baseline 结果完整记录
- [ ] 现有系统性能基线完整（延迟、准确率、吞吐量）

### 回滚点

无（纯测量阶段，不修改生产代码）

---

## Phase 1：核心数据层（4 周）

### 目标
- 实现 HLM-v1 数据库 schema
- 实现情景层写入与检索
- 实现语义层实体抽取与版本化
- 保持与现有系统兼容

### 任务清单

#### Week 3-4：数据库与情景层

| 任务 | 产出 | 依赖 |
|------|------|------|
| SQLite schema 实现 | `memory/hlm/schema.sql` | Phase 0 |
| 情景层写入 API | `memory/hlm/episodic.ts` | schema |
| 情景层检索（FTS5） | `memory/hlm/episodic-search.ts` | schema |
| 工具输出指针存储 | `memory/hlm/tool-outputs.ts` | schema |
| 单元测试 | `test/memory/hlm-episodic.test.ts` | 以上全部 |

#### Week 5-6：语义层与版本化

| 任务 | 产出 | 依赖 |
|------|------|------|
| 实体抽取模块 | `memory/hlm/semantic-extract.ts` | LLM 接口 |
| 实体存储与版本化 | `memory/hlm/semantic-entities.ts` | schema |
| 关系存储与版本化 | `memory/hlm/semantic-relations.ts` | schema |
| 实体消歧（canonical_key） | `memory/hlm/entity-disambiguation.ts` | 实体存储 |
| Supersede/Revoke API | `memory/hlm/versioning.ts` | 版本化存储 |
| 兼容层（现有 Memory 工具） | `memory/hlm/compat.ts` | 以上全部 |
| 集成测试 | `test/memory/hlm-semantic.test.ts` | 以上全部 |

### 验收标准

- [ ] 所有 SQLite 表创建成功，索引正确
- [ ] 情景层写入延迟 P95 < 50ms
- [ ] 语义层实体抽取准确率 > 80%（抽样人工校验）
- [ ] 版本化机制测试 100% 通过
- [ ] 现有 Memory 工具无回归（A/B 测试）
- [ ] 兼容层无缝对接现有系统

### 回滚点

- Git tag: `hlm-v1-phase1-complete`
- 数据备份：`backup/hlm-v1-phase1/`
- 回滚方式：Git revert + 恢复备份

### 风险缓解

| 风险 | 缓解措施 |
|------|---------|
| 实体抽取错误固化 | 置信度阈值 + 抽样校验 |
| 与现有系统兼容断裂 | 兼容层 + A/B 测试 |
| 写入延迟过高 | 异步抽取 + 缓冲 |

---

## Phase 2：检索与装配（4 周）

### 目标
- 实现混合检索（BM25 + 向量 + 图遍历）
- 实现 Post-Retrieval Assembly
- 实现统一检索 API
- 达到性能目标

### 任务清单

#### Week 7-8：混合检索

| 任务 | 产出 | 依赖 |
|------|------|------|
| 向量索引模块 | `memory/hlm/vector-index.ts` | embedding 接口 |
| 图遍历模块（PPR） | `memory/hlm/graph-traversal.ts` | 语义层 |
| 检索路由器 | `memory/hlm/retrieval-router.ts` | 以上全部 |
| 检索融合算法 | `memory/hlm/retrieval-fusion.ts` | 以上全部 |
| 单元测试 | `test/memory/hlm-retrieval.test.ts` | 以上全部 |

#### Week 9-10：Assembly 与 API

| 任务 | 产出 | 依赖 |
|------|------|------|
| 冲突检测模块 | `memory/hlm/conflict-detection.ts` | 语义层 |
| 陈旧降权模块 | `memory/hlm/stale-demotion.ts` | 语义层 |
| 证据包组装 | `memory/hlm/evidence-packaging.ts` | 以上全部 |
| 统一检索 API | `memory/hlm/search-api.ts` | 以上全部 |
| Provenance 追踪 | `memory/hlm/provenance.ts` | 以上全部 |
| 性能优化 | 各模块优化 | 以上全部 |
| 集成测试 + 基准测试 | `test/memory/hlm-assembly.test.ts` | 以上全部 |

### 验收标准

- [ ] 混合检索准确率 > Raw-RAG baseline 10%+
- [ ] 冲突检测准确率 > 90%
- [ ] 检索延迟 P95 < 500ms
- [ ] Assembly 消融实验显示正向收益
- [ ] Provenance 覆盖率 100%
- [ ] 评测集全部通过

### 回滚点

- Git tag: `hlm-v1-phase2-complete`
- 数据备份：`backup/hlm-v1-phase2/`
- 回滚方式：Git revert + 恢复备份 + 降级到现有检索

### 风险缓解

| 风险 | 缓解措施 |
|------|---------|
| 检索延迟过高 | 性能预算 + 降级路径 |
| 向量索引一致性 | fingerprint 校验 + 定期重建 |
| 图规模爆炸 | 去重/合并 + 衰减归档 |

---

## Phase 3：巩固管道（4 周）

### 目标
- 实现离线巩固管道
- 实现冲突审计与反思抽象
- 实现技能提炼与衰减归档
- 建立监控告警

### 任务清单

#### Week 11-12：巩固管道核心

| 任务 | 产出 | 依赖 |
|------|------|------|
| 巩固触发器 | `memory/hlm/consolidation-trigger.ts` | Phase 2 |
| 冲突审计模块 | `memory/hlm/conflict-audit.ts` | 语义层 |
| 反思抽象模块 | `memory/hlm/reflection.ts` | LLM 接口 |
| 技能提炼模块 | `memory/hlm/skill-extraction.ts` | 程序层 |
| 衰减归档模块 | `memory/hlm/decay-archival.ts` | 全部层 |
| 巩固报告生成 | `memory/hlm/consolidation-report.ts` | 以上全部 |

#### Week 13-14：监控与优化

| 任务 | 产出 | 依赖 |
|------|------|------|
| 监控指标收集 | `memory/hlm/metrics.ts` | Phase 2 |
| 告警规则实现 | `memory/hlm/alerts.ts` | 监控 |
| A/B 测试框架 | `memory/hlm/ab-testing.ts` | Phase 2 |
| 性能优化 | 各模块优化 | 以上全部 |
| 端到端测试 | `test/memory/hlm-e2e.test.ts` | 以上全部 |
| 评测报告 | `benchmarks/hlm-v1/REPORT.md` | 以上全部 |

### 验收标准

- [ ] 巩固管道端到端测试通过
- [ ] 实体抽取准确率 > 85%
- [ ] 技能提炼在 ALFWorld 或类似任务上显示正向收益
- [ ] 衰减策略在遗忘评测集上正确
- [ ] 监控指标完整，告警规则生效
- [ ] 巩固成本符合预算
- [ ] 最终评测报告：相对 Raw-RAG 增益 > 10%

### 回滚点

- Git tag: `hlm-v1-phase3-complete`
- 数据备份：`backup/hlm-v1-phase3/`
- 回滚方式：Git revert + 恢复备份 + 禁用巩固管道

### 风险缓解

| 风险 | 缓解措施 |
|------|---------|
| 巩固 LLM 成本过高 | 预算限制 + 效用门控 |
| 巩固错误不可逆 | 可审计 + 快照 + 回滚 |
| 监控盲区 | 完整指标 + 告警覆盖 |

---

## 资源估算

### 人力

| 阶段 | 工程师 | 评测 | 总计 |
|------|--------|------|------|
| Phase 0 | 0.5 | 1.0 | 1.5 人周 |
| Phase 1 | 2.0 | 0.5 | 2.5 人周/周 × 4 周 = 10 人周 |
| Phase 2 | 2.0 | 1.0 | 3.0 人周/周 × 4 周 = 12 人周 |
| Phase 3 | 2.0 | 1.0 | 3.0 人周/周 × 4 周 = 12 人周 |
| **总计** | | | **35.5 人周** |

### LLM 成本

| 阶段 | 用途 | 估算 |
|------|------|------|
| Phase 0 | 评测运行 | ¥50-100 |
| Phase 1 | 实体抽取测试 | ¥100-200 |
| Phase 2 | 检索优化测试 | ¥100-200 |
| Phase 3 | 巩固管道测试 | ¥200-400 |
| **总计** | | **¥450-900** |

### 基础设施

| 项目 | 估算 |
|------|------|
| SQLite 存储 | 现有基础设施复用 |
| 向量索引 | 需评估（内嵌 vs 独立服务） |
| LLM API | 现有 provider 复用 |

---

## 里程碑与决策点

### 里程碑

| 里程碑 | 时间 | 标志 |
|--------|------|------|
| M0 | Week 2 结束 | 基线报告完成 |
| M1 | Week 6 结束 | 核心数据层可用 |
| M2 | Week 10 结束 | 检索系统可用 |
| M3 | Week 14 结束 | HLM-v1 完整可用 |

### 决策点

| 决策点 | 时间 | 决策内容 |
|--------|------|---------|
| D1 | Week 2 结束 | 是否继续实施？（基线是否达标） |
| D2 | Week 6 结束 | 是否继续 Phase 2？（数据层是否达标） |
| D3 | Week 10 结束 | 是否继续 Phase 3？（检索是否达标） |
| D4 | Week 14 结束 | 是否上线？（整体是否达标） |

### 决策标准

每个决策点需回答：
1. 验收标准是否全部满足？
2. 性能是否达标？
3. 相对 baseline 是否有正向收益？
4. 是否有未解决的 Critical 风险？

---

## 风险登记册

| # | 风险 | 阶段 | 影响 | 概率 | 缓解 | 负责人 |
|---|------|------|------|------|------|--------|
| R1 | 实体抽取准确率不达标 | Phase 1 | 高 | 中 | 优化 prompt + 人工校验 | 工程组 |
| R2 | 检索性能不达标 | Phase 2 | 高 | 中 | 性能优化 + 降级路径 | 工程组 |
| R3 | 与现有系统兼容断裂 | Phase 1 | 高 | 低 | 兼容层 + A/B 测试 | 工程组 |
| R4 | 巩固成本超预算 | Phase 3 | 中 | 中 | 预算限制 + 效用门控 | 工程组 |
| R5 | 评测集不充分 | Phase 0 | 中 | 低 | 多源评测集 + 人工校验 | 评测组 |
| R6 | 团队技能缺口 | 全程 | 中 | 低 | 培训 + 外部咨询 | 项目经理 |

---

## 成功标准

HLM-v1 实施成功的标志：

1. **功能完整**：所有 9 个验收问题都能回答
2. **性能达标**：检索延迟 P95 < 500ms，写入延迟 P95 < 100ms
3. **效果提升**：相对 Raw-RAG baseline 提升 > 10%
4. **兼容无损**：现有 Memory 系统功能无回归
5. **成本可控**：LLM 成本符合预算
6. **监控完备**：关键指标可监控，告警可触发
7. **评测通过**：LongMemEval + MemoryAgentBench + 自建集全部通过

---

*本路线图基于 HLM-v1 架构设计，所有任务与验收标准均可追溯到研究报告来源。*
