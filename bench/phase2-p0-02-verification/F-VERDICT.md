# F · 验证结论

任务编号：EC-PHASE2-P0-02-V  
日期：2026-10-31

---

## 验收标准自检

| # | 标准 | 结果 | 证据 |
|---|------|------|------|
| 1 | 正式二进制身份可追溯 | ✅ | A（SHA256 `bb4c2e12…`，version `local`） |
| 2 | exit 0 被记录为 success | ✅ | B/C（L2_bash_exit0: st=success, 0 errors） |
| 3 | exit 非零被记录为 error | ✅ | B/C（L2_bash_exit1: st=error, 1 error） |
| 4 | 七个 diagnostic 字段正确持久化 | ✅ | C（7/7 字段） |
| 5 | CID 关联正确 | ✅ | C（tool cid = error cid） |
| 6 | 原始 stats.jsonl 证据完整 | ✅ | C + evidence/*.json |
| 7 | Immune V1 冻结文件 6/6 MATCH | ✅ | E |

**7/7 满足。验证任务正式关闭。**

## 结论

**bash exit≠0 修复（a5d7813）在正式二进制（bb4c2e12）上真实生效。** Immune 统计链路正确记录失败事件，7 字段诊断持久化，CID 关联正确，V1 冻结边界完整。

## 遗留

- 当前 TUI 进程（PID 29872）仍持有旧二进制文件锁——下次重启后新二进制生效
- `ev:boot`（C1 启动自检）待下次 TUI 重启后确认落账
- 旧 aside 文件 `mimo.exe.running-aside-20261031_194832` 可在确认新二进制稳定后清理
