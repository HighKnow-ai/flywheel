---
phase: 13-nothing-new-escapes-the-fence
verified: 2026-10-15T12:00:00Z
status: gaps_found
score: 2/6 roadmap criteria fully verified (4 partial)
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-01-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-01-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-02-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-02-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-03-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-03-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-04-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-04-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-05-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-05-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-06-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-06-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-07-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-07-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-08-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-08-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-09-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-09-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-10-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-10-SUMMARY.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-11-PLAN.md", ".planning/phases/13-nothing-new-escapes-the-fence/13-11-SUMMARY.md", "packages/core/src/compaction.rs", "packages/core/src/context_packet.rs", "packages/core/src/domain/actor.rs", "packages/core/src/domain/agent_run.rs", "packages/core/src/domain/authoring_proposal.rs", "packages/core/src/drift.rs", "packages/core/src/schema_classification.rs", "packages/core/src/status_derivation.rs", "packages/core/tests/authority_human_only.rs", "packages/core/tests/context_packet_bound.rs", "packages/core/tests/pm_vocabulary_gate.rs", "packages/core/tests/spine_pin.rs", "packages/core/tests/table_classification.rs", "packages/desktop/src/board/useBoardQuery.ts", "packages/desktop/src/state/keyboard.ts"]
covered_digest: "v1:sha256:90ccbd048c3543d1f84ca84a920fa1d8a871b26f060091af56b86ff0391b2121"
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "the foreign-key chain above epics ends at the cycle table, which has no parent, and no other table references it"
    reason: "No cycles table exists until Phase 14; the spine-pin mechanism that will assert it is in place and will fail the moment epics.cycle_id is added. Clause moved to Phase 14 success criterion 1."
    accepted_by: "Cyril Marechal"
    accepted_at: "2026-10-15T00:00:00Z"
  - must_have: "A live, credential-spending planning run exists as a recorded artifact showing the planner naming real files"
    reason: "Requires the owner's own credentials and cannot be produced by an agent. Serves DRFT-01, whose home is Phase 15; the hand-typed path field stays until the artifact exists."
    accepted_by: "Cyril Marechal"
    accepted_at: "2026-10-15T00:00:00Z"
gaps:
  - truth: "Criterion 4: No unbounded read of summaries, decisions or records remains"
    status: failed
    reason: "decision_ids_on_record scans every summary's decisions JSON once per echoed id, the id list (acknowledged_decisions) is uncapped, cost grows with task age, and the sole caller turns any error into an empty list (false FabricatedDecisionEcho). PRIOR_AUTHORING_RUNS_SQL (epic packet) LEFT JOINs session_summaries with no LIMIT and is still allow-listed as 'GENUINELY UNBOUNDED, a recorded debt'. drift.rs is outside the unbounded-reads gate."
    artifacts:
      - path: "packages/core/src/drift.rs"
        issue: "decision_ids_on_record lines 341-367: candidates x summaries scan, doc claims 'never by task age'"
      - path: "packages/desktop/src-tauri/src/commands/agent_run.rs"
        issue: "line ~450 .unwrap_or_default() converts an error into a false drift warning"
      - path: "packages/core/src/epic_context_packet.rs"
        issue: "PRIOR_AUTHORING_RUNS_SQL (line 200) has no LIMIT; allow-listed in epic_context_packet.rs test"
    missing:
      - "Cap and dedupe candidate ids (named constant), skip ids already in the window, one set-based statement"
      - "On error, propagate or omit the fabricated-echo detector; never default to 'none on record'"
      - "Either LIMIT PRIOR_AUTHORING_RUNS_SQL or record an owner-accepted override"
      - "Extend the unbounded-reads gate to drift.rs (or move the lookup into src/query/)"
  - truth: "Criterion 5: a board change wakes only the readers it affects (an event in one project no longer re-fetches an unrelated project's views)"
    status: partial
    reason: "Only useBoardChangedSubscription routes on projectId. 28 of 29 production subscribeBoardChanged call sites ignore the payload and invalidate on every event, including project-keyed views (useChangeFlags(projectId) refetches and spawns git for an event in another project). The test asserts zero invalidateQueries only for the central subscription. Side effect: account-wide dispatch cap/gate queries no longer refresh on a cross-project event (deferred-items.md)."
    artifacts:
      - path: "packages/desktop/src/board/useBoardQuery.ts"
        issue: "13 further per-hook subscribers ignore the payload"
      - path: "packages/desktop/src/review/useReviewQuery.ts"
        issue: "8 subscribers, none route"
      - path: "packages/desktop/src/authoring/useAuthoringQuery.ts"
        issue: "4 subscribers, none route"
    missing:
      - "Route the project-keyed readers (change flags, forge flags, worktree summaries, review reads) on payload.projectId"
      - "Give useDispatchCap its own subscription so the cap count does not go stale"
  - truth: "Criterion 6: a live, credential-spending planning run exists as a recorded artifact showing the planner naming real files from the repository"
    status: failed
    reason: "13-LIVE-PLANNING-RUN.md status line reads 'NOT YET RECORDED'; run id, log path, file list and git ls-files verification are all unfilled. 13-04 correctly refused to fabricate it. Not closable by code: needs the owner to spend credentials."
    artifacts:
      - path: ".planning/phases/13-nothing-new-escapes-the-fence/13-LIVE-PLANNING-RUN.md"
        issue: "placeholder only"
    missing:
      - "Owner runs dispatch_plan_generate against this repo, pastes run id, log path, verbatim planner paths and git ls-files results, flips status line to RECORDED"
      - "Or the owner accepts a deferral to Phase 15 as an override (see suggestion below)"
  - truth: "Criterion 1: classification is closed-world (a new table is covered by default); the foreign-key chain above epics ends at the cycle table, which has no parent and which no other table references"
    status: partial
    reason: "Table classification vs sqlite_master is closed-world and verified. Gate 1 derives its INSERT patterns from the classification but its UPDATE patterns are hard-coded to acceptance_criteria, tasks and epics, so a raw UPDATE issues/criterion_anchors (and any future canonical table) passes; core task.rs:377 and epic.rs:365 already issue UPDATE issues outside issue.rs unseen. The cycle-table clause is not implemented: no cycles table exists, the chain ends at projects and actors, and Phase 14's success criteria do not carry the clause."
    artifacts:
      - path: "packages/core/tests/proposal_no_promotion.rs"
        issue: "canonical_write_patterns lines ~84-86 and CANONICAL_UPDATE_PATTERNS hard-code the UPDATE side; patterns are case-sensitive single-space literals"
      - path: "packages/core/tests/spine_pin.rs"
        issue: "cycle clause recorded only in a doc comment"
    missing:
      - "Derive UPDATE patterns from canonical_tables(), match case-insensitively on normalised text, allow-list task.rs/epic.rs issue-detach statements explicitly"
      - "Add the cycle-chain assertions to Phase 14's success criteria (it is not there today), or record an owner override for the Phase 13 wording"
