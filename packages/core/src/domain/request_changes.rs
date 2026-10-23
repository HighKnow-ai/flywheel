//! Request changes (docs/mvp-spec.md §2 "In review → Running", §4.3, §8, issue #158): the developer
//! sends an In review Story back to Running with review comments.
//!
//! [`request_changes`] is human-only. In one transaction it closes the Story's open review as
//! `changes_requested` with the comments, moves the Story to Running and records a
//! `story.changes_requested` event. The Task checklist and the worktree are kept as they are: the
//! next session starts in the same worktree from a Context packet whose section 7 carries the
//! comments (`context_packet`), and the agent adds one Task per review point before anything else.
//!
//! Starting that session is the command's job (`story_request_changes` in the desktop crate), which
//! calls this first and then launches, under one database lock, so the Story never reads Stopped
//! unless the launch fails; a failed launch leaves it Stopped, with Resume.
//!
//! Refused, writing nothing, for an agent, for blank comments, for a Story not In review, and while
//! a session of the Story is live. A Story handed off before reviews existed has no open review: one
//! is opened from its worktree's diff, so the comments have a row to land on.

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::domain::actor::assert_human_actor;
use crate::domain::check::worktree_head;
use crate::domain::review::{close_review_in_tx, open_review, open_review_in_tx, read_review_diff};
use crate::domain::story::{get_story, set_story_state_in_tx, StoryState};
use crate::domain::worktree::worktree_for_story;
use crate::domain::{now, record_event, EventScope};

/// Send `story_id` back to Running with `comments`, as `actor_id`. See the module documentation.
pub fn request_changes(conn: &mut Connection, actor_id: &str, story_id: &str, comments: &str) -> anyhow::Result<()> {
    assert_human_actor(conn, actor_id)?;
    let comments = comments.trim();
    anyhow::ensure!(!comments.is_empty(), "Request changes needs a comment: say what the agent should change.");
    let story = get_story(conn, story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    anyhow::ensure!(
        story.state == StoryState::InReview.as_str(),
        "Only a Story In review takes a request for changes, and {} is {}.",
        story.key,
        story.state.replace('_', " ")
    );
    let live: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sessions WHERE story_id = ?1 AND status IN ('running', 'blocked'))",
        params![story_id],
        |r| r.get(0),
    )?;
    anyhow::ensure!(!live, "{} has a live session. Stop it before requesting changes.", story.key);

    let diff = match open_review(conn, story_id)? {
        Some(_) => None,
        None => {
            let worktree = worktree_for_story(conn, story_id)?
                .filter(|w| Path::new(&w.path).is_dir())
                .with_context(|| format!("{} has no worktree on disk to send back to. Recreate it, or drop the Story.", story.key))?;
            let path = Path::new(&worktree.path);
            Some(read_review_diff(path, &worktree.base_branch, &worktree_head(path)?)?)
        }
    };

    let now = now();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(diff) = &diff {
        open_review_in_tx(&tx, &story.project_id, story_id, None, diff, &serde_json::Value::Array(Vec::new()))?;
    }
    let review_id: String = tx
        .query_row("SELECT id FROM reviews WHERE story_id = ?1 AND outcome IS NULL", params![story_id], |r| r.get(0))
        .context("failed to read the open review")?;
    close_review_in_tx(&tx, story_id, actor_id, "changes_requested", None, Some(comments))?;
    // The review is already closed, so this move's own close finds nothing left to close.
    set_story_state_in_tx(&tx, actor_id, story_id, StoryState::Running)?;
    record_event(
        &tx,
        &story.project_id,
        "story",
        story_id,
        EventScope { story_id: Some(story_id), epic_id: Some(&story.epic_id) },
        actor_id,
        "story.changes_requested",
        &serde_json::json!({
            "review_id": review_id,
            "comments": comments,
            "label": format!("Requested changes on {}", story.key),
        }),
        &now,
    )?;
    tx.commit().context("failed to commit request_changes")?;
    Ok(())
}
