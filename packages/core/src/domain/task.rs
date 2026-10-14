//! `create_task` — the tracer's one-transaction write (DATA-01): the projection row, the
//! human-readable key (D-10), the per-origin event sequence (D-17) and the event (D-19) all
//! commit together, or none of them do.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::acceptance_criterion::delete_criteria_for_parent;
use crate::domain::event::{append_event, next_sequence};
use crate::domain::{assert_parent_in_project, ParentTable};
use crate::ids::new_id;
use crate::ranking::{rank_after, rank_before, rank_between, ReorderDirection};

/// The default priority for a newly created task: "No priority", keyed `0` in the keyboard map.
/// It SORTS LAST in `query::list_board` despite being keyed `0` — see that module's sort-key
/// expression (01-UI-SPEC.md Open Decisions #6).
pub const DEFAULT_PRIORITY: i64 = 0;

/// A task row, as read back immediately after `create_task` commits.
#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub key: String,
    pub title: String,
    pub status: String,
    pub rank: String,
    pub priority: i64,
}

/// Create a task: opens exactly one `conn.transaction()` and, inside it, computes the tail rank
/// for the `todo` band, allocates the project's next human-readable key, inserts the `tasks`
/// row, allocates the next event sequence and appends a `task.created` event — then commits
/// once. The projection row and the event either both land or neither does (DATA-01).
///
/// `epic_id` is nullable by design (D-13) — a task may exist before its epic is known. This
/// function performs no join to `epics` and does not require one to exist.
pub fn create_task(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    epic_id: Option<&str>,
) -> anyhow::Result<Task> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let task = create_task_in_tx(&tx, project_id, actor_id, title, epic_id, &now)?;
    tx.commit()
        .context("failed to commit create_task transaction")?;
    Ok(task)
}

/// The statement body [`create_task`] issues, factored out so a caller composing a task creation
/// with something else in the SAME transaction — `domain::authoring_proposal::accept_proposal`,
/// which must never write `tasks` through a second statement of its own (T-05-02-03) — can run it
/// inside a transaction it already owns. `create_task`'s own body and signature are otherwise
/// unchanged; this is the same statements, callable from inside the caller's transaction.
///
/// Band semantics (D-18): a new task is created at `todo`. `backlog` now means exactly "proposed
/// by an agent, not yet accepted"; typing a task is the human act and there is no second
/// acceptance to wait for. A task materialised from an accepted agent proposal also lands here,
/// because acceptance IS the human act for that path.
pub fn create_task_in_tx(
    tx: &Transaction,
    project_id: &str,
    actor_id: &str,
    title: &str,
    epic_id: Option<&str>,
    now: &str,
) -> anyhow::Result<Task> {
    const CREATED_BAND: &str = "todo";
    let id = new_id();

    if let Some(epic_id) = epic_id {
        assert_parent_in_project(tx, project_id, ParentTable::Epics, epic_id)?;
    }

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM tasks WHERE project_id = ?1 AND status = ?2 ORDER BY rank DESC LIMIT 1",
            params![project_id, CREATED_BAND],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the todo tail rank")?;
    let rank = rank_after(last_rank.as_deref())?;

    // Allocate the human-readable key in the same transaction as the insert (D-10) — no gaps,
    // no races.
    let key: String = tx
        .query_row(
            "UPDATE projects SET key_counter = key_counter + 1
             WHERE id = ?1
             RETURNING key_prefix || '-' || key_counter",
            params![project_id],
            |row| row.get(0),
        )
        .context("failed to allocate the next project key")?;

    tx.execute(
        "INSERT INTO tasks (
            id, project_id, epic_id, key, title, status, rank, priority,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?10, ?6, ?7, ?8, ?9, ?9)",
        params![id, project_id, epic_id, key, title, rank, DEFAULT_PRIORITY, actor_id, now, CREATED_BAND],
    )
    .context("failed to insert task")?;

    let sequence = next_sequence(tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": null,
        "after": CREATED_BAND,
        "title": title,
        "label": format!("Created task \"{title}\""),
    });
    append_event(
        tx,
        project_id,
        "local",
        sequence,
        "task",
        &id,
        Some(&id),
        None,
        actor_id,
        "task.created",
        &payload,
        now,
    )?;

    Ok(Task {
        id,
        project_id: project_id.to_string(),
        epic_id: epic_id.map(|s| s.to_string()),
        key,
        title: title.to_string(),
        status: CREATED_BAND.to_string(),
        rank,
        priority: DEFAULT_PRIORITY,
    })
}

