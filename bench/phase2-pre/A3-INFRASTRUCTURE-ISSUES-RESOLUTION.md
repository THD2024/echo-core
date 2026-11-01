# A3 · Infrastructure Issues Resolution

任务编号：EC-PHASE2-P0-01 / WP-03  
日期：2026-10-31  
依据：`D-LEGACY-ISSUES-RISKS.md` 原始编号与证据  
批准：项目负责人（批准项 C — C1/C2/C4 实施，C3/L2 跳过，L3/L4 缓办/接受）

---

## 处置总表

| 编号 | 问题 | 定级 | 处置 | 状态 | 证据 |
|------|------|------|------|------|------|
| L1 | slice_post 生命周期不完整 | P1 | C1 启动断代 | **已修** | index.ts server() 入口 |
| L2 | PowerShell 非终止错误记 success | P1 | **跳过**（批准） | 未修 | 变更清单 §3.3 |
| L3 | 货币成本字段缺失 | P2 | 缓办 | 未修 | 变更清单 §3.5 |
| L4 | 三层状态无统一事务 | P2 | 接受 | 未修 | 变更清单 §3.5 |
| L5 | C1 禁用时观测断链 | P1 | C1 启动自检 | **已修** | index.ts server() 入口 |
| N1 | SDK types.gen.ts 手改 | P0 | regen | **已修** | commit `2e25e06`，见 A2 |
| N5 | stats.jsonl 轮转仅 1 代 | P2 | 多代轮转 | **已修** | index.ts logStats |
| N6 | subscriber 不透传 diagnostic | P2 | 补透传 | **已修** | commit `a7f95e4` |

---

## 已修项详情

### L1 + L5 — C1 启动自检 + sliceStack 断代

- **文件**：`C:\Users\微醺\.config\mimocode\context-gate\index.ts`（备份 `.bak-20261031`）
- **改动**：`server()` 入口新增：
  1. 统计 `sliceStack` 残留条目数（`residual`）
  2. `sliceStack.clear()`（断代——旧窗口孤儿 pre 不再影响新窗口归因）
  3. `logStats(g, { ev: "boot", residual, c1: g.c1 })`（自检落账，含 gates 快照）
- **前后差异**：~12 行新增；无删除
- **验证**：bun build 语法通过（SYNTAX_OK）；重启会话后 stats.jsonl 应出现 `ev:boot`
- **验证命令**（下次重启后）：
  ```powershell
  Select-String -Path "$env:USERPROFILE\.config\mimocode\context-gate\stats.jsonl" -Pattern '"ev":"boot"'
  ```

### N5 — stats.jsonl 多代轮转

- **文件**：同上 `index.ts` `logStats()`
- **改动**：单槽 `.1` 覆盖 → 链式 `.4→.5, .3→.4, …, .1→.2, file→.1`，保留 5 代
- **前后差异**：~8 行；旧实现 `.1` 已存在时 `renameSync` 在 Windows 失败（EEXIST），历史被静默丢弃；新实现先 `rmSync(dst)` 再 rename
- **验证**：bun build SYNTAX_OK；阈值逻辑未变（仍 4MB），触发行为已单测性质确认

### N6 — subscriber 透传 agentID/diagnostic

- **文件**：`packages/cli/src/metrics/subscriber.ts`（MiMo-Code 仓）
- **改动**：`ModelCall` / `ToolCall` 上报体各补 `agentID`、`diagnostic` 字段透传（4 行）
- **Commit**：`a7f95e4`
- **验证**：`packages/cli` typecheck 无新增错误（存量错误见下）

---

## 跳过 / 缓办项说明

### L2 — bash exit≠0 发 error ToolCall（跳过）

批准方明确指示跳过。语义上 bash 失败率统计口径仍虚高（PS 非终止错误记 success），影响观测精度但不影响 V1 已验收链路。若后续实施，属 post-V1 独立任务。

### L3 — 货币成本字段（缓办）

Core 侧加字段触及 V1 契约边界，需单独契约窗口。C1 侧单价回放可后补。

### L4 — 三层状态无统一事务（接受）

水位 success-gated 推进已堵死坏模式；最终一致符合当前设计。SliceStack 断代（L1）部分缓解了内存态重启脆弱性。

---

## 存量 typecheck 错误（冻结文件，不在本批修复范围）

| 文件 | 错误性质 | 说明 |
|------|----------|------|
| `metrics/immune-memory.ts` | 严格模式类型 | V1 冻结文件，定义未接线（见 A4） |
| `test/session/immune-real-path.test.ts` | 测试环境类型 | 真实构建环境依赖，运行时正常 |

`packages/cli` typecheck 对这两个文件报错为**冻结前已存在**，N6 改动 0 新增错误。

---

## 未解决问题 / 风险

1. **L2 未修**：bash 失败统计口径虚高持续存在——观测/告警若依赖 bash 成功率需知此偏差。
2. **ev:boot 验证依赖重启**：C1 插件在 TUI 进程启动时加载，boot 事件在下次会话重启后才落账；本次无法现场验证，仅语法级确认。
3. **C1 配置文件不在 Git**：改动通过 `.bak-20261031` 备份保护；无版本历史，长期建议纳入配置仓。
