# C · stats.jsonl 原始证据

任务编号：EC-PHASE2-P0-02-V  
日期：2026-10-31  
账本：`C:\Users\<user>\.config\mimocode\context-gate\stats.jsonl`

---

## L2_bash_exit1 原始记录（ev:tool + ev:error）

### ev:tool（st=error）

```json
{"t":1793447952054,"ev":"tool","sid":"ses_ffe5e6e2c1297ffeWvKg0mdyGY","tid":null,"agent":"main","tool":"bash","st":"error","cid":"call_96de226e506d44f490c29e83"}
```

### ev:error（7 字段完整）

```json
{"t":1793447952054,"ev":"error","sid":"ses_ffe5e6e2c1297ffeWvKg0mdyGY","tid":null,"agent":"main","tool":"bash","kind":"tool","error_class":"unknown","error_stage":"execution","error_name":"Error","severity":"error","recoverability":"unknown","diagnosis_status":"classified","error_source":"tool:execute","cid":"call_96de226e506d44f490c29e83","name":"Error","msg":"tool_call error: bash"}
```

## L2_bash_exit0 原始记录（ev:tool，无 error）

```json
{"t":1793447941938,"ev":"tool","sid":"ses_ffe5e6e2c37fcffeo9VdDSG5i9","tid":null,"agent":"main","tool":"bash","st":"success","cid":"call_c205f88fd3bf45caa0aa78ee"}
```

0 条 ev:error——exit=0 正确不产生错误记录。

## CID 关联验证

| 场景 | tool cid | error cid | 关联 |
|------|----------|-----------|------|
| L2_bash_exit1 | `call_96de226e506d44f490c29e83` | `call_96de226e506d44f490c29e83` | **MATCH** |
| L2_bash_exit0 | `call_c205f88fd3bf45caa0aa78ee` | （无） | N/A（成功） |

## 七字段持久化验证

| 字段 | L2_bash_exit1 值 | 持久化 |
|------|------------------|--------|
| error_class | `unknown` | ✅ |
| error_stage | `execution` | ✅ |
| error_name | `Error` | ✅ |
| severity | `error` | ✅ |
| recoverability | `unknown` | ✅ |
| diagnosis_status | `classified` | ✅ |
| error_source | `tool:execute` | ✅ |

**7/7 字段正确持久化。**
