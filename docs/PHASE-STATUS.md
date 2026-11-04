# Echo Core 阶段状态

- 更新时间：2026-10-31（重启后 C1 冒烟通过）
- 状态：**C1 已生效并冒烟通过；P0 协议+测试仓库完成；P1 证据完成；基线数据待执行**

---

## 1. 当前基线

| 项 | 值 |
|---|---|
| MiMoCode | v0.1.16（`mimo --version`），本机 mimo.exe 135,978,496 B |
| 源码镜像 | `D:\EchoCore\MiMo-Code`，tag `v0.1.16` = `b8dbe084` |
| 研发目录 | `D:\EchoCore\echo-core`，git main @ `1fb512e` |
| 生产环境 | `C:\Users\<user>\.config\mimocode\` |
| C1 状态 | **已生效并冒烟通过**（2026-10-31 重启后实测） |

## 2. Phase 1 本轮完成

- ✅ C1 A 档代码实现（+115 行：切片栈、session.pre/post、6 个 onEvent 分支）
- ✅ C1 安全审查（10 项检查全部通过）
- ✅ C1 配置启用（gates.json c1:true，仅改这一项）
- ✅ 对账器 reconcile.py（三源对账，试跑通过）
- ✅ P0 基线协议（docs/phase1-p0-baseline-protocol.md）
- ✅ 测试仓库 B1–B4 + 任务提示词 B1–B6
- ✅ P1 清理证据（docs/phase1-p1-cleanup-evidence.md）

## 2.1 C1 冒烟验证（2026-10-31 重启后）— ✅ 通过

| 检查项 | 结果 | 证据 |
|---|---|---|
| `c1:true` 配置 | ✓ | gates.json L16 |
| `slice_pre` 事件 | ✓ 2 条 | main + checkpoint-writer-1 |
| `tool` 事件（带 tid 字段） | ✓ 26 条 | 本会话全部工具调用 |
| 三源对账器 | ✓ 可运行 | 29 条 C1 事件，0 账本错误，59 个 TID 完成对账 |
| `slice`（post） | ⏳ 未出现 | 设计如此：session.post 在切片结束时写，会话仍在进行中 |
| `error`/`retry`/`task` | ⏳ 未出现 | 本会话尚无失败/任务，属正常 |

## 3. 未完成 / 阻塞

| 项 | 阻塞原因 | 解除条件 |
|---|---|---|
| B1–B6 基线数据 | 需用户确认预算 | 确认 ¥4–8 预算 |
| P1 实际删除 | 任务书未授权 | 用户批准 |
| C1 故障注入测试 | 未安排 | 可随时本地做，¥≈0 |

## 4. 下一步（2026-10-31 断点）

1. 用户确认选哪条：**B1–B6 基线**（¥4–8）还是 **故障注入测试**（¥≈0）或两者都做
2. 若选基线：按 `docs/phase1-p0-baseline-protocol.md` 执行
3. 若选注入：本地制造错误，验证 `error`/`retry` 事件落账
4. 根据结果决定下一阶段优先级

## 5. 关键文件

| 文件 | 用途 |
|---|---|
| `docs/phase1-progress-report.md` | 本轮完整报告 |
| `docs/phase1-p0-baseline-protocol.md` | B1–B6 基线协议 |
| `docs/phase1-p1-cleanup-evidence.md` | P1 清理证据 |
| `docs/c1-design.md` | C1 设计说明 |
| `bench/reconcile.py` | 三源对账器 |
| `bench/repo-b{1..4}/` | 测试仓库 |
| `bench/tasks/b{1..6}.md` | 任务提示词 |
| `context-gate/index.ts` | C1 代码（528 行） |
| `context-gate/index.ts.pre-c1` | C1 回滚备份 |

## 6. 回滚方式

- **C1 关闭**：`gates.json` 设 `"c1": false`（热加载，秒级）
- **C1 代码回滚**：还原 `index.ts.pre-c1`（需重启）
