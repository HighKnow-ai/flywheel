---
phase: 05-socratic-epic-authoring
verified: 2026-09-24T09:15:00Z
status: gaps_found
score: 8/9 must-have truths verified (1 failed, structural mechanism for challenge-quality present but live-quality dimension still human_needed)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/05-socratic-epic-authoring/05-01-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-01-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-02-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-02-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-03-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-03-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-04-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-04-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-05-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-05-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-06-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-06-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-07-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-07-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-08-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-08-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-09-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-09-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-10-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-10-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-11-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-11-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-12-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-12-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-13-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-13-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-REVIEW.md
  - .planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md
  - .planning/phases/05-socratic-epic-authoring/05-UAT.md
  - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/authoring_proposal.rs
  - packages/core/src/domain/authoring_session.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/query/authoring.rs
  - packages/core/tests/authoring_acceptance.rs
  - packages/core/tests/authoring_measurement.rs
  - packages/core/tests/authoring_proposal.rs
  - packages/core/tests/bin/uat_authoring_ops.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/__tests__/reopen-epic.test.tsx
  - packages/desktop/src/launch-sheet/LaunchSheet.tsx
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/session/__tests__/authoring-composer.test.tsx
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/stage-gate-hook.ts
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/uat-08-socratic-authoring.mjs
covered_digest: "v1:sha256:570e6269e9bafe80ca18f7234e06605ea93780f8b322efd0daf2abff3b6deb15"
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "Success Criterion 1 — the agent genuinely challenges assumptions rather than affirming the user's framing (SHAPE-01's flagged prohibition: 'MUST NOT let the challenge stage become agreeable validation')."
    test: "Run scripts/uat/uat-08-socratic-authoring.mjs in live mode (real claude binary, real credentials, not --self-test) end to end and read the two verbatim assistant replies it now prints (plan 05-11's drain fix removed the prior 120s starvation), and/or hold at least one live authoring conversation and read the actual challenge turns."
    expected: "The agent's challenge-stage turns push back on the framing, ask substantive clarifying questions, and do not just restate/affirm what the developer said. The structural mechanism (no proposal tool reachable until a human advances the stage) is proven by tests; that only proves proposals cannot be written early, not that the free-form conversation is actually Socratic."
    why_human: "Live-conversation quality judgment. No automated presence/wiring check or offline self-test can assess whether the model's dialogue is genuinely challenging vs. sycophantic. Deliberately deferred to end-of-phase per workflow.human_verify_mode=end-of-phase; confirmed in 05-UAT.md that the live run has still not been re-attempted since the 05-11 drain fix landed."
