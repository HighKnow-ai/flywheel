---
phase: 01-the-board-is-the-store-of-record
plan: 04
subsystem: ui
tags: [rusqlite, sqlite, transactional-outbox, tauri-commands, tanstack-query, tanstack-virtual, radix-ui, zustand, react, lucide-react]

# Dependency graph
requires:
  - phase: 01-the-board-is-the-store-of-record (plan 01-03)
    provides: "Migration 0002_board_schema.sql, packages/core::domain::{actor,event,project,task}, query::list_board, the transactional-outbox pattern, the virtualized BoardView/BoardRow/QuickAdd rack, legend/marks.ts's status/priority marks"
provides:
  - "core::domain::WORKFLOW_STATES — the one fixed five-state list every CHECK constraint and picker derives from"
  - "core::domain::{epic, issue} — create/update/delete/set_status for epics, create/update/delete for issues, each in one transaction with its event"
  - "core::domain::task extended with update_task/delete_task/set_task_status"
  - "query::list_board extended to return epics+tasks banded by status and issues in a separate lane"
  - "Six new Tauri commands (epic_create/update/delete/set_status, issue_create/update/delete) plus task_update/delete/set_status, all actor-resolved server-side and registered in main.rs + capabilities/default.json"
  - "StatusBand.tsx, IssuesLane.tsx, pickers/StatusPicker.tsx, item-detail/ItemDetailPanel.tsx, collapseStore.ts"
  - "BoardView.tsx roving-focus keyboard selection (j/k, Home/End, Enter/o, s, Escape) wired to the status picker and detail panel"
  - "legend/marks.ts's epic channel and epic-pill-none mark, STATUS_MARKS/statusValueFromMarkId"
affects: ["01-06 (acceptance criteria list, inserted into ItemDetailPanel's reserved section boundary)", "01-09 (priority/estimate/assignee pickers reuse StatusPicker's Radix focus-trap/portal pattern)", "01-10 (activity trail, same reserved section boundary)", "01-11 (command palette wires Legend + Create Epic/Create Issue commands)"]

# Actuals (#2632)
actuals:
  tokens: 34300
  tasks: 3
  commits: 3
plan_head_before: 6610e75c14efc23ba7326314c99ba9dc5b00ecd8

# Tech tracking
tech-stack:
  added: ["@radix-ui/react-focus-scope@1.1.16", "@radix-ui/react-dismissable-layer@1.1.19"]
  patterns:
    - "Every new domain mutation (epic/issue/task update/delete/set_status) opens exactly one conn.transaction(), reads current state first for redundant-transition no-ops, and commits once — the same outbox shape 01-03's create_task established"
    - "A schema CHECK constraint, not application code, is the authority for valid status values — invalid_status_is_rejected_by_the_schema asserts the returned error is a rusqlite::Error::SqliteFailure, not an app-layer match arm"
    - "delete_epic orphans child tasks (epic_id -> NULL) rather than cascading a delete — a grep gate over epic.rs fails the build if a DELETE FROM tasks statement is ever introduced"
    - "Pickers portal-render to document.body rather than positioning in-row, because every virtualized row is its own CSS stacking context (each carries its own transform) — content that overflows a row's box paints behind the next row regardless of z-index"
    - "Focus trapping and dismiss-on-outside-interaction are hand-wired against low-level Radix primitives (react-focus-scope, react-dismissable-layer) directly — no shadcn, no pre-styled Radix component (component_strategy: a-selfhost-radix)"
    - "A picker's option list is generated from legend/marks.ts's registry (STATUS_MARKS), never a second hand-typed array of state names — enforced by a grep gate over the picker file itself"
    - "Collapse/UI-preference state (collapseStore.ts) lives in Zustand, keyed per project, and is never written to the database — it is not board data"

