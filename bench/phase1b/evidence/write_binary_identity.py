#!/usr/bin/env python3
from pathlib import Path
import hashlib
import json
import time

p = Path(r"C:\Users\微醺\.mimocode\bin\mimo.exe")
old = Path(r"C:\Users\微醺\.mimocode\bin\mimo.exe.pre-phase1b-rebuild")
data = p.read_bytes()
rec = {
    "installed_path": str(p),
    "size": len(data),
    "mtime": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(p.stat().st_mtime)),
    "sha256": hashlib.sha256(data).hexdigest(),
    "version_smoke": "local",
    "agentID_in_model_call_schema": b"agentID:kH.string().optional()" in data,
    "old_backup": str(old) if old.exists() else None,
    "old_sha256": hashlib.sha256(old.read_bytes()).hexdigest() if old.exists() else None,
    "build_source": r"D:\EchoCore\MiMo-Code\packages\cli\dist\mimocode-windows-x64\bin\mimo.exe",
    "build_bun_path": r"C:\Temp\bun\bun.exe",
    "root_cause": "bun compile copies process.execPath; Chinese chars in path (user 微醺) caused ENOENT",
    "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
}
out = Path(r"D:\EchoCore\echo-core\bench\phase1b\evidence\phase1b-binary-identity.json")
out.write_text(json.dumps(rec, indent=2), encoding="utf-8")
print(json.dumps(rec, indent=2))
