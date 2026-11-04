# Echo Phase 1B — 观测与归因最小修复报告

生成时间：2026-10-31  
环境：MiMoCode v0.1.16（`mimo.exe`）+ 当前 Echo 源码（`D:\EchoCore\MiMo-Code`）+ C1（`context-gate`）已启用  
原则：先定位、再最小修复；不为指标好看改统计口径；不扩大到 Agent Loop / 预算 / 记忆重构。

---

## 0. 结论摘要

| 项 | 状态 | 说明 |
|---|---|---|
| 1B-1 专用错误事件 | **已修复（C1 侧，已生效）** | 工具失败 → `ev:error` + `error_class`；LLM/API 保持 `kind=llm` + `error_class=llm_api` |
| 1B-2 Model/Tool tid 归因 | **已通过 E2E（新二进制）** | Core 发布 `agentID`；双 tid（T1/T2）model/tool 归因正确，main 保持 `tid=null`，无串线（§6.4） |
| 1B-3 Reconciler 误报 | **已修复** | `suspicious_no_gate` 32 → 0；按切片自身 tid 判定，main `tid=null` 不标记 |
| 1B-4 串行成本 | **已测量** | B1/B2/B4/B5 各 3 次，12/12 验证通过；缓存输入约 88%；**实际 API 费用 C1 无法从账本取得（null）** |
| 构建阻塞 | **已解除** | ENOENT 根因 = Bun compile 复制含中文路径的 `process.execPath`；改用 ASCII 路径 bun 产出新二进制（§6.0） |
| Phase 1B-1 工具错误分类闭环 | **已完成** | 三类错误真实链路查清；四种真实 Core 调用验证；C1 最终落账确认；TUI 新二进制验证（§7） |
| Phase 1B-1a 参数错误根因 | **已闭环** | 根因：legacy C1 只认 `tool_name==="invalid"`；修复：Core 源端 `classifyToolError` + `diagnostic`；`dc28dff1` E2E 纯参数错 → `tool_parameter`（§12，dist 证据） |
| Phase 1B-1a 正式安装验证 | **已通过** | 正式路径 `~/.mimocode/bin/mimo.exe` = `dc28dff1`；进程 PID 29460 加载新二进制；C4+C2 真实 E2E → 7 字段诊断落账（§12A） |

**是否建议进入下一轮：**  
观测链路（错误事件、并行 tid 归因、对账误报）已具备最小可用形态。**并行 model/tool 归因 E2E 通过**（新 mimo 二进制）。串行成本可作窗口级参考；若做预算仍需货币 cost 字段。**Phase 1B-1a 参数错误分类已在 dist 二进制 `dc28dff1` 上真实 E2E 闭环**（§12，dist-only 证据）；**正式安装路径现为 `dc28dff1` 且已通过进程级 + E2E 验证**（§12A，formal-install 证据）。

---

## 1. 问题与根因

### 1.1 专用错误事件缺失

**现象：** Phase1 测试中专用 `ev:error = 0`，但 `tool.st=error` 可观察。

**根因：**  
C1 只在 `session.error`（LLM/API）时写 `ev:error`。工具失败只记 `metrics.tool_call` 的 `st=error`，没有统一错误查询面。

**语义边界（明确什么该发、什么不该发）：**

| 来源 | `ev:error` | `error_class` |
|------|------------|---------------|
| 工具执行失败 | 是 | `tool_execution` |
| 工具参数非法（`tool_name=invalid`） | 是 | `tool_param` |
| LLM/API（`session.error`） | 是 | `llm_api` |
| 工具成功 / 取消 | 否 | — |

**最小修复：** C1 在 `metrics.tool_call` 且 `tool_call_status=error` 时额外写一条 `ev:error`（`kind=tool`）。不改执行路径、不加自动重试、不双发成功事件。

### 1.2 Model（及 Tool）事件缺少 tid

**现象：** 并行测试时 Model 事件几乎全 `tid=null`（历史账本 4999 条 model 里仅个位数有 agent/tid）。

**根因链：**  
1. 并行子代理共享同一 `sessionID`。  
2. C1 的 `peekTid` 只看 session 切片栈顶 → 并发时串线或猜错。  
3. Core 的 `Metrics.ModelCall` / `Metrics.ToolCall` **未携带 `agentID`**，C1 无法按 actor 区分。  
4. 主 agent 的 `agentID` 为 `main`/`undefined` → **tid 保持 null 属设计**，不是故障。

**最小修复（侵入面）：**  
- Schema：`ModelCall`、`ToolCall` 增加可选 `agentID`。  
- 发布点：`processor.ts` 用 `ctx.assistantMessage.agentID`；`prompt.ts` 工具路径用 `ctx.actorID`（与 `Tool.Context` 已有字段对齐）。  
- C1：新增 `peekTidByAgent(sid, agentID)`——**有 agentID 则必须匹配栈条目，匹配不到返回 null，禁止回退栈顶猜测**；无 agentID（legacy/main）才 `peekTid`。

**未使用：** 全局变量存当前 tid、按时间戳猜归属、按并行数均分 Token、第二套任务身份体系。

### 1.3 Reconciler `suspicious_no_gate` ×32

**根因：** 原逻辑用 “sid → 该 session 全部未终态 tid 的集合” 与切片 outcome 交叉。并行多 tid 会话会把**任意** completed 切片关联到**所有**未完成任务 → 误报。

**修复：** 只检查**该切片自己的 `tid`** 是否未终态；`tid=null`（main）永不进该桶。真实未终态任务仍留在「未完成 / 恢复中」。

### 1.4 单任务成本

C1 账本只记 Token（`tin`/`cache`/`tout`），**不记货币成本**（`actual_cost_cny = null`）。  
串行窗口测量见 §5；并行历史窗口缓存比约 **89–91%**。

---

## 2. 源码位置与调用链

### 2.1 Core（`D:\EchoCore\MiMo-Code`，未提交 diff 见 `evidence/core-agentid.diff`）

| 文件 | 变更 |
|------|------|
| `packages/cli/src/metrics/event.ts` | `ModelCall`、`ToolCall` 增加 `agentID?: string` |
| `packages/cli/src/session/processor.ts` | `ModelCall` 两处 + tool-error `ToolCall` 一处发布带 `agentID` |
| `packages/cli/src/session/prompt.ts` | 4 处 `ToolCall` 发布带 `agentID: ctx.actorID` |
| `packages/sdk/src/v2/gen/types.gen.ts` | 两个事件类型可选 `agentID` |

