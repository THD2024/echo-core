#!/usr/bin/env python3
"""Collect C1 metrics for a given task_id within a time window."""
from __future__ import annotations
import json, sys, argparse
from pathlib import Path
from collections import Counter

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"

def load_events(since: int = 0, until: int = 0):
    events = []
    with open(STATS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = o.get("t", 0)
            if since and t < since:
                continue
            if until and t > until:
                continue
            events.append(o)
    return events

def summarize(events, tid=None, sid=None):
    tools = [e for e in events if e.get("ev") == "tool"]
    if tid:
        # tools may have tid or belong to same sid window; filter explicit tid first
        tools_t = [e for e in tools if e.get("tid") == tid]
        tools = tools_t if tools_t else tools
    if sid:
        tools = [e for e in tools if e.get("sid") == sid]
    tasks = [e for e in events if e.get("ev") == "task" and (not tid or e.get("tid") == tid)]
    models = [e for e in events if e.get("ev") == "model"]
    if sid:
        models = [e for e in models if e.get("sid") == sid]
    errors = [e for e in events if e.get("ev") == "error"]
    if sid:
        errors = [e for e in errors if e.get("sid") == sid]
    retries = [e for e in events if e.get("ev") == "retry"]
    slices = [e for e in events if e.get("ev") in ("slice", "slice_pre")]
    if sid:
        slices = [e for e in slices if e.get("sid") == sid]

    tool_calls = len(tools)
    unique_tools = sorted({e.get("tool") for e in tools if e.get("tool")})
    tool_err = [e for e in tools if e.get("st") == "error"]
    # crude duplicate: same tool+in bytes repeated
    keys = Counter((e.get("tool"), e.get("in")) for e in tools if e.get("st") == "success")
    dup = sum(c - 1 for c in keys.values() if c > 1)
    tin = sum(e.get("tin") or 0 for e in models)
    tout = sum(e.get("tout") or 0 for e in models)
    cache = sum(e.get("cache") or 0 for e in models)
    model_names = sorted({e.get("model") for e in models if e.get("model")})
    return {
        "tool_calls": tool_calls,
        "unique_tools": unique_tools,
        "unique_tool_count": len(unique_tools),
        "tool_errors": len(tool_err),
        "tool_error_detail": [{"tool": e.get("tool"), "cid": e.get("cid"), "tid": e.get("tid")} for e in tool_err],
        "duplicate_calls_approx": dup,
        "model_calls": len(models),
        "input_tokens": tin,
        "output_tokens": tout,
        "cache_tokens": cache,
        "model_names": model_names,
        "error_events": len(errors),
        "error_detail": errors,
        "retry_events": len(retries),
        "task_events": tasks,
        "slice_events": slices,
    }

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=int, default=0)
    ap.add_argument("--until", type=int, default=0)
    ap.add_argument("--tid", type=str, default=None)
    ap.add_argument("--sid", type=str, default=None)
    ap.add_argument("--out", type=str, default=None)
    args = ap.parse_args()
    ev = load_events(args.since, args.until)
    s = summarize(ev, args.tid, args.sid)
    s["raw_event_count"] = len(ev)
    text = json.dumps(s, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)