/// Patch a task's `title`/`description` — `None` leaves the field unchanged (mirrors
/// `epic.rs::update_epic`'s shape). Appends exactly one event carrying the before/after title.
pub fn update_task(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    title: Option<&str>,
    description: Option<&str>,
) -> anyhow::Result<Task> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let task = update_task_in_tx(&tx, actor_id, task_id, title, description, &now)?;
    tx.commit()
        .context("failed to commit update_task transaction")?;
    Ok(task)
}

/// The statement body [`update_task`] issues, factored out so `domain::authoring_proposal::accept_proposal`
/// can materialise an `amend`/`task` proposal inside its own already-open transaction — mirrors
/// [`create_task_in_tx`]'s identical factoring reason.
pub fn update_task_in_tx(
    tx: &Transaction,
    actor_id: &str,
    task_id: &str,
    title: Option<&str>,
    description: Option<&str>,
    now: &str,
) -> anyhow::Result<Task> {
    let (project_id, epic_id, key, current_title, current_description, status, rank, priority): (
        String,
        Option<String>,
        String,
        String,
        Option<String>,
        String,
        String,
        i64,
    ) = tx
        .query_row(
            "SELECT project_id, epic_id, key, title, description, status, rank, priority FROM tasks WHERE id = ?1",
            params![task_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let new_title = title.unwrap_or(&current_title);
    let new_description = description.or(current_description.as_deref());

    tx.execute(
        "UPDATE tasks SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_title, new_description, now, task_id],
    )
    .context("failed to update task")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "title",
        "before": current_title,
        "after": new_title,
        "label": format!("Edited title to \"{new_title}\""),
    });
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.updated",
        &payload,
        now,
    )?;

    Ok(Task {
        id: task_id.to_string(),
        project_id,
        epic_id,
        key,
        title: new_title.to_string(),
        status,
        rank,
        priority,
    })
}

/// Delete a task. Idempotent: deleting an id that no longer exists returns `Ok` and appends no
/// second event. Issues linked to this task are **orphaned, never cascade-deleted**: `issues.task_id`
/// is set to NULL before the task row itself is removed, so a task deletion never fails with a
/// foreign-key error when an issue references it (CR-01).
///
/// **Revised deletion semantics (D-44, plan `03-05` Task 1 checkpoint — Option A, superseding
/// D-40): the guard is now WORKTREE-ONLY.** D-40 blocked deletion on ANY agent-run history
/// because no path existed to clear a worktree holding uncommitted work; plan `03-01` added that
/// path (`worktree::remove_worktree_for_task`, itself refusing a dirty tree per D-43), so a task
/// with no `worktrees` row can never be deleted out from under uncommitted work regardless of
/// what else is done here. The one condition that still makes deletion dangerous — a live
/// `worktrees` row — still BLOCKS, with an actionable message naming the fix (see the
/// Copywriting Contract string this function's `bail!` uses verbatim), never SQLite's raw
/// `FOREIGN KEY constraint failed`.
///
/// Once that guard clears, this task's `triggers`, `agent_runs` and `permission_requests` rows
/// are CASCADED — deleted in this same transaction, in foreign-key-safe order — rather than kept
/// as permanently-undeletable history. The append-only `events` log is NEVER touched by this or
/// any other path: `events.task_id` is a plain column with no foreign key to `tasks`
/// (`0002_board_schema.sql`), so the full chronological record of what the agent did — every
/// `agent_run.*` and permission-decision entry — survives this deletion untouched. That is the
/// non-repudiable record the core value rests on; `agent_runs` etc. are a reconstructible
/// projection over it, not the record itself. Session transcript files at
/// `<app-data>/sessions/<agent-run-id>.jsonl` (D-34) are also LEFT ON DISK — they are named by
/// run id, referenced by no surviving row, and deleting a user-inspectable transcript as a side
/// effect of deleting a board item is exactly the silent destruction this phase exists to
/// refuse. A task with no worktree, no triggers, no agent runs and no permission requests
/// deletes exactly as it did before this decision existed.
pub fn delete_task(conn: &mut Connection, actor_id: &str, task_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    delete_task_in_tx(&tx, actor_id, task_id, &now)?;
    tx.commit()
        .context("failed to commit delete_task transaction")?;
    Ok(())
}

