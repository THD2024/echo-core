# Echo Core 遗留问题与风险清单

任务编号：EC-PHASE2-PRE-01 / WP-02 交付物 D
审计日期：2026-10-31
分类原则：严格区分 ① Immune V1 已验收范围 ② 其他基础设施遗留 ③ 新发现架构问题。**不因 V1 冻结将其他遗留默认视为已解决。**

---

## 0. Immune V1 已验收范围（本清单不重复立项）

以下已闭环，仅作边界声明：

| 项 | 状态 | 证据 |
|----|------|------|
| 工具参数错误分类（tool_parameter/recoverable） | ✅ 已验收 | 正式安装 C2 E2E，stats.jsonl 14369 行 |
| 工具执行错误分类（tool_execution） | ✅ 已验收 | C2 #1 + C3 |
| 7 字段诊断持久化 + cid 一一对应 | ✅ 已验收 | stats.jsonl 14362-14372 |
| 并行 agentID/tid 归因 | ✅ 已验收 | 双 tid E2E（Phase1B §6.4） |
| suspicious_no_gate 并行误报 | ✅ 已修复 | reconcile.py per-tid 判定 |
| recoverability 三态 | ✅ 已验收 | immune-e2e R1/R2/R3 |
| 进程级 C1 落账 | ✅ 已验收 | PID 29460 + C4/C2 formal E2E |

---

## 1. 基础设施遗留（V1 范围外，独立跟踪）

### L1. slice_post 生命周期不完整 — 严重程度：中

- **问题**：runLoop 内经 Effect.onExit 保证 post 恰好一次，但进程强杀/未进 runLoop 的形状仍会缺 post；账本抽样 slice_pre(41) > slice(36)。
- **证据**：prompt.ts:3687-3695；PHASE1B-REPAIR-REPORT §13.4；stats 抽样。
- **影响范围**：C1 切片栈泄漏 → 后续 tid 归因退化；对账窗口出现孤儿 pre。
- **潜在后果**：重启后短窗口内 model/tool 事件归因错误率上升。
- **建议方向**：C1 启动时清 sliceStack 并写断代标记；reconcile 对超龄孤儿 pre 单独归桶（不并入 suspicious）。

### L2. PowerShell 非终止错误可能记 success — 严重程度：中

- **问题**：bash 工具以 exit=0 判 success；PS 非终止错误不置 exit code → 失败被记成功。
- **证据**：PHASE1B-REPAIR-REPORT §13.5（明示留待独立 PR）；关联 prompt.ts:1947-1948 结构化失败不发 error ToolCall。
- **影响范围**：所有 PS 命令的观测口径；Immune 分类漏一类真实失败。
- **建议方向**：独立 PR：bash 工具解析 PS error stream 或要求 $ErrorActionPreference=Stop 前置；同时评估 exit≠0 是否应发 error ToolCall（会改变成功率统计——需 A/B）。

### L3. 货币成本字段缺失 — 严重程度：中（决策依赖时升高）

- **问题**：账本只记 Token（tin/tout/cache）；actual_cost_cny=null。核心有本地估算入 DB message.cost（单价表=models.dev USD），非真实账单。
- **证据**：serial-summary.json:80-82；session.ts:431-446；PHASE1B §13.3。
- **影响范围**：任何货币预算/成本报表不可行；Token 预算可行（88% cache 结构已量化）。
- **建议方向**：V2 决策——若需货币口径，账本 ev:model 增加 estimated_cost 字段并明确"估算非账单"语义。

### L4. 三层状态无统一事务 — 严重程度：低-中

- **问题**：DB（权威）+ memory 文件（投影）+ sliceStack（内存）三层独立更新。
- **证据**：session.sql.ts；checkpoint-paths.ts；index.ts:374。
- **影响范围**：极端时序下恢复/对账读到滞后投影。
- **建议方向**：接受最终一致（reconcile 已部分兜底）；不做分布式事务。文档化一致性边界即可。

### L5. C1 禁用时 V1 观测断链 — 严重程度：低（当前 gates c1:true）

- **问题**：Core 发布 diagnostic 但仅 C1 消费落账；c1:false 时分类发布无人落账。
- **证据**：C 单点 SP2；subscriber 不落本地账本。
- **建议方向**：C1 健康探测（启动自检写一条 ev:boot）；或 Core 内置最小落账兜底（V2 权衡）。

### L6. verify.ts / roundtrip_hint 边界如实声明 — 状态：已部署，非缺陷

