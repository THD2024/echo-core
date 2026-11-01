# Echo Core / MiMoCode 架构审计 01：项目整体结构与启动生命周期

- **审计范围**：`D:\EchoCore\MiMo-Code\packages\cli\src\`（只读）
- **项目根**：`D:\EchoCore\MiMo-Code\`
- **审计模式**：只读，不修改任何源码
- **证据等级**：VERIFIED / IMPLEMENTED_UNVERIFIED / PARTIAL / DESIGN_ONLY / NOT_IMPLEMENTED / UNKNOWN
- **日期**：基于当前工作区快照

---

## 1. 项目目录树（保留 2-3 层深度）

```
D:\EchoCore\MiMo-Code\                          # monorepo 根（name: "opencode"）
├── package.json                                # workspaces + catalog 锁版本
├── tsconfig.json                               # project references: cli/shared/plugin/sdk
├── bun.lock / bunfig.toml                      # Bun 运行时锁与配置
├── script/                                     # 发布/构建/格式化等仓库级脚本
├── patches/                                    # 第三方依赖 patch
├── docs/                                       # 设计/spec 文档
└── packages/
    ├── cli/                                    # 主应用（@mimo-ai/cli, bin: mimo）
    │   ├── package.json                        # 依赖、#db/#pty/#hono 条件导入
    │   ├── test/                               # bun 测试（session/memory/cron/...）
    │   └── src/
    │       ├── index.ts                        # CLI 主入口（yargs + 全局 middleware）
    │       ├── node.ts                         # Node 环境 re-export bootstrap
    │       ├── temporary.ts                    # 临时入口（dev:temporary）
    │       ├── cli/                            # CLI 层：命令、TUI、bootstrap、UI
    │       │   ├── bootstrap.ts                # headless 命令统一启动/ teardown
    │       │   ├── ui.ts / network.ts / heap.ts
    │       │   └── cmd/                        # yargs 子命令
    │       │       ├── serve.ts                # `mimo serve` headless HTTP
    │       │       ├── run.ts                  # `mimo run` 一次性 prompt
    │       │       ├── tui/                    # TUI（默认命令 $0）
    │       │       │   ├── thread.ts           # 主线程入口（Worker 拉起）
    │       │       │   ├── worker.ts           # Worker：RPC + Server
    │       │       │   ├── app.tsx             # Solid TUI 应用
    │       │       │   └── context/            # TUI 状态（sync/bootstrap）
    │       │       └── ...                     # providers/agent/mcp/db/session 等
    │       ├── project/                        # 实例（directory 级）生命周期
    │       │   ├── instance.ts                 # Instance.provide / dispose
    │       │   ├── bootstrap.ts                # InstanceBootstrap Effect 编排
    │       │   └── project.ts / workspace-trust.ts
    │       ├── effect/                         # Effect 运行时与实例状态
    │       │   ├── app-runtime.ts              # AppLayer 全量服务图
    │       │   ├── instance-registry.ts        # disposer 注册与执行
    │       │   └── instance-state.ts           # 按 directory 缓存的服务状态
    │       ├── config/                         # 多层配置加载与 schema
    │       ├── storage/                        # SQLite + Drizzle + 迁移
    │       ├── server/                         # Hono HTTP/WS 服务
    │       ├── provider/                       # AI Provider 目录/SDK 解析
    │       ├── session/                        # 会话、消息、checkpoint、prompt
    │       ├── tool/                           # 工具定义与 ToolRegistry
    │       ├── memory/                         # Memory FTS 索引与 reconcile
    │       ├── plugin/                         # 插件加载/内置 auth 插件
    │       ├── agent/ skill/ mcp/ lsp/ pty/    # 能力子系统
    │       ├── auth/ account/ share/ sync/     # 账号与分享
    │       ├── bus/ metrics/ history/ actor/   # 事件、指标、历史、actor
    │       ├── flag/ global/ util/ id/ error/  # 基础设施
    │       └── command/ control-plane/ cron/   # 命令、控制面、定时
    │           llm-server/ workflow/ worktree/ # LLM 服务、工作流、worktree
    ├── shared/                                 # @mimo-ai/shared 共享工具
    ├── plugin/                                 # @mimo-ai/plugin 插件类型/示例
    └── sdk/                                    # @mimo-ai/sdk 客户端 SDK
