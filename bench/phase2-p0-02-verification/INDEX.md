# EC-PHASE2-P0-02-V 交付物索引

任务：正式二进制与 C2 运行时验证  
日期：2026-10-31  
性质：生产构建验证与隔离环境 E2E  
关联：EC-PHASE2-P0-02  
修复 Commit：`a5d7813`

---

## 交付物清单

| 文件 | 内容 |
|------|------|
| `A-BUILD-IDENTITY.md` | 构建身份（SHA256 `bb4c2e12…`，version `local`） |
| `B-C2-E2E-RESULTS.md` | 四场景 E2E 结果（C4/C2/L2_exit0/L2_exit1 全 PASS） |
| `C-STATS-RAW-EVIDENCE.md` | stats.jsonl 原始记录 + 7 字段 + CID 关联 |
| `D-DIAGNOSTIC-VERIFICATION.md` | 诊断链路与 V1 契约一致性验证 |
| `E-IMMUNE-FREEZE-CHECK.md` | 冻结文件 6/6 MATCH |
| `F-VERDICT.md` | 验收结论 7/7 PASS |
| `evidence/*.json` | 原始 E2E 数据 |

## 关键结论

**bash exit≠0 修复在正式二进制上真实生效。**

| 场景 | 结果 |
|------|------|
| L2_bash_exit0 | st=success, 0 errors ✅ |
| L2_bash_exit1 | st=error + 7 字段 diagnostic ✅ |
| C4_normal | read success ✅ |
| C2_bad_params | 2 errors（tool_execution + tool_parameter）✅ |

## 验收自检

| # | 标准 | 结果 |
|---|------|------|
| 1 | 正式二进制身份可追溯 | ✅ |
| 2 | exit 0 → success | ✅ |
| 3 | exit 非零 → error | ✅ |
| 4 | 7 字段正确持久化 | ✅ |
| 5 | CID 关联正确 | ✅ |
| 6 | 原始证据完整 | ✅ |
| 7 | 冻结 6/6 MATCH | ✅ |

**7/7 满足。验证任务关闭。**
