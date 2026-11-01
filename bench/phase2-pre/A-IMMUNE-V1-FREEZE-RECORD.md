# Immune System V1 Freeze Record

任务编号：EC-PHASE2-PRE-01 / WP-01
生成时间：2026-10-31（V1 验收日）
性质：正式冻结记录（基于已验收证据固化，不新增功能）

---

## 1. 版本标识

| 项 | 值 |
|----|-----|
| 冻结对象 | Echo Immune System V1（工具错误源端分类 + 7 字段诊断 + C1 落账） |
| 上游基线 Commit | `496bb8c`（MiMo-Code main，Merge PR #2663） |
| **V1 源码形态** | **上游 `496bb8c` + 未提交工作区改动**（无独立 freeze commit，见 §2 说明） |
| 二进制版本串 | `0.0.0-main-496bb8c`（`mimo --version` 实测；channel=main，见 §7 已知偏差） |
| 正式安装路径 | `C:\Users\微醺\.mimocode\bin\mimo.exe` |
| **二进制 SHA256** | **`dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa`** |
| 二进制大小 | 136,007,680 字节 |
| 构建方式 | Bun compile（ASCII 路径 `C:\Temp\bun\bun.exe` 规避 ENOENT，见 PHASE1B-REPAIR-REPORT §6.0） |
| 构建日期 | 2026-10-31 |
| 运行时核验 | PID 29460（创建 2026-10-31 17:11:44，父 cmd.exe 34180）加载正式路径 = dc28dff1 |

> **重要事实**：V1 代码没有对应的 git commit/tag。它以未提交工作区状态存在于 `496bb8c` 之上（见 §2）。冻结的"版本"由本记录的文件哈希清单（§3）+ 二进制哈希共同锚定。将工作区固化为 freeze commit/tag 属项目负责人决策，本记录不代执行（只读约束）。

## 2. Git 状态快照（2026-10-31，只读采集）

仓库：`D:\EchoCore\MiMo-Code`，分支 `main`，HEAD `496bb8c`。

**相对 HEAD 的修改（tracked）**：

```
packages/cli/src/metrics/event.ts        | 65 ++++++++++++++++++++++
packages/cli/src/session/processor.ts    |  9 +++
packages/cli/src/session/prompt.ts       |  7 ++
packages/sdk/src/v2/gen/types.gen.ts     |  4 ++
4 files changed, 85 insertions(+)
```

**未跟踪新增（V1 核心）**：

```
?? packages/cli/src/metrics/classify.ts
?? packages/cli/src/metrics/immune-memory.ts
?? packages/cli/src/metrics/tolerance.ts
?? packages/cli/test/session/immune-real-path.test.ts
```

（另有 `M bun.lock`，属依赖锁文件漂移，非 V1 逻辑。）

## 3. V1 文件哈希清单（SHA256，冻结锚点）

| 文件 | SHA256 | 字节 |
|------|--------|------|
| `packages/cli/src/metrics/classify.ts` | `38dad26f6654a2c756b3812b225e180806a0db07e9e441234a78f3e658a23767` | 10,177 |
| `packages/cli/src/metrics/immune-memory.ts` | `11bbcbc7639d7ae668b349f1c2ccd5d09954ae31e01a14aa40b5eff3765209f7` | 2,400 |
| `packages/cli/src/metrics/tolerance.ts` | `a0474968da77c0e45fc281f2f432f79f94c64a4956a373d2a976ef09b1728e90` | 3,315 |
| `packages/cli/src/metrics/event.ts` | `4f4cb9f3b700b291b2474cc66e871056cfae353fee14d09259c28945bc6d8c15` | 4,460 |
| `packages/cli/src/session/processor.ts` | `c232a6a3aff6e1ee8a674de2c945dbb1ba3f29bfe7a03b6f492b1f96822303ae` | 58,158 |
| `packages/cli/src/session/prompt.ts` | `af987e1787ab1f67dde5c0c306c20edf7d9bf80cdc1122a932c6375590e9266e` | 354,134 |
| `packages/cli/test/session/immune-real-path.test.ts` | `7c0f4e36ef636df2be9a4afc67b8ff78c8af5a38104b9b6a62d5d0645bd4be30` | 10,143 |
| C1 插件 `~/.config/mimocode/context-gate/index.ts` | `bbcfee3d2adcde3d0ce3044c5dc22fbbdc5e07d9b2028d74a73284345084d0fc` | 23,437 |

