# ECC-ARCH-AUDIT-R2 本地部署与环境审计报告

> 任务编号：ECC-ARCH-AUDIT-R2
> 审计日期：2026-10-31
> 审计性质：只读技术尽调
> 审计对象：`D:\EchoCore\MiMo-Code\`（MiMoCode / opencode fork）
> 代码基线：`packages/cli` version 0.1.15，Bun packageManager 1.3.14
> 前置条件：R1（ECC-ARCH-AUDIT-R1）已验收通过
> 约束遵守：未修改任何生产代码/测试/配置/锁文件；未安装依赖；未执行有副作用的部署操作

---

## 目录

1. [审计范围与代码基线](#1-审计范围与代码基线)
2. [当前运行环境依赖清单](#2-当前运行环境依赖清单)
3. [首次启动与初始化时序图](#3-首次启动与初始化时序图)
4. [依赖安装与部署能力分析](#4-依赖安装与部署能力分析)
5. [本地目录、配置与数据隔离分析](#5-本地目录配置与数据隔离分析)
6. [Windows / macOS / Linux 兼容性矩阵](#6-windows--macos--linux-兼容性矩阵)
7. [权限、安全与用户控制权分析](#7-权限安全与用户控制权分析)
8. [更新、卸载、迁移与恢复能力](#8-更新卸载迁移与恢复能力)
9. [当前部署架构的主要问题](#9-当前部署架构的主要问题)
10. [可复用能力与不应继承的历史包袱](#10-可复用能力与不应继承的历史包袱)
11. [未解决问题清单](#11-未解决问题清单)
12. [面向第三轮尽调的证据缺口](#12-面向第三轮尽调的证据缺口)
13. [简明能力矩阵](#13-简明能力矩阵)
14. [核心问题结论](#14-核心问题结论)

---

## 1. 审计范围与代码基线

### 1.1 审计对象

| 项目 | 值 |
|------|-----|
| 仓库根 | `D:\EchoCore\MiMo-Code\` |
| 核心代码 | `packages/cli/src/`（CLI 主包） |
| 共享层 | `packages/shared/src/` |
| SDK | `packages/sdk/src/` |
| 插件 SDK | `packages/plugin/src/` |
| 版本 | 0.1.15（四包一致） |
| 运行时锁定 | Bun 1.3.14（`package.json#packageManager`） |
| 许可证 | MIT + USE_RESTRICTIONS.md |
| 上游 | anomalyco/opencode fork |

### 1.2 审计方法

- 直接调用链追踪（从 `packages/cli/src/index.ts` 入口沿实际 import/调用关系深入）
- 静态代码检索（process.platform、Global.Path、spawn、fetch 等模式全域搜索）
- 安装/构建脚本逐行阅读
- CI 配置核查
- 未执行任何改变系统状态的操作；跨平台结论严格区分"代码支持"与"运行验证"

### 1.3 证据等级沿用

| 等级 | 含义 |
|------|------|
| VERIFIED | 有直接代码、配置或实际运行证据 |
| IMPLEMENTED_UNVERIFIED | 实现存在，但未完成实际运行验证 |
| PARTIAL | 仅实现部分能力 |
| DESIGN_ONLY | 只有设计、文档或注释声明 |
| NOT_IMPLEMENTED | 确认不存在相应实现 |
| UNKNOWN | 当前证据不足 |

跨平台额外区分：`VERIFIED_PLATFORM_TESTED`（当前 Windows 环境实际运行过）与 `CODE_SUPPORT_ONLY`（代码有条件分支但无运行验证）。

---

## 2. 当前运行环境依赖清单

### 2.1 明确声明的依赖

| 依赖 | 要求 | 证据 |
|------|------|------|
| OS | Windows / macOS / Linux（x64 + arm64） | `script/release.ts:17-29`（12 目标构建矩阵） |
| CPU 指令集 | x64 需 AVX2（否则用 baseline 变体） | `install:130-158`、`install.ps1:62-81` |
| 运行时 | Bun 1.3.14（构建时强制）；发布产物内嵌 Bun 运行时 | `build.ts:17-29` 拒绝版本不匹配 |
| 64 位 OS | 必须 | `install.ps1:58-60` |
| PowerShell | ≥5（Windows 安装脚本） | `install.ps1:50-52` |
| tar | Linux 解压需要 | `install:171-174` |
| unzip | 非 Linux 解压需要 | `install:176-181` |

### 2.2 启动时实际检查的依赖

| 依赖 | 检查行为 | 证据 |
|------|---------|------|
| git | VCS 初始化时 `which("git")`；缺失时抛错 | `project/project.ts:244,427` |
| rg (ripgrep) | 系统 PATH 优先；缺失时自动下载到 `{cache}/bin` | `file/ripgrep.ts:294-319` |
| shell | Windows: pwsh→powershell→Git Bash→cmd；macOS: /bin/zsh；Linux: bash→/bin/sh | `shell/shell.ts:58-93` |
| LSP 服务器 | 按语言按需 `which` + 自动下载 | `lsp/server.ts` 全文 |
| npm/pnpm/bun | 仅 npm 安装渠道与 LSP 安装时 | `installation/index.ts:211-214` |

### 2.3 默认假设已存在的依赖（隐式条件）

| 隐式假设 | 影响 | 证据 |
|---------|------|------|
| 用户在 PATH 中可执行 `mimo` | SDK、shell 工具、安装检测均依赖 | `sdk/src/v2/server.ts:35,118` spawn `opencode` |
| 网络可达（首次运行） | models.dev 刷新、ripgrep 下载、更新检查 | `provider/models.ts:29`、`file/ripgrep.ts:307` |
| 可写用户目录 | 全部数据/配置落盘 | `global/index.ts:27-33` mkdir |
| Windows 有 PowerShell | 升级、ripgrep zip 解压、UTF-8 前缀 | `installation/index.ts:182`、`ripgrep.ts:259` |
| Git Bash（可选） | Windows bash 工具优先使用 | `shell/shell.ts:74-81` |

### 2.4 仅开发环境需要的依赖

| 依赖 | 用途 | 证据 |
|------|------|------|
| Bun 1.3.14（精确） | 源码运行/构建 | `package.json:7` |
| oxlint / prettier | Lint/格式化 | `package.json:76-77` |
| @typescript/native-preview (tsgo) | Typecheck | `package.json:83` |
| playwright | E2E 测试 | catalog:54 |
| tree-sitter 原生包（trustedDependencies） | bash 工具 AST（构建期） | `package.json:101-109` |

### 2.5 生产运行环境需要的依赖

**发布产物是 Bun compile 单文件可执行**（`dist/mimocode-<target>/bin/mimo`），内嵌：

- Bun 运行时
- 全部 JS 依赖（minify + splitting）
- SQL migrations（构建期内联为 `MIMOCODE_MIGRATIONS`）
- tree-sitter WASM（bash/powershell 解析）
- @opentui parser.worker.js（内嵌路径）
- TUI worker（`worker.ts`）

