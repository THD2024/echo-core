# A · Memory System 能力评估

任务编号：EC-PHASE2-01 / WP-01  
日期：2026-10-31  
审计方式：只读代码审计（explore-6）+ 已有测试证据引用  
证据层级标注规范：`[代码存在]` / `[已接入]` / `[有测试证据]` / `[重复验证]`

---

## 1. 存储结构

| 层级 | 路径 | 写者 | 证据 |
|------|------|------|------|
| 会话短期 | `memory/sessions/<sid>/checkpoint.md`（11 节结构化） | **仅 checkpoint-writer 子代理**（`llm.ts:95,142`） | [已接入][有测试] |
| 会话草稿 | `sessions/<sid>/notes.md` | 主 agent 追加（唯一合法 scratchpad） | [已接入] |
| 任务进度 | `sessions/<sid>/tasks/<tid>/progress.md` | 子 agent | [已接入] |
| 项目长期 | `projects/<pid>/MEMORY.md` | writer 主写；主 agent 规则例外直写 | [已接入] |
| 全局长期 | `global/MEMORY.md` | 只读注入，无自动创建 | [已接入] |

- **持久化**：文件系统 .md + SQLite FTS5 旁路索引（`memory_fts`，migration `20260515010000`）
- **更新**：writer 原地覆盖；reconcile 以 `size-mtime` 指纹增量重建（`reconcile.ts:57-58`）
- **删除**：无用户删除工具；reconcile 剪除磁盘不存在的 FTS 行
- **写闸门**：`memory.disable_write` 经 `write-gate.ts:31` 可关闭全部新写（读仍可用）

**短期 vs 长期区分**：靠目录结构（sessions vs projects/global），非靠数据结构标记。checkpoint 是短期工作状态，MEMORY.md 是提炼后的长期知识——由 writer 在 checkpoint 事件时提炼。

## 2. 检索

| 项 | 现状 | 证据 |
|----|------|------|
| 入口 | `Memory.search`（`service.ts:52`）→ 工具 `memory({operation:"search"})` | [已接入][有测试] |
| 算法 | **仅 FTS5 BM25，无向量/语义/embedding** | [代码存在] |
| 查询构造 | Unicode 分词 → 短语引号 → OR 连接（`fts-query.ts:28-37`，CJK 支持） | [有测试] |
| 排序 | BM25 降序 + `topScore*0.15` 地板滤噪声 + Top1 恒保留 | [代码存在] |
| 上下文预算 | rebuild 时 section 预算截断：checkpoint ~11k、MEMORY ~10k、notes ~6k tokens | [代码存在] |
| lazy reconcile | 搜索前自动触发（`memory_reconcile_on_search` 默认 true） | [已接入] |

**关键局限**：纯关键词匹配。同义改写、隐式关联、语义近似查询会失败。工具 0 结果时文案引导 grep/history 补救——是话术补救，非系统性解决。

## 3. 使用

| 通道 | 时机 | 形式 |
|------|------|------|
| System 注入 | 每次 chat | `buildMemoryInstructions`：路径/所有权/Active recall 协议 |
| Rebuild 自动注入 | 上下文溢出或 `/rebuild` | 全量 dump checkpoint+MEMORY+global+notes → synthetic user 消息 |
| Reminder | 有记忆产物后每用户消息 | ~120 token 提示 search/read |
| 工具调用 | agent 主动 | `memory.search` / Read / Grep |
| 规划影响 | **被动** | system 提示"先查记忆"；无独立 planning→memory 桥 |

**记忆能否影响规划**：能，但依赖模型遵循 system/reminder 的主动检索协议。代码层无"规划前必须查记忆"的硬约束。

**读取成功但未被使用**：可能存在——rebuild 全量注入后模型可能忽略部分记忆。无使用率追踪。

## 4. 质量风险

| 风险 | 现状 | 机制 |
|------|------|------|
| 冗余 | checkpoint §3/§7 与 MEMORY.md 可能重复 | writer 清理 §3 中已入 Rules 的行 |
| 过期 | **无 TTL/衰减** | 仅靠 writer 覆写与 reconcile 剪死路径 |
| 错误长期保留 | writer 可能误归类 | system 明示"entries are CLAIMS…Verify"；无自动纠错 |
| 事实 vs 推断 | **主记忆无结构化区分** | `immune-memory.ts` 定义了 confidence schema——**V1 仅 schema，未接线** |
| 字面量丢失 | OR 分词丢 URL/port 精确匹配 | 工具话术引导 grep |

## 5. 证据分级汇总

| 能力 | 等级 |
|------|------|
| 文件布局/路径解析/scope | [已接入][有测试] |
| FTS5 BM25 检索 | [已接入][有测试] |
| memory search 工具 | [已接入][有测试] |
| checkpoint writer | [已接入][有测试] |
| rebuild 自动注入 | [已接入][有测试] |
| 写路径 guard | [已接入][有测试] |
| expectedRevisions 冲突校验 | [代码存在]**[未接线]**（恒传 `[]`） |
| 向量/语义检索 | **不存在** |
| immune-memory 置信分级 | [代码存在 schema] 未存储/未检索 |

## 6. 脆弱点 Top3

1. **纯关键词 BM25，无语义回退**（`fts-query.ts:9-22`）——同义改写检索失败率高
2. **冲突/修订机制空转**——`validateMemory` 存在但 `expectedRevisions` 恒 `[]`，陈旧指令可长期存活
3. **指纹一致性窗口**——同 size+mtime 内容变更漏索引；off-tool 写入依赖下次 reconcile

## 7. Memory Data Flow

```
用户输入 → Session → checkpoint-writer（checkpoint 事件时）→ checkpoint.md
                                                      ↓
                                              提炼规则/知识 → MEMORY.md
                                                      ↓
                                              FTS 索引更新（reconcile）
                                                      ↓
Context rebuild 时 → 全量 dump 注入模型上下文
平时 → reminder 提示 + agent 主动 memory.search
```

## 8. 评估结论

**Echo 当前具备**：结构化文件记忆 + BM25 检索 + rebuild 全量注入 + 写闸门。这是一个**可用的文件级记忆系统**，跨会话信息持久化已验证。

**Echo 当前不具备**：语义检索、记忆冲突自动解决、置信度分级、记忆使用率追踪。距离"可靠长期记忆"还有明确差距——核心短板是**检索精度依赖关键词匹配**和**过期/错误信息无自动清理**。