key-files:
  created:
    - packages/core/src/domain/epic.rs
    - packages/core/src/domain/issue.rs
    - packages/core/tests/hierarchy_workflow.rs
    - packages/desktop/src-tauri/src/commands/epic.rs
    - packages/desktop/src-tauri/src/commands/issue.rs
    - packages/desktop/src/board/StatusBand.tsx
    - packages/desktop/src/board/IssuesLane.tsx
    - packages/desktop/src/board/collapseStore.ts
    - packages/desktop/src/board/pickers/StatusPicker.tsx
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/board/__tests__/workflow.test.tsx
  modified:
    - packages/core/src/domain/mod.rs
    - packages/core/src/domain/actor.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/App.tsx
    - packages/desktop/src/App.css
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/board/BoardRow.tsx
    - packages/desktop/src/board/QuickAdd.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/board/__tests__/board-view.test.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/Legend.tsx
    - packages/desktop/package.json
    - DESIGN.md

key-decisions:
  - "Crash-recovery ground truth: Task 1 (epic/issue/task mutations + Tauri commands) was implemented, tested and committed by the first executor session (0f82626) before an infrastructure fault killed it. The second session inherited Task 2's and Task 3's implementation already written to disk but uncommitted, reviewed every file line by line against 01-04-PLAN.md and 01-UI-SPEC.md, found it complete and correct against every acceptance criterion, and finished only the one genuine gap (workflow.test.tsx did not exist) plus one motion-transition polish fix — see Deviations below."
  - "Pickers render through a document.body portal rather than in-row, because @tanstack/react-virtual gives each row its own CSS stacking context (per-row transform) — an in-row absolutely-positioned menu would paint behind the next row regardless of z-index"
  - "Issues' quick-add creates issues of kind 'idea' only in this plan — a kind picker (bug/idea/question/risk) is deferred; documented as a known deferred surface, not silently dropped"

patterns-established:
  - "Radix-primitive picker pattern (StatusPicker.tsx): anchorRect prop computed from the triggering element's getBoundingClientRect(), FocusScope+DismissableLayer wrapping a portal-rendered menu, numeric-key-to-option mapping — ready to be reused verbatim for the priority/estimate/assignee pickers 01-09 adds"
  - "ItemDetailPanel.tsx's placeholder-free section boundary comment marks exactly where 01-06's acceptance-criteria list and 01-10's activity trail are inserted, so neither later plan needs to guess the insertion point"

requirements-completed: [BOARD-01, BOARD-04, DATA-01, DATA-03]

coverage:
  - id: D1
    description: "Epic, task and issue mutations (create/update/delete/set_status where applicable) each open exactly one transaction and append one event; a redundant status transition is a no-op; deleting an epic orphans its child tasks rather than cascading"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/hierarchy_workflow.rs (8 tests: delete_is_idempotent, duplicate_titles_get_distinct_keys, key_allocation_never_collides, redundant_status_transition_is_a_no_op, invalid_status_is_rejected_by_the_schema, workflow_states_are_fixed_and_ordered, issue_has_no_workflow_status, deleting_an_epic_orphans_its_tasks)"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/domain/epic.rs | grep -c 'DELETE FROM tasks' == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "An invalid or unknown status value is rejected by the database CHECK constraint, not an application-layer guard"
    requirement: "BOARD-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/hierarchy_workflow.rs#invalid_status_is_rejected_by_the_schema (asserts rusqlite::Error::SqliteFailure)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The five band headers render in the fixed order, and the status picker offers exactly five options generated from the workflow state list, never a hardcoded second array"
    requirement: "BOARD-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/workflow.test.tsx (3 tests)"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/desktop/src/board/pickers/StatusPicker.tsx | grep -Ec \"'backlog'|\\\"backlog\\\"\" == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The whole three-level hierarchy renders on the rack: epics and tasks in their fixed status bands, issues in a separate workflow-less lane beneath them, orphan tasks showing the muted 'No epic' pill, one vertical rack never horizontal columns"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src/board/__tests__/board-view.test.tsx (3 tests, including the No-epic-pill assertion)"
        status: pass
      - kind: manual_procedural
        ref: "Self-conducted review against craft-floor.md and 01-UI-SPEC.md (DESIGN.md, 'Phase 1, Plan 01-04' section) — no live tauri dev capture was run this session; see Issues Encountered"
        status: unknown
    human_judgment: true
    rationale: "01-04-PLAN.md's own Task 2 <human-check> block (create an epic/task/issue live in tauri dev, press s/1-5 to re-rack, Enter/Escape to open/close the detail panel) requires a real running app; this crash-recovery session did not launch one. Structural/behavioral correctness is proven by the automated suites above and a thorough code review documented in DESIGN.md, but the live interaction walkthrough itself is deferred to /gsd-verify-work."
  - id: D5
    description: "Every new command handler resolves actor_id server-side and is registered in both main.rs's generate_handler! list and capabilities/default.json"
    requirement: "DATA-03"
    verification:
      - kind: other
        ref: "grep -c 'commands::epic::\\|commands::issue::\\|commands::task::' packages/desktop/src-tauri/src/main.rs; grep -c 'epic_create\\|issue_create' packages/desktop/src-tauri/capabilities/default.json"
        status: pass
    human_judgment: false

