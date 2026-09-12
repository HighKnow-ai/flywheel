---
phase: 02-one-agent-one-worktree-watched-live
verified: 2026-09-12T10:15:00Z
status: human_needed
score: 6/6 truths supported by evidence (5 roadmap success criteria + 1 project-constraint truth); 0 failed; 0 formally present-behavior-unverified — 1 narrower human-verification item remains open (down from 2 at the last pass, and down from 5 in the pre-UAT report)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/WINDOWS.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-11-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-11-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-12-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-12-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-13-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-13-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-14-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-14-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-15-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-15-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-16-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-16-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-17-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-17-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-18-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-18-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-SECURITY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-UAT.md
  - packages/core/src/domain/agent_run.rs
  - packages/core/tests/agent_run_stop_ordering.rs
  - packages/core/tests/app_exit_ordering.rs
  - packages/core/tests/runtime_context_call_sites.rs
  - packages/core/tests/session_close_lifecycle.rs
  - packages/core/tests/session_closed_call_site.rs
  - packages/core/tests/task_delete_with_run_history.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/test/real-claude-argv.test.mjs
  - packages/sidecar/test/shutdown.test.mjs
  - packages/sidecar/test/stub-invocation.test.mjs
covered_digest: "v1:sha256:aa0120fd1253348e915349cbcec4a363cb7864335dfaefe6f7106973e833b38c"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: "3/6 truths verified (5 roadmap success criteria + 1 project-constraint truth; 0 failed, 3 present-behavior-unverified)"
  gaps_closed:
    - "G-02-1 (blocker): the dev-time sidecar stub resolved its entrypoint by a fixed parent-hop count that was only correct from its checked-in location, not the location tauri-plugin-shell actually runs it from — Start Work failed with 'failed to write request to the sidecar's stdin' on the very first live attempt. Closed by 02-15: the stub now walks up from its own symlink-resolved directory for a fixed marker, and spawn_sidecar performs a bounded ping/ack readiness handshake before returning Ok, so a dead sidecar aborts startup naming its own cause instead of surfacing minutes later. Proven by stub-invocation.test.mjs (3 tests, including a falsifiability case that reintroduces the fixed hop and watches it fail)."
    - "G-02-2 (blocker): buildClaudeArgv omitted --verbose, which the real CLI requires alongside --output-format stream-json under -p — every session died at seq 0 with no diagnostic, because the child's stderr was never drained. Closed by 02-17: the flag pairing is now behind a constraint-shaped regression guard (not a frozen array literal), the child's stderr is drained for the session's lifetime and carried onto SessionClosedEvent.detail, and real-claude-argv.test.mjs spawns the ACTUAL claude binary (2.1.236 on this machine) to prove the built argv is accepted and a one-element-shorter argv is rejected."
    - "G-02-3 (major): the session feed's virtual rows were positioned from a constant estimate but never clamped to it, so any row whose real content exceeded the estimate painted over every row beneath it — 'dozens of superimposed text layers'. Closed by 02-16: the virtual row wrapper now declares height: virtualRow.size + overflow: hidden, and text rows are truncated in JS (not just CSS-clipped) with a disclosure control that reveals the full text in place. Proven by a regression test that pushes a ~4.2KB event through the real feed and asserts no adjacent slot pair overlaps."
    - "G-02-4 (blocker, Core Value failure): close_agent_run — the only function that writes a terminal status, ended_at, cost and token counts — had NO production caller. A run that ended on its own (completed or failed) stayed running on the board forever. Closed by 02-18: apply_session_closed is now dispatched from the sidecar reader loop's session_closed branch, decides idempotency (never overwrites an explicit Stop, backfills a missing cost/token column via COALESCE), and tokens_in is the SUM of three input-side usage fields rather than the misleading plain field alone (which read 2 for a turn that actually cost ~33,000 input tokens). Proven by session_close_lifecycle.rs (spawns the real compiled sidecar to natural completion) and session_closed_call_site.rs (a falsifiable source-scanning gate on the call site itself). Independently confirmed LIVE during UAT test 1: run 01M27YR97ZZ01RHVREKNWH96ST reached status=completed, cost_usd=1.183256, tokens_in=1011934, tokens_out=7615, with the owning task correctly left in_progress per D-29."
    - "G-02-5 (blocker, regression introduced by 02-15's own fix): the readiness handshake constructed tokio::time::timeout(...) as a block_on call argument, outside any runtime context — Sleep registers with the timer driver at construction, so the app aborted on every launch with 'there is no reactor running... thread caused non-unwinding panic'. Every automated suite stayed green through this (220/220) because nothing constructs a real Tauri AppHandle inside the launch callback. Fixed directly (not its own gap-closure plan) by moving the timeout construction inside the async block, guarded by a new falsifiable source gate, runtime_context_call_sites.rs, which walks every .rs file under the desktop crate for a block_on(tokio::time::... construction and was proven to catch the exact regression by reverting and restoring the fix."
    - "T-02-42 (high, security): credential-precedence repudiation. Clause 1 (an operator-facing notice when subscription-vs-API-key precedence is unconfirmed) was added during the security audit — API_KEY_PRECEDENCE_NOTICE in SettingsSurface.tsx, tested."
    - "T-02G-17-03 (low, security, DoS): the stderr-tail bound was check-before-append, which one oversized line defeated. Fixed to append-then-truncate in both the Node sidecar (claude-code-adapter.ts) and the Rust reader loop, matching."
    - "A non-hermetic Keychain test (resolve_credential_falls_back_to_the_global_default_without_a_project_override) read the operator's real Keychain and asserted an unstated precondition ('no key is stored') that a human UAT run genuinely broke by storing a real key through Settings. Fixed during the security audit to take the serialization lock/guard and establish its own precondition rather than assume it."
  gaps_remaining: []
  regressions:
    - "G-02-5 (see gaps_closed) was introduced by 02-15's own fix for G-02-1 and fixed the same day, before this verification ran. Recorded for the audit trail, not as an open issue — the same failure shape as G-02-4 (a function proven correct in isolation, wrong at its only real call site) recurring inside a fix for a different gap, and every automated suite passed while the application could not start at all."
