//! Acceptance criteria (docs/mvp-spec.md §2, §8): testable statements a Story must satisfy, judged
//! against the Story's diff at review.
//!
//! Two invariants this module exists to hold, both pinned by tests:
//!
//! - **Anchored to exactly one Story.** A criterion is created under a Story that must exist
//!   (`story_id` is `NOT NULL REFERENCES stories`), and nothing in this crate can move it: no writer
//!   here takes a new `story_id`, and `tests/criterion_anchored_to_one_story.rs` fails the build if
//!   any statement in the workspace updates the column.
//! - **Acceptance is human-only.** [`accept_criterion`] and [`unaccept_criterion`] read the actor's
//!   type inside their own write transaction and refuse anything but a human. A passing Check only
//!   pre-ticks its criterion in the review surface; it never writes `accepted_by`.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;
use crate::ranking::rank_after;

/// An `acceptance_criteria` row.
#[derive(Debug, Clone, PartialEq)]
pub struct AcceptanceCriterion {
    pub id: String,
    pub story_id: String,
    pub statement: String,
    pub accepted_by: Option<String>,
    pub accepted_at: Option<String>,
    pub rank: String,
}

fn row_to_criterion(row: &Row) -> rusqlite::Result<AcceptanceCriterion> {
    Ok(AcceptanceCriterion {
        id: row.get(0)?,
        story_id: row.get(1)?,
        statement: row.get(2)?,
        accepted_by: row.get(3)?,
        accepted_at: row.get(4)?,
        rank: row.get(5)?,
    })
}

