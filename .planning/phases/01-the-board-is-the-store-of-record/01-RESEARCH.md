# Phase 1: The Board Is The Store Of Record - Research

**Researched:** 2026-09-09
**Domain:** Local-first SQLite persistence (event-sourced projection) + Tauri v2/React board UI, greenfield scaffold
**Confidence:** MEDIUM-HIGH (schema/transaction/migration mechanics HIGH — cross-checked against docs.rs and multiple independent sources; UI-library specifics MEDIUM; exact future-relay behavior is a design argument, not something testable today, so tagged MEDIUM)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Board Surface & Navigation**
- **D-01:** The primary board view is a dense, virtualized, Linear-style list grouped by status — not a kanban and not an outline tree. Status changes happen by keystroke, not by drag. A kanban column view is deferred as a possible second surface over the same data.
- **D-02:** Keyboard model is Linear-style: single-letter actions on the selected item plus a ⌘K command palette. Arrow/`j`/`k` to move; single keys for the hot actions (status, edit, create); the palette is the discoverable escape hatch so BOARD-07 coverage is not gated on memorising bindings.
- **D-03:** Search, filter and sort are indexed SQL queries executed by the Rust core, debounced per keystroke; the UI holds only the current result window. There is deliberately no second in-memory filtering implementation in the renderer. Reversibility: costly.
- **D-04:** The Rust core pushes event-log deltas to the UI, which invalidates the affected queries and refetches. The UI must not rely on "refetch after my own mutation." Reversibility: costly.

**Acceptance Criteria**
- **D-05:** A single acceptance criterion is a checkable statement plus a verification hint — a test name, a command, a manual check. Not bare prose, not formal Given/When/Then.
- **D-06:** Acceptance criteria are their own table with their own ULIDs, ordered within their parent, each mutation event-logged and actor-attributed — not a JSON column on the task. Reversibility: one-way.
- **D-07:** Criteria live on tasks and on epics, not on issues. Issues are proposals and notes, not units of work.
- **D-08:** Moving an item to Done with unchecked criteria warns but does not block. The checked/total count is visible wherever the item appears.

**Item Creation, Identity & Ordering**
- **D-09:** Inline quick-add is the creation path — type a title in place, press enter to create at the current position, indent to nest a task under an epic; detail and criteria filled in afterwards.
- **D-10:** Every item carries a human-readable per-project key (`FLY-142`) alongside its ULID — a short project prefix plus a monotonic per-project counter allocated in the same transaction as the insert. Reversibility: one-way.
- **D-11:** Prioritisation is both a manual rank and a priority field. Manual rank uses a fractional index so moving one item rewrites one row rather than renumbering the list. Tie-break rule: priority sorts first, manual rank orders within a priority band. Reversibility: costly.
- **D-12:** Tasks and epics carry a nullable `estimate` (coarse size — S/M/L or 1/2/3/5/8). It is rendered and filterable. Nothing aggregates it.
- **D-13:** `task.epic_id` is nullable — a task may exist without an epic.

**Persistence, Project Registration & Team Topology**
- **D-14:** One fleet-wide SQLite database in the OS app-data directory holds every project — not one database per repository. Reversibility: one-way.
- **D-15:** Each registered repository carries a small committed marker file holding only the project id and key — never board content. Reversibility: one-way.
- **D-16:** The marker is the binding; the stored absolute path is a cached hint. On launch, verify each project's path still holds a repo whose marker matches; if not, mark the project unreachable and offer explicit relocation. Never silently re-bind, never scan the disk to auto-locate.
- **D-17:** `sequence` is NOT a single monotonic counter per project. The event log is keyed per (project, origin) with the ULID carrying global ordering, so a second origin's event stream can interleave later. Reversibility: one-way.
- **D-18:** Migration safety is backup-first, not down-migrations. Copy the database file before every migration run, migrate inside a transaction, retain the last few backups.
- **D-19:** The item activity trail renders straight from the event log — a query over `events` filtered by stream. No separate denormalised activity table. Consequence: event payloads must be designed for human rendering from day one. Reversibility: costly.

**Team & Cloud Topology (cross-cutting)**
- **D-20:** The team model is relay-as-hub, not laptop-as-master. Solo mode is the degenerate case: no relay configured, the local database is the only copy, and DIST-04 still holds.
- **D-21:** `RLAY-01` is wrong as written and must be corrected at the milestone boundary, not silently here — action for the next milestone/requirements pass, not this phase's planner.
- **D-22:** Nothing in Phase 1 depends on the relay existing. ULIDs (DATA-02), the append-only event log with actor attribution (DATA-01, DATA-03), and cursor-resumable reads (DATA-05) are what make a hub possible later. The only two hub-specific consequences for this phase are D-15 and D-17.

### Claude's Discretion
- Size/estimate design (D-12): nullable, non-aggregated `estimate`; the scale itself (S/M/L vs Fibonacci) is open.
- Full-text search mechanics (SQLite FTS5 vs indexed `LIKE`), and whether search spans projects or is per-project — resolve against D-03 and BOARD-06.
- How much of the monorepo and Tauri shell Phase 1 stands up, in particular whether the Node sidecar is scaffolded now (empty) or first appears in Phase 2 — resolve against `ARCHITECTURE.md` §8's `packages/` layout.
- The item detail surface (side panel vs full page vs modal), row column set, grouping affordances and empty states.
- The project key prefix's origin (derived from repo name vs user-chosen) and whether it is editable after items exist.

### Deferred Ideas (OUT OF SCOPE)
- Sprint / cycle velocity, story-point burndown, time-boxed planning (`CONV-04`). Seam: D-12's nullable `estimate`.
- Markdown paste-to-import (nested outline → board items with confirmation preview).
- Kanban column view as a second surface over the same data.
- Correcting `RLAY-01` in `REQUIREMENTS.md` — a requirements-pass action for a milestone boundary, not this phase's planner's work.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Every board mutation is written to an append-only event log in the same transaction as the mutable projection it updates | §"Architecture Patterns → Pattern 1: Transactional Outbox"; `Code Examples → Single-transaction dual-write` |
| DATA-02 | Every entity uses a client-generated ULID, never an auto-incrementing integer | §"Standard Stack" (`ulid` crate); `Code Examples → ID generation` |
| DATA-03 | Every mutation records the actor that made it, humans and agents as distinct actors of one model | §"Architecture Patterns → Actor Model"; schema `actors` table |
| DATA-05 | The event log is readable as an ordered, resumable stream from any point via a cursor | §"Research Flags Resolved → Flag 1"; schema `events`/`event_sequence_counters` |
| DATA-07 | The database survives an unclean application termination without corruption or loss of committed work | §"Research Flags Resolved → Flag 3"; §"Validation Architecture" crash-safety test design |
| DATA-08 | Schema migrations run automatically on launch and are reversible within one version | §"Research Flags Resolved → Flag 5"; §"Common Pitfalls" |
| BOARD-01 | Create/edit/delete epics, tasks, issues in a fixed three-level hierarchy | Schema `epics`/`tasks`/`issues`; §"Architecture Patterns → Recommended Project Structure" |
| BOARD-02 | Structured, discrete, individually checkable acceptance criteria | Schema `acceptance_criteria` table (own ULIDs, per D-06) |
| BOARD-04 | Fixed workflow Backlog → Todo → In Progress → In Review → Done, uncustomisable | `CHECK` constraint on `status` column, enforced at schema level, not app-level convention |
| BOARD-05 | Reorder and reprioritise within an epic and within the backlog | §"Research Flags Resolved → Flag 4"; `fractional_index` crate |
| BOARD-06 | Filter and search by text, status, epic, assignee | §"Architecture Patterns → Pattern 3: FTS5 search"; Open Questions (assignee field) |
| BOARD-07 | Full keyboard navigation and common item actions | §"Architecture Patterns → Recommended Project Structure" (command palette + row actions) |
| BOARD-08 | No perceptible lag at 1,000+ items | §"Research Flags Resolved → Flag 6"; `@tanstack/react-virtual` pattern |
| BOARD-09 | Chronological activity trail: what changed, when, which actor | §"Architecture Patterns → Pattern 2: Activity trail from event log" (D-19) |
| BOARD-10 | Register multiple local git repositories as projects, switch between boards | §"Architecture Patterns → Pattern 4: Project marker & reconciliation" (D-15/D-16) |
</phase_requirements>

