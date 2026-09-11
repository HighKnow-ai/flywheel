---
status: testing
phase: 02-one-agent-one-worktree-watched-live
source: [02-VERIFICATION.md]
started: 2026-09-11T05:52:53.211Z
updated: 2026-09-11T05:52:53.211Z
---

## Current Test

number: 1
name: Flat memory over a long real streaming session (PROC-07)
expected: |
  RSS stays flat while the persisted log keeps growing on disk.
awaiting: user response

## Tests

### 1. Flat memory over a long real streaming session (PROC-07)
expected: RSS stays flat while the persisted log keeps growing on disk.
how: Start a long-running real session on a real task, leave it streaming for several minutes, and watch RSS in Activity Monitor while the transcript grows on disk.
why_human: Real-process memory behavior over minutes cannot be observed by static analysis; explicitly manual-only per 02-VALIDATION.md. The CR-03 silent-drop defect that previously blocked this truth is now closed and tested — only the flat-RSS observation remains.
result: [pending]

### 2. Permission pause and resume through a real claude process (AGNT-06)
expected: The real claude process blocks on the MCP tool call and resumes correctly once answered.
how: Press Start Work on a task whose work needs a permission decision; confirm the board surfaces the request, the agent is genuinely blocked, and answering resumes the same turn rather than restarting it.
why_human: Crosses the renderer and a real spawned claude process. Note the recorded caveat — Claude Code's own bash safety heuristic was empirically found to bypass a configured --permission-prompt-tool for commands it judges read-only, even in --permission-mode default, which bears directly on whether this holds for all tool calls.
result: [pending]

### 3. Credential parity between local session and explicit API key (AGNT-03 / AGNT-04)
expected: No behavioral difference between the two credential paths; the key is present only in the child's environment.
how: Run the same task once under local Claude Code credentials and once with an explicit API key configured in Settings; confirm identical product behavior and that the key never appears in `ps` or the persisted session JSONL.
why_human: Requires two real credential configurations on one machine. Whether ANTHROPIC_API_KEY reliably overrides a present subscription session could not be measured in this environment (no spend-authorized key) and is recorded as a Phase 3 input.
result: [pending]

### 4. Bare-terminal stop walkthrough in the packaged app (WINDOWS.md row 3)
expected: Worktree intact and dirty exactly as the agent left it; no orphaned process under it.
how: Start a real session, press Stop, then from a bare terminal confirm the worktree directory and its uncommitted changes are intact and no claude (or descendant) process is still running.
why_human: Open unrun-verify item, .planning/WINDOWS.md row 3 — deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase. The underlying process-group-kill mechanism is proven by real multi-process tests; the packaged-app path has not been observed by a human.
result: [pending]

### 5. Settings surface walkthrough (WINDOWS.md row 7)
expected: All three entry points open the same Settings surface; the saved key is never re-rendered; a granted rule appears with its project and can be revoked.
how: Open Settings from the app menu, from ⌘, and from the command palette; save an API key and confirm it cannot be read back; grant an allow-always rule from a real permission request and confirm it appears in the table and can be revoked.
why_human: Open unrun-verify item, .planning/WINDOWS.md row 7 — deferred to end-of-phase UAT.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
