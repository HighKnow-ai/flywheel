//! A task's git truth, read fresh on every call (Phase 7 plan 07-01, LINK-02/LINK-09, D-75/D-128).
//!
//! This module stores nothing and caches no verdict: every figure it returns — branch, commit
//! window, ahead/behind, uncommitted changes, fetch age — is re-derived from git on every call,
//! following `drift.rs`'s own "derive at read time" discipline. The one exception that proves the
//! rule is `last_fetch_at`, which does not cache anything either — it reads `FETCH_HEAD`'s own
//! mtime, a fact git itself already persists, rather than Flywheel storing a derived timestamp of
//! its own.
//!
//! Every git read in this module routes through `crate::git::git_at` (or one of `git.rs`'s other
//! public wrappers) — never a second `Command::new("git")` construction site. This module is sync
//! throughout; the tokio runtime and the scheduler that calls it on an interval both live in the
//! desktop crate (`packages/desktop/src-tauri/src/scheduler.rs`), not here.

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::branch::epic_integration_branch_name;
use crate::domain::event::{append_event, next_sequence};
use crate::domain::worktree::PorcelainEntry;
use crate::git;

/// D-114's hot-tier interval: about as long as a person will stare at a card before re-reading
/// it.
pub const HOT_TICK_SECS: u64 = 5;

/// D-114's cold-tier interval: D-114's own stated ceiling — a cold task is permitted to be up to
/// a minute stale.
pub const COLD_TICK_SECS: u64 = 60;

/// D-116's fetch cadence: the slowest cadence at which "behind" is still useful inside one
/// working session.
pub const FETCH_INTERVAL_SECS: u64 = 300;

/// The commit-list window rendered on an item (Claude's Discretion, 07-CONTEXT.md): a plain
/// "+N earlier commits" count line tells the whole truth and is less code than paging a list the
/// user can read in full in git.
pub const COMMIT_WINDOW: usize = 20;

/// One row of a task's commit window — newest-first, in `git log`'s own emitted order (LINK-02
/// ordering).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommitRow {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub committed_at: String,
    /// LINK-10/D-129: whether no recorded `agent_runs` window for this task covers
    /// `committed_at`. This is computed from agent-run coverage — **never** from commit-trailer
    /// presence or absence. Plan 07-02's `commit-msg` hook stamps `Flywheel-Task`/`Flywheel-Run`
    /// trailers onto *every* commit on a `flywheel/`-namespaced branch, agent-made or hand-typed
    /// alike, so a trailer check would detect nothing here (D-129, forced by D-126).
    pub made_outside_flywheel: bool,
}

/// D-129's coverage predicate, read once per task (not once per commit): every `agent_runs`
/// window for `task_id`. A literal `&str` — no `format!`, no runtime SQL assembly — matching this
/// crate's `T-01-01`/`T-01-23` discipline.
pub const AGENT_RUN_COVERAGE_SQL: &str =
    "SELECT started_at, ended_at FROM agent_runs WHERE task_id = ?1";

/// D-115's event type: a commit on a task's branch that landed outside any recorded `agent_runs`
/// window. Its payload carries a `label`, so `domain::event::render_description` renders it in
/// the activity trail verbatim — no change to `ActivityTrail.tsx` is needed.
pub const EVENT_OUTSIDE_COMMIT: &str = "task.outside_commit_detected";

