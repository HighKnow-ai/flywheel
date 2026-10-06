---
phase: 08-review-and-merge-inside-flywheel
plan: 02
subsystem: review
tags: [rust, sqlite, git, tauri, context-packet]
status: complete

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "review.rs target resolution (ReviewScope, ReviewTarget, resolve_review_target) and git::git_output_at"
provides:
  - "criterion_anchors table (migration 0018): one cascading row per checked criterion, absence = no evidence"
  - "check_criterion_with_anchor, AnchorInput, CriterionAnchor, anchor_for_criterion"
  - "review::anchor_staleness / AnchorStaleness (Untouched, Changed, MovedOrChanged, Unknown), derived from git on every read"
  - "review::review_criteria_state plus its lock-free halves criteria_with_anchors / with_staleness"
  - "review_criteria_state and criterion_check_with_anchor Tauri commands (no sha parameter) and adapter wrappers"
  - "context packet criteria carry checked state, anchor and staleness, rendered as one evidence line"
affects: [08-03, 08-04, 08-05, 08-06, 08-07, 08-08]

requirements-completed: [REVW-03]

actuals:
  tokens: 21000
  tasks: 3
  commits: 3
plan_head_before: 3d95fc3b29fc9f5eac586b112c13e91eb3b293cc

coverage:
  - deliverable: "Anchor storage: core-resolved sha, replace-on-recheck, cleared on uncheck, carried across revision, cascaded on delete"
    verification:
      - kind: test
        ref: "packages/core/tests/criterion_anchors.rs"
        status: pass
    human_judgment: false
  - deliverable: "Staleness derived from git: untouched, changed (count), unknown sha, path gone, rename source"
    verification:
      - kind: test
        ref: "packages/core/tests/criterion_anchors.rs"
        status: pass
    human_judgment: false
  - deliverable: "Commands: no sha parameter, registered once, capability roster updated"
    verification:
      - kind: command
        ref: "cargo build --workspace; grep gates in 08-02-PLAN.md Task 2 verify; npm --prefix packages/desktop run build"
        status: pass
    human_judgment: false
  - deliverable: "Context packet evidence line (checked + anchored only) with staleness clause, deterministic"
    verification:
      - kind: test
        ref: "packages/core/tests/context_packet.rs"
        status: pass
    human_judgment: false

tech-stack:
  added: []
  patterns:
    - "Separate evidence table whose row absence is the no-evidence state, cascading from its parent"
    - "Resolve under the DB lock, drop it, then run git (criteria_with_anchors / with_staleness split)"
    - "Command signature, not validation, makes a renderer-supplied sha impossible"

key-files:
  created:
    - packages/core/src/db/migrations/0018_criterion_anchors.sql
    - packages/core/tests/criterion_anchors.rs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/acceptance_criterion.rs
    - packages/core/src/review.rs
    - packages/core/src/context_packet.rs
    - packages/core/src/epic_context_packet.rs
    - packages/core/src/query/authoring.rs
    - packages/core/tests/context_packet.rs
    - packages/desktop/src-tauri/src/commands/review.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts

key-decisions:
  - "Anchors live in their own table keyed by criterion id; the absence of a row is the no-evidence state, so none of the roughly eight positional AcceptanceCriterion reads changed"
  - "toggle_criterion and check_criterion_with_anchor share one private write_checked transaction, so there is exactly one DELETE FROM criterion_anchors and one event append per write"
  - "A re-check with no anchor leaves an existing anchor in place; only an uncheck clears it"
  - "Staleness order: unresolvable sha or head is Unknown, then path missing at head, then rename source since the sha, then commit count"
  - "The packet derives staleness itself through review::staleness_for_target, so the agent and the rail read one verdict; an unmeasured anchor renders as undetermined, never unchanged"

duration: ~60min
completed: 2026-10-06
---

# Phase 8 Plan 02: Criterion Anchors Summary

**Checking an acceptance criterion can now record the file, side, line range and core-resolved sha it was read at, with staleness re-derived from git on every read and carried into the context packet, and nothing ever unchecked behind the user's back.**

## Accomplishments

- **Storage.** Migration `0018` adds `criterion_anchors` (PK and cascading FK on the criterion, CHECK-bound side and range). Registered once in `migration_source_list()`.
- **Write path.** `check_criterion_with_anchor` always sets `checked = 1`, upserts the anchor, and appends one `criterion.toggled` event whose payload gains an `anchor` key. The uncheck branch of `toggle_criterion` deletes the anchor in the same transaction. `revise_criterion_in_tx` copies the anchor onto the successor row, closing the D-77 vs D-140 regression. Side, path length and line range are refused with named errors before any write.
- **Staleness.** `anchor_staleness` returns Unknown for an unresolvable sha or head, MovedOrChanged for a missing path or a rename source, otherwise Changed with a commit count or Untouched. Nothing is stored.
- **Commands.** `review_criteria_state` (read) and `criterion_check_with_anchor` (write). The write has no sha parameter, resolves the head sha itself, checks the criterion belongs to the item, and emits `board:changed` once. Adapter wrappers added.
- **Packet.** `CRITERIA_SQL` left-joins the anchor; a checked, anchored criterion gets one `Evidence:` line with path, range, side, short sha and a staleness clause. Unchecked or anchorless criteria render nothing extra.

