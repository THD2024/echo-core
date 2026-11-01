#!/usr/bin/env python3
"""Phase1B restart verification: parallel dual-tid + controlled tool fault."""
from __future__ import annotations

import json
import subprocess
import time
from collections import Counter, defaultdict
from pathlib import Path

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"
OUT = Path(r"D:\EchoCore\echo-core\bench\phase1b\evidence")
OUT.mkdir(parents=True, exist_ok=True)
MIMO = Path.home() / ".mimocode" / "bin" / "mimo.exe"
BASELINE = 11002  # recorded before dual-tid retest


def load_from(n: int) -> list[dict]:
    events = []
    with STATS.open(encoding="utf-8") as f:
        for i, line in enumerate(f):
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


def summarize(events: list[dict]) -> dict:
    models = [e for e in events if e.get("ev") == "model"]
    tools = [e for e in events if e.get("ev") == "tool"]
    errors = [e for e in events if e.get("ev") == "error"]
    slice_pre = [e for e in events if e.get("ev") == "slice_pre"]
    slice_end = [e for e in events if e.get("ev") in ("slice", "slice_post")]

    main_sid = "ses_ffe5e6fbe6849ffeiQ9eX5CWjn"
    main_models = [e for e in models if e.get("sid") == main_sid]
    main_tools = [e for e in tools if e.get("sid") == main_sid]

    tid_agents = defaultdict(set)
    for e in models + tools:
        if e.get("tid") and e.get("agent"):
            tid_agents[e["tid"]].add(e["agent"])
    multi = {t: sorted(a) for t, a in tid_agents.items() if len(a) > 1}

    # misattribution heuristic: large tin (~main context) with subagent tid during parallel window
    suspected_main_misattr = [
        e for e in main_models if e.get("tid") in ("T1.1", "T1.2") and (e.get("tin") or 0) > 40000
    ]
    subagent_models = [
        e for e in main_models if e.get("tid") in ("T1.1", "T1.2") and (e.get("tin") or 0) < 20000
    ]

    return {
        "window_events": len(events),
        "main_session": {
            "models": len(main_models),
            "tools": len(main_tools),
            "models_with_agent": sum(1 for e in main_models if e.get("agent")),
            "tools_with_agent": sum(1 for e in main_tools if e.get("agent")),
            "models_with_tid": sum(1 for e in main_models if e.get("tid")),
            "tools_with_tid": sum(1 for e in main_tools if e.get("tid")),
            "model_by_tid": dict(Counter(e.get("tid") for e in main_models)),
            "tool_by_tid": dict(Counter(e.get("tid") for e in main_tools)),
            "model_by_agent": dict(Counter(e.get("agent") for e in main_models)),
            "tool_by_agent": dict(Counter(e.get("agent") for e in main_tools)),
        },
        "slice_pre": [
            {k: e.get(k) for k in ("t", "sid", "tid", "agent")}
            for e in slice_pre
            if e.get("sid") == main_sid or (e.get("agent") or "").startswith("explore")
        ],
        "slice_end": [
            {k: e.get(k) for k in ("t", "ev", "sid", "tid", "agent")}
            for e in slice_end
            if e.get("agent") or e.get("tid")
        ],
        "cross_contamination": multi or None,
        "agent_null_on_model_tool": {
            "models": sum(1 for e in models if not e.get("agent")),
            "tools": sum(1 for e in tools if not e.get("agent")),
            "total_models": len(models),
            "total_tools": len(tools),
        },
        "errors": [
            {k: e.get(k) for k in ("t", "sid", "tid", "agent", "kind", "error_class", "tool", "cid")}
            for e in errors
        ],
        "dual_tid_probe": {
            "subagent_scale_models": [
                {k: e.get(k) for k in ("t", "tid", "agent", "tin", "tout")}
                for e in subagent_models
            ],
            "suspected_main_misattributed_to_subagent_tid": [
                {k: e.get(k) for k in ("t", "tid", "agent", "tin", "tout")}
                for e in suspected_main_misattr
            ],
        },
        "binary_check": {
            "mimo_exe_mtime": time.strftime(
                "%Y-%m-%dT%H:%M:%S%z", time.localtime(MIMO.stat().st_mtime)
            ),
            "core_agentid_schema_in_binary": False,
            "note": "mimo.exe bytes lack agentID?: string / agentID: z.string().optional() from Core patch; process restart did not load Core source changes",
        },
    }


