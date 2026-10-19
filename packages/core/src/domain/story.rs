//! Stories (docs/mvp-spec.md §2): a thin vertical slice inside exactly one Epic, and the unit of
//! work an agent executes in its own worktree. A Story can never exist outside its Epic.
//!
//! [`set_story_state`] is the one writer of `stories.state`, and it enforces the spec's transition
//! table. Every transition is the developer's act except the hand-off (Running → In review), which
//! the Story's session makes and Flywheel records:
//!
//! | Transition | Who |
//! |---|---|
//! | Shaping → Ready | the developer closes the Epic's criteria Stage |
//! | Ready → Running | the developer starts the Story |
//! | Running → In review | the session hands off |
//! | In review → Running | the developer requests changes |
//! | In review → Merged | the developer merges |
//! | any but Merged → Dropped | the developer drops it |
//!
//! What a session is doing (Waiting on you, Stopped) is attention, derived from the session and
//! never stored here.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::{allocate_key, now, record_event, EventScope};
use crate::ids::new_id;
use crate::ranking::rank_after;

/// Where a Story is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoryState {
    Shaping,
    Ready,
    Running,
    InReview,
    Merged,
    Dropped,
}

impl StoryState {
    pub const ALL: [StoryState; 6] = [
        StoryState::Shaping,
        StoryState::Ready,
        StoryState::Running,
        StoryState::InReview,
        StoryState::Merged,
        StoryState::Dropped,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            StoryState::Shaping => "shaping",
            StoryState::Ready => "ready",
            StoryState::Running => "running",
            StoryState::InReview => "in_review",
            StoryState::Merged => "merged",
            StoryState::Dropped => "dropped",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        StoryState::ALL
            .into_iter()
            .find(|s| s.as_str() == value)
            .ok_or_else(|| anyhow::anyhow!("{value:?} is not a Story state"))
    }

    /// Merged and Dropped end a Story; both count as closed for its Epic.
    pub fn is_closed(self) -> bool {
        matches!(self, StoryState::Merged | StoryState::Dropped)
    }
}

/// Whether `from → to` is in the spec's transition table.
pub fn is_allowed_transition(from: StoryState, to: StoryState) -> bool {
    use StoryState::*;
    matches!(
        (from, to),
        (Shaping, Ready) | (Ready, Running) | (Running, InReview) | (InReview, Running) | (InReview, Merged)
    ) || (to == Dropped && !from.is_closed())
}

/// Whether `from → to` is the developer's act (so the writer refuses any other actor). Only the
/// hand-off is not.
pub fn is_human_transition(from: StoryState, to: StoryState) -> bool {
    !(from == StoryState::Running && to == StoryState::InReview)
}

/// A `stories` row.
#[derive(Debug, Clone, PartialEq)]
pub struct Story {
    pub id: String,
    pub project_id: String,
    pub epic_id: String,
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub runs_after_story_id: Option<String>,
    pub rank: String,
}

/// `SELECT <every column> FROM stories <tail>`, as one compile-time literal.
macro_rules! select_stories {
    ($tail:literal) => {
        concat!(
            "SELECT id, project_id, epic_id, key, title, description, state, runs_after_story_id, rank FROM stories ",
            $tail
        )
    };
}

fn row_to_story(row: &Row) -> rusqlite::Result<Story> {
    Ok(Story {
        id: row.get(0)?,
        project_id: row.get(1)?,
        epic_id: row.get(2)?,
        key: row.get(3)?,
        title: row.get(4)?,
        description: row.get(5)?,
        state: row.get(6)?,
        runs_after_story_id: row.get(7)?,
        rank: row.get(8)?,
    })
}

