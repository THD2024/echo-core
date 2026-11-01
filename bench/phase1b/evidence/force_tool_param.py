#!/usr/bin/env python3
"""Phase1B-1: Force real repairToolCall path via OpenAI-compatible endpoint override.
Proves tool_param classification lands for unknown tool names in real Core binary."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread

STATS = Path.home() / ".config" / "mimocode" / "context-gate" / "stats.jsonl"
MIMO = Path.home() / ".mimocode" / "bin" / "mimo.exe"
OUT = Path(r"D:\EchoCore\echo-core\bench\phase1b\evidence\tool-error-e2e")
OUT.mkdir(parents=True, exist_ok=True)


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
        "t", "ev", "sid", "tid", "agent", "tool", "st", "kind",
        "error_class", "tin", "tout", "model", "cid", "name", "msg",
    )
    return {k: e.get(k) for k in keys if k in e}


class FakeLLMServer(BaseHTTPRequestHandler):
    """OpenAI-compatible endpoint that ALWAYS calls a completely fake tool name.
    Forces AI SDK experimental_repairToolCall to fire → toolName=invalid."""
    
    def do_POST(self):
        length = int(self.headers.get('content-length', 0))
        _ = self.rfile.read(length)  # consume body
        
        # Stream response: tool call to completely_fake_tool_xyz789
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        
        chunk = {
            "id": "chatcmpl-fake-001",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "fake-model",
            "choices": [{
                "index": 0,
                "delta": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_forced_unknown_001",
                        "type": "function",
                        "function": {
                            "name": "completely_fake_tool_xyz789",
                            "arguments": "{}"
                        }
                    }]
                },
                "finish_reason": None
            }],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}
        }
        self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        
        final = {
            "id": "chatcmpl-fake-001",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "fake-model",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}
        }
        self.wfile.write(f"data: {json.dumps(final)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
    
    def log_message(self, format, *args):
        pass  # suppress


def start_fake_server() -> tuple[HTTPServer, Thread]:
    server = HTTPServer(('127.0.0.1', 8799), FakeLLMServer)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def run_case(name: str, prompt: str, base_url: str | None = None) -> dict:
    line0 = stats_len()
    t0 = time.time()
    
    env = os.environ.copy()
    if base_url:
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_KEY"] = "sk-fake-for-e2e"
    
    proc = subprocess.run(
        [str(MIMO), "run", "--dangerously-skip-permissions", prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        env=env,
    )
    
    duration = time.time() - t0
    events = load_since(line0)
    tools = [e for e in events if e.get("ev") == "tool"]
    errors = [e for e in events if e.get("ev") == "error"]
    models = [e for e in events if e.get("ev") == "model"]
    
    rec = {
        "case_id": name,
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
    
    (OUT / f"{name}.json").write_text(
        json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    
    print(f"=== {name} exit={proc.returncode} tools={len(tools)} errors={len(errors)} ===")
    for e in tools:
        print("  tool", json.dumps(brief(e), ensure_ascii=False)[:300])
    for e in errors:
        print("  error", json.dumps(brief(e), ensure_ascii=False)[:300])
    
    return rec


def main():
    print("Starting fake OpenAI-compatible LLM server on 127.0.0.1:8799...")
    server, thread = start_fake_server()
    time.sleep(0.5)
    print("Server ready. Running forced unknown tool call...")
    
    try:
        result = run_case(
            "C1_forced_repair",
            "Do whatever the model outputs. Just execute.",
            base_url="http://127.0.0.1:8799/v1",
        )
    finally:
        server.shutdown()
        server.server_close()
    
    print("\n" + "=" * 60)
    print("SUMMARY:")
    error_classes = [e.get("error_class") for e in result.get("errors", [])]
    print(json.dumps({
        "case": result["case_id"],
        "exit_code": result["exit_code"],
        "tools": len(result.get("tools", [])),
        "errors": len(result.get("errors", [])),
        "error_classes": error_classes,
        "has_tool_param": "tool_param" in error_classes,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
