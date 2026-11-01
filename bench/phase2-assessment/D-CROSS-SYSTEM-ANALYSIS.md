# D · 跨系统协作与依赖分析

任务编号：EC-PHASE2-01 / 跨 WP  
日期：2026-10-31  
覆盖：Memory × Nervous × Execution 交互链路

---

## 1. Core Intelligence Interaction Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        用户输入                              │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ NERVOUS                                                      │
│  prompt.ts (7200+行编排枢纽)                                 │
│  ├─ skill/plan 注入（意图理解=提示文本）                      │
│  ├─ runLoop（任务循环）                                      │
│  ├─ classify.ts（assistant 步终局判定）                      │
│  └─ goal judge（停机门，fail-open）                          │
│                                                              │
│  Bus (PubSub) ── best-effort 遥测，非可靠总线                │
│  Task Registry ── 模型驱动创建，树形 parent_task_id          │
│  Permission ── FORCED_ASK 边界                               │
└──────┬───────────────────┬───────────────────┬──────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐
│ MEMORY       │  │ EXECUTION      │  │ IMMUNE (V1 frozen)   │
│              │  │                │  │                      │
│ FTS5 BM25    │  │ toolGate       │  │ classify.ts          │
│ checkpoint   │  │ Settlement     │  │ DiagnosticInfo 7字段 │
│ MEMORY.md    │  │ ToolSettlement │  │ C1 stats.jsonl       │
│ rebuild 注入 │  │ auto-resume    │  │                      │
└──────┬───────┘  └───────┬────────┘  └──────────┬───────────┘
       │                  │                      │
       └──────────────────┴──────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ 结果回传模型          │
              │ 下轮决策              │
              └───────────────────────┘
```

## 2. End-to-End Task Flow（逐步追踪）

| 步骤 | 系统 | 动作 | 接口/证据 |
|------|------|------|-----------|
| 1 | Nervous | 用户输入入 session，skill/plan 注入 | prompt.ts:1550+ |
| 2 | Memory | rebuild 时自动 dump；平时 reminder 提示 | checkpoint.ts:1252+ |
| 3 | Nervous | 模型规划（提示驱动）；task 工具创建任务树 | task.txt + registry |
| 4 | Execution | 工具调用链路执行 | processor→gate→settle |
| 5 | Immune | tool.execute.before/after hooks 采集 | classify.ts + C1 |
| 6 | Execution | 结果截断回传 | truncate.output |
| 7 | Nervous | classify 判定继续/结束；goal judge 停机门 | classify.ts / prompt.ts:4088 |
| 8 | Memory | checkpoint 事件触发 writer 提炼 | llm.ts:95 |

## 3. 接口明确性评估

| 接口 | 明确性 | 问题 |
|------|--------|------|
| Nervous → Execution | **高** | tool-call 事件 → processor → gate → settle，链路清晰有测试 |
| Execution → Nervous | **中** | 结果回传清晰，但 bash 失败伪装成功（L2）导致反馈失真 |
| Nervous → Memory | **中** | checkpoint 触发明确；但"规划前查记忆"无硬约束 |
| Memory → Nervous | **中** | rebuild 全量注入明确；平时靠 reminder+模型自律 |
| Execution → Immune | **高** | hooks 采集明确；V1 已冻结验证 |
| Immune → Execution | **低** | 诊断结果**不反向影响执行策略**（V1 边界，by design） |
| Task 状态 → UI/恢复 | **中** | 状态机完整；但依赖模型主动调 task 工具 |

## 4. 数据正确性

| 检查 | 结果 |
|------|------|
| 任务状态一致性 | task SQL 权威 + Bus 遥测——**设计正确**（DB 权威，Bus best-effort） |
| 执行结果影响决策 | bash 失败被记 success → **模型可能基于错误前提继续**（L2） |
| 历史记忆影响当前 | 被动通道（rebuild/reminder），**无主动"规划时查记忆"硬约束** |
| 模块职责重复 | checkpoint §3/§7 与 MEMORY.md 有冗余（writer 清理缓解） |
| 单点失效 | prompt.ts 7200+ 行是编排单点；Bus 丢事件不阻断主链路（DB 权威兜底） |

## 5. Cross-System Failure Analysis

| 故障场景 | 影响范围 | 当前防护 | 缺口 |
|----------|----------|----------|------|
| bash 高频失败未被感知 | Execution→Nervous 反馈链 | 无（L2） | **最大缺口** |
| Memory 检索 miss | 规划质量下降 | reminder + grep 补救话术 | 语义检索缺失 |
| Bus 事件丢失 | C1 观测不完整 | DB 权威兜底 | C1 假设"发了就到"会漏 |
| Task DB 空 | 恢复/UI/绑定空转 | 无自动补建 | 依赖模型主动调 task |
| checkpoint 丢失 | 长任务断代 | rebuild 现场起 writer | writer 质量依赖模型 |
| Goal judge fail-open | 未完成任务被放行 | MAX=12 上限 | 无二次确认 |
| 本地工具挂起 | gate 队列阻塞 | bash/actor 有超时 | read/edit/write 无 |

## 6. 关键发现

1. **三个系统的协作是"松耦合 + 模型粘合"**——接口清晰但协调逻辑几乎全在 prompt 层，代码层无硬性编排引擎。
2. **反馈链路的最大失真是 bash L2**——最高频工具的失败被伪装成成功，影响 Nervous 的决策质量和 Immune 的观测完整性。
3. **Memory 是被动资源**——能被检索和注入，但没有主动"规划前必须查记忆"的代码路径；使用率完全依赖模型自律。
4. **Immune V1 与 Execution 的集成是单向的**——采集诊断但不反向影响执行（by design，V2 可考虑闭环）。
5. **Task 系统是可选的**——模型不调 task 工具时，整条任务树/恢复/UI 链路空转，但主 runLoop 仍可工作。

## 7. 评估结论

**Echo 的三个核心系统协作链路已验证可工作**——本会话本身就是证据（三路 explore 并行、结果回收、报告撰写全程走通）。但协作质量高度依赖模型能力：代码提供了骨架（Bus/Task/Checkpoint/Gate/Settle），**血肉（理解、规划、重试、记忆使用）全靠 prompt 和模型自律**。

最影响长期发展的短板排序：
1. bash 失败反馈失真（L2）——影响面最广
2. Memory 语义检索缺失——影响规划质量上限
3. 任务编排无代码保障——影响长任务可靠性
