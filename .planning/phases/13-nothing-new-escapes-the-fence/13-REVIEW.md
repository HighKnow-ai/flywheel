---
phase: 13-nothing-new-escapes-the-fence
reviewed: 2026-10-15T00:00:00Z
depth: standard
files_reviewed: 90
files_reviewed_list:
  - packages/core/tests/pm_vocabulary_gate.rs
  - packages/core/tests/proc_timeout_boundary.rs
  - packages/core/tests/lock_contention.rs
  - packages/core/tests/git_hooks_pre_push.rs
  - packages/core/tests/proposal_duplicates.rs
  - packages/desktop/src/board/__tests__/board-pending-focus.test.tsx
  - packages/core/tests/context_packet_bound.rs
  - packages/core/src/compaction.rs
  - packages/core/src/context_packet.rs
  - packages/core/src/drift.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/core/tests/compaction.rs
  - packages/core/tests/drift.rs
  - packages/core/tests/five_cycle_reconstitution.rs
  - packages/core/tests/epic_context_packet.rs
  - packages/core/src/db/migrations/0023_drop_estimate.sql
  - packages/core/tests/estimate_absent.rs
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/task.rs
  - packages/core/src/domain/epic.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/filter.rs
  - packages/core/src/query/search.rs
  - packages/core/tests/migration_safety.rs
  - packages/core/tests/ranking.rs
  - packages/desktop/src-tauri/src/commands/board.rs
  - packages/desktop/src-tauri/src/commands/task.rs
  - packages/desktop/src-tauri/src/commands/epic.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/board/FilterBar.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/item-detail/ItemDetailPanel.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
  - packages/core/tests/migration_schema_too_far_ahead.rs
  - packages/desktop/src-tauri/tests/handler_roster.rs
  - .planning/phases/13-nothing-new-escapes-the-fence/13-LIVE-PLANNING-RUN.md
  - CLAUDE.md
  - .planning/PROJECT.md
  - packages/core/src/schema_classification.rs
  - packages/core/tests/table_classification.rs
  - packages/core/tests/spine_pin.rs
  - packages/core/src/lib.rs
  - packages/core/tests/proposal_no_promotion.rs
  - .planning/todos/completed/2026-10-05-git-identity-builds-a-table-name-into-sql-with-format.md
  - packages/core/tests/task_created_at_todo.rs
  - packages/core/tests/priority_is_opt_in.rs
  - packages/core/src/domain/authoring_proposal.rs
  - packages/core/tests/authoring_acceptance.rs
  - packages/core/src/status_derivation.rs
  - packages/core/tests/status_derivation.rs
  - packages/core/tests/no_agent_status_write.rs
  - packages/core/src/forge/transitions.rs
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/worktree.rs
  - packages/desktop/src-tauri/src/scheduler.rs
  - packages/core/tests/agent_tracer.rs
  - packages/core/tests/forge_live_chain.rs
  - packages/desktop/src/state/__tests__/surface-union.test.ts
  - packages/desktop/src/App.tsx
  - packages/desktop/src/board/__tests__/layer-guard.test.tsx
  - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
  - packages/desktop/src/fleet/__tests__/jump.test.tsx
  - packages/core/tests/authority_human_only.rs
  - .planning/phases/13-nothing-new-escapes-the-fence/13-AUTHORITY-ALLOWLIST.md
  - packages/core/src/domain/actor.rs
  - packages/core/src/domain/acceptance_criterion.rs
  - packages/desktop/src-tauri/tests/board_changed_payload.rs
  - packages/desktop/src/board/__tests__/board-changed-routing.test.tsx
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/issue.rs
  - packages/desktop/src-tauri/src/commands/criterion.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/commands/dispatch.rs
  - packages/desktop/src-tauri/src/commands/file_set.rs
  - packages/desktop/src-tauri/src/commands/fleet.rs
  - packages/desktop/src-tauri/src/commands/forge.rs
  - packages/desktop/src-tauri/src/commands/review.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/core/tests/run_kind.rs
  - packages/core/tests/proposal_limit_per_kind.rs
  - packages/core/src/domain/dispatch_plan.rs
  - packages/core/src/query/authoring.rs
  - packages/core/src/query/fleet.rs
  - packages/core/tests/proposal_limit.rs
