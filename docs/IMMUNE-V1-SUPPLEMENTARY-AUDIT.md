# Echo Immune System V1 — 补充审查报告

生成时间：2026-10-31  
审查范围：源码核查、DiagnosticInfo Schema、分类逻辑、诊断字段有效性、敏感信息过滤  
状态：已完成

---

## 1. 源码核查结果

### 1.1 DiagnosticInfo 真实 Schema（唯一定义）

**位置**：`packages/cli/src/metrics/event.ts:47-56`

```typescript
export const DiagnosticInfo = z.object({
  error_category: ErrorCategory.optional(),
  error_stage: ErrorStage.optional(),
  error_name: z.string().optional(),
  severity: z.enum(["info", "warning", "error", "critical"]).optional(),
  recoverability: Recoverability.optional(),
  diagnosis_status: DiagnosisStatus.optional(),
  error_source: z.string().optional(),
})
```

**全部合法枚举值**：

| 字段 | 合法值 | 必填/可选 |
|------|--------|----------|
| `error_category` | `tool_not_found`, `tool_parameter`, `tool_execution`, `tool_cancelled`, `model_error`, `permission_denied`, `timeout`, `unknown` | 可选 |
| `error_stage` | `validation`, `execution`, `permission`, `model`, `transport`, `unknown` | 可选 |
| `error_name` | 任意字符串（原始错误类名） | 可选 |
| `severity` | `info`, `warning`, `error`, `critical` | 可选 |
| `recoverability` | `recoverable`, `non_recoverable`, `unknown` | 可选 |
| `diagnosis_status` | `detected`, `classified`, `investigated`, `verified`, `unresolved` | 可选 |
| `error_source` | 任意字符串（来源组件标识） | 可选 |

**字段缺失规则**：
- 所有字段均为 `optional()`，缺失时 zod 解析为 `undefined`
- C1 消费时对缺失字段使用 `?? null` 填充
- `classifyToolError` 函数始终返回全部 7 个字段（生产路径不缺失）
- 缺失场景仅出现在：旧二进制发布的事件（无 `diagnostic` 字段）、非工具错误事件

### 1.2 Schema 一致性核查

| 位置 | error_category 枚举 | 状态 |
|------|---------------------|------|
| `event.ts` 源码 | 8 个值（含 `model_error`, `permission_denied`, `timeout`） | ✅ 唯一真实定义 |
| `classify.ts` 使用 | 6 个值（不使用 `model_error`） | ✅ 合理子集 |
| 设计文档 §3.1 | 8 个值 | ✅ 一致 |
| 实施报告 §10.2 | 5 个值（缺 `model_error`, `permission_denied`, `timeout`） | ❌ **不一致，需修正** |
| 测试 C7/C8 | 使用 `permission_denied`, `timeout` | ✅ 与源码一致 |

**结论**：实施报告 §10.2 枚举不完整，已修正。

### 1.3 诊断维度独立性

| 维度 | 含义 | 独立性 |
|------|------|--------|
| `error_category` | 错误性质 | 不从 `error_stage` 推导 |
| `error_stage` | 发生阶段 | 不从 `error_category` 推导 |
| `recoverability` | 恢复能力 | 不从 `error_category` 推导 |
| `diagnosis_status` | 诊断成熟度 | `classified` ≠ `investigated` ≠ `verified` |

**核查结果**：`classifyToolError` 中四个维度独立赋值，无交叉推导。

---

## 2. 已确认问题及处理

### 2.1 P0：C6 未知错误分类错误

**问题**：`classify.ts` 将无法识别的错误默认归为 `tool_execution`，违反"未知错误必须保留为 unknown"原则。

**根因**：
- 第 59 行：`RecoverableError` 非参数错误时 → `tool_execution`（应为 `unknown`）
- 第 110 行：fallback 默认 → `tool_execution`（应为 `unknown`）

**修复**：
- `RecoverableError` 非参数错误 → `error_category: "unknown"`, `error_stage: "execution"`
- fallback → `error_category: "unknown"`, `error_stage: "execution"`
- 新增 `isIdentifiableExecutionFailure()`：仅精确匹配明确的执行失败模式（`File not found`, `ENOENT`, `ECONNREFUSED` 等）才归为 `tool_execution`

**修改文件**：`packages/cli/src/metrics/classify.ts`

**修改前后对比**：

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| C6: RecoverableError("Task not found") | `tool_execution` | `unknown` |
| C3: Error("File not found") | `tool_execution` | `tool_execution`（通过 `isIdentifiableExecutionFailure`） |
| 未知 Error("something broke") | `tool_execution` | `unknown` |

