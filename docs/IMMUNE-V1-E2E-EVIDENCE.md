# Echo Immune System V1 — E2E 测试证据

生成时间：2026-10-31  
测试脚本：`bench/phase1b/evidence/immune-e2e-test.ts`  
运行命令：`bun run bench/phase1b/evidence/immune-e2e-test.ts`

---

## 测试类型说明

| 类型 | 说明 |
|------|------|
| **单元测试** | 直接调用 `classifyToolError()` 函数，验证分类逻辑 |
| **故障注入** | 构造特定错误对象，模拟真实错误场景 |
| **真实 E2E** | 运行 mimo 二进制，触发真实工具调用链路 |

**当前 C1-C8 测试类型**：单元测试 + 故障注入（构造错误对象调用分类函数）  
**未覆盖**：真实 Core→C1 端到端链路（需要 mimo 二进制运行）

---

## 测试统计口径

| 类别 | 通过/总数 | 说明 |
|------|----------|------|
| 异常场景 | **7/7** | C1-C4, C6-C8（C5 为控制组不计入） |
| 正常控制组 | **1/1** | C5（跳过，符合预期） |
| **总计** | **8/8** | 7 异常 + 1 控制 |

---

## C1: 未注册工具

**测试类型**：故障注入（构造 `toolRegistered: false` 选项）  
**测试输入**：
```typescript
error: new Error("Tool not found: nonexistent_tool"),
toolName: "nonexistent_tool",
options: { toolRegistered: false }
```

**原始异常**：`Error: Tool not found: nonexistent_tool`  
**Core 分类结果**：
```json
{
  "error_category": "tool_not_found",
  "error_stage": "validation",
  "error_name": "Error",
  "severity": "error",
  "recoverability": "non_recoverable",
  "diagnosis_status": "classified",
  "error_source": "ai-sdk:NoSuchTool"
}
```

**预期 vs 实际**：✅ 一致  
**C1 最终记录**：`error_class: "tool_not_found"`（通过 diagnostic 字段传递）

---

## C2: 参数校验失败

**测试类型**：故障注入（构造 `RecoverableError`）  
**测试输入**：
```typescript
error: new RecoverableError("Invalid arguments for the read tool: expected string, received undefined"),
toolName: "read"
```

**原始异常**：`RecoverableError: Invalid arguments for the read tool: expected string, received undefined`  
**Core 分类结果**：
```json
{
  "error_category": "tool_parameter",
  "error_stage": "validation",
  "error_name": "RecoverableError",
  "severity": "warning",
  "recoverability": "recoverable",
  "diagnosis_status": "classified",
  "error_source": "tool.ts:wrap"
}
```

**预期 vs 实际**：✅ 一致  
**C1 最终记录**：`error_class: "tool_parameter"`  
**历史对比**：修复前 C2 被分类为 `tool_execution`（PHASE1B-REPAIR-REPORT §7.2）

---

## C3: 工具执行失败

**测试类型**：故障注入（构造普通 `Error`）  
**测试输入**：
```typescript
error: new Error("File not found: C:\\nonexistent.txt"),
toolName: "read"
```

**原始异常**：`Error: File not found: C:\nonexistent.txt`  
**Core 分类结果**：
```json
{
  "error_category": "tool_execution",
  "error_stage": "execution",
  "error_name": "Error",
  "severity": "error",
  "recoverability": "non_recoverable",
  "diagnosis_status": "classified",
  "error_source": "tool:execute"
}
```

**预期 vs 实际**：✅ 一致  
**分类依据**：`isIdentifiableExecutionFailure()` 精确匹配 `"File not found"`  
**C1 最终记录**：`error_class: "tool_execution"`

---

## C4: 工具取消

**测试类型**：故障注入（`cancelled: true` 选项）  
**测试输入**：
```typescript
error: new Error("Tool call cancelled"),
toolName: "bash",
options: { cancelled: true }
```

**原始异常**：`Error: Tool call cancelled`  
**Core 分类结果**:
```json
{
  "error_category": "tool_cancelled",
  "error_stage": "unknown",
  "error_name": "Error",
  "severity": "info",
  "recoverability": "recoverable",
  "diagnosis_status": "classified",
  "error_source": "processor:tool-error"
}
```

