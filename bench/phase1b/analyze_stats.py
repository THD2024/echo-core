#!/usr/bin/env python3
"""Analyze C1 stats for model token attribution and cost structure."""
from __future__ import annotations
import json
from pathlib import Path
from collections import Counter, defaultdict

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"


def load_events():
    events = []
    with open(STATS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return events


def main():
    events = load_events()
    models = [e for e in events if e.get("ev") == "model"]
    errors = [e for e in events if e.get("ev") == "error"]
    tools = [e for e in events if e.get("ev") == "tool"]
    slice_pre = [e for e in events if e.get("ev") == "slice_pre"]
    slice_post = [e for e in events if e.get("ev") == "slice_post"]

    print(f"=== C1 Stats Overview ===")
    print(f"total events: {len(events)}")
    print(f"model: {len(models)} tool: {len(tools)} error: {len(errors)}")
    print(f"slice_pre: {len(slice_pre)} slice_post: {len(slice_post)}")

    print(f"\n=== Model Attribution ===")
    with_agent = sum(1 for m in models if m.get("agent"))
    with_tid = sum(1 for m in models if m.get("tid"))
    null_tid = sum(1 for m in models if not m.get("tid"))
    print(f"with agentID: {with_agent} ({with_agent/len(models)*100:.1f}%)")
    print(f"with tid: {with_tid} ({with_tid/len(models)*100:.1f}%)")
    print(f"null tid: {null_tid} ({null_tid/len(models)*100:.1f}%)")

    tin = sum(m.get("tin") or 0 for m in models)
    cache = sum(m.get("cache") or 0 for m in models)
    tout = sum(m.get("tout") or 0 for m in models)
    print(f"\n=== Token Totals ===")
    print(f"tin={tin} cache={cache} non_cache={tin-cache} tout={tout}")
    if tin:
        print(f"cache_ratio={cache/tin*100:.1f}% non_cache_ratio={(tin-cache)/tin*100:.1f}%")

    # by agent
    by_agent = defaultdict(lambda: {"n": 0, "tin": 0, "cache": 0, "tout": 0})
    for m in models:
        a = m.get("agent") or "null"
        by_agent[a]["n"] += 1
        by_agent[a]["tin"] += m.get("tin") or 0
        by_agent[a]["cache"] += m.get("cache") or 0
        by_agent[a]["tout"] += m.get("tout") or 0
    print(f"\n=== By Agent (top 20 by tin) ===")
    for a, v in sorted(by_agent.items(), key=lambda x: -x[1]["tin"])[:20]:
        cr = (v["cache"] / v["tin"] * 100) if v["tin"] else 0
        print(f"  {a[:36]:36s} n={v['n']:4d} tin={v['tin']:10d} cache={v['cache']:10d} ({cr:5.1f}%) tout={v['tout']:8d}")

    # by tid
    by_tid = defaultdict(lambda: {"n": 0, "tin": 0, "cache": 0, "tout": 0, "agent": None})
    for m in models:
        t = m.get("tid") or "null"
        by_tid[t]["n"] += 1
        by_tid[t]["tin"] += m.get("tin") or 0
        by_tid[t]["cache"] += m.get("cache") or 0
        by_tid[t]["tout"] += m.get("tout") or 0
        if m.get("agent"):
            by_tid[t]["agent"] = m["agent"]
    print(f"\n=== By TID (top 15 by tin) === distinct_tids={len(by_tid)}")
    for t, v in sorted(by_tid.items(), key=lambda x: -x[1]["tin"])[:15]:
        cr = (v["cache"] / v["tin"] * 100) if v["tin"] else 0
        agent = (v["agent"] or "?")[:20]
        print(f"  {t[:24]:24s} agent={agent:20s} n={v['n']:3d} tin={v['tin']:10d} cache={v['cache']:10d} ({cr:5.1f}%) tout={v['tout']:8d}")

    # check for tid cross-contamination: same tid with multiple agents
    print(f"\n=== Cross-contamination check ===")
    tid_agents = defaultdict(set)
    for m in models:
        if m.get("tid") and m.get("agent"):
            tid_agents[m["tid"]].add(m["agent"])
    multi = {t: a for t, a in tid_agents.items() if len(a) > 1}
    if multi:
        print(f"WARNING: {len(multi)} tids have multiple agents:")
        for t, agents in list(multi.items())[:5]:
            print(f"  {t[:24]}: {agents}")
    else:
        print("OK: no tid has multiple agents")

    # errors detail
    print(f"\n=== Error Events (last 20) ===")
    for e in errors[-20:]:
        print(f"  sid={e.get('sid','?')[:12]} tid={e.get('tid')} kind={e.get('kind')} class={e.get('error_class')} tool={e.get('tool')}")

    # slice post ratio
    print(f"\n=== Slice Coverage ===")
    pre_tids = set(s.get("tid") for s in slice_pre if s.get("tid"))
    post_tids = set(s.get("tid") for s in slice_post if s.get("tid"))
    print(f"pre tids: {len(pre_tids)} post tids: {len(post_tids)}")
    print(f"pre with tid: {sum(1 for s in slice_pre if s.get('tid'))}")
    print(f"post with tid: {sum(1 for s in slice_post if s.get('tid'))}")


if __name__ == "__main__":
    main()