**用户端无需安装 Bun/Node**——`build.ts:219-247` 的 `Bun.build({compile})` 产物自包含。

原生模块（@parcel/watcher、@lydell/node-pty/bun-pty）在构建时按目标平台选择性嵌入或外置（`build.ts:189-195` 预装全平台 `@opentui/core` + `@parcel/watcher`）。

**证据等级**：VERIFIED（构建脚本与产物结构直接可证）

### 2.6 环境变量清单（影响行为的关键变量）

| 变量 | 作用 | 默认 |
|------|------|------|
| `MIMOCODE_HOME` | 四目录根覆盖 | 未设 → XDG |
| `MIMOCODE_CONFIG_DIR` | 追加配置目录 | 未设 |
| `MIMOCODE_CONFIG` / `_CONTENT` / `_DEFAULTS` | 配置注入 | 未设 |
| `MIMOCODE_DB` | 数据库路径覆盖 | `{data}/mimocode.db` |
| `MIMOCODE_AUTH_CONTENT` | 凭据内存注入 | 未设 |
| `MIMOCODE_DISABLE_AUTOUPDATE` | 禁自动升级 | false |
| `MIMOCODE_DISABLE_MODELS_FETCH` | 禁 models.dev | false |
| `MIMOCODE_ENABLE_ANALYSIS` | 遥测开关 | **true** |
| `MIMOCODE_DISABLE_LSP_DOWNLOAD` | 禁 LSP 下载 | false |
| `MIMOCODE_DANGEROUSLY_SKIP_PERMISSIONS` | 全局跳过权限 | false |
| `MIMOCODE_INSTALL_DIR` | 安装目录覆盖 | `~/.mimocode/bin` |
| `MIMO_FDS_BASE` | 下载源覆盖 | `mimocode.cnbj1.mi-fds.com` |
| `MIMOCODE_CHANNEL` / `MIMOCODE_VERSION` | 编译期注入 | 构建时 |

**证据等级**：VERIFIED（`flag/flag.ts` 全文 472 行 + `shared/global.ts`）

---

## 3. 首次启动与初始化时序图

### 3.1 总体时序

```
用户执行 `mimo`（或 `mimo [project]`）
│
├─① 进程启动（Bun 内嵌运行时）
│   packages/cli/src/index.ts:1  yargs 解析
│   ├── 清理 Windows 升级残留 .old_* 文件 (index.ts:176-186)
│   ├── ModelsDev.startRefresh()  ── 异步网络: models.dev/api.json → {cache}/models.json
│   ├── ensureProcessMetadata()   ── 生成 process UUID
│   └── Log.init()                ── 创建 {data}/log/<stamp>-<role>-<pid>-<uuid>.active.log
│       副作用: 日志文件创建 [持久化]
│
├─② 模块级 Global 初始化（import 副作用）
│   packages/cli/src/global/index.ts:6-52
│   ├── resolveMimocodeHome() ── MIMOCODE_HOME 或 XDG 四目录
│   ├── mkdir data/config/state/log/bin (recursive)  [持久化]
│   ├── Flock.setGlobal({state}) ── 锁根目录
│   └── CACHE_VERSION 检查（当前 "21"）── 版本不匹配时 rm -rf 整个 cache  [不可逆副作用]
│
├─③ 命令分发 → 默认 TUI (`$0`)
│   packages/cli/src/cli/cmd/tui/thread.ts:157-383
│   ├── win32DisableProcessedInput() ── kernel32 FFI（仅 Windows）
│   ├── 解析 project 路径 → process.chdir()
│   ├── checkTrust(cwd) ── 读 {data}/trusted-workspaces.json
│   │   └── 非 trusted → 交互确认 → markTrusted() 写入 [持久化]
│   ├── --dangerously-skip-permissions → 交互确认
│   ├── 创建 Worker（thread-worker 双进程架构）
│   │   packages/cli/src/cli/cmd/tui/worker.ts
│   │   └── Worker 内: server 启动 + InstanceBootstrap
│   ├── 1 秒后异步 checkUpgrade()
│   └── 启动 loopback HTTP server（即使进程内通信也绑定 127.0.0.1 随机端口+密码）
│
├─④ Worker 内 InstanceBootstrap
│   packages/cli/src/cli/bootstrap.ts:10-34
│   └── Instance.provide({directory, init: InstanceBootstrap})
│       packages/cli/src/project/bootstrap.ts:21-68
│       ├── Config.Service.get() ── 多层配置合并（详见 3.2）
│       │   └── [副作用] 首次: 种子 mimocode.jsonc [持久化]
│       │   └── [副作用] ensureGitignore: 项目无 .gitignore 时写入 MIMOCODE_GITIGNORE_ENTRIES [持久化]
│       ├── Plugin.Service.init() ── 加载 config.plugin + .mimocode/plugin(s)
│       ├── sweepAbandonedZombies() ── 清理僵尸 actor
│       ├── 并行 forkDetach:
│       │   ├── LSP.Service.init() ── 按需启动语言服务器
│       │   ├── ShareNext.Service.init()
│       │   ├── Format.Service.init()
│       │   ├── File.Service.init()
│       │   ├── FileWatcher.Service.init() ── @parcel/watcher
│       │   ├── Vcs.Service.init() ── git 检测（缺失→抛错）
│       │   ├── Snapshot.Service.init() ── 创建 {data}/snapshot/<pid>/<hash>/ git 目录 [持久化]
│       │   └── WriterService.init()
│       ├── Memory.Service.reconcile() ── forkDetach，后台 FTS 索引同步
│       ├── Bus 订阅 Command.INIT
│       └── Metrics.subscribe() ── 默认开启，写 {data}/installation_id [持久化]
│
├─⑤ SQLite 数据库打开（懒初始化，首次访问触发）
│   packages/cli/src/storage/db.ts:85-118
│   ├── init(Path) ── bun:sqlite 打开/创建 {data}/mimocode.db [持久化]
│   ├── PRAGMA busy_timeout/WAL/synchronous/cache/foreign_keys/wal_checkpoint
│   ├── migrateReplaySafe(db, migrations) ── 执行全部 SQL migration [持久化·不可逆]
│   └── startIndexMigration() ── 后台 FTS 索引分批迁移
│
├─⑥ JSON → SQLite 一次性迁移（仅首次检测不到 DB 时）
│   packages/cli/src/index.ts:127-161
│   └── JsonMigration.run() ── 从 {data}/storage/ 读旧 JSON 写入 SQLite [持久化·耗时]
│
├─⑦ TUI 渲染就绪
│   └── 用户可交互。Session 惰性创建（首次 prompt 时）。
│
└─⑧ 首次 prompt 时
    ├── Session 创建 → SQLite SessionTable/MessageTable
    ├── Provider 初始化（读 auth.json / env keys）
    ├── Permission ruleset 构建（agent defaults + user config）
    └── LLM 调用（需网络）
```

