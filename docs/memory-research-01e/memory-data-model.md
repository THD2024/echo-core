# MiMoCode Memory 系统 · 数据模型深度审计报告

> **审计性质**：只读。未修改任何代码或运行时数据。  
> **代码基线**：`D:\EchoCore\MiMo-Code\packages\cli`  
> **运行时库**：`C:\Users\微醺\.local\share\mimocode\mimocode.db`（WAL SQLite）  
> **审计日期**：2026 年（基于当前 checkout + 本机运行时快照）

---

## 0. 总览

MiMoCode 的 Memory 是**双层存储**：

| 层 | 载体 | 角色 |
|---|---|---|
| **权威内容层** | 磁盘 `.md` 文件树（`<Global.Path.data>/memory/**`） | 唯一真实来源；agent 读写的是文件 |
| **检索索引层** | SQLite `memory_fts`（content 表）+ `memory_fts_idx`（FTS5 external-content 虚表） | 全文检索；由 reconcile 从磁盘单向同步 |

与 Memory 直接相关的 SQLite 对象**只有**：`memory_fts`、`memory_fts_idx`（及其 FTS5 配套影子表）、3 个触发器、2 个普通索引。不存在独立的 "memory 元数据表"。

另有 **History 检索**（`history_fts` / `history_fts_idx`）属对话历史，结构类似但数据流不同（从 `part`/session 投影，非磁盘 md），本报告在 Schema 层附带列出以作对照。

---

## 1. 完整 SQLite Schema

### 1.1 Memory 核心：`memory_fts`（content 表）

**【代码定义】Drizzle 声明**（`packages/cli/src/memory/fts.sql.ts:3-19`）：

```ts
export const MemoryFtsTable = sqliteTable(
  "memory_fts",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    path: text().notNull().unique(),
    scope: text().notNull(),
    scope_id: text().notNull().default(""),
    type: text().notNull(),
    body: text().notNull(),
    fingerprint: text().notNull(),
    last_indexed_at: integer().notNull(),
  },
  (table) => [
    index("memory_fts_scope_idx").on(table.scope, table.scope_id),
    index("memory_fts_type_idx").on(table.type),
  ],
)
```

**【代码定义】当前生效 DDL**（`packages/cli/migration/20260521010000_memory_fts_v6/migration.sql:6-15`）：

