---
phase: 05-socratic-epic-authoring
plan: 44
subsystem: authoring
tags: [mcp-tools, board-read, proposal-lifecycle, rust, typescript, gap-closure]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-18)
    provides: D-87's board_read channel and resolve_board_read dispatch (search/get_epic/list_tasks)
provides:
  - A fourth capped read tool, proposal_list, so an authoring session can read back the id of a
    proposal it just staged, scoped to its own run.
  - A "list_proposals" arm in resolve_board_read (packages/core/src/query/authoring.rs), the same
    dispatch both the desktop app and the UAT harness call.
  - A regression (authoring_criterion_reachability.rs) that fails if the id-round-trip path is
    removed, proving propose_criterion is reachable in a fresh-epic session.
affects: [phase 05 plans 45-47, any future phase touching authoring proposal reads or the board_read wire contract]

# Actuals (#2632)
actuals:
  tokens: 12200
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A fourth board_read kind added by widening one union/enum plus one match arm, never a new socket or a new held inbound kind — reuses D-87's existing channel end to end (sidecar tool -> requestBoardRead -> resolve_board_read -> domain fn)."
    - "A read tool is proven correct by asserting the emitted wire literal and the Rust match-arm literal against each other's own shipped source text, never by retyping both sides as hand-written strings in the test."

key-files:
  created:
    - packages/core/tests/authoring_criterion_reachability.rs
  modified:
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/adapter.ts
    - packages/core/src/query/authoring.rs
    - packages/core/tests/authoring_board_read.rs
    - packages/sidecar/test/authoring-tools.test.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "Checkpoint (Task 1): Option A — a fourth capped read tool, proposal_list, routed through the existing board_read channel. Reversible, needs no new answering handler in any arm (so no arm can starve), and leaves the propose ack, id-minting authority, D-07, D-88, D-96 and SHAPE-03's wording untouched. Rejected: held-propose (new held kind, starvation risk), sidecar-minted-id (moves primary-key minting across a process boundary, contradicts T-05-02-01), reword-shape-03 (rewrites a shipped requirement, contradicts D-88's own stage machine)."
  - "Deviation (Rule 1 — auto-fixed bug in the plan's own literal instruction): the plan named accept-subtree as the acceptance mechanism for the end-to-end slice, but accept_subtree's own ensure! (authoring_proposal.rs:986) requires its root proposal to be a task, and the slice's root is an epic. Used the pre-existing accept-proposal verb on the CRITERION proposal instead, which is exactly the D-96 implied-parent-walk mechanism the plan's own measured_diagnosis names — accepting the criterion recursively accepts its still-pending epic parent first, in the same transaction."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "A fresh-epic session can obtain the id of a proposal it just staged, through a tool it actually has (proposal_list), scoped to its own run."
    requirement: "SHAPE-02"
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_criterion_reachability.rs#a_fresh_epic_session_reaches_propose_criterion_through_the_id_list_proposals_hands_back"
        status: pass
      - kind: e2e
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: false
  - id: D2
    description: "A criterion staged against that still-pending id materialises into a real acceptance_criteria row when accepted, via D-96's implied-parent walk — proven offline, crossing the Node/Rust boundary, without spending a token."
    requirement: "SHAPE-03"
    verification:
      - kind: e2e
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_criterion_reachability.rs#a_fresh_epic_session_reaches_propose_criterion_through_the_id_list_proposals_hands_back"
        status: pass
    human_judgment: false
  - id: D3
    description: "A named regression fails if the reachability path is broken again — verified live by disabling the list_proposals arm and confirming all three tests in the new file turn red, then restoring."
    requirement: "SHAPE-02"
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_criterion_reachability.rs (falsifiability check performed live during this plan, not committed as a test)"
        status: pass
    human_judgment: false
  - id: D4
    description: "stageAuthoringProposal, HELD_INBOUND_REQUEST_TYPES, the propose ack shape, D-07's schema-layer rejection point and SHAPE-03's wording are all unchanged — the fix is additive only."
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/authoring-tools.test.mjs (full suite, 192/192 pass)"
        status: pass
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
    human_judgment: false

