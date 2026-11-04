# 运行环境与资源约束（memory-environment-constraints.md）

> 尽调日期：2026-10-31
> 证据纪律：每项结论标注证据等级

---

## 1. 操作系统与运行时

| 项目 | 值 | 证据等级 |
|------|-----|---------|
| OS | Windows 11（用户环境） | VERIFIED（进程路径 `C:\Users\<user>\`） |
| 运行时 | Bun（编译为单二进制 `mimo.exe`） | VERIFIED（`package.json` packageManager: bun@1.3.14） |
| 数据库 | SQLite（bundled，node:sqlite） | VERIFIED（`service.ts` 使用 `DatabaseSync`） |
| 存储 | 本地文件系统 + SQLite | VERIFIED |

---

## 2. 模型与 API

| 项目 | 值 | 证据等级 |
|------|-----|---------|
| 当前模型 | mimo-v2.6-flash（主会话） | VERIFIED（stats.jsonl 中 `"model":"mimo-v2.6-flash"`） |
| 备选模型 | deepseek-flash（配置中） | IMPLEMENTED_UNVERIFIED |
| API 协议 | OpenAI-compatible `/v1/chat/completions` | VERIFIED（provider 层） |
| 工具调用 | 支持 function calling | VERIFIED（tool/registry.ts） |
| 结构化输出 | 支持 JSON mode | IMPLEMENTED_UNVERIFIED |

---

## 3. 上下文管理

| 项目 | 值 | 证据等级 |
|------|-----|---------|
| 上下文窗口 | 由 provider 决定（模型相关） | UNKNOWN（未固定） |
| 推送预算 | `push_caps` 默认 11k/10k/6k tokens | VERIFIED（`config.ts:286-314`） |
| Checkpoint 触发 | 阈值阶梯（prune 阈值） | VERIFIED（`prompt.ts:4691-4875`） |
| Compaction | checkpoint 降级路径 | VERIFIED（`prompt.ts` overflowCheck） |
| Memory 检索注入 | search 结果作为工具返回注入 | VERIFIED（`tool/memory.ts`） |

---

## 4. Agent/Subagent 并行

| 项目 | 值 | 证据等级 |
|------|-----|---------|
| 子代理机制 | actor/spawn forkWork | VERIFIED（`actor/spawn.ts:754`） |
| 检查点写入 | writer 子代理独立进程 | VERIFIED（`checkpoint.ts:664`） |
| 任务绑定 | taskRegistry + progress.md | VERIFIED（`spawn.ts:380`） |
| 并发写入 | 无锁，last-writer-wins | VERIFIED（`reconcile.ts` 无锁机制） |

---

## 5. 后台任务

| 项目 | 值 | 证据等级 |
|------|-----|---------|
| 定时任务 | 无 cron/timer | VERIFIED |
| Bootstrap reconcile | 启动时后台同步 | VERIFIED（`bootstrap.ts:52`） |
| Lazy reconcile | search 前按需同步 | VERIFIED（`service.ts:46-64`） |
| Auto Dream | 新 session 启动时检查间隔 | VERIFIED（`auto-dream.ts` 拉模型） |

---

## 6. 存储与成本

| 项目 | 值 | 证据等级 |
|------|-----|---------|
| Memory 根目录 | `C:\Users\<user>\.local\share\mimocode\memory\` | VERIFIED |
| SQLite 路径 | `C:\Users\<user>\.local\share\mimocode\mimocode.db` | VERIFIED |
| 当前 memory_fts 行数 | 897 行 | VERIFIED（只读抽样） |
| 文件大小上限 | 无硬编码限制 | VERIFIED（代码中未发现） |
| 搜索默认 limit | 10 条 | VERIFIED（`service.ts`） |
| Over-fetch | min(3×limit, 50) | VERIFIED（`service.ts`） |
| Snippet 长度 | 32 tokens | VERIFIED（`service.ts`） |
| Embedding 依赖 | 无（纯 BM25） | VERIFIED |

---

## 7. 已知运行约束

| 约束 | 影响 | 证据等级 |
|------|------|---------|
| Windows 路径守卫失效 | `assertMemoryWriteAllowed` 缺 resolve，安全守卫在主平台失效 | VERIFIED（29 测试失败） |
| bash 不经守卫 | bash 工具可绕过 path-guard | VERIFIED（`memory-path-guard.ts:18-21` 注释） |
| 无并发锁 | 跨进程写入依赖 last-writer-wins | VERIFIED |
| CJK 分词弱 | memory_fts 用纯 unicode61，中文召回可能不足 | IMPLEMENTED_UNVERIFIED |
| 源码↔DB 漂移 | 本机 DB 有当前 checkout 无的迁移 | VERIFIED |
| 无遗忘机制 | 记忆只增不删，长期膨胀 | VERIFIED |
| write-gate 单点 | `isMemoryWriteEnabled` 是唯一开关 | VERIFIED |

---

## 8. 不可变更边界

| 边界 | 原因 | 证据等级 |
|------|------|---------|
| Immune V1 冻结文件 | 项目纪律要求不触碰 | DESIGN_ONLY（任务约束） |
| 生产代码只读 | 本阶段仅调查不实施 | DESIGN_ONLY（任务约束） |
| 现有 Memory 数据 | 不改变现有数据 | DESIGN_ONLY（任务约束） |
| `memory.disable_write` 语义 | 唯一合法 accessor 是 write-gate | VERIFIED |

---

## 9. 测试环境

| 项目 | 值 | 证据等级 |
|------|-----|---------|
| 测试框架 | Bun test | VERIFIED |
| 测试位置 | `packages/cli/test/` | VERIFIED |
| Memory 相关测试 | 17 个文件 | VERIFIED |
| 实测结果 | 180 pass / 30 fail / 2 skip | VERIFIED（子代理实测） |
| 失败根因 | Windows 路径守卫缺陷 + 中文用户名污染断言 | VERIFIED |

---

*本报告基于 memory-failure-cases.md、memory-data-model.md、memory-runtime-flow.md 综合提炼。*
