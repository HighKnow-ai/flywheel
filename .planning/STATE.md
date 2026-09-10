---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: the-board-is-the-store-of-record
status: executing
stopped_at: Completed 01-20-PLAN.md (gap closure G-01-4 hardening)
last_updated: "2026-09-10T07:15:24.927Z"
last_activity: 2026-09-10
last_activity_desc: Phase 01 execution started
state_head: 6dae05fdc3b066a7533f628d50cd95d30818c32c
progress:
  total_phases: 12
  completed_phases: 0
  total_plans: 21
  completed_plans: 20
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** Every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob.
**Current focus:** Phase 01 — The Board Is The Store Of Record

## Current Position

Phase: 01 (the-board-is-the-store-of-record) — READY TO EXECUTE
Plan: 3 of 20
Status: Ready to execute
Last activity: 2026-09-10 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 30min | 3 tasks | 59 files |
| Phase 01 P02 | 25min | 3 tasks | 20 files |
| Phase 01 P03 | 34min | 3 tasks | 38 files |
| Phase 01 P04 | 55min | 3 tasks | 30 files |
| Phase 01 P05 | 35min | 3 tasks | 7 files |
| Phase 01 P06 | 35min | 3 tasks | 21 files |
| Phase 01 P07 | 65min | 3 tasks | 26 files |
| Phase 01 P08 | 140min | 3 tasks | 20 files |
| Phase 01 P09 | 110min | 3 tasks | 16 files |
| Phase 01-the-board-is-the-store-of-record P10 | 50min | 3 tasks | 14 files |
| Phase 01 P11 | 30min | 3 tasks | 15 files |
| Phase 01 P12 | 15min | 3 tasks | 8 files |
| Phase 01-13 P13 | 20min | 3 tasks | 12 files |
| Phase 01 P14 | 12min | 3 tasks | 9 files |
| Phase 01-the-board-is-the-store-of-record P15 | 15min | 3 tasks | 9 files |
| Phase 01 P16 | 35min | 3 tasks | 12 files |
| Phase 01 P17 | 25min | 3 tasks | 13 files |
| Phase 01 P18 | 30min | 3 tasks | 10 files |
| Phase 01 P19 | 35min | 3 tasks | 6 files |
| Phase 01 P20 | 25min | 3 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Research]: Build the PM core from scratch — every cloud tracker fails local-first; Plane trades a simpler schema for AGPL plus a server stack.
- [Research]: Stack settled — Tauri v2 (Rust core) + bundled Node.js sidecar (Claude Agent SDK) + React UI; rusqlite/SQLite with an append-only event log. No sync vendor chosen; schema-first, vendor-second.
- [Roadmap]: Vertical MVP structure, not the research's horizontal build order. Each phase ships a runnable capability.
- [Roadmap]: Moat before commodity — context reconstitution (Phase 4), Socratic authoring (Phase 5) and agent-authored backlog (Phase 6) sequenced ahead of git/forge surfaces (Phases 7-8), because Nimbalyst can copy the board-plus-worktree combination in weeks.
- [Roadmap]: The thinnest vertical slice (one task, two sequential sessions, second reconstituted from the board) completes at Phase 4 — the earliest the dependency graph allows.
- [Phase 01]: Aliased packages/desktop's dependency on packages/core to flywheel_core (package = "core") to avoid a core-named dependency shadowing the sysroot core crate in tauri::generate_context!()'s expansion
- [Phase 01]: Fixed rusqlite's nonexistent 'serde' feature to 'serde_json' — 01-RESEARCH.md's install command named the wrong feature
- [Phase 01]: Locked all four open visual-world decisions at once (component strategy a-selfhost-radix, typeface Archivo, icon library Lucide, radius 2px/6px) into 01-UI-SPEC.md, binding for plans 01-03 through 01-11
- [Phase 01]: Archivo's condensed companion cut ships from the same variable font's wdth axis (font-stretch), not a second file — Google Fonts merged Archivo Condensed into Archivo's wdth axis after the typeface constraint was written
- [Phase 01]: Legend mark glyphs are lucide-react icon names, not unicode glyphs — corrected during this plan's own craft-floor review
- [Phase 01]: [Phase 01-03]: Owner closed the schema-shape checkpoint — epics/tasks share one five-state status CHECK, issues workflow-less; nullable assignee_id; priority 0-4 with No priority sorting last; estimate S/M/L as ordinal 1-3, never aggregated; project key prefix user-typed with a derived default, immutable once the first item exists
- [Phase 01]: [Phase 01-03]: ARCHITECTURE.md's epic lifecycle enum (integrating/archived) is re-homed onto the five-state status plus epics.integration_branch and epics.archived_at columns, added now so Phase 8 needs no schema change
- [Phase 01]: [Phase 01-03]: No-priority-sorts-last is enforced entirely in query::list_board's SQL sort-key expression, never by relying on the raw stored/keymap value's ordering
- [Phase 01]: Crash-recovery ground truth: Task 1 committed by first session (0f82626); second session reviewed and finished Task 2/3's inherited uncommitted work, finding it correct and complete
- [Phase 01]: Pickers portal-render to document.body (not in-row) because @tanstack/react-virtual gives each row its own CSS stacking context
- [Phase 01]: Exposed core::db::migration_sources() (the same ordered SQL list the MIGRATIONS static compiles from) so migration_safety.rs builds its N-1 and bad-migration fixtures from the real sources rather than a duplicated, driftable copy
- [Phase 01]: Crash-safety and migration-safety suites both passed against Task 2's already-correct implementation on first write (migration_safety.rs) or after one genuine intentional RED (crash_safety.rs) — documented in the SUMMARY per the same task-sequencing pattern 01-03 established
- [Phase 01]: delete_task/delete_epic now cascade-delete their criteria (one criterion.deleted event per row) inside their existing transaction — required by Task 3's own named test, auto-added per deviation Rule 2.
- [Phase 01]: DoneWarning gates the status mutation BEFORE it is sent rather than applying it optimistically and compensating on cancel — Escape 'reverts' by the mutation never having been sent.
- [Phase 01]: reorder_criterion supports 'between two neighbours' and 'append after prev' but not inserting before the very front of an existing list — no rank_before helper exists and ranking.rs is not extended by this plan.
- [Phase 01]: 01-07: filtered the reorder neighbour lookup by priority (not just project_id/status) so a keyboard reorder never displaces a neighbour in a different priority band
- [Phase 01]: 01-07: priority change does not rewrite rank — an item's position within its new priority band falls wherever its existing rank naturally compares
- [Phase 01]: 01-07: estimate letters (S/M/L) are rendered from a lookup table, never derived from the stored 1-3 integer via display formatting
- [Phase 01]: Filter dimensions bound as a single JSON-array-or-NULL named parameter (json_each) rather than a dynamic IN-list, keeping every query in packages/core/src/query a compile-time literal with zero format!/string-interpolation
- [Phase 01]: search_items delegates byte-identically to list_board for an empty/whitespace-only term rather than a second unfiltered-window implementation
- [Phase 01]: state/uiStore.ts does not absorb board/collapseStore.ts's collapsed-band state or BoardView.tsx's selectedId - both deliberately deferred, documented in DESIGN.md
- [Phase 01]: [Phase 01-09]: state/keyboard.ts is the single module that maps a key to a board action — BoardRow.tsx's own competing onKeyDown handler (double-firing every board-list keystroke) and FilterBar.tsx's hand-rolled ⌘F//-listener were both removed in favor of it
- [Phase 01]: [Phase 01-09]: Selection, the item detail panel's open item, and the pending delete target all live as ids in state/uiStore.ts, not BoardView-local state — CommandPalette.tsx (mounted outside BoardView's tree) drives all three the same way the keyboard path does
- [Phase 01]: [Phase 01-09]: The Escape ladder is one capture-phase window listener that calls stopPropagation() once it commits to closing a layer, verified against Radix DismissableLayer's own isHighestLayer source — row-level pickers and DeleteConfirm are deliberately outside the four-layer ladder and keep their own Radix Escape handling
- [Phase 01]: [Phase 01-09]: Quick-add changed from always-mounted to on-demand (c/⌘N opens it, or the project has zero items) so it can be a real closeable Escape-ladder layer
- [Phase 01]: [Phase 01-09]: dispatchAction(id) synthesizes a real KeyboardEvent matching an action's global binding — the command palette and the native menu.rs bridge both re-enter the exact keyboard pipeline rather than a second implementation of each action's effect
- [Phase 01]: render_description reads the payload's already-present "label" (built from field/before/after at write time by every domain mutation function) rather than a second, independent formatter
- [Phase 01]: ActivityTrail.tsx guarded by the same !isIssue condition as AcceptanceCriteriaList — core::query::events only accepts task/epic as parent_kind, matching the events table's denormalised task_id/epic_id columns
- [Phase 01]: Marker path/format: .flywheel/project.json, JSON via serde_json, committed (owner decision, checkpoint:decision)
- [Phase 01]: register_project (not create_project) is what the Tauri project_register command now calls
- [Phase 01]: 01-12: assert_parent_in_project lives in domain/mod.rs as one shared same-project integrity check, called by both reparenting paths (task::set_epic, issue::set_parent) and both creation paths (create_task, create_issue)
- [Phase 01]: 01-12: BOARD-01 unticked in REQUIREMENTS.md pending plan 01-15 — reparenting commands (task_set_epic, issue_set_parent) now exist and are registered, but nothing in the running renderer calls them yet
- [Phase 01]: state/keyboard.ts and state/uiStore.ts now own the whole layer stack; bindingAllowedInLayer/topLayer is the single fire/do-not-fire decision every useGlobalBindings consumer and the board-list container share (G-01-FOCUS).
- [Phase 01]: PickerKind lives in state/uiStore.ts and LayerState is {paletteOpen, detailOpen, pickerOpen, quickAddOpen} - 01-14/01-15 extend these, they do not re-derive the layer model.
- [Phase 01]: 01-14: ParentPicker (id/label/group options, portalled) is the generic sibling of the four fixed-option pickers, added now so 01-15 reuses it for issue parents instead of forking it
- [Phase 01]: 01-14: epic picker bound to m ('move under') not a reflexive letter — s/p/e/a were already taken by status/priority/estimate/assignee
- [Phase 01]: 01-14: useSetTaskEpic exists only for tasks (no epic-kind branch) — the fixed three-level hierarchy gives an epic no epic parent of its own
- [Phase 01]: 01-15: parentsById (BoardView) is one item-id -> {key,title,kind} lookup covering both epics and tasks, keyed exactly like epicsById's single-window derivation — IssuesLane needs no second tasksById map to resolve an issue's parent
- [Phase 01]: 01-15: BOARD-01 reticked in REQUIREMENTS.md, restored to its pre-01-12 wording — G-01-EPIC-ASSIGN is fully closed (issue parenting, quick-add nesting, and both creation paths now carry the ids they were dropping)
- [Phase 01]: G-01-1 closed: App.tsx's menu:action bridge no longer pre-empts the layer guard; native menu bar now mirrors bindingAllowedInLayer's verdict via menu_set_action_enabled (MenuHandles<R> generic in state.rs, concrete Wry at the command boundary)
- [Phase 01]: [Phase 01] G-01-2 closed: epic roster (list_epics/epic_list_all/useEpics) mirrors the actor-roster triad, replacing BoardView's windowed epicsById derivation; epic-pill-unresolved is a registered Legend mark so the pill can never leak a raw internal id
- [Phase 01]: G-01-2 closed: FilterBar's chip row and both parent pickers now resolve epics from the project-wide roster (useEpics), never the loaded board window — the epic filter/pickers are the second half of the fix 01-17 started for the pill
- [Phase 01]: G-01-4 closed: quick-add focus uses a consume-once request flag (quickAddFocusPending) plus virtualizer.scrollToIndex, not autoFocus or a ref, so focus survives both late-mounting and re-application — A ref handle can't focus an unmounted row; a quickAddOpen-keyed effect can't re-fire on a second press with no state change
- [Phase 01]: collapseStore gained a distinct idempotent expand(projectId, status) action rather than reusing toggle, so a second consecutive quick-add open cannot re-close an already-open Backlog band
- [Phase 01]: [Phase 01-20]: MOUNTABLE_ROW_ESTIMATE is computed from three named local constants inside volume.ts (jsdom viewport height, ROW_HEIGHT, overscan) rather than imports, so a fixture-adequacy self-check catches drift without adding a production-code dependency to the test-helper module. — Matches the plan's literal instruction and keeps volume.ts's only production dependency to the BoardItem type; the self-check case fails the suite if VOLUME_ROW_COUNT's margin over the estimate erodes.
- [Phase 01]: [Phase 01-20]: buildVolumeItems assigns each row a 26-character Crockford base32 id (ULID-shaped) instead of short ids, so plan 01-19's raw-identifier leak scan (G-01-2) is a real assertion against the shared volume fixture rather than a vacuous one. — A fixture built from short ids like "1"/"2" could never match the 26-character pattern the leak scan looks for, regardless of whether production code actually leaked one.

