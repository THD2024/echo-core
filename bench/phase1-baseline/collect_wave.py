#!/usr/bin/env python3
"""Collect metrics for a timed wave of runs. Usage:
python collect_wave.py --wave-id w1 --tid T8 --since <unix_ms> --out evidence/metrics/w1_t8.json
Or filter by time window only.
"""
from __future__ import annotations
import json, sys, time, argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from collect_metrics import load_events, summarize

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=float, default=0)
    ap.add_argument("--until", type=float, default=0)
    ap.add_argument("--tid", type=str, default=None)
    ap.add_argument("--sid", type=str, default=None)
    ap.add_argument("--out", type=str, default=None)
    ap.add_argument("--run-id", type=str, default=None)
    args = ap.parse_args()
    # support ms timestamps
    since = int(args.since) if args.since > 1e12 else int(args.since * 1000) if args.since > 1e9 else int(args.since)
    until = int(args.until) if args.until > 1e12 else int(args.until * 1000) if args.until > 1e9 else int(args.until)
    ev = load_events(since, until)
    s = summarize(ev, args.tid, args.sid)
    s["raw_event_count"] = len(ev)
    s["window"] = {"since": since, "until": until, "tid": args.tid, "sid": args.sid}
    s["run_id"] = args.run_id
    text = json.dumps(s, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text, encoding="utf-8")
    print(text[:2000])
    print(f"\n... full written to {args.out}" if args.out else "")