deferred:
  - truth: "Criterion 4 fixture halves: 40 ADRs, a 30 KB PRD, and 'byte-identical when a superseded ADR is added'"
    addressed_in: "Phase 16"
    evidence: "Phase 16 success criterion 5: 'Accepted ADRs ... enter the agent's context packet bounded by fixed counts and link relevance ... Superseded and draft records never enter'. No ADR or PRD table exists yet. context_packet_bound.rs substitutes a superseded acceptance criterion and says so. Phase 16 does not restate the 40-ADR / 30 KB scale fixture, so carry it explicitly."
  - truth: "FNC-03 'accepting an ADR' refuses an agent at the database"
    addressed_in: "Phase 16"
    evidence: "No ADR writer exists. assert_human_actor_in_tx documents that the Phase 16 writer must call it first. Nothing enforces that obligation today."
advisory: []
human_verification:
  - test: "Run a live planning run and record it"
    expected: "13-LIVE-PLANNING-RUN.md holds a run id, log path and a verbatim list of planner-named paths, each present in git ls-files"
    why_human: "Spends the owner's local claude credentials; cannot be produced or checked by code"
  - test: "Decide what an epic's status does now that StatusPicker is deleted"
    expected: "Owner records either derive-from-tasks or a dedicated epic control, and whether task_set_status / epic_set_status stay registered"
    why_human: "Owner-deferred to Phase 14 (todos 2026-10-15-*). DRFT-04 is scoped to tasks, which is a legitimate reading, but epics are frozen at their creation status in the shipped UI"
  - test: "Confirm the boundary sentence reads correctly to a person"
    expected: "A task with 200 summaries shows a sentence whose numbers a reader can reconcile with the session headings"
    why_human: "Today it reads 'Summaries 1-20 are folded; 21-25 are carried verbatim. Summaries 176-200 of 200 read; 175 earlier sessions...' mixing window ordinals with board ordinals. Whether that is acceptable is a judgement about prompt clarity"
---

# Phase 13: Nothing New Escapes The Fence Verification Report

**Phase Goal:** Every structural guarantee the milestone is about to lean on is closed-world and asserted before the first new record type exists: the spine cannot erode, an unclassified table fails the build, authority is reachable only from a human, the context packet is bounded, and the fields nobody reads are gone rather than drafted.
**Verified:** 2026-10-15
**Status:** gaps_found
**Re-verification:** No, initial verification

