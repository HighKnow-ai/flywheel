---
phase: 13-nothing-new-escapes-the-fence
reviewed: 2026-10-15T00:00:00Z
depth: standard
scope: incremental (gap-closure plans 13-12 through 13-18, d5ed1298..HEAD)
files_reviewed: 43
files_reviewed_list:
  - CLAUDE.md
  - packages/core/src/compaction.rs
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/actor.rs
  - packages/core/src/domain/epic.rs
  - packages/core/src/domain/task.rs
  - packages/core/src/drift.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/forge/transitions.rs
  - packages/core/src/status_derivation.rs
  - packages/core/tests/compaction.rs
  - packages/core/tests/context_packet_bound.rs
  - packages/core/tests/drift.rs
  - packages/core/tests/epic_context_packet.rs
  - packages/core/tests/five_cycle_reconstitution.rs
  - packages/core/tests/lock_contention.rs
  - packages/core/tests/migration_safety.rs
  - packages/core/tests/migration_schema_too_far_ahead.rs
  - packages/core/tests/no_agent_status_write.rs
  - packages/core/tests/pm_vocabulary_gate.rs
  - packages/core/tests/proc_timeout_boundary.rs
  - packages/core/tests/proposal_no_promotion.rs
  - packages/core/tests/status_derivation.rs
  - packages/core/tests/status_transitions.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/commands/git_identity.rs
  - packages/desktop/src-tauri/src/scheduler.rs
  - packages/desktop/src/authoring/useAuthoringQuery.ts
  - packages/desktop/src/board/__tests__/board-changed-adoption.test.tsx
  - packages/desktop/src/board/__tests__/board-changed-routing.test.tsx
  - packages/desktop/src/board/__tests__/epic-roster.test.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/useBoardChangedInvalidation.ts
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/dispatch/queries.ts
  - packages/desktop/src/fleet/useFleet.ts
  - packages/desktop/src/item-detail/ActivityTrail.tsx
  - packages/desktop/src/review/useReviewQuery.ts
  - packages/desktop/src/settings/PermissionRulesTable.tsx
  - packages/desktop/src/state/__tests__/surface-union.test.ts
  - packages/desktop/src/state/keyboard.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 13: Code Review Report (gap-closure round, plans 13-12..13-18)

**Reviewed:** 2026-10-15
**Depth:** standard (incremental, `d5ed1298..HEAD`)
**Files Reviewed:** 43
**Status:** issues_found

## Summary

Reviewed only what the seven gap-closure plans changed. No blockers. The two highest-risk items both hold up:

- **13-17 (refusal before backup).** `refuse_if_schema_ahead` opens the file with `SQLITE_OPEN_READ_ONLY`, reads `user_version` through `Migrations::current_version`, and returns before `backup_database_file` runs. No `fs::copy` and no write to the live file is reachable on that path. The test asserts byte equality, mtime equality and an unchanged backups directory, and the genuine-failure branch is still covered (`a_genuine_mid_migration_failure_still_takes_a_backup_and_restores_it`). A non-SQLite or corrupt file now fails at the read-only open, before a backup is taken; that is acceptable and loud.
- **13-15 (`board:changed` routing).** The hook compares `eventProjectId === scopeProjectId` by exact string equality. A non-string `projectId` (null, absent, malformed) invalidates, and so does a `viewed` scope with no project selected. Empty `keys` disables the subscription rather than subscribing to nothing. The effect cleans up on `cancelled`/`unlisten`/`pending`. Dependencies are `scopeProjectId`, `scope.kind`, `keysJson`, `debounceMs` and `disabled`; everything else is read through refs. I found no reader that lost a refresh it needed. The one difference from the old code is that a project-scoped reader with `projectId === undefined` is now fully disabled instead of subscribed; that is harmless because it has no query to refresh.

Also verified: the `decision_ids_on_record` cap, candidate list and `LIMIT` are all bound parameters; an empty candidate list issues no statement; a read error is returned and the caller maps it to `None`, which silences the fabricated-echo detector instead of defaulting to "nothing on record" (the dangerous direction is closed). The 13-16 retry fires at most once, only on a review edge, and only when `was < found < want` in band order, so a card dragged back, or moved to or past the intended band, is never written. The unmet-criteria event is now appended once, inside the deriver, on the `winner == "done"` write only. The scoped tests I ran (`migration_schema_too_far_ahead`, `no_agent_status_write`) pass.

