---
gsd_state_version: "1.0"
current_phase: 02
current_phase_name: one-agent-one-worktree-watched-live
status: executing
stopped_at: Completed 02-10-PLAN.md
last_updated: "2026-09-11T03:58:41.651Z"
last_activity: 2026-09-10
last_activity_desc: Phase 02 execution started
state_head: 17903b33ce6ebeeca0af74d8d1491dc98953a08c
progress:
  total_phases: 12
  completed_phases: 0
  total_plans: 35
  completed_plans: 31
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-10)

**Core value:** Every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob.
**Current focus:** Phase 02 — One Agent, One Worktree, Watched Live

## Current Position

Phase: 02 (one-agent-one-worktree-watched-live) — READY TO EXECUTE
Plan: 10 of 10
Status: Ready to execute
Last activity: 2026-09-10 — Phase 02 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 21
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 21 | - | - |

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
| Phase 01 P21 | 11min | 3 tasks | 4 files |
| Phase 02 P01 | 55min | 3 tasks | 43 files |
| Phase 02 P02 | 55min | 3 tasks | 17 files |
| Phase 02 P03 | 45min | 3 tasks | 10 files |
| Phase 02 P04 | 70min | 3 tasks | 15 files |
| Phase 02 P05 | 100min | 3 tasks | 22 files |
| Phase 02 P06 | 50min | 3 tasks | 20 files |
| Phase 02 P09 | 100min | 3 tasks | 20 files |
| Phase 02 P07 | 130min | 3 tasks | 14 files |
| Phase 02 P08 | 35min | 3 tasks | 12 files |
| Phase 02 P10 | 45min | 3 tasks | 12 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Research]: Build the PM core from scratch — every cloud tracker fails local-first; Plane trades a simpler schema for AGPL plus a server stack.
- [Research]: Stack settled — Tauri v2 (Rust core) + bundled Node.js sidecar (Claude Agent SDK) + React UI; rusqlite/SQLite with an append-only event log. No sync vendor chosen; schema-first, vendor-second.
- [Roadmap]: Vertical MVP structure, not the research's horizontal build order. Each phase ships a runnable capability.
- [Roadmap]: Moat before commodity — context reconstitution (Phase 4), Socratic authoring (Phase 5) and agent-authored backlog (Phase 6) sequenced ahead of git/forge surfaces (Phases 7-8), because Nimbalyst can copy the board-plus-worktree combination in weeks.
- [Roadmap]: The thinnest vertical slice (one task, two sequential sessions, second reconstituted from the board) completes at Phase 4 — the earliest the dependency graph allows.
- [Phase 01]: **Build, not integrate** — the PM core is a Rust/`rusqlite` board owning its own schema, migrations and append-only event log. The research round's open build-vs-integrate fork is now closed by having shipped it.
- [Phase 01]: **The schema, not app code, is the authority** for the fixed five-state workflow and the three-level hierarchy — CHECK constraints reject an invalid status, so no app-layer guard can be bypassed. Epics/tasks share one status CHECK; issues are workflow-less.
- [Phase 01]: **Every query in `packages/core/src/query` is a compile-time literal** with bound named parameters (filter dimensions ride a single JSON-array-or-NULL via `json_each`). Zero `format!`/string-interpolated SQL anywhere in core — verified by grep in `01-SECURITY.md`.
- [Phase 01]: **`actor_id` is resolved server-side in every command handler**, never accepted from the renderer; `events.actor_id` is NOT NULL with a live foreign key. This is what makes the activity trail non-repudiable when agents become actors.
- [Phase 01]: **`state/keyboard.ts` is the single key→action map**, and `dispatchAction(id)` synthesizes a real KeyboardEvent so the command palette and the native menu bridge re-enter the same keyboard pipeline rather than reimplementing each action. Competing per-row and per-field handlers were removed.

*(Phase 01 logged 48 decisions in total; the five above are the ones that bind later phases. The full set is in the phase's SUMMARY files and PROJECT.md's Key Decisions table.)*

