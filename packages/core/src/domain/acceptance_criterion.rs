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

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

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

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM acceptance_criteria WHERE parent_type = ?1 AND parent_id = ?2 ORDER BY rank DESC LIMIT 1",
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
    })
}

/// Patch a criterion's `statement`/`verification_hint` — `None` leaves the field unchanged
/// (mirrors `task.rs::update_task`'s shape). This is an edit, not a check: it never touches
/// `checked` or `rank`.
pub fn update_criterion(
    conn: &mut Connection,
    actor_id: &str,
    criterion_id: &str,
    statement: Option<&str>,
    verification_hint: Option<&str>,
) -> anyhow::Result<AcceptanceCriterion> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (parent_type, parent_id, current_statement, current_hint, checked, rank, created_at): (
        String,
        String,
        String,
        Option<String>,
        i64,
        String,
        String,
    ) = tx
        .query_row(
            "SELECT parent_type, parent_id, statement, verification_hint, checked, rank, created_at
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
                ))
            },
        )
        .with_context(|| format!("criterion {criterion_id:?} not found"))?;

    let project_id = resolve_parent_project_id(&tx, &parent_type, &parent_id)?;

    let new_statement = statement.unwrap_or(&current_statement);
    let new_hint = verification_hint.or(current_hint.as_deref());

    tx.execute(
        "UPDATE acceptance_criteria SET statement = ?1, verification_hint = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_statement, new_hint, now, criterion_id],
    )
    .context("failed to update criterion")?;

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

    let (parent_type, parent_id, statement, verification_hint, checked, rank, created_at): (
        String,
        String,
        String,
        Option<String>,
        i64,
        String,
        String,
    ) = tx
        .query_row(
            "SELECT parent_type, parent_id, statement, verification_hint, checked, rank, created_at
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

    let (parent_type, parent_id, statement, verification_hint, checked, created_at): (
        String,
        String,
        String,
        Option<String>,
        i64,
        String,
    ) = tx
        .query_row(
            "SELECT parent_type, parent_id, statement, verification_hint, checked, created_at
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

/// List every criterion for `(parent_type, parent_id)`, ordered by rank then id — the order a
/// refetch always reproduces, unaffected by toggling any of them. A parent with zero criteria
/// returns an empty vector (D-08: an item with no criteria reports `0/0`, never an error).
pub fn list_criteria(
    conn: &Connection,
    parent_type: &str,
    parent_id: &str,
) -> anyhow::Result<Vec<AcceptanceCriterion>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, statement, verification_hint, checked, rank, created_at, updated_at
         FROM acceptance_criteria
         WHERE parent_type = ?1 AND parent_id = ?2
         ORDER BY rank ASC, id ASC",
    )?;
    let rows = stmt
        .query_map(params![parent_type, parent_id], |row| {
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
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query criteria")
}
