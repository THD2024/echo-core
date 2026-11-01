# 推荐终极架构（06）

> 推荐方案：**混合分层记忆架构 v1（Hybrid Layered Memory, HLM-v1）**
> 基于方案 A 为骨架、方案 B 的时序知识图作为语义层实现
> 核心原则：情景不可变、语义版本化、巩固可审计、检索可回链

---

## 1. 总体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent 主循环                               │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  工作记忆    │  │  检索接口    │  │  写入接口    │              │
│  │  (预算制)    │  │  (统一API)  │  │  (门控)     │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                 │                 │                     │
└─────────┼─────────────────┼─────────────────┼─────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Memory Bus (统一总线)                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    检索路由器                             │    │
│  │  Query → 分类 → [BM25 | 向量 | 图遍历 | 时间线] → 融合   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                    │
│  ┌──────────────────────────┼──────────────────────────────┐    │
│  │              Post-Retrieval Assembly (后检索装配)         │    │
│  │  去重 → 冲突检测 → 陈旧降权 → 证据包组装 → provenance   │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                              │                                    │
│  ┌──────────────────────────┼──────────────────────────────┐    │
│  │              Write Gate (写入门控)                        │    │
│  │  surprise/utility 评分 → 是否入库 → 分流到各层           │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                                                                   │
└───────────────────────────────┼─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   情景层       │     │   语义层       │     │   程序层       │
│  (Episodic)   │     │  (Semantic)   │     │ (Procedural)  │
│               │     │               │     │               │
│ · 不可变事件  │     │ · 时序知识图  │     │ · Skill 库    │
│ · 时间戳      │◄───►│ · 实体/关系   │◄───►│ · 成功率      │
│ · session_id  │     │ · 版本链      │     │ · 触发条件    │
│ · tool_output │     │ · 有效期      │     │ · utility     │
│ · provenance  │     │ · supersede   │     │               │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │    Consolidation Pipe    │
                │      (巩固管道)          │
                │                         │
                │  ┌─────────────────┐    │
                │  │ 离线 reflection │    │
                │  │ (auto-dream)    │    │
                │  └─────────────────┘    │
                │  ┌─────────────────┐    │
                │  │ 冲突审计        │    │
                │  │ (supersede/revoke)│   │
                │  └─────────────────┘    │
                │  ┌─────────────────┐    │
                │  │ 衰减/归档       │    │
                │  │ (perishability) │    │
                │  └─────────────────┘    │
                │  ┌─────────────────┐    │
                │  │ 经验抽象        │    │
                │  │ (skill 提炼)    │    │
                │  └─────────────────┘    │
                │                         │
                └────────────┬────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │     持久存储层           │
                │                         │
                │  SQLite (图 + 索引)     │
                │  文件系统 (原始证据)    │
                │  向量索引 (embedding)   │
                │                         │
                └─────────────────────────┘
```

---

## 2. 各层详细设计

### 2.1 情景层（Episodic Layer）

**职责**：记录不可变的原始事件，提供完整 provenance。

**数据结构**：
```typescript
interface EpisodicEvent {
  id: string;                    // ULID
  session_id: string;
  timestamp: number;             // ms epoch
  event_type: 'action' | 'observation' | 'decision' | 'error';
  content: string;               // 自然语言描述
  tool_calls: ToolCall[];        // 工具调用记录
  tool_outputs: ToolOutputRef[]; // 工具输出指针（不内联大输出）
  context: {
    task_id?: string;
    user_id?: string;
    project_id?: string;
  };
  metadata: {
    surprise_score?: number;     // 写入门控评分
    utility_score?: number;
    source_session?: string;
  };
  // 不可变：创建后不可修改，只可 supersede
  version: 1;
  superseded_by?: string;        // 被哪个事件取代
}
```

**存储**：
- SQLite 表 `episodic_events`
- 大工具输出存文件系统，表中存指针
- FTS5 索引 content + metadata

**检索**：
- BM25 全文检索
- 时间范围过滤
- session/task 过滤

### 2.2 语义层（Semantic Layer）

**职责**：维护版本化的实体-关系图，支持多跳查询和冲突管理。

**数据结构**：
```typescript
interface SemanticEntity {
  id: string;                    // ULID
  entity_type: 'person' | 'project' | 'concept' | 'preference' | 'fact';
  name: string;
  canonical_key: string;         // 消歧后的规范键
  properties: Record<string, PropertyValue>;
  // 版本化
  version: number;
  valid_from: number;
  valid_to?: number;             // null = 当前有效
  status: 'active' | 'superseded' | 'revoked';
  superseded_by?: string;
  // provenance
  source_events: string[];       // 来源情景事件 ID
  confidence: number;            // 0-1
}

