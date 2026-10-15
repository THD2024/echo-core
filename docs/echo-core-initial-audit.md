# Echo Core 初始审计报告（第一阶段：仅准备，不实施）

- 审计日期：2026-10-15（+08:00）
- 审计对象：MiMoCode 官方源码、OpenCode 上游、本机 Echo 运行环境
- 源码快照：`D:\EchoCore\MiMo-Code`（浅克隆），main HEAD = `496bb8cbe614aecea27623457d143600cc12c275`（2026-10-15），发布 tag `v0.1.15` = `14dfe68a1c121f859544ba810b3c308e8501bfb2`
- 状态：**审计完成，未实施任何核心改造，未创建任何 GitHub 仓库，未修改生产环境**

---

## 1. 官方仓库与版本信息

| 项目 | 结论 | 证据 |
|---|---|---|
| 官方仓库 | `https://github.com/XiaomiMiMo/MiMo-Code`（public，13.7k stars / 1.4k forks） | GitHub 仓库页（2026-10-15 抓取） |
| 默认分支 | `main`（1,397 commits） | GitHub 仓库页 |
| 最新稳定版本 | `v0.1.15`，发布于 2026-09-22T14:58:45Z，target=main，非 prerelease | GitHub Releases API（`/releases?per_page=3`，首条） |
| v0.1.15 对应 commit | `14dfe68a1c121f859544ba810b3c308e8501bfb2` | `git fetch --depth 1 origin tag v0.1.15` 后 `git rev-parse v0.1.15` |
| 审计时 main HEAD | `496bb8cbe614aecea27623457d143600cc12c275`（2026-10-15 15:59 +0800，已超前于 v0.1.15 tag） | `git log -1` |
| 本机已装版本 | 0.1.15（与最新稳定版一致） | `mimocode --version` → `0.1.15`；`C:\Users\微醺\.mimocode\bin\mimocode.cmd` → `mimo.exe` |
| 许可证 | MIT（双版权：`Copyright (c) 2026 MiMo Code, Xiaomi Corporation` + `Copyright (c) 2025 opencode`） | `LICENSE` 全文 |
| 使用限制 | 另受 `USE_RESTRICTIONS.md` 约束：禁止违法/军事/恶意网络活动等；**明确禁止"在无适当人类监督或授权的情况下自主执行高风险动作"** | `USE_RESTRICTIONS.md` 第 19 行 |
| 贡献规则 | 见下 | `CONTRIBUTING.md` 全文 |

**贡献与发布规则要点（CONTRIBUTING.md）**：

- 接受：bug 修复、TUI 可用性/兼容性、LSP/模型/Provider 兼容、环境适配、文档修正（第 6-13 行）。
- **改 agent prompts、agent 行为、memory、checkpoint、工具执行的变更，需先开 issue 讨论再动手**（第 19 行）——Echo Core 若将来想向上游回馈核心改造，须走此流程。
- 开发环境要求：**Bun 1.3+**，版本由根 `package.json` 的 `packageManager: "bun@1.3.14"` 精确锁定（CONTRIBUTING 第 47 行）。
- 构建/运行/测试命令（CONTRIBUTING 第 49-99 行）：
  - `bun ci`（= `bun install --frozen-lockfile`，**不要用 bun install**）
  - `bun run dev`（= `bun run --cwd packages/cli script/dev.ts`，本地等价于 `mimo` 命令）
  - `bun run typecheck`、`bun lint`、`bun run --cwd packages/cli test`（**测试不能从仓库根运行**）
  - `bun run build:local` → `packages/cli/dist/mimocode-<platform>/bin/mimo`
- 实际维护面：`packages/cli`（核心/服务器/CLI，发布为 `@mimo-ai/cli`）、TUI（`packages/cli/src/cli/cmd/tui/`，SolidJS + opentui）、`packages/plugin`、`packages/sdk`；**上游继承的 web/desktop/console 界面不再维护，不接受相关 PR**（第 57-64 行）。
- 发布仅在 CI（`.github/workflows/release.yml`），版本号需四个包（cli/sdk/plugin/shared）同步。

**仓库结构**：根 `package.json` + workspaces → `packages/{cli, plugin, sdk, shared}`；核心源码 `packages/cli/src/` 含 50+ 模块目录（agent/、session/、tool/、task/、memory/、workflow/、actor/、provider/、permission/、snapshot/ 等）。本机源码审计在 `D:\EchoCore\MiMo-Code` 完成。

**本机开发环境现状**：Bun **未安装**；Node v24.19.0 已装；git 2.53.0 已装。→ 第一阶段不安装任何软件；后续若需本地构建，安装 Bun 1.3.14 属【待批准】事项（免费，无订阅/API 费用）。

---

## 2. MiMoCode 与 OpenCode 的继承关系

| 项目 | 结论 | 证据 |
|---|---|---|
| 上游仓库 | `https://github.com/anomalyco/opencode`，默认分支 **dev**，MIT，213.7k stars，2026-10-15 仍在活跃推送 | GitHub API（`/repos/anomalyco/opencode`） |
| 关系性质 | MiMoCode 是 OpenCode 的 **fork**（非独立重写） | README "Relationship to OpenCode" 节；根 `package.json` `"repository": {"url": "https://github.com/anomalyco/opencode"}` |
| fork 残留证据 | 根 `package.json` `"name": "opencode"`；`LICENSE` 保留 opencode 版权行；`packages/cli/src/installation/index.ts:142-143` 留有被注释的 `anomalyco/tap/opencode` brew 逻辑；`test/effect/observability.test.ts:18` 仍断言 `service.namespace=anomalyco`；`provider/transform.ts:268` 注释引用 `upstream opencode#26786` | 各文件行号见左 |
| 继承的核心能力 | 多 provider、TUI、LSP、MCP、plugin 体系 | README；源码目录 `src/{provider,lsp,mcp,plugin,cli/cmd/tui}` 均存在且在用 |
| MiMoCode 新增能力 | 持久记忆（SQLite FTS5）、智能上下文管理（checkpoint/compaction/rebuild）、子智能体编排、goal 停止判官、compose-next、动态 workflows（deep-research/fact-check/research-experiment）、dream/distill 自我改进 | README 对应章节；源码 `src/{memory,session/checkpoint*,workflow,actor}` 存在（详见 §3） |
| 上游更新机制 | **未发现自动同步**。`.github/workflows/` 仅有 `lint/test/typecheck/release.yml` 四个，无 upstream-sync；克隆的 origin 无第二个 upstream remote；与上游差异靠人工维护（散布的 `upstream opencode#NNNN` 注释为人工追踪痕迹） | `.github/workflows/` 目录列表；`script/` 目录列表 |
| 上游同步频率/流程 | 【未知】——官方无文档说明如何从 anomalyco/opencode 合并，需观察后续 commit 历史判断 | — |

**含义**：echo-core fork 后，对上游的更新只能是人工 cherry-pick/merge。上游 opencode（dev 分支，213k stars）与 MiMoCode（main）已显著分叉（model/版本/功能路线不同），**盲目追上游不是目标**；固定在某个 MiMoCode 发布 tag 上做增量改造更可控（见 §5）。

---

## 3. Agent 核心架构图及关键源码入口

> 全部路径相对 `packages/cli/src/`（clone 于 `D:\EchoCore\MiMo-Code`，HEAD=496bb8cb）。四个并行源码审计（主控循环/工具与错误/子代理与上下文/预算与 workflow）汇总。

### 3.1 总体文字架构图