## Task Commits

1. Task 1: `ff31705` table, check-with-anchor, clear on uncheck, carry on revise (14 tests in `criterion_anchors.rs`)
2. Task 2: `9e9a726` staleness, two commands, adapter (6 more tests, 20 total)
3. Task 3: `a0fd437` packet evidence (8 new tests in `context_packet.rs`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Structural] Shared `write_checked` instead of a duplicated toggle body**
- **Found during:** Task 1
- **Issue:** The plan asks `check_criterion_with_anchor` to contain exactly one `append_event(` call, built on a copy of the toggle body. Copying about 60 lines would also have put two delete sites in the file against the "exactly one way an anchor disappears" gate.
- **Fix:** both public functions delegate to one private `write_checked`. The intent holds (one transaction, one event per write, one anchor delete); a literal per-function `append_event(` grep over `check_criterion_with_anchor` would count zero.
- **Files modified:** `packages/core/src/domain/acceptance_criterion.rs`
- **Commit:** ff31705

**2. [Rule 2 - Missing functionality] Command refuses a partial anchor and a foreign criterion**
- **Found during:** Task 2
- **Issue:** The plan builds the anchor only when all four fields are present; a partial set would silently check with no evidence. A criterion id from another item would pair its check with the wrong branch's sha.
- **Fix:** a partial set is an error, and the command verifies the criterion's parent equals the scope and item id.
- **Commit:** 9e9a726

**3. [Rule 3 - Blocking] `CriterionEntry` widened at two roster call sites**
- **Issue:** `epic_context_packet.rs` and `query/authoring.rs` construct `CriterionEntry` by struct literal and stopped compiling when it gained fields (neither was in `files_modified`).
- **Fix:** both selects now read `checked`; `anchor` and `anchor_staleness` are `None`, documented on the type as "roster reads do not load anchors".
- **Commit:** a0fd437

**4. [Rule 1 - Contract] Packet header no longer says "no git call"**
- `context_packet.rs` documented that assembly never calls git. The plan requires staleness in the packet, so the header now records the one bounded read-only exception.

**Total deviations:** 4 auto-fixed (1 bug-contract, 1 missing-functionality, 2 blocking/structural). **Impact:** none on scope.

## Verification

- `cargo test -p core --test criterion_anchors`: 20 passed. `context_packet`: 26 passed (18 before). `migration_safety`, `criteria`, `criteria_pin`, `supervisor_cwd`, `activity_trail`, `diff_so_far`, `five_cycle_reconstitution`, `epic_context_packet`: pass.
- `cargo build --workspace` clean (one pre-existing dead-code warning). `npm --prefix packages/desktop run build` ok.
- Plan grep gates: migration registered once, one `DELETE FROM criterion_anchors`, both commands once in `main.rs`, no `sha: String` in the check command, no `INSERT INTO` in `review.rs`, `criterion_check_with_anchor` on one capability line, `name-status` precedes `rev-list`, one `criterion_anchors` line in `context_packet.rs`, no interpolated SELECT.

## Issues Encountered

- `cargo test --workspace` was run with `--skip credential --skip api_key` (the keychain tests block on this machine, as noted in 08-01). Under full-workspace load, `perf_seed_1000::search_at_1000_items_is_under_50ms` failed once and `worktree_lifecycle` panicked once; both pass when run alone, so they are timing and load sensitive and unrelated to this plan.
- The command-level "emits board-changed once" behaviour has no automated test: it needs a Tauri `AppHandle`. It is one `app.emit` call at the end of the command.
- `npm`-side UI for the rail and the anchored check gesture is plan 08-06's work; only the adapter wrappers exist here.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-08-02-01 through T-08-02-04, -06 and -07 are mitigated as specified.

## Next Phase Readiness

Ready for 08-03. `review_criteria_state` and `criterionCheckWithAnchor` are in place for the rail, and `staleness_for_target` is available to the merge confirm sheet.

## Self-Check: PASSED

- `0018_criterion_anchors.sql` and `criterion_anchors.rs` exist on disk.
- Commits `ff31705`, `9e9a726`, `a0fd437` present in `git log`; `git rev-list --count` from `plan_head_before` is 3.