/// The statement body [`delete_task`] issues, factored out so `domain::authoring_proposal::accept_proposal`
/// can materialise a `delete`/`task` proposal inside its own already-open transaction — mirrors
/// [`create_task_in_tx`]'s identical factoring reason. Idempotent, exactly like [`delete_task`]
/// itself: an id that no longer exists is a no-op, no event appended. The worktree-only guard
/// (D-44) is unchanged: a live `worktrees` row still refuses the delete with the same actionable
/// message.
pub fn delete_task_in_tx(tx: &Transaction, actor_id: &str, task_id: &str, now: &str) -> anyhow::Result<()> {
    let existing: Option<(String, Option<String>, String)> = tx
        .query_row(
            "SELECT project_id, epic_id, title FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read task before delete")?;

    let Some((project_id, epic_id, title)) = existing else {
        return Ok(());
    };

    // D-44 (plan 03-05, revising D-40): the guard is now WORKTREE-ONLY. A single condition means
    // there is no longer a "name whichever count is nonzero" case to guard against — WR-01's
    // priority-ordered wording is gone because the contradiction it protected against (naming a
    // count that is itself zero) cannot occur with one check.
    let worktree_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .context("failed to count worktrees referencing this task")?;

    if worktree_count > 0 {
        anyhow::bail!(
            "Cannot delete this task: a worktree exists for it. Remove the worktree first, then delete."
        );
    }

    // D-44 Option A: once no worktree row exists, cascade this task's recorded agent history —
    // `permission_requests` (references `agent_runs`), then `agent_runs`, then `triggers` — in
    // this same transaction, in foreign-key-safe order. Each is its own compile-time-literal
    // statement with a single bound parameter (Phase 01's no-format!-SQL rule). The row count
    // comes directly from each DELETE's own affected-row return value, not a separate COUNT(*)
    // query, since the count and the deletion are the same fact. `events` is never touched here
    // (see the function doc comment) — a source-scanning verify gate asserts no `DELETE FROM
    // events` exists anywhere in this file.
    let permission_requests_deleted = tx
        .execute("DELETE FROM permission_requests WHERE task_id = ?1", params![task_id])
        .context("failed to delete permission requests referencing this task")?;
    let agent_runs_deleted = tx
        .execute("DELETE FROM agent_runs WHERE task_id = ?1", params![task_id])
        .context("failed to delete agent runs referencing this task")?;
    let triggers_deleted = tx
        .execute("DELETE FROM triggers WHERE target_task_id = ?1", params![task_id])
        .context("failed to delete triggers referencing this task")?;

    // One summarising event, not one per deleted row (mirrors D-53's "count, do not narrate"
    // instinct) — and only when there was history to summarise, so the ordinary case (a task
    // that never started work) appends no extra event and is a no-op regression check.
    if permission_requests_deleted > 0 || agent_runs_deleted > 0 || triggers_deleted > 0 {
        let sequence = next_sequence(&tx, &project_id, "local")?;
        let payload = serde_json::json!({
            "field": "history",
            "before": {
                "agent_runs": agent_runs_deleted,
                "triggers": triggers_deleted,
                "permission_requests": permission_requests_deleted,
            },
            "after": null,
            "label": format!(
                "Deleted {agent_runs_deleted} recorded agent run(s), {triggers_deleted} trigger(s) and {permission_requests_deleted} permission request(s) for \"{title}\""
            ),
        });
        append_event(
            &tx,
            &project_id,
            "local",
            sequence,
            "task",
            task_id,
            Some(task_id),
            epic_id.as_deref(),
            actor_id,
            "task.history_deleted",
            &payload,
            &now,
        )?;
    }

    // Issues referencing this task must also be orphaned, not left dangling — `issues.task_id`
    // is a `NO ACTION` FK to `tasks(id)` with `foreign_keys = ON`, so the `DELETE FROM tasks`
    // below would otherwise fail with a raw SQLite FK constraint error the moment any issue is
    // linked to this task (CR-01). Mirrors `delete_epic`'s issue-orphaning: a plain UPDATE, no
    // event appended for the orphaning itself.
    tx.execute(
        "UPDATE issues SET task_id = NULL, updated_at = ?1 WHERE task_id = ?2",
        params![now, task_id],
    )
    .context("failed to orphan issues referencing this task")?;

    // Criteria belong exclusively to their parent (unlike a task's epic, which is orphaned, not
    // cascaded) — deleting the parent deletes its criteria, one `criterion.deleted` event per
    // row, inside this same transaction (D-06, D-19).
    delete_criteria_for_parent(&tx, &project_id, actor_id, "task", task_id, &now)?;

    tx.execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
        .context("failed to delete task")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": "existing",
        "after": "deleted",
        "title": title,
        "label": format!("Deleted task \"{title}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.deleted",
        &payload,
        &now,
    )?;

    Ok(())
}

