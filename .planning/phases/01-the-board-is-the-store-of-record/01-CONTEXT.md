# Phase 1: The Board Is The Store Of Record - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

A running macOS desktop application whose board **is** the durable work model. It delivers:
registering multiple local git repositories as projects and switching between their boards; creating
epics, tasks and issues in a fixed three-level hierarchy; individually checkable acceptance criteria
on tasks and epics; a fixed, non-reconfigurable Backlog → Todo → In Progress → In Review → Done
workflow; search, filter and reorder at 1,000+ items with no perceptible lag; full keyboard
navigation; a chronological actor-attributed activity trail on every item; and a SQLite store that
survives a force-quit and a version upgrade without losing committed work.

This is also the phase that stands up the repository itself — there is no code today — and the phase
where three structural seams land that would otherwise be retrofit nightmares: the append-only event
log written in the same transaction as the mutable projection (DATA-01), actor attribution on every
mutation with humans and agents as distinct actors of one model (DATA-03), and cursor-resumable
ordered reads of that log (DATA-05).

**Requirements:** DATA-01, DATA-02, DATA-03, DATA-05, DATA-07, DATA-08, BOARD-01, BOARD-02,
BOARD-04, BOARD-05, BOARD-06, BOARD-07, BOARD-08, BOARD-09, BOARD-10.

**Explicitly NOT in this phase:** worktrees, agent processes, agent adapters, context assembly,
Socratic authoring, agent-proposed items, git/forge linkage, diff review, the planner, the fleet
view, or the relay. Acceptance-criteria *immutability and revisioning* is BOARD-03 and lands in
Phase 4 — Phase 1 only lays the table down so that change is additive.

</domain>

<decisions>
## Implementation Decisions

### Board Surface & Navigation

- **D-01:** The primary board view is a **dense, virtualized, Linear-style list** grouped by status —
  not a kanban and not an outline tree. Status changes happen by keystroke, not by drag. A kanban
  column view is deferred as a possible second surface over the same data.
- **D-02:** Keyboard model is **Linear-style: single-letter actions on the selected item plus a ⌘K
  command palette**. Arrow/`j`/`k` to move; single keys for the hot actions (status, edit, create);
  the palette is the discoverable escape hatch so BOARD-07 coverage is not gated on memorising
  bindings.
- **D-03:** **Search, filter and sort are indexed SQL queries executed by the Rust core**, debounced
  per keystroke; the UI holds only the current result window. There is deliberately **no second
  in-memory filtering implementation** in the renderer — a divergent client-side path is rejected
  because "the board disagrees with itself" is the v1 trust failure, and because this same query path
  is what a relay would later serve. — **Reversibility:** costly — reversing means moving filter/sort
  semantics into the renderer and re-implementing them, then reconciling two definitions of a result
  set across every board view.
- **D-04:** **The Rust core pushes event-log deltas to the UI**, which invalidates the affected
  queries and refetches. The UI must not rely on "refetch after my own mutation" — from Phase 2
  onward agents write to the board, and the subscription shape chosen here is the one a relay reuses
  (DATA-05). — **Reversibility:** costly — the alternative has to be torn out and replaced the moment
  a non-UI writer exists, and every view built against it re-audited.

### Acceptance Criteria

- **D-05:** A single acceptance criterion is **a checkable statement plus a verification hint** — how
  you would know it is true (a test name, a command, a manual check). Not bare prose, and not formal
  Given/When/Then, which is hostile to non-behavioural criteria and too heavy to author during
  Phase 5's Socratic shaping.
- **D-06:** Acceptance criteria are **their own table with their own ULIDs**, ordered within their
  parent, each mutation event-logged and actor-attributed — not a JSON column on the task. This is
  load-bearing: Phase 4's immutability and revisioning becomes an additive column rather than a
  migration, Phase 8 can check off a single criterion without rewriting the parent row, and session
  summaries can reference an individual criterion by id. — **Reversibility:** one-way — moving
  criteria between a JSON column and their own table requires a data migration, and by Phase 4 those
  rows carry revision history and by Phase 8 they are referenced by review state.
- **D-07:** **Criteria live on tasks and on epics**, not on issues. An epic carries its own success
  criteria (mirroring how ROADMAP.md phases carry "what must be TRUE"), which Phase 8's epic
  integration-branch review consumes. Issues are proposals and notes, not units of work — giving them
  a contract would blur the triage lane Phase 6 depends on.
- **D-08:** Moving an item to Done with unchecked criteria **warns but does not block**. The
  checked/total count is visible wherever the item appears, so the pressure is social rather than
  mechanical. A hard block was rejected because criteria become immutable from Phase 4 on, so a wrong
  criterion would leave the user fighting their own tool.