## Summary

Phase 1 is a from-scratch scaffold: there is no code today. The concrete engineering problem is narrower than the phase's five success criteria suggest — it is "get one SQLite schema, one transaction pattern, and one virtualized React list right, because three of its structural choices (event-log-as-outbox, actor attribution, fractional ranking) cannot be changed later without a data migration or a broken relay cursor." Everything else (Tauri scaffold, `rusqlite` wiring, `@tanstack/react-virtual`) is well-trodden and low-risk; the schema and transaction shape is where the actual thinking has to happen, and it can be fully designed and load-bearing-tested before a single board row is rendered.

The stack is locked by `.claude/CLAUDE.md` and `.planning/research/STACK.md` (Tauri 2.11.x + `rusqlite` 0.40.x + React + `@tanstack/react-query`/`react-virtual`); this document does not re-argue those choices. It resolves *how*: the exact schema (nine tables, all in scope for this phase), the exact pragma/transaction shape that makes DATA-07 true, the exact fractional-indexing crate and its API, the exact `rusqlite_migration` wiring plus a concrete backup-first test design for DATA-08, and the exact FTS5 + `react-virtual` combination that keeps BOARD-06/BOARD-08 true at 1,000+ items.

**Primary recommendation:** Build one Rust crate (`packages/core`) owning the SQLite connection, WAL pragmas, migrations, and every domain mutation as a `Connection::transaction()` that writes the mutable row and appends to `events` before commit — never call this from two places with two different transaction scopes. Every ID is a ULID (`ulid` crate, `Ulid::new()`), every mutation carries `actor_id`, every list position is a `fractional_index` crate `FractionalIndex` serialized via its `stringify` module into a `TEXT` column. The Tauri shell (`packages/desktop`) never touches SQLite directly — it calls into `packages/core` through Tauri commands and receives `app_handle.emit()` push notifications that TanStack Query treats as cache-invalidation signals (D-04), never as "my own mutation already resolved" optimism.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Board CRUD (epics/tasks/issues/criteria) | API / Backend (Rust core) | — | D-03: no second write/read path; Rust core owns the DB exclusively (STACK.md: "do not use `better-sqlite3`... sidecar should ask the Rust core over IPC") |
| Search / filter / sort | API / Backend (Rust core) | — | D-03 explicit: indexed SQL in the core, no in-memory renderer-side filtering |
| List virtualization / rendering | Browser / Client (React renderer) | — | Pure presentation concern; the core never knows about scroll position |
| Live delta push (event → UI invalidate) | API / Backend → Client | Browser / Client (TanStack Query cache) | D-04: core pushes, UI invalidates and refetches — never trusts its own optimistic write |
| Actor attribution | API / Backend (Rust core) | — | DATA-03: every mutation handler stamps `actor_id` server-side, never trusts a renderer-supplied actor claim |
| Fractional rank / reorder | API / Backend (Rust core) | — | D-11: rank computation needs read-then-write consistency against neighbor rows; must happen inside the same transaction as the move, which only the core can guarantee |
| Migration / backup-on-launch | API / Backend (Rust core, at process start) | — | DATA-08/D-18: runs once, before any UI window exists; belongs to core startup, not a UI-triggered action |
| Project marker verification | API / Backend (Rust core, at launch + on-demand) | — | D-16: filesystem + git read against an absolute path; core owns all fs/git access per `ARCHITECTURE.md` Anti-Pattern 3 |
| Keyboard navigation / command palette | Browser / Client (React renderer) | — | Pure UI-state concern (Zustand-held selection), no persistence per keystroke |

## Research Flags Resolved

The phase notes name six concrete questions. Answered here; supporting detail lives in Architecture Patterns / Code Examples.

### Flag 1 — Can a future relay genuinely subscribe to and replay the event log from a cursor?

Yes, with a two-tier cursor design that D-17 already implies but does not spell out mechanically:

1. **Per-origin resumable cursor (exact, gap-free).** `events.sequence` is a strictly monotonic integer scoped to `(project_id, origin)`, allocated atomically inside the *same transaction* as the row it describes (see `event_sequence_counters` in the schema below, incremented via `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`). Because the sequence is only ever incremented and read inside a committed transaction, a consumer holding cursor `N` for a given `(project, origin)` can always ask:
   ```sql
   SELECT * FROM events
   WHERE project_id = ?1 AND origin = ?2 AND sequence > ?3
   ORDER BY sequence ASC LIMIT 500;
   ```
   This can never have a gap (an uncommitted transaction never produces a row at all) and can never replay a row twice if the consumer stores `max(sequence)` as its new cursor after each batch — this is the resumable, totally-ordered read DATA-05 requires, for a single writer.
2. **Cross-origin merge order.** A relay ingesting from N desktops holds one cursor *per* `(project_id, origin)` pair, not one global cursor — exactly what D-17 requires ("keyed per (project, origin)"). To present or replay a single merged, human-readable timeline across origins, sort the fetched rows by the `events.id` column (a ULID), which is clock-ordered across any writer without cross-machine coordination. This is the standard multi-replica-log pattern: each replica's log is strictly ordered internally; a merge step interleaves replicas by loosely-synchronized wall-clock time. `DATA-05`'s "resumable" requirement is satisfied per-origin (exact); the "ordered" requirement for a multi-origin future is satisfied approximately by ULID sort, which is sufficient for a human-facing activity trail and is the same tradeoff every CRDT-adjacent replicated log makes.
3. **Nothing about this schema is Phase-1-only plumbing that gets thrown away.** The relay's entire integration surface, when it exists, is "read `events` where `(project_id, origin, sequence) > cursor`" — no new table, no CDC tooling, no schema change. `[CITED: microservices.io/patterns/data/transactional-outbox.html, event-driven.io/en/outbox_inbox_patterns_and_delivery_guarantees_explained]`

### Flag 2 — Does actor identity extend to multi-remote without a schema migration?

Yes. `actors` is already a first-class table with a ULID primary key and a `type` enum (`human|agent|system`), exactly as `ARCHITECTURE.md` §7 requires for the team-collaboration seam. The critical design point this research adds: **`origin` (which replica/machine wrote this event) and `actor_id` (which person/agent did it) are orthogonal columns.** A second machine belonging to the same human, or a second human teammate, is simply a new `actor_id` row plus events tagged with a new `origin` value — both are additive INSERTs, never a column rename or type change. `TEAM-01` (multiple humans sharing a board) becomes "insert more actor rows and let the relay merge more origins," which is exactly the additive-not-structural property D-22 asserts. `[ASSUMED — this is an architectural argument built on the schema below, not something externally verifiable; flag for confirmation at the Phase-1-plan review, not a factual claim needing a source.]`

### Flag 3 — Exact SQLite pragmas/transaction shape guaranteeing "force-quit loses no committed change"