interface PropertyValue {
  value: string | number | boolean;
  valid_from: number;
  valid_to?: number;
  status: 'active' | 'superseded' | 'revoked';
  source_event: string;
}

interface SemanticRelation {
  id: string;
  subject_id: string;
  predicate: string;             // 'works_on', 'prefers', 'causes', ...
  object_id: string | string;    // 实体 ID 或字面值
  properties: Record<string, PropertyValue>;
  // 版本化
  version: number;
  valid_from: number;
  valid_to?: number;
  status: 'active' | 'superseded' | 'revoked';
  superseded_by?: string;
  // provenance
  source_events: string[];
  confidence: number;
}
```

**存储**：
- SQLite 表 `semantic_entities`, `semantic_relations`
- 实体消歧索引 `entity_canonical_keys`
- 向量索引（embedding of name + properties）

**检索**：
- 实体名精确匹配
- 向量相似度
- 图遍历（1-2 跳 PPR）
- 时序过滤（只取 active）

### 2.3 程序层（Procedural Layer）

**职责**：积累可复用的技能和经验规则。

**数据结构**：
```typescript
interface ProceduralSkill {
  id: string;
  skill_type: 'tool_usage' | 'workflow' | 'debugging' | 'planning';
  name: string;
  description: string;
  trigger_conditions: string[];   // 何时触发
  procedure: string;              // 具体步骤（自然语言或代码）
  // 效用
  success_count: number;
  failure_count: number;
  utility: number;                // success / (success + failure)
  last_used: number;
  // provenance
  source_events: string[];        // 从哪些事件提炼
  extracted_by: 'reflection' | 'manual' | 'distill';
}
```

**存储**：
- SQLite 表 `procedural_skills`
- 触发条件 FTS 索引

**检索**：
- 触发条件匹配
- utility 排序
- skill_type 过滤

---

## 3. 核心流程

### 3.1 写入流程

```
Agent 行动
    │
    ▼
Write Gate 评分
    │
    ├── surprise_score < 阈值 → 不入库（静默丢弃）
    │
    ├── surprise_score ≥ 阈值 → 写入情景层
    │       │
    │       ▼
    │   实时实体抽取（异步）
    │       │
    │       ├── 新实体 → 创建 SemanticEntity
    │       ├── 实体更新 → 创建新版本 + SUPERSED 旧版本
    │       └── 新关系 → 创建 SemanticRelation
    │
    └── 成功路径检测 → 写入/更新程序层
            │
            ▼
        Skill 提炼（异步）
```

### 3.2 检索流程

```
Query
    │
    ▼
Query 分类
    │
    ├── 事实查询 → 实体识别 → 图遍历 + BM25
    │
    ├── 时间查询 → 时间线检索 + BM25
    │
    ├── 关联查询 → 向量 + PPR 扩散
    │
    └── 技能查询 → 触发条件匹配 + utility 排序
    │
    ▼
候选集合并（去重）
    │
    ▼
Post-Retrieval Assembly
    │
    ├── 冲突检测（同一实体多版本）
    ├── 陈旧降权（valid_to < now）
    ├── 证据包组装
    └── provenance 附加
    │
    ▼
返回证据包 → Agent
```

### 3.3 巩固流程（离线/空闲触发）

```
Consolidation Trigger
    │
    ├── 定期（如每日）
    ├── 空闲检测
    └── 手动触发
    │
    ▼
