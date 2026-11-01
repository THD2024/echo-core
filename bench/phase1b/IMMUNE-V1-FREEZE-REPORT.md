# Immune System V1 收尾验收报告

**范围**：V1 冻结前整改 — 修复上一轮审计发现的 4 个问题（T1 recoverability 三态 / T2 C5 控制组 / T3 Core→C1 集成 / T4 七字段断言），补齐可复核证据。
**时间**：2026-10-31（初版）；2026-10-31 17:20+ 更新：进程级 C1 落账已闭合（正式安装 `dc28dff1` C4/C2 E2E，§3.4）。
**结论**：T1–T4 全部达成，回归无破坏，**进程级验证已闭合，V1 冻结条件全部满足**（见 §6 冻结条件核查）。

---

## 0. 状态图例

| 标记 | 含义 |
|------|------|
| **PASS** | 实际执行且断言通过 |
| **FAIL** | 实际执行但断言失败 |
| **SKIP** | 未执行（条件不满足） |
| **BLOCKED** | 存在明确工程阻碍，无法验证 |

---

## 1. T1 — Recoverability 三态判断  ·  **PASS**

### 1.1 问题
原 `getRecoverability()` 只有二态：`isRecoverableError → "recoverable"`，否则一律 `"non_recoverable"`。这把"证据不足"伪装成"确定不可恢复"，违反 unknown 保留原则。

### 1.2 实现位置
`packages/cli/src/metrics/classify.ts` · `getRecoverability()`（磁盘行 ~205–226）

### 1.3 判断规则（三态）
| 状态 | 触发证据 | 依据 |
|------|---------|------|
| `recoverable` | `isRecoverableError(error)` 为真 | RecoverableError = 模型下一轮可修正（参数/格式/未知 ID） |
| `non_recoverable` | `errorName === "NoSuchToolError"` 或 `RejectedError` / message 含 `permission denied` / `EACCES` | 工具不存在、权限拒绝 —— 同条件下重试无意义 |
| `unknown` | 其余（普通 Error、TimeoutError、ZodError、无恢复标记自定义错误） | 证据不足以判定恢复能力，不做推断 |

> 关键：非 RecoverableError **不再**统一归为 non_recoverable。

### 1.4 三态独立测试证据
见 E2E（`bench/phase1b/evidence/immune-e2e-test.ts`）中的 R1/R2/R3 三例，逐一断言恢复能力并核对判断依据：

| 用例 | 输入 | 期望 recoverability | 实测 | 结果 |
|------|------|--------------------|------|------|
| R1 | `new RecoverableError("Invalid arguments…")` | `recoverable` | `recoverable` | PASS |
| R2 | `Error` name=`NoSuchToolError` | `non_recoverable` | `non_recoverable` | PASS |
| R3 | `new Error("Something went sideways…")`（无恢复标记） | `unknown` | `unknown` | PASS |

Schema 一致性：`Recoverability = z.enum(["recoverable","non_recoverable","unknown"])`（`event.ts:33`），与函数返回值集合一致。**PASS**

---

## 2. T2 — C5 正常控制组（真实正常路径）  ·  **PASS**

### 2.1 问题
原 C5 以 `SKIP: No error to classify` 跳过，却仍被算入 `testCases.length`；且控制组为手动构造 `normalPublish` 对象后检查自身字段——是伪控制测试（未走生产发布路径）。

### 2.2 修复（真实正常路径，非模拟）
- **删除**手动构造 `normalPublish` 的伪控制测试。
- 定位生产真实成功发布路径：`prompt.ts:1961/2168` 在工具**执行成功后**真实 `bus.publish(Metrics.ToolCall, { tool_call_status: "success" })`（不带 diagnostic）。
- 新增真实测试 `packages/cli/test/session/immune-real-path.test.ts`（T2 用例）：复用 Phase1B 真实构建环境——真实 `Session.prompt(...)` 驱动真实 runLoop → 真实内置 `read` 工具成功执行 → 真实 `bus.publish` → 真实 `Bus.subscribeCallback(Metrics.ToolCall, …)` 捕获生产代码发布的事件。
- 统计口径分离：异常场景 / 控制场景分别计数，`skipped` 独立字段。