- [Phase 02]: slugify treats only ASCII separators as word boundaries so dropped non-ASCII chars never fragment a word — Matches the plan's own worked LINK-01 example (naïve -> nave, not na-ve); a literal per-character-drop-collapses-to-hyphen reading of the LINK-01 prose produced the wrong output
- [Phase 02]: Node sidecar packaging (pkg/nexe) deferred; a dev-time bash-script stub bridges tauri-plugin-shell's externalBin requirement to packages/sidecar/dist/index.js — No plan in this phase runs the actual packaging step yet, but cargo build --workspace hard-fails without a real externalBin artifact present
- [Phase 02]: session_closed carries a synthesized non-empty raw field instead of an empty string, preserving the AgentEventBase 'raw never empty' invariant for every event type. — Avoids a special-cased exception in event consumers and keeps the pre-existing adapter.test.mjs invariant test meaningful for the new terminal event too.
- [Phase 02]: SidecarHandle::interrupt_run uses std::sync::mpsc rather than tokio::sync::oneshot, keeping agent_run_stop a plain synchronous Tauri command like every other handler. — Avoids introducing the first async command in this codebase just for one ack-await; a 30s ceiling comfortably covers the sidecar's own 5s STOP_GRACE_MS.
- [Phase 02]: Agent signal vocabulary shipped once (colour/legend/keyboard) so no later Phase 2 surface invents a parallel list — Colour roles, legend marks and keyboard bindings are consumed directly by the surfaces that render them, not re-derived
- [Phase 02]: assemble_context_packet re-derives the hypothetical epic-integration-branch name read-only instead of calling base_ref_for_task, which would cut a real git branch as a side effect — A preview (opening the launch sheet) must never mutate the database or git history — matches D-28's determinism contract and the plan's own 'nothing happens until Start Work fires' invariant
- [Phase 02]: state/uiStore.ts gained launchSheetTaskId and board/BoardView.tsx gained a start-work switch case, both outside plan 02-04's declared files_modified — ItemDetailPanel.tsx deliberately avoids importing the store directly; the launch sheet is mounted once at App.tsx level, so a cross-tree trigger field (mirroring activeAgentRunId) and its bridging call site were necessary to wire the sheet at all
- [Phase 02]: The permission-prompt MCP server is a genuinely separate OS process spawned by the backend (claude) per its own --mcp-config; a Unix domain socket opened by the sidecar BEFORE the backend is spawned is the only channel between the two processes, since MCP's stdio transport requires the client to own the pipe ends to whatever it spawns.
- [Phase 02]: Assumption A2 empirical spike found the installed claude CLI (2.1.236) applies its own built-in bash-command safety classification before ever consulting a configured --permission-prompt-tool, for at least read-only/safe-looking commands, even in --permission-mode default. Flagged as a Phase 3 input, not resolved this plan.
- [Phase 02]: pending_requests_for_run reads ALL pending permission_requests rows for a run, not just the latest, since two concurrent MCP tool calls can each raise their own pending row (02-05's D4). — The card's own E3 zero-one-many resolution promises to stack every pending request, which the existing LIMIT-1 lookup could not satisfy.
- [Phase 02]: useRegionBindings added to state/keyboard.ts as the region-scoped sibling of useGlobalBindings — the permission card's a/d/Shift+A shortcuts resolve through it, keeping the card's own file free of any local key or dismissal handler (T-02-16). — A component with a structural zero-key-handler requirement needs the window listener to live outside its own file.
- [Phase 02]: [Phase 02]: A global-scope credential-mode change writes no events row (events.project_id is NOT NULL and a global setting has no natural project stream); settings.updated_by/updated_at is its own audit record instead. Per-project override changes append a real project-scoped event.
- [Phase 02]: [Phase 02]: agent_run_start now resolves the run's credential BEFORE start_agent_run creates the run/worktree, so an api_key-mode resolution failure never leaves an orphaned running agent_runs row with nothing spawned.
- [Phase 02]: [Phase 02]: keyring is added with its default features kept ON (v1 required to compile at all) plus apple-native-keyring-store explicitly enabled, not default-features=false as first attempted.
- [Phase 02]: [Phase 02]: Assumption A1 (does ANTHROPIC_API_KEY reliably override a present subscription session) could not be measured this session — no spend-authorized real API key was available; recorded as a Phase 3 input, matching the plan's own accepted fallback.
- [Phase 02]: useSessionFeed pages tail-first with a literal "tail" pageParam for the initial page, letting a live invalidation re-resolve the tail against the log's current total while older loaded pages keep their own stable offsets — Avoids a second live-update mechanism separate from the paging query itself
- [Phase 02]: Tool-call/tool_result pairing is FIFO-by-toolName since no correlation id exists on either event in the sidecar's AgentEvent union — Accepted simplification; documented as a known limitation under concurrent same-named tool calls rather than fixed by extending the sidecar's event shapes (out of scope for this UI-only plan)
- [Phase 02]: Extended query::agent_runs's existing SELECT list (RunRow/RunSummaryDto) to include external_session_id — the column already existed on agent_runs but plan 02-07's own read path never selected it.
- [Phase 02]: Moved the permission-request card's compact mount from a generic ItemDetailPanel-level section into RunsSection, nested beneath the specific blocked run's own row, so a run and the answer it is waiting on read as one linked record.
- [Phase 02]: [Phase 02]: settings_set_credential_mode's mode widened from String to Option<String> so a per-project override can be cleared back to the global default — the domain layer already supported None, the Tauri command never exposed it.
- [Phase 02]: [Phase 02]: PermissionRulesTable takes an explicit loadingProjects prop from its caller rather than inferring loading state from an empty projects array, which is ambiguous between 'still loading' and 'genuinely zero'.

### Pending Todos

None yet.

### Blockers/Concerns

- **Anthropic credential policy is an external dependency, not a solved problem.** A policy shift on third-party harness use of subscription credentials could invalidate v1 overnight. AGNT-04 (explicit API-key path) is first-class in Phase 2 as the hedge; review this at every milestone boundary.
- **Nimbalyst competitive checkpoint.** Ships local desktop + Claude Code + worktrees + kanban already. Re-scout before Phase 5 (Socratic authoring) to confirm the moat is still where the research said it was.
- **Phase 4 needs evidence, not vibes.** Do not ship context reconstitution without the synthetic multi-cycle test suite and explicit context-quality metrics built during planning.
- **Phase 5 rests on an unvalidated assumption** that Socratic epic authoring beats prompting in a terminal. Spike it during planning before building the full surface.
- **Phase 11 has a hard prerequisite** outside the codebase: an Apple Developer account ($99/yr) for signing and notarization.
- ⚠️ **[Phase 01] The generic trigger abstraction was never built.** It is one of the three named extension-ready foundations (PROJECT.md), and the other two shipped — but no scheduler crate is vendored and no trigger type is stubbed, so schedule-as-trigger-source is still a structural retrofit, which is exactly what the architecture constraint forbids. Close it before the automations milestone, not at it.
- ⚠️ **[Phase 01] `epic_roster` is unbounded by design.** It returns every epic in a project, deliberately exempt from the `DEFAULT_LIMIT`/`MAX_LIMIT` cap (`01-SECURITY.md` AR-01-04). Safe only while one human creates epics one at a time; it becomes an unbounded response the moment an agent gets that path in Phase 6.
- ⚠️ **[Phase 01] The chosen visual direction has not yet been seen as designed.** `01-UI-REVIEW.md` (18/24) found two of Flight Progress Strips' own signature moves absent: sticky band headers (specified, asserted by three code comments, implemented nowhere) and the selected strip "breaking the plane" (tint overlay only). Tracked in Phase 10.1. Relevant because the owner's judgement that the direction "reads as dated" is currently a judgement on an incomplete execution of it.
- ⚠️ **[Phase 01] Process defect, will recur every phase needing human verification.** The verifier's `human_needed` branch writes `{phase}-UAT.md`, but `UAT.md` is also declared in `covered_files` and hashed into `covered_digest` — so a verification that asks for human testing invalidates its own fingerprint and reads `stale` forever after. `/gsd-verify-work` then routes to itself, which cannot clear it. Broken this round by regenerating verification with `status: passed` after UAT passed; the durable fix is to stop fingerprinting verify-step *outputs* as verification *inputs*.

### Roadmap Evolution

- Phase 10.1 inserted after Phase 10: Visual polish: brand assets (app icon, logo.svg, the HighKnow-vs-Flywheel mark decision) and the three UI-SPEC motions the direction round never confirmed. Surfaced by phase 01 UAT; filed on the board as THRE-1068 through THRE-1074.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Requirements correction | **D-21 — `RLAY-01` is wrong as written.** It encodes laptop-as-master relay topology, which the user rejected as a single point of failure for a team sharing a repository. Rewrite it to the relay-as-hub model settled in D-20. Not Phase 1 work; action for the next milestone or requirements pass. | Open | 2026-09-09 (Phase 1 planning) | v1 |

## Session Continuity

Last session: 2026-09-11T02:43:35.940Z
Stopped at: Completed 02-10-PLAN.md
Resume file: None