/// Set a task's workflow status. A redundant transition (new value equals the current value) is
/// a no-op: `Ok` is returned, `updated_at` is left untouched, and no event is appended. An
/// invalid status is rejected by the schema CHECK constraint in migration `0002_board_schema.sql`
/// (BOARD-04, T-01-15) — this function performs no application-layer allow-list of its own.
///
/// Opens its own transaction and delegates the whole body to [`set_task_status_in_tx`],
/// committing once. Signature and observable behaviour are unchanged by that extraction.
pub fn set_task_status(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_status: &str,
) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    set_task_status_in_tx(&tx, actor_id, task_id, new_status)?;
    tx.commit().context("failed to commit set_task_status transaction")?;
    Ok(())
}

/// The statement body [`set_task_status`] issues, factored out so a caller already holding a
/// transaction — `forge::transitions::apply_forge_observation` (phase 7 plan 07-07) — can compose
/// a status change with its own writes atomically, inside one transaction, instead of nesting a
/// second `conn.transaction()`. This is the crate's established `*_in_tx` idiom, the same reason
/// `domain::authoring_proposal::accept_proposal_in_tx`/`merge_proposal_in_tx` and
/// `domain::agent_run::interrupt_agent_run_in_tx` exist.
///
/// A redundant transition (new value equals the current value) is a no-op: `Ok` is returned,
/// `updated_at` is left untouched, and no event is appended — the same guarantee
/// `set_task_status` has always made. On a real transition: `UPDATE tasks SET status = ?1,
/// updated_at = ?2 WHERE id = ?3`, then one `task.status_changed` event carrying its
/// `field`/`before`/`after`/`label` payload. Does not commit — the caller's transaction owns
/// that.
///
/// **No caller anywhere may issue a raw `UPDATE tasks SET status`.** The schema CHECK constraint
/// in migration `0002_board_schema.sql` is the sole authority on the status vocabulary, and this
/// function is the only path to it.
pub fn set_task_status_in_tx(
    tx: &Transaction,
    actor_id: &str,
    task_id: &str,
    new_status: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();

    let (project_id, epic_id, current_status): (String, Option<String>, String) = tx
        .query_row(
            "SELECT project_id, epic_id, status FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_status == new_status {
        return Ok(());
    }

    tx.execute(
        "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_status, now, task_id],
    )
    .context("failed to set task status")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": current_status,
        "after": new_status,
        "label": format!("Changed status from {current_status} to {new_status}"),
    });
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.status_changed",
        &payload,
        &now,
    )?;

    Ok(())
}

/// The event a human decline appends (A-08(a)). A marker plus an audit snapshot (count and
/// criterion ids, never statement text); the reason itself is read live from the criteria.
pub const EVENT_CHANGES_REQUESTED: &str = "task.changes_requested";

/// One current, unchecked criterion of a task — what a decline sends back.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct UncheckedCriterion {
    pub id: String,
    pub statement: String,
}

/// Why a decline is not offered. `category()` is the wire string the renderer switches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangesRequestRefusal {
    NotInFlight,
    Integrated,
    NoCriteria,
    NothingUnchecked,
}

impl ChangesRequestRefusal {
    pub fn category(&self) -> &'static str {
        match self {
            Self::NotInFlight => "notInFlight",
            Self::Integrated => "integrated",
            Self::NoCriteria => "noCriteria",
            Self::NothingUnchecked => "nothingUnchecked",
        }
    }
}

/// What the review surface may offer for a task right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangesRequestState {
    Ready(Vec<UncheckedCriterion>),
    SentBack(Vec<UncheckedCriterion>),
    Refused(ChangesRequestRefusal),
}

/// What [`request_changes`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangesRequestOutcome {
    Requested { count: usize },
    AlreadySentBack,
    Refused(ChangesRequestRefusal),
}