```sql
CREATE TABLE `memory_fts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `path` text NOT NULL UNIQUE,
  `scope` text NOT NULL,
  `scope_id` text DEFAULT '' NOT NULL,
  `type` text NOT NULL,
  `body` text NOT NULL,
  `fingerprint` text NOT NULL,
  `last_indexed_at` integer NOT NULL
);
```

**【运行时实际】** `PRAGMA table_info(memory_fts)` 与上一致（8 列；`scope_id` 默认 `''`；`path` UNIQUE）。

**列语义**：

| 列 | 类型 | 语义 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 内部行号；也是 FTS5 `content_rowid` |
| `path` | TEXT UNIQUE | 绝对路径（Windows 下用正斜杠规范化后的路径字符串） |
| `scope` | TEXT | `global` \| `projects` \| `sessions` \| `cc` |
| `scope_id` | TEXT | global 为 `""`；projects 为 projectID 或 `global`；sessions 为 sessionID；cc 为 slug |
| `type` | TEXT | `free` \| `memory` \| `checkpoint` \| `progress` \| `notes` \| `feedback` \| `project` \| `reference` \| `user` |
| `body` | TEXT | **完整** `.md` 文件正文 |
| `fingerprint` | TEXT | `"{size}-{mtimeMs}"`（`reconcile.ts:57`） |
| `last_indexed_at` | INTEGER | `Date.now()` 毫秒时间戳 |

### 1.2 初始（历史）DDL：`20260515010000_memory_fts`

**【代码定义】**（`packages/cli/migration/20260515010000_memory_fts/migration.sql:1-9`）：

```sql
CREATE TABLE `memory_fts` (
  `path` text PRIMARY KEY NOT NULL,   -- 早期：path 即主键，无 id
  `scope` text NOT NULL,
  `scope_id` text DEFAULT '' NOT NULL,
  `type` text NOT NULL,
  `body` text NOT NULL,
  `fingerprint` text NOT NULL,
  `last_indexed_at` integer NOT NULL
);
```

v6 迁移 drop 后重建，改为 `id` 自增 PK + `path` UNIQUE。

### 1.3 History 对照表：`history_fts`（非 Memory，供对照）

**【代码定义】**（`packages/cli/src/history/fts.sql.ts:3-25`）：

```ts
export const HistoryFtsTable = sqliteTable("history_fts", {
  part_id: text().primaryKey(),
  session_id: text().notNull(),
  message_id: text().notNull(),
  project_id: text().notNull(),
  kind: text().notNull(),
  body: text().notNull(),        // 展示用原文
  body_idx: text().notNull(),    // 检索用（CJK unigram 处理）
  tool_name: text(),
  time_created: integer().notNull(),
}, ...)
```

**【运行时实际】** 列集合一致（`kind`/`body_idx` 有 DEFAULT `''` 的 ALTER ADD 痕迹）。

**`history_index_migration`**（`history/fts.sql.ts:28-34`）：

```ts
version: integer PK
phase: "clean" | "repair" | "finalize" | "done"
cursor, fts_end, part_end: integer
```

### 1.4 首建基线（非 Memory 但同库）

初始库由 `20260127222353_familiar_lady_ursula/migration.sql` 创建 `project` / `message` / `part` / `session` / `todo` / `permission` / `session_share` 等。Memory 表在 2026-05-15 迁移中才加入。

---

## 2. 索引清单

### 2.1 Memory 相关

| 索引名 | 表 | 列 | 唯一 | 来源 |
|---|---|---|---|---|
| `memory_fts_scope_idx` | `memory_fts` | `(scope, scope_id)` | 否 | fts.sql.ts:16；migration `20260515010000` L11 / `20260521010000` L16 |
| `memory_fts_type_idx` | `memory_fts` | `(type)` | 否 | fts.sql.ts:17；同上 L13/L17 |
| `sqlite_autoindex_memory_fts_1` | `memory_fts` | `(path)` | **是** | UNIQUE 约束隐式索引【运行时】 |

### 2.2 History 对照

| 索引名 | 表 | 列 |
|---|---|---|
| `history_fts_session_idx` | `history_fts` | `(session_id, time_created)` |
| `history_fts_project_idx` | `history_fts` | `(project_id, time_created)` |
| `history_fts_message_idx` | `history_fts` | `(message_id)` |
| `history_fts_kind_idx` | `history_fts` | `(kind)` |

### 2.3 FTS5 影子表（运行时自动管理，勿手写）

**`memory_fts_idx_*`**：
- `memory_fts_idx_config` (k PK, v) WITHOUT ROWID
- `memory_fts_idx_data` (id PK, block BLOB)
- `memory_fts_idx_docsize` (id PK, sz BLOB)
- `memory_fts_idx_idx` (segid, term, pgno) WITHOUT ROWID

**`history_fts_idx_*`**：同构。

**【运行时行数】** `memory_fts_idx_data` = 495 块；`memory_fts_idx_idx` = 492 词项段；`docsize` = 897（与 content 行数 1:1）。

---

## 3. 迁移机制

### 3.1 迁移文件位置

```
packages/cli/migration/<YYYYMMDDHHMMSS>_<name>/migration.sql
```

可选伴随 `snapshot.json`（早期迁移）。

Memory 三次演进：
1. `20260515010000_memory_fts` — 首建
2. `20260521010000_memory_fts_v6` — 重建为 id PK + external-content FTS5
3. `20260521020000_memory_fts_triggers` — 修复 delete 触发器

### 3.2 加载与排序

**【代码定义】**（`packages/cli/src/storage/db.ts:65-83`）：

```ts
function migrations(dir: string): Journal {
  // readdir migration/，读每个 <tag>/migration.sql
  // timestamp = 从目录名前 14 位数字解析为 UTC epoch ms
  return sql.sort((a, b) => a.timestamp - b.timestamp)
}
```

生产构建时可用打包期注入的 `MIMOCODE_MIGRATIONS` 常量（`db.ts:20,101-104`），否则读磁盘 `../../migration`。

### 3.3 执行

**【代码定义】**（`db.ts:85-118`）：

1. `init(Path)` 打开 SQLite
2. PRAGMA：`busy_timeout=5000`, `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-64000`, `foreign_keys=ON`, `wal_checkpoint(PASSIVE)`
3. `migrateReplaySafe(db, entries)` 调用 drizzle-orm `migrate()`
4. 除非 `MIMOCODE_SKIP_MIGRATIONS`，启动 history 索引后台迁移 `startIndexMigration(db)`

**【代码定义】Replay-safe 包装**（`migrate-replay-safe.ts:7-56`）：
- 包装 `session.run`
- 仅将两类错误视为 no-op 成功：
  - `ALTER TABLE` → `duplicate column name` / `no such column`
  - `CREATE [UNITE] INDEX` → `already exists`
- 其他失败仍中止

### 3.4 版本管理

**机制**：drizzle migrator 写入 `__drizzle_migrations`：

```sql
CREATE TABLE "__drizzle_migrations" (
  id INTEGER PRIMARY KEY,
  hash text NOT NULL,
  created_at numeric,
  name text,
  applied_at TEXT
);
```

**【运行时实际】**（只读查询结果）：
- 已应用 **56** 条
- `user_version` PRAGMA = **0**（版本完全依赖 drizzle journal，不用 SQLite user_version）
- Memory 相关：
  - id 17: `20260515010000_memory_fts` applied 2026-08-31
  - id 22: `20260521010000_memory_fts_v6`
  - id 23: `20260521020000_memory_fts_triggers`
- 最新一条：id 56 `20261013000000_inbox_queue` applied 2026-10-27

**⚠ 源码/运行时漂移**：运行时 journal 含 `20261013000000_inbox_queue`，但当前 checkout 的 `packages/cli/migration/` 目录**没有**该子目录（最新为 `20261012000000_history_cjk_unigram`）。说明本机 DB 由更新版本的构建写入，或该迁移目录在源码侧被移除。不影响 Memory 表结构，但表明源码基线 ≠ 本机 DB 基线。

### 3.5 其他"迁移"（非 schema）

| 机制 | 文件 | 作用 |
|---|---|---|
| `memory.md` → `MEMORY.md` | `session/checkpoint-paths.ts:48-60` | 会话启动/checkpoint 时幂等 rename |
| JSON → SQLite | `storage/json-migration.ts` | 历史数据导入，与 Memory FTS 无关 |
| History 索引增量 | `history/migration.ts` + `migration-batch.ts` | 后台低占空比补索引 |

---

## 4. FTS5 虚表定义

### 4.1 `memory_fts_idx` 完整定义

**【代码定义 / 【运行时一致】**（`20260521010000_memory_fts_v6/migration.sql:18-23`）：

```sql
CREATE VIRTUAL TABLE `memory_fts_idx` USING fts5(
  body,
  content='memory_fts',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1'
);
```

| 参数 | 值 | 含义 |
|---|---|---|
| 索引列 | `body` | 只索引正文全文 |
| content 模式 | external-content，`content='memory_fts'` | 索引不存正文副本，查询时回读 content 表 |
| content_rowid | `'id'` | 映射到 `memory_fts.id`（v6 从 rowid 改为 id） |
| tokenizer | `unicode61 remove_diacritics 1` | Unicode 分词；去变音符号；**无 CJK unigram**（与 history 不同） |

### 4.2 触发器（当前）

**【代码定义】**（`20260521020000_memory_fts_triggers/migration.sql:8-17`，与运行时 DDL 一致）：

```sql
CREATE TRIGGER `memory_fts_ai` AFTER INSERT ON `memory_fts` BEGIN
  INSERT INTO `memory_fts_idx`(rowid, body) VALUES (NEW.id, NEW.body);
