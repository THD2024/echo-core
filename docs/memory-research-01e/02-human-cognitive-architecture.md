# 人类认知架构与计算认知架构：面向 AI Agent 长期记忆的学术基础

> 文档编号：memory-research-01e / 02  
> 生成时间：2026-10-31  
> 数据来源：CrossRef、PubMed、arXiv API 在线检索（真实论文元数据）  
> 标注约定：
> - 【事实】有同行评审论文或高共识实证支持
> - 【理论】学术界主流观点但存在实质性争议
> - 【类比】工程上方便、常被引用，但生物学/认知学对应不严格

---

## 目录

1. [Part A：人类记忆机制](#part-a人类记忆机制)
   - 1.1 记忆分类系统
   - 1.2 记忆过程（编码/巩固/提取/重建/遗忘）
   - 1.3 海马体与模式补全
   - 1.4 科学证据 vs 理论争议 vs 工程类比
   - 1.5 人类记忆机制总结表
2. [Part B：计算认知架构](#part-b计算认知架构)
   - 2.1 ACT-R
   - 2.2 SOAR
   - 2.3 其他架构（GWT / CLARION / LIDA）
   - 2.4 迁移评估
3. [Part C：2024–2026 最新进展](#part-c20242026-最新进展)
   - 3.1 OS 式记忆管理（MemGPT / Letta）
   - 3.2 海马体启发检索（HippoRAG 系）
   - 3.3 生产级记忆系统（Mem0 / Zep / Memobase 等）
   - 3.4 Agentic Memory 最新论文（A-MEM 等）
   - 3.5 评测基准（LongMemEval / MemoryAgentBench 等）
   - 3.6 综述
4. [机制迁移矩阵](#4-机制迁移矩阵)
5. [关键启示：真正"长期记忆"系统必须具备的核心能力](#5-关键启示真正长期记忆系统必须具备的核心能力)
6. [参考文献总表](#6-参考文献总表)

---

# Part A：人类记忆机制

## 1.1 记忆分类系统

### 1.1.1 工作记忆（Baddeley 模型）

**【事实】** Baddeley & Hitch（1974）提出工作记忆多组件模型；Baddeley（2000）增设情景缓冲区（episodic buffer），形成当代主流四组件结构：

| 组件 | 功能 | 容量限制 | 持续时间 | 神经基础（近似） |
|------|------|----------|----------|------------------|
| 中央执行系统（Central Executive） | 注意控制、子系统协调、抑制 | 有限注意资源 | 毫秒–秒级 | 前额叶（尤其 DLPFC） |
| 语音环路（Phonological Loop） | 语音/言语信息保持与复述 | ~2 秒语音量（约 2–4 个无意义音节 / 7±2 字母串，Cowan 修订后更接近 **3–5 个组块**） | 秒级（无复述则衰减） | 左半球额下回–颞上回语言区 |
| 视空间画板（Visuospatial Sketchpad） | 视觉/空间信息保持 | 类似语音环路量级 | 秒级 | 右半球后部视空间网络 |
| 情景缓冲区（Episodic Buffer） | 多模态信息整合、与长时记忆绑定 | 约 **4 个组块**（Cowan 2001） | 秒级 | 广泛皮层-丘脑网络（假说） |

**关键论文：**

1. **Baddeley, A. (2012).** *Working Memory: Theories, Models, and Controversies.* Annual Review of Psychology, 63, 1–29.  
   DOI: [10.1146/annurev-psych-120710-100422](https://doi.org/10.1146/annurev-psych-120710-100422)  
   引用约 3200+（CrossRef）。综述性权威文本，明确承认模型仍有争议（"controversies" 标题本身即是声明）。

2. **Baddeley, A. (2000).** *The episodic buffer: a new component of working memory?* Trends in Cognitive Sciences, 4(11), 417–423.  
   DOI: [10.1016/S1364-6613(00)01538-2](https://doi.org/10.1016/S1364-6613(00)01538-2)  
   引用约 4900+。情景缓冲区的提出论文。

3. **Cowan, N. (2001).** *The magical number 4 in short-term memory: A reconsideration of mental storage capacity.* Behavioral and Brain Sciences, 24(1), 87–114.  
   DOI: [10.1017/S0140525X01003922](https://doi.org/10.1017/S0140525X01003922)  
   提出在控制复述与注意后，短时存储容量约为 **4 个组块**，修订 Miller（1956）的 7±2。

**标注说明：**
- 四组件结构：【事实】（强实证，临床与神经影像广泛支持）
- 情景缓冲区的具体机制与神经定位：【理论】（Baddeley 本人承认证据相对薄弱）
- "把 context window 类比为工作记忆"：【类比】（工程上常用，但 LLM 的 attention 机制与中央执行系统的抑制控制、刷新功能差异极大）

### 1.1.2 情景记忆与语义记忆（Tulving 分类）

**【事实】** Tulving 将长时陈述性记忆区分为：

| 子系统 | 功能 | 容量 | 持续时间 | 神经基础 |
|--------|------|------|----------|----------|
| 情景记忆（Episodic） | 对个人经历的"心理时间旅行"式再体验，带时空情境与自我感（autonoetic consciousness） | 理论上无限；受检索线索制约 | 可终生 | 内侧颞叶（尤其海马）→ 新皮层；默认模式网络参与提取 |
| 语义记忆（Semantic） | 对世界的一般知识、事实、概念，与具体学习情境解绑 | 理论上无限 | 可终生 | 颞叶前部与分布式新皮层；MTL 在获得初期必要，稳定后部分独立 |

**关键论文：**

1. **Tulving, E. (1972).** *Episodic and semantic memory.* In E. Tulving & W. Donaldson (Eds.), *Organization of Memory*, Academic Press, 381–403.  
   （经典原典；无 DOI，被引用数万次）

2. **Tulving, E. (1986).** *What kind of a hypothesis is the distinction between episodic and semantic memory?* Journal of Experimental Psychology: Learning, Memory, and Cognition, 12(2), 307–320.  
   DOI: [10.1037/0278-7393.12.2.307](https://doi.org/10.1037/0278-7393.12.2.307)  
   Tulving 本人后期将该区分重新表述为**假设而非既定事实**。

3. **Squire, L. R. (1992).** *Declarative and Nondeclarative Memory: Multiple Brain Systems Supporting Learning and Memory.* Journal of Cognitive Neuroscience, 4(3), 232–243.  
   DOI: [10.1162/jocn.1992.4.3.232](https://doi.org/10.1162/jocn.1992.4.3.232)  
   奠基性的"陈述性 vs 非陈述性"系统划分。

**标注说明：**
- 情景/语义的行为学区分：【事实】（大量分离性证据，如顺行性遗忘患者不能形成新情景但可学习新语义）
- 情景记忆必须伴随"心理时间旅行"意识：【理论】（Tulving 假说；部分研究者认为动物也有类情景记忆）
- 直接把"对话日志"存成 episodic memory、把"用户画像"存成 semantic memory：【类比】（方向合理，但 LLM 记忆没有"再体验"，只是结构化重放）

### 1.1.3 程序性记忆（Procedural Memory）

**【事实】** 程序性记忆指技能与习惯的习得与表达（骑车、打字、规则运用），属非陈述性记忆家族的核心成员，主要依赖：

- **纹状体/基底节**（习惯形成、序列化行为）
- **小脑**（精细运动定时）
- **运动皮层**（动作执行）

**关键特征（工程相关）：**

| 维度 | 特征 |
|------|------|
| 获得 | 通过重复与强化学习，初期依赖注意/MTL，后期向基底节转移（"MTL→纹状体"系统转移，【理论】） |
| 表达 | 自动化、并行、难以用语言完全外显（"知道比说得更多"） |
| 容量 | 极大；与陈述性记忆系统的干扰模式不同 |
| 遗忘 | 极慢；技能一旦巩固非常稳定 |

**关键论文：**

1. **Squire, L. R. (1992).** 同上（Declarative/Nondeclarative 划分）。
2. **Knowlton, B. J., & Squire, L. R. (1993).** *The Learning of Categories: Parallel Brain Systems for Item Memory and Category Knowledge.* Science, 262(5140), 1747–1749.  
   DOI: [10.1126/science.8259522](https://doi.org/10.1126/science.8259522)  
   提供"项目记忆（海马）vs 类别知识（纹状体等）"的平行系统证据。

**标注说明：**
- 程序性与陈述性的双分离：【事实】（H.M. 等经典病例 + 动物模型 + 神经影像）
- 对 Agent 工程的对应："procedural memory ≈ 可执行 skill/tool 代码、固化 prompt 模板、macro-action"：【类比】（方向被大量系统采用，但 LLM 的"技能"多在参数或工具中，与基底节强化学习机制不同）

### 1.1.4 记忆系统总览（Squire 框架）

**【事实】** 当代标准分类（Squire 框架）：

```
长时记忆
├── 陈述性记忆（Declarative）
│   ├── 情景记忆（Episodic）
│   └── 语义记忆（Semantic）
└── 非陈述性记忆（Nondeclarative）
    ├── 程序性记忆（Procedural / skill）
    ├── 启动（Priming）
    ├── 经典条件反射（情绪性/运动性）
    └── 非联合学习（习惯化、敏感化）
```

工作记忆作为**工作台**与陈述性长时记忆交互（Baddeley 情景缓冲区 + Tulving 系统）。

---

## 1.2 记忆过程

### 1.2.1 编码（Encoding）

**【事实】** 影响编码质量的主要因素（均有大量同行评审证据）：

1. **注意与深度加工（Levels of Processing）**  
   语义深加工优于浅层物理加工（Craik & Lockhart, 1972 传统）。

2. **编码特异性原则（Encoding Specificity）**  
   提取线索与编码情境匹配时记忆最佳（Tulving & Thomson, 1973）。

3. **精细化与自我参照**  
   将新信息与已有知识/自我关联可显著提升后续提取。

4. **情绪唤醒**  
   中等至高唤醒可增强巩固（杏仁核-海马交互），但高压力/干扰下编码可受损。

5. **间隔与交错**  
   分散练习优于集中练习（spacing effect）。

**工程启示【类比】：** 记忆写入时应保留**丰富上下文与检索键**（何时、何地、何任务、为何重要），而不仅是压缩后的"结论"。这直接对应 LongMemEval 中 temporal reasoning 任务的失败模式。

### 1.2.2 巩固（Consolidation）

**【事实】** 巩固分为两层：

| 层级 | 时间尺度 | 机制 | 功能 |
|------|----------|------|------|
| 突触巩固（Synaptic consolidation） | 分钟–小时–天 | 长时程增强（LTP）、蛋白质合成、突触结构重塑 | 将脆弱的痕迹稳定为持久突触变化 |
| 系统巩固（Systems consolidation） | 天–年 | 海马重激活 → 与新皮层慢波睡眠/spindle 交互 → 皮层依赖逐步增强 | 将记忆逐步从海马依赖转为部分皮层依赖 |

**睡眠作用【事实+理论】：**
- 睡眠（尤其慢波睡眠与纺锤波）促进记忆巩固：大量实验支持【事实】
- 睡眠中海马"重播"（replay）帮助皮层整合：动物与人类证据强【事实】
- 具体计算角色（如"反转学习/去噪"假说）仍有争议【理论】

**关键论文：**

1. **Diekelmann, S., Wilhelm, I., & Born, J. (2009).** *The whats and whens of sleep-dependent memory consolidation.* Sleep Medicine Reviews, 13(5), 309–321.  
   DOI: [10.1016/j.smrv.2008.08.002](https://doi.org/10.1016/j.smrv.2008.08.002)

2. **McClelland, J. L., McNaughton, B. L., & O'Reilly, R. C. (1995).** *Why there are complementary learning systems in the hippocampus and neocortex: Insights from the successes and failures of connectionist models of learning and memory.* Psychological Review, 102(3), 419–457.  
   DOI: [10.1037/0033-295X.102.3.419](https://doi.org/10.1037/0033-295X.102.3.419)  
   引用 4200+。互补学习系统（CLS）理论的奠基论文：解释**为何**需要海马快速学习 + 新皮层慢速结构化学习，以及离线巩固/重播的必要性。

**工程启示【类比→可用】：**  
- "写入后需要独立于即时请求的**离线巩固过程**"（如夜间/空闲时的 reflection、合并、去重、图谱重建）是 CLS 的直接启发。  
- Generative Agents 的 reflection、MemDream 的 dream cycle、CraniMem 的 consolidation loop 都是这一思路的工程化。  
- 但：**工程上的"巩固"没有神经重播的生理约束**，只是优化调度，属【类比】；其有效性需单独用 agent benchmark 验证。

### 1.2.3 提取（Retrieval）

**【事实】** 关键效应：

1. **提取练习效应（Retrieval Practice / Testing Effect）**  
   主动回忆比重读显著改善长期保持，且效应可持续数日至数年。

2. **检索竞争（Retrieval Competition）**  
   语义相关的竞争项会干扰目标提取；抑制与竞争消解是记忆检索的固有部分。

3. **线索依赖（Cue-dependent retrieval）**  
   记忆痕迹"永久脆弱"假说（Tulving & Pearlstone）与情境匹配：改变提取情境可导致"情境依赖遗忘"。

4. **提取诱发遗忘（Retrieval-Induced Forgetting）**  
   提取部分项目会暂时抑制竞争项的可及性。

**关键论文：**

1. **Roediger, H. L., & Karpicke, J. D. (2006).** *Test-enhanced learning: Taking memory tests improves long-term retention.* Psychological Science, 17(3), 249–255.  
   DOI: [10.1111/j.1467-9280.2006.01693.x](https://doi.org/10.1111/j.1467-9280.2006.01693.x)  
   提取练习效应的现代经典实证。

2. **Collins, A. M., & Loftus, E. F. (1975).** *A spreading-activation theory of semantic processing.* Psychological Review, 82(6), 407–428.  
   DOI: [10.1037/0033-295X.82.6.407](https://doi.org/10.1037/0033-295X.82.6.407)  
   展布激活（spreading activation）的经典理论框架：概念在网络中激活沿关联边扩散；用于解释语义启动、关联检索与部分匹配。

**工程启示【类比→高价值】：**
- **提取练习** → 定期用真实/合成查询"考"记忆库（MemDream 的 self-probing 是直接实现），比只写入更能发现并修复记忆缺陷。
- **展布激活** → HippoRAG 用 Personalized PageRank 在知识图上做关联扩展，是 Collins-Loftus 思想的现代实现【类比但有效】。

### 1.2.4 重建（Reconstruction）

**【理论+事实】** 记忆是**重建性**的，而非录像回放：

1. **Bartlett 图式理论（1932）**  
   记忆提取受既有图式（schema）文化知识结构塑造；经典实验《The War of the Ghosts》显示意义化扭曲。

2. **错误记忆（False Memory）**  
   DRM 范式：语义关联但未呈现的"关键诱饵"被大量虚报。

3. **源监控错误（Source Monitoring）**  
   内部想象 vs 外部事件的来源混淆。

**关键论文：**

1. **Roediger, H. L., & McDermott, K. B. (1995).** *Creating false memories: Remembering words not presented in lists.* Journal of Experimental Psychology: Learning, Memory, and Cognition, 21(4), 803–814.  
   DOI: [10.1037/0278-7393.21.4.803](https://doi.org/10.1037/0278-7393.21.4.803)  
   DRM 错误记忆范式的奠基实证。

2. **Bartlett, F. C. (1932).** *Remembering: A Study in Experimental and Social Psychology.* Cambridge University Press.  
   （图式理论原典；无 DOI）

**工程启示：**
- 重建性是**特性而非缺陷**：从原始轨迹**重构**到当前任务有用的表示（而非原样回放）是正确的——MemHarness（2026）显式提出 "Memory Is Reconstructed, Not Replayed"。
- 但错误记忆/幻觉风险必须由**溯源（provenance）与可验证性**约束：任何重构必须能回指到不可变的原始证据。

### 1.2.5 遗忘（Forgetting）

**【理论争议中但有强实证】** 三大主流机制（并存而非互斥）：

| 机制 | 核心主张 | 证据状态 |
|------|----------|----------|
| 衰退（Decay） | 未使用的痕迹随时间自然衰退 | 间接证据；与干扰难以完全分离。【理论】争议较大 |
| 干扰（Interference） | 前摄/倒摄干扰导致提取失败 | 强实证。【事实】 |
| 主动抑制（Active inhibition） | 线索激活竞争项时存在主动压制 | 提取诱发遗忘等范式支持。【事实+理论】 |
| 检索失败（Retrieval failure） | 痕迹仍在但线索不足 | 与线索依赖、编码特异性一致。【事实】 |

**工程启示：**
- 对 Agent 记忆，**"过期/被更新事实"的问题比单纯衰退更接近干扰与主动抑制**（MemoryAgentBench 的 FactConsolidation / Conflict Resolution 分任务正是测这一点）。
- 工程上常用的 **last-write-wins** 只覆盖单键冲突的最简情形；对多跳、历史审计、可撤销记忆需要显式 revoke / 版本化（见 TEPA 等 2026 工作）。

---

## 1.3 海马体与模式补全

### 1.3.1 Pattern Separation vs Pattern Completion

**【事实】** 海马（尤其 DG-CA3）计算的核心分工：

| 过程 | 功能 | 主要区 | 工程对应 |
|------|------|--------|----------|
| **模式分离（Pattern Separation）** | 将相似输入映射为正交/去重表征，防止干扰 | 颗粒下回（SG）/ DG → CA3 | 实体消歧、去重、精确 key 写入、embedding 正交化 |
| **模式补全（Pattern Completion）** | 从部分/噪声线索恢复完整记忆 | CA3 回返连接 | 部分查询召回完整事实、联想检索、PPR 图扩散 |

**关键论文：**

1. **Yassa, M. A., & Stark, C. E. L. (2011).** *Pattern separation in the hippocampus.* Trends in Neurosciences, 34(10), 515–525.  
   DOI: [10.1016/j.tins.2011.06.006](https://doi.org/10.1016/j.tins.2011.06.006)

2. **Norman, K. A., & O'Reilly, R. C. (2003).** *Modeling hippocampal and neocortical contributions to recognition memory: A complementary-learning-systems approach.* Psychological Review, 110(4), 611–646.  
   DOI: [10.1037/0033-295X.110.4.611](https://doi.org/10.1037/0033-295X.110.4.611)  
   引用 1000+。将 CLS 与熟悉度/回忆双过程计算模型结合。

3. **O'Reilly, R. C., & Rudy, J. W. (2001).** *Conjunctive representations in learning and memory: Principles of cortical and hippocampal function.* Psychological Review, 108(2), 311–345.  
   DOI: [10.1037/0033-295X.108.2.311](https://doi.org/10.1037/0033-295X.108.2.311)  
   " conjunctive binding "（绑定 what-where-when 等特征为整体事件）的计算原则。

4. **McClelland, McNaughton, & O'Reilly (1995).** 同上。CLS 理论原典。

### 1.3.2 线索依赖提取与关联记忆

**【事实】** 提取高度依赖编码时形成的线索网络。展布激活（Collins & Loftus 1975）描述了语义网络中激活扩散；现代图检索（PPR、个性化 PageRank）在工程上近似此机制。

**工程映射【类比→已被验证有效】：**

| 海马机制 | 工程实现 | 代表系统 |
|----------|----------|----------|
| 索引理论（hippocampal indexing） | 知识图/倒排索引 | HippoRAG（2024, NeurIPS） |
| 模式补全 | PPR 多跳关联扩展 | HippoRAG 的 Personalized PageRank |
| 模式分离 | 实体消歧、高精度 embedding、canonical key | ActionRAG 的 tiered entity resolution |
| what-where-when 绑定 | 带时间戳的情景元组 | ScrubJay-MEM 的 What–Where–When tuple；Zep/Graphiti 时序图 |

### 1.3.3 补充学习系统（CLS）：为何需要双系统

**【理论→主流】** McClelland et al.（1995）核心论证：

1. 新皮层式渐进学习在**统计上高效**但会**灾难性干扰**已有知识；
2. 海马式快速学习可**近乎无干扰**地编码单次事件，代价是容量与泛化有限；
3. 二者通过**离线重播/巩固**耦合：海马先存，皮层后慢整合为结构化知识。

这是当前"短期/工作记忆 + 长期结构化记忆 + 后台 consolidation" agent 架构最常引用的认知科学依据。

---

## 1.4 科学证据 vs 理论争议 vs 工程类比

| 主张 | 标注 | 说明 |
|------|------|------|
| 工作记忆有有限容量（约 4 个组块 / ~2s 语音） | 【事实】 | 行为与神经证据一致 |
| Baddeley 四组件的完整神经定位 | 【理论】 | 行为学强，神经细节争议 |
| 陈述性（情景+语义）与非陈述性（程序等）双分离 | 【事实】 | 临床/动物/影像多重证据 |
| 情景记忆的"心理时间旅行"本质 | 【理论】 | Tulving 假说；跨物争议 |
| 提取练习改善长期保持 | 【事实】 | 大量重复验证 |
| 记忆是重建而非回放 | 【事实】 | Bartlett 传统 + DRM 等 |
| 衰退 vs 干扰的相对贡献 | 【理论】 | 长期争议；不同记忆类型权重不同 |
| 睡眠巩固促进记忆 | 【事实】 | 总体效应稳健 |
| 睡眠巩固的精确算法级机制 | 【理论】 | 多假说竞争 |
| CA3 pattern completion / DG separation 分工 | 【事实】 | 计算模型+动物记录支持 |
| CLS 双系统必要性 | 【理论→主流】 | 广泛接受，但实现细节有变体 |
| "context window = 工作记忆" | 【类比】 | 有用但不严格 |
| "向量库 = 海马索引" | 【类比】 | 部分对应（索引/补全），无 separation 生理等价 |
| "last-write-wins = 主动抑制/更新" | 【类比】 | 远弱于生物抑制；缺版本与审计 |
| "reflection/summaries = 巩固" | 【类比】 | 启发合理，需 benchmark 证明 |
| ACT-R 激活方程精确预测人类 RT | 【事实】（在受限任务域） | 量化认知架构的强项；外推到开放 agent 需谨慎 |

---

## 1.5 人类记忆机制总结表

| 机制 | 功能 | 证据强度 | 工程可迁移性 | 参考文献 |
|------|------|----------|--------------|----------|
| 工作记忆容量限制 | 有界注意工作台 | 高【事实】 | 高：context 预算、attention 门控 | Baddeley 2012; Cowan 2001 |
| 情景缓冲区 | 多源绑定 | 中【理论】 | 中：统一 episodic packet | Baddeley 2000 |
| 情景记忆 | 个人事件再体验 | 高【事实】（分离）；意识属性中等【理论】 | 高：带时间戳的对话/轨迹存储 | Tulving 1972/1986; Squire 1992 |
| 语义记忆 | 一般知识 | 高【事实】 | 高：实体-关系图、用户画像 | Tulving 1972; Squire 1992 |
| 程序性记忆 | 技能/习惯 | 高【事实】 | 高：skill library、可执行 macro | Squire 1992; Knowlton & Squire 1993 |
| 编码特异性 | 线索-编码匹配 | 高【事实】 | 高：写入时丰富上下文键 | Tulving 传统 |
| 提取练习 | 使用增强记忆 | 高【事实】 | 高：self-probing / 周期性 QA | Roediger & Karpicke 2006 |
| 展布激活 | 关联扩散检索 | 中高【理论→可用】 | 高：图上 PPR/多跳 | Collins & Loftus 1975 |
| 重建性提取 | 按当前目标重构 | 高【事实】 | 中高：检索后适配，需溯源 | Bartlett 1932; Roediger & McDermott 1995 |
| 干扰/竞争/抑制 | 解决记忆冲突 | 高【事实】 | 高：冲突解析、revoke、版本 | Anderson 抑制研究传统；现代 MAB |
| 突触/系统巩固 | 离线稳定与整合 | 高（睡眠效应）；算法细节中 | 高：离线 consolidation 管道 | McClelland et al. 1995; Diekelmann et al. 2009 |
| 模式分离 | 去重防干扰 | 高【事实】 | 高：实体消歧、canonical key | Yassa & Stark 2011 |
| 模式补全 | 部分线索恢复 | 高【事实】 | 高：联想/多跳检索 | Norman & O'Reilly 2003 |
| 线索依赖提取 | 环境绑定 | 高【事实】 | 高：session/topic 元数据 | Tulving & Thomson 传统 |
| 主动遗忘/抑制 | 清除过时痕迹 | 中高【理论】 | 中高：受控 forget/revoke | 提取诱发遗忘文献；TEPA 等工程延伸 |

---

# Part B：计算认知架构

## 2.1 ACT-R（Adaptive Control of Thought—Rational）

### 2.1.1 核心机制

**【事实】** ACT-R 是 Anderson 与同事发展的产生式认知架构，将认知分解为**陈述性记忆模块**与**程序性（产生式）模块**，以贝叶斯/效用学习统一。与记忆最相关的是**激活（activation）理论**。

### 2.1.2 数学公式

**陈述性单元的激活（activation of a chunk）：**

\[
A_i = B_i + \sum_j W_j S_{ji} + \varepsilon
\]

- \(B_i\)：**基线水平（base-level）**，由历史使用次数与间隔决定：
  \[
  B_i = \ln \sum_{j=1}^{n} t_j^{-d}
  \]
  其中 \(t_j\) 为第 \(j\) 次使用后经过的时间，\(d\approx 0.5\) 为衰减常数。  
  → **使用越多、越近，基线越高；久不用则衰减。**
- \(S_{ji}\)：源 \(j\) 到条目 \(i\) 的**展布激活**权重（语义/情境关联）。
- \(W_j\)：当前活跃线索 \(j\) 的权重。
- \(\varepsilon\)：噪声（通常为逻辑斯蒂/正态极值噪声）。

**检索概率（probability of retrieval）：**

\[
P(\text{retrieval}_i) = \frac{1}{1+e^{-(A_i - T)/s}}
\]

- \(T\)：**检索阈值（retrieval threshold）**
- \(s\)：噪声参数 \(s\)

**部分匹配（partial matching）：** 允许在精确匹配失败时按相似度/结构匹配降低效用但仍可用，支持"模糊回忆"。

**遗忘：** 在基础模型中表现为 \(B_i\) 随时间的幂律衰减；也可建模为检索失败当 \(A_i < T\)。

### 2.1.3 关键论文

1. **Anderson, J. R., & Lebiere, C. (1998).** *The Newell Test / Atomic Components of Thought.* MIT Press.  
   （ACT-R 5 时代权威专著；与 BBS 上的 Newell Test 理论文章配套：Anderson & Lebiere, 2003, *The Newell Test for a theory of cognition*, Behavioral and Brain Sciences — DOI: [10.1017/S0140525X0300013X](https://doi.org/10.1017/S0140525X0300013X)）

2. **Anderson, J. R., Bothell, D., Byrne, M. D., Douglass, S., Lebiere, C., & Qin, Y. (2004).** *An Integrated Theory of the Mind.* Psychological Review, 111(4), 1036–1060.  
   DOI: [10.1037/0033-295X.111.4.1036](https://doi.org/10.1037/0033-295X.111.4.1036)  
   引用 1900+。现代 ACT-R 整合理论。

### 2.1.4 优缺点

| 优点 | 缺点 |
|------|------|
| 激活方程可**定量预测**人类 RT 与错误率 | 参数拟合需要大量人类数据 |
| 激活-阈值-噪声框架天然支持**部分记忆、软失败** | 对开放世界、高维语义关联表达力弱 |
| 基线衰减给出**使用驱动的记忆价值**形式化 | 与现代神经科学的离线巩固耦合较弱 |
| 产生式 + 效用学习可形成**技能记忆** | 实现复杂，现代 LLM 栈中直接落地少 |

### 2.1.5 迁移建议（ACT-R）

| 机制 | 迁移建议 | 理由 |
|------|----------|------|
| 激活 = 基线 + 展布 + 噪声 | **适合迁移** | 可直接作为记忆条目 score 公式：use count / recency / association / noise |
| 基线幂律衰减 | **适合（需改造）** | 改为**按类型的 perishability**（见 ScrubJay-MEM），对事实 vs 偏好用不同 \(d\) |
| 检索阈值 | **适合** | 低于阈值→abstain / 继续搜索，而非强行生成 |
| 部分匹配 | **需要改造** | 用结构化字段相似度 + 图扩展替代符号相似 |
| 产生式程序记忆 | **适合** | 对应 skill/macro 库 + 效用（成功率）更新 |

---

## 2.2 SOAR

### 2.2.1 核心机制

**【事实】** SOAR（Newell, Laird, Rosenbloom 谱系）以**决策循环 + 产生式规则 + chunking**为核心：

1. **Impasse-driven learning**：当现有规则无法在当前状态中做出满意决策时产生 impasse，通过子目标求解；求解结论被 **chunking** 固化为新产生式规则（程序性学习）。
2. **多记忆系统**：工作记忆（WM）作为当前情境总线；长时记忆包含语义/情景能力。
3. **情景记忆模块（Nuxoll & Laird）**：为 SOAR agent 增加基于过去具体情境的**情景回忆**，支持未来计划中的"过去类似情境发生了什么"。

### 2.2.2 关键论文

1. **Laird, J. E. (2012).** *The Soar Cognitive Architecture.* MIT Press.  
   （系统专著；含 episodic memory 章节 DOI: [10.7551/mitpress/7688.003.0011](https://doi.org/10.7551/mitpress/7688.003.0011)）

2. **Nuxoll, A. M., & Laird, J. E. (2012).** *Enhancing intelligent agents with episodic memory.* Cognitive Systems Research, 17, 34–48.  
   DOI: [10.1016/j.cogsys.2011.10.002](https://doi.org/10.1016/j.cogsys.2011.10.002)

3. **Laird, J. E., Lebiere, C., & Rosenbloom, P. S. (2017).** *A Standard Model of the Mind: Toward a Common Computational Framework across Artificial Intelligence, Cognitive Science, Neuroscience, and Robotics.* AAAI Spring Symposium.  
   （SOAR/ACT-R 等向"标准模型"整合的纲领性文献）

4. Newell, Rosenbloom, & Laird 的早期符号架构立场：*Symbolic Architectures for Cognition*（1989，Foundations of Cognitive Science 章节，DOI: [10.7551/mitpress/3072.003.0005](https://doi.org/10.7551/mitpress/3072.003.0005)）

### 2.2.3 优缺点

| 优点 | 缺点 |
|------|------|
| chunking 给出**可执行技能自动结晶**的清晰机制 | 规则系统符号性强，与分布表示融合难 |
| impasse-driven：**失败驱动学习**，与 agent 探索天然契合 | impasse 检测在 LLM agent 中需显式工程化 |
| episodic 模块区分"具体事件"与"一般化规则" | 现代大规模开放任务中可扩展性压力大 |
| 决策周期统一感知-行动 | 计算/知识工程成本高 |

### 2.2.4 迁移建议（SOAR）

| 机制 | 迁移建议 | 理由 |
|------|----------|------|
| Chunking（成功路径结晶） | **适合** | 将反复成功的 tool-use 序列固化为 skill/macro |
| Impasse-driven learning | **适合** | 失败/卡住触发记忆检索、反思、学习，而非仅当错误处理 |
| Episodic vs semantic 在 Soar 中的分离 | **适合** | 情景库（原始事件）与规则/语义库分层 |
| 全符号产生式 WM | **需要改造** | WM 用自然语言/结构化 state 替代，不必全符号 |

---

## 2.3 其他值得参考的架构

### 2.3.1 Global Workspace Theory（Baars / GWT + LIDA）

**【理论】** Baars 的全局工作空间：大量专门处理器并行运行；仅当信息进入**全局广播工作空间**（类似"意识"）时被全系统可见并写入长时记忆。

**记忆相关机制：**
- 注意门控决定何者入工作空间
- LIDA（Franklin 等）进一步给出"感知→注意→工作空间→行动"的完整 agent 周期，并含**情节记忆码**与**巩固**模块

**关键论文：**
1. **Baars, B. J., & Franklin, S. (2003).** *How conscious experience and working memory interact.* Trends in Cognitive Sciences, 7(4), 166–172.  
   DOI: [10.1016/S1364-6613(03)00056-1](https://doi.org/10.1016/S1364-6613(03)00056-1)
2. **Baars, B. J., & Franklin, S. (2007).** *An architectural model of conscious and unconscious brain functions: Global Workspace Theory and IDA.* Neural Networks, 20(9), 955–961.  
   DOI: [10.1016/j.neunet.2007.09.013](https://doi.org/10.1016/j.neunet.2007.09.013)

**迁移：** 注意瓶颈与"只有进入 workspace 的内容才被编码"对 **写入门控（what gets stored）** 有直接启发【适合迁移】；GWT 的意识语义本身对 agent 无工程必要【类比】。

### 2.3.2 CLARION

**【理论】** Sun 等的双环架构：**显式（顶层，规则/命题）** 与 **隐式（底层，联结主义/隐性）** 知识与学习互动；强调隐性知识积累与显式化（recognition / rule formation）。

**记忆相关：** 隐式记忆作为大量"感知-行动"先验；显式记忆承载可语言化规则与解释。

**迁移：** "能用但说不清"的隐式技能库 vs "可审计"的显式事实库——对应 LLM 参数化能力 vs 外置记忆【适合思想迁移，实现需用结构化隐式表征如 embedding + 规则摘要】。

### 2.3.3 LIDA

**【理论】** Franklin 等的认知架构，GWT 的工程化后继：强调**行动选择、注意、情节记忆码（episode code）、巩固** 的统一周期，用于机器人与认知机器人研究。

**迁移：** 与 SOAR/GWT 类似，提供**周期性记忆管理**的模块划分参考；直接代码级迁移价值低于其流程思想。

---

## 2.4 迁移评估（跨架构综合）

| 架构 | 记忆相关机制 | 迁移到 Agent Memory | 关键理由 |
|------|--------------|---------------------|----------|
| ACT-R | 激活=基线+展布+噪声；阈值检索；部分匹配；产生式效用 | **大部分适合** | 给出**打分公式与软失败**的现成形式；需把"使用历史"接到真实轨迹，把"展布"接到图 |
| SOAR | chunking；impasse-driven；episodic 模块 | **适合** | 失败驱动学习与技能结晶对 coding/research agent 极有价值 |
| GWT/LIDA | 注意门控；全局广播；情节码；巩固周期 | **部分适合** | 写入门控与周期巩固可借鉴；全意识架构过重 |
| CLARION | 显式/隐式双记忆 | **适合思想** | 匹配"参数化技能 vs 外置可审计记忆"分层 |
| CLS（神经计算） | 海马快学+皮层慢整合 | **高度适合（作为原则）** | 已被 HippoRAG 等验证；指导分层与离线整合 |
| 展布激活/图索引 | 关联扩散 | **高度适合** | HippoRAG/Zep 已工程化并基准验证 |

---

# Part C：2024–2026 最新进展

> 以下条目均来自 arXiv/CrossRef 在线检索的**真实论文元数据**。会议/期刊信息以 arXiv comment 或已索引 venue 为准；部分为 preprint（已在文中注明）。

## 3.1 OS 式记忆管理：MemGPT / Letta

### MemGPT: Towards LLMs as Operating Systems

| 字段 | 内容 |
|------|------|
| 作者 | Charles Packer, Sarah Wooders, Kevin Lin, Vivian Fang, Shishir G. Patil, Ion Stoica, Joseph E. Gonzalez |
| 年份 | 2023（v2 更新 2024） |
| 来源 | arXiv preprint（UC Berkeley 等） |
| URL | https://arxiv.org/abs/2310.08560 |
| 核心贡献 | **虚拟上下文管理**：把 LLM 上下文窗口类比为 OS 内存层次（主存=上下文，外存=外部存储），通过自编辑与中断在分层记忆间搬运数据；提出 MemGPT 系统并在长文档分析与多会话对话上评估 |
| 局限 | 依赖 LLM 自管理的提示工程；延迟与 token 成本高；在后续评测中被 Zep 等在 DMR/LongMemEval 上追赶或超越；"OS 类比"本身是【类比】而非生物学忠实 |
| 工程地位 | 生产系统 **Letta** 的前身与思想来源；成为后续大量 agent memory 工作的 baseline |

**相邻：Zep — Zep: A Temporal Knowledge Graph Architecture for Agent Memory**  
Rasmussen, Paliychuk, Beauvais, Ryan, Chalef (2025). arXiv:2501.13956.  
核心：Graphiti 时序知识图引擎；报告 DMR 94.8% vs MemGPT 93.4%；LongMemEval 等企业向任务上延迟大幅降低。局限：与厂商系统绑定的评测、非完全独立复现。

---

## 3.2 海马体启发检索：HippoRAG

### HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models

| 字段 | 内容 |
|------|------|
| 作者 | Bernal Jiménez Gutiérrez, Yiheng Shu, Yu Gu, Michihiro Yasunaga, Yu Su（OSU NLP） |
| 年份 | 2024 |
| 会议 | **NeurIPS 2024** |
| URL | https://arxiv.org/abs/2405.14831 |
| 核心贡献 | 以**海马索引理论**为灵感：新皮层≈LLM 参数 + 知识，海马≈知识图 + **Personalized PageRank** 的关联检索；多跳 QA 上相对 SOTA 提升最高约 20%；单步检索可匹敌甚至超过迭代式 IRCoT，且便宜 10–30 倍 |
| 局限 | 依赖开放信息抽取与 KG 质量；对话式、时效冲突、用户偏好类记忆非其主战场；"神经启发"到机制级对应仍是【类比】+ 部分工程验证 |

### HippoRAG 2: From RAG to Memory: Non-Parametric Continual Learning for LLMs

| 字段 | 内容 |
|------|------|
| 作者 | Jiménez Gutiérrez, Shu, Qi, Zhou, Su |
| 年份 | 2025 |
| 会议 | **ICML 2025** |
| URL | https://arxiv.org/abs/2502.14802 |
| 核心贡献 | 修复 HippoRAG 在**基础事实记忆**上相对朴素 RAG 的退化；更深的段落整合 + 更有效的在线 LLM 使用；在关联记忆任务上比 SOTA embedding 模型再 +7% |
| 局限 | 图构建成本；对话冲突与知识更新仍非完整解决 |

**启示：** HippoRAG 系是**目前少有的、把"海马机制"落实为可检索实现并在标准 QA 上强基准验证**的工作；对 EchoCore 类系统，PPR/关联扩展 + 保留朴素稠密检索双通道是直接可抄的设计。

---

## 3.3 生产级记忆系统：Mem0 / Zep / Memobase 等

### Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory

| 字段 | 内容 |
|------|------|
| 作者 | Prateek Chhikara, Dev Khant, Saket Aryan, Taranjeet Singh, Deshraj Yadav |
| 年份 | 2025 |
| 来源 | arXiv preprint（Mem0 公司） |
| URL | https://arxiv.org/abs/2504.19413 |
| 核心贡献 | 对话流中**动态抽取-整合-检索**显著事实；在 **LOCOMO** 上对比六类 baseline；相对 OpenAI 记忆方案 LLM-as-a-Judge 相对提升约 26%；**p95 延迟降低约 91%、token 成本节省 >90%** vs full-context；另提供图记忆变体 |
| 局限 | 抽取器与整合启发式的错误会**固化**；冲突更新、多跳与时间推理仍是薄弱点；论文为系统报告而非独立第三方审计 |

### 其他生产系统（工程地位）

| 系统 | 要点 | 备注 |
|------|------|------|
| **Letta**（MemGPT 商业化） | 分层记忆 + 自管理 | 见 3.1 |
| **Zep / Graphiti** | 时序 KG | 见 3.1 |
| **Memobase** | 用户档案式长期记忆，面向个性化 | 开源/产品；本报告检索窗口内未抓到独立学术主论文，建议引用其官方文档与下游评测时标注为**工程系统**而非 peer-reviewed |
| **memorywire**（协议层） | remember/recall/forget/merge/expire 五操作 + 四类记忆类型（semantic/episodic/procedural/emotional）跨框架 wire format | Munirathinam, 2026, arXiv:2606.01138；说明行业正走向**操作原语标准化** |

---

## 3.4 Agentic Memory 最新论文

### A-MEM: Agentic Memory for LLM Agents

| 字段 | 内容 |
|------|------|
| 作者 | Wujiang Xu, Zujie Liang, Kai Mei, Hang Gao, Juntao Tan, Yongfeng Zhang |
| 年份 | 2025 |
| 会议 | **NeurIPS 2025** |
| URL | https://arxiv.org/abs/2502.12110 |
| 核心贡献 | 受 **Zettelkasten** 卡片盒启发：新记忆生成结构化 note（上下文、关键词、标签），**动态连边**；新记忆可触发对旧记忆表示的**回溯更新**（memory evolution）；在 6 个基础模型上相对 SOTA baseline 提升 |
| 局限 | 写入路径随记忆数增长（后续工作如 D-MEM 批评其 O(N²) 写延迟与 token 成本）；链接质量依赖 LLM 判断 |

### 相关后续（节选）

| 论文 | 年份 | 要点 |
|------|------|------|
| **MemHarness: Memory Is Reconstructed, Not Replayed** (arXiv:2607.28272) | 2026 | 强调检索到的经验必须按当前状态**重构**，否则负迁移；ALFWorld/WebShop 上优于静态记忆回放 |
| **D-MEM** (arXiv:2603.14597) | 2026 | 以 RPE/"多巴胺门控"分离快慢路径，低惊奇旁路、高惊奇触发图演化；LoCoMo-Noise |
| **Jev-Mem** (arXiv:2609.23986) | 2026 | System1/System2 分工：轻量控制面管记忆，System2 仅复杂推理 |
| **ScrubJay-MEM** (arXiv:2608.04746) | 2026 | 西丛鸦情景记忆启发：What–Where–When + **按类型条件的易腐系数** π_i 与效用半衰 τ_i |
| **MINDSET** (arXiv:2610.08586) | 2026 | 不可变 episode + 版本化 schema 的最小能量状态转移；滞后防单次矛盾冲垮稳定记忆 |
| **TEPA** (arXiv:2608.07429) | 2026 | **可撤销**证据记忆：valid 为显式状态；反转变更下 last-write-wins 崩溃而 revoke 保持 |
| **MemDream** (arXiv:2609.34545) | 2026 | 离线 dream cycle 自探测-诊断-修复记忆图；GRPO 学修复策略；LoCoMo F1 +4.5，MAB +9.1 |
| **Hippocam / Use and Disuse** (arXiv:2610.12124) | 2026 | 嵌套 intent 的递归前缀巩固；用过的记忆再整合强化，未用的日益抽象 |
| **Raw-RAG 挑战** (arXiv:2610.30755) | 2026 | **朴素稠密 RAG over 原始历史**在 7 个 benchmark-model 设定中 6 个排第一；提示复杂 agentic memory 的必要性被高估；**必须报告 naive RAG baseline** |
| **Experience-following** (arXiv:2505.16067) | 2025 | Agent 表现出"经验跟随"：检索高相似记忆导致输出强相似；错误传播与 misaligned replay 是真实风险 |

---

## 3.5 评测基准

### LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory

| 字段 | 内容 |
|------|------|
| 作者 | Di Wu, Hongwei Wang, Wenhao Yu, Yuwei Zhang, Kai-Wei Chang, Dong Yu |
| 年份 | 2024 |
| 会议 | **ICLR 2025** |
| URL | https://arxiv.org/abs/2410.10813 |
| 核心贡献 | 五种核心能力：**信息抽取、多会话推理、时间推理、知识更新、弃答（abstention）**；500 题嵌入可扩展会话历史；商业助手与长上下文 LLM 在持续交互上准确率**下降约 30%**；提出 indexing–retrieval–reading 统一框架与若干设计优化 |
| 局限 | 主要面向 chat assistant；对工具使用/多步任务 agent 覆盖有限 |

### MemoryAgentBench: Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions

| 字段 | 内容 |
|------|------|
| 作者 | Yuanzhe Hu*, Yu Wang*, Julian McAuley（*同等贡献） |
| 年份 | 2025 |
| 来源 | arXiv preprint（https://arxiv.org/abs/2507.05257） |
| 核心贡献 | 基于记忆/认知科学识别记忆 agent **四大能力**：**准确检索、测试时学习（test-time learning）、长程理解、选择性遗忘**；将长上下文数据集改造为**增量多轮**形式；覆盖 Context / RAG / 外部记忆模块 / 工具集成等多类 agent；实验显示尚无方法全面掌握四能力 |
| 局限 | 后续分析（如 arXiv:2610.09193）指出 Conflict Resolution 分任务中部分 gold 在 last-write 规则下**不可达**——解读总分时需谨慎，应做 per-item 分析 |

### LOCOMO（常用配套）

被 Mem0、Zep、LongMemEval 相关工作等广泛使用；长对话记忆的社区事实标准之一（本报告未单独抓取原 LOCOMO 主论文元数据时，请引用各使用论文中的数据集节）。

### 2026 观察（评测生态）

- **Naive RAG 必须作为 baseline**（arXiv:2610.30755）
- 检索正确 ≠ 答案正确：**过时竞争证据**在同等 token 下比无关证据更有害（arXiv:2610.36308）
- MemoryAgentBench 上 post-retrieval assembly（证据抽取与策略执行分离）可大幅提升（arXiv:2606.01435）
- 流式插入与检索交织时，性能随记忆增长**退化**；时间类问题最难（Neuromem, arXiv:2602.13967）

---

## 3.6 综述（2024–2026）

| 综述 | 作者/年份/venue | 贡献 |
|------|-----------------|------|
| **A Survey on the Memory Mechanism of Large Language Model based Agents** | Zhang et al., 2024, arXiv:2404.13501 | 早期系统综述：what/why/how 设计与评估 |
| **From Storage to Experience: A Survey on the Evolution of LLM Agent Memory Mechanisms** | Luo et al., ACL 2026 Findings, arXiv:2605.06716 | **Storage → Reflection → Experience** 三阶段演化框架 |
| **A Survey of Agent Memory in the Second Half** | Huang et al., **TMLR (Survey Certification)**, 2026, arXiv:2602.06052 | 三维：substrate / cognitive mechanism（sensory, working, episodic, semantic, procedural）/ subject；强调记忆成为 self-evolution 基质 |
| **From Long Context to Selective Memory** | Gou, 2026, arXiv:2610.21165 | 将长上下文压缩重构为**内存管理**问题：compute-active vs inactive；写/卸载/召回/物化/驱逐/巩固/遗忘的状态转移与预算成本模型 |
| **A Survey on Long-Term Memory Security in LLM Agents** | Lin et al., EMNLP 2026, arXiv:2604.16548 | 六生命周期阶段 × 四安全目标；Verifiable Memory Governance |

---

## 4 机制迁移矩阵

| 生物/认知机制 | 计算实现思路 | 适合 Agent Memory? | 改造要点 | 风险 |
|---------------|--------------|-------------------|----------|------|
| 工作记忆有界容量 | 每步注入的记忆/上下文预算、attention 门控 | 适合 | 预算随任务类型自适应（MemCon 等） | 预算过紧丢关键证据；过松退化为 full-context |
| 语音环路 / 内部独白 | agent 的 scratchpad / 自言自语推理 | 部分适合 | 需可丢弃，不应写入长期库 | 把中间草稿误存为事实 |
| 情景缓冲区 | 统一 episodic packet（事件+实体+时间+工具输出指针） | 适合 | 绑定完整 provenance | 包过重，检索成本高 |
| 情景记忆 | 不可变事件日志 + 时间戳 | 适合 | 永不静默改写；允许 supersede 指针 | 隐私与保留策略 |
| 语义记忆 | 实体-关系图 / 用户档案 | 适合 | 与情景分离；支持版本 | 抽取错误固化 |
| 程序性记忆 | skill/macro 库、成功路径 chunk | 适合 | 以任务成功率为 utility 更新 | 错误技能传播（experience-following） |
| 编码特异性 | 写入时丰富条件键（任务、用户、环境、时间） | 适合 | 避免过早压缩丢键 | 元数据爆炸 |
| 展布激活 / 索引补全 | KG + PPR / 多跳扩展 | 适合（已验证） | 与稠密检索混合 | 噪声边扩散 |
| 模式分离 | 实体消歧、canonical key、正交化 | 适合 | 检测"相似非相同" | 过分离导致无法关联 |
| 突触/系统巩固 | 离线 reflection、合并、图重构、抽象层级化 | 适合 | schedule + 效用门控 | 巩固错误不可逆；需可审计 |
| 提取练习 | 自探测 QA、周期性 probe | 适合 | 与真实流量分布一致的 probe | 探测成本；分布偏移 |
| 重建性提取 | 检索后按当前状态改写/适配 | 适合 | 必须可回链原始证据 | 幻觉性重构 |
| 干扰抑制 / 主动遗忘 | 冲突解析、revoke、选择性遗忘 | 适合 | last-write 不够；要版本+审计 | 误删有用历史 |
| 衰退 | 按类型 perishability 的 soft decay | 部分适合 | 事实 vs 稀有偏好策略不同 | 真重要低频知识被衰减 |
| 注意门控（GWT） | 只有"显著/目标相关"内容入长期库 | 适合 | surprise/utility 评分 | 门控器成为单点瓶颈 |
| Impasse 驱动学习（SOAR） | 失败触发检索/反思/技能固化 | 适合 | 需可靠失败检测 | 频繁假阳性 impasse |
| 基线激活方程（ACT-R） | score = log Σ t^{-d} + spreading + noise | 适合（作为 scoring core） | d 按类型；spreading 用图 | 参数敏感 |
| 检索阈值 + 弃答 | score < T → 拒答或继续搜索 | 适合 | 与 LongMemEval abstention 对齐 | 阈值校准 |
| CLS 双系统 | 海马式快写图/索引 + 皮层式慢结构 | 高度适合 | 离线 consolidation 管道 | 工程复杂度 |

---

## 5 关键启示：真正"长期记忆"系统必须具备的核心能力

从认知科学（Part A）与计算架构/最新系统（Part B/C）交叉提炼。一个配得上"长期记忆"之名的 Agent 记忆层，至少应具备：

### 5.1 有界工作台 + 门控写入（工作记忆 + 注意）
上下文与每步可及记忆必须有硬预算；**不是所有交互都应写入长期库**。  
依据：Cowan 容量；GWT 注意门控；Mem0/MemCon 的实用压力。

### 5.2 多类型记忆分离（情景 / 语义 / 程序）
- **情景**：带时间戳的不可变事件  
- **语义**：可版本化的实体/关系/偏好  
- **程序**：可执行 skill 及其成功率 utility  
依据：Squire 分离；memorywire 四类型操作；TMLR 综述的 cognitive mechanism 轴。

### 5.3 分层存储与离线巩固（CLS）
快速在线写入（索引/草稿）与慢速结构化（图、schema、抽象）分离；空闲期 consolidation 重播高价值轨迹。  
依据：McClelland et al. 1995；Generative Agents reflection；CraniMem/MemDream/Hippocam。

### 5.4 关联检索 = 精确匹配 + 模式补全
单一向量 top-k 不够；需要图扩散/多跳/PPR 式补全，同时保留朴素 RAG 作为 baseline。  
依据：Collins & Loftus；HippoRAG/HippoRAG 2；Raw-RAG 警示。

### 5.5 模式分离与冲突解析
相似≠相同；更新≠删除历史；需要显式 **supersede / revoke / 版本 / 审计**。  
依据：Yassa & Stark；MAB FactConsolidation；TEPA；MINDSET。

### 5.6 使用驱动的价值与衰减（ACT-R 基线）
激活或效用应随**使用次数、新近性、关联度**更新；不同内容类型不同易腐率。  
依据：ACT-R 激活方程；ScrubJay-MEM π/τ；experience-following 风险提示需正反馈与质量门控。

### 5.7 提取练习与自监控
系统应**主动 probe** 自己，而不是等真实查询失败才修复；支持 abstain 而非编造。  
依据：Roediger & Karpicke；MemDream；LongMemEval 的 abstention 维度。

### 5.8 重建但不篡改
检索结果应按当前目标**重构**为可操作指导，但必须链接到不可变原始证据（provenance）。  
依据：Bartlett/DRM 重建性；MemHarness；TrajWiki 等 source-grounded 设计。

### 5.9 完整生命周期操作集
不止 put/get：需要 **remember / update / merge / forget / expire / revoke** 的显式 API 与治理（含 HITL 可选）。  
依据：memorywire；TEPA；VMG 安全综述。

### 5.10 可评测、可证伪
必须在 **LongMemEval + MemoryAgentBench + LOCOMO** 等上报告：检索、更新、多跳、时间、弃答、冲突；并披露 **naive RAG / full-context** baseline。  
依据：ICLR 2025 LongMemEval；MemoryAgentBench；2026 多篇 baseline 警示。

### 5.11（可选扩展）隐式/显式双通道
参数化技能/风格 vs 外置可审计记忆并存（CLARION 式分层），避免"一切都塞进可检索文本"。

---

## 6 参考文献总表

### Part A

| # | 引用 | DOI / URL |
|---|------|-----------|
| A1 | Baddeley (2012). Working Memory: Theories, Models, and Controversies. *Annu. Rev. Psychol.* | 10.1146/annurev-psych-120710-100422 |
| A2 | Baddeley (2000). The episodic buffer. *TiCS* | 10.1016/S1364-6613(00)01538-2 |
| A3 | Cowan (2001). Magical number 4. *BBS* | 10.1017/S0140525X01003922 |
| A4 | Cowan (2010). The Magical Mystery Four. *Curr. Dir. Psychol. Sci.* | 10.1177/0963721409359277 |
| A5 | Tulving (1986). What kind of a hypothesis… *JEP:LMC* | 10.1037/0278-7393.12.2.307 |
| A6 | Squire (1992). Declarative and Nondeclarative Memory. *J. Cogn. Neurosci.* | 10.1162/jocn.1992.4.3.232 |
| A7 | Knowlton & Squire (1993). Learning of Categories. *Science* | 10.1126/science.8259522 |
| A8 | McClelland, McNaughton, & O'Reilly (1995). CLS. *Psychol. Rev.* | 10.1037/0033-295X.102.3.419 |
| A9 | Norman & O'Reilly (2003). CLS recognition. *Psychol. Rev.* | 10.1037/0033-295X.110.4.611 |
| A10 | O'Reilly & Rudy (2001). Conjunctive representations. *Psychol. Rev.* | 10.1037/0033-295X.108.2.311 |
| A11 | Yassa & Stark (2011). Pattern separation. *TINS* | 10.1016/j.tins.2011.06.006 |
| A12 | Collins & Loftus (1975). Spreading-activation. *Psychol. Rev.* | 10.1037/0033-295X.82.6.407 |
| A13 | Roediger & Karpicke (2006). Test-enhanced learning. *Psychol. Sci.* | 10.1111/j.1467-9280.2006.01693.x |
| A14 | Roediger & McDermott (1995). Creating false memories. *JEP:LMC* | 10.1037/0278-7393.21.4.803 |
| A15 | Diekelmann, Wilhelm, & Born (2009). Sleep-dependent consolidation. *Sleep Med. Rev.* | 10.1016/j.smrv.2008.08.002 |
| A16 | Bartlett (1932). *Remembering*. CUP | （专著） |
| A17 | Tulving (1972). Episodic and semantic memory | （章节，无 DOI） |

### Part B

| # | 引用 | DOI / URL |
|---|------|-----------|
| B1 | Anderson et al. (2004). An Integrated Theory of the Mind. *Psychol. Rev.* | 10.1037/0033-295X.111.4.1036 |
| B2 | Anderson & Lebiere (2003). The Newell Test. *BBS* | 10.1017/S0140525X0300013X |
| B3 | Anderson & Lebiere (1998). *Atomic Components of Thought* / Newell Test 专著谱系 | MIT Press |
| B4 | Nuxoll & Laird (2012). Enhancing intelligent agents with episodic memory. *Cogn. Syst. Res.* | 10.1016/j.cogsys.2011.10.002 |
| B5 | Laird (2012). *The Soar Cognitive Architecture*. MIT Press | 含 episodic 章节 |
| B6 | Baars & Franklin (2003). *TiCS* | 10.1016/S1364-6613(03)00056-1 |
| B7 | Baars & Franklin (2007). *Neural Networks* | 10.1016/j.neunet.2007.09.013 |

### Part C

| # | 引用 | URL |
|---|------|-----|
| C1 | Packer et al. (2023). MemGPT. | arXiv:2310.08560 |
| C2 | Jiménez Gutiérrez et al. (2024). HippoRAG. **NeurIPS 2024** | arXiv:2405.14831 |
| C3 | Jiménez Gutiérrez et al. (2025). HippoRAG 2. **ICML 2025** | arXiv:2502.14802 |
| C4 | Chhikara et al. (2025). Mem0. | arXiv:2504.19413 |
| C5 | Xu et al. (2025). A-MEM. **NeurIPS 2025** | arXiv:2502.12110 |
| C6 | Wu et al. (2024/2025). LongMemEval. **ICLR 2025** | arXiv:2410.10813 |
| C7 | Hu, Wang, McAuley (2025). MemoryAgentBench. | arXiv:2507.05257 |
| C8 | Rasmussen et al. (2025). Zep. | arXiv:2501.13956 |
| C9 | Park et al. (2023). Generative Agents. **UIST 2023** | arXiv:2304.03442 |
| C10 | Zhang et al. (2024). Survey on Memory Mechanism of LLM Agents. | arXiv:2404.13501 |
| C11 | Luo et al. (2026). From Storage to Experience. **ACL 2026 Findings** | arXiv:2605.06716 |
| C12 | Huang et al. (2026). Agent Memory in the Second Half. **TMLR** | arXiv:2602.06052 |
| C13 | Gou (2026). From Long Context to Selective Memory. | arXiv:2610.21165 |
| C14 | Lin et al. (2026). Long-Term Memory Security. **EMNLP 2026** | arXiv:2604.16548 |
| C15 | Bao et al. (2026). Naive RAG Is Stronger Than We Thought. | arXiv:2610.30755 |
| C16 | Zhou et al. (2026). TEPA. | arXiv:2608.07429 |
| C17 | Dutta et al. (2026). MINDSET. | arXiv:2610.08586 |
| C18 | Lu et al. (2026). MemDream. | arXiv:2609.34545 |
| C19 | Wu et al. (2026). MemHarness. | arXiv:2607.28272 |
| C20 | Bhandari et al. (2026). ScrubJay-MEM. | arXiv:2608.04746 |
| C21 | Munirathinam (2026). memorywire. | arXiv:2606.01138 |
| C22 | Zeng et al. (2026). Hippocam / Use and Disuse. | arXiv:2610.12124 |
| C23 | Xiong et al. (2025). Experience-following behavior. | arXiv:2505.16067 |
| C24 | Pakhomov & Nijkamp (2026). Reading MAB Conflict-Resolution scores. | arXiv:2610.09193 |
| C25 | Poikarayil et al. (2026). Obsolete Facts in Agent Memory. | arXiv:2610.36308 |

---

## 附录：检索方法说明

- 元数据通过 **CrossRef REST API**、**PubMed E-utilities**、**arXiv Atom API** 于 2026-10-31 在线获取。
- WebSearch 插件在本次会话不可用；未使用未验证的 URL 猜测。
- 部分 1932/1972 类专著无 DOI，按学术惯例引用出版信息。
- 标注为 preprint 的 2025–2026 论文未经同等严格的本报告二次同行审查复核，引用时请核查 arXiv 最新版本。

---

*报告结束。*
