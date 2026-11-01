# ENVIRONMENT-SNAPSHOT — Phase 1 B1–B6 Baseline

## Freeze time
- Started: 2026-10-31T11:06:57+08:00
- Operator: MiMoCode main agent (session ses_ffe5e70294ba1ffezuPmgky7Ua)

## Host
- OS: Microsoft Windows 11 Home
- CPU: AMD Ryzen 7 7745HX with Radeon Graphics
- RAM: 15.2 GB
- Disk D: free ~308.7 GB
- Node: v24.19.0
- Python: available (used for metrics/verify)

## Software versions
| Component | Value |
|---|---|
| MiMoCode git | `496bb8cbe614aecea27623457d143600cc12c275` |
| MiMoCode tag | (none exact match; v0.1.16 baseline per design docs) |
| Echo Core git | `1fb512e150d59ae42693dca4b88f81bec84dbbcc` branch `main` |
| Echo Core worktree | has uncommitted changes (len=212 porcelain lines) — **recorded, not cleaned** |
| C1 gates.json | c1:true, enabled:true, soft_limit:75000, hard_limit:110000 |
| C1 plugin path | `C:\Users\微醺\.config\mimocode\context-gate\index.ts` |
| stats.jsonl lines at freeze | 9333 |
| Model observed in C1 | `mimo-v2.6-flash` |

## Model parameters
- temperature / topP: not exposed in C1 model events (null)
- Context limit: host default (not overridden this round)

## Tool inventory
- Standard MiMoCode tool surface (bash, read, write, edit, glob, grep, task, actor, memory, …)
- No custom tool definitions added for this baseline
- Known defect: PowerShell non-terminating errors may be recorded as tool success (documented; not fixed)

## Budget
- Planned: ≤ ¥8 for 18+ runs
- Metering: C1 `ev:model` tin/tout per call; API cost not directly exposed → will record tokens and note cost as estimated null unless host exposes it

## Fixtures
- Source: `bench/repo-b1` … `repo-b4`
- Snapshot: `bench/phase1-baseline/fixtures/`
- Task defs: `bench/tasks/b1.md` … `b6.md` (used verbatim)

## C1 config snapshot (verbatim)
```json
{
  "enabled": true,
  "soft_limit": 75000,
  "hard_limit": 110000,
  "keep_recent": 20,
  "text_trim_min": 8000,
  "head_tail_keep": 2000,
  "pass2_head_tail": 600,
  "data_trim_min": 4000,
  "input_trim_min": 4000,
  "sample_every": 40,
  "stats_file": "stats.jsonl",
  "compacting_context": true,
  "verify": true,
  "roundtrip_hint": true,
  "c1": true
}
```

## Freeze rules for this round
- Do not switch model mid-round
- Do not change prompts, tools, C1 config
- Do not fix PowerShell success-misclass
- Do not delete tools / rewrite agent loop / add auto-retry
- Record all runs including failures