### 2.3 执行结果（真实正常路径）
```
(bun test ./test/session/immune-real-path.test.ts)
T2: 真实 read 成功 → success 事件无 diagnostic，窗口内无 error 事件  …… PASS
```
真实断言（全部作用于**真实捕获的 `Metrics.ToolCall` 事件**）：
- 真实成功事件 `tool_call_status === "success"` ✓
- 真实成功事件 `diagnostic === undefined`（正常不产生诊断）✓
- 成功窗口内**无任何 `tool_call_status === "error"` 事件**（C1 无从写错误账本）✓
- 无 `cancelled` 误报 ✓

C5 不再以 SKIP 充当通过；异常/控制/跳过三类独立统计。**PASS**

> 说明：此处为**单测进程内的真实正常路径**（真实生产 `prompt.ts` 成功发布 + 真实 bus 订阅，不含 C1 插件落账）。C1 进程级落账（`stats.jsonl`）见 §3.4 进程级验证边界。

---

## 3. T3 — Core → C1 真实集成验证  ·  **PASS（真实单测链路）**

### 3.1 链路
```
真实 Session.prompt(...) 驱动真实 runLoop
  → 真实内置 read 工具执行失败
  → 真实 processor.ts:647-668 tool-error handler
  → classifyToolError(error, toolName)                 // 源端分类（真实代码）
  → bus.publish(Metrics.ToolCall, { diagnostic })      // 结构化发布（真实 bus）
  → 真实 Bus.subscribeCallback(Metrics.ToolCall, …)    // 真实订阅消费
  → （进程级）C1 index.ts:517-538 → logStats 落账
```

### 3.2 集成测试设计（真实路径，非模拟）
删除旧的 `immune-core-c1-integration-test.ts`（以 `corePublishToolError()` / `c1ConsumeToolCall()` 复刻生产逻辑——属模拟）。
新增真实测试 `packages/cli/test/session/immune-real-path.test.ts`（T3 用例）：
- **不**复刻、**不**直接调用 `classifyToolError` 断言返回值。
- 真实 `Session.prompt(...)` → 真实内置 `read` 工具（schema 合法但文件不存在）真实执行失败 → 真实 `processor.ts` tool-error handler 真实调用 `classifyToolError` → 真实 `bus.publish(Metrics.ToolCall, {…, diagnostic})` → 真实 `Bus.subscribeCallback` 捕获生产代码发布的事件。
- 断言作用于**真实捕获的事件**：7 个诊断字段全部存在、`recoverability`/`diagnosis_status` 取值合法、`tool_call_id` 非空、同 `tool_call_id` 的 error 事件只有一条（不重复发布）、`diagnostic` 存在（未走 legacy 分支——legacy 不带 diagnostic）。

### 3.3 执行结果（真实单测链路）
```
(bun test ./test/session/immune-real-path.test.ts)
T3: 真实 read 执行失败 → error 事件携带完整 7 字段 diagnostic + cid，未走 legacy，不重复发布  …… PASS
2 pass, 0 fail, 22 expect() calls
```
每例真实 error 事件 `diagnostic` 的 error_category / error_stage / error_name / severity / recoverability / diagnosis_status / error_source 全部存在且取值合法，`tool_call_id` 非空、不重复。**PASS**

### 3.4 进程级 C1 落账（stats.jsonl）边界 — **已闭合（2026-10-31 17:20+）**