### Item Creation, Identity & Ordering

- **D-09:** **Inline quick-add is the creation path** — type a title in place, press enter to create
  at the current position, indent to nest a task under an epic; detail and criteria are filled in
  afterwards by opening the item. No form-per-item-type dialog as the primary path.
- **D-10:** Every item carries a **human-readable per-project key (`FLY-142`) alongside its ULID** —
  a short project prefix plus a monotonic per-project counter allocated in the same transaction as
  the insert. This is what Phase 2 derives branch names from (LINK-01) and what Phase 7 writes into
  commit trailers (LINK-03), so it must be typeable, greppable and stable. — **Reversibility:**
  one-way — once branches and commit trailers in real git history carry these keys, changing the
  identifier scheme cannot be applied retroactively to published git objects.
- **D-11:** Prioritisation is **both a manual rank and a priority field**. Manual rank uses a
  **fractional index** so moving one item rewrites one row rather than renumbering the list.
  **Tie-break rule: priority sorts first, manual rank orders within a priority band.** This gives one
  unambiguous answer to "what is next" for an agent reading the board. — **Reversibility:** costly —
  the ordering key shape is depended on by every list query and by any future sync reconciliation;
  integer positions would need a backfill and a rewrite of reorder handling.
- **D-12:** Tasks and epics carry a **nullable `estimate`** (coarse size — S/M/L or 1/2/3/5/8). It is
  rendered and filterable. **Nothing aggregates it** — no velocity, no burndown, no capacity, nowhere
  in the UI. It exists because Phase 9's planner can legitimately use a size hint alongside declared
  file-sets, and because it is the seam that makes cycles additive in v2. Retrospection in this
  product comes from measured data (agent run cost, tokens, duration; event-log timestamps on every
  status transition), not from human estimates.
- **D-13:** **`task.epic_id` is nullable — a task may exist without an epic.** Work is captured before
  its epic is known. Consequence handed to Phase 2: the fixed branch topology (task → epic
  integration branch → main) needs a defined answer for an orphan task; do not assume every task has
  an integration branch to chain to.

### Persistence, Project Registration & Team Topology

- **D-14:** **One fleet-wide SQLite database in the OS app-data directory** holds every project — not
  one database per repository. The whole value proposition is a single cross-project view (Phase 10),
  and a per-repo store would make it an N-database fan-out and put agent-written state inside the
  tree agents are editing. — **Reversibility:** one-way — splitting or merging the store later is a
  data migration across every table plus a rewrite of every cross-project query.
- **D-15:** Each registered repository carries **a small committed marker file holding only the
  project id and key — never board content**. This gives a project stable identity that survives
  being cloned onto another machine, which is the prerequisite for any team model. Board state itself
  never enters git. — **Reversibility:** one-way — without it, "the same project on two machines"
  cannot be established retroactively for repos already registered.
- **D-16:** **The marker is the binding; the stored absolute path is a cached hint.** On launch,
  verify each project's path still holds a repo whose marker matches; if not, mark the project
  **unreachable and offer explicit relocation**. Never silently re-bind, and never scan the disk to
  auto-locate — this mirrors WORK-06's rule for worktrees in Phase 3, and silent repair is exactly
  what that requirement forbids.
- **D-17:** **`sequence` is NOT a single monotonic counter per project.** The event log is keyed per
  **(project, origin)** with the ULID carrying global ordering, so a second origin's event stream can
  interleave later. A single per-project counter breaks the moment a second writer exists and would
  become a migration. — **Reversibility:** one-way — renumbering an append-only log that a relay may
  already have consumed by cursor is not possible without breaking every subscriber's cursor.
- **D-18:** **Migration safety is backup-first, not down-migrations.** Copy the database file before
  every migration run, migrate inside a transaction, retain the last few backups. This delivers
  DATA-08's "reversible within one version" as a file restore rather than as hand-written
  down-migrations that are rarely exercised and often wrong. The database is small; the copy is cheap.
- **D-19:** **The item activity trail renders straight from the event log** — a query over `events`
  filtered by stream. There is deliberately **no separate denormalised activity table**: a second
  history can drift from the first, and a board that disagrees with itself about what happened is a
  trust failure in the very phase whose point is being the store of record. Consequence: **event
  payloads must be designed for human rendering from day one** (field-level before/after values,
  actor, not just sync-shaped deltas). Criterion 5's replay-from-any-cursor is then the same data the
  UI already renders. — **Reversibility:** costly — retrofitting human-renderable detail into event
  payloads means every historical event predating the change renders degraded, permanently.

