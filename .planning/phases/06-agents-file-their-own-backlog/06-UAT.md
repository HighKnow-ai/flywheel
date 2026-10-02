---
status: passed
phase: 06-agents-file-their-own-backlog
source: [06-VERIFICATION.md]
started: 2026-10-02T04:35:00Z
updated: 2026-10-02T04:36:00Z
---

## Current Test

number: 1
name: Live-agent half of Criterion 1 — a real `claude` session's own `propose_item` call
expected: |
  Per-criterion report marks Criterion 1 `observed` (a real agent's own `propose_item` call
  staged a pending row, no promotion occurred) and all five criteria end `observed`, none
  silently un-measured.
awaiting: nothing — executed by the harness

## Tests

### 1. Run `node scripts/uat/uat-10-agent-backlog.mjs --live` with a real `claude` binary
expected: Per-criterion report marks Criterion 1 `observed` and all five criteria end `observed`, none `not-measured`.
result: passed

Executed 2026-10-02 by the execute-phase orchestrator rather than by hand, per the project's
standing preference for a runnable harness over a manual walkthrough. The script is the phase's
own ship gate (plan 06-09) and the `--live` arm spends exactly one real model call.

Observed:
- A real `claude` execution-run session called `propose_item` once, mid-session, of its own
  accord — run `01M3XEAQ8AHRCJEXG4MNH5JBMF`, proposal `01M3XEB5Q5KH9AAX28J6BCE0GE`,
  title "Fix flaky retry test that drops events under load", with the model's own rationale
  recorded on the row.
- Criterion 2: all four triage verbs exercised end to end through the real domain functions —
  accept minted a task, reject marked rejected, merge minted a child issue while the seeded
  task row stayed unchanged (tasks stayed at 2), defer minted nothing and appeared in
  `list-deferred`.
- Criterion 3: the deferred proposal's rationale round-tripped verbatim through `list-deferred`.
- Criterion 4: a near-duplicate carried `duplicateOf=01M3XEB5Q5KH9AAX28J6BCE0GE`,
  `duplicateScore=-213.73` on the staged row before any triage decision.
- Criterion 5: the 11th proposal was refused naming the limit (10); `limit-notices` reported
  exactly one notice (`refusedCount=1`) for the run.

Artifact: `agent-backlog-live-2026-10-02T04-35-46-347Z-session-timeline.json`

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None.
