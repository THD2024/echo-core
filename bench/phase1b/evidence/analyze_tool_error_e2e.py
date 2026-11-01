#!/usr/bin/env python3
"""Analyze Phase1B-1 four-case tool error E2E results from stats.jsonl files."""
from pathlib import Path
import json

base = Path(r"D:\EchoCore\echo-core\bench\phase1b\evidence\tool-error-e2e")


def dump_event(e, indent="  "):
    keys = sorted(e.keys())
    interesting = {}
    for k in keys:
        v = e.get(k)
        if k in (
            "type", "name", "ok", "status", "error", "error_class",
            "errorSource", "error_source", "tid", "agent", "agentID", "agent_id",
            "tool_name", "toolName", "repair", "reason", "phase", "detail",
            "result", "message", "category", "session", "out",
        ) or "err" in k.lower() or "tool" in k.lower() or "class" in k.lower():
            s = str(v)
            if len(s) > 200:
                s = s[:200] + "..."
            interesting[k] = s
    print(indent + json.dumps(interesting, ensure_ascii=False))


for d in sorted(base.iterdir()):
    if not d.is_dir():
        continue
    print("=" * 60)
    print("CASE:", d.name)
    sp = d / "stats.jsonl"
    if not sp.exists():
        print("  (no stats.jsonl)")
        # show any other files
        for f in d.iterdir():
            print("  file:", f.name, f.stat().st_size)
        continue
    lines = [l for l in sp.read_text(encoding="utf-8").splitlines() if l.strip()]
    events = [json.loads(l) for l in lines]
    print(f"  total_events={len(events)}")
    # group by type
    by_type = {}
    for e in events:
        by_type.setdefault(e.get("type", "?"), []).append(e)
    print("  types:", {k: len(v) for k, v in sorted(by_type.items())})
    # tools
    for t in by_type.get("ev:tool", []):
        print("  -- tool event --")
        dump_event(t)
    # errors
    for t in by_type.get("ev:error", []):
        print("  -- error event --")
        dump_event(t)
    # any event with error_class
    for e in events:
        if e.get("error_class") and e.get("type") != "ev:error":
            print("  -- event with error_class (non-ev:error) --")
            dump_event(e)
    # models summary
    models = by_type.get("ev:model", [])
    print(f"  model_events={len(models)}")
    for m in models:
        out = m.get("out") or m.get("output") or ""
        print(
            f"  model: status={m.get('status')} tool_calls={m.get('tool_calls')} "
            f"out_len={len(str(out))} err={str(m.get('error'))[:80]}"
        )
        # print last 300 chars of out if any
        if out:
            print("    out_tail:", repr(str(out)[-300:]))
    # other event types worth seeing
    for etype in ("ev:repair", "ev:task", "ev:slice", "ev:gate"):
        for e in by_type.get(etype, []):
            print(f"  -- {etype} --")
            dump_event(e)
    print()