On every connection open (pragmas are connection-scoped except `journal_mode`, which persists in the file):
```rust
conn.pragma_update(None, "journal_mode", "WAL")?;      // persists in the DB file itself
conn.pragma_update(None, "synchronous", "NORMAL")?;    // must be re-set on every open
conn.pragma_update(None, "busy_timeout", 5000)?;        // ms; avoids SQLITE_BUSY under the core's own concurrent readers
conn.pragma_update(None, "foreign_keys", "ON")?;        // also connection-scoped, also must be re-set every open
```
`WAL` + `synchronous=NORMAL` is the standard "safe under application/process crash, not safe under OS power-loss" tier: a **committed** transaction is durable across the process being killed (SIGKILL, force-quit, panic) because the OS still flushes the WAL file on its own schedule independent of the crashed process; it is *not* guaranteed durable across a literal power failure between WAL write and checkpoint, which `synchronous=FULL` would cost roughly 2x throughput to close. For a solo-developer desktop app, `NORMAL` is the correct tradeoff — DATA-07's actual failure mode named in the success criteria ("force-quits the application") is an application crash, not a power-cut, and NORMAL already covers it. `[CITED: sqlite.org/pragma.html cross-checked against oneuptime.com and tenthousandmeters.com blog benchmarks confirming WAL+NORMAL survives process/app crash without corruption]`

The transaction shape that makes DATA-01 and DATA-07 compose: every domain mutation opens exactly one `conn.transaction()`, performs every table write (projection row(s), key-counter increment, sequence-counter increment, event row) inside it, and calls `.commit()` once at the very end — see `Code Examples` below. If the process dies before `.commit()` returns, SQLite's own rollback-journal/WAL semantics guarantee the transaction never partially applies; on next open, `PRAGMA integrity_check` and a row-count assertion (used in the Validation Architecture crash-safety test) confirm this holds, rather than trusting the pragma choice alone. `[VERIFIED: cargo installed locally confirms rusqlite 0.40.2 / rusqlite_migration 2.6.0 on crates.io — see Package Legitimacy Audit]`

### Flag 4 — Fractional/lexicographic ranking so reordering 1,000+ items stays O(1) per move

Use the `fractional_index` crate (crates.io `2.0.2`, `github.com/jamsocket/fractional_index`), not a hand-rolled midpoint-string algorithm:
```rust
use fractional_index::FractionalIndex;

// Append to the tail of a status column (new item, or "move to bottom"):
let new_rank = FractionalIndex::new_after(&last_rank_in_column);

// Move between two existing rows (drag target, or "move down one" keystroke):
let new_rank = FractionalIndex::new_between(&prev.rank, &next.rank);
```
`FractionalIndex` values compare via ordinary byte/lexicographic comparison, and the crate's own compatibility guarantee states two values will "compare the same way when deserialized in any other version" of the crate — the property this schema needs since `rank` is a persisted `TEXT` column, not an ephemeral in-memory value. `#[serde(with = "fractional_index::stringify")]` produces the hex-string form suitable for a `TEXT` column and for `ORDER BY rank ASC` to reproduce the exact same order as comparing `FractionalIndex` values in Rust. `[CITED: docs.rs/fractional_index/latest/fractional_index]`

Finding the tail/neighbor rows for a move is one indexed query, not a scan:
```sql
SELECT rank FROM tasks WHERE project_id = ?1 AND status = ?2 ORDER BY rank DESC LIMIT 1;
```
against the `(project_id, status, rank)` composite index below — O(log n), and the move itself is a single-row `UPDATE`, never a renumbering pass over the list. This is the concrete mechanism behind BOARD-05 and BOARD-08 composing at 1,000+ items.

### Flag 5 — `rusqlite_migration` wiring + how migration safety is tested

Migrations are plain SQL files embedded at compile time and tracked via SQLite's built-in `user_version` integer (not a hand-rolled migrations table):
```rust
static MIGRATIONS: once_cell::sync::Lazy<Migrations<'static>> = once_cell::sync::Lazy::new(|| {
    Migrations::new(vec![
        M::up(include_str!("migrations/0001_initial_schema.sql")),
        // M::up(include_str!("migrations/0002_....sql")),  // future migrations append here
    ])
});

pub fn open_and_migrate(db_path: &Path, backups_dir: &Path) -> anyhow::Result<Connection> {
    backup_database_file(db_path, backups_dir)?;    // D-18: copy BEFORE migrating, retain last N
    let mut conn = Connection::open(db_path)?;
    apply_pragmas(&mut conn)?;
    MIGRATIONS.to_latest(&mut conn)?;               // each pending migration runs inside its own transaction
    Ok(conn)
}
```
Each individual migration statement set runs inside its own transaction (do not call `PRAGMA foreign_keys` from inside a migration body — it is a documented no-op there). `[CITED: docs.rs/rusqlite_migration]` `DATA-08`'s "reversible within one version" is delivered as a **file restore**, not down-migrations: `backup_database_file` copies the pre-migration `.db` file to `backups_dir/pre-migration-{schema_version}-{timestamp}.db` before `to_latest()` runs; if `to_latest()` returns an error, the caller restores the backup and refuses to open the (possibly half-migrated) live file. **Test design** (also in Validation Architecture): build a fixture database at schema version N-1 (a checked-in `.db` file or a script that runs migrations 1..N-1 only), run `open_and_migrate`, assert the resulting `user_version` and a `SELECT` against a table/column introduced by migration N both succeed, and assert existing rows from the N-1 fixture are unchanged. A second test intentionally supplies a malformed migration N (bad SQL) against the same fixture, asserts `to_latest()` errors, and asserts the pre-migration backup file byte-matches the original fixture — proving the "reversible within one version" property is a restore, not a hope.

### Flag 6 — Virtualized rendering + indexed queries keeping search/filter/reorder imperceptible at 1,000+ items

Three things compose, each already independently decided:
1. **The core never sends more than a result window.** D-03: the Rust core executes the indexed query (composite indexes on `(project_id, status, rank)` and the FTS5 virtual table for text) and returns a page/window, not all 1,000+ rows on every keystroke.
2. **The renderer virtualizes that window.** `@tanstack/react-virtual`'s `useVirtualizer` needs `count`, `estimateSize`, `getScrollElement`, and — because board rows are not fixed-height (title wraps, criteria-count badge, etc.) — a `measureElement` ref callback plus `overscan`; rows are absolutely positioned via `transform: translateY()`, not native `<table>` layout, which does not compose with independently-measured variable-height virtual rows. `[CITED: tanstack.com/virtual/v3/docs/framework/react/examples/dynamic]`
3. **Debounce at the query boundary, not the render boundary.** D-03 already specifies "debounced per keystroke" — the debounce belongs in the hook issuing the Tauri `invoke` call (e.g. 150-200ms), not in the virtualization layer, which should always render whatever window it currently has instantly.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rusqlite` | 0.40.2 (`bundled` feature) `[VERIFIED: cargo search rusqlite, run locally]` | Embedded SQLite in the Rust core | Locked by `.claude/CLAUDE.md`; `bundled` vendors SQLite 3.53.1 `[CITED: docs.rs/crate/libsqlite3-sys/latest]`, well past the 3.35 baseline `RETURNING` requires |
| `rusqlite_migration` | 2.6.0 `[VERIFIED: cargo search rusqlite_migration, run locally]` | Versioned schema migrations via `user_version` | Locked by `.claude/CLAUDE.md`; no hand-rolled migrations table |
| `ulid` | 3.0.0 (`dylanhart/ulid-rs`) `[VERIFIED: cargo search ulid, run locally]` | Client-generated globally-unique sortable IDs (DATA-02) | Most widely used Rust ULID crate (1.04M weekly downloads); ships a monotonic `Generator` for same-millisecond ordering |
| `fractional_index` | 2.0.2 (`jamsocket/fractional_index`) `[VERIFIED: cargo search fractional_index, run locally]` | Manual rank / reorder key (D-11, BOARD-05) | Byte-comparable, forward/backward-compatible serialization designed exactly for this persisted-key use case `[CITED: docs.rs/fractional_index]` |
| Tauri | 2.11.4 (CLI) `[VERIFIED: npm view @tauri-apps/cli version, run locally]` | Desktop shell | Locked by `.claude/CLAUDE.md`; project-level decision, not re-argued here |
| React + Vite (via `create-tauri-app` `react-ts` template) | current `create-tauri-app` template | Renderer | Locked by `.claude/CLAUDE.md` |
| `@tanstack/react-query` | 5.102.8 `[VERIFIED: npm view, run locally]` | Client-side cache/query layer for the Tauri IPC seam | Locked by `.claude/CLAUDE.md`; the adapter-swap seam for a future web/relay client |
| `@tanstack/react-virtual` | 3.14.11 `[VERIFIED: npm view, run locally]` | Virtualized board list (BOARD-08) | Locked by `.claude/CLAUDE.md`; headless model gives full control over the dense row layout D-01 needs |
| Zustand | 5.0.15 `[VERIFIED: npm view, run locally]` | Local UI state (selection, palette open/closed, filter draft) | Locked by `.claude/CLAUDE.md`; keeps UI state out of TanStack Query's server-state cache |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `once_cell` | current | `Lazy` static for the compiled `Migrations` list | Standard pattern for a static built once from `include_str!` migration files |
| `serde` / `serde_json` | current (already implied by `rusqlite`'s `serde` feature per STACK.md's `cargo add rusqlite --features bundled,serde,chrono`) | Event `payload` JSON encode/decode | Event payloads must be human-renderable JSON per D-19 |
| SQLite FTS5 (built into the `bundled` SQLite, no extra crate) | vendored w/ SQLite 3.53.1 | Text search across title/description (BOARD-06) | Resolves the "Claude's Discretion" search-mechanics question in favor of FTS5 over `LIKE` — see Architecture Patterns |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fractional_index` crate | Hand-rolled base62 midpoint string algorithm | The algorithm is genuinely small (~30 lines), but the crate's documented byte-representation *compatibility guarantee across crate versions* is exactly the property a persisted, indexed `TEXT` column needs and a hand-rolled version would have to re-derive and re-test itself; not worth the hand-roll for a 5.9k-weekly-download crate with a matching problem shape |
| SQLite FTS5 | Indexed `LIKE '%term%'` | `LIKE` with a leading wildcard cannot use a B-tree index and degrades to a full scan; at 1,000+ items this risks BOARD-08's "no perceptible lag" on every keystroke. FTS5 is built into the already-bundled SQLite at zero extra dependency cost |
| `ulid` crate | UUIDv7 (`uuid` crate `v7` feature) | Both are time-sortable and client-generatable; `ulid` was already the crate named in `ARCHITECTURE.md`/`STACK.md`'s prior research and has a purpose-built monotonic `Generator`, so there is no reason to switch mid-project |