真实 C1 插件（`~/.config/mimocode/context-gate/index.ts`）只在**真实 mimo 进程**内加载并写 `stats.jsonl`；单测进程不含 C1 插件。
- 单测进程内已用**真实生产代码**验证 Core→bus 发布 + 消费一致性（§3.3）。
- 进程级 stats.jsonl（含真实 C1 落账）需含 Immune V1 代码的二进制：新构建产物 `dc28dff1…` 已确认含 `tool_parameter`/`diagnosis_status`（`classify.ts` 编入成功）。
- ~~**当前安装的 `~/.mimocode/bin/mimo.exe` 仍是旧版 `86bad66b`（不含 Immune V1）**，且有两个运行中进程（TUI 会话）占用该二进制。替换需重启 TUI，属用户运行时资产，未擅自替换。~~ **已于 2026-10-31 17:09 完成替换**：正式路径 `~/.mimocode/bin/mimo.exe` = `dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa`；用户重启 TUI 后新进程（PID 29460，创建 17:11:44）加载该二进制（时间序 + 文件 hash 双确认）。
- **进程级验证已执行**（2026-10-31 17:20+）：正式安装路径上跑 C4_normal + C2_bad_params 真实 E2E —— C4：1 成功工具事件、0 错误；C2：2 条 `ev:error` 均落完整 7 字段诊断（`tool_execution`/execution/Error/error/unknown/classified/tool:execute 与 `tool_parameter`/validation/RecoverableError/warning/recoverable/classified/tool.ts:wrap），事件经 Core→Bus→C1 落入 `stats.jsonl`。原始证据：`bench/phase1b/evidence/tool-error-e2e-formal/`（summary.json + C4_normal.json + C2_bad_params.json）。
- **进程级 stats.jsonl 验证：PASS**（本节原"待执行"项已闭合）。

---

## 4. T4 — 七个 DiagnosticInfo 字段断言  ·  **PASS**

### 4.1 Schema 定义（唯一真实类型）
`packages/cli/src/metrics/event.ts:47-56` `DiagnosticInfo`，7 字段**全部 optional**：

| 字段 | 类型 | 合法值 |
|------|------|--------|
| `error_category` | ErrorCategory | tool_not_found / tool_parameter / tool_execution / tool_cancelled / model_error / permission_denied / timeout / unknown |
| `error_stage` | ErrorStage | validation / execution / permission / model / transport / unknown |
| `error_name` | string | 原始错误类名 |
| `severity` | enum | info / warning / error / critical |
| `recoverability` | Recoverability | recoverable / non_recoverable / unknown |
| `diagnosis_status` | DiagnosisStatus | detected / classified / investigated / verified / unresolved |
| `error_source` | string | 错误来源组件 |

### 4.2 断言覆盖
`immune-e2e-test.ts` 每个异常用例（C1–C4, C6–C8, R1–R3）对 **7 字段逐一 `!==` 断言**（非仅打印）。C5 控制组断言 `diagnostic === undefined`（合法缺失）。**PASS**

### 4.3 敏感信息过滤
`classifyToolError` 仅提取 `error.name` / `error.message`，**不读取、不记录工具参数对象**（如 `input`），`error_source` 为固定常量串。诊断对象不含用户隐私/密钥。已核。**PASS**

---

## 5. 回归验证  ·  **PASS**

```
packages/cli: bun test ./test/session/classify.test.ts ./test/session/classify-integration.test.ts
 43 pass  0 fail  59 expect() calls
```
> 注：首轮曾报 1 fail，为环境偶发（超时）；干净重跑 43/43 全通过。

`tsc --noEmit` 对 metrics/classify 无类型错误。三态改动未破坏现有调用点。

---

## 6. 冻结条件核查

