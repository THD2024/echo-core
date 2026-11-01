# 关键风险、未决问题与验证计划（08）

> 基于：01-current-audit、02-human-cognitive-architecture、03-agent-memory-research、06-recommended-architecture
> 本文件识别 HLM-v1 架构的关键风险、待解决问题，以及验证计划

---

## 1. 关键风险

### 1.1 技术风险

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|------|---------|
| T1 | **语义层抽取错误固化** | 错误实体/关系进入图谱，污染后续检索 | 高 | 置信度阈值 + 巩固审计 + 人工复核接口 |
| T2 | **图规模爆炸** | 实体/关系数量线性增长，检索性能下降 | 中 | 去重/合并策略 + 衰减归档 + 图分片 |
| T3 | **写入延迟过高** | 实时实体抽取阻塞 Agent 主循环 | 中 | 异步抽取 + 写入缓冲 + 批量处理 |
| T4 | **巩固管道 LLM 成本** | 离线反思消耗大量 token | 中 | 效用门控 + 预算限制 + 增量巩固 |
| T5 | **向量索引一致性** | embedding 与内容不同步 | 低 | fingerprint 校验 + 定期重建 |
| T6 | **并发写入冲突** | 多 Agent 同时更新同一实体 | 中 | 版本化 + 乐观锁 + 审计日志 |

### 1.2 认知风险（Agent 行为）

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|------|---------|
| C1 | **Experience-following 陷阱** | 检索到相似记忆导致输出强相似，错误传播 | 高 | 相似度阈值 + 多样性采样 + 反事实检索 |
| C2 | **过度依赖记忆** | Agent 忽略当前上下文，盲目复用旧经验 | 中 | 记忆置信度衰减 + 上下文优先级 |
| C3 | **记忆幻觉** | Agent 将检索结果当作确定事实 | 中 | Provenance 强制展示 + 置信度标注 |
| C4 | **检索回避** | Agent 因记忆系统复杂而减少使用 | 低 | 简化 API + 默认行为优化 |

### 1.3 工程风险

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|------|---------|
| E1 | **与现有系统兼容断裂** | 现有 Memory 工具/测试失效 | 中 | 兼容层 + 渐进迁移 + A/B 测试 |
| E2 | **数据迁移复杂** | 现有 MEMORY.md 内容导入困难 | 中 | 一次性迁移脚本 + 人工校验 |
| E3 | **性能回归** | 新系统比现有 BM25 慢 | 中 | 基准测试 + 性能预算 + 降级路径 |
| E4 | **调试困难** | 多层系统问题定位困难 | 中 | 完整审计日志 + 可观测性 + 回放工具 |

### 1.4 安全风险

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|------|---------|
| S1 | **记忆投毒** | 恶意输入污染记忆库 | 中 | 写入门控 + 来源验证 + 异常检测 |
| S2 | **隐私泄露** | 敏感信息进入可检索记忆 | 中 | 敏感词过滤 + 访问控制 + 自动脱敏 |
| S3 | **Prompt injection via memory** | 检索结果包含注入指令 | 高 | 内容消毒 + 置信度标注 + 人工复核 |

---

## 2. 未决问题

### 2.1 架构设计问题

| # | 问题 | 当前假设 | 待验证 |
|---|------|---------|--------|
| Q1 | 写入门控的 surprise 阈值如何校准？ | 初始 0.3，基于 Generative Agents 论文 | 需 A/B 测试不同阈值 |
| Q2 | 实体消歧的 canonical_key 生成策略？ | 基于 entity_type + 规范化 name | 需评估不同消歧算法 |
| Q3 | 图遍历的 PPR 跳数上限？ | 默认 2 跳 | 需基准测试不同深度 |
| Q4 | 巩固管道的触发时机？ | 定时 + 空闲 + 手动 | 需评估触发策略效果 |
| Q5 | 程序技能的 utility 更新公式？ | success / (success + failure) | 需考虑时间衰减 |

### 2.2 性能问题

