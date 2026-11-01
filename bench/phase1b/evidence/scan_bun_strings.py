#!/usr/bin/env python3
from pathlib import Path
import re

data = Path(r"C:\Users\微醺\AppData\Roaming\npm\node_modules\bun\bin\bun.exe").read_bytes()
needle = b"failed to copy bun executable into temporary file"
i = data.find(needle)
print("idx", i)
start = max(0, i - 3000)
end = min(len(data), i + 3000)
chunk = data[start:end]
parts = re.findall(rb"[\x20-\x7e]{10,}", chunk)
for p in parts:
    s = p.decode("ascii", "ignore")
    if any(k in s.lower() for k in ("temp", "copy", "bun", "path", "file", "compile", "exe", "stdout", "gettemp", "enoent", "failed")):
        print(s)

print("--- all nearby unique longer strings ---")
for p in re.findall(rb"[\x20-\x7e]{16,}", chunk)[:80]:
    print(p.decode("ascii", "ignore")[:200])
