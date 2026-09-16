---
status: testing
phase: 03-nothing-lost-nothing-left-running
source: [03-VERIFICATION.md]
started: 2026-09-16T05:59:55.179Z
updated: 2026-09-16T05:59:55.179Z
---

## Current Test

number: 1
name: Supervisor kill -9 leaves no surviving agent process
expected: |
  No orphaned agent process in the OS process table; a kill record naming run id,
  pid, reason and timestamp exists under `<app-data>/runtime/kills/`.
awaiting: user response

## Tests

### 1. Supervisor `kill -9` leaves no surviving agent process (SC2, PROC-03/PROC-04)
expected: With Flywheel running and one agent session live, kill the supervisor with `kill -9 <pid>` (not Quit). Within ~20s no `claude` process from that session survives in `ps -ax`, and a kill record naming run id, pid, reason and timestamp exists under `<app-data>/runtime/kills/`.
result: [pending]

### 2. Crash relaunch surfaces every orphan and repairs nothing silently (SC3, PROC-05, WORK-06)
expected: Force-quit Flywheel while a session runs, then relaunch. The orphan recovery modal blocks the board (no Escape, no click-outside dismissal), per-row Kill resolves each row, Kill All resolves the rest, and the board becomes reachable only once the list is empty. The run then shows Abandoned with the watchdog's own reason, and Acknowledge clears it.
result: [pending]

### 3. Destructive gate stops a live auto-accept session (SC5, AGNT-07)
expected: Start a real session on a scratch repository in an auto-accept permission mode and instruct the agent to force-push, or to delete a remote branch (`git push --delete`). The board shows a pending permission request, the session sits blocked rather than proceeding, and the remote branch/ref is unchanged. Denying it surfaces a clear refusal to the agent, not a bare non-zero exit.
result: [pending]

### 4. Destructive card renders correctly in a live session (SC5, AGNT-07)
expected: With a real session in auto-accept mode, have the agent attempt two different destructive categories in turn, including a push-shaped branch deletion. The card shows the stop-sign glyph, the correct consequence sentence naming the deleted BRANCH (not the remote) for the push-shaped case, Deny filled/primary, Allow outline/secondary reading "just this once", and no allow-always option anywhere — including the Settings permission-rules table after answering Allow.
result: [pending]

### 5. Ten concurrent commits through the packaged app keep every commit (SC4, WORK-04/WORK-05)
expected: In the packaged application, drive ten concurrent commits into worktrees of one repository through a live agent session (not just the automated stress harness). All ten commits are reachable, and the agent's own git invocations resolve through the installed PATH shim rather than a bare system git.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