### Team & Cloud Topology (cross-cutting correction, raised by the user)

- **D-20:** The team model is **relay-as-hub, not laptop-as-master.** Execution locality is the real
  constraint — agents run on the developer's machine with their own credentials, which never leave
  the desk. Board *authority* is a separable question, and nothing requires it to sit on one
  designated laptop. When a team is configured, the relay holds the shared board and every desktop is
  an offline-capable replica that reconciles on reconnect. Solo mode is the degenerate case: no relay
  configured, the local database is the only copy, and DIST-04 still holds because the desktop app is
  fully functional with the server entirely absent.
- **D-21:** **`RLAY-01` is wrong as written** and must be corrected at the milestone boundary, not
  silently here. It currently reads "A hosted relay syncs board state *from a developer's machine* to
  the cloud", which encodes the laptop-as-master topology the user rejected as a single point of
  failure for a team sharing a repository. **Action for whoever runs the next milestone or
  requirements pass — not for this phase's planner.**
- **D-22:** Nothing in Phase 1 depends on the relay existing. The properties that make a hub possible
  are already locked and land in this phase regardless: ULIDs so two machines never collide on keys
  (DATA-02), an append-only event log with actor attribution so merging is "apply their events"
  (DATA-01, DATA-03), and cursor-resumable reads so a replica can catch up (DATA-05). The only two
  hub-specific consequences for this phase are D-15 (stable project identity across clones) and D-17
  (multi-origin-tolerant event log).

### Claude's Discretion