```

### 核心源码目录职责

| 目录 | 职责 | 等级 |
|------|------|------|
| `packages/cli/src/cli/` | CLI 命令注册、TUI 宿主、统一 bootstrap | VERIFIED |
| `packages/cli/src/project/` | 目录级 Instance 创建/销毁/门控 | VERIFIED |
| `packages/cli/src/effect/` | Effect AppRuntime、InstanceState、disposer | VERIFIED |
| `packages/cli/src/config/` | 多源配置合并（全局/项目/环境/managed） | VERIFIED |
| `packages/cli/src/storage/` | SQLite 打开、SQL 迁移、JSON→SQLite 迁移 | VERIFIED |
| `packages/cli/src/server/` | Hono 路由、Instance 中间件、事件流 | VERIFIED |
| `packages/cli/src/session/` | Session CRUD、prompt 循环、checkpoint | VERIFIED |
| `packages/cli/src/tool/` | 内置工具与 ToolRegistry | VERIFIED |
| `packages/cli/src/provider/` | models.dev、provider SDK、模型解析 | VERIFIED |
| `packages/cli/src/memory/` | memory 根目录、FTS5、reconcile | VERIFIED |
| `packages/cli/test/` | 功能测试（非 `src` 内嵌） | VERIFIED |

---

## 2. 技术栈清单

| 技术 | 版本 | 用途 | 证据 |
|------|------|------|------|
| Bun | `packageManager: bun@1.3.14` | 运行时 / 测试 / 构建 | `package.json:7` VERIFIED |
| TypeScript | catalog `5.8.2` | 主语言 | 根 `package.json:56` |
| yargs | `18.0.0` | CLI 解析 | `packages/cli/package.json:189`；`src/index.ts:1` |
| Effect | catalog `4.0.0-beta.48` | 服务图 / 异步编排 | `src/effect/app-runtime.ts`；`src/project/bootstrap.ts:14` |
| Hono | catalog `4.10.7` | HTTP/WS 服务器 | `src/server/server.ts:2`；`#hono` 条件导入 |
| Drizzle ORM | catalog `1.0.0-beta.19-...` | SQLite ORM | `src/storage/db.ts`；`drizzle-orm/bun-sqlite` |
| SQLite (Bun) | 内置 / `#db` | 持久化 | `packages/cli/package.json:28-31`；`src/storage/db.bun.ts` |
| SolidJS + OpenTUI | solid `1.9.10`；`@opentui/* 0.1.101` | TUI 渲染 | `packages/cli/package.json:132-133`；`src/cli/cmd/tui/app.tsx` |
| Vercel AI SDK (`ai` + `@ai-sdk/*`) | catalog `ai 6.0.168` | 多 Provider LLM 调用 | `packages/cli/package.json:87-106` |
| Zod | catalog `4.1.8` | 配置/路由校验 | 多处 config/server 引用 |
| MCP SDK | `@modelcontextprotocol/sdk 1.27.1` | MCP 客户端 | `package.json:120`；`src/mcp/` |
| ACP SDK | `@agentclientprotocol/sdk 0.16.1` | Agent Client Protocol | `package.json:86`；`src/acp/` |
| oxlint + tsgo | root scripts | Lint / typecheck | 根 `package.json:11-12` |
| Bun test | 超时 30s/120s | 单元/集成测试 | `packages/cli/package.json:14-15` |

**主要语言/框架/运行时**：TypeScript ESM + Bun 运行时 + Effect 服务层 + Hono 服务器 + Solid/OpenTUI 终端 UI。VERIFIED

---

## 3. 入口与启动链

### 3.1 CLI 进程入口（所有命令共用）

```
mimo bin (`bin.mimo` → ./mimo.js)
  → packages/cli/src/index.ts
```