behavior_unverified_items_note: "05-11's drain fix (this run) removes the specific starvation defect (G-05-1) that made the live run structurally impossible, and 05-13's premise-at-turn-zero + composer (G-05-2) give the live run something to hold a conversation with — but neither gap-closure plan actually re-ran the live script to completion. No evidence in any phase artifact shows the live UAT has been executed since these fixes landed."
gaps:
  - truth: "Every turn the application sends into an authoring session — the developer's, the distillation instruction, and the two proposal-decision relays — leaves exactly one transcript row (05-12's own declared must_have, requirement SHAPE-01)."
    status: failed
    reason: "SidecarHandle::send_authoring_turn (packages/desktop/src-tauri/src/sidecar.rs:507-523) calls record_authoring_turn — which persists a developer_turn line to the session log and emits it on agent:event — UNCONDITIONALLY, before it ever attempts delivery via self.send_request(). send_request can genuinely fail (self.child is None, or the write to the child's stdin fails — e.g. the claude process already exited but agent_runs.status has not yet transitioned, a race authoring_turn_send's own DB status check cannot close because the connection is dropped before the sidecar call). When send_request fails: (1) the feed already shows the developer's message as an ordinary developer_turn row with no delivery-status field, indistinguishable from a delivered one; (2) authoring_turn_send correctly returns Err to the renderer, which shows an alert and leaves the text in the composer for retry (this part works as designed); (3) if the developer retries — the documented recovery path — record_authoring_turn runs again with a new turnId, persisting and emitting a SECOND developer_turn row for what is one logical send attempt, and only the second one ever reached the model; (4) if the developer does not retry, the transcript permanently and silently misrepresents that the developer said something the agent never received, with no marker and no follow-up correction. Verified directly by reading sidecar.rs:470-523 — this is not a SUMMARY claim, it is the code at HEAD (75803a3, the same commit that added the code-review report documenting this exact finding as CR-01). No fix commit exists after the review. Confirmed no test exercises this path: the only Rust unit test touching this code (authoring_turn_line_carries_type_run_id_text_and_origin, sidecar.rs:939) tests only the pure build_authoring_turn_line() line-builder, never send_authoring_turn/record_authoring_turn themselves; the frontend composer tests (authoring-composer.test.tsx) mock sendAuthoringTurn at the adapters/tauri.ts wrapper boundary and never exercise the real Rust persist-then-relay ordering or a failure path."
    artifacts:
      - path: "packages/desktop/src-tauri/src/sidecar.rs"
        issue: "send_authoring_turn (lines 507-523) persists+emits the developer_turn row before attempting send_request; a failed send leaves a phantom 'delivered-looking' row, and a retry mints a duplicate row for the same logical turn"
    missing:
      - "Reorder send_authoring_turn to attempt delivery (send_request) before calling record_authoring_turn — fail fast, persist only once delivery is confirmed reachable — OR add a delivery-status field (pending/failed/delivered) to the transcript line that authoring_turn_send's failure path can update in place, so a retry supersedes rather than duplicates and a non-retrying developer can tell from the transcript itself that the message did not land"
      - "A test that exercises send_authoring_turn (or authoring_turn_send end-to-end) with a failing/absent sidecar handle and asserts exactly one transcript row exists in the session log after a failed send followed by a successful retry"
human_verification:
  - test: "Live challenge quality (SHAPE-01's core claim) — run scripts/uat/uat-08-socratic-authoring.mjs in live mode (no --self-test) against a real claude binary and credentials, now that plan 05-11's drain fix and plan 05-13's premise/composer give the run something to actually converse about."
    expected: "During the challenge stage, the agent pushes back on the developer's stated premise, asks substantive clarifying questions, and does not simply affirm or restate what was typed."
    why_human: "Judgment about live model dialogue quality; no structural/presence check can certify it. Never actually re-run since the 05-11/05-13 fixes landed — 05-UAT.md's two blockers (G-05-1, G-05-2) were closed structurally, but neither closure plan re-executed the live script to completion, so this remains unproven, not merely deferred."
  - test: "Product Kill Criterion — in-app Socratic shaping vs. terminal comparison arm, now that the composer and premise field exist to stage it (05-VALIDATION.md's Manual-Only Verifications table, third row)."
    expected: "Hand-time shaping a real epic through the launch sheet + composer, read the two numbers back via `cargo run -p core --bin uat_authoring_ops -- measure-run <runId>`, and hand-time/hand-count the identical exercise in a bare terminal; the in-app flow should read as faster/better per 05-CONTEXT.md's stated bar for this surface's reason to exist."
    why_human: "Explicitly a human-paced timed comparison the phase's own spike (05-SPIKE-FINDINGS.md) could only measure a baseline for; 05-13 built the measurement instrument but the comparison itself has still never been run — 05-VALIDATION.md lists it as pending, not completed."
---

# Phase 05: Socratic Epic Authoring Verification Report