### Pending Todos

None yet.

### Blockers/Concerns

- **Anthropic credential policy is an external dependency, not a solved problem.** A policy shift on third-party harness use of subscription credentials could invalidate v1 overnight. AGNT-04 (explicit API-key path) is first-class in Phase 2 as the hedge; review this at every milestone boundary.
- **Nimbalyst competitive checkpoint.** Ships local desktop + Claude Code + worktrees + kanban already. Re-scout before Phase 5 (Socratic authoring) to confirm the moat is still where the research said it was.
- **Phase 4 needs evidence, not vibes.** Do not ship context reconstitution without the synthetic multi-cycle test suite and explicit context-quality metrics built during planning.
- **Phase 5 rests on an unvalidated assumption** that Socratic epic authoring beats prompting in a terminal. Spike it during planning before building the full surface.
- **Phase 11 has a hard prerequisite** outside the codebase: an Apple Developer account ($99/yr) for signing and notarization.

### Roadmap Evolution

- Phase 10.1 inserted after Phase 10: Visual polish: brand assets (app icon, logo.svg, the HighKnow-vs-Flywheel mark decision) and the three UI-SPEC motions the direction round never confirmed. Surfaced by phase 01 UAT; filed on the board as THRE-1068 through THRE-1074.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Requirements correction | **D-21 — `RLAY-01` is wrong as written.** It encodes laptop-as-master relay topology, which the user rejected as a single point of failure for a team sharing a repository. Rewrite it to the relay-as-hub model settled in D-20. Not Phase 1 work; action for the next milestone or requirements pass. | Open | 2026-09-09 (Phase 1 planning) | v1 |

## Session Continuity

Last session: 2026-09-10T06:28:34.088Z
Stopped at: Completed 01-20-PLAN.md (gap closure G-01-4 hardening)
Resume file: None