**预期 vs 实际**：✅ 一致  
**C1 最终记录**：`error_class: "tool_cancelled"`  
**历史对比**：修复前取消事件不产生 error 事件

---

## C5: 正常调用（控制组）

**测试类型**：控制组（无错误）  
**测试输入**：
```typescript
error: null,
toolName: "read"
```

**结果**：SKIP（无错误可分类）  
**预期**：不产生错误诊断  
**实际**：✅ 符合预期（测试跳过）  
**C1 最终记录**：不产生 `ev:error` 事件

---

## C6: 未知错误

**测试类型**：故障注入（`RecoverableError` 但非参数错误）  
**测试输入**：
```typescript
error: new RecoverableError("Task not found: T999"),
toolName: "task"
```

**原始异常**：`RecoverableError: Task not found: T999`  
**Core 分类结果**：
```json
{
  "error_category": "unknown",
  "error_stage": "execution",
  "error_name": "RecoverableError",
  "severity": "warning",
  "recoverability": "recoverable",
  "diagnosis_status": "classified",
  "error_source": "tool.ts:wrap"
}
```

**预期 vs 实际**：✅ 一致  
**C1 最终记录**：`error_class: "unknown"`  
**历史对比**：修复前 C6 被分类为 `tool_execution`（违反"未知错误保留 unknown"原则）

---

## C7: 权限拒绝

**测试类型**：故障注入（构造 `RejectedError`）  
**测试输入**：
```typescript
error: Object.assign(new Error("Permission denied"), { name: "RejectedError" }),
toolName: "bash"
```

**原始异常**：`RejectedError: Permission denied`  
**Core 分类结果**：
```json
{
  "error_category": "permission_denied",
  "error_stage": "permission",
  "error_name": "RejectedError",
  "severity": "warning",
  "recoverability": "non_recoverable",
  "diagnosis_status": "classified",
  "error_source": "permission:check"
}
```

**预期 vs 实际**：✅ 一致  
**C1 最终记录**：`error_class: "permission_denied"`

---

## C8: 超时

**测试类型**：故障注入（构造 `TimeoutError`）  
**测试输入**：
```typescript
error: Object.assign(new Error("Operation timed out"), { name: "TimeoutError" }),
toolName: "bash"
```

**原始异常**：`TimeoutError: Operation timed out`  
**Core 分类结果**：
```json
{
  "error_category": "timeout",
  "error_stage": "execution",
  "error_name": "TimeoutError",
  "severity": "error",
  "recoverability": "recoverable",
  "diagnosis_status": "classified",
  "error_source": "executor:timeout"
}
```

**预期 vs 实际**：✅ 一致  
**C1 最终记录**：`error_class: "timeout"`

---

## 历史测试 vs 当前测试

| 项 | 历史（PHASE1B §7） | 当前（本轮） |
|----|-------------------|-------------|
| 测试时间 | 2026-10-31 13:28 | 2026-10-31（本轮） |
| 测试版本 | 修复前 | 修复后 |
| C2 分类 | `tool_execution` ❌ | `tool_parameter` ✅ |
| C6 分类 | `tool_execution` ❌ | `unknown` ✅ |
| 测试类型 | 真实 Core 调用 | 单元测试 + 故障注入 |
| 取消事件 | 无 error 事件 | `tool_cancelled` ✅ |

**注意**：历史测试为真实 Core 调用（mimo-v2.6-flash 模型），当前测试为单元测试。两者测试类型不同，不可直接比较通过率。

---

## 原始测试输出

完整输出见 `bench/phase1b/evidence/immune-e2e-test.ts` 运行结果：

```
Echo Immune System V1 · E2E Test
============================================================

C1: 未注册工具（AI SDK NoSuchToolError） ✅ PASS
C2: 参数校验失败（RecoverableError + Invalid arguments） ✅ PASS
C3: 工具执行失败（普通 Error） ✅ PASS
C4: 工具取消 ✅ PASS
C5: 正常执行（无错误）— 控制组 SKIP
C6: 未知错误（RecoverableError 但非参数错误） ✅ PASS
C7: 权限拒绝 ✅ PASS
C8: 超时 ✅ PASS

============================================================
Results: 7 passed, 0 failed, 8 total
```