### 2.2 P0：实施报告枚举不完整

**问题**：§10.2 只列 5 个 `error_category`，源码有 8 个。

**修复**：已修正报告枚举列表。

### 2.3 P1：测试统计口径歧义

**问题**：报告写 "7/7 通过"，未区分异常场景和控制组。

**修复**：明确统计口径：
- 异常场景：7/7 通过（C1-C4, C6-C8）
- 正常控制组：1/1 通过（C5 跳过，符合预期）
- 总场景：8/8（7 异常 + 1 控制）

---

## 3. 诊断字段有效性核查

### 3.1 字段产生逻辑

| 字段 | 产生方式 | 判断依据 | 状态 |
|------|---------|---------|------|
| `error_category` | `classifyToolError` 分类 | error_name + message 模式匹配 | ✅ 真实计算 |
| `error_stage` | `classifyToolError` 分类 | 与 error_category 关联赋值 | ✅ 真实计算 |
| `error_name` | `getErrorName(error)` | `error.name` 属性 | ✅ 真实读取 |
| `severity` | `classifyToolError` 分类 | 与 error_category 关联赋值 | ✅ 真实计算 |
| `recoverability` | `getRecoverability(error)` | `isRecoverableError(error)` | ✅ 真实计算 |
| `diagnosis_status` | 固定值 `"classified"` | V1 阶段始终为 classified | ⚠️ 静态赋值（设计如此） |
| `error_source` | `classifyToolError` 分类 | 与 error_category 关联赋值 | ✅ 真实计算 |

### 3.2 未知情况处理

- 无法识别的错误 → `error_category: "unknown"` ✅
- 无法确定恢复能力 → `recoverability: "unknown"` ✅（当前 `getRecoverability` 只返回 `recoverable`/`non_recoverable`，未返回 `unknown`——**限制**，见 §4）
- `diagnosis_status` 始终为 `"classified"`——V1 阶段设计如此，不宣称 `investigated` 或 `verified`

### 3.3 Core → C1 传递完整性

**传递链路**：
```
classifyToolError() → DiagnosticInfo
  → processor.ts: bus.publish(Metrics.ToolCall, { diagnostic })
    → C1: p.diagnostic → logStats({ error_class: d.error_category, ... })
```

**核查结果**：
- `diagnostic` 字段通过 `Metrics.ToolCall` 事件传递 ✅
- C1 直接消费 `p.diagnostic`，不重新猜测 ✅
- C1 对缺失 `diagnostic` 有 legacy fallback（旧二进制兼容）✅
- 7 个字段全部传递到 C1 账本 ✅

### 3.4 敏感信息过滤

| 检查项 | 结果 |
|--------|------|
| 错误消息原文是否进入 C1 账本 | ❌ 不进入（`msg` 只含 `tool_call failed: ${tool_name}`） |
| `error_name` 是否含敏感内容 | ❌ 只含错误类名（如 `RecoverableError`） |
| `input_bytes` 是否含输入内容 | ❌ 是数字（如 `74`），不是内容 |
| 账本中敏感模式扫描 | 0 命中（password/secret/key/token/credential/api_key） |

---

## 4. 未解决问题和限制

1. **`recoverability` 未返回 `unknown`**：`getRecoverability()` 只返回 `recoverable`/`non_recoverable`，对完全未知的错误类型应返回 `unknown`。当前实现中，非 RecoverableError 一律返回 `non_recoverable`，这不准确。
2. **`diagnosis_status` 始终为 `classified`**：V1 阶段设计如此，但意味着没有路径到达 `investigated` 或 `verified`。
3. **`isIdentifiableExecutionFailure` 覆盖有限**：仅匹配文件/网络/权限/命令失败模式，其他执行失败会落入 `unknown`。
4. **测试为单元测试**：C1-C8 测试的是 `classifyToolError` 函数，不是真实 Core→C1 端到端链路。真实 E2E 需要运行 mimo 二进制。
5. **`model_error` 类别未实现**：Schema 定义了但 `classifyToolError` 不产生（模型错误走 `session.error` 路径，不走 tool-error handler）。

---

## 5. 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `packages/cli/src/metrics/classify.ts` | C6 分类修正；新增 `isIdentifiableExecutionFailure()` |
| `bench/phase1b/evidence/immune-e2e-test.ts` | C6 预期改为 `unknown`；C5 标记为控制组 |

**回归测试**：7/7 异常场景通过 + 1/1 控制组通过