- **Size/estimate design (D-12):** the user delegated this explicitly ("I trust your analysis on
  size"). The recommendation taken was a nullable, non-aggregated `estimate`; the scale itself
  (S/M/L vs Fibonacci) is open.
- Full-text search mechanics (SQLite FTS5 vs indexed `LIKE`), and whether search spans projects or is
  per-project, were not discussed — resolve against D-03 (query runs in the core) and BOARD-06.
- How much of the monorepo and Tauri shell Phase 1 stands up — in particular whether the Node sidecar
  is scaffolded now (empty) or first appears in Phase 2 — was not discussed. Resolve against
  `ARCHITECTURE.md` §8's `packages/` layout.
- The item detail surface (side panel vs full page vs modal), row column set, grouping affordances
  and empty states were not discussed — UI-spec and planning concerns.
- The project key prefix's origin (derived from repo name vs user-chosen) and whether it is editable
  after items exist.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent and scope
- `.planning/PROJECT.md` — core value, the seven hard constraints (especially "no v1 decision may
  foreclose scheduled automations, team collaboration, the mobile/web relay, or additional agent
  backends"), and the Key Decisions table.
- `.planning/REQUIREMENTS.md` — the 15 requirement definitions this phase implements, plus the v2
  seams (`TEAM-01`, `RLAY-01`, `CONV-04`) that Phase 1 must not foreclose. **Note D-21: `RLAY-01`'s
  wording is known to be wrong.**
- `.planning/ROADMAP.md` §"Phase 1: The Board Is The Store Of Record" — the five success criteria this
  phase is verified against, and the Notes on where the structural seams land.

### Architecture and schema
- `.planning/research/ARCHITECTURE.md` §2 "Domain Schema" — the concrete entity table (Actor, Project,
  Epic, Task, Issue, Event, Trigger …), field lists and relationships. The authoritative starting
  point for the Phase 1 schema.
- `.planning/research/ARCHITECTURE.md` §2.1 "Event log vs. mutable projection" — the transactional
  outbox pattern (one transaction writes the mutable row *and* appends to `events`), and the explicit
  rejection of full event sourcing. **Read alongside D-17 and D-19, which refine it.**
- `.planning/research/ARCHITECTURE.md` §8 "Open-Core Module Boundary" — the `packages/core`,
  `packages/desktop`, `packages/relay-client` layout and the CI rule that OSS packages must build with
  the commercial packages stripped. Defines the repository structure this phase creates.
- `.planning/research/ARCHITECTURE.md` §9 "Build Order" — step 1 (domain schema + persistence) and
  step 7 (renderer/UI shell) are the two components this phase delivers.
- `.planning/research/ARCHITECTURE.md` §"Anti-Patterns to Avoid" — in particular anti-pattern 3
  (cwd as an implicit git/fs argument), which shapes how the core is written even before worktrees
  exist in Phase 2.

### Stack
- `.claude/CLAUDE.md` §"Technology Stack" — the locked stack with verified versions: Tauri 2.11.x,
  `rusqlite` 0.40.x (`bundled` feature), `rusqlite_migration`, React, `@tanstack/react-query`,
  `@tanstack/react-virtual` 3.14.x, Zustand/Jotai. Also the "What NOT to Use" table.
- `.planning/research/STACK.md` — the full argument behind those choices, including why the sync
  vendor is deliberately deferred and what "schema-first, vendor-second" requires of the v1 schema.

### Risk
- `.planning/research/PITFALLS.md` — pitfall 3 (context reconstitution degrading silently) is the one
  that reaches back into this phase: it is why acceptance criteria are stored separately from prose
  (D-05, D-06) and why the event log is append-only.
- `.planning/research/SUMMARY.md` §"Research Flags" — Phase 1's named open questions: *can a relay
  actually subscribe to the event log and replay, and can actor identity extend to multi-remote
  without a schema migration?* D-17 and D-20 are this discussion's answer to the second half;
  **the researcher should verify the first half concretely.**

### Market
- `.planning/research/COMPETITION.md` — the build-vs-integrate resolution (build the PM core from
  scratch) and why every cloud tracker fails the local-first constraint.
- `.planning/research/FEATURES.md` — item 1 of the v1 daily-use set ("board as store of record"), and
  the finding that rigidity is the feature: Linear beats Jira on being non-configurable.

</canonical_refs>

<code_context>
## Existing Code Insights

**The repository is greenfield.** It contains only `README.md`, `.gitignore`, `.claude/` and
`.planning/`. There is no source code, no package manifest, no build tooling and no scaffold.

### Reusable Assets
- None. Nothing to reuse or extend.

### Established Patterns
- None in code. The only binding patterns are documentary: the stack table in `.claude/CLAUDE.md`
  and the `packages/` module layout in `ARCHITECTURE.md` §8.

### Integration Points
- This phase creates the integration points rather than connecting to any. Specifically it must
  stand up the monorepo skeleton (`packages/core`, `packages/desktop`, and the inert
  `packages/relay-client` seam), the Tauri v2 shell, the Rust core with `rusqlite` + WAL, the first
  `rusqlite_migration` migration, and the React renderer with its Tauri-invoke adapter module.
- **Phase-1 discipline with downstream consequences:** every Tauri `invoke`/`listen` call must sit
  behind one thin adapter module from day one, so the same React tree can later be pointed at a
  REST/WebSocket client against the relay with a single-file swap. `.claude/CLAUDE.md` calls this out
  explicitly as a phase-1 requirement rather than a stack decision.

</code_context>

<specifics>
## Specific Ideas

- **"Linear, not Jira" is the explicit reference point** for the board surface, the keyboard model
  and the deliberate non-configurability. Single-letter bindings plus ⌘K, a dense list rather than a
  kanban, and a fixed workflow are all modelled on it.
- **The user raised story points directly**, wanting them for retrospection and sprint measurement.
  The resolution: the *measurement* instinct is right but points are the wrong instrument for this
  product, because Flywheel will have real data — cost, tokens and duration per agent run (AGNT-08),
  and event-log timestamps on every status transition — where human teams only had estimates. A
  nullable non-aggregated `estimate` (D-12) is the compromise; sprint velocity and burndown are
  deferred.
- **The user pushed back hard on single-machine board authority**, describing the real collaboration
  case as teammates sharing a git repository and sharing project state through the tool, and named a
  single developer's laptop holding the database as "a gigantic point of failure." This produced
  D-20, D-21 and D-22, and is the most consequential outcome of this discussion — it corrects a
  requirement, not just a phase decision.

</specifics>

<deferred>
## Deferred Ideas

- **Sprint / cycle velocity, story-point burndown, and time-boxed planning** — already tracked as
  `CONV-04` in `REQUIREMENTS.md` v2, and excluded by the "general-purpose PM features" out-of-scope
  rule. The seam that keeps it additive is D-12's nullable `estimate` column, which exists in v1 with
  no aggregation anywhere.
- **Markdown paste-to-import** — pasting a nested outline (epics as headings, tasks as bullets,
  criteria as sub-bullets) and turning it into board items after a confirmation preview. Considered
  for day-one bulk loading and rejected for Phase 1 because it is a format, a parser and a preview UI.
  Worth revisiting once the board is real; also the natural home for importing an existing GSD
  `.planning/` structure.
- **Kanban column view** — as a second surface over the same data, toggled per project, once the
  dense list is solid.
- **Correcting `RLAY-01` in `REQUIREMENTS.md`** — see D-21. This is a requirements-pass action for a
  milestone boundary, not work for this phase's planner. Recorded here so it is not lost.

</deferred>

---

*Phase: 1-The Board Is The Store Of Record*
*Context gathered: 2026-09-09*
