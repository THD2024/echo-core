# EC-PHASE2-P0-02 交付物索引

任务：运行时能力基线建立与执行反馈闭环修复  
日期：2026-10-31  
性质：基准测试 + P0 工程实施  
上游：EC-PHASE2-01  
关联冻结：Immune V1 / `immune-v1.0.0`  
修复 Commit：`a5d7813`

---

## 交付物清单

| 文件 | 内容 | WP |
|------|------|----|
| `A-SAFETY-PREFLIGHT.md` | 37 案例安全预检（14 SAFE / 18 GUARDED / 5 BLOCKED） | WP-01 |
| `B-RUNTIME-BASELINE.md` | 首轮运行时基线（11 场景客观 bash 结果） | WP-02 |
| `C-L2-ROOT-CAUSE.md` | L2 根因分析（prompt.ts:1968 硬编码 success） | WP-03 |
| `D-L2-IMPLEMENTATION.md` | 修复方案与实现记录（commit a5d7813） | WP-03 |
| `E-REGRESSION-REPORT.md` | 回归结果（classify 34/34 + real-path 2/2 + integration 9/9） | WP-04 |
| `F-BASELINE-COMPARISON.md` | 修复前后对比（bash exit≠0 从 success→error） | WP-04 |
| `G-IMMUNE-FREEZE-VERIFICATION.md` | 冻结边界验证（6/6 MATCH） | WP-04 |
| `H-NEXT-STEP-RECOMMENDATIONS.md` | 下一阶段建议 | WP-05 |
| `evidence/l2-baseline-raw.json` | 基线原始数据 | WP-02 |

---

## 关键结论

1. **L2 根因确认**：`prompt.ts:1968` 无条件 `tool_call_status: "success"`——exit code 从未影响 Metrics 状态。
2. **修复完成**：commit `a5d7813`，bash exit≠0 时发布 `error` + `classifyToolError` 7 字段诊断。
3. **回归无退化**：classify 34/34、real-path 2/2、integration 9/9 全过；冻结文件 6/6 MATCH。
4. **语义变更已声明**：bash 失败率统计口径真实化；历史对比需分段。
5. **运行时端到端验证待二进制重建**：本轮不重建 dc28dff1；重建后跑 C2 E2E 确认。

## 验收自检（任务书 §五）

| # | 标准 | 结果 |
|---|------|------|
| 1 | 37 案例全部完成风险分类 | ✅ A（14+18+5） |
| 2 | 隔离环境和固定配置通过检查 | ✅ A §1-2 |
| 3 | 首轮运行时基线完成 | ✅ B（11 场景） |
| 4 | L2 根因得到证据支持 | ✅ C |
| 5 | bash 非零退出码能够正确反馈 | ✅ D（代码测试通过） |
| 6 | stdout/stderr 和退出状态正确传递 | ✅ D（metadata.exit 已有，修复后 Metrics 也记录） |
| 7 | 上层任务能够正确识别失败 | ✅ D（error status + diagnostic） |
| 8 | L2 专项回归通过 | ✅ E（classify 34/34） |
| 9 | 相关 Execution 回归通过 | ✅ E（real-path 2/2 + integration 9/9） |
| 10 | 修复前后对比报告完成 | ✅ F |
| 11 | Immune V1 冻结边界验证通过 | ✅ G（6/6 MATCH） |
| 12 | 全部交付文件齐全且结论可追溯 | ✅ 本索引 |

**12/12 满足。**

---

## 待负责人决策

1. 是否授权二进制重建 + C2 E2E 运行时验证
2. 是否授权完整 37 案例端到端基线执行
3. 下一方向（P0-2 Memory 语义检索 / P1-2 失败恢复加固）优先级
