# B · Nervous System 能力评估

任务编号：EC-PHASE2-01 / WP-02  
日期：2026-10-31  
审计方式：只读代码审计（explore-7）  
范围：`packages/cli/src/{bus,task,session,tool,permission,actor}`

---

## 1. 信息传递架构（Bus）

**实现**：Effect PubSub 双桶（typed Map + wildcard），`bus/index.ts:45-171`。

| 项 | 现状 | 证据 |
|----|------|------|
| 发布/订阅 | 同步 publish + 异步 callback 执行 | [已接入][有测试] |
| 错误传播 | subscriber 抛错仅 log.error + ignore | [代码存在] |
| 背压 | **无**（Unbounded PubSub） | [代码存在] |
| 语义 | **best-effort 遥测，非可靠总线**（DB 才是权威） | [代码存在]（注释明言） |
| 跨实例 | GlobalBus EventEmitter 广播 | [已接入] |

**关键判断**：Bus 是可靠事件外壳，但"发了就到"是错误假设——C1 若依赖 Bus 保证送达会静默丢事件。

## 2. 任务理解

| 能力 | 现状 | 证据 |
|------|------|------|
| 用户意图分类 | **不存在代码级分类器** | [代码存在] |
| 约束识别 | 多 skill 消息注入编排提醒——**全靠模型执行** | [已接入] |
| 模糊输入处理 | plan Phase 1 要求 Question 澄清；never-ask 下回交模型 | [已接入][有测试] |
| Active intent | checkpoint §1 原文块引用，writer 写入 | [已接入] |

**关键判断**：理解层是"提示注入 + 模型自律"，非 NLU 管道。`session/classify.ts` 是 assistant 步终局判定（final/continue/tool-calls），不是用户意图识别。

## 3. 推理与规划

| 能力 | 现状 | 证据 |
|------|------|------|
| 任务分解 | **模型驱动**——task.txt 提示"3+ 步时用 task"；registry 无自动拆解 | [代码存在] |
| 多步骤规划 | plan 模式 5 阶段（explore→design→review→write→PlanExit），注入文本编排 | [已接入][有测试] |
| 依赖关系 | 仅有 `parent_task_id` 树形；**无 sibling 依赖边、无 DAG 调度** | [代码存在] |
| 执行后重规划 | ① `/goal` judge 重入（MAX=12）② actor preStop ReAct ③ 无自动任务树重排 | [已接入][有测试] |
| 决策依据 | plan 模式写权限封锁 + Question 工具 + PlanExit 门控 | [已接入] |

**关键判断**：**没有硬编码任务图执行器**。规划=模型 + 提示文本。代码只做边界（plan 封锁、forced-ask、goal 上限、terminal 不可复活）。不要把注入的 plan 文本当成编排引擎。

## 4. 上下文协调

| 层 | 机制 | 证据 |
|---|---|---|
| Session | `contextFrom`/`contextWatermark` 继承主会话 | [已接入] |
| Task | `task_id` 绑定 spawn，代码 auto-start；事件日志 TaskEventTable | [已接入][有测试] |
| Agent | `ForkContext`/`inheritedMessages`；权限前向传递 | [已接入] |

子智能体信息共享：peer 独立 session + progress.md 校验 + 完成后 inbox 通知。长任务连续性：checkpoint 11 节 + MEMORY.md + 任务事件流 + 预算裁剪。

## 5. 自主性边界

**必须问用户**：
1. `bash_delete` / `computer`：FORCED_ASK 集合，通配 allow 不能预批
2. Plan→Build 切换：PlanExit 阻塞 Question
3. 规则为 `ask` 的权限走 Deferred 人审

**规划驱动方**：**模型驱动**。代码驱动仅限：plan 写权限封锁、goal 判官重入、spawn auto-start、权限评估。

## 6. 证据分级汇总

| 能力 | 分级 |
|---|---|
| Bus 发布/订阅 | [已接入][有测试] |
| Task 树 CRUD + 事件 | [已接入][有测试] |
| 自动任务分解 | **不存在**（仅 prompt 约束） |
| 任务依赖 DAG | **不存在** |
| 用户意图分类 | [代码存在]（仅 assistant 步） |
| Plan 5 阶段 + PlanExit | [已接入][有测试] |
| Goal judge 重规划 | [已接入][有测试]（fail-open） |
| Checkpoint 三层连续性 | [已接入][有测试] |
| Forced-ask 边界 | [已接入][有测试] |

## 7. 脆弱点 Top3

1. **Bus 遥测语义易误判为可靠总线**——publish 全 ignore、无背压、无确认；C1 假设"发了就到"会丢事件
2. **任务真相完全依赖模型调用 task 工具**——无代码侧自动登记；DB 空时 Task tree、UI、spawn 绑定全部空转（本会话实证 DB 空）
3. **Goal 判官 fail-open + 分类空洞**——judge 异常直接允许 stop；`classify.ts` 自承 T01-T05 未接，长循环异常恢复不完整

## 8. 评估结论

**Echo 当前具备**：可靠事件外壳（Bus/Task/Checkpoint/Permission 骨架扎实且有测试）、plan 模式、goal judge、三层上下文连续性、forced-ask 安全边界。

**Echo 当前不具备**：代码级任务理解、自动任务分解、依赖 DAG 编排、失败自动重规划。**理解、分解、依赖编排、失败重规划几乎全押在 prompt 与模型自律上**。这是"模型自主内核 + 代码边界守护"架构——强大但不可预测，且高度依赖模型能力上限。
