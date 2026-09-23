//! Acceptance criteria (BOARD-02, D-05/D-06/D-07/D-08): `create_criterion`, `update_criterion`,
//! `toggle_criterion`, `reorder_criterion`, `delete_criterion` and `list_criteria` — each
//! mutation opens exactly one `conn.transaction()` and commits the projection row and its event
//! together (DATA-01), following `task.rs::create_task`'s shape.
//!
//! A criterion is its own row with its own ULID (D-06) — never a JSON column on the parent — so
//! Phase 4's immutability/revisioning is an additive column, Phase 8 can check one criterion
//! without rewriting its parent, and a session summary can reference one criterion by id. The
//! `parent_type` CHECK constraint in migration `0002_board_schema.sql` (`'task'` or `'epic'`
//! only) is the sole authority on which parent kinds may carry criteria (D-07) — this module
//! performs no application-layer allow-list of its own, mirroring how `task.rs`/`epic.rs` defer
//! workflow-state validity to the schema.
//!
//! `revise_criterion` (D-76/D-77, plan 04-04) is the one write path that decides between an
//! in-place edit and an appended revision: `criteria_locked_for_task` is a fact — the existence
//! of an `agent_runs` row for the parent task, ever — not a status value a human can hand-edit
//! (D-29). Locked, an edit mints a successor row and stamps the predecessor's `superseded_at`,
//! touching no other column on that row, so the original statement an agent was told is never
//! rewritten. Unlocked, it still edits in place through `update_criterion_in_tx`, the single
//! statement site `update_criterion` itself also delegates to.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::{rank_after, rank_between};

/// A criterion row, as read back immediately after a mutation commits (or via `list_criteria`).
#[derive(Debug, Clone, PartialEq)]
pub struct AcceptanceCriterion {
    pub id: String,
    pub parent_type: String,
    pub parent_id: String,
    pub statement: String,
    pub verification_hint: Option<String>,
    pub checked: bool,
    pub rank: String,
    pub created_at: String,
    pub updated_at: String,
    /// D-77's revision counter — 1 for the row a `create_criterion` call wrote, and the
    /// predecessor's `revision + 1` for every successor `revise_criterion` mints. Never touched
    /// by an in-place (unlocked) edit.
    pub revision: i64,
    /// The CHAIN ROOT's id — the criterion row as it was first created — never the immediate
    /// predecessor. `None` on a revision-1 row; `Some` on every successor.
    pub revision_of: Option<String>,
    /// `NULL` means this row is the current revision; a timestamp means a later revision exists
    /// and this row's `statement` is preserved history, never rewritten (D-77).
    pub superseded_at: Option<String>,
}

/// `("task"|"epic", parent_id)` -> the denormalised `(task_id, epic_id)` pair the `events` table
/// stores at write time (D-19) — the single place that mapping is computed, so every mutation
/// function below carries it identically. A `parent_type` outside `{"task","epic"}` can only
/// reach here after the schema CHECK constraint has already rejected the row that would have
/// produced it (see `create_criterion`), so the catch-all arm is unreachable in practice, not a
/// second validity gate.
fn parent_columns(parent_type: &str, parent_id: &str) -> (Option<String>, Option<String>) {
    match parent_type {
        "task" => (Some(parent_id.to_string()), None),
        "epic" => (None, Some(parent_id.to_string())),
        _ => (None, None),
    }
}

/// Map one `acceptance_criteria` row carrying the full 12-column projection (id, parent_type,
/// parent_id, statement, verification_hint, checked, rank, created_at, updated_at, revision,
/// revision_of, superseded_at) — the shape [`list_criteria`], [`list_current_criteria`] and
/// [`list_revisions_for_root`] all share, so the column order is defined exactly once.
fn row_to_criterion(row: &Row) -> rusqlite::Result<AcceptanceCriterion> {
    Ok(AcceptanceCriterion {
        id: row.get(0)?,
        parent_type: row.get(1)?,
        parent_id: row.get(2)?,
        statement: row.get(3)?,
        verification_hint: row.get(4)?,
        checked: row.get::<_, i64>(5)? != 0,
        rank: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        revision: row.get(9)?,
        revision_of: row.get(10)?,
        superseded_at: row.get(11)?,
    })
}

