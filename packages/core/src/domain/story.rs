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
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::domain::acceptance_criterion::create_criterion_in_tx;
use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::check::set_check_in_tx;
use crate::domain::{allocate_key, now, record_event, EventScope};
use crate::ids::new_id;
use crate::ranking::{check_rank, rank_after};

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
    /// The constraint behind the runs-after marker, in one line ("shares `FeedRow.tsx`"), issue #127.
    /// Informational, like the marker: it never blocks a start.
    pub runs_after_reason: Option<String>,
    pub rank: String,
}

/// `SELECT <every column> FROM stories <tail>`, as one compile-time literal.
macro_rules! select_stories {
    ($tail:literal) => {
        concat!(
            "SELECT id, project_id, epic_id, key, title, description, state, runs_after_story_id, rank, runs_after_reason FROM stories ",
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
        runs_after_reason: row.get(9)?,
    })
}

/// Create a Story at the end of `epic_id`'s execution order, in Shaping. Its project is the
/// Epic's. Refused when the Epic is Done.
pub fn create_story(conn: &mut Connection, actor_id: &str, epic_id: &str, title: &str) -> anyhow::Result<Story> {
    let tx = conn.transaction()?;
    let story = create_story_in_tx(&tx, actor_id, epic_id, title, None, None)?;
    tx.commit().context("failed to commit create_story")?;
    Ok(story)
}