/// The Story and its scope for a criterion's events, read inside the caller's transaction.
fn criterion_scope(tx: &Transaction, criterion_id: &str) -> anyhow::Result<(String, String, String)> {
    tx.query_row(
        "SELECT c.story_id, s.epic_id, s.project_id FROM acceptance_criteria c
         JOIN stories s ON s.id = c.story_id WHERE c.id = ?1",
        params![criterion_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .with_context(|| format!("criterion {criterion_id:?} not found"))
}

/// Add a criterion at the end of `story_id`'s list. The Story must exist: a criterion is never
/// orphaned.
pub fn create_criterion(
    conn: &mut Connection,
    actor_id: &str,
    story_id: &str,
    statement: &str,
) -> anyhow::Result<AcceptanceCriterion> {
    let tx = conn.transaction()?;
    let criterion = create_criterion_in_tx(&tx, actor_id, story_id, statement)?;
    tx.commit().context("failed to commit create_criterion")?;
    Ok(criterion)
}

/// [`create_criterion`] inside the caller's transaction.
pub(crate) fn create_criterion_in_tx(
    tx: &Transaction,
    actor_id: &str,
    story_id: &str,
    statement: &str,
) -> anyhow::Result<AcceptanceCriterion> {
    let statement = statement.trim();
    anyhow::ensure!(!statement.is_empty(), "a criterion needs a statement");
    let now = now();
    let id = new_id();
    let (project_id, epic_id): (String, String) = tx
        .query_row("SELECT project_id, epic_id FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .with_context(|| format!("Story {story_id:?} not found; a criterion is anchored to one Story"))?;
    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM acceptance_criteria WHERE story_id = ?1 ORDER BY rank DESC LIMIT 1",
            params![story_id],
            |r| r.get(0),
        )
        .optional()?;
    let rank = rank_after(last_rank.as_deref())?;
    tx.execute(
        "INSERT INTO acceptance_criteria (id, story_id, statement, rank, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, story_id, statement, rank, actor_id, now],
    )
    .context("failed to insert the criterion")?;
    record_event(
        tx,
        &project_id,
        "criterion",
        &id,
        EventScope { story_id: Some(story_id), epic_id: Some(&epic_id) },
        actor_id,
        "criterion.created",
        &serde_json::json!({ "statement": statement, "label": format!("Added criterion \"{statement}\"") }),
        &now,
    )?;
    Ok(AcceptanceCriterion {
        id,
        story_id: story_id.to_string(),
        statement: statement.to_string(),
        accepted_by: None,
        accepted_at: None,
        rank,
    })
}

/// One criterion by id.
pub fn get_criterion(conn: &Connection, criterion_id: &str) -> anyhow::Result<Option<AcceptanceCriterion>> {
    conn.query_row(
        "SELECT id, story_id, statement, accepted_by, accepted_at, rank FROM acceptance_criteria WHERE id = ?1",
        params![criterion_id],
        row_to_criterion,
    )
    .optional()
    .context("failed to read the criterion")
}

/// A Story's criteria, in order.
pub fn criteria_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Vec<AcceptanceCriterion>> {
    let mut stmt = conn.prepare(
        "SELECT id, story_id, statement, accepted_by, accepted_at, rank FROM acceptance_criteria
         WHERE story_id = ?1 ORDER BY rank, id",
    )?;
    let rows = stmt.query_map(params![story_id], row_to_criterion)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Story's criteria")
}

/// Rewrite a criterion's statement. A changed statement is a new thing to judge, so an acceptance
/// already recorded is cleared with it. The Story it belongs to never changes.
pub fn amend_criterion(conn: &mut Connection, actor_id: &str, criterion_id: &str, statement: &str) -> anyhow::Result<()> {
    let statement = statement.trim();
    anyhow::ensure!(!statement.is_empty(), "a criterion needs a statement");
    let now = now();
    let tx = conn.transaction()?;
    let (story_id, epic_id, project_id) = criterion_scope(&tx, criterion_id)?;
    tx.execute(
        "UPDATE acceptance_criteria SET statement = ?1, accepted_by = NULL, accepted_at = NULL, updated_at = ?2
         WHERE id = ?3",
        params![statement, now, criterion_id],
    )?;
    record_event(
        &tx,
        &project_id,
        "criterion",
        criterion_id,
        EventScope { story_id: Some(&story_id), epic_id: Some(&epic_id) },
        actor_id,
        "criterion.amended",
        &serde_json::json!({ "statement": statement, "label": "Amended a criterion" }),
        &now,
    )?;
    tx.commit()?;
    Ok(())
}

/// Accept a criterion at review. Human-only: the actor's type is read inside this transaction and
/// anything but a human is refused before any row changes.
pub fn accept_criterion(conn: &mut Connection, actor_id: &str, criterion_id: &str) -> anyhow::Result<()> {
    write_acceptance(conn, actor_id, criterion_id, true)
}

/// Withdraw an acceptance. Human-only, like [`accept_criterion`].
pub fn unaccept_criterion(conn: &mut Connection, actor_id: &str, criterion_id: &str) -> anyhow::Result<()> {
    write_acceptance(conn, actor_id, criterion_id, false)
}

fn write_acceptance(conn: &mut Connection, actor_id: &str, criterion_id: &str, accept: bool) -> anyhow::Result<()> {
    let now = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let (story_id, epic_id, project_id) = criterion_scope(&tx, criterion_id)?;
    if accept {
        tx.execute(
            "UPDATE acceptance_criteria SET accepted_by = ?1, accepted_at = ?2, updated_at = ?2 WHERE id = ?3",
            params![actor_id, now, criterion_id],
        )?;
    } else {
        tx.execute(
            "UPDATE acceptance_criteria SET accepted_by = NULL, accepted_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, criterion_id],
        )?;
    }
    let (event_type, label) =
        if accept { ("criterion.accepted", "Accepted a criterion") } else { ("criterion.unaccepted", "Withdrew a criterion's acceptance") };
    record_event(
        &tx,
        &project_id,
        "criterion",
        criterion_id,
        EventScope { story_id: Some(&story_id), epic_id: Some(&epic_id) },
        actor_id,
        event_type,
        &serde_json::json!({ "field": "accepted", "before": !accept, "after": accept, "label": label }),
        &now,
    )?;
    tx.commit()?;
    Ok(())
}

/// Delete a criterion (and its Check, by cascade).
pub fn delete_criterion(conn: &mut Connection, actor_id: &str, criterion_id: &str) -> anyhow::Result<()> {
    let now = now();
    let tx = conn.transaction()?;
    let (story_id, epic_id, project_id) = criterion_scope(&tx, criterion_id)?;
    tx.execute("DELETE FROM acceptance_criteria WHERE id = ?1", params![criterion_id])?;
    record_event(
        &tx,
        &project_id,
        "criterion",
        criterion_id,
        EventScope { story_id: Some(&story_id), epic_id: Some(&epic_id) },
        actor_id,
        "criterion.deleted",
        &serde_json::json!({ "label": "Deleted a criterion" }),
        &now,
    )?;
    tx.commit()?;
    Ok(())
}
