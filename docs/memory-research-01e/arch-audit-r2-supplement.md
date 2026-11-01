# ECC-ARCH-AUDIT-R2 补充核查报告

> 任务名称：本地部署与环境审计补充核查
> 任务性质：只读
> 核查日期：2026-10-31
> 审计对象：`D:\EchoCore\MiMo-Code\`
> 前置：R2 主报告已完成；本报告校准其中证据不足或风险定级不够准确的结论
> 约束遵守：未修改任何生产代码/测试/配置/锁文件；未执行任何有副作用的操作

---

## 1. SDK 命令名残留的实际影响

### 1.1 真实调用链

SDK 启动 CLI 的完整路径有两条，均经过 `cross-spawn`：

```
用户代码: import { createOpencode } from "@mimo-ai/sdk"
  │
  ├─ v1: packages/sdk/src/index.ts:8
  │   └─ createOpencodeServer()  packages/sdk/src/server.ts:22
  │       └─ launch("opencode", ["serve", ...])  server.ts:35  ← 硬编码
  │
  └─ v2: packages/sdk/src/v2/index.ts:10
      └─ createOpencodeServer()  packages/sdk/src/v2/server.ts:22
          └─ launch("opencode", ["serve", ...])  server.ts:35  ← 硬编码

另有 createOpencodeTui():
  packages/sdk/src/v1/server.ts:102 / v2/server.ts:102
  └─ launch("opencode", [...])  server.ts:118  ← 硬编码
