# EC-PHASE2-P0-01 变更清单与实施方案（审批稿）

任务编号：EC-PHASE2-P0-01
日期：2026-10-31
状态：**待项目负责人批准**（按任务书七·授权边界：冻结 commit/Tag、SDK 生成源头、生产代码修改均需先批准）

---

## 0. 核查结论摘要（全部 PASS，无停止条件）

| 核查项 | 结果 |
|--------|------|
| WP-01 现状核验 | **PASS**：HEAD `496bb8cbe614aecea27623457d143600cc12c275`、5 改 +4 新、二进制 `dc28dff1…`、8 文件哈希与冻结记录逐字符一致 |
| WP-02 SDK 链路调查 | 根因确认 = **从未 regen**（zod 源头已有 agentID+diagnostic；手抄漏 diagnostic） |
| WP-03 七项遗留 | 全部确认存在；定级 L1/L2/L5=P1，L3/L4/N5/N6=P2（详见 A3） |
| WP-04 诊断边界 | immune-memory/tolerance/ModelCall.diagnostic 均为设计内 V2 预留，不接线（A4 已完成） |

---

## 1. 批准项 A — WP-01 Immune V1 冻结提交与 Tag

### 1.1 精确文件集合（7 个，仅 V1 已验收内容）

**纳入冻结 commit**：

```
packages/cli/src/metrics/classify.ts              (新增, 10177B, 38dad26f…)
packages/cli/src/metrics/immune-memory.ts         (新增, 2400B, 11bbcbc7…)
packages/cli/src/metrics/tolerance.ts             (新增, 3315B, a0474968…)
packages/cli/src/metrics/event.ts                 (修改, +65, 4f4cb9f3…)
packages/cli/src/session/processor.ts             (修改, +9,  c232a6a3…)
packages/cli/src/session/prompt.ts                (修改, +7,  af987e17…)
packages/cli/test/session/immune-real-path.test.ts (新增, 10143B, 7c0f4e36…)
```

**明确排除**（归属分离依据）：

| 文件 | 排除理由 |
|------|---------|
| `packages/sdk/src/v2/gen/types.gen.ts` | SDK 生成产物，hand-edit 属 WP-02 修复对象；regen 后单独 commit |
| `bun.lock` | 依赖锁噪声，非 V1 逻辑 |

### 1.2 操作序列

```bash
git add <上述 7 个文件>
git commit -m "feat(immune): Immune System V1 — tool-error 7-field classification (frozen)

Anchored on binary dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa.
Acceptance: C4_normal/C2_bad_params process-level E2E, stats.jsonl 7-field + cid binding.
Freeze contract: bench/phase2-pre/A-IMMUNE-V1-FREEZE-RECORD.md §6.
No new features, no classification extensions, no auto-retry in this tag."
git tag -a immune-v1.0.0 -m "Immune System V1 frozen (EC-PHASE2-P0-01)"
```

### 1.3 冻结后验证

- `git rev-parse immune-v1.0.0^{commit}` == commit SHA
- commit 后重新计算 7 文件 SHA256 == 冻结清单
- `git status` 剩余应仅为：types.gen.ts、bun.lock（未跟踪/修改残留即为预期）

### 1.4 风险与回滚

- 风险：无（add 精确到文件，不做 `git add -A`）
- 回滚：`git tag -d immune-v1.0.0; git reset --soft HEAD~1`（未 push 前安全）

---

## 2. 批准项 B — WP-02 SDK 类型 regen

### 2.1 方案（不手改生成物）

1. 前置回归：`cd packages/cli && bun test test/server/openapi-refs.test.ts`（防悬空 $ref 历史问题）
2. Regen（仓库根）：`bun ./packages/sdk/script/build.ts`（自动 spec→hey-api→prettier→tsc）
3. 验证：`packages/sdk` 下 `bun run typecheck`；diff 确认 `EventMetricsModelCall/ToolCall` 同时含 `agentID?: string` 与 `diagnostic?`
4. 提交（与冻结 commit 分离）：`git add packages/sdk/src/v2/gen/ && git commit -m "fix(sdk): regen v2 types — sync agentID + diagnostic from zod source"`

### 2.2 预期 diff

