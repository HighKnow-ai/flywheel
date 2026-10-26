//! Worktree create-or-reuse (WORK-01, WORK-08, D-30): `ensure_worktree` is the ONE call site that
//! resolves whether a Story's worktree already exists, and if not, creates it. Never rely on git's
//! own error to detect a duplicate (RESEARCH.md Pitfall 2) — this module always checks the
//! `worktrees` table first.
//!
//! `worktrees.story_id` carries a UNIQUE constraint: a worktree is a durable resource owned by one
//! Story, created once and reused by every session of that Story.

use std::path::{Path, PathBuf};

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::branch::story_branch_name;
use crate::domain::event::{append_event, next_sequence};
use crate::git;
use crate::ids::new_id;

/// A worktree row, as read back after [`ensure_worktree`] resolves it (either freshly created or
/// reused unchanged).
#[derive(Debug, Clone, PartialEq)]
pub struct Worktree {
    pub id: String,
    pub story_id: String,
    pub project_id: String,
    pub path: String,
    pub branch: String,
    pub base_branch: String,
    pub status: String,
    /// Where the project sits inside the worktree, relative to `path`: '' for a project at its
    /// repository's root, `flywheel` for one registered at `<repo>/flywheel`
    /// (cymarechal/highknow-mvp#551). Read through [`Worktree::project_dir`].
    pub subdir: String,
}

impl Worktree {
    /// The project's directory in this worktree: where the agent starts, the Checks run and the
    /// editor opens. `path` itself stays the worktree's root, which git work on the worktree uses.
    pub fn project_dir(&self) -> PathBuf {
        if self.subdir.is_empty() {
            PathBuf::from(&self.path)
        } else {
            Path::new(&self.path).join(&self.subdir)
        }
    }
}

fn row_to_worktree(row: &rusqlite::Row) -> rusqlite::Result<Worktree> {
    Ok(Worktree {
        id: row.get(0)?,
        story_id: row.get(1)?,
        project_id: row.get(2)?,
        path: row.get(3)?,
        branch: row.get(4)?,
        base_branch: row.get(5)?,
        status: row.get(6)?,
        subdir: row.get(7)?,
    })
}

const WORKTREE_SELECT_SQL: &str =
    "SELECT id, story_id, project_id, path, branch, base_branch, status, subdir FROM worktrees WHERE story_id = ?1";

/// Every `worktrees` row currently `status = 'active'` — [`reconcile_worktrees`]'s own candidate
/// set. Only `active` rows are ever examined (a row already `stale`/`merged`/`abandoned` is left
/// alone), matching `<behavior>`'s "only active rows are candidates" rule.
const ACTIVE_WORKTREES_SELECT_SQL: &str =
    "SELECT id, story_id, project_id, path, branch, base_branch, status, subdir FROM worktrees WHERE status = 'active'";

/// The existing worktree row for `story_id`, if one has ever been created — the existence check
/// `ensure_worktree` performs BEFORE opening a transaction or touching git (RESEARCH.md Pitfall 2).
pub fn worktree_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Option<Worktree>> {
    conn.query_row(WORKTREE_SELECT_SQL, params![story_id], row_to_worktree)
        .optional()
        .context("failed to look up the worktree for this Story")
}

/// The Flywheel-managed worktree root (D-23): `~/Flywheel/`, unless `FLYWHEEL_WORKTREE_ROOT` is
/// set — a deliberate test-only seam, never a user setting (rigidity is the feature).
pub fn worktree_root() -> PathBuf {
    git::worktree_root_from_env()
}

/// Resolve the base ref a Story's worktree branches from (D-26, WORK-02): the project's own
/// `default_branch`, the branch a Story is merged back into (docs/mvp-spec.md §2: "Merged means the
/// merge commit is on the base branch"). No configuration input, no caller-supplied override, no
/// planner or agent choice.
///
/// This is the ONE call site in this crate that resolves a base ref for worktree creation —
/// `ensure_worktree` calls this and nothing else.
pub fn base_ref_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<String> {
    conn.query_row(
        "SELECT p.default_branch FROM stories s JOIN projects p ON p.id = s.project_id WHERE s.id = ?1",
        params![story_id],
        |row| row.get(0),
    )
    .with_context(|| format!("Story {story_id:?} not found"))
}