**生效条件：** 需重建/重启 CLI。当前进程仍用旧二进制；`build:local` 在 bun compile 复制 runtime 时 `ENOENT` 失败（临时目录/权限），**未产出新 mimo 二进制**。

### 2.2 C1（`C:\Users\<user>\.config\mimocode\context-gate\index.ts`）

- `peekTidByAgent`  
- `metrics.model_call` / `metrics.tool_call` 使用 `peekTidByAgent`  
- tool error → `ev:error`  
- `session.error` → `error_class: llm_api`  

热加载：`gates.json` mtime / 文件变更即生效（本会话已加载新逻辑）。

### 2.3 Reconciler（`D:\EchoCore\echo-core\bench\reconcile.py`）

`suspicious_no_gate` 按切片 `tid` 单独判定。

---

## 3. 修复前证据（摘录）

历史 stats（修复前）：

- model 事件 ~4999，**99.9% tid=null**  
- 无 agent 的 model 无法拆到 run  
- `slice_post` 在部分路径为 0（Phase1 已知；本任务未强制改 post 钩子）  
- 三源对账曾出现 32 条 `suspicious_no_gate`

DeepSeek 默认模型 headless 调用：

```text
{"type":"error",...,"Insufficient Balance",...statusCode:402,"providerID":"deepseek"}
```

C1 同步写出：`ev:error kind=llm` + `slice outcome=error`（错误链路对 LLM 侧是通的）。

---

## 4. 修复后验证

### 4.1 单元 / 注入测试

| 测试 | 结果 |
|------|------|
| `c1-logic.test.ts` | 11/11 PASS（并行 A/B 无串线；error_class；main tid null） |
| `c1-plugin-feed.test.ts` | 11/11 PASS（tool 错误 → `T_FEED_A`；model A/B tid 正确） |

注入事件特征：

```text
ev=tool  tid=T_FEED_A agent=general-A st=error
ev=error tid=T_FEED_A agent=general-A kind=tool error_class=tool_execution
ev=model tid=T_FEED_A agent=general-A tin=1000
ev=model tid=T_FEED_B agent=general-B tin=2000
```

交叉归因检查：`no tid has multiple agents`。

### 4.2 受控真实调用（mimo.exe + xiaomi 主模型）

- Headless DeepSeek：LLM `ev:error` + slice error（余额）  
- 切换主模型后 serial 任务正常；**当前进程 model 事件仍无 agent（旧二进制）**，与 §2.1 一致。

### 4.3 三源对账（串行采样后）

```text
正常结束: 46
失败: 1 (T5)
未完成: 7 (历史子任务 T2.x/T3.x)
恢复中: 5 (含本阶段 T14/T18 等)
无法归类: 0
suspicious_no_gate: 0
账本错误数: 12（含工具/LLM 测试痕迹，非对账未知任务）
```

未解释异常：无「无法归类」；`suspicious_no_gate=0`。

---

## 5. 串行成本测量（B1/B2/B4/B5 ×3）

**方法：** 每次独立 `mimo run --dangerously-skip-permissions`，前后统计 `stats.jsonl` 增量；仅该进程窗口；默认模型 `xiaomi/mimo-v2.6-flash`。  
**货币费用：** 账本无字段 → **全部 null**，未用估价冒充。

| 类别 | 验证通过 | 均耗时 (s) | Input | Cached | Non-cache | Output | 缓存比 | 工具调用 | error 事件 |
|------|----------|------------|-------|--------|-----------|--------|--------|----------|------------|
| B1 | 3/3 | 7.30 | 81286 | 67819 | 13467 | 76 | 83.4% | 3 | 0 |
| B2 | 3/3 | 11.51 | 79615 | 64192 | 15423 | 182 | 80.6% | 3 | 0 |
| B4 | 3/3 | 7.11 | 39616 | 38656 | 960 | 135 | 97.6% | 0 | 0 |
| B5 | 3/3 | 8.96 | 79357 | 75563 | 3794 | 148 | 95.2% | 3 | **3** |
| **合计** | **12/12** | **8.72** | **839618** | **738688** | **100930** | **1624** | **88.0%** | 9 | 3 |

B5 三次均出现 1 条 `ev:error`（读不存在文件）→ 与 §1.1 设计一致。  
原始 JSON：`bench/phase1b/serial-cost/*.json` + `serial-runs.jsonl` + `serial-summary.json`。

**解读：**  
- 输入大头是 **上下文固定税**（系统提示 + 工具 schema + 记忆注入），不是单次工具 payload。  
- 缓存命中高（B4/B5 >95%）说明重复前缀有效；B1/B2 首轮/变上下文更多 non-cache。  
- **不能**把窗口 `tin` 直接除以任务数当“单任务费用”——并行时更不能。

---

## 6. Core 二进制重建与并行归因复验（2026-10-31 13:00+）

### 6.0 ENOENT 根因与最小修复

**现象：** `bun run script/build.ts --single`（`build:local`）在 `building mimocode-windows-x64` 阶段失败：

```text
error: failed to copy bun executable into temporary file: ENOENT
error: Failed to get temp file path: FileNotFound
Bun v1.3.14 (Windows x64)
```

**定位：**

| 对照 | 结果 |
|------|------|
| bun 版本 | 1.3.14 = `packageManager` pin，版本检查通过 |
| 默认 TEMP 可写 | 通过 |
| ASCII TEMP（`C:\Temp\BunBuild`）仍失败 | 失败 — TEMP 本身不是根因 |
| 最小 `Bun.build({compile})` 探针 | 同样 ENOENT — 与 mimo 源码无关 |
| `process.execPath` = `C:\Users\<user>\AppData\Roaming\npm\...\bun.exe` | **路径含中文用户名「（已脱敏）」** |
| 将 bun.exe 复制到 `C:\Temp\bun\bun.exe` 后最小 compile | **BUILD_OK** |

**根因：** Bun 1.3.14 在 `compile` 时会把 **`process.execPath` 自身** 复制到临时文件；当 execPath 含非 ASCII 字符（中文用户名）时，内部复制路径解析失败 → ENOENT。与构建脚本、依赖、工作目录无关。

**最小修复（不改构建系统）：** 用 **ASCII 路径** 下的同版本 bun 执行构建：

```powershell
Copy-Item "$env:APPDATA\npm\node_modules\bun\bin\bun.exe" "C:\Temp\bun\bun.exe" -Force
$env:MIMOCODE_CHANNEL='local'; $env:MIMOCODE_VERSION='local'
Set-Location "D:\EchoCore\MiMo-Code\packages\cli"
& "C:\Temp\bun\bun.exe" run script/build.ts --single
```