observed_since_last_verification:
  - "02-UAT.md ran to completion: 5/5 tests passed, 0 issues, 0 pending. All five items previously listed as human_verification in the pre-UAT report were exercised for real; two produced a clean, fully corroborated pass (permission gate pause/resume; PROC-07 short-session memory), and two produced a PASS with a partial, explicitly-flagged evidentiary gap (bare-terminal stop walkthrough; Settings walkthrough) that the prior version of this report reduced to two narrower human_verification items."
  - "02-SECURITY.md ran to completion: 84 threats, 82 closed, 2 open (both below the high block threshold, 0 blocking), threats_open: 0. At audit time, six mitigations — one of them T-02-24 at high severity — were verified by code reading only, never by observed production behavior, because the permission-rule grant/revoke path had never executed outside automated tests."
  - "All three suites and the TypeScript build were independently re-run by the prior pass of this verification (not read from any SUMMARY claim): cargo test --workspace -> 222/222 (0 failed); npm --prefix packages/sidecar test -> 39/39 (0 failed); npm --prefix packages/desktop test -> 314/314 (0 failed, 29 files); npm --prefix packages/desktop run build -> tsc + vite build exit 0, no error TS diagnostics. Not re-run this pass — no source file touched between passes, only two human-verification items were newly attempted, so a full-suite re-run would produce no new evidence."
  - "THIS PASS (2026-09-12): item 1 (allow-always permission rule) independently re-verified directly against the live database, not trusted from 02-SECURITY.md's or WINDOWS.md's own narrative. `select event_type, count(*) from events where event_type like '%rule%' group by event_type` returns permission_rule.granted 1, permission_rule.revoked 1. `select count(*) from permission_rules` returns 0 (consistent with granted-then-revoked, not never-granted). `select tool_name, status from permission_requests` returns 5 rows (up from test 5's 1), including one allowed_always row. All three figures match exactly what 02-SECURITY.md's 2026-09-12 update and WINDOWS.md row 7 claim. This closes the gap 02-UAT.md test 5 and its 2026-09-11T10:24 re-run both left open (permission_rules at 0 with only 1 permission_requests row and 0 %rule% events)."
  - "THIS PASS (2026-09-12): item 2 (Stop preserving uncommitted work) independently re-verified against the real worktrees, not trusted from WINDOWS.md's narrative alone. `git -C .../THRE-43 log --oneline -5` shows 1a59dbe docs: add stop-test marker line to README one commit ahead of b2b9c46 (the branch tip before it); `git rev-list --count main..HEAD` = 1; `git status --short` across all four live worktrees (THRE-33, THRE-38, THRE-43, THRE-53) returns 0 lines each. This confirms WINDOWS.md row 3's own characterization: the agent's edit survived the Stop, but only because it was committed before the kill landed — the working tree was already clean when Stop fired, so whether an UNCOMMITTED edit specifically survives a Stop remains unexercised. Recorded as PARTIAL, not resolved, per WINDOWS.md row 3 and 02-SECURITY.md's T-02-12 entry."
  - ".planning/REQUIREMENTS.md's per-requirement status table (lines ~217-271) still shows the inverse of the actual, code-verified state for this phase (DATA-04/WORK-01/WORK-02/WORK-08/LINK-01/AGNT-03/AGNT-04/AGNT-06 marked 'Gaps Found' while DATA-06/PROC-01/PROC-06/PROC-07/AGNT-01/AGNT-02 are marked 'Complete') — flagged in the pre-UAT report and still unreconciled. Doc-hygiene only; not evidence of a code regression."
  - ".planning/WINDOWS.md row 7 now reads 'FULLY OBSERVED 2026-09-12... This row is satisfied' in its description text, but its own `status` column (and the JSON mirror below the table) still literally reads `open` — the ledger's status field was never flipped to `fixed` to match its own updated narrative. Row 3's `status: open` is, by contrast, still accurate: its description itself says the claim is only 'ACCEPTED AS PARTIAL', not satisfied. Doc-hygiene only, but worth the orchestrator closing out row 7 with `gsd-tools windows fixed 7` now that this report independently confirms its claim."
