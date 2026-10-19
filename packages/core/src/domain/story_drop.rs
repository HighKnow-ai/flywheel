//! Drop (docs/mvp-spec.md §2): the developer ends a Story on purpose, from any state but Merged.
//! Its worktree and branch are removed, uncommitted work included; the record, its criteria, Tasks,
//! sessions and summaries stay readable, and it counts as closed for its Epic.
//!
//! Drop is the developer's own act, not an agent's Gated action: it raises no permission request.
//! It refuses while a session is live, because removing a worktree under a running agent corrupts
//! both; the developer stops the session first.
//!
//! The wipe lives here, not in `git.rs` or `domain/worktree.rs`: the routine removal chain there
//! never forces and refuses a dirty tree (D-43, pinned by `tests/worktree_removal.rs`). Drop is
//! the one path where discarding uncommitted work is the point (docs/mvp-spec.md §4.5: "Wiping
//! the work is Cyril's call, through Drop"), so it owns its own forced removal.

use std::path::Path;

use anyhow::{bail, Context};
use rusqlite::{params, Connection};

use crate::domain::actor::assert_human_actor;
use crate::domain::story::{get_story, is_allowed_transition, set_story_state, StoryState};
use crate::domain::worktree::{record_worktree_removed, worktree_for_story};
use crate::git;

/// Remove the Story's worktree with `--force` and delete its branch, then record the removal. A
/// Story with no worktree is a no-op; a worktree already missing on disk is pruned from git's list.
/// Refuses a path outside the Flywheel worktree root, the repository itself, and any branch outside
/// the `flywheel/` namespace or equal to the base branch.
fn wipe_worktree_and_branch(conn: &mut Connection, story_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let Some(worktree) = worktree_for_story(conn, story_id)? else {
        return Ok(());
    };
    let repo_path: String = conn
        .query_row("SELECT repo_path FROM projects WHERE id = ?1", params![worktree.project_id], |row| row.get(0))
        .with_context(|| format!("project {:?} not found", worktree.project_id))?;
    let story_key: String = conn
        .query_row("SELECT key FROM stories WHERE id = ?1", params![story_id], |row| row.get(0))
        .with_context(|| format!("Story {story_id:?} not found"))?;
    let repo = Path::new(&repo_path);
    let path = Path::new(&worktree.path);

    if path == repo || !path.starts_with(git::worktree_root_from_env()) {
        bail!("Drop refused: {path:?} is not a Flywheel worktree");
    }
    let branch = worktree.branch.as_str();
    if branch == worktree.base_branch || !branch.starts_with(crate::branch::FLYWHEEL_BRANCH_NAMESPACE) {
        bail!("Drop refused: {branch:?} is not a Story branch");
    }

    if path.exists() {
        let path_str = path.to_string_lossy().into_owned();
        git::git_at(repo, &["worktree", "remove", "--force", &path_str])
            .with_context(|| format!("failed to remove the worktree of {story_key}"))?;
    } else {
        git::git_at(repo, &["worktree", "prune"]).context("failed to prune the missing worktree")?;
    }
    if git::rev_parse_verify(repo, &format!("refs/heads/{branch}"))? {
        git::git_at(repo, &["branch", "-D", "--", branch])
            .with_context(|| format!("the worktree of {story_key} is gone, but its branch could not be deleted"))?;
    }

    record_worktree_removed(conn, &worktree, story_id, &story_key, actor_id).map_err(|e| {
        anyhow::anyhow!("the worktree and branch were removed but their record was not updated: {e:#}")
    })
}

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

    wipe_worktree_and_branch(conn, story_id, actor_id)?;
    set_story_state(conn, actor_id, story_id, StoryState::Dropped)
}
