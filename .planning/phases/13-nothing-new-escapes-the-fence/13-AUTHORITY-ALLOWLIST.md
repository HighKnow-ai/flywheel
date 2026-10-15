# Phase 13 authority and write-past-the-gate allow-list

Plan 13-09, requirement FNC-03, ROADMAP criterion 2.

Criterion 2 originally read "refactored or allow-listed". Amendment A-01 changed it to
"refactored, deleted, or allow-listed", precisely to permit row 1 below: that write is redundant
once status is derived, so it is deleted rather than allow-listed. The amendment is recorded in
`.planning/PROJECT.md` Key Decisions (plan 13-04).

Three sites wrote past the no-promotion gate (research finding F5). Each has one disposition here.
The gate that now catches the class they belong to is
`no_agent_reachable_module_writes_a_canonical_table` in
`packages/core/tests/proposal_no_promotion.rs`. Its pattern set now includes `UPDATE tasks SET` and
`UPDATE epics SET`, and the allow-list is the `ALLOWED_CANONICAL_UPDATE_SITES` const beside it.

| Site | Disposition | Reason | Revisit when |
|------|-------------|--------|--------------|
| `packages/core/src/domain/agent_run.rs` — the raw `UPDATE tasks SET status` in `start_agent_run` | **deleted** (D-13, A-01; done by plan 13-07) | A run only starts once a worktree exists, so the status deriver has already set the band. A run starting is not a status signal. | Never; `no_agent_status_write.rs` fails the build if any module outside `task.rs` writes `tasks.status`. |
| `packages/core/src/domain/acceptance_criterion.rs` — `UPDATE tasks SET updated_at = ?1 WHERE id = ?2` (parent touch in `write_checked`) | **allow-listed** | An `updated_at` touch of the criterion's own parent inside the criterion-check transaction. It is not a promotion (no board substance is created) and not a status write (the status column is untouched, which `no_agent_status_write.rs` proves independently). Refactoring it into `task.rs` would add a cross-module call for a timestamp. | A task-level writer gains behaviour a criterion check must also trigger (for example a derived field), or a second criterion-side statement appears. |
| `packages/core/src/domain/acceptance_criterion.rs` — `UPDATE epics SET updated_at = ?1 WHERE id = ?2` (same branch, epic parent) | **allow-listed** | Same as the row above, for an epic parent. | Same as the row above. |

An allow-list entry is an exact (file, pattern) match. `every_allowlisted_update_site_still_exists`
fails if the statement disappears, so a stale entry cannot silently widen the gate.