/// Create a Story at the end of `epic_id`'s execution order, in Shaping. Its project is the
/// Epic's. Refused when the Epic is Done.
pub fn create_story(conn: &mut Connection, actor_id: &str, epic_id: &str, title: &str) -> anyhow::Result<Story> {
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "a Story needs a title");
    let now = now();
    let id = new_id();
    let tx = conn.transaction()?;

    let (project_id, epic_state): (String, String) = tx
        .query_row("SELECT project_id, state FROM epics WHERE id = ?1", params![epic_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .with_context(|| format!("Epic {epic_id:?} not found; a Story always sits inside an Epic"))?;
    anyhow::ensure!(epic_state != "done", "Epic {epic_id:?} is done; a new Story goes into an open Epic");

    let last_rank: Option<String> = tx
        .query_row("SELECT rank FROM stories WHERE epic_id = ?1 ORDER BY rank DESC LIMIT 1", params![epic_id], |r| {
            r.get(0)
        })
        .optional()?;
    let rank = rank_after(last_rank.as_deref())?;
    let key = allocate_key(&tx, &project_id)?;

    tx.execute(
        "INSERT INTO stories (id, project_id, epic_id, key, title, state, rank, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'shaping', ?6, ?7, ?8, ?8)",
        params![id, project_id, epic_id, key, title, rank, actor_id, now],
    )
    .context("failed to insert the Story")?;
    record_event(
        &tx,
        &project_id,
        "story",
        &id,
        EventScope { story_id: Some(&id), epic_id: Some(epic_id) },
        actor_id,
        "story.created",
        &serde_json::json!({ "title": title, "label": format!("Created Story {key} \"{title}\"") }),
        &now,
    )?;
    tx.commit().context("failed to commit create_story")?;

    Ok(Story {
        id,
        project_id,
        epic_id: epic_id.to_string(),
        key,
        title: title.to_string(),
        description: None,
        state: "shaping".to_string(),
        runs_after_story_id: None,
        rank,
    })
}

/// One Story by id.
pub fn get_story(conn: &Connection, story_id: &str) -> anyhow::Result<Option<Story>> {
    conn.query_row(select_stories!("WHERE id = ?1"), params![story_id], row_to_story)
        .optional()
        .context("failed to read the Story")
}

/// Every Story of an Epic, in execution order.
pub fn stories_in_epic(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<Story>> {
    let mut stmt = conn.prepare(select_stories!("WHERE epic_id = ?1 ORDER BY rank, id"))?;
    let rows = stmt.query_map(params![epic_id], row_to_story)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Epic's Stories")
}

/// Rewrite a Story's title and description.
pub fn update_story(
    conn: &mut Connection,
    actor_id: &str,
    story_id: &str,
    title: &str,
    description: Option<&str>,
) -> anyhow::Result<()> {
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "a Story needs a title");
    let now = now();
    let tx = conn.transaction()?;
    let (project_id, epic_id): (String, String) = tx
        .query_row("SELECT project_id, epic_id FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .with_context(|| format!("Story {story_id:?} not found"))?;
    tx.execute(
        "UPDATE stories SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
        params![title, description, now, story_id],
    )?;
    record_event(
        &tx,
        &project_id,
        "story",
        story_id,
        EventScope { story_id: Some(story_id), epic_id: Some(&epic_id) },
        actor_id,
        "story.updated",
        &serde_json::json!({ "title": title, "label": "Edited the Story" }),
        &now,
    )?;
    tx.commit()?;
    Ok(())
}

/// Move a Story to `to`, if the spec's transition table allows it from where it is, and the actor
/// may make that move: a human for every transition but the hand-off. The one writer of
/// `stories.state`.
pub fn set_story_state(conn: &mut Connection, actor_id: &str, story_id: &str, to: StoryState) -> anyhow::Result<()> {
    let now = now();
    let tx = conn.transaction()?;
    let (project_id, epic_id, current): (String, String, String) = tx
        .query_row("SELECT project_id, epic_id, state FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .with_context(|| format!("Story {story_id:?} not found"))?;
    let from = StoryState::parse(&current)?;
    anyhow::ensure!(
        is_allowed_transition(from, to),
        "a Story cannot move from {} to {}",
        from.as_str(),
        to.as_str()
    );
    if is_human_transition(from, to) {
        assert_human_actor_in_tx(&tx, actor_id)?;
    }

    tx.execute("UPDATE stories SET state = ?1, updated_at = ?2 WHERE id = ?3", params![to.as_str(), now, story_id])
        .context("failed to write the Story state")?;
    record_event(
        &tx,
        &project_id,
        "story",
        story_id,
        EventScope { story_id: Some(story_id), epic_id: Some(&epic_id) },
        actor_id,
        "story.state_changed",
        &serde_json::json!({
            "field": "state", "before": from.as_str(), "after": to.as_str(),
            "label": format!("Moved Story from {} to {}", from.as_str(), to.as_str()),
        }),
        &now,
    )?;
    tx.commit().context("failed to commit set_story_state")?;
    Ok(())
}