| 步骤 | 位置 | 行为 | 等级 |
|------|------|------|------|
| 1. 进程元数据 | `src/index.ts:50` | `ensureProcessMetadata("main")` | VERIFIED |
| 2. models.dev 后台刷新 | `src/index.ts:51` | `ModelsDev.startRefresh()` | VERIFIED |
| 3. 异常钩子 | `src/index.ts:53-63` | `unhandledRejection` / `uncaughtException` 仅记日志 | VERIFIED |
| 4. yargs middleware | `src/index.ts:99-187` | `--pure` → env；`Log.init`；`Heap.start`；env（AGENT/MIMOCODE/PID） | VERIFIED |
| 5. JSON→SQLite 一次性迁移 | `src/index.ts:127-162` | 若无 `mimocode.db` marker，跑 `JsonMigration.run` | VERIFIED |
| 6. 可选 Claude 导入 | `src/index.ts:167-174` | flag 开启时 `ClaudeImport.run()` | VERIFIED |
| 7. Windows 清理 `.old_*` | `src/index.ts:177-186` | win32 升级残留清理 | VERIFIED |
| 8. 命令注册 | `src/index.ts:190-214` | TuiThread/Attach/Run/Serve/... | VERIFIED |
| 9. parse + finally 退出 | `src/index.ts:230-286` | `Log.shutdown()` + `process.exit()` | VERIFIED |

### 3.2 默认 TUI 链（`mimo` / `mimo [project]`）

| 步骤 | 位置 | 行为 | 等级 |
|------|------|------|------|
| 1 | `src/cli/cmd/tui/thread.ts:157-158` | `TuiThreadCommand` command=`$0 [project]` | VERIFIED |
| 2 | `thread.ts:213-217` | Win32 禁用 processed input / Ctrl+C guard | VERIFIED |
| 3 | `thread.ts:227-248` | chdir + workspace trust 门禁 | VERIFIED |
| 4 | `thread.ts:266-273` | 创建 Worker（`worker.ts` / `worker.js`），env role=worker | VERIFIED |
| 5 | `thread.ts:284-312` | RPC client；shutdown 时 `shutdown` + `terminate` | VERIFIED |
| 6 | `thread.ts:314-349` | 读 TuiConfig；选择 in-process fetch 或 external HTTP；必要时 bind loopback server | VERIFIED |
| 7 | `thread.ts:356-376` | `tui({ url, fetch, events, args })` 进入 Solid TUI | VERIFIED |
| Worker 侧 | `src/cli/cmd/tui/worker.ts:20-151` | metadata、ModelsDev、Log、Heap、GlobalBus 转发、RPC 表、`Server.listen` 幂等 | VERIFIED |
| HTTP 请求进入 Instance | `src/server/routes/instance/middleware.ts:50-56` | `Instance.provide({ init: InstanceBootstrap })` | VERIFIED |
| TUI 数据 bootstrap | `src/cli/cmd/tui/context/sync.tsx:817+` | 拉取 providers/config/agents/mcp 等 | PARTIAL（UI 层，非进程生命周期核心） |

### 3.3 `mimo serve` 链

| 步骤 | 位置 | 行为 | 等级 |
|------|------|------|------|
| 1 | `src/cli/cmd/serve.ts:11-27` | 解析网络选项；非 loopback 强制密码；`Server.listen` | VERIFIED |
| 2 | `src/server/server.ts:98-125` | 安全检查 → `create(opts)` → `runtime.listen` | VERIFIED |
| 3 | `server.ts:39-74` | 中间件栈 + Instance/ControlPlane/UI 路由 | VERIFIED |
| 4 | `serve.ts:31-40` | SIGINT/SIGTERM → `server.stop(true)` → `process.exit`；主循环挂起 | VERIFIED |

### 3.4 `mimo run` 链

| 步骤 | 位置 | 行为 | 等级 |
|------|------|------|------|
| 1 | `src/cli/cmd/run.ts:316-366` | 消息/文件/目录参数校验 | VERIFIED |
| 2 | `run.ts:709-718` | `--attach` 远程 SDK 客户端路径 | VERIFIED |
| 3 | `run.ts:721-728` | 本地路径：`bootstrap(cwd, …)` + 内存 fetch 到 `Server.Default()` | VERIFIED |
| 4 | `run.ts:387-401` | 经 SDK 创建/续用/fork session | VERIFIED |
| 5 | `run.ts:648-706` | 订阅事件流、prompt/command、完成 tracker | VERIFIED |

### 3.5 统一 headless bootstrap 壳

