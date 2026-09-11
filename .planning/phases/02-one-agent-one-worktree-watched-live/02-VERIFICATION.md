---
phase: 02-one-agent-one-worktree-watched-live
verified: 2026-09-11T19:05:00Z
status: human_needed
score: 6/6 truths supported by evidence (5 roadmap success criteria + 1 project-constraint truth); 0 failed; 0 formally present-behavior-unverified — but 2 narrower, harvested human-verification items remain open (down from 5 in the pre-UAT report)
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
covered_digest: "v1:sha256:e0951685399976b0559b2398f86c13c7e6773961177ca9a111a167a236b11515"
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
  - "02-UAT.md ran to completion: 5/5 tests passed, 0 issues, 0 pending. All five items previously listed as human_verification in the pre-UAT report were exercised for real; two produced a clean, fully corroborated pass (permission gate pause/resume; PROC-07 short-session memory), and two produced a PASS with a partial, explicitly-flagged evidentiary gap (bare-terminal stop walkthrough; Settings walkthrough) that this report reduces to two narrower human_verification items below rather than either hiding or reopening the whole original five."
  - "02-SECURITY.md ran to completion: 84 threats, 82 closed, 2 open (both below the high block threshold, 0 blocking), threats_open: 0. Six mitigations — one of them T-02-24 at high severity — are verified by code reading only, never by observed production behavior, because the permission-rule grant/revoke path has never executed outside automated tests (permission_rules: 0 rows; 0 %rule% events of any kind)."
  - "All three suites and the TypeScript build were independently re-run by this verification (not read from any SUMMARY claim): cargo test --workspace -> 222/222 (0 failed); npm --prefix packages/sidecar test -> 39/39 (0 failed); npm --prefix packages/desktop test -> 314/314 (0 failed, 29 files); npm --prefix packages/desktop run build -> tsc + vite build exit 0, no error TS diagnostics."
  - ".planning/REQUIREMENTS.md's per-requirement status table (lines ~217-271) still shows the inverse of the actual, code-verified state for this phase (DATA-04/WORK-01/WORK-02/WORK-08/LINK-01/AGNT-03/AGNT-04/AGNT-06 marked 'Gaps Found' while DATA-06/PROC-01/PROC-06/PROC-07/AGNT-01/AGNT-02 are marked 'Complete') — flagged in the pre-UAT report and still unreconciled. Doc-hygiene only; not evidence of a code regression."
  - ".planning/WINDOWS.md rows 3 and 7 (the two unrun-verify items this report's harvested human_verification items descend from) are still marked status: open in the ledger even though 02-UAT.md ran and partially corroborated both — the ledger was not updated after UAT completed. Neither row should be marked fixed outright (each still has a genuinely unevidenced clause), but the ledger's 'has not been observed by a human' wording is now stale and should be tightened to name the specific unevidenced clause."
gaps: []
deferred: []
human_verification:
  - test: "From a real, previously-answered permission request, grant an allow-always rule, confirm it appears in the rules table with its project, then revoke it."
    expected: "The rule is created (a new permission_rules row scoped to project_id + tool_name), appears attributable in the Settings table, and revoking it removes the row (or marks it revoked) such that a subsequent matching request is gated again."
    why_human: "WINDOWS.md row 7, clause 3. Structurally proven by automated tests (answering_allow_always_writes_the_answered_row_and_exactly_one_permission_rule, a_matching_allow_rule_auto_resolves_with_no_pending_row) and by the UNIQUE (project_id, tool_name) constraint, but never once executed in production: two independent UAT attempts (2026-09-11, an initial pass and a deliberate re-run) both failed to raise a second gated call to grant a rule from — permission_rules holds 0 rows and there are 0 %rule% events of any kind on the live board. Ties directly to T-02-24 (high severity, 02-SECURITY.md) — the cross-project scope constraint's structural half is unbypassable, but matching_rule's real-world read path has never returned a real rule. Standing recommendation from both 02-UAT.md and 02-SECURITY.md: do not consider this closed on the code-reading evidence alone."
  - test: "Start a real session, have the agent modify a tracked file, confirm the edit lands on disk, press Stop, and confirm from a bare terminal that the uncommitted edit is still present exactly as the agent left it (not just that the worktree directory and its process are gone)."
    expected: "The uncommitted edit is intact on disk after Stop — the stop path affects only the process group, never the working tree."
    why_human: "WINDOWS.md row 3, second clause. The 'worktree intact, no orphan process' half IS corroborated (pgrep found nothing under either worktree; both worktrees present on their task branches) — but at UAT verification time both worktrees were already clean (0 dirty entries), so the specific claim that a Stop preserves an agent's UNCOMMITTED work was never exercised. Structurally guaranteed (the stop path issues no git commands — T-02-12, 02-SECURITY.md, high severity) but never behaviorally observed. UAT's own note calls this 'the half most likely to regress silently, since it depends on the kill never touching the working tree' and recommends re-running deliberately."
