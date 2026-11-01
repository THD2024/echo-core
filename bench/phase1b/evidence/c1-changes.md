# Core + C1 Phase1B changes (on disk)

## Activation

- C1 plugin (`context-gate/index.ts`): reloads via gates.json mtime — **already active** in running CLI.
- Core metrics (`agentID` on ModelCall/ToolCall): requires CLI restart or rebuild — **not active** in the currently running binary (this session still uses pre-fix mimo).
- Rebuild blocked: `bun run build:local` fails with `failed to copy bun executable into temporary file: ENOENT` (bun compile self-extract on this machine).

## 1. Core: Metrics.ModelCall + Metrics.ToolCall carry agentID

Parallel subagents share sessionID. Without agentID, token/tool metrics cannot be attributed.

```ts
// packages/cli/src/metrics/event.ts
agentID: z.string().optional()  // on ModelCall and ToolCall

// packages/cli/src/session/processor.ts
bus.publish(Metrics.ModelCall, { sessionID: ctx.sessionID, agentID: ctx.assistantMessage.agentID, ... })
bus.publish(Metrics.ToolCall, { sessionID: ctx.sessionID, agentID: ctx.assistantMessage.agentID, ... }) // tool-error path

// packages/cli/src/session/prompt.ts — 4 publish sites use ctx.actorID
bus.publish(Metrics.ToolCall, { sessionID: ctx.sessionID, agentID: ctx.actorID, ... })

// packages/sdk/src/v2/gen/types.gen.ts — optional agentID on both event types
```

Main agent: agentID is `"main"` or undefined → C1 tid stays null (by design). No second task-identity system.

## 2. C1: peekTidByAgent

```ts
function peekTidByAgent(sid: string, agentID?: string | null): string | null {
  if (!agentID) return peekTid(sid)          // legacy / main
  const arr = sliceStack.get(sid)
  if (!arr || !arr.length) return null
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].agent === agentID) return arr[i].tid
  }
  return null  // agentID present but not on stack → never guess via stack top
}
```

Applied to `metrics.model_call` and `metrics.tool_call`.

## 3. C1: tool failures emit ev:error

```ts
if (st === "error") {
  logStats(g, {
    ev: "error", sid, tid, agent,
    kind: "tool",
    error_class: tool_name === "invalid" ? "tool_param" : "tool_execution",
    tool, cid, name: "ToolCallError",
  })
}
// session.error → kind=llm, error_class=llm_api (LLM/API only; not duplicated)
```

Semantics:
| Source | ev:error | error_class |
|--------|----------|-------------|
| tool execution fail | yes | tool_execution |
| tool param invalid | yes | tool_param |
| LLM/API fail (session.error) | yes | llm_api |
| success / cancelled | no | — |

Not a double-publish: tool event keeps full metrics; error is the query surface.

## 4. Reconciler: suspicious_no_gate

Previously: slice completed + **any** unfinished tid in same sid → flag.
Now: only flag when the **slice's own tid** is unfinished. main (tid=null) never flags.

Result: 32 → 0 on full history; real unfinished tasks remain in 未完成/恢复中.

## 5. Verification

- `c1-logic.test.ts` — 11/11 PASS
- `c1-plugin-feed.test.ts` — 11/11 PASS (parallel A/B, no tid cross; tool error → T_FEED_A)
- Live headless DeepSeek run: ev:error kind=llm + slice outcome=error (Insufficient Balance)
- Live main session: model events still lack agent (old binary); after restart should carry agent=main
