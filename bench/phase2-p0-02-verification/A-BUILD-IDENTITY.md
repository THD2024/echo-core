# A · 构建身份

任务编号：EC-PHASE2-P0-02-V  
日期：2026-10-31  
修复 Commit：`a5d7813`

---

## 构建信息

| 项 | 值 |
|----|-----|
| 构建命令 | `C:\Temp\bun\bun.exe run script/build.ts --single`（ASCII 路径规避 ENOENT） |
| 构建环境变量 | `MIMOCODE_CHANNEL=local` `MIMOCODE_VERSION=local` |
| 二进制路径 | `C:\Users\微醺\.mimocode\bin\mimo.exe` |
| SHA256 | `bb4c2e12b7bf7651d8ba553ef73fb076edc0550502128c04ae0bd37e2acf8ad7` |
| SIZE | 136009728 bytes |
| `--version` 输出 | `local` |
| Smoke test | PASS（构建时自动执行） |

## 与旧二进制对比

| 项 | 旧 | 新 |
|----|-----|-----|
| SHA256 | `dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa` | `bb4c2e12b7bf7651d8ba553ef73fb076edc0550502128c04ae0bd37e2acf8ad7` |
| `--version` | `0.0.0-main-496bb8c` | `local` |
| 自动更新风险 | 有（channel=main） | **无**（channel=local） |
| L2 修复 | 无 | **有**（a5d7813） |

## 旧二进制备份

| 文件 | SHA256 |
|------|--------|
| `bin\backups\mimo.exe.20261031_170829.801c91d0` | `801c91d0…` |
| `bin\mimo.exe.running-aside-20261031_194832` | `dc28dff1…`（替换前 aside） |

## 进程身份核验

CIM 查询显示两个 mimo 进程（PID 27456 / 29872）的 `ExecutablePath` SHA256 均为 `bb4c2e12…`——这是 CIM 重新解析磁盘文件的已知陷阱。实际进程创建时间（10:17:15 / 19:42:48）早于新二进制安装时间（19:48:32），证明它们仍持有旧二进制的文件锁。新二进制在下次 TUI 重启后生效。
