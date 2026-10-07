//! `assemble_request_draft` (D-118, LINK-05, phase 07 plan 07-09): the board item becomes the
//! pull/merge request description. A pure query over board state, no model call and no
//! mutation — the same discipline `context_packet.rs`'s own CTX-04 contract states for exactly
//! the same reason: **the body the user previews must be byte-identical to the body that is
//! sent**. That equality is what makes the privacy prohibition (T-07-09-01) structural rather
//! than a promise — `assemble_request_draft` is the ONE function that produces a draft, called
//! identically by the read-only preview command and by `create_request`, which re-assembles
//! rather than accepting a title or a body from its caller.

use std::path::PathBuf;

use anyhow::Context;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::branch::epic_integration_branch_name;
use crate::domain::session_summary::{list_summaries_for_task, SessionSummary};

/// One request draft — the title and body a human previews before Flywheel opens a request on
/// the forge, plus the head and target branches [`crate::forge::create_request`] needs to open
/// it. `Serialize` so it crosses the Tauri IPC boundary as the preview command's own DTO shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RequestDraft {
    pub title: String,
    pub body: String,
    pub head_branch: String,
    pub target_branch: String,
}

impl RequestDraft {
    /// SHA-256 of the text a human reads, as 64 lowercase hex characters (G-08-5, WR-08). The epic
    /// request preview carries this value and the confirm command refuses when the draft it
    /// re-assembles hashes differently, so the text that is published is the text that was shown.
    ///
    /// The digest is over `title`, one newline byte, then `body`. The separator is what makes the
    /// pair unambiguous: a draft whose title gained a character while its body lost the same one
    /// hashes differently. The branches are deliberately NOT in the digest — the guard's subject is
    /// the text the user read. This is a change detector, not an authentication tag: the value
    /// round-trips through the renderer as an opaque string and the renderer never computes it.
    pub fn content_hash(&self) -> String {
        use sha2::{Digest, Sha256};
        use std::fmt::Write;

        let mut hasher = Sha256::new();
        hasher.update(self.title.as_bytes());
        hasher.update(b"\n");
        hasher.update(self.body.as_bytes());
        hasher.finalize().iter().fold(String::with_capacity(64), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
    }
}

// Current-revision criteria only — this file's own load-bearing filter, the same discipline
// `context_packet.rs`'s own `CRITERIA_SQL` states for the identical reason (D-79's "a draft
// never reads a superseded statement"), extended here to also carry `checked`, which the context
// packet's own agent-facing read has no reason to need.
const CRITERIA_SQL: &str = "SELECT statement, verification_hint, checked FROM acceptance_criteria \
    WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL \
    ORDER BY rank ASC, id ASC";

/// Assemble the deterministic request draft for `task_id` (D-118). Takes `&Connection`, not
/// `&mut Connection` — the signature itself proves this function writes nothing. Two calls
/// against an unchanged database return byte-identical drafts (CTX-04): nothing here reads the
/// clock, randomness, or any input other than the database and `task_id`.
///
/// Returns `Err` naming the task when it has no `worktrees` row — a draft must never carry an
/// empty head branch, because an empty head branch is not a value `gh pr create`/`glab mr create`
/// can be sent at all.
pub fn assemble_request_draft(conn: &Connection, task_id: &str) -> anyhow::Result<RequestDraft> {
    let (project_id, epic_id, task_key, task_title): (String, Option<String>, String, String) =
        conn.query_row(
            "SELECT project_id, epic_id, key, title FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let head_branch: String = conn
        .query_row(
            "SELECT branch FROM worktrees WHERE task_id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .with_context(|| {
            format!("task {task_id:?} has no worktree — a request draft needs a head branch to open from")
        })?;

    // D-25/D-26: the same derivation `git_facts.rs` uses for its ahead/behind target, minus the
    // `origin/` prefix that comparison target carries — a base ref passed to `gh pr create
    // --base`/`glab mr create --target-branch` must never carry one.
    let target_branch = match epic_id {
        Some(epic_id) => {
            let (epic_key, epic_title): (String, String) = conn
                .query_row(
                    "SELECT key, title FROM epics WHERE id = ?1",
                    params![epic_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .with_context(|| format!("epic {epic_id:?} not found"))?;
            epic_integration_branch_name(&epic_key, &epic_title)
        }
        None => conn
            .query_row(
                "SELECT default_branch FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .with_context(|| format!("project {project_id:?} not found"))?,
    };

    let mut criteria_stmt = conn.prepare(CRITERIA_SQL)?;
    let criteria: Vec<(String, Option<String>, bool)> = criteria_stmt
        .query_map(params![task_id], |row| {
            let checked_int: i64 = row.get(2)?;
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, checked_int != 0))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the task's acceptance criteria")?;
    drop(criteria_stmt);

    let summaries = list_summaries_for_task(conn, task_id)
        .context("failed to read the task's session summaries")?;

    let body = render_body(&task_key, &task_title, &criteria, &summaries);

    Ok(RequestDraft { title: task_title, body, head_branch, target_branch })
}

// `assemble_epic_request_draft`'s criteria read is the epic-scoped sibling of `CRITERIA_SQL`: same
// current-revision filter, same `checked` column, left-joined to the anchor table so evidence is
// summarised when it exists and absent when it does not (D-140 — no anchor row IS no evidence).

// One row per task of the epic, with its current-revision criteria counted as checked-of-total.
const EPIC_TASKS_SQL: &str = "SELECT t.id, t.key, t.title, t.status, \
    (SELECT COUNT(*) FROM acceptance_criteria c WHERE c.parent_type = 'task' AND c.parent_id = t.id \
        AND c.superseded_at IS NULL AND c.checked = 1), \
    (SELECT COUNT(*) FROM acceptance_criteria c WHERE c.parent_type = 'task' AND c.parent_id = t.id \
        AND c.superseded_at IS NULL) \
    FROM tasks t WHERE t.epic_id = ?1 ORDER BY t.rank ASC, t.id ASC";

struct EpicCriterionRow {
    statement: String,
    hint: Option<String>,
    checked: bool,
    anchor: Option<(String, String, i64, i64)>,
}

struct EpicTaskRow {
    key: String,
    title: String,
    status: String,
    checked: i64,
    total: i64,
    integrated: bool,
}

/// One task of the epic as the board reads it, plus the merge commit its integrated event
/// recorded. Whether that commit is still reachable is a git fact and waits for the git half.
struct EpicTaskInput {
    key: String,
    title: String,
    status: String,
    checked: i64,
    total: i64,
    merge_commit: Option<String>,
}

/// What the board said about an epic's request draft, before any git runs. Private fields: an
/// opaque hand-off from [`epic_draft_inputs`] to [`finish_epic_request_draft`], so a caller cannot
/// substitute a branch, path or commit between the two halves, and the git half re-reads nothing.
pub struct EpicDraftInputs {
    epic_key: String,
    epic_title: String,
    description: Option<String>,
    head_branch: String,
    target_branch: String,
    repo_path: PathBuf,
    criteria: Vec<EpicCriterionRow>,
    tasks: Vec<EpicTaskInput>,
}

// Current revision only, left-joined to the anchor table (D-140).
const EPIC_CRITERIA_SQL: &str = "SELECT c.statement, c.verification_hint, c.checked, \
    a.path, a.side, a.line_start, a.line_end \
    FROM acceptance_criteria c LEFT JOIN criterion_anchors a ON a.criterion_id = c.id \
    WHERE c.parent_type = 'epic' AND c.parent_id = ?1 AND c.superseded_at IS NULL \
    ORDER BY c.rank ASC, c.id ASC";

/// The database half of [`assemble_epic_request_draft`]: every board read, no git. An epic with no
/// integration branch is a named error, never a trigger to cut one. Safe under the database lock;
/// hand the result to [`finish_epic_request_draft`] once the lock is released.
pub fn epic_draft_inputs(conn: &Connection, epic_id: &str) -> anyhow::Result<EpicDraftInputs> {
    let (project_id, epic_key, epic_title, description, integration_branch): (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT project_id, key, title, description, integration_branch FROM epics WHERE id = ?1",
            params![epic_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .with_context(|| format!("epic {epic_id:?} not found"))?;

    let Some(head_branch) = integration_branch else {
        anyhow::bail!(
            "{epic_key} has no integration branch yet — nothing has been merged into it, so there is nothing to propose"
        );
    };

    let (repo_path, target_branch): (String, String) = conn
        .query_row(
            "SELECT repo_path, default_branch FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    let mut criteria_stmt = conn.prepare(EPIC_CRITERIA_SQL)?;
    let criteria: Vec<EpicCriterionRow> = criteria_stmt
        .query_map(params![epic_id], |row| {
            let checked_int: i64 = row.get(2)?;
            let path: Option<String> = row.get(3)?;
            let anchor = match path {
                Some(path) => Some((path, row.get::<_, String>(4)?, row.get::<_, i64>(5)?, row.get::<_, i64>(6)?)),
                None => None,
            };
            Ok(EpicCriterionRow {
                statement: row.get(0)?,
                hint: row.get(1)?,
                checked: checked_int != 0,
                anchor,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the epic's acceptance criteria")?;
    drop(criteria_stmt);

    let mut tasks_stmt = conn.prepare(EPIC_TASKS_SQL)?;
    let raw_tasks: Vec<(String, String, String, String, i64, i64)> = tasks_stmt
        .query_map(params![epic_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the epic's tasks")?;
    drop(tasks_stmt);

    let mut tasks = Vec::with_capacity(raw_tasks.len());
    for (task_id, key, title, status, checked, total) in raw_tasks {
        let merge_commit = crate::merge::integrated_merge_commit(conn, &task_id)?;
        tasks.push(EpicTaskInput { key, title, status, checked, total, merge_commit });
    }

    Ok(EpicDraftInputs {
        epic_key,
        epic_title,
        description,
        head_branch,
        target_branch,
        repo_path: PathBuf::from(repo_path),
        criteria,
        tasks,
    })
}

/// The git half of [`assemble_epic_request_draft`]: one ancestry check per task that has a recorded
/// merge commit, then the deterministic body. Takes no connection, so a caller can read the inputs
/// under the database lock, release it, then call this. The body bytes depend only on the inputs
/// and those ancestry answers.
pub fn finish_epic_request_draft(inputs: EpicDraftInputs) -> anyhow::Result<RequestDraft> {
    let EpicDraftInputs { epic_key, epic_title, description, head_branch, target_branch, repo_path, criteria, tasks } =
        inputs;

    let mut rows = Vec::with_capacity(tasks.len());
    for t in tasks {
        let integrated = match &t.merge_commit {
            Some(commit) => crate::merge::merge_commit_is_reachable(&repo_path, commit, &head_branch)?,
            None => false,
        };
        rows.push(EpicTaskRow { key: t.key, title: t.title, status: t.status, checked: t.checked, total: t.total, integrated });
    }

    let body = render_epic_body(&epic_key, &epic_title, description.as_deref(), &criteria, &rows);

    Ok(RequestDraft { title: epic_title, body, head_branch, target_branch })
}

/// Assemble the deterministic request draft for `epic_id` (REVW-05): the epic's integration branch
/// as the head, the project's default branch as the target. The structural sibling of
/// [`assemble_request_draft`], and pure and clockless for the same reason: the renderer passes an
/// epic id and never a title or a body, so the text previewed before sending and the text
/// published are the same text by construction, not by coincidence. It writes nothing — in
/// particular an epic with no integration branch is a named error, never a trigger to cut one.
///
/// The one non-database input is the integrated marker per task
/// ([`crate::merge::merge_commit_is_reachable`]), a read-only git ancestry check; two calls over an
/// unchanged database and repository agree. For core-internal and test use: this takes a
/// connection AND spawns git, so a command handler must call [`epic_draft_inputs`] and
/// [`finish_epic_request_draft`] itself, with the database lock released between them.
pub fn assemble_epic_request_draft(conn: &Connection, epic_id: &str) -> anyhow::Result<RequestDraft> {
    finish_epic_request_draft(epic_draft_inputs(conn, epic_id)?)
}

/// Fixed order: key and title, description (omitted when empty), criteria (omitted when none),
/// then the task roll-up (omitted when the epic has no tasks).
fn render_epic_body(
    epic_key: &str,
    epic_title: &str,
    description: Option<&str>,
    criteria: &[EpicCriterionRow],
    tasks: &[EpicTaskRow],
) -> String {
    let mut out = String::new();
    out.push_str(epic_key);
    out.push_str(": ");
    out.push_str(epic_title);
    out.push('\n');

    if let Some(description) = description.map(str::trim).filter(|d| !d.is_empty()) {
        out.push('\n');
        out.push_str(description);
        out.push('\n');
    }

    if !criteria.is_empty() {
        out.push_str("\n## Acceptance Criteria\n\n");
        for c in criteria {
            out.push_str(if c.checked { "- [x] " } else { "- [ ] " });
            out.push_str(&c.statement);
            if let Some(hint) = &c.hint {
                out.push_str(" (Verify: ");
                out.push_str(hint);
                out.push(')');
            }
            if let Some((path, side, start, end)) = &c.anchor {
                out.push_str(" — evidence: ");
                out.push_str(path);
                if start == end {
                    out.push_str(&format!(":{start}"));
                } else {
                    out.push_str(&format!(":{start}-{end}"));
                }
                if side == "old" {
                    out.push_str(" (before)");
                }
            }
            out.push('\n');
        }
    }

    if !tasks.is_empty() {
        out.push_str("\n## Tasks\n\n");
        for t in tasks {
            out.push_str(&format!(
                "- {}: {} — {} — {}/{} criteria checked — {}\n",
                t.key,
                t.title,
                t.status,
                t.checked,
                t.total,
                if t.integrated { "integrated" } else { "not integrated" }
            ));
        }
    }

    out
}

/// Render the body's three labelled sections (D-118's body-shape decision): the task key with a
/// one-line statement of the task, the current-revision criteria checklist (real `checked`
/// state, never presenting an unmet criterion as met), and the session summaries in chronological
/// order (the read order [`list_summaries_for_task`] already returns). A section with no rows is
/// **omitted entirely** — `context_packet.rs`'s own absence discipline, applied here for the same
/// reason. No diff, no commit list: the forge renders both itself.
fn render_body(
    task_key: &str,
    task_title: &str,
    criteria: &[(String, Option<String>, bool)],
    summaries: &[SessionSummary],
) -> String {
    let mut out = String::new();

    out.push_str(task_key);
    out.push_str(": ");
    out.push_str(task_title);
    out.push('\n');

    if !criteria.is_empty() {
        out.push_str("\n## Acceptance Criteria\n\n");
        for (statement, hint, checked) in criteria {
            out.push_str(if *checked { "- [x] " } else { "- [ ] " });
            out.push_str(statement);
            if let Some(hint) = hint {
                out.push_str(" (Verify: ");
                out.push_str(hint);
                out.push(')');
            }
            out.push('\n');
        }
    }

    if !summaries.is_empty() {
        out.push_str("\n## Session Summaries\n\n");
        for (i, summary) in summaries.iter().enumerate() {
            out.push_str("### Session ");
            out.push_str(&(i + 1).to_string());
            out.push('\n');
            if let Some(prose) = &summary.changed_prose {
                out.push_str(prose);
                out.push('\n');
            }
            if let Some(remains) = &summary.remains {
                out.push_str("Remains: ");
                out.push_str(remains);
                out.push('\n');
            }
            if let Some(next) = &summary.next_session_must_know {
                out.push_str("Next session must know: ");
                out.push_str(next);
                out.push('\n');
            }
            out.push('\n');
        }
    }

    out
}
