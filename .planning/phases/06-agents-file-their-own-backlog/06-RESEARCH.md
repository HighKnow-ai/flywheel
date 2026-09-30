# Phase 6: Agents File Their Own Backlog - Research

**Researched:** 2026-09-30
**Domain:** Extending an existing Rust/rusqlite staging-table proposal system (shipped in Phase 5)
to a second run kind (execution runs), adding duplicate detection, a volume limit, and a triage UI.
No new external dependencies.
**Confidence:** HIGH — every claim below that concerns this repository's own code was verified by
reading the cited file this session; only the bm25 sign-convention claim and the FTS5-vs-embedding
tradeoff rest on external documentation.

## Summary

Phase 6 is almost entirely an *extension* phase, not a greenfield one. Phase 5 already shipped the
staging table (`authoring_proposals`), its four-verb/four-target-type CHECK-constrained schema, a
transactional accept/reject/amend/accept-subtree write path that materialises exclusively through
each canonical table's own writer functions, a board-level triage lane (`TriageLane.tsx`) and row
component (`ProposalRow.tsx`), and a "no code path promotes a proposal" discipline documented in
`domain::authoring_proposal`'s own module header. `06-CONTEXT.md`'s decisions (D-97–D-112) correctly
read this substrate and choose to extend it rather than build a second one — this research confirms
that reading against the actual source and adds the concrete facts a planner needs to sequence the
extension safely.

The single most important verified finding this research adds beyond `06-CONTEXT.md`: **the
authoring-only stage-gate hook is already wired into every execution run's argv, not only authoring
runs**, and its `PreToolUse` matcher is a bare prefix regex (`propose_|amend_|delete_`) that the
planned `propose_item` tool name will match. Because execution runs never write the stage-marker
file the hook depends on, calling `propose_item` from an execution run will be **denied by an
existing, unrelated safety mechanism** unless the plan explicitly addresses this — see the dedicated
pitfall below. This was not visible from `06-CONTEXT.md` alone; it required reading
`claude-code-adapter.ts`'s `writeHookSettings` call sites and `stage-gate-hook.ts`'s fail-closed
logic together.

Everything else Phase 6 needs — an `issue` target type on the payload enum, a `merged`/`deferred`
status pair, `duplicate_of`/`duplicate_score` columns, a turn-pointer column, a rationale field, a
per-run count check inside the existing write transaction, and a new project-scoped triage surface —
is additive to code that already exists and follows patterns (source gates, bounded/indexed reads,
FTS5 triggers, event-append discipline) this codebase applies consistently everywhere else.

