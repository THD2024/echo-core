# 数据模型与记忆生命周期设计（07）

> 基于：06-recommended-architecture 的 HLM-v1 架构
> 本文件定义完整的数据模型 Schema 与生命周期状态机

---

## 1. SQLite 表结构总览

```
┌─────────────────────────────────────────────────────────┐
│                    HLM-v1 数据库                          │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  情景层：                                                 │
│  ├── episodic_events          (不可变事件)               │
│  ├── episodic_tool_outputs    (工具输出指针)             │
│  └── episodic_fts             (FTS5 索引)                │
│                                                           │
│  语义层：                                                 │
│  ├── semantic_entities        (实体 + 版本)              │
│  ├── semantic_relations       (关系 + 版本)              │
│  ├── entity_canonical_keys    (消歧索引)                 │
│  └── semantic_fts             (FTS5 索引)                │
│                                                           │
│  程序层：                                                 │
│  ├── procedural_skills        (技能 + utility)           │
│  └── procedural_fts           (FTS5 索引)                │
│                                                           │
│  治理层：                                                 │
│  ├── memory_audit_log         (操作审计)                 │
│  ├── consolidation_runs       (巩固批次)                 │
│  └── memory_config            (运行时配置)               │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 详细表定义

### 2.1 情景层

#### episodic_events

```sql
CREATE TABLE episodic_events (
  id              TEXT PRIMARY KEY,              -- ULID
  session_id      TEXT NOT NULL,
  timestamp       INTEGER NOT NULL,              -- ms epoch
  event_type      TEXT NOT NULL CHECK(event_type IN 
                    ('action','observation','decision','error','reflection')),
  content         TEXT NOT NULL,                 -- 自然语言描述
  task_id         TEXT,
  user_id         TEXT,
  project_id      TEXT,
  surprise_score  REAL,                          -- 0-1, 写入门控评分
  utility_score   REAL,                          -- 0-1, 后续更新
  source_session  TEXT,                          -- 反思来源
  version         INTEGER NOT NULL DEFAULT 1,
  superseded_by   TEXT REFERENCES episodic_events(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_episodic_session ON episodic_events(session_id);
CREATE INDEX idx_episodic_timestamp ON episodic_events(timestamp);
CREATE INDEX idx_episodic_task ON episodic_events(task_id);
CREATE INDEX idx_episodic_type ON episodic_events(event_type);
```

#### episodic_tool_outputs

```sql
CREATE TABLE episodic_tool_outputs (
  id              TEXT PRIMARY KEY,              -- ULID
  event_id        TEXT NOT NULL REFERENCES episodic_events(id),
  tool_name       TEXT NOT NULL,
  tool_call_id    TEXT NOT NULL,
  output_ref      TEXT NOT NULL,                 -- 文件系统路径或 S3 URI
  output_size     INTEGER,                       -- bytes
  output_hash     TEXT,                          -- SHA256，用于去重
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_tool_outputs_event ON episodic_tool_outputs(event_id);
```

#### episodic_fts (FTS5 虚表)

```sql
CREATE VIRTUAL TABLE episodic_fts USING fts5(
  content,
  event_type,
  content='episodic_events',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 1'
);
-- 触发器同步（参照现有 memory_fts 模式）
```

### 2.2 语义层

#### semantic_entities

```sql
CREATE TABLE semantic_entities (
  id              TEXT PRIMARY KEY,              -- ULID
  entity_type     TEXT NOT NULL CHECK(entity_type IN 
                    ('person','project','concept','preference',
                     'fact','tool','skill','location','organization')),
  name            TEXT NOT NULL,
  canonical_key   TEXT NOT NULL,                 -- 消歧后的规范键
  description     TEXT,
  -- 版本化字段
  version         INTEGER NOT NULL DEFAULT 1,
  valid_from      INTEGER NOT NULL,              -- ms epoch
  valid_to        INTEGER,                       -- NULL = 当前有效
  status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN 
                    ('active','superseded','revoked')),
  superseded_by   TEXT REFERENCES semantic_entities(id),
  -- provenance
  confidence      REAL NOT NULL DEFAULT 0.5,     -- 0-1
  source_events   TEXT NOT NULL DEFAULT '[]',    -- JSON array of event IDs
  -- 元数据
  embedding       BLOB,                         -- 向量索引（可选）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_entities_canonical ON semantic_entities(canonical_key, version);
CREATE INDEX idx_entities_type ON semantic_entities(entity_type);
CREATE INDEX idx_entities_status ON semantic_entities(status);
CREATE INDEX idx_entities_valid ON semantic_entities(valid_from, valid_to);
```

#### entity_canonical_keys

```sql
CREATE TABLE entity_canonical_keys (
  canonical_key   TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL,
  aliases         TEXT NOT NULL DEFAULT '[]',    -- JSON array of alias strings
  embedding       BLOB,                         -- 用于相似度消歧
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

#### semantic_relations

```sql
CREATE TABLE semantic_relations (
  id              TEXT PRIMARY KEY,              -- ULID
  subject_id      TEXT NOT NULL REFERENCES semantic_entities(id),
  predicate       TEXT NOT NULL,                 -- 'works_on', 'prefers', 'causes', ...
  object_id       TEXT,                          -- 实体 ID（可 NULL）
  object_literal  TEXT,                          -- 字面值（与 object_id 二选一）
  -- 版本化字段
  version         INTEGER NOT NULL DEFAULT 1,
  valid_from      INTEGER NOT NULL,
  valid_to        INTEGER,
  status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN 
                    ('active','superseded','revoked')),
  superseded_by   TEXT REFERENCES semantic_relations(id),
  -- provenance
  confidence      REAL NOT NULL DEFAULT 0.5,
  source_events   TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_relations_subject ON semantic_relations(subject_id);
CREATE INDEX idx_relations_object ON semantic_relations(object_id);
CREATE INDEX idx_relations_predicate ON semantic_relations(predicate);
CREATE INDEX idx_relations_status ON semantic_relations(status);
```

#### semantic_fts (FTS5 虚表)

```sql
CREATE VIRTUAL TABLE semantic_fts USING fts5(
  name,
  description,
  content='semantic_entities',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 1'
);
```

### 2.3 程序层

#### procedural_skills

```sql
CREATE TABLE procedural_skills (
  id                TEXT PRIMARY KEY,            -- ULID
  skill_type        TEXT NOT NULL CHECK(skill_type IN 
                      ('tool_usage','workflow','debugging','planning','knowledge')),
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  trigger_conditions TEXT NOT NULL DEFAULT '[]', -- JSON array of condition strings
  procedure         TEXT NOT NULL,               -- 自然语言或代码
  -- 效用
  success_count     INTEGER NOT NULL DEFAULT 0,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  utility           REAL NOT NULL DEFAULT 0.5,   -- success / (success + failure)
  last_used         INTEGER,                     -- ms epoch
  -- provenance
  source_events     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  extracted_by      TEXT NOT NULL CHECK(extracted_by IN 
                      ('reflection','manual','distill')),
  -- 版本化
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN 
                      ('active','archived','revoked')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX idx_skills_type ON procedural_skills(skill_type);
CREATE INDEX idx_skills_utility ON procedural_skills(utility DESC);
CREATE INDEX idx_skills_status ON procedural_skills(status);
```

#### procedural_fts (FTS5 虚表)

```sql
CREATE VIRTUAL TABLE procedural_fts USING fts5(
  name,
  description,
  trigger_conditions,
  content='procedural_skills',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 1'
);
```

### 2.4 治理层

#### memory_audit_log

```sql
CREATE TABLE memory_audit_log (
  id              TEXT PRIMARY KEY,              -- ULID
  timestamp       INTEGER NOT NULL,
  operation       TEXT NOT NULL CHECK(operation IN 
                    ('create','update','supersede','revoke','archive',
                     'retrieve','consolidate','decay')),
  target_type     TEXT NOT NULL CHECK(target_type IN 
                    ('episodic','semantic_entity','semantic_relation','procedural')),
  target_id       TEXT NOT NULL,
  actor           TEXT NOT NULL,                 -- 'agent','consolidation','user','system'
  details         TEXT,                          -- JSON: {old_value, new_value, reason, ...}
  session_id      TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_audit_target ON memory_audit_log(target_type, target_id);
CREATE INDEX idx_audit_timestamp ON memory_audit_log(timestamp);
```

#### consolidation_runs

```sql
CREATE TABLE consolidation_runs (
  id              TEXT PRIMARY KEY,              -- ULID
  started_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  status          TEXT NOT NULL DEFAULT 'running' CHECK(status IN 
                    ('running','completed','failed','cancelled')),
  trigger_type    TEXT NOT NULL CHECK(trigger_type IN 
                    ('scheduled','idle','manual','post_session')),
  -- 统计
  events_processed    INTEGER DEFAULT 0,
  entities_created    INTEGER DEFAULT 0,
  entities_updated    INTEGER DEFAULT 0,
  relations_created   INTEGER DEFAULT 0,
  relations_updated   INTEGER DEFAULT 0,
  skills_extracted    INTEGER DEFAULT 0,
  conflicts_resolved  INTEGER DEFAULT 0,
  items_decayed       INTEGER DEFAULT 0,
  -- 错误
  error_message   TEXT,
  created_at      INTEGER NOT NULL
);
```

#### memory_config

```sql
CREATE TABLE memory_config (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,                 -- JSON encoded
  updated_at      INTEGER NOT NULL
);

-- 默认配置种子
INSERT INTO memory_config VALUES 
  ('write_gate.surprise_threshold', '0.3', strftime('%s','now') * 1000),
  ('write_gate.utility_threshold', '0.1', strftime('%s','now') * 1000),
  ('decay.episodic_half_life_days', '90', strftime('%s','now') * 1000),
  ('decay.semantic_half_life_days', '365', strftime('%s','now') * 1000),
  ('decay.procedural_min_utility', '0.2', strftime('%s','now') * 1000),
  ('consolidation.schedule_hours', '24', strftime('%s','now') * 1000),
  ('consolidation.max_llm_calls', '50', strftime('%s','now') * 1000),
  ('retrieval.max_candidates', '50', strftime('%s','now') * 1000),
  ('retrieval.final_limit', '10', strftime('%s','now') * 1000);
```

---

## 3. 记忆生命周期状态机

### 3.1 情景事件生命周期

```
                    ┌─────────────┐
                    │  (创建)     │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
              ┌────►│   active    │◄────────┐
              │     └──────┬──────┘         │
              │            │                │
              │            │ supersede      │ restore
              │            ▼                │ (撤销 supersede)
              │     ┌─────────────┐         │
              │     │ superseded  │─────────┘
              │     └─────────────┘
              │
              │     ┌─────────────┐
              └─────│  archived   │  (衰减/手动归档)
                    └─────────────┘
```

**状态说明**：
- `active`：当前有效，可被检索
- `superseded`：被新版本取代，历史可查但默认不检索
- `archived`：衰减归档，仅精确查询可访问

### 3.2 语义实体/关系生命周期

```
                    ┌─────────────┐
                    │  (创建)     │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
              ┌────►│   active    │◄────────┐
              │     └──────┬──────┘         │
              │            │                │
              │      ┌─────┴─────┐         │ restore
              │      │           │         │
              │      ▼           ▼         │
              │ ┌─────────┐ ┌─────────┐    │
              │ │superseded│ │ revoked │────┘
              │ └─────────┘ └─────────┘
              │      │           │
              │      │           │ (彻底删除，仅审计)
              │      ▼           ▼
              │     ┌─────────────┐
              └─────│  archived   │
                    └─────────────┘
```

**状态说明**：
- `active`：当前有效，参与检索
- `superseded`：被新版本取代，历史可查
- `revoked`：被明确撤销（错误信息），审计可查
- `archived`：长期未用衰减归档

### 3.3 程序技能生命周期

```
                    ┌─────────────┐
                    │  (提炼)     │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
              ┌────►│   active    │◄────────┐
              │     └──────┬──────┘         │
              │            │                │
              │       utility < 阈值        │ 手动恢复
              │            │                │
              │            ▼                │
              │     ┌─────────────┐         │
              └─────│  archived   │─────────┘
                    └─────────────┘
                           │
                           │ 明确废弃
                           ▼
                    ┌─────────────┐
                    │   revoked   │
                    └─────────────┘
```

---

## 4. 版本化与 Supersede 机制

### 4.1 版本链结构

```
Entity A (v1, active)
    │
    │ supersede (新版本创建时)
    ▼
Entity A (v2, active) ── superseded_by ──► Entity A (v1, superseded)
    │
    │ supersede
    ▼
Entity A (v3, active) ── superseded_by ──► Entity A (v2, superseded)
```

### 4.2 Supersede 操作

```typescript
async function supersedeEntity(
  entityId: string,
  newValue: Partial<SemanticEntity>,
  sourceEvent: string,
  reason: string
): Promise<string> {
  // 1. 读取当前 active 版本
  const current = await getActiveEntity(entityId);
  
  // 2. 创建新版本
  const newVersion = await createEntity({
    ...current,
    ...newValue,
    version: current.version + 1,
    valid_from: Date.now(),
    source_events: [...current.source_events, sourceEvent]
  });
  
  // 3. 标记旧版本 superseded
  await updateEntity(current.id, {
    status: 'superseded',
    valid_to: Date.now(),
    superseded_by: newVersion.id
  });
  
  // 4. 审计日志
  await auditLog({
    operation: 'supersede',
    target_type: 'semantic_entity',
    target_id: current.id,
    details: { new_version: newVersion.id, reason }
  });
  
  return newVersion.id;
}
```

### 4.3 Revoke 操作（错误信息撤销）

```typescript
async function revokeEntity(
  entityId: string,
  reason: string,
  sourceEvent: string
): Promise<void> {
  // Revoke 不删除，只标记状态
  await updateEntity(entityId, {
    status: 'revoked',
    valid_to: Date.now()
  });
  
  await auditLog({
    operation: 'revoke',
    target_type: 'semantic_entity',
    target_id: entityId,
    details: { reason, source_event: sourceEvent }
  });
}
```

---

## 5. 检索 API 设计

### 5.1 统一检索接口

```typescript
interface MemorySearchRequest {
  query: string;
  layers?: ('episodic' | 'semantic' | 'procedural')[];  // 默认全部
  limit?: number;                                         // 默认 10
  filters?: {
    session_id?: string;
    task_id?: string;
    time_range?: { start: number; end: number };
    entity_types?: string[];
    min_confidence?: number;
    include_superseded?: boolean;                         // 默认 false
    include_archived?: boolean;                           // 默认 false
  };
  options?: {
    use_vector?: boolean;        // 默认 true
    use_graph?: boolean;         // 默认 true（语义层）
    ppr_hops?: number;           // 默认 2
  };
}

interface MemorySearchResult {
  items: MemoryItem[];
  total_candidates: number;
  assembly_metadata: {
    conflicts_resolved: number;
    stale_demoted: number;
    layers_searched: string[];
  };
}

interface MemoryItem {
  layer: 'episodic' | 'semantic' | 'procedural';
  id: string;
  type: string;                  // event_type / entity_type / skill_type
  content: string;               // 主要内容
  score: number;                 // 综合得分
  metadata: {
    timestamp?: number;
    session_id?: string;
    confidence?: number;
    utility?: number;
    valid_from?: number;
    valid_to?: number;
    source_events?: string[];
  };
  provenance: {
    source_layer: string;
    source_id: string;
    retrieval_path: string;      // 'bm25' | 'vector' | 'graph' | 'temporal'
  };
}
```

### 5.2 写入 API

```typescript
interface MemoryWriteRequest {
  layer: 'episodic' | 'semantic' | 'procedural';
  operation: 'create' | 'update' | 'supersede' | 'revoke';
  data: EpisodicEvent | SemanticEntity | SemanticRelation | ProceduralSkill;
  context?: {
    session_id?: string;
    task_id?: string;
    source_events?: string[];
  };
}

interface MemoryWriteResult {
  success: boolean;
  id: string;                    // 创建/更新的实体 ID
  version?: number;
  audit_id: string;
  warnings?: string[];
}
```

---

## 6. 衰减与归档策略

### 6.1 Perishability 配置

```typescript
const PERISHABILITY = {
  episodic: {
    half_life_days: 90,
    min_utility_to_keep: 0.1,
    archive_after_days: 365
  },
  semantic: {
    half_life_days: 365,
    // 事实类不衰减，偏好类衰减
    by_type: {
      fact: { half_life_days: Infinity },
      preference: { half_life_days: 180 },
      temporary: { half_life_days: 30 }
    }
  },
  procedural: {
    // 技能不按时间衰减，按 utility
    min_utility: 0.2,
    archive_after_failures: 5
  }
};
```

### 6.2 衰减计算公式

```typescript
function calculateDecay(
  created_at: number,
  last_accessed: number,
  access_count: number,
  half_life_days: number
): number {
  if (half_life_days === Infinity) return 1.0;
  
  const days_since_creation = (Date.now() - created_at) / (1000 * 60 * 60 * 24);
  const days_since_access = (Date.now() - last_accessed) / (1000 * 60 * 60 * 24);
  
  // 基础衰减（基于创建时间）
  const base_decay = Math.pow(0.5, days_since_creation / half_life_days);
  
  // 访问强化（访问越多衰减越慢）
  const access_boost = Math.log1p(access_count) * 0.1;
  
  // 新近性加权（最近访问的衰减更慢）
  const recency_boost = Math.pow(0.5, days_since_access / (half_life_days * 2));
  
  return Math.min(1.0, base_decay + access_boost + recency_boost);
}
```

---

*本数据模型设计基于 HLM-v1 架构，所有字段与状态机均有明确的生命周期语义。*