/// Resolve the `project_id` a criterion's mutation event belongs to, by looking up the parent
/// row itself inside the caller's transaction. Only used by mutations that receive a
/// `criterion_id` rather than a fresh `project_id` from the caller (`create_criterion` is given
/// `project_id` directly, exactly as `create_task`/`create_epic` are).
fn resolve_parent_project_id(
    tx: &Transaction,
    parent_type: &str,
    parent_id: &str,
) -> anyhow::Result<String> {
    match parent_type {
        "task" => tx
            .query_row(
                "SELECT project_id FROM tasks WHERE id = ?1",
                params![parent_id],
                |row| row.get(0),
            )
            .context("failed to resolve the criterion's parent task's project_id"),
        "epic" => tx
            .query_row(
                "SELECT project_id FROM epics WHERE id = ?1",
                params![parent_id],
                |row| row.get(0),
            )
            .context("failed to resolve the criterion's parent epic's project_id"),
        other => anyhow::bail!("unknown acceptance_criteria parent_type {other:?}"),
    }
}

/// Create a criterion on a task or an epic (D-07). One transaction: compute the tail rank within
/// `(parent_type, parent_id)`, insert the row, allocate the next event sequence and append a
/// `criterion.created` event — then commit once. Two criteria created with identical `statement`
/// text on the same parent are two rows with two ids and two ranks — nothing here deduplicates
/// or merges by statement text.
///
/// `parent_type` is passed straight through to the INSERT; a value other than `"task"`/`"epic"`
/// (e.g. `"issue"`) is rejected by the schema's `CHECK (parent_type IN ('task', 'epic'))`
/// constraint, not by this function.
#[allow(clippy::too_many_arguments)]
pub fn create_criterion(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    parent_type: &str,
    parent_id: &str,
    statement: &str,
    verification_hint: Option<&str>,
) -> anyhow::Result<AcceptanceCriterion> {
    let id = new_id();
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction()?;

    // Restricted to current revisions (D-79, plan 04-04 Task 3): a superseded row may sort after
    // the current tail by rank alone, and a newly added criterion must rank after the last
    // *current* one, not after a row no one reads anymore.
    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM acceptance_criteria
             WHERE parent_type = ?1 AND parent_id = ?2 AND superseded_at IS NULL
             ORDER BY rank DESC LIMIT 1",
            params![parent_type, parent_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the criteria tail rank")?;
    let rank = rank_after(last_rank.as_deref())?;

    tx.execute(
        "INSERT INTO acceptance_criteria (
            id, parent_type, parent_id, statement, verification_hint, checked, rank,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?8)",
        params![id, parent_type, parent_id, statement, verification_hint, rank, actor_id, now],
    )
    .context("failed to insert acceptance criterion — parent_type must be 'task' or 'epic'")?;

    let (task_id, epic_id) = parent_columns(parent_type, parent_id);
    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "statement",
        "before": null,
        "after": statement,
        "label": format!("Added criterion \"{statement}\""),
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "acceptance_criterion",
        &id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "criterion.created",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit create_criterion transaction")?;

    Ok(AcceptanceCriterion {
        id,
        parent_type: parent_type.to_string(),
        parent_id: parent_id.to_string(),
        statement: statement.to_string(),
        verification_hint: verification_hint.map(|s| s.to_string()),
        checked: false,
        rank,
        created_at: now.clone(),
        updated_at: now,
        revision: 1,
        revision_of: None,
        superseded_at: None,
    })
}

/// The single in-place-edit statement site (Task 2, 04-04-PLAN.md): issues ONLY the `UPDATE`
/// against `acceptance_criteria` — no read, no event, no transaction of its own. Both
/// `update_criterion` (below) and `revise_criterion`'s unlocked branch call this and nothing
/// else ever writes `statement`/`verification_hint` in place, so there is exactly one statement
/// site for an in-place edit, never two.
fn update_criterion_in_tx(
    tx: &Transaction,
    criterion_id: &str,
    statement: &str,
    verification_hint: Option<&str>,
    now: &str,
) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE acceptance_criteria SET statement = ?1, verification_hint = ?2, updated_at = ?3 WHERE id = ?4",
        params![statement, verification_hint, now, criterion_id],
    )
    .context("failed to update criterion")?;
    Ok(())
}