**Installation:**
```bash
# Desktop shell scaffold (creates packages/desktop)
npm create tauri-app@latest -- --template react-ts

# Rust core crate (packages/core) dependencies
cargo add rusqlite --features bundled,serde,chrono
cargo add rusqlite_migration
cargo add ulid --features serde
cargo add fractional_index --features serde
cargo add once_cell
cargo add anyhow

# Frontend (packages/desktop)
npm install @tanstack/react-query @tanstack/react-virtual zustand
```

**Version verification:** All versions above were confirmed live against the local toolchain and the npm/crates.io registries during this research session (`cargo search <crate>`, `npm view <package> version`) — see inline `[VERIFIED]` tags. Training-data version numbers were treated as stale until reconfirmed.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `rusqlite` | crates | since 2014 | 2.56M/wk | github.com/rusqlite/rusqlite | OK | Approved |
| `rusqlite_migration` | crates | since 2020 | 163K/wk | github.com/cljoly/rusqlite_migration | OK | Approved |
| `ulid` | crates | since 2017 | 1.04M/wk | github.com/dylanhart/ulid-rs | OK | Approved |
| `fractional_index` | crates | since 2021 | 5.9K/wk | github.com/jamsocket/fractional_index | OK | Approved |
| `tauri` | crates | since 2019 | 888K/wk | github.com/tauri-apps/tauri | OK | Approved |
| `@tanstack/react-virtual` | npm | long-standing (TanStack) | 20.9M/wk | github.com/TanStack/virtual | SUS (`too-new`) | Approved — see note below; planner should add a `checkpoint:human-verify` per protocol, but this is very likely a false positive |
| `@tanstack/react-query` | npm | long-standing (TanStack) | 55.4M/wk | github.com/TanStack/query | SUS (`too-new`) | Approved — see note below |
| `zustand` | npm | long-standing (pmndrs) | 49.3M/wk | github.com/pmndrs/zustand | SUS (`too-new`) | Approved — see note below |

**Note on the three `SUS (too-new)` verdicts:** the legitimacy seam's `too-new` signal is keyed off `publishedAt`, which for these packages reflects the most recent *version release* (all three ship frequent minor/patch releases), not the package's actual registry inception (all three are multi-year, tens-of-millions-of-weekly-download projects with long, well-known GitHub histories). This is a heuristic false positive, not a genuine slopsquat/hallucination signal — but per the Package Legitimacy Gate protocol the disposition is recorded as-flagged rather than silently overridden, so the planner should still insert a lightweight `checkpoint:human-verify` before the `npm install` step for these three, even though the risk here is judged negligible.

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `@tanstack/react-virtual`, `@tanstack/react-query`, `zustand` — see note above; no genuine slopsquat risk identified, checkpoint retained per protocol.

### Human Verification — Task 1 Gate Cleared (2026-09-09)

The `gate="blocking-human"` checkpoint in `01-01-PLAN.md` Task 1 was cleared by the human ("approved"),
supported by registry evidence gathered before approval:

| Package | First published | Repository | Versions | Maintainers |
|---|---|---|---|---|
| `@tanstack/react-query` | 2022-07-19 | `git+https://github.com/TanStack/query.git` | 532 | tannerlinsley, alemtuzlak, kevinvandy |
| `@tanstack/react-virtual` | 2022-02-07 | `git+https://github.com/TanStack/virtual.git` | 136 | tannerlinsley, alemtuzlak, kevinvandy |
| `zustand` | 2019-04-09 | `git+https://github.com/pmndrs/zustand.git` | 158 | daishi, jeremyrh, drcmda |

**Conclusion:** all three show multi-year publish histories, repositories matching the expected
upstream projects, and expected maintainer accounts. The `SUS (too-new)` heuristic keyed on
latest-release date rather than registry inception — confirmed false positive, no slopsquat signal.
Installation authorized.

## Architecture Patterns

### System Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│  RENDERER (React, packages/desktop/src)                                │
│  BoardView (virtualized list) ── ItemDetailPanel ── CommandPalette      │
│        │  invoke("task_create", …)         ▲  listen("board:changed")  │
└────────┼─────────────────────────────────────┼─────────────────────────┘
         │ Tauri IPC (adapters/tauri.ts — the single seam)               │
┌────────▼─────────────────────────────────────┼─────────────────────────┐
│  TAURI CORE PROCESS (Rust, packages/desktop/src-tauri)                  │
│  #[tauri::command] handlers ── call into packages/core ─────────────────┘
│        │                                        │ app_handle.emit()
┌────────▼────────────────────────────────────────┴──────────────────────┐
│  DOMAIN CRATE (packages/core)                                          │
│  1. open_and_migrate() at startup: backup file → apply pragmas →       │
│     rusqlite_migration::to_latest()                                    │
│  2. Every mutation: conn.transaction() → write projection row(s) →     │
│     increment key_counter → increment event_sequence_counter →         │
│     append events row → commit() → emit("board:changed")               │
│  3. Every read (list/search/filter): indexed SELECT or FTS5 MATCH,     │
│     debounced at the calling hook, returns a bounded result window     │
└────────┬─────────────────────────────────────────────────────────────--┘
         │ single rusqlite::Connection behind Mutex<Connection>
┌────────▼─────────────────────────────────────────────────────────────--┐
│  SQLite file, WAL mode, in the OS app-data directory (D-14: ONE file    │
│  for the whole fleet, not one per project)                              │
└──────────────────────────────────────────────────────────────────────--┘

