# Architecture Research: v0.2.0 "The Board Thinks With You"

**Domain:** Integrating an authoring layer (PRD, ADR, phases, agent-drafted everything, agent-assisted review, a state-colour direction) into a shipped Tauri v2 + Rust + SQLite + React ADE.
**Researched:** 2026-10-14
**Confidence:** HIGH on integration points and constraints (read from the code, several confirmed by running SQLite 3.51 and one vitest). MEDIUM on the design choices (they are judgements). LOW on live agent behaviour (nothing here was run against a real model).

Builds on `.planning/research/ARCHITECTURE.md` (v0.1.0). That document's process topology, event log, context-packet and worktree decisions are not re-argued. Only what v0.2.0 adds or changes is covered.

---

## 0. Bottom line

1. **The spine has not been touched since `0002`.** Twenty-one migrations later, `epics`, `tasks` and `issues` still have their original DDL (`0002_board_schema.sql:35,58,79`; no later migration alters them). Keep it that way. Phases, PRDs and ADRs become new tables joined to epics by link tables. Do not add `phase_id` to `epics`. Add a golden-schema test that freezes the three tables.
2. **There are not two proposal mechanisms. There is one.** Phase 6 already made `authoring_proposals` "the single proposal channel for both run kinds" (06-CONTEXT D-97). The two bespoke things are the tool wiring and the UI hosts, and the UI already shares one row component (`ProposalRow`). Extend that one mechanism for spine drafts. Do not build a new one.
3. **PRD and ADR bodies do not go through `authoring_proposals`.** They get their own append-only revision model. What stays structural is *authority*: a human-only transition on a specific immutable revision, enforced by a SQLite trigger (verified) plus a generalised source gate. That is stronger than Phase 6's guard, not weaker.
4. **Three latent defects block the plan and are not in any requirement:**
   - `PROPOSAL_LIMIT_PER_RUN = 10` applies to authoring runs too (`authoring_proposal.rs:319,406`), which would cap a decomposition session at 10 rows.
   - `brand-rule.test.ts` fails at load today, because the v0.1.0 archive commit moved the spec file it reads (confirmed by running it).
   - A criterion cannot be drafted for an existing, hand-made task. `materialise_proposal` requires a parent *proposal* (`authoring_proposal.rs:838`).
5. **Add an explicit `agent_runs.kind`.** Run kind is currently inferred from column shape in four places. v0.2.0 adds two more kinds (PRD authoring, review). Additive `ALTER TABLE ... ADD COLUMN` with CHECK works in the bundled SQLite (verified), so no fourth `agent_runs` rebuild is needed.
6. **PLAN-01 is wired end to end; what is missing is one live run and a better editor.** `dispatch_plan_generate` -> planning run -> held `submit_plan` -> draft plan exists. The textarea is the *edit* surface over the planner's draft. Closing PLAN-01 means a live measurement first, then replacing the textarea with per-entry editing plus a free-text "Add path" escape hatch.
7. **Agent review is a new run kind that reads the diff through the same Rust functions the review UI uses** (`review.rs:258,269`), and stores findings as pointers plus an opinion, never diff text. Freshness is derived from git exactly like criterion anchors. A finding never sets `checked`.
8. **Theming: the tension is real, and it is a recorded decision, not a style choice.** `08.1-DIRECTION.md` section 2 (D-11) says "No status fills. No pills with backgrounds." The new direction supersedes that by name. "Meaning never rests on colour" is resolved by making it a mechanical invariant (one `StateMark` component, a source gate), then letting colour be the fastest channel instead of the redundant one.
9. **Build order:** repairs and guard-rails first, then phases (no agent dependency), then the proposal-mechanism extension (it gates PRD, file-set UX and field drafts), then PRD/ADR and review in parallel, then the visual round last. Start the PLAN-01 live measurement on day one because its feedback loop is the slowest.
10. **Surface count is about to outgrow the shell.** `App.tsx` chooses full-screen surfaces with a hand-rolled ternary over independent `uiStore` fields. The PROJECT.md Active item WR-02 (surfaces outside the keyboard layer model) is a prerequisite, not a nice-to-have.