END;

CREATE TRIGGER `memory_fts_ad` AFTER DELETE ON `memory_fts` BEGIN
  INSERT INTO `memory_fts_idx`(`memory_fts_idx`, rowid, body)
    VALUES('delete', OLD.id, OLD.body);
END;

CREATE TRIGGER `memory_fts_au` AFTER UPDATE ON `memory_fts` BEGIN
  INSERT INTO `memory_fts_idx`(`memory_fts_idx`, rowid, body)
    VALUES('delete', OLD.id, OLD.body);
  INSERT INTO `memory_fts_idx`(rowid, body) VALUES (NEW.id, NEW.body);
END;
```

**关键修复说明**（migration 注释 L1-4）：external-content 模式删除 token 必须用 magic command `'delete'`，不能 `DELETE FROM vtab`（那是 contentless 语法）。v6 初版用错，本迁移修正。

### 4.3 历史触发器（v1，已 drop）

`20260515010000` 中曾用 `content_rowid='rowid'` + 普通 DELETE；v6 整表 drop 重建。

### 4.4 查询路径（service.search）

**【代码定义】**（`memory/service.ts:102-112`）：

```sql
SELECT memory_fts.path, memory_fts.scope, memory_fts.scope_id, memory_fts.type,
       snippet(memory_fts_idx, 0, '<<', '>>', '...', 32) AS snippet,
       bm25(memory_fts_idx) AS score
