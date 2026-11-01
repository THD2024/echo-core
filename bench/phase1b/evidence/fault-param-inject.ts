// Controlled tool_param injection against real C1 hooks (same path as production event branch).
// Run with: bun run evidence/fault-param-inject.ts
// Confirms ev:error + error_class=tool_param lands when tool_name=invalid + status=error.
import path from "node:path"
import os from "node:os"
import { pathToFileURL } from "node:url"

const modPath = path.join(os.homedir(), ".config", "mimocode", "context-gate", "index.ts")

let hooks: Record<string, any> | null = null
try {
  const mod: any = await import(pathToFileURL(modPath).href)
  const plugin = mod.default ?? mod
  hooks = typeof plugin.server === "function" ? plugin.server() : plugin
} catch (e) {
  console.error("import_failed", String(e))
  process.exit(2)
}

const sid = "ses_FAULT_INJECT_PHASE1B"
hooks!["session.pre"]?.({ sessionID: sid, agentID: "fault-agent-1", task_id: "T_FAULT_PARAM" })
hooks!.event?.({
  event: {
    type: "metrics.tool_call",
    properties: {
      sessionID: sid,
      agentID: "fault-agent-1",
      tool_name: "invalid",
      tool_call_status: "error",
      tool_call_id: "call_fault_param_1",
      input_bytes: 10,
      output_bytes: 20,
    },
  },
})
hooks!["session.post"]?.({ sessionID: sid, agentID: "fault-agent-1", outcome: "error" })
console.log("injected", sid)