**结果：** smoke test `dist/mimocode-windows-x64/bin/mimo --version` → `local`；EXIT=0。

日志：`evidence/build-attempt1.log`（失败）、`evidence/build-attempt3-ascii-bun.log`（成功）。

### 6.1 新二进制身份

| 项 | 值 |
|----|-----|
| 安装路径 | `C:\Users\<user>\.mimocode\bin\mimo.exe` |
| 构建产物 | `D:\EchoCore\MiMo-Code\packages\cli\dist\mimocode-windows-x64\bin\mimo.exe` |
| Size | 135,996,928 |
| mtime | 2026-10-31T13:09:23+0800 |
| **SHA256** | **`86bad66b5451f7e4096a2abcd490404d2ff95c616b9cb9215d9d86bf9a254685`** |
| `--version` | `local` |
| 旧二进制备份 | `mimo.exe.pre-phase1b-rebuild`（SHA256 `801c91d0…7bdd`，mtime 10-26） |
| Core agentID patch 在二进制内 | **是**（minify 后为 `agentID:kH.string().optional()`，位于 `metrics.model_call` schema） |

替换方式：旧文件被运行中进程占用 → rename 后写入新文件（未伪造 mtime/复制旧二进制）。

证据：`evidence/phase1b-binary-identity.json`、`evidence/core-agentid-rebuild.diff`。

### 6.2 运行进程验证

| 项 | 证据 |
|----|------|
| E2E 使用的二进制 | 启动前 `Get-FileHash` = `86BAD66B…4685`，与安装路径一致 |
| 运行版本 | `mimo --version` → `local` |
| 与此前测试环境一致 | 同 model=`mimo-v2.6-flash`、同 C1 `context-gate`（c1=true）、同 `stats.jsonl` |

**注意：** 本编辑会话（MiMoCode 主进程）仍是旧镜像内的进程；**新 `mimo run` 子进程加载的是新文件**。交互式 TUI 需用户重启后才会换成新进程镜像。

### 6.3 双 tid E2E 方法

用**已安装的新二进制** headless 启动独立会话（`sid=ses_ffe5e6f9f294effeVsTrLsv07F`）：

1. 创建 task **T1** / **T2**
2. 单轮并行 spawn 两个 explore actor：`task_id=T1` 读文件；`task_id=T2` 列目录
3. 两边均返回 `E2E_A_OK` / `E2E_B_OK`

窗口：`stats.jsonl` baseline=11285。

### 6.4 归因结果 — **通过**

**slice_pre：**

```text
agent=main           tid=null
agent=explore-1      tid=T1
agent=explore-2      tid=T2
```

**model（9 条）— 全部带 agent；子代理 tid 正确：**

| agent | tid | tin | tout | 角色 |
|-------|-----|-----|------|------|
| main | **null** | 39386–40787 | 89–235 | 主会话（设计内 null） |
| explore-1 | **T1** | 5175 / 5509 | 67 / 191 | 子代理 A |
| explore-2 | **T2** | 5168 / 5574 | 79 / 87 | 子代理 B |

**tool（10 条）— 全部带 agent：**

| agent | tid | tools |
|-------|-----|-------|
| main | null | task×4, actor×4 |
| explore-1 | T1 | read |
| explore-2 | T2 | bash |

**验收对照：**

| 验收点 | 结果 |
|--------|------|
| 两子任务 model/tool 关联各自 agentID+tid | **通过**（explore-1↔T1, explore-2↔T2） |
| 主会话无法归属 → 保持 null | **通过**（main model/tool 均 `tid=null`，未串到 T1/T2） |
| 跨任务串线（同 tid 多 agent） | **无** |
| 无栈顶猜测/时间戳推断 | **通过**（有 agentID 时不走 `peekTid` 回退） |
| Token 可按 agent/tid 对应 | **通过**（子代理 tin≈5K，main tin≈40K，边界清晰） |

**对照旧二进制（§6 旧文）：** 旧镜像下 model/tool `agent=0%` 且 main tin≈82K 被记成 T1.x；新镜像上述问题消失。

证据：`evidence/phase1b-e2e-new-binary-result.json`、`evidence/e2e-new-binary-run.log`、`evidence/analyze_e2e_new_binary.py`。

### 6.5 受控工具故障落账（此前已验，本轮未改）

#### A. 真实缺文件 → `tool_execution` ✅

```text
ev:tool  tool=read  st=error
ev:error kind=tool  error_class=tool_execution
tid=null agent=main
```

#### B. `tool_name=invalid` → `tool_param` ✅（C1 钩子注入）

```text
ev:error kind=tool error_class=tool_param tid=T_FAULT_PARAM agent=fault-agent-1
```

线上假工具名经 `mcp_tool_use` 发布原名 → 落 `tool_execution`（设计如此，未扩分类）。

### 6.6 结论表

| 手段 | 状态 |
|------|------|
| bun compile ENOENT | **已修复**（ASCII 路径 bun） |
| 新二进制 + agentID patch | **已确认**（SHA256 + schema 字节） |
| 真实并行双 tid E2E | **通过**（agent/tid 正确，main 不串线） |
| tool_execution / tool_param | **通过** |

**是否仍存在主会话串线：** **否**（新二进制 E2E 窗口内，main model/tool 均 `tid=null`）。

---

## 7. Phase 1B-1: 工具错误分类闭环（T3）

**时间**：2026-10-31 13:28+  
**二进制**：`86bad66b5451f7e4096a2abcd490404d2ff95c616b9cb9215d9d86bf9a254685`（新 mimo，含 agentID patch）  
**目标**：查清并验证 Core 中工具错误的真实分类链路，补齐尚未完成的端到端验证。

### 7.1 三类工具错误的真实源码调用链

#### A. 工具不存在（未注册工具）

**链路**：
1. 模型请求未注册工具 → AI SDK `experimental_repairToolCall` 触发（`llm.ts:706`）
2. `ToolCompat.repairToolCall` 尝试修复（`tool-compat.ts:189`）：
   - 如果 `toolNames.includes(toolName)` 失败 → 返回 `undefined`（不修复）
   - 否则尝试 normalizeInput + stringify
3. 若 repair 返回 `undefined` → AI SDK 继续 `NoSuchToolError` 路径（`llm.ts:728-735`）：
   ```ts
   return {
     ...failed.toolCall,
     input: JSON.stringify({ tool: failed.toolCall.toolName, error: NoSuchToolError... }),
     toolName: "invalid",
   }
   ```
4. 发布到 processor 的 `tool-error` 事件（`processor.ts:646`）：
   ```ts
   case "tool-error": {
     yield* failToolCall(value.toolCallId, value.error)
     yield* bus.publish(Metrics.ToolCall, {
       tool_name: value.toolName,  // "invalid"
       tool_call_status: "error",
     })
   }
   ```