FROM memory_fts_idx
JOIN memory_fts ON memory_fts.id = memory_fts_idx.rowid
WHERE memory_fts_idx MATCH ?
  -- 可选 AND memory_fts.scope = ? / scope_id = ? / type = ?
ORDER BY score
LIMIT ?
```

查询构建（`fts-query.ts:28-37`）：Unicode 字母/数字/下划线切词 → 短语引用 → **OR 连接**；空 token 返回 null。  
打分后处理：BM25 取负变"越高越好"，相对地板 `memory_search_score_floor`（默认 0.15），#1 恒保留；over-fetch `min(limit*3, 50)`。

---

## 5. 数据流方向

### 5.1 权威方向：磁盘 → SQLite（单向索引）

```
磁盘 .md 文件
    │  walkMemoryDir / walkCcRoot
    ▼
reconcileMemory()  ── prune：索引中不在磁盘集合的 path → DELETE
    │
    └── indexFromDisk():
          fingerprint = size-mtimeMs
          若与 DB 相同 → "hit"（跳过）
          否则读全文 → INSERT ... ON CONFLICT(path) DO UPDATE
          触发 memory_fts_au/ai → 维护 memory_fts_idx
```

**SQLite 永不回写磁盘。** 检索命中只返回 path/snippet；内容以文件为准。

### 5.2 触发时机

| 时机 | 位置 | 条件 |
|---|---|---|
| `Memory.reconcile()` 显式调用 | service.ts:46-50 | 业务按需 |
| **每次** `Memory.search()` | service.ts:59-64 | `cfg.checkpoint.memory_reconcile_on_search ?? true` 且开 |
| 会话启动 | session 启动链路 | 间接（search 路径） |

无文件 watcher；靠 search 前 lazy reconcile 覆盖 off-tool 写入。

### 5.3 冲突 / 边界处理

| 场景 | 行为 |
|---|---|
| 磁盘删除文件 | reconcile prune DELETE 行；触发器清 FTS token |
| 仅 mtime/size 变化 | fingerprint 不匹配 → 全量重读 body 重写 |
| 双 root（mimo + cc） | **先合并两侧磁盘路径再 prune**（reconcile.ts:96-102），避免误删另一 root |
| CC 关闭（cc_index=false） | cc 磁盘集合为空；mimo 行保留；**历史 cc 行会被 prune** |
| 路径解析失败 | log.warn，跳过不 prune 该路径外的健康行 |
| 写关闭（disable_write） | 只停**写 .md**；search/reconcile/读不受影响 |

### 5.4 与 History FTS 数据流对照

| | Memory | History |
|---|---|---|
| 源 | 磁盘 md | SQLite `part` / chunk |
| 同步 | lazy reconcile on search | 投影触发器 `history_part_ad` + 后台 migration batch |
| tokenizer | unicode61 + remove_diacritics | unicode61（+ body_idx CJK 预处理） |
| 内容字段 | body（单列全文） | body（展示）+ body_idx（检索） |

---

## 6. 文件系统路径结构

### 6.1 根路径

**【代码定义】**  
- Memory root：`path.join(Global.Path.data, "memory")`（`service.ts:39`）  
- Global.Path.data：由 `resolveMimocodeHome()`（`global/index.ts:8-16`）  
- CC root：`path.join(os.homedir(), ".claude", "projects")`（`service.ts:40`）

本机实际：`C:\Users\微醺\.local\share\mimocode\memory`

### 6.2 解析规则（paths.ts）

**MiMo native**（`paths.ts:54-61`）：

```
/memory/(global|projects|sessions)(?:/<id>)?/<key>.md
```

- `global`：`/memory/global/<key>.md`（`scope_id=""`）
- `projects`：`/memory/projects/<projectId>/<key>.md`
- `sessions`：`/memory/sessions/<sessionId>/<key>.md`

**类型推断**（`paths.ts:26-43`）：

| key 模式 | type |
|---|---|
| `^memory$` / `^memory-` （大小写不敏感） | `memory` |
| `^checkpoint$` / `^checkpoint-`（精确大小写） | `checkpoint` |
| `^tasks/<TID>/progress$` | `progress` |
| `^tasks/<TID>/notes$` | `notes` |
| 其他 | `free` |

**CC**（`paths.ts:66-78`）：`<anything>/.claude/projects/<slug>/memory/<key>.md` → scope=`cc`，type 先 `free`，索引时从 frontmatter `metadata.type` 覆盖（`feedback|project|reference|user`）。

**Windows**：`layoutPath` 将 `\` → `/` 仅用于匹配/FTS path 身份（`paths.ts:47-52`）。

**构建路径**（`paths.ts:114-121`）：拒绝 `..` 与绝对路径注入。

**projectId**（`paths.ts:123-125`）：`sha256(absRepoPath).hex.slice(0,12)`。

### 6.3 磁盘规范文件（checkpoint-paths.ts）

| 函数 | 路径 |
|---|---|
| `metaDir(sid)` | `<data>/memory/sessions/<sid>/` |
| `checkpointPath(sid)` | `.../checkpoint.md` |
| `memoryPath(pid)` | `<data>/memory/projects/<pid>/MEMORY.md` |
| `globalMemoryPath()` | `<data>/memory/global/MEMORY.md` |
| `notesPath(sid)` | `.../notes.md` |
| `tasksDir(sid)` | `.../tasks/` |
| `progressPath(sid, tid)` | `.../tasks/<tid>/progress.md` |

### 6.4 本机实际目录树（摘要）

```
<memory>/
  echo-avatar-readme.md          # 根级散落（parsePath 不匹配 → 不索引）
  identity/                      # 同上，不匹配 layout
  projects/
    9bb2a134-6602-40f1-8ea7-bdbac7d07d03/MEMORY.md
    global/MEMORY.md + MEMORY-*.md（~160+ spillover）
  sessions/
    <sid>/checkpoint.md, notes.md, tasks/<TID>/...
    （~200+ session 目录）
  tools/                         # 空/非 md 布局
