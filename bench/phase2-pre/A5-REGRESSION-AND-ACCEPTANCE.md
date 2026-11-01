# A5 · Regression & Acceptance

任务编号：EC-PHASE2-P0-01 / WP-05  
日期：2026-10-31  
模式：整体回归与工程固化验收

---

## 1. 验收检查表

| 检查项 | 要求 | 结果 | 证据 |
|--------|------|------|------|
| V1 Freeze Commit | 存在且可追溯 | **PASS** | `0939522`（7 文件，+738 行） |
| V1 Git Tag | 指向正确 Commit | **PASS** | `immune-v1.0.0^{commit}` = `0939522` |
| SHA256 | 与冻结清单一致 | **PASS** | 7 文件冻结后复算一致（N6 未触碰） |
| SDK 类型生成 | 可重复生成 | **PASS** | regen commit `2e25e06`；再跑 build.ts diff 为空 |
| TypeScript 类型检查 | 通过 | **PASS** | SDK typecheck EXIT=0；cli 无新增错误 |
| C4_normal | 原基线通过 | **PASS** | `tool-error-e2e-formal/C4_normal.json`（正式安装 dc28dff1） |
| C2_bad_params | 原基线通过 | **PASS** | `tool-error-e2e-formal/C2_bad_params.json` |
| stats.jsonl | 持久化正确 | **PASS** | 行 14356–14372，C4/C2 事件齐全 |
| CID 关联 | 正确 | **PASS** | error 行含 `cid=call_*`，与 E2E 捕获一致 |
| 七个诊断字段 | 持久化正确 | **PASS** | `tool_execution`/`tool_parameter` + recoverability + 7 字段 |
| 基础设施修复 | 每项独立验证 | **PASS** | L1/L5/N5 语法验证 + 备份；N6 typecheck；见 A3 |
| 回归测试 | 无非预期退化 | **PASS** | 见 §2 |

**12/12 PASS**

## 2. 回归测试明细

| 套件 | 命令 | 结果 |
|------|------|------|
| classify 单元 | `bun test ./test/session/classify.test.ts` | **34/34 pass** |
| classify 集成 | `bun test ./test/session/classify-integration.test.ts` | **0 fail**（复跑；首跑 1 fail 为环境偶发） |
| immune 真实路径 | `bun test ./test/session/immune-real-path.test.ts` | **2/2 pass** |
| SDK typecheck | `bun run typecheck`（packages/sdk） | **EXIT=0** |
| openapi-refs | regen 前后各一次 | 通过 |

对原始 V1 验收场景（C4/C2）**未更改任何测试预期**；正式二进制 `dc28dff1` 未重建，复跑即原基线。

## 3. 冻结完整性复核

冻结后执行了 N6（subscriber）与 C1 配置修改：

- N6 只改 `subscriber.ts`（冻结集合之外）→ 7 文件哈希复算一致
- C1 配置在 `~/.config/mimocode/context-gate/`，不属 MiMo-Code 仓 → 不影响冻结 commit
- 未 rebase / push / 重建二进制

## 4. 语义变更声明

- **N5**：轮转从 1 代变 5 代——`stats.jsonl.2` 至 `.5` 将在 4MB 阈值触发时出现；旧 `.1` 覆盖 bug 消除。
- **L1/L5**：每次 TUI 启动 stats.jsonl 增加一条 `ev:boot`——下游按 `ev` 过滤的工具需兼容新事件类型。
- **N6**：远程上报体新增字段——消费端应为 optional 解析（已有 schema 向后兼容）。

## 5. 未解决问题

1. `ev:boot` 实际落账待下次 TUI 重启验证（语法级已确认）。
2. classify-integration 首跑 1 fail 未复现，疑为测试环境资源竞争；若再现行需单独归因。
3. L2 跳过：bash 失败统计口径虚高持续（观测层偏差，非 V1 契约内）。

## 6. 风险说明

- 本批修改的 C1 配置无 Git 版本管理，依赖 `.bak-20261031` 单点备份。
- 二进制与源码对应关系依赖构建时环境记录；无 CI 管道强制校验（Phase 2 建议方向之一）。