## Verdict in one paragraph

The phase delivered the large majority of its mechanisms and they work: the 14 core targets I re-ran (see Spot-Checks) pass 172 tests, and renderer routing/surface tests pass. What the phase did not do is close three clauses the roadmap states in so many words: no unbounded read of summaries (criterion 4), a board change waking only affected readers (criterion 5), and the recorded live planning run (criterion 6). The cycle-table clause of criterion 1 cannot be satisfied yet and is not carried forward by any later phase's wording. Nothing here is a data-loss or security blocker, but the phase does not meet its own contract, so I will not mark it passed.

## Goal Achievement: the six roadmap criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Classification closed-world, spine pin, corpus, FK chain ends at cycle table | PARTIAL | Three clauses verified; cycle clause unimplemented; Gate 1 UPDATE side not derived (see below) |
| 2 | Authority transitions refuse an agent at the DB, unreachable from agent code, two-sided; three write-past-gate sites disposed | VERIFIED (warnings) | 10 writers, 20 two-sided tests pass; source gate narrower than its docs; ADR transition does not exist yet |
| 3 | PM vocabulary gate; estimate gone; priority opt-in; status derived | VERIFIED (warnings) | Gate, deletion, opt-in and deriver all present and tested; known evasions listed below |
| 4 | Bounded packet, boundary sentence, fixture, no unbounded reads | PARTIAL / FAILED on one clause | `SUMMARIES_SQL` fixed with LIMIT; `decision_ids_on_record` and `PRIOR_AUTHORING_RUNS_SQL` remain unbounded |
| 5 | Surface is one modelled value; board change wakes only affected readers | PARTIAL | Surface: verified. Wake-only-affected: central subscription only |
| 6 | Per-kind cap, D-109 amendment recorded, live planning run recorded | PARTIAL | Cap and amendment verified; live run absent |

### Criterion 1 in detail

- VERIFIED: a table in `sqlite_master` with no entry in `TABLE_CLASSES` fails the build. `table_classification.rs` reads the migrated database (not the migration text), checks both directions, guards against a vacuous read by requiring the three spine tables, and has a planted-table firing test. `schema_classification.rs` has no catch-all class. Ran: 2 passed.
- VERIFIED: `spine_pin.rs` pins the normalised `CREATE TABLE` text of `epics`, `tasks` and `issues` from `sqlite_master` and the FK parents of `epics`; a planted ALTER proves it can fail. Ran: 4 passed.
- VERIFIED (with a weakness): `prd`, `adr`, `cycle_assignment` are in the no-promotion corpus (`proposal_no_promotion.rs:1210-1351`), each refused four ways (enum, typed payload, migration 0015 CHECK on a raw INSERT, `apply_proposal_created` returning `Ignored`). The criterion says "every verb-by-target case". Only the `create` verb is exercised against these three targets. The refusal is verb-independent today because the type does not exist, so the proof is real but thin, and it becomes meaningful when Phase 16 widens the CHECK.
- FAILED: "the foreign-key chain above `epics` ends at the cycle table, which has no parent, and no other table references it." No cycles table exists. `FOREIGN_KEY_PARENTS_ABOVE_EPICS` is `actors, actors, projects`. 13-05 recorded the clause as a one-const edit in a doc comment. That is an honest deferral, not satisfaction. Phase 14's success criteria (ROADMAP lines 209-225) do not mention the chain, so nothing downstream will fail if it is forgotten. The Phase 14 hand-off is only implicit (the pin test will fail when `epics.cycle_id` is added, which forces a const edit but does not force the "no parent, no other referrer" assertions).
- WARNING (WR-04, confirmed): `canonical_write_patterns()` derives `INSERT INTO <table>` from the classification but appends the hard-coded `UPDATE acceptance_criteria`, and `CANONICAL_UPDATE_PATTERNS` is `["UPDATE tasks SET", "UPDATE epics SET"]`. `issues` and `criterion_anchors` are Canonical yet a raw `UPDATE issues SET` anywhere passes; `task.rs:377` and `epic.rs:365` already do this outside `issue.rs`. Matching is case-sensitive single-space, so `INSERT OR REPLACE INTO tasks`, `REPLACE INTO` and lowercase pass. FNC-02 says a new table is "covered by default"; that holds for INSERT only. This gate is the thing Phase 16 will lean on for PRD/ADR tables.
- WARNING (WR-02, confirmed by reading the review and test): `migration_0023_keeps_search_in_sync` seeds one row per table and counts FTS matches without joining to the base table, so a dropped `rowid` would still pass. The migration is correct today (reviewer traced it); the guard is decorative. FTS5/rowid preservation is therefore asserted by review, not by a test.
- WARNING (WR-05, confirmed): `packages/desktop/src-tauri/src/commands/git_identity.rs:65` still builds `format!("SELECT title FROM {title_table} ...")`. The "crate-wide" interpolation gate scans only `core/src`. The todo's `files:` pointer was to the core file (already clean), so the todo was closed on a true statement about the wrong file. Not injectable (two literals) but the gate does not enforce what it announces.

