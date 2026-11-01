# B · C2 E2E 结果

任务编号：EC-PHASE2-P0-02-V  
日期：2026-10-31  
二进制：`bb4c2e12b7bf7651d8ba553ef73fb076edc0550502128c04ae0bd37e2acf8ad7`  
脚本：`run_c2_e2e.py`

---

## 四场景结果

| 场景 | 进程 exit | tools | errors | 结果 |
|------|-----------|-------|--------|------|
| C4_normal | 0 | 1 (read success) | 0 | **PASS** |
| C2_bad_params | 0 | 2 (read error×2) | 2 | **PASS** |
| L2_bash_exit0 | 0 | 1 (bash success) | 0 | **PASS** |
| L2_bash_exit1 | 0 | 1 (bash **error**) | 1 | **PASS** |

## L2 修复验证（核心）

### L2_bash_exit0（exit 0 → success）

```json
{"ev":"tool","tool":"bash","st":"success","cid":"call_c205f88fd3bf45caa0aa78ee"}
```

0 errors——exit=0 正确记 success。

### L2_bash_exit1（exit 1 → error + diagnostic）

```json
{"ev":"tool","tool":"bash","st":"error","cid":"call_96de226e506d44f490c29e83"}
```

1 error（7 字段完整）：

```json
{
  "error_class": "unknown",
  "error_stage": "execution",
  "error_name": "Error",
  "severity": "error",
  "recoverability": "unknown",
  "diagnosis_status": "classified",
  "error_source": "tool:execute",
  "cid": "call_96de226e506d44f490c29e83"
}
```

**L2 修复在正式二进制上验证成功。**

## C4/C2 回归（与 Phase1B-1a 基线一致）

- C4_normal：read success，0 errors——与原基线一致
- C2_bad_params：2 errors（`tool_execution` + `tool_parameter`）——与原基线一致

## 原始证据

- `L2_bash_exit0.json`
- `L2_bash_exit1.json`
- `C4_normal.json`
- `C2_bad_params.json`
- `summary.json`