/// Patch a criterion's `statement`/`verification_hint` — `None` leaves the field unchanged
/// (mirrors `task.rs::update_task`'s shape). This is an edit, not a check: it never touches
/// `checked` or `rank`. Never consults the lock (D-76) — this is the pre-Phase-4 in-place editor,
/// unchanged behaviour/signature/event by this plan's own extraction; `revise_criterion` is the
/// lock-aware entry point new callers should prefer.
pub fn update_criterion(
    conn: &mut Connection,
    actor_id: &str,
    criterion_id: &str,
    statement: Option<&str>,
    verification_hint: Option<&str>,
) -> anyhow::Result<AcceptanceCriterion> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (parent_type, parent_id, current_statement, current_hint, checked, rank, created_at, revision, revision_of, superseded_at): (
        String,
        String,
        String,
        Option<String>,
        i64,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT parent_type, parent_id, statement, verification_hint, checked, rank, created_at,
                    revision, revision_of, superseded_at
             FROM acceptance_criteria WHERE id = ?1",
            params![criterion_id],
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
                    row.get(8)?,
                    row.get(9)?,
                ))
            },
        )
        .with_context(|| format!("criterion {criterion_id:?} not found"))?;

    let project_id = resolve_parent_project_id(&tx, &parent_type, &parent_id)?;

    let new_statement = statement.unwrap_or(&current_statement);
    let new_hint = verification_hint.or(current_hint.as_deref());

    update_criterion_in_tx(&tx, criterion_id, new_statement, new_hint, &now)?;

    let (task_id, epic_id) = parent_columns(&parent_type, &parent_id);
    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "statement",
        "before": current_statement,
        "after": new_statement,
        "label": format!("Edited criterion to \"{new_statement}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "acceptance_criterion",
        criterion_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "criterion.updated",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit update_criterion transaction")?;

    Ok(AcceptanceCriterion {
        id: criterion_id.to_string(),
        parent_type,
        parent_id,
        statement: new_statement.to_string(),
        verification_hint: new_hint.map(|s| s.to_string()),
        checked: checked != 0,
        rank,
        created_at,
        updated_at: now,
        revision,
        revision_of,
        superseded_at,
    })
}

/// D-76: the lock is a FACT, not a flag — whether an `agent_runs` row has ever existed for
/// `task_id`, not `tasks.status` (which a human can hand-edit, per D-29's identical concern about
/// agent-attributed progress). True the moment work has ever started on the task, even if every
/// run since finished, was abandoned, or was interrupted: the wording an agent was told must
/// never move regardless of what happened to the run afterward. For an epic parent this predicate
/// is never consulted — `revise_criterion` never locks an epic-parented criterion (D-76 is about
/// work starting on a task).
pub fn criteria_locked_for_task(conn: &Connection, task_id: &str) -> anyhow::Result<bool> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM agent_runs WHERE task_id = ?1 LIMIT 1",
            params![task_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to check whether any agent_runs row exists for this task")?;
    Ok(exists.is_some())
}

/// A typed, downcastable value naming an edit that landed on a locked criterion — declared so a
/// FUTURE caller that wants to REFUSE such an edit outright can recognise it, even though
/// [`revise_criterion`] itself never returns this: D-77's own answer is to revise, not refuse.
/// Follows `permission_request::AlreadyAnsweredError`'s exact shape.
#[derive(Debug, Clone, PartialEq)]
pub struct CriteriaLockedError {
    pub criterion_id: String,
    pub task_id: String,
}

impl std::fmt::Display for CriteriaLockedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "criterion {:?} is locked — task {:?} has an agent_runs row, so its statement can \
             only be revised (a new row appended), never overwritten in place",
            self.criterion_id, self.task_id
        )
    }
}