/// Create-or-reuse a Story's worktree (D-30). Performs the existence SELECT before opening any
/// transaction; when a row already exists, returns it untouched and issues no second
/// `git worktree add`. Otherwise: derives the branch name (`branch::story_branch_name`), resolves
/// the base ref via [`base_ref_for_story`] (D-26), computes the
/// worktree path as `worktree_root()/{project.key_prefix}/{story.key}/`, calls
/// `git::worktree_add`, then opens one transaction that inserts the `worktrees` row and appends a
/// `worktree.created` event.
pub fn ensure_worktree(conn: &mut Connection, story_id: &str, actor_id: &str) -> anyhow::Result<Worktree> {
    if let Some(existing) = worktree_for_story(conn, story_id)? {
        return Ok(existing);
    }

    let (project_id, story_key, story_title): (String, String, String) = conn
        .query_row(
            "SELECT project_id, key, title FROM stories WHERE id = ?1",
            params![story_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("Story {story_id:?} not found"))?;

    let (repo_path, key_prefix): (String, String) = conn
        .query_row(
            "SELECT repo_path, key_prefix FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    let branch = story_branch_name(&story_key, &story_title);
    let base_branch = base_ref_for_story(conn, story_id)?;
    let subdir = git::project_subdir(Path::new(&repo_path))
        .with_context(|| format!("failed to read where the project sits in its repository for Story {story_id:?}"))?;

    let worktree_path = worktree_root().join(&key_prefix).join(&story_key);

    if worktree_path.exists() {
        anyhow::bail!(
            "worktree_add refused: {worktree_path:?} already exists on disk but no worktrees \
             row claims it"
        );
    }

    git::worktree_add(
        std::path::Path::new(&repo_path),
        &worktree_path,
        &branch,
        &base_branch,
    )
    .with_context(|| format!("failed to create worktree for Story {story_id:?}"))?;

    let id = new_id();
    let now = Utc::now().to_rfc3339();
    let worktree_path_str = worktree_path.to_string_lossy().into_owned();

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO worktrees (
            id, story_id, project_id, path, branch, base_branch, status, created_by, created_at, subdir
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9)",
        params![id, story_id, project_id, worktree_path_str, branch, base_branch, actor_id, now, subdir],
    )
    .context("failed to insert worktree row")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "worktree",
        "before": null,
        "after": branch,
        "label": format!("Created worktree {branch}"),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "worktree",
        &id,
        Some(story_id),
        None,
        actor_id,
        "worktree.created",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit ensure_worktree transaction")?;

    Ok(Worktree {
        id,
        story_id: story_id.to_string(),
        project_id,
        path: worktree_path_str,
        branch,
        base_branch,
        status: "active".to_string(),
        subdir,
    })
}

/// One line of `git status --porcelain` output, split into its two-character status code and the
/// path it describes. A line shorter than four characters (code + separating space + at least one
/// path byte) is kept rather than dropped — its raw text becomes `path` and its `code` reads
/// `"??"`, so a malformed/truncated porcelain line still surfaces as SOMETHING dirty rather than
/// silently vanishing from the count (D-42/D-43's "never silently drop a would-be-lost change").
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PorcelainEntry {
    pub code: String,
    pub path: String,
}

/// Parse `git status --porcelain`'s raw stdout for `worktree_path` into one [`PorcelainEntry`]
/// per line, preserving git's own ordering — no filtering, no sorting, no deduplication. This is
/// the sole caller of `git::git_status_porcelain` (WORK-03's one-porcelain-read-site contract);
/// every caller that needs a dirty-tree read (the desktop command's fresh-at-open-time check, and
/// [`remove_worktree_for_story`]'s own re-read) goes through this function.
pub fn porcelain_entries(worktree_path: &Path) -> anyhow::Result<Vec<PorcelainEntry>> {
    let raw = git::git_status_porcelain(worktree_path)?;
    Ok(raw
        .lines()
        .map(|line| {
            if line.len() < 4 {
                PorcelainEntry { code: "??".to_string(), path: line.to_string() }
            } else {
                PorcelainEntry { code: line[0..2].to_string(), path: line[3..].to_string() }
            }
        })
        .collect())
}

/// Remove a Story's worktree (WORK-03, D-41/D-42/D-43). Bails when no `worktrees` row exists for
/// `story_id`. **Re-reads `git status --porcelain` itself** via [`porcelain_entries`] — never
/// trusts a caller-supplied dirty check — and bails naming the dirty count on ANY non-empty
/// result. This closes the check-then-act window between a renderer's earlier
/// `worktree_remove_check` read and this call: the renderer's check is advisory UI only, this
/// re-read is the actual guard, and there is no parameter anywhere in this call chain that could
/// skip it (D-43). Only on a verified-clean tree does it call `git::worktree_remove`, then in ONE
/// transaction deletes the `worktrees` row and appends a `worktree.removed` event shaped like
/// `ensure_worktree`'s own `worktree.created` payload (`reconcile_projects`'s
/// `field`/`before`/`after`/`label` idiom).
pub fn remove_worktree_for_story(
    conn: &mut Connection,
    story_id: &str,
    actor_id: &str,
) -> anyhow::Result<()> {
    remove_worktree(conn, story_id, actor_id, false)
}

/// [`remove_worktree_for_story`] with one more refusal: a session that is `running` or `blocked` on
/// the Story or in the worktree stops the removal, checked immediately before `git worktree remove`
/// (WR-04). The batch reclaim uses this because its eligibility read can be seconds stale by the
/// time the removal runs, and an agent started in a closed Story's worktree in between has written
/// nothing yet, so the porcelain check cannot see it. The single-worktree remove keeps its
/// established behaviour (its callers and tests remove worktrees whose runs are still recorded as
/// live). This narrows the window to the gap between the query and the `git` call; it does not
/// close it -- that would need a marker `session_start` refuses against.
pub fn remove_worktree_for_story_refusing_live_run(
    conn: &mut Connection,
    story_id: &str,
    actor_id: &str,
) -> anyhow::Result<()> {
    remove_worktree(conn, story_id, actor_id, true)
}

fn remove_worktree(
    conn: &mut Connection,
    story_id: &str,
    actor_id: &str,
    refuse_live_run: bool,
) -> anyhow::Result<()> {
    let worktree = worktree_for_story(conn, story_id)?
        .ok_or_else(|| anyhow::anyhow!("no worktree exists for Story {story_id:?}"))?;

    let repo_path: String = conn
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            params![worktree.project_id],
            |row| row.get(0),
        )
        .with_context(|| format!("project {:?} not found", worktree.project_id))?;

    let story_key: String = conn
        .query_row("SELECT key FROM stories WHERE id = ?1", params![story_id], |row| row.get(0))
        .with_context(|| format!("Story {story_id:?} not found"))?;

    // Re-read porcelain HERE, never trusting the renderer's own earlier check (D-43's "no
    // check-then-act window" requirement) — a dirty tree refuses unconditionally.
    let entries = porcelain_entries(Path::new(&worktree.path))?;
    if !entries.is_empty() {
        anyhow::bail!(
            "worktree_remove refused: {} uncommitted change(s) in {:?}",
            entries.len(),
            worktree.path
        );
    }

    if refuse_live_run {
        let live_run: bool = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM sessions
                    WHERE (story_id = ?1 OR worktree_id = ?2) AND status IN ('running', 'blocked'))",
                params![story_id, worktree.id],
                |row| row.get(0),
            )
            .context("failed to check for a live run before removing the worktree")?;
        if live_run {
            anyhow::bail!("worktree_remove refused: an agent run is live in the worktree for Story {story_id:?}");
        }
    }

    if let Err(e) = git::worktree_remove(Path::new(&repo_path), Path::new(&worktree.path)) {
        // A removal that errors or times out is not "nothing happened": git may have deleted part
        // of a large tree before it was killed (WR-05). Say what is on disk so the failure is not
        // mistaken for a clean refusal.
        let on_disk = if Path::new(&worktree.path).exists() {
            "the directory still exists and may be partially deleted -- check it before retrying"
        } else {
            "the directory is gone but git reported an error, so the worktree record was kept"
        };
        return Err(e.context(format!("failed to remove worktree for Story {story_id:?}: {on_disk}")));
    }

    // Past this point the directory is gone, so a database failure is its own outcome (WR-05).
    record_worktree_removed(conn, &worktree, story_id, &story_key, actor_id).map_err(|e| {
        anyhow::anyhow!("the worktree directory was removed but its record was not updated: {e:#}")
    })
}