| # | 问题 | 当前假设 | 待验证 |
|---|------|---------|--------|
| Q6 | 语义层抽取的延迟预算？ | 异步 < 100ms P95 | 需实测 LLM 调用延迟 |
| Q7 | 混合检索的融合算法？ | 加权平均（BM25 + 向量 + PPR） | 需基准测试不同融合策略 |
| Q8 | 图规模上限？ | 假设 < 100 万节点 | 需压测验证 |

### 2.3 评测问题

| # | 问题 | 当前假设 | 待验证 |
|---|------|---------|--------|
| Q9 | 如何证明记忆有效而非仅增加存储？ | 基准评测 + Raw-RAG baseline | 需设计具体评测集 |
| Q10 | 冲突检测的准确率目标？ | > 90% | 需标注冲突数据集 |
| Q11 | 遗忘策略的效果如何量化？ | MemoryAgentBench 遗忘分任务 | 需自建遗忘评测集 |

---

## 3. 验证计划

### 3.1 阶段验证

#### Phase 0：基线建立（实施前）

| 验证项 | 方法 | 通过标准 |
|--------|------|---------|
| 现有系统性能基线 | 运行现有 memory 测试 + 记录延迟 | 基线数据完整 |
| 评测集准备 | LongMemEval 子集 + 自建冲突集 | 评测集覆盖 5 类能力 |
| Raw-RAG baseline | 在评测集上运行朴素 RAG | baseline 结果记录 |

#### Phase 1：核心数据层（实施后）

| 验证项 | 方法 | 通过标准 |
|--------|------|---------|
| 情景层写入 | 单元测试 + 集成测试 | 100% 通过 |
| 语义层抽取 | 抽样人工校验 | 抽取准确率 > 80% |
| 版本化机制 | supersede/revoke 测试 | 状态转换正确 |
| 与现有系统兼容 | A/B 测试现有 memory 工具 | 无回归 |

#### Phase 2：检索与装配（实施后）

| 验证项 | 方法 | 通过标准 |
|--------|------|---------|
| 混合检索效果 | 评测集 vs Raw-RAG baseline | 提升 > 10% |
| 冲突检测 | 冲突标注集测试 | 准确率 > 90% |
| 检索延迟 | P95 延迟测量 | < 500ms |
| Post-Retrieval Assembly | 消融实验 | 相比无装配有提升 |

#### Phase 3：巩固管道（实施后）

| 验证项 | 方法 | 通过标准 |
|--------|------|---------|
| 实体抽取质量 | 抽样人工校验 | 准确率 > 85% |
| 技能提炼效果 | ALFWorld 或类似任务 | 成功率提升 |
| 巩固成本 | LLM 调用计数 | 符合预算 |
| 衰减策略 | 遗忘评测集 | 选择性遗忘正确 |

### 3.2 持续验证

#### 3.2.1 基准评测套件

```
benchmarks/
├── longmemeval_subset/          # LongMemEval 子集
│   ├── information_extraction/
│   ├── multi_session_reasoning/
│   ├── temporal_reasoning/
│   ├── knowledge_update/
│   └── abstention/
├── memoryagentbench_subset/     # MemoryAgentBench 子集
│   ├── accurate_retrieval/
│   ├── test_time_learning/
│   ├── long_range_understanding/
│   └── selective_forgetting/
├── conflict_resolution/         # 自建冲突集
│   ├── simple_override/
│   ├── multi_hop_conflict/
│   └── temporal_reversal/
└── raw_rag_baseline/            # Raw-RAG baseline
```

#### 3.2.2 评测指标

| 指标 | 计算方式 | 目标 |
|------|---------|------|
| 检索准确率 | 正确检索结果 / 总查询 | > 80% |
| 冲突检测率 | 正确检测冲突 / 总冲突 | > 90% |
| 遗忘正确率 | 正确遗忘 / 应遗忘项 | > 85% |
| 检索延迟 P95 | 95 分位延迟 | < 500ms |
| 写入延迟 P95 | 95 分位延迟 | < 100ms |
| Token 成本 | 每千次操作 token 消耗 | 符合预算 |
| 相对 Raw-RAG 增益 | (HLM - RawRAG) / RawRAG | > 10% |