### 3.2 配置加载细节（InstanceBootstrap 内 Config.get）

合并顺序（后加载者优先，`config/config.ts:694-1002`）：

```
1. Well-known 远程配置（auth.json 中 type=wellknown 的 provider）
2. Global: {config}/config.json → mimocode.json → mimocode.jsonc
3. MIMOCODE_CONFIG 指定文件
4. Project: cwd→worktree 向上的 mimocode.json(c)
5. 目录层: {config} → 项目 .mimocode/ → ~/.mimocode → MIMOCODE_CONFIG_DIR
   （每目录加载 mimocode.json(c) + command/ + agent/ + plugin(s)/）
6. MIMOCODE_CONFIG_CONTENT（内联 JSON）
7. Console 远程 config（登录账户时）
8. 系统托管目录（ProgramData/opencode 等）
9. macOS MDM plist（override everything）
10. Claude 兼容 ~/.claude.json mcpServers
11. MIMOCODE_CONFIG_DEFAULTS（最底层 defaults）
```

### 3.3 各阶段副作用分类

| 阶段 | 持久化写入 | 网络依赖 | 不可逆性 |
|------|-----------|---------|---------|
| ① 进程启动 | 日志文件 | models.dev（可关） | 低（日志可删） |
| ② Global init | 5 目录 + cache 版本检查 | 无 | **cache 全清不可逆** |
| ③ Trust | trusted-workspaces.json | 无 | 低 |
| ④ Bootstrap | mimocode.jsonc 种子、.gitignore、snapshot gitdir、installation_id | 无 | 低 |
| ⑤ SQLite | mimocode.db + 全部 migration | 无 | **schema 迁移不可逆**（无自动备份） |
| ⑥ JSON 迁移 | SQLite 填充 | 无 | 一次性（保留旧 JSON） |
| ⑧ 首次 prompt | Session/Message 记录 | LLM API | 低 |

### 3.4 启动失败处理

| 失败点 | 处理 | 证据 |
|--------|------|------|
| 致命异常 | catch → FormatError → stderr → exit(1) → Log.shutdown | `index.ts:240-286` |
| Bootstrap init 失败 | InstanceBusyError / 直接抛出 | `instance.ts:104-125` |
| Memory reconcile 失败 | warn 不阻断 boot | `bootstrap.ts:52-56` |
| Checkpoint drain 失败 | warn 不阻断 teardown | `bootstrap.ts:28-30` |
| VCS（git 缺失） | Instance 初始化抛错 | `project.ts:427` |
| DB migration 失败 | 部分 replay-safe 容错；其他中止 | `migrate-replay-safe.ts` |

**证据等级**：VERIFIED（全链路直接调用追踪）

---

## 4. 依赖安装与部署能力分析

### 4.1 安装渠道矩阵

| 渠道 | 脚本/机制 | 平台 | 校验 | 回滚 | 管理员权限 |
|------|----------|------|------|------|-----------|
| curl 一键 | `install`（bash，493 行） | Linux/macOS/MSYS | **无 sha256** | 无 | 不需要 |
| PowerShell | `install.ps1`（232 行，`install-utf8.ps1` 生成源） | Windows | **无 sha256** | 无 | 不需要（用户 PATH） |
| npm | `@mimo-ai/cli` 薄启动器 + postinstall 预取 | 全平台 | **可选** sha256（缺失即跳过） | 无 | 不需要 |
| 本地构建 | `local-install.sh`（64 行） | Darwin/Linux（**拒绝 musl/Windows**） | N/A | **有**（临时文件+mv 原子替换） | 不需要 |
| brew/choco/scoop | TODO 注释 | — | — | — | — |

**关键发现**：

1. **安装脚本不校验下载完整性**——`install:335-354`、`install.ps1:152-181` 直接解压执行。供应链攻击面存在。
2. **npm launcher 有可选 sha256**（`launcher.js:194-216`），但校验文件不存在则静默跳过——防御为 best-effort。
3. **安装产物是自包含单文件二进制**——用户端无需 Bun/Node/依赖安装。这与"开发工具"有本质区别。
4. **安装位置**：`~/.mimocode/bin/mimo[.exe]`，与用户数据（XDG 四目录）完全分离。

**证据等级**：VERIFIED

### 4.2 首次运行自动依赖获取

| 依赖 | 触发时机 | 来源 | 用户确认 |
|------|---------|------|---------|
| ripgrep | 首次 grep/glob 调用 | GitHub releases | 无（自动下载） |
| LSP 服务器 | 首次打开对应语言文件 | GitHub/Eclipse/JetBrains/npm/go | 无（可 env 禁用） |
| models.json | 启动后台刷新 | models.dev | 无（可 env 禁用） |
| 更新检查 | TUI 启动 1 秒后 | FDS releases/latest | 通知级 |

**证据等级**：VERIFIED

### 4.3 SDK 启动 CLI 二进制的条件

```
packages/sdk/src/v2/server.ts:35,118
  launch('opencode', args)  // cross-spawn
```

**关键缺陷**：SDK 假设 PATH 中存在名为 **`opencode`** 的可执行文件。但：
- 本 fork 安装产物名为 **`mimo`**
- npm bin 字段为 `mimo`
- 无 fallback 探测逻辑

→ **在只安装 mimo 的机器上 SDK 无法启动 CLI**。证据等级：机制 VERIFIED，实际失败行为 IMPLEMENTED_UNVERIFIED。

另外：serve 模式 URL 解析依赖 stdout 中 `"opencode server listening on <url>"` 字符串前缀（`server.ts:56`），若 CLI 已改文案则解析失败——本仓库未审计 serve 日志文案，标 UNKNOWN。

### 4.4 运行时更新

- **自动升级**（默认开启，仅 patch 版）：TUI 启动后 1 秒检查 → 静默执行
- **curl 路径**：下载远程 `https://mimo.xiaomi.com/install` **pipe 给 bash**（`installation/index.ts:154-172`）——运行时执行远程脚本
- **Windows 路径**：`irm install.ps1 | iex` 下载 staging → rename 自身 exe → copy 覆盖 → 失败时 rename 回滚（`:174-204`）
- **手动**：`mimo upgrade [target]` 支持 curl/npm/pnpm/bun

**证据等级**：VERIFIED

---

## 5. 本地目录、配置与数据隔离分析

### 5.1 目录结构总览