┌─────────────────────────────────────┐
│  Phase 1: 冲突审计                   │
│  - 检测同一实体的多 active 版本       │
│  - 标记 supersede 关系               │
│  - 低置信度标记 revoke               │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Phase 2: 反思与抽象                 │
│  - 高价值事件 → LLM 反思             │
│  - 提炼语义摘要 → 更新语义层         │
│  - 成功路径 → 提炼技能 → 程序层      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  Phase 3: 衰减与归档                 │
│  - 按 perishability 计算衰减         │
│  - 低 utility 技能归档               │
│  - 旧事件压缩（保留索引，归档正文）  │
└─────────────────────────────────────┘
    │
    ▼
Consolidation Report（可审计）
```

---

## 4. 与现有 Echo Core 的兼容边界

### 4.1 可直接复用的现有组件

| 现有组件 | 位置 | 在 HLM-v1 中的角色 |
|---------|------|-------------------|
| FTS5 索引 | `memory/fts.sql.ts` | 情景层/语义层的全文索引 |
| write-gate | `memory/write-gate.ts` | 扩展为 HLM 写入门控 |
| path-guard | `memory-path-guard.ts` | 情景层文件存储的路径守卫 |
| reconcile | `memory/reconcile.ts` | 扩展为多层同步 |
| auto-dream | `session/auto-dream.ts` | 巩固管道的触发器之一 |
| checkpoint-writer | `session/checkpoint.ts` | 工作记忆 ↔ 情景层桥梁 |
| Immune classifyToolError | `metrics/` | 程序层错误经验的来源 |

### 4.2 需要新建的组件

| 新组件 | 职责 | 依赖 |
|-------|------|------|
| Memory Bus | 统一检索/写入 API | SQLite 新表 |
| Semantic Graph | 时序知识图 | SQLite + 向量索引 |
| Post-Retrieval Assembly | 后检索装配 | Memory Bus |
| Consolidation Pipeline | 巩固管道 | Memory Bus + LLM |
| Procedural Skill Store | 技能库 | SQLite |

### 4.3 迁移策略

**Phase 1（兼容层）**：
- 现有 `memory/` 模块作为 HLM-v1 的"文件后端"
- 新增 SQLite 表，与现有 `memory_fts` 共存
- 现有 Memory 工具升级为调用 Memory Bus

**Phase 2（渐进增强）**：
- 启用语义层（实体抽取 + 图构建）
- 启用巩固管道（auto-dream 升级）
- 现有 MEMORY.md 内容一次性导入语义层

**Phase 3（完整能力）**：
- 启用程序层（skill 积累）
- 启用混合检索（BM25 + 向量 + 图）
- 启用冲突管理（版本 + supersede）

---

## 5. 验收标准

HLM-v1 必须能回答任务书中的 9 个问题：

| # | 问题 | HLM-v1 回答方式 |
|---|------|----------------|
| 1 | 如何从一次经历中保留具体情景？ | 情景层不可变事件 + 完整 provenance |
| 2 | 如何从多次经历中形成可复用知识？ | 巩固管道反思 → 语义层实体/关系 |
| 3 | 如何由一个局部线索找回相关经历？ | 混合检索：BM25 + 向量 + 图 PPR |
| 4 | 如何在检索过程中逐步补全记忆？ | Post-Retrieval Assembly + PPR 扩散 |
| 5 | 如何判断新旧信息冲突？ | 语义层版本检测 + 冲突审计 |
| 6 | 如何修正错误认知，同时保留历史证据？ | SUPERSED 边 + 版本链 + provenance |
| 7 | 如何决定记忆的重要程度和保留期限？ | Write Gate surprise/utility + perishability 衰减 |
| 8 | 如何让过去的经验真正影响未来行动？ | 程序层 skill 触发 + 语义层检索注入 |
| 9 | 如何证明系统能力提升？ | 基准评测：LongMemEval 子集 + 自建冲突集 + Raw-RAG baseline |

---

*本推荐架构综合了方案 A/B 的优点，所有设计决策附有研究报告来源编号。*
