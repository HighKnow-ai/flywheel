# Phase 1: The Board Is The Store Of Record - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 1-The Board Is The Store Of Record
**Areas discussed:** Board surface & speed, Acceptance criteria shape, Getting real structure in, Projects & where state lives

---

## Board surface & speed

### Q1 — What is the primary view when you open a project's board?

| Option | Description | Selected |
|--------|-------------|----------|
| Dense list, Linear-style | One virtualized table grouped by status, keyboard-first, status by keystroke not drag. Fastest to make performant at 1,000 items; kanban addable later. | ✓ |
| Kanban of the 5 statuses | Five fixed columns with drag. Most legible glance, harder to virtualize, fights a keyboard-first model. | |
| Epic → task outline tree | Collapsible hierarchy mirroring the fixed 3-level model. Best for shaping, weakest for "what's in flight". | |
| List + kanban, both in v1 | Both surfaces over the same data. Honest to real use, doubles the work in the first phase. | |

**User's choice:** Dense list, Linear-style

### Q2 — What's the keyboard model for the dense list?

| Option | Description | Selected |
|--------|-------------|----------|
| Linear-style: single keys + ⌘K | j/k navigation, single-letter actions, ⌘K palette as discoverable escape hatch. Highest ceiling; palette means BOARD-07 isn't gated on memorisation. | ✓ |
| Command palette only | ⌘K for everything, no single-letter bindings. Less to build, nothing to memorise, three keystrokes per action. | |
| Vim-style with modes and chords | Modal navigation, g-prefixed jumps, chords. Densest once learned, most idiosyncratic, hardest to keep consistent. | |

**User's choice:** Linear-style: single keys + ⌘K

### Q3 — Where does the work happen when you type in the search box or change a filter?

| Option | Description | Selected |
|--------|-------------|----------|
| SQLite does it, UI renders | Indexed SQL query (FTS5 for text) in the Rust core; UI holds only the current page. Scales past 1,000, same query path a relay serves. Needs debouncing. | ✓ |
| Load the project, filter in memory | Whole project in the renderer, client-side filtering. Zero-latency typing, simpler; degrades past a few thousand items and builds a second divergent implementation. | |
| Hybrid: cache + SQL fallback | In-memory below a threshold, SQL above. Best felt performance, two code paths that can disagree. | |

**User's choice:** SQLite does it, UI renders

### Q4 — How does the board learn that something changed?

| Option | Description | Selected |
|--------|-------------|----------|
| Core pushes event-log deltas | Rust core emits on event-log append; UI invalidates and refetches. Same subscription shape a relay uses; agent writes in Phase 2+ need no new mechanism. | ✓ |
| UI refetches after its own mutations | Updates only on self-initiated actions. Simplest for Phase 1's single writer; must be torn out the moment an agent writes in Phase 2. | |
| Poll on an interval | Re-query every second or two. Catches outside writers cheaply; wastes work at idle and puts visible lag between an agent's write and seeing it. | |

**User's choice:** Core pushes event-log deltas

**Notes:** The two options rejected here were both rejected on the same grounds — they satisfy Phase 1
(where the user is the only writer) but become rework the moment agents write to the board in Phase 2.

---

## Acceptance criteria shape

### Q1 — What is a single acceptance criterion, concretely?

| Option | Description | Selected |
|--------|-------------|----------|
| Checkable line + how to verify | Ordered checkable statement plus a verification hint (test name, command, manual check). Enough structure for Phase 8 review without forcing a template during shaping. | ✓ |
| Just a checkable line | Plain text statements with checkboxes. Exactly BOARD-02 and nothing more; leaves "how would you know?" to prose. | |
| Structured Given/When/Then | Formal scenarios. Most machine-checkable, heavy to author in Phase 5, hostile to non-behavioural criteria. | |

**User's choice:** Checkable line + how to verify

### Q2 — How do acceptance criteria live in the schema?

| Option | Description | Selected |
|--------|-------------|----------|
| Own table, own ULIDs | Ordered rows with their own identity, event-logged and actor-attributed. Phase 4 immutability becomes additive; Phase 8 can check off one criterion. | ✓ |
| JSON array on the task | One column, simplest queries. Every check-off rewrites the task row; individual criteria have no identity to reference; Phase 4 becomes a migration. | |

**User's choice:** Own table, own ULIDs

### Q3 — Does the fixed workflow enforce anything about criteria at Done?

