//! `assemble_request_draft` (D-118, LINK-05, phase 07 plan 07-09): the board item becomes the
//! pull/merge request description. A pure query over board state, no model call and no
//! mutation — the same discipline `context_packet.rs`'s own CTX-04 contract states for exactly
//! the same reason: **the body the user previews must be byte-identical to the body that is
//! sent**. That equality is what makes the privacy prohibition (T-07-09-01) structural rather
//! than a promise — `assemble_request_draft` is the ONE function that produces a draft, called
//! identically by the read-only preview command and by `create_request`, which re-assembles
//! rather than accepting a title or a body from its caller.

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