/// The database half of [`remove_worktree_for_story`]: decouple runs, delete the row, append the
/// `worktree.removed` event, in one transaction. The transaction takes the write lock up front
/// (`Immediate`): the batch reclaim runs on a second writer connection, and a deferred transaction
/// that reads before it writes fails with `SQLITE_BUSY_SNAPSHOT` -- which `busy_timeout` does not
/// retry -- if another writer commits in between.
pub(crate) fn record_worktree_removed(
    conn: &mut Connection,
    worktree: &Worktree,
    story_id: &str,
    story_key: &str,
    actor_id: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    record_worktree_removed_in_tx(&tx, worktree, story_id, story_key, actor_id, &now)?;
    tx.commit().context("failed to commit remove_worktree_for_story transaction")?;
    Ok(())
}

/// [`record_worktree_removed`] inside the caller's transaction: Merge records the removal in the
/// one transaction that moves the Story to Merged.
pub(crate) fn record_worktree_removed_in_tx(
    tx: &rusqlite::Transaction,
    worktree: &Worktree,
    story_id: &str,
    story_key: &str,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    // `sessions.worktree_id` is a NULLABLE `REFERENCES worktrees(id)` (unlike `sessions.story_id`,
    // which is NOT NULL) — a session's history belongs to its Story forever, but its worktree is
    // this function's own to reclaim. Decouple any session that pointed at this worktree BEFORE
    // deleting the row, or SQLite's `foreign_keys = ON` raises a raw `FOREIGN KEY constraint
    // failed` the moment a Story has ever had a session.
    tx.execute(
        "UPDATE sessions SET worktree_id = NULL WHERE worktree_id = ?1",
        params![worktree.id],
    )
    .context("failed to decouple agent runs from the worktree being removed")?;

    tx.execute("DELETE FROM worktrees WHERE id = ?1", params![worktree.id])
        .context("failed to delete worktree row")?;

    let sequence = next_sequence(tx, &worktree.project_id, "local")?;
    let payload = serde_json::json!({
        "field": "worktree",
        "before": worktree.branch,
        "after": null,
        "label": format!("Removed worktree for {story_key}"),
    });
    append_event(
        tx,
        &worktree.project_id,
        "local",
        sequence,
        "worktree",
        &worktree.id,
        Some(story_id),
        None,
        actor_id,
        "worktree.removed",
        &payload,
        now,
    )?;
    Ok(())
}