```

**【运行时】scope×type 分布**（memory_fts）：

| scope | type | 行数 |
|---|---|---|
| sessions | checkpoint | 362 |
| sessions | free | 338 |
| projects | memory | 168 |
| sessions | progress | 29 |
| **合计** | | **897** |

无 `scope=cc` 行（cc_index 默认 false）。根级 `identity/`、`tools/`、`echo-avatar-readme.md` 未入索引。

---

## 7. 配置结构

### 7.1 `memory.*`（config.ts:335-346）

```ts
memory?: {
  /** 默认 false；true 停止写入新 memory（读/search 仍可用） */
  disable_write?: boolean
  /** 默认 false；索引 ~/.claude/projects/<slug>/memory → scope='cc' */
  cc_index?: boolean
}
```

### 7.2 `checkpoint.memory_*`（config.ts:326-332）

```ts
checkpoint?: {
  memory_reconcile_on_search?: boolean  // 默认 true
  memory_search_score_floor?: number    // 默认 0.15；0 关闭相对地板
}
```

### 7.3 write-gate（write-gate.ts:14-33）

```ts
export type MemoryWriteConfig = {
  memory?: { disable_write?: boolean }
}
export function isMemoryWriteEnabled(cfg): boolean {
  return cfg?.memory?.disable_write !== true
}
```

- 唯一允许读取 `disable_write` 的访问器（负向字段的单点）
- `!== true`：缺失 / 非布尔 / false → 均允许写
- 业务写路径：`memory-path-guard.ts` 拦截；checkpoint 重建短路为 compaction

### 7.4 相关 dream/distill（节选）

```ts
dream?: { auto?: boolean; interval_days?: number }  // 默认 false / 7
```

---

## 8. 运行时实际数据

> 路径：`C:\Users\微醺\.local\share\mimocode\mimocode.db`  
> 打开方式：`node:sqlite` `DatabaseSync(..., { readOnly: true })`  
> PRAGMA journal_mode = WAL（旁路 `-wal` / `-shm` 文件）

### 8.1 全库对象规模（审计时快照）

| 类别 | 数量 |
|---|---|
| 业务表 + 系统表 | ~34（含 FTS 影子表） |
| 普通索引 | 27 |
| 触发器 | 7（memory×3, history×3+1 part 级, session title guard×1） |
| `__drizzle_migrations` | 56 行 |

### 8.2 Memory 相关行数

| 对象 | 行数 |
|---|---|
| `memory_fts` | **897** |
| `memory_fts_idx`（可计数投影） | 897 |
| `memory_fts_idx_data` | 495 |
| `memory_fts_idx_docsize` | 897 |
| `memory_fts_idx_idx` | 492 |
| `memory_fts_idx_config` | 1 |

### 8.3 抽样行（结构验证）

```
id=1 path=...\memory\projects\9bb2a134-.../MEMORY.md
     scope=projects scope_id=9bb2a134-... type=memory
     fingerprint=5403-1790133424498.3132 last_indexed_at=1793081114143
     body_preview="# Project memory\n_Durable project-level knowledge..."

