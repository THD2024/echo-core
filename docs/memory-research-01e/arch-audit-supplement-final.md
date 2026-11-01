# ECC-ARCH-AUDIT-R1 补充核查报告

> 任务性质：只读补充审计
> 核查日期：2026-10-31
> 目标：解决第一轮报告的三个证据缺口
> 约束：未修改任何生产代码、测试、配置、Memory 数据

---

## 核查 1：packages 级审计

### 1.1 packages/shared（`@mimo-ai/shared`）

| 字段 | 内容 | 证据 |
|------|------|------|
| 核心职责 | 运行时基础设施工具库（FS 封装、flock 文件锁、路径/XDG 解析、glob、NamedError、slug/hash） | `shared/src/` 目录 |
| 入口 | 无 barrel index；子路径导出 `"./*": "./src/*.ts"` | `package.json:18-20` |
| 运行时逻辑 | **是**（Effect FS 服务、flock 跨进程锁+心跳、global.ts 目录解析） | `filesystem.ts`、`flock.ts` |
| 依赖 CLI | **否**（不 import CLI 源码） | Grep 零命中 |
| 身体核心能力 | **否**（底座工具，非 Agent 业务核心） | 职责分析 |
| 独立生命周期 | **否**（锁文件由调用方写入 state） | 代码分析 |

**定性**：被核心高频依赖的**底座**（CLI 101 处 import），但不是身体核心能力。

**发现**：`package.json` 的 `bin.opencode` 指向不存在的 `bin/`，疑似遗留配置。

### 1.2 packages/plugin（`@mimo-ai/plugin`）

| 字段 | 内容 | 证据 |
|------|------|------|
| 核心职责 | 插件/TUI **扩展接口契约**（Hooks、Tool、Auth、TuiPluginApi、Actor 生命周期钩子、Trajectory 类型） | `plugin/src/` |
| 入口 | `.` / `./tool` / `./tui` | `package.json:26-30` |
| 运行时逻辑 | **极少**（仅 `tool()` 透传工厂 + 常量数组）；几乎全是 type 定义 | 代码分析 |
| 依赖 CLI | **否**（type-only import `@mimo-ai/sdk`） | Grep |
| 身体核心能力 | **否**（接口契约，宿主在 CLI） | 职责分析 |
| 独立生命周期 | **否** | 代码分析 |

**定性**：**纯类型/接口契约包**。`BUILT_IN_AGENTS` 硬编码名单（`plugin/src/index.ts:232-235`）是接口包携带跨层知识的耦合点。

### 1.3 packages/sdk（`@mimo-ai/sdk`）

| 字段 | 内容 | 证据 |
|------|------|------|
| 核心职责 | OpenAPI 生成客户端包装 + `createOpencodeServer/Tui` 进程启动器 | `sdk/src/` |
| 入口 | `.` / `./client` / `./server` / `./v2*` | `package.json` |
| 运行时逻辑 | **是**（fetch 拦截器注入 header、cross-spawn 启动 `opencode serve`、taskkill 停进程） | `server.ts:35` |
| 依赖 CLI | **否**（代码级不 import；运行时 spawn CLI 二进制） | `process.ts:3-4` 注释 |
| 身体核心能力 | **否**（API 客户端包装，非服务端实现） | 职责分析 |
| 独立生命周期 | **拥有子进程生命周期**；无业务持久化 | 代码分析 |

**定性**：SDK 客户端 + 进程启动器。唯一运行时依赖 `cross-spawn`。

### 1.4 依赖方向总结

```
CLI ──► shared（运行时）
CLI ──► plugin（type-only 为主）
CLI ──► sdk（type + 少数运行时）
plugin ──(type)──► sdk
sdk ──(运行时 spawn)──► `opencode` 二进制（CLI 提供）
```

**关键事实**：
- 三包均不反向依赖 CLI 源码
- 唯一反向边：SDK 运行时 spawn CLI 提供的 `opencode` 二进制
- 为避免循环，SDK 复制了 CLI 的 process 工具（`sdk/src/process.ts:3-4` 注释自认）
- 三包均**不承担身体核心能力**

**证据等级**：VERIFIED（来自代码路径和 Grep 分析）

---

## 核查 2：证据时间与代码基线

### 2.1 代码基线

| 项目 | 值 |
|------|-----|
| Git HEAD | `a5d7813a95bd4e249be2feeee21b26d6b265a15d` |
| 提交时间 | 2026-10-31 19:29:02 +0800 |
| 提交信息 | `fix(observability): emit error ToolCall for bash nonzero exit (L2, EC-PHASE2-P0-02)` |
| 工作区差异 | 仅 `bun.lock` 修改（行尾符），**无源码变更** |

### 2.2 五份子审计时间戳

| 文件 | 写入时间 | 审计轮次 |
|------|---------|---------|
| arch-audit-01-structure-lifecycle.md | 2026-10-31 23:21:18 | 第一轮 |
| arch-audit-02-core-modules.md | 2026-10-31 23:23:12 | 第一轮 |
| arch-audit-03-agent-model-runtime.md | 2026-10-31 23:19:50 | 第一轮 |
| arch-audit-04-dependencies.md | 2026-10-31 23:22:13 | 第一轮 |
| arch-audit-05-memory-connections.md | 2026-10-31 23:26:05 | 第一轮 |

### 2.3 本轮重新核对结果

