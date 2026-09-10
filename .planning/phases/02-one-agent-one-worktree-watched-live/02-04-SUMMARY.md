---
phase: 02-one-agent-one-worktree-watched-live
plan: 04
subsystem: agent-runtime
tags: [rust, rusqlite, tauri, typescript, react, radix-ui, tanstack-query, vitest]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-01's start_agent_run/ensure_worktree/task_branch_name/base_ref_for_task,
      agent_run_start tracer command, ItemDetailPanel Start Work affordance, SessionSurface —
      the surfaces this plan extends and re-wires. Plan 02-03's agent signal vocabulary
      (theme/tokens.ts AGENT group, legend/marks.ts agent channel, state/keyboard.ts start-work
      action id) — bound to, not re-derived."
provides:
  - "core::context_packet::{ContextPacket, assemble_context_packet, render_prompt} — the D-28
    genuine stub of Phase 4's ContextAssembler, same signature and determinism contract Phase 4's
    multi-cycle drift suite is written against"
  - "agent_run_preview Tauri command — the launch sheet's read-only briefing (D-27), proven to
    perform no insert/update/delete"
  - "agent_run_start extended with a validated instruction argument, rendering its sidecar prompt
    through the same render_prompt function agent_run_preview uses"
  - "launch-sheet/LaunchSheet.tsx — the D-27 briefing gate before anything is spawned"
  - "state/uiStore.ts's launchSheetTaskId — the cross-tree trigger pattern any future App.tsx-level
    overlay opened from deep inside the board tree should reuse"
affects: [02-05, 02-06, 02-07, 02-08, 02-09, 02-10, 04-01]

# Actuals (#2632)
actuals:
  tokens: 23641
  tasks: 3
  commits: 5
  plan_head_before: 5eccec46866d6cf855ae7826288653a84249a359

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Preview/launch symmetry: one Rust-side render_prompt function called from both the
      read-only preview command and the mutating start command — a test proves structural
      equality rather than resting on convention (T-02-21)"
    - "Read-only prediction over a mutating helper: assemble_context_packet re-derives the
      hypothetical epic-integration-branch name read-only instead of calling
      domain::worktree::base_ref_for_task, which would cut a real git branch as a side effect —
      a preview must never mutate, even indirectly"
    - "App.tsx-level overlay triggered by a bare id in uiStore.ts (launchSheetTaskId), mirroring
      activeAgentRunId's own precedent, so a deeply-nested trigger component never imports the
      overlay component itself"

key-files:
  created:
    - packages/core/src/context_packet.rs
    - packages/core/tests/context_packet.rs
    - packages/desktop/src/launch-sheet/LaunchSheet.tsx
    - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
  modified:
    - packages/core/src/lib.rs
    - packages/core/tests/agent_tracer.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/App.tsx
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/board/BoardView.tsx
    - DESIGN.md

