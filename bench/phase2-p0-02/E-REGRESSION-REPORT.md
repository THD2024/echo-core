# E · 回归报告

任务编号：EC-PHASE2-P0-02 / WP-04  
日期：2026-10-31  
修复 Commit：`a5d7813`

---

## 1. 回归套件结果

| 套件 | 命令 | 结果 | 对比修复前 |
|------|------|------|-----------|
| classify 单元 | `bun test ./test/session/classify.test.ts` | **34/34 pass** | 无退化（修复前 34/34） |
| immune 真实路径 | `bun test ./test/session/immune-real-path.test.ts` | **2/2 pass** | 无退化（修复前 2/2） |
| classify 集成 | `bun test ./test/session/classify-integration.test.ts` | **9/9 pass** | 无退化（修复前 9/9） |
| SDK typecheck | `bun run typecheck`（packages/sdk） | **EXIT=0** | 无变化 |

## 2. typecheck 分析

`packages/cli` typecheck 报错全部在：
- `src/metrics/immune-memory.ts`（5 处，冻结文件，已知存量）
- `test/session/immune-real-path.test.ts`（8 处，冻结文件，已知存量）

**prompt.ts 无新错误**——L2 修复 0 新增 typecheck 错误。

## 3. 冻结边界验证

| 文件 | 哈希比对 | 结果 |
|------|----------|------|
| classify.ts | 与冻结清单一致 | MATCH |
| event.ts | 与冻结清单一致 | MATCH |
| immune-memory.ts | 与冻结清单一致 | MATCH |
| tolerance.ts | 与冻结清单一致 | MATCH |
| processor.ts | 与冻结清单一致 | MATCH |
| immune-real-path.test.ts | 与冻结清单一致 | MATCH |

**6/6 MATCH**——L2 修复未触碰任何 V1 冻结文件。

## 4. 修复前后对比

| 指标 | 修复前 (a7f95e4) | 修复后 (a5d7813) | Δ |
|------|------------------|------------------|---|
| classify 34/34 | ✅ | ✅ | 0 |
| real-path 2/2 | ✅ | ✅ | 0 |
| integration 9/9 | ✅ | ✅ | 0 |
| 冻结文件 6/6 | MATCH | MATCH | 0 |
| prompt.ts typecheck | 0 新错误 | 0 新错误 | 0 |
| bash exit≠0 记 error | ❌ 全记 success | ✅ 记 error+diagnostic | **改善** |

## 5. 结论

- L2 修复无非预期退化
- Immune V1 冻结边界完整
- 语义变更仅限 bash 失败统计口径真实化（已声明）