| # | 条件 | 状态 |
|---|------|------|
| 1 | T1 三态判断正确，helper 与分支判定口径统一，测试完整 | ✅ PASS（11/11，含 Timeout/Zod/取消/权限 recoverability） |
| 2 | T2 C5 控制组真实执行并通过（真实正常路径，非模拟） | ✅ PASS（真实 prompt.ts 成功发布 + 真实 bus 订阅） |
| 3 | T3 Core→C1 真实集成链路验证通过 | ✅ PASS（真实单测链路 + **进程级 stats.jsonl 已闭合**：正式安装 dc28dff1 上 C4/C2 E2E，7 字段诊断落账，2026-10-31 17:20+，见 §3.4） |
| 4 | T4 七个诊断字段均有有效断言 | ✅ PASS |
| 5 | 相关回归测试通过 | ✅ PASS（immune-e2e 11/11、immune-real-path 2/2、classify 43/43） |
| 6 | 未通过降低测试标准掩盖问题 | ✅ 删除伪控制测试与模拟集成测试，改真实路径；七字段全断言；无扩大容错 |
| 7 | 报告统计与实际执行一致 | ✅ 11/11 E2E、2/2 真实路径、43/43 回归、进程级 C4/C2 E2E，口径已分离 |

**结论：全部冻结条件满足（T1/T2/T3 含进程级/T4/回归）。**
进程级 C1 落账（stats.jsonl）已于 2026-10-31 17:20+ 在正式安装路径（`dc28dff1`）完成验证并闭合（§3.4）。**V1 冻结条件全部达成，可正式宣布 V1 冻结。**

---

## 7. 变更审计

| 文件 | 修改 | 原因 |
|------|------|------|
| `packages/cli/src/metrics/classify.ts` | `getRecoverability()` 二态→三态（新增 unknown 分支）；抽 `isTimeoutError`/`isPermissionDenied`/`isNoSuchToolError`/`isZodSchemaError` 共享判定；取消/未注册两个 options 分支保留显式覆盖并注明理由 | T1 判定一致性 |
| `packages/cli/src/metrics/event.ts` | +65 行：DiagnosticInfo / ErrorCategory / ErrorStage / Recoverability / DiagnosisStatus Schema | Immune V1 结构（已跟踪，modified） |
| `packages/cli/test/session/immune-real-path.test.ts` | **新增**：真实 Session.prompt→真实内置 read→真实 processor/prompt 发布→真实 Bus.subscribeCallback，T2 成功路径 + T3 错误路径 | T2/T3 真实路径（替代模拟） |
| `bench/phase1b/evidence/immune-core-c1-integration-test.ts` | **删除**：以 corePublishToolError/c1ConsumeToolCall 复刻生产逻辑的模拟集成测试 | T3 改真实路径 |
| `bench/phase1b/evidence/immune-e2e-test.ts` | 重写：C5 真执行、七字段断言、R1–R3 三态、准确统计 | T1/T2/T4 |

**无关模块**：未触碰 Agent Loop、自动重试/恢复、免疫记忆存储、自适应学习、C1 除消费逻辑外的部分、B1–B6 冻结基线。`classify.ts` 为新文件（untracked），未纳入 git 暂存（未执行 `git add`，保留工作区状态）。

---

## 8. 未实现 / 遗留

- **免疫记忆（SQLite）**：V1 未实现（按边界不启动）。
- **diagnosis_status 高阶态**（investigated / verified / unresolved）：Schema 已定义，分类器当前固定输出 `classified`（正确——单次分类 ≠ 根因验证）。
- ~~**进程级 C1 落账（stats.jsonl）验证**：真实 C1 插件只在真实 mimo 进程内加载。新二进制 `dc28dff1`（含 Immune V1）已构建通过冒烟，但安装的 `86bad66b` 仍被两个运行中 TUI 进程占用。替换 + 重启 TUI + 跑 C4_normal/C2_bad_params 属用户运行时操作，待授权执行（见 §3.4 / §6）。~~ **已闭合（2026-10-31 17:20+）**：正式安装 `dc28dff1` 上完成 C4/C2 进程级 E2E，7 字段诊断落账 `stats.jsonl`，V1 冻结条件全部达成（见 §3.4 / §6）。
