# Echo Immune System V1 设计文档

生成时间：2026-10-31  
版本：V1（第一阶段底层免疫机制）  
状态：已完成，等待架构评审

---

## 1. 免疫系统定位

Echo Immune System 是 Echo 的基础治理能力，长期负责：

- 运行异常感知
- 错误识别与诊断
- 系统健康监测
- 异常隔离与恢复
- 故障经验积累
- 诊断规则更新与验证
- 正常行为识别与误报控制

**V1 范围**：只建设底层机制，不提前实现所有长期能力。

---

## 2. 生物机制与工程机制对应

| 生物机制 | 工程机制 | V1 实现状态 |
|---------|---------|------------|
| 先天免疫 | 快速识别常见异常模式 | ✅ `classifyToolError` 按 error_name/message 模式匹配 |
| 适应性免疫 | 针对具体异常形成更精确的识别能力 | ⏳ V2（需要免疫记忆积累） |
| 抗原呈递 | 将异常转换为结构化信息 | ✅ `DiagnosticInfo` 结构化数据 |
| 免疫记忆 | 保留经过验证的异常案例和处理经验 | ⏳ 结构已定义，存储待实现 |
| 免疫耐受 | 识别正常行为，避免误报 | ✅ `tolerance.ts` 定义原则 |
| 免疫调节 | 控制响应强度，防止局部异常演变为系统性故障 | ⏳ V2（需要响应策略） |

---

## 3. 统一诊断数据结构

### 3.1 DiagnosticInfo

```typescript
{
  // 异常类别
  error_category: "tool_not_found" | "tool_parameter" | "tool_execution" | "tool_cancelled" | "model_error" | "permission_denied" | "timeout" | "unknown"
  
  // 错误发生阶段
  error_stage: "validation" | "execution" | "permission" | "model" | "transport" | "unknown"
  
  // 原始错误类名
  error_name: string
  
  // 严重程度
  severity: "info" | "warning" | "error" | "critical"
  
  // 恢复能力（与 error_category 独立）
  recoverability: "recoverable" | "non_recoverable" | "unknown"
  
  // 诊断状态
  diagnosis_status: "detected" | "classified" | "investigated" | "verified" | "unresolved"
  
  // 错误来源组件
  error_source: string
}
```

### 3.2 设计原则

- **error_category 与 recoverability 独立**：参数错误通常是 recoverable，但执行错误也可能是 recoverable（如超时）
- **diagnosis_status 区分"发现"与"根因确认"**：`classified` 不等于 `verified`
- **所有字段 optional**：保持向后兼容

---

## 4. 五个功能环节及职责边界

### A. Sentinel（异常感知）

**职责**：收集现有运行事件  
**实现**：C1 插件的 `onEvent` handler  
**覆盖范围**：
- 工具调用（`metrics.tool_call`）✅
- 模型调用（`metrics.model_call`）✅
- 任务状态（`task.created/updated`）✅
- 执行错误（`session.error`）✅

**V1 限制**：首先打通工具调用完整链路，其余事件只调查现有接口。

### B. Recognition（识别与诊断）

**职责**：建立准确的错误分类机制  
**实现**：`classifyToolError` 函数  
**关键特性**：
- 在最接近异常发生的位置识别错误性质
- 保留原始异常信息
- 不通过工具名称猜测错误
- 不把 recoverable 直接等同于参数错误
- 无法确定时标记 unknown
- 区分异常发现、错误分类和根因确认

### C. Response（免疫响应）

**职责**：V1 只允许记录、分类、告警、提供诊断结果  
**实现**：C1 插件的 `logStats` 写入 `stats.jsonl`  
**V1 限制**：
- 不允许自动重试
- 不允许自动修改代码
- 不允许自动删除数据
- 不允许自动改变系统配置

### D. Immune Memory（免疫记忆）

**职责**：定义经验记录所需的数据结构  
**实现**：`immune-memory.ts` 定义 `ImmuneMemoryEntry`  
**V1 限制**：
- 只定义结构，不建设完整自主学习系统
- 未经验证的模型推测不得直接成为正式经验

### E. Tolerance（免疫耐受）

**职责**：建立基本的正常行为和未知行为处理原则  
**实现**：`tolerance.ts` 定义原则和基线  
**V1 原则**：
1. 正常事件不产生错误告警
2. 合法的空结果不能被默认视为故障
3. 重复事件需要有明确关联，避免重复诊断
4. 未知事件保留证据，不擅自归为已知故障
5. 不得通过屏蔽告警或放宽阈值制造健康假象

---

## 5. 当前已有能力与缺失能力

### 已有能力

| 能力 | 实现位置 | 状态 |
|------|---------|------|
| 事件采集 | C1 `onEvent` | ✅ |
| 切片追踪 | C1 `session.pre/post` | ✅ |
| tid 归因 | C1 `peekTidByAgent` | ✅ |
| 错误分类 | `classifyToolError` | ✅ 新增 |
| 结构化诊断 | `DiagnosticInfo` | ✅ 新增 |
| 耐受原则 | `tolerance.ts` | ✅ 新增 |
| 记忆结构 | `immune-memory.ts` | ✅ 新增 |