/// Every current criterion of a task as `(criterion, checked)`, in the same rank-then-id order
/// `context_packet::CRITERIA_SQL` uses, so the reason reads in the order the agent's own
/// Acceptance Criteria section does. Current revisions only (`superseded_at IS NULL`) — the same
/// predicate `forge::transitions` uses for its unmet count.
fn current_criteria(conn: &Connection, task_id: &str) -> anyhow::Result<Vec<(UncheckedCriterion, bool)>> {
    let mut stmt = conn.prepare(
        "SELECT id, statement, checked FROM acceptance_criteria \
         WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL \
         ORDER BY rank ASC, id ASC",
    )?;
    let rows = stmt
        .query_map(params![task_id], |row| {
            Ok((
                UncheckedCriterion { id: row.get(0)?, statement: row.get(1)? },
                row.get::<_, i64>(2)? != 0,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the task's current acceptance criteria")?;
    Ok(rows)
}

/// Is a decline the newest word on the task? True when its newest `task.changes_requested` event
/// is later (by `sequence`) than its newest move to `in_review` — a re-submission, by a human or
/// by the forge's own `None -> open` edge, clears the marker.
fn decline_is_newest(conn: &Connection, task_id: &str) -> anyhow::Result<bool> {
    let newest: Option<String> = conn
        .query_row(
            "SELECT event_type FROM events WHERE task_id = ?1 AND ( event_type = ?2 OR \
             (event_type = 'task.status_changed' AND json_extract(payload, '$.after') = 'in_review') ) \
             ORDER BY sequence DESC LIMIT 1",
            params![task_id, EVENT_CHANGES_REQUESTED],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the task's decline marker")?;
    Ok(newest.as_deref() == Some(EVENT_CHANGES_REQUESTED))
}

/// The live unchecked list when a decline is pending, else `None`. Pending means the decline is
/// the newest word on the task AND some current criterion is still unchecked. Carries no status
/// gate: a declined task later demoted to Todo still briefs its next session with the reason.
pub fn pending_changes_request(
    conn: &Connection,
    task_id: &str,
) -> anyhow::Result<Option<Vec<UncheckedCriterion>>> {
    if !decline_is_newest(conn, task_id)? {
        return Ok(None);
    }
    let unchecked: Vec<UncheckedCriterion> =
        current_criteria(conn, task_id)?.into_iter().filter(|(_, checked)| !checked).map(|(c, _)| c).collect();
    Ok((!unchecked.is_empty()).then_some(unchecked))
}

/// Derive what the surface may offer for `task_id`. Precedence: not in flight, integrated (a
/// recorded event, a board read — no git), no criteria, sent back, nothing unchecked, ready.
pub fn changes_request_state(conn: &Connection, task_id: &str) -> anyhow::Result<ChangesRequestState> {
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0))
        .with_context(|| format!("task {task_id:?} not found"))?;
    if status != "in_progress" && status != "in_review" {
        return Ok(ChangesRequestState::Refused(ChangesRequestRefusal::NotInFlight));
    }
    if crate::merge::integrated_merge_commit(conn, task_id)?.is_some() {
        return Ok(ChangesRequestState::Refused(ChangesRequestRefusal::Integrated));
    }
    let criteria = current_criteria(conn, task_id)?;
    if criteria.is_empty() {
        return Ok(ChangesRequestState::Refused(ChangesRequestRefusal::NoCriteria));
    }
    let unchecked: Vec<UncheckedCriterion> =
        criteria.into_iter().filter(|(_, checked)| !checked).map(|(c, _)| c).collect();
    if unchecked.is_empty() {
        return Ok(ChangesRequestState::Refused(ChangesRequestRefusal::NothingUnchecked));
    }
    if decline_is_newest(conn, task_id)? {
        return Ok(ChangesRequestState::SentBack(unchecked));
    }
    Ok(ChangesRequestState::Ready(unchecked))
}

/// Decline a task's work: send its unchecked criteria back to the agent (A-08(a)). One
/// transaction. The state is re-derived inside it, so a stale `Ready` on screen cannot record a
/// decline the board no longer supports, and a double click is `AlreadySentBack`. On a real
/// decline the status moves to `in_progress` through [`set_task_status_in_tx`] (D-03: the one
/// status implementation; a task already `in_progress` is that writer's documented no-op) and one
/// `task.changes_requested` event is appended beside it. The command accepts no reason text: the
/// reason is the unchecked criteria, read live at briefing time.
pub fn request_changes(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
) -> anyhow::Result<ChangesRequestOutcome> {
    let tx = conn.transaction()?;
    let unchecked = match changes_request_state(&tx, task_id)? {
        ChangesRequestState::Refused(why) => return Ok(ChangesRequestOutcome::Refused(why)),
        ChangesRequestState::SentBack(_) => return Ok(ChangesRequestOutcome::AlreadySentBack),
        ChangesRequestState::Ready(unchecked) => unchecked,
    };

    let (project_id, epic_id, from_status): (String, Option<String>, String) = tx
        .query_row(
            "SELECT project_id, epic_id, status FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    set_task_status_in_tx(&tx, actor_id, task_id, "in_progress")?;

    let count = unchecked.len();
    let noun = if count == 1 { "criterion" } else { "criteria" };
    let payload = serde_json::json!({
        "unchecked_count": count,
        "criterion_ids": unchecked.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        "from_status": from_status,
        "label": format!("Requested changes: {count} acceptance {noun} unchecked"),
    });
    let sequence = next_sequence(&tx, &project_id, "local")?;
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        EVENT_CHANGES_REQUESTED,
        &payload,
        &Utc::now().to_rfc3339(),
    )?;

    tx.commit().context("failed to commit request_changes transaction")?;
    Ok(ChangesRequestOutcome::Requested { count })
}

/// Move a task up or down by one position within its `(project_id, status, priority)` band
/// (D-11, BOARD-05) — the manual-rank half of the tie-break rule ("priority sorts first, rank
/// orders within a band"). Filtering the neighbour lookup by `priority`, not merely
/// `(project_id, status)`, is what keeps `⌘↑`/`⌘↓` from computing a rank against a neighbour in a
/// different priority band: `list_board`'s `priority ASC, rank ASC, id ASC` order groups by
/// priority first, so the neighbour a keyboard reorder must actually displace is scoped by
/// priority too.
///
/// One transaction: read the task's own `(project_id, status, priority, rank)`, look up its one
/// or two nearest neighbours in the move direction with a single indexed query against
/// `(project_id, status, rank)`, compute the new rank from [`rank_before`]/[`rank_between`]/
/// [`rank_after`], write exactly one `UPDATE`, append one `task.reordered` event, and commit.
/// A task with no neighbour in the move direction (already first for `Up`, already last for
/// `Down`, or the only item in its band) is a no-op: `Ok` is returned and no row is written.
pub fn reorder_task(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    direction: ReorderDirection,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, status, priority, rank): (
        String,
        Option<String>,
        String,
        i64,
        String,
    ) = tx
        .query_row(
            "SELECT project_id, epic_id, status, priority, rank FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let new_rank = match direction {
        ReorderDirection::Up => {
            // Newest-first by (rank, id): LIMIT 2 gives [immediate predecessor, its own
            // predecessor] in one indexed query against (project_id, status, rank).
            let mut stmt = tx.prepare(
                "SELECT rank FROM tasks
                 WHERE project_id = ?1 AND status = ?2 AND priority = ?3
                   AND (rank, id) < (?4, ?5)
                 ORDER BY rank DESC, id DESC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, status, priority, rank, task_id], |row| {
                    row.get(0)
                })?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the preceding neighbours")?;
            match neighbours.as_slice() {
                [] => None,
                [prev] => Some(rank_before(Some(prev.as_str()))?),
                [prev, prev_prev, ..] => Some(rank_between(prev_prev, prev)?),
            }
        }
        ReorderDirection::Down => {
            let mut stmt = tx.prepare(
                "SELECT rank FROM tasks
                 WHERE project_id = ?1 AND status = ?2 AND priority = ?3
                   AND (rank, id) > (?4, ?5)
                 ORDER BY rank ASC, id ASC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, status, priority, rank, task_id], |row| {
                    row.get(0)
                })?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the following neighbours")?;
            match neighbours.as_slice() {
                [] => None,
                [next] => Some(rank_after(Some(next.as_str()))?),
                [next, next_next, ..] => Some(rank_between(next, next_next)?),
            }
        }
    };

    let Some(new_rank) = new_rank else {
        tx.commit()
            .context("failed to commit no-op reorder_task transaction")?;
        return Ok(());
    };

    tx.execute(
        "UPDATE tasks SET rank = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_rank, now, task_id],
    )
    .context("failed to reorder task")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "rank",
        "before": rank,
        "after": new_rank,
        "label": "Reordered",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.reordered",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit reorder_task transaction")?;
    Ok(())
}

