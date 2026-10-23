//! The roster's one read (docs/mvp-spec.md §7 "Roster", issue #159): per Story of a Milestone, what
//! its row draws besides the Story itself. The renderer draws these figures and issues no read of
//! its own per row.
//!
//! One literal statement, [`ROSTER_ROWS_SQL`], walking indexes only (`idx_epics_milestone_rank`,
//! `idx_stories_epic_rank`, `idx_sessions_story_started`, `idx_permission_requests_session_status`,
//! `idx_tasks_story_rank`, `idx_tasks_one_doing_per_story`, `idx_acceptance_criteria_story_rank`,
//! `idx_check_runs_check_started`, `idx_reviews_story_opened`, `idx_reviews_one_open_per_story`):
//!
//! - **Attention** as the Milestone header counts it (`query::progress`): Stopped when a Running
//!   Story's latest session is dead (it never handed off), else Waiting on you when a live session of
//!   it holds a pending request. A Stopped row carries its session's ending reason; a row with a live
//!   session carries that session's id, which Answer and Open session open.
//! - **The *doing* Task's title**, at most one per Story by `idx_tasks_one_doing_per_story`.
//! - **criteria x/y**: x counts the criteria the Developer accepted, or whose Check's current result
//!   (its latest run since the Check's last edit, `domain::check::current_result`) passed and is not
//!   stale. Stale is judged against the head the Story last handed off, its latest review's
//!   `head_sha`, never against git: the roster reads no worktree (ADR 0012). With no review yet no
//!   head is known, and a result whose head can't be known is not stale (`CurrentResult::is_stale`). A
//!   run an accepted Amend criterion marked stale (`checks.stale_since`, ADR 0015) is stale too.
//! - **tasks x/y**: Tasks done out of every Task not Dropped. A Dropped Task is closed, not work.
//! - **The diff size** of the Story's open review, while it is In review.
//!
//! Rows come back Epic by Epic in Roadmap order, Stories in rank order, ties broken by id.

use anyhow::Context;
use rusqlite::{params, Connection};

/// The open review's diff: files changed, lines added and removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReviewDiffSize {
    pub files: i64,
    pub added: i64,
    pub removed: i64,
}

/// One Story row's figures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterRow {
    pub story_id: String,
    /// `stopped`, `waiting_on_you` or `None`.
    pub attention: Option<String>,
    /// Why a Stopped Story's session ended (`sessions.ending_reason`); `None` unless Stopped.
    pub ending_reason: Option<String>,
    /// The Story's live session, if one is running or blocked.
    pub live_session_id: Option<String>,
    pub doing_task_title: Option<String>,
    pub criteria_met: i64,
    pub criteria_total: i64,
    pub tasks_done: i64,
    pub tasks_total: i64,
    /// The open review's diff size, while the Story is In review.
    pub review: Option<ReviewDiffSize>,
}

pub const ROSTER_ROWS_SQL: &str = "SELECT s.id, \
        CASE WHEN s.state <> 'running' THEN NULL \
             WHEN latest.status NOT IN ('running', 'blocked') THEN 'stopped' \
             WHEN EXISTS (SELECT 1 FROM sessions r WHERE r.story_id = s.id AND r.status IN ('running', 'blocked') \
                AND EXISTS (SELECT 1 FROM permission_requests pr WHERE pr.session_id = r.id \
                    AND pr.status = 'pending' AND pr.expired_at IS NULL)) THEN 'waiting_on_you' \
        END, \
        CASE WHEN s.state = 'running' AND latest.status NOT IN ('running', 'blocked') THEN latest.ending_reason END, \
        (SELECT r.id FROM sessions r WHERE r.story_id = s.id AND r.status IN ('running', 'blocked') \
            ORDER BY r.started_at DESC, r.id DESC LIMIT 1), \
        (SELECT t.title FROM tasks t WHERE t.story_id = s.id AND t.state = 'doing'), \
        (SELECT COUNT(*) FROM acceptance_criteria c WHERE c.story_id = s.id AND (c.accepted_by IS NOT NULL \
            OR EXISTS (SELECT 1 FROM checks k \
                JOIN check_runs cr ON cr.id = (SELECT id FROM check_runs WHERE check_id = k.id \
                    AND started_at >= k.updated_at ORDER BY started_at DESC, id DESC LIMIT 1) \
                WHERE k.criterion_id = c.id AND cr.result = 'passed' \
                AND (handed_off.head_sha IS NULL OR cr.commit_sha = handed_off.head_sha) \
                AND (k.stale_since IS NULL OR cr.started_at >= k.stale_since)))), \
        (SELECT COUNT(*) FROM acceptance_criteria c WHERE c.story_id = s.id), \
        (SELECT COUNT(*) FROM tasks t WHERE t.story_id = s.id AND t.state = 'done'), \
        (SELECT COUNT(*) FROM tasks t WHERE t.story_id = s.id AND t.state <> 'dropped'), \
        open_review.files, open_review.added, open_review.removed \
     FROM epics e JOIN stories s ON s.epic_id = e.id \
     LEFT JOIN sessions latest ON latest.id = (SELECT id FROM sessions WHERE story_id = s.id \
        ORDER BY started_at DESC, id DESC LIMIT 1) \
     LEFT JOIN reviews handed_off ON handed_off.id = (SELECT id FROM reviews WHERE story_id = s.id \
        ORDER BY opened_at DESC, id DESC LIMIT 1) \
     LEFT JOIN reviews open_review ON open_review.story_id = s.id AND open_review.outcome IS NULL \
        AND s.state = 'in_review' \
     WHERE e.milestone_id = ?1 \
     ORDER BY e.rank, e.id, s.rank, s.id";

/// Every Story of `milestone_id` with its row's figures, in Roadmap order. One statement; an unknown
/// Milestone has no rows.
pub fn roster_rows(conn: &Connection, milestone_id: &str) -> anyhow::Result<Vec<RosterRow>> {
    let mut stmt = conn.prepare(ROSTER_ROWS_SQL)?;
    let rows = stmt
        .query_map(params![milestone_id], |row| {
            let files: Option<i64> = row.get(9)?;
            let review = match files {
                Some(files) => Some(ReviewDiffSize { files, added: row.get(10)?, removed: row.get(11)? }),
                None => None,
            };
            Ok(RosterRow {
                story_id: row.get(0)?,
                attention: row.get(1)?,
                ending_reason: row.get(2)?,
                live_session_id: row.get(3)?,
                doing_task_title: row.get(4)?,
                criteria_met: row.get(5)?,
                criteria_total: row.get(6)?,
                tasks_done: row.get(7)?,
                tasks_total: row.get(8)?,
                review,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the roster's rows")
}