```

### 1.2 双重不匹配

| 不匹配项 | SDK 期望 | CLI 实际输出 | 证据 |
|---------|---------|-------------|------|
| 可执行文件名 | `opencode`（cross-spawn 在 PATH 中查找） | 安装产物名为 `mimo`（`install` 脚本 bin 目标；npm bin 字段） | `server.ts:35` vs `install:343` / `cli/package.json bin` |
| stdout 日志前缀 | `opencode server listening` | `mimocode server listening` | `server.ts:56` vs `serve.ts:28` |

**关键**：这是**双重不匹配**——即使 PATH 中存在名为 `opencode` 的二进制（例如用户手动建了符号链接），URL 解析仍会失败，因为 serve 命令输出的前缀已改为 `mimocode server listening`。

### 1.3 SDK 是否有 fallback？

**无。** 全文检索 `packages/sdk/src/` 目录：

- `launch("opencode", ...)` 出现且仅出现于 `server.ts:35` 和 `server.ts:118`（v1、v2 各两处，共 4 处）
- 无环境变量覆盖（如 `MIMOCODE_BIN`）
- 无 PATH 探测逻辑
- 无 try-catch 换名重试
- 无配置项指定二进制路径

**证据等级**：VERIFIED

### 1.4 影响范围精确界定

| 使用方式 | 是否受影响 | 说明 |
|---------|:----------:|------|
| 直接运行 `mimo` CLI | **否** | 不经 SDK |
| SDK `createOpencodeClient()` 连接已运行的 server | **否** | 仅 HTTP 调用，不 spawn 进程 |
| 手动 `mimo serve` + SDK client | **否** | 同上 |
| SDK `createOpencode()` 一键启动 | **是** | 内部调 createOpencodeServer → spawn 失败 |
| SDK `createOpencodeServer()` | **是** | 直接 spawn 失败 |
| SDK `createOpencodeTui()` | **是** | 直接 spawn 失败 |

**普通 CLI 用户完全不受影响**——SDK 命令名残留只影响通过 SDK 编程式启动 CLI 的场景。

**未来身体内部模块调用**：如果 Echo Core 内部模块通过 SDK spawn CLI，同样受影响；如果通过 HTTP client 连接已运行的 server，则不受影响。

**证据等级**：VERIFIED（代码分析，未做实机运行验证）

### 1.5 修正原报告风险等级

原报告将 SDK 问题标为 **P0（阻塞普通用户部署）**。经核查，更准确的定级为：

> **P1（SDK 编程式使用断裂）**——仅影响 SDK spawn 路径，不影响普通用户直接运行 CLI，也不影响 SDK client 模式。对"普通用户下载即部署"这一目标**不构成阻塞**。

---

## 2. 跨平台兼容性结论校准

### 2.1 原结论"无结构性障碍"的修正

原报告称"无结构性障碍，但有验证缺口"。该表述不够准确。修正为：

> **代码层面存在跨平台适配，但验证覆盖严重不均，且部分适配存在已知缺口。**

### 2.2 分平台验证状态

#### Windows

| 能力 | 验证状态 | 证据 |
|------|---------|------|
| 安装（install.ps1） | VERIFIED_PLATFORM_TESTED | 当前审计环境为 Windows，安装脚本完整阅读 |
| 首次启动（目录创建/DB/配置） | VERIFIED_PLATFORM_TESTED | 当前环境运行 mimo.exe（`~/.mimocode/bin/mimo.exe`） |
| Shell 选择链 | VERIFIED_PLATFORM_TESTED | 当前环境已验证 pwsh→powershell→Git Bash 链 |
| UTF-8 输出适配 | VERIFIED_PLATFORM_TESTED | 当前环境 zh-CN（ACP 936），代码有 POWERSHELL_UTF8_PREFIX + CMD_UTF8_PREFIX |
| 升级（Windows 原地替换） | CODE_SUPPORT_ONLY | 代码逻辑完整（`installation/index.ts:174-204`），但本次审计未执行升级操作 |
| 路径归一（normalizePath） | VERIFIED_PLATFORM_TESTED | `filesystem.ts:113-121`，仅 win32 生效，已确认 |
| Ctrl+C 守卫（kernel32 FFI） | CODE_SUPPORT_ONLY | `tui/win32.ts`，代码存在，未做信号级验证 |
| worktree 测试 | **跳过** | `worktree.test.ts:13`：`wintest = process.platform !== "win32" ? it.live : it.live.skip` |
| CI 覆盖 | **无** | `test.yml:20` 仅 ubuntu-latest |

**Windows 小结**：核心运行链路已在当前环境实际验证（安装→启动→TUI→bash 工具→文件读写）。升级、信号处理等仅代码层支持。CI 零覆盖。

#### macOS

| 能力 | 验证状态 | 证据 |
|------|---------|------|
| 代码适配 | CODE_SUPPORT_ONLY | `process.platform === "darwin"` 分支存在 |
| shell 选择 | CODE_SUPPORT_ONLY | `shell.ts:87-89`：固定 `/bin/zsh` |
| 构建产物 | CODE_SUPPORT_ONLY（构建） | `release.yml:59`：build 在 macos-latest 执行——**构建过程**在 macOS 验证，但产物未在 macOS 运行测试 |
| 大小写不敏感 FS | **已知缺口** | `normalizePath`（`filesystem.ts:114`）`if (process.platform !== "win32") return p`——macOS 上是 no-op。`realpathSync.native` 在 macOS 上可解析实际大小写，但 normalizePath 不调用它（直接 return p） |
| LSP 路径大小写 | **潜在问题** | `lsp/client.ts:52` 调 normalizePath，在 macOS 上不做归一 |
| CI 覆盖 | **无** | `test.yml` 仅 ubuntu-latest |
| 实机运行 | **未验证** | 本次审计无 macOS 环境 |

**macOS 大小写问题的影响范围**：
- `normalizePath` 是 no-op（`filesystem.ts:114`）——意味着路径字符串原样传递
- `realpathSync.native`（`filesystem.ts:117`）在 macOS 上**可以**解析实际大小写，但仅在 `normalizePath` 内部且被 win32 条件短路
- 实际影响：LSP 返回的路径大小写与用户输入不一致时，可能导致文件匹配失败。但这是**低概率场景**（用户通常使用一致的大小写），且 bash 工具内的 glob 有 `i` flag 匹配（`wildcard.ts`）可部分缓解。
- **不能断言 macOS 上存在必然的兼容性故障**——只能说代码缺少主动归一，存在潜在风险。

**证据等级**：CODE_SUPPORT_ONLY + 已知缺口标记

#### Linux

| 能力 | 验证状态 | 证据 |
|------|---------|------|
| 代码适配 | CODE_SUPPORT_ONLY | `process.platform === "linux"` 分支 |
| shell 选择 | CODE_SUPPORT_ONLY | `shell.ts:91-93`：bash→/bin/sh |
| glibc 发行版 | CODE_SUPPORT_ONLY | 构建有 glibc 目标（`release.ts`） |
| musl（Alpine） | CODE_SUPPORT_ONLY | 构建有 musl 目标；`local-install.sh:16` **显式拒绝 musl**（仅影响本地构建安装，不影响预编译二进制） |
| cron PID 检测 | **Linux-only** | `cron-lock.ts:39`：仅 Linux 实现 |
| CI 覆盖 | **有** | `test.yml:20` ubuntu-latest——但这是唯一有 CI 测试的平台 |
| 实机运行（glibc） | **未验证** | 本次审计无 Linux 环境 |
| 实机运行（musl） | **未验证** | 同上 |

**glibc/musl 支持边界**：
- 预编译二进制：两者均有构建目标（`release.ts:17-29`）
- `local-install.sh`：`if [ -n "$(ldd --version 2>&1 | grep musl)" ]; then echo "Unsupported: musl not supported"; exit 1`（`:16`）——**本地构建安装**拒绝 musl
- 原生模块（@parcel/watcher）：有 musl 包（`package.json optionalDependencies`）
- 结论：musl 支持**代码层存在**（构建目标+原生模块），但 `local-install.sh` 主动拒绝——两者矛盾，原因未知

**证据等级**：CODE_SUPPORT_ONLY

### 2.3 交叉编译成功能否证明目标系统可运行？

**不能。** 原因：

1. **交叉编译只验证代码可编译+链接**——Bun compile 将 JS 打包进可执行文件，不验证运行时行为。
2. **原生模块是最大风险点**——@parcel/watcher、bun-pty 等在目标平台加载 `.node`/`.bun` 文件，交叉编译不检查 ABI 兼容性。
3. **shell/进程/信号行为**——Windows 的 taskkill、POSIX 的 killTree、信号处理逻辑，编译无法验证。
4. **路径/编码行为**——大小写、分隔符、locale 影响，编译无法验证。

**本次 release.yml 中 build 在 macos-latest 执行**（`release.yml:59`）——这验证了**构建过程**在 macOS 上可行（macOS 原生编译器签名等），但**不等于产物在 macOS 上运行正确**。

**正确的关系**：

| 步骤 | 能证明什么 |
|------|-----------|
| 交叉编译成功 | 代码可编译/打包为目标平台格式 |
| 目标平台安装成功 | 文件可写入、PATH 可配置 |
| 目标平台启动成功 | 运行时加载、基础初始化可行 |
| 目标平台功能测试通过 | 业务逻辑在目标平台正确 |
| CI 目标平台测试 | 持续回归保障 |

当前状态：第 1-2 步有构建证据；第 3 步仅 Windows 有实测；第 4-5 步仅 Linux 有 CI（但 CI 不含安装/启动测试，仅单元测试）。

**证据等级**：VERIFIED（对交叉编译能力边界的分析）

### 2.4 修正原报告"无结构性障碍"表述

原表述的问题：暗示三平台同等可靠。实际情况：

1. **Windows 有实际运行验证**（当前环境），但 CI 零覆盖——回归靠人工。
2. **macOS 有已知路径大小写缺口**（normalizePath no-op），且无实机验证。
3. **Linux 是唯一有 CI 的平台**，但 CI 不测试安装/启动/跨平台行为，仅单元测试。
4. **musl 支持自相矛盾**——release 有 musl 构建目标，local-install.sh 拒绝 musl。
5. **worktree 测试 Windows 跳过**——已知 Windows 兼容测试缺口。

修正结论：

> **代码层面具备三平台支持条件，但验证覆盖严重不均（Linux CI → Windows 实测 → macOS 仅代码）。不存在结构性障碍（如硬编码 Unix 路径、单一平台 API 依赖），但存在具体的兼容性缺口（macOS 大小写、Windows worktree 测试跳过、musl 矛盾）。**

---

## 3. 60–70% 完成度的依据

### 3.1 原报告的问题

原报告末尾写了"约完成 60-70%"——这是一个**直觉估算**，没有可靠模型支撑：

| 缺陷 | 说明 |
|------|------|
| 无评价维度定义 | 未说明"完成"指什么 |
| 无权重分配 | 未说明各维度重要性 |
| 无计算过程 | 无法复核 |
| 数字精确度虚假 | "60-70%"暗示可测量，实际不可测量 |

### 3.2 修正：删除百分比，改用能力维度评价

原报告的能力矩阵（§13）已经是更可靠的评价方式。补充一个按维度的定性评价：

| 维度 | 评价 | 依据 |
|------|------|------|
| 安装可达性 | **良好** | 三平台安装脚本、无需管理员、单文件二进制 |
| 首次启动自动化 | **良好** | 目录/配置/DB 全自动初始化 |
| 核心运行可用 | **可用（需凭据+网络）** | Provider 需用户配置；bash/文件工具开箱即用 |
| 安全边界 | **薄弱** | bash 默认 allow、遥测默认开、凭据明文 |
| 数据主权 | **不足** | Memory/凭据/Session 混放；卸载全删 |
| 可恢复性 | **不足** | 升级无回滚（非 Windows）、迁移无备份 |
| 跨平台验证 | **不均** | Windows 实测 > Linux CI > macOS 仅代码 |
| SDK 集成 | **断裂** | 编程式启动路径不可用（双重不匹配） |

**结论**：删除"60-70%"数字。改用上表的定性评价 + 原有能力矩阵。

---

## 4. 安全问题的风险范围

### 4.1 分类框架

每项安全发现按三个维度标注：

| 维度 | 含义 |
|------|------|
| **触发条件** | 需要什么条件才会发生 |
| **影响范围** | 影响谁/影响什么 |
| **实际后果** | 如果触发，具体造成什么 |

风险等级标注：
- **默认行为**：安装后无需任何配置即生效
- **可配置行为**：可通过 env/config 改变
- **条件触发**：需要特定操作/环境才会发生

---

### 4.2 安装脚本下载完整性校验不足

| 维度 | 内容 |
|------|------|
| 代码位置 | `install:335-354`（bash 无校验）；`install.ps1:152-181`（PowerShell 无校验）；`launcher.js:194-216`（npm 可选校验，缺失则跳过） |
| 触发条件 | 用户执行安装脚本时 |
| 影响范围 | 所有通过 curl/PowerShell/npm 安装的用户 |
| 实际后果 | 如果下载源（FDS/CDN）被篡改或中间人攻击，用户会安装恶意二进制 |
| 风险等级 | **条件触发**——需要攻击者控制下载源或网络路径 |
| 缓解因素 | HTTPS 传输；FDS 是小米官方 CDN；npm 渠道有可选 sha256 |
| 证据等级 | VERIFIED |

**精确表述**：安装脚本**缺少端到端完整性验证**，不等于"已发生安全事件"。风险在于信任链完全依赖 CDN 和 HTTPS，无独立于传输层的验证。

---

### 4.3 升级时远程脚本执行

| 维度 | 内容 |
|------|------|
| 代码位置 | `installation/index.ts:154-172`（curl 渠道：HTTP GET → pipe 给 bash）；`:174-204`（Windows：`irm install.ps1 \| iex`） |
| 触发条件 | ① 自动升级默认开启（`MIMOCODE_DISABLE_AUTOUPDATE` 未设）② 有新版本 ③ 用户同意升级或静默 patch 升级 |
| 影响范围 | 所有 curl/PowerShell 渠道安装的用户（npm 渠道走 npm update，不经此路径） |
| 实际后果 | 远程脚本内容完全由 URL 决定；`MIMOCODE_INSTALL_SCRIPT_URL` env 可覆盖 URL（`installation/index.ts:154`） |
| 风险等级 | **默认行为**（自动升级开启）+ **可配置行为**（env 可关/可改 URL） |
| 缓解因素 | 升级时有通知（非静默 patch）；HTTPS；`MIMOCODE_DISABLE_AUTOUPDATE` 可完全关闭 |
| 证据等级 | VERIFIED |

**精确表述**：远程脚本执行**在升级时发生**，但仅限 curl/PowerShell 渠道；npm 渠道不执行远程脚本。`MIMOCODE_INSTALL_SCRIPT_URL` env 覆盖是**设计特性**（允许内网镜像），但也是**风险放大器**（env 注入即可改变升级源）。

---

### 4.4 Bash 默认 allow

| 维度 | 内容 |
|------|------|
| 代码位置 | `agent/agent.ts:127-128`：`Permission.fromConfig({ "*": "allow", ... })` |
| 触发条件 | 默认配置下（用户未修改 `permission` 配置） |
| 影响范围 | 所有使用 bash 工具的 agent 会话 |
| 实际后果 | 模型生成的 bash 命令**直接执行**，不弹权限确认 |
| 风险等级 | **默认行为** |
| 缓解因素 | ① `bash_delete` 强制 ask（`agent/agent.ts` + `permission/index.ts:206`）——不可逆删除被拦截 ② `external_directory` 写入 ask ③ `.env` 读取 ask ④ 用户可在 config 中覆盖为 ask |
| 证据等级 | VERIFIED |

**精确表述**：bash 默认 allow 是**产品设计决策**（最大化开发者体验），不是 bug。但与"用户授权优先"原则存在张力。**实际风险边界**：不可逆删除（bash_delete）和敏感路径（.env）仍有强制确认——不是完全无防护。

---

### 4.5 遥测默认开启

| 维度 | 内容 |
|------|------|
| 代码位置 | `flag.ts:105-107`：`MIMOCODE_ENABLE_ANALYSIS: !falsy("MIMOCODE_ENABLE_ANALYSIS")`——默认 true |
| 上报端点 | `metrics/client.ts:1`：`https://tracking.miui.com/track/v4/o` |
| 上报内容 | `subscriber.ts`：model_call（token 统计）、tool_call（工具名/状态）、agent_request、try_best_detected |
| 触发条件 | 默认配置下，每次模型/工具调用 |
| 影响范围 | 所有用户（除非显式 opt-out） |
| 实际后果 | 使用行为数据发送至 tracking.miui.com |
| 风险等级 | **默认行为** + **可配置行为**（`MIMOCODE_ENABLE_ANALYSIS=false` 可关） |
| 缓解因素 | 不发送 prompt 全文（仅 token 统计和工具名）；env 可关 |
| 证据等级 | VERIFIED |