### 3.3 A/B 测试计划

#### 3.3.1 检索策略 A/B

| 组别 | 策略 | 对比指标 |
|------|------|---------|
| A | 现有 BM25 only | 准确率、延迟 |
| B | BM25 + 向量 | 准确率、延迟 |
| C | BM25 + 向量 + PPR | 准确率、延迟 |
| D | HLM-v1 混合 + Assembly | 准确率、延迟 |

#### 3.3.2 写入门控 A/B

| 组别 | 阈值 | 对比指标 |
|------|------|---------|
| A | 无门控（全写入） | 存储量、检索噪声 |
| B | surprise > 0.1 | 存储量、检索准确率 |
| C | surprise > 0.3 | 存储量、检索准确率 |
| D | surprise > 0.5 | 存储量、检索准确率 |

---

## 4. 监控与告警

### 4.1 关键监控指标

```typescript
interface MemoryMetrics {
  // 写入
  writes_per_minute: number;
  write_gate_rejection_rate: number;
  avg_write_latency_ms: number;
  
  // 检索
  searches_per_minute: number;
  avg_search_latency_ms: number;
  p95_search_latency_ms: number;
  empty_result_rate: number;
  
  // 存储
  episodic_event_count: number;
  semantic_entity_count: number;
  semantic_relation_count: number;
  procedural_skill_count: number;
  
  // 巩固
  consolidation_runs_today: number;
  last_consolidation_duration_ms: number;
  consolidation_llm_tokens: number;
  
  // 质量
  conflict_detection_rate: number;
  stale_evidence_rate: number;
  provenance_coverage_rate: number;
}
```

### 4.2 告警规则

| 告警 | 条件 | 严重度 |
|------|------|--------|
| 检索延迟过高 | P95 > 1000ms 持续 5 分钟 | Warning |
| 检索延迟过高 | P95 > 2000ms 持续 5 分钟 | Critical |
| 写入失败率 | > 10% 持续 5 分钟 | Warning |
| 巩固失败 | 连续 3 次失败 | Critical |
| 图规模异常 | 实体数增长率 > 100%/天 | Warning |
| Token 预算超支 | 日消耗 > 预算 80% | Warning |

---

## 5. 回滚策略

### 5.1 数据回滚

| 场景 | 回滚方式 |
|------|---------|
| 语义层抽取错误 | revoke 错误实体 + 审计日志 |
| 巩固管道错误 | 恢复 consolidation_runs 快照 |
| 数据迁移失败 | 恢复备份 + 重新迁移 |

### 5.2 系统回滚

| 场景 | 回滚方式 |
|------|---------|
| 性能回归 | 降级到现有 Memory 系统 |
| 兼容性问题 | 启用兼容层 + 回退 API |
| 严重 bug | Git revert + 数据迁移回滚 |

### 5.3 回滚测试

```bash
# 回滚演练脚本
scripts/
├── test_rollback_semantic.sh     # 语义层回滚测试
├── test_rollback_consolidation.sh # 巩固管道回滚测试
└── test_rollback_full.sh         # 完整系统回滚测试
```

---

## 6. 待决策事项

需要架构评审委员会决策的事项：

| # | 事项 | 选项 | 推荐 |
|---|------|------|------|
| D1 | 是否启用向量检索？ | 是/否 | 是（但需验证成本） |
| D2 | 是否启用图遍历？ | 是/否/仅语义层 | 是（仅语义层） |
| D3 | 巩固管道是否默认开启？ | 是/否/仅手动 | 否（默认关闭，手动触发） |
| D4 | 现有 MEMORY.md 如何处理？ | 保留/迁移/混合 | 迁移（一次性导入语义层） |
| D5 | 写入门控默认阈值？ | 0.1/0.3/0.5 | 0.3（可配置） |
| D6 | 衰减策略默认值？ | 激进/保守/禁用 | 保守（半衰期 90 天） |

---

*本风险与验证计划基于三份研究报告的证据，所有判断附有来源编号。*