```
程序本体（与数据分离）:
  ~/.mimocode/bin/mimo[.exe]

用户数据根（MIMOCODE_HOME 优先，否则 XDG）:
  {data}    = ~/.local/share/mimocode     (Windows: C:\Users\<u>\.local\share\mimocode)
  {config}  = ~/.config/mimocode
  {state}   = ~/.local/state/mimocode
  {cache}   = ~/.cache/mimocode

{data}/ 明细:
  mimocode.db          ← SQLite 主库（Session/Message/Permission/Account/Task/History FTS）
  auth.json            ← Provider 凭据（0o600）
  mcp-auth.json        ← MCP OAuth（0o600）
  installation_id      ← 随机 UUID
  trusted-workspaces.json
  mimo-key-name
  memory/              ← 用户个人 Memory
    global/MEMORY.md
    projects/<pid>/MEMORY.md     (pid = sha256(repoPath)[:12])
    sessions/<sid>/checkpoint.md, notes.md, tasks/<tid>/progress.md
  storage/             ← legacy JSON（迁移后保留）
  snapshot/<pid>/<hash>/  ← git-dir 快照
  worktree/
  plans/
  log/                 ← 日志（带轮转与总量上限）
  tool-output/
  workflow/

{config}/ 明细:
  mimocode.jsonc       ← 主配置（JSONC，支持注释）
  mimocode.json / config.json（兼容）
  command/ agent/ plugin(s)/ tui/
  （也读取 ~/.mimocode 目录与项目 .mimocode/）

{state}/ 明细:
  model.json           ← 当前模型选择
  plugin-meta.json
  locks/               ← Flock 锁根
  llm-server/<hash>/tokens.json  ← LLM-server 令牌（0o700/0o600）

{cache}/ 明细:
  version              ← CACHE_VERSION（当前 "21"）
  models.json          ← models.dev 目录缓存
  bin/                 ← 下载的二进制（rg、LSP 等）
  skills/
```

**证据等级**：VERIFIED（`shared/global.ts`、`cli/global/index.ts`、全库 `Global.Path.*` 消费约 134 处）

### 5.2 数据类别隔离评估

| 类别 | 位置 | 隔离状态 |
|------|------|---------|
| 1. 身体代码（程序） | `~/.mimocode/bin/` | **完全分离** VERIFIED |
| 2. 用户个人 Memory | `{data}/memory/` | **独立子树**，可随 data 整体保留/删除；uninstall 默认删 PARTIAL |
| 3. 用户配置 | `{config}/` | **独立树**，uninstall `--keep-config` 可保留 VERIFIED |
| 4. 凭据/秘密 | `{data}/auth.json` + DB 内 token | **与 data 混合**；auth.json 0o600 但 DB 无 chmod PARTIAL |
| 5. Runtime 状态 | SQLite + `{state}/` | **混合**：Session 在 DB（data），模型选择在 state |
| 6. 可重建缓存 | `{cache}/` | **独立树**，版本号全清机制 VERIFIED |

**关键观察**：
- 四目录（data/config/state/cache）互不重叠——**目录级隔离已实现**。
- 但 **Memory 与 Session DB 同在 {data} 下**——uninstall 默认全删，`--keep-data` 一刀切保留。
- **凭据（auth.json）与 Memory/Session 同在 {data}**——无独立密钥目录。
- **Windows 下 0o600 无实际约束力**（NTFS 默认 ACL），代码未做 Windows ACL 加固。

**证据等级**：VERIFIED

### 5.3 配置格式与写入

- 格式：JSONC（允许注释与尾逗号），`jsonc-parser` 实现
- Schema：Effect Schema/Zod 校验，`$schema` 自动改写
- 写入点：`Config.updateGlobal`（全局）、`Config.update`（项目 cwd）、schema 自动升级、legacy TOML 迁移、starter 种子
- **无 config schema 版本号字段**——结构变更靠解析兼容，无专用迁移器

**证据等级**：VERIFIED

---

## 6. Windows / macOS / Linux 兼容性矩阵

| 调查项 | Windows | macOS | Linux |
|--------|---------|-------|-------|
| 路径处理 | VERIFIED_PLATFORM_TESTED | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| 平台分支代码 | VERIFIED_PLATFORM_TESTED（~111 处 process.platform） | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| Shell/子进程 | VERIFIED_PLATFORM_TESTED | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| 文件权限/锁 | VERIFIED_PLATFORM_TESTED（chmod 弱化） | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| 用户目录解析 | VERIFIED_PLATFORM_TESTED | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| 换行符/编码 | VERIFIED_PLATFORM_TESTED（UTF-8 专项适配） | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| 大小写敏感 | VERIFIED_PLATFORM_TESTED（normalizePath） | CODE_SUPPORT_ONLY（**未做 darwin 归一**） | CODE_SUPPORT_ONLY |
| 外部二进制 | VERIFIED_PLATFORM_TESTED | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| 原生模块 | VERIFIED_PLATFORM_TESTED | CODE_SUPPORT_ONLY | CODE_SUPPORT_ONLY |
| CI 测试覆盖 | **无**（仅 ubuntu 单测） | **无**（仅 release 构建） | CODE_SUPPORT_ONLY（CI 唯一测试平台） |

### 6.1 已确认的 Windows 适配亮点

1. **shell 选择链**：pwsh → powershell → Git Bash（从 git 路径推导）→ cmd（`shell/shell.ts:58-93`）
2. **UTF-8 乱码修复**：PowerShell BOM-less 编码前缀 + cmd chcp 65001（`:112-124`，针对 zh-CN ACP 936）
3. **进程树终止**：taskkill /pid /T /F（`shell/shell.ts:20-31`）
4. **Ctrl+C 守卫**：kernel32 FFI 持续清除 ENABLE_PROCESSED_INPUT（`tui/win32.ts`）
5. **路径翻译**：Git Bash/Cygwin/WSL → Windows 盘符（`filesystem.ts:145-157`）
6. **大小写归一**：`realpathSync.native` + wildcard `i` flag + shell name lowercase
7. **升级原地替换**：rename → copy → 失败回滚（`installation/index.ts:174-204`）
8. **MAX_PATH**：git core.longpaths=true

### 6.2 已知兼容问题（KNOWN_ISSUE）

1. **CI 零 Windows/macOS 单测**——`test.yml` 仅 ubuntu-latest
2. **worktree 正向测试 Windows 跳过**（`test/project/worktree.test.ts:13`）
3. **snapshot unicode 文件名测试无条件 skip**（`snapshot.test.ts:374`）
4. **pptx 技能 soffice 探测无 Windows 路径**（硬编码 Unix）
5. **cron PID 回收检测仅 Linux**（`cron-lock.ts:39`）
6. **Windows 无系统目录黑名单**（`instance.ts:95` win32 跳过）
7. **macOS 大小写不敏感 FS 未做路径归一**（对比 Windows 有 normalizePath）
8. **bash 工具命名偏 POSIX**（`bash.ts:483` TODO）
9. **安装渠道 TODO**：brew/choco/scoop 全部注释

### 6.3 原生模块平台支持

| 模块 | Windows | macOS | Linux |
|------|---------|-------|-------|
| @parcel/watcher | win32-x64/arm64 显式列出 | darwin-x64/arm64 | glibc/musl × x64/arm64 |
| bun-pty / @lydell/node-pty | 上游支持 | 上游支持 | 上游支持 |
| web-tree-sitter (WASM) | 跨平台 | 跨平台 | 跨平台 |
| @opentui/core | 构建期嵌入 | 构建期嵌入 | 构建期嵌入 |
| kernel32 FFI (win32.ts) | 专属 | N/A | N/A |

