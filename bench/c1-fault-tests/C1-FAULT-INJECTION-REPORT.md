# C1 故障注入验收报告（Phase 1 · 2026-10-31）

会话：`ses_ffe5e70294ba1ffezuPmgky7Ua`  
C1 开关：`gates.json` → `c1:true`（已启用）  
隔离工作区：`D:\EchoCore\echo-core\bench\c1-fault-tests\`  
原始证据：`snapshots\raw-evidence.jsonl`（81 条 C1 事件）  
快照：`snapshots\stats-before.jsonl` / `reconcile-after-tests.txt` / `reconcile-final.txt`

---

## A. 五项测试执行结果

| 测试 | 目标 | 结果 | 关键证据 |
|---|---|---|---|
| **T1 工具不存在** | 未知工具调用可观测 | **通过** | `ev:tool` st=error, tool=`this_tool_definitely_does_not_exist_c1t1`, cid=`call_b72b8dd309f7464398ae3c4d`，无重复调用 |
| **T2 工具参数错误** | 真实工具非法参数可观测 | **通过（有缺口）** | `edit` 缺 old_string → st=error, cid=`call_8183c89f87f8431f86bf69fb`；**缺口：PowerShell 运行时 PathNotFound 被记为 success** |
| **T3 可恢复失败** | 失败→恢复链可观察 | **通过** | read missing → error；write → success；read → success。无自动重试（系统无此机制，未擅自添加） |
| **T4 不可恢复失败** | 最终态不误判 success | **通过** | T5: open→in_progress→blocked→**abandoned**；DB=`abandoned`；对账桶=**失败** |
| **T5 正常结束对照** | 成功路径无 error/retry | **通过** | bash success + task T6 done；窗口内无 ev:error/ev:retry |

---

## B. 原始事件摘录

### T1 未知工具
```json
{"t":1793415359361,"ev":"tool","sid":"ses_ffe5e70294ba1ffezuPmgky7Ua","tid":null,"tool":"this_tool_definitely_does_not_exist_c1t1","st":"error","cid":"call_b72b8dd309f7464398ae3c4d","in":77,"out":0}
```

### T2 参数错误（edit 无匹配）
```json
{"t":1793415464242,"ev":"tool","sid":"ses_ffe5e70294ba1ffezuPmgky7Ua","tid":null,"tool":"edit","st":"error","cid":"call_8183c89f87f8431f86bf69fb","in":163,"out":0}
```

### T3 恢复链（同 sid，时序）
```json
{"t":1793415476620,"ev":"tool","tool":"read","st":"error","cid":"call_2d6b8c85b701430a84c7c847"}
{"t":1793415485784,"ev":"tool","tool":"write","st":"success","cid":"call_29f5fe155de24d9eb4d3b95d"}
{"t":1793415488468,"ev":"tool","tool":"read","st":"success","cid":"call_1c27fe5b26604d6da2b097b0"}
```

### T4 不可恢复任务链
```json
{"t":1793415497190,"ev":"task","tid":"T5","st":"blocked","kind":"blocked"}
{"t":1793415502354,"ev":"task","tid":"T5","st":"abandoned","kind":"abandoned"}
```

### T5 正常结束
```json
{"t":1793415502647,"ev":"tool","tool":"bash","st":"success","cid":"call_be0cc3f839974e9e83e73b83"}
{"t":1793415520893,"ev":"task","tid":"T6","st":"done","kind":"done"}
```

### 子代理 tid 关联（general-1 / T2）
```json
{"t":1793415560640,"ev":"tool","tid":"T2","tool":"write","st":"error","cid":"call_10f86263a0b747a781b9a09e"}
{"t":1793415609246,"ev":"tool","tid":"T2","tool":"edit","st":"error","cid":"call_584585cbfc894e6e88e880a2"}
{"t":1793415631616,"ev":"slice","tid":"T2","agent":"general-1","outcome":"completed"}
```

---

## C. task id 关联验证

| 场景 | tid | 结论 |
|---|---|---|
| 主 agent 工具/错误 | **null** | 符合设计（`session.error` 无原生 task_id；主切片 tid=null 已在 c1-design §8 声明） |
| 子代理（spawn 带 task_id） | **T2 正确** | slice_pre / tool error / slice post 全链路 tid=T2 |
| task.created / updated | **T2–T6 正确** | 生命周期链完整 |

**结论**：有 task 上下文的子代理可正确关联；主 agent 靠时窗回查（已知缺口，非缺陷）。

---

## D. 错误分类与恢复链

| 类别 | 事件 | 可区分？ |
|---|---|---|
| 工具不存在 | `ev:tool` st=error + 工具名 | 是（按 tool 字段） |
| 工具参数错误 | `ev:tool` st=error + 不同 tool 名/cid | 是 |
| 运行时命令失败 | **可能 st=success**（见缺口） | **弱** |
| session 级错误 | `ev:error`（历史仅 1 条 MessageAbortedError） | 需 session.error 路径 |
| 重试 | `ev:retry` | 本窗口 **0 条**（无 LLM/网络重试触发） |
| 恢复 | 失败 cid → 后续 success cid 时序链 | 是 |

**恢复 vs 最终失败**：T3 以 success 收口；T4 以 abandoned 收口——对账器正确分桶。

---

## E. slice post 根因分析

**结论：slice post 机制正常，不是缺陷。**

| 检查项 | 结果 |
|---|---|
| 触发条件 | `Effect.onExit` 在 `prompt.ts:3680` 保证恰好一次 |
| session 生命周期 | 每个 agent turn 结束触发；当前主会话 turn 未结束故无 post |
| 事件顺序 | 子代理 T2：`slice_pre` → tools → `slice`（completed）✓ |
| 提前退出 | 历史有 `outcome:error`（InterruptError）的 slice post ✓ |
| 异步写入 | 同步 `logStats` 追加，无丢失 |

**为什么最初认为“未观察到”**：
1. 当前主会话仍在 turn 中，post 尚未 fire——**预期行为**。
2. 全账本已有 **12 条 slice post**（含 error 结局），并非零。
3. 配对分析：`slice_pre=16` / `slice=12`，差额 = 进行中 turn + 个别 checkpoint-writer 未闭合 turn。

---

## F. 三源对账

```
C1 事件数: 230 | 账本错误: 1 | DB 任务: 681 | 对账 TID: 59
正常结束: 47 | 失败: 1 (T5=abandoned) | 未完成: 7 | 恢复中: 4 | 无法归类: 0 | suspicious_no_gate: 0
```

测试任务 DB 终态（本 session）：
- T2 done / T3 done / T4 done / **T5 abandoned** / T6 done / T1 in_progress（验收主任务）

**未将失败误判为成功** ✓

---

## G. C1 是否具备进入 B1–B6 条件

### 通过项
- ✅ 工具失败发现（T1/T2）
- ✅ 子代理 task 关联
- ✅ 恢复链可观察（T3）
- ✅ 不可恢复不误判 success（T4）
- ✅ 正常路径干净（T5）
- ✅ slice post 正常触发
- ✅ 观测安全（纯外层插件，零核心改动，fail-open）
- ✅ 三源对账可运行且分桶正确

### 已知缺口（如实标注，不阻塞基线）
| # | 缺口 | 影响 | 是否阻塞 B1–B6 |
|---|---|---|---|
| 1 | 主 agent tid 恒 null | 步骤级归因靠时窗 | 否（设计已声明） |
| 2 | 工具失败不产 `ev:error` | 仅 `ev:tool` st=error | 否（按设计） |
| 3 | PowerShell 运行时错误可记 success | 工具失败率偏低估 | 否（B1–B6 可量化） |
| 4 | 无受控 LLM 重试触发样本 | `ev:retry` 零样本 | 否（B 档/mock 可补） |

### 裁定

**C1 具备进入 B1–B6 基线测试的条件。**

缺口 3 是唯一需要在 B 阶段关注的观测精度问题；不修改 C1 判定逻辑，不在本阶段扩大修复范围。

---

## H. 最小修复方案（可选，不阻塞基线）

**问题**：bash 工具在 PowerShell 非终止错误（PathNotFound 等）时仍发布 `tool_call_status: "success"`。

**根因**：`prompt.ts` 成功路径在 `normalizeResult` 后无条件 publish success；未检查 `normalized.isError` 或 exit code。

**最小修复（B 档 / 单独 PR，本阶段不做）**：
```ts
// prompt.ts ~2161
tool_call_status: normalized.isError ? "error" : "success"
```
影响范围：仅 metrics 计数，不改执行决策。回滚：revert 单行。

**本阶段不执行**——符合任务书「不得为了通过测试修改 C1 判定逻辑」。

---

## 下一步授权

按任务书 §8：全部关键项目通过 → **申请启动 B1–B6 基线测试**。
