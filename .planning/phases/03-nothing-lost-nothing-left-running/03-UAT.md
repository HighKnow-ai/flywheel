---
status: testing
phase: 03-nothing-lost-nothing-left-running
source: [03-VERIFICATION.md]
harness: scripts/uat/ (added by quick task 260918-nch)
started: 2026-09-16T05:59:55.179Z
updated: 2026-09-18T10:20:00Z
---

## Current Test

number: 4
name: Destructive card renders correctly in a live session
expected: |
  Stop-sign glyph, a consequence sentence naming the deleted BRANCH (not the remote),
  Deny filled/primary, Allow outline/secondary reading "just this once", and no
  allow-always option anywhere.
awaiting: user response (visual — run `bash scripts/uat/uat-ui-setup.sh destructive`)

## Tests

### 1. Supervisor `kill -9` leaves no surviving agent process (SC2, PROC-03/PROC-04)
expected: With Flywheel running and one agent session live, kill the supervisor with `kill -9 <pid>` (not Quit). Within ~20s no `claude` process from that session survives in `ps -ax`, and a kill record naming run id, pid, reason and timestamp exists under `<app-data>/runtime/kills/`.
result: pass
source: automated
harness: scripts/uat/uat-01-supervisor-kill.sh
evidence: |
  The watchdog force-kills the session's whole process group within one stale window
  and writes a kill record naming run_id, pid, start_time, reason=heartbeat-stale and
  killed_at. Falsifiability-checked: the group is asserted alive before the kill.
  Scope note: the leaf of the process tree is a long-lived stub, because claude 2.1.267
  refuses `sleep 240` under its own tool policy and its turn ends at ~16s — below the
  15s stale window. Everything above the leaf is the real product.

### 2. Crash relaunch surfaces every orphan and repairs nothing silently (SC3, PROC-05, WORK-06)
expected: Force-quit Flywheel while a session runs, then relaunch. The orphan recovery modal blocks the board (no Escape, no click-outside dismissal), per-row Kill resolves each row, Kill All resolves the rest, and the board becomes reachable only once the list is empty. The run then shows Abandoned with the watchdog's own reason, and Acknowledge clears it.
result: pass
source: human + harness
harness: scripts/uat/uat-ui-setup.sh orphan
evidence: |
  Confirmed against the real application, seeded with a genuinely live orphan.
  - The recovery modal appeared naming exactly the live orphan, blocking the board.
  - Escape did nothing (driven by the harness, screenshot-verified before and after).
  - Only Kill and Kill All were offered — no resume or adopt affordance anywhere.
  - Kill resolved the row; the board became reachable.
  - Verified underneath the UI: the stand-in process is gone, agent_runs.status is
    `abandoned`, and the recorded event reason is `killed-by-user-at-launch`.
  - The run displayed Abandoned with its reason, and Acknowledge cleared it.
  Not separately isolated: click-outside-to-dismiss was not exercised as its own step
  apart from the general blocking behaviour, which did hold throughout.
  Harness note: the modal is rendered through a portal and does NOT appear in the macOS
  accessibility tree, so it must be confirmed from pixels, not from the tree.

### 3. Destructive gate stops a live auto-accept session (SC5, AGNT-07)
expected: Start a real session on a scratch repository in an auto-accept permission mode and instruct the agent to force-push, or to delete a remote branch (`git push --delete`). The board shows a pending permission request, the session sits blocked rather than proceeding, and the remote branch/ref is unchanged. Denying it surfaces a clear refusal to the agent, not a bare non-zero exit.
result: issue
source: automated
harness: scripts/uat/uat-03-destructive-gate.mjs
reported: "Measured live against claude 2.1.267, twice. Safety holds: the remote branch is unchanged and the agent receives 'This would delete a branch.' rather than a bare non-zero exit. But no permission_request is ever raised and the session never blocks on a human — the tool result reads non_execution_kind: 'permission-rule'. The PreToolUse hook (matcher: 'Bash', WIRED_DECISION = 'deny') refuses the command outright, and because it classifies via the shim's own --classify-command mode it refuses precisely the set the shim's socket would have asked about, so D-58's indefinite block is unreachable for anything the agent runs through Bash."
severity: major

### 4. Destructive card renders correctly in a live session (SC5, AGNT-07)
expected: With a real session in auto-accept mode, have the agent attempt two different destructive categories in turn, including a push-shaped branch deletion. The card shows the stop-sign glyph, the correct consequence sentence naming the deleted BRANCH (not the remote) for the push-shaped case, Deny filled/primary, Allow outline/secondary reading "just this once", and no allow-always option anywhere — including the Settings permission-rules table after answering Allow.
result: [pending]
blocked_by: visual-judgement
precondition: "bash scripts/uat/uat-ui-setup.sh destructive — stands the real app up against a scratch database already holding a pending branch-deletion request"
note: "Test 3's finding means a live session will not produce this card by itself; the precondition script seeds the pending request directly so the card can still be inspected." 

### 5. Ten concurrent commits through the packaged app keep every commit (SC4, WORK-04/WORK-05)
expected: In the packaged application, drive ten concurrent commits into worktrees of one repository through a live agent session (not just the automated stress harness). All ten commits are reachable, and the agent's own git invocations resolve through the installed PATH shim rather than a bare system git.
result: pass
source: automated
harness: scripts/uat/uat-05-concurrent-commits.mjs
evidence: |
  All ten commits reachable and carrying their payload; zero shim retry-budget
  exhaustions. Shim resolution proven by the agent's OWN shell writing `command -v git`
  to a file the harness reads back — it resolved to the per-run shim directory, not a
  bare system git.
  Scope note: driven through a real claude session, not through the packaged .app
  bundle (none is built). The session, sidecar, adapter, shim and process tree are all
  the real product.

## Summary

total: 5
passed: 3
issues: 1
pending: 1
skipped: 0
blocked: 0

## Gaps

- gap_id: G-03-3
  truth: "A destructive action in an auto-accept session raises a pending permission request and blocks the session until a human answers (SC5, AGNT-07)."
  status: failed
  reason: "User-facing behaviour measured by scripts/uat/uat-03-destructive-gate.mjs against claude 2.1.267: the action is blocked and explained (safety holds, remote ref unchanged), but no permission_request is raised and the session never blocks on a human. The tool result reads non_execution_kind: 'permission-rule'."
  severity: major
  test: 3
  root_cause: "claude-code-adapter.ts::writeHookSettings wires the PreToolUse hook with matcher 'Bash' — every Bash tool call — and pretooluse-hook.ts returns permissionDecision 'deny' for every non-safe verdict from the shim's own --classify-command classifier. Hook and shim consult the SAME classifier, so the hook refuses precisely the set the shim's socket would have asked a human about, and D-58's indefinite block never runs. pretooluse-hook.ts's own doc comment scopes this residual gap to absolute-path invocations only; the measured scope is every Bash command."
  artifacts:
    - path: "packages/sidecar/src/pretooluse-hook.ts"
      issue: "WIRED_DECISION = 'deny' makes this a refusal layer for ALL Bash commands, not only the absolute-path class its doc comment claims"
    - path: "packages/sidecar/src/claude-code-adapter.ts"
      issue: "writeHookSettings registers the hook with matcher 'Bash', so it pre-empts the shim's socket for every agent shell command"
  missing:
    - "A decision on whether the gate should ASK (hook returns a value that defers to the shim's socket, or the hook itself opens the socket) or whether AGNT-07's 'asks a human' claim should be narrowed to match the shipped refusal behaviour"
  debug_session: ""

