# Phase 1 — Foundation & Observability 阶段报告

- 日期：2026-10-30
- 状态：**C1 代码就绪（待重启生效）；P0 协议完成；P1 证据完成；基线数据待执行**
- 宿主：MiMoCode v0.1.16（tag `b8dbe084`）
- 本轮实际费用：≈¥0（无 API 调用消耗；仅本地文件操作）

---

## A. C1 启用报告

### A.1 启用前安全检查

| 检查项 | 结论 | 证据 |
|---|---|---|
| Git 状态 | 干净，1fb512e，3 个未跟踪文件 | `git status` |
| 备份完整性 | index.ts.pre-c1 = 15,518 字节（原始 413 行） | 文件系统 |
| C1 配置门 | L39 `c1:false` 默认；L406/429/487 三处门控 | 源码审查 |
| 无重复注册 | session.pre/post/event 各出现一次 | L521-523 |
| 无事件递归 | C1 只写文件，不 publish | 源码审查 |
| 不改决策 | 不设 cancel、不改 properties | 源码审查 |
| JSONL 错误处理 | 全部 try/catch 包裹 | 源码审查 |
| 回滚有效 | gates.json c1:false 热加载短路所有 C1 分支 | 逻辑推导 |

### A.2 配置变更

```diff
- "roundtrip_hint": true
+ "roundtrip_hint": true,
+ "c1": true
```

仅此一行。其他配置未动。

### A.3 代码变更

| 文件 | 变更 | 行数 |
|---|---|---|
| `context-gate/index.ts` | +切片栈、+session.pre/post 钩子、+6 个 onEvent 分支、+c1 配置 | 413 → 528（+115） |
| `bench/reconcile.py` | 新建三源对账器 | 258 行 |
| `gates-changelog.jsonl` | 追加 C1 变更记录 | +1 行 |

### A.4 冒烟测试状态

**阻塞**：当前 mimo 进程（PID 25188/29604）在启动时加载了旧版 index.ts（413 行，无 C1 分支）。`c1:true` 配置虽热加载，但旧代码不检查 `g.c1`，故新事件类型不会产生。

**需要**：用户重启 MiMoCode 后，C1 分支随新代码加载，事件开始产生。

**重启后验证步骤**：
1. 执行任意简单操作（如读文件）
2. 检查 stats.jsonl 是否出现 `ev:slice_pre`、`ev:slice`、`ev:tool` 等新行
3. 运行 `python bench\reconcile.py` 查看对账输出

### A.5 额外开销评估

- 每事件 +1 次 `appendFileSync`（<1ms，微秒级 I/O）
- 切片栈：每 session 几十字节内存
- **结论**：可忽略

---

## B. B1–B6 基线协议

### B.1 协议文档

`docs/phase1-p0-baseline-protocol.md` — 完整定义 B1–B6 任务、成功判定、环境固定、数据采集规范。

### B.2 测试基础设施

```
bench/
├── repo-b1/          # 简单任务仓库（config.js）
├── repo-b2/          # 多步骤任务仓库（5 个 JSON 日志）
├── repo-b3/          # 多文件任务仓库（math 模块 + 测试 + README）
├── repo-b4/          # 工具密集仓库（30 个 JS，5 个含 TODO）
├── tasks/            # 任务提示词（b1.md ~ b6.md）
├── results/          # 结果输出（空，待执行）
└── reconcile.py      # 三源对账器
```

全部已验证可运行。

### B.3 基线数据状态

**未执行**。原因：
1. C1 事件需重启后才产生，基线应在 C1 生效后采集
2. 基线执行需 ¥4–8 API 消耗，待用户确认预算窗口

---

## C. P1 清理证据报告

完整版：`docs/phase1-p1-cleanup-evidence.md`

### 关键发现

| 对象 | 结论 | 建议 |
|---|---|---|
| tools/ 27 TS | 零注册，死代码 | 归档后删除 |
| model-router.ts | 密钥路径硬编码（L7） | **优先删除** |
| 四角色 BRIEF | 零引用，已证伪 | 归档 |
| TRIAGE/RECOVERY/HANDOFF | 零引用 | 归档 |
| B1/B0 动态预算 | **已不存在** | 无需操作 |
| tail_turns | **非过期字段**（v0.1.16 仍有效，值=默认） | 保留 |