/// Set a task's priority (D-11, 5-level Linear convention, 0-4). A redundant change (new value
/// equals the current value) is a no-op: `Ok` is returned, `updated_at` is left untouched, and no
/// event is appended. A priority outside `0..=4` is rejected by the schema CHECK constraint in
/// migration `0002_board_schema.sql` — this function performs no application-layer range check
/// of its own, mirroring `set_task_status`'s deferral to the schema.
pub fn set_priority(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_priority: i64,
) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    set_priority_in_tx(&tx, actor_id, task_id, new_priority)?;
    tx.commit()
        .context("failed to commit set_priority transaction")?;
    Ok(())
}

/// The statement body [`set_priority`] issues, factored out the way [`set_task_status_in_tx`]
/// was, so a caller already holding a transaction can compose a priority change with its own
/// writes atomically instead of nesting a second one. It exists so that accepting a priority
/// suggestion can run inside `authoring_proposal::accept_proposal_in_tx`'s per-item transaction
/// (D-16, D-17, F4). Same no-op, event and range-check behaviour as [`set_priority`]; does not
/// commit — the caller's transaction owns that.
pub fn set_priority_in_tx(
    tx: &Transaction,
    actor_id: &str,
    task_id: &str,
    new_priority: i64,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();

    let (project_id, epic_id, current_priority): (String, Option<String>, i64) = tx
        .query_row(
            "SELECT project_id, epic_id, priority FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_priority == new_priority {
        return Ok(());
    }

    tx.execute(
        "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_priority, now, task_id],
    )
    .context("failed to set task priority")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "priority",
        "before": current_priority,
        "after": new_priority,
        "label": format!("Changed priority from {current_priority} to {new_priority}"),
    });
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.priority_changed",
        &payload,
        &now,
    )?;
    Ok(())
}