/// Read every `agent_runs` window for `task_id` once (D-129's coverage predicate), as
/// `(started_at, ended_at)` RFC3339-string pairs.
fn agent_run_windows(conn: &Connection, task_id: &str) -> anyhow::Result<Vec<(String, Option<String>)>> {
    let mut stmt = conn.prepare(AGENT_RUN_COVERAGE_SQL)?;
    let rows = stmt
        .query_map(params![task_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read agent run windows")?;
    Ok(rows)
}

/// Whether `committed_at` falls inside any of `windows` — inclusive on both ends (a commit
/// timestamped exactly at a run's `started_at` or `ended_at` is covered, since git's committer
/// timestamps have one-second resolution and an exclusive bound would falsely accuse a genuine
/// agent commit on an exact-second collision). A `None` `ended_at` is a still-live run — its
/// right edge is open, extending to "now" (any commit at or after `started_at` is covered).
/// Timestamps are parsed as RFC3339 instants (not compared as raw strings) so a commit's own
/// timezone offset (`git log --format=%cI`) compares correctly against a `agent_runs` row's UTC
/// timestamp regardless of offset.
fn is_covered_by_agent_run(committed_at: &str, windows: &[(String, Option<String>)]) -> bool {
    let Ok(committed) = chrono::DateTime::parse_from_rfc3339(committed_at) else {
        return false;
    };
    windows.iter().any(|(started_at, ended_at)| {
        let Ok(started) = chrono::DateTime::parse_from_rfc3339(started_at) else {
            return false;
        };
        if committed < started {
            return false;
        }
        match ended_at {
            None => true,
            Some(ended_at) => match chrono::DateTime::parse_from_rfc3339(ended_at) {
                Ok(ended) => committed <= ended,
                Err(_) => false,
            },
        }
    })
}

/// A task's full git truth as of the moment this was read (LINK-02, LINK-09): branch, commit
/// window, ahead/behind against its integration target (or a withheld figure, D-116), fetch age,
/// and uncommitted changes.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GitFacts {
    pub branch: String,
    pub worktree_path: String,
    pub target_ref: String,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub last_fetch_at: Option<String>,
    pub commits: Vec<CommitRow>,
    pub commits_truncated: usize,
    pub uncommitted: Vec<PorcelainEntry>,
}

/// A task tracked by a scheduler tick (Task 2, D-113/D-114) — just enough to call
/// [`git_facts_for_task`] and know which project to fetch for.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackedWorktree {
    pub task_id: String,
    pub project_id: String,
    pub worktree_path: String,
}

