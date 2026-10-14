---
phase: 05-socratic-epic-authoring
plan: 10
subsystem: agent-authoring
tags: [rusqlite, react, tanstack-query, mcp-tool, live-uat, requirements-ledger]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "05-04's assemble_epic_context_packet/render_epic_prompt (consumed here for the first time), 05-05's authoring_run_start, 05-06's full accept/reject/amend/accept_subtree matrix, 05-08's TriageLane/useProjectProposals, 05-09's launchSheetAuthoringHandoff channel — all extended, none re-derived"
provides:
  - "authoring_run_start widened to an optional epic_id, threaded through to assemble_epic_context_packet/render_epic_prompt for EVERY start (fresh or reopened) — reopening is the same start path with a subject, not a second flow"
  - "authoring_run_for_epic + a defensive re-check inside authoring_run_start itself: an epic with a running/blocked authoring session routes to it and starts no second run"
  - "Two reopen doors — a board-row r keyboard action (continue-shaping, epic-only) and an ItemDetailPanel Continue Shaping section — both funnelled through the ONE shared continueShapingEpic entry point"
  - "LaunchSheet.tsx's authoring variant: the epic packet (task roster, answered assumptions, the rejected set with its fold boundary) previewed before any token is spent, for both a fresh epic (short sheet) and a reopened one"
  - "packages/core/tests/authoring_acceptance.rs: one journey test per Phase 5 roadmap success criterion plus four listing/ordering edge properties (8 tests total), composing the already-shipped pieces rather than restating their own unit tests"
  - "packages/core/tests/bin/uat_authoring_ops.rs (new harness binary): the Rust bridge a plain Node UAT script shells out to for real board mutations against a scratch database, calling the SAME domain functions (including authoring_proposal::apply_proposal_created, the real desktop app's own inbound half) the production write path calls"
  - "scripts/uat/uat-08-socratic-authoring.mjs (new, joined to run-all.sh): the live acceptance run, reporting pass/fail per roadmap criterion; --self-test runs fully offline"
  - "05-VALIDATION.md filled in from its seeded draft: nyquist_compliant: true, the real per-task verification map across all ten plans"
  - "All five SHAPE-01..SHAPE-05 requirement rows marked Complete in the same commit as their supporting evidence"
affects: [phase-06-*, phase-05-verification]

actuals:
  tokens: 36100
  tasks: 3
  commits: 3
  plan_head_before: cdd24f5ad81ebd7006495c3b8b63595d51440d68

tech-stack:
  added: []
  patterns:
    - "The launch sheet's own briefing-before-spend contract (D-27) extended to a second subject kind (authoring) inside the SAME component, via a discriminated `authoring` prop rather than a second sheet component — one place `handleSubmit` branches between `startAgentRun` and `startAuthoringRun`, one place the header/body/footer branch on `isAuthoring`"
    - "A Rust CLI harness binary (uat_authoring_ops) as the bridge between a plain Node UAT script and a real board write path, mirroring uat_seed_ui.rs's/uat_session_env.rs's own established 'shell out to a compiled binary that calls the real domain functions' pattern — apply-proposal-created is not a simulation of the inbound write path, it calls the exact same function (authoring_proposal::apply_proposal_created) the real desktop app's own handle_inbound_proposal_created calls"
    - "The realistic two-session shape a fresh-epic authoring flow actually requires, made explicit rather than assumed: a task proposal's own epic_id is resolved from agent_runs.epic_id at CREATE time (fixed at that run's own start, D-84) — never retroactively updated by an accept inside the same run — so 'an epic with child tasks' from one conversation is structurally a fresh-epic session proposing the epic, then a REOPENED session (the very door this plan builds) decomposing it into tasks. authoring_acceptance.rs's Criterion 2/4 tests document this explicitly rather than silently working around it."

key-files:
  created:
    - packages/core/tests/authoring_acceptance.rs
    - packages/core/tests/bin/uat_authoring_ops.rs
    - packages/desktop/src/board/__tests__/reopen-epic.test.tsx
    - scripts/uat/uat-08-socratic-authoring.mjs
  modified:
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/App.tsx
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/launch-sheet/LaunchSheet.tsx
    - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/__tests__/keyboard-agent.test.ts
    - packages/core/tests/epic_context_packet.rs
    - packages/core/Cargo.toml
    - scripts/uat/run-all.sh
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
    - .planning/WINDOWS.md
    - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md