**Primary recommendation:** Extend `authoring_proposals` and `domain::authoring_proposal` in place
(one rebuild migration covering both CHECK constraints and every new column at once, mirroring
`0006_recovery_statuses.sql`'s documented rebuild recipe), add `propose_item` as a new MCP tool on
the *same* `flywheel-permissions` server, and — before wiring `propose_item` into execution-run
argv — fix the stage-gate hook collision described in Pitfall 1. Reuse `search_items`'s FTS5 tables
for duplicate detection via `bm25()`, never a new index or a hosted embedding call.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Proposal staging (write) | API / Backend (Rust core, `domain::authoring_proposal`) | — | Identity (project/epic/actor) is resolved server-side inside the write transaction; no caller-supplied identity is trusted (existing T-05-02-01 discipline). |
| Volume-limit enforcement | API / Backend (Rust core) | — | D-110: must be inside the same write transaction as the staging insert, not the sidecar (which restarts and loses in-memory counters) and not a second layer. |
| Duplicate scoring | API / Backend (Rust core, `query::search`) | — | FTS5 lives in SQLite; scoring at staging time inside the same transaction that inserts the row (D-107). |
| MCP tool surface (`propose_item`) | API / Backend (Node sidecar, `mcp-permission-server.ts`) | Browser/Client (none) | The sidecar is a thin process driver with no decision authority (per its own `package.json` description) — it relays to the Rust core over the existing Unix-socket protocol; it does not decide whether a proposal is accepted. |
| Stage-gate / permission-prompt hooks | API / Backend (Node sidecar, spawned as a *second* OS process per `claude` invocation) | — | Runs as Claude Code's own `PreToolUse` hook subprocess; reads only its own environment and a Rust-core-written marker file, never the DB directly. |
| Triage surface (accept/reject/merge/defer) | Frontend/Desktop (React, Tauri WebView) | API / Backend (Tauri commands) | UI renders the bounded, indexed read; every mutation is a Tauri command into the Rust core's canonical writers — the UI never writes SQL. |
| Materialisation (merge -> `create_issue`) | API / Backend (Rust core, `domain::issue::create_issue`) | — | D-101: merge must go through the canonical issue writer, same discipline every other accept path already follows. |

## Standard Stack

This phase introduces **no new external package** in any ecosystem. Everything it needs already
ships in the workspace:

| Capability | Existing dependency | Where |
|------------|---------------------|-------|
| Full-text duplicate scoring | SQLite FTS5 (built into `rusqlite`'s `bundled` feature) | `packages/core/src/query/search.rs`, migration `0002_board_schema.sql` |
| Schema/migration versioning | `rusqlite_migration` `^2.6` (already a workspace dependency, `Cargo.toml` verified via `cargo metadata`) | `packages/core/src/db/mod.rs` |
| MCP tool registration | `@modelcontextprotocol/sdk` `1.30.0` (already a `packages/sidecar` dependency — `package.json` verified) | `packages/sidecar/src/mcp-permission-server.ts` |
| Rust JSON | `serde`/`serde_json` `^1` (already a workspace dependency) | throughout `packages/core` |

**Installation:** none required.

### Alternatives Considered (duplicate detection specifically)

| Recommended | Alternative | When to use alternative |
|-------------|-------------|--------------------------|
| FTS5 `bm25()` over existing `*_fts` tables (D-105) | Hosted embedding similarity (e.g. an OpenAI/Anthropic embeddings call) | Never for this project as constituted — Flywheel authenticates only through the developer's local Claude Code credentials and is local-first by constraint (`.claude/CLAUDE.md`'s "No ANTHROPIC_API_KEY dependency" pinned memory, and PROJECT.md's "Cloud agent execution / remote sandboxes" exclusion). A hosted dedup call would require a second, unrelated credential path this project has explicitly ruled out. `[VERIFIED: .claude/CLAUDE.md pinned memory + PROJECT.md Out of Scope table]` |
| FTS5 `bm25()` | Trigram/edit-distance normalised-title matching | If bm25's ranking is found empirically too permissive/strict after seeding real data — cheaper to reason about, but D-105's own rejected-alternatives analysis (already in `06-CONTEXT.md`) found it misses same-finding-different-wording duplicates, the common agent case. |

## Package Legitimacy Audit

**Not applicable.** This phase installs no new external packages in any ecosystem — every
capability it needs (FTS5, `rusqlite_migration`, `@modelcontextprotocol/sdk`) is already a workspace
dependency, verified present via `cargo metadata --no-deps` and `packages/sidecar/package.json` this
session (see Standard Stack table above). No `checkpoint:human-verify` gate is needed for package
installation in this phase's plan.

## Architecture Patterns

### System Architecture Diagram

```
 Execution-run agent (claude CLI, task-scoped)
        │
        │ tool call: mcp__flywheel-permissions__propose_item
        ▼
 [NEW] propose_item handler (packages/sidecar/src/mcp-permission-server.ts)
        │  - validates target_type ∈ {task, issue, epic}
        │  - opens a socket, sends AuthoringProposalPayload-shaped message
        │  - AWAITS resolution (like propose_task today) so it can report
        │    "staged" vs "staged + flagged duplicate" vs "refused: limit hit"
        ▼
 Sidecar's per-run socket (ClaudeCodeAdapter, same channel Phase 5 built)
        │  onProposal callback -> relays over stdout as a
        │  {"type":"proposal_created", "runId": ..., "verb":..., "payload":...} line
        ▼
 sidecar.rs reader loop (packages/desktop/src-tauri/src/sidecar.rs, ~line 1698-1706)
        │  dispatches on event.type == "proposal_created"
        ▼
 commands::authoring::handle_inbound_proposal_created (Rust core boundary)
        │
        ▼
 domain::authoring_proposal::apply_proposal_created  ── ONE transaction ──▶
        │  1. resolve (project_id, epic_id, actor_id) from agent_runs — NEVER
        │     from the inbound event (existing T-05-02-01 discipline)
        │  2. [NEW D-110] COUNT(*) via idx_authoring_proposals_run_status;
        │     refuse (no INSERT) if >= 10 for this run
        │  3. [NEW D-105/D-107] score title+body against tasks_fts/epics_fts/
        │     issues_fts + a decided-proposals corpus; write duplicate_of/
        │     duplicate_score alongside the row in the SAME statement
        │  4. INSERT INTO authoring_proposals (status='pending', ...)
        │  5. append_event(..., "proposal.created", ...)
        │  6. COMMIT
        ▼
 authoring_proposals table (extended: target_type += 'issue', status +=
 'merged'/'deferred', + duplicate_of, duplicate_score, [turn-pointer col])
        │
        ├─▶ query::authoring::list_pending_proposals (existing, project-scoped,
        │    bounded, indexed via idx_authoring_proposals_project_status)
        │        │
        │        ▼
        │   [NEW] TriageSurface.tsx (sibling of SessionSurface.tsx) —
        │   accept / reject / merge / defer, bulk reject/defer only
        │        │
        │        ├── accept  ──▶ existing accept_proposal_in_tx ──▶ canonical
        │        │              writer (task::create_task_in_tx, etc.)
        │        ├── reject  ──▶ existing reject_proposal (unchanged)
        │        ├── [NEW] merge ──▶ domain::issue::create_issue (IssueParent)
        │        │              + UPDATE authoring_proposals SET status='merged',
        │        │              materialised_id=<new issue id>
        │        └── [NEW] defer ──▶ UPDATE authoring_proposals SET status='deferred'
        │                          (mints nothing, D-102)
        │
        └─▶ [NEW] events row (limit exhausted) ──▶ re-derived triage-surface
             and run-summary notice (D-112, same pattern as D-74/D-75)
```

### Recommended Project Structure (files this phase touches — no new top-level directories)

```
packages/core/src/db/migrations/
└── 0015_proposal_triage_extension.sql   # NEW — one rebuild covering D-97/D-102/D-107/D-99
packages/core/src/domain/
├── authoring_proposal.rs                # EXTEND — Issue payload variant, merge/defer verbs,
│                                         #   duplicate scoring call, run-scoped count check
└── issue.rs                             # UNCHANGED — create_issue already fits D-101's merge
packages/core/src/query/
├── authoring.rs                         # EXTEND — triage read gains duplicate_of/duplicate_score
│                                         #   columns in its projection
└── search.rs                            # EXTEND (or a new sibling fn) — bm25-scored duplicate
                                          #   candidate lookup, reusing to_fts5_prefix_phrase
packages/sidecar/src/
├── mcp-permission-server.ts             # EXTEND — propose_item tool + handler
└── claude-code-adapter.ts               # EXTEND — buildClaudeArgv gains proposeItemToolName;
                                          #   writeHookSettings gated per Pitfall 1
packages/desktop/src-tauri/src/commands/
└── authoring.rs                         # EXTEND — authoring_proposal_merge, authoring_proposal_defer,
                                          #   bulk-reject, bulk-defer commands
packages/desktop/src/triage/             # NEW directory (or packages/desktop/src/authoring/ —
└── TriageSurface.tsx                    #   either is consistent with existing conventions)
packages/desktop/src/board/
└── TriageLane.tsx                       # UNCHANGED entry point, per D-103
```

### Pattern 1: Transactional write-path extension (existing, to be followed exactly)

**What:** Every mutating function in `domain::authoring_proposal` opens one `Transaction`,
resolves identity server-side, performs the write, appends exactly one `events` row, and commits
once. `06-CONTEXT.md`'s D-110 (volume limit) and D-107 (duplicate flag) both require landing inside
this **same** transaction as the row insert — not a second round trip.

**When to use:** Any new write path in this module (the count check, the duplicate score, the merge
materialisation).

**Example (existing `create_proposal_in_tx`, verified this session):**
```rust
// Source: packages/core/src/domain/authoring_proposal.rs:209-322 (read this session)
fn create_proposal_in_tx(
    tx: &Transaction,
    agent_run_id: &str,
    verb: ProposalVerb,
    payload: ProposalPayload,
    target_id: Option<&str>,
    parent_proposal_id: Option<&str>,
    now: &str,
) -> anyhow::Result<Proposal> {
    let (project_id, epic_id, actor_id): (String, Option<String>, String) = tx
        .query_row(
            "SELECT project_id, epic_id, actor_id FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;
    // ... position allocation, payload validation ...
    tx.execute("INSERT INTO authoring_proposals (...) VALUES (...)", params![...])?;
    let sequence = next_sequence(tx, &project_id, "local")?;
    append_event(tx, &project_id, "local", sequence, "authoring_proposal", &id,
        None, epic_id.as_deref(), &actor_id, "proposal.created", &event_payload, now)?;
    Ok(Proposal { .. })
}
```
The volume-limit `COUNT(*)` (D-110) and duplicate `bm25()` lookup (D-107) both insert as additional
statements between "resolve identity" and "INSERT" in this exact function (or its
`apply_proposal_created` sibling), never as a separate call before/after this transaction opens.

### Pattern 2: The source-gate test (existing, directly reusable for D-100/D-104)

**What:** `authoring_proposal.rs`'s own test file (`packages/core/tests/authoring_proposal.rs:1296-
1418`) already implements exactly the mechanism D-100 (Criterion 1's structural proof) and D-104
(the accept-all prohibition) need: a recursive source walker (`sources_under`) that scans `.rs`/
`.ts`/`.tsx` files under named directories, skips whole-line comments, and asserts a list of
forbidden identifiers never appears outside the gate's own file. It also carries a **gate-on-the-
gate** test (`the_no_accept_all_gate_actually_reaches_the_frontend_tree`) proving the walker still
collects `.tsx` files — added *after* a real coverage hole (an empty frontend scan) was found in
Phase 5 verification.

**When to use:** D-100's "no agent-reachable module contains an `INSERT`/`UPDATE` against
`epics`/`tasks`/`issues`/`acceptance_criteria`" property, and D-104's "no accept-all/bulk-accept
identifier" property, are both instances of this exact pattern — write a sibling test function in
the same file reusing `sources_under`/`workspace_root`, not a new walker.

**Example (verified this session, `packages/core/tests/authoring_proposal.rs:1337-1381`):**
```rust
const FORBIDDEN_IDENTIFIERS: [&str; 4] = ["accept_all", "acceptAll", "accept_remaining", "acceptRemaining"];

#[test]
fn no_accept_all_identifier_exists_outside_this_gates_own_file() {
    let root = workspace_root();
    let scan_dirs = [
        root.join("packages/core/src"),
        root.join("packages/desktop/src-tauri/src"),
        root.join("packages/desktop/src"),
    ];
    let mut offenders = Vec::new();
    for dir in scan_dirs {
        for (path, body) in sources_under(&dir) {
            for (n, line) in body.lines().enumerate() {
                if is_whole_line_comment(line) { continue; }
                for forbidden in FORBIDDEN_IDENTIFIERS {
                    if line.contains(forbidden) {
                        offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
                    }
                }
            }
        }
    }
    assert!(offenders.is_empty(), "...");
}
```
For D-100, the forbidden-pattern list is `["INSERT INTO tasks", "INSERT INTO epics", "INSERT INTO issues", "INSERT INTO acceptance_criteria", "UPDATE acceptance_criteria"]` (case-sensitive literal
substring, matching this file's own `line.contains` idiom), scanned over `packages/core/src`,
`packages/desktop/src-tauri/src`, and `packages/sidecar/src` (the three trees an agent-reachable
write could live in) — **excluding** the modules that already legitimately contain such
statements (`domain::task`, `domain::epic`, `domain::issue`, `domain::acceptance_criterion`
themselves), which the CONTEXT.md's own wording of D-100 ("no *agent-reachable* module") already
anticipates needs an allow-list of canonical-writer files.

### Pattern 3: Bounded, indexed reads only (existing, `epic_context_packet.rs`'s `unbounded_reads`
gate — verified referenced but not read this session; treat its existence as `[CITED:
06-CONTEXT.md's own canonical_refs, cross-confirmed by query::authoring's own header comment]`)

**What:** `query::authoring.rs`'s own module header (verified, lines 1-8) states this module's every
function is bounded from the first line by the same `DEFAULT_LIMIT`/`MAX_LIMIT`/clamp idiom, "none
takes an `Option` that defaults to unbounded." Any new triage read (the merge target-picker's
search, the decided-set duplicate corpus read) must follow `resolve_limit`'s exact shape:

```rust
// Source: packages/core/src/query/authoring.rs:38-41 (read this session)
fn resolve_limit(limit: i64) -> i64 {
    let base = if limit <= 0 { DEFAULT_LIMIT } else { limit };
    base.min(MAX_LIMIT)
}
```

**When to use:** Every new read this phase adds (D-106's decided-set corpus, D-108's returned
candidate lookup).

### Anti-Patterns to Avoid

- **A second staging table or a status column on `issues`:** D-97 already rejected this after
  finding `authoring_proposals` is the only place "no code path promotes this" is already
  structurally proven; building a parallel mechanism would mean proving that property twice. The
  `issues` table's own module header (verified, `packages/core/src/domain/issue.rs:1-7`) states in
  its own words: *"This module contains no `status` identifier and no reference to
  `WORKFLOW_STATES` — a grep gate in `hierarchy_workflow.rs` asserts exactly that."* — Note this
  claim is **not machine-checked today**: `hierarchy_workflow.rs` was read in full this session and
  contains no source-scanning/grep test of any kind; its only relevant test is
  `issue_has_no_workflow_status` (`packages/core/tests/hierarchy_workflow.rs:195-221`), which
  queries a *live database row*, not source text. `[VERIFIED: packages/core/tests/hierarchy_workflow.rs
  read in full this session — no grep/source-scan test present]` — see Pitfall 4 below.
- **Computing the duplicate score at read time:** D-107 already rejected this (an unbounded `bm25`
  sweep per render), matching this codebase's `unbounded_reads` prohibition exactly.
- **A second copy of the FTS5 quoting/escaping logic:** `search_items`'s `to_fts5_prefix_phrase`
  (verified, `packages/core/src/query/search.rs:52-62`) already handles quote-doubling and
  prefix-match wrapping; a duplicate-detector's own query construction must call this function, not
  reimplement it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Duplicate detection | A custom trigram/Levenshtein matcher, or an embedding pipeline | SQLite FTS5 `bm25()` over the already-triggered `tasks_fts`/`epics_fts`/`issues_fts` tables | Zero new index, zero new dependency, zero network call; the sync triggers already fire on every canonical write (`0002_board_schema.sql:151-189`, verified). |
| FTS5 query-string escaping | A second escaping routine for the duplicate detector | `to_fts5_prefix_phrase` (`query/search.rs:55-62`) | Already empirically verified against quote/asterisk/hyphen/colon/CJK/emoji terms per that module's own doc comment; reinventing it reintroduces exactly the injection-into-FTS5-query-syntax risk that function exists to close. |
| Merge materialisation | A bespoke "merged proposal" table or a free-text append onto the target's description | `domain::issue::create_issue` with `IssueParent::Task`/`IssueParent::Epic` | Already a canonical writer with the both-parents-unrepresentable guarantee (`IssueParent` enum, verified `issue.rs:376-420`); reusing it means D-96's "materialise only through canonical writers" property extends automatically. |
| Bulk reject/defer | A new generic "bulk apply any verb" endpoint | Two narrow Tauri commands (`authoring_proposals_reject_bulk`, `authoring_proposals_defer_bulk`), each a loop of the existing single-row `reject_proposal`/new `defer_proposal` inside one transaction | Mirrors `accept_subtree`'s own shape (one root op, loop over a bounded set, one transaction, one outcome struct) rather than inventing a new generic verb-dispatch bulk mechanism the accept-all gate would then have to reason about. |
| Volume-limit counting | An in-memory counter in the sidecar | `COUNT(*)` against `idx_authoring_proposals_run_status` inside the write transaction | The sidecar is explicitly documented as having "no decision authority of its own" (`packages/sidecar/package.json` description, verified) and restarts under `watchdog.ts`, which would silently reset any in-process counter. |

**Key insight:** Every "don't hand-roll" item above is not a general software-engineering
platitude for this codebase — each one is a capability that Phase 1/2/5 already built and hardened
(FTS5 triggers, canonical writers, transactional identity resolution) specifically so that later
phases would not need to rebuild it. Phase 6's job is almost entirely "wire the existing pieces
together one more time," not "design a new subsystem."

## Common Pitfalls

### Pitfall 1 (CRITICAL, HIGH confidence, verified this session): The authoring stage-gate hook is
already wired into execution-run argv and will silently deny `propose_item`

**What goes wrong:** `06-CONTEXT.md`'s D-98 states the new tool "is left untouched" relative to the
authoring `stage-gate-hook.ts`, implying that hook's reach stops at authoring sessions. This is
**not what the code does today.**

`writeHookSettings` (`packages/sidecar/src/claude-code-adapter.ts:170-194`) is a single function
that unconditionally writes a `PreToolUse` settings file containing **two** hook entries:
```typescript
// Source: packages/sidecar/src/claude-code-adapter.ts:176-185 (read this session)
hooks: {
  PreToolUse: [
    { matcher: "Bash", hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }] },
    { matcher: AUTHORING_STAGE_GATE_MATCHER, hooks: [{ type: "command", command: `${process.execPath} ${stageGateHookScriptPath()}` }] },
  ],
},
```
where `AUTHORING_STAGE_GATE_MATCHER = mcp__flywheel-permissions__(propose|amend|delete)_.*`
(`claude-code-adapter.ts:154`, verified). This function is called from **both** call sites:
- Line 1204: inside the regular execution-run `startSession`, immediately before `buildClaudeArgv`.
- Line 1444: inside `startAuthoringSession`.

`stage-gate-hook.ts`'s `main()` (verified in full, lines 80-120) reads
`<runtimeDir>/stage/<runId>.json` and, if that file cannot be read, calls `failClosed(...)` — which
prints a deny decision and `process.exit(2)`. The **only** writer of that marker file is
`write_authoring_stage` (`packages/core/src/runtime_protocol.rs:317-343`), called exclusively from
authoring-run code paths (`authoring_run_start`/`authoring_stage_advance`/`authoring_stage_return`
in `commands/authoring.rs`) — **never** from a plain execution run's start path.

Consequence: as soon as `propose_item` is registered on the `flywheel-permissions` server and named
with the `propose_` prefix (D-98's locked choice), **every** execution-run call to it will match
`AUTHORING_STAGE_GATE_MATCHER`, trigger `stage-gate-hook.ts`, find no stage marker for that run, and
be denied — before the MCP handler is even reached. This is a real, load-bearing collision between
two decisions made in two different phases, invisible without reading both files together.

**Why it happens:** `writeHookSettings` was written in Phase 5 when the `propose_`/`amend_`/
`delete_` prefix vocabulary belonged exclusively to authoring sessions; nothing about that function
changed when Phase 6 was scoped, and `06-CONTEXT.md`'s own reasoning ("D-98 avoids extending
[the stage gate's] reach") was written without re-checking that the hook is unconditionally wired.

**How to avoid:** The plan must include one of:
1. **(Recommended)** Parameterize `writeHookSettings` (e.g. a boolean `includeAuthoringStageGate`)
   so the `AUTHORING_STAGE_GATE_MATCHER` entry is omitted for execution-run sessions, threading the
   flag through both call sites. This makes D-98's *stated* intent ("avoids extending its reach")
   literally true, and is the most surgical fix — it changes zero behaviour for authoring sessions.
2. Write a permissive stage marker for execution runs too (e.g. reuse `write_authoring_stage(run_id,
   "decompose")`, since the hook already treats `"decompose"`/`"criteria"` as pass-through) — cheap,
   but semantically confusing (an execution run is not "in decompose stage").
3. Modify `stage-gate-hook.ts` to distinguish run kind before failing closed — rejected: the hook is
   deliberately DB-free and socket-free "to keep this check live without a poll loop" (its own doc
   comment); adding a DB read here reintroduces exactly the dependency it was designed to avoid.

Option 1 is recommended and should be an explicit task in the plan, sequenced **before** any task
that spawns an execution run with `propose_item` pre-approved.

**Warning signs during implementation:** A `propose_item` call from a live execution-run UAT
returning a tool error whose `permissionDecisionReason` contains "no authoring stage marker could
be read for this run" is this exact bug, not a bug in the new tool's own handler.

### Pitfall 2: SQLite cannot `ALTER` a `CHECK` constraint — every schema change here needs one rebuild, not several

**What goes wrong:** D-97 (target_type += 'issue'), D-102 (status += 'merged'/'deferred'), D-99
(turn-pointer column), and D-107 (duplicate_of/duplicate_score columns) all touch
`authoring_proposals`. Migrating them as four separate migrations means either four separate table
rebuilds (four backup/restore risk windows, per `0006_recovery_statuses.sql`'s own documented
concern) or three of them silently failing because SQLite's `ALTER TABLE ... ADD COLUMN` **can**
add a plain column without a rebuild (as `0009_criteria_revisions.sql` does) but **cannot** touch a
`CHECK` constraint.

**Why it happens:** The two CHECK-constraint changes (target_type, status) force a rebuild
regardless; the new plain columns (duplicate_of, duplicate_score, turn-pointer) do not, in
isolation — but bundling them into the *same* migration is strictly cheaper than a separate
`ADD COLUMN` migration plus a separate rebuild migration.

**How to avoid:** One migration (`0015_...sql`, since `0014_permission_requests_authoring.sql` is
the current tail — verified via `ls packages/core/src/db/migrations/`), following
`0006_recovery_statuses.sql`'s exact documented recipe: `CREATE TABLE authoring_proposals_new (...)`
with both extended CHECK constraints and every new column, `INSERT INTO ... SELECT ... , NULL, NULL,
... FROM authoring_proposals`, `DROP TABLE authoring_proposals`, `ALTER TABLE ...RENAME TO
authoring_proposals`, then re-create **all three** existing indexes
(`idx_authoring_proposals_run_status`, `idx_authoring_proposals_epic_status`,
`idx_authoring_proposals_parent`) plus the `0012` migration's project-status index — `DROP TABLE`
silently drops every index on that table, and `RENAME TO` does not resurrect them (exactly the
lesson `0006`'s own migration states about `agent_runs`).

**Warning signs:** A test that passes locally but a fresh `open_and_migrate` on an empty DB fails
with "no such index" is this rebuild dropping an index the old migrations created.

### Pitfall 3: `authoring_proposals` is self-referential (`parent_proposal_id REFERENCES
authoring_proposals(id)`) — the rebuild needs the same `PRAGMA foreign_keys` toggle as `0006`'s

**What goes wrong:** `0006_recovery_statuses.sql`'s own header comment (verified) documents that
`DROP TABLE` on a table that is the parent side of a foreign key with matching child rows fails
under `PRAGMA foreign_keys = ON`, verified against a real `sqlite3` binary. `authoring_proposals`
is self-referential via `parent_proposal_id`, so the same failure mode applies to its own rebuild.

**How to avoid:** No new code is needed — `open_and_migrate` (`packages/core/src/db/mod.rs`) already
disables `PRAGMA foreign_keys` around every migration's `to_latest()` call (per `0006`'s own
comment, this is a connection-level toggle applied once, not per-migration). Confirm this stays true
by running the existing `migration_safety.rs` test suite after adding `0015`, rather than assuming
it; do not add a second, redundant pragma toggle inside the new migration's own SQL (which would be
a documented no-op per `rusqlite_migration`'s transaction semantics, per `0006`'s own comment).

### Pitfall 4: `issue.rs`'s own "a grep gate asserts this" claim is not machine-checked today

**What goes wrong:** `domain::issue`'s module header (verified, lines 1-7) states: *"This module
contains no `status` identifier and no reference to `WORKFLOW_STATES` — a grep gate in
`hierarchy_workflow.rs` asserts exactly that."* `hierarchy_workflow.rs` was read in full this
session (726 lines); it contains **no** source-scanning/grep-style test anywhere. Its tests
(`issue_has_no_workflow_status`, etc.) query a **live database row** to confirm the `issues` table
has no `status` column — a real and valuable check, but a different mechanism than "a grep gate over
source," and one that would not catch a future PR that adds a `status`-adjacent field to `Issue`
the Rust struct without touching the schema.

**Why it happens:** Likely documentation drift — the comment may describe an intended future gate,
or one that existed in an earlier draft and was replaced by the schema-level test without the
comment being updated.

**How to avoid:** D-97 is unaffected either way (it relies on the schema CHECK, not this comment),
but if the plan wants D-97's "issues keep zero status columns" claim to be provably machine-checked
at the *source* level (matching D-100's own stated preference for source gates over conventions),
add the missing source-scan test as part of this phase's work, reusing the `sources_under` walker
from Pattern 2 above (forbidden identifier: any `status` field/column reference inside
`domain::issue`, excluding this comment itself).

### Pitfall 5: `ProposalPayload` has no `Issue` variant today — D-97/D-98 require adding one

**What goes wrong:** The current enum (verified, `authoring_proposal.rs:88-95`) is:
```rust
pub enum ProposalPayload {
    Epic { title: String, description: Option<String> },
    Task { title: String, description: Option<String> },
    Criterion { statement: String, verification_hint: Option<String> },
    Assumption { assumption: String, answer: String },
}
```
There is no `Issue` variant. D-98 requires `propose_item` to accept `target_type ∈ {task, issue,
epic}`. Adding `Issue { title: String, body: Option<String>, kind: String }` (matching `issues`'s
own `kind` CHECK: `bug`/`idea`/`question`/`risk`, verified `0002_board_schema.sql:87`) is required
before `propose_item`'s wire path can round-trip. This also means `ProposalTargetType` gains an
`Issue` variant, and `materialise_proposal`'s match arms gain a `("create", ProposalPayload::Issue
{ .. })` case calling `domain::issue::create_issue` — separate from D-101's *merge* path, which also
calls `create_issue` but from a different verb/context (accepting a proposed-issue-target proposal
directly, versus merging a proposed-task/epic into a new child issue).

**How to avoid:** Treat "accept a proposed issue" (materialise directly) and "merge a
proposed-task/epic into a child issue" (D-101) as two distinct call sites into the same
`create_issue` function, with two distinct `IssueParent` values (`IssueParent::None` for a
top-level proposed issue vs. `IssueParent::Task`/`IssueParent::Epic` for a merge target) — do not
conflate them into one code path with a runtime branch on "was this triggered by accept or by
merge," since that reintroduces exactly the kind of hidden coupling D-96's "materialise exclusively
through canonical writers" discipline exists to prevent duplicating.

### Pitfall 6: `SessionSurface.tsx` already gates `ProposalTray` on `authoringStage`, not on run kind directly

**What goes wrong (informational, resolves a Claude's Discretion item):** `06-CONTEXT.md` lists as
open discretion "whether an executing agent's session surface gains a live proposal tray... or
whether the board lane's count is the only in-flight signal." This is answerable now: `ProposalTray`
already mounts inside the shared `SessionSurface.tsx` component (verified,
`packages/desktop/src/session/SessionSurface.tsx:1289-1302`):
```tsx
{authoringStage && (
  // ... existing comment ...
  <ProposalTray agentRunId={agentRunId} />
)}
```
`authoringStage` is `null`/`undefined` for an ordinary task-execution run (per the prop's own doc
comment, verified line 513-517: *"the run's `agent_runs.authoring_stage`, or `null`/`undefined` for
an ordinary task-execution run."*). `ProposalTray` itself queries by `agentRunId` alone (via
`useRunProposals`, `useAuthoringQuery.ts:45-72`, verified) and has no dependency on run kind. **If
the plan wants a live in-session tray for execution runs**, the change is narrowly: broaden the
mount condition (e.g. `{(authoringStage || hasPendingProposalsForRun) && <ProposalTray .../>}`) —
not a new component. If the plan instead wants "the board lane's count is the only in-flight
signal" (the other option `06-CONTEXT.md` names), no change to `SessionSurface.tsx` is needed at
all. Either way, this is now a one-line decision with a known, small blast radius rather than an
open architectural question.

### Pitfall 7: `bm25()` returns *negative* scores — smaller (more negative) is a better match

**What goes wrong:** A naive threshold implementation ("flag when `bm25(...) > threshold`") is
backwards. Per SQLite's own FTS5 documentation: *"the built-in auxiliary function bm25() returns...
a negative number, with more relevant results being more negative"* — ranking should `ORDER BY
bm25(tbl) ASC` and a duplicate flag should trigger when the score is **below** (more negative than)
a fixed threshold, not above it. `[CITED: sqlite.org/fts5.html — bm25() auxiliary function,
retrieved via web search this session]`

**How to avoid:** Write the threshold comparison as `score < THRESHOLD` (e.g. `score < -5.0`), and
have the Claude's-Discretion threshold-measurement task (`06-CONTEXT.md`'s own open item) measure
against this sign convention explicitly rather than discovering it by trial and error against seeded
data.

## Code Examples

### Extending the tool-name vocabulary (mirrors existing `report_summary` precedent exactly)

```typescript
// Source: packages/sidecar/src/mcp-permission-server.ts:73-92 (read this session) — the pattern
// to replicate for PROPOSE_ITEM_TOOL_NAME
export const REPORT_SUMMARY_TOOL_NAME = "report_summary";
export const SUMMARY_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${REPORT_SUMMARY_TOOL_NAME}`;
```
D-98's `propose_item` follows this exact two-constant pattern (raw name + fully-qualified name), and
its fully-qualified name is pushed onto `buildClaudeArgv`'s `--allowedTools`, mirroring exactly how
`summaryToolName` is threaded through today (verified, `claude-code-adapter.ts:274-303`):
```typescript
// Source: packages/sidecar/src/claude-code-adapter.ts:268-304 (read this session)
export function buildClaudeArgv(options: {
  // ...
  summaryToolName?: string;
  // [NEW] proposeItemToolName?: string;
}): string[] {
  // ...
  if (options.permissionPromptToolName && options.mcpConfig) {
    pushPermissionPromptFlags(argv, options.permissionPromptToolName, options.mcpConfig);
    if (options.summaryToolName) {
      argv.push("--allowedTools", options.summaryToolName);
    }
    // [NEW] if (options.proposeItemToolName) { argv.push("--allowedTools", options.proposeItemToolName); }
  }
  // ...
}
```