impl std::error::Error for CriteriaLockedError {}

/// Revise a criterion (D-76/D-77) — the one write path that decides between an in-place edit and
/// an appended revision. Unlocked (no `agent_runs` row for the parent task, ever, or the parent
/// is an epic): delegates to [`update_criterion_in_tx`] exactly like [`update_criterion`], no
/// revision row, no `superseded_at` marker. Locked: mints a successor row carrying the new
/// `statement`/`verification_hint` and the predecessor's `rank`/`checked`, with `revision` one
/// past the predecessor's and `revision_of` pointing at the CHAIN ROOT (the predecessor's own
/// `revision_of` when it has one, or the predecessor's own id when it does not) — then stamps the
/// predecessor's `superseded_at`, touching no other column on that row. Both branches append
/// exactly one event; the locked branch's is `criterion.revised`, carrying the before/after
/// statement pair (D-19).
pub fn revise_criterion(
    conn: &mut Connection,
    actor_id: &str,
    criterion_id: &str,
    statement: &str,
    verification_hint: Option<&str>,
) -> anyhow::Result<AcceptanceCriterion> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (
        parent_type,
        parent_id,
        current_statement,
        _current_hint,
        checked,
        rank,
        revision,
        revision_of,
    ): (String, String, String, Option<String>, i64, String, i64, Option<String>) = tx
        .query_row(
            "SELECT parent_type, parent_id, statement, verification_hint, checked, rank, revision, revision_of
             FROM acceptance_criteria WHERE id = ?1",
            params![criterion_id],
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
        .with_context(|| format!("criterion {criterion_id:?} not found"))?;

    let project_id = resolve_parent_project_id(&tx, &parent_type, &parent_id)?;
    let (task_id, epic_id) = parent_columns(&parent_type, &parent_id);

    let locked = match parent_type.as_str() {
        "task" => criteria_locked_for_task(&tx, &parent_id)?,
        _ => false,
    };

    if !locked {
        update_criterion_in_tx(&tx, criterion_id, statement, verification_hint, &now)?;

        let sequence = next_sequence(&tx, &project_id, "local")?;
        let payload = serde_json::json!({
            "field": "statement",
            "before": current_statement,
            "after": statement,
            "label": format!("Edited criterion to \"{statement}\""),
        });
        append_event(
            &tx,
            &project_id,
            "local",
            sequence,
            "acceptance_criterion",
            criterion_id,
            task_id.as_deref(),
            epic_id.as_deref(),
            actor_id,
            "criterion.updated",
            &payload,
            &now,
        )?;

        tx.commit().context("failed to commit revise_criterion (unlocked) transaction")?;

        return Ok(AcceptanceCriterion {
            id: criterion_id.to_string(),
            parent_type,
            parent_id,
            statement: statement.to_string(),
            verification_hint: verification_hint.map(|s| s.to_string()),
            checked: checked != 0,
            rank,
            created_at: now.clone(),
            updated_at: now,
            revision,
            revision_of,
            superseded_at: None,
        });
    }

    // Locked: append a successor, never touch the predecessor's own statement.
    let successor_id = new_id();
    let new_revision = revision + 1;
    let chain_root = revision_of.clone().unwrap_or_else(|| criterion_id.to_string());

    tx.execute(
        "INSERT INTO acceptance_criteria (
            id, parent_type, parent_id, statement, verification_hint, checked, rank,
            revision, revision_of, superseded_at, created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?11)",
        params![
            successor_id,
            parent_type,
            parent_id,
            statement,
            verification_hint,
            checked,
            rank,
            new_revision,
            chain_root,
            actor_id,
            now,
        ],
    )
    .context("failed to insert successor criterion revision")?;

    // Touches ONE column: superseded_at. Never the same statement in this or any other
    // assignment list (the crate-wide grep gate this plan's own <verify> runs).
    tx.execute(
        "UPDATE acceptance_criteria SET superseded_at = ?1 WHERE id = ?2",
        params![now, criterion_id],
    )
    .context("failed to mark the predecessor criterion superseded")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "statement",
        "before": current_statement,
        "after": statement,
        "label": format!("Revised criterion \"{statement}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "acceptance_criterion",
        &successor_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "criterion.revised",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit revise_criterion (locked) transaction")?;

    Ok(AcceptanceCriterion {
        id: successor_id,
        parent_type,
        parent_id,
        statement: statement.to_string(),
        verification_hint: verification_hint.map(|s| s.to_string()),
        checked: checked != 0,
        rank,
        created_at: now.clone(),
        updated_at: now,
        revision: new_revision,
        revision_of: Some(chain_root),
        superseded_at: None,
    })
}

