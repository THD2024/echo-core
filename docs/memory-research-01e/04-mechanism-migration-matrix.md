# 机制迁移分析矩阵（04）

> 基于：01-current-audit（现状）、02-human-cognitive-architecture（认知科学）、03-agent-memory-research（AI Agent Memory）
> 标注：✅ 推荐迁移 / ⚠️ 需改造 / ❌ 不迁移 / 🔗 与现有系统关联

---

## 1. 总矩阵

| # | 生物/认知机制 | 计算实现思路 | 迁移决策 | 改造要点 | 与 Echo Core 现状关联 | 风险 |
|---|--------------|-------------|---------|---------|---------------------|------|
| 1 | 工作记忆有界容量（Baddeley/Cowan） | 每步注入记忆预算、attention 门控 | ✅ | 预算随任务类型自适应；复用现有 rebuild token 预算体系 | 🔗 `config.ts:286-314` push_caps 已有类似机制 | 预算过紧丢关键证据 |
| 2 | 情景缓冲区（Baddeley 2000） | 统一 episodic packet：事件+实体+时间+工具输出指针 | ✅ | 绑定完整 provenance；包不宜过重 | 🔗 现有 checkpoint.md 是其粗糙原型 | 包过重导致检索成本高 |
| 3 | 情景记忆（Tulving） | 不可变事件日志 + 时间戳；允许 supersede 指针 | ✅ | 永不静默改写；版本化 | 🔗 现有 sessions/*.md 是文件级情景，无结构化 | 隐私与保留策略 |
| 4 | 语义记忆（Tulving） | 实体-关系图 / 用户档案；支持版本 | ✅ | 与情景分离；事实带有效期 | 🔗 现有 projects/MEMORY.md 是扁平语义 | 抽取错误固化 |
| 5 | 程序性记忆（Squire） | skill/macro 库、成功路径 chunk；utility 更新 | ✅ | 以任务成功率更新 utility | 🔗 现有 skills/ 目录 + tools/ 可作为载体 | 错误技能传播（experience-following） |
| 6 | 编码特异性（Tulving & Thomson） | 写入时丰富条件键（任务、用户、环境、时间） | ✅ | 避免过早压缩丢键 | 🔗 现有 fingerprint 仅 size-mtime，条件键缺失 | 元数据爆炸 |
| 7 | 展布激活 / 索引补全（Collins & Loftus） | KG + PPR / 多跳扩展 | ✅ | 与稠密检索混合；保留朴素 RAG baseline | ❌ 现状无图谱 | 噪声边扩散 |
| 8 | 模式分离（Yassa & Stark） | 实体消歧、canonical key、正交化 | ✅ | 检测"相似非相同" | ❌ 现状无消歧 | 过分离导致无法关联 |
| 9 | 突触/系统巩固（McClelland CLS） | 离线 reflection、合并、图重构、抽象层级化 | ✅ | schedule + 效用门控；可审计 | 🔗 auto-dream/distill 是其雏形但默认关 | 巩固错误不可逆 |
| 10 | 提取练习（Roediger & Karpicke） | 自探测 QA、周期性 probe | ✅ | 与真实流量分布一致的 probe | ❌ 现状无 probe 机制 | 探测成本；分布偏移 |
| 11 | 重建性提取（Bartlett） | 检索后按当前状态改写/适配；必须可回链原始证据 | ✅ | provenance 链必须完整 | 🔗 现有 search 返回 path 可回链 | 幻觉性重构 |
| 12 | 干扰抑制 / 主动遗忘 | 冲突解析、revoke、选择性遗忘 | ✅ | last-write 不够；要版本+审计 | ❌ 现状完全缺失 | 误删有用历史 |
| 13 | 时间衰退（Ebbinghaus/ACT-R） | 按类型 perishability 的 soft decay | ⚠️ | 事实 vs 稀有偏好策略不同 | ❌ 现状无衰减 | 真重要低频知识被衰减 |
| 14 | 注意门控（GWT/Baars） | 只有"显著/目标相关"内容入长期库 | ✅ | surprise/utility 评分 | 🔗 write-gate 是其工程对应 | 门控器成为单点瓶颈 |
| 15 | Impasse 驱动学习（SOAR） | 失败触发检索/反思/技能固化 | ✅ | 需可靠失败检测 | 🔗 Immune V1 classifyToolError 是其起点 | 频繁假阳性 |
| 16 | 基线激活方程（ACT-R） | score = log Σ t^{-d} + spreading + noise | ✅ | d 按类型；spreading 用图 | 🔗 现有 BM25 可作为 spreading 的一部分 | 参数敏感 |
| 17 | 检索阈值 + 弃答 | score < T → 拒答或继续搜索 | ✅ | 与 LongMemEval abstention 对齐 | 🔶 现有 floor ratio 0.15 是其粗糙版 | 阈值校准 |
| 18 | CLS 双系统（快写+慢巩固） | 海马式快写索引 + 皮层式慢结构化 | ✅ | 离线 consolidation 管道 | 🔗 reconcile 是同步管道，非巩固管道 | 工程复杂度 |
| 19 | 知识图谱 + 时序有效期（Graphiti） | fact + validity window；失效不删除 | ✅ | 检索默认当前视图，按需历史视图 | ❌ 现状无 | 图构建依赖 LLM；运维成本 |
| 20 | Zettelkasten 笔记网络（A-MEM） | 结构化卡片+动态链接 | ⚠️ | O(N²) 写入问题需解决 | ❌ 现状无 | 链接质量依赖 LLM |

---

## 2. 不迁移的机制及理由

| 机制 | 不迁移理由 |
|------|-----------|
| 语音环路 | LLM 无语音保持需求；scratchpad 已覆盖类似功能 |
| 经典条件反射 | 情绪性条件反射在 agent 场景无直接对应 |
| 启动效应（Priming） | 隐式启动在文本 agent 中难以控制和审计 |
| 睡眠依赖巩固的生理约束 | 工程上只需"离线巩固调度"，不需要模拟睡眠周期 |
| 海马体 CA3 区具体回路 | 过度生物细节，工程上用 PPR/图扩散即可 |

---

## 3. 按实施优先级排序

### P0（核心骨架，必须有）
1. 情景记忆不可变日志（#3）
2. 语义记忆版本化事实（#4）
3. 编码特异性条件键（#6）
4. 混合检索 + 模式补全（#7）
5. 冲突解析 + revoke（#12）

### P1（学习闭环）
6. 离线巩固管道（#9）
7. 经验抽象/反思（#9 + #5）
8. 使用驱动激活/衰减（#13 + #16）

### P2（高级能力）
9. 程序性 skill 积累（#5）
10. 提取练习自监控（#10）
11. 图谱多跳检索（#7 完整版）
12. 重建性适配（#11）

---

*本矩阵基于三份研究报告交叉提炼，所有判断附有来源报告编号。*