/// A task's full git truth (LINK-02, LINK-09), or `Ok(None)` when the task has no `worktrees` row
/// at all. Never errors on "nothing ahead" or "target not fetched locally" — those are honest
/// empty/withheld values, not failures.
///
/// `target_ref` is derived, never stored or caller-supplied (D-25/D-26, D-116): `origin/` plus
/// `branch::epic_integration_branch_name` when the task has an epic, otherwise `origin/` plus the
/// project's `default_branch`.
pub fn git_facts_for_task(conn: &Connection, task_id: &str) -> anyhow::Result<Option<GitFacts>> {
    let worktree_row: Option<(String, String)> = conn
        .query_row(
            "SELECT path, branch FROM worktrees WHERE task_id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("failed to look up the worktree for this task")?;

    let Some((worktree_path_str, branch)) = worktree_row else {
        return Ok(None);
    };
    let worktree_path = Path::new(&worktree_path_str);

    let (project_id, epic_id): (String, Option<String>) = conn
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let target_ref = match epic_id {
        Some(epic_id) => {
            let (epic_key, epic_title): (String, String) = conn
                .query_row(
                    "SELECT key, title FROM epics WHERE id = ?1",
                    params![epic_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .with_context(|| format!("epic {epic_id:?} not found"))?;
            format!("origin/{}", epic_integration_branch_name(&epic_key, &epic_title))
        }
        None => {
            let default_branch: String = conn
                .query_row(
                    "SELECT default_branch FROM projects WHERE id = ?1",
                    params![project_id],
                    |row| row.get(0),
                )
                .with_context(|| format!("project {project_id:?} not found"))?;
            format!("origin/{default_branch}")
        }
    };

    let target_resolves = git::rev_parse_verify(worktree_path, &target_ref)?;
    let commit_range =
        if target_resolves { format!("{target_ref}..HEAD") } else { "HEAD".to_string() };
    let max_count = (COMMIT_WINDOW + 1).to_string();
    let log_output = git::git_at(
        worktree_path,
        &["log", "--max-count", &max_count, "--format=%H%x1f%h%x1f%s%x1f%cI", &commit_range],
    )?;
    let log_text = String::from_utf8_lossy(&log_output.stdout).into_owned();
    let mut commits: Vec<CommitRow> = log_text
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let mut fields = line.splitn(4, '\u{1f}');
            Some(CommitRow {
                sha: fields.next()?.to_string(),
                short_sha: fields.next()?.to_string(),
                subject: fields.next()?.to_string(),
                committed_at: fields.next()?.to_string(),
                made_outside_flywheel: false,
            })
        })
        .collect();

    let run_windows = agent_run_windows(conn, task_id)?;
    for commit in &mut commits {
        commit.made_outside_flywheel = !is_covered_by_agent_run(&commit.committed_at, &run_windows);
    }

    let commits_truncated = commits.len().saturating_sub(COMMIT_WINDOW);
    commits.truncate(COMMIT_WINDOW);

    let uncommitted = crate::domain::worktree::porcelain_entries(worktree_path)?;

    let (ahead, behind) = match git::ahead_behind(worktree_path, &target_ref, &branch)? {
        Some((a, b)) => (Some(a), Some(b)),
        None => (None, None),
    };
    let last_fetch_at = git::last_fetch_at(worktree_path)?;

    Ok(Some(GitFacts {
        branch,
        worktree_path: worktree_path_str,
        target_ref,
        ahead,
        behind,
        last_fetch_at,
        commits,
        commits_truncated,
        uncommitted,
    }))
}

/// Every `worktrees` row currently `status = 'active'` (D-113/D-114's scheduler tick candidate
/// set). When `hot_only` is true, restricts to rows whose task has an `agent_runs` row in status
/// `running` or `blocked` — D-114's "live agent session" half of the hot tier; the "open detail
/// panel" half is supplied by the caller (`AppState.focused_task`, Task 2).
pub fn tracked_worktrees(conn: &Connection, hot_only: bool) -> anyhow::Result<Vec<TrackedWorktree>> {
    let sql = if hot_only {
        "SELECT w.task_id, w.project_id, w.path \
         FROM worktrees w \
         WHERE w.status = 'active' \
         AND EXISTS ( \
             SELECT 1 FROM agent_runs ar \
             WHERE ar.task_id = w.task_id AND ar.status IN ('running', 'blocked') \
         )"
    } else {
        "SELECT task_id, project_id, path FROM worktrees WHERE status = 'active'"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TrackedWorktree {
                task_id: row.get(0)?,
                project_id: row.get(1)?,
                worktree_path: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to read tracked worktrees")?;
    Ok(rows)
}

/// Fetch `origin` for `project_id`'s repository (D-116) — delegates to [`git::fetch_origin`]'s
/// own "no remote configured" skip.
pub fn fetch_origin_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<bool> {
    let repo_path: String = conn
        .query_row("SELECT repo_path FROM projects WHERE id = ?1", params![project_id], |row| {
            row.get(0)
        })
        .with_context(|| format!("project {project_id:?} not found"))?;
    git::fetch_origin(Path::new(&repo_path))
}

/// D-115: for each commit in `task_id`'s rendered commit window (the exact `COMMIT_WINDOW`-capped
/// list [`git_facts_for_task`] already reads — no extra git invocation, no unbounded history
/// walk) not covered by any recorded `agent_runs` window (D-129), appends exactly one `events`
/// row the first time it is noticed. Idempotency is a query, not a stored flag (D-75): before
/// appending, this checks for an existing `events` row with [`EVENT_OUTSIDE_COMMIT`], this
/// `task_id`, and this sha extracted from the stored payload — the append-only log is itself the
/// record of what has already been noticed. Returns the number of rows it appended; `Ok(0)` for a
/// task with no worktree.
///
/// Writes nothing but `events` rows: this function issues no `UPDATE tasks`, no `UPDATE epics`
/// and calls no status writer (`set_task_status` or otherwise) — D-115's two rejected
/// alternatives (a persistent board-card indicator, an acknowledgement requirement) are not
/// reachable from here, because there is no second write path for them to attach to.
pub fn record_outside_commits(conn: &mut Connection, task_id: &str, actor_id: &str) -> anyhow::Result<usize> {
    let Some(facts) = git_facts_for_task(conn, task_id)? else {
        return Ok(0);
    };

    let (project_id, epic_id): (String, Option<String>) = conn
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let mut appended = 0usize;
    for commit in facts.commits.iter().filter(|c| c.made_outside_flywheel) {
        let tx = conn.transaction()?;

        let already_noticed: Option<i64> = tx
            .query_row(
                "SELECT 1 FROM events WHERE task_id = ?1 AND event_type = ?2 \
                 AND json_extract(payload, '$.sha') = ?3 LIMIT 1",
                params![task_id, EVENT_OUTSIDE_COMMIT, commit.sha],
                |row| row.get(0),
            )
            .optional()
            .context("failed to check for an existing outside-commit event")?;

        if already_noticed.is_some() {
            tx.commit().context("failed to commit no-op record_outside_commits transaction")?;
            continue;
        }

        let sequence = next_sequence(&tx, &project_id, "local")?;
        let payload = serde_json::json!({
            "sha": commit.sha,
            "short_sha": commit.short_sha,
            "branch": facts.branch,
            "committed_at": commit.committed_at,
            "label": format!(
                "Commit {} on {} was made outside Flywheel",
                commit.short_sha, facts.branch
            ),
        });
        append_event(
            &tx,
            &project_id,
            "local",
            sequence,
            "task",
            task_id,
            Some(task_id),
            epic_id.as_deref(),
            actor_id,
            EVENT_OUTSIDE_COMMIT,
            &payload,
            &commit.committed_at,
        )?;

        tx.commit().context("failed to commit record_outside_commits transaction")?;
        appended += 1;
    }

    Ok(appended)
}