/// Flip a criterion's `checked` state. This is the plan's own load-bearing prohibition made
/// concrete: the UPDATE statement against `acceptance_criteria` names ONLY the `checked` column
/// and `updated_at` — never `rank`, `statement` or `verification_hint` — because a check is not
/// an edit (T-01-20). A second UPDATE, naming only `updated_at`, touches the parent task/epic
/// row so its own "last modified" reflects that its contract state changed, without rewriting
/// any of the parent's own authored fields.
pub fn toggle_criterion(
    conn: &mut Connection,
    actor_id: &str,
    criterion_id: &str,
) -> anyhow::Result<AcceptanceCriterion> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (parent_type, parent_id, statement, verification_hint, checked, rank, created_at, revision, revision_of, superseded_at): (
        String,
        String,
        String,
        Option<String>,
        i64,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT parent_type, parent_id, statement, verification_hint, checked, rank, created_at,
                    revision, revision_of, superseded_at
             FROM acceptance_criteria WHERE id = ?1",
            params![criterion_id],
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
                    row.get(8)?,
                    row.get(9)?,
                ))
            },
        )
        .with_context(|| format!("criterion {criterion_id:?} not found"))?;

    let project_id = resolve_parent_project_id(&tx, &parent_type, &parent_id)?;
    let new_checked = if checked == 0 { 1 } else { 0 };

    tx.execute(
        "UPDATE acceptance_criteria SET checked = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_checked, now, criterion_id],
    )
    .context("failed to toggle criterion")?;

    let touch_result: rusqlite::Result<usize> = match parent_type.as_str() {
        "task" => tx.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            params![now, parent_id],
        ),
        "epic" => tx.execute(
            "UPDATE epics SET updated_at = ?1 WHERE id = ?2",
            params![now, parent_id],
        ),
        other => return Err(anyhow::anyhow!("unknown acceptance_criteria parent_type {other:?}")),
    };
    touch_result.context("failed to touch the parent's updated_at")?;

    let (task_id, epic_id) = parent_columns(&parent_type, &parent_id);
    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "checked",
        "before": checked != 0,
        "after": new_checked != 0,
        "label": format!(
            "{} criterion \"{}\"",
            if new_checked == 1 { "Checked" } else { "Unchecked" },
            statement
        ),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "acceptance_criterion",
        criterion_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "criterion.toggled",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit toggle_criterion transaction")?;

    Ok(AcceptanceCriterion {
        id: criterion_id.to_string(),
        parent_type,
        parent_id,
        statement,
        verification_hint,
        checked: new_checked != 0,
        rank,
        created_at,
        updated_at: now,
        revision,
        revision_of,
        superseded_at,
    })
}