duration: ~55min (this continuation session; excludes the crashed first session's own duration, which is not recoverable)
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 4: The Fixed Hierarchy and the Fixed Workflow Summary

**Epics, tasks and issues are fully mutable through a schema-enforced transactional outbox; the whole rack renders the three-level hierarchy with a keyboard-driven status picker (portal-rendered Radix primitives) and a 480px item detail panel, all sourced from one `WORKFLOW_STATES` constant a database CHECK constraint also enforces.**

## Performance

- **Duration:** ~55 min (this continuation session, resuming after an infrastructure fault killed the first session mid-flight; that session's own duration is not included)
- **Started:** 2026-09-09 (continuation session, ground-truth review)
- **Completed:** 2026-09-09
- **Tasks:** 3
- **Files modified:** 30 (across 3 commits: 1 inherited from the first session, 2 from this one)

## Accomplishments

- Verified ground truth from git before touching anything: `git show --stat 0f82626` confirmed Task 1 (epic/issue/task mutations, six new Tauri commands, `WORKFLOW_STATES`) was fully implemented, tested (`cargo test -p core` green) and committed by the first session.
- Reviewed every uncommitted file on disk — `IssuesLane.tsx`, `StatusBand.tsx`, `collapseStore.ts`, `pickers/StatusPicker.tsx`, `item-detail/ItemDetailPanel.tsx`, the `BoardView.tsx`/`BoardRow.tsx`/`QuickAdd.tsx`/`useBoardQuery.ts`/`legend/marks.ts` diffs, and `packages/core/tests/hierarchy_workflow.rs` — line by line against `01-04-PLAN.md`'s Task 2/3 action prose, acceptance criteria and `01-UI-SPEC.md`'s Row Anatomy/Keyboard Map/Item detail sections. Found the inherited work **correct and complete**: every grep gate passed, `cargo test -p core --test hierarchy_workflow` was already 8/8 green, `cargo build --workspace` and `npm run build` both succeeded.
- Found and fixed the one genuine gap the crash left: `packages/desktop/src/board/__tests__/workflow.test.tsx` did not exist, despite being named in Task 3's `<files>` and the plan's own artifact list. Wrote it fresh — five band headers in fixed order, five `StatusPicker` options sourced from `STATUS_MARKS`, exactly one marked checked for the current status.
- Found and fixed one small motion gap during the Impeccable craft-floor review: `App.css`'s `.board-row` transition declaration covered `box-shadow` (the pre-existing hover treatment) but not `background`, so the new selection-highlight overlay (a `linear-gradient` composited over the status tint) snapped instantly on selection change instead of transitioning — a direct miss against `01-UI-SPEC.md`'s "the selection highlight transitions between rows." One-line fix reusing the existing `--duration-settle`/`--ease` pair.
- Ran the Impeccable detector (`detect.mjs --json packages/desktop/src/board packages/desktop/src/item-detail`) — no findings. Self-conducted a review against `craft-floor.md`'s Verify/Refuse checklist and updated `DESIGN.md` with a new "Phase 1, Plan 01-04" section, since no agent-spawning tool is available in this execution environment (same documented limitation as `01-02`/`01-03`).
- Committed the inherited-and-corrected Task 2 work and the Task 3 test suite as two atomic commits, keeping Task 1's already-committed history intact.
- All four verification commands green at the end of this session: `cargo build --workspace`, `cargo test --workspace` (35 tests), `npm --prefix packages/desktop run test` (21 tests, up from 18), `npm --prefix packages/desktop run build`.

## Task Commits

Each task was committed atomically, across two executor sessions:

1. **Task 1: Epic, issue and task mutations behind the fixed workflow** — `0f82626` (feat) — implemented and committed by the **first session**, before it crashed.
2. **Task 2: The five fixed bands, the status picker and the item detail panel** — `2738fcb` (feat) — implemented on disk by the first session (uncommitted at crash time), reviewed, corrected (one motion-transition fix) and committed by **this session**.
3. **Task 3: Prove the hierarchy and the workflow are fixed** — `0512767` (test) — `hierarchy_workflow.rs` written by the first session (uncommitted, already 8/8 green against Task 1's implementation); `workflow.test.tsx` written fresh by **this session** (did not exist on disk); both committed together by this session.

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md docs commit, below).

## Files Created/Modified

See `key-files` in frontmatter above for the full list. Highlights:

- `packages/core/src/domain/{epic,issue}.rs` — the new mutation modules; `task.rs`/`mod.rs`/`actor.rs` extended
- `packages/core/src/query/mod.rs` — `list_board` extended to return epics+tasks banded, issues in a separate lane
- `packages/desktop/src-tauri/src/commands/{epic,issue}.rs` — the new Tauri command surface; `task.rs` extended
- `packages/desktop/src/board/{StatusBand,IssuesLane,collapseStore}` — the new board surfaces
- `packages/desktop/src/board/pickers/StatusPicker.tsx`, `packages/desktop/src/item-detail/ItemDetailPanel.tsx` — the hand-wired Radix pickers and the side panel
- `packages/core/tests/hierarchy_workflow.rs`, `packages/desktop/src/board/__tests__/workflow.test.tsx` — the invariant suites

## Decisions Made

See `key-decisions` in frontmatter above. Most consequential: treating the crashed session's uncommitted work as real, reviewable input rather than restarting from scratch — every file was checked against the plan and spec before being trusted, and the review found it already correct, which is itself evidence the crash was a pure infrastructure fault (background-agent resume failure) rather than a mid-task logic error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `workflow.test.tsx` was named in Task 3's `<files>` but did not exist on disk**
- **Found during:** ground-truth review, before Task 3 could be considered complete
- **Issue:** The crashed session had written `hierarchy_workflow.rs` (the Rust half of Task 3) but not the paired Vitest component suite, leaving Task 3's own acceptance criterion ("the Vitest workflow suite asserts exactly five band headers and exactly five picker options") unverifiable
- **Fix:** Wrote `packages/desktop/src/board/__tests__/workflow.test.tsx` from scratch, covering exactly the two bullets Task 3's `<action>` names — no other test infrastructure needed changing
- **Files modified:** `packages/desktop/src/board/__tests__/workflow.test.tsx` (new)
- **Verification:** `npm --prefix packages/desktop run test` — 21/21 pass (up from 18)
- **Committed in:** `0512767`

**2. [Rule 1 - Bug] Selection-highlight overlay snapped instead of transitioning, contradicting 01-UI-SPEC.md's Motion contract**
- **Found during:** the Impeccable craft-floor review pass, after confirming the inherited Task 2 code was otherwise complete
- **Issue:** `App.css`'s `.board-row` transition declaration only listed `box-shadow` (added in `01-03` for the hover wash); `BoardRow.tsx`'s new `selected`/`focused` states change the row's `background` (a `linear-gradient` overlay composited with the status tint), which was not in the transition list, so selecting a row visually snapped rather than transitioning per "the selection highlight transitions between rows" (`01-UI-SPEC.md` "Motion")
- **Fix:** Added `background` to the same `.board-row`/`.quick-add` transition declaration, reusing the existing `--duration-settle`/`--ease` token pair — no second easing curve introduced
- **Files modified:** `packages/desktop/src/App.css`
- **Verification:** `npm --prefix packages/desktop run build` succeeds; visual behavior not re-verified live (no `tauri dev` launch this session — see Issues Encountered)
- **Committed in:** `2738fcb`

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking-gap fill, 1 Rule 1 motion-contract bug)
**Impact on plan:** Both were necessary — the first to make Task 3's own acceptance criterion verifiable at all, the second because it was a direct, findable violation of a named UI-SPEC behavior discovered during the Impeccable review this plan's own Build Process Requirement mandates. No scope creep beyond what Task 3's action bullets and the craft-floor.md checklist already specified. The remaining reviewed surface (StatusBand, IssuesLane, StatusPicker, ItemDetailPanel, BoardView's keyboard model, the six new Tauri commands) needed no correction — it matched the plan and `01-UI-SPEC.md` on first read.