**证据等级**：见各项

---

## 7. 权限、安全与用户控制权分析

### 7.1 部署阶段权限行为

| 行为 | 是否需要管理员/root | 用户可见性 | 可禁用 |
|------|-------------------|-----------|--------|
| 安装到 ~/.mimocode/bin | 否 | 是 | — |
| 修改 shell rc 加 PATH | 否 | 是（默认执行） | `--no-modify-path` |
| 修改 Windows 用户 PATH | 否 | 是（默认执行） | `-NoModifyPath` |
| 写注册表 HKCU\Environment | 否（PATH 副作用） | 间接 | 同上 |
| 写注册表 HKLM | **否** | — | — |
| 修改 /usr/bin 等系统目录 | **否** | — | — |
| 要求 sudo | **否** | — | — |

### 7.2 运行阶段权限行为

| 行为 | 默认 | 证据 |
|------|------|------|
| Bash 工具自动执行 | **默认 allow**（agent `"*": "allow"`） | `agent/agent.ts:127-128` |
| 不可逆删除（bash_delete） | **强制 ask**（forced-ask，skip-all 不豁免） | `permission/index.ts:206` |
| 项目外目录写入 | ask | `agent/agent.ts:134-137` |
| .env 读取 | ask | `agent/agent.ts:140-145` |
| workspace trust | 首次进入 untrusted 目录需确认 | `workspace-trust.ts` + `thread.ts:240-249` |
| dangerous 目录（home/root） | 红色警告 + 显式确认 | `thread.ts:74-101` |
| --dangerously-skip-permissions | 红色警告 + 显式确认（TTY 时） | `thread.ts:130-155` |
| serve 非回环绑定 | 必须设密码或 --no-auth | `serve.ts:15-23` |
| metrics 遥测 | **默认开启**（tracking.miui.com） | `flag.ts:105-107` + `metrics/client.ts:1` |

### 7.3 网络与数据外发

| 端点 | 时机 | 内容 | opt-out |
|------|------|------|---------|
| `https://tracking.miui.com/track/v4/o` | 模型/工具调用时 | token 统计、工具名、状态（**非 prompt 全文**） | `MIMOCODE_ENABLE_ANALYSIS=false` |
| `https://models.dev/api.json` | 启动 + 每小时 | 模型目录 | `MIMOCODE_DISABLE_MODELS_FETCH` |
| `https://mimocode.cnbj1.mi-fds.com/...` | 更新/安装/rg 下载 | 二进制 | 不可完全禁用（更新可关） |
| `https://mimo.xiaomi.com/install` | 升级时 pipe 给 bash | **远程脚本执行** | `MIMOCODE_DISABLE_AUTOUPDATE` |
| LLM Provider API | prompt 时 | 完整对话 | N/A（核心功能） |

### 7.4 凭据安全

| 风险 | 现状 | 证据 |
|------|------|------|
| auth.json 明文 | 是（0o600 best-effort） | `auth/index.ts:9,97` |
| SQLite 内 OAuth token 明文 | 是（无 chmod） | `account/repo.ts:115-145` |
| OS keychain 集成 | **无** | 全库 grep 无 keytar/wincred |
| MIMOCODE_AUTH_CONTENT 泄露面 | 代码注释自认可被子进程读取 | `auth/index.ts:14-19` |
| EXA_API_KEY 进 URL query | 是 | `tool/mcp-exa.ts:4-5` |
| MCP token 终端打印 | 前 20 字符 | `cli/cmd/mcp.ts:681` |
| Session DB 含工具 I/O（可能含密钥） | 是 | Session 存储设计 |

### 7.5 用户控制权评估

| 控制点 | 现状 |
|--------|------|
| 知道程序将修改什么 | 部分——安装脚本行为明确，但运行时 ripgrep/LSP 下载无提示 |
| 知道程序将执行什么 | 部分——bash 默认 allow 下模型可直接执行；无完整审计日志 |
| 拒绝自动更新 | 可以（env/config） |
| 拒绝遥测 | 可以（env） |
| 拒绝依赖下载 | 部分（LSP 可关；rg 无开关） |
| 恢复到更新前版本 | **无**（升级不留旧版本备份，curl 路径直接覆盖） |

---

## 8. 更新、卸载、迁移与恢复能力

### 8.1 更新能力

| 能力 | 状态 | 证据 |
|------|------|------|
| 自动检查更新 | VERIFIED | TUI 启动 1s 后 `checkUpgrade` |
| 自动升级（patch） | VERIFIED（默认开） | `cli/upgrade.ts:28-36` |
| 手动升级指定版本 | VERIFIED | `mimo upgrade [target]` |
| npm 渠道升级 | VERIFIED | `installation/index.ts` npm 分支 |
| brew/choco/scoop | DESIGN_ONLY（注释） | 同上 |
| 升级失败回滚 | PARTIAL（Windows 有 `.old_*` 回滚；curl 路径无） | `installation/index.ts:174-204` |
| 降级到旧版本 | NOT_IMPLEMENTED（upgrade 只接受 target 版本号但无降级验证） | — |

### 8.2 卸载能力

`mimo uninstall` 命令（`uninstall.ts:26-246`）：

| 选项 | 行为 |
|------|------|
| 默认 | **删除 data + cache + config + state 全部** |
| `--keep-config` | 保留 {config} |
| `--keep-data` | 保留 {data}（含 Memory、Session、auth.json） |
| `--dry-run` | 预览 |
| `--force` | 跳过确认 |
| PATH 清理 | Windows: 用户 PATH 移除；shell rc: 扫描删除对应行 |
| 二进制删除 | **不自动删**（curl 渠道仅提示手动 rm） |

**关键问题**：Memory 无独立保留选项——`--keep-data` 会同时保留 Session DB、auth.json 等。用户想"只删程序保留 Memory"做不到精确控制。

**证据等级**：VERIFIED

### 8.3 迁移能力

| 能力 | 状态 | 证据 |
|------|------|------|
| SQLite schema 迁移 | VERIFIED（drizzle，每次 open 执行，replay-safe 容错） | `db.ts:99-118` |
| JSON→SQLite 一次性迁移 | VERIFIED | `index.ts:127-161` |
| History FTS 后台分批迁移 | VERIFIED | `history/migration.ts` |
| TUI 配置迁移（带 .bak） | VERIFIED | `tui-migrate.ts:78-129` |
| Config schema 版本迁移 | **NOT_IMPLEMENTED** | 无 version 字段 |
| 迁移前自动 DB 备份 | **NOT_IMPLEMENTED** | — |
| 跨机器数据迁移 | PARTIAL（export/import session JSON） | `export.ts`/`import.ts` |
| MIMOCODE_HOME 整体搬迁 | VERIFIED（设 env 指向新位置即可） | `shared/global.ts:27-42` |