### 缺失能力（V2+）

| 能力 | 说明 |
|------|------|
| 免疫记忆存储 | SQLite/文件系统存储，经验检索 |
| 适应性免疫 | 基于历史经验的模式识别 |
| 免疫调节 | 响应强度控制策略 |
| 自动恢复 | 需要独立的安全策略和权限边界 |
| 跨事件关联 | correlation_id 跨事件链接 |

---

## 6. Core 到 C1 的完整异常传播链路

```
模型输出 tool_call
  → AI SDK 调 tool.execute(args, ctx)
    → tool.ts:110 Effect.try(parameters.parse)  [zod 校验]
    → tool.ts:117 throw RecoverableError(...)   [参数错误]
    → tool.ts:137 Effect.orDie                   [转为 defect]
  → AI SDK catch(error)
  → AI SDK emit tool-error part
    携带 { toolName, error }
  → processor.ts:646 case "tool-error"
    → classifyToolError(error, toolName)  [新增：分类]
    → bus.publish(Metrics.ToolCall, { diagnostic })  [新增：传递]
  → C1 context-gate/index.ts
    → 消费 p.diagnostic  [新增：直接使用]
    → logStats({ error_class: d.error_category, ... })
  → stats.jsonl
```

**关键改进**：
- 分类发生在最接近异常的位置（processor.ts）
- 结构化数据通过 `diagnostic` 字段传递
- C1 直接消费，不再猜测

---

## 7. E2E 测试及原始证据

### 7.1 测试用例

| 用例 | 场景 | 预期分类 | 结果 |
|------|------|---------|------|
| C1 | 未注册工具 | `tool_not_found` | ✅ |
| C2 | 参数校验失败 | `tool_parameter` | ✅ |
| C3 | 工具执行失败 | `tool_execution` | ✅ |
| C4 | 工具取消 | `tool_cancelled` | ✅ |
| C5 | 正常执行 | — | ✅ SKIP |
| C6 | 未知错误 | `tool_execution` | ✅ |
| C7 | 权限拒绝 | `permission_denied` | ✅ |
| C8 | 超时 | `timeout` | ✅ |

**结果：7/7 通过**

### 7.2 测试脚本

位置：`bench/phase1b/evidence/immune-e2e-test.ts`

### 7.3 修复前后对比

| 场景 | 修复前 | 修复后 |
|------|-------|-------|
| 参数错误 | `error_class: "tool_execution"` | `error_class: "tool_parameter"` |
| 取消事件 | 无 error 事件 | `error_class: "tool_cancelled"` |
| 恢复能力 | 未记录 | `recoverability: "recoverable"/"non_recoverable"` |
| 错误来源 | 未记录 | `error_source: "tool.ts:wrap"` 等 |

---

## 8. V1 的能力限制

1. **免疫记忆未存储**：只定义数据结构，未实现持久化
2. **无自动恢复**：V1 只记录和分类，不自动修复
3. **分类依赖 error_name/message 模式**：可能有误分类
4. **未注册工具分类依赖 AI SDK**：AI SDK 在到达 tool-error handler 前处理
5. **无跨事件关联**：correlation_id 未实现
6. **耐受原则未自动执行**：只是文档定义，未在代码中强制

---

## 9. 下一阶段建议

### V2 优先级

1. **免疫记忆存储**：实现 SQLite 存储，支持经验检索
2. **跨事件关联**：实现 correlation_id，链接同一异常的多个事件
3. **耐受原则代码化**：将 tolerance.ts 的原则转为可执行检查
4. **诊断状态追踪**：实现 detected → classified → investigated → verified 的状态机
5. **误报控制**：基于历史数据建立正常行为基线

### 长期方向

1. **适应性免疫**：基于免疫记忆的模式识别
2. **免疫调节**：响应强度控制策略
3. **自动恢复**：需要独立的安全策略和权限边界
4. **免疫耐受学习**：自动学习正常行为模式

---

## 附录：文件清单

| 文件 | 说明 |
|------|------|
| `packages/cli/src/metrics/event.ts` | DiagnosticInfo 类型定义 |
| `packages/cli/src/metrics/classify.ts` | 错误分类函数 |
| `packages/cli/src/metrics/immune-memory.ts` | 免疫记忆数据结构 |
| `packages/cli/src/metrics/tolerance.ts` | 免疫耐受原则 |
| `packages/cli/src/session/processor.ts` | tool-error handler（修改） |
| `packages/cli/src/session/prompt.ts` | cancelled case（修改） |
| `~/.config/mimocode/context-gate/index.ts` | C1 消费结构化数据（修改） |
| `bench/phase1b/evidence/immune-e2e-test.ts` | E2E 测试脚本 |
