# A1 · Immune System V1 Freeze Report

任务编号：EC-PHASE2-P0-01 / WP-01  
日期：2026-10-31  
执行：AI 开发与审计助手  
批准：项目负责人（变更清单 P0-01-CHANGE-PLAN.md 批准项 A）

---

## 1. 版本标识

| 项 | 值 |
|----|-----|
| Tag | `immune-v1.0.0` |
| Freeze Commit | `0939522c515b7e1a7188bd0e9b08aa3091e45cb5` |
| 父 Commit | `496bb8c`（上游 merge base） |
| 分支 | `main` |
| 正式二进制 | `C:\Users\微醺\.mimocode\bin\mimo.exe` |
| 二进制 SHA256 | `dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa` |

Tag 与 Commit 指向一致（`git rev-parse immune-v1.0.0^{commit}` = freeze commit）。

## 2. 冻结文件集合（7 文件，+738 行）

| 文件 | SHA256 |
|------|--------|
| `packages/cli/src/metrics/classify.ts` | `38dad26f6654a2c756b3812b225e180806a0db07e9e441234a78f3e658a23767` |
| `packages/cli/src/metrics/event.ts` | `4f4cb9f3b700b291b2474cc66e871056cfae353fee14d09259c28945bc6d8c15` |
| `packages/cli/src/metrics/immune-memory.ts` | `11bbcbc7639d7ae668b349f1c2ccd5d09954ae31e01a14aa40b5eff3765209f7` |
| `packages/cli/src/metrics/tolerance.ts` | `a0474968da77c0e45fc281f2f432f79f94c64a4956a373d2a976ef09b1728e90` |
| `packages/cli/src/session/processor.ts` | `c232a6a3aff6e1ee8a674de2c945dbb1ba3f29bfe7a03b6f492b1f96822303ae` |
| `packages/cli/src/session/prompt.ts` | `af987e1787ab1f67dde5c0c306c20edf7d9bf80cdc1122a932c6375590e9266e` |
| `packages/cli/test/session/immune-real-path.test.ts` | `7c0f4e36ef636df2be9a4afc67b8ff78c8af5a38104b9b6a62d5d0645bd4be30` |

冻结后（N6 commit 之后）重新计算，**七文件哈希与冻结时完全一致**——N6 只改了 `subscriber.ts`（冻结集合之外），未触碰 V1 冻结文件。

## 3. 冻结提交内容

```
0939522 feat(immune): Immune System V1 - tool-error 7-field classification (frozen)
 7 files changed, 738 insertions(+)
```

未混入：`bun.lock`、`types.gen.ts` 留在工作区，未入冻结提交。

## 4. 后续提交（冻结后，独立于 V1）

| Commit | 内容 |
|--------|------|
| `2e25e06` | fix(sdk): regen v2 types — sync agentID + diagnostic from zod source (WP-02) |
| `a7f95e4` | fix(metrics): forward agentID/diagnostic in analysis subscriber (N6, EC-PHASE2-P0-01) |

## 5. 验收证据索引

| 证据 | 位置 |
|------|------|
| 正式安装进程级验证 | `bench/phase1b/evidence/tool-error-e2e-formal/` |
| C4_normal E2E | `…/tool-error-e2e-formal/C4_normal.json` |
| C2_bad_params E2E | `…/tool-error-e2e-formal/C2_bad_params.json` |
| stats.jsonl 原始行 | `C:\Users\微醺\.config\mimocode\context-gate\stats.jsonl` 行 14356–14372 |
| 冻结前核验 | `bench/phase2-pre/A-IMMUNE-V1-FREEZE-RECORD.md` |
| 验收报告 | `bench/phase1b/PHASE1B-REPAIR-REPORT.md` §12/§12A |

## 6. 冻结边界（V1 契约）

- 不新增诊断字段、不扩展故障分类
- 不引入自动修复/自动重试
- 不改变已验收接口契约（`DiagnosticInfo` 7 字段、`classifyToolError` 三态、C1 `p.diagnostic` 消费路径）
- 实际缺陷修复须独立 commit + 回归证据（本次 N6 即按此执行）

## 7. 维护与升级规则

1. **V1 缺陷修复**：独立 commit，不 amend 冻结 commit，附回归测试。
2. **新能力**：进 V2，不混入 `immune-v1.0.0` tag 范围。
3. **上游合并**：merge 后必须重跑 classify 34 + real-path 2 回归。
4. **二进制重建**：构建时设 `MIMOCODE_CHANNEL='local'` + `MIMOCODE_VERSION='local'`；装机后执行进程身份核验（创建时间排序 + 父进程 + aside hash）。

## 8. 未解决问题 / 风险

- `immune-memory.ts`、`immune-real-path.test.ts` 存在严格 typecheck 错误（冻结文件，存量，见 A3）。
- 二进制 `dc28dff1` 与源码 freeze commit 对应关系依赖构建环境记录，无 CI 重现管道（Phase 2 建议）。
