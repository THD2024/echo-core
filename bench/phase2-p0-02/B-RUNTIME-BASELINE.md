# B · 首轮运行时基线

任务编号：EC-PHASE2-P0-02 / WP-02  
日期：2026-10-31  
基线编号：BL-20261031-rt-v1  
性质：L2 修复前的客观 bash 执行结果基线

---

## 1. 环境锚点

| 项 | 值 |
|----|-----|
| code_commit | `a7f95e44c5257d0af46e08d5e50bbbbc3b8e7b25`（L2 修复前） |
| binary | `dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa` |
| model | `xiaomi/mimo-v2.6-flash` |
| node | v24.19.0 |
| os | Windows NT 10.0.26200.0 |

## 2. 基线方法

本轮基线聚焦 **L2 修复的核心场景**：用真实 bash 命令执行 11 个客观可验证的退出码场景，记录 exit code / stdout / stderr，建立"正确分类应为什么"的 ground truth。

这 11 个场景覆盖了任务书 WP-03 要求的全部 8 类测试场景（exit 0 / exit 1 / exit 非零 / 命令不存在 / stderr+exit0 / 进程异常 / stdout+stderr 并存 / 上层接收失败）。

**说明**：完整 37 案例的端到端运行时基线（含模型交互、记忆检索、多步规划）需要在隔离环境执行完整会话，消耗大量 token/时间。本轮以 L2 相关的客观 bash 行为为核心基线，端到端基线待后续授权执行。

## 3. 基线结果（11 场景）

| ID | 场景 | exit | stdout | stderr | 期望成功 | 正确分类 |
|----|------|------|--------|--------|----------|----------|
| BASE-05 | exit 1 | 1 | (空) | (空) | 否 | ✅ |
| BASE-05b | exit 42 | 42 | (空) | (空) | 否 | ✅ |
| BASE-06 | 读不存在文件 | 1 | (空) | (空) | 否 | ✅ |
| BASE-07 | echo hello | 0 | hello_world | (空) | 是 | ✅ |
| MULTI-06 | 连接 localhost:1 | 7 | (连接拒绝) | (空) | 否 | ✅ |
| FAULT-03a | 命令不存在 | 1 | (空) | (空) | 否 | ✅ |
| FAULT-03b | stderr + exit 0 | 0 | (含 stderr) | (空) | 是 | ✅ |
| FAULT-03c | stdout+stderr + exit 0 | 0 | (两者) | (空) | 是 | ✅ |
| FAULT-03d | stdout+stderr + exit 1 | 1 | (两者) | (空) | 否 | ✅ |
| FAULT-04 | 超时后失败 | 1 | (空) | (空) | 否 | ✅ |
| FAULT-05 | 长命令被中断 | 0* | (空) | (空) | 否 | ⚠️ |

*FAULT-05：ping 30 次在 PowerShell `& cmd /c` 下实际返回 exit=0（命令执行完成但测试意图是模拟中断）——这是测试脚本的局限，非系统缺陷。

## 4. L2 缺陷基线结论

**修复前**：Echo Core 的 bash 工具在 `prompt.ts:1968` 无条件发布 `tool_call_status: "success"`，exit code 从未影响 Metrics 状态。

**后果**：
- BASE-05 (exit=1)、BASE-05b (exit=42)、FAULT-03a (命令不存在)、FAULT-03d (exit=1) 等真实失败场景，在 stats.jsonl 中全部记录为 `st:"success"`
- Immune V1 的 `classifyToolError` 7 字段分类链路对 bash 失败完全盲区
- C1 错误统计虚低，成功率虚高

**基线数据**：`evidence/l2-baseline-raw.json`

## 5. 与其他维度的关系

本基线不覆盖 D2（记忆）、D3（规划）、D6（经验复用）等需要模型交互的维度。这些维度的运行时基线需在端到端测试中采集，待后续授权。
