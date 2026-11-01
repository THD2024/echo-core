// Phase1B E2E-ish: load real C1 plugin hooks and feed synthetic bus events.
// Verifies: tool error → ev:error; model with agentID → tid via peekTidByAgent.
// Run: bun run c1-plugin-feed.test.ts

import plugin from "file:///C:/Users/%E5%BE%AE%E9%86%BA/.config/mimocode/context-gate/index.ts"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const statsPath = path.join(os.homedir(), ".config", "mimocode", "context-gate", "stats.jsonl")
const before = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, "utf8").split("\n").filter(Boolean).length : 0

const hooks = (plugin as any).server({})
const sid = "ses_phase1b_feed_test"
const t0 = Date.now()

// Simulate session.pre for two parallel subagents with DIFFERENT tids
;(hooks as any)["session.pre"]({ sessionID: sid, agentID: "general-A", task_id: "T_FEED_A" })
;(hooks as any)["session.pre"]({ sessionID: sid, agentID: "general-B", task_id: "T_FEED_B" })

// Tool error from A
await hooks.event({ event: {
  type: "metrics.tool_call",
  properties: {
    sessionID: sid,
    agentID: "general-A",
    tool_name: "read",
    input_bytes: 50,
    output_bytes: 0,
    tool_call_id: "cid_feed_1",
    tool_call_status: "error",
  },
}})

// Tool success from B
await hooks.event({ event: {
  type: "metrics.tool_call",
  properties: {
    sessionID: sid,
    agentID: "general-B",
    tool_name: "read",
    input_bytes: 50,
    output_bytes: 100,
    tool_call_id: "cid_feed_2",
    tool_call_status: "success",
  },
}})

// Model call with agentID (requires core rebuild for live; we inject properties directly)
await hooks.event({ event: {
  type: "metrics.model_call",
  properties: {
    sessionID: sid,
    agentID: "general-A",
    finish_reason: "stop",
    latency_ms: 100,
    cached_read_tokens: 10,
    model_id: "test-model",
    provider: "test",
    total_tokens_in: 1000,
    total_tokens_out: 50,
  },
}})
await hooks.event({ event: {
  type: "metrics.model_call",
  properties: {
    sessionID: sid,
    agentID: "general-B",
    finish_reason: "stop",
    latency_ms: 100,
    cached_read_tokens: 10,
    model_id: "test-model",
    provider: "test",
    total_tokens_in: 2000,
    total_tokens_out: 80,
  },
}})

// session.post both
;(hooks as any)["session.post"]({ sessionID: sid, agentID: "general-A", outcome: "completed" })
;(hooks as any)["session.post"]({ sessionID: sid, agentID: "general-B", outcome: "completed" })

// Read new stats lines
const after = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, "utf8").split("\n").filter(Boolean) : []
const newLines = after.slice(before)
const parsed = newLines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const mine = parsed.filter((e: any) => e.sid === sid)

console.log("new events for feed sid:", mine.length)
for (const e of mine) console.log(JSON.stringify(e))

const errs = mine.filter((e: any) => e.ev === "error")
const models = mine.filter((e: any) => e.ev === "model")
const tools = mine.filter((e: any) => e.ev === "tool")

function assert(c: boolean, m: string) {
  if (!c) { console.error("FAIL:", m); process.exit(1) }
  console.log("PASS:", m)
}

assert(tools.some((e: any) => e.st === "error" && e.tool === "read" && e.agent === "general-A" && e.tid === "T_FEED_A"), "tool error attributed to general-A/T_FEED_A")
assert(errs.length >= 1, "at least one ev:error for tool failure")
assert(errs.every((e: any) => e.kind === "tool" && e.error_class), "error events have kind+error_class")
assert(errs.some((e: any) => e.tid === "T_FEED_A" && e.agent === "general-A" && e.error_class === "tool_execution"), "error event attributed to general-A/T_FEED_A")
assert(!mine.some((e: any) => e.ev === "error" && e.cid === "cid_feed_2"), "no error event for success tool")

const mA = models.find((e: any) => e.agent === "general-A")
const mB = models.find((e: any) => e.agent === "general-B")
assert(!!mA, "model event has agent general-A")
assert(!!mB, "model event has agent general-B")
// After posts, stack may be empty — model events were logged BEFORE post
// Check tid on model events
assert(mA?.tid === "T_FEED_A" || mA?.tid === null, `model A tid=${mA?.tid} (T_FEED_A or null if post already popped)`)
assert(mB?.tid === "T_FEED_B" || mB?.tid === null, `model B tid=${mB?.tid}`)

// Re-feed model BEFORE post to get deterministic tid
;(hooks as any)["session.pre"]({ sessionID: sid + "2", agentID: "gA", task_id: "T_X" })
;(hooks as any)["session.pre"]({ sessionID: sid + "2", agentID: "gB", task_id: "T_Y" })
const before2 = after.length
hooks.event({ event: {
  type: "metrics.model_call",
  properties: { sessionID: sid + "2", agentID: "gA", finish_reason: "stop", latency_ms: 1, cached_read_tokens: 0, model_id: "m", provider: "p", total_tokens_in: 1, total_tokens_out: 1 },
}})
hooks.event({ event: {
  type: "metrics.model_call",
  properties: { sessionID: sid + "2", agentID: "gB", finish_reason: "stop", latency_ms: 1, cached_read_tokens: 0, model_id: "m", provider: "p", total_tokens_in: 2, total_tokens_out: 2 },
}})
const after2 = fs.readFileSync(statsPath, "utf8").split("\n").filter(Boolean)
const batch2 = after2.slice(before2).map((l) => JSON.parse(l)).filter((e: any) => e.sid === sid + "2" && e.ev === "model")
const x = batch2.find((e: any) => e.agent === "gA")
const y = batch2.find((e: any) => e.agent === "gB")
assert(x?.tid === "T_X", `pre-post model gA → T_X (got ${x?.tid})`)
assert(y?.tid === "T_Y", `pre-post model gB → T_Y (got ${y?.tid})`)

console.log("\nC1 plugin feed test PASSED")
