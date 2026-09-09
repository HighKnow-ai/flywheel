# Walking Skeleton — Flywheel (by HighKnow)

**Phase:** 1
**Generated:** 2026-09-09

## Capability Proven End-to-End

A developer registers one of their own local git repositories as a project, types a title into the
inline quick-add, and the strip appears in the Backlog band carrying its `FLY-1` key — written by a
single transaction that appended the event alongside the projection row, refreshed by a delta the
Rust core pushed, and still there after quitting and relaunching the app.

The skeleton spans plans **01-01 → 01-02 → 01-03**: scaffold and harnesses, the visual world, then
the tracer slice that wires one path through every layer.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Desktop shell | Tauri 2.11.x — Rust core + macOS-native WebView | Locked in `.claude/CLAUDE.md`. The default-deny capability manifest gives a structural way to enforce "the renderer never touches the filesystem", which is the invariant the supervisor depends on from Phase 2 |
| Renderer | React + Vite, from the `create-tauri-app` `react-ts` template | Locked. Deepest ecosystem for the widgets this product needs — virtualized list now, diff view and DAG view in later phases — and the cleanest path to a future web surface |
| Store of record | SQLite via `rusqlite` 0.40.x (`bundled`), owned exclusively by the Rust core | Locked. No IPC on the hottest read/write path; no N-API/ABI friction. **One fleet-wide database** in the OS app-data directory, never one per repository (D-14) |
| Write pattern | Transactional outbox — every mutation is one `conn.transaction()` writing the projection row *and* appending to `events`, committed once | The audit trail and current state can never diverge (DATA-01). Full event sourcing was rejected: replay cost grows unboundedly and the renderer's queries are far simpler against normalized tables |
| Identity | Client-generated ULIDs everywhere, plus a human-readable per-project key (`FLY-142`) allocated in the same transaction as the insert | ULIDs so a second machine or a relay never collides (DATA-02, D-22). The human key because Phase 2 derives branch names from it and Phase 7 writes it into commit trailers, so it must be typeable, greppable and stable (D-10) |
| Event ordering | `sequence` keyed per `(project_id, origin)`, ULID `id` carrying global order | A single per-project counter passes every Phase-1 test and breaks silently the moment a second writer exists (D-17). Per-origin cursors are what let a relay subscribe later with no schema change (DATA-05) |
| Attribution | An `actors` table with a `human｜agent｜system` type, seeded by the first migration; `events.actor_id` NOT NULL | Humans and agents are distinct actors of one model from day one (DATA-03), which makes team collaboration additive rather than structural |
| Ordering key | `fractional_index` 2.0.2 serialized to a `TEXT` column, priority sorting first and rank within a band | A move rewrites one row rather than renumbering the list, which is what lets BOARD-05 and BOARD-08 compose at 1,000 items (D-11) |
| Migrations | `rusqlite_migration` over `user_version`, backup-the-file-first, restore-and-refuse on failure | "Reversible within one version" is delivered as a file restore, not as hand-written down-migrations that are rarely exercised and often wrong (D-18) |
| Search | SQLite FTS5 external-content tables with sync triggers, inside the already-bundled SQLite | A leading-wildcard `LIKE` cannot use an index and would break the no-perceptible-lag promise at 1,000 items. Zero extra dependency |
| Query ownership | Search, filter and sort execute as indexed SQL in the Rust core; the renderer holds only the current window | There is deliberately no second in-memory implementation — "the board disagrees with itself" is the trust failure this product cannot have (D-03) |
| UI refresh | The core emits `board:changed`; TanStack Query invalidates and refetches | The UI never trusts its own optimistic write, because from Phase 2 agents write to this board too, and this subscription shape is the one a relay reuses (D-04) |
| IPC seam | Every `invoke`/`listen` call sits behind `packages/desktop/src/adapters/tauri.ts` | Named in `.claude/CLAUDE.md` as a phase-1 requirement: the same React tree can later be pointed at a REST/WebSocket relay client by editing one file |
| Visual world | Flight Progress Strips (Impeccable direction round, seed `59b0beb9`), chosen by the owner 2026-09-09 | Dark aluminium rack chrome, light strip stock tinted per workflow state, annotation as the interaction grammar. One vertical rack, never horizontal columns |
| Directory layout | `packages/core` (Rust, OSS) · `packages/desktop` (Tauri + React, OSS) · `packages/relay-client` (inert, OSS) | `ARCHITECTURE.md` §8. The open/paid boundary falls on the `relay-client` seam, and it has to be real from the first commit for the CI module-boundary rule to mean anything |
| Local run | `npm --prefix packages/desktop run tauri dev` | Documented in `README.md` in plan 01-01 |

## Stack Touched in Phase 1

- [x] Project scaffold — Cargo workspace, Tauri v2 shell, React/Vite renderer, `cargo test` and Vitest harnesses (plan 01-01)
- [x] Routing — a single-window app with surface-level navigation: first-run, board, item detail panel, command palette, legend, project-unreachable (plans 01-03, 01-04, 01-09, 01-11)
- [x] Database — a real read *and* a real write: `create_task` writes the projection row, the key counter, the sequence counter and the event in one transaction; `list_board` reads a bounded indexed window (plan 01-03)
- [x] UI — an interactive element wired to the core: the inline quick-add creates an item and the rack refreshes from the pushed delta (plan 01-03)
- [x] Local full-stack run — `npm --prefix packages/desktop run tauri dev`, documented in `README.md` (plan 01-01)

## Out of Scope (Deferred to Later Slices)

Nothing below is missing work — each is deliberately absent so Phase 1 stays the thinnest thing that
proves the store of record. Do not re-litigate this list in a later phase's planning.

- Worktrees, agent processes, agent adapters, permission requests, cost and token tracking (Phases 2, 3, 10)
- Context assembly, session summaries, acceptance-criteria immutability and revisioning (Phase 4 — BOARD-03 is deliberately *not* Phase 1; this phase only lays the table down so that change is additive)
- Socratic epic authoring and agent-proposed items (Phases 5, 6)
- Git and forge linkage, branch topology, diff review, merge (Phases 7, 8)
- The planner, file-set declarations, fan-out (Phase 9)
- The fleet view across projects (Phase 10)
- Signing, notarization and auto-update (Phase 11)
- The relay itself. `packages/relay-client` is scaffolded inert so the module boundary is real, and nothing in Phase 1 depends on a relay existing (D-22)
- Kanban column view, markdown paste-to-import, cycles and story-point aggregation — recorded as deferred in `01-CONTEXT.md`
- A Node sidecar. It first appears in Phase 2, when there is an agent to drive; scaffolding an empty one now would be a package with no contract

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural
decisions:

- **Phase 2:** Start work on a task and watch a Claude Code session do it in a worktree the task owns
- **Phase 3:** Quit, crash or interrupt at any moment without destroying work or leaking agents
- **Phase 4:** Discard an agent's whole context and have the next session pick up from the board alone
- **Phase 5:** Be challenged while shaping an epic and walk away with board items, not a document
- **Phase 6:** Agents propose what they learn into a triage lane nothing escapes without a human
- **Phase 7:** Answer "where does this task stand in git and on the forge?" without a terminal
- **Phase 8:** Review an agent's diff against its acceptance criteria and land it in-app
- **Phase 9:** Turn one epic into several agents at once, bounded by real file-set disjointness
- **Phase 10:** Answer "what is every agent everywhere doing, and what needs me?" in one glance
- **Phase 11:** Install Flywheel like any Mac app; another developer builds it from source
</content>
