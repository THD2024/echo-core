#!/usr/bin/env python3
"""C1 任务收口对账器（c1-design.md §4）

三源对账：
  1. 总线账本 stats.jsonl — ev:task 最后状态、ev:slice 结局、ev:error
  2. DB task 表          — 权威状态
  3. 日志 ERROR 行       — 对账失败可见率（可选）

五类输出：正常结束 / 失败 / 未完成 / 恢复中 / 无法归类
附加桶：suspicious_no_gate（切片 completed 但任务未终态 → fail-open 可疑）

用法：
  python reconcile.py [--stats PATH] [--db PATH] [--since EPOCH_MS]

默认路径适配 Windows 本机环境。
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

# ---------- 默认路径 ----------
DEFAULT_STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"
DEFAULT_DB = Path.home() / ".local" / "share" / "mimocode" / "mimocode.db"


def load_stats(stats_path: Path, since: int = 0) -> list[dict]:
    """读取 stats.jsonl，返回 C1 相关事件行。"""
    events = []
    c1_types = {"task", "slice", "error", "retry", "tool", "repeat", "slice_pre"}
    if not stats_path.exists():
        print(f"[warn] stats file not found: {stats_path}", file=sys.stderr)
        return events
    with open(stats_path, "r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("t", 0) < since:
                continue
            if obj.get("ev") in c1_types:
                events.append(obj)
    return events


def load_tasks_from_db(db_path: Path, since: int = 0) -> list[dict]:
    """从 DB task 表读取任务。列名基于 Phase 0 审计（task/registry.ts）。"""
    if not db_path.exists():
        print(f"[warn] db not found: {db_path}", file=sys.stderr)
        return []
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        # 先探测列名
        cols_row = conn.execute("PRAGMA table_info(task)").fetchall()
        cols = {r["name"] for r in cols_row}
        if not cols:
            print("[warn] no task table found", file=sys.stderr)
            return []
        # 动态适配列名
        id_col = "id" if "id" in cols else next(iter(cols))
        status_col = "status" if "status" in cols else None
        session_col = "session_id" if "session_id" in cols else ("sessionID" if "sessionID" in cols else None)
        created_col = "created" if "created" in cols else ("time_created" if "time_created" in cols else None)
        updated_col = "updated" if "updated" in cols else ("time_updated" if "time_updated" in cols else None)

        select_parts = [f'"{id_col}" AS id']
        if status_col:
            select_parts.append(f'"{status_col}" AS status')
        else:
            select_parts.append("NULL AS status")
        if session_col:
            select_parts.append(f'"{session_col}" AS session_id')
        else:
            select_parts.append("NULL AS session_id")
        if created_col:
            select_parts.append(f'"{created_col}" AS created')
        else:
            select_parts.append("NULL AS created")
        if updated_col:
            select_parts.append(f'"{updated_col}" AS updated')
        else:
            select_parts.append("NULL AS updated")

        sql = f"SELECT {', '.join(select_parts)} FROM task"
        rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[warn] db read error: {e}", file=sys.stderr)
        return []
    finally:
        conn.close()


def reconcile(events: list[dict], db_tasks: list[dict]) -> dict:
    """三源对账主逻辑。"""
    # 账本侧：每个 tid 的最后状态
    ledger_tasks: dict[str, str] = {}
    ledger_slices: dict[str, list[dict]] = defaultdict(list)
    ledger_errors: list[dict] = []

    for ev in events:
        et = ev.get("ev")
        if et == "task":
            tid = ev.get("tid")
            if tid:
                # task.updated 可能多次 → 取最后一条
                ledger_tasks[tid] = ev.get("st") or ledger_tasks.get(tid, "unknown")
        elif et == "slice":
            sid = ev.get("sid")
            if sid:
                ledger_slices[sid].append(ev)
        elif et == "error":
            ledger_errors.append(ev)

    # DB 侧
    db_map: dict[str, dict] = {}
    for t in db_tasks:
        tid = t.get("id")
        if tid:
            db_map[tid] = t

    # 对账
    buckets: dict[str, list] = {
        "正常结束": [],
        "失败": [],
        "未完成": [],
        "恢复中": [],
        "无法归类": [],
        "suspicious_no_gate": [],
    }

    all_tids = set(ledger_tasks.keys()) | set(db_map.keys())

    for tid in all_tids:
        ledger_st = ledger_tasks.get(tid)
        db_row = db_map.get(tid)
        db_st = (db_row or {}).get("status")

        # 归类优先级：DB 权威 > 账本
        status = db_st or ledger_st
        if status is None:
            buckets["无法归类"].append({"tid": tid, "ledger": ledger_st, "db": db_st})
        elif status in ("done", "completed", "success"):
            buckets["正常结束"].append({"tid": tid, "ledger": ledger_st, "db": db_st})
        elif status in ("failed", "error", "blocked", "abandoned"):
            buckets["失败"].append({"tid": tid, "ledger": ledger_st, "db": db_st})
        elif status in ("in_progress", "active", "running"):
            buckets["恢复中"].append({"tid": tid, "ledger": ledger_st, "db": db_st})
        elif status in ("open", "pending", "created"):
            buckets["未完成"].append({"tid": tid, "ledger": ledger_st, "db": db_st})
        else:
            buckets["无法归类"].append({"tid": tid, "ledger": ledger_st, "db": db_st, "raw_status": status})

    # suspicious_no_gate：切片 outcome=completed 但该切片自身绑定的任务未终态。
    # Phase1B 修复：原先用 sid→全部 tids 聚合交集，并行多 tid 会话会把
    # 任意完成切片关联到所有未完成任务 → 32 条误报。现在只检查切片自己的 tid。
    # 主 agent 切片 tid=null：属设计（main 无任务绑定），不标记。
    terminal = {"done", "completed", "success", "failed", "error", "blocked", "abandoned"}
    unfinished_tids = {
        tid for tid in all_tids
        if (db_map.get(tid, {}).get("status") or ledger_tasks.get(tid)) not in terminal
        and (db_map.get(tid, {}).get("status") or ledger_tasks.get(tid)) is not None
    }

    for sid, sl_list in ledger_slices.items():
        for sl in sl_list:
            if sl.get("outcome") != "completed":
                continue
            slice_tid = sl.get("tid")
            # main agent (tid=null) completed slices must not flag concurrent subagent tasks
            if not slice_tid:
                continue
            if slice_tid in unfinished_tids:
                buckets["suspicious_no_gate"].append({
                    "sid": sid,
                    "tid": slice_tid,
                    "agent": sl.get("agent"),
                    "dur": sl.get("dur"),
                    "msgs": sl.get("msgs"),
                })

    # 汇总
    summary = {k: len(v) for k, v in buckets.items()}
    summary["_total_tids"] = len(all_tids)
    summary["_db_tasks"] = len(db_tasks)
    summary["_ledger_errors"] = len(ledger_errors)
    summary["_c1_events"] = len(events)
    return {"summary": summary, "buckets": buckets}


def main():
    ap = argparse.ArgumentParser(description="C1 任务收口对账器")
    ap.add_argument("--stats", type=Path, default=DEFAULT_STATS, help="stats.jsonl 路径")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB, help="MiMoCode DB 路径")
    ap.add_argument("--since", type=int, default=0, help="起始时间戳（epoch ms）")
    ap.add_argument("--json", action="store_true", help="输出 JSON 而非表格")
    args = ap.parse_args()

    events = load_stats(args.stats, args.since)
    db_tasks = load_tasks_from_db(args.db, args.since)
    result = reconcile(events, db_tasks)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        s = result["summary"]
        print("=" * 50)
        print("C1 任务收口对账报告")
        print("=" * 50)
        print(f"C1 事件数:    {s['_c1_events']}")
        print(f"账本错误数:   {s['_ledger_errors']}")
        print(f"DB 任务数:    {s['_db_tasks']}")
        print(f"对账 TID 数:  {s['_total_tids']}")
        print("-" * 50)
        for bucket in ("正常结束", "失败", "未完成", "恢复中", "无法归类", "suspicious_no_gate"):
            n = s[bucket]
            items = result["buckets"][bucket]
            print(f"  {bucket:20s}: {n}")
            for item in items[:10]:  # 最多展示 10 条
                tid = item.get("tid") or item.get("sid", "?")
                print(f"    - {tid}")
            if len(items) > 10:
                print(f"    ... 共 {len(items)} 条")
        print("=" * 50)


if __name__ == "__main__":
    main()
