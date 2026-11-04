# EC-PHASE2-P0-02-V 综合报告

正式二进制与 C2 运行时验证 + Bun 构建环境永久修复

日期：2026-10-31  
关联修复 Commit：`a5d7813`（bash L2 exit≠0）  
验证二进制：`bb4c2e12b7bf7651d8ba553ef73fb076edc0550502128c04ae0bd37e2acf8ad7`

---

## 一、任务目标

1. 证明 bash exit≠0 修复（a5d7813）在正式二进制中真实生效。
2. 证明 Immune 统计链路正确记录失败事件（状态、CID、7 诊断字段）。
3. 确认 Immune V1 冻结文件 6/6 MATCH。
4. 顺带解决构建过程中的 Bun ENOENT 问题（永久修复，非绕过）。

---

## 二、验收标准结果

| # | 标准 | 结果 | 证据 |
|---|------|------|------|
| 1 | 正式二进制身份可追溯 | ✅ | SHA256 `bb4c2e12…`，version `local` |
| 2 | exit 0 被记录为 success | ✅ | L2_bash_exit0: st=success, 0 errors |
| 3 | exit 非零被记录为 error | ✅ | L2_bash_exit1: st=error, 1 error |
| 4 | 七个 diagnostic 字段正确持久化 | ✅ | 7/7 字段 |
| 5 | CID 关联正确 | ✅ | tool cid = error cid |
| 6 | 原始 stats.jsonl 证据完整 | ✅ | evidence/*.json + stats.jsonl 原文 |
| 7 | Immune V1 冻结文件 6/6 MATCH | ✅ | E2E 后逐文件哈希比对 |

**7/7 满足。**

---

## 三、构建身份

| 项 | 值 |
|----|-----|
| 构建命令 | `C:\bun\bun.exe run script/build.ts --single`（修复后标准路径） |
| 环境变量 | `MIMOCODE_CHANNEL=local` `MIMOCODE_VERSION=local` |
| 二进制路径 | `C:\Users\<user>\.mimocode\bin\mimo.exe` |
| SHA256 | `bb4c2e12b7bf7651d8ba553ef73fb076edc0550502128c04ae0bd37e2acf8ad7` |
| SIZE | 136009728 bytes |
| `--version` | `local` |
| Smoke test | PASS |

与旧二进制对比：

| 项 | 旧 `dc28dff1…` | 新 `bb4c2e12…` |
|----|----------------|----------------|
| `--version` | `0.0.0-main-496bb8c` | `local` |
| 自动更新风险 | 有（channel=main） | **无**（channel=local） |
| L2 修复 | 无 | **有**（a5d7813） |

旧二进制 aside 备份：`bin\mimo.exe.running-aside-20261031_194832`

---

## 四、C2 E2E 结果

脚本：`run_c2_e2e.py`，隔离环境执行，4 场景全部通过。

| 场景 | tools | errors | 结果 |
|------|-------|--------|------|
| C4_normal（read success） | 1 | 0 | **PASS** |
| C2_bad_params（read error×2） | 2 | 2 | **PASS** |
| L2_bash_exit0 | 1 (bash success) | 0 | **PASS** |
| L2_bash_exit1 | 1 (bash **error**) | 1 | **PASS** |

### L2 核心验证

**exit 0 → success**（无 error 记录）：
```json
{"ev":"tool","tool":"bash","st":"success","cid":"call_c205f88fd3bf45caa0aa78ee"}
```

**exit 1 → error + 7 字段 diagnostic**：
```json
{"ev":"tool","tool":"bash","st":"error","cid":"call_96de226e506d44f490c29e83"}
```
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

### 诊断链路（修复后）

```
bash exit=1
  → bash.ts 返回 ToolResult（metadata.exit=1）
  → prompt.ts 检测 isBashFailure=true
  → publish Metrics.ToolCall status="error" + diagnostic=classifyToolError(...)
  → C1 订阅 → 记 ev:tool st=error + ev:error 7字段
  → stats.jsonl 落盘
```

分类说明：bash exit≠0 归为 `unknown`（非 `tool_execution`）——普通 Error 对象的可恢复性无法从 exit code 通用推断，这是正确的语义。更精确分类属 V2 范围。

---

## 五、stats.jsonl 原始证据

账本：`C:\Users\<user>\.config\mimocode\context-gate\stats.jsonl`

L2_bash_exit1 的 ev:tool + ev:error 原文（cid 一致）：
```
{"t":1793447952054,"ev":"tool","sid":"ses_ffe5e6e2c1297ffeWvKg0mdyGY","tid":null,"agent":"main","tool":"bash","st":"error","cid":"call_96de226e506d44f490c29e83"}
{"t":1793447952054,"ev":"error","sid":"ses_ffe5e6e2c1297ffeWvKg0mdyGY","tid":null,"agent":"main","tool":"bash","kind":"tool","error_class":"unknown","error_stage":"execution","error_name":"Error","severity":"error","recoverability":"unknown","diagnosis_status":"classified","error_source":"tool:execute","cid":"call_96de226e506d44f490c29e83","name":"Error","msg":"tool_call error: bash"}
```

L2_bash_exit0 的 ev:tool（无 error 记录）：
```
{"t":1793447941938,"ev":"tool","sid":"ses_ffe5e6e2c37fcffeo9VdDSG5i9","tid":null,"agent":"main","tool":"bash","st":"success","cid":"call_c205f88fd3bf45caa0aa78ee"}
```

---

## 六、Immune V1 冻结验证

锚点：Tag `immune-v1.0.0` → Commit `0939522c515b7e1a7188bd0e9b08aa3091e45cb5`

E2E 后逐文件哈希比对：

| 文件 | 结果 |
|------|------|
| `classify.ts` | **MATCH** |
| `event.ts` | **MATCH** |
| `immune-memory.ts` | **MATCH** |
| `tolerance.ts` | **MATCH** |
| `processor.ts` | **MATCH** |
| `immune-real-path.test.ts` | **MATCH** |

**6/6 MATCH。** 重建 + E2E 全程未触碰 V1 冻结文件。诊断契约（classifyToolError 签名、DiagnosticInfo 7 字段、Metrics.ToolCall schema、C1 消费路径）均未变。

---

## 七、Bun ENOENT 永久修复

### 根因

```
npm install -g bun → bun.exe 装在中文路径（AppData\Roaming\npm\node_modules\bun\bin\）
  → bun run build:local 执行 package.json 脚本
  → 脚本内部 spawn 子进程 → cmd.exe 通过 bun.cmd 找到中文路径 bun.exe
  → bun compile 复制 process.execPath（含中文）到临时文件
  → Windows API 失败 → ENOENT
```

Bun 1.3.14 为最新版，上游未修复。`TEMP` 设 ASCII 无效——问题在源路径（`process.execPath` 本身含中文），不在目标路径。

### 修复内容

| 文件 | 操作 |
|------|------|
| `C:\bun\bun.exe` | 新建，从 npm bun 复制（hash 一致） |
| 系统 PATH | `C:\bun` 加入用户 PATH，优先于 npm |
| `bun.ps1` | 重定向到 `C:\bun\bun.exe` |
| `bun.cmd` | 重定向到 `C:\bun\bun.exe` |

### 验证

| 测试 | 结果 |
|------|------|
| `bun -e "process.execPath"` | `C:\bun\bun.exe`（ASCII）✅ |
| `Bun.build({compile:true})` | 成功 ✅ |
| `bun run build:local` | Smoke test passed: local ✅ |
| 产出 binary 哈希 | 与已安装 `bb4c2e12…` 一致（确定性）✅ |

### 注意

若将来 `npm install -g bun` 重装，npm 会覆盖 `bun.ps1` 和 `bun.cmd`——需重新应用重定向。

---

## 八、遗留事项

- 当前 TUI 进程（PID 29872）持有旧二进制文件锁——下次重启后新二进制生效
- `ev:boot`（C1 启动自检）待下次 TUI 重启后确认落账
- 旧 aside 文件可在确认新二进制稳定后清理

---

## 结论

**bash exit≠0 修复（a5d7813）在正式二进制（bb4c2e12）上真实生效。** Immune 统计链路正确记录失败事件，7 字段诊断持久化，CID 关联正确，V1 冻结边界完整。构建环境的 Bun ENOENT 问题已永久修复。