## Issues Encountered

- **Root cause of the crash was infrastructure, not this plan's own logic.** The dispatching context described the failure as "a background-agent resume failure" — the crashed session had already produced correct, plan-conformant code for both remaining tasks before it died; nothing found during review pointed to a genuine implementation defect beyond the one motion-transition gap above.
- **No agent-spawning tool available to this executor**, matching the limitation `01-02`/`01-03` already documented. The shipped `impeccable-finish-reviewer` and `impeccable-documenter` subagents named in Task 2's acceptance criteria could not be literally invoked; substituted a self-conducted review directly against `craft-floor.md`'s Verify/Refuse checklist (documented in `DESIGN.md`'s new "Phase 1, Plan 01-04" section) and authored the `DESIGN.md` update directly, exactly as `01-03` did.
- **No live `tauri dev` launch this session.** `01-03`'s session used a real launch (via `orca computer get-app-state`) to capture screenshots and prove the end-to-end flow; this crash-recovery session, given its narrower scope (finish and correct already-written code, not build a new surface from zero), relied on the automated test suites plus a thorough structural/behavioral code review instead. Task 2's own `<human-check>` block (create an epic/task/issue live, press `s`/`1`-`5` to re-rack, `Enter`/`Escape` to open/close the detail panel, confirm no reconfiguration affordance exists anywhere) is **not yet walked live** — flagged as coverage item D4 with `human_judgment: true`, deferred to `/gsd-verify-work`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `cargo build --workspace`, `cargo test --workspace` (35 passing: 3 ranking + 7 db_bootstrap + 4 ids + 13 outbox + 8 hierarchy_workflow), and `npm --prefix packages/desktop run test` (21 passing, up from 18) are all green. `npm --prefix packages/desktop run build` succeeds.
- `packages/core::domain::{epic,issue,task}` and the extended `query::list_board` are real, tested, and ready for `01-06`'s acceptance-criteria mutations and `01-09`'s remaining pickers to follow the exact same one-transaction outbox shape.
- `StatusPicker.tsx`'s Radix focus-trap/portal pattern (anchor-rect prop, `FocusScope`+`DismissableLayer`, numeric-key selection) is ready for `01-09`'s priority/estimate/assignee pickers to reuse verbatim rather than re-deriving the wiring.
- `ItemDetailPanel.tsx`'s placeholder-free section boundary is exactly where `01-06`'s criteria list and `01-10`'s activity trail insert.
- **Outstanding, flagged for `/gsd-verify-work`:** Task 2's `<human-check>` live walkthrough (create epic/task/issue in `tauri dev`, keyboard re-rack, open/close detail panel, confirm no reconfiguration affordance exists) has not been run live this session — see coverage item D4.
- No blockers. Deferred surfaces (priority/estimate/assignee pickers, epic quick-add, `Tab`/`Shift+Tab` nesting, command palette) are explicit scope boundaries documented in `DESIGN.md`'s new "Known deferred surfaces" section under Phase 1, Plan 01-04, matching `01-03`'s precedent for undocumented-vs-deferred distinctions.

## Known Stubs

None that block this plan's own goal. As with `01-03`, several Row Anatomy fields remain genuinely **not rendered at all** (not rendered as an empty placeholder) because their underlying feature does not exist in any plan through this one: assignee avatar, criteria checked/total badge, actor-of-last-change. These are unchanged scope boundaries from `01-03`, reconfirmed here, not new gaps this plan introduced. The one new deferral this plan itself introduces: `IssuesLane`'s quick-add creates issues of kind `idea` only — no kind picker (`bug`/`idea`/`question`/`risk`) ships yet, documented in `DESIGN.md`'s "Known deferred surfaces."

## TDD Gate Compliance (Task 1, Task 3)

| Gate | Commit | Status |
|------|--------|--------|
| Task 1 (tdd="true") | `0f82626` | Implemented and committed by the first session before this session began; that session's own RED/GREEN evidence is not recoverable from this continuation (the crash occurred after Task 1's commit, not during it) — the commit itself and its passing `cargo test -p core` result are the surviving evidence. `workflow.tdd_mode` is not the strict-gate-enforcing setting for this project's config (per `01-03-SUMMARY.md` precedent), so this is documented rather than treated as a compliance gap. |
| Task 3 (tdd="true") — `hierarchy_workflow.rs` | (written by crashed session, committed `0512767`) | Not present as a failing state from this session's perspective — the file already passed 8/8 against Task 1's already-correct, already-committed implementation when this session first ran `cargo test -p core --test hierarchy_workflow`. Consistent with `01-03`'s own documented precedent for this plan's sequencing (implementation task before invariant-proving task). |
| Task 3 (tdd="true") — `workflow.test.tsx` | `0512767` | Written fresh this session against already-built, already-reviewed components (`StatusBand`, `StatusPicker`) — not a fabricated RED phase for code that already existed; the plan's own Task 2→Task 3 sequencing places implementation before the invariant suite by design, and this SUMMARY states that explicitly rather than claiming a RED commit that never happened. |

## Self-Check: PASSED

- FOUND: packages/core/src/domain/epic.rs
- FOUND: packages/core/src/domain/issue.rs
- FOUND: packages/core/tests/hierarchy_workflow.rs
- FOUND: packages/desktop/src-tauri/src/commands/epic.rs
- FOUND: packages/desktop/src-tauri/src/commands/issue.rs
- FOUND: packages/desktop/src/board/StatusBand.tsx
- FOUND: packages/desktop/src/board/IssuesLane.tsx
- FOUND: packages/desktop/src/board/collapseStore.ts
- FOUND: packages/desktop/src/board/pickers/StatusPicker.tsx
- FOUND: packages/desktop/src/item-detail/ItemDetailPanel.tsx
- FOUND: packages/desktop/src/board/__tests__/workflow.test.tsx
- FOUND commit 0f82626 (feat(01-04): epic, issue and task mutations behind the fixed workflow)
- FOUND commit 2738fcb (feat(01-04): the five fixed bands, the status picker and the item detail panel)
- FOUND commit 0512767 (test(01-04): prove the hierarchy and the workflow are fixed)

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