### Criterion 2 in detail

- VERIFIED: `assert_human_actor_in_tx` (`domain/actor.rs`) reads `actors.type` in the same transaction and accepts only `'human'`; system, agent, unknown and empty ids are each refused with a distinct message. It is the first statement after `transaction()` in the writers. `authority_human_only.rs` holds 10 writers (`toggle_criterion`, `check_criterion_with_anchor`, `request_changes`, `accept_proposal`, `accept_subtree`, `merge_proposal`, `reject_proposal`, `defer_proposal`, `reject_proposals_bulk`, `defer_proposals_bulk`) with, per writer, an agent-refused-and-board-unchanged test and a human-not-blocked-and-effect-lands test, enforced by a macro so a writer cannot exist without both. Ran: 28 passed.
- VERIFIED: the source half scans core, desktop-tauri and sidecar; sidecar has no allow-list entry (asserted). Planted-call firing test passes.
- VERIFIED: the three sites past the gate each have a recorded disposition in `13-AUTHORITY-ALLOWLIST.md`: `start_agent_run`'s `tasks.status` write is deleted (grep: no `UPDATE tasks` in `agent_run.rs`), and the two `updated_at` touches in `acceptance_criterion.rs:780,784` are allow-listed with reasons. "Deleted" is outside the roadmap wording ("refactored or allow-listed"); amendment A-01 is recorded in PROJECT.md and the intent (nothing writes past the gate) is met.
- Judgement on the orchestrator's WR-03/WR-13 concern: the guarantee holds on the current tree (I grepped every `UPDATE tasks|epics` in core, desktop-tauri and sidecar; the only `status` writers are `task.rs:473` and `epic.rs:430`). It is a latent weakness, not a present hole: the allow-list matches the bare prefix `UPDATE tasks SET` for the whole of `acceptance_criterion.rs`, and `no_agent_status_write.rs` matches only the lowercase-folded single-line `update tasks set status`, so `SET updated_at = ?, status = ?` or a statement split across lines is invisible. `priority_is_opt_in.rs` already has the correct normalising shape. Fix is small.
- No remaining ungated writer found among the named transitions. `create_proposal`, `amend_proposal`, `apply_proposal_created` are the agent's legitimate staging route and are rightly ungated. Not DB-gated and not in `AUTHORITY_WRITERS`: `set_task_status` / `set_epic_status` (human-only by being unreached from the renderer) and branch merge (`merge::record_merge_event`). The helper's own docs list "merging" as an authority act (WR-13). I treat this as an unrecorded scoping decision rather than a gap; it should be written into `13-AUTHORITY-ALLOWLIST.md`.
- "Accepting an ADR": no ADR writer exists. The criterion names it; the mechanism is ready and documented, but nothing yet forces the Phase 16 writer to call the helper. Deferred to Phase 16 (listed above).

### Criterion 3 in detail

- VERIFIED: forbidden vocabulary. `pm_vocabulary_gate.rs` scans `core/src`, `desktop/src`, `core/tests` for the ten words, with two named exclusions and planted two-sided cases. I grepped the same trees for the words and found none outside the gate file. Ran: 4 passed. The whole-word matching was an owner-recorded amendment (A-02) because the literal reading fails on `Vec::with_capacity`.
  - Known ceiling the gate itself documents as intended: identifiers that merely contain a word pass (`story_points_total` is asserted silent, `sprint_id`, `overdueCount`, `velocity_per_week` also pass because `_` and letters count as word characters). `.sql` is not scanned. This is a real narrowing of "a build containing `story_point` ... fails" and weakens the Jira-drift guard exactly where Phase 14 will add schema. Worth a decision before Phase 14 adds columns.
  - Per-line exclusion shielding (a line with both `with_capacity` and a real `capacity`): confirmed in the matcher; a test pins the next-line case only.