key-decisions:
  - "assemble_context_packet does NOT call domain::worktree::base_ref_for_task for a task with no
    worktree yet, despite the plan's own read_first pointing at it — that function cuts a real git
    branch (via ensure_epic_integration_branch) as a side effect the moment an epic has no
    integration branch yet. A preview must never do that, so a private read-only predictor
    re-derives the identical hypothetical value instead."
  - "agent_run_start re-assembles the context packet AFTER start_agent_run creates the worktree
    (not before, against a predicted packet) — simpler and strictly correct: it reads the now-real
    worktree row rather than depending on the prediction matching exactly (though the Task 1 test
    proves it does)."
  - "ContextPacket gained a task_key field beyond the plan's own literal <behavior> enumeration —
    the launch sheet's header ('Start Work on {TASK-KEY}') needs it, and the packet is the single
    source of truth for the sheet's content; adding a structural field is a compatible extension,
    not a breaking change to the D-28 contract."
  - "launchSheetTaskId added to state/uiStore.ts (outside this plan's declared files_modified) —
    a necessary deviation: ItemDetailPanel.tsx deliberately avoids importing the store directly
    (an established, pre-existing convention this plan preserved), so opening an App.tsx-mounted
    overlay from inside it requires the same cross-tree state pattern activeAgentRunId already
    uses."
  - "BoardView.tsx's start-work switch case added (also outside declared files_modified) — without
    it, ItemDetailPanel's onStartWork callback prop had no caller wiring it to the store, and the
    board-list w keystroke (02-UI-SPEC.md's own keyboard map) would stay permanently unreachable."

patterns-established:
  - "A Rust function taking &Connection (not &mut Connection) as a structural signal of
    read-only intent, reserved for genuine preview/query paths — context_packet.rs is the first
    module in this crate to use this convention deliberately for a whole-file contract."

requirements-completed: [DATA-04, WORK-01, AGNT-01, AGNT-02]

coverage:
  - id: D1
    description: "assemble_context_packet is a pure deterministic query — two calls against an
      unchanged database return byte-identical packets and rendered prompts, and reordering a
      criterion changes the output (proving determinism, not constancy)"
    requirement: "AGNT-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/context_packet.rs#determinism_two_calls_are_byte_identical_and_a_reorder_changes_the_output"
        status: pass
    human_judgment: false
  - id: D2
    description: "The packet never mutates the database or cuts a git branch, even for a task
      with an epic and no integration branch cut yet — proven both by row-count invariants and by
      asserting the predicted branch name does not exist in the repository"
    requirement: "AGNT-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/context_packet.rs#assembling_the_packet_never_mutates_triggers_worktrees_or_agent_runs_row_counts"
        status: pass
      - kind: unit
        ref: "packages/core/tests/context_packet.rs#a_task_with_no_worktree_yet_predicts_exactly_what_ensure_worktree_would_create"
        status: pass
    human_judgment: false
  - id: D3
    description: "For a task with no worktree yet, the predicted branch/base-ref/path exactly
      match what ensure_worktree actually creates; for a task with an existing worktree, the
      packet reports the stored row's values, not a fresh derivation"
    requirement: "WORK-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/context_packet.rs#a_task_with_no_worktree_yet_predicts_exactly_what_ensure_worktree_would_create"
        status: pass
      - kind: unit
        ref: "packages/core/tests/context_packet.rs#an_existing_worktree_reports_the_stored_row_not_a_fresh_derivation"
        status: pass
    human_judgment: false
  - id: D4
    description: "agent_run_preview performs no insert/update/delete and emits no event; the
      preview's rendered prompt and the started run's prompt come from the same render_prompt
      call (one Rust-side renderer, no second implementation in the renderer)"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::build_preview_dto_performs_no_insert_update_or_delete"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::the_previewed_prompt_and_the_started_runs_prompt_come_from_the_same_renderer"
        status: pass
    human_judgment: false
  - id: D5
    description: "agent_run_start rejects an out-of-list permission_mode or an over-4000-character
      instruction before any sidecar request is sent, and persists the accepted permission_mode on
      the agent_runs row"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::validate_permission_mode_accepts_exactly_the_four_named_values_and_rejects_others"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::validate_instruction_trims_and_rejects_over_4000_characters"
        status: pass
      - kind: integration
        ref: "packages/core/tests/agent_tracer.rs#start_work_creates_worktree_branch_and_linked_rows"
        status: pass
    human_judgment: false
  - id: D6
    description: "The launch sheet renders the exact header/placeholder/mode-label copy, defaults
      to Accept Edits, submits the adapter value each label maps to with no relabeling, and
      Cancel/Escape leave the start command uncalled"
    requirement: "DATA-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx (header/placeholder/mode-label/Cancel/Escape describe blocks)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Enter submits from the sheet's body; Enter inserts a newline inside the
      free-text field; ⌘Enter submits from inside the field; an empty instruction still submits"
    requirement: "DATA-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx (Enter/⌘Enter/empty-instruction describe blocks)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Pressing Start Work in the running packaged app opens the sheet with the real
      briefing, and cancelling it creates no worktree directory and writes no database rows"
    verification: []
    human_judgment: true
    rationale: "The automated suite proves the read-only contract and the UI behavior against
      mocked/fixture data; actually launching the packaged desktop app, pressing Start Work, and
      confirming nothing was created on a real filesystem/database has not been observed by a
      human yet — the plan's own <verification> block's manual step, deferred to end-of-phase UAT
      per workflow.human_verify_mode=end-of-phase, the same pattern 02-01/02-02/02-03-SUMMARY.md
      used for their own manual steps."

duration: 70min
completed: 2026-09-10
status: complete
---

# Phase 2 Plan 4: Context Packet and the Launch Sheet Summary

**`assemble_context_packet`/`render_prompt` ship as a pure, mutation-free query proven by a determinism-not-constancy test; the launch sheet renders that packet as a 640px briefing gate reusing the command palette's overlay mechanics, and `agent_run_start` now sends the sidecar the exact prompt the sheet just previewed instead of a title+description placeholder.**

## Performance

- **Duration:** 70 min
- **Started:** 2026-09-10 (continuation of Phase 2 execution)
- **Completed:** 2026-09-10
- **Tasks:** 3/3 completed
- **Files modified:** 15 (4 created, 11 modified)

## Accomplishments

- **`core::context_packet`** (new module): `ContextPacket`/`render_prompt`, D-28's genuine stub of
  Phase 4's `ContextAssembler`. Reads task/epic/criteria/worktree facts through literal bound SQL
  only, taking `&Connection` (never `&mut`) as a structural signal that it cannot open a
  transaction. Nine named tests in `packages/core/tests/context_packet.rs`, including the
  load-bearing determinism/reorder case and a no-mutation row-count invariant even for the
  epic-with-no-integration-branch-yet case.
- **`agent_run_preview`** Tauri command: the launch sheet's one read, projecting the packet into a
  camelCase `ContextPacketDto`. Proven to insert/update/delete nothing via a factored, directly
  unit-testable `build_preview_dto` function (mirroring this file's own
  `resolve_log_window_limit`/`read_log_window` precedent for testing Tauri-command logic without a
  full Tauri harness).
- **`agent_run_start`** extended: validates a new `instruction: Option<String>` argument (trim,
  reject over 4000 characters), and now builds the sidecar's initial prompt via the SAME
  `render_prompt` call the preview uses — one Rust-side renderer, proven by a unit test, not left
  to convention.
- **`launch-sheet/LaunchSheet.tsx`**: a 640px/80vh centred overlay reusing
  `board/CommandPalette.tsx`'s scrim/`FocusScope`/`DismissableLayer`/portal machinery. Renders the
  preview's epic/task/criteria/worktree facts read-only (worktree facts in the Mono font stack),
  a pinned free-text instruction field, a four-option permission-mode segmented control
  (`Accept Edits` default, D-36), and Start Work/Cancel actions. Enter submits from the body;
  Enter inserts a newline in the field, `⌘Enter` submits from inside it; Escape/Cancel call no
  start command.
- **Wiring**: `ItemDetailPanel.tsx`'s "Start Work" button now opens the sheet via an `onStartWork`
  callback instead of calling `startAgentRun` directly; `state/uiStore.ts` gained
  `launchSheetTaskId` (mirroring `activeAgentRunId`'s own cross-tree precedent) so the sheet,
  mounted once in `App.tsx`, is triggered from `ItemDetailPanel` and the board-list `start-work`
  action id (`w`) without either importing the sheet component.

## Task Commits

Each task was committed atomically:

1. **Task 1: `assemble_context_packet` — a pure query with the determinism contract** — `d015ac8` (feat)
2. **Task 2: `agent_run_preview` — the launch sheet's read-only briefing** — `118145d` (feat)
3. **Task 3: The launch sheet — the gate before anything is spawned** — `ebce322` (feat)

Plus two small follow-up commits inside this plan's own scope:
- `0a4da21` (test) — closes Task 2's own `agent_runs.permission_mode` acceptance criterion, which
  had no runnable proof.
- `a476c9c` (docs) — the DESIGN.md craft-floor review this phase's own Build Process Requirement
  (inherited from Phase 1) binds every UI-touching plan to.

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/core/src/context_packet.rs` — `ContextPacket`/`assemble_context_packet`/`render_prompt`
- `packages/core/tests/context_packet.rs` — 9 named tests covering every `<behavior>` case
- `packages/core/src/lib.rs` — registers `context_packet`
- `packages/core/tests/agent_tracer.rs` — one added assertion (`permission_mode` persisted)
- `packages/desktop/src-tauri/src/commands/agent_run.rs` — `agent_run_preview`,
  `ContextPacketDto`/`CriterionDto`, `agent_run_start`'s `instruction` argument and `render_prompt`
  call, 5 new unit tests
- `packages/desktop/src-tauri/src/main.rs` — registers `agent_run_preview`
- `packages/desktop/src-tauri/capabilities/default.json` — roster comment updated
- `packages/desktop/src/adapters/tauri.ts` — `previewContextPacket`, `ContextPacketDto`/
  `CriterionDto` types, `startAgentRun` widened with `instruction`
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` — the sheet component
- `packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx` — 14 tests
- `packages/desktop/src/item-detail/ItemDetailPanel.tsx` — `onStartWork` callback, fixed a
  pre-existing hardcoded `#ffffff`
- `packages/desktop/src/App.tsx` — mounts `LaunchSheet`
- `packages/desktop/src/state/uiStore.ts` — `launchSheetTaskId`
- `packages/desktop/src/board/BoardView.tsx` — wires `onStartWork` and the `start-work` action id
- `DESIGN.md` — Phase 2 Plan 04's craft-floor review section

## Decisions Made

- **`assemble_context_packet` does not call `domain::worktree::base_ref_for_task`** for the
  no-worktree-yet case, despite the plan's own read_first list pointing at it — that function
  cuts a real git branch as a side effect (`ensure_epic_integration_branch`) the moment an epic
  has no integration branch yet, which directly contradicts D-28's "never mutates" contract and
  the plan's own "nothing happens until the primary action fires" invariant. A private read-only
  predictor re-derives the identical hypothetical value instead — proven to match exactly via
  `a_task_with_no_worktree_yet_predicts_exactly_what_ensure_worktree_would_create`.
- **`agent_run_start` re-assembles the packet after `start_agent_run` runs**, reading the
  now-real worktree row rather than reusing a pre-start prediction — simpler and strictly
  correct, at the cost of one extra read `agent_run_preview` already paid moments earlier (an
  accepted, deliberate double-read per the plan's own key_links: "one assembler, two call sites").
- **`ContextPacket` gained a `task_key` field** beyond the plan's literal `<behavior>` list — the
  sheet's header ("Start Work on `{TASK-KEY}`") needs it, and the packet is the intended single
  source of truth for the sheet's content. A compatible, additive extension to the D-28 contract,
  not a breaking one.
- **`state/uiStore.ts`/`board/BoardView.tsx` touched despite not being in this plan's declared
  `files_modified`** — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `assemble_context_packet` would have mutated the database and cut a real git
branch if it had followed the plan's own read_first suggestion literally**
- **Found during:** Task 1, reading `domain::worktree::base_ref_for_task`'s implementation before
  writing the "no worktree yet" branch
- **Issue:** The plan's read_first list names `base_ref_for_task` as "used to report the facts of
  a worktree that does not exist yet," but that function calls
  `domain::epic::ensure_epic_integration_branch`, which cuts a real git branch and writes
  `epics.integration_branch` for a task whose epic has no integration branch yet. Calling it from
  a preview path would mean opening the launch sheet — before Start Work is even pressed — could
  create real git history, directly contradicting this plan's own stated invariant ("Cancelling
  the sheet spawns nothing... nothing happens until Start Work fires").
- **Fix:** Wrote a private, read-only prediction inline in `context_packet.rs`: the epic's
  already-cut `integration_branch` if one exists, or exactly the name
  `ensure_epic_integration_branch` would cut later (`branch::epic_integration_branch_name`) —
  never cutting it.
- **Files modified:** `packages/core/src/context_packet.rs`
- **Verification:** `a_task_with_no_worktree_yet_predicts_exactly_what_ensure_worktree_would_create`
  asserts both that `epics.integration_branch` stays `NULL` and that the predicted branch name
  does not exist in the repository after assembly, then that the prediction exactly matches what
  `ensure_worktree` actually creates.
- **Committed in:** `d015ac8` (Task 1 commit)

**2. [Rule 3 - Blocking] A process-wide env-var race across this plan's own parallel test suite**
- **Found during:** Task 1, first `cargo test -p core --test context_packet` run
- **Issue:** `FLYWHEEL_WORKTREE_ROOT` is mutated via `unsafe { std::env::set_var/remove_var }`
  (an established pattern from `worktree_lifecycle.rs`), but `cargo test` runs every `#[test]` fn
  in a file concurrently by default. With 8 tests in this new file all using the pattern, two
  tests' `set_var`/`remove_var` calls interleaved and a thread observed the wrong (unset) root
  mid-call, resolving `ensure_worktree` against the real `~/Flywheel/` instead of the test's
  scratch dir — reproduced deterministically, not a one-off flake.
- **Fix:** Added a `static WORKTREE_ROOT_ENV_LOCK: Mutex<()>` scoped to this one test file
  (`tests/*.rs` integration files each compile to their own binary, so this cannot race with
  `worktree_lifecycle.rs`'s own, much smaller use of the identical pattern) — every test's
  env-var-mutating section now runs serialized.
- **Files modified:** `packages/core/tests/context_packet.rs`
- **Verification:** `cargo test -p core --test context_packet` run 3 times consecutively, all
  green
- **Committed in:** `d015ac8` (Task 1 commit)

**3. [Rule 1 - Bug] A pre-existing hardcoded `#ffffff` on the exact button this plan had to edit**
- **Found during:** Task 3, replacing `ItemDetailPanel.tsx`'s `handleStartWork` with the
  `onStartWork` callback
- **Issue:** The Start Work button's `color: "#ffffff"` (introduced by plan 02-01, already flagged
  as an out-of-scope false-failure in 02-03-SUMMARY.md's "Issues Encountered" since 02-03 didn't
  touch this file) would have failed this plan's own Task 3 hex-literal verify gate, since this
  plan's `files_modified` explicitly includes `ItemDetailPanel.tsx` and this exact button.
- **Fix:** Replaced with `var(--text-primary-rack)`, an existing token with adequate contrast
  against the button's `--accent-nontext` fill.
- **Files modified:** `packages/desktop/src/item-detail/ItemDetailPanel.tsx`
- **Verification:** `grep -rlE '#[0-9a-fA-F]{6}' packages/desktop/src | grep -vcE '...'` returns
  `0`
- **Committed in:** `ebce322` (Task 3 commit)

**4. [Rule 3 - Blocking] `state/uiStore.ts` and `board/BoardView.tsx` needed changes outside this
plan's declared `files_modified`**
- **Found during:** Task 3, wiring the sheet's trigger points
- **Issue:** The plan's own action text requires "Wire the sheet from the Start Work affordance in
  `ItemDetailPanel.tsx` and from the `start-work` action id... Mount it from `App.tsx`," but
  `ItemDetailPanel.tsx` deliberately avoids importing `state/uiStore.ts` directly (a pre-existing,
  documented architectural convention: "This component stays free of any store import"), and the
  sheet is mounted once at the `App.tsx` level like `CommandPalette`, not as a child of
  `ItemDetailPanel`. Without a cross-tree state field and a bridging call site, the two ends
  cannot connect, and the board-list `w` keystroke (02-UI-SPEC.md's own keyboard map) would stay
  permanently unreachable.
- **Fix:** Added `launchSheetTaskId`/`setLaunchSheetTaskId` to `state/uiStore.ts`, mirroring
  `activeAgentRunId`'s own established precedent for exactly this situation. Wired
  `BoardView.tsx`'s `ItemDetailPanel` prop pass-through (`onStartWork={() =>
  setLaunchSheetTaskId(selectedItem.id)}`) and added a one-line `case "start-work"` to its
  existing keyboard switch, following the identical pattern every sibling case already uses.
- **Files modified:** `packages/desktop/src/state/uiStore.ts`,
  `packages/desktop/src/board/BoardView.tsx`
- **Verification:** `npm --prefix packages/desktop run test` (202/202 pass, including the existing
  `keyboard-nav`/`palette`/`filter`/`project-rail` suites this store's `resetUiState` feeds) and
  `npm --prefix packages/desktop run build`
- **Committed in:** `ebce322` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 1 bug fixes, 2 Rule 3 blocking-issue fixes).
**Impact on plan:** All four were necessary for the plan's own stated invariants or verify
commands to hold. Deviation #1 is the most consequential — following the plan's own read_first
suggestion literally would have made opening the launch sheet a mutating operation, exactly the
failure mode the sheet exists to prevent. No scope creep beyond what each task's own action/
behavior/acceptance criteria already required.

## Known Stubs

None that block this plan's own goal. `ContextPacketDto.renderedPrompt` is carried over the wire
but not rendered verbatim in the sheet's body — the UI-SPEC calls for structured sections, not a
raw prompt dump; the field exists so the Rust-side "one renderer" invariant is testable
end-to-end. `LaunchSheet.tsx`'s `PreviewSkeleton` is a minimal, self-contained loading placeholder
since no shared skeleton-row component exists anywhere in this codebase yet (documented in
DESIGN.md as a stopgap, not a permanent implementation).

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `core::context_packet::{ContextPacket, assemble_context_packet, render_prompt}` is ready for
  Phase 4's `ContextAssembler` to extend (more inputs: prior `SessionSummary`s, diff-so-far) per
  D-28's own "costly reversibility" note — the signature and determinism contract are locked in
  and proven, not merely asserted.
- Plans 02-05 through 02-10 can rely on the launch sheet existing as the one gate before any run
  starts, and on `agent_run_start`'s prompt now coming from the real board content rather than a
  placeholder.
- **Not yet human-observed:** pressing Start Work in the actual packaged desktop app, reading the
  real briefing, and confirming a Cancel creates no worktree directory and writes no database rows
  (the plan's own `<verification>` block's manual step). Deferred to end-of-phase UAT per
  `workflow.human_verify_mode: end-of-phase`, the same pattern 02-01/02-02/02-03-SUMMARY.md used.
- **Pre-existing, out-of-scope gap tracked, not fixed:** `DESIGN.md` went unmaintained for plans
  `01-12` through `01-21` and `02-01` through `02-03` despite `01-UI-SPEC.md`'s binding Build
  Process Requirement. This plan added its own section (closing its own obligation) and recorded
  the gap in that section rather than backfilling nine prior plans' worth of retroactive review —
  a future cleanup plan's job, not this one's.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-10*

## Self-Check: PASSED

All 4 files listed under `key-files.created` verified present on disk with `[ -f ]` (and all
`key-files.modified` files verified present too). All 5 commits (`d015ac8`, `118145d`, `ebce322`,
`0a4da21`, `a476c9c`) verified present in `git log --oneline --all`. Every `<acceptance_criteria>`
item across Tasks 1-3 re-run and passing: `cargo test -p core --test context_packet` (9/9),
`cargo test -p core` (full suite green), `cargo test -p desktop` (7/7), `npm --prefix
packages/desktop run test` (202/202), `npm --prefix packages/desktop run build` (clean, no `error
TS`), the `agent_run_preview` single-registration grep gate, the capabilities-roster grep gate,
the adapter-seam grep gate, and the hex-literal grep gate (all PASS). The plan-level
`<verification>` block's one manual item (press Start Work in the running packaged app, read the
briefing, cancel, confirm nothing was created) is not re-run here — it requires a human at a
GUI — see "Next Phase Readiness."
