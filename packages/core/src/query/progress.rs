//! Project progress at a glance (docs/mvp-spec.md §7, Milestone header; issue #106): the Current
//! Milestone with its Story counts by state, its Epics done, and each of its Epics with the same
//! counts. The renderer draws these numbers and never counts anything itself.
//!
//! Two literal statements, both walking indexes only (`idx_milestones_project_rank`,
//! `idx_epics_milestone_rank`, `idx_stories_epic_rank`, `idx_sessions_story_started`,
//! `idx_permission_requests_session_status`):
//! - [`milestone_progress`] reads the whole header in ONE statement;
//! - [`epic_progress`] reads every Epic of a Milestone in ONE statement, grouped by Epic.
//!
//! **Attention partitions Running.** A Running Story is counted exactly once: as Stopped (its latest
//! session is dead and it never handed off, `query::sessions::stopped_session_for_story`), else as
//! Waiting on you (a live session holds a pending request, `query::permissions`), else as Running. So
//! the eight counts add up to every Story in the Milestone, and the bar can stack them.
//!
//! **An Epic in Shaping has attention of its own** (issue #124): Waiting on you while a live shaping
//! session is held on one of its open Rounds (`crate::query::round_waiting_on_you`), or a Shaping
//! Round waiting while a Round is open and no shaping session is live on it. Shown in place of the
//! Epic's state word, never counted among its Stories.
//!
//! **Dropped is shown, not stacked.** A Dropped Story "counts as closed for its Epic" (spec §2), which
//! is what lets an Epic's exit test be confirmed; it is not progress. `stories_total` is every Story
//! that is not Dropped, so "Stories merged / Stories" reads as merged out of the work that will ship,
//! and dropping a Story never makes the bar look further along. The Dropped count is returned on its
//! own so the header can name it.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};

/// A Milestone's or an Epic's Stories, counted by state with attention split out of Running.
/// `running` counts only the Running Stories that are neither Waiting on you nor Stopped.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StoryStateCounts {
    pub shaping: i64,
    pub ready: i64,
    pub running: i64,
    pub waiting_on_you: i64,
    pub stopped: i64,
    pub in_review: i64,
    pub merged: i64,
    pub dropped: i64,
    /// Every Story that is not Dropped: the denominator of "Stories merged / Stories".
    pub stories_total: i64,
}

/// The Milestone header's numbers, all from one statement.
#[derive(Debug, Clone, PartialEq)]
pub struct MilestoneProgress {
    pub milestone_id: String,
    pub title: String,
    pub exit_test: Option<String>,
    /// The state with In progress derived, as `domain::milestone::milestone_state` derives it.
    pub state: String,
    /// The Milestone after it on the Roadmap that is neither Done nor Dropped, if any.
    pub next_milestone_title: Option<String>,
    pub counts: StoryStateCounts,
    pub epics_done: i64,
    pub epics_total: i64,
}

/// One Epic's row of progress.
#[derive(Debug, Clone, PartialEq)]
pub struct EpicProgress {
    pub epic_id: String,
    pub key: String,
    pub title: String,
    /// The state with In progress derived, as `domain::epic::epic_state` derives it.
    pub state: String,
    pub counts: StoryStateCounts,
    /// `waiting_on_you` (a live shaping session is held on an open Round of it), `round_waiting` (a
    /// Round is open with no live shaping session on the Epic) or `None`.
    pub attention: Option<String>,
}

/// The `marks` CTE body: one row per Story with its stored state and its attention (`stopped`,
/// `waiting_on_you` or NULL), restricted by the caller's `WHERE`. Stopped is checked first, as the
/// board's state word does: a Stopped Story has no live session, so it cannot also be Waiting.
macro_rules! story_marks {
    ($where:literal) => {
        concat!(
            "SELECT s.epic_id AS epic_id, s.state AS state, \
                CASE WHEN s.state <> 'running' THEN NULL \
                     WHEN EXISTS (SELECT 1 FROM sessions r \
                        WHERE r.id = (SELECT id FROM sessions WHERE story_id = s.id ORDER BY started_at DESC, id DESC LIMIT 1) \
                        AND r.status NOT IN ('running', 'blocked')) THEN 'stopped' \
                     WHEN EXISTS (SELECT 1 FROM sessions r WHERE r.story_id = s.id AND r.status IN ('running', 'blocked') \
                        AND EXISTS (SELECT 1 FROM permission_requests pr WHERE pr.session_id = r.id \
                            AND pr.status = 'pending' AND pr.expired_at IS NULL)) THEN 'waiting_on_you' \
                END AS attention \
             FROM stories s JOIN epics e ON e.id = s.epic_id ",
            $where
        )
    };
}

/// The nine count columns over the `m` alias of the marks CTE (a LEFT JOIN, so an empty group
/// counts zero, never NULL).
macro_rules! count_columns {
    () => {
        "COALESCE(SUM(m.state = 'shaping'), 0), \
         COALESCE(SUM(m.state = 'ready'), 0), \
         COALESCE(SUM(m.state = 'running' AND m.attention IS NULL), 0), \
         COALESCE(SUM(m.attention = 'waiting_on_you'), 0), \
         COALESCE(SUM(m.attention = 'stopped'), 0), \
         COALESCE(SUM(m.state = 'in_review'), 0), \
         COALESCE(SUM(m.state = 'merged'), 0), \
         COALESCE(SUM(m.state = 'dropped'), 0), \
         COALESCE(SUM(m.state <> 'dropped'), 0)"
    };
}