```
bootstrap(directory, cb)                          # src/cli/bootstrap.ts:10
  → HostErrorRegistry.initializeHostErrorCatalog  # :11
  → Instance.provide({ directory, init: AppRuntime(InstanceBootstrap), fn: cb })
  → finally: SessionCheckpoint.drainWriters()     # :28-30
  → Instance.dispose()                            # :31
```
VERIFIED（`src/cli/bootstrap.ts:10-34`）

---

## 4. 初始化顺序（配置→数据库→Provider→Session→Tool→Memory）

> 说明：数据库在**进程 middleware** 层惰性打开；Provider / Session / Tool 为 **Effect InstanceState 惰性构造**，不在 `InstanceBootstrap` 里强制 eager。以下按「首次真正触发」的顺序编号。

### 步骤 0 — 进程级全局路径与日志（Instance 之前）

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 0.1 | 模块加载时创建 data/config/state/log/bin 目录、cache 版本失效 | `src/global/index.ts:27-52` | VERIFIED |
| 0.2 | `Log.init`、`Heap.start`、env 标记 | `src/index.ts:104-118` | VERIFIED |
| 0.3 | JSON→SQLite 一次性迁移（可选路径） | `src/index.ts:127-162` | VERIFIED |
| 0.4 | `ModelsDev.startRefresh()` 后台拉模型目录 | `src/index.ts:51`；`worker.ts:21` | VERIFIED |

### 步骤 1 — Instance 创建与配置加载

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 1.1 | `Instance.provide` 解析目录、安全目录断言、门控并发 | `src/project/instance.ts:173-200`；`assertSafeDirectory:90-101` | VERIFIED |
| 1.2 | `Project.Service.fromDirectory` 解析 project/worktree | `instance.ts:113-119` | VERIFIED |
| 1.3 | 运行 `InstanceBootstrap` | `cli/bootstrap.ts:14`；`server/routes/instance/middleware.ts:52` | VERIFIED |
| 1.4 | **配置 eager 加载**：`Config.Service.get()` | `project/bootstrap.ts:24` | VERIFIED |
| 1.5 | 配置文件候选：`mimocode.jsonc` / `mimocode.json` / `config.json` | `config/config.ts:528-535` | VERIFIED |
| 1.6 | 加载顺序：全局 → 自定义 `MIMOCODE_CONFIG` → 项目向上查找 → `.mimocode` 目录 → Claude 兼容 → env 内容 → managed/defaults | `config/config.ts:811-990` | VERIFIED |
| 1.7 | 路径发现：`ConfigPaths.files/directories` | `config/paths.ts:12-43` | VERIFIED |

### 步骤 2 — 数据库初始化

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 2.1 | `Database.Client` 为 **lazy** 首次访问时打开 | `storage/db.ts:85-119` | VERIFIED |
| 2.2 | 打开后 PRAGMA（busy_timeout/WAL/synchronous/foreign_keys…） | `db.ts:92-97` | VERIFIED |
| 2.3 | 应用 migration（bundled `MIMOCODE_MIGRATIONS` 或 `migration/*.sql`） | `db.ts:101-116`；`migrateReplaySafe` | VERIFIED |
| 2.4 | FTS 索引迁移 `startIndexMigration` | `db.ts:117` | VERIFIED |
| 2.5 | 进程入口 JSON 迁移在 middleware 里**提前**触达 `Database.Client()` | `index.ts:138` | VERIFIED |
| 2.6 | 提供方：`Storage.defaultLayer` 挂入 AppRuntime | `effect/app-runtime.ts:78` | VERIFIED |
| 2.7 | **何时进入 InstanceBootstrap 路径**：`Config.get` 内部及后续服务依赖 Storage；Client 仍惰性 | `db.ts:85` | IMPLEMENTED_UNVERIFIED（首个业务读写时机未在本审计中运行验证） |

### 步骤 3 — Plugin（先于其它能力服务）

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 3.1 | `Plugin.Service.init()` 在 bootstrap 中紧随 Config | `project/bootstrap.ts:25-26` | VERIFIED |
| 3.2 | 注释明确：Plugin 可改配置，故必须先于其它初始化 | `bootstrap.ts:25-26` | VERIFIED |

