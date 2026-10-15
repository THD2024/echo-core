# Echo Core 阶段状态（暂停点）

- 更新时间：2026-10-16（阶段收尾 v1.0 完成时）
- 状态：**第一阶段审计收尾与基线冻结完成；正式核心改造暂缓，等待授权与预算。**

---

## 1. 当前基线（实测，非引用）

| 项 | 值 |
|---|---|
| 审计源码 | `D:\EchoCore\MiMo-Code`，分支 main（跟踪 origin/main），HEAD `496bb8cbe614aecea27623457d143600cc12c275`（2026-10-15），工作区**干净**，无 stash |
| 上游版本锚 | tag `v0.1.15` = `14dfe68a1c121f859544ba810b3c308e8501bfb2` |
| 研发目录 | `D:\EchoCore\echo-core`（**尚未 git init**；GitHub 私有仓库**已创建**：`THD2024/echo-core`（私有，main，空库 auto_init=false，2026-10-16 用凭据管理器中既有 PAT 创建，**尚未 push**）。认证走系统凭据管理器（git credential fill），无需 gh CLI |
| 文档 | `docs\echo-core-initial-audit.md`（阶段一审计）、`docs\c1-implementation-plan.md`（C1 封存方案）、本文件 |
| 仓库附件 | `LICENSE` + `USE_RESTRICTIONS.md`（自上游拷贝，发布必备）、`.gitignore`（P1 建立，已送审待批） |
| Bun | 1.3.14 已装于 `D:\EchoCore\tools\bun-npm\node_modules\@oven\bun-windows-x64-baseline\bin\bun.exe`（npmmirror 安装；baseline 版全 CPU 兼容）。已在 `D:\EchoCore\MiMo-Code` 冒烟：`--version`/`-e`/`bun pm pkg get name` 均通过。**尚未 `bun ci`**（依赖未装） |
| 生产环境 | 未触碰：生产 mimo 0.1.15、`C:\Users\微醺\.config\mimocode\`、4097 serve、8088 通道、全部记忆与配置均零修改（本阶段全程只读） |

## 2. 已完成

- P0 现场核实（实测分支/HEAD/工作区/文档）。
- P1 成果保护：上传范围密钥扫描**零命中**；`.gitignore` + 许可证文件就绪；首推清单待人工审核（见 §5）。
- P2 Bun 1.3.14 独立安装并冒烟验证。
- P3 C1 方案封存（根因双层实证：账本层忽略 `session.error`；核心层 `metrics.model_call` 仅成功发布；`plugin/index.ts:371 subscribeAll` 事件可达性打通）。
- 阶段一审计报告（10 章，含四模块源码级架构、历史机制四分类、候选瓶颈 C1/C2/C3）。

## 3. 未完成 / 挂起

| 项 | 阻塞原因 |
|---|---|
| GitHub 首推 | 仓库 `THD2024/echo-core` 已建（2026-10-16，用户当场授权）；**首推前必须提交：待上传文件清单 + .gitignore + 密钥扫描结果 + 许可证清单，等待人工审核**（清单见 §5，已备齐）。用户计划 **2026-10-17 审核并执行首推**（"明天再 Push"，2026-10-16 收尾时指示） |
| `bun ci` 与上游测试基线 | 未授权执行依赖安装（属 C1 实施阶段第一步） |
| C1 A/B 档实施 | 任务书明确：本轮只封存方案 |
| H1/H2/H3/H4 最小实验 | 同上，需批准后在隔离环境进行 |
| D:\AlroLab\research\MiMo-Code-src 旧源码树 | 未做依赖检查，按令**不删除不覆盖**，处置待批准 |
| MiMo-V2.6-Pro/Flash 接入方式与单价核实 | 挂起，不阻塞 C1 |

## 4. C1 方案指针与验收（摘要）

- 方案全文：`docs\c1-implementation-plan.md`。
- 首月唯一目标：**C1——失败模型调用观测与账本对账修复**（不动重试语义）。
- 验收五条：失败可靠查询；账本 vs 日志 ERROR **逐条**对账；区分重复/非模型错误/特殊情况；不改重试/路由/模型/插件行为；echo-dev 独立分支、单 commit 可 revert。

## 5. 首推待审清单（GitHub 私有仓库 echo-core；当前 6 项）

1. `docs\echo-core-initial-audit.md`
2. `docs\c1-implementation-plan.md`
3. `docs\PHASE-STATUS.md`（本文件）
4. `.gitignore`
5. `LICENSE`（MIT，小米+opencode 双版权）
6. `USE_RESTRICTIONS.md`

密钥扫描：`sk-`/`tp-`/`Bearer` 模式对全部待传文件**零命中**（2026-10-16）。

审核通过后的首推命令序列（在 `D:\EchoCore\echo-core` 执行）：
```
git init -b main
git remote add origin https://github.com/THD2024/echo-core.git
git add . && git commit -m "chore: phase-1 audit freeze (docs, license, gitignore)"
git push -u origin main
```
凭据由 Windows 凭据管理器自动提供（无需 gh）。

## 6. 未获批准的操作清单（恢复后逐项确认授权状态）

推送 GitHub 仓库（**首推清单待人工审核**，仓库本身已获授权创建并已建成）；`bun ci` 依赖安装；C1 核心代码修改；生产 context-gate（A 档）修改；MiMo-V2.6 模型接入切换；旧源码树清理；gitleaks 等新工具引入；DeepSeek 密钥轮换执行。（gh CLI 安装已不需要——PAT 在凭据管理器中可直接用）

## 7. 恢复工作时的第一步

> **第一条命令**：
> `git -C "D:\EchoCore\MiMo-Code" log -1 --format="%H" && git -C "D:\EchoCore\MiMo-Code" status --short`
> 对照本文件 §1 的 HEAD `496bb8cb` 与干净工作区——不一致即先查明差异。
> **第一项检查**：确认 §6 各项授权状态（用户已批哪些），然后按 `c1-implementation-plan.md` §8 顺序执行。

## 8. 预算与费用

- 本阶段实际额外费用：**≈¥0**（bun 经 npmmirror 免费下载 38MB 级流量；无 API 新消耗口径——审计用 token 属既有订阅内日常消耗，未新增付费）。
- C1 实施预计：**≤¥10**（隔离环境 deepseek-flash 跑 H1–H4 实验与对账验证）。
- 月度上限 ¥200 不变；未批准不得新增付费。

## 9. 越界声明

**未修改**生产环境（Echo/Alro/插件/配置/记忆/服务）；**未修改**任何核心代码；**未**执行未经批准的操作（bun 安装属任务书 P2 明示批准范围）。