```
CLI(yargs index.ts) ──► cli/cmd/{serve,tui,run} ──► HTTP server/routes/instance/session.ts
        │                                            POST /session/:id/prompt(:1315)/abort
        ▼
SessionPrompt（session/prompt.ts，7227 行主控文件）
  prompt(:3423) → createUserMessage(:2727) → loop(:5766) → runLoop=run(:3626) while(true){:4449}
   ├─ filterCompactedEffect(:4473) 取切片 lastUser/lastAssistant/tasks
   ├─ classifyAssistantStep（session/classify.ts:32，3 个调用点）
   │     单步判定：final/continue/text-tool-call/filtered/think-only/invalid/failed
   ├─ 无效输出恢复 autoContinueInvalidOutput(:4189)：synthetic 提醒注入，
   │     上限 flag.ts:181 默认 2 次 → 耗尽写 InvalidOutputError + Session.Event.Error(:4196-4201)
   ├─ 文本工具调用重试(:4273，上限 2) / finish=length 续跑(:4577)
   │   / 重复步骤 loop-streak 提醒(:4716-4738，REPEATED_STEP_THRESHOLD=3)
   ├─ fireCheckpoints(prune 阈值阶梯) + overflowCheck → checkpoint 重建或 compaction 降级(:4691-4875)
   ├─ processor.create(:4993).handle.process(processor.ts:913)
   │     ├─ llm.run(llm.ts:388) → provider 流
   │     │     └─ session/retry.ts decide(:323)：分类预算（request 4次/30s、stream 5次/10min、
   │     │        server 8次/15min；401/内容过滤/上下文超限=terminal）指数退避同模型重试
   │     ├─ handleEvent 落库 reasoning/text/tool/step-finish(:491/:697)
   │     ├─ executeTool(:450)：插件钩子 → permission.ask → ToolGate FIFO 准入
   │     └─ 返回 "continue"|"stop"|"overflow"|"text-repeat"(:1111-1114)
   ├─ classifyAssistantStep("after-process")(:5545) → pending 工具必 continue
   ├─ text-loop 检测(:5668，≤2 次恢复) → break 前 goalGate(:4081/:5731)
   │     /goal 判官 session/goal.ts evaluate(:144)：未达成注入重入(≤MAX_GOAL_REACT=12)，
   │     判官失败 fail-open 放行(:4103-4105)；状态仅内存 Map(goal.ts:111)
   └─ 出口：prune(:5738) → lastAssistant → publishAgentRequest(:5757)

子代理：tool/actor.ts run(:419-589 分派 spawn/status/wait/send/cancel)
  → actor/spawn.ts spawnSubagent(:754) → registry.register → forkWork(:349)
  → 完成 notify(:626-668) → inbox.send(:42-59) 持久化 → 唤醒主循环 loop({inboxWake})
  → runLoop 每轮 inbox.drain(:4461) 渲染合成 user 消息回注上下文
  同步 run 路径：Deferred.await 直读 outcome → <actor_result>(tool/actor.ts:563-588)
  任务绑定：spawn 即 taskRegistry.start(spawn.ts:380)；postStop 钩子校验
  tasks/<id>/progress.md 五段结构(plugin/subagent-progress-checker.ts:102-110)

上下文：filterCompacted(message-v2.ts:1442 遇 checkpoint/compaction 边界截断)
  → 预写 checkpoint(prune.ts:241 阈值阶梯) → 溢出 isOverflow(overflow.ts:99，
    max_context 预算 + 触发比 0.9) → rebuildEnsuringCheckpoint(prompt.ts:954)
  → checkpoint-writer 子代理(checkpoint.ts:640) → renderRebuildContext(:1252，
    分区 token 上限 + budgeted-read) → insertRebuildBoundary(:1644)
  → 失败降级 session/compaction.ts process(:337 有损摘要)
  恢复：SessionPrompt.resume(:6504) → planResume → launchResume 回到同一 runLoop

工具注册：tool/registry.ts layer(:133) 组装 ~30 个内置工具
  (read/write/edit/multiedit/bash/grep/glob/actor/task/memory/webfetch/…)
  → prompt.ts 包装(:1851-1981) → Truncate.output 截断(tool/preview.ts 2000行/50KB)
  失败级联：tool/gate.ts FAIL_CASCADE(:138)；可 MIMOCODE_DISABLE_FAIL_CASCADE 关闭

预算/指标：metrics/event.ts 4 事件 ModelCall/ToolCall/AgentRequest/TryBestDetected
  ModelCall 仅成功路径发布(processor.ts:725、prompt.ts:1396) ⚠ 失败不发（见 §8-C1）
  workflow 预算：maxConcurrentAgents=min(16,2×CPU)、maxDepth=8、deadline=12h、
  sandbox 64MiB(config.ts:454-465、sandbox.ts:45-46)

实验工作流：tool/workflow.ts run(:163) → runtime.ts launch/evalScript(:1402)
  → builtin/research-experiment.js 4 阶段 Baseline→Loop(3连败REFINE/5连败PIVOT/3次pivot STOP，
  maxIters=15)→Audit→Report；keep/revert=脚本判定+agent 执行(软约束)；
  自定义 workflow 仅嵌套 workflow(name) 走 .mimocode/workflows(resolve.ts:22)
```

### 3.2 关键源码入口速查

| 文件:行号 | 职责 |
|---|---|
| `index.ts` / `cli/cmd/{serve,run,tui}.ts` | yargs 入口与三个运行形态 |
| `server/routes/instance/session.ts:1315/:691` | HTTP prompt 入口；summarize 后重启循环 |
| `session/prompt.ts:3423/5766/3626/4449` | prompt→loop→runLoop 主动脉 |
| `session/classify.ts:32` | 单步停/续唯一判定源（纯函数） |
| `session/processor.ts:913/450/491/697` | 流处理、工具执行、落库、step-finish |
| `session/llm.ts:388/902` | 组 system 发请求；重试决策接入点 |
| `session/retry.ts:323` | 重试分类/预算/退避（同模型） |
| `session/goal.ts:144`、`prompt.ts:4075-4180` | /goal 判官与拦截注入 |
| `session/{checkpoint,compaction,overflow,prune}.ts` | 检查点/压缩/溢出/水位阶梯 |
| `session/resume（prompt.ts:6504）、revert.ts` | 会话恢复、按 messageID 回卷 |
| `tool/registry.ts:133-478`、`tool/gate.ts`、`tool/tool.ts:92` | 工具注册、并发门、wrap 校验/截断 |
| `tool/{edit,bash}.ts`、`tool/preview.ts` | diff 编辑（行级+Levenshtein 兜底）、bash 权限与流式截断 |
| `tool/actor.ts:230`、`actor/spawn.ts:754/349/626/825` | 子代理派发、执行、通知、取消 |
| `inbox/inbox.ts:158-407`、`prompt.ts:4461` | 通知持久化与 drain 回注 |
| `task/{registry,schema}.ts`、`tool/task.ts` | T1 任务树状态机（与主循环解耦） |
| `memory/{paths,service}.ts`、`history/service.ts` | 记忆 FTS5、history 检索 |
| `metrics/{event,subscriber}.ts` | 4 指标事件与上报（受 MIMOCODE_ENABLE_ANALYSIS 门控） |
| `workflow/{runtime,sandbox,builtin}.ts` | workflow 沙箱运行时与内置表 |
| `flag/flag.ts:180-182/:419/:454` | 重试上限默认值、dev 隔离与 MIMOCODE_HOME |

### 3.3 任务完成判断（三层，源码实证）