/// Launch-time worktree reconciliation (WORK-06, D-45) — structurally identical to
/// `domain::project::reconcile_projects`: detect a mismatch between the database and the
/// filesystem, surface it, never silently repair it.
///
/// Selects every `status = 'active'` row through [`ACTIVE_WORKTREES_SELECT_SQL`] (a
/// compile-time-literal constant, no `format!`), collecting them into a `Vec` before the loop so
/// no statement is held open across the per-row transactions below. For each row, presence is
/// `std::path::Path::new(&row.path).try_exists().unwrap_or(false)` — `try_exists` distinguishes
/// "absent" from "could not tell" (a permissions error on the parent directory, say), and
/// `.unwrap_or(false)` deliberately collapses "could not tell" into "missing", mirroring
/// `reconcile_projects`'s own `.unwrap_or(false)` so one unreadable row never aborts the pass for
/// every other row.
///
/// A row whose derived status equals its current status is skipped with no write and no event —
/// this is what makes a second run over an unchanged filesystem a true no-op, and what keeps a
/// worktree that went `missing` and then reappeared on disk at `missing`: reconciliation never
/// moves a row back to `active` on its own (that is the user's Recreate decision,
/// [`recreate_worktree_for_story`]). On a real change, one transaction updates `status` — and
/// nothing else; `path`/`branch`/`base_branch` are structurally out of reach of this function's
/// `UPDATE` statement — and appends one `worktree.missing` event whose payload carries a
/// human-renderable `label` (D-19) for the activity trail.
pub fn reconcile_worktrees(conn: &mut Connection, actor_id: &str) -> anyhow::Result<()> {
    let active_worktrees: Vec<Worktree> = {
        let mut stmt = conn
            .prepare(ACTIVE_WORKTREES_SELECT_SQL)
            .context("failed to prepare the active-worktrees reconciliation query")?;
        let rows = stmt
            .query_map([], row_to_worktree)
            .context("failed to query active worktrees for reconciliation")?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("failed to read an active worktree row during reconciliation")?
    };

    let now = Utc::now().to_rfc3339();

    for worktree in active_worktrees {
        // Any read failure (a permissions error, a genuinely absent path) reads as "not present"
        // here — one bad row must never abort reconciliation for every other worktree.
        let present = Path::new(&worktree.path).try_exists().unwrap_or(false);
        let new_status = if present { "active" } else { "missing" };
        if new_status == worktree.status {
            // No change: no row write, no event — the no-op contract.
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute("UPDATE worktrees SET status = ?1 WHERE id = ?2", params![new_status, worktree.id])
            .context("failed to update worktree status during reconciliation")?;

        let sequence = next_sequence(&tx, &worktree.project_id, "local")?;
        let payload = serde_json::json!({
            "field": "status",
            "before": worktree.status,
            "after": new_status,
            "path": worktree.path,
            "label": "Worktree missing from disk",
        });
        append_event(
            &tx,
            &worktree.project_id,
            "local",
            sequence,
            "worktree",
            &worktree.id,
            Some(&worktree.story_id),
            None,
            actor_id,
            "worktree.missing",
            &payload,
            &now,
        )?;

        tx.commit().context("failed to commit reconcile_worktrees transaction")?;
    }

    Ok(())
}

/// Re-run worktree creation on a `missing` row, against the SAME recorded `branch`/`base_branch`
/// (D-45's Recreate decision, plan 03-UI-SPEC.md). Never allocates a new branch name and never
/// calls [`base_ref_for_story`] — that function lazily CUTS an epic integration branch as a side
/// effect, and recreating a worktree must reproduce the recorded topology rather than mint new git
/// history.
///
/// Refuses (via `bail!`, naming the actual status) when no row exists for `story_id` or when the
/// row's status is not `missing` — this can never be used as a second worktree-creation path for
/// a healthy worktree. Probes with [`git::rev_parse_verify`] first: when the recorded branch still
/// exists (the realistic case — only the working directory was deleted), checks it out with the
/// existing-branch form of `git worktree add`; otherwise uses the `-b` form exactly as
/// [`ensure_worktree`] would for a brand-new branch. Neither form bypasses `git::worktree_add`'s
/// own adjacency refusals — both go through `git::git_at` (never a new `packages/core/src/git.rs`
/// function, which is owned by other plans in earlier waves). On success, updates the row back to
/// `active` and appends `worktree.recreated` in one transaction; a failed git call leaves the row
/// at `missing` untouched — a failed recreate is not a decision made.
pub fn recreate_worktree_for_story(
    conn: &mut Connection,
    story_id: &str,
    actor_id: &str,
) -> anyhow::Result<Worktree> {
    let worktree = worktree_for_story(conn, story_id)?
        .ok_or_else(|| anyhow::anyhow!("no worktree exists for Story {story_id:?}"))?;

    if worktree.status != "missing" {
        anyhow::bail!(
            "recreate_worktree_for_story refused: worktree for Story {story_id:?} has status \
             {:?}, expected \"missing\"",
            worktree.status
        );
    }

    let repo_path: String = conn
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            params![worktree.project_id],
            |row| row.get(0),
        )
        .with_context(|| format!("project {:?} not found", worktree.project_id))?;

    let repo_path = Path::new(&repo_path);
    let worktree_path = Path::new(&worktree.path);

    // The directory this row names is confirmed gone (the row is `missing`), but git's own
    // internal administrative record for it under `.git/worktrees/<name>` is NOT automatically
    // cleared when the directory disappears out from under it (the whole scenario D-45 exists
    // for — the user deleted it outside Flywheel). `git worktree add` on that exact same path
    // fails with "is a missing but already registered worktree" until that stale record is
    // pruned. Safe here specifically because reconciliation already confirmed the directory is
    // genuinely absent — `git worktree prune` only clears administrative entries whose working
    // directory is truly gone, never a live one.
    git::git_at(repo_path, &["worktree", "prune"])
        .with_context(|| format!("failed to prune stale worktree metadata in {repo_path:?}"))?;

    let branch_exists = git::rev_parse_verify(repo_path, &worktree.branch)
        .with_context(|| format!("failed to probe branch {:?} in {repo_path:?}", worktree.branch))?;

    if branch_exists {
        // The realistic case: only the working directory was deleted, the branch survives.
        // Check it out rather than minting a new one — `git worktree add`'s `-b` form would
        // refuse anyway, since `worktree_add`'s own guard rejects an already-existing branch.
        let worktree_path_str = worktree_path.to_string_lossy().into_owned();
        git::git_at(repo_path, &["worktree", "add", &worktree_path_str, &worktree.branch])
            .with_context(|| format!("failed to recreate worktree for Story {story_id:?}"))?;
    } else {
        git::worktree_add(repo_path, worktree_path, &worktree.branch, &worktree.base_branch)
            .with_context(|| format!("failed to recreate worktree for Story {story_id:?}"))?;
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    tx.execute("UPDATE worktrees SET status = 'active' WHERE id = ?1", params![worktree.id])
        .context("failed to update worktree status after recreate")?;

    let sequence = next_sequence(&tx, &worktree.project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": "missing",
        "after": "active",
        "path": worktree.path,
        "label": "Worktree recreated",
    });
    append_event(
        &tx,
        &worktree.project_id,
        "local",
        sequence,
        "worktree",
        &worktree.id,
        Some(story_id),
        None,
        actor_id,
        "worktree.recreated",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit recreate_worktree_for_story transaction")?;

    Ok(Worktree { status: "active".to_string(), ..worktree })
}

/// Delete a `missing` row's record with no filesystem call of any kind (D-45's "Remove Record"
/// decision) — there is nothing on disk to touch, since the directory is already gone. Refuses
/// (via `bail!`, naming the actual status) when no row exists for `story_id` or when the row's
/// status is not `missing`; the only removal path for a REAL, on-disk worktree remains
/// [`remove_worktree_for_story`]'s porcelain-checked one.
pub fn forget_worktree_record(conn: &mut Connection, story_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let worktree = worktree_for_story(conn, story_id)?
        .ok_or_else(|| anyhow::anyhow!("no worktree exists for Story {story_id:?}"))?;

    if worktree.status != "missing" {
        anyhow::bail!(
            "forget_worktree_record refused: worktree for Story {story_id:?} has status {:?}, \
             expected \"missing\"",
            worktree.status
        );
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    // Same FK hazard as `remove_worktree_for_story` above: `sessions.worktree_id` is nullable
    // and must be decoupled before the `worktrees` row is deleted, or a Story that ever had an
    // agent run in this worktree raises a raw `FOREIGN KEY constraint failed` here too.
    tx.execute(
        "UPDATE sessions SET worktree_id = NULL WHERE worktree_id = ?1",
        params![worktree.id],
    )
    .context("failed to decouple agent runs from the worktree record being forgotten")?;

    tx.execute("DELETE FROM worktrees WHERE id = ?1", params![worktree.id])
        .context("failed to delete worktree row")?;

    let sequence = next_sequence(&tx, &worktree.project_id, "local")?;
    let payload = serde_json::json!({
        "field": "worktree",
        "before": worktree.branch,
        "after": null,
        "label": "Worktree record forgotten",
    });
    append_event(
        &tx,
        &worktree.project_id,
        "local",
        sequence,
        "worktree",
        &worktree.id,
        Some(story_id),
        None,
        actor_id,
        "worktree.record_forgotten",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit forget_worktree_record transaction")?;
    Ok(())
}

/// D-130: which of the two "open this worktree" actions a template/argv is being resolved for —
/// editor or terminal. `Serialize`/`Deserialize` so it crosses the Tauri IPC boundary as a plain
/// lowercase string (`"editor"` / `"terminal"`), matching `adapters/tauri.ts`'s
/// `WorktreeOpenSurface`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenSurface {
    Editor,
    Terminal,
}

impl OpenSurface {
    fn settings_key(self) -> &'static str {
        match self {
            OpenSurface::Editor => "open_in_editor_command",
            OpenSurface::Terminal => "open_in_terminal_command",
        }
    }

    fn label(self) -> &'static str {
        match self {
            OpenSurface::Editor => "editor",
            OpenSurface::Terminal => "terminal",
        }
    }

    fn default_template(self) -> &'static str {
        match self {
            OpenSurface::Editor => DEFAULT_EDITOR_TEMPLATE,
            OpenSurface::Terminal => DEFAULT_TERMINAL_TEMPLATE,
        }
    }
}