- VERIFIED: `estimate`. Migration 0023 drops it from `tasks` and `epics`; `estimate_absent.rs` gates `core/src`, `desktop/src` and `desktop/src-tauri/src` (including `.css`). My grep of core, desktop, desktop-tauri, sidecar finds only: the migration history, `estimateSize`/`MOUNTABLE_ROW_ESTIMATE` (virtualiser and its fixture), a fleet cost-copy comment, and a stale doc comment in `ParentPicker.tsx` listing an "Estimate" picker. No flow asks for it. "Appears in no required flow and is asked for nowhere" is met. Ran: 2 passed.
- VERIFIED: priority. `priority_is_opt_in.rs` limits the setters to five files, stages priority only inside a proposal that must carry reasoning (`validate_priority_reasoning`), applies it on human accept inside the same transaction, and has agent-refused and human-not-blocked behaviour tests. Ran: 4 passed. Caveat from `deferred-items.md`: the agent-facing `propose_item` MCP schema has no `priority` property, so no agent can reach the field today. That is safe, but it means the opt-in path is exercised by core tests only, not end to end.
- VERIFIED (with warnings): status derivation. `status_derivation.rs` computes `max(candidate, current)` over `BAND_ORDER`; `set_task_status_in_tx` is the single `UPDATE tasks SET status` (gate-enforced; also verified by grep). New tasks and accepted task proposals are created at `todo` (`CREATED_BAND`), so backlog-to-todo rides acceptance. `start_agent_run` no longer writes status. Ran: `status_derivation` 19 passed, `no_agent_status_write` 8 passed.
  - Not DB-enforced: `set_task_status_in_tx` takes any actor and has no human assertion; "no agent-writable path" holds because no agent-reachable code calls it (source gate) and the remaining `task_set_status` Tauri command is IPC-only with the actor resolved server-side. A reasonable position, but it is a source-gate guarantee, not a database one.
  - WR-06/WR-07 (both read and plausible against the code): a merge refused by the compare-and-swap is re-applied by the next cold tick, which skips the `done_with_unmet_criteria` event, and a review edge lost to a refusal is never retried. These are correctness defects in the deriver's seams, not agent write paths, so they do not fail the criterion, but WR-06 means a documented D-123 event can be silently dropped and the scheduler test comment asserts the opposite of the behaviour.
  - Epic status is frozen (owner-deferred, todos filed). DRFT-04's text is "a task's status", so scoping to tasks is legitimate. It is a UX regression the owner has already chosen to carry; it is listed under human verification so it is not lost.
  - IN-03: legacy tasks left at `backlog` have no producer and no migration; the doc comment describes a state nothing enters.

### Criterion 4 in detail

- VERIFIED: `SUMMARIES_SQL` is fixed. It binds `LIMIT ?2` to `compaction::SUMMARY_WINDOW` (25) in an inner newest-first select with an outer oldest-first order; it is not in `ALLOWED_UNBOUNDED_SELECTS` (grep confirms). The unbounded-reads gate now scans `context_packet.rs`, `epic_context_packet.rs` and `src/query/*.rs`, with a planted-violation test. Ran: `epic_context_packet` 17 passed.
- VERIFIED: `context_packet_bound.rs` (6 tests, ran): a 200-summary task and a 400-summary task both yield exactly 25 summaries and an identically sized Prior Sessions section; a 6-summary task is strictly smaller; two assemblies are byte-identical; adding a superseded record leaves the packet and prompt byte-identical; acknowledged decisions never affect inclusion.
  - The bound is by count and age-independence, not an absolute byte ceiling. D-69 rejected size ceilings deliberately, so I treat "a fixed bound" as met by the fixed count. A single huge summary is not capped.
  - 40 ADRs and a 30 KB PRD cannot exist (no tables). The fixture substitutes prose volume and a superseded acceptance criterion and says so openly in its header. Deferred to Phase 16, which does not restate the scale fixture (see `deferred`).
- VERIFIED with a defect (WR-10, confirmed in `compaction.rs:110-145` and `context_packet.rs:648-670`): the boundary sentence is in the prompt, asserted to contain "176-200 of 200" and "175 earlier sessions". For a 200-summary task it also says "Summaries 1-20 are folded; 21-25 are carried verbatim", window-relative numbers beside board-relative ones. A reader cannot reconcile them. The criterion says the packet states its inclusion boundary; it does, and the content is true, but it is confusing in the agent prompt.
- FAILED: "No unbounded read of summaries, decisions or records remains."
  - `drift::decision_ids_on_record` (confirmed, WR-09): one `json_each` scan over every summary of the task per candidate id; candidate ids come from the latest summary's `acknowledged_decisions`, which the MCP schema does not cap. The doc says the cost is "never by task age"; the query is `task_id`-scoped over all of that task's summaries, so it is. It runs on every preview and launch.
  - The caller (`commands/agent_run.rs` ~444-452) applies `.unwrap_or_default()`: any error (busy DB, malformed `decisions` blob making `json_each` raise) becomes "no id on record", which makes every legitimately echoed older decision a `FabricatedDecisionEcho` and records a false `drift.detected`. That reintroduces the exact false positive this function was added to remove, silently.
  - `PRIOR_AUTHORING_RUNS_SQL` joins `session_summaries.changed_prose` for every authoring run of an epic with no LIMIT, and the gate's own comment calls it "GENUINELY UNBOUNDED, a recorded debt". It is the epic packet, not the task packet, but the criterion says "summaries, decisions or records" without that carve-out, and it was not in the plan's scope list.
  - Neither read is covered by the gate: `drift.rs` is not a scanned file.

