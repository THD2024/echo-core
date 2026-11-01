#!/usr/bin/env python3
"""Setup isolated workspaces for each baseline run + sha256 snapshot of originals."""
from __future__ import annotations
import hashlib, json, shutil, time
from pathlib import Path

BENCH = Path(r"D:\EchoCore\echo-core\bench")
ROOT = BENCH / "phase1-baseline"
WS = ROOT / "workspaces"
SNAP = ROOT / "evidence" / "original-fixtures"
SNAP.mkdir(parents=True, exist_ok=True)
WS.mkdir(parents=True, exist_ok=True)

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def snapshot_repo(name: str) -> list[dict]:
    src = BENCH / name
    dst = SNAP / name
    if not dst.exists():
        shutil.copytree(src, dst)
    files = []
    for p in sorted(src.rglob("*")):
        if p.is_file():
            rel = str(p.relative_to(src))
            files.append({"path": rel, "sha256": sha256(p), "bytes": p.stat().st_size})
    return files

def fresh_ws(name: str, src_name: str) -> Path:
    dst = WS / name
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(BENCH / src_name, dst)
    return dst

def main():
    snaps = {}
    for r in ["repo-b1", "repo-b2", "repo-b3", "repo-b4"]:
        snaps[r] = snapshot_repo(r)
    (SNAP / "manifest.json").write_text(
        json.dumps({"frozen_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "repos": snaps}, indent=2),
        encoding="utf-8",
    )
    # B1 x3
    for i in (1, 2, 3):
        fresh_ws(f"b1-run{i}", "repo-b1")
    # B2 x3
    for i in (1, 2, 3):
        fresh_ws(f"b2-run{i}", "repo-b2")
    # B3 x3
    for i in (1, 2, 3):
        fresh_ws(f"b3-run{i}", "repo-b3")
    # B4 x3
    for i in (1, 2, 3):
        fresh_ws(f"b4-run{i}", "repo-b4")
    # B5 x3 (share b1 layout but isolated)
    for i, k in enumerate(["a", "b", "c"], 1):
        fresh_ws(f"b5{k}-run{i}", "repo-b1")
    # B6 x3 pairs (R1 mutates; R2 continues on same ws after R1)
    for i in (1, 2, 3):
        fresh_ws(f"b6-run{i}", "repo-b3")
    print(json.dumps({"workspaces": sorted(p.name for p in WS.iterdir() if p.is_dir()),
                      "snapshots": {k: len(v) for k, v in snaps.items()}}, indent=2))

if __name__ == "__main__":
    main()
