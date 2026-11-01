#!/usr/bin/env python3
"""Append a run record to raw-runs.jsonl"""
from __future__ import annotations
import json, sys, time
from pathlib import Path

OUT = Path(r"D:\EchoCore\echo-core\bench\phase1-baseline\raw-runs.jsonl")
EV = Path(r"D:\EchoCore\echo-core\bench\phase1-baseline\evidence")

def record(rec: dict):
    rec.setdefault("recorded_at", time.time())
    rec.setdefault("benchmark", "phase1-baseline")
    with open(OUT, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    # dump full record as evidence
    run_id = rec.get("run_id", "unknown")
    p = EV / "runs" / f"{run_id}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"recorded {run_id}")

if __name__ == "__main__":
    # stdin JSON
    data = json.load(sys.stdin)
    record(data)