id=2 path=...\memory\projects\global\MEMORY-20261014-cleanup-and-desktop-diagnostics.md
     scope=projects scope_id=global type=memory
```

确认：`body` 为全文；`fingerprint` 为 `size-mtimeMs`；Windows path 在 DB 中以反斜杠原样存储（`parsePath` 仅在匹配时规范化，`buildPath`/写入用 `path.join` 原生分隔符——抽样显示 DB 内是 `\`）。

> **注意**：代码 `layoutPath` 在 win32 上会把 `\` 换成 `/` 再 match，但 `indexFromDisk` 写入的是 `absPath` 原样（`reconcile.ts:70`），与 Windows 上 `walkMemoryDir` 的 `path.join` 一致。两侧一致即可。

### 8.4 History 对照行数

| 表 | 行数 |
|---|---|
| `history_fts` | 58,380 |
| `history_index_migration` | 7 |
| `message` | 23,227 |
| `part` | 99,687 |

### 8.5 Integrity

只读模式下无法执行 FTS `integrity-check` magic command（需写）。行数 1:1 对齐（content 897 = docsize 897）是健康信号。

---

## 9. Immune Memory Schema

**【代码定义】** `packages/cli/src/metrics/immune-memory.ts`（纯 Zod 类型 + Store 接口；**无 SQLite 表**）。

```ts
export const ImmuneMemoryEntry = z.object({
  id: z.string(),
  anomaly_signature: z.object({
    error_category: z.string(),
    error_name: z.string(),
    tool_name: z.string().optional(),
    error_stage: z.string().optional(),
    message_pattern: z.string().optional(),  // 正则或关键词
  }),
  verified_root_cause: z.string(),
  effective_handling: z.string(),
  verification_evidence: z.array(z.object({
    type: z.enum(["e2e_test", "log", "code_review", "manual"]),
    description: z.string(),
    timestamp: z.string(),
    result: z.string(),
  })),
  applicability: z.object({
    components: z.array(z.string()),
    exclusions: z.array(z.string()).optional(),
  }),
  limitations: z.array(z.string()).optional(),
  confidence: z.enum(["verified", "probable", "unverified"]),
  created_at: z.string(),
  last_verified_at: z.string().optional(),
  related_tests: z.array(z.string()).optional(),
})

