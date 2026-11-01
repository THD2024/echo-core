# 架构补充审计：packages/shared、packages/plugin、packages/sdk（只读）

- 审计范围：`D:\EchoCore\MiMo-Code\packages\shared`、`packages\plugin`、`packages\sdk`，以及 CLI 对三者的引用方向
- 审计方式：只读（Glob / Read / Grep），未修改任何代码
- 证据等级标注：**强** = 源码/清单直接可读可复核；**中** = 结构与引用模式归纳；**弱** = 推断性结论

---

## 1. packages/shared（`@mimo-ai/shared`）

### 1.1 职责

**基础设施工具库**：提供路径/目录解析、文件系统封装、文件锁（flock）、glob、错误基类、slug/hash 等通用运行时能力。它是被 CLI 直接消费的“底层工具包”，不是业务逻辑层，也不是类型定义专用包。

- 核心证据：`packages/shared/src/global.ts:26-50`（`resolveMimocodeHome`，MIMOCODE_HOME / XDG 四目录解析）；`packages/shared/src/filesystem.ts:10-37`（`AppFileSystem` Effect 服务接口：readJson/writeJson/ensureDir/glob/findUp 等）；`packages/shared/src/util/flock.ts:12-60`（跨进程文件锁，含心跳、stale 超时）
- 证据等级：**强**

### 1.2 入口

- **无单一 barrel 入口**（没有 `src/index.ts`）。`package.json` 使用子路径导出：`"exports": { "./*": "./src/*.ts" }`（`packages/shared/package.json:18-20`）。
- CLI 按子路径引用：`@mimo-ai/shared/filesystem`、`@mimo-ai/shared/global`、`@mimo-ai/shared/util/error`、`@mimo-ai/shared/util/flock` 等（见 §6 引用清单）。
- 疑点：`package.json` 声明 `"bin": { "opencode": "./bin/opencode" }`（`packages/shared/package.json:15-17`），但仓库中未找到 `bin/` 目录（Glob `packages/shared/bin/**` 无结果）——疑似遗留配置。证据等级：**中**。
- 证据等级：**强**（导出形态）

### 1.3 公开接口（按子路径）

| 子路径 | 主要导出 | 证据 |
|---|---|---|
| `filesystem` | `AppFileSystem`（Effect `Context.Service`：isDir/isFile/readJson/writeJson/ensureDir/glob/findUp/up/globUp…） | `src/filesystem.ts:10-41` |
| `global` | `resolveMimocodeHome`、`Global` 服务（home/data/cache/config/state/bin/log） | `src/global.ts:26-84` |
| `util/error` | `NamedError` 抽象类、`HOST_RETRY_CLASSES` | `src/util/error.ts:3-60` |
| `util/flock` | `Flock` 命名空间（acquire/heartbeat/stale） | `src/util/flock.ts:12+` |
| `util/effect-flock` | Effect 版 flock | `src/util/effect-flock.ts`（CLI 引用见 `cli/src/config/config.ts:24`） |
| `util/slug`、`util/hash`、`util/glob`、`util/lazy`、`util/module`、`util/binary` 等 | 纯工具函数 | `src/util/*.ts`；CLI 引用见 §6 |
| `types.d.ts` | 仅 ambient 声明（`@npmcli/arborist` 模块声明、`Bun` 全局可选声明） | `src/types.d.ts:1-46` |

### 1.4 是否含运行时逻辑

**是，且是实质性运行时逻辑**（不是纯类型包）：

- 文件系统 I/O（Effect + `fs/promises`）：`src/filesystem.ts:46-115`
- 跨进程文件锁 + 心跳 + 超时重试：`src/util/flock.ts:12-60+`（358 行）
- 目录解析与环境变量处理：`src/global.ts:26-50`
- 模块解析（`createRequire`）：`src/util/module.ts:5-9`
- 依赖：`effect`、`@effect/platform-node`、`glob`、`minimatch`、`semver`、`xdg-basedir`、`zod`、`@npmcli/arborist` 等（`package.json:29-39`）

证据等级：**强**

### 1.5 依赖方向

- **shared 不依赖 CLI**，也不依赖 `@mimo-ai/plugin` / `@mimo-ai/sdk`。Grep `@mimo-ai` 仅命中自身包名与自身测试导入（`packages/shared/package.json:4`、`test/**`）。
- **CLI 依赖 shared**：`packages/cli/package.json:53` → `"@mimo-ai/shared": "workspace:*"`；源码引用 ≥100 处（见 §6）。
- 证据等级：**强**

