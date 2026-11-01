// Phase1B unit test for C1 attribution + error event logic (pure, no live bus)
// Run: bun run c1-logic.test.ts

type SliceEntry = { tid: string | null; agent: string; t0: number }

function makePeek() {
  const sliceStack = new Map<string, SliceEntry[]>()
  return {
    push(sid: string, tid: string | null, agent: string) {
      let arr = sliceStack.get(sid)
      if (!arr) { arr = []; sliceStack.set(sid, arr) }
      arr.push({ tid, agent, t0: Date.now() })
    },
    pop(sid: string) {
      const arr = sliceStack.get(sid)
      if (arr && arr.length) arr.pop()
    },
    peekTid(sid: string): string | null {
      const arr = sliceStack.get(sid)
      if (!arr || !arr.length) return null
      return arr[arr.length - 1].tid
    },
    peekTidByAgent(sid: string, agentID?: string | null): string | null {
      if (!agentID) return this.peekTid(sid)
      const arr = sliceStack.get(sid)
      if (!arr || !arr.length) return null
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].agent === agentID) return arr[i].tid
      }
      return null // agentID present but not on stack → unknown, never guess
    },
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1) }
  console.log("PASS:", msg)
}

// Test 1: parallel agents, different tids, same sid — no cross-attribution
{
  const p = makePeek()
  const sid = "ses_test"
  p.push(sid, "T_A", "general-A")
  p.push(sid, "T_B", "general-B")
  assert(p.peekTidByAgent(sid, "general-A") === "T_A", "agent A model → T_A (no cross)")
  assert(p.peekTidByAgent(sid, "general-B") === "T_B", "agent B model → T_B (no cross)")
  assert(p.peekTid(sid) === "T_B", "naive peek returns stack top (documents the bug)")
}

// Test 2: main agent tid stays null
{
  const p = makePeek()
  p.push("ses_m", null, "main")
  assert(p.peekTidByAgent("ses_m", "main") === null, "main agent tid is null by design")
  assert(p.peekTid("ses_m") === null, "main peekTid null")
}

// Test 3: fallback when agentID missing
{
  const p = makePeek()
  p.push("ses_f", "T_X", "general-X")
  assert(p.peekTidByAgent("ses_f", undefined) === "T_X", "missing agentID falls back to peekTid")
}

// Test 4: pop restores previous
{
  const p = makePeek()
  p.push("ses_p", "T1", "g1")
  p.push("ses_p", "T2", "g2")
  p.pop("ses_p")
  assert(p.peekTidByAgent("ses_p", "g1") === "T1", "after pop, g1 still resolves T1")
  assert(p.peekTidByAgent("ses_p", "g2") === null, "after pop, g2 gone")
}

// Test 5: tool error classification mapping
{
  const classify = (tool: string, st: string): string | null => {
    if (st !== "error") return null
    if (tool === "invalid") return "tool_param"
    return "tool_execution"
  }
  assert(classify("bash", "error") === "tool_execution", "bash error → tool_execution")
  assert(classify("invalid", "error") === "tool_param", "invalid → tool_param")
  assert(classify("bash", "success") === null, "success → no error event")
}

console.log("\nAll C1 logic tests passed.")