### 步骤 4 — 并行后台服务 init（非阻塞）

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 4.1 | forkDetach 并行 `init()`：LSP / ShareNext / Format / File / FileWatcher / Vcs / Snapshot / WriterService | `project/bootstrap.ts:36-47` | VERIFIED |
| 4.2 | Actor 僵尸清扫 | `bootstrap.ts:29-35`；`actor/registry` sweepAbandonedZombies | VERIFIED |
| 4.3 | Bus 订阅 Command.INIT → `Project.setInitialized` | `bootstrap.ts:59-65` | VERIFIED |
| 4.4 | Metrics 订阅 | `bootstrap.ts:67` | VERIFIED |

### 步骤 5 — Memory 初始化（异步，不阻塞启动）

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 5.1 | `Memory.Service.reconcile()` forkDetach；失败仅 warn | `project/bootstrap.ts:52-57` | VERIFIED |
| 5.2 | Memory root = `{Global.Path.data}/memory`；可选 Claude projects 索引 | `memory/service.ts:39-49` | VERIFIED |
| 5.3 | 搜索时可再次 lazy reconcile（默认开） | `memory/service.ts:59-64`；config `memory_reconcile_on_search` | VERIFIED |
| 5.4 | FTS5 BM25 检索 + 相对阈值过滤 | `memory/service.ts:66-80` | IMPLEMENTED_UNVERIFIED |

### 步骤 6 — Provider 初始化（惰性 InstanceState）

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 6.1 | Provider 状态由 `InstanceState.make` 基于 `config.get()` 构建 | `provider/provider.ts:1624-1626` | VERIFIED |
| 6.2 | `list/getProvider/getModel` 读该状态 | `provider.ts:1649,1800-1820` | VERIFIED |
| 6.3 | 配置变更热更新：`prepareRefresh`（新 SDK 包需重启） | `provider.ts:1628-1647` | VERIFIED |
| 6.4 | models.dev 刷新成功可 `Instance.disposeAll()` 触发重建 | `tui/worker.ts:22-28` | VERIFIED |
| 6.5 | **不在 InstanceBootstrap 中显式 `Provider.init`** | `project/bootstrap.ts` 无 Provider 调用 | NOT_APPLICABLE（设计为惰性） |

### 步骤 7 — Session 创建

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 7.1 | `Session.create` Effect：directory/workspace/permission/parent | `session/session.ts:774-799` | VERIFIED |
| 7.2 | CLI `run` 经 SDK `sdk.session.create` | `cli/cmd/run.ts:399-401` | VERIFIED |
| 7.3 | 服务路由 session CRUD | `server/routes/instance/session.ts`（引用存在） | IMPLEMENTED_UNVERIFIED（路由内部未逐行审计） |
| 7.4 | Session 为 AppRuntime 图中的一等服务 | `app-runtime.ts:89` | VERIFIED |

### 步骤 8 — Tool 注册

| # | 内容 | 证据 | 等级 |
|---|------|------|------|
| 8.1 | `ToolRegistry` 挂入 AppRuntime | `app-runtime.ts:105` | VERIFIED |
| 8.2 | 内置工具列表在 `ToolRegistry.state` 组装：bash/read/edit/write/glob/grep/actor/skill/memory/… | `tool/registry.ts:256-285` | VERIFIED |
| 8.3 | 实验工具受 Flag 控制（lsp/cron/workflow） | `registry.ts:277-284` | VERIFIED |
| 8.4 | 插件/MCP 自定义工具与 builtin 合并，同名冲突时 builtin 被 custom 覆盖（reserved 除外） | `registry.ts:292-304` | VERIFIED |
| 8.5 | 注册时机：首次请求 `ToolRegistry.all/tools/definitions` 时惰性 init | `registry.ts:172+` | IMPLEMENTED_UNVERIFIED（未逐步跟到每次 prompt 的调用点） |

### 推荐记忆序（进程视角）

