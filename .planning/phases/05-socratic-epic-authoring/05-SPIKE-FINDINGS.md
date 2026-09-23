# Phase 5 Plan 01: Spike Findings

Measured against the real installed `claude` binary — see each section's own measurement notes.

## Decision Rule

Choose `option-a` if and only if all four turns were answered AND the duplicate-entry count is zero for OPTION A's OWN measurement run; otherwise `option-b`. Recorded below alongside the measurement that selected it.
claude_version: 2.1.267 (Claude Code)

<!-- transport-measurement-table:start -->
## Transport Measurement (A1)

| transport | turns answered | per-turn latency | total cost (summed across turns) | total output tokens (summed) | duplicate (byte-identical persisted lines) |
|---|---|---|---|---|---|
| option-a | 4/4 | t1=34900ms, t2=14502ms, t3=23853ms, t4=6626ms | $1.7345 | 4773 | 0 |
| option-b | 4/4 | t1=42111ms, t2=46020ms, t3=45312ms, t4=6295ms | $1.3583 | 7951 | 0 |
<!-- transport-measurement-table:end -->
heartbeat_verdict: survived a 20000ms idle window (exceeds runtime_protocol.rs's HEARTBEAT_STALE_MS=15000ms) with a production-cadence heartbeat writer running; turn 3 was answered normally afterward
transport_decision: option-a

<!-- transport-invariant:start -->
## Invariant

One authoring conversation is one `agent_runs` row regardless of transport. Under Option B, the follow-up turns are further child processes inside the SAME run, never additional `agent_runs` rows — this is what keeps D-84's "an epic-authoring session IS an agent_run" literally true either way, and it is why plans 05-02 onward do not branch on this decision.
<!-- transport-invariant:end -->
stage_gate_matcher: intercepts
denial_outcome: recoverable

<!-- stage-gate-measurement:start -->
## Stage Gate Measurement (A2/A3)

- **A2 (matcher interception):** `intercepts` — hook fired for propose_task_spike: true; propose_task_spike handler itself ran: false.
- **A3 (denial recoverability):** `recoverable` — session exited normally with a terminal result event.
- **Negative control (read_epic_spike, does not match the stage-gate matcher):** HELD — executed normally, hook never fired for it (hook fired for read_epic_spike: false; read_epic_spike handler ran: true).
- **Quoted model response (verbatim):**

  > `read_epic_spike` ran fine (negative control); `propose_task_spike` was rejected with "still in the challenge stage — no proposals yet".

The hook mechanism is a real enforcement point for a second MCP server's tool names — plan 05-03 can build D-88's stage gate on it directly.
<!-- stage-gate-measurement:end -->

## Product Kill Criterion

Closes the three open Discretion questions `05-CONTEXT.md` left for this spike: what is measured,
what the comparison arm is, and what result changes the plan. Judged **after** plan 05-02's tracer
makes one real shaping run possible — not before, since the measurement needs something to
measure. Both halves below are required because either alone is gameable: wall-clock time alone
rewards a fast-but-sloppy draft; amendment count alone rewards a slow-but-careful one.

measured: wall-clock minutes from "I want to build X" to an epic with at least three tasks, each carrying at least one ACCEPTED acceptance criterion — paired with the count of those criteria the developer amended before accepting (the quality proxy: an authoring surface that drafts criteria nobody has to correct is doing the work; one whose every criterion is rewritten is a typing exercise with extra steps).
comparison_arm: the identical shaping exercise on the identical real epic, performed by prompting `claude` directly in a terminal and hand-entering the resulting items on the board through the existing quick-add (D-09) — a timed run against the real product, not a hypothetical estimate.
changes_the_plan_when: if the in-app flow is SLOWER than the terminal arm AND more than half of the drafted criteria were amended before acceptance, the consequence is `05-CONTEXT.md`'s own Deferred Idea — "a dedicated authoring surface... Revisit only with evidence that `SessionSurface` plus a tray measurably loses to a terminal." This is a LAYOUT change, not an abandonment of the phase: the mechanisms (D-80 staging, the create/amend/delete verbs, D-88's stage gate) survive it unchanged: only where the conversation renders would move, from `SessionSurface.tsx` plus a side tray to a dedicated route.
