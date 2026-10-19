//! Drop (docs/mvp-spec.md §2): the developer ends a Story on purpose, from any state but Merged.
//! Its worktree and branch are removed, uncommitted work included; the record, its criteria, Tasks,
//! sessions and summaries stay readable, and it counts as closed for its Epic.
//!
//! Drop is the developer's own act, not an agent's Gated action: it raises no permission request.
//! It refuses while a session is live, because removing a worktree under a running agent corrupts
//! both; the developer stops the session first.

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::domain::actor::assert_human_actor;
use crate::domain::story::{get_story, is_allowed_transition, set_story_state, StoryState};
use crate::domain::worktree::remove_worktree_and_branch_for_drop;

/// Drop `story_id`. Checks, in order: the actor is the developer, the Story may move to Dropped,
/// no session is live. Then removes the worktree and branch, and only once they are gone moves the
/// Story to Dropped, so a failed removal leaves the Story where it was.
pub fn drop_story(conn: &mut Connection, actor_id: &str, story_id: &str) -> anyhow::Result<()> {
    assert_human_actor(conn, actor_id)?;
    let story = get_story(conn, story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    let from = StoryState::parse(&story.state)?;
    anyhow::ensure!(
        is_allowed_transition(from, StoryState::Dropped),
        "a {} Story cannot be dropped",
        from.as_str()
    );
    let live: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM sessions WHERE story_id = ?1 AND status IN ('running', 'blocked'))",
            params![story_id],
            |row| row.get(0),
        )
        .context("failed to check for a live session before Drop")?;
    anyhow::ensure!(!live, "{} has a live session. Stop the session first, then drop it.", story.key);

    remove_worktree_and_branch_for_drop(conn, story_id, actor_id)?;
    set_story_state(conn, actor_id, story_id, StoryState::Dropped)
}
