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

## Product Kill Criterion — Measurement Protocol

Written by plan 05-13 (gap G-05-2's third item) once the in-app arm had something real to shape
with (05-12's composer) and a read-only way to derive its own two numbers from the board (this
plan's `measure_authoring_run`/`measure-run`). Neither arm has been re-staged against the shipped
UI yet — the numbers this protocol produces are recorded under this section only once a real
timed run has actually happened, per this file's own start/end marker convention elsewhere; an
unmeasured measurement is recorded by not being there, never by a placeholder.

### In-app arm

1. Launch the dev build (`npm --prefix packages/desktop run tauri dev`, or the project's own dev
   entry point) against a real project.
2. Start a stopwatch, then open the epic-authoring launch sheet and state a real epic's premise in
   its premise field (plan 05-13 Task 2).
3. Hold the conversation through the composer (plan 05-12) until the challenge stage is done, then
   advance the stage and decide each drafted proposal individually — accept, reject or amend-then-
   accept — until the epic has at least three tasks, each carrying at least one ACCEPTED
   acceptance criterion.
4. Stop the stopwatch the moment the last criterion needed is accepted. Record the wall-clock
   minutes by hand — the measured span is real elapsed time INCLUDING conversation latency, not
   only what the query below reports.
5. Run:

   ```bash
   FLYWHEEL_APP_DATA_DIR=<unset, or the real app-data dir the dev build itself used> \
     cargo run -p core --bin uat_authoring_ops -- measure-run <runId>
   ```

   `<runId>` is the `agent_runs.id` of the authoring session just held — visible in the session
   surface's own URL/state, or via the board. This subcommand reads the SAME real fleet database
   the dev build just wrote to (its own early branch, unlike every other `uat_authoring_ops`
   subcommand, never requires or honours a scratch `FLYWHEEL_APP_DATA_DIR` override — see that
   binary's own header comment).
6. Record the three numbers `measure-run` prints: `acceptedTaskProposals` (must be >= 3 for a
   valid run), `acceptedCriterionProposals`, and `amendedBeforeAccept` — plus the hand-timed
   wall-clock minutes from step 4.

### Terminal arm

1. On the identical epic's premise, prompt `claude` directly in a terminal — no app, no composer,
   no proposal tray.
2. Hold the identical shaping conversation by hand, then hand-enter the resulting tasks and
   criteria onto the board through the existing quick-add (D-09) as the model proposes them.
3. Time the whole exercise by hand, start to the last criterion entered.
4. Count by hand how many of the entered criteria were corrected/reworded before you considered
   them final — the terminal arm has no staging/amend step of its own, so this is the developer's
   own honest count of "wrote it, then changed it" while transcribing.

### What a completed measurement records

Once both arms have been run, record under this section (not here — this is the protocol, not the
result):

- **In-app arm:** wall-clock minutes (hand-timed), `acceptedTaskProposals`,
  `acceptedCriterionProposals`, `amendedBeforeAccept`, and the amendment RATE
  (`amendedBeforeAccept / acceptedCriterionProposals`).
- **Terminal arm:** wall-clock minutes (hand-timed), the count of tasks and criteria entered, and
  the hand-counted amendment rate.
- **Verdict:** applying `changes_the_plan_when` above verbatim — `option-a` (no layout change) IF
  the in-app arm was faster, OR at most half the drafted criteria were amended before acceptance;
  `option-b` (the Deferred Idea's layout change is now evidenced) IF the in-app arm was BOTH
  slower AND more than half its accepted criteria were amended before acceptance. A slower-but-
  mostly-unamended in-app run, or a faster-but-heavily-amended one, is `option-a` by this rule's
  own AND — record the numbers plainly even when the verdict does not change the plan; that is the
  layout finding the criterion names, not a failure of this plan (05-13-PLAN.md's own `<verify>`
  human-check says so explicitly).
