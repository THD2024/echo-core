# Phase 1 — P1 清理证据报告

- 日期：2026-10-30
- 性质：**只读审计，不执行任何删除**
- 依据：Phase 0 §H.3 删除清单 + Phase 1 任务书 §六
- 方法：逐一检查文件位置、配置注册、引用关系、运行时加载

---

## 1. `~/.mimocode/tools/` 27 个 TS 文件

| 项 | 实测 |
|---|---|
| 文件位置 | `C:\Users\微醺\.mimocode\tools\` |
| 总数 | 27 个 `.ts` 文件，合计 ~293 KB |
| 最大文件 | `semantic-gui.ts` (58.4 KB)、`memory-manager.ts` (47.0 KB)、`win-worker-client.ts` (24.7 KB) |
| 配置注册 | **零**。`~/.mimocode/mimocode.json` 仅注册 `./tui`；`~/.config/mimocode/mimocode.jsonc` 仅注册 `./context-gate` |
| tui 插件引用 | 无。扫描 tui 目录下所有 .ts，无 `tools/` 路径引用 |
| 运行时加载 | 不加载。MiMoCode 只加载 `plugin` 数组中列出的插件 |
| 内部交叉引用 | 存在。`computer-bridge` 是 GUI 子系统枢纽（被 7 个文件引用）；`circuit-breaker`/`exec-policy`/`task-state`/`win-worker-client`/`semantic-gui-types` 是辅助模块 |

**结论**：整个目录是从运行时视角的**死代码**。从未被任何配置注册，从未被加载执行。

**建议**：**归档后删除**。归档到 `D:\EchoCore\archive\mimocode-tools-20261030\`（保留 git 可追溯性），然后删除原目录。

**前置条件**：Phase 0 §F 阶段 7 要求"删除前再跑一次运行时探针"——需在隔离环境验证确实无加载。

---

## 2. `model-router.ts` 密钥暴露风险

| 项 | 实测 |
|---|---|
| 文件位置 | `C:\Users\微醺\.mimocode\tools\model-router.ts`（247 行） |
| 密钥读取 | **L7**：硬编码 `AUTH_FILE = "C:\\Users\\微醺\\.local\\share\\mimocode\\auth.json"` |
| | **L9-11**：`loadAuth()` 读取整个 auth.json |
| | **L23-53**：`getProviders()` 将 xiaomi/siliconflow/volcengine 三家的 `apiKey` 提取到内存对象 |
| auth.json 现状 | 存在，含 4 个 provider key（xiaomi, siliconflow, volcengine, deepseek） |
| 暴露面 | 密钥被读入 JS 对象后，若该文件被任何机制执行或调试，密钥可被日志/错误输出泄露 |
| 是否活跃 | **否**。文件未被注册，不会执行 |

**结论**：虽然是死代码（不会执行），但**源码中硬编码了密钥文件路径和提取逻辑**。若未来有人误注册此工具，或将其复制到其他环境，会造成密钥暴露。

**建议**：**优先删除**（在 tools/ 目录清理中第一批处理）。删除后评估是否需要轮换 auth.json 中的密钥——当前密钥未通过此路径泄露（因为代码从未执行），但 `mimocode.jsonc` 中明文写有 deepseek key（已在本次审计中被我看到），建议一并评估。

---

## 3. 四角色实体化（BRIEF-ANALYST / BRIEF-DOMAIN / BRIEF-VERIFIER）

| 项 | 实测 |
|---|---|
| 文件位置 | `D:\AlroLab\orchestrator\BRIEF-{ANALYST,DOMAIN,VERIFIER}.md`（各 698-759 字节） |
| 配置引用 | **零**。两个 mimocode 配置均无 analyst/domain/verifier 引用 |
| 自动调用 | Phase 0 实测：0 次 |
| A/B 结果 | Phase 0 实测：墙钟 2.74×、成本 2.01×、质量无差 |
| 记忆引用 | 历史记忆文件中有提及，但均为记录性引用，非活跃机制 |

**结论**：已证伪的机制。文件存在但无任何自动调用路径。

**建议**：**归档**（移到 `D:\AlroLab\orchestrator\archive\`），不删除（是历史实验记录）。

---

## 4. TRIAGE / RECOVERY / HANDOFF

| 项 | 实测 |
|---|---|
| 文件位置 | `D:\AlroLab\orchestrator\{TRIAGE,RECOVERY,HANDOFF}.md`（1,348-2,333 字节） |
| 配置引用 | **零** |
| 自动调用 | Phase 0 实测：0 次 |
| 记忆引用 | 历史记忆文件中有提及 |

**结论**：文档约定，无自动化机制。

**建议**：**归档**（同上）。它们是设计文档，不是运行机制。

---

## 5. B1/B0 动态预算

| 项 | 实测 |
|---|---|
| 搜索范围 | `context-gate/index.ts`、`verify.ts`、`gates.json`、两个 mimocode 配置 |
| 命中 | **零** |

**结论**：在当前活跃代码和配置中**不存在**。Phase 0 报告提到的 B1/B0 动态预算机制要么已被移除，要么从未落地到生产配置。

**建议**：**无需操作**（已不存在）。从 Phase 1 删除清单中移除。

---

## 6. `tail_turns`

| 项 | 实测 |
|---|---|
| 配置位置 | `~/.config/mimocode/mimocode.jsonc` L29：`"tail_turns": 2` |
| v0.1.16 源码 | **仍为有效字段**。`config/config.ts:242` 定义 `tail_turns: Schema.optional(NonNegativeInt)` |
| 默认值 | 2（与配置值相同） |
| 文档 | `reference/config.md:120`："Recent user turns kept verbatim (default 2)" |

**结论**：**Phase 0 报告称 tail_turns 为"过期字段"是错误的**。它在 v0.1.16 中仍是有效配置项，且当前值与默认值一致——是**冗余字段**，不是过期字段。

**建议**：**保留**（值与默认相同，删除无影响但也无必要）。修正 Phase 0 报告的错误判断。

---

## 7. 必须保护的对象（确认在位）

| 对象 | 位置 | 状态 |
|---|---|---|
| context-gate 投影 | `C:\Users\微醺\.config\mimocode\context-gate\` | ✅ 活跃（528 行，含 C1） |
| 人格身份层 | `D:\MiMoMemory\identity\Echo.md` | ✅ 在位 |
| gates-changelog | `context-gate\gates-changelog.jsonl` | ✅ 已更新（含 C1 记录） |
| probe.py | `D:\AlroLab\temp\self-opt\src\probe.py` 等 3 处 | ✅ 在位 |
| wu.py | `D:\AlroLab\orchestrator\wu.py`（3,578 字节） | ✅ 在位 |

---

## 8. 汇总建议表

| # | 对象 | 建议 | 优先级 | 前置条件 |
|---|---|---|---|---|
| 1 | tools/ 27 TS 死代码 | 归档后删除 | 高 | 运行时探针确认无加载 |
| 2 | model-router.ts | **优先删除**（密钥路径硬编码） | 最高 | 同上 |
| 3 | 四角色 BRIEF 文件 | 归档 | 中 | 无 |
| 4 | TRIAGE/RECOVERY/HANDOFF | 归档 | 中 | 无 |
| 5 | B1/B0 动态预算 | 无需操作（已不存在） | — | — |
| 6 | tail_turns | 保留（有效字段，值=默认） | — | — |
| 7 | 保护对象 | 不动 | — | — |

---

## 9. 额外发现（不在原清单，如实记录）

`mimocode.jsonc` 中明文写有 DeepSeek API key（`provider.deepseek.options.apiKey`）。此 key 未通过 model-router.ts 泄露（因为该代码从未执行），但明文存储在配置文件中。**是否轮换由用户决定**——本轮审计不读取、不输出、不复制该密钥值。