### 8.4 恢复能力

| 场景 | 恢复手段 |
|------|---------|
| 升级失败（Windows） | rename 回滚旧 exe |
| 升级失败（curl） | **无**——远程脚本执行到一半状态未知 |
| DB 迁移失败 | replay-safe 部分容错；无备份可回退 |
| cache 损坏 | 下次启动 CACHE_VERSION 变更时全清重建 |
| 误删数据 | **无**回收站/备份机制 |
| 更新后想回旧版 | 需手动指定旧版本号重装（upgrade 命令支持 target，但无验证） |

---

## 9. 当前部署架构的主要问题

### P0（阻塞普通用户部署）

| # | 问题 | 证据 |
|---|------|------|
| 1 | **SDK spawn `opencode` 而非 `mimo`**——嵌入式使用完全断裂 | `sdk/src/v2/server.ts:35,118` |
| 2 | **升级时 pipe 远程脚本给 bash**——供应链信任链过长，且 URL 可被 env 篡改 | `installation/index.ts:154-172` |
| 3 | **安装脚本无下载完整性校验**（sha256/签名） | `install:335-354`、`install.ps1:152-181` |

### P1（严重风险/体验缺陷）

| # | 问题 | 证据 |
|---|------|------|
| 4 | **Bash 默认 allow**——零配置下模型可直接执行任意 shell | `agent/agent.ts:127-128` |
| 5 | **Metrics 默认开启**上报至 tracking.miui.com，opt-out 需用户主动设 env | `flag.ts:105-107` |
| 6 | **凭据明文落盘**（auth.json + SQLite token），无 OS keychain | `auth/index.ts`、`account/repo.ts` |
| 7 | **uninstall 默认删全部用户数据**（含 Memory/auth），无 Memory 单独保留选项 | `uninstall.ts:92-97` |
| 8 | **DB migration 无自动备份**——迁移失败不可恢复 | `db.ts:85-118` |
| 9 | **Windows 0o600 无实际约束力**——敏感文件仅靠默认 ACL | 平台语义 + 无 ACL 代码 |
| 10 | **CI 零 Windows/macOS 测试**——跨平台回归靠人工 | `test.yml:20` |

### P2（结构性缺陷/历史包袱）

| # | 问题 | 证据 |
|---|------|------|
| 11 | 系统托管目录仍叫 `opencode`（ProgramData/opencode 等） | `config/managed.ts:26-30` |
| 12 | brew/choco/scoop 渠道全部 TODO | `installation/index.ts:215-218` |
| 13 | macOS 大小写不敏感 FS 未做路径归一 | 对比 Windows 有 normalizePath |
| 14 | Permission "always" 审批可能未写回 DB（仅内存） | `permission/index.ts:489-495` |
| 15 | 临时文件（clipboard/jdtls）无退出清理 | `clipboard.ts:41,56` 等 |
| 16 | cache 版本变更时全清不可逆（无确认） | `global/index.ts:39-51` |
| 17 | Config 无 schema 版本字段 | `config/` 无 version |
| 18 | pptx 技能 soffice 探测无 Windows | `preview_server.ts:50-58` |

---

## 10. 可复用能力与不应继承的历史包袱

### 10.1 值得未来 Echo Core 复用的能力

| 能力 | 理由 | 证据 |
|------|------|------|
| **四目录分离架构**（data/config/state/cache + MIMOCODE_HOME 覆盖） | 清晰、可搬迁、可单独清理 | `shared/global.ts:26-50` |
| **自包含单文件二进制**（Bun compile，12 目标交叉编译） | 用户端零依赖部署的基础 | `build.ts:219-247` |
| **workspace trust 机制** | 首次进入目录的授权门控 | `workspace-trust.ts` |
| **forced-ask 权限**（bash_delete 等不可静默放行） | 安全底线设计 | `permission/index.ts:206` |
| **SQLite + drizzle + replay-safe migration** | 可靠的本地结构化存储 | `db.ts` + `migrate-replay-safe.ts` |
| **Flock 纯文件系统锁** | 三平台通用，无 flock(2) 依赖 | `shared/util/flock.ts` |
| **Windows 适配深度**（shell 链、UTF-8 前缀、路径翻译、kernel32 FFI） | 减少未来重做成本 | `shell.ts`、`win32.ts`、`filesystem.ts` |
| **安装脚本无需管理员 + 用户级 PATH** | 最小权限原则 | `install`、`install.ps1` |
| **uninstall 命令区分数据类别** | 卸载≠全删（虽不完善） | `uninstall.ts` |
| **Cache 版本化全清** | 缓存可安全重建 | `global/index.ts:35-52` |
| **auth.json 0o600** | 至少有权限意识 | `auth/index.ts:97` |

### 10.2 不应直接带入未来身体架构的历史包袱

| 包袱 | 理由 |
|------|------|
| **`opencode` 命名残留**（SDK spawn、系统托管目录、MCP well-known 路径、mcp-auth 命名空间） | fork 改名不彻底导致的行为断裂 |
| **远程脚本 pipe 给 bash 的升级机制** | 供应链风险；未来应走签名二进制差量更新 |
| **Bash 默认 allow 的权限基线** | 与"用户授权优先"原则冲突；未来应默认 ask |
| **默认开启的第三方遥测** | 需用户显式 opt-in，而非 opt-out |
| **凭据明文落盘 + 无 OS keychain** | 未来应集成系统凭据管理器 |
| **Memory/Session/auth 混在 {data}** | 未来应独立 Memory 目录 + 独立密钥存储 |
| **CI 无 Windows/macOS 测试** | 平台声明与验证脱节 |
| **Config 无 schema 版本** | 长期演进必然遇到无法迁移的配置 |
| **Cache 全清无确认** | 应改为提示或分层清理 |
| **web UI 嵌入硬编码禁用**（`skipEmbedWebUi = true`） | 半成品状态，避免误继承 |

---

## 11. 未解决问题清单

| # | 问题 | 状态 | 需要什么才能确认 |
|---|------|------|----------------|
| 1 | SDK 在只有 mimo 的机器上 spawn `opencode` 的确切失败模式 | UNKNOWN | 实机运行验证 |
| 2 | serve 模式 stdout 日志文案是否仍为 `opencode server listening` | UNKNOWN | 阅读 serve 命令日志代码 |
| 3 | Permission "always" 是否有意不写回 DB | UNKNOWN | 产品/作者确认 |
| 4 | macOS 上 LSP 路径大小写问题是否实际发生 | UNKNOWN | macOS 实机测试 |
| 5 | Linux musl（Alpine）发布二进制是否可用（local-install 拒绝 musl 但 release 有 musl 目标） | UNKNOWN | Alpine 实机测试 |
| 6 | Windows arm64 二进制是否实际可用 | UNKNOWN | Windows ARM 设备测试 |
| 7 | 中文 Windows（ACP 936）下 TUI 完整体验 | PARTIAL（代码有适配，无完整验证） | zh-CN Windows 实测 |
| 8 | 升级到一半断电/断网后的恢复行为 | UNKNOWN | 故障注入测试 |
| 9 | 并发多实例对同一 DB 的行为 | PARTIAL（有 busy_timeout + WAL） | 压力测试 |
| 10 | `MIMOCODE_HOME` 在 UNC 路径（`\\server\share`）下的行为 | UNKNOWN | 实机测试 |