### 1.6 是否承担“身体核心能力”

**部分是 —— shared 是运行时基础设施层，但不是业务/Agent 编排核心。**

- 它承担：路径解析、文件读写、锁、glob 等**通用底层能力**，CLI 的 storage/provider/plugin/config 等核心模块都建立在其上（如 `cli/src/storage/storage.ts:6`、`cli/src/provider/models.ts:9`）。
- 它不承担：会话编排、LLM 调用、工具执行、TUI 等业务能力——那些在 CLI 内。
- 措辞建议：shared 是 **runtime util / infrastructure**，不是“身体核心（Agent 主体）”，但**是被核心高频依赖的底座**。
- 证据等级：**强**（依赖面广）+ **中**（“核心能力”定性）

### 1.7 独立生命周期 / 持化

- **无独立生命周期进程**：纯库，无 daemon/服务循环。
- **有状态文件操作**：flock 在 `state/locks` 下创建锁文件（`src/util/flock.ts:19-22`），属于**被调用方代管的持久化**，本身不管理数据模型。
- `Global`/`resolveMimocodeHome` 只解析目录，不创建持久化 schema。
- 证据等级：**强**

### 1.8 是否依赖 CLI 内部

**否。** 无任何 `packages/cli` 或 CLI 内部路径导入（Grep 仅见自身 test）。SDK 的 `process.ts` 注释反向说明了 CLI→SDK 的单向性（见 §4）。
证据等级：**强**

---

## 2. packages/plugin（`@mimo-ai/plugin`）

### 2.1 职责

**插件扩展接口契约（Plugin SDK types/hooks）**：定义 server 插件与 TUI 插件的 Hooks、工具、认证、Provider、Actor 生命周期钩子等**类型与少量工厂**。`package.json` 自述 "Plugin SDK for extending MiMoCode"（`packages/plugin/package.json:5`）。

- **主体是类型定义 + 钩子形状**，不是插件宿主运行时（宿主加载逻辑在 CLI：`cli/src/plugin/host.ts`、`cli/src/cli/cmd/tui/plugin/runtime.ts`）。
- 证据等级：**强**

### 2.2 入口

`package.json` exports（`packages/plugin/package.json:26-30`）：

- `.` → `./src/index.ts`（server 插件类型 + `Hooks`）
- `./tool` → `./src/tool.ts`
- `./tui` → `./src/tui.ts`（TUI 插件类型）
- 另有 `src/shell.ts`（BunShell 类型，经 index 间接引用）、`src/example.ts` / `example-workspace.ts`（示例，非导出面）

证据等级：**强**

### 2.3 公开接口

| 模块 | 关键类型 | 证据 |
|---|---|---|
| `index.ts` | `Plugin`、`PluginInput`、`PluginModule`、`Hooks`（大量钩子：event/config/tool/auth/provider、`tool.execute.before/after`、`session.pre/post`、`session.userQuery.pre/post`、`actor.preStop/postStop`、compaction 等）、`AuthHook`、`ProviderHook`、`WorkspaceAdaptor`、`TrajectoryPart/Message`、`BUILT_IN_AGENTS` | `src/index.ts:57-626` |
| `tool.ts` | `tool()` 工厂 + `ToolContext` / `ToolDefinition`（唯一有逻辑的工厂函数，纯函数返回 input） | `src/tool.ts:32-41` |
| `tui.ts` | `TuiPlugin`、`TuiPluginModule`、`TuiPluginApi`、`TuiSlotMap`、`TuiTheme`、`TuiState`、Dialog/Prompt/Command/Route 等（**几乎纯类型**，526 行） | `src/tui.ts:1-526` |
| `shell.ts` | `BunShell` / `BunShellPromise` / `BunShellOutput` **纯接口声明**（无实现） | `src/shell.ts:10-136` |

注意：`BUILT_IN_AGENTS` 常量（`src/index.ts:232-235`）是**硬编码的内置 agent 名单**（main/general/build/…/compaction），属于跨层知识下沉到接口包的耦合点。

证据等级：**强**

### 2.4 是否含运行时逻辑

**极少，几乎为类型定义包：**