---

# Phase 2: One Agent, One Worktree, Watched Live — Verification Report (Re-Verification, post-UAT and post-security-audit)

**Phase Goal:** Cyril presses Start Work on a board task and watches a Claude Code session do that
task inside a git worktree that belongs to the task rather than to the session.

**Verified:** 2026-09-11T19:05:00Z
**Status:** human_needed
**Re-verification:** Yes — this replaces a report written 2026-09-11T13:55:00Z, before plans
02-15..02-18 (four gap-closure plans triggered by human UAT findings G-02-1..G-02-4), a direct
fix for a fifth regression (G-02-5), a completed human UAT round (`02-UAT.md`, 5/5 passed), and a
completed security audit (`02-SECURITY.md`, 84 threats, threats_open: 0) all existed.

**Mode note:** unchanged from the prior report — ROADMAP.md marks this phase `mode: mvp`, but its
`**Goal:**` line is not in `As a … I want to … so that …` user-story format, so this report
continues the standard goal-backward methodology against the roadmap's five numbered Success
Criteria.

## What changed since the stale report

The prior report (`status: human_needed`, `3/6` truths cleanly verified, 3 present-behavior-
unverified) was written immediately after the second code-review round and BEFORE any human ever
ran the application. The first human UAT session found it did not work at all: Start Work failed
on the very first attempt (G-02-1), then failed differently after that fix (G-02-2), then rendered
unreadably once a session finally streamed (G-02-3), then — on the run that finally worked
end-to-end — proved the board never recorded a run's completion (G-02-4, "the Core Value failing,
not a cosmetic gap" per the UAT record itself). A fifth defect (G-02-5) was a regression introduced
by the first fix and aborted application startup entirely; every automated suite (220/220) stayed
green throughout, because none of these five defects were reachable by anything short of running
the real, packaged application.

All five are independently re-confirmed closed below — not trusted from any plan's own SUMMARY.md
claim — by re-reading the fix, re-running its dedicated test(s), and re-running the full workspace
suites once each. UAT then resumed and ran to completion (5/5 passed), and a full security audit
(84 threats) closed with `threats_open: 0`.

**This report does not launder that history into a uniform "passed."** Two narrow, previously-
unraised sub-claims — both explicitly flagged by UAT and by the security audit as unevidenced
despite genuine attempts to exercise them — are carried forward as `human_verification` items
below, and one of them concerns a `high`-severity, never-executed security control (T-02-24).

## Goal Achievement