**改动侵入面小结**：`event.ts` +65（DiagnosticInfo/agentID schema）、`processor.ts` +9（tool-error handler 调 classifyToolError + agentID 发布）、`prompt.ts` +7（cancelled 路径 diagnostic + agentID）、`types.gen.ts` +4（SDK 事件类型同步）。全部为**加法式插入**（diff 仅 insertions，0 deletions），未删除上游行为。

## 4. 验收证据归档索引

| 证据 | 位置 | 内容 |
|------|------|------|
| V1 冻结验收报告 | `bench/phase1b/IMMUNE-V1-FREEZE-REPORT.md` | T1 三态/T2 控制组/T3 集成/T4 七字段 + 回归 + §3.4 进程级闭合 |
| 修复总报告 | `bench/phase1b/PHASE1B-REPAIR-REPORT.md` | §12 dist 复验（DIST-ONLY）、§12A 正式安装验证 |
| **正式安装 E2E** | `bench/phase1b/evidence/tool-error-e2e-formal/` | `summary.json`、`C4_normal.json`、`C2_bad_params.json`（正式路径 dc28dff1，2026-10-31 17:20+） |
| stats.jsonl 原始行 | `~/.config/mimocode/context-gate/stats.jsonl` 行 14356–14372 | C4 sid `…JKTCbScp5H`（5 事件 0 error）、C2 sid `…OHCkpT1VxX`（11 事件 2 error 带 7 字段） |
| dist 基线对照 | `bench/phase1b/evidence/tool-error-e2e/`（含 `hist-86bad66b/`） | 同字节二进制的 dist 路径复验 + legacy 对照 |
| 单测证据 | `immune-e2e-test.ts`（8/8）、`immune-real-path.test.ts`（2/2）、classify 回归（43/43） | 见 IMMUNE-V1-FREEZE-REPORT §5 |
| 构建日志 | `bench/phase1b/evidence/build-attempt3-ascii-bun.log` 等 | ENOENT 根因与 ASCII bun 构建 |
| agentID 补丁 diff | `evidence/core-agentid.diff`、`core-agentid-rebuild.diff` | agentID 相对上游的完整 diff |
| 进程核验 | 本会话原始输出（CIM + Get-Process 双通道 + 事前 hash 校验 + 父进程佐证） | PID 29460 = dc28dff1 |

## 5. 测试基线固化

### 5.1 C4_normal（正常路径基线）

- 二进制：正式路径 dc28dff1；模型 `xiaomi/mimo-v2.6-flash`
- 断言基线：exit=0；**1 条 tool 事件**（read / st=success / cid 非空）；**0 条 ev:error**；切片 outcome=completed
- 参考时长：~23s（窗口 6 事件）
- 原始记录：stats.jsonl 14356–14361；`tool-error-e2e-formal/C4_normal.json`

### 5.2 C2_bad_params（错误分类基线）

- 断言基线：exit=0；3 条 tool 事件（error → success → error，模型自愈重试可见）；**恰好 2 条 ev:error**
- 错误 #1（cid `call_239e3db2…`）：`error_class=tool_execution` / stage=execution / name=Error / severity=error / recoverability=unknown / diagnosis_status=classified / source=tool:execute —— 对应 stderr `File not found: …\12345`（参数过 zod、执行期失败，语义正确）
- 错误 #2（cid `call_24af4bf7…`）：`error_class=tool_parameter` / stage=validation / name=RecoverableError / severity=warning / **recoverability=recoverable** / diagnosis_status=classified / source=tool.ts:wrap —— 对应 stderr `Invalid arguments … expected string, received undefined`（**V1 修复目标：纯参数校验失败正确分类**）
- cid 与 tool/error 一一对应，无重复无丢失；参考时长 ~17s（窗口 11 事件）
- 原始记录：stats.jsonl 14362–14372；`tool-error-e2e-formal/C2_bad_params.json`

### 5.3 回归基线

- `bun test classify.test.ts classify-integration.test.ts` → 43/43
- `immune-e2e-test.ts` → 8/8（含 R1/R2/R3 三态）
- `immune-real-path.test.ts` → 2/2（真实 prompt→tool→bus 链路）

## 6. V1 功能 / 接口 / 责任边界

### 6.1 功能边界（V1 做什么）