key-decisions:
  - "The opening prompt for EVERY authoring_run_start call (fresh or reopened) is now render_epic_prompt(assemble_epic_context_packet(...)) — the hand-written AUTHORING_OPENING_PROMPT constant plan 05-02 shipped was removed, since a hard-coded line and a real epic-scoped briefing cannot both be 'the same start path with a subject, not a second flow'."
  - "authoring_run_for_epic (new command) is the door-level pre-flight read; authoring_run_start ALSO re-checks defensively before starting — two call sites sharing one find_running_authoring_run helper, so a TOCTOU race between two doors still cannot produce two concurrent sessions on one epic."
  - "launchSheetAuthoringHandoff (05-09's own Discard hand-off channel) is reused as the general 'open the authoring launch sheet' trigger for continueShapingEpic, rather than adding a second uiStore field with the identical {epicId} shape."
  - "continue-shaping is bound to the board-list letter r (free in that region; unused by any prior plan) — epic-row-only, the inverse of open-epic-picker's task-row-only guard."
  - "Criterion 2/4's board construction uses two authoring runs (propose+accept the epic, then reopen it to propose+accept tasks/criteria) rather than one — this is not a test-only workaround, it is the shape the shipped materialise_proposal function actually requires, since a task proposal's epic_id is fixed at its OWN run's start."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "Reopening an existing epic is one action from two places (a board-row keyboard action and an item-detail section), both routing through the one continueShapingEpic entry point; an epic already being shaped routes to the running session and starts no second run"
    requirement: SHAPE-05
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/reopen-epic.test.tsx (6 tests: keyboard binding resolution, the board-row door with no running session, task-row refusal, the already-running-session routing/no-second-run case, the item-detail-panel door, and its absence on a task's own panel)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_context_packet.rs#reopening_a_primed_epic_produces_a_prompt_with_the_roster_assumptions_and_do_not_re_propose_sentence"
        status: pass
      - kind: integration
        ref: "cargo test --workspace; npm --prefix packages/desktop run test (534/534)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The launch sheet's authoring variant previews the epic packet (task roster, answered assumptions, the rejected set with its fold boundary) before any token is spent, for both a fresh epic (short sheet, most sections absent) and a reopened one"
    requirement: SHAPE-05
    verification:
      - kind: unit
        ref: "packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx (6 new tests in the 'epic-authoring variant' describe block: header/preview for a reopened epic, the short sheet for epicId: null, roster/assumptions/rejected-fold-boundary rendering, no instruction/permission-mode controls, Start Shaping calling startAuthoringRun, rendering nothing with authoring/taskId both null)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (534/534); npm --prefix packages/desktop run build"
        status: pass
    human_judgment: false
  - id: D3
    description: "One test per Phase 5 roadmap success criterion, driving a realistic board through the whole authoring write path against a real temporary database, plus four cross-journey listing/ordering properties"
    requirement: "SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05"
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_acceptance.rs (8/8: criterion_1_the_agent_challenges_before_any_work_is_planned, criterion_2_lands_directly_on_the_board_never_as_a_file, criterion_3_accepts_rejects_and_amends_each_item_individually, criterion_4_reopening_an_epic_primes_the_challenge_against_what_it_already_contains, pending_proposals_come_back_in_the_same_order_across_two_reads, two_byte_identical_criterion_statements_stay_two_distinct_rows, a_task_accepted_with_zero_criteria_produces_zero_criteria_rows, per_project_key_allocation_follows_acceptance_order_never_proposal_order)"
        status: pass
      - kind: integration
        ref: "cargo test --workspace (0 failures across every crate)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A live acceptance script joins run-all.sh and reports pass/fail per roadmap criterion; a Rust bridge binary applies real board mutations from observed sidecar events; --self-test runs fully offline"
    requirement: "SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05"
    verification:
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (5/5 offline assertions pass, exit 0, no child process spawned)"
        status: pass
      - kind: other
        ref: "grep gates: 'uat-08-socratic-authoring' appears exactly once in run-all.sh; 'heartbeat' appears 7 times in the script"
        status: pass
      - kind: manual_procedural
        ref: "the live half (a real claude session, challenge-quality judgment, the wall-clock comparison against 05-SPIKE-FINDINGS.md's terminal arm) — not executed this session"
        status: unknown
    human_judgment: true
    rationale: "The live acceptance run costs real tokens against a real credentialed backend; this autonomous session declined to spend them without explicit human instruction. Recorded as WINDOWS.md entry #16 (unrun-verify), alongside entries #13/#14 from earlier plans in this phase. The Rust bridge binary (uat_authoring_ops) was smoke-tested end-to-end by hand against a scratch database — register-project through epic-packet, covering every subcommand — outside the automated test suite; that manual proof is recorded here, not fabricated as a passing automated test."
  - id: D5
    description: "The requirement ledger (REQUIREMENTS.md's five SHAPE rows) matches the evidence, updated in the same commit as that evidence — the Phase 3 lesson this project's own history names explicitly"
    requirement: "SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05"
    verification:
      - kind: other
        ref: "gsd-tools query requirements.mark-complete SHAPE-01..SHAPE-05 reports already_complete for all five with zero diff against the hand-edited REQUIREMENTS.md — the tool's own idempotent write agrees exactly with the manual edit"
        status: pass
    human_judgment: false

duration: ~75min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 10: Reopen The Door, Prove The Phase, Close The Ledger Summary

**Reopening an existing epic is now one action from two places, primed with an epic-scoped briefing preview before any token is spent; one automated Rust journey proves all four Phase 5 roadmap success criteria against a real database; and all five SHAPE requirement rows are marked Complete in the same commit as the evidence that supports them — with the one genuinely unproven half (live conversational quality) tracked openly in WINDOWS.md rather than folded silently into a green checkbox.**

## Performance

- **Duration:** ~75 min
- **Completed:** 2026-09-24
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 19

## Accomplishments

- **Task 1 — the reopen door.** `authoring_run_start` (`commands/authoring.rs`) now takes an optional `epic_id`, threaded straight through to `start_authoring_run` and — for the first time since plan 05-04 shipped it — to `assemble_epic_context_packet`/`render_epic_prompt`. Every session, fresh or reopened, is now spawned with the real epic-scoped briefing as its opening turn, replacing the hand-written `AUTHORING_OPENING_PROMPT` constant: reopening genuinely is "the same start path with a subject," not a second flow, for the prompt as much as for the schema. Two doors reach it — a `board-list` keyboard action (`continue-shaping`, bound to the free letter `r`, epic-row-only) and an `ItemDetailPanel.tsx` "Continue Shaping" section — both calling the one shared `continueShapingEpic` (`useBoardQuery.ts`), which asks the new `authoring_run_for_epic` command whether the epic already has a running/blocked session before doing anything else: if so, it routes straight there (`setActiveAgentRunId`) and never calls `authoring_run_start`; if not, it opens `LaunchSheet.tsx`'s new authoring variant (via `launchSheetAuthoringHandoff`, reusing plan 05-09's own Discard hand-off channel). `authoring_run_start` itself carries a defensive re-check of the same `find_running_authoring_run` guard, so a race between the two doors still cannot produce two concurrent sessions on one epic. `LaunchSheet.tsx` gained the authoring preview body (task roster, answered assumptions, the rejected set with its fold boundary sentence) — a short sheet with most sections absent for a brand-new epic, a full briefing for a reopened one — with no instruction field or permission-mode control (D-86 fixes both unconditionally for an authoring run).
- **Task 2 — one journey, four criteria.** `packages/core/tests/authoring_acceptance.rs` (new) drives a realistic board through the whole write path against a real temporary database, one test per `ROADMAP.md` §"Phase 5" success criterion: Criterion 1 proves `authoring_proposals` is empty before the stage advances and non-empty after (D-88's own named test); Criterion 2 proves zero board rows before, exactly one epic/three tasks/six criteria after, with a snapshotted scratch directory proving no file was ever written — using the two-session shape (propose+accept the epic, then reopen it to decompose it) the shipped `materialise_proposal` function actually requires, since a task's own `epic_id` resolves from its run's `agent_runs.epic_id`, fixed at that run's own start; Criterion 3 proves per-row accept/reject/amend/subtree-accept, deferring the "no accept-all path exists" structural half to plan 05-06's own gate (re-run, not re-implemented, by `cargo test --workspace`); Criterion 4 proves a reopened epic's prompt carries its task roster, its answered assumptions, both rejected proposals, and the literal do-not-re-propose sentence. `05-VALIDATION.md` was filled in from its seeded draft: real framework rows, the per-task verification map across all ten plans (each task's own actual `<automated>` command, as shipped), the two manual-only judgments the live UAT script surfaces, and `nyquist_compliant: true`.
- **Task 3 — the live run, and a ledger that agrees with it.** `scripts/uat/uat-08-socratic-authoring.mjs` (new, joined to `run-all.sh`) drives a real `authoring_spawn` session through both conversational turns, the stage advance, and the accept/reject/amend decisions, reporting pass/fail per roadmap criterion; `--self-test` runs fully offline (no `claude` binary, no child process — mirroring `authoring-stage-gate-spike.mjs`'s own convention from plan 05-01). `packages/core/tests/bin/uat_authoring_ops.rs` (new harness binary, following `uat_seed_ui.rs`'s/`uat_session_env.rs`'s established pattern) is the bridge: `apply-proposal-created` calls `authoring_proposal::apply_proposal_created` with the REAL sidecar event the script observes on the live session's own stdout stream — the exact function `commands::authoring::handle_inbound_proposal_created` calls in production, not a simulation of it. `authoring_acceptance.rs` gained four more tests (8 total) proving cross-journey listing/ordering properties: stable pending-proposal order across two reads, two byte-identical criterion statements staying two distinct rows, a zero-criteria task producing zero criteria rows, and per-project key allocation following ACCEPTANCE order rather than proposal order. `REQUIREMENTS.md`'s five SHAPE rows are marked Complete in this same commit, matched against the evidence above; `STATE.md`'s Blockers/Concerns section closes the Nimbalyst re-scout (05-01) and `epic_roster`-unbounded (05-04) rows, rewords (does not close) the product-kill-criterion row since the live comparison itself was not run, and leaves the `context_packet.rs`-unbounded row untouched, as instructed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Reopen an epic, and be argued with about the change** — `cdd24f5` (feat)
2. **Task 2: One automated run that proves the phase** — `cf65d99` (test)
3. **Task 3: The live acceptance run, and a ledger that matches its evidence** — `0b2240f` (feat)

**Plan metadata:** see below.

## Files Created/Modified

- `packages/core/tests/authoring_acceptance.rs` — 8 tests: the four roadmap-criterion journeys plus four cross-journey edge properties
- `packages/core/tests/bin/uat_authoring_ops.rs` — the live-UAT Rust bridge (register-project, start-run, advance-stage, apply-proposal-created, list-pending, accept-proposal/-subtree, reject-proposal, amend-criterion, close-run, epic-packet, board-counts)
- `packages/desktop/src/board/__tests__/reopen-epic.test.tsx` — 6 tests covering both reopen doors
- `scripts/uat/uat-08-socratic-authoring.mjs` — the live acceptance script
- `packages/desktop/src-tauri/src/commands/authoring.rs` — `authoring_run_start` widened, `authoring_run_for_epic`, `authoring_preview_epic_packet` + its DTOs
- `packages/desktop/src-tauri/src/main.rs` — two new commands registered
- `packages/desktop/src/App.tsx` — `launchSheetAuthoringHandoff` wired to `LaunchSheet`'s `authoring`/`onAuthoringStarted` props
- `packages/desktop/src/adapters/tauri.ts` — `resumed` on `AuthoringRunDto`, `authoringRunForEpic`, `EpicContextPacketDto` and siblings, `previewEpicContextPacket`
- `packages/desktop/src/board/BoardView.tsx` — the `continue-shaping` keyboard case, `onContinueShaping` wired to `ItemDetailPanel`
- `packages/desktop/src/board/CommandPalette.tsx` — the `continue-shaping` palette case and `EPIC_ONLY_ACTION_IDS`
- `packages/desktop/src/board/useBoardQuery.ts` — `continueShapingEpic`
- `packages/desktop/src/item-detail/ItemDetailPanel.tsx` — the "Continue Shaping" section (epic-only)
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` — the authoring variant (`authoring`/`onAuthoringStarted` props, `EpicPacketBody` and its subsections)
- `packages/desktop/src/state/keyboard.ts` — `continue-shaping` ActionId and its `r` binding
- `packages/core/tests/epic_context_packet.rs` — the end-to-end priming assertion test
- `packages/core/Cargo.toml` — `uat_authoring_ops` binary registration
- `scripts/uat/run-all.sh` — UAT 8 joined, prerequisites build list widened
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/WINDOWS.md`, `05-VALIDATION.md` — the ledger

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `keyboard-agent.test.tsx`'s own hardcoded board-list-letter sanity check needed updating for the new `r` binding**
- **Found during:** Task 1, running the full desktop test suite after adding `continue-shaping`
- **Issue:** `board-list additions > start-work/open-live-session do not collide with Phase 1's existing board-list letters` asserts a fixed, sorted array of every board-list single-letter key at the time it was written — adding `r` for `continue-shaping` made the array stale, failing the test (not a collision, a snapshot going out of date).
- **Fix:** Added `"r"` to the expected sorted array, with a comment naming the addition.
- **Files modified:** `packages/desktop/src/state/__tests__/keyboard-agent.test.ts`
- **Verification:** `npm --prefix packages/desktop run test` (522/522, then 534/534 once Task 1's own new tests were added)
- **Committed in:** `cdd24f5` (Task 1's own commit)

**2. [Rule 2 - Missing Critical] `CommandPalette.tsx` needed an explicit case and disabled-predicate entry for `continue-shaping`**
- **Found during:** Task 1, after adding the new board-list action id
- **Issue:** The palette's generic fallback would have pushed `continue-shaping` as a "Selected item" command with `runBoardListAction`'s own `default: break;` doing nothing on selection — the exact dead-menu-entry defect `return-stage`'s own case (plan 05-03) and the tray's four verbs' own cases (plan 05-07) were both added specifically to avoid.
- **Fix:** Added a `continue-shaping` case calling `continueShapingEpic` (mirroring `open-live-session`'s own task-only pattern, inverted to epic-only), and a new `EPIC_ONLY_ACTION_IDS` set disabling the command when a task is selected.
- **Files modified:** `packages/desktop/src/board/CommandPalette.tsx`
- **Verification:** `npm --prefix packages/desktop run build`; full test suite green
- **Committed in:** `cdd24f5` (Task 1's own commit)

**3. [Rule 3 - Blocking] `board-counts`'s own SQL referenced a `project_id` column `acceptance_criteria` does not have**
- **Found during:** Task 3, smoke-testing `uat_authoring_ops` end-to-end by hand
- **Issue:** `acceptance_criteria` (D-06) carries no `project_id` column of its own — it is scoped only via its `parent_type`/`parent_id`. The first cut of `board-counts` queried `WHERE project_id = ?1` directly, which SQLite silently accepted as a query returning no rows (via `.unwrap_or(0)`) rather than a visible error, so the count read `0` even after a real criterion was accepted.
- **Fix:** Rewrote the criteria count as the sum of two subqueries joined through `tasks`/`epics`, matching how every other project-scoped criteria read in this crate resolves the same join.
- **Files modified:** `packages/core/tests/bin/uat_authoring_ops.rs`
- **Verification:** Hand-verified end-to-end against a scratch database (register-project → start-run → advance-stage → apply-proposal-created ×2 → accept-subtree → board-counts reporting `{"criteria":1,"epics":0,"tasks":1}`, matching the fixture)
- **Committed in:** `0b2240f` (Task 3's own commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 — a stale test snapshot this plan's own new binding made stale, 1 Rule 2 — a missing-critical dead-menu-entry defect this plan's own new action id would otherwise have introduced, 1 Rule 3 — a blocking bug in this plan's own new harness binary, caught before it ever reached a committed test). **Impact:** All three are necessary consequences of implementing the plan's own action items as written; none touch product behaviour beyond what the plan specifies.

## Issues Encountered

**The live half of `uat-08-socratic-authoring.mjs` was not executed this session.** The `claude` CLI and real credentials are present on this machine, but running the live flow would spend real API tokens against the developer's own account with no explicit instruction to do so — this autonomous run declined to make that call unilaterally. `--self-test` (fully offline) was run and passes 5/5. The Rust bridge binary (`uat_authoring_ops`) was smoke-tested end-to-end BY HAND against a scratch database — every subcommand, register-project through epic-packet — outside the automated suite, and that manual verification is what caught Deviation 3 above. The two human judgments the live run's own `<human-check>` requires (whether the challenge is genuine, whether drafted criteria were mostly kept) and the wall-clock comparison against `05-SPIKE-FINDINGS.md`'s terminal arm remain unrecorded, tracked as `WINDOWS.md` entry #16 alongside entries #13/#14 from earlier plans in this phase. This is the SAME class of deferral `05-02-SUMMARY.md` already recorded for the product kill criterion — not a new gap this plan introduced, but this plan's own Task 3 is the first point the phase has a runnable script to actually judge it with.

## User Setup Required

None — no external service configuration required. (Running the live half of `uat-08-socratic-authoring.mjs` requires a working, authenticated `claude` CLI, which this session confirmed is present but did not exercise live.)

## Next Phase Readiness

- All five SHAPE-01 through SHAPE-05 requirements are marked Complete, matched against real evidence in the same commit.
- The phase's own success criteria (`ROADMAP.md` §"Phase 5") now have a single automated proof (`authoring_acceptance.rs`) and a live acceptance path (`uat-08-socratic-authoring.mjs`) — the live path itself still needs a human to run it deliberately before the phase's one remaining qualitative judgment (genuine challenge vs. agreeable validation) can close.
- Phase 6 ("Agents File Their Own Backlog") extends this phase's triage lane and write seam directly — nothing in this plan's own changes narrows that door: `authoring_run_start`'s widened signature, the epic-scoped packet's consumption, and the reopen doors are all additive to what Phase 6 will build on.
- `WINDOWS.md` carries three open entries this phase leaves for a human: #13 (the product kill criterion), #14 (challenge-stage quality), #16 (this plan's own live-run deferral) — all three are most efficiently judged together, in one sitting, running `uat-08-socratic-authoring.mjs` for real.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- All 4 created files found on disk (`authoring_acceptance.rs`, `uat_authoring_ops.rs`, `reopen-epic.test.tsx`, `uat-08-socratic-authoring.mjs`).
- All 3 task commit hashes (`cdd24f5`, `cf65d99`, `0b2240f`) found in git history.
- `cargo build --workspace` succeeds (only the one pre-existing, unrelated `StartRunOutcome` dead-code warning).
- `cargo test --workspace` — 0 failures across every crate, including `authoring_acceptance` 8/8 and `epic_context_packet` 11/11.
- `npm --prefix packages/desktop run build` succeeds; `npm --prefix packages/desktop run test` — 534/534 pass, including `reopen-epic.test.tsx` 6/6 and `launch-sheet.test.tsx` 29/29.
- `npm --prefix packages/sidecar test` — 140/140 pass (unaffected by this plan's own diff).
- `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` — 5/5 assertions pass, exit 0.
- Named grep gates: `grep -cE '#[0-9a-fA-F]{3,8}' packages/desktop/src/item-detail/ItemDetailPanel.tsx` = 0; `grep -c 'uat-08-socratic-authoring' scripts/uat/run-all.sh` = 1; `grep -c 'heartbeat' scripts/uat/uat-08-socratic-authoring.mjs` = 7; `grep -c '#\[test\]' packages/core/tests/authoring_acceptance.rs` = 8; `grep -cE '^- \[[ x]\] \*\*SHAPE-0[1-5]\*\*' .planning/REQUIREMENTS.md` = 5 — all return their expected values.
- `gsd-tools query requirements.mark-complete SHAPE-01..SHAPE-05` reports `already_complete` for all five with zero further diff — the tool's own write agrees with the hand-edited ledger.
- `commits: 3` measured via `git rev-list --count cdd24f5ad81ebd7006495c3b8b63595d51440d68~1..HEAD` (matches `plan_head_before` in frontmatter).