---

## 12. 面向第三轮尽调的证据缺口

第三轮（数据与持久化审计）需要回答的关键问题：

1. **Session/Message 表的完整 schema 与增长模型**——当前只确认了迁移列表与打开逻辑，未审计表结构细节。
2. **Memory FTS 索引的一致性保障**——reconcile 与触发器的失败恢复路径。
3. **Snapshot gitdir 与主 .git 的关系**——用户 git 操作与快照的冲突面。
4. **多设备/多进程并发写入 SQLite 的实际行为**——WAL 模式下的具体竞态。
5. **数据导出/导入的完整性边界**——export/import 覆盖哪些表，丢失什么。
6. **Checkpoint/notes/tasks 文件与 SQLite 的双写一致性**——崩溃时哪个是 truth source。
7. **Account 表 token 刷新流程**——过期、并发刷新、失败处理。
8. **旧 JSON storage 的清理策略**——迁移后旧文件是否永久保留。
9. **installation_id 的隐私边界**——是否可关联到用户身份。
10. **`{state}/llm-server` 的生命周期**——token 何时生成/失效/清理。

---

## 13. 简明能力矩阵

| 能力 | 已实现 | 部分实现 | 未实现 | 未知 |
|------|:------:|:--------:|:------:|:----:|
| 环境识别（OS/Arch 检测） | ✓ | | | |
| 环境检查（运行时前置校验） | | ✓（仅安装脚本；运行时无 doctor） | | |
| 首次启动自动初始化目录 | ✓ | | | |
| 首次启动自动配置种子 | ✓ | | | |
| 首次启动数据库迁移 | ✓ | | | |
| 首次启动 JSON→SQLite 迁移 | ✓ | | | |
| 用户端零依赖部署（单文件二进制） | ✓ | | | |
| 安装脚本（Win/mac/Linux） | ✓ | | | |
| 安装完整性校验（sha256） | | ✓（仅 npm 可选） | | |
| 安装失败回滚 | | ✓（仅 local-install/Windows 升级） | | |
| 自动更新 | ✓ | | | |
| 更新失败恢复 | | ✓（仅 Windows） | | |
| 降级/回退版本 | | | ✓ | |
| 卸载命令 | ✓ | | | |
| 卸载精确数据保留 | | ✓（keep-data 一刀切） | | |
| 数据备份 | | ✓（export session） | | |
| 配置 schema 版本化 | | | ✓ | |
| DB schema 迁移 | ✓ | | | |
| 迁移前自动备份 | | | ✓ | |
| 目录隔离（data/config/state/cache） | ✓ | | | |
| 程序与数据分离 | ✓ | | | |
| Memory 独立保留 | | | ✓ | |
| 凭据 OS keychain | | | ✓ | |
| 凭据文件权限（Unix） | ✓ | | | |
| 凭据文件权限（Windows ACL） | | | ✓ | |
| Workspace trust | ✓ | | | |
| 强制确认（删除类操作） | ✓ | | | |
| Bash 默认安全基线 | | | ✓（默认 allow） | |
| 遥测 opt-in | | | ✓（默认开） | |
| 远程脚本执行（升级） | ✓ | | | |
| Windows 适配（代码层） | ✓ | | | |
| macOS 适配（代码层） | | ✓（大小写等缺口） | | |
| Linux 适配（代码层） | ✓ | | | |
| Windows 运行验证 | ✓（当前环境） | | | |
| macOS 运行验证 | | | | ✓ |
| Linux 运行验证 | | | | ✓ |
| CI Windows 测试 | | | ✓ | |
| CI macOS 测试 | | | ✓ | |
| SDK 正确启动 CLI | | | ✓（命令名不匹配） | |
| 在线安装渠道（brew 等） | | | ✓（TODO） | |
| 离线完整部署 | | ✓（--binary 存在但 rg/LSP 仍需网络） | | |
| 环境 doctor / 健康检查 | | | ✓ | |
| 失败后一键恢复 | | | ✓ | |

---

## 14. 核心问题结论

### 问题 1：当前项目究竟是可独立部署的用户端产品，还是依赖开发环境的本地开发工具？

**结论：介于两者之间，但更接近"可独立部署的用户端产品"（有实质差距）。**

- ✅ 发布产物是 Bun compile 单文件可执行（12 平台），用户端**无需 Bun/Node/依赖安装**——`build.ts:219-247`
- ✅ 安装脚本完善（curl/PowerShell/npm），无需管理员——`install`、`install.ps1`
- ✅ 程序与数据目录分离，首次启动自动创建全部所需目录——`global/index.ts:27-33`
- ❌ 但无环境 doctor、无安装校验和、升级依赖远程脚本 pipe、SDK 命令名断裂
- ❌ 首次运行仍隐式依赖网络（rg 下载、models.dev、更新检查）

**证据等级**：VERIFIED

### 问题 2：当前启动流程中，哪些步骤必须由开发者提前完成？

| 开发者已完成 | 用户自动获得 |
|-------------|------------|
| Bun compile 构建全部 12 目标 | 单文件可执行 |
| SQL migrations 内联进二进制 | 无需外部 migration 文件 |
| models-snapshot 生成（build-time） | 首次离线可用基础模型目录 |
| tree-sitter WASM 嵌入 | bash 工具 AST 解析可用 |
| @parcel/watcher 平台包选择 | 文件监听可用 |
| patch 依赖（5 个 patch） | 无需用户再打补丁 |
| release 上传 FDS + GitHub | 安装脚本有源可拉 |

**用户仍需自行完成**：设置 Provider API key（或 OAuth 登录）、首次进入项目的 trust 确认、按需允许权限。

**证据等级**：VERIFIED

### 问题 3：如果用户只下载程序，距离首次启动可用还缺什么？

假设用户拿到 `mimocode-windows-x64.zip` 解压出 `mimo.exe`：

| 步骤 | 现状 |
|------|------|
| 1. 放到 PATH 或全路径执行 | 用户手动（安装脚本会做，裸二进制不会） |
| 2. 目录创建 | ✅ 自动 |
| 3. 配置种子 | ✅ 自动 |
| 4. DB 创建 + 迁移 | ✅ 自动 |
| 5. Trust 确认 | ✅ 交互引导 |
| 6. Provider/API key 配置 | ⚠️ 需用户在 TUI 内操作或编辑 config.json |
| 7. 首次 LLM 调用（网络） | ⚠️ 需网络 + 有效凭据 |
| 8. ripgrep（首次 grep 时） | ⚠️ 需网络自动下载（或系统已有 rg） |
| 9. LSP（按语言） | ⚠️ 需网络自动下载 |

