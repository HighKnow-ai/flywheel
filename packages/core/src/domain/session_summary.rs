//! Session summaries (docs/mvp-spec.md §4.2, §4.5): the short note a Story session leaves for the
//! next one, in two fields — *next session must know* and *decisions*.
//!
//! Two contracts this module lives under. A recorded summary is never rewritten: there is no
//! setter and no delete, only the insert. And identity comes from the session row, never from the
//! caller: [`create_summary`] takes a session id and resolves the Story and the actor from it, so a
//! caller cannot attribute a summary to a session it does not drive.
//!
//! When a session ends without handing off, Flywheel writes a stub in its place
//! ([`synthesize_fallback_summary`]): why it ended and where it was. Every terminal path calls it
//! inside the transaction that writes the terminal status, guarded by [`latest_summary_for_run`],
//! so a session is never terminal without a summary.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::ids::new_id;

/// A `session_summaries` row.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionSummary {
    pub id: String,
    pub session_id: String,
    pub story_id: String,
    pub next_session_must_know: String,
    pub decisions: String,
    pub is_stub: bool,
    pub created_by: String,
    pub created_at: String,
}

fn row_to_summary(row: &Row) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary {
        id: row.get(0)?,
        session_id: row.get(1)?,
        story_id: row.get(2)?,
        next_session_must_know: row.get(3)?,
        decisions: row.get(4)?,
        is_stub: row.get(5)?,
        created_by: row.get(6)?,
        created_at: row.get(7)?,
    })
}

const LIST_SUMMARIES_FOR_STORY_SQL: &str = "SELECT id, session_id, story_id, next_session_must_know, decisions, \
    is_stub, created_by, created_at FROM session_summaries WHERE story_id = ?1 ORDER BY created_at ASC, id ASC";

const LATEST_SUMMARY_FOR_RUN_SQL: &str =
    "SELECT id, session_id, story_id, next_session_must_know, decisions, \
    is_stub, created_by, created_at FROM session_summaries WHERE session_id = ?1 \
    ORDER BY created_at DESC, id DESC LIMIT 1";

