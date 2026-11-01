# A4 · Immune 诊断边界与未接线能力核查

任务编号：EC-PHASE2-P0-01 / WP-04
优先级：P1（先核查，不默认实施）
核查日期：2026-10-31
性质：只读核查 + 边界说明。**本工作包不产生代码变更。**

---

## 1. 核查对象与结论总表

| 对象 | 是否 V1 既定设计 | 调用入口 | 其他模块依赖 | 影响已验收功能 | 处置 |
|------|-----------------|---------|-------------|---------------|------|
| `immune-memory.ts` | **是**（V2 占位） | **无**（全仓 0 import） | 无 | 否 | **保留为 V2 扩展点，不接线** |
| `tolerance.ts` | **是**（原则代码化，V2 执行化） | **无**（`isWithinNormalBaseline` 0 调用） | 无（cron/scheduler.ts:388 的 "tolerance" 为无关同名词） | 否 | **保留为 V2 扩展点，不接线** |
| `ModelCall.diagnostic` | **是**（schema 预留） | schema 定义有（event.ts:75），**生产 publish 从不填充** | 无消费者（SDK 类型亦缺，见 WP-02） | 否（V1 验收目标为 ToolCall diagnostic） | **保留 schema 预留；是否接线属 LLM 诊断立项（§3）** |

## 2. 逐项证据

### 2.1 immune-memory.ts

- 文件性质：zod schema `ImmuneMemoryEntry`（:8）+ 接口 `ImmuneMemoryStore`（:56-65），自注 "V1 只定义"（:52-54）。**无实现类**。
- 引用扫描：`packages/` 全量 grep `immune-memory`/`ImmuneMemory` → 仅自身定义，**零生产/测试调用方**。
- 设计归属：`docs/immune-system-v1-design.md:30-32` 明确「免疫记忆 ⏳ V2（需要免疫记忆积累）」「结构已定义，存储待实现」；:219 列为 V1 已知限制；:232 将「免疫记忆存储」列入 V2 路线。
- 冻结记录归属：A-IMMUNE-V1-FREEZE-RECORD §6.3 责任边界明确「不做免疫记忆持久化」。

**判定**：未接线是 V1 既定设计，非缺陷。强行接入违反冻结规则「不将自动修复/未纳入 V1 的能力混入冻结版本」。

### 2.2 tolerance.ts

- 文件性质：`TOLERANCE_PRINCIPLES`/`NORMAL_BASELINE`/`UNKNOWN_EVENT_PRINCIPLES` 常量 + 纯函数 `isWithinNormalBaseline()`（:69-85）。
- 引用扫描：全仓零调用（cron/scheduler.ts:388 为 "legacy tolerance" 注释，语境无关）。
- 设计归属：设计文档 :33「免疫耐受 ✅ tolerance.ts 定义原则」；:234「V2：将 tolerance.ts 的原则转为可执行检查」。
- 冻结记录：§6.3「tolerance.ts 仅原则/基线定义」。

**判定**：同上，V2 扩展点。V1 的「unknown 保留」原则已由 classify.ts 的 getRecoverability 三态实现（生产路径），tolerance.ts 是其原则文档的代码化镜像，无需接线。

### 2.3 ModelCall.diagnostic

- schema：`metrics/event.ts:74-75`（ModelCall）与 :92（ToolCall）均定义 `diagnostic: DiagnosticInfo.optional()`。
- 生产填充：`processor.ts:733-744` / :1286-1290（ModelCall publish）**不带 diagnostic**；grep `diagnostic.*ModelCall` 全仓 0 生产匹配。
- 消费端：C1 `index.ts:482-498` ev:model 分支不读 diagnostic；SDK types.gen.ts 亦缺（WP-02）。
- 设计归属：设计文档 :83 仅将 model_call 列为「已接入事件」，未承诺 ModelCall 诊断字段；V1 验收目标（IMMUNE-V1-FREEZE-REPORT）为工具错误 7 字段，未含模型错误。

**判定**：schema 预留、生产空置，属设计内的前向兼容。是否接线 = 是否立项「LLM 错误进入免疫系统」（见 §3），**不属本任务书授权范围**（任务书五：仅完成现状核查、影响分析和设计建议）。

## 3. LLM 错误进入免疫系统：现状 / 影响 / 设计建议（不实施）

### 3.1 现状

- LLM/API 错误经 `session.error` 事件进 C1，落账为 `kind=llm` 粗分类（历史行为），无 7 字段结构化。
- classify.ts 决策树当前仅覆盖工具错误；无 llm_api 分支。
- L3 货币成本、N6 subscriber 缺字段为相邻基础设施项（见 A3）。

### 3.2 影响分析

- 现实故障源中 LLM 层（余额不足、限流、超时）占比高——本会话即亲历 deepseek-flash 余额不足切换。
- 缺口：无法按 error_class 聚合 LLM 故障、无法计算 LLM 错误的 recoverability、远程分析无结构化 LLM 诊断。

### 3.3 设计建议（供后续版本任务书参考）

1. classify.ts 增加 `classifyModelError`（复用三态框架）：error_class=llm_api，stage=llm，error_source=session.error。
2. processor session.error 路径注入 diagnostic（不改 ModelCall 成功路径语义）。
3. C1 ev:model error 形态或独立 ev:llm_error 消费。
4. **验收**：mock 注入余额/限流/超时 → 7 字段落账；V1 工具回归 43/43 不动。
5. 建议作为 **Immune V2 首个子任务**单独立项，不在 EC-PHASE2-P0-01 实施。

## 4. 本工作包产出

- 本边界说明（无代码变更）。
- 确认：V1 未接线三件套均为设计内预留，**禁止为「看起来完整」强行接线**（符合任务书五约束）。
- LLM 诊断建议移交 V2 立项。
