#!/usr/bin/env python3
from pathlib import Path

p = Path(r"D:\EchoCore\echo-core\bench\phase1b\PHASE1B-REPAIR-REPORT.md")
lines = p.read_text(encoding="utf-8").splitlines(keepends=True)

idx_12_first = next(i for i, l in enumerate(lines) if l.startswith("## 12. 未解决问题"))
idx_11b = next(i for i, l in enumerate(lines) if l.startswith("## 11B."))
idx_12_second = None
for i, l in enumerate(lines):
    if l.startswith("## 12. 未解决问题") and i > idx_11b:
        idx_12_second = i
        break
assert idx_12_first < idx_11b < idx_12_second, (idx_12_first, idx_11b, idx_12_second)

sep_before_11b = idx_11b
while sep_before_11b > idx_12_first and lines[sep_before_11b - 1].strip() != "---":
    sep_before_11b -= 1

open_issues = lines[idx_12_first:sep_before_11b]

sep_before_12s = idx_12_second
while sep_before_12s > idx_11b and lines[sep_before_12s - 1].strip() != "---":
    sep_before_12s -= 1
section_11b = lines[idx_11b:sep_before_12s]
next_round = lines[idx_12_second:]

section_11b = [
    ("## 12. Phase 1B-1a: 参数错误分类根因调查与最小修复\n" if l.startswith("## 11B.") else l)
    for l in section_11b
]
open_issues = [
    ("## 13. 未解决问题\n" if l.startswith("## 12. 未解决问题") else l) for l in open_issues
]
next_round = [
    ("## 14. 是否建议进入下一轮\n" if l.startswith("## 12. 未解决问题") else l) for l in next_round
]

head = lines[:idx_12_first]
while head and head[-1].strip() == "":
    head.pop()
if head and head[-1].strip() == "---":
    head.pop()
while head and head[-1].strip() == "":
    head.pop()

out: list[str] = []
out.extend(head)
out.append("\n---\n\n")
out.extend(section_11b)
out.append("\n---\n\n")
out.extend(open_issues)
out.append("\n---\n\n")
out.extend(next_round)
if not out[-1].endswith("\n"):
    out[-1] += "\n"

p.write_text("".join(out), encoding="utf-8")
print("fixed")
for i, l in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
    if l.startswith("## "):
        print(f"{i}: {l}")