gaps: []
deferred: []
human_verification:
  - test: "Start a real session, have the agent modify a tracked file WITHOUT committing it, confirm the uncommitted edit lands on disk, press Stop, and confirm from a bare terminal that the uncommitted edit is still present exactly as the agent left it (not just that the worktree directory and its process are gone, and not via a commit that survives regardless of what Stop does to the working tree)."
    expected: "The uncommitted edit is intact on disk after Stop — the stop path affects only the process group, never the working tree, even when there is an uncommitted diff to disturb."
    why_human: "WINDOWS.md row 3, narrowed. Both attempts to exercise this (02-UAT.md test 4, and the 2026-09-12 re-run this report just independently confirmed) ended with the agent's work already committed by the time Stop fired, so all four live worktrees (THRE-33, THRE-38, THRE-43, THRE-53) report 0 dirty entries — there was no uncommitted diff for the kill to preserve or destroy. A surviving commit at THRE-43 (1a59dbe, one ahead of main) does prove the stop path never resets, clobbers or rewinds the branch, which closes most of what T-02-12 (high severity, 02-SECURITY.md) asserts — but the narrower claim, whether Stop ever touches the working tree specifically, remains genuinely unexercised. Structurally guaranteed (the stop path issues no git commands) but never behaviorally observed. Recorded as PARTIAL rather than resolved because the tester's acceptance of a passing-but-incomplete test does not substitute for the missing observation — per this verifier's brief, it is held open rather than passed to be agreeable."
---

# Phase 2: One Agent, One Worktree, Watched Live — Verification Report (Re-Verification, post-UAT, post-security-audit, post-additional-human-observation)

**Phase Goal:** Cyril presses Start Work on a board task and watches a Claude Code session do that
task inside a git worktree that belongs to the task rather than to the session.

**Verified:** 2026-09-12T10:15:00Z
**Status:** human_needed
**Re-verification:** Yes — this updates a report written 2026-09-11T19:05:00Z (itself a
re-verification of one written 2026-09-11T13:55:00Z), in light of a further human attempt at the
two human-verification items that report left open.

**Mode note:** unchanged from prior reports — ROADMAP.md marks this phase `mode: mvp`, but its
`**Goal:**` line is not in `As a … I want to … so that …` user-story format, so this report
continues the standard goal-backward methodology against the roadmap's five numbered Success
Criteria.

## What changed since the last report (this update)

The 2026-09-11T19:05:00Z report left two narrow human-verification items open. Both have since
been attempted again by a human, with different outcomes, and this report re-assesses each
independently against the live database and the real worktrees on disk rather than trusting either
02-SECURITY.md's or WINDOWS.md's own narrative:

1. **Allow-always permission rule (WINDOWS.md row 7, clause 3) — NOW RESOLVED.** A real gated
   permission request was granted as an allow-always rule, the rule appeared, and it was revoked —
   all in production. Independently confirmed against `~/Library/Application Support/Flywheel/flywheel.db`:
   `permission_rule.granted` 1 and `permission_rule.revoked` 1 event rows; `permission_rules` at 0
   (consistent with grant-then-revoke, not never-granted); `permission_requests` grown from 1 to 5
   rows, including one `allowed_always` decision. This closes the item — five mitigations move from
   code-only to observed: T-02-04, **T-02-24 (high)**, T-02-27, T-02-45, T-02-47.
