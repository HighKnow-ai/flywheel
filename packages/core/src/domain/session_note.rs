//! A note to the agent (docs/mvp-spec.md §4.7, ADR 0044).
//!
//! The developer types a free-text note on a Story whose session is live. [`record_note`] records it
//! as `sent`. The sidecar hands it to the agent at the agent's next turn boundary, never during a
//! tool call, and then reports that it did; [`mark_delivered`] records that report.
//!
//! A note whose session ends first is never delivered. That state is not written. [`notes_for_story`]
//! derives it: a note still `sent` while its session is not live reads `undelivered`. A crash or an
//! abandoned session therefore needs no extra write, and the next session does not receive the note:
//! the developer sees it as not delivered and writes it again if it still matters.
//!
//! [`record_note`] is human-only. An agent never sends a note to an agent.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::actor::{assert_human_actor, system_actor};
use crate::domain::{now, record_event, EventScope};

/// The longest note, in characters.
pub const MAX_NOTE_LEN: usize = 1000;

/// One note, with the state the board shows: `sent`, `delivered` or `undelivered`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionNote {
    pub id: String,
    pub story_id: String,
    pub session_id: String,
    pub body: String,
    pub status: String,
    pub created_at: String,
    pub delivered_at: Option<String>,
}

/// Trim `body` and refuse a blank note or one longer than [`MAX_NOTE_LEN`] characters.
pub fn validate_note(body: &str) -> anyhow::Result<String> {
    let body = body.trim();
    anyhow::ensure!(
        !body.is_empty(),
        "A note needs words: say what the agent should know."
    );
    let chars = body.chars().count();
    anyhow::ensure!(
        chars <= MAX_NOTE_LEN,
        "A note is at most {MAX_NOTE_LEN} characters, and this one has {chars}."
    );
    Ok(body.to_string())
}

/// Record a note from the developer to the live session of `story_id`. Returns the note, `sent`.
///
/// Refused, writing nothing, for an agent, a blank or long note, and a Story with no live session
/// (`running` or `blocked`): a note has nobody to reach.
pub fn record_note(
    conn: &mut Connection,
    actor_id: &str,
    story_id: &str,
    body: &str,
) -> anyhow::Result<SessionNote> {
    assert_human_actor(conn, actor_id)?;
    let body = validate_note(body)?;
    let (session_id, project_id, epic_id, key): (String, String, String, String) = conn
        .query_row(
            "SELECT se.id, st.project_id, st.epic_id, st.key
             FROM sessions se JOIN stories st ON st.id = se.story_id
             WHERE se.story_id = ?1 AND se.status IN ('running', 'blocked')",
            params![story_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .with_context(|| {
            format!("The Story {story_id:?} has no live session to send a note to.")
        })?;

    let id = crate::ids::new_id();
    let now = now();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO session_notes (id, project_id, story_id, session_id, body, status, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'sent', ?6, ?7)",
        params![id, project_id, story_id, session_id, body, actor_id, now],
    )
    .context("failed to record the note")?;
    record_event(
        &tx,
        &project_id,
        "session",
        &session_id,
        EventScope {
            story_id: Some(story_id),
            epic_id: Some(&epic_id),
        },
        actor_id,
        "session.note_sent",
        &serde_json::json!({ "note_id": id, "label": format!("Sent a note to the agent on {key}") }),
        &now,
    )?;
    tx.commit().context("failed to commit record_note")?;
    Ok(SessionNote {
        id,
        story_id: story_id.to_string(),
        session_id,
        body,
        status: "sent".to_string(),
        created_at: now,
        delivered_at: None,
    })
}

/// Record that the agent now has note `note_id`. Idempotent: returns `true` only for the call that
/// moved the note from `sent` to `delivered`. A note that does not exist returns `false`.
pub fn mark_delivered(conn: &mut Connection, note_id: &str) -> anyhow::Result<bool> {
    let system = system_actor(conn)?.id;
    let now = now();
    let tx = conn.transaction()?;
    let changed = tx.execute(
        "UPDATE session_notes SET status = 'delivered', delivered_at = ?2 WHERE id = ?1 AND status = 'sent'",
        params![note_id, now],
    )?;
    if changed == 1 {
        let (project_id, story_id, session_id, epic_id): (String, String, String, String) = tx
            .query_row(
                "SELECT n.project_id, n.story_id, n.session_id, st.epic_id
                 FROM session_notes n JOIN stories st ON st.id = n.story_id WHERE n.id = ?1",
                params![note_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
        record_event(
            &tx,
            &project_id,
            "session",
            &session_id,
            EventScope {
                story_id: Some(&story_id),
                epic_id: Some(&epic_id),
            },
            &system,
            "session.note_delivered",
            &serde_json::json!({ "note_id": note_id, "label": "The agent has the note" }),
            &now,
        )?;
    }
    tx.commit().context("failed to commit mark_delivered")?;
    Ok(changed == 1)
}

/// The notes of `story_id`, oldest first, each with its derived state (see the module documentation).
pub fn notes_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Vec<SessionNote>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.story_id, n.session_id, n.body,
                CASE WHEN n.status = 'delivered' THEN 'delivered'
                     WHEN se.status IN ('running', 'blocked') THEN 'sent'
                     ELSE 'undelivered' END,
                n.created_at, n.delivered_at
         FROM session_notes n JOIN sessions se ON se.id = n.session_id
         WHERE n.story_id = ?1 ORDER BY n.created_at, n.id",
    )?;
    let rows = stmt
        .query_map(params![story_id], |r| {
            Ok(SessionNote {
                id: r.get(0)?,
                story_id: r.get(1)?,
                session_id: r.get(2)?,
                body: r.get(3)?,
                status: r.get(4)?,
                created_at: r.get(5)?,
                delivered_at: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the notes of the Story")
}
