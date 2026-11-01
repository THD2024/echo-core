#!/usr/bin/env python3
"""Phase1B-1: four-case real Core tool-error classification E2E."""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"
# Phase1B-1a re-verify: use dist binary containing Immune V1 classifyToolError.
# Installed ~/.mimocode/bin/mimo.exe remains 86bad66b (held by running TUI).
MIMO = Path(r"D:\EchoCore\MiMo-Code\packages\cli\dist\mimocode-windows-x64\bin\mimo.exe")
OUT = Path(r"D:\EchoCore\echo-core\bench\phase1b\evidence\tool-error-e2e")
OUT.mkdir(parents=True, exist_ok=True)
BINARY_SHA256 = "dc28dff15cdda164"  # prefix; full hash written into summary at runtime


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
        "t",
        "ev",
        "sid",
        "tid",
        "agent",
        "tool",
        "st",
        "kind",
        "error_class",
        "error_stage",
        "error_name",
        "severity",
        "recoverability",
        "diagnosis_status",
        "error_source",
        "tin",
        "tout",
        "model",
        "cid",
        "name",
        "msg",
    )
    return {k: e.get(k) for k in keys if k in e}


CASES = [
    {
        "id": "C1_unregistered",
        "prompt": (
            "You MUST call a tool named completely_unknown_tool_zzz9 using the "
            "tool-calling interface with empty arguments {}. "
            "Do not refuse. Do not explain first. Immediately emit that tool call. "
            "After the call fails, reply with one line: CASE_C1_DONE"
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
    {
        "id": "C3_exec_fail",
        "prompt": (
            "Call the read tool with path=D:\\EchoCore\\echo-core\\bench\\phase1b\\"
            "NO_SUCH_TOOLERR_FILE.txt (valid schema, missing file). "
            "After the failure reply with one line: CASE_C3_DONE"
        ),
        "timeout": 120,
    },
    {
        "id": "C4_normal",
        "prompt": (
            "Call the read tool with path=D:\\EchoCore\\echo-core\\bench\\phase1b\\serial_cost.py "
            "and limit=5. Then reply with one line: CASE_C4_DONE"
        ),
        "timeout": 120,
    },
]


def run_case(case: dict) -> dict:
    line0 = stats_len()
    t0 = time.time()
    proc = subprocess.run(
        [
            str(MIMO),
            "run",
            "--dangerously-skip-permissions",
            case["prompt"],
        ],
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
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(t0)),
        "duration_s": round(duration, 3),
        "exit_code": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-800:],
        "stderr_tail": (proc.stderr or "")[-800:],
        "window_event_count": len(events),
        "tools": [brief(e) for e in tools],
        "errors": [brief(e) for e in errors],
        "models": [brief(e) for e in models],
        "all_events": [brief(e) for e in events if e.get("ev") in ("tool", "error", "model", "slice_pre", "slice")],
    }
    (OUT / f"{case['id']}.json").write_text(
        json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"=== {case['id']} exit={proc.returncode} tools={len(tools)} errors={len(errors)} ===")
    for e in tools:
        print("  tool", json.dumps(brief(e), ensure_ascii=False)[:300])
    for e in errors:
        print("  error", json.dumps(brief(e), ensure_ascii=False)[:300])
    return rec


def main() -> None:
    results = []
    for case in CASES:
        try:
            results.append(run_case(case))
        except subprocess.TimeoutExpired:
            results.append({"case_id": case["id"], "error": "timeout"})
            print(f"=== {case['id']} TIMEOUT ===")
        time.sleep(1)
    import hashlib
    summary = {
        "binary_path": str(MIMO),
        "binary_sha256": hashlib.sha256(MIMO.read_bytes()).hexdigest(),
        "binary_note": "dist build with classify.ts; installed ~/.mimocode/bin/mimo.exe still 86bad66b",
        "cases": [
            {
                "case_id": r.get("case_id"),
                "exit_code": r.get("exit_code"),
                "tools": r.get("tools", []),
                "errors": r.get("errors", []),
                "duration_s": r.get("duration_s"),
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
