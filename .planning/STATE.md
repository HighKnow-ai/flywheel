---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: The Board Is The Store Of Record
status: executing
stopped_at: Completed 01-10-PLAN.md
last_updated: "2026-09-09T08:34:16.079Z"
last_activity: 2026-09-09
last_activity_desc: Phase 01 execution started
state_head: 8b43e59273dbcbf842cb8b824c31021251fed164
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 11
  completed_plans: 10
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-08)

**Core value:** Every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob.
**Current focus:** Phase 01 — The Board Is The Store Of Record

## Current Position

Phase: 01 (The Board Is The Store Of Record) — EXECUTING
Plan: 11 of 11
Status: Ready to execute
Last activity: 2026-09-09 — Phase 01 execution started

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

### Pending Todos

None yet.

### Blockers/Concerns

- **Anthropic credential policy is an external dependency, not a solved problem.** A policy shift on third-party harness use of subscription credentials could invalidate v1 overnight. AGNT-04 (explicit API-key path) is first-class in Phase 2 as the hedge; review this at every milestone boundary.
- **Nimbalyst competitive checkpoint.** Ships local desktop + Claude Code + worktrees + kanban already. Re-scout before Phase 5 (Socratic authoring) to confirm the moat is still where the research said it was.
- **Phase 4 needs evidence, not vibes.** Do not ship context reconstitution without the synthetic multi-cycle test suite and explicit context-quality metrics built during planning.
- **Phase 5 rests on an unvalidated assumption** that Socratic epic authoring beats prompting in a terminal. Spike it during planning before building the full surface.
- **Phase 11 has a hard prerequisite** outside the codebase: an Apple Developer account ($99/yr) for signing and notarization.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Requirements correction | **D-21 — `RLAY-01` is wrong as written.** It encodes laptop-as-master relay topology, which the user rejected as a single point of failure for a team sharing a repository. Rewrite it to the relay-as-hub model settled in D-20. Not Phase 1 work; action for the next milestone or requirements pass. | Open | 2026-09-09 (Phase 1 planning) | v1 |

## Session Continuity

Last session: 2026-09-09T08:34:16.058Z
Stopped at: Completed 01-10-PLAN.md
Resume file: None