### 修正 Phase 0 的两处判断

1. `tail_turns` 不是"过期字段"——v0.1.16 `config.ts:242` 仍定义它，当前值与默认值相同
2. B1/B0 动态预算在活跃代码中不存在——搜索范围（context-gate + 两个 config）零命中

### 额外发现

`mimocode.jsonc` 明文含 DeepSeek API key。未通过 model-router.ts 泄露（该代码从未执行），但明文存储在配置中。是否轮换由用户决定。

---

## D. Phase 1 当前架构状态

### Echo 已掌握的能力

| 能力 | 实现 | 证据 |
|---|---|---|
| 上下文视图投影 | context-gate transform | 实测 −65.78%，errs=0 |
| 配置治理 | gates-changelog | JSONL 变更记录 |
| 执行入口验证 | verify.ts 预检 | .ps1 BOM / -File / 图像 |
| **失败事件采集** | **C1 A 档（代码就绪）** | **待重启生效** |
| **任务关联** | **切片栈（代码就绪）** | **待重启生效** |
| **三源对账** | **reconcile.py** | **试跑通过** |

### 仍依赖 MiMoCode 的能力

| 能力 | 原因 |
|---|---|
| 模型 API 调用 | 宿主 provider 层 |
| 工具注册与执行 | 宿主 tool/registry |
| 任务生命周期管理 | 宿主 task/registry |
| 并发门与准入 | 宿主 tool/gate |
| 上下文压缩重建 | 宿主 compaction |
| 重试与退避 | 宿主 session/retry |
| 会话持久化 | 宿主 DB |

### 架构判断不变

Echo 核心 = **在插件接口面之上建立认知与治理层**。六模块可用纯外层实现，仅 Model Fallback 需核心接口。本轮未改变此判断。

---

## E. 下一阶段建议（由实测数据决定）

**当前无法给出下一阶段优先级**——因为基线数据尚未采集。本轮交付的是基础设施（C1 代码 + 协议 + 测试仓库），不是性能数据。

**重启 MiMoCode 并执行 B1–B6 基线后**，根据真实数据决定：

1. 若失败可见率仍然低 → C1 需要 B 档核心补丁（session.error 加 task_id）
2. 若固定税仍 >35K → 启动上下文优化
3. 若工具失败率 >3% → P3 工具修复
4. 若任务收口率 <80% → 完成闸机制

**不预先认定**下一阶段必须是预算系统、记忆系统或模型容灾。

---

## F. 本轮交付物清单

| # | 交付物 | 路径 | 状态 |
|---|---|---|---|
| 1 | C1 A 档代码 | `context-gate/index.ts`（528 行） | ✅ 代码就绪 |
| 2 | C1 回滚备份 | `context-gate/index.ts.pre-c1` | ✅ |
| 3 | C1 配置 | `gates.json` c1:true | ✅ 已写入 |
| 4 | C1 配置记录 | `gates-changelog.jsonl` | ✅ 已追加 |
| 5 | 对账器 | `bench/reconcile.py` | ✅ 试跑通过 |
| 6 | P0 基线协议 | `docs/phase1-p0-baseline-protocol.md` | ✅ |
| 7 | 测试仓库 B1–B4 | `bench/repo-b{1..4}/` | ✅ 验证通过 |
| 8 | 任务提示词 | `bench/tasks/b{1..6}.md` | ✅ |
| 9 | P1 清理证据 | `docs/phase1-p1-cleanup-evidence.md` | ✅ |

---

## G. 未完成项

| 项 | 阻塞原因 | 解除条件 |
|---|---|---|
| C1 冒烟测试 | 进程加载旧代码 | 用户重启 MiMoCode |
| C1 故障注入测试 | 同上 | 同上 |
| B1–B6 基线数据 | 需 C1 生效 + API 预算 | 重启 + 用户确认预算 |
| P1 实际删除 | 任务书未授权 | 用户批准后执行 |

---

## H. 费用

- 本轮实际 API 消耗：**¥0**（无模型调用）
- 基线执行预算：**¥4–8**（待确认）
- 月度上限 ¥200 未动