/// The literal substitution token inside a stored open-command template (D-130) — replaced with
/// the worktree's own absolute path inside whichever argv element contains it, never splitting
/// that element into two.
pub const WORKTREE_PATH_TOKEN: &str = "{worktree_path}";

/// D-130's default "Open in editor" template — `code` confirmed on this machine's `PATH`
/// (07-RESEARCH.md). The template is editable from Settings, so a wrong default on a machine
/// without VS Code on `PATH` is a settings change, not a defect.
pub const DEFAULT_EDITOR_TEMPLATE: &str = "code {worktree_path}";

/// D-130's default "Open in terminal" template — `open -a Terminal` is the macOS system
/// terminal, and v1 is macOS-only (phase 11 is the macOS build).
pub const DEFAULT_TERMINAL_TEMPLATE: &str = "open -a Terminal {worktree_path}";

/// `surface`'s stored open-command template, or its own default ([`DEFAULT_EDITOR_TEMPLATE`] /
/// [`DEFAULT_TERMINAL_TEMPLATE`]) when no `settings` row exists yet — exact structural sibling of
/// `domain::settings::global_credential_mode`'s read-with-default idiom. These two actions are
/// global, not per-project, exactly like the credential mode's global half.
pub fn open_command_template(conn: &Connection, surface: OpenSurface) -> anyhow::Result<String> {
    Ok(crate::domain::settings::read_setting(conn, surface.settings_key())?
        .unwrap_or_else(|| surface.default_template().to_string()))
}