### Independently Re-Run Evidence (not trusted from any SUMMARY.md claim)

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
| 1 | Worktree appears on a branch derived from the task identifier, chained to the epic integration branch, visible from a bare terminal | ✓ VERIFIED | Unaffected by any gap-closure round. `cargo test --workspace` re-run above includes `branch_naming`/`worktree_lifecycle` — both pass against real scratch git repos. |
| 2 | User watches the agent's output stream live for a long session with flat memory | ✓ VERIFIED (qualified — short session only) | G-02-3's silent-panic/overlap defect is closed and gated. UAT test 1 then genuinely ran a real streaming session to natural completion (~2.5 min, 126 lines, 211 KB) and measured application RSS (APP+RENDER+SIDECAR) DECLINE by 64 MB from its early peak while the log grew monotonically — nothing tracked the transcript. UAT's own qualification: "PASSED ON A SHORT SESSION... The truth is SUPPORTED, not stress-tested. A multi-hour session remains the stronger evidence." This report preserves that qualification rather than reporting a clean pass. |
| 3 | Agent pauses on a permission request, user answers from the board, agent resumes | ✓ VERIFIED | UAT test 2 exercised the full path through a real spawned `claude` process for the first time: the run was gated on a Bash tool call, the board surfaced `permission_requests` with the pending row, answering it produced exactly one `permission_request.raised` and one `permission_request.answered` event, and the run resumed. Notably the gate fired on a **read-only** `git status`/`git log` Bash command — the previously-recorded Claude Code bash-safety-heuristic bypass caveat did NOT reproduce on this build, downgraded from "open risk" to "did not reproduce, once." |
| 4 | User stops a session, worktree stays intact/inspectable, and a second session reuses it — the worktree outlives the session | ✓ VERIFIED — but see the residual human-verification item below | The stop-stranding defect (CR-04) and the app-exit orphan defect (CR-02) are closed and gated (`agent_run_stop_ordering.rs`, `app_exit_ordering.rs`, `shutdown.test.mjs`). UAT test 4 corroborated "worktree intact, no orphan process" independently via `pgrep` and direct filesystem inspection of both real worktrees. **Not corroborated:** at UAT verification time both worktrees were already clean (0 dirty entries), so the specific claim that a Stop preserves an agent's *uncommitted* work was never exercised — carried forward as a human-verification item below rather than silently folded into this VERIFIED status. |
| 5 | Worktree, agent run and session are distinct linked records on the task; local-credential and API-key paths behave identically | ✓ VERIFIED (qualified) | The "distinct linked records" half and its previously-unguarded edge case (CR-01, task deletion with agent-run history) remain solidly proven (`task_delete_with_run_history.rs`, 3 tests). UAT test 3 measured the non-leak half independently of the tester (0 credential-shaped matches across 191 persisted JSONL lines; 0 of 11 argv elements credential-shaped) but the PARITY claim itself — identical product behavior under a subscription session vs. an explicit key — rests on the tester's own observation, not independent reproduction. Whether `ANTHROPIC_API_KEY` reliably *overrides* a present subscription session remains unmeasured in this environment (no spend-authorized key) and is explicitly recorded as a Phase 3 input, not a Phase 2 gap. |