/// Set a task's assignee to an actor id, or clear it with `None`. An id that names no row in
/// `actors` is rejected by the `assignee_id` foreign key (T-01-21) — `foreign_keys = ON` is set
/// on every connection (`db::open_and_migrate`), so this function performs no application-layer
/// existence check of its own; the `UPDATE` itself fails with a SQLite foreign-key-constraint
/// error. A redundant change is a no-op, mirroring `set_priority`.
pub fn set_assignee(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_assignee_id: Option<&str>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, current_assignee_id): (String, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT project_id, epic_id, assignee_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_assignee_id.as_deref() == new_assignee_id {
        tx.commit()
            .context("failed to commit no-op set_assignee transaction")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE tasks SET assignee_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_assignee_id, now, task_id],
    )
    .context("failed to set task assignee — assignee_id must reference an existing actor")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "assignee_id",
        "before": current_assignee_id,
        "after": new_assignee_id,
        "label": "Changed assignee",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        "task.assignee_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_assignee transaction")?;
    Ok(())
}

/// Reparent a task under an epic, or clear its epic with `None` (G-01-EPIC-ASSIGN). A parent id
/// in another project is rejected by [`assert_parent_in_project`] (T-01-GC-01); a redundant call
/// naming the epic the task already has is a no-op — `Ok` is returned, `updated_at` is left
/// untouched, and no event is appended, mirroring `set_priority`/`set_assignee`.
///
/// Appends exactly one `task.epic_changed` event whose denormalised `epic_id` column is the NEW
/// parent, not the task's own `epic_id` at the time of the call — so the arrival shows on the
/// receiving epic's activity trail (D-19); the task's own trail, queried by `task_id`, is
/// unaffected by this choice.
pub fn set_epic(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_epic_id: Option<&str>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, current_epic_id): (String, Option<String>) = tx
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    if current_epic_id.as_deref() == new_epic_id {
        tx.commit()
            .context("failed to commit no-op set_epic transaction")?;
        return Ok(());
    }

    if let Some(epic_id) = new_epic_id {
        assert_parent_in_project(&tx, &project_id, ParentTable::Epics, epic_id)?;
    }

    tx.execute(
        "UPDATE tasks SET epic_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_epic_id, now, task_id],
    )
    .context("failed to set task epic")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "epic_id",
        "before": current_epic_id,
        "after": new_epic_id,
        "label": "Changed epic",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        new_epic_id,
        actor_id,
        "task.epic_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_epic transaction")?;
    Ok(())
}