1. **单步完成** = `classifyAssistantStep`：finish 原因 + 内容有无 + 工具态（pending 必续）。纯函数、单一判定源。
2. **整轮完成** = runLoop break：不存在更强的"任务全做完"语义；**T1 任务树与主循环解耦**——runLoop 不读 TaskRegistry 判完成（audit 未发现消费点，【需进一步验证】）。
3. **任务级完成** = `/goal` 独立判官（唯一显式目标停止条件）：生成式 Verdict、temperature 0、失败 fail-open、12 次上限、仅 main、状态不持久。**无全局"完成前测试门"**——workflow 层仅 research-experiment 脚本内建 eval/guard 判定（软约束）。

### 3.4 子系统成熟度汇总（四模块审计合并）

| 子系统 | 评级 | 关键限制（附证据） |
|---|---|---|
| 主控循环 + 单步分类 | **成熟** | `maxSteps` 默认 Infinity（prompt.ts:4887）；degraded 完成仅 warn |
| 无效输出/空轮恢复 | **成熟（有界）** | 上限 2 次后写错误——**但失败路径不进账本**（见 §8-C1）；18 例空轮根因仍 [U] |
| LLM 重试/退避 | **成熟** | 分类预算+jitter；**始终同模型、无升级路径**（§8-C3） |
| 工具体系（注册/权限/截断/编辑） | **成熟** | edit 无匹配不给定位提示（0.23% 频率，1 往返代价） |
| 并发 gate | **可能存在限制** | FAIL_CASCADE 一步内一损俱损（有 flag 可关） |
| 取消/级联/快照回卷 | **成熟** | 三阶段防竞态；3s 强杀 |
| 子代理生命周期/通知 | **成熟** | drain 非事务（自认 Tolerable）；**无运行时预算字段**（§8-C2）；ReAct 上限硬编码 3；全局并发上限【未知】 |
| 上下文压缩/检查点/重建 | **成熟** | 依赖 writer 成功否则有损降级；非 main 切片不重建 |
| 记忆/FTS 检索 | **成熟中带待验证** | history FTS 初始化/CJK 分词一致性【待验证】 |
| /goal 判官 | **成熟（有界）** | 内存态、fail-open、12 次、非独立上下文 |
| 任务树（T1） | **成熟（簿记）** | 是否参与完成判定【待验证】 |
| 预算/指标 | **可能存在限制** | ModelCall 仅成功路径；validation_status 恒 "skipped"（prompt.ts:4004）；无 task 归因 |
| workflow/沙箱 | **成熟（附已知限制）** | symlink 不解析（自认）；keep/revert 软约束；自定义 workflow 顶层覆盖与 README 描述不符【待验证】 |
| llm-server 兼容层与主 loop 关系 | **需进一步验证** | 【未知】 |

---



## 4. 当前 Echo 与上游的能力边界（四层区分）

> 依据：任务书"任务 3"。只登记**有证据**的能力；每条给出出处。密钥、私人数据只标存在性、不抄录值。

### 4.1 第一层：MiMoCode 上游原生能力（源码/文档证实，无需任何 Echo 配置）

| 能力 | 源码证据（`packages/cli/src/`） |
|---|---|
| Agent 主控循环、单步停/续分类 | `session/prompt.ts`（runLoop :3604 起）、`session/classify.ts:32 classifyAssistantStep` |
| 空轮/无效输出自动续跑（有上限，超限写错误） | `session/prompt.ts:4189 autoContinueInvalidOutput`；上限 `flag/flag.ts:181`（默认 **2** 次） |
| 重复步骤/文本循环提醒（原生"看门狗"雏形） | `session/prompt.ts:250 REPEATED_STEP_THRESHOLD=3`、`:4716-4738` 注入 loop-streak reminder、`session/prompt/loop-streak.ts` |
| 模型请求重试（同模型、有 backoff、分类决策） | `session/llm.ts:902 SessionRetry.decide`、`session/retry.ts`（PERSISTENT_RETRY 10 次 × 5 min 上限，prompt.ts:3296 注释） |
| /goal 独立判官（唯一显式任务级停止条件） | `session/goal.ts:144 evaluate`；`MAX_GOAL_REACT=12`（prompt.ts:243） |
| Task 任务树（T1/T1.1 状态机、防复活/防抢锁） | `task/schema.ts:7`、`task/registry.ts:285-296`、`tool/task.ts` |
| plan→build 模式切换（plan 硬禁写） | `agent/agent.ts:151/190`、`tool/plan.ts:20-96` |
| 子智能体（actor/task spawn、并行、preStop ReAct ≤3） | `tool/actor.ts:230`、`actor/spawn.ts:35/456` |
| 工具门（失败级联、只读并行白名单、权限询问） | `tool/gate.ts:19 FAIL_CASCADE_MESSAGE`、`session/processor.ts:450 executeTool` |
| 上下文压缩/检查点/重建（checkpoint-writer 子代理） | `session/checkpoint.ts`、`session/compaction.ts:610`、`session/prune.ts` |
| 记忆系统（MEMORY.md/checkpoint/notes + SQLite FTS5） | `memory/`、`history/` |
| 重复动作检测指标（edit 重试/bash 重试/动作连击） | `metrics/event.ts:45 TryBestDetected` |
| Token/成本落库（消息级、step-finish 部件） | `session/processor.ts:697-700`（step-finish part）、`message.data.cost/tokens` |
| 工具调用成败指标（含 error/cancelled 状态） | `metrics/event.ts:19 ToolCall`（status: success/error/cancelled） |
| 模型分层配置位（model_groups: ultra/standard/lite、small_model） | WP-R1 已实测：本机未配置 → 静默回退默认模型 |
| workflows 运行时（deep-research/fact-check/research-experiment）、内置 skills | `workflow/`、`skill/builtin/` |
| 权限系统、MCP、LSP、插件 15 钩子、serve HTTP API | `permission/`、`mcp/`、`lsp/`、`packages/plugin/src/index.ts`、`server/` |

### 4.2 第二层：Echo 外层封装提供（配置/插件/文件，均在本机、不进上游）