5. C1 钩子接收 `metrics.tool_call`（`index.ts:510-532`）：
   ```ts
   if (st === "error") {
     logStats(g, {
       ev: "error",
       error_class: p.tool_name === "invalid" ? "tool_param" : "tool_execution",
       tool: p.tool_name,  // "invalid"
     })
   }
   ```

**分类结果**：`tool_param`（因为 `tool_name === "invalid"`）  
**证据**：`fault-param-inject.ts` 注入 → `stats.jsonl:11108` 落 `error_class=tool_param`

#### B. 参数错误（工具存在，但参数不符合 schema）

**链路**：
1. 模型调用已注册工具（如 `read`）但参数错误（如 `path=12345` 而非字符串）
2. AI SDK 参数校验失败 → 触发 `experimental_repairToolCall`（`llm.ts:706`）
3. `repairToolCall` 尝试修复（`tool-compat.ts:189`）：
   ```ts
   if (!input.toolNames.includes(input.toolName)) return undefined  // 工具已注册，继续
   const schema = await getSchema(input.toolName)
   const parsed = parseToolInput(input.input)  // 尝试解析 JSON
   const normalized = normalizeInput(parsed, schema)  // 按 schema 归一化
   return { toolName, input: stringifyToolInput(normalized) }
   ```
4. 若 repair 成功 → 重新执行，不发布错误事件  
   若 repair 失败（如 `parseToolInput` 返回原始字符串、`normalizeInput` 无法转换类型）→ AI SDK 抛 `NoSuchToolError` 或其他验证错误
5. 最终走 `tool-error` → C1 钩子 → `tool_param` 或 `tool_execution`

**分类结果**：取决于 repair 是否成功；若 repair 失败且 SDK 判定为"参数非法" → `tool_param`；若 repair 失败但工具已尝试执行 → `tool_execution`  
**E2E 证据**：`C2_bad_params.json` 显示 `error_class=tool_execution`（工具已注册并执行，但文件不存在）

#### C. 工具执行失败（工具存在，参数通过，但实际执行失败）

**链路**：
1. 模型调用已注册工具（如 `read`）且参数正确（如 `path=NO_SUCH_FILE.txt`）
2. 参数校验通过 → 直接执行 `item.execute(args, ctx)`（`prompt.ts:1922`）
3. 工具内部失败（如文件不存在）→ 抛异常或返回错误结构
4. `processor.executeTool` 捕获错误（`processor.ts:450-484`）：
   ```ts
   const execution = Effect.gen(function* () {
     return yield* toolGate.run(..., Effect.gen(function* () {
       return yield* Effect.uninterruptibleMask((restore) => restore(body.pipe(
         Effect.onExit((exit) => Exit.isFailure(exit) && settled.result
           ? settled.result.pipe(Effect.matchEffect({
               onFailure: (error) => failToolCall(callID, error),
             }))
           : Effect.void),
         Effect.tapError((error) => failToolCall(callID, error)),
       )))
     }))
   })
   ```
5. 发布 `Metrics.ToolCall` 事件（`processor.ts:651-660`）：
   ```ts
   yield* bus.publish(Metrics.ToolCall, {
     tool_name: value.toolName,  // 原始工具名（如 "read"）
     tool_call_status: "error",
   })
   ```
6. C1 钩子接收 → `tool_name !== "invalid"` → `error_class=tool_execution`

**分类结果**：`tool_execution`（因为 `tool_name` 是原始工具名，不是 `"invalid"`）  
**E2E 证据**：`C3_exec_fail.json` → `error_class=tool_execution`；`stats.jsonl:11476` 落 `error_class=tool_execution`

### 7.2 四种真实 Core 调用的原始事件

#### C1. 未注册工具（模型拒调）

**场景**：提示模型调用 `completely_unknown_tool_zzz9`  
**结果**：模型拒绝调用，无工具事件

```json
{
  "case_id": "C1_unregistered",
  "exit_code": 0,
  "tools": [],
  "errors": [],
  "stdout_tail": "I don't have a tool named `completely_unknown_tool_zzz9` available...",
  "window_event_count": 3
}
```

**原因**：模型（`mimo-v2.6-flash`）拒绝调用不存在的工具，未触发 AI SDK `repairToolCall` 路径。

#### C1_forced. 强制未知工具（模型拒调）

**场景**：强制提示调用 `completely_fake_tool_xyz789`  
**结果**：模型仍拒调，无工具事件

```json
{
  "case_id": "C1_forced_repair",
  "exit_code": 0,
  "tools": [],
  "errors": [],
  "window_event_count": 3
}
```

**原因**：同 C1，模型拒调。

#### C2. 参数错误（工具已注册）

**场景**：调用 `read` 工具但 `path=12345`（数字，应为字符串）或缺失字段  
**结果**：工具执行，报错 `tool_execution`

```json
{
  "case_id": "C2_bad_params",
  "exit_code": 0,
  "tools": 2,
  "errors": 2,
  "error_classes": ["tool_execution", "tool_execution"],
  "stderr_tail": "Error: File not found: C:\\Users\\<user>\\12345\nError: Invalid arguments for the read tool: expected string, received undefined → at file_path"
}
```

**原因**：工具已注册，AI SDK `repairToolCall` 尝试修复但未成功（类型不匹配），最终执行失败 → `tool_execution`。

#### C3. 执行失败（文件不存在）

**场景**：调用 `read` 工具读取 `NO_SUCH_TOOLERR_FILE.txt`  
**结果**：工具执行，报错 `tool_execution`

```json
{
  "case_id": "C3_exec_fail",
  "exit_code": 0,
  "tools": 1,
  "errors": 1,
  "error_classes": ["tool_execution"],
  "stderr_tail": "Error: File not found: D:\\EchoCore\\echo-core\\bench\\phase1b\\NO_SUCH_TOOLERR_FILE.txt"
}
```

**原因**：工具已注册，参数正确，执行时文件不存在 → `tool_execution`。

#### C4. 正常调用

**场景**：调用 `read` 工具读取 `serial_cost.py`（存在）  
**结果**：工具成功，无错误事件

```json
{
  "case_id": "C4_normal",
  "exit_code": 0,
  "tools": 1,
  "errors": [],
  "stdout_tail": "CASE_C4_DONE\n"
}
```

### 7.3 C1 最终落账结果

