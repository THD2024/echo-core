import plugin from "file:///C:/Users/%E5%BE%AE%E9%86%BA/.config/mimocode/context-gate/index.ts"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const statsPath = path.join(os.homedir(), ".config", "mimocode", "context-gate", "stats.jsonl")
const before = fs.readFileSync(statsPath, "utf8").split("\n").filter(Boolean).length

const hooks = (plugin as any).server({})
console.log("hooks keys", Object.keys(hooks))
console.log("event is", typeof hooks.event)

const sid = "ses_debug_feed2"
try {
  await hooks.event({ event: { type: "metrics.tool_call", properties: { sessionID: sid, tool_name: "read", input_bytes: 1, output_bytes: 0, tool_call_id: "c1d", tool_call_status: "error" } } })
  console.log("tool event returned ok")
} catch (e) {
  console.error("tool event threw", e)
}

try {
  await hooks.event({ event: { type: "metrics.model_call", properties: { sessionID: sid, agentID: "gX", finish_reason: "stop", latency_ms: 1, cached_read_tokens: 0, model_id: "m", provider: "p", total_tokens_in: 1, total_tokens_out: 1 } } })
  console.log("model event returned ok")
} catch (e) {
  console.error("model event threw", e)
}

const after = fs.readFileSync(statsPath, "utf8").split("\n").filter(Boolean)
const news = after.slice(before).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
console.log("new lines", news.length)
for (const n of news) console.log(JSON.stringify(n).slice(0, 200))
