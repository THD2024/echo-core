# G · 当前能力基线与测试结果

任务编号：EC-PHASE2-01 / WP-04  
日期：2026-10-31  
基线编号：BL-20261031-v1  
性质：代码审计基线（非运行时基准——运行时基准待首轮执行后补充）

---

## 1. 基线锚点

| 项 | 值 |
|----|-----|
| code_commit | `a7f95e44c5257d0af46e08d5e50bbbbc3b8e7b25`（N6 之后 HEAD） |
| tag | `immune-v1.0.0`（Immune V1 冻结点 = `0939522`） |
| binary_sha256 | `dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa` |
| model | 待首轮运行时记录 |
| tool_permissions | 生产默认全集 |
| environment | Windows 11, C1 context-gate 启用 |
| c1_gates | c1=true, enabled=true |
| run_timestamp | 2026-10-31（审计日） |

---

## 2. 能力维度基线（代码审计推断）

基于三路深读审计的证据分级，给出当前各维度的**代码层能力上限**（非运行时分数——运行时分数需执行 F 测试集后填入）。

| 维度 | 代码层能力 | 证据等级 | 主要制约 |
|------|-----------|----------|----------|
| D1 任务理解 | **中** | [已接入] 提示注入+模型自律 | 无意图分类器；约束识别靠 prompt |
| D2 长期记忆 | **中** | [已接入][有测试] FTS5+checkpoint | 无语义检索；冲突机制空转 |
| D3 推理规划 | **中** | [已接入][有测试] plan/goal/task | 无 DAG；模型驱动非代码驱动 |
| D4 执行可靠性 | **中-高** | [已接入][有测试] gate/settle/orphan | bash L2 反馈失真；无统一超时 |
| D5 失败恢复 | **中** | [已接入][有测试] cascade/auto-resume | goal fail-open；write orDie |
| D6 经验复用 | **中-低** | [已接入] reminder+MEMORY | 被动通道；无主动规划桥 |
| D7 长期稳定性 | **中-高** | [已接入][有测试] checkpoint×40 | checkpoint 质量依赖模型；task DB 可空 |

---

## 3. Immune V1 遗留状态更新

| 项 | 状态 | 说明 |
|----|------|------|
| ev:boot 落账 | **待确认** | C1 改动已部署（语法验证过），但本次审计期间 TUI 未重启，stats.jsonl 无 ev:boot 行。下次重启后验证。 |
| L2 bash exit≠0 | **保持暂缓** | 经批准跳过；本次审计再次确认缺口存在且影响面广（C 报告 §9-1）。不纳入本次开发。 |
| CLI 存量 typecheck 错误 | **登记为 V2 清理** | immune-memory.ts / immune-real-path.test.ts 严格模式错误，冻结文件，不阻塞运行。 |

---

## 4. 已有运行时证据（复用历史）

以下测试已在冻结版本上通过，可作为 D4/D5 的运行时基线参考：

| 测试 | 结果 | 证据位置 |
|------|------|----------|
| classify 单元 | 34/34 | `packages/cli/test/session/classify.test.ts` |
| classify 集成 | 复跑 0 fail | `classify-integration.test.ts` |
| immune 真实路径 | 2/2 | `immune-real-path.test.ts` |
| C4_normal E2E | 通过 | `bench/phase1b/evidence/tool-error-e2e-formal/` |
| C2_bad_params E2E | 通过 | 同上 |
| SDK typecheck | EXIT=0 | `packages/sdk` |
| 回归 12/12 | PASS | `bench/phase2-pre/A5` |

---

## 5. 运行时基准（待执行）

F 测试集 37 案例的运行时基准**尚未执行**——本任务为只读审计+方案设计，运行时基准需在授权后按 E 框架流程执行。

首轮执行后此处填入：

| 维度 | 分数 | 样本数 | 备注 |
|------|------|--------|------|
| D1 | — | — | |
| D2 | — | — | |
| D3 | — | — | |
| D4 | — | — | |
| D5 | — | — | |
| D6 | — | — | |
| D7 | — | — | |

---

## 6. 基线解读

当前 Echo 的**代码层能力骨架完整**——Bus/Task/Checkpoint/Gate/Settle/Memory/Plan/Goal 各层均有实现且多数有测试。但**运行时表现高度依赖模型能力**：代码提供的是边界和通道，理解、规划、重试、记忆使用的质量几乎完全由模型决定。

这意味着：
1. 换更强的模型 → 能力提升立竿见影（但也更不可控）
2. 代码层加固（L2、语义检索、DAG）→ 提升可靠性和上限，但不会让弱模型变强
3. 评价体系必须**固定模型**才能衡量代码升级的真实效果