```
bin/mimo
  → index.ts (Log/Heap/env/JSON migrate)
  → command handler
      serve  → Server.listen（Instance 惰性于请求）
      run    → cli/bootstrap → InstanceBootstrap
      tui    → thread → worker RPC → Server + InstanceMiddleware
  → InstanceBootstrap:
      Config.get → Plugin.init → (parallel LSP/Share/VCS/…)
      → Memory.reconcile (detached)
  → 首次需要时：
      Database.Client (lazy) → Provider InstanceState → ToolRegistry → Session.create
```

---

## 5. 退出与清理

| 场景 | 行为 | 证据 | 等级 |
|------|------|------|------|
| CLI 主入口 finally | `Log.shutdown()` → `process.exit()`；异常设 `exitCode=1` | `src/index.ts:278-285` | VERIFIED |
| `Log.exit(code)` | shutdown 后 `process.exit(code)` | `util/log.ts:205-208` | VERIFIED |
| headless bootstrap finally | `SessionCheckpoint.drainWriters()`（最长约 120s 语义注释）→ `Instance.dispose()` | `cli/bootstrap.ts:18-31` | VERIFIED |
| TUI 主线程 stop | RPC `shutdown`（5s 超时）→ `worker.terminate()` | `tui/thread.ts:300-311` | VERIFIED |
| Worker shutdown | Log.flush → checkpoint drain(30s) → `Instance.disposeAll` → `server.stop(true)` → 清密码 → `Log.shutdown` | `tui/worker.ts:118-148` | VERIFIED |
| Instance dispose | 请求计数门控 → `disposeCached` → `disposeInstance`（normal/late disposer）→ 发 `server.instance.disposed` | `project/instance.ts:145-170,332-345`；`effect/instance-registry.ts:19-31` | VERIFIED |
| InstanceState 释放 | ScopedCache invalidate（按 directory） | `effect/instance-state.ts:67-70,97-99` | VERIFIED |
| serve 信号 | SIGINT/SIGTERM → `server.stop(true)` → `process.exit` | `cli/cmd/serve.ts:31-38` | VERIFIED |
| Server.stop | 先 unpublish llm-server 广告，再停 socket | `server/server.ts:171-181` | VERIFIED |
| HTTP dispose 路由 | `/instance/dispose`、`/dispose` 主动释放 | `server/routes/instance/index.ts:73-90`；`routes/global.ts:234-251` | VERIFIED |
| yargs fail | `Log.exit(1)` + `CLI_EXIT` 哨兵 | `src/index.ts:215-227` | VERIFIED |

### 退出路径缺口（与第 6 节交叉）

- `Database.close()` 已实现（`storage/db.ts:121-125`），但 **grep 未发现** headless/TUI/serve 正常退出路径显式调用。依赖进程退出 / WAL 自愈。**PARTIAL / 潜在 NOT_IMPLEMENTED 接线**
- `AppRuntime.dispose()` 暴露（`app-runtime.ts:151`），主路径未在 teardown 中显式调用。**UNKNOWN（是否由 Instance disposer 间接覆盖需运行验证）**
- serve 主路径 `await new Promise(() => {})` 永不 resolve，仅靠信号退出。**VERIFIED**

---

## 6. 缺失环节（明确标注）

| 环节 | 状态 | 说明 | 等级 |
|------|------|------|------|
| 统一「启动阶段机」（explicit phase machine） | 不存在 | 初始化由 yargs middleware + InstanceBootstrap + 惰性 InstanceState 拼接，无单一状态机 | VERIFIED |
| Provider 显式启动阶段 | 不存在于 Bootstrap | 设计为 InstanceState 惰性；无 `Provider.init()` 步骤 | VERIFIED（设计如此） |
| Session 显式启动阶段 | 不存在 | Session 在首次 create/prompt 时构造，非进程启动步骤 | VERIFIED |
| Tool 显式启动阶段 | 不存在于 Bootstrap | ToolRegistry 惰性 state；内置列表在 registry 内 | VERIFIED |
| Database 在 InstanceBootstrap 中显式打开 | 不存在 | Client 惰性；JSON 迁移路径会在 middleware 提前触达 | PARTIAL |
| 进程退出时 `Database.close()` 接线 | 未接线 | 函数存在，主退出链未调用 | NOT_IMPLEMENTED（接线） |
| 进程退出时 `AppRuntime.dispose()` 接线 | 未在主链发现 | 可能部分由 Instance dispose 覆盖 | UNKNOWN |
| SIGINT/SIGTERM 在 **CLI 索引入口** 的统一 handler | 无 | 仅 serve 与 TUI 线程处理；`index.ts` 全局只有 unhandled* 日志钩子 | VERIFIED |
| 热重载配置 | 存在 | `Config.invalidate`；TUI SIGUSR2 → worker `reload` | VERIFIED |
| 多 Workspace 控制面 | 部分存在 | `MIMOCODE_WORKSPACE_ID` 分支走 Workspace 中间件；默认 ControlPlane 路由 | PARTIAL |
| Web 命令 | 暂时禁用 | `index.ts:30-31,204-205` 注释掉 WebCommand | VERIFIED |
| 独立 TUI 进程内嵌 Server 关闭与 Worker 生命周期一致性 | 已实现双路径 | thread 终止 worker；worker 自身 disposeAll+stop | VERIFIED |
| 优雅关闭时 MCP/子进程统一 registry | 部分 | bash-interactive / Actor 等有独立机制；未见单一「所有子进程」关闭清单 | PARTIAL |