2. **Stop preserving an agent's uncommitted work (WINDOWS.md row 3) — STILL PARTIAL.** The tester's
   edit survived a Stop, but independent inspection shows the agent had committed it first
   (`THRE-43`, commit `1a59dbe`, one commit ahead of `main`) and all four live worktrees report 0
   dirty entries. The working tree was already clean when the kill landed, so there was nothing
   uncommitted for Stop to preserve or destroy. This is real, valuable evidence — it proves the stop
   path never resets, clobbers or rewinds the branch, which is most of what T-02-12 asserts — but it
   does not prove the narrower claim that the working tree specifically is left untouched. This item
   remains open, narrowed rather than closed, per the standing instruction not to pass a genuinely
   unexercised claim just because a human accepted the attempt as a pass.

Nothing else changed: no source file was touched between the two passes, so the full-suite
re-run recorded in the prior pass (`cargo test --workspace` 222/222, sidecar 39/39, desktop
314/314, clean TS build) was not repeated — it would produce no new evidence.

## Goal Achievement

### Independently Re-Run Evidence (this pass — database and worktree state, not trusted from any narrative)

| Check | Command | Result |
|---|---|---|
| Permission-rule event trail | `select event_type, count(*) from events where event_type like '%rule%' group by event_type` | `permission_rule.granted` 1, `permission_rule.revoked` 1 |
| Permission-rule table state | `select count(*) from permission_rules` | 0 (consistent with a rule granted then revoked) |
| Permission requests | `select tool_name, status from permission_requests` | 5 rows (up from 1 at UAT test 5): 2× `Bash allowed`, 1× `AskUserQuestion allowed_always`, 2× `Skill allowed` |
| THRE-43 commit history | `git -C .../THRE-43 log --oneline -5` | `1a59dbe docs: add stop-test marker line to README` one commit ahead of `b2b9c46` |
| THRE-43 commit count vs. main | `git -C .../THRE-43 rev-list --count main..HEAD` | 1 |
| All four live worktrees' dirty state | `git -C <worktree> status --short \| wc -l` for THRE-33, THRE-38, THRE-43, THRE-53 | 0 in every worktree |

### Independently Re-Run Evidence (prior pass, carried forward — not repeated this pass, no source changed)