/// The single insert site: resolve the Story and actor from the session row, write the summary
/// and its event, inside the caller's transaction.
fn insert_summary_row(
    tx: &Transaction,
    session_id: &str,
    next_session_must_know: &str,
    decisions: &str,
    is_stub: bool,
    now: &str,
) -> anyhow::Result<SessionSummary> {
    let (story_id, project_id, actor_id): (String, String, String) = tx
        .query_row(
            "SELECT story_id, project_id, actor_id FROM sessions WHERE id = ?1",
            params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .with_context(|| format!("session {session_id:?} not found"))?;
    let epic_id: String = tx.query_row(
        "SELECT epic_id FROM stories WHERE id = ?1",
        params![story_id],
        |r| r.get(0),
    )?;
    let id = new_id();
    tx.execute(
        "INSERT INTO session_summaries (id, session_id, story_id, next_session_must_know, decisions, is_stub, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, session_id, story_id, next_session_must_know, decisions, is_stub, actor_id, now],
    )
    .context("failed to insert the session summary")?;
    crate::domain::record_event(
        tx,
        &project_id,
        "session_summary",
        &id,
        crate::domain::EventScope {
            story_id: Some(&story_id),
            epic_id: Some(&epic_id),
        },
        &actor_id,
        "session_summary.recorded",
        &serde_json::json!({
            "session_id": session_id,
            "is_stub": is_stub,
            "label": if is_stub { "Flywheel wrote a stub summary for a session that ended without handing off" } else { "Recorded a session summary" },
        }),
        now,
    )?;
    Ok(SessionSummary {
        id,
        session_id: session_id.to_string(),
        story_id,
        next_session_must_know: next_session_must_know.to_string(),
        decisions: decisions.to_string(),
        is_stub,
        created_by: actor_id,
        created_at: now.to_string(),
    })
}

/// Record the summary a session hands off with.
pub fn create_summary(
    conn: &mut Connection,
    session_id: &str,
    next_session_must_know: &str,
    decisions: &str,
) -> anyhow::Result<SessionSummary> {
    let now = crate::domain::now();
    let tx = conn.transaction()?;
    let summary = insert_summary_row(
        &tx,
        session_id,
        next_session_must_know,
        decisions,
        false,
        &now,
    )?;
    tx.commit().context("failed to commit create_summary")?;
    Ok(summary)
}

/// [`create_summary`] inside the caller's transaction: the hand-off records the summary in the one
/// transaction that records the Check results and moves the Story.
pub(crate) fn create_summary_in_tx(
    tx: &Transaction,
    session_id: &str,
    next_session_must_know: &str,
    decisions: &str,
) -> anyhow::Result<SessionSummary> {
    insert_summary_row(
        tx,
        session_id,
        next_session_must_know,
        decisions,
        false,
        &crate::domain::now(),
    )
}

/// How much of the last assistant message a stub keeps, in characters.
pub const STUB_LAST_MESSAGE_MAX_CHARS: usize = 600;

/// Write the stub summary for a session that ended without one (docs/mvp-spec.md §4.5): the reason
/// it ended, the Task it was doing, if any, with its note, and its last assistant message, truncated. Runs inside
/// the caller's transaction (the one writing the terminal status) and has no dedupe of its own: the
/// caller's [`latest_summary_for_run`] check is the guard. `close_reason` is the ending label's
/// words ([`crate::domain::session_ending::EndingReason::words`]).
pub fn synthesize_fallback_summary(
    tx: &Transaction,
    session_id: &str,
    close_reason: &str,
) -> anyhow::Result<String> {
    let now = crate::domain::now();
    let doing: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT t.title, t.note FROM tasks t JOIN sessions r ON r.story_id = t.story_id
             WHERE r.id = ?1 AND t.state = 'doing'",
            params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let mut note = format!("The previous session ended ({close_reason}) without handing off.");
    match &doing {
        Some((title, _)) => note.push_str(&format!(
            " It was doing \"{title}\"; re-verify that Task before going on."
        )),
        None => note.push_str(" No Task was marked doing."),
    }
    // Issue #96: what the session had written down on the doing Task, so the next one starts from
    // it rather than redoing the work.
    if let Some(task_note) = doing
        .as_ref()
        .and_then(|(_, n)| n.as_deref())
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        note.push_str(&format!(
            "\n\nIts note on that Task:\n> {}\n\n",
            task_note.replace('\n', "\n> ")
        ));
    } else {
        note.push(' ');
    }
    note.push_str(
        "The worktree is left exactly as it was: it is the authority on what is finished.",
    );
    if let Some(last) = crate::session_log::last_assistant_message(session_id) {
        let text = last.text.trim();
        if !text.is_empty() {
            let mut kept: String = text.chars().take(STUB_LAST_MESSAGE_MAX_CHARS).collect();
            if text.chars().count() > STUB_LAST_MESSAGE_MAX_CHARS {
                kept.push_str(" [...]");
            }
            note.push_str(&format!(
                "\n\nIts last message:\n> {}",
                kept.replace('\n', "\n> ")
            ));
        }
    }
    let summary = insert_summary_row(tx, session_id, &note, "", true, &now)?;
    Ok(summary.id)
}

/// Every summary of a Story, oldest first (the ULID breaks a same-millisecond tie, so two reads of
/// an unchanged board agree).
pub fn list_summaries_for_story(
    conn: &Connection,
    story_id: &str,
) -> anyhow::Result<Vec<SessionSummary>> {
    let mut stmt = conn.prepare(LIST_SUMMARIES_FOR_STORY_SQL)?;
    let rows = stmt
        .query_map(params![story_id], row_to_summary)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Story's session summaries")
}

/// The latest summary of one session, if it has one.
pub fn latest_summary_for_run(
    conn: &Connection,
    session_id: &str,
) -> anyhow::Result<Option<SessionSummary>> {
    conn.query_row(
        LATEST_SUMMARY_FOR_RUN_SQL,
        params![session_id],
        row_to_summary,
    )
    .optional()
    .context("failed to read the session's latest summary")
}