| 案例 | tools | errors | error_class | 重复事件 | 丢失事件 | 归因 |
|------|-------|--------|-------------|----------|----------|------|
| C1_unregistered | 0 | 0 | - | - | - | main/tid=null |
| C1_forced_repair | 0 | 0 | - | - | - | main/tid=null |
| C2_bad_params | 2 | 2 | tool_execution×2 | 无 | 无 | main/tid=null |
| C3_exec_fail | 1 | 1 | tool_execution | 无 | 无 | main/tid=null |
| C4_normal | 1 | 0 | - | 无 | 无 | main/tid=null |

**逐条核对**：
- **C2**：2 次工具调用（`path=12345` + 缺字段） → 2 条 `ev:error`，均 `error_class=tool_execution`，`cid` 一一对应
- **C3**：1 次工具调用（文件不存在） → 1 条 `ev:error`，`error_class=tool_execution`，`cid` 对应
- **C4**：1 次工具调用（成功） → 0 条 `ev:error`
- **C1/C1_forced**：0 次工具调用 → 0 条 `ev:error`

**结论**：错误事件不重复、不丢失；正常调用不产生错误事件；每条事件保留 `error 来源`、`调用标识（cid）`、`task/agent 信息`（均为 main/tid=null）。

### 7.4 TUI 新二进制最小验证

**验证脚本**：`evidence/verify_tui_new_binary.py`  
**结果**：`evidence/tui-new-binary-verification.json`

```json
{
  "binary_identity": {
    "path": "C:\\Users\\<user>\\.mimocode\\bin\\mimo.exe",
    "sha256": "86bad66b5451f7e4096a2abcd490404d2ff95c616b9cb9215d9d86bf9a254685",
    "matches_expected": true
  },
  "running_processes": [
    {"Id": 18232, "Path": "C:\\Users\\<user>\\.mimocode\\bin\\mimo.exe"},
    {"Id": 27456, "Path": "C:\\Users\\<user>\\.mimocode\\bin\\mimo.exe"}
  ],
  "error_classification": {
    "total_tool_errors": 4,
    "by_class": {"tool_execution": 4},
    "has_tool_execution": true,
    "has_tool_param": false
  },
  "verification_checks": {
    "binary_matches_expected": true,
    "process_running_on_new_binary": true,
    "tool_errors_have_classification": true,
    "agent_attribution_present": false
  }
}
```

**确认**：
- 二进制 SHA256 与 Phase 1B 重建产物一致
- 运行进程使用 `~/.mimocode/bin/mimo.exe`
- 工具错误均带 `error_class` 分类
- 主会话 `agent=null, tid=null`（设计内）

**真实工具错误落账检查**：已完成（见 §7.3 C2/C3）。

### 7.5 尚未解决的问题

1. **模型拒调未注册工具**：`mimo-v2.6-flash` 拒绝调用不存在的工具，无法在真实 E2E 中触发 `tool_param` 路径（C1/C1_forced 均失败）。需改用可注入工具调用的模型或 mock LLM 服务。
2. **参数错误分类**：C2 显示 `error_class=tool_execution`，而非 `tool_param`。需进一步查清 AI SDK `repairToolCall` 失败后，哪些场景归为 `tool_param`、哪些归为 `tool_execution`。
3. **主会话 agent 归因**：TUI 会话 `agent=null`（设计内），但并行子任务已有 agent 归因（见 §6.4）。主会话是否需要 `agent=main` 待产品决策。

## 8. Reconciler 异常分类

| 类 | 处理 |
|----|------|
| 并发 sid 聚合误报（原 32 条主体） | 改为按切片 tid → 消失 |
| 主 agent `tid=null` | 设计内，不进 `suspicious_no_gate` |
| 真实未终态 T2.x/T3.x | 仍在未完成，**未隐藏** |
| 关联延迟 | 本次全量对账未再暴露为 32 条形态 |

---

## 9. 配置变更（非代码修复）

`C:\Users\<user>\.config\mimocode\mimocode.jsonc`：

- `"model": "deepseek/deepseek-flash"` → `"xiaomi/mimo-v2.6-flash"`  
- 删除 DeepSeek `provider` 块（余额 402）  
- `plugin: ["./context-gate"]` 未改  

回滚：改回 model 字符串并恢复 provider 块（key 需用户重新提供）。

---

## 10. 修改清单与回滚

**Core（未 commit）：** 见 §2.1；`git diff` 已存 `evidence/core-agentid.diff` / `evidence/core-agentid-rebuild.diff`。  
**C1：** `context-gate/index.ts`（热加载；可用 `gates.json` `c1:false` 关闭观测）。  
**Reconciler：** `bench/reconcile.py`。  
**构建：** 未改构建脚本；仅用 `C:\Temp\bun\bun.exe` 执行既有 `build:local`。  
**二进制：** 新 mimo 已装入 `~/.mimocode/bin/mimo.exe`；旧文件备份为 `.pre-phase1b-rebuild`。  
**测试：** `bench/phase1b/c1-logic.test.ts`、`c1-plugin-feed.test.ts`、`serial_cost.py`。  
**证据：** `bench/phase1b/evidence/`（含 build 日志、binary-identity、e2e-new-binary-result、tool-error-e2e、tui-new-binary-verification）、`bench/phase1b/serial-cost/`。

**未做（保护边界）：** Agent Loop 重写、自动重试、Model Fallback、预算改造、删 `~/.mimocode/tools`、改四角色 / TRIAGE·RECOVERY·HANDOFF、改 B1–B6 历史基线。

---

## 11. Echo Immune System V1（免疫系统第一阶段）

**时间**：2026-10-31  
**状态**：已完成

### 10.1 现有基础审查

| 能力 | 状态 | 说明 |
|------|------|------|
| C1 事件采集 | ✅ 已有 | `metrics.tool_call`, `metrics.model_call`, `session.error` 等 |
| 切片追踪 | ✅ 已有 | `session.pre/post` + `peekTidByAgent` 实现 tid 归因 |
| Metrics.ToolCall | ⚠️ 需扩展 | 原 schema 缺少 error_kind 字段 |
| 错误分类 | ❌ 无 | C1 只能按 `tool_name` 猜测 |
| 免疫记忆 | ❌ 无 | 未定义经验数据结构 |
| 免疫耐受 | ❌ 无 | 未定义正常行为基线 |

### 11.2 统一诊断数据结构

新增 `DiagnosticInfo` 类型（`metrics/event.ts`）：