### Criterion 5 in detail

- VERIFIED: surface as one modelled value. `activeSurface(state)` in `state/keyboard.ts` is the single decision, with the precedence comments preserved; `App.tsx:305-381` selects with a flat `switch` ending in `never`. `surface-union.test.ts` and `layer-guard.test.tsx` pass (37 passed across the three renderer files I ran).
  - WARNING (WR-12, confirmed by grep): `SURFACE_LAYERS` is read by nothing outside its own test, and `topLayer()` never consults surfaces. The criterion says the value lives "inside the keyboard layer model". The function sits in the keyboard module, but it is not wired into the layer stack, so the "build failure in two places" claim is one place. The nested conditional outside the model is gone, which is the core of FNC-06; the coupling to the layer model is decorative.
- PARTIAL: wake only affected readers. The Rust side emits `{projectId, entity, id}` (`commands/mod.rs:52`, `project_of` read before deletes). The central `useBoardChangedSubscription` routes: viewed project invalidates board, epics and `["board","dispatch"]`; a foreign project invalidates nothing; null/missing/malformed broadcasts. Test `board-changed-routing.test.tsx` proves zero `invalidateQueries` calls for a foreign project, in 8 cases. That is real and well tested.
  - But I count 29 production `subscribeBoardChanged(` call sites (board 14, review 8, authoring 4, fleet 1, activity trail 1, permission rules 1); exactly one reads the payload. The others are project- or task-keyed views that still refetch on every event, for example `useChangeFlags(projectId)` (debounced, but each refresh spawns git) and `useForgeFlags`. The criterion's observable is "an event in one project no longer re-fetching an unrelated project's views". For the board and epic roster it holds; for the other views mounted in the same window it does not.
  - Regression to note: account-wide `GATE_KEY`/`CAP_KEY` dispatch queries no longer refresh on a cross-project event; the cap's running-run count can lag (`deferred-items.md`). That is a new staleness bug introduced by this plan, logged but unfixed.
  - IN-04: `authoring_proposal_accept` always labels the event `entity: "task"`.

### Criterion 6 in detail

- VERIFIED: per-kind cap. `proposal_limit(RunKind)` is a `const fn` (execution 10, planning 30, authoring 60); `proposal_limit_refusal(RunKind)` gives an authoring run "stop staging and list the items you could not stage in your reply to the developer" and an execution run `report_summary`, and a generic sentence for planning (no shipped planning tool can stage a proposal, so the value 30 is nominal; owner-decided). A 42-draft decomposition is not throttled. `RunKind::classify` is the one definition, and `RUN_KIND_*_PREDICATE` mirror it in SQL; grep finds no remaining ad-hoc `authoring_stage IS` inference in src outside `agent_run.rs`. Ran: `proposal_limit_per_kind` 15, `run_kind` 17 passed.
- VERIFIED: the D-109 amendment is recorded as A-05 in PROJECT.md Key Decisions ("owner decision, 2026-10-15").
- DRFT-09 vs `agent_runs.kind`: the requirement text (REQUIREMENTS.md line 57) is about not throttling and wording; it does not mention a column. The sentence "lands with `agent_runs.kind`" is in the placement notes, and F6 in the roadmap says the column "replaces it". The deliberate no-column choice (another rebuild on a freshly pinned spine) is stated in 13-11's plan and summary but is not recorded as an owner decision like A-05. DRFT-09 is met on its own text; the F6 wording differs from what shipped. WARNING: record it.
- FAILED: the live planning run. `13-LIVE-PLANNING-RUN.md` header is "NOT YET RECORDED"; every field is `_not recorded_`. The criterion states the artifact must exist. This is the one clause that cannot be closed with code.

## Requirements Coverage