External: each registered project's git repo carries a committed marker
file (D-15) that packages/core reads/verifies against the DB's cached
repo_path at launch (D-16) — never inside the SQLite file itself.
```

### Recommended Project Structure

```
packages/
├── core/                          # OSS domain crate — owns the DB exclusively
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── db/
│   │   │   ├── mod.rs             # open_and_migrate(), apply_pragmas()
│   │   │   ├── backup.rs          # D-18 copy-before-migrate + retention
│   │   │   └── migrations/
│   │   │       └── 0001_initial_schema.sql
│   │   ├── ids.rs                 # Ulid::new() wrapper, monotonic Generator
│   │   ├── ranking.rs             # FractionalIndex helpers (new_after/new_between)
│   │   ├── domain/
│   │   │   ├── actor.rs
│   │   │   ├── project.rs
│   │   │   ├── epic.rs
│   │   │   ├── task.rs
│   │   │   ├── issue.rs
│   │   │   ├── acceptance_criterion.rs
│   │   │   └── event.rs           # append_event(), stream queries for activity trail
│   │   └── marker.rs              # D-15/D-16 project marker read/verify
│   └── tests/
│       ├── crash_safety.rs        # spawns crash_harness, asserts post-crash integrity
│       ├── migration_safety.rs    # Flag 5 test design
│       └── bin/
│           └── crash_harness.rs   # separate binary target, deliberately aborts mid-tx
├── desktop/                       # OSS Tauri shell + React renderer
│   ├── src-tauri/
│   │   ├── Cargo.toml             # depends on `core` via path
│   │   ├── capabilities/          # default-deny manifest — scope narrowly (Security Domain)
│   │   └── src/
│   │       ├── main.rs
│   │       ├── state.rs           # AppState { db: Mutex<Connection> }, .manage()
│   │       └── commands/          # #[tauri::command] handlers, one module per entity
│   ├── src/
│   │   ├── main.tsx / App.tsx
│   │   ├── adapters/
│   │   │   └── tauri.ts           # THE single invoke/listen seam (CLAUDE.md phase-1 requirement)
│   │   ├── board/
│   │   │   ├── BoardView.tsx      # useVirtualizer, grouped-by-status dense list (D-01)
│   │   │   ├── BoardRow.tsx
│   │   │   ├── CommandPalette.tsx # ⌘K (D-02)
│   │   │   ├── QuickAdd.tsx       # inline create (D-09)
│   │   │   └── useBoardQuery.ts   # react-query hooks wrapping adapters/tauri.ts, debounced
│   │   ├── item-detail/
│   │   │   ├── ItemDetailPanel.tsx
│   │   │   ├── AcceptanceCriteriaList.tsx
│   │   │   └── ActivityTrail.tsx  # BOARD-09, queries the events stream
│   │   └── state/
│   │       └── uiStore.ts         # Zustand: selection, palette/panel open state, filter draft
│   └── package.json
└── relay-client/                  # OSS, inert placeholder (Claude's Discretion — scaffold now,
                                    #  empty, to keep the module boundary real from commit 1;
                                    #  see Open Questions)
```

### Pattern 1: Transactional Outbox (DATA-01, DATA-07)

**What:** Every domain mutation opens exactly one `rusqlite::Transaction`, writes the mutable projection row(s) and appends an `events` row inside it, and commits once.
**When to use:** Every write path in `packages/core`, with no exception — including the acceptance-criteria checkbox toggle and the project-key counter increment.
**Example:**
```rust
// Source: pattern synthesized from rusqlite::Transaction docs (docs.rs/rusqlite/latest/rusqlite/struct.Transaction.html)
// and rusqlite_migration's transaction-per-migration model (docs.rs/rusqlite_migration)
pub fn create_task(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    epic_id: Option<&str>,
) -> anyhow::Result<Task> {
    let tx = conn.transaction()?;

    let id = Ulid::new().to_string();
    let last_rank: Option<String> = tx.query_row(
        "SELECT rank FROM tasks WHERE project_id = ?1 AND status = 'backlog' ORDER BY rank DESC LIMIT 1",
        params![project_id],
        |r| r.get(0),
    ).optional()?;
    let rank = match last_rank {
        Some(r) => FractionalIndex::new_after(&FractionalIndex::from_stringify(&r)?),
        None => FractionalIndex::default(),
    };

    // Atomically allocate the human-readable key in the same transaction (D-10)
    let key: String = tx.query_row(
        "UPDATE projects SET key_counter = key_counter + 1
         WHERE id = ?1 RETURNING key_prefix || '-' || key_counter",
        params![project_id], |r| r.get(0),
    )?;

    tx.execute(
        "INSERT INTO tasks (id, project_id, epic_id, key, title, status, rank, created_by)
         VALUES (?1, ?2, ?3, ?4, 'backlog', to_stringify(?5), ?6)",
        params![id, project_id, epic_id, key, rank.stringify(), actor_id],
    )?;

    // Allocate this origin's next sequence number in the same transaction (D-17)
    let sequence: i64 = tx.query_row(
        "INSERT INTO event_sequence_counters(project_id, origin, next_seq) VALUES (?1, 'local', 2)
         ON CONFLICT(project_id, origin) DO UPDATE SET next_seq = next_seq + 1
         RETURNING next_seq - 1",
        params![project_id], |r| r.get(0),
    )?;

    let event_id = Ulid::new().to_string();
    let payload = serde_json::json!({ "field": "status", "before": null, "after": "backlog", "title": title });
    tx.execute(
        "INSERT INTO events (id, project_id, origin, sequence, stream_type, stream_id, task_id, actor_id, event_type, payload)
         VALUES (?1, ?2, 'local', ?3, 'task', ?4, ?4, ?5, 'task.created', ?6)",
        params![event_id, project_id, sequence, id, actor_id, payload.to_string()],
    )?;

    tx.commit()?; // single fsync-relevant boundary; see pragmas in Flag 3
    Ok(Task { id, key, title: title.into(), status: "backlog".into(), rank: rank.stringify(), .. })
}
```

### Pattern 2: Activity trail rendered straight from the event log (BOARD-09, D-19)

**What:** No denormalised activity table. `events` carries denormalized nullable `task_id`/`epic_id` columns (populated at write time, even for `acceptance_criterion`-stream events whose parent is a task) so a single indexed query serves the trail.
**When to use:** Item-detail panel activity trail; also the exact query a future relay-side reconstruction or a "replay from any cursor" tool would run.
**Example:**
```sql
-- Source: schema design derived from D-19 ("query over events filtered by stream")
SELECT id, actor_id, event_type, payload, occurred_at
FROM events
WHERE task_id = ?1
ORDER BY id ASC;   -- id is a ULID: chronological by construction, no separate timestamp sort needed
```

### Pattern 3: FTS5 external-content search kept in sync by triggers (BOARD-06)

**What:** An `fts5` virtual table with `content=<table>` mirrors `title`/`description`; three triggers (`AFTER INSERT/UPDATE/DELETE`) keep it in sync, since external-content FTS5 tables do not auto-update.
**When to use:** Any text search across tasks/epics/issues. Resolves the "Claude's Discretion" search-mechanics question in favor of FTS5 (see Alternatives Considered).
**Example:**
```sql
-- Source: pattern cross-checked against SQLite forum guidance on external-content FTS5 sync
CREATE VIRTUAL TABLE tasks_fts USING fts5(title, description, content=tasks, content_rowid=rowid);

CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
-- Query:
SELECT tasks.* FROM tasks JOIN tasks_fts ON tasks.rowid = tasks_fts.rowid
WHERE tasks_fts MATCH ?1 AND tasks.project_id = ?2;
```
Note: `tasks.id` is declared `TEXT PRIMARY KEY`, which is *not* the `INTEGER PRIMARY KEY` rowid alias — the table still has an ordinary hidden `rowid`, so `content_rowid=rowid` is valid without declaring the table `WITHOUT ROWID`.

### Pattern 4: Project marker + reconciliation, never silent re-bind (BOARD-10, D-15/D-16)

**What:** Each registered repository gets a small committed file (recommend `.flywheel/project.json` at repo root, containing only `{"project_id": "<ulid>", "project_key": "FLY"}`). On registration, if the file already exists (repo cloned from a machine where it was previously registered), reuse its `project_id`; otherwise generate one. On launch, for every known project: read the marker at the DB's cached `repo_path`; if missing or its `project_id` mismatches, set `projects.status = 'unreachable'` and surface it — never silently rewrite `repo_path` and never scan the disk to find where the repo went.
**When to use:** Project registration flow and app-launch reconciliation.
```
[ASSUMED] The exact marker filename/path (`.flywheel/project.json`) is this research's
recommendation, not a decision recorded in CONTEXT.md — flagged in Open Questions for
planner/user confirmation, since D-15 fixes the *existence and content* of the marker
but not its literal path.
```

### Anti-Patterns to Avoid
- **Two write paths to the same tables:** per D-03/ARCHITECTURE.md, only `packages/core` ever executes a mutating SQL statement. A future Node sidecar (Phase 2+) must ask the Rust core over IPC, never open the SQLite file itself — this is already decided in `STACK.md`'s "What NOT to Use" table and applies from Phase 1's first migration onward.
- **Treating `events.sequence` as a single per-project counter:** breaks the instant a second `origin` exists (D-17). Always key the counter and the uniqueness index by `(project_id, origin)`.
- **Nested `rusqlite` transactions:** `conn.transaction()` requires `&mut Connection` specifically to prevent this; structure mutation functions so every step happens inside one outer `Transaction`, never call a function that itself opens `conn.transaction()` from inside another transaction's scope.
- **`process.chdir()` / implicit cwd git or fs calls anywhere in `packages/core`:** per `ARCHITECTURE.md` Anti-Pattern 3, every filesystem/git call (including marker-file reads) takes an explicit absolute path from a DB-cached `repo_path`, never `process.cwd()` or an inherited working directory.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reorderable list positions | A custom midpoint-string or integer-gap algorithm | `fractional_index` crate | Byte-comparable, documented cross-version compatibility guarantee for a column you will persist and index for the life of the product |
| Unique sortable IDs | Timestamp+random string concatenation | `ulid` crate (with monotonic `Generator`) | Handles same-millisecond ordering correctly; a hand-rolled version reliably gets sort-stability wrong under bulk inserts |
| Schema version tracking | A hand-written `schema_migrations` table + manual DDL runner | `rusqlite_migration` (`user_version` pragma) | Already the project-locked choice; avoids reinventing transaction-per-migration semantics |
| Full-text search | App-side substring scan / regex over loaded rows | SQLite FTS5 (built into the already-bundled SQLite) | Zero extra dependency; `LIKE '%term%'` cannot use an index and will violate BOARD-08's "no perceptible lag" at 1,000+ rows |
| List virtualization | Manual scroll-offset math + row recycling | `@tanstack/react-virtual` | Locked stack choice; a hand-rolled version reliably mishandles variable-height rows and overscan |

**Key insight:** every item in this table is a case where the "custom" version isn't just more code — it's more code with a subtly wrong edge case (fractional-index rebalancing, ULID same-millisecond collisions, FTS5 index staleness) that a maintained library already tests for. None of these are hand-rolled anywhere in this schema.

## Common Pitfalls

### Pitfall 1: Forgetting pragmas are connection-scoped, not database-scoped
**What goes wrong:** `synchronous=NORMAL`, `busy_timeout`, and `foreign_keys=ON` silently revert to SQLite defaults (`FULL`, `0`, `OFF`) on every new connection unless re-applied — only `journal_mode=WAL` persists in the file itself.
**Why it happens:** Developers set pragmas once during initial setup and assume they "stick" like `journal_mode` does.
**How to avoid:** Apply all four pragmas inside `apply_pragmas()`, called on every `Connection::open()`, not just the first one.
**Warning signs:** Silent referential-integrity violations (rows referencing deleted actors) despite `REFERENCES` clauses in the schema — a sign `foreign_keys` reverted to off.

### Pitfall 2: `events.sequence` treated as globally monotonic instead of per-origin
**What goes wrong:** A single counter looks correct with one writer (v1, solo mode) and silently breaks the moment a second origin (a teammate's machine, a relay-originated replay) exists, because two origins would collide on the same sequence values.
**Why it happens:** It is the simpler design and passes every Phase-1 test, since Phase 1 only ever has one origin.
**How to avoid:** Key the counter table and the uniqueness index by `(project_id, origin)` from the first migration (D-17), even though `origin` is always `'local'` until Phase 2+.
**Warning signs:** A migration or refactor that references `events.sequence` without an accompanying `origin` filter.

### Pitfall 3: FTS5 external-content table drifting silently
**What goes wrong:** A future bulk-import or backfill script writes directly to `tasks` bypassing the ORM-level insert path, and the FTS index silently stops matching those rows (no error is raised).
**Why it happens:** External-content FTS5 tables require the *application*, not SQLite, to keep them synchronized; only the three triggers do that, and any write path that bypasses normal `INSERT`/`UPDATE`/`DELETE` (e.g. `.import`) also bypasses the triggers.
**How to avoid:** Never write to `tasks`/`epics`/`issues` except through `packages/core`'s mutation functions (already required by D-03); if a bulk path is ever added, follow it with `INSERT INTO tasks_fts(tasks_fts) VALUES ('rebuild')`.

### Pitfall 4: Assuming every task has an epic
**What goes wrong:** Epic-scoped board views or reports written with an implicit inner join on `epic_id` silently drop orphan tasks (D-13 makes `epic_id` nullable by design).
**Why it happens:** Most PM-tool schemas make the epic relationship mandatory, so this is an easy default to reach for.
**How to avoid:** Every task list query must explicitly decide how to treat `epic_id IS NULL` (include in an "unassigned" bucket, or exclude with a stated reason) — never a bare `JOIN epics`.

### Pitfall 5: `FractionalIndex` key growth under adversarial repeated inserts at one boundary
**What goes wrong:** Always inserting/moving to the exact same boundary (e.g., a script that always "moves to top") grows the rank string without bound over many operations.
**Why it happens:** Fractional indexing's fundamental tradeoff — unbounded insert-at-the-same-point grows key length, in exchange for O(1) writes everywhere else.
**How to avoid:** Not urgent at Phase-1 MVP scale (1,000 items, human-paced reordering); note as a watch item for a future background rebalance job, do not build one now.

## Code Examples

### ID generation (DATA-02)
```rust
// Source: docs.rs/ulid (dylanhart/ulid-rs) — cross-checked via crates.io search, VERIFIED locally installed
use ulid::Ulid;
let id: String = Ulid::new().to_string(); // lexicographically sortable, 128-bit, no coordination needed
```

### Fractional rank stringification (D-11, Flag 4)
```rust
// Source: docs.rs/fractional_index — WebFetch-confirmed API surface
use fractional_index::FractionalIndex;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
struct Rank(#[serde(with = "fractional_index::stringify")] FractionalIndex);
// Rank serializes to a hex string whose lexicographic order matches FractionalIndex's Ord —
// safe to store in a TEXT column and ORDER BY directly.
```

### Tauri command + push-invalidate (D-04)
```rust
// Source: pattern cross-checked against v2.tauri.app/develop/state-management/ via web search
#[tauri::command]
fn task_set_status(state: tauri::State<AppState>, app: tauri::AppHandle, task_id: String, new_status: String, actor_id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    core::domain::task::set_status(&mut conn, &task_id, &new_status, &actor_id).map_err(|e| e.to_string())?;
    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id })).ok();
    Ok(())
}
```
```ts
// packages/desktop/src/adapters/tauri.ts — the single seam
import { listen } from "@tauri-apps/api/event";
import { queryClient } from "./queryClient";