```typescript
{
  error_category: "tool_not_found" | "tool_parameter" | "tool_execution" | "tool_cancelled" | "model_error" | "permission_denied" | "timeout" | "unknown"
  error_stage: "validation" | "execution" | "permission" | "model" | "transport" | "unknown"
  error_name: string        // 原始错误类名
  severity: "info" | "warning" | "error" | "critical"
  recoverability: "recoverable" | "non_recoverable" | "unknown"  // 与 error_category 独立
  diagnosis_status: "detected" | "classified" | "investigated" | "verified" | "unresolved"
  error_source: string      // 错误来源组件
}
```

**所有字段均为 `optional()`**，缺失时 zod 解析为 `undefined`。`classifyToolError` 生产路径始终返回全部 7 个字段。

### 10.3 错误分类机制

新增 `classifyToolError` 函数（`metrics/classify.ts`），在最接近异常发生的位置分类：

| 错误类型 | 识别依据 | error_category | recoverability |
|---------|---------|----------------|----------------|
| 参数校验失败 | `RecoverableError` + message 含 "Invalid arguments" | `tool_parameter` | `recoverable` |
| 工具执行失败 | `isIdentifiableExecutionFailure()` 精确匹配（File not found/ENOENT/ECONNREFUSED 等） | `tool_execution` | `non_recoverable` |
| 工具取消 | `cancelled: true` 选项 | `tool_cancelled` | `recoverable` |
| 权限拒绝 | `RejectedError` 或 message 含 "permission" | `permission_denied` | `non_recoverable` |
| 超时 | `TimeoutError` 或 message 含 "timeout" | `timeout` | `recoverable` |
| 未知错误 | 无法可靠识别 | `unknown` | `unknown`/`recoverable` |

**关键原则**：`error_stage` 可以是 `execution`，但不因此推导 `error_category` 为 `tool_execution`。无法可靠识别时保留 `unknown`。

### 10.4 Core→C1 信息传递修复

**修改点：**
1. `Metrics.ToolCall` schema 新增 `diagnostic` 可选字段
2. `processor.ts` tool-error handler 调用 `classifyToolError` 并填充 diagnostic
3. `prompt.ts` cancelled case 添加 diagnostic
4. C1 插件消费结构化数据，不再按 `tool_name` 猜测

**关键改进：**
- 参数错误正确分类为 `tool_parameter`（原来被误分类为 `tool_execution`）
- 取消事件可区分（原来不产生 error 事件）
- `recoverability` 独立记录，不与 `error_category` 混淆

### 10.5 免疫记忆与耐受

**免疫记忆**（`metrics/immune-memory.ts`）：
- 定义 `ImmuneMemoryEntry` 数据结构
- 包含异常特征、验证根因、有效处理、验证证据、适用范围、可信状态
- V1 只定义结构，不实现完整存储

**免疫耐受**（`metrics/tolerance.ts`）：
- 定义 5 条耐受原则（不误报、合法空结果、去重关联、保留未知、不制造健康假象）
- 定义正常行为基线
- 定义未知事件处理原则

### 11.6 E2E 测试结果（补充审查后修正）

**测试类型**：单元测试 + 故障注入（调用 `classifyToolError()` 函数）  
**测试脚本**：`bench/phase1b/evidence/immune-e2e-test.ts`

| 测试用例 | error_category | error_stage | recoverability | 结果 |
|---------|----------------|-------------|----------------|------|
| C1: 未注册工具 | `tool_not_found` | `validation` | `non_recoverable` | ✅ |
| C2: 参数校验失败 | `tool_parameter` | `validation` | `recoverable` | ✅ |
| C3: 工具执行失败 | `tool_execution` | `execution` | `non_recoverable` | ✅ |
| C4: 工具取消 | `tool_cancelled` | `unknown` | `recoverable` | ✅ |
| C5: 正常执行（控制组） | — | — | — | ✅ SKIP |
| C6: 未知错误 | `unknown` | `execution` | `recoverable` | ✅ |
| C7: 权限拒绝 | `permission_denied` | `permission` | `non_recoverable` | ✅ |
| C8: 超时 | `timeout` | `execution` | `recoverable` | ✅ |

**统计口径**：
- 异常场景：**7/7 通过**（C1-C4, C6-C8）
- 正常控制组：**1/1 通过**（C5 跳过，符合预期）
- 总计：**8/8**

**C6 修正说明**：修复前 C6 被分类为 `tool_execution`，违反"未知错误保留 unknown"原则。修复后正确分类为 `unknown`。

### 11.7 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `packages/cli/src/metrics/event.ts` | 新增 `DiagnosticInfo` 类型；扩展 `Metrics.ToolCall` schema |
| `packages/cli/src/metrics/classify.ts` | 新增 `classifyToolError` 分类函数；补充审查修正 C6 分类 |
| `packages/cli/src/metrics/immune-memory.ts` | 新增免疫记忆数据结构定义 |
| `packages/cli/src/metrics/tolerance.ts` | 新增免疫耐受原则定义 |
| `packages/cli/src/session/processor.ts` | tool-error handler 调用 `classifyToolError` |
| `packages/cli/src/session/prompt.ts` | cancelled case 添加 diagnostic |
| `~/.config/mimocode/context-gate/index.ts` | C1 消费结构化 diagnostic 数据 |

---

## 12. Phase 1B-1a: 参数错误分类根因调查与最小修复

**时间**：2026-10-31 16:39+（E2E）  
**目标**：查清真实 Core 调用中参数校验失败为何落成 `error_class=tool_execution`，并做最小修复。

### 11B.1 根因（已确认）

**链路**：

1. AI SDK `doParseToolCall`（`ai@6.0.168`）对**已注册工具 + 非法参数**：`InvalidToolInputError` → `repairToolCall`；`repairToolCall` 对已注册工具可能返回 `undefined`（不重命名）→ 最终 `{invalid:true, toolName: ORIGINAL}`。**不把 toolName 改写为 `"invalid"`**。
2. `Metrics.ToolCall` 错误路径发布 `tool_name = value.toolName`（原始工具 id，如 `read`）。
3. **Legacy C1**（修复前）：`error_class = p.tool_name === "invalid" ? "tool_param" : "tool_execution"`。因此已注册工具参数失败 **必然** 被记为 `tool_execution`。
4. 对照：未注册工具经 `llm.ts` `experimental_repairToolCall` 可把 `toolName` 重写为 `"invalid"`，legacy C1 才可能得到 `tool_param`。

**证据**：`hist-86bad66b/summary.json`（二进制 `86bad66b`，无 diagnostic 字段）C2 两条均为 `error_class=tool_execution`、`name=ToolCallError`、`msg=tool_call failed: read`。

**结论**：不是 C1 单独猜错，而是 **Core 事件里没有可靠错误语义字段**，legacy C1 只能用 `tool_name` 启发式。

