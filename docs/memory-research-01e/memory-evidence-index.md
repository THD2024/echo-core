# 证据索引（memory-evidence-index.md）

> 所有关键结论对应的代码路径、测试记录和证据来源。
> 证据等级：VERIFIED / IMPLEMENTED_UNVERIFIED / PARTIAL / DESIGN_ONLY / NOT_IMPLEMENTED / UNKNOWN

---

## 1. 架构事实

| 结论 | 证据 | 等级 |
|------|------|------|
| Memory 是文件优先系统，SQLite 仅作索引 | `memory/service.ts:46-64`（reconcile 方向）、`memory/reconcile.ts:78-88`（upsert 从磁盘读） | VERIFIED |
| Memory.Service 无写 API | `memory/service.ts` 仅导出 root/reconcile/search | VERIFIED |
| 写入路径：工具写文件→守卫→reconcile | `tool/external-directory.ts:125-132`、`memory/reconcile.ts` | VERIFIED |
| reconcile 单向磁盘→SQLite | `memory/reconcile.ts:78-88` | VERIFIED |
| fingerprint = size-mtime | `memory/reconcile.ts:57` | VERIFIED |

---

## 2. 模块清单

| 模块 | 文件 | 行数 | 导出符号 |
|------|------|------|---------|
| Service | `packages/cli/src/memory/service.ts` | 148 | Service, layer, defaultLayer, Interface |
| Paths | `packages/cli/src/memory/paths.ts` | 125 | parsePath, buildPath, Scope, MemoryType |
| Reconcile | `packages/cli/src/memory/reconcile.ts` | 144 | reconcileMemory, walkMemoryDir, indexFromDisk |
| Write Gate | `packages/cli/src/memory/write-gate.ts` | 33 | isMemoryWriteEnabled, MemoryWriteConfig |
| FTS Query | `packages/cli/src/memory/fts-query.ts` | 38 | buildFtsQuery |
| FTS Schema | `packages/cli/src/memory/fts.sql.ts` | 19 | MemoryFtsTable |
| Memory Tool | `packages/cli/src/tool/memory.ts` | 77 | MemoryTool |
| Path Guard | `packages/cli/src/tool/memory-path-guard.ts` | 248 | assertMemoryWriteAllowed, assertAgentWriteSandbox |
| Immune Memory | `packages/cli/src/metrics/immune-memory.ts` | 65 | ImmuneMemoryEntry, ImmuneMemoryStore |

---

## 3. 检索链路

| 结论 | 证据 | 等级 |
|------|------|------|
| FTS5 查询 = memory_fts_idx MATCH + JOIN memory_fts | `memory/service.ts:102-112` | VERIFIED |
| BM25 排序 + 相对分数地板 0.15 | `memory/service.ts:119-132` | VERIFIED |
| 搜索默认 limit=10 | `memory/service.ts` search 方法默认参数 | VERIFIED |
| Over-fetch min(3×limit, 50) | `memory/service.ts` | VERIFIED |
| Snippet 32 tokens | `memory/service.ts` | VERIFIED |
| buildFtsQuery 生成 OR 短语 MATCH | `memory/fts-query.ts:1-38` | VERIFIED |
| search 前 lazy reconcile | `memory/service.ts:46-64` | VERIFIED |

---

## 4. 写入链路

| 结论 | 证据 | 等级 |
|------|------|------|
| write-gate 唯一 accessor | `memory/write-gate.ts:12` | VERIFIED |
| 三级守卫链 | `tool/external-directory.ts:125-132` | VERIFIED |
| 保留路径主代理不可写 | `tool/memory-path-guard.ts:108-132` | VERIFIED |
| writer 水位仅成功时推进 | `session/checkpoint.ts` 事务性不变量 | VERIFIED |
| write-off 不 spawn writer | `session/checkpoint.ts:664` | VERIFIED |
| write-off rebuild 短路到 compaction | `session/prompt.ts:986` | VERIFIED |

---

## 5. Checkpoint / Dream / Reconcile