| 机制 | 位置与证据 | 状态 |
|---|---|---|
| context-gate 插件：视图侧投影（超 soft_limit 压缩老消息/图/工具输出）、roundtrip_hint、verify 预检、stats.jsonl 账本 | `C:\Users\微醺\.config\mimocode\context-gate\{index.ts(413行),verify.ts,gates.json}`；全局 `mimocode.jsonc` `"plugin":["./context-gate"]` | **在跑**（WP-R2 实测投影加权缩减 25.83%、errs=0；verify 有 4/13 误报） |
| TUI 插件 agent-panel.tsx（Agent 面板定制，含 phase3/4.2 备份） | `C:\Users\微醺\.mimocode\tui\` + `~\.mimocode\mimocode.json` `"plugin":["./tui"]` | 在跑（TUI-only 注册方式有既定坑，见 MEMORY.md 架构决策） |
| 模型/Provider 配置（deepseek flash 日常 + v4-pro 备用；含**明文 apiKey，禁止抄录**） | `C:\Users\微醺\.config\mimocode\mimocode.jsonc` | 在跑 |
| 上下文预算调参：`compaction.max_context:200K`、`checkpoint.thresholds:["70K","140K"]`、push_caps 砍半 | 同上（2026-10-14 定案，实测生效） | 在跑 |
| 危险命令 deny 规则（关机/重启族） | `~\.mimocode\mimocode.json` permission.bash | 在跑 |
| ~150 个个人 skills（Blender/办公/设计全家桶） | `C:\Users\微醺\.mimocode\skills\`、`C:\Users\微醺\.agents\skills\` | 在跑 |
| 个人记忆档案（MEMORY.md 68KB + 150+ spillover + identity 目录） | `D:\MiMoMemory\`、`~\.local\share\mimocode\memory\` | 在跑，**含密钥，禁止入仓** |
| 编排七步包（TRIAGE/HANDOFF/RECOVERY/任务账本 wu.py） | `D:\AlroLab\orchestrator\` | **人工约定，自动调用 0 次**（WP-R2 [M]） |
| memory-manager 写入闸门（四层查重/审计双账） | WP 阶段三产物 | **未注册**（仅工具路径生效，主控未挂） |
| tools/*.ts（model-router/circuit-breaker/task-state/gui-agent） | `C:\Users\微醺\.mimocode\tools\` | **从未加载 = 死代码**（WP-R2 [M]） |
| Alro 通道（8088 HTTP/QQ + 常驻 serve 4097） | `D:\AlroChannel\`、launch-agent.bat | 在跑（4097 serve 用旧插件，用户明令勿擅自重启） |

### 4.3 第三层：本机运行环境带来的能力/限制

- Windows + PowerShell 5.1（编码/BOM 坑、管道解析坑）；git 2.53；Node v24.19。
- **Bun 未安装** → 官方"改码即跑"路径（`bun run dev`）当前不可用，属【待批准】安装项。
- 已有生产库/日志/缓存：`~\.local\share\mimocode\`（mimocode.db/auth.json/日志）、`~\.local\state\mimocode\`、`~\.cache\mimocode\`；官方支持 `MIMOCODE_HOME` 整体重定向（`flag/flag.ts:419` 注释原文 "Use MIMOCODE_HOME to isolate dev"，`skill/builtin/.bundle/mimocode-docs/reference/config.md:15`）。
- 本机已有**第二棵源码树** `D:\AlroLab\research\MiMo-Code-src\`（v0.1.15，WP-R2 时期发现）——与本次 `D:\EchoCore\MiMo-Code` 并存，后续应统一为一棵（见 §5 待确认）。

### 4.4 第四层：只有改底层源码/运行时才能实现的候选改进（初步，详见 §7/§8）

| 候选 | 为什么外层做不到 | 源码线索 |
|---|---|---|
| 失败模型调用可观测性 | `metrics.model_call` 只在成功路径 publish（`session/processor.ts:725-737`、`session/prompt.ts:1394-1406` 成功后才发）；事件 schema 无错误字段（`metrics/event.ts:4-17`）；失败只落 `Session.Event.Error`/日志 | 改核心=补失败事件/计数 |
| 模型失败自动升级/降级 | 无配置 fallback 键；插件 `chat.params` 输出无 model 字段（WP-R1/R2 [M]）；`SessionRetry.decide` 只决定同模型重试 | 改核心=retry 决策加 escalation |
| 每步 token/耗时归因 | step-finish part 源码会写（processor.ts:697），但 WP-R2 实测 DB 中为空 → 落库条件【待验证】 | 改核心=补埋点 |
| goal 判官持久化/独立上下文/非 fail-open | 状态仅内存 Map、失败放行（goal.ts:111-119/4100-4108） | 改核心 |
| 任务树参与完成判定、maxSteps 默认无上限、SubtaskPart 派发失败静默 | prompt.ts:4887/2379-2385 | 改核心 |
| 空轮根因裁决数据 | 18 例空轮 84min 无账本数据（WP-R2 E-3/F-1） | 改核心=观测补全（与第 1 项同源） |

---

## 5. 独立研发环境与 GitHub 仓库方案（本阶段仅方案）

### 5.1 总体原则

- **不动生产**：`C:\Users\微醺\.mimocode`（安装+项目配置）、`~\.config\mimocode\`、`~\.local\{share,state}\mimocode\`、4097 serve、AlroChannel 全部保持原样。
- **fork 优先**：从 `XiaomiMiMo/MiMo-Code` fork，不重写、不另造历史。
- **一切密钥与个人数据不入仓**（见 5.5）。

### 5.2 本地目录布局（已建，均为纯文件夹，未 git init）

```
D:\EchoCore\
├── MiMo-Code\            # 官方仓浅克隆（审计工作区，origin=官方，不改动）
├── echo-core\            # 未来 fork 的工作副本（本阶段只有 docs/ 报告）
│   └── docs\echo-core-initial-audit.md
└── （阶段二待建）mimocode-home\   # MIMOCODE_HOME 隔离运行根：{data,cache,config,state}
```

> `D:\AlroLab\research\MiMo-Code-src\` 为历史遗留源码树，建议阶段二删除或标注废弃（需确认后执行）。

### 5.3 GitHub 仓库与分支结构（**待用户批准后创建**）

- 仓库名：`echo-core`（用户暂定），**fork 自 XiaomiMiMo/MiMo-Code**（保留 fork 关系与 LICENSE/USE_RESTRICTIONS）。
- 分支模型（上游固定 + 单轨改造）：
  - `main` = 上游追踪分支：**只允许 fast-forward 到官方 tag**（如 `v0.1.15`），承载"钉住的上游基线"；
  - `echo-dev` = 唯一开发分支：从 `main`（= v0.1.15 = `14dfe68a`）切出，每月优化在上面做；
  - 每月合并一次上游新 tag 进 `main`，再 rebase/merge `echo-dev`（先审上游 diff，不盲追）。
- 保护约定：`main` 禁直接 push 改动；所有 Echo 变更走 `echo-dev` → 审查 → 合并；发布以 tag `echo-vX.Y` 标记。

### 5.4 独立构建/运行/测试（阶段二步骤，均待批准）

1. 安装 Bun 1.3.14（与根 `package.json` packageManager 锁一致；免费，**需批准安装软件**）。
2. 在 `D:\EchoCore\echo-core` 执行 `bun ci`（官方 `bun install --frozen-lockfile`；**不执行任何未经审查的远程脚本**）。
3. 运行隔离：`$env:MIMOCODE_HOME="D:\EchoCore\mimocode-home"` → 所有 `{data,cache,config,state}` 重定向（源码依据 `flag/flag.ts:454-455`、`mimocode-docs/reference/config.md:15`）；其内写**独立最小配置**（自己的 provider/key 或测试模型、不带个人 skills/memory）。
4. 端口隔离：`bun run dev` 的 serve 固定用 **4098+**（避开生产 4097、通道 8088、调试 6499）。
5. 测试：`bun run --cwd packages/cli test`（官方约束：不能在仓库根跑）；先跑**上游基线全量测试**确认绿，再动第一行代码。
6. 成本测量：`MIMOCODE_ANALYSIS=1`（或按 flag.ts:106 opt-out 语义确认开关名【待验证】）本地观测 + `mimo stats`。

### 5.5 防泄漏与回滚

| 风险 | 措施 |
|---|---|
| 密钥入仓 | 仓内**不复制** `mimocode.jsonc`（含明文 apiKey）、`auth.json`、`Mimo Key.txt`；配置用 `${secret.X}` 占位；提交前 `git diff --stat` 人工审 + 可选 gitleaks 扫描【工具未装，待批准】 |
| 私人记忆/日志入仓 | `MIMOCODE_HOME` 独立根 + `.gitignore` 覆盖 `**/memory/**`、`**/*.db*`、`log/`、`stats.jsonl`；**本报告与仓内文件一律不抄密钥值** |
| 实验失败 | 三重回滚：① git（`echo-dev` 每步可回退，基线 tag 在）② `MIMOCODE_HOME` 目录整体删除/替换 ③ 生产环境零接触 → 天然无回滚需求 |
| 自动更新污染生产 | 生产 `mimo.exe` 不动；echo-core 运行只用 `bun run dev`/`dist`，不安装到 `C:\Users\微醺\.mimocode` |

### 5.6 与现有 Echo 的隔离清单

配置（两套 mimocode.json(c) 不混用）、端口（4097/8088/6499 保留生产，dev 用 4098+）、进程（dev 进程独立 PID、不碰常驻 serve）、缓存（`MIMOCODE_HOME` 自带 cache）、日志与记忆（独立 data 根，不读写 `D:\MiMoMemory`/`~\.local\share\mimocode\memory`）。

---

## 6. 基准评测任务及指标设计（可长期重复执行）

### 6.1 设计原则

- **真实任务、固定夹具**：每个基准任务 = 一份入库的夹具代码仓 + 一条任务描述 + 一份验收脚本；任何月份可原样重跑。
- **单变量原则**：跑分时固定（同一模型与版本、同一配置模板、同一夹具 commit、干净 `MIMOCODE_HOME`），只变"被测的 Agent 改动"，以区分**模型能力 / Agent 架构 / 工具环境 / 任务难度**四类影响。
- **不可测就标待验证**：没有可靠采集手段的指标一律标【待验证】，禁止编造（对齐"持续自进化④"）。

### 6.2 五类基准任务（B1–B5）

| 编号 | 类型 | 夹具与输入 | 预期结果与验收条件 | 可重复测试方式 |
|---|---|---|---|---|
| **B1** | 理解现有代码并定位问题 | 小型夹具仓（300–800 行 TS，预埋 3 个已知 bug：1 逻辑错、1 配置错、1 并发错）+ "定位 X 现象根因" | 输出根因文件:行号与解释；金标准答案比对 | 离线答案比对脚本（允许同义表述→人工二审一次并记录） |
| **B2** | 跨文件修改/开发任务 | 夹具仓 + 明确 feature 需求（需改 ≥3 文件 + 新增测试） | `bun run --cwd packages/cli test` 等价的夹具测试全绿 + 无回归 + diff 范围合理 | 验收脚本跑测试，机器判定 PASS/FAIL |
| **B3** | 测试失败根因分析与恢复 | 夹具仓预置一个失败测试（根因为某文件缺陷或配置缺失），任务="让测试通过" | 测试转绿 + 修复 diff 指向真实根因（非改断言/删测试） | 测试脚本 + diff 审查规则（禁止改断言的静态检查） |
| **B4** | 多步骤规划与子任务协调 | ≥4 子任务、含 2 个可并行分支的任务书 | 所有子任务 done、顺序依赖正确、并行分支确实并行、无子任务失败被无视 | task 树导出比对 + 过程日志审查 |
| **B5** | 根据测试结果判断是否真正完成 | 故意设计"看似完成实则测试挂"的陷阱任务（如只改了一半的实现） | **不虚报完成**：要么修完+测试绿才宣告，要么明确报告未完成项 | 完成声明与测试结果交叉核对；统计"假完成率" |

### 6.3 指标与采集

| 指标 | 采集方式 | 状态 |
|---|---|---|
| 最终任务成功率 | 验收脚本机器判定（B2/B3/B5）+ 金标准比对（B1/B4） | 可测 |
| 完成耗时（墙钟） | 运行起止时间戳；注意排除"用户不在场"空档（WP-R2 教训） | 可测 |
| 人工介入次数 | 会话中 HITL/权限询问/用户补充指令计数（DB `permission` 事件 + 人工标注） | 可测（自动计数【待验证】） |
| Token 消耗与费用 | `message.data.tokens/cost` + `mimo stats`（WP-R1 已验证价格回算口径） | 可测（失败调用不落账 → 见 §7 候选） |
| 无效重试/重复操作次数 | DB error part 计数 + `TryBestDetected` 事件 + 失败调用日志扫描 | **部分待验证**（失败调用观测缺口） |
| 测试通过率/回归 | 验收脚本输出 | 可测 |
| **假完成率**（B5 特有） | 完成声明 vs 验收结果交叉表 | 可测 |
| 每步 token/工具耗时 | step-finish part（源码有、实测空）| **待验证**（见 §4.4） |

### 6.4 执行方式（阶段二落地）

- 运行入口：`mimo run --format json`（headless）或 `mimo serve` + `POST /session/:id/prompt`【API 细节待验证】，全部在隔离 `MIMOCODE_HOME` + 4098 下执行。
- 每轮跑 B1–B5 各 1 次为最小集（成本受限时可降为 B2+B3+B5 核心集）；结果写入 `D:\EchoCore\benchmarks\results/<日期>-<版本>.md`，与基线行同表对比。
- **先建基线、后动代码**：v0.1.15+Echo 现状 = 基线行；任何改造必须带来基线行的可测改善才保留。

---

## 7. 历史优化机制盘点与迁移评估（补充任务）

> 证据源：`D:\MiMoMemory\projects\global\MEMORY.md` 及 MEMORY-* 档案、`C:\Users\微醺\docs\echo-efficiency-audit-wp-r2-20261015.md`（WP-R2）、外层插件实文件、`D:\EchoCore\MiMo-Code` 源码。**"已实现"只认实存代码/配置/日志，纯文档约定单列标注。**

### 7.1 机制逐项追踪表（任务书点名的 10 项全部回应）

| # | 机制 | 是否确已实现 | 原始问题（档案证据） | 当前缓解方式 | MiMoCode 底层对应模块 | 现有限制/根因 | 初步分类 |
|---|---|---|---|---|---|---|---|
| 1 | **任务路由（模型分档）** | **仅审计交付，自动切换未落地**：`MEMORY-wp-r1-model-tiering-audit.md:7`「模型切换几乎处处不生效」；`tools/model-router.ts` **从未加载=死代码**（MEMORY.md:95⑦） | 全部任务实走 deepseek-flash，无分档（MEMORY.md:96③） | 人工规则 + `/models` 手动切；配置不热加载 | `config model_groups`(ultra/standard/lite)、`small_model`——**原生存在但本机未配置**（WP-R1 [M]）；`actor/` 子代理 model 参数 | 根因①配置无 fallback 键；根因②插件 `chat.params` 输出无 model 字段（index.d.ts:412-424 [M]）→ 外层**无接口**可换模型 | **B 改底层**（启用原生分档 + retry 决策接入 fallback） |
| 2 | **角色分工（Analyst/Executor/Verifier/Domain Expert）** | **从未作为 agent 存在**：`BUILT_IN_AGENTS` 仅 main/general/build/explore/summary/title/checkpoint-writer/dream/distill/compaction（WP-R2 亲读 index.d.ts:178 [M]）；BRIEF-*.md 文件实存但零运行 | 执行者自检漏缺陷 → 需独立 verifier（`MEMORY-wp41-delivered.md:6`） | 「T8 必派独立 verifier」人工约定（orchestration README） | `agent/agent.ts` 内置 agent 定义；原生 actor 可临时扮演角色 | WP5.3-B A/B 实测**单 Agent 更合适**（多组墙钟 2.74×、成本 2.01×，`MEMORY-wp53b…:11`）；四角色实体化**已证伪** | 约定**C 留外层**；角色实体化**D 已证伪** |
| 3 | **子智能体协作** | **原生能力强**（actor spawn/wait/send/cancel、inbox 通知链全通，源码见 §3）；外层编排实验已关闭（V3 收尾） | 子代理只拿 prompt 零主历史；预算只写在 brief 文本（BN-01，`MEMORY-wp51-wp52-delivered.md:9`，415.6s>300s 实例） | 收益门槛三问 + brief 自包含约定 | `actor/{spawn,waiter,registry,notification}.ts`、`tool/actor.ts`、`inbox/` | ①**子代理无运行时预算字段**（超时靠人工 wait+cancel）②`parent_actor_id` 全 NULL → 成本不可归集 [M] ③ReAct 上限硬编码 3（spawn.ts:35-37） | 协作策略**C**；**预算强制/成本归集 = B** |
| 4 | **任务账本（wu.py 九字段）** | **外层实存但链路脱耦**：`D:\AlroLab\orchestrator\wu.py` 在盘；drive*.py 引用数=0（自动调用 0 次 [M]）；无锁无事务 | WP4 要求可追溯台账（MEMORY.md:28） | 人工登记；实验内 call-ledger.json | `task/{registry,schema}.ts`（原生 T1 任务树）、`session/todo.ts`【用途待确认】 | `stats.jsonl` **0 行带 task id**（WP-R2 F-2 [M]）→ 账本与观测互不相通 | wu.py 主链路 **D**；**任务级可观测关联 = A 迁入底层** |
| 5 | **并行检查（三检）** | 两层：外层「actor 并行三检」=提示词约定；**底层工具并行门真实存在**（`tool/gate.ts`：read/grep/glob 并行白名单、其余 barrier 串行） | 并发竞态（edit racing git commit）；串行耗时（E2 并发 −43%） | 三检约定 + V1 并行清单（天花板≈3.5%） | `tool/gate.ts`、`session/processor.ts` | 三检靠自觉；白名单窄 | 三检 **C**；扩大并行白名单 **B（低优先）** |
| 6 | **失败分类** | 外层 RECOVERY 四分类 = **仅文档**（自动调用 0 次）；**底层已有真分类器**：`session/classify.ts:32`（final/continue/filtered/think-only/invalid/failed）+ FAIL_CASCADE（gate.ts:19） | 失败不可见：4 次 402 → stats.jsonl 0 行；18 空轮/84min 无法裁决（MEMORY.md:95④，WP-R2 E-2/F-1） | RECOVERY 约定；V3 往返三分类方法论 | `session/classify.ts`、`session/retry.ts`、`Session.Event.Error` | **失败调用不进账本**：`metrics.model_call` 仅成功路径发布（§8-C1 证据） | 语义分类 **C**；**失败进账本 = B（最优先）** |
| 7 | **看门狗** | **候选未部署**：`budget_watchdog.py/watchdog_runner.py` 在 `D:\AlroLab\temp\wp4\`，「无生产部署授权」 | verifier 实测 415.6s/359.7s 双双超支 →「预算停止必须外部强制」（`MEMORY-wp41…:9`） | serve 轮询环（隔离）；actor 仅 wait+cancel+审计 | `actor/waiter.ts`、`metrics/`、`session/retry.ts` | **全运行时无 maxTurns/toolCallLimit/budget 字段**（wp42:5④ [M]）；预算耗尽事件无持久化（wp42:5⑥） | **B 改底层根因** |
| 8 | **取消与恢复** | **原生取消已实证**（wait→cancel 真中断在途请求，wp42:5② [M]）；原生恢复=checkpoint/resume 链（源码见 §3）；外层四级 abort 协议未部署 | 只 wait 不 cancel = 停不下来（WP4.1 超支根因）；「停止等待≠底层终止≠费用停增」三事件分离 | 手工 wait+cancel 串接 | `actor/spawn.ts:825 cancel`、`session/{checkpoint,revert,retry}.ts`、`prompt.ts resume:6504` | wait 超时**不自动** cancel；drain 非事务有重复通知窗口（inbox.ts:341-346 自认 Tolerable） | wait→cancel 联动 **B**；恢复协议 **C** |
| 9 | **上下文管理** | **已落地且实证正收益**：context-gate 投影（加权缩减 25.83%、errs=0）+ compaction 200K/checkpoint 绝对阈值（MEMORY.md:84/86） | 「上下文太长变慢变贵」；默认 944K 才压缩 | 视图侧投影 + 预算调参 + roundtrip_hint | `session/{compaction,checkpoint,overflow,prune}.ts` | ①投影**看不见系统提示+工具 schema**（65.6% 调用 >75K [M]）②est 低估 1.37×/2.54×（待校准）③4097 serve 未接入新插件 | 投影插件 **C 留外层**；计量口径低估 **B** |
| 10 | **预算意识** | 多点、多数仅隔离/文档：prompt 静态预算块（B0 定案，B1 动态裁定不部署）、cost_gate.py 三态闸（隔离 46/0）、TRIAGE 预算列无运行时强制 | L6 NULL 回填低估 13.7%；成本事件无持久化 | context-gate token 闸（上线）+ `mimo stats` 原生观测 | `message.data.cost`、`metrics/`、`config` compaction/checkpoint 预算 | 无 per-task/per-actor 预算强制；validation_status 恒 "skipped"（prompt.ts:4004） | cost 三态/预算字段 **B**；观测与闸 **C** |

### 7.2 四分类汇总

- **A 应迁入/重构进底层核心的有效能力**：
  1. **任务级可观测关联**（账本/指标带 task id——把"任务账本"思想落进原生 metrics/task 层）；
  2. **失败与空转进账本**（把外层"失败分类"诉求落进原生事件层，见 §8-C1）。
- **B 应通过改底层架构解决的根因**：模型分档/fallback 接口、子代理与任务的运行时预算字段（看门狗根因）、wait→cancel 联动、cost 回填三态、上下文计量口径低估。
- **C 适合留在外层的个性化能力**：编排七步/三检/RECOVERY 等**人工约定类**（本质是行为纪律而非机制）、context-gate 投影（外层插件恰是其正确层级）、身份/记忆/技能库、通道与 TUI 定制。
- **D 已重复/失效/无证据**：四角色实体（已证伪，A/B 判单 Agent 更优）、`tools/*.ts` 死代码（model-router 等 4 件从未加载）、wu.py 主链路自动调用 0 次（降级为文档约定，**不删**——是用户作品与纪律载体）、B1 动态预算（已裁定不部署）、管家 steward 系统（2026-10-14 已删）。

### 7.3 关键迁移的行为对照、回归与回滚（补充任务第 5 条）

| 关键迁移（A/B 类） | 迁移前行为（现状） | 迁移后目标行为 | 回归测试 | 回滚方案 |
|---|---|---|---|---|
| 失败调用进账本（→§8 C1） | 402/空轮：日志有、账本 0 行、主控无感 | 每次失败模型调用产生可查询事件（计数、类型、时长），与日志逐条对账 | **对账测试**：脚本输出 vs 日志 ERROR 行数零偏差（WP-R2 C1 既定方法，n=1 已知现场） | revert 单 commit；观测层无行为影响 |
| 子代理预算字段（看门狗根因） | brief 文本写预算，超支靠人工 wait+cancel（415.6s 实例） | actor spawn 支持 time/turn 上限，超限自动 cancel + 落账 | 基准 **B4** 加超时子任务变体：超限必须自动终止且父代理收到通知；现有 B4 不回归 | config 关闭新字段=回到无限行为；git revert |
| 模型分档/fallback（WP-R1 成果落地） | 单模型硬编码；失败同模型重试 4 次 | 失败按策略升级/降级（复用原生 model_groups 档位） | **故障注入**：mock 402 → 断言按档位切换；基准 B3 同价位对照 | 配置删除 fallback 键即回原行为（不删代码也可） |
| 任务级账本关联 | stats 0 行带 task id | 指标行携带 session+task 归因 | 指标行 join TaskRegistry 抽查 100% 可关联 | 字段级向后兼容，可停发 |

**迁移原则**（回应补充任务第 4 条）：不为迁移而迁移——每项必须同时满足①外层已有成果被**复用为规格或测试**（如 WP-R2 C1 的对账法、wp42 的 wait→cancel 语义）②有已知根因③有可验证收益；**不预设历史问题都来自底层**——分类 C/D 共 8 项（近半）明确留在外层或判定失效，说明历史上相当部分问题本就不在内核。

---

## 8. 候选瓶颈（≤3，全部有源码证据）

> 筛选口径：**核心运行时层面**（外层可修的不占名额）；与历史成果衔接（WP-R1/WP-R2/wp41/wp42 已诊断过）；有源码落点。WP-R2 当年因"本机无源码"把 C1 设计成外层脚本——Echo Core 使其可升级为核心级修复。

### C1：失败模型调用不可观测（"失败不进账本"）★

| 项 | 内容 |
|---|---|
| **源码证据** | ① `metrics/event.ts:4-17` `ModelCall` schema 无错误字段（finish_reason/tokens 必填）；② `session/processor.ts:725-737` 与 `session/prompt.ts:1394-1406` **仅成功路径** publish ModelCall；③ `prompt.ts:1387-1392` 预测调用失败→仅 `elog.warn` 后吞掉；④ 无效输出耗尽才发 `Session.Event.Error`（prompt.ts:4198）；⑤ `AgentRequest.validation_status` 恒 `"skipped"`（prompt.ts:4004）。**行为证据 [M]**：WP-R2 stats.jsonl 1,053 行 0 行 tin=0；4 次 402/2min31s 主控与账本全无感；18 空轮/84min 至今无法裁决 |
| **为何限制整体效率** | 最大已知浪费（84min/25.8% 往返中的失败分量）**不可裁决** → 无法定位根因；且**任何后续优化的收益都测不到**（失败调用不在指标里，成本/重试指标系统性低估）——是"没有基准就宣称优化"的反面：先有观测才有优化 |
| **已有机制为何不够** | 日志有 ERROR、DB 有 message.error，但二者都不进**可查询账本**；外层 context-gate 的 stats.jsonl 只记到 `ev:model`（成功事件）；plugin `event` 钩子能否收到失败事件 **[U]（WP-R2 §9.4 明确未验证）** |
| **预期收益 / 副作用** | 收益：84min 悬案可裁决；§6 的"无效重试次数"等指标转为可测；为 C2/C3 验证奠基。副作用：账本体积小幅增长；事件 schema 需定义（一次设计成本） |
| **复杂度 / 成本** | **低-中**。两档：A 档=外层只读对账脚本（复用 WP-R2 C1 设计，零核心改动）；B 档=核心新增失败事件（bus publish + 计数/落账）。开发消耗预计 <¥20（deepseek-flash 价，待核实） |
| **验证 / 基准 / 回滚** | **对账测试**：账本失败计数 vs 日志 ERROR 行数逐条零偏差（WP-R2 既定方法，已知现场 n=1）；跑 §6 B1–B5 确认"无效重试"指标非空且与日志一致。回滚：revert 单 commit / 删除外层脚本 |

### C2：子代理与任务无运行时预算强制（看门狗根因）

| 项 | 内容 |
|---|---|
| **源码证据** | ① `actor/spawn.ts` 无 time/turn 预算参数；`waiter.ts` 超时仅通知不自动 cancel；② ReAct 再入上限硬编码 3（spawn.ts:35-37，源码自注 TODO 配置化）；③ workflow 侧 `agentTimeoutMs` 默认 OFF（runtime.ts:179-185）；④ 行为证据 [M]：wp42:5④「全运行时无 maxTurns/toolCallLimit/budget 字段（0 命中）」、verifier 415.6s/359.7s 双超支、WP4.1 两例超支根因 |
| **为何限制** | 长任务最坏损失无闸：超支只能人工盯（用户非程序员，更依赖机制而非自觉）；子代理成本不可归集（`parent_actor_id` 全 NULL，wp51:10⑤）→ 预算无处记账 |
| **已有机制为何不够** | 预算只写在 brief 文本=纯约定；wait→cancel 需人工串接；metrics 无 task/actor 归因 |
| **预期收益 / 副作用** | 收益：超支自动终止+落账，最坏损失有界；B4 基准可量化。副作用：**误杀风险**（需宽限期/分级：先通知后强杀）；对"模型能力不足导致的慢"可能过早终止 |
| **复杂度 / 成本** | **中**：config schema（默认 OFF）+ spawn 参数 + 自动 cancel 联动 + 终止事件落账。预计开发消耗 <¥40 |
| **验证 / 基准 / 回滚** | B4 加"超时子任务"变体：超限必须自动 cancel 且父代理收到通知、账本有终止记录；现有 B4 不回归。回滚：默认 OFF 即回原行为 |

### C3：模型失败无升级/降级路径（同模型重试撞死）

| 项 | 内容 |
|---|---|
| **源码证据** | ① `session/retry.ts:323` decide 只判同模型可否再试（分类预算 request 4/30s 等）；② WP-R1 [M]：配置无 fallback 键；插件 `chat.params` 输出**无 model 字段**（packages/plugin/src/index.ts:412-424）→ 外层无换模型接口；③ 行为 [M]：4 次 402 全部打同一模型（WP-R2 §4.0）；④ **原生 `model_groups`(ultra/standard/lite) 与 `small_model` 存在但本机未配置**（WP-R1）→ 分档地基已有 |
| **为何限制** | 瞬时故障/欠费/限流 → 整段死局（2min31s 实例）；单 provider 单点；重试预算只延长同模型寿命不改变结局 |
| **已有机制为何不够** | 分层退避成熟但**永不换挡**；small_model 仅辅助任务；model_groups 未启用 |
| **预期收益 / 副作用** | 收益：可用性提升、死局时长有界。副作用：质量/成本档位漂移、防振荡（同一故障禁止来回切）、需定义升级语义（402 欠费该降级不该升级） |
| **复杂度 / 成本** | **中-高**：config schema + retry 决策点接入 + provider 解析 + 故障注入测试。预计 <¥60 |
| **验证 / 基准 / 回滚** | mock 402/503 故障注入：断言按策略换挡并落账；B3 对照跑。回滚：删配置键即回原行为 |

**落选说明**（曾进入候选池）：verify-gate `-File` 误报（外层 context-gate/verify.ts，本会话又实证 1 次）与 edit 无匹配提示（tool/edit.ts）——**均可修但不属"核心运行机制"**，列为外层并行小修候选，待另行批准；上下文固定税 38,575（系统提示+工具 schema 盲区）——价值大但一次改动面过宽、评估方法未定，暂不进前三。

---

## 9. 第一个月唯一优先优化建议：**C1 — 失败路径观测补全（核心级）**

**推荐理由**（对照补充任务三要件）：
1. **复用既有成果**：直接继承 WP-R2 C1 的对账法与现场样本（n=1 已知 402 案例、18 空轮悬案），当年仅因无源码只能设计成外层脚本——Echo Core 首月用源码把账做成**事件级、可回放**；
2. **已知根因**：失败既不进认知也不进账本（MEMORY.md:95④ 实证），且这同时遮住已知最大浪费的根因；
3. **可验证收益**：对账零偏差是硬指标；同时把 §6 基准的"无效重试次数/费用"从【待验证】转为可测——**它是验证一切后续优化的前置设施**。

**范围（严格一事）**：核心新增失败调用事件（覆盖 HTTP 层失败与空轮耗尽路径）+ 落账/计数接口；**不含**重试策略改动（那是 C3）、**不含**预算强制（那是 C2）。第一步可先跑 A 档对账脚本（零核心改动）拿到基线，再上 B 档核心事件——A/B 两档本身即"迁移前后行为对照"。

**验收**：① 对账测试零偏差（日志 ERROR ↔ 账本）；② 402/空轮现场重放可查；③ §6 指标表中"无效重试"摆脱【待验证】；④ 上游基线测试不回归（`bun run --cwd packages/cli test`）。
**回滚**：单 commit revert / 关闭事件开关；观测层无行为副作用，风险≈0。
**明确不做**：不改重试语义、不动 context-gate 生产插件、不碰 4097 serve、不碰生产配置。

> 外层并行小修（不属于本项、待另行批准）：verify-gate `-File` 提取缺陷——本会话再次实证误拦 1 次，根因已精确锁定（WP-R2 §5-C3），修在 `context-gate/verify.ts` 即可，**无需动底层**。

---

## 10. 预算估算、风险、回滚与待确认事项

### 10.1 预算（月上限 ¥200）

| 项目 | 估算 | 依据/状态 |
|---|---|---|
| 第一阶段（本审计） | **≈¥0 额外** | 未购订阅、未产生新 API 计费项；用现有模型与本地源码完成 |
| Bun 1.3.14 安装 | ¥0（仅需安装批准） | 官方要求，免费 |
| C1 实现（首月目标） | <¥20 | deepseek-flash 单价 $0.15/$0.60 per 1M（WP-R1 models.dev 抓取，**当前价待核实**） |
| 基准跑分（B1–B5 一轮） | ≈¥4–12/轮（$0.3–1.0） | 参照 WP-R2 任务样本 $0.06/$0.27/$1.52；建议月 2–4 轮 |
| C1 验收 + 回归测试 | ≈¥5–15 | 测试套件跑本地、模型调用少量 |
| **首月合计** | **≈¥30–70，留 ≥60% 余量** | 全程可用 `mimo stats` 对账（口径见 WP-R1） |
| MiMo-V2.6-Pro/Flash 接入 | 【待核实】 | 任务书暂定 Pro 处理复杂任务/Flash 辅助；WP-R1 抓取价 Pro $0.435/$0.87、Flash $0.14/$0.28 per 1M——**接入方式与现行价格未验证**；在核实前继续用现有 deepseek 配置 |

> 说明：本机日常消耗基线 $1.29/天（23 天 $29.77，WP-R1 [M]）属既有使用，**Echo Core 专项支出须单独统计**，以不突破 ¥200/月总上限为硬约束；若某月无明确瓶颈，允许只做审计与基线（任务书条款）。

### 10.2 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 密钥入仓（`mimocode.jsonc` 明文 apiKey、`auth.json`、记忆档案含旧 key） | 高 | 仓内零密钥原则（§5.5）；提交前 diff 审；**建议轮换已暴露的 DeepSeek key【待批准】** |
| 自动更新/误触污染生产 | 高 | 生产零接触；MIMOCODE_HOME 隔离；不注册开机自启；4097 serve 按用户指令不动 |
| 上游分叉漂移 | 中 | 钉 tag（v0.1.15=`14dfe68a`）；每月只做一次人工评估合并，不盲追 |
| 许可合规 | 低 | MIT + 保留双版权头；遵守 USE_RESTRICTIONS——**基准自动化须避免"无监督高风险动作"**（隔离目录+白名单+不 skip 生产权限） |
| 改造后回退失败 | 低 | 三重回滚（§5.5）；每步一 commit；实验默认 OFF 开关 |
| Bun 缺失导致构建链不可用 | 中 | 首月首要待批准项；未装前仅做只读审计与外层脚本（A 档） |
| Windows/PS 5.1 环境坑 | 中 | 沿用 verify-gate 经验；测试在官方支持路径下跑 |

### 10.3 回滚方案（总表）

1. **代码层**：`echo-dev` 每 commit 可 revert；基线 tag 永远在（§5.3 分支模型）。
2. **运行层**：`MIMOCODE_HOME` 目录整体删除/替换即恢复纯净；新机制默认 OFF。
3. **生产层**：本阶段全程未改生产 → 无需回滚；后续任何生产接入须单独批准并先在隔离环境验证。
4. **数据层**：基准结果、账本均为追加式文件，损坏可重跑（夹具 commit 固定）。

### 10.4 待确认/待批准事项（汇总）

| # | 事项 | 需要什么 |
|---|---|---|
| 1 | 安装 Bun 1.3.14 | **批准安装软件**（免费） |
| 2 | 创建 GitHub `echo-core` 仓库（fork 官方） | **批准创建+首次 push**（push 前提交内容清单人工审） |
| 3 | MiMo-V2.6-Pro/Flash 接入方式与单价 | 核实（models.dev/平台价目），核实前不切模型 |
| 4 | 轮换已写入档案/配置的 DeepSeek 等密钥 | 批准（涉及用户平台操作） |
| 5 | `D:\AlroLab\research\MiMo-Code-src` 旧源码树处置 | 确认删除或归档（避免双树漂移） |
| 6 | gitleaks 等防泄漏扫描工具安装 | 批准（可选，可用人工 diff 审替代） |
| 7 | plugin `event` 钩子能否收到模型失败事件 [U] | C1 A/B 档选型时以最小实验验证（本身是一次改动，需批准） |
| 8 | step-finish part 源码会写但实测 DB 为空的原因 | 【待验证】，C1 实施时顺带裁决 |
| 9 | `permissionAskTimeoutMs` 默认值、checkpoint writer 实际成功率、auto-resume 中途断流边界 | 【未知】，后续按需补审计 |
| 10 | 4097 serve 插件更新时机 | **维持用户指令：勿擅自重启**；接入新插件需专门批准 |

---

## 附：完成标准自查（任务书 §6）

| 标准 | 状态 |
|---|---|
| 理解主要 Agent 调用链（非浏览介绍） | ✅ §3 四模块源码级调用链（文件:行号） |
| 明确区分上游/Echo 外层/运行环境能力 | ✅ §4 三层 + 第四层候选 |
| 不影响生产环境的独立研发方案 | ✅ §5（仅方案，未建仓、未装、未改生产） |
| 可重复基准任务设计 | ✅ §6 B1–B5 + 指标与采集 |
| 有源码证据的候选瓶颈 ≤3 | ✅ §8 C1/C2/C3（含行为证据 [M] 与源码行号） |
| 推荐一个优先方向且未实施 | ✅ §9 C1，明确"不做"清单 |
| 完整报告 + 未完成/无法确认事项 | ✅ §10.4 待确认清单；全文 [U]/【未知】/【待验证】标注 |

**本阶段实际落盘物**：`D:\EchoCore\MiMo-Code\`（官方浅克隆，只读审计用）、`D:\EchoCore\echo-core\docs\echo-core-initial-audit.md`（本报告）。**未**创建 GitHub 仓库、未安装软件、未修改任何生产代码/配置/记忆/服务。
