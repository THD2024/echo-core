import hashlib
import subprocess
from pathlib import Path

EXPECTED = "dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa"
INSTALLED = Path.home() / ".mimocode" / "bin" / "mimo.exe"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def list_mimo_processes() -> list[dict]:
    ps = (
        "Get-Process mimo -ErrorAction SilentlyContinue | "
        "Select-Object Id,Path,StartTime | ConvertTo-Json -Compress"
    )
    r = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    raw = (r.stdout or "").strip()
    if not raw:
        return []
    import json

    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    return data


def main() -> None:
    installed_sha = sha256(INSTALLED) if INSTALLED.exists() else None
    procs = list_mimo_processes()
    print(f"installed_path={INSTALLED}")
    print(f"installed_sha256={installed_sha}")
    print(f"expected_sha256={EXPECTED}")
    print(f"installed_match={installed_sha == EXPECTED}")
    print(f"process_count={len(procs)}")
    for p in procs:
        path = p.get("Path")
        pid = p.get("Id")
        start = p.get("StartTime")
        if path and Path(path).exists():
            h = sha256(Path(path))
            match = h == EXPECTED
        else:
            h = "unreadable"
            match = False
        print(f"pid={pid}")
        print(f"  path={path}")
        print(f"  start={start}")
        print(f"  sha256={h}")
        print(f"  match_expected={match}")


if __name__ == "__main__":
    main()