listen("board:changed", () => {
  queryClient.invalidateQueries({ queryKey: ["board"] }); // never trust the caller's own optimistic write
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full event sourcing (replay all events to derive current state) | CQRS-lite transactional outbox: mutable projection + append-only log written in one transaction | Standing pattern, not a recent shift — restated here because it's easy to over-engineer toward full event sourcing given "event log" language | Reads stay simple relational queries against `tasks`/`epics`/`issues`; the event log exists for audit/sync, not as the query interface |
| Auto-incrementing integer primary keys | Client-generated ULIDs | Standing best practice for any eventually-multi-writer system | No collision risk when a second machine/relay starts writing later (D-22) |
| Integer position column + full-list renumber on reorder | Fractional/lexicographic rank string | Standing pattern (Figma 2017, Jira LexoRank) | O(1) writes per reorder instead of O(n) |

**Deprecated/outdated:** none specific to this phase — the domain is new, not a migration off a prior approach.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | **RESOLVED 2026-09-09 (01-11-PLAN.md Task 1, owner decision `dot-dir-json`):** The project marker file lives at `.flywheel/project.json` (path/filename), JSON via `serde_json`, committed (never `.gitignore`d) — confirming this research's own recommendation exactly, before the first real marker was written to a repository. Accepted cost, recorded honestly rather than presented as free: JSON carries no comment, so the marker cannot explain itself to a teammate who finds it in a clone with no Flywheel context, and D-15's "id and key, nothing else" rule forbids adding a field to carry that explanation instead — TOML (the alternative that could add a comment) was shown to the owner and declined in favor of `serde_json` already being in the dependency graph. See `packages/core/src/marker.rs`'s module doc comment for the as-built record. | Architecture Patterns → Pattern 4 | Low — purely a naming choice; changing it before any repo has been registered costs nothing, changing it after is a one-way door per D-15's own reversibility note. **No longer live risk: resolved before any repository carried a marker.** |
| A2 | Cross-origin merge ordering for a future relay is "good enough" via ULID clock-sort rather than a stronger causal-ordering scheme (vector clocks, Lamport timestamps) | Research Flags Resolved → Flag 1 | Medium — if the relay's actual UX needs strict causal ordering across concurrent edits on two machines (not just a human-readable activity feed), this may need revisiting at the relay milestone; does not block Phase 1, which has exactly one origin |
| A3 | `assignee_id` (nullable FK to `actors`) must be added to `tasks` (and possibly `epics`) to make BOARD-06's "filter by assignee" requirement meaningful in solo v1 | Open Questions | Medium — if omitted, BOARD-06 as literally worded cannot be satisfied; CONTEXT.md's decisions do not mention an assignee field, so this is this research's inference, not a locked decision |
| A4 | `packages/relay-client` should be scaffolded now as an empty placeholder package, not deferred to a later phase | Architecture Patterns → Recommended Project Structure | Low — CONTEXT.md left this as "Claude's Discretion"; an empty package costs nothing and keeps the CI module-boundary check meaningful from commit 1, but the planner may reasonably choose to defer it |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Where does `assignee_id` come from, and is it in scope for Phase 1's schema?**
   - What we know: BOARD-06 literally requires filtering by "assignee." CONTEXT.md's decisions cover status/priority/rank/estimate but never mention an assignee field.
   - What's unclear: Whether this was an oversight in CONTEXT.md or a deliberate omission (single-user v1, so "assignee" may have been read as out-of-scope until TEAM-02 in v2).
   - Recommendation: Add a nullable `assignee_id REFERENCES actors(id)` to `tasks` now (cheap, additive, matches the `actors`-table-exists-from-day-one pattern already used for `created_by`); the planner should confirm this reading against BOARD-06's literal text before finalizing the schema migration.

2. **RESOLVED 2026-09-09 (01-11-PLAN.md Task 1, a `checkpoint:decision`, option `dot-dir-json`).
   Exact project-marker file path and format.**
   - What we know: D-15 fixes content (project id + key only, never board content) and the reversibility risk (one-way once repos are cloned with it).
   - What was unclear before this decision: Literal filename/location — `.flywheel/project.json` vs a dotfile at root vs something else.
   - **Resolution:** `.flywheel/project.json`, JSON via `serde_json` (no new dependency — `serde_json` was already present for event payloads), committed rather than `.gitignore`d. Confirmed by the owner before the first marker was ever written to a real repository, exactly as this research recommended doing. Rationale recorded in full in `01-11-SUMMARY.md` and in `packages/core/src/marker.rs`'s module doc comment; the accepted cost (JSON cannot carry an explanatory comment, and D-15 forbids adding a field to substitute for one) is recorded there rather than presented as free.

3. **Command palette / keyboard-action library.**
   - What we know: D-02 specifies the interaction model (single-letter actions + ⌘K palette), not an implementation library.
   - What's unclear: Whether to hand-roll the palette (small, ~200 LOC, full design control) or adopt `cmdk` (the de facto React command-palette library, MIT-licensed, unverified in this session).
   - Recommendation: Flag for the planner; not researched deeply here since it's UI-implementation detail rather than a structural seam, and CONTEXT.md marks item-detail/UI specifics as "Claude's Discretion" generally.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (`rustc`/`cargo`) | Tauri core, `packages/core` | ✓ | 1.96.0 | — |
| Node.js | `create-tauri-app` scaffold, frontend build | ✓ | 22.22.3 | — |
| npm | Package installs | ✓ | 10.9.8 | — |
| git CLI | Worktree/marker-file reads (Phase 2+, but repo itself needs git now) | ✓ | 2.50.1 (≥ 2.44 required per STACK.md) | — |
| system `sqlite3` CLI | Developer convenience only (inspecting the `.db` file by hand); not a runtime dependency since `rusqlite`'s `bundled` feature vendors its own SQLite | ✓ | 3.51.0 | Not required — `bundled` feature makes this irrelevant to the build |
| Xcode Command Line Tools | Compiling `bundled` SQLite + Rust native deps on macOS | ✓ | present at `/Library/Developer/CommandLineTools` | — |
| macOS code-signing identity | Distribution builds (DIST-01, Phase 11 — not this phase) | ✗ | — | Not blocking: Phase 1 only needs unsigned dev builds (`tauri dev`); signing is explicitly a Phase 11 concern per `STATE.md`'s blockers list |

**Missing dependencies with no fallback:** none for this phase.
**Missing dependencies with fallback:** macOS code-signing identity — irrelevant until Phase 11; dev builds run unsigned via `tauri dev`/`tauri build --debug`.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust core, built-in, no extra crate) + Vitest 5.x (React/TS, not yet installed — Wave 0) |
| Config file | none yet — Wave 0 creates `packages/core`'s Cargo test targets and `packages/desktop/vitest.config.ts` |
| Quick run command | `cargo test -p core` (Rust) / `npx vitest run` (frontend) |
| Full suite command | `cargo test --workspace && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | Mutation writes projection + event in one transaction | unit (Rust) | `cargo test -p core outbox::` | ❌ Wave 0 |
| DATA-02 | Every entity ID is a ULID, not autoincrement | unit (Rust) | `cargo test -p core ids::ulid_format` | ❌ Wave 0 |
| DATA-03 | Every mutation/event row carries `actor_id` | unit (Rust) | `cargo test -p core domain::actor_attribution` | ❌ Wave 0 |
| DATA-05 | Cursor read is resumable and ordered | integration (Rust) | `cargo test -p core events::cursor_resume` | ❌ Wave 0 |
| DATA-07 | Force-quit mid-transaction loses no committed change | integration (Rust, spawns `crash_harness` binary + SIGKILL/abort) | `cargo test -p core --test crash_safety` | ❌ Wave 0 |
| DATA-08 | Migration runs automatically, backup-first, restorable | integration (Rust) | `cargo test -p core --test migration_safety` | ❌ Wave 0 |
| BOARD-01 | CRUD epics/tasks/issues in fixed hierarchy | unit (Rust) | `cargo test -p core domain::{epic,task,issue}::crud` | ❌ Wave 0 |
| BOARD-02 | Discrete, individually-checkable acceptance criteria | unit (Rust) | `cargo test -p core domain::acceptance_criterion` | ❌ Wave 0 |
| BOARD-04 | Fixed workflow, DB-level `CHECK` rejects invalid status | unit (Rust) | `cargo test -p core schema::status_check_constraint` | ❌ Wave 0 |
| BOARD-05 | Reorder within epic/backlog is O(1) per move | unit (Rust) | `cargo test -p core ranking::reorder_single_row` | ❌ Wave 0 |
| BOARD-06 | Filter/search by text/status/epic/assignee | integration (Rust) | `cargo test -p core --test search_filter` | ❌ Wave 0 |
| BOARD-07 | Full keyboard navigation | component (Vitest + Testing Library) | `npx vitest run src/board/__tests__/keyboard-nav.test.tsx` | ❌ Wave 0 |
| BOARD-08 | No perceptible lag at 1,000+ items | integration (Rust query-latency assertion) + manual UAT | `cargo test -p core --test perf_seed_1000 -- --nocapture` | ❌ Wave 0 |
| BOARD-09 | Activity trail query from event log | unit (Rust) | `cargo test -p core events::activity_trail` | ❌ Wave 0 |
| BOARD-10 | Register/switch multiple projects; marker reconciliation | integration (Rust) | `cargo test -p core --test project_reconciliation` | ❌ Wave 0 |

**Manual-only justification:** BOARD-07's *full* keyboard-navigation experience (feel of single-letter actions, palette discoverability) is best confirmed via conversational UAT (`/gsd-verify-work`) rather than automated e2e — Tauri's officially-supported e2e path (`@wdio/tauri-service` over WebDriver) is real but has documented setup friction in 2026 community reports `[CITED: webdriver.io/docs/wdio-tauri-service, v2.tauri.app/develop/tests/webdriver]`; recommend deferring full WebDriver e2e setup past Phase 1 and relying on component-level keyboard tests (Testing Library `fireEvent.keyDown`) plus manual UAT for the end-to-end feel.

### Sampling Rate
- **Per task commit:** `cargo test -p core` (fast subset touching the changed module) and, once Vitest exists, `npx vitest run --changed`.
- **Per wave merge:** `cargo test --workspace && npx vitest run` (full suite).
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus the crash-safety and migration-safety integration tests specifically re-run (they are the two tests most directly proving criterion 5).

### Wave 0 Gaps
- [ ] `packages/core/Cargo.toml` test target wiring — no Cargo workspace exists yet.
- [ ] `packages/core/tests/bin/crash_harness.rs` — separate binary target that performs a controlled transaction then aborts before/after commit on command-line flag, used by `crash_safety.rs`.
- [ ] `packages/core/tests/migration_safety.rs` — fixture database at schema version N-1 plus the intentional-bad-migration test.
- [ ] `packages/desktop/vitest.config.ts` + `@testing-library/react`/`@testing-library/jest-dom` install — no frontend test tooling exists yet.
- [ ] A seed script/fixture inserting 1,000+ synthetic tasks for the `perf_seed_1000` latency assertion.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Single local human user, no login surface in Phase 1; `actors` table exists structurally but no credential-based auth flow yet |
| V3 Session Management | No | Not a web session model; single long-lived local desktop process |
| V4 Access Control | Yes | Tauri v2's default-deny capabilities manifest — scope the `packages/desktop/src-tauri/capabilities/` grant to exactly the commands Phase 1's UI calls, nothing broader |
| V5 Input Validation | Yes | Every Tauri command validates its input shape before calling into `packages/core`; every SQL statement uses `rusqlite`'s `params![]` parameterization, never string interpolation |
| V6 Cryptography | No (Phase 1) | No secrets stored yet; the SQLite file is unencrypted at rest by default — flagged as a future-hardening item, not a Phase 1 blocker since D-14/D-15 do not store credentials in the DB |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via task title/description/search term | Tampering | Exclusive use of `rusqlite` parameterized queries (`params![]`); never format a user string into an SQL string, including FTS5 `MATCH` queries |
| Path traversal via a malicious/corrupted project marker or `repo_path` | Tampering / Information Disclosure | Every fs/git operation in `packages/core` takes an explicit, previously-validated absolute path (`ARCHITECTURE.md` Anti-Pattern 3); never derive a path by concatenating unsanitized marker-file content |
| Renderer escaping the Tauri sandbox to reach arbitrary commands | Elevation of Privilege | Keep the capabilities manifest scoped to the exact command set Phase 1's UI needs; do not grant a blanket `core:*` or filesystem-wide capability "for convenience" |
| Event payload JSON containing unbounded/attacker-influenced size (e.g., a very large pasted description) | Denial of Service | Not urgent for solo local-first v1 (no untrusted network input reaches this schema in Phase 1), but worth a sanity length-cap on `title`/`description` at the command-validation layer rather than deferring entirely |

## Sources

### Primary (HIGH confidence)
- `.planning/research/ARCHITECTURE.md` §2 (Domain Schema), §2.1 (event log vs. mutable projection), §8 (module boundary) — read directly this session
- `.planning/research/STACK.md` (full document) — read directly this session
- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — read directly this session
- `docs.rs/fractional_index/latest/fractional_index` — WebFetch-confirmed API surface (constructors, `stringify` module, compatibility guarantee)
- Local toolchain probes: `cargo search rusqlite/rusqlite_migration/ulid/fractional_index`, `npm view <pkg> version` — run directly this session, exact versions confirmed live

### Secondary (MEDIUM confidence)
- `docs.rs/rusqlite_migration` (via web search summary) — `Migrations`/`M::up`/`to_latest`/`user_version` behavior
- `sqlite.org/pragma.html` cross-checked against `oneuptime.com`, `tenthousandmeters.com` — WAL + `synchronous=NORMAL` crash-safety semantics
- `docs.rs/rusqlite/latest/rusqlite/struct.Transaction.html` (via web search summary) — transaction/commit/rollback-on-drop semantics
- `v2.tauri.app/develop/state-management/` (via web search summary) — `Mutex<Connection>` managed-state pattern, `app_handle.emit()`
- `tanstack.com/virtual/v3/docs/framework/react/examples/dynamic` (via web search summary) — `useVirtualizer`/`measureElement` pattern
- SQLite forum posts on FTS5 external-content trigger sync (via web search summary)
- `webdriver.io/docs/wdio-tauri-service`, `v2.tauri.app/develop/tests/webdriver` — Tauri e2e testing status and known friction

### Tertiary (LOW confidence)
- None retained as authoritative claims — all findings above were either tool-verified or cross-corroborated with 2+ independent sources within their web search result sets before being promoted to MEDIUM.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version number tool-verified live against crates.io/npm this session, not carried from training data or prior research documents
- Architecture (schema/transaction shape): HIGH — directly derivable from locked CONTEXT.md decisions (D-06, D-10, D-11, D-17, D-19) plus tool-confirmed library APIs (`fractional_index` WebFetched, `rusqlite_migration`/`rusqlite` cross-checked)
- Pitfalls: MEDIUM — grounded in documented library behavior (pragma scoping, FTS5 sync requirements) rather than this project's own incident history, since no code exists yet
- Relay/multi-remote research flags (1, 2): MEDIUM — sound architectural argument built on the locked schema, but genuinely untestable until a relay exists; flagged as such rather than overstated

**Research date:** 2026-09-09
**Valid until:** 30 days for the schema/architecture decisions (stable once implemented); 7 days for the exact npm/crates.io version numbers if planning is delayed, given the fast release cadence noted in `STACK.md` for several of these packages

---
*Phase: 1-The Board Is The Store Of Record*
*Researched: 2026-09-09*