### The run-scoped write transaction's identity-resolution guard (must be preserved exactly)

```rust
// Source: packages/core/src/domain/authoring_proposal.rs:218-224 (read this session)
let (project_id, epic_id, actor_id): (String, Option<String>, String) = tx
    .query_row(
        "SELECT project_id, epic_id, actor_id FROM agent_runs WHERE id = ?1",
        params![agent_run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;
```
D-99's provenance requirement ("the executing task comes free via `agent_run_id` ->
`agent_runs.task_id`") is satisfied by this exact same lookup — `agent_runs` already carries
`task_id` (verified, `packages/core/src/db/migrations/0003_agent_runtime.sql` referenced via
`0006`'s rebuilt column list, which includes `task_id TEXT NOT NULL REFERENCES tasks(id)`), so no
new join is required to answer "which task's run produced this."

## State of the Art

| Old Approach (Phase 5) | Current/New Approach (Phase 6) | When Changed | Impact |
|--------------------------|-------------------------------|---------------|--------|
| `authoring_proposals` serves only authoring runs; `target_type` has no `issue` | Same table serves both run kinds; `target_type` += `issue` | This phase (D-97) | One proposed-state to prove PROP-03 against, not two. |
| Proposal resolution is always `{"staged": true}` | `propose_item` resolves with the flagged candidate (D-108) | This phase | Diverges deliberately from authoring's contract — must be documented so future readers don't assume uniformity. |
| No stage-gate collision exists (authoring-only prefix vocabulary) | `propose_item` shares the `propose_` prefix with authoring's write tools | This phase | Creates Pitfall 1 above — must be fixed before wiring. |

**Deprecated/outdated:** Nothing in this phase deprecates prior-phase code; it is purely additive
except for the `writeHookSettings` parameterization needed to fix Pitfall 1.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | The recommended fix for Pitfall 1 (parameterize `writeHookSettings`) is the lowest-risk option among the three listed | Pitfall 1 | Low — all three options are documented; the planner can choose differently with full information. |
| A2 | `bm25()`'s sign convention (negative = better) applies identically across the three `*_fts` tables this codebase defines, with no custom weighting | Pitfall 7 | Low — this is a documented, table-shape-independent SQLite behavior, not project-specific. |
| A3 | A single fixed `bm25` threshold (D-105, already a locked decision) will generalize across `tasks_fts`/`epics_fts`/`issues_fts` despite their different column counts (title+description vs. title+body) | Duplicate flagging | Medium — `06-CONTEXT.md` already flags the actual threshold value as Claude's Discretion requiring measurement; this note only adds that per-table normalization may be needed if titles/bodies differ enough in length distribution across the three tables. |
| A4 | Naming the new Rust rebuild migration `0015_proposal_triage_extension.sql` is available (no other in-flight phase claims 0015) | Pitfall 2 | Low — verified `0014` is the current tail via `ls`; a concurrent phase branch could claim 0015 first, requiring a rename before merge. |

**A1–A4 above are all `[VERIFIED]`-grounded recommendations with an `[ASSUMED]` risk-ranking
attached to the choice among alternatives** — none of them rest on unverified claims about the
codebase's current state.

## Open Questions

`06-CONTEXT.md`'s own "Claude's Discretion" list (8 items) remains the authoritative list of
decisions still open. This research adds evidence relevant to three of them:

1. **Live proposal tray for execution runs?** — See Pitfall 6. Resolved to a one-line
   implementation question either way; no longer an open architectural unknown.
2. **The bm25 threshold value** — See Pitfall 7's sign-convention correction; the measurement task
   `06-CONTEXT.md` already calls for should be written with `score < THRESHOLD` (negative
   direction) from the start, not discovered after an inverted first attempt.
3. **Decided-set FTS index for D-106** — Not resolved by this research; recommend a lightweight new
   `authoring_proposals_fts` external-content FTS5 table (following `0002_board_schema.sql`'s exact
   trigger pattern) over title-only matching, since the existing three tables already prove the
   pattern is cheap and consistent, and title-only matching would need a second, different-shaped
   query path alongside the bm25 one — more code, not less.

## Environment Availability

No external tools, services, or runtimes beyond what Phases 1-5 already established. FTS5 is
compiled into `rusqlite`'s `bundled` SQLite build (verified via `cargo metadata` showing
`rusqlite` with `features: ["bundled", "serde_json", "chrono"]`) — no separate SQLite installation
or extension-loading step is needed.

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| SQLite FTS5 | Duplicate detection (D-105) | Yes (bundled) | Whatever `rusqlite` 0.40's `bundled` feature vendors | N/A — already exercised by Phase 1's `search_items` |
| Node.js (sidecar) | `propose_item` MCP tool | Yes (already running) | Matches existing sidecar runtime | N/A |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Rust) | `cargo test`, workspace-integration-test style (one `.rs` file per concern under `packages/core/tests/`) |
| Framework (sidecar) | Node's built-in `node --test`, invoked via `npm run test` (`packages/sidecar/package.json` script, verified: `"test": "npm run build && ... node --test test/*.test.mjs"`) |
| Config file | none dedicated — `Cargo.toml` workspace members (verified via `cargo metadata`); sidecar's `tsconfig`/`package.json` |
| Quick run command | `cargo test -p core --test authoring_proposal` (or the new test file this phase adds) |
| Full suite command | `cargo test --workspace` and `npm --prefix packages/sidecar test` |

