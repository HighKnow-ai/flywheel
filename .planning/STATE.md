---
gsd_state_version: "1.0"
current_phase: 3
current_phase_name: Nothing Lost, Nothing Left Running
status: planning
stopped_at: Phase 3 context gathered
last_updated: "2026-09-12T01:10:33.740Z"
last_activity: 2026-09-12
last_activity_desc: Phase 02 complete, transitioned to Phase 3
state_head: c512d672402bfb77b64eca7e990e9fc68f42cb05
progress:
  total_phases: 12
  completed_phases: 0
  total_plans: 39
  completed_plans: 39
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-10)

**Core value:** Every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob.
**Current focus:** Phase 02 — One Agent, One Worktree, Watched Live

## Current Position

Phase: 3 — Nothing Lost, Nothing Left Running
Plan: Not started
Status: Ready to plan
Last activity: 2026-09-12 — Phase 02 complete, transitioned to Phase 3

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 39
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 21 | - | - |
| 02 | 18 | - | - |

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
| Phase 02 P11 | 9min | 3 tasks | 5 files |
| Phase 02 P13 | 22min | 3 tasks | 4 files |
| Phase 02 P12 | 35min | 3 tasks | 4 files |
| Phase 02 P14 | 25min | 3 tasks | 6 files |
| Phase 02 P15 | 45min | 3 tasks | 5 files |
| Phase 02 P16 | 35min | 3 tasks | 4 files |
| Phase 02 P17 | 20min | 4 tasks | 6 files |
| Phase 02 P18 | 20min | 3 tasks | 9 files |

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
- [Phase 02]: [Phase 02]: agent_run_stop's CR-04 fix is a decouple-then-report shape (AgentRunStopDto { status, sidecarWarning }), not the review's raw format!-wrapped Err sketch — an Err from a decoupled command still lands in SessionSurface.tsx's .catch(() => setStopping(false)), leaving the UI stuck since the surface only ever sets terminal status from a session_closed push a dead sidecar never sends.
- [Phase 02]: [Phase 02]: stop_agent_run_recording_first captures the interrupt closure's Result in a local, read only after the domain write completes, rather than applying ? or matching with an early return, making 'is the domain write reachable when the sidecar failed' a structural, greppable property instead of a comment promising discipline.
- [Phase 02]: [Phase 02]: The unconfirmed-stop notice reuses E2's terminal-row pattern at the interrupted/muted weight (--text-muted-rack, CircleSlash) rather than the failed treatment, since 02-UI-SPEC.md specifies no presentation for a successful-but-unconfirmed stop and the run genuinely did reach interrupted.
- [Phase 02]: D-40 (checkpoint, plan 02-13): Deleting a task with agent-run history is BLOCKED, with an actionable message (option-a) -- never cascaded. Preserves the non-repudiable record of agent work; needs no migration; cheap to revisit once Phase 3 adds a worktree-removal path.
- [Phase 02]: persist_event_line replaces sidecar.rs's panicking session-log open with a non-panicking PersistOutcome seam (CR-03/PROC-07) — A panic in the shared sidecar stdout reader task took down every run's live feed and persisted log for the rest of the app session; every failure mode is now a returned value.
- [Phase 02]: A skipped session-log persist now surfaces a visible incomplete-transcript banner instead of a suppressed stderr line — 02-07's own prohibition requires the live feed never silently drop agent output; the banner is gated once-per-run via a HashSet so a repeatedly-failing run does not spam notices.
- [Phase 02]: [Phase 02] CR-02 closed: the sidecar shutdown op (plus SIGTERM/stdin-EOF fallback nets) tears down every live session's process group, and main.rs's RunEvent::Exit now calls it before kill(), machine-verified by a source-order gate. — Every claude session is spawned detached:true precisely so it becomes its own process-group leader, independent of the sidecar's group -- killing only the sidecar (kill()) can never reach it, so an explicit shutdown-then-kill ordering is the only correct sequence.
- [Phase 02]: [Phase 02] G-02-1 closed: the dev sidecar stub now walks up from its own symlink-resolved physical directory for the packages/sidecar/dist marker instead of a fixed parent-hop count, and spawn_sidecar performs a bounded ping readiness handshake (reading the spawn receiver directly, before AppState/pending_acks exists) before returning Ok, so an immediately-dying sidecar aborts startup naming its own exit status and stderr instead of surfacing later as a stdin write failure.
- [Phase 02]: [Phase 02] ping is a distinct sidecar op from capability_probe: ping asks only whether the sidecar process itself is alive and speaking its own protocol (no side effect, no backend dependency), while capability_probe spawns the user's claude binary and must never gate application startup.
- [Phase 02]: Collapsed body-row text is JS-sliced to FEED_ROW_TRUNCATION_THRESHOLD, not just CSS-clipped — jsdom keeps the full DOM text node under text-overflow:ellipsis, contradicting the plan's own Task 3 assertion that oversized marker text is absent before expanding; JS slicing also avoids rendering multi-kilobyte strings into the DOM purely to hide them with CSS.
- [Phase 02]: G-02-2 closed: buildClaudeArgv pairs stream-json with --verbose behind a constraint-shaped guard (converse + examined-count asserted), the sidecar drains the child's stderr for the session's lifetime and carries a failure explanation on SessionClosedEvent.detail, and a real-binary test (with a falsifiability companion) proves an argv the CLI rejects can no longer pass the suite.
- [Phase 02]: Non-init system stream events now normalise to system_notice (terse 'system: <subtype>' text) instead of unknown, so the --verbose flag's session-lifecycle chatter reads as one short line per event; the fallthrough to unknown is narrowed, never deleted, and no renderer change was needed.
- [Phase 02]: [Phase 02]: G-02-4 closed: apply_session_closed (packages/core/src/domain/agent_run.rs) is close_agent_run's missing production caller, dispatched from the sidecar reader loop's session_closed branch — an already-terminal run is backfilled (cost/tokens only) rather than overwritten, and close_agent_run's own body/signature are unchanged.
- [Phase 02]: [Phase 02]: Token counts (tokens_in/tokens_out) are written ONCE from the terminal result event's summed usage block, never accumulated per message — tokens_in is the SUM of input_tokens + cache_creation_input_tokens + cache_read_input_tokens, measured against the real CLI to avoid recording the misleading plain-field value alone.

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

Last session: 2026-09-12T01:10:33.648Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md
