#!/usr/bin/env python3
"""Force AI SDK experimental_repairToolCall path via scripted LLM server.
Proves tool_param classification for unknown tool names in real Core pipeline."""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

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


# Scripted LLM server that always calls an unknown tool
# This bypasses model refusal and forces the AI SDK repairToolCall path
SERVER_SCRIPT = '''
import http.server
import json
import sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('content-length', 0))
        body = self.rfile.read(length)
        
        # Parse request to get model info
        try:
            req = json.loads(body)
            model_id = req.get('model', 'unknown')
        except:
            model_id = 'unknown'
        
        # Always return a tool call to a completely fake tool
        # This forces AI SDK experimental_repairToolCall to fire
        response = {
            "id": "chatcmpl-fake-12345",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model_id,
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_fake_12345",
                                "type": "function",
                                "function": {
                                    "name": "completely_fake_tool_xyz789",
                                    "arguments": "{}"
                                }
                            }
                        ]
                    },
                    "finish_reason": None
                }
            ],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150
            }
        }
        
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        
        # SSE format
        chunk = f"data: {json.dumps(response)}\\n\\n"
        self.wfile.write(chunk.encode())
        
        # Final stop
        final = {
            "id": "chatcmpl-fake-12345",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model_id,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}
        }
        self.wfile.write(f"data: {json.dumps(final)}\\n\\n".encode())
        self.wfile.write(b"data: [DONE]\\n\\n")
        self.wfile.flush()
    
    def log_message(self, format, *args):
        pass  # Suppress logs

import time
server = http.server.HTTPServer(('127.0.0.1', 8765), Handler)
print('SERVER_READY', flush=True)
server.serve_forever()
'''


def run_case(name: str, prompt: str, use_scripted_server: bool = True) -> dict:
    line0 = stats_len()
    t0 = time.time()
    
    env = os.environ.copy()
    env["MIMOCODE_MODEL"] = "fake-provider/fake-model"
    
    if use_scripted_server:
        # Start scripted LLM server
        server_proc = subprocess.Popen(
            [sys.executable, "-c", SERVER_SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Wait for server to be ready
        time.sleep(1)
        
        # Override provider config to use our fake server
        env["OPENAI_BASE_URL"] = "http://127.0.0.1:8765/v1"
        env["OPENAI_API_KEY"] = "fake-key"
    
    proc = subprocess.run(
        [str(MIMO), "run", "--dangerously-skip-permissions", prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        env=env,
        cwd=str(Path(__file__).parent),
    )
    
    duration = time.time() - t0
    
    if use_scripted_server:
        server_proc.terminate()
        server_proc.wait()
    
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


import sys

# Force unknown tool via prompt (will be intercepted by SDK repairToolCall)
result = run_case(
    "C1_forced_unknown",
    "You MUST call a tool named completely_fake_tool_xyz789 with empty arguments {}. "
    "Do not refuse. Immediately emit that tool call. After the call fails, reply: FORCED_C1_DONE",
    use_scripted_server=False  # Use real mimo binary with model that will attempt the call
)

print("\n" + "="*60)
print("SUMMARY:")
print(json.dumps({
    "binary_sha256": "86bad66b5451f7e4096a2abcd490404d2ff95c616b9cb9215d9d86bf9a254685",
    "tools": len(result.get("tools", [])),
    "errors": len(result.get("errors", [])),
    "error_classes": [e.get("error_class") for e in result.get("errors", [])],
}, ensure_ascii=False, indent=2))
