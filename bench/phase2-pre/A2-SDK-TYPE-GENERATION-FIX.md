# A2 · SDK Type Generation Fix

任务编号：EC-PHASE2-P0-01 / WP-02  
日期：2026-10-31  
对应 Commit：`2e25e06`  
批准：项目负责人（批准项 B）

---

## 1. 问题（D-LEGACY N1）

SDK `packages/sdk/src/v2/gen/types.gen.ts` 存在手工修改：`diagnostic` 字段被直接写入生成文件，但未同步至 zod 生成源头。下次 regen 将丢失该字段。

## 2. 根因

- 生成源头：`packages/cli/src/metrics/event.ts`（zod schema → SDK 类型）
- 生成入口：`bun ./packages/sdk/script/build.ts`
- `event.ts` 中 `DiagnosticInfo` / `ModelCall.diagnostic` 在 Phase1B 已加入 zod 定义
- **但从添加 diagnostic 到本次修复期间，从未执行 regen**——生成产物落后于源头
- 手抄 `types.gen.ts` 时只抄了 `agentID`，漏了 `diagnostic`

## 3. 修复

1. 确认 zod 源头 `event.ts` 已含 `agentID` + `diagnostic`（无需改源头）
2. 执行官方生成流程：`bun ./packages/sdk/script/build.ts`
3. 实质变更仅 2 个文件：
   - `packages/sdk/src/v2/gen/types.gen.ts` — `diagnostic` 字段同步（:211/:241）
   - `packages/sdk/src/v2/gen/sdk.gen.ts` — 重排（`refreshProviders`/`SessionStatus` 等活跃方法确认仍在）

## 4. 生成前后差异

| 文件 | 变更 |
|------|------|
| `types.gen.ts` | `+ diagnostic` 字段（2 处），`agentID` 保留 |
| `sdk.gen.ts` | 行尾/顺序噪声，无方法丢失（`refreshProviders`:422、`SessionStatus`:462、`EventSessionStatus`:485 均在） |

行尾噪声通过 `git checkout --` 丢弃，只提交 2 个实质文件。

## 5. 验证

| 检查 | 结果 |
|------|------|
| SDK typecheck（`bun run typecheck`） | **EXIT=0** |
| openapi-refs 测试 | 通过（regen 前后均过） |
| 活跃类型未丢失 | refreshProviders / SessionStatus / EventSessionStatus 确认存在 |
| 重复生成稳定性 | build.ts 为确定性生成，再次运行 diff 为空（zod→SDK 纯映射） |

## 6. 可重复性

```bash
bun ./packages/sdk/script/build.ts
git diff --stat packages/sdk/src/v2/gen/
# 预期：空 diff（已与源头同步）
```

## 7. 未解决问题 / 风险

- v1 gen 目录行尾噪音在 git status 中显示 M，未实质变更（`core.safecrlf=false` 下 numstat 为 0）。
- 上游若改 event.ts zod 定义，regen 会自动带出；无需再手改生成文件。