| Option | Description | Selected |
|--------|-------------|----------|
| Warn, don't block | Allowed but surfaced; item shows 3/5 everywhere. Honest without the tool refusing you; pressure is social. | ✓ |
| Hard block | In Review → Done refused until all checked. Strongest expression of the Core Value; likeliest to make you fight your own tool given Phase 4 immutability. | |
| No coupling in v1 | Criteria informational, workflow ignores them. Least to build; risks criteria becoming decoration in the phase meant to prove they aren't. | |
| Require a reason to override | Typed reason recorded on the event log. Enforcement without a dead end; a modal in the hottest path. | |

**User's choice:** Warn, don't block

### Q4 — Do epics and issues get criteria too?

| Option | Description | Selected |
|--------|-------------|----------|
| Tasks only | Matches BOARD-02 exactly; epic completeness is "all child tasks Done". | |
| Tasks and epics | Epics get success criteria, mirroring ROADMAP.md's "what must be TRUE"; Phase 8's epic diff review is the consumer. | ✓ |
| All three levels | Issues too. Maximum uniformity, but blurs the Phase 6 triage lane. | |

**User's choice:** Tasks and epics

---

## Getting real structure in

### Q1 — Fastest path to get real project structure onto the board in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline quick-add everywhere | Type a title in place, enter to create, indent to nest; fill detail afterwards. Keyboard-native, matches the dense list, no parser. | ✓ |
| Markdown paste → items | Paste a nested outline, confirm, items land. Bulk-loads in one action; a format, a parser and a preview UI. | |
| Both | Quick-add daily, paste for the initial load. Best day-one experience, two creation paths in the first phase. | |
| Forms only | Create dialog per type. Least to build; makes criterion 1 painful enough you'd never move real work over. | |

**User's choice:** Inline quick-add everywhere

### Q2 — What human-readable identifier do you type and read?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-project key: FLY-142 | Project prefix + monotonic per-project counter alongside the ULID. Typeable, greppable, survives in `git log`; needs a counter allocated in the insert transaction. | ✓ |
| Short ULID prefix | First 8 chars of the ULID. Zero extra schema, globally unique; unreadable and unsearchable in every branch name for the project's life. | |
| Title slug only | Derive from the title. Most readable; breaks on rename, collides, gives nothing stable to paste. | |

**User's choice:** Per-project key: FLY-142

### Q3 — Is priority a manual position, a field, or both?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual order only | Fractional-index rank; the order is the priority. Unambiguous; ranking 200 items by hand is the cost. | |
| Both: manual order + priority field | P0–P3 plus manual rank within it. Most expressive; two notions of "next" that need a tie-break rule. | ✓ |
| Priority field only | Sorted by field. Cheapest; no way to order within a band, which is most of grooming. | |

**User's choice:** *(Answered "Other")* — **"I kinda like the idea of story points. That also help us
retrospect and measure progress in a sprint for a later version. Do you have any alternative
suggestion?"** — then, after discussion: **"Manual position + field is great / I trust your analysis
on size."**

**Notes:** The story-point request was separated into two things. Points as a *sprint velocity*
instrument (burndown, capacity) is excluded by REQUIREMENTS.md's "general-purpose PM features"
out-of-scope rule and already tracked as CONV-04 in v2 — deferred. The underlying *measurement*
instinct was accepted, but redirected: Flywheel will have real data (agent run cost, tokens and
duration via AGNT-08; event-log timestamps on every status transition) where human teams only had
estimates, so retrospection should come from measurement rather than guesses. Three alternatives were
offered — measure-don't-estimate, a planner-serving size field with no aggregation, or full points
with velocity. The user delegated the choice; the middle option was taken: a nullable `estimate` on
tasks and epics, rendered and filterable, aggregated nowhere, serving Phase 9's planner and acting as
the seam that makes cycles additive in v2. Tie-break for the two ordering mechanisms: priority sorts
first, manual rank orders within a band.

### Q4 — Must every task belong to an epic?

| Option | Description | Selected |
|--------|-------------|----------|
| Epic optional | Loose tasks in the project backlog, adopted later. Matches how work arrives; `task.epic_id` already nullable in the research schema. Phase 2 needs an answer for an orphan task's branch chain. | ✓ |
| Epic required | Catch-all epic for loose work. Keeps the topology total; friction on capture and a junk-drawer epic. | |
| Optional, but promoted on Start Work | Capture loose, gate at Start Work. Fast capture and total topology; a gate at the worst moment, encoded in Phase 1 for a phase that doesn't exist. | |

**User's choice:** Epic optional

---

## Projects & where state lives

### Q1 — Where does the database actually live?

**First pass** *(user answered "Other")*: **"Sorry this may be a dumb question but how is the cloud
version working in this setup? I don't really see it trivial"**