- `tool()` 是透传工厂（`src/tool.ts:32-38`），无 I/O。
- `index.ts` / `tui.ts` / `shell.ts` 以 type 导出为主；`BUILT_IN_AGENTS` 是常量数组。
- 依赖 `@mimo-ai/sdk`（**仅 type import**：`src/index.ts:13-14`、`src/tui.ts:18`）、`zod`、`effect`（`package.json:34-37`）；`@opentui/*` 为 optional peer。
- **不要夸大**：本包不是插件执行引擎，不含加载、调度、沙箱、权限执行——那些在 CLI。
- 证据等级：**强**

### 2.5 依赖方向

- **plugin → sdk**（workspace 依赖：`package.json:35`；type-only import 于 `src/index.ts:13-14`）。
- **plugin 不依赖 CLI**（Grep 无 `packages/cli` 引用；`example-workspace.ts:1` 导入的是自身 `@mimo-ai/plugin`）。
- **CLI → plugin**：`packages/cli/package.json:118`；源码 34 处（`cli/src/plugin/host.ts:2-4` 同时 import `.`/`./tool`/`./tui`）。
- 证据等级：**强**

### 2.6 是否承担身体核心能力

**否（按定义层职责）**：它是**扩展点契约层**——把 CLI 内核的钩子面暴露给第三方插件作者。真正的钩子触发/执行在 CLI（如 `cli/src/plugin/matcher.ts` 消费 `ActorMatcher`/`BUILT_IN_AGENTS`）。定性为：**插件接口/类型契约包**，非核心能力实现体。
证据等级：**强**

### 2.7 独立生命周期 / 持久化

**无**。无进程、无存储；`TuiLifecycle`/`onDispose` 只是给宿主注入的**类型形状**（`src/tui.ts:416-421`）。
证据等级：**强**

---

## 3. packages/sdk（`@mimo-ai/sdk`）

### 3.1 职责

**MiMoCode HTTP API 的 TypeScript 客户端 SDK + 进程启动包装**：基于 OpenAPI 生成的 client，外加“拉起 `opencode serve` 进程”的便捷函数。

- `package.json` 自述 "TypeScript SDK for the MiMoCode API"（`packages/sdk/package.json:5`）。
- 主体是 **hey-api/openapi-ts 生成代码**（`src/gen/**`、`src/v2/gen/**`，devDep `@hey-api/openapi-ts`：`package.json:39`）。
- 证据等级：**强**

### 3.2 入口

`package.json` exports（`packages/sdk/package.json:26-34`）：

- `.` → `src/index.ts`（re-export client+server，并提供 `createOpencode()` 一键起服务+建客户端）
- `./client`、`./server`、`./v2`、`./v2/client`、`./v2/server`、`./v2/gen/client`
- 依赖仅 `cross-spawn`（`package.json:46-48`）

证据等级：**强**

### 3.3 公开接口

| 模块 | 内容 | 证据 |
|---|---|---|
| `src/index.ts` | `createOpencode()`：`createOpencodeServer` + `createOpencodeClient` 组合 | `src/index.ts:8-21` |
| `src/client.ts` | `createOpencodeClient`：包装生成的 `OpencodeClient`，注入 `x-mimocode-directory` header、自定义 fetch（禁 timeout） | `src/client.ts:32-55` |
| `src/server.ts` | `createOpencodeServer` / `createOpencodeTui`：**cross-spawn 启动 `opencode` 可执行文件**，解析 stdout 中 "opencode server listening" 得 URL；`close()` 停进程 | `src/server.ts:22-134` |
| `src/process.ts` | `stop` / `bindAbort`：子进程终止与 AbortSignal 绑定；**注释明确为避免循环依赖而从 CLI 复制** | `src/process.ts:1-31` |
| `src/gen/**`（v1） | OpenAPI 生成的 types + SDK 方法 | `src/gen/types.gen.ts`、`src/gen/sdk.gen.ts` |
| `src/v2/**` | v2 client/server/data + 生成代码；`data.ts` 提供 `message.user()` 测试数据工厂（含占位 id `"asdasd"`） | `src/v2/index.ts`、`src/v2/data.ts:3-31` |

证据等级：**强**

### 3.4 是否含运行时逻辑

**是，但属于“客户端包装 + 进程管理”，不是服务端内核：**