- types.gen.ts：agentID 保留（zod 源已含），**新增 diagnostic 相关类型**；手写 JSDoc 注释消失（非字段，可接受；如需保留可在 event.ts 加 `.describe()` 后再 regen——默认不做，保持最小变更）
- 其他 gen 文件：hey-api clean:true 全量重写，预期无实质 diff（版本锁定 0.90.10）

### 2.3 风险与回滚

- 若 openapi-refs 测试失败：**停止 regen**，转修 spec（超出本批，重新报批）
- 回滚：`git checkout -- packages/sdk/src/v2/gen/`

---

## 3. 批准项 C — WP-03 基础设施最小修复

按任务书 P0/P1/P2 定级与核查结果，**本批实施 P1 三项 + P2 两项，L3/L4 缓办/接受**：

### 3.1 C1 — L5+L1：C1 启动自检 + sliceStack 断代（C1 配置文件，非 MiMo-Code 仓）

- 文件：`~/.config/mimocode/context-gate/index.ts`（先备份 `.bak-20261031`）
- 改动：server() 入口处——清空 sliceStack；对本次启动前的残留计数记 `ev:"boot"` 事件（含 gates 快照 c1 值、residual count）
- 大小：~20 行
- 验证：重启会话后 stats.jsonl 出现 ev:boot；旧孤儿 pre 不再影响新窗口归因

### 3.2 C2 — N5：stats.jsonl 多代轮转（同文件顺带）

- 改动：logStats 轮转段——`.1→.2→…→.5` 链式移位，保留 5 代
- 大小：~10 行
- 验证：单测性质——临时调低阈值触发轮转，确认多代文件

### 3.3 C3 — L2：bash exit≠0 发 error ToolCall（**生产代码**）

- 文件：`packages/cli/src/session/prompt.ts`（冻结 commit 之后单独提交，不混入 V1 tag）
- 改动点：:1960-1969 publish 处——`item.id==="bash" && metadata.exit!==0 && exit!=null` 时 `tool_call_status:"error"` + `diagnostic: classifyToolError(...)`（枚举已含 error，schema 不变）
- 语义变更声明：bash 失败率统计口径将真实化（历史对比需分段）
- 验证：新增测试——构造 exit=1 的 bash 调用，断言 ev:tool st=error + 7 字段；跑 classify 43/43 + immune-real-path 2/2 回归
- commit：`fix(observability): emit error ToolCall for bash nonzero exit (L2, post-V1)`

### 3.4 C4 — N6：subscriber 补 4 字段透传（生产代码，小改）

- 文件：`packages/cli/src/metrics/subscriber.ts` :21-42
- 改动：model_call/tool_call 上报体各加 `agentID`、`diagnostic` 透传（~4 行）
- 验证：typecheck + 现有 subscriber 相关测试（若有）
- commit：与 C3 可合并或独立 `fix(metrics): forward agentID/diagnostic in analysis subscriber (N6)`

### 3.5 缓办与接受（本批不实施）

| 项 | 处置 | 理由 |
|----|------|------|
| L3 货币 cost | **缓办** | Core 侧加字段=动 V1 契约边界，需单独契约窗口；C1 侧单价回放可后补 |
| L4 三层无事务 | **接受** | 水位 success-gated 推进已堵死坏模式；最终一致符合设计 |

---

## 4. 执行顺序（批准后）

```
批准项 A（freeze commit + tag）
  → 批准项 B（SDK regen + commit）
  → 批准项 C3/C4（生产代码修复，独立 commit）
  → 批准项 C1/C2（C1 配置文件修复 + 备份）
  → WP-05 整体回归：
      - bun test classify / immune-e2e / immune-real-path
      - C4/C2 现场复跑（正式二进制 dc28dff1 未变，预期通过）
      - stats.jsonl/cid/7 字段抽检
  → 交付物 A1/A2/A3/A5 + INDEX 更新
```

## 5. 明确不做的事

- 不 rebase/merge 上游；不 push 远程
- 不重建二进制（dc28dff1 保持；L2 修复只落源码，待下个构建窗口）
- 不接线 immune-memory/tolerance/ModelCall.diagnostic
- 不改 C4/C2 测试预期
- 不删任何原始证据
