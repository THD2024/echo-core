#!/usr/bin/env python3
"""Phase1B serial cost: snapshot stats, run one task, collect window metrics."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"
OUT = Path(r"D:\EchoCore\echo-core\bench\phase1b\serial-cost")
OUT.mkdir(parents=True, exist_ok=True)
MIMO = Path.home() / ".mimocode" / "bin" / "mimo.exe"

PROMPTS = {
    "B1": "Read file D:\\EchoCore\\echo-core\\bench\\phase1b\\serial_cost.py and reply with exactly one line: SERIAL_OK",
    "B2": "Read D:\\EchoCore\\echo-core\\bench\\tasks\\b2.md then summarize the required steps in one short paragraph ending with B2_DONE.",
    "B4": "List three tool categories MiMoCode exposes (search, file, shell) and end with B4_DONE.",
    "B5": "Attempt to read file D:\\EchoCore\\echo-core\\bench\\phase1b\\NO_SUCH_FILE.txt. If it fails, explain the failure and end with B5_DONE.",
}


def stats_len() -> int:
    if not STATS.exists():
        return 0
    return sum(1 for line in STATS.open(encoding="utf-8") if line.strip())


def load_since_line(n: int) -> list[dict]:
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


def window_metrics(events: list[dict]) -> dict:
    models = [e for e in events if e.get("ev") == "model"]
    tools = [e for e in events if e.get("ev") == "tool"]
    errors = [e for e in events if e.get("ev") == "error"]
    retries = [e for e in events if e.get("ev") == "retry"]
    return {
        "model_calls": len(models),
        "input_tokens": sum(e.get("tin") or 0 for e in models),
        "cache_tokens": sum(e.get("cache") or 0 for e in models),
        "output_tokens": sum(e.get("tout") or 0 for e in models),
        "non_cache_input": sum((e.get("tin") or 0) - (e.get("cache") or 0) for e in models),
        "tool_calls": len(tools),
        "tool_errors": sum(1 for e in tools if e.get("st") == "error"),
        "tool_by_tid": dict(Counter(e.get("tid") for e in tools)),
        "model_by_tid": dict(Counter(e.get("tid") for e in models)),
        "model_by_agent": dict(Counter(e.get("agent") for e in models if e.get("agent"))),
        "error_events": len(errors),
        "retry_events": len(retries),
        "event_types": dict(Counter(e.get("ev") for e in events)),
    }


def run_once(benchmark: str, run_id: str) -> dict:
    line0 = stats_len()
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    t0 = time.time()
    proc = subprocess.run(
        [
            str(MIMO),
            "run",
            "--dangerously-skip-permissions",
            PROMPTS[benchmark],
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
    )
    duration = time.time() - t0
    events = load_since_line(line0)
    m = window_metrics(events)
    rec = {
        "run_id": run_id,
        "benchmark": benchmark,
        "mode": "serial",
        "started_at": started,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "duration_s": round(duration, 3),
        "exit_code": proc.returncode,
        "stdout_tail": (proc.stdout or "")[-500:],
        "stderr_tail": (proc.stderr or "")[-500:],
        "verification": {
            "stdout_contains_expected": (
                "SERIAL_OK" in (proc.stdout or "")
                if benchmark == "B1"
                else "B2_DONE" in (proc.stdout or "")
                if benchmark == "B2"
                else "B4_DONE" in (proc.stdout or "")
                if benchmark == "B4"
                else "B5_DONE" in (proc.stdout or "")
            ),
            "human_note": "serial harness verification via terminal token",
        },
        "metrics": m,
        "actual_cost_cny": None,
        "cost_note": "C1 records tokens only; monetary cost not exposed",
    }
    (OUT / f"{run_id}.json").write_text(
        json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with (OUT / "serial-runs.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(
        f"{run_id}: exit={proc.returncode} dur={rec['duration_s']}s "
        f"tin={m['input_tokens']} cache={m['cache_tokens']} tout={m['output_tokens']} "
        f"tools={m['tool_calls']} errs={m['error_events']} "
        f"verify={rec['verification']['stdout_contains_expected']}"
    )
    return rec


def main() -> None:
    suites = sys.argv[1:] or ["B1", "B2", "B4", "B5"]
    for bench in suites:
        for i in (1, 2, 3):
            run_id = f"{bench}-R{i}"
            try:
                run_once(bench, run_id)
            except subprocess.TimeoutExpired:
                print(f"{run_id}: TIMEOUT", file=sys.stderr)
            except Exception as exc:  # noqa: BLE001
                print(f"{run_id}: ERROR {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