findings:
  critical: 0
  warning: 13
  info: 5
  total: 18
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-10-15
**Depth:** standard
**Files Reviewed:** 90
**Status:** issues_found

## Summary

Phase 13 is mostly gates, tests and deletions, and the production changes that carry real risk are
sound at their core. Specifically, I traced and found correct:

- Migration 0023 copies every surviving column of `epics` and `tasks` with an explicit column list,
  carries `rowid`, and restores all three indexes and all six FTS5 triggers byte-equivalent to
  `0002_board_schema.sql`. No later migration added a column, index, trigger or view on either table,
  and the `RENAME` ordering (epics first) resolves the `REFERENCES` clauses by name. No data loss
  beyond `estimate`.
- `status_derivation::derive_status_in_tx` does hold the stay-lowered guarantee. After a human
  `request_changes`, the worktree arm is skipped (`current_rank >= in_progress`), the review arm needs
  `review_edge`, and `max(candidate, current)` blocks every backward move. The `Refused` arm is
  reachable only from the forge tick (the only caller passing `Some`).
- `assert_human_actor_in_tx` is the first statement after the transaction opens in all ten writers;
  the bulk forms additionally re-assert per item inside the transaction, so the out-of-transaction
  pre-check is not a TOCTOU.
- `SUMMARIES_SQL` binds `LIMIT ?2` correctly and the outer `ORDER BY ... id` resolves through the
  subquery's `id` column.
- Every delete handler (`task_delete`, `epic_delete`, `issue_delete`, `criterion_delete`) reads
  `project_of` before the row goes. No call site passes a wrong project.

The defects are in what surrounds that core: two real behaviour leaks in the deriver's seams, a
non-bounded read in the very feature that claims to bound input, a destructive recovery path that runs
on a refusal that changed nothing, and a set of gates whose matchers are narrower than their docs
claim. No finding below is a data-loss or security blocker on the current tree, so none is rated
BLOCKER; WR-01, WR-06 and WR-09 are the ones to fix first.

## Warnings

### WR-01: A "database too far ahead" refusal takes a backup and then copies it over the live database

**File:** `packages/core/src/db/mod.rs:138` and `:206` (with `packages/core/src/db/backup.rs:67`)
**Issue:** F7 routed the too-far-ahead refusal through the generic failure branch of
`open_and_migrate_with`. That branch was designed for a migration that may have half-run. For this
refusal nothing ran: `rusqlite_migration` rejects before executing any SQL. Yet the function (a) copies
the whole database into `backups_dir` first, and (b) on refusal `fs::copy`s that backup back over the
live file. Consequences:

1. If the newer build is open in another process (the exact situation of "I launched the old build by
   mistake"), the restore overwrites the main file under a live WAL connection. That is corruption of
   the newer build's data, caused by a refusal that was supposed to be harmless.
2. `prune_backups` only runs on the success path, so every refused launch leaves one more full copy of
   the database in `backups/`, unbounded.
3. `the_refused_database_is_left_byte_for_byte_intact` passes only because the copy is identical and
   nothing else holds the file. It does not test the case that matters.

**Fix:** Decide the refusal before touching the file. Read `user_version` (already done by
`read_user_version`) and compare it with `migration_source_list().len()` (or the `Migrations` passed
in) before `backup_database_file`; if ahead, return the `schema_ahead_context` error immediately with
no backup and no restore.
```rust
let on_disk = if db_path.exists() { backup::read_user_version(db_path)? } else { 0 };
if on_disk > migration_source_list().len() as i64 { /* build and return the refusal error */ }
```
Keep the backup-and-restore branch for genuine migration failures only.

### WR-02: The migration 0023 search test cannot detect a lost `rowid`

**File:** `packages/core/tests/migration_safety.rs:639-690`
**Issue:** `migration_0023_keeps_search_in_sync` seeds exactly one task and one epic. Both get rowid 1,
and a copy that omitted `rowid` from the column list would also assign rowid 1, so the test passes
either way. The assertion is also `SELECT COUNT(*) FROM x_fts WHERE x_fts MATCH ?`, which is answered
from the FTS index alone and never joins back to the base table, so even a wrong rowid would still
count 1. The migration header calls "a fresh rowid would orphan every existing search hit" the reason
for the explicit `rowid` carry, and this is the only guard on it. The migration is correct today; the
guard is decorative.
**Fix:** Seed several rows and delete the first so rowids have a gap, then assert the join:
```rust
// after migrating
let title: String = conn.query_row(
    "SELECT t.title FROM tasks_fts f JOIN tasks t ON t.rowid = f.rowid WHERE tasks_fts MATCH ?1",
    params!["zebrafish"], |r| r.get(0))?;
assert_eq!(title, "zebrafish before");
conn.execute("INSERT INTO tasks_fts(tasks_fts) VALUES('integrity-check')", [])?;
```

### WR-03: The allow-list is a file-wide pass, and the status gate is defeated by column order

**File:** `packages/core/tests/proposal_no_promotion.rs:130-175`, `packages/core/tests/no_agent_status_write.rs:84`
**Issue:** Two gates that together guard the single-writer claim on `tasks.status` both have trivial
evasions.

1. `ALLOWED_CANONICAL_UPDATE_SITES` matches on (file suffix, pattern) where the pattern is the bare
   prefix `UPDATE tasks SET`. `13-AUTHORITY-ALLOWLIST.md` describes it as an exact match for one
   `updated_at` touch, but any statement beginning `UPDATE tasks SET` inside `acceptance_criterion.rs`
   is exempt, including one that writes `status` or `priority`. `every_allowlisted_update_site_still_exists`
   only checks that at least one such line exists, so adding a second statement raises nothing.
2. `no_agent_status_write.rs` flags only the literal lowercase-folded string `update tasks set status`
   on a single line. `UPDATE tasks SET updated_at = ?1, status = ?2`, `UPDATE tasks SET rank = ?1,
   status = ?2`, a statement split across lines (`UPDATE tasks\n SET status`), or `UPDATE tasks AS t
   SET status` all pass. Combined with (1), `UPDATE tasks SET updated_at = ?1, status = 'done'` placed
   in `acceptance_criterion.rs` is invisible to both gates.

`priority_is_opt_in.rs` already does this correctly (joins code lines, collapses whitespace, lowercases);
the other two gates should reuse that shape.
**Fix:** Allow-list the full statement text, not the prefix, and make the status gate normalise
whitespace across lines and look for `status` anywhere in the `SET` list:
```rust
// allow-list entry: the whole statement
("src/domain/acceptance_criterion.rs", "UPDATE tasks SET updated_at = ?1 WHERE id = ?2", reason),
// status gate: after joining + collapsing whitespace + lowercasing
let re = regex::Regex::new(r"update\s+tasks\s+(as\s+\w+\s+)?set\s[^;\"]*\bstatus\s*=").unwrap();
```

### WR-04: Gate 1's UPDATE patterns are not derived from the classification, and `issues`/`criterion_anchors` UPDATEs are unpoliced

**File:** `packages/core/tests/proposal_no_promotion.rs:84-86, 119`
**Issue:** The doc on `canonical_write_patterns` says the patterns are "DERIVED, not listed (FNC-02): a
new canonical table is covered the moment it is classified". That holds for `INSERT INTO <table>` only.
The UPDATE side is hard-coded to `UPDATE acceptance_criteria` plus `["UPDATE tasks SET", "UPDATE epics
SET"]`. `issues` and `criterion_anchors` are `Canonical` in `TABLE_CLASSES`, yet a raw `UPDATE issues
SET ...` in any agent-reachable module passes. This is not hypothetical: `core/src/domain/task.rs:377`
and `core/src/domain/epic.rs:365` already issue `UPDATE issues SET ...` from modules outside
`issue.rs` and the gate does not see them. The INSERT patterns are also case-sensitive single-space
literals, so `INSERT OR REPLACE INTO tasks`, `REPLACE INTO tasks` and a lowercase `insert into tasks`
pass.
**Fix:** Derive both directions from `canonical_tables()`, match case-insensitively on normalised text
(as `priority_is_opt_in.rs` does), and cover `insert (or \w+ )?into`, `replace into` and `update (or
\w+ )?<table>`. Then give task.rs/epic.rs's issue-detach statements explicit allow-list entries, as the
`updated_at` touches have.

### WR-05: The table-name interpolation gate does not cover the site its todo was closed for

**File:** `packages/core/tests/proposal_no_promotion.rs:1379-1432`, `packages/desktop/src-tauri/src/commands/git_identity.rs:65`
**Issue:** `.planning/todos/completed/2026-10-05-git-identity-builds-a-table-name-into-sql-with-format.md`
is marked "Resolved by plan 13-05", reasoning that `packages/core/src/git_identity.rs` has no table
interpolation. But the todo's `files:` pointer was wrong. The actual site is the desktop crate:
`packages/desktop/src-tauri/src/commands/git_identity.rs:65` still does
`format!("SELECT title FROM {title_table} WHERE id = ?1")`, and `commands/agent_run.rs:2606` has
`format!("SELECT COUNT(*) FROM {table}")` in a test. The new gate scans only `packages/core/src`, so it
is green while the defect the todo named is still present. (Not exploitable: `title_table` is chosen
from two literals. The finding is that the closure claim is false and the gate does not enforce the
convention it announces as "crate-wide".) The matcher is also uppercase-keyword-only and requires the
file to contain `format!(`/`write!(`, so `from {table}`, `FROM "{table}"` and `FROM ` + `table`
concatenation pass.
**Fix:** Replace the desktop site with an explicit two-arm `match` of static SQL, add
`packages/desktop/src-tauri/src` to the gate's scan roots, make the keyword match case-insensitive and
also accept `"{`/`[{`, and reopen or annotate the todo.

### WR-06: Level-based "merged" re-applies a refused write within a minute, skips the unmet-criteria event, and the scheduler test says the opposite

**File:** `packages/core/src/forge/transitions.rs:196-235`, `packages/core/src/status_derivation.rs:116-140`, `packages/desktop/src-tauri/src/scheduler.rs:208, 870-878`
**Issue:** Three connected defects from making the merge arm a level:

1. `task.done_with_unmet_criteria` (D-123: "surfaced as an event, never silently closed") is appended
   only inside `apply_forge_observation`, on the `Wrote("done")` it triggered itself. Every other
   caller of the deriver (`derive_in_own_transaction` in the 60 s cold tick, `ensure_worktree`,
   `record_worktree_removed`) can also write `done` from a standing merged baseline and writes no such
   event. The reachable case: a forge tick records the merge, its write is refused by the
   compare-and-swap (human moved the card in the lock-release window), and the cold tick then closes
   the task with unmet criteria and no event.
2. That same sequence nullifies quick task 261005-mn5. The CAS refusal protects the human's move for at
   most `COLD_TICK_SECS`; the cold tick then re-derives `done` from the merged baseline with
   `expected_status: None`. `forge::transitions` documents this ("a refusal on a level ... is retried
   by the next tick"), but the scheduler test still asserts the opposite in its comments: "the next
   tick re-observes no edge and never retries the overwrite" (`scheduler.rs:870-878`). The test only
   asserts the state immediately after the forge write, so it passes while its stated guarantee is false.
3. `derive_in_own_transaction` (`scheduler.rs:202`) duplicates `status_derivation::derive_status`
   (see IN-02), so there is no single seam where the event could live.

**Fix:** Move the unmet-criteria event into the deriver's `Wrote("done")` arm (it already has the
transaction, task and project) so every route to `done` records it, and delete the copy in
`transitions.rs`. Correct the scheduler test comment to say the merged level is re-applied by the next
tick, or, if the owner wants a human move to stand against a merge, give the cold tick the same
captured-status precondition.

### WR-07: A review-edge lost to a compare-and-swap refusal is never retried, and system-driven moves now cause those refusals

**File:** `packages/core/src/forge/transitions.rs:240-267`, `packages/core/src/status_derivation.rs:135`
**Issue:** The forge tick captures `status_at_poll` (say `todo`), releases the lock, polls, and writes
with `expected_status = Some("todo")`. Before 13-07 only a human could move the card inside that window.
Now `ensure_worktree`, `record_worktree_removed` and the cold tick also move cards, so a normal system
transition (a worktree created or a cold tick landing during the poll's network call) makes
`expected_status` stale. If that poll also observed `None -> Open`, the state-changed event is already
appended, so the baseline advances, `Refused` is returned, and `review_edge` is false on every later
tick. The card sits at `in_progress` with an open PR until the merge. Because the edge is the only
route to `in_review`, one unlucky window is permanent. D4 accepted this for human moves; it was not
re-argued for system moves.
**Fix:** On `Refused` with `forge_changed`, retry once in the same transaction using the status the
write actually found, when that status is below the intended band:
```rust
Derivation::Refused { intended, actual } if forge_changed && band_rank(&actual) < band_rank(&intended) => {
    derive_status_in_tx(&tx, task_id, actor_id, Some(&actual), review_edge)?; /* then record the skip */
}
```
or drop the precondition for differences the deriver itself caused.

### WR-08: The deriver uses `git_facts_for_task` as a row-existence check, inside the write transaction

**File:** `packages/core/src/status_derivation.rs:122-124`, `packages/core/src/domain/worktree.rs:191`, `packages/desktop/src-tauri/src/scheduler.rs:207`
**Issue:** `worktree_present` is computed with `matches!(git_facts_for_task(tx, task_id), Ok(Some(_)))`.
`git_facts_for_task` runs about six git subprocesses (rev-parse, log, status --porcelain, ahead/behind,
fetch time) to answer "is there a `worktrees` row". Three problems:

1. In `ensure_worktree` this runs after the `INSERT INTO worktrees`, so the transaction already holds
   the write lock while git runs. `worktree.rs:347` documents that the batch reclaim runs on a second
   writer connection and that `busy_timeout` does not rescue it from `SQLITE_BUSY_SNAPSHOT`.
2. Any git error (a `git status` timeout, a missing directory) is silently read as "no worktree", so
   the `todo -> in_progress` edge is skipped with no log. The cold tick repairs it later, but the
   failure is invisible.
3. `derive_in_own_transaction` and `derive_status` open a deferred transaction, read, run git, then
   write: the read-then-write shape `record_worktree_removed` already fixes with `Immediate`. A
   concurrent commit from the reclaim connection makes the write fail; the cold tick logs and retries,
   so this is noise rather than corruption, but it is avoidable.

**Fix:** The deriver needs a fact, not git output. Use the cheap lookup that already exists:
```rust
let worktree_present = current_rank < in_progress_rank
    && crate::domain::worktree::worktree_for_task(tx, task_id)?.is_some_and(|w| w.status == "active");
```
and open the cold-tick transaction with `TransactionBehavior::Immediate`.

### WR-09: `decision_ids_on_record` is neither bounded nor safe on error

**File:** `packages/core/src/drift.rs:341-367`, `packages/desktop/src-tauri/src/commands/agent_run.rs:444-452`
**Issue:** FNC-05 is "bounded at input", and the doc here says the lookups are "bounded by that one row,
never by task age". They are bounded by the length of `acknowledged_decisions`, which nothing caps:
`apply_summary_reported` collects every string in the agent's array, and the MCP schema is
`{ type: "array", items: { type: "string" } }` with no `maxItems`. Each candidate id runs a
`json_each` scan over every `decisions` blob of every summary the task has ever had, so cost is
`candidates x summaries x decisions` on every preview and every launch. It also runs for ids the
in-scope window already holds, which need no lookup. Separately, the caller does
`.unwrap_or_default()` (`agent_run.rs:450`): any error (a busy database, a malformed `decisions` blob
makes `json_each` raise) yields an empty list, which makes every correctly-echoed old decision a
`FabricatedDecisionEcho` and records a false `drift.detected` event. That is the exact false positive
this function was added to remove, now reintroduced silently on error.
**Fix:** Skip ids already in the in-scope set, dedupe, cap the candidate count (reject or truncate with
a named constant), run one statement for all of them
(`... WHERE task_id = ?1 AND json_extract(value,'$.id') IN (SELECT value FROM json_each(?2))`), and on
error propagate or log and omit the fabricated-echo detector rather than defaulting to "none found".

### WR-10: The folded-history boundary sentence mixes two ordinal bases

**File:** `packages/core/src/compaction.rs:110-145`, `packages/core/src/context_packet.rs:648-670`
**Issue:** When the window dropped sessions, the sentence reads, for a task with 55 summaries,
"Summaries 1-20 are folded; 21-25 are carried verbatim. Summaries 31-55 of 55 read; 30 earlier sessions
are on the task ...". The first clause uses window-relative ordinals (matching the `### Session 1..25`
headings the prompt renders), the second uses board ordinals (31-55). A model reading "Summaries 31-55"
beside headings numbered "Session 1-25" has no way to reconcile them, and this text goes straight into
the prompt. CTX-04's byte-determinism hides it because the string is stable, just inconsistent.
**Fix:** Number the rendered sessions by board ordinal (`left_out + i + 1`) and use that base in both
clauses, or drop the ordinal range from the second clause and state only the count.

### WR-11: CLAUDE.md still states three stack rows that contradict the tree

**File:** `CLAUDE.md:50, 53, 56`
**Issue:** 13-04 (F7) exists to make CLAUDE.md match the tree, and it fixed the agent-SDK, `git2`,
Monaco and xyflow rows. Three others are still false, and CLAUDE.md is auto-loaded into every agent
session as ground truth:
- Row 50: "Packaged with `pkg`/`nexe` as `externalBin`" and "match what the Agent SDK supports". The tree
  ships `binaries/flywheel-node`, `flywheel-sidecar` and `flywheel-shim` with
  `sidecar/scripts/stage-runtime.mjs`; neither `pkg` nor `nexe` appears, and the SDK is not a
  dependency (the same file now says so two rows down).
- Row 53: git is driven "via `tokio::process::Command`". `grep tokio::process` finds nothing in
  `packages/core/src` or `packages/desktop/src-tauri/src`; git is driven through `core/src/git.rs` and
  `proc::output_with_timeout` (std::process).
- Row 56: `node-pty` "inside the sidecar" at 1.1.0. `packages/sidecar/package.json` has one runtime
  dependency, `@modelcontextprotocol/sdk`; `node-pty` is not installed.
**Fix:** Apply the same "**not installed** / what is real" treatment to these three rows.

### WR-12: `SURFACE_LAYERS` is exported and tested but read by nothing in production

**File:** `packages/desktop/src/state/keyboard.ts:570`
**Issue:** The doc says that because it is a `Record<UiSurface, ...>`, "adding a surface without
deciding its layer is a build failure". But the only importer is `surface-union.test.ts`. Real layer
registration happens in each component (`useRegionBindings("triage-surface", ...)` in
`TriageSurface.tsx`) and `topLayer()` never consults surfaces. So the guarantee is decorative: a new
surface must add a `SURFACE_LAYERS` entry that nothing reads, and that entry can disagree with what the
component registers without any check noticing. FNC-06 is about having one place that answers this; this
leaves two.
**Fix:** Either feed `topLayer`/the region binding from `SURFACE_LAYERS[activeSurface(...)]`, or delete
it and its test so the `never` default in `App.tsx` is the single exhaustiveness check.

### WR-13: The authority gate is a hand-kept name list, and the DB refusal covers only ten writers

**File:** `packages/core/tests/authority_human_only.rs:300-345`, `packages/core/src/domain/actor.rs:104`
**Issue:** The database-level refusal is real for the ten listed writers. The source half then protects
only those names, matching the literal token `name(`. Two residual gaps:
1. `use core::...::accept_proposal as ap; ap(...)` or any wrapper in a non-listed file passes the call
   match, and each allow-listed domain module is allowed wholesale (any function in `task.rs` may call
   `request_changes`).
2. Other human sign-offs have no DB-level assertion and no entry in `AUTHORITY_WRITERS`:
   `set_task_status` / `set_epic_status` (still registered commands, owner-deferred to Phase 14, but the
   deferral covers the UI, not the missing refusal) and the task-branch merge
   (`merge::record_merge_event`, `review_merge_task`). The helper's own doc lists "merging" among the
   authority transitions.
**Fix:** Add the missing writers to the helper and the table, or record in
`13-AUTHORITY-ALLOWLIST.md` that status and branch-merge are deliberately outside FNC-03 and why. For
the call match, scan for the writer names as identifiers (not just `name(`) outside the allow-list.

## Info

### IN-01: Mechanical `deadline` -> `timeout_at` rename left a misnomer and an awkward message

**File:** `packages/core/tests/lock_contention.rs:218-224, 257`, `packages/core/tests/git_hooks_pre_push.rs:403`
**Issue:** To satisfy the PM-vocabulary gate, `let deadline = stress_deadline()` became `let timeout_at`,
but in `lock_contention.rs` that value is a `Duration` (it is added to `started`), while the same name is
an `Instant` in `git_hooks_pre_push.rs`. Panic messages now read "within the derived timeout_at ...".
**Fix:** `let stress_timeout = stress_deadline();` and "derived timeout {stress_timeout:?}".

### IN-02: `scheduler::derive_in_own_transaction` duplicates `status_derivation::derive_status`

**File:** `packages/desktop/src-tauri/src/scheduler.rs:202-211`
**Issue:** The two functions are the same body. `derive_status` is used only by tests, so the tests
exercise a function production does not call.
**Fix:** Call `status_derivation::derive_status(conn, actor_id, task_id, None)` from the cold tick and
delete the local copy.

### IN-03: "backlog means proposed by an agent" has no producer

**File:** `packages/core/src/domain/task.rs:60-63`, `packages/core/src/domain/epic.rs:185`
**Issue:** No `tasks` row is created at `backlog` any more (proposals live in `authoring_proposals`, and
accepted ones land at `todo`), so the doc's definition describes a state nothing enters. Epics are still
created at `backlog` by humans. Existing human-typed tasks stay at `backlog` with the new meaning, and
no data migration moves them.
**Fix:** Reword the comment to what is true (legacy band, no writer) or backfill existing rows; decide
the epic band explicitly.

### IN-04: Accepting a non-task proposal emits `entity: "task"`

**File:** `packages/desktop/src-tauri/src/commands/authoring.rs:785, 823`
**Issue:** `authoring_proposal_accept` and the subtree form always label the first event `"task"` with
`outcome.materialised_id`, even when the proposal materialised an epic, criterion or assumption.
Harmless today (the renderer routes only on `projectId`), but `entity`/`id` are now part of the payload
contract FNC-07 introduced.
**Fix:** Derive the entity from `outcome.proposal.target_type`.

### IN-05: `handler_roster` extractor has silent blind spots

**File:** `packages/desktop/src-tauri/tests/handler_roster.rs:35-60, 96-110`
**Issue:** `collect_commands` strips only `pub ` / `async `, so `pub(crate) fn` after `#[tauri::command]`
is dropped without being collected; `commands_in` skips `mod.rs` and does not recurse into
subdirectories; `parse_roster` takes the first `generate_handler![` in the file, which a doc comment
could precede. None bites today (the `> 100` floor catches a broken extractor).
**Fix:** Handle `pub(crate)`, fail if a `#[tauri::command]` attribute is not followed by an `fn` it
recognises, and recurse.

---

_Reviewed: 2026-10-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