pub const MILESTONE_PROGRESS_SQL: &str = concat!(
    "WITH cur AS (SELECT id, project_id, title, exit_test, state, rank FROM milestones \
        WHERE project_id = ?1 AND CASE WHEN ?2 IS NULL THEN state NOT IN ('done', 'dropped') ELSE id = ?2 END \
        ORDER BY rank, id LIMIT 1), \
     marks AS (",
    story_marks!("WHERE e.milestone_id = (SELECT id FROM cur)"),
    ") \
     SELECT cur.id, cur.title, cur.exit_test, \
        CASE WHEN cur.state = 'ready' AND EXISTS (SELECT 1 FROM epics e WHERE e.milestone_id = cur.id AND ( \
                e.state = 'done' OR EXISTS (SELECT 1 FROM stories s WHERE s.epic_id = e.id \
                    AND s.state IN ('running', 'in_review', 'merged')))) \
             THEN 'in_progress' ELSE cur.state END, \
        (SELECT n.title FROM milestones n WHERE n.project_id = cur.project_id \
            AND n.state NOT IN ('done', 'dropped') AND (n.rank > cur.rank OR (n.rank = cur.rank AND n.id > cur.id)) \
            ORDER BY n.rank, n.id LIMIT 1), ",
    count_columns!(),
    ", (SELECT COUNT(*) FROM epics WHERE milestone_id = cur.id AND state = 'done'), \
       (SELECT COUNT(*) FROM epics WHERE milestone_id = cur.id) \
     FROM cur LEFT JOIN marks m ON 1 = 1 GROUP BY cur.id"
);

pub const EPIC_PROGRESS_SQL: &str = concat!(
    "WITH marks AS (",
    story_marks!("WHERE e.milestone_id = ?1"),
    ") \
     SELECT e.id, e.key, e.title, \
        CASE WHEN e.state = 'ready' AND EXISTS (SELECT 1 FROM stories s WHERE s.epic_id = e.id \
                AND s.state IN ('running', 'in_review', 'merged')) \
             THEN 'in_progress' ELSE e.state END, ",
    count_columns!(),
    ", CASE WHEN EXISTS (SELECT 1 FROM rounds r JOIN stages st ON st.id = r.stage_id WHERE st.epic_id = e.id AND ",
    crate::query::round_waiting_on_you!(),
    ") THEN 'waiting_on_you' \
        WHEN EXISTS (SELECT 1 FROM rounds r JOIN stages st ON st.id = r.stage_id \
                WHERE st.epic_id = e.id AND r.state = 'open') \
            AND NOT EXISTS (SELECT 1 FROM sessions ss WHERE ss.epic_id = e.id AND ss.kind = 'shaping' \
                AND ss.status IN ('running', 'blocked')) THEN 'round_waiting' \
        END \
     FROM epics e LEFT JOIN marks m ON m.epic_id = e.id \
     WHERE e.milestone_id = ?1 GROUP BY e.id ORDER BY e.rank, e.id"
);

/// The nine count columns starting at `first`.
fn counts_at(row: &Row, first: usize) -> rusqlite::Result<StoryStateCounts> {
    Ok(StoryStateCounts {
        shaping: row.get(first)?,
        ready: row.get(first + 1)?,
        running: row.get(first + 2)?,
        waiting_on_you: row.get(first + 3)?,
        stopped: row.get(first + 4)?,
        in_review: row.get(first + 5)?,
        merged: row.get(first + 6)?,
        dropped: row.get(first + 7)?,
        stories_total: row.get(first + 8)?,
    })
}

/// One Milestone of the project with its header numbers: `milestone_id` when given (the one picked on
/// the Roadmap strip, whatever its state), else the Current Milestone (the first on the Roadmap neither
/// Done nor Dropped). `None` when there is no such Milestone in this project. One statement.
pub fn milestone_progress(
    conn: &Connection,
    project_id: &str,
    milestone_id: Option<&str>,
) -> anyhow::Result<Option<MilestoneProgress>> {
    conn.query_row(MILESTONE_PROGRESS_SQL, params![project_id, milestone_id], |row| {
        Ok(MilestoneProgress {
            milestone_id: row.get(0)?,
            title: row.get(1)?,
            exit_test: row.get(2)?,
            state: row.get(3)?,
            next_milestone_title: row.get(4)?,
            counts: counts_at(row, 5)?,
            epics_done: row.get(14)?,
            epics_total: row.get(15)?,
        })
    })
    .optional()
    .context("failed to read the Milestone's progress")
}

/// Every Epic of `milestone_id` in Roadmap order, each with its Story counts. One statement.
pub fn epic_progress(conn: &Connection, milestone_id: &str) -> anyhow::Result<Vec<EpicProgress>> {
    let mut stmt = conn.prepare(EPIC_PROGRESS_SQL)?;
    let rows = stmt
        .query_map(params![milestone_id], |row| {
            Ok(EpicProgress {
                epic_id: row.get(0)?,
                key: row.get(1)?,
                title: row.get(2)?,
                state: row.get(3)?,
                counts: counts_at(row, 4)?,
                attention: row.get(13)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Epics' progress")
}