/// Reorder a criterion between two neighbours (or to the tail, when `next_rank` is `None`).
/// Ranks come from `ranking::rank_after`/`ranking::rank_between` — this writes exactly one row,
/// never a renumbering pass over the list. Moving a criterion to the very front of an existing
/// list (`prev_rank = None` while `next_rank` is `Some`) is not supported by this function: this
/// plan does not extend `ranking.rs` with a `rank_before` helper, and nothing in Phase 1's UI
/// calls for that case — call with `prev_rank = Some(...)` (append after) or leave both `None`
/// only when the parent has no other criteria yet.
pub fn reorder_criterion(
    conn: &mut Connection,
    actor_id: &str,
    criterion_id: &str,
    prev_rank: Option<&str>,
    next_rank: Option<&str>,
) -> anyhow::Result<AcceptanceCriterion> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (parent_type, parent_id, statement, verification_hint, checked, created_at, revision, revision_of, superseded_at): (
        String,
        String,
        String,
        Option<String>,
        i64,
        String,
        i64,
        Option<String>,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT parent_type, parent_id, statement, verification_hint, checked, created_at,
                    revision, revision_of, superseded_at
             FROM acceptance_criteria WHERE id = ?1",
            params![criterion_id],
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
                    row.get(8)?,
                ))
            },
        )
        .with_context(|| format!("criterion {criterion_id:?} not found"))?;

    let project_id = resolve_parent_project_id(&tx, &parent_type, &parent_id)?;

    let new_rank = match (prev_rank, next_rank) {
        (Some(p), Some(n)) => rank_between(p, n)?,
        (Some(p), None) => rank_after(Some(p))?,
        (None, None) => rank_after(None)?,
        (None, Some(_)) => anyhow::bail!(
            "reorder_criterion requires a prev_rank — moving to the very front of an existing \
             list is not supported (ranking.rs is not extended by this plan)"
        ),
    };

    // Exactly one row written: this criterion's rank + updated_at. Every sibling row is
    // untouched.
    tx.execute(
        "UPDATE acceptance_criteria SET rank = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_rank, now, criterion_id],
    )
    .context("failed to reorder criterion")?;

    let (task_id, epic_id) = parent_columns(&parent_type, &parent_id);
    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "rank",
        "before": null,
        "after": new_rank,
        "label": format!("Reordered criterion \"{statement}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "acceptance_criterion",
        criterion_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "criterion.reordered",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit reorder_criterion transaction")?;

    Ok(AcceptanceCriterion {
        id: criterion_id.to_string(),
        parent_type,
        parent_id,
        statement,
        verification_hint,
        checked: checked != 0,
        rank: new_rank,
        created_at,
        updated_at: now,
        revision,
        revision_of,
        superseded_at,
    })
}