**Phase Goal:** Cyril shapes a new epic by being challenged rather than interviewed, and walks away
with structured board items instead of a document.
**Verified:** 2026-09-24T09:15:00Z
**Status:** gaps_found
**Re-verification:** Yes — this replaces the prior `05-VERIFICATION.md` (status `human_needed`,
2026-09-24T03:55:00Z), covering the phase as a whole after gap-closure plans 05-11/05-12/05-13
closed the two blockers (G-05-1, G-05-2) that conversational UAT found against that prior pass.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | (Roadmap SC1) User starts a conversational session to shape a new epic and the agent challenges his assumptions and asks clarifying questions before any work is planned. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Structural mechanism unchanged from the prior pass and still holds: `stage-gate-hook.ts` denies every `propose_*`/`amend_*`/`delete_*` tool while in `challenge`; `cargo test --test authoring_acceptance criterion_1_the_agent_challenges_before_any_work_is_planned` passes. **New this round:** plan 05-13 closed the structural precondition for the live-quality check itself — a fresh epic's opening prompt now asks for a premise instead of instructing the model to challenge a framing that was never captured (`render_epic_prompt`, `epic_context_packet.rs`), and plan 05-12 gave the developer a composer to actually hold that conversation. But the live conversational quality question — does the model's dialogue genuinely push back — is still unproven: 05-UAT.md records the live script timing out on the *prior* pass, and no phase artifact shows it has been re-run to completion since the 05-11 drain fix and 05-13 premise/composer landed. See behavior_unverified_items. |
| 2 | (Roadmap SC2) The session's outcome lands directly on the board as a structured epic with child tasks and drafted acceptance criteria for each task — not as a markdown file or a chat log. | ✓ VERIFIED | Unchanged from prior pass; `authoring_proposals` staging → `accept_proposal`/`accept_subtree` write through canonical domain writers (`create_task`, `create_epic`, `create_criterion`) in one transaction. `cargo test --test authoring_acceptance criterion_2_lands_directly_on_the_board_never_as_a_file` passes. Gap-closure work in this round (developer turns, premise) does not touch this write path — confirmed by reading `authoring_turn_send`, which explicitly writes no board row and appends no `events` row. |
| 3 | (Roadmap SC3) User accepts, rejects or amends each proposed item and each drafted criterion individually, rather than accepting the set wholesale. | ✓ VERIFIED | Unchanged from prior pass; the prior pass's own flagged regression-gate hole (the accept-all scanner's zero-file no-op against `packages/desktop/src`) was closed in commit `a4b0244` (`rust_sources_under` now also collects `.ts`/`.tsx`; a new test `the_no_accept_all_gate_actually_reaches_the_frontend_tree` asserts the frontend tree is non-empty and contains at least one `.tsx`). Confirmed present at HEAD by reading `packages/core/tests/authoring_proposal.rs`. |
| 4 | (Roadmap SC4) User reopens an epic weeks later, continues shaping it, and the agent challenges the change against what the epic already contains. | ✓ VERIFIED | Unchanged from prior pass; `cargo test --test authoring_acceptance criterion_4_reopening_an_epic_primes_the_challenge_against_what_it_already_contains` passes end-to-end against a real database. `reopen-epic.test.tsx` (6/6) confirms both UI doors call the same `authoring_run_start` entry point. |
| 5 | (05-12 must_have, SHAPE-01) A developer sitting on an authoring session can type a message and send it into the live conversation; the composer appears only for a live authoring run that can still receive a turn. | ✓ VERIFIED | `AuthoringComposer` (`SessionSurface.tsx:382-`) renders only when `stage` is non-null and the run is not terminal; calls `sendAuthoringTurn` (never the transport directly) with a synchronous-tick send guard (`sendingRef`). `authoring_turn_send` (`commands/authoring.rs`) validates length, confirms `authoring_stage` is non-null and `status` is `running`/`blocked` before relaying. `authoring-composer.test.tsx` exercises the happy path, the empty/too-long rejection, and the failure-keeps-draft path at the wrapper-mock boundary. |
| 6 | (05-12 must_have, SHAPE-01) A turn the developer sends appears in the transcript as the developer's own words, visually distinct from the agent's; the backend's own restatement of a sent turn never doubles a row. | ✓ VERIFIED | `developer_turn` is its own `FeedRow` case (`FeedRow.tsx:45,159,290`), never folded into `assistant_text`. `backend_echo` is a separate typed event, explicitly suppressed by `claude-code-adapter.ts` rather than merged — confirmed by direct reading. |
| 7 | **(05-12 must_have, SHAPE-01) Every turn the application sends into an authoring session leaves exactly one transcript row.** | ✗ **FAILED** | `SidecarHandle::send_authoring_turn` (`sidecar.rs:507-523`) persists+emits the `developer_turn` row via `record_authoring_turn` UNCONDITIONALLY, before ever attempting `send_request`. A failed `send_request` (child exited, handle absent) leaves a row that looks delivered but was not; a developer retry (the documented recovery path) mints a second row for the same logical turn. This is CR-01 from `05-REVIEW.md`, independently re-confirmed against the code at HEAD (`75803a3`) during this verification — not accepted on the review's word alone. No fix commit exists after the review; no test exercises the failure path. See Gaps below. |
| 8 | (05-13 must_have, SHAPE-01/SHAPE-02) A developer states an epic's premise before a token is spent; the premise is bounded and rejected when empty; the stated premise is carried into the opening prompt and appears in the transcript as the developer's first turn. | ✓ VERIFIED | `LaunchSheet.tsx`'s `!isAuthoring &&` guard from the prior pass is gone — the instruction field now also renders `isAuthoring &&` (line 796), and `handleSubmit`'s `trimmedPremise` path (line 632) forwards it. `epic_context_packet.rs`/`render_epic_prompt` asks for a premise when none was supplied rather than inventing a framing to challenge — proven by `cargo test --test epic_context_packet` (TDD-driven per 05-13's RED/GREEN commit pairs). |
| 9 | (05-13 must_have, SHAPE-02) The Product Kill Criterion's in-app arm is derived from the board via a read-only harness door, never migrating or writing to the real fleet database. | ✓ VERIFIED (with a latent-bug caveat) | `uat_authoring_ops measure-run`'s early-dispatch branch opens the database `SQLITE_OPEN_READ_ONLY` and never calls `open_and_migrate` — confirmed by reading `main()` in `packages/core/tests/bin/uat_authoring_ops.rs`. **Caveat (not a gap):** `05-REVIEW.md`'s WR-05 identifies that `measure_authoring_run`'s bounded event read orders `ASC` before `LIMIT` (keeping the oldest events, discarding the newest) when a run's own accept/amend event count exceeds the 200-event bound, which would silently under-report `last_accepted_at` for an unrealistically large single run; and a sibling proposal read has no `ORDER BY` at all. Confirmed present in `packages/core/src/query/authoring.rs:364-397`. This is a real, unfixed defect but not one any current test or usage path is known to hit (a single epic-authoring run reaching 200+ accept/amend events is not realistic), so it is recorded as a Warning-level anti-pattern rather than a failed must-have. |

**Score:** 8/9 must-have truths VERIFIED by direct code inspection or a passing automated test; 1/9 FAILED (truth #7, CR-01); truth #1's live-quality dimension remains PRESENT_BEHAVIOR_UNVERIFIED (structural mechanism proven, live conversational quality still unproven — see behavior_unverified_items).

### Deferred Items

None — no gap here maps to a later milestone phase; this is the terminal phase for SHAPE-01..05 per `.planning/REQUIREMENTS.md`.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `scripts/uat/uat-08-socratic-authoring.mjs` | Live arm answers incidental permission requests instead of starving | ✓ VERIFIED (G-05-1 closed) | `drainIncidentalPermissionRequests` (imported from `lib/sidecar-harness.mjs`) is now started before the first-reply wait, mirroring `uat-07`'s wiring. `--self-test` re-confirmed 5/5 (per run_context's already-run gates; not re-run here per instructions). **However:** the live arm itself has still not been executed to completion post-fix — see human_verification #1. |
| `packages/desktop/src/session/SessionSurface.tsx` (`AuthoringComposer`) | Developer-turn composer (G-05-2 closure) | ✓ VERIFIED | Present, substantive (send guard, Enter-to-send, error/retry UX), wired to `sendAuthoringTurn`. |
| `packages/desktop/src-tauri/src/commands/authoring.rs` (`authoring_turn_send`) | Tauri command relaying developer text | ✓ VERIFIED, wired | Validates length/emptiness, checks run is `running`/`blocked`, relays via `SidecarHandle::send_authoring_turn`. Does not write a board row or an `events` row (confirmed by reading the full function body). |
| `packages/desktop/src-tauri/src/sidecar.rs` (`SidecarHandle::send_authoring_turn`/`record_authoring_turn`) | Persist-before-emit, single transcript row per turn | ✗ **STUB-EQUIVALENT ON THE FAILURE PATH** | Persist/emit is unconditional and precedes the delivery attempt it is supposed to be a record of — see truth #7 / Gaps. |
| `packages/desktop/src/launch-sheet/LaunchSheet.tsx` | Premise field visible for authoring runs (G-05-2 closure) | ✓ VERIFIED | `isAuthoring &&` branch renders the instruction/premise textarea (line 796); no longer suppressed. |
| `packages/core/src/epic_context_packet.rs` (`render_epic_prompt`) | Asks for a premise when none supplied | ✓ VERIFIED | Confirmed via `cargo test --test epic_context_packet` (per run_context's already-run gate). |
| `packages/core/tests/authoring_measurement.rs`, `packages/core/tests/bin/uat_authoring_ops.rs` | Read-only Product Kill Criterion measurement harness | ✓ VERIFIED | `SQLITE_OPEN_READ_ONLY`, no `open_and_migrate` call, confirmed by direct code reading. Latent ordering bug noted above (WR-05) but not a missing/stub artifact. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Composer send button/Enter | live authoring session's stdin | `sendAuthoringTurn` → `authoring_turn_send` → `SidecarHandle::send_authoring_turn` → sidecar `authoring_turn` op | ⚠️ WIRED BUT NOT SAFE ON FAILURE | The happy path is fully wired and tested. The failure path (delivery fails) is wired but produces the duplicate/phantom-row defect in truth #7. |
| `SidecarHandle::send_authoring_turn` | `developer_turn` feed row | `persist_event_line` → `app.emit("agent:event")` → `buildFeedRows` | ⚠️ WIRED, ORDERING DEFECT | Persist-before-emit holds as designed for the happy path; the defect is persist-before-*delivery-attempt*, not persist-before-emit. |
| Launch sheet premise field | opening prompt's first developer turn | `startAuthoringRun(projectId, epicId, premise)` → `authoring_run_start` → `render_epic_prompt(&packet, premise)` | ✓ WIRED | Confirmed via `LaunchSheet.tsx` submit handler and `commands/authoring.rs` call sites; TDD'd in 05-13 (RED/GREEN commit pairs `1cd07fa`/`50a87ee`, `7c36329`/`e10942f`). |
| `events` (`proposal.amended`, `proposal.accepted`) | Product Kill Criterion numbers | `measure_authoring_run` query | ✓ WIRED (with WR-05's latent large-run ordering caveat) | Confirmed present; not exercised against a >200-event run by any test. |
| Board row / item-detail panel "Continue Shaping" | `authoring_run_start` | Shared entry point, both doors | ✓ WIRED | Unchanged from prior pass; `reopen-epic.test.tsx` still passes. |

### Code Review Findings — Fix Verification

This round's `05-REVIEW.md` (incremental, scoped to 05-11/05-12/05-13 plus the prior round's WR-01/WR-02/WR-03/CR-01 fix commits) reported 1 Critical, 3 Warnings. Independently re-verified against the code at HEAD (`75803a3`), not accepted on the review's or SUMMARY's word:

| ID | Issue | Status at HEAD | Verified |
|---|---|---|---|
| CR-01 (Critical) | `send_authoring_turn` persists a transcript row unconditionally before attempting delivery — a failed send leaves a phantom row and a retry duplicates it | **UNFIXED** | ✓ Confirmed by direct reading of `sidecar.rs:507-523`; no fix commit exists after the review commit. Promoted to a phase gap (truth #7) in this verification. |
| WR-04 (Warning) | `record_authoring_turn`'s persist failure is only logged to stderr, not surfaced via `emit_persistence_failure_notice` like every other persist-failure path in the file | **UNFIXED** | ✓ Confirmed — `record_authoring_turn` (`sidecar.rs:470-486`) only does `eprintln!` on a non-`Written` outcome. Low-severity relative to CR-01 (a rare persist-layer failure, not a delivery failure), recorded as an anti-pattern below, not a separate gap. |
| WR-05 (Warning) | `measure_authoring_run`'s bounded reads order `ASC` before `LIMIT` (wrong end kept) and one read has no deterministic order at all | **UNFIXED** | ✓ Confirmed — `packages/core/src/query/authoring.rs:364-397`. Latent, not hit by any current test/usage (see truth #9 caveat). |
| WR-06 (Warning) | `uat-08-socratic-authoring.mjs`'s SHAPE-05 result is hardcoded `false`, so the live script's own `assert.ok(allPassed, ...)` can never pass even when SHAPE-01..04 all genuinely pass | **UNFIXED, pre-existing from 05-10** | ✓ Confirmed — `criterion4Reopened`/`criterion4PrimedRejected` are declared and never reassigned in the file's control flow. Not introduced by this round's gap-closure diff; recorded as an anti-pattern, not a new gap, since it predates 05-11/12/13 and does not block any of this phase's roadmap success criteria directly. |

None of the four fixes from the *original* review round (CR-01-original/WR-01/WR-02/WR-03, all already independently verified fixed in the prior `05-VERIFICATION.md`) have regressed — spot-confirmed `IN_FLIGHT_AGENT_RUNS_SELECT_SQL` still uses `LEFT JOIN`, `validate_payload` is still called on the proposal create path, `CONTEXT_PACKET_READ_LIMIT` is still applied, and `startingRef` is still present in `LaunchSheet.tsx`.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| SHAPE-01 | 05-01..05-05, 05-09, 05-10, 05-11, 05-12, 05-13 | Conversational session challenges before planning | ⚠️ PARTIAL — structural mechanism holds; the new developer-turn transcript has a real integrity defect (truth #7); live challenge quality still unproven | Gap + human_verification #1 |
| SHAPE-02 | 05-02, 05-05, 05-06, 05-08, 05-10, 05-13 | Outcome writes directly to board as structured epic+tasks, not a document | ✓ SATISFIED | Truth #2, unchanged |
| SHAPE-03 | 05-02, 05-05, 05-06, 05-07, 05-10 | Agent drafts acceptance criteria per task, editable before accepting | ✓ SATISFIED | Unchanged from prior pass |
| SHAPE-04 | 05-06, 05-07, 05-08, 05-10 | Accept/reject/amend any individual item, no wholesale accept | ✓ SATISFIED | Truth #3, regression-gate hole from prior pass now closed |
| SHAPE-05 | 05-01, 05-04, 05-05, 05-07, 05-10 | Reopen and continue shaping, challenged against existing content | ✓ SATISFIED | Truth #4, unchanged |

`.planning/REQUIREMENTS.md` marks all five SHAPE-* IDs `[x]` Complete. SHAPE-01's "Complete" marking is **not fully substantiated** by the current codebase: the transcript-integrity must-have this phase's own plan declared for SHAPE-01 fails, and SHAPE-01's live-quality dimension has never been proven. No orphaned requirements — all five IDs are claimed by at least one plan's `requirements:` frontmatter (05-11/05-12/05-13 all declare SHAPE-01, and 05-13 additionally spans SHAPE-01 through SHAPE-05).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/desktop/src-tauri/src/sidecar.rs` | 507-523 | Persist-before-delivery-attempt ordering produces a phantom/duplicate transcript row on send failure | 🛑 Blocker (promoted to Gap, truth #7) | See Gaps section |
| `packages/desktop/src-tauri/src/sidecar.rs` | 470-486 | `record_authoring_turn`'s persist failure only reaches stderr, not the user-visible `system_notice` pattern the rest of the file already established | ⚠️ Warning | Low-severity relative to CR-01; a rare failure mode (session-log write failure, not delivery failure) that is invisible to the developer if it occurs |
| `packages/core/src/query/authoring.rs` | 364-397 | `measure_authoring_run`'s event read orders `ASC` before `LIMIT` (wrong end kept once a run exceeds 200 events); a sibling proposal read has no `ORDER BY` | ⚠️ Warning | Latent correctness bug in the Product Kill Criterion numbers for an unrealistically large single run; not hit by any current test or usage |
| `scripts/uat/uat-08-socratic-authoring.mjs` | 440-479 | SHAPE-05's result variables are declared and never reassigned to `true` anywhere in the file, so `assert.ok(allPassed, ...)` can never pass even on a fully successful run | ⚠️ Warning | Pre-existing from 05-10, not touched by this round's diff; means the live script structurally cannot report an overall pass today, which is worth fixing before the deferred live run (human_verification #1) is attempted, so a genuine pass isn't misread as a failure |
| `packages/core/src/epic_context_packet.rs` | ~200-203 (`PRIOR_AUTHORING_RUNS_SQL`) | Unbounded read, unlike its two sibling queries WR-02 bounded in the prior round | ℹ️ Info | Unchanged from prior pass; low practical risk |

No debt markers (`TBD`/`FIXME`/`XXX`) or cleanup markers (`TODO`/`HACK`/`PLACEHOLDER`) found in any file this round's three gap-closure plans touched, confirmed by direct grep.

### Behavioral Spot-Checks / Test Re-Runs

Per `run_context`, the post-merge build & test gate (both waves), drift gates, regression gate, and code review were already run this session at the current HEAD and are treated as established evidence rather than re-run: `cargo build` clean; `cargo test` green (69 suites); desktop vitest 552/552; sidecar `node --test` 143/143; both drift gates `block: false`; 94 prior-phase regression tests passing.

This verification additionally re-read (not re-ran, since the tests are unit-level and the claim is about code structure, not runtime output) the specific test files that the review's CR-01 finding says do NOT cover the failure path, to confirm that claim independently:

| Check | Method | Result | Status |
|---|---|---|---|
| Does any Rust test exercise `send_authoring_turn`/`record_authoring_turn` beyond the pure line-builder? | `grep -n "send_authoring_turn\|record_authoring_turn" sidecar.rs` cross-referenced against `#[test]` blocks | Only `authoring_turn_line_carries_type_run_id_text_and_origin` and `two_builder_calls_...` exist, both testing `build_authoring_turn_line` only | ✓ CONFIRMS review's claim — no coverage of the failure path |
| Does the frontend composer test exercise the real Rust send path? | Read `authoring-composer.test.tsx` | Mocks `sendAuthoringTurn` at the `adapters/tauri.ts` wrapper boundary (`vi.fn()`); never reaches Rust | ✓ CONFIRMS review's claim |
| Is `authoring_turn_send`'s failure surfacing itself correct (as distinct from the persist-before-delivery ordering)? | Read `commands/authoring.rs:886-935` | Correctly checks `authoring_stage`/`status` before relaying and propagates `Err` | ✓ PASS — this half of the design works; the defect is specifically the ordering inside `send_authoring_turn` |
| Debt markers in this round's touched files | `grep -n -E "TBD\|FIXME\|XXX"` across 9 core touched files | No matches | ✓ PASS |
| Working tree clean re: phase 05 | `git status --short`, `git log --oneline` | HEAD is `75803a3` (adds the code review report); no uncommitted phase-05 changes; no fix commit for CR-01 exists after it | ✓ CONFIRMS CR-01 is unfixed at the commit under verification |

### Human Verification Required

#### 1. Live challenge quality (SHAPE-01's core claim)

**Test:** Run `scripts/uat/uat-08-socratic-authoring.mjs` in live mode (no `--self-test`) against a real `claude` binary and real credentials, now that the drain fix (05-11) and the premise/composer (05-13) give the run something to actually converse about — or hold a real conversational authoring session directly.
**Expected:** During the `challenge` stage the agent pushes back on the developer's stated premise, asks substantive clarifying questions, and does not simply affirm or restate what was typed.
**Why human:** Judgment about live model dialogue quality; no structural check can certify it. This has still never actually been executed to completion — 05-UAT.md records the prior attempt timing out, and no phase artifact records a completed post-fix run.

#### 2. Product Kill Criterion — in-app vs. terminal comparison

**Test:** Shape a real epic through the launch sheet + composer, hand-time it, read the two numbers back via `cargo run -p core --bin uat_authoring_ops -- measure-run <runId>`, and hand-time/hand-count the identical exercise typed directly into a terminal against `claude`.
**Expected:** The in-app Socratic flow reads as faster/better than the bare-terminal arm — the bar this surface exists to clear, per `05-CONTEXT.md`/`05-SPIKE-FINDINGS.md`.
**Why human:** A human-paced timed comparison; 05-13 built the read-only measurement instrument for the in-app arm, but the comparison itself has never been run — `05-VALIDATION.md`'s own Manual-Only Verifications table lists it as still pending.

### Gaps Summary

One gap blocks a clean pass: **CR-01 is real and unfixed.** `SidecarHandle::send_authoring_turn` persists and emits a `developer_turn` transcript row unconditionally, before it ever attempts to deliver that turn to the live `claude` process. When delivery fails — a real, reachable condition (the child process has exited, or the handle is absent) — the transcript ends up either permanently misrepresenting a message as delivered when it was not, or duplicated across a retry. This directly falsifies plan 05-12's own declared must-have truth ("leaves exactly one transcript row") for the very feature (`authoring_turn_send`) that this phase's gap-closure round built specifically to give SHAPE-01's challenge stage a human channel. It was found and correctly diagnosed by this session's own code review (`05-REVIEW.md` CR-01) but no fix commit followed — the review report itself is the most recent commit on the branch. This is not a SUMMARY-vs-code discrepancy; the SUMMARY for 05-12 does not claim this defect is fixed, and the review that found it post-dates the SUMMARY. It is, however, a genuine, currently-open gap that must be closed before this phase can be called done: a developer whose typed turn silently fails to reach the agent, with no visible indication in the transcript, undermines the exact trust property ("this is a real conversation, not a chat log with silent gaps") the phase goal depends on.

Two items remain `human_needed` independent of the gap: the live conversational-quality check (SHAPE-01's irreducible live dimension) and the Product Kill Criterion in-app-vs-terminal comparison. Both are legitimately deferred to end-of-phase per `workflow.human_verify_mode=end-of-phase`, and both now have everything they structurally need to be run (the drain fix and the composer/premise), but neither has actually been executed since those fixes landed — so they remain open, not merely deferred-and-forgotten.

Three Warning-level findings (WR-04, WR-05, WR-06) are recorded as tracked debt, not blocking: none falsifies a declared must-have truth, and WR-06 in particular predates this round's gap-closure work entirely.