| 审计 | 本轮核对 | 结论变化 |
|------|---------|---------|
| arch-audit-01 | ✅ 已核对 | 无变化（Git HEAD 未变） |
| arch-audit-02 | ✅ 已核对 | 无变化 |
| arch-audit-03 | ✅ 已核对 | 无变化 |
| arch-audit-04 | ✅ 已核对 | 无变化 |
| arch-audit-05 | ✅ 已核对 | 无变化 |

**关键结论**：五份子审计均基于同一 Git 基线 `a5d7813a`（19:29:02），写入时间在 23:19-23:26 之间。本轮核查确认 HEAD 未变，工作区无源码变更，**所有结论仍然成立**。

**证据等级**：VERIFIED（来自 `git log` 和文件时间戳）

---

## 核查 3：Reconcile 数据方向

### 3.1 六个问题逐条回答

| # | 问题 | 回答 | 证据 |
|---|------|------|------|
| Q1 | Markdown 是否唯一权威数据源？ | **是** | `reconcile.ts:60` `Bun.file(absPath).text()` 从磁盘读取 |
| Q2 | SQLite FTS5 是否只是可重建索引？ | **是** | `reconcile.ts:66-90` upsert 写入；可从磁盘重建 |
| Q3 | Reconcile 是否只执行磁盘到索引的同步？ | **是（内容方向）**；但有索引清理（见 Q4） | `reconcile.ts:122-141` Direction A |
| Q4 | 是否存在索引数据反向写入 Markdown 的业务路径？ | **否** | 全代码库无此路径 |
| Q5 | 写入文件后索引如何更新？ | **延迟更新**：bootstrap reconcile 或 search 前 lazy reconcile | `service.ts:46-64`、`bootstrap.ts:52` |
| Q6 | 文件删除/修改/重命名时索引如何处理？ | **删除→prune；修改→fingerprint 变化重索引；重命名→旧 prune + 新索引** | `reconcile.ts:113-120` |

### 3.2 reconcile 完整行为分析

```
reconcileMemory(roots)
    │
    ├── 1. 收集磁盘文件路径（walkMemoryDir + walkCcRoot）
    │
    ├── 2. 读取 SQLite 已索引路径和 fingerprint
    │
    ├── 3. Direction B: prune 死行
    │   └── SQLite 中有但磁盘上没有的路径 → DELETE
    │       （reconcile.ts:113-120）
    │
    └── 4. Direction A: 索引磁盘文件
        ├── 读取文件内容（reconcile.ts:60）
        ├── 计算 fingerprint = "{size}-{mtimeMs}"（reconcile.ts:57）
        ├── 与旧 fingerprint 比较（reconcile.ts:58）
        └── 变化则 upsert 到 SQLite（reconcile.ts:66-90）
```

### 3.3 数据流方向修正

**原报告表述**："磁盘 → SQLite 单向 reconcile"

**修正后精确表述**：
- **内容流**：磁盘 → SQLite **单向**（Markdown 是权威源，SQLite 只存副本用于索引）
- **同步逻辑**：**双向**（Direction A 索引新增/更新 + Direction B 清理死行）
- **无反向写入**：SQLite 数据**永远不会**写回 Markdown 文件

**关键代码证据**：

| 行为 | 代码位置 | 方向 |
|------|---------|------|
| 读取磁盘文件 | `reconcile.ts:60` | 磁盘 → 内存 |
| 写入 SQLite | `reconcile.ts:66-90` | 内存 → SQLite |
| 删除 SQLite 死行 | `reconcile.ts:117` | SQLite → 删除 |
| 写回 Markdown | **不存在** | — |

### 3.4 文件变更处理细节

| 变更类型 | 处理方式 | 证据 |
|---------|---------|------|
| **新建文件** | fingerprint 为 undefined → upsert | `reconcile.ts:58` `oldFingerprint === fingerprint` 为 false |
| **修改文件** | size/mtime 变化 → fingerprint 变化 → upsert | `reconcile.ts:57` |
| **删除文件** | 磁盘无此路径 → prune DELETE | `reconcile.ts:116-118` |
| **重命名文件** | 旧路径 prune + 新路径 upsert | `reconcile.ts:113-141` |
| **无变化文件** | fingerprint 相同 → skip | `reconcile.ts:58` 返回 `"hit"` |

### 3.5 索引更新时机

| 时机 | 触发者 | 证据 |
|------|--------|------|
| Bootstrap | `InstanceBootstrap` detached 后台 | `bootstrap.ts:52` |
| Search 前 | `Memory.Service.search` lazy reconcile | `service.ts:46-64` |
| Rebuild 前 | 上下文重建前 | `prompt.ts` |
| 手动 | 无独立 CLI 命令 | 代码分析 |

**证据等级**：VERIFIED（来自 reconcile.ts 全量阅读和代码路径追踪）

---

## 总结

| 核查项 | 结论 |
|--------|------|
| packages 审计 | 三包均不承担身体核心能力；shared 是底座，plugin 是接口契约，sdk 是客户端包装 |
| 证据基线 | 五份子审计均基于 `a5d7813a`（19:29:02）；本轮确认无变化，结论仍成立 |
| Reconcile 方向 | 内容流单向（磁盘→SQLite）；同步逻辑双向（索引+清理）；无反向写入 |

---

*本补充报告仅包含三项核查结果，不重新生成第一轮完整报告。*