**精确表述**：遥测默认开启，**发送内容为使用统计而非对话内容**。风险是隐私层面（行为画像），非数据泄露层面。`MIMOCODE_ENABLE_ANALYSIS=false` 是明确的 opt-out 路径。

---

### 4.6 凭据明文存储

| 维度 | 内容 |
|------|------|
| 代码位置 | `auth/index.ts:9,97`：`auth.json` 0o600；`account/repo.ts:115-145`：SQLite token 列 |
| 触发条件 | 用户登录/配置 provider 后 |
| 影响范围 | 本机可读取文件的其他进程/用户 |
| 实际后果 | token 可被本机恶意软件或同机其他用户读取 |
| 风险等级 | **条件触发**（需要本机已有攻击者） |
| 平台差异 | Unix：0o600 有效；**Windows：0o600 无实际约束力**（NTFS 默认 ACL） |
| 缓解因素 | ① Unix 权限 0o600 ② 无远程泄露路径（本地文件） ③ `MIMOCODE_AUTH_CONTENT` env 可内存注入 |
| 证据等级 | VERIFIED |

**精确表述**：凭据存储是**本地明文**（best-effort 权限保护），非网络传输泄露。Windows 上权限保护更弱。**不等于"凭据已泄露"**——需要本机已有攻击者。