| 能力 | 说明 |
|------|------|
| 源端错误分类 | `classifyToolError(error, toolName)` 在 processor tool-error handler 内对异常分类 |
| 7 字段诊断 | error_category / error_stage / error_name / severity / recoverability / diagnosis_status / error_source，随 `Metrics.ToolCall.diagnostic` 发布 |
| recoverability 三态 | recoverable / non_recoverable / **unknown**（证据不足不推断） |
| C1 落账 | C1 插件优先消费 `diagnostic`；写 `stats.jsonl` ev:error（含 7 字段 + cid） |
| agentID 归因 | ModelCall/ToolCall 携带可选 agentID；C1 peekTidByAgent 精确归因（main 保持 tid=null） |
| 取消事件诊断 | prompt.ts cancelled 路径携带 diagnostic（tool_cancelled） |

### 6.2 接口边界（V1 对外契约）

- **事件契约**：`Metrics.ToolCall` 新增可选 `diagnostic?: DiagnosticInfo` 与 `agentID?: string`（全部 optional，缺失不破坏 legacy 消费）。
- **C1 消费契约**：有 `diagnostic` → 直接取 `error_category` 等字段；无 diagnostic → 回退 legacy `tool_name==="invalid"` 启发式。
- **不承诺**：diagnosis_status 高阶态（investigated/verified/unresolved）——Schema 已定义但分类器固定输出 `classified`；免疫记忆存储；自动重试/自动修复。

### 6.3 责任边界（V1 不做什么）

- 不做自动修复、自动重试、模型 fallback。
- 不做免疫记忆（SQLite）持久化（immune-memory.ts 仅数据结构定义，V1 无生产引用）。
- 不做自适应学习；tolerance.ts 仅原则/基线定义。
- 不改 AI SDK、不伪装 toolName="invalid"。
- 不覆盖其他基础设施遗留（货币 cost、slice_post 完整性等——见遗留清单，独立跟踪）。

## 7. 已知偏差与限制（冻结时如实记录）

1. **channel 偏差**：构建时未注入 `MIMOCODE_CHANNEL='local'`，二进制自报 channel=main / version=0.0.0-main-496bb8c。后果：触发上游更新检查。缓解：`mimocode.jsonc` 已设 `"autoupdate": false`（2026-10-31）。重建时应补设两个环境变量（双保险）。
2. **无 freeze commit**：V1 以工作区形态存在（§1/§2）。文件哈希清单（§3）为当前唯一字节级锚点。
3. **C1 在配置目录**：`context-gate/index.ts` 位于用户配置目录而非源码仓库，不在二进制内，热加载生效。其哈希已入 §3 清单；修改它即改变 V1 行为，受本冻结规则约束。
4. **C1 未注册工具路径**：真实 E2E 中模型拒调未知工具，`tool_not_found` 分类仅由单测/故障注入覆盖，无真实进程级 E2E（模型行为限制，非遗留缺陷）。

## 8. 维护与升级规则

1. **冻结期默认不改**：不新增诊断字段、不扩展分类枚举、不修改 classifyToolError 判定逻辑、不改 C1 消费优先级。
2. **缺陷修复例外**：发现实际缺陷允许最小修复，必须记录（原因/影响范围/回归证据：§5 三组基线 + 相关单测全绿），并在本记录追加修订条目。
3. **新能力入 V2**：自动修复、记忆存储、diagnosis_status 高阶态、新 error_category 一律进入 V2 分支/版本，不直接改 V1 契约。
4. **上游同步**：rebase/merge 上游时，冲突高危文件为 event.ts / processor.ts / prompt.ts / types.gen.ts（§3）。同步后必须重跑 §5 全部回归 + C4/C2 基线，对照 7 字段产出不变。
5. **C1 变更**：修改 context-gate/index.ts 前须确认不破坏"diagnostic 优先、legacy 回退"契约；修改后重跑 C2 基线确认 tool_parameter 仍正确落账。
6. **二进制重建**：必须 `MIMOCODE_CHANNEL='local'` + `MIMOCODE_VERSION='local'`；重建后重跑 §5 基线并更新本记录 §1/§3 哈希。
7. **账本兼容**：stats.jsonl 为追加型账本，历史行只读；新版本不得改写既有 ev 字段语义。

## 9. 冻结状态声明

基于 IMMUNE-V1-FREEZE-REPORT.md（T1–T4 全 PASS，进程级 §3.4 已闭合）与正式安装 E2E（§4 索引），**Immune System V1 自 2026-10-31 起进入冻结状态**。冻结锚点 = 二进制 SHA256（§1）+ 文件哈希清单（§3）+ 测试基线（§5）。本记录由只读审计产出，未修改任何生产代码/配置/状态。
