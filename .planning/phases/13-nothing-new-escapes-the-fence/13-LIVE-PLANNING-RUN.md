# Phase 13: Live planning run (recorded artifact for success criterion 6)

**Status: NOT YET RECORDED — start on day one**

This file is a placeholder for a measurement, not the measurement. It is **not a blocking task**.
No plan in Phase 13 waits on it, and it starts on day one of the phase and runs in parallel with
every other plan. Phase verification reads the status line above: a "NOT YET RECORDED" status is
reported to the owner, never silently passed.

## Purpose

ROADMAP success criterion 6 requires "a live, credential-spending planning run [that] exists as a
recorded artifact showing the planner naming real files from the repository."

It serves **DRFT-01** (the planner declares each task's expected file-set, observed against a live
backend). DRFT-01's home is **Phase 15**. The hand-typed path field at
`packages/desktop/src/dispatch/WavePlanSheet.tsx` is not retired until this artifact exists, and
that retirement is explicitly **not planned in Phase 13**. PLAN-01's code path has only ever been
proven against a fake backend (D-REV-35); this artifact is the first evidence from a real one.

## Recording protocol

1. Start a real authoring or planning run against **this repository**, using the developer's own
   local `claude` credentials. In the app, the planning run starts from an epic with
   `dispatch_plan_generate`. The run spends real credentials; that is the point.
2. Capture, verbatim, in the "Recorded run" section below:
   - the run's **log path** (the `agent_runs.log_path` pointer for the run);
   - the **`agent_runs` row id** of the run;
   - the **verbatim list of repository file paths the planner named**, exactly as the plan stored
     them, with no edits, tidying or reordering.
3. Verify every claimed path with `git ls-files` (for example
   `git ls-files --error-unmatch <path>` per path, or `git ls-files | grep -Fx <path>`) and record
   the result beside each path.

## Acceptance bar

The planner names **real files that exist in the repository**, verified with `git ls-files`. A path
that is plausible-looking but absent from `git ls-files` is an invented path and counts against the
run, not for it. The run must be a transcript of what the planner actually produced.

**A hand-written description of what such a run would show does not satisfy this artifact.** A
fabricated or reconstructed entry would retire DRFT-01's hand-typed escape hatch on false evidence,
so it is worse than leaving the status as NOT YET RECORDED.

## Recorded run

_Nothing recorded yet. Paste the run id, the log path, the planner's verbatim file paths and the
`git ls-files` verification here, then change the status line at the top to
`RECORDED <date> — run <agent_runs id>`._

| Field | Value |
|---|---|
| `agent_runs` row id | _not recorded_ |
| Log path | _not recorded_ |
| Date and `claude` version | _not recorded_ |

| Path the planner named (verbatim) | In `git ls-files`? |
|---|---|
| _none recorded_ | _n/a_ |