export interface ImmuneMemoryStore {
  add(entry): Promise<void>
  find(signature): Promise<ImmuneMemoryEntry[]>
  updateConfidence(id, confidence): Promise<void>
  getVerified(): Promise<ImmuneMemoryEntry[]>
}
```

**状态**：V1 只定义结构，注释明确"未来可接入 SQLite 或文件系统"；运行时库中**无**对应表。

---

## 10. 审计发现与风险备注

1. **命名易混淆**：`memory_fts` 是 content 普通表（非虚表）；真正 FTS5 虚表是 `memory_fts_idx`。查询必须 JOIN 二者。
2. **无自动 GC / TTL**：磁盘文件只 prune 索引行，不删文件；`.md` 堆积靠人工/产品逻辑（spillover 归档可见于 projects/global）。
3. **reconcile 成本**：每次 search 全量 walk + 全表 fingerprint 比对；session 数 ~200+ 时仍可接受，但无增量 watcher。
4. **CJK 分词弱于 History**：memory 用纯 `unicode61`；history 另有 `body_idx` + `history_cjk_unigram` 迁移。中文 memory 检索依赖 Unicode 字母类切分，召回形态与 history 不一致。
5. **cc_index 隐私开关**：开启后 `type: user/feedback` 可被所有 mimocode agent 检索（config 注释已警告）。
6. **disable_write 默认可写**：仅显式 `true` 关闭；写关时 search 仍 reconcile（若 reconcile_on_search）。
7. **源码 vs 运行时迁移漂移**：本机 DB 有 `inbox_queue` 迁移，当前源码 migration 目录无此目录——基线不一致，做 diff 审计时需注意。
8. **Immune Memory 未落地**：仅类型层，无持久化。

---

## 附录 A · 关键文件索引

| 主题 | 路径 |
|---|---|
| Memory FTS 声明 | `packages/cli/src/memory/fts.sql.ts` |
| 路径解析 | `packages/cli/src/memory/paths.ts` |
| 检索服务 | `packages/cli/src/memory/service.ts` |
| 索引同步 | `packages/cli/src/memory/reconcile.ts` |
| FTS 查询构造 | `packages/cli/src/memory/fts-query.ts` |
| 写开关 | `packages/cli/src/memory/write-gate.ts` |
| 规范路径 | `packages/cli/src/session/checkpoint-paths.ts` |
| DB 打开/迁移入口 | `packages/cli/src/storage/db.ts` |
| Replay-safe migrate | `packages/cli/src/storage/migrate-replay-safe.ts` |
| Memory 首建 DDL | `packages/cli/migration/20260515010000_memory_fts/migration.sql` |
| Memory v6 DDL | `packages/cli/migration/20260521010000_memory_fts_v6/migration.sql` |
| Memory 触发器修复 | `packages/cli/migration/20260521020000_memory_fts_triggers/migration.sql` |
| History FTS | `packages/cli/src/history/fts.sql.ts` |
| 配置 schema | `packages/cli/src/config/config.ts` |
| Immune 类型 | `packages/cli/src/metrics/immune-memory.ts` |

## 附录 B · 审计方法

- 全文阅读 schema / 迁移 / 路径 / 配置源文件  
- Grep：`CREATE TABLE|VIRTUAL TABLE|INDEX|TRIGGER|migration|drizzle|memory_fts`  
- `node:sqlite` 只读打开本机 `mimocode.db`：`sqlite_master`、`PRAGMA table_info/index_list`、`COUNT(*)`、抽样 SELECT、`__drizzle_migrations`  
- 未执行任何写操作；`integrity-check` 因只读被拒绝（预期）

---

*报告结束 · 数据模型审计 01e*