/// Set `surface`'s stored open-command template (D-130). Rejects an empty or whitespace-only
/// template — naming the surface — rather than storing a value that could never spawn anything.
/// Exact structural sibling of `domain::settings::set_global_credential_mode`'s
/// write-plus-audit-row shape: `updated_by`/`updated_at` on the `settings` row are this write's
/// own audit record, and no `events` row is appended — a global setting has no natural project
/// stream to attribute one to (`domain::settings`'s own doc comment).
pub fn set_open_command_template(
    conn: &mut Connection,
    actor_id: &str,
    surface: OpenSurface,
    template: &str,
) -> anyhow::Result<()> {
    if template.trim().is_empty() {
        anyhow::bail!(
            "open-command template for the {} surface must not be empty",
            surface.label()
        );
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    crate::domain::settings::upsert_setting(&tx, surface.settings_key(), template, actor_id, &now)?;
    tx.commit()
        .context("failed to commit set_open_command_template transaction")?;
    Ok(())
}

/// Resolve `story_id`'s worktree-open argv for `surface` (D-130, T-07-04-01). The template is
/// split on runs of ASCII whitespace into argv elements — the one splitting site this module
/// uses — which collapses whitespace runs and yields no empty elements. The worktree path is
/// substituted INSIDE whichever element contains [`WORKTREE_PATH_TOKEN`], never splitting that
/// element; when no element contains the token, the path is pushed as one additional final
/// element, so a template with no token (`code` alone) still works.
///
/// The returned vector is handed to `Command::new(argv[0]).args(&argv[1..])` and is never joined
/// back into a command line — no character inside the worktree path or inside the user's own
/// template can therefore be interpreted as a command separator by anything spawning it (the
/// whole mitigation for T-07-04-01).
///
/// Errors naming `story_id` when no `worktrees` row exists for it — never returns an argv
/// carrying an empty path.
pub fn resolve_open_argv(conn: &Connection, story_id: &str, surface: OpenSurface) -> anyhow::Result<Vec<String>> {
    let worktree = worktree_for_story(conn, story_id)?
        .ok_or_else(|| anyhow::anyhow!("no worktree exists for Story {story_id:?}"))?;

    let template = open_command_template(conn, surface)?;
    // The editor and the terminal open where the agent works: the project's directory in the
    // worktree, which is the worktree's root unless the project is a subdirectory of its repository.
    let dir = worktree.project_dir().to_string_lossy().into_owned();

    let mut argv: Vec<String> = Vec::new();
    let mut token_found = false;
    for element in template.split_whitespace() {
        if element.contains(WORKTREE_PATH_TOKEN) {
            token_found = true;
            argv.push(element.replace(WORKTREE_PATH_TOKEN, &dir));
        } else {
            argv.push(element.to_string());
        }
    }
    if !token_found {
        argv.push(dir);
    }

    Ok(argv)
}

// ---------------------------------------------------------------------------------------------
// The worktree inventory's judgement and measurement (Phase 10 plan 10-08, WORK-07, D-177/D-178).
// ---------------------------------------------------------------------------------------------

/// Why a worktree has the disposition it has. A closed enum, because every inventory row must name
/// its basis and a free-text reason would drift from the legend that renders it.
///
/// `worktrees.status` also allows `stale` and `merged` in its CHECK constraint. **Nothing writes
/// either, on purpose (D-178):** reclaimability is derived from facts already recorded, so there is
/// no stored judgement to go stale. The only writers of that column are [`reconcile_worktrees`] and
/// [`recreate_worktree_for_story`], writing `active` or `missing`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReclaimReason {
    /// The Story is Merged.
    Merged,
    /// The Story is Dropped.
    Dropped,
    /// A run against this worktree is running.
    Sessionning,
    /// A run against this worktree is blocked on a permission request.
    Blocked,
    /// The tree has uncommitted changes.
    UncommittedChanges,
    /// The owning project cannot be reached, so nothing about its worktrees can be evaluated.
    ProjectUnreachable,
    /// The row exists but its directory does not.
    DirectoryMissing,
    /// The Story is neither merged nor dropped: nothing says the work is finished.
    StoryOpen,
}