- verify（gates.verify=true）：bash -File 前置拦截、ps1 BOM 修复、图像产物验证。join 漏报已修（foldJoin）。
- roundtrip_hint（gates.roundtrip_hint=true）：仅 keep_recent 窗口内有 read 历史才注入锚点；**短任务无作用空间（by design）**，不作为缺陷立项。

---

## 2. 新发现架构问题（本次审计）

### N1. SDK types.gen.ts 手改且 diagnostic 未同步 — 严重程度：高

- **问题**：v2/types.gen.ts 为 OpenAPI 生成物，工作区手改 +agentID；**diagnostic 字段未同步进 SDK 类型**（bus zod 有、SDK 无）。下次 regen 手改丢失。
- **证据**：git diff +4 行；event.ts DiagnosticInfo vs types.gen.ts 无对应。
- **影响范围**：远程 API 消费方无法类型安全读取 7 字段；regen 即回归。
- **建议方向**：短期：regen 流程加 patch 步骤或 freeze note 标注；中期：向上游提交 schema 变更 PR 消除手改。

### N2. tool_not_found 分类生产近乎不可达 — 严重程度：中

- **问题**：classifyToolError 支持 toolRegistered=false → tool_not_found，但生产无调用方传入；AI SDK 在上游已拦截未注册工具，到不了 tool-error handler。
- **证据**：classify.ts:44-54 + toolRegistered 零调用方；processor.ts:654 注释。
- **影响范围**：设计文档宣称的 8 类枚举实际生产可达约 6 类；真实 E2E 中 C1 未注册工具模型拒调（历史验证）。
- **建议方向**：冻结记录已如实声明（§7.4 同类）；V2 决策是否值得接线（需 mock LLM 或 SDK 层注入）。

### N3. compaction.tail_turns 死配置 — 严重程度：低

- **问题**：mimocode.jsonc 设 tail_turns:2，但全库仅 schema 声明（deprecated），无代码消费。
- **证据**：config.ts:240-243 唯一匹配。
- **建议方向**：从用户配置删除该键或保留注释说明无效；不改代码。

### N4. ModelCall.diagnostic 字段空置 — 严重程度：低

- **问题**：event.ts ModelCall 定义 diagnostic 可选字段，生产 publish 从不填充。
- **证据**：processor.ts:733-744 / :1286-1290。
- **建议方向**：V2 决策 LLM/API 错误是否需要 7 字段结构化；否则从 schema 摘除避免误导。

### N5. stats.jsonl 轮转仅存 1 代 — 严重程度：低-中

- **问题**：>4MB 轮转为 .1 单代覆盖，更早历史永久丢失。
- **证据**：index.ts:286-296。
- **影响范围**：长期趋势分析、跨周回归比对断档。
- **建议方向**：多代轮转或按日归档（C1 侧小改，需过 V1 冻结规则——属观测基础设施，非 V1 分类逻辑）。

### N6. 远程上报链路不转发 diagnostic/agentID — 严重程度：低（启用分析时升高）

- **问题**：metrics/subscriber.ts 上报体不含 diagnostic/agentID。
- **证据**：subscriber.ts:36-42。
- **建议方向**：若启用 MIMOCODE_ENABLE_ANALYSIS 远程分析，补字段；当前本地账本不受影响。

---

## 3. 遗留问题总表

| ID | 问题 | 类别 | 严重程度 | 状态 |
|----|------|------|---------|------|
| L1 | slice_post 部分路径缺失 | 基础设施 | 中 | 未修 |
| L2 | PS 非终止错误记 success | 基础设施 | 中 | 未修（已知留 PR） |
| L3 | 货币 cost 字段缺失 | 基础设施 | 中 | 未修（Token 预算可用） |
| L4 | 三层状态无事务 | 基础设施 | 低-中 | 接受最终一致 |
| L5 | C1 禁用观测断链 | 基础设施 | 低 | 未修 |
| L6 | verify/roundtrip 边界 | 基础设施 | — | 已部署/如实声明 |
| N1 | SDK diagnostic 类型缺失 | 新发现 | **高** | 未修 |
| N2 | tool_not_found 不可达 | 新发现 | 中 | 如实声明 |
| N3 | tail_turns 死配置 | 新发现 | 低 | 未修 |
| N4 | ModelCall.diagnostic 空置 | 新发现 | 低 | 未修 |
| N5 | 账本轮转 1 代 | 新发现 | 低-中 | 未修 |
| N6 | 远程上报缺诊断字段 | 新发现 | 低 | 未修 |

**明确声明**：以上 12 项均不属于 Immune V1 已验收范围，V1 冻结不自动解决任何一项。