/// [`create_story`] inside the caller's transaction, with an optional description, at `rank` in the
/// Epic's execution order or, without one, at its end. An accepted New Story Proposal creates its
/// Story here, at the rank it proposed (issue #127).
pub(crate) fn create_story_in_tx(
    tx: &Transaction,
    actor_id: &str,
    epic_id: &str,
    title: &str,
    description: Option<&str>,
    rank: Option<&str>,
) -> anyhow::Result<Story> {
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "a Story needs a title");
    let description = description.map(str::trim).filter(|d| !d.is_empty());
    let now = now();
    let id = new_id();

    let (project_id, epic_state): (String, String) = tx
        .query_row("SELECT project_id, state FROM epics WHERE id = ?1", params![epic_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .with_context(|| format!("Epic {epic_id:?} not found; a Story always sits inside an Epic"))?;
    anyhow::ensure!(epic_state != "done", "Epic {epic_id:?} is done; a new Story goes into an open Epic");

    let rank = match rank {
        Some(rank) => {
            check_rank(rank)?;
            rank.to_string()
        }
        None => {
            let last_rank: Option<String> = tx
                .query_row("SELECT rank FROM stories WHERE epic_id = ?1 ORDER BY rank DESC LIMIT 1", params![epic_id], |r| {
                    r.get(0)
                })
                .optional()?;
            rank_after(last_rank.as_deref())?
        }
    };
    let key = allocate_key(tx, &project_id)?;

    tx.execute(
        "INSERT INTO stories (id, project_id, epic_id, key, title, description, state, rank, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'shaping', ?7, ?8, ?9, ?9)",
        params![id, project_id, epic_id, key, title, description, rank, actor_id, now],
    )
    .context("failed to insert the Story")?;
    record_event(
        tx,
        &project_id,
        "story",
        &id,
        EventScope { story_id: Some(&id), epic_id: Some(epic_id) },
        actor_id,
        "story.created",
        &serde_json::json!({ "title": title, "label": format!("Created Story {key} \"{title}\"") }),
        &now,
    )?;

    Ok(Story {
        id,
        project_id,
        epic_id: epic_id.to_string(),
        key,
        title: title.to_string(),
        description: description.map(str::to_string),
        state: "shaping".to_string(),
        runs_after_story_id: None,
        runs_after_reason: None,
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
    let tx = conn.transaction()?;
    set_story_state_in_tx(&tx, actor_id, story_id, to)?;
    tx.commit().context("failed to commit set_story_state")?;
    Ok(())
}

/// [`set_story_state`] inside the caller's transaction.
pub(crate) fn set_story_state_in_tx(tx: &Transaction, actor_id: &str, story_id: &str, to: StoryState) -> anyhow::Result<()> {
    let now = now();
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
        assert_human_actor_in_tx(tx, actor_id)?;
    }

    tx.execute("UPDATE stories SET state = ?1, updated_at = ?2 WHERE id = ?3", params![to.as_str(), now, story_id])
        .context("failed to write the Story state")?;
    if (from, to) == (StoryState::InReview, StoryState::Running) {
        // In review -> Running is the developer's request for changes: it closes the open review, so
        // the next hand-off opens a fresh one.
        crate::domain::review::close_review_in_tx(tx, story_id, actor_id, "changes_requested", None)?;
    }
    record_event(
        tx,
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
    Ok(())
}

/// Move Story `story_id` into Epic `epic_id` of the same project (issue #168, docs/mvp-spec.md §7): the
/// developer's re-parenting. The Story lands at the end of the target Epic's order and keeps its key,
/// state, criteria, Tasks, worktree and branch. A runs-after marker names a Story of the same Epic, so
/// every marker the move would carry across Epics (the Story's own, and any pointing at it) is cleared.
///
/// Human-only. Refused for a Merged or Dropped Story (it stays where it closed), for a Done or Dropped
/// Epic (it takes no new Story), for an Epic of another project, and for the Story's own Epic.
pub fn move_story_to_epic(conn: &mut Connection, actor_id: &str, story_id: &str, epic_id: &str) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let now = now();
    let (project_id, from_epic, key, state): (String, String, String, String) = tx
        .query_row("SELECT project_id, epic_id, key, state FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .with_context(|| format!("Story {story_id:?} not found"))?;
    anyhow::ensure!(!StoryState::parse(&state)?.is_closed(), "{key} is {state}; a closed Story stays in the Epic it closed in");
    let (epic_project, epic_key, epic_title, epic_state): (String, String, String, String) = tx
        .query_row("SELECT project_id, key, title, state FROM epics WHERE id = ?1", params![epic_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .with_context(|| format!("Epic {epic_id:?} not found"))?;
    anyhow::ensure!(epic_project == project_id, "{epic_key} is in another project; a Story moves only within its project");
    anyhow::ensure!(epic_id != from_epic, "{key} is already in {epic_key}");
    anyhow::ensure!(
        epic_state != "done" && epic_state != "dropped",
        "{epic_key} is {epic_state}; a Story moves only into an open Epic"
    );

    let last_rank: Option<String> = tx
        .query_row("SELECT rank FROM stories WHERE epic_id = ?1 ORDER BY rank DESC LIMIT 1", params![epic_id], |r| r.get(0))
        .optional()?;
    let rank = rank_after(last_rank.as_deref())?;
    tx.execute(
        "UPDATE stories SET epic_id = ?1, rank = ?2, runs_after_story_id = NULL, runs_after_reason = NULL, updated_at = ?3
         WHERE id = ?4",
        params![epic_id, rank, now, story_id],
    )
    .context("failed to move the Story")?;
    tx.execute(
        "UPDATE stories SET runs_after_story_id = NULL, runs_after_reason = NULL, updated_at = ?1 WHERE runs_after_story_id = ?2",
        params![now, story_id],
    )
    .context("failed to clear the runs-after markers on the moved Story")?;
    record_event(
        &tx,
        &project_id,
        "story",
        story_id,
        EventScope { story_id: Some(story_id), epic_id: Some(epic_id) },
        actor_id,
        "story.moved",
        &serde_json::json!({
            "field": "epic_id", "before": from_epic, "after": epic_id,
            "label": format!("Moved {key} to {epic_key} \"{epic_title}\""),
        }),
        &now,
    )?;
    tx.commit().context("failed to commit move_story_to_epic")?;
    Ok(())
}

/// Set or clear Story `story_id`'s runs-after marker and the one-line constraint behind it (issue
/// #127), inside the caller's transaction. The Story it runs after must be another Story of the same
/// Epic; the marker is informational and never blocks a start. `proposal_id` names the accepted
/// Proposal that set it, for the event.
pub(crate) fn set_runs_after_in_tx(
    tx: &Transaction,
    actor_id: &str,
    story_id: &str,
    runs_after: Option<(&str, &str)>,
    proposal_id: Option<&str>,
) -> anyhow::Result<()> {
    let now = now();
    let (project_id, epic_id, key): (String, String, String) = tx
        .query_row("SELECT project_id, epic_id, key FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .with_context(|| format!("Story {story_id:?} not found"))?;
    let (after_id, reason, after_key) = match runs_after {
        None => (None, None, None),
        Some((after_id, reason)) => {
            anyhow::ensure!(after_id != story_id, "a Story cannot run after itself");
            let (after_epic, after_key): (String, String) = tx
                .query_row("SELECT epic_id, key FROM stories WHERE id = ?1", params![after_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .with_context(|| format!("Story {after_id:?} not found"))?;
            anyhow::ensure!(after_epic == epic_id, "{key} can only run after a Story of its own Epic; {after_key} is in another");
            let reason = reason.trim();
            anyhow::ensure!(!reason.is_empty(), "a runs-after marker needs its one-line reason");
            (Some(after_id), Some(reason), Some(after_key))
        }
    };
    tx.execute(
        "UPDATE stories SET runs_after_story_id = ?1, runs_after_reason = ?2, updated_at = ?3 WHERE id = ?4",
        params![after_id, reason, now, story_id],
    )
    .context("failed to write the runs-after marker")?;
    let label = match &after_key {
        Some(after_key) => format!("Marked {key} to run after {after_key}"),
        None => format!("Cleared {key}'s runs-after marker"),
    };
    record_event(
        tx,
        &project_id,
        "story",
        story_id,
        EventScope { story_id: Some(story_id), epic_id: Some(&epic_id) },
        actor_id,
        "story.runs_after_set",
        &serde_json::json!({
            "field": "runs_after_story_id", "after": after_id, "reason": reason,
            "proposal_id": proposal_id, "label": label,
        }),
        &now,
    )?;
    Ok(())
}

/// Move Story `story_id` to `rank` in its Epic's execution order (issue #127: an accepted reorder
/// Proposal), inside the caller's transaction. A closed Story keeps its place.
pub(crate) fn set_story_rank_in_tx(
    tx: &Transaction,
    actor_id: &str,
    story_id: &str,
    rank: &str,
    proposal_id: Option<&str>,
) -> anyhow::Result<()> {
    check_rank(rank)?;
    let now = now();
    let (project_id, epic_id, key, state, before): (String, String, String, String, String) = tx
        .query_row("SELECT project_id, epic_id, key, state, rank FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .with_context(|| format!("Story {story_id:?} not found"))?;
    anyhow::ensure!(!StoryState::parse(&state)?.is_closed(), "{key} is {state}; a closed Story keeps its place in the order");
    tx.execute("UPDATE stories SET rank = ?1, updated_at = ?2 WHERE id = ?3", params![rank, now, story_id])
        .context("failed to move the Story")?;
    record_event(
        tx,
        &project_id,
        "story",
        story_id,
        EventScope { story_id: Some(story_id), epic_id: Some(&epic_id) },
        actor_id,
        "story.reordered",
        &serde_json::json!({
            "field": "rank", "before": before, "after": rank, "proposal_id": proposal_id,
            "label": format!("Moved {key} in the Epic's order"),
        }),
        &now,
    )?;
    Ok(())
}

/// One Acceptance criterion of a Story written by hand, with its optional Check command. A blank
/// command means the criterion is judged at review.
#[derive(Debug, Clone, Copy)]
pub struct HandWrittenCriterion<'a> {
    pub statement: &'a str,
    pub check_command: Option<&'a str>,
}

/// Write a Story by hand (Milestone 2's stand-in for shaping, issue #50): the Story inside
/// `epic_id`, its criteria in order and their Checks, then Shaping → Ready, all in one
/// transaction. Shaping replaces this in Milestone 3.
///
/// Developer-only, and a Story needs at least one criterion before it is Ready. Any refusal (no
/// Epic, no title, no criterion, a blank statement) writes nothing.
pub fn write_story_by_hand(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    title: &str,
    description: Option<&str>,
    criteria: &[HandWrittenCriterion],
) -> anyhow::Result<Story> {
    anyhow::ensure!(!criteria.is_empty(), "a Story needs at least one Acceptance criterion before it is Ready");
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let mut story = create_story_in_tx(&tx, actor_id, epic_id, title, description, None)?;
    for criterion in criteria {
        let created = create_criterion_in_tx(&tx, actor_id, &story.id, criterion.statement)?;
        if let Some(command) = criterion.check_command.map(str::trim).filter(|c| !c.is_empty()) {
            set_check_in_tx(&tx, actor_id, &created.id, command, None)?;
        }
    }
    set_story_state_in_tx(&tx, actor_id, &story.id, StoryState::Ready)?;
    tx.commit().context("failed to commit write_story_by_hand")?;
    story.state = StoryState::Ready.as_str().to_string();
    Ok(story)
}

/// Every Story of a project, in Roadmap order: Milestone rank, then Epic rank, then Story rank.
pub fn stories_in_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<Story>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.project_id, s.epic_id, s.key, s.title, s.description, s.state, s.runs_after_story_id, s.rank,
                s.runs_after_reason
         FROM stories s
         JOIN epics e ON e.id = s.epic_id
         JOIN milestones m ON m.id = e.milestone_id
         WHERE s.project_id = ?1
         ORDER BY m.rank, m.id, e.rank, e.id, s.rank, s.id",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_story)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the project's Stories")
}