1. **HTTP 客户端运行时**：生成代码 + fetch 拦截器（`src/client.ts:32-55`）。
2. **子进程运行时**：`cross-spawn("opencode", ["serve", ...])` 并解析日志 URL（`src/server.ts:35-70`）——这是真实进程生命周期逻辑。
3. **进程终止工具**：`taskkill /T /F`（Windows）等（`src/process.ts:5-12`）。
4. **明确的循环依赖规避**：`src/process.ts:3-4` 注释 “Duplicated from `packages/cli/src/util/process.ts` because the SDK cannot import `opencode` without creating a cycle (`opencode` depends on `@mimo-ai/sdk`)”。

**注意**：SDK 运行时通过**启动外部二进制 `opencode`** 与 CLI 发生**进程级耦合**，但**代码级不 import CLI 源码**。
证据等级：**强**

### 3.5 依赖方向

- **sdk 不 import `@mimo-ai/shared` / `@mimo-ai/plugin` / CLI 源码**（Grep `@mimo-ai` 在 `sdk/src` 无命中；`opencode` 字样仅出现在 spawn 参数与生成文档字符串）。
- **plugin → sdk**（type-only）。
- **CLI → sdk**：`packages/cli/package.json:119`；源码 35 处（含大量 `@mimo-ai/sdk/v2` type import，以及运行时 `createOpencodeClient`：`cli/src/cli/cmd/tui/context/sdk.tsx:1`、`cli/src/cli/cmd/run.ts:11`、`cli/src/acp/agent.ts:48` 等）。
- **进程级反向耦合**：sdk 的 `createOpencodeServer` 依赖 PATH 中的 `opencode` 二进制（由 CLI 提供）——代码依赖方向仍是 CLI→SDK，运行时控制方向是 SDK→CLI 进程。
- 证据等级：**强**

### 3.6 是否承担身体核心能力

**否。** 定性为 **API 客户端包装 + 进程启动辅助**。它不实现 LLM 会话、工具、存储；服务端能力全部由 CLI `serve` 提供。不要把“SDK 启动了 server”夸大为“SDK 是核心”。
证据等级：**强**

### 3.7 独立生命周期 / 持久化

- **有子进程生命周期**（spawn/timeout/abort/stop），但**不拥有服务端状态**；服务端数据生命周期在 CLI。
- **无自身持久化**（不写业务数据；仅进程管理）。
- `data.ts` 是测试数据构造器，非持久层。
- 证据等级：**强**

---

## 4. 依赖关系调查（CLI ↔ 三包）

### 4.1 CLI 清单声明

`packages/cli/package.json`：

- L53：`"@mimo-ai/shared": "workspace:*"`
- L118：`"@mimo-ai/plugin": "workspace:*"`
- L119：`"@mimo-ai/sdk": "workspace:*"`

证据等级：**强**

### 4.2 CLI 源码引用统计（Grep `from "@mimo-ai/..."` in `packages/cli/src`）

| 目标包 | 命中数 | 典型引用 | 运行时/类型 |
|---|---|---|---|
| `@mimo-ai/shared` | **101** | `cli/src/session/prompt.ts:123`（NamedError）、`:144`（AppFileSystem）；`cli/src/provider/models.ts:9`（Flock）；`cli/src/global/index.ts:5-6`（Flock + resolveMimocodeHome）；`cli/src/effect/app-runtime.ts:5` | 混合：大量**运行时**（AppFileSystem/Flock/Glob/Global）+ NamedError |
| `@mimo-ai/plugin` | **34** | `cli/src/plugin/host.ts:2-4`（`.`/`./tool`/`./tui`）；`cli/src/tool/registry.ts:27`；`cli/src/plugin/matcher.ts:1`（BUILT_IN_AGENTS）；大量 `cli/src/cli/cmd/tui/feature-plugins/**`（TuiPlugin 类型） | 以 **type-only** 为主；host/runtime 处有命名空间 import |
| `@mimo-ai/sdk` | **35** | `cli/src/cli/cmd/tui/context/sdk.tsx:1-2`（createOpencodeClient 运行时）；`cli/src/cli/cmd/run.ts:11`；`cli/src/plugin/index.ts:19`；其余多为 `sdk/v2` type import | 混合：少数**运行时 client**，多数**类型** |

### 4.3 反向引用（三包是否引用 CLI）