duration: ~50min (Tasks 2-3, resumed from Task 1's decision checkpoint)
completed: 2026-09-26
status: complete
---

# Phase 05 Plan 44: Agent Can Read Its Own Staged Proposal's Id Back Summary

**A fourth capped read tool, `proposal_list`, closes gap G-05-9: `propose_criterion` was structurally unreachable because a staged proposal's id was never returned to the agent that staged it — now it is, through the same `board_read` channel `board_search`/`epic_get`/`task_list` already use.**

## Performance

- **Duration:** ~50 min (Tasks 2-3 only; Task 1's decision was made by the user before this agent was spawned)
- **Completed:** 2026-09-26T12:21:29Z
- **Tasks:** 2 (Task 1 required no code — the decision was recorded, not re-derived)
- **Files modified:** 6 modified, 1 created

## Accomplishments

- Added `proposal_list` — a fourth read tool, `PROPOSAL_LIST_TOOL_NAME`/`AUTHORING_PROPOSAL_LIST_TOOL_NAME`, registered statically alongside `board_search`/`epic_get`/`task_list`, deliberately outside the `propose_`/`amend_`/`delete_` prefix so plan 05-03's stage-gate matcher never catches it.
- Added a `"list_proposals"` arm to `resolve_board_read` (`packages/core/src/query/authoring.rs`), scoped server-side to the `run_id` parameter (never from the event), applying the same `DEFAULT_LIMIT`/`MAX_LIMIT` clamp-and-peek arithmetic every other arm uses, and projecting each row to `id`/`verb`/`targetType`/`parentProposalId`/`status`/`label` only.
- Extended `scripts/uat/uat-08-socratic-authoring.mjs --board-read-check` into a genuine end-to-end slice: an epic proposal is staged, its id is read back through the real dispatch while it is still pending, a criterion is staged naming that id as its parent, the criterion is accepted (driving D-96's implied-parent walk to accept the still-pending epic first), and `board-counts` confirms a real `acceptance_criteria` row exists — offline, zero tokens.
- Added `packages/core/tests/authoring_criterion_reachability.rs`, a finding-first regression that fails if the `list_proposals` arm is removed (verified live during this session).
- Fixed the two `authoring-tools.test.mjs` assertions this round's own `npm test` turned red (nine→ten tools, three→four read names), and added a two-sided `readKind` contract test that reads both the sidecar's emitted literal and the Rust match arm out of their own shipped source files.

## Task Commits

1. **Task 1: Decide how the agent learns a staged proposal's id** — no commit (decision recorded here and in STATE.md; resolved before this agent was spawned, per the resume state)
2. **Task 2: End-to-end slice** — `334f478` (feat)
3. **Task 3: Regression + two-sided contract** — `fb615a2` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS)

## Files Created/Modified
- `packages/sidecar/src/mcp-permission-server.ts` — `PROPOSAL_LIST_TOOL_NAME`/`AUTHORING_PROPOSAL_LIST_TOOL_NAME`, `proposalListToolDefinition`, its `CallToolRequestSchema` branch, widened `AUTHORING_READ_TOOL_NAMES` (3→4) and `BoardReadRequestPayload.readKind`, and (Task 3) `propose_criterion`'s description now names `proposal_list`
- `packages/sidecar/src/adapter.ts` — widened `BoardReadRequestEvent.readKind` to include `"list_proposals"`
- `packages/core/src/query/authoring.rs` — the new `"list_proposals"` arm in `resolve_board_read`
- `packages/core/tests/authoring_board_read.rs` — `list_proposals`'s own clamp/truncate/ceiling-edge-case coverage
- `packages/core/tests/authoring_criterion_reachability.rs` — new: the finding-first reachability regression
- `packages/sidecar/test/authoring-tools.test.mjs` — updated tool counts, added the two-sided `readKind` contract test
- `scripts/uat/uat-08-socratic-authoring.mjs` — `--board-read-check` extended into the full end-to-end slice

## Decisions Made

**Task 1 checkpoint decision (Option A, `read-tool`):** a fourth capped read tool, `proposal_list`, routed through the existing `board_read` channel. Chosen because it is the only reversible option of the four, the only one needing no new answering handler in any arm (so no arm can starve — the exact failure `scripts/uat/README.md` Item 8 records twice), and the only one leaving D-07, D-88, D-96 and SHAPE-03's wording all exactly as they were. Rejected: `held-propose` (new held inbound kind, starvation risk, changes the propose stdio contract), `sidecar-minted-id` (moves the `authoring_proposals` primary key's minting authority across a process boundary, contradicting T-05-02-01's own stated discipline three times over), `reword-shape-03` (rewrites a shipped requirement to accommodate a constraint measurement showed does not exist).

See also the frontmatter `key-decisions` for the Task 2 execution deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's own literal instruction to use `accept-subtree` on the epic proposal would fail**
- **Found during:** Task 2 (the end-to-end slice)
- **Issue:** The plan's Task 2 action text says "Accept the EPIC proposal's subtree via `accept-subtree`." `accept_subtree`'s own `ensure!` (`packages/core/src/domain/authoring_proposal.rs:986`) requires its root proposal to have `target_type == "task"`. Calling it on an EPIC proposal errors with `"accept_subtree's root must be a task proposal, got a Epic proposal"`.
- **Fix:** Used the pre-existing `accept-proposal` verb on the CRITERION proposal instead — this is exactly the D-96 implied-parent-walk mechanism the plan's own `<measured_diagnosis>` names: `accept_proposal_in_tx` (`authoring_proposal.rs:679-684`) recursively accepts a still-pending `parent_proposal_id` FIRST, in the same transaction, before the criterion materialises. Accepting the criterion therefore accepts the still-pending epic proposal first, then materialises the criterion against it — landing the real `acceptance_criteria` row the plan's `<done>` criterion asks for, through the mechanism the plan itself measured and named.
- **Files modified:** `scripts/uat/uat-08-socratic-authoring.mjs`
- **Verification:** `node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check` passes end to end; `board-counts` reports `criteria: 1`.
- **Committed in:** `334f478` (Task 2 commit)

**2. [Process note, not a rule] The Task 3(d) description-only edit to `mcp-permission-server.ts` landed in the Task 2 commit**
- **Found during:** staging Task 3's commit
- **Issue:** Both Task 2 and Task 3(d) touch `packages/sidecar/src/mcp-permission-server.ts`. The Task 3(d) edit (naming `proposal_list` in `propose_criterion`'s description) was made before Task 2's files were staged, so `git add` on the whole file swept both hunks into the Task 2 commit (`334f478`).
- **Fix:** None needed — the content is correct and the change is purely descriptive (model-facing tool copy, no schema/logic change). Documented here so the commit history's own attribution is accurate rather than silently wrong.
- **Files modified:** none (documentation of an already-correct state)
- **Verification:** `git show 334f478 -- packages/sidecar/src/mcp-permission-server.ts` shows the description hunk.
- **Committed in:** `334f478`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug), 1 process note (commit attribution only, no code impact).
**Impact on plan:** The Rule 1 fix was necessary for the plan's own `<done>` criterion to be achievable at all — a literal implementation of the plan's instruction would have thrown at test-run time. No scope creep; the fix uses a verb the plan's own read_first list already named (`accept-proposal` exists in `uat_authoring_ops.rs` and was already called earlier in the same arm for the epic proposal).

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

- `propose_criterion` is now reachable in a fresh-epic session, end to end, proven offline.
- Full verification suite green: `node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check` (new slice), `--self-test`, `--replay-check` (all scenarios); `cargo test -p core --test authoring_criterion_reachability`; `cargo test -p core --test authoring_board_read`; `npm --prefix packages/sidecar test` (192/192); `cargo test --workspace` (72/72 test binaries, 0 failures).
- Plans 05-45, 05-46 and 05-47 (which depend on this plan) can proceed. The single remaining gap this round's own register notes but explicitly leaves untouched: the comment/code divergence at `uat-08-socratic-authoring.mjs:6429`'s single-shot proposal drain, assigned to plan 05-46.
- A live re-run of the challenge transcript (SHAPE-03's live verdict) was explicitly out of scope for this plan and remains for a future live-verification round.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- `packages/core/tests/authoring_criterion_reachability.rs` — FOUND on disk
- `.planning/phases/05-socratic-epic-authoring/05-44-SUMMARY.md` — FOUND on disk
- Commit `334f478` (Task 2) — FOUND in `git log --oneline --all`
- Commit `fb615a2` (Task 3) — FOUND in `git log --oneline --all`
- All `<acceptance_criteria>`/`<done>` gates re-verified: `node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check` PASS; `cargo test -p core --test authoring_criterion_reachability` PASS (3/3); `cargo test -p core --test authoring_board_read` PASS (6/6); `npm --prefix packages/sidecar test` PASS (192/192); `cargo test --workspace` PASS (72/72 binaries, 0 failed); `--self-test` and `--replay-check` (all 5 scenarios) PASS.
- Falsifiability of the load-bearing regression confirmed live: disabling the `list_proposals` match arm turned all three `authoring_criterion_reachability.rs` tests red with `unknown board read kind "list_proposals"`; restoring the arm turned them green again.
