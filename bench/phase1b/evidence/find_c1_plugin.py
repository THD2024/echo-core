#!/usr/bin/env python3
import os
from pathlib import Path

for root, dirs, files in os.walk(r"D:\EchoCore"):
    # skip node_modules for speed
    dirs[:] = [d for d in dirs if d != "node_modules"]
    for f in files:
        if f.endswith((".ts", ".js")):
            path = os.path.join(root, f)
            try:
                content = Path(path).read_text(encoding="utf-8", errors="replace")
                if "error_class" in content and "tool_param" in content:
                    print(path)
            except Exception:
                pass