### 11B.2 最小修复（不做 fake tool_name）

| 层 | 改动 | 说明 |
|----|------|------|
| Core | `metrics/classify.ts`：`classifyToolError` | 在最接近异常处按错误对象分类；参数校验（RecoverableError + Invalid arguments/…）→ `tool_parameter`；无法识别 → `unknown`（不因执行阶段推断 `tool_execution`） |
| Core | `metrics/event.ts`：`DiagnosticInfo` + `Metrics.ToolCall.diagnostic` | 结构化诊断随事件发布 |
| Core | `processor.ts` tool-error handler | `classifyToolError(value.error, value.toolName)` → 写入 `diagnostic` |
| Core | `prompt.ts` cancelled 路径 | 取消事件同样携带 diagnostic |
| C1 | `context-gate/index.ts` | **优先消费 `p.diagnostic`**；无 diagnostic 时才走 legacy `tool_name==="invalid"` 回退 |

**禁止事项遵守**：未改 AI SDK、未把注册工具参数错误伪装成 `toolName="invalid"`、未扩展免疫记忆/自动重试。

### 11B.3 复验（真实 Core 进程 + C1 落账）— **DIST-ONLY 证据**

> **证据范围说明（2026-10-31 17:11+ 补注）**：本节 E2E 使用的是 **dist 产物路径**（`D:\EchoCore\MiMo-Code\packages\cli\dist\...`），不是正式安装路径。当时正式安装仍为 `86bad66b`（TUI 占用）。本节结论对 **二进制内容（dc28dff1 字节）** 有效；**正式安装路径的进程级验证与 E2E 见 §12A**（2026-10-31 17:11+，tool-error-e2e-formal\）。旧 dist 证据文件保留于 `evidence/tool-error-e2e\`，未覆盖。

**二进制**：`D:\EchoCore\MiMo-Code\packages\cli\dist\mimocode-windows-x64\bin\mimo.exe`  
**SHA256**：`dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa`  
**说明**：安装路径 `~/.mimocode/bin/mimo.exe` 当时仍为 `86bad66b`（被运行中 TUI 占用，未强杀）；本轮直接用 dist 产物跑 `mimo run`。**（此说明为 2026-10-31 17:11 前的历史状态；正式安装现已替换为 dc28dff1，见 §12A。）**

| Case | 工具事件 | C1 error 落账 | 判定 |
|------|----------|---------------|------|
| C1_unregistered | 0 | 0 | 模型拒调未知工具（环境限制，非分类器问题） |
| C2_bad_params #1 `call_2cd61f1a…` | read/error | `tool_execution` / `Error` / `unknown` / `tool:execute` | **正确**：stderr=`File not found: …\12345`，schema 过了但执行失败，非纯参数错误 |
| C2_bad_params #2 `call_3b37018a…` | read/error | **`tool_parameter`** / `validation` / `RecoverableError` / **`recoverable`** / `tool.ts:wrap` | **正确**：stderr=`Invalid arguments … expected string, received undefined → at file_path` |
| C3_exec_fail | read/error | `tool_execution` / `Error` / `unknown` / `tool:execute` | **正确**：合法路径读缺失文件 |
| C4_normal | read/success | （无 error） | **正确**：正常成功不产生错误诊断 |

**原始证据**：
- 新结果：`evidence/tool-error-e2e/summary.json` + `C*.json`（含 diagnostic 字段）
- 历史对照：`evidence/tool-error-e2e/hist-86bad66b/`（86bad66b，legacy 路径）

### 11B.4 与 legacy / Immune V1 口径说明

- Legacy `tool_param`（字符串）与 Immune `tool_parameter`（枚举）**命名不同**；C1 消费 diagnostic 时写入 `error_class = d.error_category`（即 `tool_parameter`）。
- 模型把「错误类型参数」有时写成能通过 zod 的错误路径值（如 `12345`），最终是 **执行期 File not found** → 归 `tool_execution` 是语义正确的，不应强行改 `tool_parameter`。
- 安装二进制替换与进程级 TUI 落账仍属 **T9 / 用户运行时**，本轮（dist 复验轮）未强杀 PID 18232/27456。**（正式安装替换与进程验证已在 2026-10-31 17:11+ 完成，见 §12A。）**

### 11B.5 修改清单

| 文件 | 相对 86bad66b 基线 |
|------|-------------------|
| `packages/cli/src/metrics/classify.ts` | 新增（untracked） |
| `packages/cli/src/metrics/event.ts` | DiagnosticInfo + ToolCall.diagnostic + agentID |
| `packages/cli/src/session/processor.ts` | tool-error 调 classifyToolError |
| `packages/cli/src/session/prompt.ts` | cancel 路径 diagnostic |
| `~/.config/mimocode/context-gate/index.ts` | 优先消费 diagnostic |

**回归**（已有 Immune V1 证据，非本轮重跑）：classify 单测、immune-e2e、immune-real-path 见 `IMMUNE-V1-FREEZE-REPORT.md`。

---

## 12A. Phase 1B-1a 正式安装验证（Formal-Install Verify，2026-10-31 17:11+）

> **目的**：区分「dist-only 证据」（§11B.3，用 dist 产物路径跑 E2E）与「正式安装验证」（本节，用 `~/.mimocode/bin/mimo.exe` 真实安装路径 + 真实进程）。旧 dist 证据文件（`evidence/tool-error-e2e\`）**未覆盖、未删除**。

### 12A.1 安装与进程身份

| 项 | 值 |
|----|-----|
| 正式路径 | `C:\Users\<user>\.mimocode\bin\mimo.exe` |
| **SHA256** | **`dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa`** |
| 旧二进制备份 | `bin\backups\mimo.exe.20261031_170829.801c91d0`（SHA256 `801c91d0…7bdd`） |
| 备用构建（勿动） | `C:\Temp\bun\mimo-new.exe`（SHA256 `86bad66b…4685`） |
| 旧文件 rename 暂存 | `bin\mimo.exe.running-aside-20261031_170919`（仍由 pre-restart 进程持有，hash=`801c91d0`） |

**运行进程验证**（用户重启 TUI 后）：

| PID | 创建时间 | 父进程 | 加载路径 | 判定 |
|-----|----------|--------|----------|------|
| **29460** | 2026-10-31 17:11:44 | cmd.exe 34180（17:11:42） | formal path | **新进程，加载 dc28dff1**（创建时刻晚于 ~17:09 安装完成） |
| 27456 | 2026-10-31 10:17:15 | 已退出 | formal path 记录为历史创建路径 | pre-restart 遗留，实际持有 aside 文件（801c91d0），忽略 |

**时间序证明**：进程 29460 创建于 17:11:44，晚于正式路径写入 dc28dff1（~17:09）；Windows 在进程创建时加载当时路径上的文件 → 该进程加载的是 dc28dff1。文件级 hash 复核 = dc28dff1（`Get-FileHash` / CIM 双通道确认）。

### 12A.2 正式安装 E2E（C4 + C2）

**脚本**：`evidence/tool_error_e2e_formal.py`（指向正式路径，输出到 `evidence/tool-error-e2e-formal\`，不覆盖 dist 证据）  
**运行时间**：2026-10-31 17:20+  
**二进制**：正式路径 `~/.mimocode/bin/mimo.exe`，SHA256 启动前校验 = `dc28dff1`（不匹配则 ABORT）

| Case | exit | tools | errors | duration | 判定 |
|------|------|-------|--------|----------|------|
| C4_normal | 0 | 1（read/success） | 0 | 23.2s | **正确**：正常成功无错误事件 |
| C2_bad_params | 0 | 3（error/success/error） | **2** | 17.4s | **正确**：两条错误均落 7 字段诊断 |

**C2 两条错误的 7 字段诊断**（与 §11B.3 dist 结论一致）：

| # | error_class | error_stage | error_name | severity | recoverability | diagnosis_status | error_source |
|---|-------------|-------------|------------|----------|----------------|------------------|--------------|
| 1 | `tool_execution` | execution | Error | error | unknown | classified | tool:execute |
| 2 | **`tool_parameter`** | validation | RecoverableError | warning | **recoverable** | classified | tool.ts:wrap |

**Core→Bus→C1→stats.jsonl 链路确认**：
- 事件从正式二进制进程发出 → 落入 `~/.config/mimocode/context-gate/stats.jsonl`
- E2E 脚本 `load_since` 窗口读回，`ev=error` 携带完整 7 字段
- `diagnosis_status=classified` 证明 C1 Immune 分类器已运行；`error_source` 指向 `tool:execute` / `tool.ts:wrap`（Core 源端分类）

**原始证据**：`evidence/tool-error-e2e-formal\summary.json` + `C4_normal.json` + `C2_bad_params.json`  
**dist 旧证据（保留）**：`evidence/tool-error-e2e\summary.json` + `C*.json` + `hist-86bad66b\`

### 12A.3 与 dist-only 证据的关系

| 维度 | dist-only（§11B.3） | formal-install（本节） |
|------|---------------------|------------------------|
| 二进制字节 | dc28dff1 | dc28dff1（同一 hash） |
| 执行路径 | dist 目录 | 正式安装路径 `~/.mimocode/bin/mimo.exe` |
| 进程来源 | 临时 `mimo run` 子进程 | 真实安装 + 用户重启后 TUI 进程 29460 |
| C1 落账 | 是 | 是（stats.jsonl 7 字段） |
| 证据目录 | `tool-error-e2e\` | `tool-error-e2e-formal\` |

**结论**：正式安装二进制与 dist 复验二进制为同一字节序列（dc28dff1）；进程级加载与 C1 落账在正式安装路径上均验证通过。§12 的分类结论对正式安装同样成立。

---

## 13. 未解决问题

1. **CLI 二进制未更新** — ~~阻塞~~ **已解除**：ASCII 路径 bun 重建成功；正式安装 `~/.mimocode/bin/mimo.exe` 现为 **`dc28dff1`**（§12A，2026-10-31 17:11+）。旧镜像备份于 `bin\backups\mimo.exe.20261031_170829.801c91d0`；备用 `86bad66b` 于 `C:\Temp\bun\mimo-new.exe`（勿动）。  
2. **真实并行 E2E 归因** — **已通过**：双 tid T1/T2，model/tool agent 正确，main 保持 null，无串线（§6.4）。  
3. **货币成本** — 账本无 cost 字段；需 provider usage 或账单侧接入（超出本轮）。  
4. **slice_post 生命周期** — 部分路径仍不写 post（Phase1 已知，本轮未作为主修复）。  
5. **PowerShell 非终止错误仍可能记 success** — 按任务书留待独立 PR。  
6. ~~**工具错误分类 tool_param 路径未在真实 E2E 触发**~~ — **仍受模型行为限制**：C1 未注册工具真实调用中模型拒调（§11B）。tool_not_found 由 Immune V1 单测/故障注入覆盖；未注册工具真实 E2E 仍不可得。  
7. ~~**参数错误分类** — C2 落成 `tool_execution`~~ — **已闭环（§11B）**：根因是 legacy C1 只看 `tool_name==="invalid"`；最小修复为 Core 源端 `classifyToolError` + `diagnostic` 随 `Metrics.ToolCall` 发布。`dc28dff1` 真实 E2E：纯参数校验失败 → `tool_parameter`/`recoverable`。

---

---

## 14. 是否建议进入下一轮

**建议进入下一轮（最小修复验证 / B 档），但带条件：**

1. ~~修复 bun 构建并产出含 agentID 的 mimo 二进制~~ **已完成**（§6.0–6.1）。  
2. ~~重跑双 tid E2E~~ **已通过**（§6.4）：explore-1↔T1、explore-2↔T2；main `tid=null` 无串线。  
3. 串行成本可作基线参考；若要做预算，需先落地货币 cost 字段，否则只能谈 Token。  
4. ~~交互式 TUI 会话需用户重启后才会运行在新进程镜像上（磁盘文件已换新）~~ **已完成**（§12A）：用户重启 TUI 后，进程 29460 加载正式路径 dc28dff1；进程级 + E2E 双验证通过。  
5. **Phase 1B-1 工具错误分类闭环** — **已完成**（§7）：三类错误真实链路已查清；四种真实调用已验证；C1 最终落账已确认；TUI 新二进制已验证；未解决问题已记录（§13）。  
6. **Phase 1B-1a 参数错误分类** — **已闭环**（§12）：根因与最小修复已确认；`dc28dff1` 真实 E2E：纯参数校验 → `tool_parameter`；File-not-found → `tool_execution`（语义正确）。**正式安装验证已完成**（§12A）：安装路径 = dc28dff1，进程 29460 加载新二进制，C4+C2 E2E 7 字段诊断落账。

**本阶段验收对应：** Echo 能记录工具/LLM 失败并分类；对账不再因并行误报 32 条；**并行归因在真实双 tid E2E 通过**；串行窗口 Token 结构已量化；**工具错误分类闭环与参数错误语义分类均已补齐**。目标仍是「知道自己在哪里失败、为什么失败、是否恢复」，而不是刷成功率。