Answered in plain text: the desktop stays the source of truth; the event log is the sync substrate;
`packages/relay-client` reads from a cursor and POSTs batches to a configured relay, which replays
them into its own projection for mobile/web; writes come back as events from a different `Actor`.
Three honest hard parts were named — bidirectional conflict resolution is deliberately deferred (no
sync vendor chosen), the machine has to be awake, and two machines on one project is genuinely
unsolved.

**Second pass** *(user answered "Other" again, with a substantive objection)*: **"I think we're maybe
seeing things differently. When I say that teammates are collaborating on the same project, they
collaborate on the same git repo and share the same project state using our PM agentic tool. So the DB
running in 'one developer's laptop' seems like a gigantic point of failure"**

This was accepted as correct. Execution locality (agents + credentials on the developer's machine) was
separated from board authority (which need not sit on any one laptop), producing the relay-as-hub
model and the finding that `RLAY-01` is wrong as written. The question was then re-asked in that frame:

| Option | Description | Selected |
|--------|-------------|----------|
| Fleet DB + committed marker | Local state in one app-data SQLite file; a committed file carries only project id and key. Fast local store, clean repos, a clone identifies itself so a hub can reconcile. | ✓ |
| Board state committed to the repo | Event log as files in git. Collaboration free via git, no server needed; merge conflicts, agents mutating their own board, repo churn, recreates `.planning/`. | |
| Fleet DB only, no marker | Repos untouched, identity purely local. Cleanest now; makes "same project on two machines" a retrofit. | |

**User's choice:** Fleet DB + committed marker

### Q2 — What happens when a registered repo moves, is renamed, or is unmounted?

| Option | Description | Selected |
|--------|-------------|----------|
| Marker is truth, path is a hint | Path is a cached location; verify on launch, mark unreachable, offer relocation. Board data never lost to a moved folder; same shape as WORK-06. | ✓ |
| Path is truth, surface breakage | Broken until re-pointed. Simplest and explicit; re-registering risks a duplicate project. | |
| Auto-relocate by scanning | Search for a matching marker and re-bind. Nicest when it works; scans the disk, can bind the wrong clone, repairs silently. | |

**User's choice:** Marker is truth, path is a hint

### Q3 — Migration safety policy for DATA-07/DATA-08?

| Option | Description | Selected |
|--------|-------------|----------|
| Backup, migrate, keep the backup | File copy before every migration, migrate in a transaction, retain recent backups. Delivers "reversible within one version" as a restore rather than untested down-migrations. | ✓ |
| Reversible up/down migrations | Tested down-migration per change. Literal reading of DATA-08; two migrations and a test per schema change, forever. | |
| Both | Belt and braces on data you can't afford to lose; highest per-change cost. | |

**User's choice:** Backup, migrate, keep the backup

### Q4 — Is the item activity trail rendered from the event log itself?

| Option | Description | Selected |
|--------|-------------|----------|
| Straight from the event log | Query over `events` by stream. One source of truth, so the trail can't disagree with what a relay replays. Requires payloads designed for human rendering from day one. | ✓ |
| Separate activity table | Denormalised, display-shaped. Fast and free to change; a second history that can drift. | |
| Event log + rendering layer | One log plus a versioned formatter. Same single source; more upfront structure, a formatter to keep current. | |

**User's choice:** Straight from the event log

---

## Claude's Discretion

- **The `estimate` scale** (S/M/L vs Fibonacci) — the user explicitly delegated the size question
  ("I trust your analysis on size") after the story-points discussion.
- **Full-text search mechanics** (SQLite FTS5 vs indexed `LIKE`) and whether search spans projects —
  not discussed.
- **Monorepo and Tauri scaffold scope** — in particular whether the Node sidecar is scaffolded empty
  in Phase 1 or first appears in Phase 2 — not discussed.
- **Item detail surface** (side panel vs full page vs modal), row column set, grouping affordances,
  empty states — not discussed; UI-spec and planning concerns.
- **Project key prefix origin** (derived from repo name vs user-chosen) and whether it is editable
  once items exist.

## Deferred Ideas

- **Sprint / cycle velocity, story-point burndown, time-boxed planning** — CONV-04 in v2; the nullable
  non-aggregated `estimate` is the seam that keeps it additive.
- **Markdown paste-to-import** — considered for day-one bulk loading, rejected for Phase 1 as a
  format + parser + preview UI. Also the natural home for importing an existing GSD `.planning/`
  structure.
- **Kanban column view** — a second surface over the same data, once the dense list is solid.
- **Correcting `RLAY-01` in REQUIREMENTS.md** — a requirements-pass action for a milestone boundary,
  not work for this phase's planner.
