# Phase 1 B1–B6 基线测试报告

- 阶段：Phase 1 — Foundation & Observability
- 日期：2026-10-31
- 执行会话：`ses_ffe5e70294ba1ffezuPmgky7Ua`
- 目录：`D:\EchoCore\echo-core\bench\phase1-baseline\`
- 原则：只测量、不优化、不清理、不改变系统行为

---

## 1. 执行摘要

| 指标 | 值 |
|---|---|
| 有效独立运行数 | **21**（要求 ≥18） |
| 无效 harness 样本 | 2（B5 路径命名错误，保留不删） |
| 自报成功 | 21/21 |
| **独立验收通过** | **21/21（100%）** |
| 自报 vs 验收不一致 | 0 |
| 专用 `ev:error` 事件 | **0** |
| 专用 `ev:retry` 事件 | **0** |
| 工具层 `st=error` | 21 |
| 模型 | `mimo-v2.6-flash` |
| 输入 Token（窗口合计） | ≈ **10.26M**（含 cache 9.33M） |
| 输出 Token | ≈ **81k** |

**结论一句话：** 在本会话受控任务定义下，Echo 对 B1–B6 六类任务的**任务成功率与独立验收率均为 100%**；但 C1 观测层**没有专用 error/retry 事件流**，Token 成本与并行编排强相关，per-run Token 无法在并行波次下可靠归因。当前系统主要瓶颈不是“会不会做任务”，而是**观测粒度 + Token/上下文成本**。

---

## 2. 测试环境（冻结）

完整快照见 `ENVIRONMENT-SNAPSHOT.md`。

| 项 | 值 |
|---|---|
| MiMoCode CLI | `0.1.16` |
| MiMoCode PE ProductVersion | `1.3.14`（两套口径并存） |
| C1 | 已启用，`stats.jsonl` 持续写入 |
| 模型 | `mimo-v2.6-flash` |
| Echo / 测试执行方式 | 主代理编排 + `general` 子代理（task_id 绑定） |
| 工作区 | `bench/phase1-baseline/workspaces/*`（每次 run 独立副本） |
| 原始 fixtures 快照 | `evidence/original-fixtures/`（含 SHA256 manifest） |

约束遵守情况：

- 未修改 C1 判定逻辑
- 未改正式项目文件（仅碰 phase1-baseline workspaces）
- 未加自动重试 / Model Fallback
- 未删 tools TS / 四角色 / TRIAGE 等
- 未为提高成绩改任务定义（B5 首跑路径错误作废样本保留）

---

## 3. B1–B6 测试矩阵与结果

任务定义机器可读版：`task_defs.py`。验收脚本（不信任 Agent 自报）：`verify.py`。原始运行：`raw-runs.jsonl`。

### B1 简单任务 — `config.js` RETRY_LIMIT 3→5 + node 校验

| Run | 结果 | 验收 | 耗时(s) | 说明 |
|---|---|---|---|---|
| B1-R1 | success | ✅ | 105.6 | |
| B1-R2 | success | ✅ | 92.0 | |
| B1-R3 | success | ✅ | null* | 时间戳未采集完整 |

### B2 多步骤任务 — 5×JSONL 计数 → report.md

| Run | 结果 | 验收 | 耗时(s) |
|---|---|---|---|
| B2-R1 | success | ✅ | null* |
| B2-R2 | success | ✅ | null* |
| B2-R3 | success | ✅ | null* |

验收要点：log1=3, log2=4, log3=2, log4=5, log5=3，总 17，与磁盘真实内容一致。  
**小结：** 3/3 通过。验收器初版把 JSONL 当单 JSON 会炸——属 harness 缺陷，已修，**不是任务失败**。

### B3 多文件任务 — math 模块加 multiply（4 文件）

| Run | 结果 | 验收 | 耗时(s) |
|---|---|---|---|
| B3-R1 | success | ✅ | 105.1 |
| B3-R2 | success | ✅ | 114.1 |
| B3-R3 | success | ✅ | 117.9 |

验收：4 文件均含 multiply；`node utils/math.test.js` → All tests passed；`node index.js` 含 `6 * 7 = 42`。

### B4 工具密集任务 — 30 文件扫 TODO → todos.md

| Run | 结果 | 验收 | 耗时(s) |
|---|---|---|---|
| B4-R1 | success | ✅（复核后） | 133.1 |
| B4-R2 | success | ✅ | null* |
| B4-R3 | success | ✅ | null* |

真实 TODO 真值：

| 文件 | 行 | 内容 |
|---|---|---|
| module03.js | 1 | Add input validation for edge cases |
| module07.js | 1 | Refactor to use async/await |
| module12.js | 1 | Add TypeScript types |
| module19.js | 1 | Optimize the inner loop |
| module25.js | 1 | Add unit tests for error paths |

**小结：** 3/3 内容正确。R1 引言写了 “module01.js–module30.js”，验收正则曾误判——**harness 误报，已改为只统计 Markdown 标题**。

### B5 失败恢复任务

| Run | 自报 | 验收 | 耗时(s) | 行为 |
|---|---|---|---|---|
| B5A-R1 | success | ✅ | 90.2 | `node nonexistent-script.js` → MODULE_NOT_FOUND **1 次**；未伪造脚本；读 config.js 报告 RETRY_LIMIT=3 |
| B5B-R1 | failed（任务语义） | ✅ | 106.5 | 正确识别 missing-file.js 不存在；**未创建伪造文件** |
| B5C-R1 | success | ✅ | 105.4 | 识别无 super-search；改用 grep/read；得到 RETRY_LIMIT=3 |
| B5B-badpath | failed | ❌ | 85.3 | **无效样本**：harness 路径写错 |
| B5C-badpath | partial | ❌ | 92.8 | **无效样本**：harness 路径写错 |

**小结：** 有效 3/3 通过。无效 2 条保留原始证据，**不计入成功率**。B5B/B5C 语义上是“预期失败被正确观测”，所以业务结果记为观测链成功。

### B6 经验复用任务 — R1 multiply → R2 divide（同 workspace 两轮）

| Pair | R1 | 验收 | R2 | 验收 | R2 耗时(s) |
|---|---|---|---|---|---|
| b6-run1 | success | ✅ | success | ✅ | 74.8 |
| b6-run2 | success | ✅ | success | ✅ | 190.7 |
| b6-run3 | success | ✅ | success | ✅ | 188.4 |

R2 自报均明确：**复用 multiply 模式**（单行函数 + exports + console.assert + index 打印 + README 表格行）。  
R2c 额外加了 `divide(7,0)===Infinity` 边界断言——属合理模式迁移。

**小结：** 3 对全部通过。但本设计下“经验”主要来自**工作区残留实现**，不是跨 task 记忆库；**不能外推为“记忆系统已具备经验复用”**。

---

## 4. C1 观测验收（本轮）

窗口：≈ 2026-10-31 基线波次全程。原始事件：`evidence/c1-window.jsonl`（627 行）。

| 能力 | 结果 | 证据 |
|---|---|---|
| 工具事件按 tid 关联 | **部分通过** | tool tid：T13=75, T12=64, T9=30, T11=22, T8=7, T10=3, null=62（主代理） |
| 工具失败可见 | **通过（工具层）** | `ev:tool st=error` ×21 |
| 专用 error 事件 | **失败 / 缺口** | `ev:error` = 0 |
| retry 事件 | **通过（空结果符合设计）** | `ev:retry` = 0；无自动重试，不误报 |
| slice_pre / slice post | **通过** | slice_pre=35，slice(post 语义)=35，成对 |
| 三源对账 | **可运行，无无法归类** | 见下 |
| 模型 per-run Token | **无法可靠归因** | model 事件 tid=null，并行波次共享流 |

### 三源对账（reconcile.py）

| 桶 | 数量 | 说明 |
|---|---|---|
| 正常结束 | 41 | 历史+本会话 done |
| 失败 | 1 | T5 abandoned（C1 验收期） |
| 未完成 | 7 | 历史 open |
| 恢复中 | 10 | 含 T8–T13（报告时仍未 done） |
| **无法归类** | **0** | |
| ledger errors | 0 | |
| suspicious_no_gate | 32 | 并行多 tid 编排噪声 |

证据：`evidence/reconcile.json`。

---

## 5. 效率与成本（诚实口径）

| 类别 | 有效 runs | 成功率 | 验收率 | 耗时 mean（已知样本） |
|---|---|---|---|---|
| B1 | 3 | 100% | 100% | 98.8s（n=2） |
| B2 | 3 | 100% | 100% | n/a（时间戳缺失） |
| B3 | 3 | 100% | 100% | 112.3s |
| B4 | 3 | 100% | 100% | 133.1s（n=1） |
| B5 | 3 | 100% | 100% | 100.7s |
| B6 R1 | 3 | 100% | 100% | 77.0s |
| B6 R2 | 3 | 100% | 100% | 151.3s |

Token（**窗口合计，不可按 run 拆分**）：

- input ≈ 10,256,672
- 其中 cache ≈ 9,326,528
- output ≈ 81,285
- 模型：`mimo-v2.6-flash`

**成本结论：**  
本轮以 3–6 个子代理并行推进，换吞吐；代价是 **input Token 被多路上下文重复计入**。若要给出“单任务真实 Token 成本”，下一轮必须**串行单 run** 或改造 model 事件带 tid/actor 归因。  
按 flash 档粗算，未突破任务书 ¥8 上限量级，但**无法给出可审计的 per-run 成本**，故成本项标为 **不可拆分**，不用估算冒充测量。

无效/重复调用：

- C1 的 `in`/`out` 是**字节数**，不能当内容哈希。
- `duplicate_calls_approx` **不可用**（已从正式指标剔除）。
- 人工观察：子代理对同一小文件多次 read 有时是必要的（如 B2 逐个读 log）。

---

## 6. 当前系统主要瓶颈（有数据支持）

1. **观测层专用失败事件缺失（高置信）**  
   工具失败只在 `ev:tool.st=error`；全程 `ev:error=0`, `ev:retry=0`。无法做错误类型分布 / 恢复链自动分析。

2. **并行编排下 Token 无法归因（高置信）**  
   model 事件无 tid；21 次有效 run 共享一条模型流。基线成本只能报窗口总量。

3. **上下文/缓存主导输入成本（中高置信）**  
   cache 占 input ~91%。说明大量是重复前缀；cache miss 或切模型时成本会陡增。

4. **Reconciler 对并行 bench 的 suspicious_no_gate 噪声（中置信）**  
   32 条全绑同一 session 的 T8–T13，更像对账器假设“单任务单窗口”，不一定是执行缺陷。

5. **B6 未测到真记忆复用（中置信，能力边界）**  
   依赖磁盘已有 multiply 代码，不是跨 session 经验库。任务书禁止临时加记忆功能——如实记为测试设计边界。

---

## 7. 已知缺陷与数据缺口

| # | 类型 | 描述 | 影响 |
|---|---|---|---|
| 1 | 系统（已知） | PowerShell 非终止错误可能被记 success | 本轮 B 任务未依赖；仍留 B 档 PR |
| 2 | C1 缺口 | 无专用 error/retry 事件 | 失败分析能力不足 |
| 3 | C1 缺口 | model 事件无 tid | per-run 成本不可测 |
| 4 | harness | B5B/B5C 首跑路径错误 | 2 条无效样本，已排除 |
| 5 | harness | JSONL 验收解析初版失败 | 已修，无业务影响 |
| 6 | harness | B4 正则误报 range 描述 | 已修，内容原本正确 |
| 7 | 采集 | B1-R3/B2/B4-R2R3 缺 duration | 标 null，不估算 |
| 8 | 指标 | 字节级 in/out 不能判重复调用 | 不采用该指标 |

---

## 8. 交付物清单

| 文件 | 内容 |
|---|---|
| `BASELINE-REPORT.md` | 本报告 |
| `raw-runs.jsonl` | 全部运行记录（含 2 条无效样本） |
| `baseline-summary.json` | 结构化汇总，供后续自动对比 |
| `ENVIRONMENT-SNAPSHOT.md` | 环境冻结 |
| `evidence/c1-window.jsonl` | C1 原始事件窗口 |
| `evidence/reconcile.json` | 三源对账快照 |
| `evidence/original-fixtures/` | fixtures SHA256 |
| `evidence/metrics/full-campaign.json` | 活动期聚合 |
| `verify.py` / `collect_metrics.py` / `setup_workspaces.py` / `task_defs.py` | 可复现 harness |

---

## 9. 是否具备进入下一轮的条件

**任务完成定义已满足：**

1. B1–B6 均 ≥3 次有效独立 run（21≥18）
2. 全部有 run_id / task 体系
3. 原始证据保留
4. 每次均有 success/partial/failed 结论
5. 验收与自报分离（verify.py 独立跑 node/磁盘）
6. 时间有部分测量；Token 有窗口总量并标明不可拆分
7. C1 工具事件可按 tid 部分对应
8. 对账无“无法归类”
9. 无未经批准的系统修改
10. 报告写明主要瓶颈

**但不建议在未评审前自动进入 B 档修复。** 建议评审聚焦：

1. 下一阶段是否优先打 **专用 error/retry 事件** 与 **model tid 归因**（观测），而不是继续堆任务类型？
2. 是否接受“并行波次只报窗口成本、串行波次再测 per-run 成本”的两段式基线？
3. B6 是否需要改成“依赖记忆库而非磁盘残留”才能算真经验复用？

---

## 10. 最小修复方案（若进入 B 档，仅提案、本轮未实施）

| 优先级 | 方案 | 影响范围 | 不做的事 |
|---|---|---|---|
| P0 | 工具失败时同步发 `ev:error`（含 tool/error_class/tid/cid） | C1 plugin 一处 | 不改执行决策 |
| P0 | model 事件增加 `tid` 或 `actor_id` | C1 model 钩子 | 不改采样逻辑 |
| P1 | reconcile 对“多 tid 同 session 并行”降低 suspicious_no_gate 噪声 | 仅 bench 对账器 | 不改 C1 写入 |
| P1 | 基线 harness 串行单 run 模式脚本 | bench 侧 | 不改系统 |

---

**本轮最终目标达成情况：**  
已建立 Echo 当前架构下 **B1–B6 第一份可信能力基线**——任务层全绿，观测与成本层暴露真实缺口。成绩没有靠改系统刷出来；缺口也没有藏。
