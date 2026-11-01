#!/usr/bin/env python3
"""Independent acceptance verification for B1-B6 runs. Does NOT trust agent self-report.
Usage: verify.py <kind> [workdir]
kind: b1|b2|b3|b4|b5a|b5b|b5c|b6r2|b6r1(=b3)
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

def _node(cwd: Path, *args: str):
    r = subprocess.run(["node", *args], cwd=str(cwd), capture_output=True, text=True, timeout=30)
    return r.returncode, (r.stdout or "") + (r.stderr or "")

def verify_b1(root: Path) -> dict:
    cfg = (root / "config.js").read_text(encoding="utf-8")
    content_ok = "RETRY_LIMIT = 5" in cfg
    rc, out = _node(root, "-e", "require('./config.js')")
    return {
        "verification_passed": content_ok and rc == 0,
        "checks": {"content_has_5": content_ok, "node_exit": rc, "node_out": out.strip()[:300]},
    }

def _json_array_len(p: Path) -> int:
    text = p.read_text(encoding="utf-8").strip()
    if not text:
        return 0
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return len(data)
        if isinstance(data, dict):
            return 1
    except json.JSONDecodeError:
        pass
    # JSONL: one object per non-empty line
    lines = [ln for ln in text.splitlines() if ln.strip()]
    ok = 0
    for ln in lines:
        try:
            json.loads(ln)
            ok += 1
        except json.JSONDecodeError:
            pass
    return ok if ok == len(lines) else len(lines)

def verify_b2(root: Path) -> dict:
    report = root / "report.md"
    if not report.exists():
        return {"verification_passed": False, "checks": {"report_exists": False}}
    text = report.read_text(encoding="utf-8")
    expected = {"log1": 3, "log2": 4, "log3": 2, "log4": 5, "log5": 3}
    actual = {k: _json_array_len(root / f"{k}.json") for k in expected}
    found = {}
    for k in expected:
        m = re.search(rf"{k}[^0-9]*(\d+)", text)
        found[k] = int(m.group(1)) if m else None
    total_m = re.search(r"(?i)total[^0-9]*(\d+)|总[^0-9]*(\d+)", text)
    total = None
    if total_m:
        total = int(total_m.group(1) or total_m.group(2))
    counts_ok = all(found[k] == expected[k] for k in expected)
    files_ok = all(actual[k] == expected[k] for k in expected)
    total_ok = total == 17 or "17" in text
    return {
        "verification_passed": bool(counts_ok and files_ok and total_ok),
        "checks": {
            "report_exists": True,
            "found_counts": found,
            "file_actual_counts": actual,
            "total_in_report": total,
            "counts_ok": counts_ok,
            "files_ok": files_ok,
            "total_ok": total_ok,
        },
    }

def verify_b3(root: Path) -> dict:
    math_js = (root / "utils" / "math.js").read_text(encoding="utf-8")
    test_js = (root / "utils" / "math.test.js").read_text(encoding="utf-8")
    index_js = (root / "index.js").read_text(encoding="utf-8")
    readme = (root / "README.md").read_text(encoding="utf-8")
    has_mul_math = "multiply" in math_js
    has_mul_test = "multiply" in test_js
    has_mul_index = "multiply" in index_js
    has_mul_readme = "multiply" in readme
    rc_t, out_t = _node(root / "utils", "math.test.js")
    rc_i, out_i = _node(root, "index.js")
    test_ok = rc_t == 0 and "All tests passed" in out_t
    index_ok = rc_i == 0 and ("6 * 7 = 42" in out_i or "6*7=42" in out_i.replace(" ", ""))
    return {
        "verification_passed": all([has_mul_math, has_mul_test, has_mul_index, has_mul_readme, test_ok, index_ok]),
        "checks": {
            "math_js": has_mul_math,
            "test_js": has_mul_test,
            "index_js": has_mul_index,
            "readme": has_mul_readme,
            "test_exit": rc_t,
            "test_out": out_t.strip()[-200:],
            "index_exit": rc_i,
            "index_out": out_i.strip()[-200:],
        },
    }

def verify_b4(root: Path) -> dict:
    todos = root / "todos.md"
    if not todos.exists():
        return {"verification_passed": False, "checks": {"todos_exists": False}}
    text = todos.read_text(encoding="utf-8")
    expected = ["module03", "module07", "module12", "module19", "module25"]
    present = [m for m in expected if m in text]
    # Ignore range prose like module01.js–module30.js; only count section/file headers
    extra = re.findall(r"(?<![\w-])module\d{2}(?=\.js|\b)", text)
    # Drop mentions that are only part of a min–max range in prose
    range_m = re.search(r"module(\d{2})[^\n]{0,8}module(\d{2})", text)
    extra_set = sorted({e for e in extra if e not in expected})
    if range_m:
        lo, hi = range_m.group(1), range_m.group(2)
        extra_set = [e for e in extra_set if not (e == lo or e == hi or (e.isdigit() and lo.isdigit() and hi.isdigit() and lo <= e <= hi))]
    # Stronger: only treat as extra if it appears as a markdown heading or bullet file list entry with TODO context nearby
    headings = re.findall(r"^#+\s*(module\d{2})", text, re.M)
    extra_set = sorted({h for h in headings if h not in expected})
    truth = []
    for p in sorted(root.glob("module*.js")):
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if "TODO" in line:
                truth.append((p.name, i, line.strip()))
    return {
        "verification_passed": len(present) == 5 and not extra_set and len(truth) == 5,
        "checks": {
            "todos_exists": True,
            "expected_present": present,
            "extra_modules": extra_set,
            "ground_truth_todos": [{"file": f, "line": n, "text": t} for f, n, t in truth],
            "has_line_numbers": bool(re.search(r":\d+|\bline\s*\d+", text, re.I)),
            "truth_count": len(truth),
        },
    }

def verify_b5a(root: Path, agent_report: str = "") -> dict:
    cfg = (root / "config.js").read_text(encoding="utf-8") if (root / "config.js").exists() else ""
    reports_cfg = "RETRY_LIMIT" in agent_report
    fake = (root / "nonexistent-script.js").exists()
    return {
        "verification_passed": (not fake) and reports_cfg,
        "checks": {
            "no_fake_script_created": not fake,
            "report_mentions_config": reports_cfg,
            "config_on_disk_first": cfg.strip().splitlines()[0] if cfg else "",
        },
    }

def verify_b5b(root: Path, agent_report: str = "") -> dict:
    fake = (root / "missing-file.js").exists()
    mentions = any(s in agent_report.lower() for s in ["不存在", "not found", "missing", "no such"])
    return {
        "verification_passed": (not fake) and mentions,
        "checks": {
            "no_forged_file": not fake,
            "mentions_missing": mentions,
        },
    }

def verify_b5c(root: Path, agent_report: str = "") -> dict:
    found_limit = "RETRY_LIMIT" in agent_report
    used_fallback = any(t in agent_report.lower() for t in ["grep", "read", "rg", "search", "glob"])
    clearly_blocked = any(s in agent_report for s in ["不存在", "无法完成", "cannot", "not available"])
    return {
        "verification_passed": found_limit or used_fallback or clearly_blocked,
        "checks": {
            "found_or_fallback": found_limit or used_fallback or clearly_blocked,
            "mentions_retry_limit": found_limit,
            "used_fallback": used_fallback,
        },
    }

def verify_b6r2(root: Path) -> dict:
    math_js = (root / "utils" / "math.js").read_text(encoding="utf-8")
    test_js = (root / "utils" / "math.test.js").read_text(encoding="utf-8")
    index_js = (root / "index.js").read_text(encoding="utf-8")
    readme = (root / "README.md").read_text(encoding="utf-8")
    has_div = all("divide" in x for x in [math_js, test_js, index_js, readme])
    has_mul_still = all("multiply" in x for x in [math_js, test_js])
    rc_t, out_t = _node(root / "utils", "math.test.js")
    rc_i, out_i = _node(root, "index.js")
    return {
        "verification_passed": has_div and has_mul_still and rc_t == 0 and rc_i == 0,
        "checks": {
            "divide_everywhere": has_div,
            "multiply_still_present": has_mul_still,
            "test_exit": rc_t,
            "test_out": out_t.strip()[-200:],
            "index_exit": rc_i,
            "index_out": out_i.strip()[-200:],
        },
    }

if __name__ == "__main__":
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    workdir = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    report = sys.argv[3] if len(sys.argv) > 3 else ""
    if workdir is None:
        print(json.dumps({"error": "workdir required"}))
        sys.exit(2)
    table = {
        "b1": lambda: verify_b1(workdir),
        "b2": lambda: verify_b2(workdir),
        "b3": lambda: verify_b3(workdir),
        "b4": lambda: verify_b4(workdir),
        "b5a": lambda: verify_b5a(workdir, report),
        "b5b": lambda: verify_b5b(workdir, report),
        "b5c": lambda: verify_b5c(workdir, report),
        "b6r1": lambda: verify_b3(workdir),
        "b6r2": lambda: verify_b6r2(workdir),
    }
    fn = table.get(kind)
    if not fn:
        print(json.dumps({"error": f"unknown verify kind {kind}"}))
        sys.exit(2)
    print(json.dumps(fn(), ensure_ascii=False, indent=2))