impl ReclaimReason {
    /// The wire word the renderer matches on.
    pub fn as_str(self) -> &'static str {
        match self {
            ReclaimReason::Merged => "merged",
            ReclaimReason::Dropped => "dropped",
            ReclaimReason::Sessionning => "sessionning",
            ReclaimReason::Blocked => "blocked",
            ReclaimReason::UncommittedChanges => "uncommitted_changes",
            ReclaimReason::ProjectUnreachable => "project_unreachable",
            ReclaimReason::DirectoryMissing => "directory_missing",
            ReclaimReason::StoryOpen => "story_open",
        }
    }
}

/// What the inventory says about one worktree. `Reclaimable` is the only variant plan 10-09 may act
/// on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReclaimDisposition {
    Reclaimable(ReclaimReason),
    InUse(ReclaimReason),
    Keep(ReclaimReason),
}

impl ReclaimDisposition {
    /// The chip word: `reclaimable`, `in_use` or `keep`.
    pub fn as_str(self) -> &'static str {
        match self {
            ReclaimDisposition::Reclaimable(_) => "reclaimable",
            ReclaimDisposition::InUse(_) => "in_use",
            ReclaimDisposition::Keep(_) => "keep",
        }
    }

    pub fn reason(self) -> ReclaimReason {
        match self {
            ReclaimDisposition::Reclaimable(r) | ReclaimDisposition::InUse(r) | ReclaimDisposition::Keep(r) => r,
        }
    }
}

/// THE definition of a reclaimable worktree: the inventory read and plan 10-09's reclaim both call
/// this, so the list and the action cannot disagree. Pure: plain values in, no connection, no git.
///
/// A worktree is reclaimable when its Story is closed (Merged or Dropped), AND no session is live
/// against it, AND its tree is clean. `live_run` is the status of a running or blocked session on
/// the Story, if any; `dirty` is whether `porcelain_entries` found anything.
///
/// Precedence, so exactly one reason is ever shown: project unreachable, then directory missing,
/// then a live session, then a dirty tree, then the closed Story's state. A worktree whose Story is
/// open is kept as `StoryOpen`.
pub fn reclaim_eligibility(
    story_state: &str,
    live_run: Option<&str>,
    dirty: bool,
    project_status: &str,
    directory_present: bool,
) -> ReclaimDisposition {
    if project_status == "unreachable" {
        return ReclaimDisposition::Keep(ReclaimReason::ProjectUnreachable);
    }
    if !directory_present {
        return ReclaimDisposition::Keep(ReclaimReason::DirectoryMissing);
    }
    if let Some(status) = live_run {
        let reason = if status == "blocked" { ReclaimReason::Blocked } else { ReclaimReason::Sessionning };
        return ReclaimDisposition::InUse(reason);
    }
    if dirty {
        return ReclaimDisposition::Keep(ReclaimReason::UncommittedChanges);
    }
    match story_state {
        "merged" => ReclaimDisposition::Reclaimable(ReclaimReason::Merged),
        "dropped" => ReclaimDisposition::Reclaimable(ReclaimReason::Dropped),
        _ => ReclaimDisposition::Keep(ReclaimReason::StoryOpen),
    }
}

/// The most entries one [`worktree_size`] walk examines before it stops and says so.
pub const WORKTREE_WALK_MAX_ENTRIES: usize = 2_000_000;
/// The deepest directory nesting one walk descends into.
pub const WORKTREE_WALK_MAX_DEPTH: usize = 64;

/// A measured size. `bounded` means the walk hit a bound or could not read part of the tree, so
/// `bytes` is a lower bound and must not be presented as the size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WalkSize {
    pub bytes: u64,
    pub bounded: bool,
}

/// The allocated size of everything under `path` (D-177): blocks times 512, not apparent length,
/// because that is what a reclaim actually frees.
///
/// Never follows a symlink: every entry is read with `symlink_metadata`, so a link counts as the
/// link itself and a loop or a link out of the tree contributes nothing from outside. Refuses any
/// path not under [`worktree_root`] (or carrying a `..`) before reading anything. Bounded by
/// [`WORKTREE_WALK_MAX_ENTRIES`] and [`WORKTREE_WALK_MAX_DEPTH`].
///
/// Known ceiling (Pitfall 8, accepted): a file hard-linked several times inside the tree is counted
/// once per link, so the figure can overstate; solving it needs an inode set that grows with the
/// tree. `st_blocks` is in 512-byte units on every unix this app targets.
pub fn worktree_size(path: &Path) -> anyhow::Result<WalkSize> {
    worktree_size_limited(path, WORKTREE_WALK_MAX_ENTRIES, WORKTREE_WALK_MAX_DEPTH)
}

