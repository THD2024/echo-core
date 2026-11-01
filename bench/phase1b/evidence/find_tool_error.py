#!/usr/bin/env python3
from pathlib import Path

lines = Path(r"D:\EchoCore\MiMo-Code\packages\cli\node_modules\ai\dist\index.js").read_text(
    encoding="utf-8", errors="replace"
).splitlines()

for i, line in enumerate(lines):
    if 'type: "tool-error"' in line:
        start = max(0, i - 25)
        end = min(len(lines), i + 15)
        print(f"=== Line {i+1} ===")
        for j in range(start, end):
            print(f"{j+1}: {lines[j]}")
        print()