---

### 4.7 SQLite 迁移没有自动备份

| 维度 | 内容 |
|------|------|
| 代码位置 | `db.ts:85-118`：`migrateReplaySafe(db, migrations)`——直接执行，无备份 |
| 触发条件 | ① 首次启动（创建 DB + 全部迁移） ② 版本升级后启动（增量迁移） |
| 影响范围 | `{data}/mimocode.db` |
| 实际后果 | 如果迁移脚本有 bug 或中断，DB 可能处于不一致状态 |
| 风险等级 | **条件触发**（需要迁移脚本本身有 bug 或执行中断） |
| 缓解因素 | ① replay-safe 部分容错（`migrate-replay-safe.ts`）② WAL 模式 ③ 迁移脚本经过开发测试 |
| 证据等级 | VERIFIED |

**精确表述**：无自动备份是**可恢复性缺口**，非直接安全风险。触发条件是迁移脚本 bug 或执行中断——这是低概率事件，但一旦发生影响是数据层面的。

---

### 4.8 卸载默认删除用户数据

| 维度 | 内容 |
|------|------|
| 代码位置 | `uninstall.ts:92-97`：`keep: args.keepData` / `keep: args.keepConfig`——默认 false |
| 触发条件 | 用户执行 `mimo uninstall` 且未传 `--keep-data` / `--keep-config` |
| 影响范围 | `{data}`（含 Memory、Session DB、auth.json）、`{config}`、`{cache}`、`{state}` |
| 实际后果 | 用户数据全部删除，无法恢复 |
| 风险等级 | **可配置行为**（`--keep-data` / `--keep-config` 可保留） |
| 缓解因素 | ① 卸载前有确认交互（`uninstall.ts:105-134` 展示删除摘要）② `--dry-run` 可预览 ③ 不自动删二进制 |
| 证据等级 | VERIFIED |