The findings below are gate-strength and documentation defects, plus one detector false-accusation edge. None are product-correctness blockers.

## Warnings

### WR-01: Both rewritten SQL gates are blind to Rust `\` line continuations

**File:** `packages/core/tests/no_agent_status_write.rs:79-95` and `packages/core/tests/proposal_no_promotion.rs:228-232` (`normalise_sql`)
**Issue:** 13-14 and 13-13 claim the gates now "see reordered and split statements" by joining lines, collapsing whitespace and lowercasing. They do not strip the trailing `\` that a Rust string literal uses to continue a line, and this codebase uses that continuation constantly (for example `permission_request.rs:303`, `authoring_proposal.rs:1118`, `update.rs:204`). The `\` survives normalisation as a stray token:

- `"UPDATE tasks SET \` newline `status = ?1 WHERE ..."` normalises to `update tasks set \ status = ?1 ...`. After whitespace removal the SET list is `\status=?1`, which fails both `starts_with("status=")` and `contains(",status=")`. A raw `tasks.status` write goes through.
- `"UPDATE tasks SET updated_at = ?1, \` newline `status = ?2"` becomes `...?1,\status=?2`, which also fails `,status=`.
- In Gate 1, `"UPDATE tasks \` newline `SET ..."` becomes `update tasks \ set`, which does not match the pattern `update tasks set`. `"INSERT INTO \` newline `tasks"` likewise.

The planted-violation tests only use `\n` inside the literal, never `\` + newline, so they pass while the idiomatic multi-line form evades. This is the exact evasion class the plans said they closed.
**Fix:** Strip continuations before normalising, then add the continuation form to the planted tests:
```rust
// before joining lines
let line = line.strip_suffix('\\').unwrap_or(line);
```
or, after joining, `normal.replace("\\ ", "")`. Add planted cases such as `"UPDATE tasks SET \\\n status = ?1"` and `"UPDATE tasks SET a = ?1, \\\n status = ?2"` to `the_status_write_gate_fires_on_a_planted_raw_update`, and `"UPDATE tasks \\\n SET x = 1"` to Gate 1's planted test.

### WR-02: Gate 1 matches only some SQLite write forms

**File:** `packages/core/tests/proposal_no_promotion.rs:105-110` (`table_insert_patterns`), `:121-123` (`canonical_update_patterns`)
**Issue:** The pattern set is `insert into T`, `insert or replace into T`, `replace into T`, `update T set`. SQLite also accepts `INSERT OR IGNORE|ABORT|FAIL|ROLLBACK INTO T`, `UPDATE OR <action> T SET`, `UPDATE T AS x SET`, and quoted or schema-qualified names (`INTO "tasks"`, `main.tasks`). Each writes a canonical table and none is matched. The pre-existing grep of the three trees finds no such statement today, so this is a latent evasion in a gate whose purpose (FNC-02, derived coverage) is to catch the next one. `INSERT OR IGNORE` is the form most likely to be written by hand.
**Fix:** Match structurally instead of by literal prefix. For example, after normalisation use a regex such as `\b(insert( or \w+)? into|replace into|update( or \w+)?) ["`\[]?(main\.)?{table}\b` and, for updates, require `set` later in the same statement. At minimum add `insert or ignore into`, `insert or abort into`, `insert or fail into`, `insert or rollback into` to `table_insert_patterns` (and extend `statement_hits`' `insert or ` tail check) and give each a planted case.

### WR-03: `decision_ids_on_record` truncation turns a real older decision into a "fabricated echo"

**File:** `packages/core/src/drift.rs:337-343, 361-364` (the `.take(MAX_ECHOED_DECISION_CANDIDATES)`), consumed at `packages/core/src/drift.rs:233-245`
**Issue:** The cap bounds the cost, but a candidate beyond the 25th is silently dropped from the lookup. The detector then treats "not looked up" as "not on record", so a genuine decision recorded outside the window and echoed past position 25 is reported as `FabricatedDecisionEcho`. That is the false accusation 13-12 set out to remove for read errors, reintroduced for the over-cap case. The new test `the_candidate_cap_boundary_...` asserts the extra id is "never considered" and does not examine what the detector then says. The MCP `acknowledged_decisions` array has no `maxItems`, so the over-cap case is reachable by an agent that echoes every decision it was shown (which is the behaviour the detector rewards).
**Fix:** When `candidates` is truncated, the unresolved tail must not be asserted fabricated. Either return a signal the caller maps to `None` (omit the detector, as for a read error):
```rust
let truncated = candidates_before_take > MAX_ECHOED_DECISION_CANDIDATES;
// return Err / a typed "incomplete" so packet_extras_for sets the lookup result to None
```
or have `detect_decision_read_back` ignore echoed ids beyond the cap. Add a drift test: 26 distinct beyond-scope real ids echoed produces zero warnings.

### WR-04: PM-vocabulary idiom exclusion is per line and per word, contradicting its own test

**File:** `packages/core/tests/pm_vocabulary_gate.rs:134-144`, test at `:253-258`
**Issue:** The exclusion suppresses a hit when `literal.contains(word) && lower.contains(literal)`. For the word `capacity`, `with_capacity` contains it, so any line holding `with_capacity` is exempt for that word regardless of whether a second, PM-meaning `capacity` occurrence sits on the same line. `Vec::with_capacity(team_capacity)` and `Vec::with_capacity(capacity)` therefore pass. The new test `..._per-line exclusion does not shield a PM use sharing the line` only passes because it uses a different word (`sprint_capacity` trips `sprint`). The test comment overstates the guarantee. The same applies to `deadline` in `src/proc.rs`.
**Fix:** Make the exclusion occurrence-level: for each match of `word`, skip it only if that match lies inside an occurrence of `literal` (`literal_start <= match_start && match_end <= literal_end`), and count the line as offending if any other match remains. Add `Vec::with_capacity(team_capacity)` as a planted offender.

### WR-05: CLAUDE.md still contradicts the tree on the git floor

**File:** `CLAUDE.md:53`
**Issue:** 13-18 rewrote this row but left `git ≥ 2.44`. `packages/core/src/git.rs:600-605` sets `MIN_SUPPORTED_GIT = (2, 54, 0)` and states that the older 2.44 floor "was an unbisected guess" it deliberately replaced; `lock_contention.rs` skips below 2.54. The row also says "a deadline-watched child" after 13-14 spent a plan renaming `deadline` to `timeout` in the same code and tests (CLAUDE.md is not scanned by the gate, so nothing catches it). The plan's goal was "no remaining row the tree contradicts".
**Fix:** Change the version cell to `git ≥ 2.54` (cite `MIN_SUPPORTED_GIT`) and "a timeout-supervised child".

## Info

### IN-01: Circular module dependency introduced by moving the unmet-criteria event

**File:** `packages/core/src/status_derivation.rs:34`, `packages/core/src/forge/transitions.rs:43`
**Issue:** `status_derivation` now imports `EVENT_DONE_WITH_UNMET_CRITERIA` from `forge::transitions`, which already imports `band_rank`, `derive_status_in_tx` and `is_review_edge` from `status_derivation`. Rust allows it, but the deriver (the lower layer) now depends on the forge transition module (the caller) for one string constant.
**Fix:** Move the constant next to the other event-type constants in `domain/event.rs` (or into `status_derivation.rs`) and re-export it from `transitions.rs`.

### IN-02: Formatting residue from the hook migration and a runaway doc line

**File:** `packages/desktop/src/board/useBoardQuery.ts` (`useBlockedSummary`, `useRecoverySummary`, `useScopeFlags`, `useEpicProgress` bodies open with a blank line after `{`); `packages/desktop/src/authoring/useAuthoringQuery.ts` and `packages/desktop/src/review/useReviewQuery.ts` (same, plus several 120-plus-column hook calls); `packages/core/src/compaction.rs:107-110` (one doc-comment line is about 170 columns after the WR-10 edit).
**Issue:** Leftover blank lines and an unwrapped comment line. Cosmetic.
**Fix:** Run the formatter and rewrap the `boundary_sentence` doc comment.

### IN-03: `board_entity_for` hides a wrong label behind its catch-all

**File:** `packages/desktop/src-tauri/src/commands/authoring.rs:763-778`
**Issue:** The fix exists so the payload's `entity` is true, but the `_ => "task"` arm will mislabel any future `target_type` as a task, and the in-code comment concedes it. Because the renderer routes only on `projectId`, nothing breaks today.
**Fix:** If `target_type` is (or becomes) a typed enum, match it exhaustively so a new variant fails the build; otherwise keep the arm and leave as is.

---

_Reviewed: 2026-10-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
