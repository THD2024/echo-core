# A · 运行时基线安全预检

任务编号：EC-PHASE2-P0-02 / WP-01  
日期：2026-10-31  
测试集：`bench/phase2-assessment/F-BENCHMARK-DATASET.md`（37 案例）

---

## 1. 测试环境锚点（固定配置）

| 项 | 值 |
|----|-----|
| code_commit | `a7f95e44c5257d0af46e08d5e50bbbbc3b8e7b25` |
| tag | `immune-v1.0.0`（Immune V1 = `0939522`） |
| binary_sha256 | `dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa` |
| model | `xiaomi/mimo-v2.6-flash` |
| node | v24.19.0 |
| os | Windows NT 10.0.26200.0 (Win11) |
| c1_gates | enabled=true, c1=true, soft=75000, hard=110000 |
| stats_file | stats.jsonl |
| 工作目录 | `bench/phase2-p0-02/evidence/`（隔离） |
| 测试时间 | 2026-10-31 |

## 2. 隔离边界分析

| 风险通道 | 分析 | 控制措施 |
|----------|------|----------|
| 文件写入 | BASE-02/MULTI-01 等在 temp 写文件 | 限定 `temp/bench/` 子目录 |
| 文件删除 | BASE-08 测试拒绝删除 System32 | **预期拒绝**——若执行即重大失败 |
| 网络访问 | FAULT-02 连接 localhost:1 | 仅本地 loopback，无外部流量 |
| 进程创建 | bash 工具每次调用 | 受控，进程有超时 |
| 持久化数据 | Memory 写入 | 使用独立测试 session，不碰生产 MEMORY.md |
| 真实外部服务 | 无 | 所有测试本地 |

**结论**：隔离通道充分。关键控制：所有文件写入限 `temp/bench/{id}/`；Memory 测试用独立 session 且不写生产 MEMORY.md；BASE-08 预期拒绝。

## 3. 37 案例风险分类

### SAFE（可直接执行，14）

| ID | 操作 | 安全依据 |
|----|------|----------|
| BASE-01 | 读临时文件 | 只读 |
| BASE-03 | 创建 2 个临时文件 | 写 temp/bench/ |
| BASE-04 | 读+整理 JSON | 只读+写 temp |
| BASE-05 | 运行 exit 1 | 本地进程，无副作用 |
| BASE-06 | 读不存在路径 | 只读，预期 ENOENT |
| BASE-07 | 创建 3 个临时文件 | 写 temp/bench/ |
| BASE-08 | 尝试删 System32 | **预期拒绝**——拒绝=安全通过 |
| MULTI-01 | 3 步文件操作 | 写 temp/bench/ |
| MULTI-03 | 条件分支文件操作 | 写 temp/bench/ |
| MULTI-05 | 创建 A/B/C 文件 | 写 temp/bench/ |
| FAULT-03 | 批量创建（1 个故意失败） | 写 temp/bench/，1 个路径非法 |
| FAULT-04 | 验证文件存在性 | 只读验证 |
| FAULT-05 | 复用 Immune C2 E2E | 已有隔离脚本 |
| LONG-03 | 同任务 3 次执行 | 写 temp/bench/ |

### GUARDED（需保护条件，18）

保护条件：① 工作目录限 temp/bench/ ② 不碰生产数据 ③ 有超时 ④ Memory 测试用独立 session

| ID | 操作 | 保护条件 |
|----|------|----------|
| BASE-02 | 写 hello.txt | ① 写 temp/bench/ |
| MULTI-02 | 写+验证+修复 | ① 写 temp/bench/ |
| MULTI-04 | 尝试写只读目录 | ① 目录预置只读于 temp/bench/ |
| MULTI-06 | 连接 localhost:1 | ③ 有 bash 超时；仅 loopback |
| MEM-01 | 同会话记忆写读 | ④ 独立 session |
| MEM-02 | 跨会话记忆 | ④ 独立 session |
| MEM-03 | 相似记忆区分 | ④ 预写测试记忆到独立位置 |
| MEM-04 | 冲突更新 | ④ 独立 session |
| MEM-05 | 抗干扰 | ④ 预写无关记忆 |
| MEM-06 | 记忆使用 | ④ 预写偏好记忆 |
| XSESS-01 | 会话恢复 | ④ 独立 session + temp/bench/ |
| XSESS-02 | 指令延续 | ④ 独立 session |
| XSESS-03 | 避免重复错误 | ④ 独立 session |
| XSESS-04 | 记忆过期 | ④ 预写带旧时间戳记忆 |
| AGENT-01 | spawn 子代理 | ① 子代理写 temp/bench/ |
| AGENT-02 | 子代理失败 | ① 子代理在 temp/bench/ |
| AGENT-03 | 并行子代理 | ① 写不同 temp 文件 |
| AGENT-04 | 信息隔离 | ① 只读测试文件 |

### BLOCKED（当前不执行，5）

| ID | 原因 | 说明 |
|----|------|------|
| FAULT-01 | 工具失败注入需生产代码改动 | 需在工具层注入故障——超出只读基线范围 |
| FAULT-02 | sleep 120 挂起测试 | bash 2min 默认超时刚好边界；结果不可靠且浪费时间 |
| LONG-01 | 10 步长任务 | 消耗大量 token/时间；需单独授权预算 |
| LONG-02 | 触发上下文压缩 | 需构造超长对话触发 compact——不可控且影响其他测试 |
| LONG-04 | 8 步任务中断恢复 | 同 LONG-01；且需跨 session 状态构造 |

**BLOCKED 不执行**——待后续授权或简化后纳入。

## 4. 执行许可汇总

| 类别 | 数量 | 许可 |
|------|------|------|
| SAFE | 14 | ✅ 直接执行 |
| GUARDED | 18 | ✅ 满足保护条件后执行 |
| BLOCKED | 5 | ❌ 本轮不执行 |
| **合计** | **37** | |

## 5. 验收自检

- [x] 37 案例均有风险分类
- [x] 所有执行案例有安全依据
- [x] BLOCKED 案例不执行（5 个已标注）
- [x] 测试环境与配置可复现（§1 锚点）

---

## 6. 执行范围决定

本轮实际执行：**SAFE 14 + GUARDED 18 = 32 案例**。BLOCKED 5 个不执行。

GUARDED 的保护条件在执行时逐案落实：临时目录创建、独立 session、超时设置。
