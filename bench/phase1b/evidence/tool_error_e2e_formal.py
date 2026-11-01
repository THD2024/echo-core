#!/usr/bin/env python3
"""Phase1B-1a formal-install E2E: C4_normal + C2_bad_params on installed binary.

Dist-only evidence lives in tool-error-e2e\ (do not overwrite).
This script targets the formal install ~/.mimocode/bin/mimo.exe (= dc28dff1)
and writes to tool-error-e2e-formal\.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"
# Formal install (Phase1B-1a): dc28dff1 — NOT the dist path.
MIMO = Path(r"C:\Users\微醺\.mimocode\bin\mimo.exe")
OUT = Path(r"D:\EchoCore\echo-core\bench\phase1b\evidence\tool-error-e2e-formal")
OUT.mkdir(parents=True, exist_ok=True)
EXPECTED_SHA256 = "dc28dff15cdda164eedc4c935563001231a13ba4179821dc25db2c4408949eaa"


def stats_len() -> int:
    return sum(1 for L in STATS.open(encoding="utf-8") if L.strip())


def load_since(n: int) -> list[dict]:
    events = []
    for i, line in enumerate(STATS.open(encoding="utf-8")):
        if i < n:
            continue
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return events


def brief(e: dict) -> dict:
    keys = (
        "t", "ev", "sid", "tid", "agent", "tool", "st", "kind",
        "error_class", "error_stage", "error_name", "severity",
        "recoverability", "diagnosis_status", "error_source",
        "tin", "tout", "model", "cid", "name", "msg",
    )
    return {k: e.get(k) for k in keys if k in e}


# Only the two cases required by T1.4.
CASES = [
    {
        "id": "C4_normal",
        "prompt": (
            "Call the read tool with path=D:\\EchoCore\\echo-core\\bench\\phase1b\\serial_cost.py "
            "and limit=5. Then reply with one line: CASE_C4_DONE"
        ),
        "timeout": 120,
    },
    {
        "id": "C2_bad_params",
        "prompt": (
            "Call the read tool with INVALID arguments: set path to the number 12345 "
            "(wrong type) or omit required fields entirely. Force the invalid call. "
            "After the failure, reply with one line: CASE_C2_DONE"
        ),
        "timeout": 120,
    },
]


def run_case(case: dict) -> dict:
    line0 = stats_len()
    t0 = time.time()
    proc = subprocess.run(
        [str(MIMO), "run", "--dangerously-skip-permissions", case["prompt"]],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=case["timeout"],
    )
    duration = time.time() - t0
    events = load_since(line0)
    tools = [e for e in events if e.get("ev") == "tool"]
    errors = [e for e in events if e.get("ev") == "error"]
    models = [e for e in events if e.get("ev") == "model"]
    rec = {
        "case_id": case["id"],
        "binary_path": str(MIMO),
        "binary_sha256": hashlib.sha256(MIMO.read_bytes()).hexdigest(),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(t0)),
        "duration_s": round(duration, 3),
        "exit_code": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-800:],
        "stderr_tail": (proc.stderr or "")[-800:],
        "window_event_count": len(events),
        "tools": [brief(e) for e in tools],
        "errors": [brief(e) for e in errors],
        "models": [brief(e) for e in models],
        "all_events": [
            brief(e)
            for e in events
            if e.get("ev") in ("tool", "error", "model", "slice_pre", "slice")
        ],
    }
    (OUT / f"{case['id']}.json").write_text(
        json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"=== {case['id']} exit={proc.returncode} "
        f"tools={len(tools)} errors={len(errors)} ==="
    )
    for e in tools:
        print("  tool", json.dumps(brief(e), ensure_ascii=False)[:300])
    for e in errors:
        print("  error", json.dumps(brief(e), ensure_ascii=False)[:300])
    return rec


def main() -> None:
    actual_sha = hashlib.sha256(MIMO.read_bytes()).hexdigest()
    if actual_sha != EXPECTED_SHA256:
        print(f"ABORT: formal binary hash mismatch: {actual_sha}")
        return
    print(f"Formal binary OK: {MIMO} sha256={actual_sha[:16]}…")

    results = []
    for case in CASES:
        try:
            results.append(run_case(case))
        except subprocess.TimeoutExpired:
            results.append({"case_id": case["id"], "error": "timeout"})
            print(f"=== {case['id']} TIMEOUT ===")
        time.sleep(1)

    summary = {
        "binary_path": str(MIMO),
        "binary_sha256": actual_sha,
        "binary_note": "formal install ~/.mimocode/bin/mimo.exe (Phase1B-1a); dist evidence kept in tool-error-e2e\\",
        "cases": [
            {
                "case_id": r.get("case_id"),
                "exit_code": r.get("exit_code"),
                "tools": r.get("tools", []),
                "errors": r.get("errors", []),
                "duration_s": r.get("duration_s"),
                "error": r.get("error"),
            }
            for r in results
        ],
    }
    (OUT / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
