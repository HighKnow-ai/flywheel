# Phase 13 authority and write-past-the-gate allow-list

Plan 13-09, requirement FNC-03, ROADMAP criterion 2.

Criterion 2 originally read "refactored or allow-listed". Amendment A-01 changed it to
"refactored, deleted, or allow-listed", precisely to permit row 1 below: that write is redundant
once status is derived, so it is deleted rather than allow-listed. The amendment is recorded in
`.planning/PROJECT.md` Key Decisions (plan 13-04).

Three sites wrote past the no-promotion gate (research finding F5). Each has one disposition here.
The gate that now catches the class they belong to is
`no_agent_reachable_module_writes_a_canonical_table` in
`packages/core/tests/proposal_no_promotion.rs`. Its INSERT and UPDATE patterns are both derived
from `canonical_tables()` (plan 13-13), each Canonical table has exactly one owning module, and the
allow-list is the `ALLOWED_CANONICAL_UPDATE_SITES` const beside it.

| Site | Disposition | Reason | Revisit when |
|------|-------------|--------|--------------|
| `packages/core/src/domain/agent_run.rs` — the raw `UPDATE tasks SET status` in `start_agent_run` | **deleted** (D-13, A-01; done by plan 13-07) | A run only starts once a worktree exists, so the status deriver has already set the band. A run starting is not a status signal. | Never; `no_agent_status_write.rs` fails the build if any module outside `task.rs` writes `tasks.status`. |
| `packages/core/src/domain/acceptance_criterion.rs` — `UPDATE tasks SET updated_at = ?1 WHERE id = ?2` (parent touch in `write_checked`) | **allow-listed** | An `updated_at` touch of the criterion's own parent inside the criterion-check transaction. It is not a promotion (no board substance is created) and not a status write (the status column is untouched, which `no_agent_status_write.rs` proves independently). Refactoring it into `task.rs` would add a cross-module call for a timestamp. | A task-level writer gains behaviour a criterion check must also trigger (for example a derived field), or a second criterion-side statement appears. |
| `packages/core/src/domain/acceptance_criterion.rs` — `UPDATE epics SET updated_at = ?1 WHERE id = ?2` (same branch, epic parent) | **allow-listed** | Same as the row above, for an epic parent. | Same as the row above. |
| `packages/core/src/domain/task.rs` — `UPDATE issues SET task_id = NULL, updated_at = ?1 WHERE task_id = ?2` (detach in `delete_task_in_tx`) | **allow-listed** (plan 13-13) | Detaching a deleted task's child issues inside the task-delete transaction. Not a promotion (it creates no board substance) and not an issue-content write (title, body, rank and parentage are `issue.rs`'s); routing it through `issue.rs` would add a cross-module call inside the delete transaction for a NULL-out. | `issue.rs` gains a detach helper, or a third module needs to detach issues. |
| `packages/core/src/domain/epic.rs` — `UPDATE tasks SET epic_id = NULL, updated_at = ?1 WHERE epic_id = ?2` (detach in `delete_epic_in_tx`) | **allow-listed** (plan 13-13) | Detaching a deleted epic's child tasks inside the epic-delete transaction. Not a promotion and not a status write; `tasks.epic_id` is a NO ACTION foreign key, so the NULL-out must run in the same transaction as the `DELETE FROM epics`. The old file-level rule ("`epic.rs` owns `UPDATE tasks`") exempted it silently; the per-table owner model makes it a recorded exception. | `task.rs` gains a detach helper the epic delete can call, or a third module needs to detach tasks. |
| `packages/core/src/domain/epic.rs` — `UPDATE issues SET epic_id = NULL, updated_at = ?1 WHERE epic_id = ?2` (same transaction, issue children) | **allow-listed** (plan 13-13) | Same as the task.rs issue-detach row, for an epic parent. | Same as the task.rs issue-detach row. |

An allow-list entry matches one exact normalised statement (lowercased, whitespace collapsed), in
one file. A second `UPDATE tasks SET …` statement added to the same file is an offender, as is a
longer statement that merely begins with the allow-listed one.
`every_allowlisted_update_site_still_exists` fails both when the statement disappears and when a
second occurrence appears, so a stale or duplicated entry cannot silently widen the gate. Rows above
and `ALLOWED_CANONICAL_UPDATE_SITES` entries are in the same order.

## Deliberately outside FNC-03 (WR-13)

This is a scoping decision, not a hole. Two kinds of write are not database-gated and are not in
`AUTHORITY_WRITERS` (`authority_human_only.rs`): the status writers `set_task_status` and
`set_epic_status`, and the task-branch merge (`merge::record_merge_event`, reached through
`review_merge_task`).

- **Status writers.** They are human-only by being unreached from agent code, not by a refusal in
  the database. The renderer's `useSetStatus` hook is deleted, and the source gate
  `no_agent_status_write.rs` enforces the single-writer claim. The one remaining entry point,
  the `task_set_status` Tauri command, is IPC-only and resolves the actor server-side. That is a
  source-gate guarantee, not a database one, and is stated as such.
- **Branch merge.** `merge::record_merge_event` records the event and does not call
  `assert_human_actor_in_tx`. `actor.rs` no longer lists merging among the transitions the helper
  covers.

**Revisit when** Phase 14 decides what an epic's status does, or when any status writer becomes
reachable from agent code. At that point both writers gain `assert_human_actor_in_tx` and an
`AUTHORITY_WRITERS` entry.