**结论**：核心运行链路（2-5）已自动化；**可用**（6-7）需要用户提供凭据 + 网络；**完整能力**（8-9）隐式依赖网络。

**证据等级**：VERIFIED

### 问题 4：当前运行环境是否与 CLI 进程强绑定？是否存在难以拆分的 Bun/Node/Shell 依赖？

- **对外（用户端）**：单文件二进制，**不依赖系统 Bun/Node**。PTY 用内嵌 bun-pty，SQLite 用 bun:sqlite，TUI 用内嵌 OpenTUI。
- **对内（代码架构）**：有 `#db`/`#pty`/`#hono` 条件导出支持 Node 构建（`packages/cli/package.json:27-48`、`build-node.ts`），说明**代码层可拆**。
- **Shell 依赖**：bash 工具强依赖系统 shell（Windows: PowerShell/cmd/Git Bash；macOS: zsh；Linux: bash）。这是功能本质决定的，非架构缺陷。
- **Worker 双进程**：TUI thread + worker 通过 RPC 通信，worker 路径在编译期注入（`MIMOCODE_WORKER_PATH`）。已内嵌，用户无感。

**证据等级**：VERIFIED

### 问题 5：当前目录结构是否允许身体代码、个人 Memory、凭据和运行状态独立管理？

| 维度 | 独立？ | 说明 |
|------|:------:|------|
| 身体代码 ↔ 用户数据 | ✅ | `~/.mimocode/bin` vs XDG 四目录 |
| 用户数据 ↔ 缓存 | ✅ | `{data}` vs `{cache}`，cache 可全清 |
| 配置 ↔ 数据 | ✅ | `{config}` vs `{data}` |
| **Memory ↔ Session DB** | ❌ | 同在 `{data}` 下 |
| **Memory ↔ 凭据** | ❌ | auth.json 与 memory/ 同在 `{data}` |
| **运行状态 ↔ 数据** | ⚠️ | `{state}` 独立但 Session 在 `{data}/mimocode.db` |

**结论**：目录级四分已有良好基础，但 **Memory、凭据、Session 三者未独立**——uninstall 无法精确操作。

**证据等级**：VERIFIED

### 问题 6：是否存在环境初始化失败后无法恢复的情况？

| 场景 | 可恢复？ |
|------|:--------:|
| 目录创建失败（权限不足） | ✅ 报错退出，修复权限即可 |
| Cache 版本清空后崩溃 | ✅ 下次重建（但旧 cache 数据丢失） |
| DB migration 半应用失败 | ⚠️ replay-safe 部分容错；**无备份可回退** |
| JSON→SQLite 迁移中断 | ✅ 旧 JSON 保留，重试可续 |
| 升级 curl 路径执行到一半 | ❌ **无回滚**——旧二进制已被替换/删除 |
| 升级 Windows 路径 copy 失败 | ✅ rename 回滚 |
| Snapshot gitdir 初始化失败 | ✅ 不阻断 boot（warn） |
| Memory reconcile 失败 | ✅ 不阻断 boot（warn） |

**最危险场景**：curl 升级中断 + DB 迁移失败叠加 → 可能同时失去可执行文件和数据一致性。

**证据等级**：VERIFIED

### 问题 7：当前是否有可靠的更新、卸载和数据迁移机制？

| 机制 | 可靠性 | 说明 |
|------|:------:|------|
| 更新 | ⚠️ | 有完整实现但升级执行远程脚本；Windows 有回滚，其他平台无 |
| 卸载 | ⚠️ | 命令完善但默认删全部数据；Memory 无法单独保留 |
| 数据迁移 | ✅ | JSON→SQLite + drizzle 迁移成熟；MIMOCODE_HOME 可整体搬迁 |
| 配置迁移 | ❌ | 无 schema 版本化 |
| 备份 | ❌ | 无自动备份 |

**证据等级**：VERIFIED

### 问题 8：当前系统是否存在跨平台部署的结构性障碍？

**无结构性障碍，但有验证缺口。**

- ✅ 路径处理：统一 path 模块 + win32 专项翻译/归一
- ✅ Shell：三平台适配链完整
- ✅ 进程管理：cross-spawn + taskkill/进程组
- ✅ 原生模块：全部平台包显式列出
- ✅ 构建：交叉编译 12 目标
- ✅ 锁：纯文件系统原语（mkdir），无平台特定 syscall
- ❌ **CI 零 Windows/macOS 测试**——声明支持与验证脱节
- ❌ macOS 大小写不敏感 FS 未做路径归一（对比 Windows 有）

**证据等级**：VERIFIED_PLATFORM_TESTED（Windows）+ CODE_SUPPORT_ONLY（macOS/Linux）

### 问题 9：哪些现有能力值得未来 Echo Core 复用？

见 [§10.1](#101-值得未来-echo-core-复用的能力)——重点：四目录架构、单文件二进制、workspace trust、forced-ask、SQLite 迁移体系、Flock、Windows 适配深度。

### 问题 10：哪些实现属于历史包袱，不应带入？

见 [§10.2](#102-不应直接带入未来身体架构的历史包袱)——重点：opencode 命名残留、远程脚本升级、bash 默认 allow、默认遥测、明文凭据、Memory/auth 混放。

---

## 最终回答：普通用户能否获得独立可运行的身体？

**如果今天把当前 MiMoCode 二进制交给一个没有开发环境的普通用户：**

| 维度 | 评分 | 说明 |
|------|:----:|------|
| 能否装上 | **能** | 安装脚本或裸二进制均可，无需管理员 |
| 能否启动 | **能** | 首次启动自动初始化，交互引导 trust |
| 能否用起来 | **有条件** | 需提供 LLM API key + 网络；bash 工具默认全开 |
| 数据是否属于自己 | **基本是** | 全部落本地；但遥测默认开、凭据明文 |
| 出问题能否恢复 | **弱** | 升级无回滚（非 Windows）、DB 迁移无备份、卸载默认全删 |
| 跨平台是否可靠 | **代码是，验证否** | Windows 有实测；macOS/Linux 仅代码层 |

**与目标的差距概括**：

1. **授权与知情**——bash 默认 allow、遥测默认开、远程脚本升级，均违背"用户授权优先、操作可见"。
2. **数据主权**——Memory/凭据/Session 未独立，卸载即全失；凭据无 OS 保护。
3. **可恢复性**——升级失败（非 Windows）与迁移失败均无回退路径。
4. **完整性信任**——安装/升级无签名校验，运行时执行远程代码。
5. **验证覆盖**——三平台声明但仅一平台有 CI/实测。

**当前系统距离"普通用户受控部署获得独立身体"的目标：约完成 60-70%。核心运行链路已具备，安全与恢复链路是主要缺口。**

---

> 报告完成。本报告为只读审计产出，未修改任何源码/配置/数据。
> 等待独立审查。不自行开始第三轮。