def run_tool_fault() -> dict:
    """Controlled missing-file fault (tool_execution path)."""
    line0 = sum(1 for L in STATS.open(encoding="utf-8") if L.strip())
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    t0 = time.time()
    prompt = (
        "Read file D:\\EchoCore\\echo-core\\bench\\phase1b\\NO_SUCH_PHASE1B_RETEST.txt "
        "using the read tool. If it fails, briefly explain and end with FAULT_TOOL_DONE."
    )
    proc = subprocess.run(
        [str(MIMO), "run", "--dangerously-skip-permissions", prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
    )
    duration = time.time() - t0
    events = load_from(line0)
    error_events = [e for e in events if e.get("ev") == "error"]
    tool_errors = [e for e in events if e.get("ev") == "tool" and e.get("st") == "error"]
    return {
        "kind": "missing_file_tool_execution",
        "started_at": started,
        "duration_s": round(duration, 3),
        "exit_code": proc.returncode,
        "stdout_has_FAULT_TOOL_DONE": "FAULT_TOOL_DONE" in (proc.stdout or ""),
        "stdout_tail": (proc.stdout or "")[-400:],
        "stderr_tail": (proc.stderr or "")[-300:],
        "tool_error_events": [
            {k: e.get(k) for k in ("t", "tid", "agent", "tool", "st", "cid")}
            for e in tool_errors
        ],
        "error_events": [
            {k: e.get(k) for k in ("t", "tid", "agent", "kind", "error_class", "tool", "name", "cid")}
            for e in error_events
        ],
        "pass_ev_error": any(e.get("ev") == "error" and e.get("error_class") for e in events),
        "pass_error_class": any(e.get("error_class") == "tool_execution" for e in error_events),
        "pass_kind_tool": any(e.get("kind") == "tool" for e in error_events),
    }


def try_tool_param() -> dict:
    """Attempt invalid-tool path via headless mimo (may not fire)."""
    line0 = sum(1 for L in STATS.open(encoding="utf-8") if L.strip())
    prompt = (
        "Use mcp_tool_use to call tool totally_fake_tool_abc123 with empty arguments. "
        "Report the error and end with FAULT_PARAM_DONE."
    )
    t0 = time.time()
    try:
        proc = subprocess.run(
            [str(MIMO), "run", "--dangerously-skip-permissions", prompt],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        code = proc.returncode
    except subprocess.TimeoutExpired:
        stdout, stderr, code = "", "timeout", -1
    events = load_from(line0)
    error_events = [e for e in events if e.get("ev") == "error"]
    tool_errors = [e for e in events if e.get("ev") == "tool" and e.get("st") == "error"]
    return {
        "kind": "invalid_tool_name_attempt",
        "duration_s": round(time.time() - t0, 3),
        "exit_code": code,
        "stdout_tail": stdout[-400:],
        "stderr_tail": stderr[-300:],
        "tool_error_events": [
            {k: e.get(k) for k in ("t", "tid", "agent", "tool", "st")}
            for e in tool_errors
        ],
        "error_events": [
            {k: e.get(k) for k in ("t", "kind", "error_class", "tool")}
            for e in error_events
        ],
        "fired_metrics_tool_call_error": bool(tool_errors),
        "note": "model may refuse to call non-existent tools; tool_param only guaranteed if tool_name=invalid is published",
    }


def main() -> None:
    # dual-tid window
    events = load_from(BASELINE)
    dual = summarize(events)
    fault = run_tool_fault()
    param = try_tool_param()

    rec = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "baseline_lines": BASELINE,
        "dual_tid": dual,
        "controlled_fault_tool_execution": fault,
        "controlled_fault_tool_param": param,
        "verdict": {
            "agent_field_present_on_live_model_tool": dual["main_session"]["models_with_agent"] > 0
            or dual["main_session"]["tools_with_agent"] > 0,
            "core_agentid_loaded_in_running_binary": False,
            "parallel_agent_discrimination_possible": False,
            "tid_via_peekTid_stack_fallback_only": True,
            "ev_error_and_error_class_landed": fault.get("pass_error_class") and fault.get("pass_kind_tool"),
            "tool_param_live_fired": param.get("fired_metrics_tool_call_error"),
        },
    }
    (OUT / "phase1b-restart-verify.json").write_text(
        json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(rec["verdict"], indent=2))
    print("dual main_session:", json.dumps(dual["main_session"], indent=2))
    print("errors dual:", json.dumps(dual["errors"], indent=2)[:1500])
    print("fault:", json.dumps(fault, indent=2)[:2000])
    print("param:", json.dumps(param, indent=2)[:1500])


if __name__ == "__main__":
    main()