---

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ RENDERER (React 18/19)                         one seam: adapters/tauri.ts     │
│  Home: board + ROADMAP REGION (new)    Surfaces (one union, new):              │
│  EpicHeaderRow, StatusBand (mod)        review* · fleet · settings · triage*   │
│                                         prd (new) · adr (new)                  │
│  Inbox = triage ∪ proposed ADRs (mod)   StateMark + legend/stateClasses (new)  │
│  server state: React Query only         UI state: Zustand only                 │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ invoke / board:changed {entity,id}
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ RUST CORE (src-tauri/src/commands/* -> packages/core)                          │
│  domain/ (the only mutating SQL)                                               │
│   spine writers (unchanged DDL):  epic task issue acceptance_criterion         │
│   staging:   authoring_proposal (extended)   authoring_session (kind-aware)    │
│   NEW owners: phase  prd  adr  review_finding                                  │
│   plans:     dispatch_plan  file_set (unchanged, PLAN-01 closes on it)         │
│  query/ (derive, never store):  epic_progress -> phase_progress (new fold)     │
│                                 inbox (new union read)  review (finding overlay)│
│  context_packet / epic_context_packet: + governing PRD bar + accepted ADRs     │
│  db/: migrations 0023..0026 (additive x3, one rebuild)                         │
│  AUTHORITY_REGISTRY + generalised source gate (tests/, new)                    │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ stdin/stdout JSON lines + per-run unix socket (held calls)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ SIDECAR (Node)   never opens the DB                                            │
│  RunKindProfile table (new) -> allowedTools, hook matchers, scope mode         │
│  kinds: execution · authoring · planning · prd_authoring (new) · review (new)  │
│  MCP server: propose_*/amend_*/delete_* (stage-gated by prefix) · propose_item │
│   · submit_plan · board_read family  + NEW: prd/adr/review tools              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Findings that change the plan

These were found by reading the code. Each needs an owner or a requirement before the roadmap is frozen.

| # | Finding | Evidence | Confidence | Action |
|---|---------|----------|------------|--------|
| F1 | The 10-proposal cap applies to authoring runs. A decomposition (epic + tasks + criteria) exceeds it quickly, and the refusal tells the agent to "call report_summary", which is wrong advice for an authoring session. The Phase 5 live run drafted 42 criteria and predates the cap. | `authoring_proposal.rs:319` (constant), `:406` (`staged_count >= PROPOSAL_LIMIT_PER_RUN`, no run-kind branch), `commands/authoring.rs:1405-1411` (`LimitExhausted` arm relays the execution wording to authoring). D-109/D-110 in `06-CONTEXT.md` were written about execution runs. | HIGH from reading; not executed | Make the cap a function of run kind (section 5.3). Confirm first with an 11-proposal authoring fixture. |
| F2 | `brand-rule.test.ts` fails at import. It reads `.planning/phases/08.1-.../08.1-UI-SPEC.md`, which commit `72b306e` moved to `.planning/milestones/v0.1.0-phases/`. `.planning/phases/` is now empty. Several `*.browser.test.tsx` files also mention `.planning/phases`. | `brand-rule.test.ts:6-12`. I ran `npx vitest run src/theme/__tests__/brand-rule.test.ts`: "Test Files 1 failed", ENOENT. | HIGH (executed) | Repair before any theme work. It is the colour gate the new direction must amend. |
| F3 | Drafting criteria for an existing task has no representation. A `create`/`Criterion` proposal materialises only through `parent_outcome`, i.e. a parent *proposal*. | `authoring_proposal.rs:836-839` ("carries no parent_proposal_id"). Audit finding in PROJECT.md: every task with a worktree has zero criteria. | HIGH | Allow `target_id` to carry the parent task id on a criterion `create` (section 5.2). |
| F4 | `set_priority` and `set_estimate` take `&mut Connection` and open their own transaction. There is no `_in_tx` form, so a proposal cannot materialise them atomically. `set_task_status_in_tx` does exist. | `task.rs:808`, `:869`, `:446`; same pair in `epic.rs:564,622`. | HIGH | Add `set_priority_in_tx` / `set_estimate_in_tx` for task and epic. |
| F5 | `start_agent_run` writes `UPDATE tasks SET status = 'in_progress'` directly, contradicting `task.rs`'s "no caller anywhere may issue a raw UPDATE tasks SET status". The Phase 6 gate does not catch it because its patterns are only `INSERT INTO` the four tables plus `UPDATE acceptance_criteria`. | `agent_run.rs:233`; `proposal_no_promotion.rs:81-87`. Two other non-writer sites touch `updated_at` (`acceptance_criterion.rs:778,782`). | HIGH | If the gate is widened to `UPDATE tasks/epics`, allow-list or refactor these three sites first. |
| F6 | Run kind is inferred from column shape in four places. | `dispatch_plan.rs:1192` and `commands/dispatch.rs:703` ("epic_id set, task_id NULL, authoring_stage NULL" = planning); `query/authoring.rs:574` and `commands/authoring.rs:190` (`authoring_stage IS NOT NULL` = authoring). | HIGH | Add `agent_runs.kind` and migrate these four sites. |
| F7 | The older app build cannot open a newer database. So "reversible within one version" (DATA-08) is the pre-migration backup and restore, not down-migrations. | `db/mod.rs:81-90` (restore on failure is "the reversibility mechanism"); `rusqlite_migration-2.6.0/src/lib.rs:720` returns `DatabaseTooFarAhead`; no test covers it. | HIGH | Say so in the requirement. Additive migrations reduce risk; they do not make a roll-back free. |
| F8 | `board:changed` carries `{entity, id}` but the adapter discards it, so every subscriber invalidates on every event. An always-on roadmap that folds every task in the project would refetch on every proposal and run event. | `adapters/tauri.ts:27-31` (`listen(...) => handler()`); `queryClient.ts` `staleTime: 0`; `query/epic_progress.rs:1-9` ("three grouped reads over EVERY task"). | MEDIUM (rate not measured) | Pass the payload through, map entity to query keys centrally, coalesce trailing 150 ms. |
| F9 | Full-screen surfaces are chosen by a nested ternary over independent store fields, outside the keyboard layer model. | `App.tsx` ~330-426 (`reviewSurface ? ... : fleetSurface ? ...`); `uiStore.ts:227-247` (`settingsOpen`, `reviewSurface`, `fleetSurface`, `worktreeInventoryOpen`); `state/keyboard.ts:502-511` (`LayerState`/`topLayer`); PROJECT.md Active WR-02. | HIGH | Replace with one `surface: SurfaceTarget \| null` union that `topLayer` understands, before adding PRD/ADR surfaces. |
| F10 | Draft file-sets are live. `store_submitted_plan` writes `task_file_set_entries` at *draft* time, attributed to the agent actor, before the human approves. Effect is restrictive only (a scope hook denies writes outside the set; an empty set runs alone), but a manual launch between draft and approval arms the hook with an unreviewed scope. | `dispatch_plan.rs:1131`, `sidecar.rs:984-1001`. | HIGH | Accept it, but show "drafted by the planner" provenance in the editor (derivable from the `task.file_set_declared` event actor). No schema change. |
| F11 | The `board:changed` consumers, `commands/*` roster and the capabilities description string are each maintained by hand. The capabilities JSON says its roster is "kept here for auditability". | `capabilities/default.json` description; `main.rs` has 148 `commands::` entries. | HIGH | Treat the roster string as documentation. The enforcement point is `generate_handler!`. |

---

## 3. Decision 1 - Schema and domain model

### 3.1 What BOARD-01 actually rests on

The brief says the spine is enforced "by CHECK constraints rather than app code". That is only partly true, and the precise answer decides the design.

- **Depth is structural, not a CHECK.** `epics` has no parent column. `tasks.epic_id` references `epics` only (nullable, `0002:58-77`). `issues` carries `epic_id` and `task_id` (`0002:79-91`). There is no `level` column and no place to add a level.
- **States and kinds are CHECKs.** The five workflow states on `epics` and `tasks`, `priority BETWEEN 0 AND 4`, `estimate IN (1,2,3)`, issue `kind IN (...)`.
- **Issue parent exclusivity is application code** (`issue::set_parent`, `domain/mod.rs` `assert_parent_in_project`), tested by `hierarchy_workflow.rs`.
- **Same-project integrity is application code too**, and `domain/mod.rs` says it "has nowhere else to live" because the original FKs are single-column.

So the guarantee that matters is: *no table, column or setting exists that adds a level or a state*. Adding `epics.phase_id` is the first time an epic would carry a parent pointer. Whether or not you call that a fourth level, it is the one change that makes the claim arguable. A link table keeps all three spine tables byte-identical.

**Recommendation: add a frozen-schema test.** Read `sqlite_master` for `epics`, `tasks`, `issues`, and compare against a golden string. It is about 20 lines, it fails the day someone alters the spine, and it turns "untouched since 0002" from a historical accident into a rule.

### 3.2 Separate tables, not a generic document table

Recommend `phases`, `prds`, `prd_revisions`, `adrs` and link tables, not one `documents` table.

| Concern | Separate tables | Generic `documents(kind, ...)` |
|---|---|---|
| Status vocabulary | Own CHECK per table, matching the repo's idiom (`0002`, `0004`, `0005`, `0017`, `0018`: "the CHECK, not app code, is the authority") | One CHECK must be a union, or a table-level `CASE kind`. Weaker, and it lets a PRD carry an ADR status |
| Lifecycle | PRD: revisioned, signed. ADR: frozen once accepted, superseded by a *new* ADR. Different invariants | Shared columns that mean different things per kind |
| Links | PRD to epic is 1:N; ADR to PRD is N:1; ADR to epic is N:M; ADR to ADR is a supersede edge. Each gets real foreign keys | Polymorphic `(target_type, target_id)` with no FK, the shape `acceptance_criteria.parent_id` already has and 0018 had to work around |
| Writers | One owner module per entity, matching `task.rs`/`epic.rs`/`issue.rs`/`acceptance_criterion.rs` | One module with a `match kind` |
| Cost | Three small modules | Less SQL, more branching |

The only shared machinery worth reusing is the revision pattern already proven by `acceptance_criteria` (`revision`, `revision_of`, `superseded_at`, `0009:28-30`) and session summaries (append-only, CTX-02).

### 3.3 Recommended DDL (sketch, not final)

Table names deliberately do not start with `epics`, `tasks`, `issues` or `acceptance_criteria`, so they cannot collide with the literal-substring patterns in the Phase 6 gate (`proposal_no_promotion.rs:81-87`).

```sql
-- 0023_phases.sql  (additive)
CREATE TABLE phases (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    goal TEXT,
    rank TEXT NOT NULL,                 -- the repo's fractional rank; display ordinal "Phase 3" is derived from it
    archived_at TEXT,                   -- mirrors epics.archived_at; NO status column (derive, see below)
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (project_id, id)
);
CREATE UNIQUE INDEX ux_epics_project_id ON epics (project_id, id);   -- an INDEX; the epics table DDL is unchanged
CREATE TABLE phase_epics (
    epic_id TEXT PRIMARY KEY NOT NULL,  -- an epic is in at most one phase
    phase_id TEXT NOT NULL, project_id TEXT NOT NULL, rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id), created_at TEXT NOT NULL,
    FOREIGN KEY (project_id, epic_id)  REFERENCES epics  (project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, phase_id) REFERENCES phases (project_id, id) ON DELETE CASCADE
);
```

I ran the composite-FK-to-unique-index pattern in SQLite 3.51: inserting an epic from project `p1` under a phase from `p2` is rejected by the database. This closes the same-project gap for the new tables without app code. (The bundled engine is `libsqlite3-sys 0.38.2` per `Cargo.lock`; the CLI I tested with is 3.51.0. Re-run the three probes in the repo's own test harness before relying on them.)

```sql
-- 0024_documents.sql  (additive)
CREATE TABLE prds (
    id ..., project_id ..., title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed_off')),
    current_revision_id TEXT, signed_revision_id TEXT,
    signed_by TEXT REFERENCES actors(id), signed_at TEXT, archived_at TEXT,
    created_by ..., created_at ..., updated_at ..., UNIQUE (project_id, id),
    CHECK ((status = 'signed_off') = (signed_revision_id IS NOT NULL AND signed_by IS NOT NULL AND signed_at IS NOT NULL))
);
CREATE TABLE prd_revisions (          -- append-only; an UPDATE trigger aborts
    id ..., prd_id TEXT NOT NULL REFERENCES prds(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, body TEXT NOT NULL,
    agent_run_id TEXT REFERENCES agent_runs(id),     -- provenance, as session_summaries has
    created_by TEXT NOT NULL REFERENCES actors(id), created_at TEXT NOT NULL,
    UNIQUE (prd_id, revision)
);
CREATE TABLE prd_epics (epic_id TEXT PRIMARY KEY, prd_id TEXT, project_id TEXT, composite FKs as phase_epics);

CREATE TABLE adrs (
    id ..., project_id ..., prd_id TEXT,  -- nullable, composite FK to prds(project_id,id): ADR belongs to at most one PRD
    title TEXT NOT NULL, context TEXT, decision TEXT, consequences TEXT,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','superseded','rejected')),
    superseded_by TEXT REFERENCES adrs(id),
    proposed_by_run_id TEXT REFERENCES agent_runs(id), rationale TEXT, origin_log_offset INTEGER,  -- PROP-07 parity
    decided_by TEXT REFERENCES actors(id), decided_at TEXT,
    created_by ..., created_at ..., updated_at ..., UNIQUE (project_id, id),
    CHECK (superseded_by IS NULL OR status = 'superseded'),
    CHECK ((status IN ('accepted','superseded','rejected')) = (decided_by IS NOT NULL))
);
CREATE TABLE adr_epics (adr_id TEXT, epic_id TEXT, project_id TEXT, PRIMARY KEY (adr_id, epic_id), composite FKs);
-- plus prds_fts / adrs_fts external-content indexes and their 3 triggers each, per 0002's pattern.
```

Two authority triggers (verified in SQLite: a non-human `decided_by` is aborted, and an accepted ADR's body cannot be edited):

```sql
CREATE TRIGGER adrs_authority BEFORE UPDATE OF status ON adrs
  WHEN NEW.status IN ('accepted','superseded','rejected')
   AND (SELECT type FROM actors WHERE id = NEW.decided_by) IS NOT 'human'
BEGIN SELECT RAISE(ABORT, 'authority transition requires a human actor'); END;
CREATE TRIGGER adrs_frozen BEFORE UPDATE OF context, decision, consequences ON adrs
  WHEN OLD.status IN ('accepted','superseded')
BEGIN SELECT RAISE(ABORT, 'an accepted ADR is immutable; supersede it with a new one'); END;
-- same shape for prds.signed_revision_id / signed_by, and for prd_revisions (any UPDATE aborts).
```

The PRD's acceptance bar is the one place reuse costs a rebuild (section 3.5). The `agent_runs` and `review_findings` additions are in 5.1 and section 7.

### 3.4 Phase: a grouping record, not an attribute on an epic

Recommend a **grouping record with a link table** (`phases` + `phase_epics`), for five reasons:

1. `epics` stays byte-identical, so BOARD-01 and `hierarchy_workflow.rs` need no re-argument.
2. Membership has its own attribute (`rank` within the phase) and its own events (`phase.epic_added`), which a nullable column cannot carry.
3. `domain/epic.rs` is one of the four Phase 6 canonical writers. A `phase_id` column would widen its surface and the gate's allow-list rationale. A new `domain/phase.rs` owns phase writes.
4. Deleting a phase touches only `phase_epics`. No epic row is updated.
5. Nothing about a phase is *stored* that can be derived. There is no `phases.status`. Planned / active / done come from folding `board_epic_progress` over the phase's epics, the same discipline as Phase 10 ("nothing writes `worktrees.status = 'stale'`, so there is no populator to drift", PROJECT.md).

**Roadmap progress must fold `board_epic_progress` (all tasks), never the 200-row board window.** `epic_progress.rs:1-9` already records that mistake ("a 200-row page over 920 real rows ... plausible and wrong").

**PRD to phase is not an edge.** PRD to epic is a link (`prd_epics`) and phase to epic is a link (`phase_epics`), so a PRD's phases are derived through its epics. A stored PRD-to-phase edge would be a second source of the same fact. If "this phase is for PRD X before any epic exists" is wanted, add a nullable `phases.prd_id` later (`ADD COLUMN` on a table we own).

**ADR linkage:** ADR to PRD is `adrs.prd_id` (N:1). ADR to epic is `adr_epics` (N:M). An ADR with no epic rows is project-wide. ADR supersession is `superseded_by`.

### 3.5 Migration strategy

The mechanics, from the code:

- Migrations are an ordered `include_str!` list in `db/mod.rs:20-45`, appended with `M::up` only. Reversibility is the pre-migration backup restored on failure (`db/mod.rs:81-90,158-182`), with `PRAGMA foreign_keys` OFF around the whole run (`:131`) and `foreign_key_check` plus `integrity_check` after. See F7.
- `tests/migration_safety.rs:40` builds its N-1 fixture from `migration_sources()`, so a new file is picked up automatically. Add one data-preservation test per rebuild, modelled on `migration_0015_rebuild_preserves_self_referential_parent_link` (`:305`).

Proposed files (each isolates a failure to one reviewable unit; restore is whole-file regardless):

| File | Kind | Content |
|---|---|---|
| `0023_phases.sql` | additive | `phases`, `phase_epics`, unique index on `epics (project_id, id)` |
| `0024_documents.sql` | additive | `prds`, `prd_revisions`, `prd_epics`, `adrs`, `adr_epics`, FTS, triggers |
| `0025_run_kinds.sql` | additive | `agent_runs.kind`, `.prd_id`, `.review_task_id` (columns below), `review_findings`, backfill `UPDATE`s |
| `0026_criteria_prd_parent.sql` | rebuild | `acceptance_criteria.parent_type` gains `'prd'` |

`agent_runs` without a fourth rebuild. This is the part of the plan that changes what the earlier migrations assumed. `0009:6-8` says SQLite's `ADD COLUMN` "cannot attach a CHECK constraint". That was true of old SQLite and is not true now. I ran this against SQLite 3.51 and it works, including a CHECK that references sibling columns and an FK on the new column:

```sql
ALTER TABLE agent_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'execution'
  CHECK (kind IN ('execution','authoring','planning','prd_authoring','review'));
UPDATE agent_runs SET kind = 'authoring' WHERE authoring_stage IS NOT NULL;
UPDATE agent_runs SET kind = 'planning'
  WHERE authoring_stage IS NULL AND task_id IS NULL AND epic_id IS NOT NULL;
ALTER TABLE agent_runs ADD COLUMN prd_id TEXT REFERENCES prds(id)
  CHECK (prd_id IS NULL OR (task_id IS NULL AND epic_id IS NULL));
ALTER TABLE agent_runs ADD COLUMN review_task_id TEXT REFERENCES tasks(id)
  CHECK (review_task_id IS NULL OR (task_id IS NULL AND epic_id IS NULL AND prd_id IS NULL));
```

The sibling-column CHECKs keep `0010`'s "a run has at most one subject" rule (`CHECK (NOT (task_id IS NOT NULL AND epic_id IS NOT NULL))`) without rebuilding. A later rebuild of `agent_runs` must carry these forward; note that in the migration header.

**The review subject is deliberately NOT `task_id`.** If a review run set `task_id`, it would flow into `SUMMARIES_SQL` (`context_packet.rs:219-221`, `WHERE task_id = ?1`) and pollute the next *execution* session's reconstituted context, and it would displace the execution run in the fleet's "latest run per task decides" subselect (`query/fleet.rs:126`) and trip the `HasLiveRun` and `declare_refusal` guards. A separate subject column is safe by default. The cost is that the fleet must be taught to show it, which is the right failure direction (visible-by-addition beats polluting-by-default).

**The one rebuild.** `acceptance_criteria.parent_type CHECK IN ('task','epic')` must gain `'prd'` so a PRD's acceptance bar reuses the whole criteria engine: individually checkable items (BOARD-02), the revision chain, anchors, and the existing Phase 6 protection (`INSERT INTO acceptance_criteria` is already gated to one module). The cost is the usual rebuild hazards: column order must be preserved (the 0018 header says criteria are built from positional reads in "about eight places"), `criterion_anchors` has a cascading FK into it, and the two indexes must be recreated (`0010`/`0006` lesson).

*Fallback if the owner objects:* a separate `prd_bar_items` table with its own check/revise logic. That duplicates about 1,100 lines (`acceptance_criterion.rs`) and splits "what counts as a criterion". I do not recommend it. If the PRD bar can be flat checklist text, `0026` disappears; that is a product decision for requirements (section 12).

**Do not rebuild `authoring_proposals`.** See 5.2: every new proposal shape fits under the existing `target_type` values by adding payload variants, so its CHECK is untouched. This matters because `0016`'s header says any future rebuild "MUST drop and re-create" `authoring_proposals_fts` and its three triggers and re-run `'rebuild'`, and the table holds decided rows forever (D-83).

### 3.6 Events and search

New `stream_type` values `'phase'`, `'prd'`, `'adr'` use the existing `{field, before, after, label}` payload idiom (`authoring_proposal.rs:530-545`). Set `events.epic_id` for link events so an epic's activity trail shows "linked to PRD / put in Phase 2" (D-19: denormalised at write time). PRD revision events carry the revision id and a short summary, not the body.

---

## 4. Decision 2 - The canonical-writer regime

### 4.1 What the Phase 6 gate actually protects

`proposal_no_promotion.rs` has five parts:

- **Gate 1** (`:99-165`): no file under `packages/core/src`, `src-tauri/src` or `packages/sidecar/src` contains `INSERT INTO epics|tasks|issues|acceptance_criteria` or `UPDATE acceptance_criteria` outside four allow-listed modules (`:92-97`). Literal substrings, comments skipped. (PROJECT.md says the scan includes `packages/desktop/src`; the code scans `sidecar/src` instead, and Gate 3 only proves the walker reaches the frontend tree. Minor doc drift.)
- **Gate 2** (`:185-232`): in `authoring_proposal.rs`, only `materialise_proposal`, `accept_proposal_in_tx` and `merge_proposal_in_tx` may call a canonical `_in_tx` writer.
- **Gate 4** (`:267-292`): `domain/issue.rs` has no `status` identifier.
- **The adversarial corpus** (`:461-1183`): 17 labelled cases proving zero canonical rows before a human triage action.

The *property* it protects is PROP-03: an agent-reachable path cannot turn something an agent produced into authoritative board substance without a human act.

### 4.2 Do PRD, ADR and phase records need the same protection?

They need the same *property*, but not the same *mechanism*, because the threat model differs in a way that cuts in the design's favour.

- For spine rows, "real" means "the row exists", so promotion = INSERT, and the only way to stop it is to stage.
- For a PRD or ADR, "real" means **authoritative**, i.e. "a human signed or accepted revision N". A draft PRD or a `proposed` ADR is already a non-authoritative state with its own name. Letting the agent write the draft directly is safe *iff* nothing consumes a draft as if it were authoritative and the transition to authoritative is human-only.

So the protection moves from "no direct write" to "**authority is a human-only transition on an immutable revision**":

1. **Immutability.** `prd_revisions` rows are append-only (UPDATE aborts by trigger). An accepted ADR's text is frozen by trigger. An agent edit after sign-off makes a new draft revision; it cannot change what was signed. This is BOARD-03's rule ("criteria immutable once work starts; change creates a revision") applied to documents.
2. **Sign-off names a revision.** `sign_off_prd(prd_id, revision_id, human)` fails if `revision_id` is not the current one. If the agent edits between the human reading and clicking, the sign-off is refused. This is the same "undecidable, never silently applied" stance as `ProposalUndecidable` (`authoring_proposal.rs:716`).
3. **DB-enforced human-ness.** The triggers in 3.3 require `decided_by`/`signed_by` to reference an actor with `type = 'human'`. Today "human-only" is a convention of the command layer (`actor.rs:14-30` resolves the actor server-side; `advance_stage`'s "no agent-reachable caller" is a comment, D-90). A trigger is a stronger structural form than Phase 6 used. I verified the abort behaviour in SQLite.
4. **Drafts are never consumed.** The only reader that feeds an agent's context is `governing_documents_for(...)`, which selects `signed_revision_id` PRDs and `accepted` ADRs. A test asserts a draft/proposed record never appears in either packet.
5. **A generalised source gate.** Replace the hand-listed constants with a registry and one gate that iterates it:

```rust
// tests/authority_registry.rs (new). One entry per agent-writable store.
struct Store { tables: &'static [&'static str], owner: &'static str,
               authority_fns: &'static [&'static str] }
const REGISTRY: &[Store] = &[
  Store { tables: &["epics","tasks","issues","acceptance_criteria"], owner: /* the existing four */, authority_fns: &[] },
  Store { tables: &["prds","prd_revisions"], owner: "src/domain/prd.rs", authority_fns: &["sign_off_prd"] },
  Store { tables: &["adrs"],                 owner: "src/domain/adr.rs", authority_fns: &["accept_adr","reject_adr","supersede_adr"] },
  Store { tables: &["review_findings"],      owner: "src/domain/review_finding.rs", authority_fns: &[] },
];
// Gate A: INSERT/UPDATE of any table in a Store appears only in its owner (Phase 6 Gate 1, generalised).
// Gate B: no authority_fn is called from an agent-reachable file: sidecar/src/*, any `handle_inbound_*`
//         function body (sidecar.rs, commands/authoring.rs), or an MCP tool handler (Phase 6 Gate 2's
//         top-level-fn tracking, reused).
// Gate C: the walker reaches the same three trees (guards against the dead-gate failure Gate 3 exists for).
```

**Phases and review findings** need only Gate A. A phase is a human organising act with no agent-facing write tool in v0.2.0 (an agent suggesting phase placement can ride an `epic` proposal later). A review finding is an annotation with no authority.

**What does not change.** Spine rows an agent causes to exist as a *consequence* of a PRD session (epics, tasks, criteria) still go through `authoring_proposals` and the unchanged Phase 6 gates. The PRD session stages them with the existing `propose_epic` etc.

### 4.3 Should agent-authored PRD/ADR content use `authoring_proposals`?

No, for the bodies. Argued from the code:

| Property | `authoring_proposals` | What a PRD/ADR body needs |
|---|---|---|
| Content bound | `validate_payload` caps title at 500 and text at 1000 chars (`authoring_proposal.rs:1394-1402`) | A PRD is pages; an ADR is paragraphs |
| Unit of decision | One item, decided once, then terminal (D-83: a rejected row is never re-proposed) | A document is co-edited many times in one session by two actors |
| Volume policy | Hard cap per run counting every status (`:406`) | Revisions are cheap and expected; the cap would throttle normal editing |
| Edit surface | `ProposalAmendEditor` edits discrete payload fields | A long-form editor with revision history and actor badges |
| Staging a staging | Accept would create a `prds` row from a pending row, so the "draft" the human co-edits would have to live somewhere else anyway | `prds.status = 'draft'` *is* the staging state |
| Triage surface | `TriageSurface` lists pending proposals | Needs a PRD surface; proposed ADRs additionally need to appear in the triage inbox |

For the inbox, add a **read-side union** (`query::inbox`: pending proposals plus `adrs WHERE status = 'proposed'`), so the human still has one place to adjudicate without forcing one table. This keeps `TriageSurface`'s single-queue promise (PROP-06) and avoids a second staging layer.

**Agent-proposed ADRs mid-execution.** A new execution-run tool `propose_decision` (pre-approved in `--allowedTools` exactly like `propose_item`, D-98) creates an `adrs` row in `proposed` with `proposed_by_run_id`, `rationale` (required) and `origin_log_offset` resolved server-side from the session log (T-06-02's discipline: identity and turn pointer come from the run row, never from tool arguments). A per-run cap is counted in the same transaction (mirror D-110; a small constant, e.g. 3, as an owner decision). Duplicate-flagging against existing ADR titles (including rejected and superseded ones) uses `adrs_fts`, so an agent cannot re-propose a decision the human already refused (the D-83 / D-106 reasoning).

---

## 5. Decision 3 - One adjudication mechanism, or several?

### 5.1 What the code says today

The brief's premise ("at least two bespoke implementations") is half right. Reading both:

| Layer | SHAPE (Phase 5) | Triage (Phase 6) | Same or different? |
|---|---|---|---|
| Store | `authoring_proposals` | `authoring_proposals` (widened by `0015`) | **Same table** (D-97) |
| Adjudication core | `accept_proposal_in_tx` / `materialise_proposal` (`:971`, `:806`) | same, plus `merge_proposal_in_tx` / `defer_proposal_in_tx` | **Same functions** |
| Staging entry | `create_proposal` (direct call from `commands/authoring.rs`) | `apply_proposal_created` (sidecar event, `:608`) | Two thin doors into `create_proposal_in_tx` |
| Run-kind policy | none | `PROPOSAL_LIMIT_PER_RUN` (see F1) | One policy applied to both by accident |
| Agent tools | six `propose_/amend_/delete_` tools (`mcp-permission-server.ts:120`) | one `propose_item` | Different, by D-98's design |
| UI | `ProposalTray` | `TriageSurface` + `TriageLane` | **Same row**: `ProposalRow` is reused by all three hosts; only `groupProposals` is triplicated byte-for-byte |

So the generalisation question is mostly already answered: there is one store and one core. What is bespoke is the tool surface (a tool per target type) and the closed set of shapes the core can materialise.

### 5.2 Recommendation: extend the one mechanism for spine drafts; give documents, plans and findings their own stores under a shared invariant

**Extend `authoring_proposals`, without a rebuild, for the four spine paths:**

| Path | Today | Change |
|---|---|---|
| Task decomposition (titles/bodies) | `create`/`Task`, `amend`/`Task{title,description}` | none; works |
| Acceptance criteria on a new task | `create`/`Criterion` with `parent_proposal_id` | none; works |
| **Acceptance criteria on an existing task** | not representable (F3) | allow `target_id` = parent task/epic/PRD id on `create`/`Criterion`; `materialise_proposal` takes the parent from it when no parent proposal exists. This is the entry point for "draft criteria for this task" |
| **Status / priority / estimate** | `amend`/`Task` only changes title and description (`:898`) | new payload variants `TaskFields { status?, priority?, estimate? }` and `EpicFields {...}` under the *existing* `target_type` `'task'`/`'epic'`. The `kind` discriminator is JSON, not a CHECK, so no rebuild. Needs the `_in_tx` setters from F4 |
| **Epic created from a PRD session** | `create`/`Epic` | the run's `agent_runs.prd_id` (read from the run row in-transaction, never from the payload) makes `materialise_proposal` also call `prd::link_epic_in_tx` |

**Restrict what an agent may propose for `status`.** `in_progress`, `in_review` and `done` are driven by run lifecycle and git/forge state (LINK-07). An agent-drafted status may only be `backlog` or `todo`. Priority and estimate are unrestricted. Enforce in `validate_payload`, not in the prompt.

**Keep these out of the table, but under one invariant:**

| Store | Why not `authoring_proposals` | Adjudication |
|---|---|---|
| File-sets | Live enforcement semantics, version history already in events, adjudicated per *plan* (approve), edited per entry. Moving them would add a second path to a thing the dispatcher reads directly | Plan approval, unchanged |
| PRD / ADR | Section 4.3 | Human-only transition on an immutable revision |
| Review findings | Annotations, derived-stale, never promote to anything | Human `check` action, unchanged |

**The unifying thing to build is the invariant plus its test, not a runtime abstraction.** Every agent-writable store must satisfy four properties, listed in the registry gate from 4.2:

1. Writes are actor-attributed and append an event in the same transaction (DATA-01, DATA-03).
2. Authority (promotion / sign-off / accept) is reachable only from a human-actor command.
3. Volume per run is bounded in the same transaction as the write.
4. Nothing authoritative reads the non-authoritative state.

This is the conservative answer to "premature generalisation vs six divergent implementations": one place where divergence is *detected* (the registry test) without forcing a shared Rust trait that three different data shapes would only distort. A `trait Adjudicable` has no behaviour all four stores share beyond what the four properties already say.

**Tripwire for revisiting.** If a seventh agent-writable store appears, or `materialise_proposal`'s `match (verb, payload)` grows past roughly 12 arms, split it by target type into per-type materialisers behind the same three allowed call sites. Do not do it now.

### 5.3 The two policies that must become functions of run kind

1. **Proposal cap** (F1). Replace the single constant with a compile-time function of kind, still not a setting (D-109's reasoning stands):

```rust
pub const fn proposal_limit(kind: RunKind) -> usize {
    match kind { RunKind::Execution => 10,                      // D-109 unchanged: unattended
                 RunKind::Authoring | RunKind::PrdAuthoring => 100, // a human gates every stage (D-90)
                 _ => 0 }
}
```

The 10 exists to protect *unattended* triage attention. An authoring session is attended and stage-gated, so it does not apply. This amends D-109 and must be recorded as an owner decision. Fix the refusal wording per kind at the same time.
2. **Tool set and hooks** (5.4).

### 5.4 Run-kind profile (sidecar)

Run kind is currently encoded as optional parameters on `buildClaudeArgv` (`summaryToolName`, `proposeItemToolName`, `submitPlanToolName`, `claude-code-adapter.ts` ~395-440, `:1537-1540`) and a `planning` boolean on the spawn request (`index.ts:203`). With five kinds, replace these with one table keyed by the `kind` the Rust core puts in the spawn request:

```ts
const PROFILES: Record<RunKind, { allowedTools: string[]; stageGate: boolean;
                                   scope: "worktree-armed" | "armed-empty" | "none";
                                   readTools: boolean; permissionMode: "default" | "..." }> = { ... };
```

It is tested by the existing argv tests (`real-claude-argv.test.mjs`). It is the one piece of refactoring this milestone justifies, because the next two features would otherwise each add another optional parameter.

**New tools must follow the prefix convention** so the stage gate covers them for free. `AUTHORING_STAGE_GATE_MATCHER` is `mcp__flywheel-permissions__(propose|amend|delete)_.*` (`claude-code-adapter.ts:174`). A PRD-write tool named `propose_prd_revision` is denied during `challenge` with no hook change. A tool named `write_prd` would silently bypass the Socratic gate. Add a one-line test that every authoring write tool name matches the matcher.

**PRD sessions reuse the three-stage machine** (`challenge` -> `decompose` -> `criteria`, `AUTHORING_STAGES` in `authoring_session.rs`, the stage marker file and `stage-gate-hook.ts`) with a per-kind label map in `SessionSurface.tsx:202-207`: challenge the problem, draft the PRD and propose epics, write the acceptance bar. That avoids rewriting the `authoring_stage` CHECK on `agent_runs`.

---

## 6. Decision 4 - Closing PLAN-01

### 6.1 What exists

The path is complete and tested against a fake backend:

```
EpicDispatchControls.tsx:92  dispatchPlanGenerate(epicId)        "Plan fan-out" button
  -> commands/dispatch.rs:669 start_planning_run
       -> dispatch_exec.rs:271 begin_planning_run   epic integration worktree, scope ARMED over an EMPTY set
       -> spawn {planning: true, permissionMode: "default"}
  -> planner calls HELD submit_plan   (mcp-permission-server.ts:1301-1410)
  -> sidecar.rs:984 process_inbound_submit_plan -> dispatch_plan.rs:1011 store_submitted_plan
       declares file-sets (:1131), creates the draft plan, appends dispatch_plan.drafted
  -> WavePlanSheet shows the draft; the per-task <textarea> (WavePlanSheet.tsx:201) edits it
```

Facts that reframe the task:

- The hand-typed form is an **edit** surface over the planner's draft, not a way to create one. The renderer has no caller for `dispatch_plan_create` (registered at `main.rs:183`, no wrapper in `adapters/tauri.ts`).
- The mechanism was verified against a fake backend only. 09-VERIFICATION marks SC1 / PLAN-01 "PRESENT_BEHAVIOR_UNVERIFIED" and registers it as D-REV-35: needs "a live claude login", and "the run never stalls on a permission prompt; the worktree is clean afterward".
- `scripts/uat/uat-13-fan-out-live.mjs` fakes the model on purpose ("WHAT IS NOT PROVEN: a real model's obedience"). The precedent for a real-model measurement is `scripts/uat/uat-10-agent-backlog.mjs --live`.

### 6.2 What is needed

1. **A live measurement first** (new `scripts/uat/uat-14-plan-live.mjs --live`, modelled on `uat-10 --live`). Assert: a draft with a non-empty file-set and a wave on every task; no `permission_requests` row raised; the epic worktree clean; `submit_plan` called once. Run it before any UI work. This has the longest feedback loop in the milestone and no dependency on anything else, so it should start immediately.
2. **Remove the likeliest stall.** The planning run's `--allowedTools` is exactly `submit_plan` and its permission mode is `default` (`commands/dispatch.rs` `PLANNING_PERMISSION_MODE`). The prompt tells the agent "reading, searching and listing are what it needs" (`epic_context_packet.rs:604-610`). I could not verify how Claude Code's default mode treats `Read`/`Grep`/`Glob` versus `Bash` (LOW confidence, which is why step 1 is a measurement). The safe design does not depend on the answer: (a) the Rust core computes a bounded repository file listing (`git ls-files`, capped) and embeds it in the planning prompt, consistent with CTX-04 (context is a query, not exploration); (b) pre-allow only `Read`, `Grep`, `Glob` for the planning profile; (c) leave `Bash` unlisted so any shell attempt surfaces as an ordinary permission request rather than a silent stall.
3. **Make the draft's provenance visible** (F10). Show "drafted by the planner" on a task whose latest `task.file_set_declared` event is agent-attributed and not followed by a human one. Derive; add no column.
4. **Replace the textarea with per-entry editing** (`WavePlanSheet.tsx:199-221` and the `drafts` state): one row per entry (path, a file/dir badge from `parse_entry`, remove button), one "Add path" single-line input as the escape hatch, validation and refusal text from the core as today (`edit_draft_plan`, `dispatch_plan.rs:827`). Path autocomplete comes from a new read-only core command over the repo index (`git2` is the stack's hot-path read tool; worktree *lifecycle* stays on system `git`). The manual entry survives, but as one input, not a whole-set editor.
5. **Dispose of the dead door.** `dispatch_plan_create` and its `create_plan_for_epic` call (`commands/dispatch.rs:193-210`) serve "the dispatcher usable before [a planner] exists". Once PLAN-01 is live-proven, delete the command (tests at `scheduler.rs:1011` use the domain function, which stays).

**Ordering constraint.** Deleting the textarea is gated on step 1 passing. If the live run shows the planner routinely under-declares, step 4 must also add a per-task "re-plan this task" action before the textarea can go.

---

## 7. Decision 5 - Agent-assisted review

### 7.1 Where it lives

**A new run kind (`review`) driven by the sidecar, with results stored by the Rust core.** Not "in the sidecar" (it never opens the DB) and not "in core" (a model session is the sidecar's job).

- **Session:** `kind = 'review'`, subject `agent_runs.review_task_id` (3.5). A *fresh* session reconstituted from the board, not the executing session, which is the whole thesis: the reviewer has no stake in the author's context. Working directory is the project `repo_path` (as `review.rs:7-9` already requires: "Diffs run against the project repo_path, not a worktree, so review survives worktree removal"), with the scope marker armed over an empty set so any file write is denied, exactly like the planning run (`dispatch_exec.rs:267-294`).
- **Reads go through held calls, not `Bash`.** The agent reads the diff via a new `review_read` kind on the existing board-read channel (`mcp-permission-server.ts`, `board_search`/`epic_get`/`task_list`/`proposal_list` at `:850-910`; resolved in Rust at `query/authoring.rs:711 resolve_board_read`). Its three read kinds call `review::review_file_list` and `review::review_file_patch` (`review.rs:258,269`) and the criteria read. **The agent and the human therefore see the same bytes produced by the same function.** That is the structural answer to "without becoming a second source of truth about the diff". It also avoids a shell, which avoids the permission stall and the destructive-gate surface (Phase 12's lesson: pre-approving "read-only" git commands is how `git --version` got bricked).
  - Note the existing channel is wired for authoring sessions only ("`board_read` is an authoring-session path; an execution or planning run has no caller for it", `claude-code-adapter.ts:1454`). The review and PRD profiles need that callback.
- **Output:** one held tool, `submit_review`, modelled on `submit_plan` (`:1301-1410`). Per criterion: `criterion_id` (validated by Rust to belong to the task's current-revision criteria), `verdict` in `met | not_met | unclear`, `note`, and an optional evidence pointer `{path, side, line_start, line_end}`. **The core resolves `base_sha`/`head_sha` itself; the model never supplies them** (the D-139 rule that `criterion_anchors.sha` "is resolved inside the core, never supplied by the renderer").

### 7.2 Storage and freshness

```sql
-- in 0025_run_kinds.sql
CREATE TABLE review_findings (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    criterion_id TEXT NOT NULL REFERENCES acceptance_criteria(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL CHECK (verdict IN ('met','not_met','unclear')),
    note TEXT NOT NULL,
    path TEXT, side TEXT CHECK (side IS NULL OR side IN ('old','new')),
    line_start INTEGER CHECK (line_start IS NULL OR line_start >= 1),
    line_end INTEGER CHECK (line_end IS NULL OR line_end >= line_start),
    base_sha TEXT NOT NULL, head_sha TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_review_findings_task_criterion ON review_findings (task_id, criterion_id, created_at DESC);
```

Append-only; the newest row per criterion is the current finding. **Nothing here stores diff text.** Freshness is derived on every read using the function that already exists for anchors: `review::anchor_staleness(repo, head, finding.head_sha, finding.path)` (`review.rs:298`), stored nowhere, consistent with `review.rs:3` ("This module stores nothing and caches no verdict") and D-75. `criteria_with_anchors` / `review_criteria_state` (`review.rs:362,464`) gain a `finding: Option<...>` next to `anchor` and `staleness`.

### 7.3 How a verdict reaches the review surface, and what it may do

- `CriteriaRail.tsx` (110 lines) renders the finding beside each criterion: a glyph and a word (met / not met / unclear), the note, the evidence pointer as a jump target into `FileDiff.tsx`, and "stale" when the derived staleness says the code moved.
- "Check with this evidence" calls the **existing** `check_criterion_with_anchor` (`acceptance_criterion.rs:673`) with a *human* actor and the finding's pointer pre-filled as the anchor. **That is the only thing that sets `checked`.** A finding never does.
- A `not_met` verdict is advisory. It is shown in `DecisionFoot.tsx` ("agent flagged 2 criteria") but never holds a merge. If it could, the agent would be an authority, and the registry's property 2 would be violated.
- Trigger: a manual "Pre-review" button in `ReviewSurface` first. Auto-run on completion is an opt-in setting, default off, because a run costs money and AGNT-05 (rate-limit observation) is still unobserved live.

### 7.4 Places that must become kind-aware

A review run must not be mistaken for an execution run: the fleet's latest-run subselect (`query/fleet.rs:126`) and `awaiting_review` derivation (`:108-111`) read `task_id`, which the review run does not set (3.5), so nothing changes there by default. The fleet needs one addition to *show* a running review. `RunsSection.tsx` and `runStatus.ts` need a kind label. `session_summaries`: a review run must either not write a summary row or write one with no `task_id`, so it can never enter `SUMMARIES_SQL`. Add a test that a completed review run leaves `assemble_context_packet(task)` byte-identical (the five-cycle harness `five_cycle_reconstitution.rs` is the model).

---

## 8. Decision 6 - Theming for a dark-first direction

### 8.1 The tension is a recorded decision

The conflict is not only the comment "meaning never rests on colour" (`legend/marks.ts:35`, `runStatus.ts:7`, `BoardRow.tsx:443`, and about ten more). It is a ruling:

> `08.1-DIRECTION.md` section 2 (D-11): "Nothing else is coloured. **No tinted rows. No status fills. No pills with backgrounds.** ... colour was only ever the redundant third channel and now it is not even that."

and an enforcement layer built to make that ruling mechanical:

| Enforcer | What it encodes | File |
|---|---|---|
| Brand-rule allowlist | colour is spent only where the spec lists, counts per file, "widen both together, or neither" | `theme/__tests__/brand-rule.test.ts:30-60` (**currently failing, F2**) |
| No coloured side border at 2px or more except selection | also an Impeccable craft-floor ban | same file, assertion 2 |
| One scheme rule, no `[data-theme]` | prevents a second mechanism drifting | `review/__tests__/browser/legibility.browser.test.tsx:253-262` |
| Block-aware drift check on the dark `@media` block | a wrong dark value cannot hide behind a right light one | `theme/__tests__/contrast.test.ts:90,101,430` |
| "No token declared identically in both modes" | the `--focus-ring` lesson | `contrast.test.ts:341-370` |
| Legend completeness: "no mark may exist that the legend does not define" | `legend/marks.ts` header | `legend/` tests |

The new direction ("colour carrying real state signal", saturated accents, dark-first) **supersedes D-11 and widens D-12**. That must be a named decision in a new direction document with a SUPERSEDES table, as 08.1 did for 01-UI-SPEC. It is not a refactor. Every row above is amended in the same plan as the decision, never quietly worked around.

### 8.2 What has to change structurally

**T1. A semantic state layer between components and palette.** Today colour roles attach per vocabulary: `RUN_STATUS_COLOR_ROLES` maps run status straight to CSS variables (`runStatus.ts:50-58`); dispatch states are printed words (`WavePlanSheet.tsx:43-58`, `dispatch.css:3`); board statuses are colourless (`--strip-*` are aliases of the ground, `tokens.css`); forge states are words (`ForgeSection.tsx:46`); *merged* has no colour role at all. Introduce a small class set (running, needs-you/blocked, failed, done, merged, idle) and one registry, `legend/stateClasses.ts`, that every vocabulary maps into. `RUN_STATUS_COLOR_ROLES` becomes derived from it.

**T2. Four tokens per class, not one.** Existing roles are text-only (`--success-text-rack` etc.). A state signal needs: `-ink` (text, at least 4.5:1 on ground, surface and the wash), `-fill` (glyph, dot, bar, at least 3:1 non-text), `-wash` (low-chroma row or pill background, with `-ink` and primary text at least 4.5:1 on it), `-on-fill`. Do **not** add a 2px coloured side rule for state: the brand-rule test forbids it. Use glyph colour plus wash.

**T3. Mirror in `theme/tokens.ts`.** `Palette` is typed per mode (`tokens.ts:14-60`), so a class missing in one mode does not typecheck, and `contrast.test.ts` iterates `MODES`. Extend the assertions: ink on every surface and wash, fill against surfaces, and **pairwise distinguishability of the state fills under simulated protan/deutan/tritan vision, computed in the test** (the codebase's standard: "the table is not the proof, a runnable assertion is"). Set the threshold from the first measurement and pin it, as the 08.1 plan did for the brand lift.

**T4. Derive saturated dark values by search, not by eye.** The repo already does this for the dark brand text lift (`tokens.css:125-132`: hue held, saturation held, lightness stepped 1% until 4.5:1 on the worst dark surface). Saturated blue, violet and red have low luminance on near-black, so text roles need a lightness lift while fills keep full saturation. Keep `--text-primary-rack` at `#ededed`, not white: pure white on `#0a0a0a` at "high contrast" invites halation.

**T5. Dark-first mechanism.** Today `:root` holds light and the single `@media (prefers-color-scheme: dark)` block (`tokens.css:118`) overrides it. Two options:

| Option | Change | Blast radius |
|---|---|---|
| **A (recommended)** swap which mode is the base: `:root` holds dark, `@media (prefers-color-scheme: light)` holds light | the one-scheme-rule test keeps its shape; `contrast.test.ts` `DARK_BLOCK_START` and the block parsing flip; `tokens.ts` header comment; browser tests keep using `matchMedia` | small |
| B explicit `[data-theme]` set before first paint from a persisted setting | cleaner for a "force dark" product and for user override | the "no `[data-theme]`" assertion is inverted, `DARK_BLOCK_START` and about eight `*.browser.test.tsx` files that read `matchMedia` for the expected mode change |

Option A satisfies "authored dark first". It does not *force* dark on a light-OS machine. Whether the product should force dark is a requirements question (section 12). If yes, B is the honest mechanism.

**T6. Reconciling "meaning never rests on colour" with colour carrying state.** WCAG 1.4.1 forbids colour as the *only* visual means. The new direction makes colour the *fastest* means, not the only one. Make that a mechanical invariant, in this codebase's own style:

- One component, `<StateMark state=...>`, is the **only** consumer of `--state-*` tokens. It always renders the mark glyph (from `legend/marks.ts`) and the printed word or an accessible name. A component cannot spend state colour without the glyph and the word because it cannot reference the token directly.
- A source gate (same pattern as `brand-rule.test.ts`) fails if a `--state-` custom property appears in any file other than `StateMark`, `legend/stateClasses.ts`, `styles/tokens.css` and `theme/tokens.ts`.
- `@media (forced-colors: active)` and `prefers-contrast: more` blocks fall back to glyph and word only. Add a browser test for each.
- Dense rows keep the glyph plus an accessible name when width forbids the visible word (existing practice, `BoardRow.tsx:260-261,443`).

Colour then does what the owner wants (scanning a fleet of agents at a glance) and the guarantee the codebase states is preserved by construction rather than by comment.

**T7. Order.** T1, T2, T3 and the amended gates are structure and should land *before* the new surfaces are built, so the roadmap region, PRD surface and review overlay are born on state tokens. The visual polish round that "follows the IA" is only the application of values on top (section 11).

---

## 9. Component inventory

### 9.1 New

| Layer | Component | Path |
|---|---|---|
| Core domain | phase owner | `packages/core/src/domain/phase.rs` |
| | PRD owner (revisions, `sign_off_prd`, `link_epic_in_tx`) | `.../domain/prd.rs` |
| | ADR owner (`propose`, `accept_adr`, `reject_adr`, `supersede_adr`) | `.../domain/adr.rs` |
| | review finding owner | `.../domain/review_finding.rs` |
| | run kind enum and `proposal_limit(kind)` | `.../domain/agent_run.rs` (or `run_kind.rs`) |
| Core query | phase roster and progress fold | `.../query/phase.rs` (folds `epic_progress.rs`) |
| | inbox union | `.../query/inbox.rs` |
| | governing documents for packets | `.../query/documents.rs` |
| Core other | PRD session prompt, `begin_review_run`, planning file listing | `.../epic_context_packet.rs` (+ `prd_context_packet.rs`), `dispatch_exec.rs` |
| Migrations | `0023`..`0026` | `.../db/migrations/` and registered at `db/mod.rs:20-45` |
| Tauri commands | `phase_*`, `prd_*`, `adr_*`, `review_prereview_start`, `repo_paths_search` | `src-tauri/src/commands/{phase,prd,adr}.rs`; review additions in `review.rs`; registered in `main.rs` |
| Sidecar | run-kind profile table; PRD, ADR and review tools; `review_read` kind | `sidecar/src/run-profiles.ts`; split new tool definitions out of the 1,683-line `mcp-permission-server.ts` into `sidecar/src/tools/*.ts` |
| Renderer | roadmap region (home view) | `desktop/src/roadmap/RoadmapRegion.tsx`, `usePhases.ts` |
| | PRD surface | `desktop/src/prd/PrdSurface.tsx` (+ revision list, sign-off bar) |
| | ADR surface and list | `desktop/src/adr/AdrSurface.tsx` |
| | file-set editor | `desktop/src/dispatch/FileSetEditor.tsx` |
| | review finding overlay | inside `desktop/src/review/CriteriaRail.tsx` |
| | state vocabulary and mark | `desktop/src/legend/stateClasses.ts`, `desktop/src/legend/StateMark.tsx` |
| | surface union | `desktop/src/state/surface.ts` |
| Tests/gates | authority registry gate; spine frozen-schema test; run-kind policy; draft-never-consumed; `uat-14-plan-live.mjs`; state-token source gate | `core/tests/`, `desktop/src/theme/__tests__/`, `scripts/uat/` |

### 9.2 Modified

| Path | Change |
|---|---|
| `core/src/domain/authoring_proposal.rs` | limit by kind (`:319,:406`); criterion `create` with `target_id` parent (`:836-839`); `TaskFields`/`EpicFields` payload variants and `validate_payload` bounds (`:134-152, :1402`); epic-create links to PRD (`:806+`) |
| `core/src/domain/{task,epic}.rs` | add `set_priority_in_tx`, `set_estimate_in_tx` (F4) |
| `core/src/domain/authoring_session.rs` | `start_authoring_run` takes a kind and optional `prd_id`; stage labels per kind |
| `core/src/context_packet.rs`, `epic_context_packet.rs` | bounded "governing PRD bar" and "accepted ADRs" sections, signed/accepted only; keep CTX-04 determinism |
| `core/src/drift.rs` | optional fifth detector: a governing ADR superseded, or PRD signed revision moved, since the run's pin (cf. `CriteriaRevisionMoved`) |
| `core/src/review.rs` | `finding` on `CriterionReviewState`; `criteria_with_anchors` |
| `core/src/query/fleet.rs`, `authoring.rs`, `commands/{authoring,dispatch}.rs`, `dispatch_plan.rs:1192` | the four shape-inference sites move to `kind =` (F6); fleet shows review runs |
| `core/src/domain/dispatch_plan.rs` | no logic change; planning prompt gains a file listing |
| `sidecar/src/{claude-code-adapter,index,adapter}.ts` | profile table replaces optional tool parameters; `review_read` / PRD callbacks; planning allowlist |
| `desktop/src/adapters/tauri.ts` | payload-aware `subscribeBoardChanged` (F8); new wrappers. Consider moving wrappers into `adapters/*.ts` with only one small file importing `@tauri-apps`, so the relay swap point stays tiny; today 2,049 lines and 111 exports live in one file |
| `desktop/src/App.tsx`, `state/uiStore.ts`, `state/keyboard.ts` | surface union; `topLayer` knows surfaces (closes WR-02) |
| `desktop/src/dispatch/WavePlanSheet.tsx` | replace textarea (`:199-221`) with `FileSetEditor` |
| `desktop/src/triage/TriageSurface.tsx`, `board/TriageLane.tsx`, `authoring/ProposalTray.tsx` | extract the three byte-identical `groupProposals` copies; inbox union; inline accept for field drafts |
| `desktop/src/board/{EpicHeaderRow,StatusBand,BoardView}.tsx` | roadmap region and phase grouping |
| `desktop/src/session/SessionSurface.tsx` | per-kind stage labels (`:202-207`); PRD document pane |
| `desktop/src/styles/tokens.css`, `theme/tokens.ts` and the theme tests | T1 to T6 |
| `core/db/mod.rs`, `core/tests/migration_safety.rs` | register migrations; per-rebuild preservation test |
| `capabilities/default.json` | roster string only (documentation) |

### 9.3 Deliberately unchanged

`epics`, `tasks`, `issues` DDL; `authoring_proposals` DDL; the four canonical-writer allow-list for the spine; `task_file_set_entries`; `dispatch_plans` and their tables; the event log schema; the single adapter seam as a rule.

---

## 10. Data flows (new and changed)

**PRD session.**
```
PrdSurface "Start" -> commands/prd.rs prd_session_start
  -> authoring_session::start_authoring_run(kind=prd_authoring, prd_id)   [trigger w/ no target, stage=challenge]
  -> sidecar spawn, profile prd_authoring (stage-gated write tools, board_read)
  agent: propose_prd_revision  (HELD call, denied in challenge by the prefix matcher)
  -> sidecar.rs inbound router -> domain::prd::append_revision(agent actor, same-tx event)
  -> app.emit("board:changed", {entity:"prd", id}) -> central map -> invalidate ["prd", id]
  human edits (append_revision, human actor) -> "Sign off rev N" -> prd_sign_off(prd_id, revision_id)
  -> domain::prd::sign_off_prd (human resolved server-side; trigger verifies) -> event
  agent: propose_epic -> authoring_proposals (unchanged) -> accept -> create_epic_in_tx + link_epic_in_tx
```

**Agent proposes a decision mid-execution.**
```
task agent: propose_decision {title, context, decision, rationale}  (pre-approved; HELD)
  -> Rust: adr::propose_in_tx  (proposed_by_run_id, origin_log_offset from the session log; per-run cap; FTS dup flag)
  -> Inbox (proposals ∪ proposed ADRs) -> human accept_adr / reject_adr
  -> accepted ADRs appear in the next context packet (bounded); drift detector flags a run whose pin moved
```

**Agent drafts a field or criterion.**
```
"Draft criteria" on a task row -> review/authoring-lite run (kind=authoring, task-scoped subject OR the epic session)
  -> create/Criterion with target_id = task id -> authoring_proposals (pending)
  -> inline ProposalRow accept -> materialise_proposal -> create_criterion_in_tx  (BOARD-03 lock respected: revise if started)
priority/estimate: amend/TaskFields -> set_priority_in_tx / set_estimate_in_tx
```

**Review.**
```
ReviewSurface "Pre-review" -> review_prereview_start -> begin_review_run(kind=review, review_task_id, cwd=repo_path, scope armed-empty)
agent: review_read(files|patch|criteria) -> Rust review::review_file_list/patch (same bytes as the UI)
agent: submit_review (HELD) -> core resolves shas, validates criterion ids -> review_findings (append)
board:changed {entity:"review_finding"} -> CriteriaRail overlay (staleness derived by anchor_staleness)
human: "Check with this evidence" -> check_criterion_with_anchor(human) -> the only write to `checked`
```

**Roadmap.** `phase_roster` = `phases` ⨝ `phase_epics` folded over `board_epic_progress` (all tasks). Subscribers invalidate on entities `phase`, `epic`, `task`, `agent_run`, coalesced. No stored phase status.

---

## 11. Build order

Dependencies, not preferences:

```
W0 repairs/guard-rails ──┬─> W1 schema+kinds+registry ──┬─> W2 phases/roadmap ───────────┐
                         │                              ├─> W3 proposal-mechanism ext ─┬─> W5 PRD+ADR
W4a PLAN-01 live ────────┘ (starts day 1, independent)  │                              └─> (field/criteria drafts UX)
W4b file-set editor needs W4a                           ├─> W6 agent review
W7a state tokens+vocabulary ── before any new surface ──┘                              W7b apply visuals LAST
```

| Wave | Contents | Gates | Why here |
|---|---|---|---|
| **W0 Repairs and guard-rails** | fix `.planning/phases` test paths (F2); spine frozen-schema test; surface union + `topLayer` (F9, WR-02); payload-aware `board:changed` with coalescing (F8); confirm F1 with a fixture | W7, every new surface, everything | Cheap, removes the traps. The surface union and event routing are infrastructure the always-visible roadmap needs |
| **W1 Foundations** | `0023`..`0026`; `agent_runs.kind` and the four site migrations (F6); run-kind enum and `proposal_limit(kind)` (5.3); run-profile table (5.4); authority registry gate (4.2); frozen-spine test wired | W2, W3, W5, W6 | One schema pass; the migrations are additive except the criteria rebuild |
| **W2 Phases and roadmap** | `domain/phase.rs`, `query/phase.rs`, commands, `RoadmapRegion`, epic grouping | none downstream | First visible win; zero agent dependency; first consumer of state colour. Delivers "progress and roadmap always on screen" |
| **W3 Proposal-mechanism extension** | F3, F4, `TaskFields`/`EpicFields`, status restriction, inline accept, `groupProposals` dedupe | **W5**, drafts UX | The decision that "gates four other workstreams" resolves here: extend, don't replace |
| **W4a PLAN-01 live proof** | `uat-14-plan-live.mjs --live`; planning prompt file listing; read-tool allowlist | W4b | Longest feedback loop; start on day 1, in parallel with W0 |
| **W4b File-set editor** | `FileSetEditor`, path search, provenance chip, delete `dispatch_plan_create` | none | Closes PLAN-01 and retires the textarea |
| **W5 PRD and ADR** | `domain/prd.rs`/`adr.rs`, PRD session, `PrdSurface`, `AdrSurface`, `propose_decision`, packet sections, inbox union, drift detector | none downstream | Needs W1 (schema, kinds, registry) and W3 (cap policy, link-on-accept) |
| **W6 Agent review** | `review_findings`, `begin_review_run`, `review_read`/`submit_review`, overlay, fleet label | none downstream | Independent of W3 and W5; can run in parallel with W5 |
| **W7a State tokens and vocabulary** | direction doc and SUPERSEDES, T1 to T3, T6, amended tests | built into W2/W5/W6 UI | Surfaces are born on state tokens |
| **W7b Visual application** | values, polish, forced-colors tests, dark-first swap (T5) | last | The IA the owner wants it applied to now exists |
| Carried | AGNT-05 (needs a real limit event, opportunistic); DIST-01 (signing and notarisation, independent infrastructure; it touches sidecar packaging, so re-run `packaged-sidecar.test.mjs` after new tools land) | none | Not on the critical path |

**Suggested phase packaging** (continuing from phase 12): 13 repairs + foundations (W0, W1, and the W4a measurement as an early plan); 14 phases/roadmap + state vocabulary (W2, W7a); 15 agent drafts everywhere + PLAN-01 closure (W3, W4b); 16 PRD and ADR (W5); 17 agent review (W6), which can run beside 16; 18 visual direction applied (W7b) plus carried items.

**Research flags**

| Phase | Needs deeper research | Why |
|---|---|---|
| 15 | Yes, for the live planner | Depends on a real model's behaviour in default permission mode (LOW confidence here) |
| 16 | Yes | PRD session prompt design, what the acceptance bar contains, how epics are proposed from a PRD, packet size budget |
| 17 | Yes | Whether pre-review quality justifies its cost; evidence-pointer accuracy; needs a live measurement like `uat-10 --live` |
| 18 | Yes (design, not code) | The owner's direction document: which states get washes, forced-dark or OS-follow, CVD thresholds |
| 13, 14 | No | Established patterns in this repo |

---

## 12. Open questions for requirements

1. **Force dark, or default dark and follow the OS?** Decides Option A or B in T5.
2. **ADR statuses:** the milestone names proposed / accepted / superseded. This design adds `rejected`, because a refused decision is information (the D-83 / D-106 reasoning). Confirm.
3. **PRD acceptance bar as real criteria (rebuild `0026`) or a flat list?** Section 3.5.
4. **Citable keys for PRD and ADR** (`ADR-7`). A stored sequence needs a per-project counter (the item `key_counter` is shared by epics, tasks and issues). A derived ordinal is stable only while rows are never deleted, which holds if both are archive-only.
5. **Authoring cap value** (100 is a placeholder) and the **per-run ADR proposal cap** (3 is a placeholder). Both are owner decisions amending D-109.
6. **"Phase" semantics:** is it time-boxed? A "cycle" suggests start and end dates, which are nullable `ADD COLUMN`s on a table we own.
7. **May an agent propose phase placement?** Not recommended for the first cut; an optional `phase_id` hint on an epic proposal is the cheap later extension.
8. **Auto pre-review on completion:** default off recommended.

---

## 13. Patterns to follow

- **Derive, never store.** Phase status, finding staleness, "unsigned changes" on a PRD, "drafted by the planner", ADR ordinal. This is the repo's strongest discipline (D-75, D-141, Phase 10) and it removes every populator that could drift.
- **Held call with server-side identity.** New agent writes are held tool calls whose run, project and epic come from the socket and the `agent_runs` row, never from arguments (T-05-02-01; `submit_plan`'s description says so explicitly). Validate in Rust, answer the agent in the same call so it can correct itself.
- **Authority = human transition on an immutable revision**, enforced by a trigger, listed in the registry, scanned by the gate.
- **One owner module per table, `_in_tx` siblings for composition.** Every new writer ships an `_in_tx` form so a proposal can materialise atomically (F4).
- **Additive migrations; one rebuild, isolated, with a preservation test** and the `0016` FTS rule recorded in the header.
- **Two-sided acceptance for any gate** (Phase 12): a check that fails if the gate decides something it cannot justify, and one that fails if ordinary behaviour becomes blocked. Apply to the authority triggers: an agent cannot accept an ADR, and a human accepting one is not refused.

## 14. Anti-patterns

| Anti-pattern | Why it is wrong here | Instead |
|---|---|---|
| `epics.phase_id` | First parent pointer on `epics`; makes BOARD-01 arguable; widens a canonical writer | `phase_epics` link table + frozen-schema test |
| Putting PRD/ADR bodies in `authoring_proposals` | 1000-char bound, terminal-on-decision rows, 10-cap, no co-editing | Revision model + human-only authority |
| A generic `documents` table | Union CHECK, polymorphic links without FKs | Separate tables, shared invariant test |
| A `trait Adjudicable` | Three data shapes share only four properties, which a test states better | Registry gate |
| Rebuilding `authoring_proposals` or `agent_runs` | Rows kept forever; FTS triggers must be recreated; FK-off dance | Payload variants under existing types; `ADD COLUMN ... CHECK` |
| Review run with `task_id` set | Pollutes `SUMMARIES_SQL`, displaces the execution run in the fleet, trips `HasLiveRun` | `review_task_id` subject |
| Giving the reviewer `Bash` | Permission stalls; destructive-gate surface | `review_read` through the same Rust functions the UI uses |
| Agent verdict that gates a merge | Makes the agent an authority | Advisory overlay; human check only |
| A tool named outside `propose_/amend_/delete_` that writes in a gated session | Silently bypasses the Socratic gate | Naming rule + a test against the matcher |
| Colour referenced directly in components | Reintroduces colour-only meaning | `StateMark` is the sole consumer, gated by a source test |
| Stored `phases.status` | A populator to drift | Fold `board_epic_progress` |

## 15. Scaling considerations

| Concern | At today's 1,000-item boards | At 10,000 items / 50 epics | Note |
|---|---|---|---|
| Roadmap fold | one grouped read per query, already measured fast | still grouped reads over all tasks | must not use the paged board window (F8, `epic_progress.rs:1-9`) |
| Event fan-out | per-event invalidation is cheap now | an active fleet makes it hot | payload routing plus coalescing (F8) |
| Context packet growth | `SUMMARIES_SQL` is already known-unbounded (PROJECT.md Active) | governing documents add more | bound ADR and PRD sections from day one: signed bar only, ADR titles plus decision sentence, N-most-recent, full text via a read tool |
| PRD revisions | tens per session | hundreds | store bodies in `prd_revisions`, keep events small, list revisions with a limit |
| `authoring_proposals` growth | rows kept forever (D-83) | indexed reads exist (`0011`, `0012`) | avoided a rebuild so those indexes and FTS stay as they are |

## 16. Sources

- Code (HIGH): `packages/core/src/db/mod.rs`; migrations `0002`, `0006`, `0009`, `0010`, `0011`, `0015`, `0016`, `0018`, `0019`; `domain/{authoring_proposal,authoring_session,dispatch_plan,file_set,task,epic,agent_run,acceptance_criterion,actor}.rs`; `review.rs`; `context_packet.rs`; `dispatch_exec.rs`; `query/{fleet,epic_progress,authoring}.rs`; `tests/{proposal_no_promotion,hierarchy_workflow,migration_safety,proposal_limit}.rs`; `desktop/src-tauri/src/{main,sidecar}.rs` and `commands/{dispatch,authoring}.rs`; `sidecar/src/{mcp-permission-server,claude-code-adapter,stage-gate-hook}.ts`; `desktop/src/{App.tsx,adapters/tauri.ts,adapters/queryClient.ts,dispatch/*,review/*,triage/*,legend/*,state/*,styles/tokens.css,theme/*}`.
- Planning (HIGH): `.planning/PROJECT.md`; `.planning/REQUIREMENTS.md` (BOARD-01..04, DATA-01..08, PLAN-01, PROP-01..07); `.planning/milestones/v0.1.0-phases/06-*/06-CONTEXT.md` (D-97..D-112); `.../08.1-*/08.1-DIRECTION.md` (D-10..D-12); `.../09-*/09-VERIFICATION.md` (D-REV-35).
- Executed checks (HIGH): `sqlite3 3.51.0` probes for `ADD COLUMN ... CHECK/REFERENCES` with sibling-column CHECK, composite FK to a unique index, and abort triggers; `npx vitest run src/theme/__tests__/brand-rule.test.ts` (fails at load); `rusqlite_migration-2.6.0/src/lib.rs:720`.
- Not verified (LOW): behaviour of Claude Code's default permission mode for read tools versus `Bash`; whether the 10-proposal cap actually stops a live authoring session (read, not run); `board:changed` event rate under a real fleet.

---
*Architecture research for: Flywheel v0.2.0 integration*
*Researched: 2026-10-14*