---

## 7. 证据索引（关键 path:line）

| 主题 | path:line |
|------|-----------|
| CLI 入口 middleware | `packages/cli/src/index.ts:99-187` |
| CLI finally 退出 | `packages/cli/src/index.ts:279-286` |
| 默认 TUI 命令 | `packages/cli/src/cli/cmd/tui/thread.ts:157-384` |
| Worker RPC/teardown | `packages/cli/src/cli/cmd/tui/worker.ts:61-149` |
| serve | `packages/cli/src/cli/cmd/serve.ts:7-41` |
| run + bootstrap | `packages/cli/src/cli/cmd/run.ts:721-728` |
| headless bootstrap | `packages/cli/src/cli/bootstrap.ts:10-34` |
| InstanceBootstrap | `packages/cli/src/project/bootstrap.ts:21-68` |
| Instance 生命周期 | `packages/cli/src/project/instance.ts:104-346` |
| Disposer 注册表 | `packages/cli/src/effect/instance-registry.ts:8-31` |
| AppRuntime 服务图 | `packages/cli/src/effect/app-runtime.ts:66-151` |
| Config 加载 | `packages/cli/src/config/config.ts:528-990` |
| 配置路径 | `packages/cli/src/config/paths.ts:12-43` |
| Database 惰性打开 | `packages/cli/src/storage/db.ts:85-125` |
| Memory | `packages/cli/src/memory/service.ts:35-64` |
| Provider 惰性 | `packages/cli/src/provider/provider.ts:1624-1647` |
| ToolRegistry 内置 | `packages/cli/src/tool/registry.ts:256-285` |
| Session.create | `packages/cli/src/session/session.ts:774-799` |
| Instance HTTP 中间件 | `packages/cli/src/server/routes/instance/middleware.ts:12-59` |
| Global paths | `packages/cli/src/global/index.ts:10-52` |
| Log.exit/shutdown | `packages/cli/src/util/log.ts:190-208` |

---

## 8. 审计结论摘要

1. **结构**：Bun monorepo，主程序在 `packages/cli`，按领域目录切分（config/storage/server/session/tool/provider/memory/project/effect/cli），Effect 承载依赖注入与实例状态，Hono 承载 HTTP，OpenTUI/Solid 承载终端 UI。
2. **启动**：入口统一走 `index.ts` → yargs；进程级只做日志/堆/环境/一次性 JSON 迁移。真正「项目上下文」由 `Instance.provide + InstanceBootstrap` 建立，Config 与 Plugin 为唯一显式 eager 步骤。
3. **数据库 / Provider / Session / Tool** 多为惰性，不构成严格线性启动序列；Memory reconcile 为非阻塞后台步。
4. **退出**：三条主链（CLI finally、headless bootstrap finally、TUI worker shutdown）相对完整；`Database.close` 与 `AppRuntime.dispose` 在主链上接线不完整或未验证。
5. **风险点**：serve 无 graceful drain 之外的 Instance dispose 调用；CLI 全局无信号处理；进程退出依赖 `process.exit` 硬切。

---

*本报告为只读审计产物，不包含任何代码修改。*