| 包 | 引用 CLI？ | 证据 |
|---|---|---|
| shared | **否** | Grep `@mimo-ai` 仅自身包名与自身测试 |
| plugin | **否** | Grep 无 `packages/cli`；仅 type-import `@mimo-ai/sdk`（`src/index.ts:13-14`、`src/tui.ts:18`） |
| sdk | **否（代码级）** | Grep `@mimo-ai` 无命中；`process.ts:3-4` 注释明确避免 import CLI 以打破循环；但 **运行时 spawn `opencode` 二进制**（`src/server.ts:35`） |

证据等级：**强**

### 4.4 依赖方向结论

```
        (workspace 依赖 / 源码 import)
  ┌──────────────┐
  │  packages/cli │ ──────────────┐
  └──────┬───────┘               │
         │                       │
         │        ┌──────────────▼──────────────┐
         │        │      packages/shared         │  （无下游 mimo 依赖）
         │        └─────────────────────────────┘
         │
         ├──────────► packages/plugin ──(type)──► packages/sdk
         │
         └──────────► packages/sdk
                        │
                        └──(运行时 spawn)──► `opencode` 二进制（由 CLI 提供）
```

**总结：**

1. **代码依赖方向单一**：CLI → {shared, plugin, sdk}；plugin → sdk；三包均不 import CLI 源码。无循环的代码级依赖。
2. **运行时控制反向**：sdk `createOpencodeServer` 通过 `cross-spawn` 启动 CLI 的 `opencode serve`（`sdk/src/server.ts:35`），形成“SDK 拉起 CLI 进程”的**运行时**反向边；SDK 为此复制了 CLI 的 process 工具以避免代码循环（`sdk/src/process.ts:3-4`）。
3. **职责分层**：shared = 运行时基础设施；plugin = 插件/TUI 扩展**接口契约**（类型为主）；sdk = OpenAPI **客户端包装 + 进程启动**；CLI = 真正的身体核心（会话、工具、存储、宿主）。

---

## 5. 依赖方向总结表

| 包 | 名称 | 核心职责 | 入口 | 运行时逻辑 | 依赖 CLI 源码？ | 被 CLI 依赖？ | 身体核心能力？ | 独立生命周期/持久化 | 关键证据 |
|---|---|---|---|---|---|---|---|---|---|
| **shared** | `@mimo-ai/shared` | 运行时基础设施工具（FS/锁/路径/glob/错误） | 子路径导出 `./src/*.ts`，无 barrel | **有且实质**（FS、flock、目录解析） | **否** | **是**（101 处 + workspace） | **底座，非业务核心** | 无进程；锁文件由调用写入 state | `shared/package.json:18-20`；`src/global.ts:26`；`src/util/flock.ts:12`；`cli/package.json:53` |
| **plugin** | `@mimo-ai/plugin` | 插件/TUI **接口契约与 Hooks 类型** | `.` / `./tool` / `./tui` | **极少**（`tool()` 工厂、`BUILT_IN_AGENTS` 常量；余为类型） | **否** | **是**（34 处 + workspace） | **否**——扩展点定义，宿主在 CLI | **无** | `plugin/package.json:5,26-30`；`src/index.ts:422-626`；`src/tool.ts:32`；`src/tui.ts:1-526` |
| **sdk** | `@mimo-ai/sdk` | OpenAPI **客户端包装** + **拉起 opencode 进程** | `.` / `./client` / `./server` / `./v2*` | **有**（fetch 拦截、cross-spawn、进程 stop/abort） | **否**（显式复制代码避免循环） | **是**（35 处 + workspace） | **否**——API 边缘层 | 子进程生命周期（有）；无业务持久化 | `sdk/package.json:26-48`；`src/server.ts:35`；`src/process.ts:3-4`；`src/client.ts:32` |
| **cli** | `@mimo-ai/cli` | 身体核心（会话/工具/存储/插件宿主/TUI） | — | **是** | — | — | **是** | — | `cli/package.json:53,118-119` |

**定性红线（防夸大）：**

- `plugin` = **类型/接口定义包**，不是插件运行时引擎。
- `sdk` = **SDK 包装 + 进程启动器**，不是 API 服务端实现。
- `shared` = **通用运行时工具底座**，是基础设施而非 Agent 业务核心；但它含真实运行时逻辑，**不是**纯类型包。
- 三者均**不反向依赖 CLI 源码**；唯一的反向边是 SDK 运行时 spawn `opencode` 二进制。

---

*报告生成：只读审计。所有 path:line 均对应 `D:\EchoCore\MiMo-Code` 仓库在审计时点的内容。*