All 11 phase requirement IDs appear in a PLAN's `requirements:` frontmatter and in REQUIREMENTS.md. No orphans: REQUIREMENTS.md maps exactly these 11 to Phase 13. Status below is my verdict, not the checkbox state (all 11 are marked Complete in REQUIREMENTS.md; that mark is premature for the four marked PARTIAL).

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| FNC-01 | 13-04, 13-05 | SATISFIED | `spine_pin.rs`, 4 tests pass, two-sided |
| FNC-02 | 13-05 | PARTIAL | Table classification closed-world; Gate 1 UPDATE patterns still hard-coded (WR-04) |
| FNC-03 | 13-09 | SATISFIED (warnings) | 10 writers two-sided; ADR writer not yet existing; status/merge not covered (WR-13) |
| FNC-04 | 13-01 | SATISFIED (warnings) | Whole-word gate; compound identifiers and `.sql` out of scope by owner amendment A-02 |
| FNC-05 | 13-02 | PARTIAL | Window bound and boundary sentence verified; `decision_ids_on_record` and `PRIOR_AUTHORING_RUNS_SQL` unbounded |
| FNC-06 | 13-08 | SATISFIED (warning) | Flat switch on `activeSurface`; `SURFACE_LAYERS` unused in production (WR-12) |
| FNC-07 | 13-10 | PARTIAL | Central subscription routed and tested; 28 of 29 sites not |
| DRFT-04 | 13-07 | SATISFIED (scoped to tasks) | Deriver, single writer, `start_agent_run` write deleted; epic status frozen by owner deferral |
| DRFT-05 | 13-03, 13-06 | SATISFIED | Migration 0023, `estimate_absent.rs` |
| DRFT-06 | 13-06 | SATISFIED | `priority_is_opt_in.rs`; MCP tool cannot carry the field yet |
| DRFT-09 | 13-11 | SATISFIED | Per-kind cap and refusal; no `agent_runs.kind` column (unrecorded divergence from F6 wording) |

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/core/src/schema_classification.rs` | VERIFIED | 25 classified tables, five classes, no catch-all; consumed by two gates |
| `packages/core/tests/table_classification.rs` | VERIFIED | reads `sqlite_master`, both directions, planted firing test |
| `packages/core/tests/spine_pin.rs` | VERIFIED | DDL text and FK parents pinned |
| `packages/core/src/db/migrations/0023_drop_estimate.sql` | VERIFIED (guard weak) | rebuild correct per review; rowid guard decorative |
| `packages/core/src/domain/actor.rs` `assert_human_actor_in_tx` | VERIFIED | called by 7 sites covering 10 writers |
| `packages/core/src/status_derivation.rs` | VERIFIED | floor as one comparison; one writer |
| `packages/core/src/context_packet.rs` / `compaction.rs` | VERIFIED (boundary wording defect) | LIMIT bound, determinism |
| `packages/core/src/drift.rs` `decision_ids_on_record` | STUB-adjacent | works, unbounded, error-swallowed at caller |
| `packages/desktop/src/state/keyboard.ts` `activeSurface` | VERIFIED | wired in `App.tsx` |
| `packages/desktop/src/state/keyboard.ts` `SURFACE_LAYERS` | ORPHANED | read only by its own test |
| `13-LIVE-PLANNING-RUN.md` | MISSING (content) | placeholder only |

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `table_classification.rs` | `schema_classification::TABLE_CLASSES` | const list vs `sqlite_master` | WIRED |
| `proposal_no_promotion.rs` Gate 1 | `canonical_tables()` | INSERT side only | PARTIAL |
| authority writers | `assert_human_actor_in_tx` | first statement in tx | WIRED |
| `derive_status_in_tx` | `set_task_status_in_tx` | sole `UPDATE tasks SET status` | WIRED |
| `context_packet.rs` | `compaction::SUMMARY_WINDOW` | bound `?2` | WIRED |
| `agent_run.rs` caller | `drift::decision_ids_on_record` | `.unwrap_or_default()` | WIRED, unsafe on error |
| `App.tsx` | `activeSurface` | flat switch | WIRED |
| Rust `emit_board_changed` | `useBoardChangedSubscription` | `{projectId,...}` payload | WIRED (central only) |
| `create_proposal_in_tx` | `proposal_limit(kind)` | in-tx COUNT(*) | WIRED |

## Behavioral Spot-Checks (I ran these)

| Command | Result | Status |
|---------|--------|--------|
| `RUST_TEST_THREADS=1 cargo test -p core` with `--test` for table_classification, spine_pin, authority_human_only, no_agent_status_write, pm_vocabulary_gate, estimate_absent, priority_is_opt_in, context_packet_bound, proposal_limit_per_kind, run_kind, proposal_no_promotion, status_derivation, epic_context_packet, drift | 14 targets, 172 passed, 0 failed, exit 0 | PASS |
| `npx vitest run` surface-union, board-changed-routing, layer-guard | 3 files, 37 passed | PASS |
| grep for the ten PM words, `estimate`, and every `UPDATE tasks|epics` in core, desktop-tauri, sidecar | only the exclusions, history, and `task.rs`/`epic.rs` writers | PASS |

I did not re-run the full 25-target gate or the full renderer suite; I rely on the orchestrator's figures for those and did not independently confirm them. 81 of 121 core test binaries were never executed during the phase, per the orchestrator.

## Anti-Patterns Found

No unreferenced `TBD/FIXME/XXX` markers were found in the files I read; I did not sweep all 90 reviewed files. Findings from `13-REVIEW.md` that I confirmed against the code:

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `core/src/drift.rs:341` + `desktop/.../agent_run.rs:~450` | unbounded read, error swallowed | Blocker for criterion 4 | WR-09 |
| `core/tests/proposal_no_promotion.rs:84,119` | hard-coded UPDATE patterns | Warning | WR-04 |
| `core/tests/no_agent_status_write.rs:84`, allow-list prefix | narrow matcher | Warning | WR-03 |
| `core/src/db/mod.rs:138,206` | too-far-ahead refusal backs up then copies backup over live DB | Warning (data) | WR-01, F7 fix quality; not in any criterion |
| `core/src/forge/transitions.rs`, `scheduler.rs` | CAS refusal re-applied silently; lost review edge | Warning | WR-06, WR-07 |
| `core/src/compaction.rs:110` | mixed ordinal bases in prompt | Warning | WR-10 |
| `desktop/src/state/keyboard.ts:570` | unused `SURFACE_LAYERS` | Warning | WR-12 |
| `CLAUDE.md` rows 50, 53, 56 | still describe `pkg`/`nexe`, `tokio::process`, `node-pty` | Warning | WR-11; roadmap named only four rows, so not a criterion |

## Override suggestions (only if the owner agrees these are intentional)

The cycle-table clause and the live run are the two items that cannot be closed by code now. If the owner accepts deferring them, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "the foreign-key chain above epics ends at the cycle table, which has no parent, and no other table references it"
    reason: "No cycles table exists until Phase 14; the pin mechanism is in place. Moved to Phase 14 success criterion 1."
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
  - must_have: "A live, credential-spending planning run exists as a recorded artifact showing the planner naming real files"
    reason: "Requires owner credentials; serves DRFT-01 whose home is Phase 15 and which keeps the hand-typed path field until the artifact exists."
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
```