**Verify-command grounding — confirmed this session, all still resolve:**
- `cargo test --workspace` — confirmed via `cargo metadata --no-deps` succeeding against the four
  workspace members (`core`, `relay-client`, `desktop`, `flywheel-shim`).
- `cargo test -p core --test <name>` — confirmed; `packages/core` exposes dozens of named
  integration test binaries via `cargo metadata`'s `targets` list (e.g. `authoring_proposal`,
  `hierarchy_workflow`, `authoring_stage`).
- `npm --prefix packages/sidecar run build` / `npm --prefix packages/sidecar test` — confirmed;
  `packages/sidecar/package.json`'s scripts are exactly `"build": "tsc"` and `"test": "npm run
  build && ... node --test test/*.test.mjs"`.
- `cargo build --workspace` — confirmed resolvable (same workspace member list as above).
- No `packages/desktop/src` frontend test harness was found during this research (no `*.test.tsx`/
  `vitest.config.*`/`jest.config.*` file was encountered while reading `packages/desktop/src`) —
  **frontend behavior for this phase (TriageSurface.tsx) has no existing automated test seam**; the
  plan should either add one (a Wave 0 gap) or rely on the Rust-level command tests plus a manual/
  scripted UAT bridge (the codebase already has a UAT-bridge pattern per `uat_authoring_ops.rs` in
  `cargo metadata`'s target list, worth reusing rather than inventing a new harness).

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|--------------|
| PROP-01 | Execution-run agent can call `propose_item` and stage a row | integration | `cargo test -p core --test authoring_proposal -- propose_item` (new tests) | ❌ Wave 0 — new file/test needed |
| PROP-02 | Proposed items enter `status='pending'`, never appear in canonical tables | unit | Extend existing `authoring_proposal.rs` tests (the accept-path tests already assert `materialised_id` is `None` until accept) | Partially — pattern exists, `issue` target-type case is new |
| PROP-03 | No code path promotes without triage | source-scan (see Pattern 2) | `cargo test -p core --test authoring_proposal -- no_..._promotion_path_exists` (new source gate) | ❌ Wave 0 — new gate needed, reusing `sources_under` |
| PROP-04 | Duplicates flagged before surfaced | unit | New test asserting `duplicate_of`/`duplicate_score` populated inside `create_proposal`'s own transaction | ❌ Wave 0 |
| PROP-05 | Volume limit surfaced, not silently dropped | integration | New test: 11th `propose_item` call in one run returns a named tool error, not silent staging | ❌ Wave 0 |
| PROP-06 | Triage view: accept/reject/merge/defer | manual/UAT-bridge (no frontend test harness found) | `uat_authoring_ops` binary pattern, extended | ❌ Wave 0 — no `.tsx` test harness exists in this repo today |
| PROP-07 | Every proposal records run + rationale | unit | New test asserting the `rationale` field round-trips and `agent_run_id -> agent_runs.task_id` resolves | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test -p core --test authoring_proposal` (fast, targeted)
- **Per wave merge:** `cargo test --workspace && npm --prefix packages/sidecar test`
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a live UAT run exercising
  `propose_item` from a real execution-run session (per this project's own "prefers automated
  verification" pinned memory — prefer scripting this via the existing UAT-bridge pattern over a
  purely manual click-through).

### Wave 0 Gaps
- [ ] New source-gate test for D-100 (Pattern 2 above), in `packages/core/tests/` — no equivalent
      exists today for "no agent-reachable INSERT into canonical tables."
- [ ] New adversarial-corpus test mirroring D-62/AGNT-07's precedent (drives every propose/amend/
      delete path, asserts zero canonical rows until triage) — `06-CONTEXT.md`'s D-100 explicitly
      requires this as the second, non-optional half.
- [ ] Frontend test harness gap: no `.tsx`/`.ts` component-test framework exists in
      `packages/desktop/src` today (confirmed absent this session) — the new `TriageSurface.tsx`'s
      accept/reject/merge/defer logic will be validated at the Tauri-command layer (Rust) plus a
      UAT-bridge script, not a component-level test, unless this phase's plan explicitly adds one.
- [ ] Migration-safety test extension: `migration_safety.rs` (existing, per `cargo metadata`) should
      gain a case exercising the new `0015` rebuild specifically (self-referential FK rebuild,
      Pitfall 3).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | No | Unchanged — Flywheel authenticates only via local Claude Code credentials, not touched by this phase. |
| V3 Session Management | No | Not touched. |
| V4 Access Control | Yes | Server-side scoping pattern already established: every agent-facing read/write resolves `project_id`/`epic_id`/`run_id` from the `agent_runs` row inside the transaction, **never** from caller-supplied fields (`T-05-02-01`/`T-05-05-03`, verified repeatedly across `authoring_proposal.rs` and `query/authoring.rs`). The new `propose_item` handler and the new merge/defer commands must preserve this exactly — a `propose_item` payload must never carry (or be trusted for) `project_id`/`epic_id`. |
| V5 Input Validation | Yes | `validate_payload` (verified, `authoring_proposal.rs:823-876`) already enforces length bounds (`MAX_PROPOSAL_TITLE_LEN = 500`, `MAX_PROPOSAL_TEXT_LEN = 1000`) matching the tool schemas; the new `Issue` payload variant must be added to this function's match arms with the same bounds, and `rationale` (D-99) needs its own bound added here too. |
| V6 Cryptography | No | Not touched. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| A malicious/compromised agent stages an arbitrary number of proposals to spam the board | Denial of Service (against human triage attention, not the system) | D-109/D-110's fixed, non-configurable per-run limit enforced inside the write transaction — this IS the mitigation this phase builds; no additional control needed beyond faithfully implementing D-110's transaction placement. |
| An agent crafts a title/body designed to break FTS5 query syntax during duplicate scoring | Tampering (query injection into the search subsystem) | Already mitigated by reuse of `to_fts5_prefix_phrase` (Don't Hand-Roll table) — do not construct a second, unescaped FTS5 MATCH string for the duplicate detector. |
| A proposal's `target_id` (for `amend`/`delete`) names a row the agent has no legitimate relationship to, in another project | Elevation of Privilege / broken access control | Already mitigated by `ensure_target_exists` + `target_row_exists` (verified, `authoring_proposal.rs:461-497`) scoping every target lookup — but note this only checks existence, not project match, for `Task`/`Epic`/`Criterion` target types (it queries `WHERE id = ?1` with no `project_id` filter). This is a **pre-existing** pattern from Phase 5, not new to Phase 6, but Phase 6's `issue` target type addition should be checked against the same standard the existing three already meet (or don't meet) rather than introducing a new, inconsistent standard. `[VERIFIED: packages/core/src/domain/authoring_proposal.rs:461-479 — no project_id parameter appears in any of `target_row_exists`'s three query arms]` |

## Sources

### Primary (HIGH confidence — read in full or in relevant part this session)
- `.planning/phases/06-agents-file-their-own-backlog/06-CONTEXT.md` — the phase's locked decisions (D-97–D-112) and discretion items.
- `.planning/REQUIREMENTS.md` — PROP-01 to PROP-07, lines 101-107.
- `.planning/STATE.md` — decision history, Phase 1-5 architectural precedents.
- `packages/core/src/db/migrations/0002_board_schema.sql`, `0006_recovery_statuses.sql`, `0009_criteria_revisions.sql`, `0011_authoring_staging.sql`, `0012_authoring_proposals_project_status_index.sql`.
- `packages/core/src/domain/authoring_proposal.rs` (full file, 1063 lines).
- `packages/core/src/domain/issue.rs` (full file, 578 lines).
- `packages/core/src/query/authoring.rs` (full file, 625 lines).
- `packages/core/src/query/search.rs` (full file, 317 lines).
- `packages/core/tests/hierarchy_workflow.rs` (full file, 726 lines) and `packages/core/tests/authoring_proposal.rs` (tail section, source-gate tests, lines 1290-1419).
- `packages/core/src/runtime_protocol.rs` (stage-marker read/write, lines 300-361).
- `packages/sidecar/src/mcp-permission-server.ts` (header + tool-name declarations, lines 1-230).
- `packages/sidecar/src/claude-code-adapter.ts` (buildClaudeArgv, writeHookSettings, call sites, ~lines 150-330 and 1190-1260).
- `packages/sidecar/src/stage-gate-hook.ts` (full file, 123 lines).
- `packages/desktop/src-tauri/src/commands/authoring.rs` (command signatures via grep) and `packages/desktop/src-tauri/src/sidecar.rs` (inbound dispatch, ~lines 1690-1710).
- `packages/desktop/src-tauri/src/main.rs` (registered command list).
- `packages/desktop/src/board/TriageLane.tsx` (full file, 229 lines).
- `packages/desktop/src/authoring/ProposalRow.tsx` (header + top section).
- `packages/desktop/src/authoring/useAuthoringQuery.ts` (exported hooks, via grep).
- `packages/desktop/src/session/SessionSurface.tsx` (ProposalTray mount condition, lines 505-520, 1280-1305).
- `packages/desktop/src/state/keyboard.ts` (existing proposal-tray keybindings, lines 190-260).
- `packages/sidecar/package.json`, `Cargo.toml`/`cargo metadata --no-deps` output (dependency/test-target verification).

### Secondary (MEDIUM confidence)
- SQLite FTS5 `bm25()` sign convention — [SQLite FTS5 Extension official docs](https://sqlite.org/fts5.html), confirmed via web search this session ("the better the match, the numerically smaller/more-negative the bm25() value").

### Tertiary (LOW confidence)
- None used as load-bearing in this document — every claim above is either directly verified against this repository's source this session, drawn verbatim from `06-CONTEXT.md`'s already-researched decisions, or cited to SQLite's own documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; every existing dependency confirmed via `cargo metadata`/`package.json` reads this session.
- Architecture: HIGH — every architectural claim traces to a specific file:line read this session; the one non-trivial cross-file finding (Pitfall 1) was independently re-derived from two separate source files, not assumed.
- Pitfalls: HIGH for Pitfalls 1-6 (all directly verified against source); MEDIUM for Pitfall 7 (verified against external SQLite documentation, not this codebase's own bm25 usage, since none exists yet).

**Research date:** 2026-09-30
**Valid until:** 30 days (stable, slow-moving internal architecture; re-verify Pitfall 1's fix status if Phase 6 planning spans more than one sprint, since a partial implementation could resolve or worsen the collision).