**精确表述**：卸载默认删全部数据是**设计决策**（干净卸载），非 bug。但缺少"仅保留 Memory"的精细选项——用户想保留 Memory 但删除 Session 时，`--keep-data` 一刀切保留全部 `{data}`。

---

### 4.9 风险总览

| 发现 | 风险等级 | 是否默认发生 | 可否配置 | 实际后果严重度 |
|------|---------|:----------:|:--------:|:------------:|
| 安装无校验 | 条件触发 | — | 不可配置 | 高（供应链攻击） |
| 升级远程脚本 | 默认行为 | ✅ | 可关/可改 URL | 高（代码执行） |
| Bash 默认 allow | 默认行为 | ✅ | 可覆盖 | 中（任意命令执行） |
| 遥测默认开 | 默认行为 | ✅ | 可关 | 低（行为统计） |
| 凭据明文 | 条件触发 | — | 部分 | 中（本机泄露） |
| 迁移无备份 | 条件触发 | — | 不可配置 | 中（数据不一致） |
| 卸载全删 | 可配置 | — | ✅ 有选项 | 高（数据丢失） |

---

## 5. 修正汇总

| 原报告表述 | 修正后 | 理由 |
|-----------|--------|------|
| SDK 问题为 P0 | **P1** | 仅影响 SDK spawn 路径，不影响普通 CLI 用户 |
| "无结构性障碍" | **代码有条件但验证不均，存在具体缺口** | macOS 大小写、musl 矛盾、worktree 测试跳过 |
| "60-70% 完成" | **删除百分比，改用定性维度评价** | 无可复核计算模型 |
| 安装无校验 = 高风险 | **条件触发，高严重度但非默认发生** | 需攻击者控制下载源 |
| Bash 默认 allow = P0 | **P1（设计决策）** | 有 bash_delete 等强制确认兜底；是产品取舍非缺陷 |

---

## 6. 未解决问题（补充）

| # | 问题 | 状态 |
|---|------|------|
| 1 | musl 矛盾：release 有 musl 目标但 local-install.sh 拒绝——原因是什么？ | UNKNOWN |
| 2 | macOS 大小写问题是否在实际使用中导致过用户报告的问题？ | UNKNOWN |
| 3 | SDK `createOpencode()` 是否有已知用户在使用？影响面多大？ | UNKNOWN |
| 4 | 升级远程脚本 URL 被 env 篡改是否有已知攻击案例？ | UNKNOWN |

---

> 补充核查完成。等待独立审查。
> 不修改生产代码、测试、配置、锁文件和用户数据。
> 不执行安装、升级、卸载、远程脚本或其他具有副作用的操作。