| Check | Command | Result |
|---|---|---|
| Rust workspace suite | `cargo test --workspace` | **222 passed, 0 failed** across every crate/test binary (summed from each `test result:` line) |
| Sidecar (Node) suite | `npm --prefix packages/sidecar test` | **39 passed, 0 failed** (0 skipped, 0 cancelled) |
| Desktop (TS/React) suite | `npm --prefix packages/desktop test` | **314 passed, 0 failed** across 29 test files |
| Desktop TypeScript build | `npm --prefix packages/desktop run build` | `tsc && vite build` exits 0, no `error TS` diagnostics |
| Working tree state | `git status --short` | Clean — all claimed commits (`d548591`..`504d0ca`) are present in `git log`, nothing uncommitted |
| G-02-4 production call site | `grep handle_inbound_session_closed packages/desktop/src-tauri/src/sidecar.rs` | Present, dispatched in the reader loop below the existing `permission_request` dispatch |
| G-02-2 fix | `grep STDERR_DETAIL_MAX_CHARS packages/sidecar/src/claude-code-adapter.ts` | Present; append-then-truncate pattern confirmed by direct read (T-02G-17-03) |
| T-02-42 fix | `grep API_KEY_PRECEDENCE_NOTICE packages/desktop/src/settings/SettingsSurface.tsx` | Present, rendered in the Settings surface |
| G-02-5 fix + gate | `grep block_on packages/desktop/src-tauri/src/sidecar.rs`; `packages/core/tests/runtime_context_call_sites.rs` exists | Timeout now constructed inside the async block passed to `block_on`; the falsifiable source gate exists on disk |
| Debt markers in this round's touched files | `grep -nE "TBD\|FIXME\|XXX"` across all 10 files this round modified | **0 matches** |

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Worktree appears on a branch derived from the task identifier, chained to the epic integration branch, visible from a bare terminal | ✓ VERIFIED | Unaffected by any gap-closure round. `cargo test --workspace` re-run includes `branch_naming`/`worktree_lifecycle` — both pass against real scratch git repos. |
| 2 | User watches the agent's output stream live for a long session with flat memory | ✓ VERIFIED (qualified — short session only) | G-02-3's silent-panic/overlap defect is closed and gated. UAT test 1 then genuinely ran a real streaming session to natural completion (~2.5 min, 126 lines, 211 KB) and measured application RSS (APP+RENDER+SIDECAR) DECLINE by 64 MB from its early peak while the log grew monotonically — nothing tracked the transcript. UAT's own qualification: "PASSED ON A SHORT SESSION... The truth is SUPPORTED, not stress-tested. A multi-hour session remains the stronger evidence." This report preserves that qualification rather than reporting a clean pass. |
| 3 | Agent pauses on a permission request, user answers from the board, agent resumes | ✓ VERIFIED | UAT test 2 exercised the full pause/answer/resume path through a real spawned `claude` process for the first time (the gate fired on a read-only Bash command, and the previously-recorded bash-safety-heuristic bypass caveat did NOT reproduce on this build). The allow-always rule variant of the same feature — grant, list, revoke — was unexercised at UAT time but is now independently confirmed live (see this pass's evidence table above): `permission_rule.granted`/`.revoked` both 1, `permission_requests` up to 5 including an `allowed_always` decision. |
| 4 | User stops a session, worktree stays intact/inspectable, and a second session reuses it — the worktree outlives the session | ✓ VERIFIED — but see the residual human-verification item below | The stop-stranding defect (CR-04) and the app-exit orphan defect (CR-02) are closed and gated (`agent_run_stop_ordering.rs`, `app_exit_ordering.rs`, `shutdown.test.mjs`). UAT test 4 corroborated "worktree intact, no orphan process" independently via `pgrep` and direct filesystem inspection. A further human attempt (independently confirmed this pass) showed an agent's edit surviving a Stop — but the edit was already committed (`THRE-43`, `1a59dbe`) before the kill landed, and every live worktree reports 0 dirty entries. This proves the stop path never resets/clobbers/rewinds a branch, but the narrower claim — that Stop leaves an UNCOMMITTED edit untouched — remains genuinely unexercised and is carried forward as a human-verification item below rather than folded into this VERIFIED status. |
| 5 | Worktree, agent run and session are distinct linked records on the task; local-credential and API-key paths behave identically | ✓ VERIFIED (qualified) | The "distinct linked records" half and its previously-unguarded edge case (CR-01, task deletion with agent-run history) remain solidly proven (`task_delete_with_run_history.rs`, 3 tests). UAT test 3 measured the non-leak half independently of the tester (0 credential-shaped matches across 191 persisted JSONL lines; 0 of 11 argv elements credential-shaped) but the PARITY claim itself — identical product behavior under a subscription session vs. an explicit key — rests on the tester's own observation, not independent reproduction. Whether `ANTHROPIC_API_KEY` reliably *overrides* a present subscription session remains unmeasured in this environment (no spend-authorized key) and is explicitly recorded as a Phase 3 input, not a Phase 2 gap. |

**Score:** 5/5 roadmap success criteria supported by evidence; 0 failed. Two of the five (#2, #5)
carry explicit, load-bearing qualifications preserved above rather than smoothed into a clean pass;
#3 and #4 each had a narrower sub-claim genuinely unexercised as of the last pass — #3's is now
closed by direct evidence, #4's remains open.

### Additional Project-Constraint Truth (not one of the 5 numbered Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | CLAUDE.md hard architectural constraint: "killing orphans... at the OS-process-tree level" — no `claude` process should survive Flywheel quitting | ✓ VERIFIED | Unchanged from prior reports' mechanism (`shutdown_all_sessions()` before `kill()`, `shutdown.test.mjs` 4/4 against real spawned grandchildren), corroborated live: UAT test 4's `pgrep -fl 'flywheel-permissions'` found no match and no process of any kind living under either real task worktree after a Stop. |

**Combined score (6 truths):** 6/6 supported by evidence; 0 failed; 0 formally
`PRESENT_BEHAVIOR_UNVERIFIED` at the truth level. Overall status is `human_needed` anyway — see
Human Verification Required below — because **one** narrower, harvested sub-claim tied to truth #4
(whether Stop preserves specifically UNCOMMITTED work, not just an intact branch) remains genuinely
unexercised. The companion sub-claim, tied to truth #3 / AGNT-06 (the allow-always permission rule),
is resolved this pass by direct database evidence and is removed from the open list below.

### Required Artifacts (this round's gap-closure + security-remediation changes)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` | Entrypoint resolution that holds from both its checked-in location and the Tauri-copied location | ✓ VERIFIED | Walk-up marker resolution from the symlink-resolved physical directory; `stub-invocation.test.mjs` (3 tests) proves it, including a falsifiability case. |
| `packages/desktop/src-tauri/src/sidecar.rs` | Bounded `ping` readiness handshake in `spawn_sidecar`; `CommandEvent::Stderr/Terminated/Error` observed; `handle_inbound_session_closed` dispatch | ✓ VERIFIED | Read directly. `STARTUP_READINESS_TIMEOUT`/`READINESS_REQUEST_ID` present; `session_closed` dispatch present and positioned after both the persist call and the renderer emit. |
| `packages/sidecar/src/index.ts` | `ping` op, ack-only, no backend dependency | ✓ VERIFIED | Present; distinct from `capability_probe` by design (ping never gates startup on the user's `claude` binary). |
| `packages/sidecar/src/claude-code-adapter.ts` | `--verbose` paired with `--output-format stream-json`; drained child stderr; `STDERR_DETAIL_MAX_CHARS` append-then-truncate | ✓ VERIFIED | Read directly (lines ~440-464); confirmed append-then-truncate pattern, matching the Rust side's own fix. |
| `packages/sidecar/test/real-claude-argv.test.mjs` | First test spawning the real `claude` binary; falsifiability companion | ✓ VERIFIED | 2/2 passing, not skipped (real `claude` 2.1.236 present); SUMMARY records the negative case rejecting a one-element-shorter argv. |
| `packages/desktop/src/session/SessionSurface.tsx`, `FeedRow.tsx` | Virtual row wrapper clamped to `virtualRow.size` + `overflow: hidden`; JS-truncated collapsed text with a disclosure control | ✓ VERIFIED | `feed-row-slot`/`virtualRow.size` present on non-comment lines; repo-wide raw-hex gate returns `0`. |
| `packages/core/src/domain/agent_run.rs` | `apply_session_closed`, `SessionClosedOutcome` (idempotent against an explicit Stop) | ✓ VERIFIED | Read directly (lines ~276-380): `AlreadyTerminal`/`BackfilledTerminal` outcomes present; `close_agent_run`'s own body unchanged. |
| `packages/core/tests/session_close_lifecycle.rs`, `session_closed_call_site.rs` | Real-sidecar natural-completion test; falsifiable source gate on the call site | ✓ VERIFIED | Both exist and pass (confirmed by the prior pass's independent `cargo test --workspace` run). |
| `packages/core/tests/runtime_context_call_sites.rs` | Falsifiable gate against constructing a `tokio::time::` future as a `block_on` argument (G-02-5) | ✓ VERIFIED | Exists on disk; the fix it guards (`block_on(async { tokio::time::timeout(...).await })`) confirmed by direct read of `sidecar.rs`. |
| `packages/desktop/src/settings/SettingsSurface.tsx` | `API_KEY_PRECEDENCE_NOTICE` (T-02-42 clause 1) | ✓ VERIFIED | Present and rendered; tested in `settings-surface.test.tsx` per 02-SECURITY.md. |

All artifacts from the original 10 plans and the two gap-closure rounds (`02-01`..`02-18`) that
were previously VERIFIED remain unchanged and were not re-audited file-by-file this pass — no
source file changed between the last pass and this one.

### Key Link Verification (this round)

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `sidecar.rs` (reader loop) | `commands/agent_run.rs` (`handle_inbound_session_closed`) | Dispatch on `event.type == "session_closed"`, after persist + renderer emit | ✓ WIRED | Confirmed by direct read (`sidecar.rs:847-857`). |
| `commands/agent_run.rs` (`handle_inbound_session_closed`) | `domain/agent_run.rs` (`apply_session_closed`) | Direct call, panic-free region | ✓ WIRED | Confirmed by direct read; no `expect`/`unwrap`/`panic!` in the handler's region. |
| `sidecar.rs` (`spawn_sidecar`) | `packages/sidecar/src/index.ts` (`op: "ping"`) | Bounded readiness handshake before `spawn_sidecar` returns `Ok` | ✓ WIRED | Confirmed by direct read of both sides; `stub-invocation.test.mjs` proves it against the real Tauri-copied invocation path. |
| `claude-code-adapter.ts` (stderr readline) | `adapter.ts` (`SessionClosedEvent.detail`) | `stderrTail`, capped and carried onto the terminal event | ✓ WIRED | Confirmed by direct read; `SessionSurface.tsx` renders `detail` beneath the terminal row's machine-detail line (tested). |
| `main.rs` (`RunEvent::Exit`) | `sidecar.rs` (`shutdown_all_sessions`, then `kill()`) | Sequential, shutdown before kill | ✓ WIRED (unchanged) | `app_exit_ordering.rs` passing; corroborated live by UAT test 4's `pgrep` finding nothing. |
| Board (`permission_requests` answer, decision=`allow_always`) | `permission_rules` table + `matching_rule` read path | Grant writes a row; `matching_rule` reads it on a subsequent matching request; revoke removes it | ✓ WIRED — now observed | Structurally proven pre-pass by `answering_allow_always_writes_the_answered_row_and_exactly_one_permission_rule` and `a_matching_allow_rule_auto_resolves_with_no_pending_row`; this pass independently confirms the real-world round trip executed: `permission_rule.granted` 1, `permission_rule.revoked` 1, `permission_rules` back to 0. |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| DATA-04 | Generic trigger record, `user_action` implemented | ✓ SATISFIED | Unchanged. |
| DATA-06 | Worktrees/runs/sessions as first-class records | ✓ SATISFIED | Unchanged + strengthened: `apply_session_closed` now correctly writes the run's terminal state. |
| WORK-01/02/08, LINK-01 | Worktree creation, branch topology, persistence, naming | ✓ SATISFIED | Unchanged; SC1 above. |
| PROC-01 | Each session a separate OS process in its own worktree | ✓ SATISFIED | Unchanged, and its startup-liveness boundary is now proven (G-02-1's readiness handshake). |
| PROC-02 | Supervisor never reads its own cwd | ✓ SATISFIED | Unchanged. |
| PROC-06 | Interrupt/stop leaves the worktree consistent | ✓ SATISFIED — see human-verification item on the uncommitted-work half | Mechanism proven; branch-integrity half now independently corroborated live (a surviving commit was never reset/clobbered/rewound); the specific "an uncommitted edit survives exactly as left" claim still not observed. |
| PROC-07 | Live streaming without unbounded memory growth | ✓ SATISFIED (qualified — short session) | G-02-3 closed; UAT test 1 measured a real short session; long-session stress observation not yet performed. |
| AGNT-01, AGNT-02 | Single adapter interface; normalises stream-json | ✓ SATISFIED | Strengthened this round — the argv the adapter builds is now proven against the REAL CLI, not just an internal fake. |
| AGNT-03, AGNT-04 | Local credentials / explicit API key | ✓ SATISFIED (qualified) | Non-leak independently measured; parity observed but not independently reproduced; precedence-override unmeasurable here, explicit Phase 3 input. |
| AGNT-06 | Permission requests block until answered | ✓ SATISFIED | The pause/answer/resume core was proven end-to-end at UAT; the allow-always rule grant/revoke half of the same feature (D-39), previously unexercised, is now independently confirmed live this pass (see Key Link Verification above). No longer carries an open human-verification item. |

No orphaned requirements — all 15 IDs mapped to this phase are declared in at least one plan's
frontmatter (`02-01` through `02-18`).

**Advisory (documentation hygiene, carried forward unresolved):** `.planning/REQUIREMENTS.md`'s
per-requirement status table still shows the inverse of the actual, code-verified state for this
phase (see `observed_since_last_verification` in frontmatter). Not evidence of a code regression —
should be reconciled by the orchestrator.

**Advisory (ledger hygiene, updated this pass):** `.planning/WINDOWS.md` row 7's description text
now reads "This row is satisfied" (2026-09-12), and this report independently confirms that claim —
but the row's own `status` column (and its JSON mirror) still literally reads `open`. The ledger was
never flipped to `fixed` to match its own updated narrative; the orchestrator should run
`gsd-tools windows fixed 7` now that this report corroborates it independently. Row 3's `status:
open` is, by contrast, still accurate — its own description says the claim was only "ACCEPTED AS
PARTIAL," and this report agrees it remains open.

**Advisory (security audit hygiene, carried forward):** No `## Threat Flags` section exists in any
of the 18 `*-SUMMARY.md` files for this phase (per 02-SECURITY.md's "Findings outside the
register"). Treat the absence of threat flags across this phase's plans as **unrecorded**, not as
**none found** — the one self-disclosed mitigation gap that does exist (T-02-37) was filed under a
non-standard `## Known Stubs` heading instead, where a `## Threat Flags`-scoped reader would have
missed it entirely.

### Anti-Patterns Found

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found in any of the ten files the
prior gap-closure and security-remediation round touched. No new stub patterns (empty handlers,
hardcoded-empty rendered props, silent panics reintroduced) found. No source file was touched
between the prior pass and this one, so this scan was not re-run — it would produce no new
evidence. The three `ℹ️ Info`-level items from the pre-UAT report (stale `deferred-items.md`/
WINDOWS.md row 4 wording, the pre-existing `FLYWHEEL_WORKTREE_ROOT` test race at WINDOWS.md row 2,
and the Phase-3-deferred `WorktreeSummary.tsx` disk-existence gap at row 6) are unrelated to this
round's changes and carried forward unchanged.

### Behavioral Spot-Checks

Not re-run this pass — no source file changed between the prior pass (which independently re-ran
the full test suites and build; see the carried-forward evidence table above) and this one. This
pass's checks were database and worktree-state inspection (see the "this pass" evidence table
above), which are the correct instrument for the two items being re-assessed — neither is a code
change.

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventions or phase-declared probes found for this phase. Skipped.

### Human Verification Required

See `human_verification` in frontmatter — **1 item** (down from 2 at the prior pass, and down from
5 in the pre-UAT report):

1. **A Stop preserves an agent's specifically UNCOMMITTED work, not just an intact branch and no
   orphan process** (WINDOWS.md row 3, narrowed). Two independent human attempts (02-UAT.md test 4,
   and a further 2026-09-12 attempt independently confirmed by this report) both ended with the
   agent's edit already committed before Stop fired, so all four live worktrees report 0 dirty
   entries — there was no uncommitted diff for the kill to preserve or destroy. The surviving commit
   IS real evidence that the stop path never resets, clobbers or rewinds a branch (most of what
   T-02-12, high severity, `02-SECURITY.md` asserts), but the narrower claim — that an uncommitted
   edit specifically is left untouched — remains genuinely unexercised. Structurally guaranteed (the
   stop path issues no git commands) but never behaviorally observed. This item is held open rather
   than passed to be agreeable, per this verification's own brief: a human accepting a partial
   result as "pass" does not substitute for the missing observation.

**Resolved this pass and removed from the list:** the allow-always permission rule (grant, list,
revoke) — previously item 1 in the prior pass's list, tied to **T-02-24 (high severity)** — is now
independently confirmed executed in production against the live database (`permission_rule.granted`
1, `permission_rule.revoked` 1, `permission_requests` up to 5 including one `allowed_always`
decision). See the Key Link Verification and Requirements Coverage sections above.

### Gaps Summary

**No gaps remain.** All five defects found by human UAT (G-02-1 through G-02-5) are independently
re-confirmed closed against the code on disk and the currently-passing, independently-re-run test
suites — not trusted from any plan's own SUMMARY.md claim. The security audit closed with
`threats_open: 0` (two open threats, both below the `high` block threshold, zero blocking).

The reason overall status remains `human_needed` rather than `passed` is exclusively the one item
above: a genuinely unexercised behavioral claim about whether Stop preserves specifically
uncommitted work, narrower than before but not yet closed. Its sibling item — the allow-always
permission rule, previously tied to a `high`-severity security control that had never run in
production — is now resolved by direct evidence and no longer contributes to the `human_needed`
status. Per the routing rule this agent follows: any non-empty human-verification section means the
correct status is `human_needed`, not `passed`, even though every roadmap Success Criterion has
supporting evidence and the full automated suite (cargo 222/222, sidecar 39/39, desktop 314/314,
clean TS build) remains green.

Three items remain worth the orchestrator's attention: `.planning/REQUIREMENTS.md`'s
per-requirement status table still shows the inverse of the actual, code-verified state (unreconciled,
carried forward across two passes now); `.planning/WINDOWS.md` row 7 should be marked `fixed` in the
ledger (its own text already says "satisfied," and this report independently agrees); and no
`*-SUMMARY.md` in this phase carries a `## Threat Flags` section, so the absence of flagged new
attack surface across all 18 plans should be read as unrecorded, not as none found.

---

_Verified: 2026-09-12T10:15:00Z_
_Verifier: Claude (gsd-verifier)_