| 结论 | 证据 | 等级 |
|------|------|------|
| checkpoint writer 是独立子代理 | `session/checkpoint.ts:664` spawn | VERIFIED |
| auto-dream 触发条件：config+间隔+write-gate+step=1 | `session/auto-dream.ts:113,126` | VERIFIED |
| bootstrap reconcile 后台执行 | `project/bootstrap.ts:52` | VERIFIED |
| 无 cron/timer 定时任务 | 全 src 搜索无 cron/schedule | VERIFIED |
| auto-dream 是拉模型（新 session 检查） | `session/auto-dream.ts` | VERIFIED |

---

## 6. 缺陷与风险

| 结论 | 证据 | 等级 |
|------|------|------|
| assertMemoryWriteAllowed 缺 path.resolve | `tool/memory-path-guard.ts`（对比 assertAgentWriteSandbox:35 有 resolve） | VERIFIED |
| 29 个 path-guard 测试失败 | `memory-failure-cases.md` 实测记录 | VERIFIED |
| bash 不经守卫 | `tool/memory-path-guard.ts:18-21` 注释 | VERIFIED |
| 无并发锁 | reconcile.ts 无锁机制 | VERIFIED |
| 源码↔DB 迁移漂移 | 本机 DB 有 20261013000000_inbox_queue，源码无 | VERIFIED |
| CJK 分词弱（memory 用纯 unicode61） | `memory/fts.sql.ts` tokenizer 配置 | VERIFIED |

---

## 7. 测试覆盖

| 测试文件 | 覆盖点 | 实测状态 |
|----------|--------|---------|
| `test/tool/memory.test.ts` | search 有/无结果文案 | PASS |
| `test/tool/memory-write-gate.test.ts` | write-gate 单元行为 | PASS |
| `test/tool/memory-path-guard.test.ts` | 路径 allowlist/保留路径 | **29 FAIL**（Windows 缺陷） |
| `test/tool/memory-edit-ask-skip.test.ts` | 记忆树跳过 edit ask | PASS |
| `test/config/memory-disable-write.test.ts` | schema + accessor 全真值表 | PASS |
| `test/session/checkpoint-memory-write.test.ts` | write-off 不 spawn writer | PASS |
| `test/session/auto-dream-memory-write.test.ts` | write-off 不触发 dream | PASS |
| `test/memory/*` | 底层套件 | 部分 PASS |

**总实测**：180 pass / 30 fail / 2 skip（来源：memory-failure-cases.md）

---

## 8. 未测试项目（明确标记）

| 能力 | 状态 |
|------|------|
| 冲突处理 | 未测试（且未实现） |
| 过期信息 | 未测试（且未实现） |
| 错误记忆 | 未测试（且未实现） |
| 重复记忆 | 未测试（且未实现） |
| 信息遗漏 | 未测试 |
| 原始证据追溯 | 未测试（且未实现） |
| 崩溃恢复 | 部分测试（writer 失败水位不动） |
| 并发读写 | 未测试（且未实现） |
| 索引重建 | 已测试 |

---

## 9. 运行时数据

| 结论 | 证据 | 等级 |
|------|------|------|
| memory_fts 897 行 | mimocode.db 只读抽样（2026-10-31） | VERIFIED |
| 分布：sessions/checkpoint 362, free 338, projects 168, progress 29 | 同上 | VERIFIED |
| 迁移 56 条 | `__drizzle_migrations` 表 | VERIFIED |
| Memory 根：`C:\Users\<user>\.local\share\mimocode\memory\` | paths.ts + 实际目录 | VERIFIED |

---

## 10. Immune 零耦合

| 结论 | 证据 | 等级 |
|------|------|------|
| ImmuneMemoryStore 仅接口声明 | `metrics/immune-memory.ts:56-65` | VERIFIED |
| 全 src/test 零 import | Grep 搜索 ImmuneMemory 零引用 | VERIFIED |
| 与 Memory.Service 无数据流 | 依赖审计报告 | VERIFIED |

---

*本索引汇总自 memory-research-01e/ 下全部 15 份文档。所有 path:line 坺基于 D:\EchoCore\MiMo-Code\packages\cli\src\ 源码根。*