/// Delete a single criterion. Idempotent: deleting an id that no longer exists returns `Ok` and
/// appends no second event.
pub fn delete_criterion(conn: &mut Connection, actor_id: &str, criterion_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String, String)> = tx
        .query_row(
            "SELECT parent_type, parent_id, statement FROM acceptance_criteria WHERE id = ?1",
            params![criterion_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read criterion before delete")?;

    let Some((parent_type, parent_id, statement)) = existing else {
        tx.commit().context("failed to commit no-op delete_criterion transaction")?;
        return Ok(());
    };

    let project_id = resolve_parent_project_id(&tx, &parent_type, &parent_id)?;

    tx.execute("DELETE FROM acceptance_criteria WHERE id = ?1", params![criterion_id])
        .context("failed to delete criterion")?;

    let (task_id, epic_id) = parent_columns(&parent_type, &parent_id);
    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "statement",
        "before": statement,
        "after": null,
        "label": format!("Deleted criterion \"{statement}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "acceptance_criterion",
        criterion_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "criterion.deleted",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit delete_criterion transaction")?;
    Ok(())
}

/// Delete every criterion belonging to `(parent_type, parent_id)`, appending one
/// `criterion.deleted` event per row so the trail records exactly what was removed (D-19). Takes
/// `&Transaction`, never `&Connection` — this exists to be called from INSIDE
/// `task.rs::delete_task`'s and `epic.rs::delete_epic`'s own single transaction (never opens a
/// second one of its own), the same discipline `event::append_event`/`next_sequence` already
/// follow. A parent with zero criteria is a no-op: no DELETE, no events.
pub fn delete_criteria_for_parent(
    tx: &Transaction,
    project_id: &str,
    actor_id: &str,
    parent_type: &str,
    parent_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    let mut stmt = tx.prepare(
        "SELECT id, statement FROM acceptance_criteria WHERE parent_type = ?1 AND parent_id = ?2",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![parent_type, parent_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read criteria before cascading delete")?;
    drop(stmt);

    if rows.is_empty() {
        return Ok(());
    }

    tx.execute(
        "DELETE FROM acceptance_criteria WHERE parent_type = ?1 AND parent_id = ?2",
        params![parent_type, parent_id],
    )
    .context("failed to cascade-delete criteria")?;

    let (task_id, epic_id) = parent_columns(parent_type, parent_id);
    for (criterion_id, statement) in rows {
        let sequence = next_sequence(tx, project_id, "local")?;
        let payload = serde_json::json!({
            "field": "statement",
            "before": statement,
            "after": null,
            "label": format!("Deleted criterion \"{statement}\" (parent deleted)"),
        });
        append_event(
            tx,
            project_id,
            "local",
            sequence,
            "acceptance_criterion",
            &criterion_id,
            task_id.as_deref(),
            epic_id.as_deref(),
            actor_id,
            "criterion.deleted",
            &payload,
            now,
        )?;
    }
    Ok(())
}

/// List EVERY criterion for `(parent_type, parent_id)` — the full-history read, revision-1 rows,
/// superseded rows and current rows alike — ordered by rank then id, the order a refetch always
/// reproduces, unaffected by toggling any of them. A parent with zero criteria returns an empty
/// vector (D-08: an item with no criteria reports `0/0`, never an error). [`list_current_criteria`]
/// is the filtered sibling: pick deliberately between the two rather than by accident.
pub fn list_criteria(
    conn: &Connection,
    parent_type: &str,
    parent_id: &str,
) -> anyhow::Result<Vec<AcceptanceCriterion>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, statement, verification_hint, checked, rank, created_at,
                updated_at, revision, revision_of, superseded_at
         FROM acceptance_criteria
         WHERE parent_type = ?1 AND parent_id = ?2
         ORDER BY rank ASC, id ASC",
    )?;
    let rows = stmt
        .query_map(params![parent_type, parent_id], row_to_criterion)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query criteria")
}

/// The current-revision-only projection of [`list_criteria`] (D-79's "an agent never reads a
/// superseded statement" contract, extended here to every human-facing list read too) — same
/// `(parent_type, parent_id)` scope, same rank-then-id order, restricted to `superseded_at IS
/// NULL`. [`list_criteria`] itself stays the full-history read, unfiltered and unchanged; this is
/// the filtered sibling.
pub fn list_current_criteria(
    conn: &Connection,
    parent_type: &str,
    parent_id: &str,
) -> anyhow::Result<Vec<AcceptanceCriterion>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, statement, verification_hint, checked, rank, created_at,
                updated_at, revision, revision_of, superseded_at
         FROM acceptance_criteria
         WHERE parent_type = ?1 AND parent_id = ?2 AND superseded_at IS NULL
         ORDER BY rank ASC, id ASC",
    )?;
    let rows = stmt
        .query_map(params![parent_type, parent_id], row_to_criterion)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query current criteria")
}

/// Every row belonging to `criterion_id`'s revision chain (D-79's expand-to-prior-text read) —
/// matching on the CHAIN ROOT whether `criterion_id` itself names the root (a revision-1 row, its
/// own `revision_of` is `NULL`) or one of its successors, ordered `revision DESC` so the newest is
/// first. `criterion_id` naming no row returns an empty vector, matching [`list_criteria`]'s own
/// "unknown parent -> empty, not an error" discipline.
pub fn list_revisions_for_root(
    conn: &Connection,
    criterion_id: &str,
) -> anyhow::Result<Vec<AcceptanceCriterion>> {
    let existing_revision_of: Option<Option<String>> = conn
        .query_row(
            "SELECT revision_of FROM acceptance_criteria WHERE id = ?1",
            params![criterion_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to resolve the criterion's chain root")?;
    let Some(revision_of) = existing_revision_of else {
        return Ok(Vec::new());
    };
    let root_id = revision_of.unwrap_or_else(|| criterion_id.to_string());

    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, statement, verification_hint, checked, rank, created_at,
                updated_at, revision, revision_of, superseded_at
         FROM acceptance_criteria
         WHERE id = ?1 OR revision_of = ?1
         ORDER BY revision DESC",
    )?;
    let rows = stmt
        .query_map(params![root_id], row_to_criterion)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query revisions for chain root")
}