**Score:** 5/5 roadmap success criteria supported by evidence (up from 2/5 fully unqualified + 3
present-behavior-unverified in the pre-UAT report); 0 failed. Two of the five (#2, #5) carry
explicit, load-bearing qualifications that are preserved above rather than smoothed into a clean
pass.

### Additional Project-Constraint Truth (not one of the 5 numbered Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | CLAUDE.md hard architectural constraint: "killing orphans... at the OS-process-tree level" — no `claude` process should survive Flywheel quitting | ✓ VERIFIED | Unchanged from the pre-UAT report's mechanism (`shutdown_all_sessions()` before `kill()`, `shutdown.test.mjs` 4/4 against real spawned grandchildren), now additionally corroborated live: UAT test 4's `pgrep -fl 'flywheel-permissions'` found no match and no process of any kind living under either real task worktree after a Stop. |

**Combined score (6 truths):** 6/6 supported by evidence; 0 failed; 0 formally
`PRESENT_BEHAVIOR_UNVERIFIED` at the truth level. Overall status is `human_needed` anyway — see
Human Verification Required below — because two narrower, harvested sub-claims tied to truths #4
and to the permission-rule feature underlying #3/AGNT-06 remain genuinely unexercised.

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
| `packages/core/tests/session_close_lifecycle.rs`, `session_closed_call_site.rs` | Real-sidecar natural-completion test; falsifiable source gate on the call site | ✓ VERIFIED | Both exist and pass (confirmed by this round's independent `cargo test --workspace` run). |
| `packages/core/tests/runtime_context_call_sites.rs` | Falsifiable gate against constructing a `tokio::time::` future as a `block_on` argument (G-02-5) | ✓ VERIFIED | Exists on disk; the fix it guards (`block_on(async { tokio::time::timeout(...).await })`) confirmed by direct read of `sidecar.rs`. |
| `packages/desktop/src/settings/SettingsSurface.tsx` | `API_KEY_PRECEDENCE_NOTICE` (T-02-42 clause 1) | ✓ VERIFIED | Present and rendered; tested in `settings-surface.test.tsx` per 02-SECURITY.md. |

All artifacts from the original 10 plans and the first gap-closure round (`02-01`..`02-14`) that
were previously VERIFIED remain unchanged and were not re-audited file-by-file beyond the
regression checks embedded in the full independently-re-run test suites above.

### Key Link Verification (this round)

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `sidecar.rs` (reader loop) | `commands/agent_run.rs` (`handle_inbound_session_closed`) | Dispatch on `event.type == "session_closed"`, after persist + renderer emit | ✓ WIRED | Confirmed by direct read (`sidecar.rs:847-857`). |
| `commands/agent_run.rs` (`handle_inbound_session_closed`) | `domain/agent_run.rs` (`apply_session_closed`) | Direct call, panic-free region | ✓ WIRED | Confirmed by direct read; no `expect`/`unwrap`/`panic!` in the handler's region. |
| `sidecar.rs` (`spawn_sidecar`) | `packages/sidecar/src/index.ts` (`op: "ping"`) | Bounded readiness handshake before `spawn_sidecar` returns `Ok` | ✓ WIRED | Confirmed by direct read of both sides; `stub-invocation.test.mjs` proves it against the real Tauri-copied invocation path. |
| `claude-code-adapter.ts` (stderr readline) | `adapter.ts` (`SessionClosedEvent.detail`) | `stderrTail`, capped and carried onto the terminal event | ✓ WIRED | Confirmed by direct read; `SessionSurface.tsx` renders `detail` beneath the terminal row's machine-detail line (tested). |
| `main.rs` (`RunEvent::Exit`) | `sidecar.rs` (`shutdown_all_sessions`, then `kill()`) | Sequential, shutdown before kill | ✓ WIRED (unchanged from pre-UAT report) | `app_exit_ordering.rs` passing; corroborated live by UAT test 4's `pgrep` finding nothing. |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| DATA-04 | Generic trigger record, `user_action` implemented | ✓ SATISFIED | Unchanged. |
| DATA-06 | Worktrees/runs/sessions as first-class records | ✓ SATISFIED | Unchanged + strengthened: `apply_session_closed` now correctly writes the run's terminal state. |
| WORK-01/02/08, LINK-01 | Worktree creation, branch topology, persistence, naming | ✓ SATISFIED | Unchanged; SC1 above. |
| PROC-01 | Each session a separate OS process in its own worktree | ✓ SATISFIED | Unchanged, and its startup-liveness boundary is now proven (G-02-1's readiness handshake). |
| PROC-02 | Supervisor never reads its own cwd | ✓ SATISFIED | Unchanged. |
| PROC-06 | Interrupt/stop leaves the worktree consistent | ✓ SATISFIED — see human-verification item on the uncommitted-work half | Mechanism proven; the specific "dirty exactly as left" claim not yet observed. |
| PROC-07 | Live streaming without unbounded memory growth | ✓ SATISFIED (qualified — short session) | G-02-3 closed; UAT test 1 measured a real short session; long-session stress observation not yet performed. |
| AGNT-01, AGNT-02 | Single adapter interface; normalises stream-json | ✓ SATISFIED | Strengthened this round — the argv the adapter builds is now proven against the REAL CLI, not just an internal fake. |
| AGNT-03, AGNT-04 | Local credentials / explicit API key | ✓ SATISFIED (qualified) | Non-leak independently measured; parity observed but not independently reproduced; precedence-override unmeasurable here, explicit Phase 3 input. |
| AGNT-06 | Permission requests block until answered | ✓ SATISFIED — see human-verification item on the allow-always rule | The pause/answer/resume core is now proven end-to-end for the first time; the allow-always rule grant/revoke half of the same feature (D-39) has never executed in production. |

No orphaned requirements — all 15 IDs mapped to this phase are declared in at least one plan's
frontmatter (`02-01` through `02-18`).

**Advisory (documentation hygiene, carried forward unresolved):** `.planning/REQUIREMENTS.md`'s
per-requirement status table still shows the inverse of the actual, code-verified state for this
phase (see `observed_since_last_verification` in frontmatter). Not evidence of a code regression —
should be reconciled by the orchestrator.

**Advisory (ledger hygiene, new this round):** `.planning/WINDOWS.md` rows 3 and 7 are still marked
`status: open` with wording that predates UAT ("has not been observed by a human"), even though
`02-UAT.md` ran and partially corroborated both. Neither row should be marked `fixed` outright (see
the two human-verification items below), but the wording is now stale and should be tightened to
name the one specific clause each row still lacks, rather than implying nothing was ever attempted.

### Anti-Patterns Found

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found in any of the ten files this
round's gap-closure and security-remediation plans touched. No new stub patterns (empty handlers,
hardcoded-empty rendered props, silent panics reintroduced) found. The three `ℹ️ Info`-level items
from the pre-UAT report (stale `deferred-items.md`/WINDOWS.md row 4 wording, the pre-existing
`FLYWHEEL_WORKTREE_ROOT` test race at WINDOWS.md row 2, and the Phase-3-deferred `WorktreeSummary.tsx`
disk-existence gap at row 6) are unrelated to this round's changes and carried forward unchanged.

### Behavioral Spot-Checks (independently re-run by this verification, not read from a SUMMARY)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full Rust workspace suite | `cargo test --workspace` | 222 passed, 0 failed | ✓ PASS |
| Full sidecar (Node) suite | `npm --prefix packages/sidecar test` | 39 passed, 0 failed | ✓ PASS |
| Full desktop (TS/React) suite | `npm --prefix packages/desktop test` | 314 passed, 0 failed (29 files) | ✓ PASS |
| Desktop TS build | `npm --prefix packages/desktop run build` | Exits 0, no `error TS` | ✓ PASS |
| G-02-4 production dispatch present | `grep handle_inbound_session_closed packages/desktop/src-tauri/src/sidecar.rs` | Found, correctly positioned | ✓ PASS |
| G-02-5 fix present, gate exists | `grep block_on` (async-wrapped) + file existence check on `runtime_context_call_sites.rs` | Confirmed | ✓ PASS |
| T-02G-17-03 append-then-truncate present | Direct read of `claude-code-adapter.ts:456-463` | Confirmed (matches Rust side's pattern) | ✓ PASS |
| Debt markers in this round's touched files | `grep -nE "TBD\|FIXME\|XXX"` across 10 files | 0 matches | ✓ PASS |
| Repo working-tree state matches commit history | `git status --short` vs. `git log --oneline -15` | Clean tree; all claimed commits present | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventions or phase-declared probes found for this phase. Skipped.

### Human Verification Required

See `human_verification` in frontmatter — 2 items (down from 5 in the pre-UAT report, since three
of the original five were fully resolved by a completed, independently-corroborated UAT run):

1. **Allow-always permission rule: grant, list, revoke** (WINDOWS.md row 7, clause 3). Never
   executed in production despite two independent UAT attempts. Ties directly to **T-02-24
   (high severity)** in `02-SECURITY.md` — the structural half (the `UNIQUE (project_id,
   tool_name)` constraint) is proven, but `matching_rule`'s real-world read path has never
   returned a real rule. Both `02-UAT.md` and `02-SECURITY.md` independently recommend NOT
   considering this closed on code-reading evidence alone.
2. **A Stop preserves an agent's uncommitted work, not just an intact worktree and no orphan
   process** (WINDOWS.md row 3, second clause). The "worktree intact, no orphan" half IS
   corroborated; the "dirty exactly as the agent left it" half was never exercised because both
   real worktrees happened to be clean at verification time. Structurally guaranteed (the stop
   path issues no git commands — T-02-12, high severity, `02-SECURITY.md`) but never behaviorally
   observed. UAT's own note: "the half most likely to regress silently."

Both items are narrower in scope than anything in the pre-UAT report's original five, and both
were reached — not skipped — by genuine attempts recorded in `02-UAT.md`.

### Gaps Summary

**No gaps remain.** All five defects found by human UAT (G-02-1 through G-02-5) are independently
re-confirmed closed against the code on disk and the currently-passing, independently-re-run test
suites — not trusted from any plan's own SUMMARY.md claim. The security audit closed with
`threats_open: 0` (two open threats, both below the `high` block threshold, zero blocking).

The reason overall status is `human_needed` rather than `passed` is exclusively the two items
above: both are genuinely unexercised behavioral claims — one tied to a `high`-severity security
control that has never run in production — that a completed, good-faith UAT round attempted and
could not reach, not evidence of anything broken. Per the routing rule this agent follows: any
non-empty human-verification section means the correct status is `human_needed`, not `passed`,
even though every roadmap Success Criterion has supporting evidence and the full automated suite
(cargo 222/222, sidecar 39/39, desktop 314/314, clean TS build) is green.

Two documentation-hygiene items are worth the orchestrator's attention before this phase is
considered fully closed: `.planning/REQUIREMENTS.md`'s per-requirement status table still shows
the inverse of the actual, code-verified state, and `.planning/WINDOWS.md` rows 3 and 7 carry
pre-UAT wording that should be tightened to name the one clause each still lacks, now that UAT
has partially (not fully) corroborated both.

---

_Verified: 2026-09-11T19:05:00Z_
_Verifier: Claude (gsd-verifier)_
