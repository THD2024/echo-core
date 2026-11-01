#!/usr/bin/env python3
"""Analyze new-binary dual-tid E2E attribution from stats.jsonl."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"
BASE = 11285
OUT = Path(r"D:\EchoCore\echo-core\bench\phase1b\evidence")


def main() -> None:
    events = []
    with STATS.open(encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i < BASE:
                continue
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    e2e_sid_prefix = "ses_ffe5e6f9f294"  # headless new-binary session from log
    e2e = [e for e in events if str(e.get("sid", "")).startswith(e2e_sid_prefix)]
    if not e2e:
        # fallback: all events after baseline that have T1/T2/agent
        e2e = [
            e
            for e in events
            if e.get("tid") in ("T1", "T2")
            or (e.get("agent") or "").startswith("explore")
            or (e.get("ev") in ("slice_pre", "model", "tool") and e.get("sid", "").startswith("ses_"))
        ]

    models = [e for e in e2e if e.get("ev") == "model"]
    tools = [e for e in e2e if e.get("ev") == "tool"]
    errors = [e for e in e2e if e.get("ev") == "error"]
    slice_pre = [e for e in e2e if e.get("ev") == "slice_pre"]
    tasks = [e for e in e2e if e.get("ev") == "task"]

    # Isolate the E2E headless session only if possible
    sids = Counter(e.get("sid") for e in e2e if e.get("sid"))
    # Prefer the sid that has slice_pre with explore-*
    e2e_sid = None
    for e in slice_pre:
        agent = e.get("agent") or ""
        if agent.startswith("explore") or e.get("tid") in ("T1", "T2"):
            e2e_sid = e.get("sid")
            break
    if e2e_sid is None and sids:
        # pick sid with most model events among those with T1/T2
        for sid, n in sids.most_common():
            sub = [e for e in e2e if e.get("sid") == sid and e.get("tid") in ("T1", "T2")]
            if sub:
                e2e_sid = sid
                break

    if e2e_sid:
        session = [e for e in e2e if e.get("sid") == e2e_sid]
    else:
        session = e2e

    models = [e for e in session if e.get("ev") == "model"]
    tools = [e for e in session if e.get("ev") == "tool"]
    errors = [e for e in session if e.get("ev") == "error"]
    slice_pre = [e for e in session if e.get("ev") == "slice_pre"]
    slices = [e for e in session if e.get("ev") in ("slice", "slice_post")]
    tasks = [e for e in session if e.get("ev") == "task"]

    def brief(e):
        return {
            k: e.get(k)
            for k in (
                "t",
                "ev",
                "sid",
                "tid",
                "agent",
                "tool",
                "st",
                "kind",
                "error_class",
                "tin",
                "tout",
                "cache",
                "model",
                "cid",
                "outcome",
            )
            if k in e and e.get(k) is not None
        }

    # Attribution analysis for model/tool
    model_attr = []
    for e in models:
        model_attr.append(
            {
                "tid": e.get("tid"),
                "agent": e.get("agent"),
                "tin": e.get("tin"),
                "tout": e.get("tout"),
                "has_agent": bool(e.get("agent")),
                "has_tid": bool(e.get("tid")),
            }
        )
    tool_attr = []
    for e in tools:
        tool_attr.append(
            {
                "tid": e.get("tid"),
                "agent": e.get("agent"),
                "tool": e.get("tool"),
                "st": e.get("st"),
                "has_agent": bool(e.get("agent")),
                "has_tid": bool(e.get("tid")),
            }
        )

    # Cross: tid -> set of agents for model/tool only
    cross = defaultdict(set)
    for e in models + tools:
        if e.get("tid") and e.get("agent"):
            cross[e["tid"]].add(e["agent"])
    multi = {t: sorted(a) for t, a in cross.items() if len(a) > 1}

    # Main-attribution rule: agent main/missing should keep tid null
    # Detect subagent scale (small tin) vs main scale
    by_tid_agent = defaultdict(list)
    for e in models:
        by_tid_agent[(e.get("tid"), e.get("agent"))].append(e.get("tin") or 0)

    rec = {
        "baseline_lines": BASE,
        "e2e_sid": e2e_sid,
        "window_events": len(session),
        "slice_pre": [brief(e) for e in slice_pre],
        "slices": [brief(e) for e in slices],
        "tasks": [brief(e) for e in tasks[:20]],
        "model_count": len(models),
        "tool_count": len(tools),
        "error_count": len(errors),
        "models_with_agent": sum(1 for e in models if e.get("agent")),
        "tools_with_agent": sum(1 for e in tools if e.get("agent")),
        "models_with_tid": sum(1 for e in models if e.get("tid")),
        "tools_with_tid": sum(1 for e in tools if e.get("tid")),
        "model_by_tid_agent": {
            f"{t}|{a}": {"n": len(v), "tin_sum": sum(v), "tin_list": v}
            for (t, a), v in by_tid_agent.items()
        },
        "tool_by_tid_agent": dict(
            Counter(f"{e.get('tid')}|{e.get('agent')}" for e in tools)
        ),
        "cross_contamination": multi or None,
        "models_detail": model_attr,
        "tools_detail": tool_attr,
        "errors": [brief(e) for e in errors],
        "all_models": [brief(e) for e in models],
        "all_tools": [brief(e) for e in tools],
    }

    # Verdict heuristics
    sub_agents = sorted(
        {
            e.get("agent")
            for e in models + tools
            if e.get("agent") and e.get("agent") not in ("main", None)
        }
    )
    tids_seen = sorted({e.get("tid") for e in models + tools if e.get("tid")})
    rec["sub_agents"] = sub_agents
    rec["tids_seen"] = tids_seen

    # PASS if every explore-scale model has both agent and tid, and no multi-agent tid
    explore_models = [
        e for e in models if (e.get("agent") or "").startswith("explore") or (e.get("tid") in ("T1", "T2") and (e.get("tin") or 0) < 20000)
    ]
    main_scale_with_subagent_tid = [
        e
        for e in models
        if (e.get("tin") or 0) > 40000 and e.get("tid") in ("T1", "T2") and (e.get("agent") or "") not in sub_agents
    ]
    # better: main scale events that have subagent tid but agent is null/main
    main_misattr = [
        e
        for e in models
        if (e.get("tin") or 0) > 40000
        and e.get("tid") in ("T1", "T2")
        and e.get("agent") not in sub_agents
    ]

    rec["verdict"] = {
        "agent_present_on_subagent_models": sum(
            1 for e in models if (e.get("agent") or "").startswith("explore")
        )
        > 0
        or sum(1 for e in tools if (e.get("agent") or "").startswith("explore")) > 0,
        "distinct_tids": tids_seen,
        "distinct_sub_agents": sub_agents,
        "cross_contamination": multi or None,
        "main_scale_misattributed_models": [
            {"tid": e.get("tid"), "agent": e.get("agent"), "tin": e.get("tin")}
            for e in main_misattr
        ],
        "explore_scale_models": [
            {
                "tid": e.get("tid"),
                "agent": e.get("agent"),
                "tin": e.get("tin"),
                "tout": e.get("tout"),
            }
            for e in models
            if (e.get("agent") or "").startswith("explore")
            or (e.get("tid") in ("T1", "T2") and (e.get("tin") or 0) < 20000)
        ],
    }

    # Acceptance:
    # 1) subagent model/tool events must carry agent + tid
    # 2) no tid maps to multiple agents
    # 3) main large-context models must NOT be attributed to subagent tids
    v = rec["verdict"]
    sub_ok = (
        any((e.get("agent") or "").startswith("explore") for e in models)
        and any((e.get("agent") or "").startswith("explore") for e in tools)
    ) or (
        # if agents are like explore-1 but tin small with both fields
        all(
            e.get("agent") and e.get("tid")
            for e in models
            if (e.get("tin") or 0) < 20000 and e.get("tid") in ("T1", "T2")
        )
        and any((e.get("tin") or 0) < 20000 and e.get("tid") in ("T1", "T2") for e in models)
    )
    # stricter sub_ok
    sub_models = [
        e
        for e in models
        if (e.get("agent") or "").startswith("explore")
        or ((e.get("tin") or 0) < 20000 and e.get("tid") in ("T1", "T2"))
    ]
    sub_tools = [
        e
        for e in tools
        if (e.get("agent") or "").startswith("explore")
        or (e.get("tid") in ("T1", "T2") and e.get("agent"))
    ]
    sub_models_ok = len(sub_models) > 0 and all(e.get("agent") and e.get("tid") for e in sub_models)
    # tools from explore agents
    explore_tools = [e for e in tools if (e.get("agent") or "").startswith("explore")]
    explore_tools_ok = len(explore_tools) > 0 and all(e.get("tid") for e in explore_tools)

    rec["acceptance"] = {
        "subagent_models_have_agent_and_tid": sub_models_ok,
        "explore_tools_present_with_tid": explore_tools_ok or len(explore_tools) == 0,
        "no_cross_contamination": not multi,
        "no_main_misattr": len(main_misattr) == 0,
        "slice_pre_dual": len([e for e in slice_pre if e.get("tid") in ("T1", "T2")]) >= 2,
    }
    acc = rec["acceptance"]
    rec["pass"] = (
        acc["subagent_models_have_agent_and_tid"]
        and acc["no_cross_contamination"]
        and acc["no_main_misattr"]
        and acc["slice_pre_dual"]
    )

    out = OUT / "phase1b-e2e-new-binary-result.json"
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"pass": rec["pass"], "verdict": rec["verdict"], "acceptance": acc, "counts": {
        "models": len(models),
        "tools": len(tools),
        "models_with_agent": rec["models_with_agent"],
        "tools_with_agent": rec["tools_with_agent"],
        "slice_pre": [brief(e) for e in slice_pre],
        "sub_agents": sub_agents,
        "tids_seen": tids_seen,
    }}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