/// [`worktree_size`] with its two bounds as arguments, so a test can hit them without building two
/// million files. Production code calls [`worktree_size`].
pub fn worktree_size_limited(path: &Path, max_entries: usize, max_depth: usize) -> anyhow::Result<WalkSize> {
    use std::os::unix::fs::MetadataExt;

    let root = worktree_root();
    if !path.starts_with(&root) || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        anyhow::bail!("refusing to measure {path:?}: it is not under the worktree root {root:?}");
    }

    let top = std::fs::symlink_metadata(path).with_context(|| format!("failed to read {path:?}"))?;
    let mut bytes = top.blocks() * 512;
    let mut bounded = false;
    let mut entries = 0usize;
    let mut pending: Vec<(PathBuf, usize)> = Vec::new();
    if top.is_dir() {
        pending.push((path.to_path_buf(), 0));
    }

    'walk: while let Some((dir, depth)) = pending.pop() {
        let Ok(listing) = std::fs::read_dir(&dir) else {
            bounded = true;
            continue;
        };
        for entry in listing {
            entries += 1;
            if entries > max_entries {
                bounded = true;
                break 'walk;
            }
            let Ok(entry) = entry else {
                bounded = true;
                continue;
            };
            let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
                bounded = true;
                continue;
            };
            bytes += meta.blocks() * 512;
            if meta.is_dir() {
                if depth + 1 > max_depth {
                    bounded = true;
                } else {
                    pending.push((entry.path(), depth + 1));
                }
            }
        }
    }
    Ok(WalkSize { bytes, bounded })
}

// ---------------------------------------------------------------------------------------------
// The batch reclaim (Phase 10 plan 10-09, WORK-07, D-179).
// ---------------------------------------------------------------------------------------------

/// What happened to one selected worktree. `removed` is the only claim of success; a refusal names
/// its basis in `reason` (an eligibility refusal) or `error` (the removal itself failed, a timeout
/// at the subprocess ceiling included), and a worktree that was removed carries the reason it was
/// reclaimable. `error` is `None` unless the removal or the lookup failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReclaimOutcome {
    pub story_id: String,
    pub removed: bool,
    pub reason: Option<ReclaimReason>,
    pub error: Option<String>,
}

/// Reclaim the named Stories' worktrees, one outcome per distinct id, in submitted order.
///
/// Per row, the disposition is re-derived NOW -- from the board and from git, through
/// [`crate::query::fleet::finish_worktree_inventory`], which applies [`reclaim_eligibility`], the
/// same function the inventory list uses -- so a selection that went stale between the list and this
/// call (an agent started in the worktree, the tree was edited) is refused, not obeyed. Only a
/// `Reclaimable` row reaches [`remove_worktree_for_story_refusing_live_run`], which is the unchanged
/// removal plus a live-run re-check made right before `git worktree remove`: its own
/// `git status --porcelain` re-read stays the final guard, and **no parameter exists here or there
/// that could skip it**. Do not add a `force` flag.
///
/// One refusal never fails the batch: every failure is recorded as that row's outcome and the loop
/// goes on, which is why this returns a vector and not a `Result`.
///
/// This holds no lock of its own, but `remove_worktree_for_story` runs `git worktree remove` on
/// whatever `conn` it is given, so the caller must pass a connection that is NOT behind the
/// application's shared mutex.
pub fn reclaim_worktrees(conn: &mut Connection, story_ids: &[String], actor_id: &str) -> Vec<ReclaimOutcome> {
    let mut seen = std::collections::HashSet::new();
    let mut outcomes = Vec::new();
    for story_id in story_ids {
        if !seen.insert(story_id.as_str()) {
            continue;
        }
        let failed = |error: String| ReclaimOutcome {
            story_id: story_id.clone(),
            removed: false,
            reason: None,
            error: Some(error),
        };
        let input = match crate::query::fleet::worktree_inventory_input_for_story(conn, story_id) {
            Ok(Some(input)) => input,
            Ok(None) => {
                outcomes.push(failed(format!("no worktree exists for Story {story_id:?}")));
                continue;
            }
            Err(e) => {
                outcomes.push(failed(format!("{e:#}")));
                continue;
            }
        };
        let disposition = match crate::query::fleet::finish_worktree_inventory(vec![input]).pop() {
            Some(row) => row.disposition,
            None => {
                outcomes.push(failed("the worktree could not be evaluated".to_string()));
                continue;
            }
        };
        let ReclaimDisposition::Reclaimable(reason) = disposition else {
            outcomes.push(ReclaimOutcome {
                story_id: story_id.clone(),
                removed: false,
                reason: Some(disposition.reason()),
                error: None,
            });
            continue;
        };
        outcomes.push(match remove_worktree_for_story_refusing_live_run(conn, story_id, actor_id) {
            Ok(()) => ReclaimOutcome { story_id: story_id.clone(), removed: true, reason: Some(reason), error: None },
            Err(e) => failed(format!("{e:#}")),
        });
    }
    outcomes
}