I would not suggest an override for criteria 4 or 5; both are small code fixes (cap and batch `decision_ids_on_record` and stop swallowing its error; route the project-keyed per-hook subscribers on `payload.projectId` and add the dispatch-cap subscription).

## Gaps Summary

Groups by root cause:

1. **Unfinished bounding (criterion 4, FNC-05).** One function and one tolerated allow-list entry read summaries without a bound, and the error path fabricates false drift warnings. Highest priority; small fix.
2. **Gates narrower than their docs (criteria 1, 2, 3).** Gate 1 UPDATE side, the allow-list prefix match, the status gate's single-line match, the PM gate's compound identifiers and `.sql` blind spot, and the interpolation gate's core-only scope. The tree is clean today under all of them; the risk is Phase 14 and 16 adding tables and columns against matchers that will not notice. Phase 14 should not start schema work before WR-03/WR-04 are fixed.
3. **FNC-07 done at one site (criterion 5).** The mechanism and payload exist; adoption is 1 of 29.
4. **Two clauses that need the owner (criteria 1 cycle chain, 6 live run).** Neither is a code gap; each needs an owner act or an explicit override.

The orchestrator's flagged risks, answered: WR-04 confirmed and counted as a partial FNC-02 gap; WR-05 confirmed, warning only; WR-02 confirmed, rowid is not behaviourally asserted; cycle clause is deferred not satisfied; WR-03 a latent weakness, the tree is currently clean; no ungated named authority writer found, but status and branch merge sit outside FNC-03 unrecorded; the `estimate` exclusions satisfy the criterion's wording; WR-06/07 are deriver correctness defects, not agent write paths; epic-status scoping is legitimate for DRFT-04 but needs the owner decision already filed; WR-09 is a direct miss against criterion 4; WR-10 is a clarity defect in a stated boundary; WR-12 is real and FNC-06's layer coupling is decorative; the subscriber count is 29 not 9 and criterion 5 is partial; the live run is absent and the planning cap value is nominal by design; DRFT-09 is met on its text, with the no-column divergence needing a recorded decision.

---

_Verified: 2026-10-15_
_Verifier: Claude (gsd-verifier)_
