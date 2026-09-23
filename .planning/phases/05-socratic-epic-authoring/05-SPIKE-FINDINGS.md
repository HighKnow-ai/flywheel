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
