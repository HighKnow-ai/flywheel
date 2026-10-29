//! The cross-project fleet read (FLEET-01, FLEET-04, D-163..D-171): every Story session across every
//! registered project in one bounded, banded, ordered statement, and beside them every live shaping
//! session (issue #239), which has no Story but is an agent all the same. `fleet_rows` is the generalisation
//! of `query::permissions` / `query::recovery`'s per-project reads, and keeps their discipline —
//! the statement below is a single literal `&str`, bound through `params![]`.
//!
//! * **Derived, never stored (D-168).** `fleet_state` is a `CASE` alias in the select list: a live
//!   session holding a pending request reads `blocked`, which every surface words "Waiting on you"
//!   (docs/mvp-spec.md §2 "Attention"), whatever `sessions.status` says; a `completed` session
//!   whose Story is not yet merged or dropped reads `awaiting_review`; every other case is the
//!   session status, with a live `blocked` session that holds nothing reading `running`. No column
//!   holds it, so it cannot disagree with the pending requests or `stories.state`.
//! * **Banding and ordering happen here, in SQL (D-03).** The renderer only groups. Band order is
//!   fixed (waiting on you, awaiting review, abandoned, running, then the terminal states), longest
//!   waiting first inside a band, with the session id as the final key so two reads of an
//!   unchanged database return byte-identical order.
//! * **Which rows appear (D-165).** A live session (`running`/`blocked`) always appears. A terminal
//!   session appears only while `acknowledged_at IS NULL`, and a Story with several unacknowledged
//!   terminal sessions contributes only its most recent one. `abandoned` is the one exception: it
//!   appears whenever unacknowledged, matching `recovery.rs`'s any-unacknowledged rule so the rail
//!   count and the band can never disagree.

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::worktree::{
    porcelain_entries, reclaim_eligibility, PorcelainEntry, ReclaimDisposition,
};

/// The hard ceiling on one fleet window. The Tauri command applies its own cap before it calls in
/// here; this clamp is the backstop for any other caller.
pub const FLEET_ROWS_MAX_LIMIT: usize = 200;

/// One row of the fleet. `fleet_state` is one of `running`, `blocked` (Waiting on you), `awaiting_review`,
/// `completed`, `failed`, `interrupted`, `abandoned`.
#[derive(Debug, Clone, PartialEq)]
pub struct FleetRow {
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub project_status: String,
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    pub story_state: String,
    pub run_status: String,
    pub fleet_state: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    /// When the oldest still-pending request of this live session was raised; `None` for a
    /// session that is not waiting on you.
    pub blocked_since: Option<String>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    /// The title of the Story's *doing* Task (docs/mvp-spec.md §7: "what its agent is doing now");
    /// `None` when no Task of the Story is doing. The schema allows at most one.
    pub doing_task_title: Option<String>,
}

/// One live shaping session (issue #239): an agent shaping an Epic, a Milestone or its project's Roadmap
/// with the developer. It has no Story, so it is not a [`FleetRow`], but it is an agent all the same
/// (GLOSSARY.md § Agent: a live session), whether it works between Rounds or is held on one. Only live
/// sessions appear: an ended shaping session hands nothing off, so it leaves nothing to dismiss.
#[derive(Debug, Clone, PartialEq)]
pub struct ShapingFleetRow {
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub project_status: String,
    /// `epic`, `milestone` or `roadmap`: what the session shapes.
    pub subject: String,
    /// The Epic an Epic's session shapes; `None` for any other subject.
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub epic_title: Option<String>,
    /// The Milestone a Milestone's session shapes; `None` for any other subject.
    pub milestone_id: Option<String>,
    pub milestone_title: Option<String>,
    /// `running` or `blocked`, as `sessions.status` holds it.
    pub run_status: String,
    /// `blocked` (Waiting on you) while a Round it holds waits on the developer (`round_waiting_on_you`),
    /// else `running`: working between Rounds.
    pub fleet_state: String,
    pub started_at: String,
    /// When the oldest Round it is held on was posted; `None` while it works between Rounds.
    pub blocked_since: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FleetList {
    pub rows: Vec<FleetRow>,
    /// Every live shaping session (issue #239), Waiting on you first, then oldest first. Kept apart from
    /// `rows` because a shaping session has no Story, and every reader of a Story row keeps its Story.
    pub shaping_rows: Vec<ShapingFleetRow>,
    /// The length of `rows` — never a second count, so the header and the list cannot disagree.
    pub total_rows: usize,
    /// The sum of the non-NULL `cost_usd` of the rows returned; `None` when no returned row carries
    /// a cost. `cost_usd` is the client-side estimate, not billing data (Finding 11).
    pub visible_cost_usd: Option<f64>,
}

/// The fleet statement. The `ORDER BY` sits in an outer select so it can name the `fleet_state`
/// and `blocked_since` aliases instead of restating the `CASE` and the correlated subselect.
pub const FLEET_SQL: &str = "SELECT * FROM ( \
    SELECT ar.id AS session_id, ar.project_id AS project_id, p.name AS project_name, \
        p.key_prefix AS project_key_prefix, p.status AS project_status, \
        ar.story_id AS story_id, s.key AS story_key, s.title AS story_title, s.state AS story_state, \
        ar.status AS run_status, \
        CASE \
            WHEN ar.status IN ('running', 'blocked') AND EXISTS (SELECT 1 FROM permission_requests pr \
                WHERE pr.session_id = ar.id AND pr.status = 'pending' AND pr.expired_at IS NULL) \
                THEN 'blocked' \
            WHEN ar.status = 'blocked' THEN 'running' \
            WHEN ar.status = 'completed' AND s.state NOT IN ('merged', 'dropped') \
                THEN 'awaiting_review' \
            ELSE ar.status \
        END AS fleet_state, \
        ar.started_at AS started_at, ar.ended_at AS ended_at, \
        CASE WHEN ar.status IN ('running', 'blocked') THEN \
            (SELECT MIN(pr.created_at) FROM permission_requests pr \
                WHERE pr.session_id = ar.id AND pr.status = 'pending' AND pr.expired_at IS NULL) \
            END AS blocked_since, \
        ar.cost_usd AS cost_usd, ar.tokens_in AS tokens_in, ar.tokens_out AS tokens_out, \
        (SELECT t.title FROM tasks t WHERE t.story_id = ar.story_id AND t.state = 'doing' \
            LIMIT 1) AS doing_task_title \
    FROM sessions ar \
    JOIN projects p ON p.id = ar.project_id AND p.hidden = 0 \
    JOIN stories s ON s.id = ar.story_id \
    WHERE ar.status IN ('running', 'blocked') \
        OR (ar.status IN ('completed', 'failed', 'interrupted', 'abandoned') \
            AND ar.acknowledged_at IS NULL \
            AND (ar.status = 'abandoned' OR ar.id = ( \
                SELECT ar2.id FROM sessions ar2 WHERE ar2.story_id = ar.story_id \
                ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1))) \
    ) \
    ORDER BY \
        CASE fleet_state \
            WHEN 'blocked' THEN 1 \
            WHEN 'awaiting_review' THEN 2 \
            WHEN 'abandoned' THEN 3 \
            WHEN 'running' THEN 4 \
            ELSE 5 \
        END ASC, \
        COALESCE(blocked_since, ended_at, started_at) ASC, \
        session_id ASC \
    LIMIT ?1";

/// Every live shaping session across every registered project (issue #239), in a project that is not
/// hidden. Its subject is named from its own row: the Epic, the Milestone, or with neither the Roadmap.
/// It reads Waiting on you while a Round it holds waits on the developer, by the one derivation
/// (`round_waiting_on_you`) the waiting-Round lamps use, so the two never disagree.
pub const FLEET_SHAPING_SQL: &str = concat!(
    "SELECT * FROM ( \
    SELECT ar.id AS session_id, ar.project_id, p.name, p.key_prefix, p.status, \
        CASE WHEN ar.epic_id IS NOT NULL THEN 'epic' WHEN ar.milestone_id IS NOT NULL THEN 'milestone' \
            ELSE 'roadmap' END, \
        e.id, e.key, e.title, m.id, m.title, ar.status, ar.started_at AS started_at, \
        (SELECT MIN(r.posted_at) FROM rounds r WHERE r.session_id = ar.id AND ",
    crate::query::round_waiting_on_you!(),
    ") AS blocked_since \
    FROM sessions ar \
    JOIN projects p ON p.id = ar.project_id AND p.hidden = 0 \
    LEFT JOIN epics e ON e.id = ar.epic_id \
    LEFT JOIN milestones m ON m.id = ar.milestone_id \
    WHERE ar.kind = 'shaping' AND ar.status IN ('running', 'blocked') \
    ) \
    ORDER BY blocked_since IS NULL ASC, COALESCE(blocked_since, started_at) ASC, session_id ASC \
    LIMIT ?1"
);

fn shaping_fleet_rows(conn: &Connection, limit: i64) -> anyhow::Result<Vec<ShapingFleetRow>> {
    let mut stmt = conn.prepare(FLEET_SHAPING_SQL)?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let blocked_since: Option<String> = row.get(13)?;
            Ok(ShapingFleetRow {
                session_id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                project_key_prefix: row.get(3)?,
                project_status: row.get(4)?,
                subject: row.get(5)?,
                epic_id: row.get(6)?,
                epic_key: row.get(7)?,
                epic_title: row.get(8)?,
                milestone_id: row.get(9)?,
                milestone_title: row.get(10)?,
                run_status: row.get(11)?,
                fleet_state: if blocked_since.is_some() {
                    "blocked"
                } else {
                    "running"
                }
                .to_string(),
                started_at: row.get(12)?,
                blocked_since,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the live shaping sessions")?;
    Ok(rows)
}

/// Every Story session across every registered project that belongs on the fleet, banded and
/// ordered, at most `limit` (clamped to [`FLEET_ROWS_MAX_LIMIT`]) rows, and beside them every live
/// shaping session (issue #239), at most `limit` too. An empty database returns zero rows, never an
/// error.
pub fn fleet_rows(conn: &Connection, limit: usize) -> anyhow::Result<FleetList> {
    let limit = limit.min(FLEET_ROWS_MAX_LIMIT) as i64;
    let mut stmt = conn.prepare(FLEET_SQL)?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(FleetRow {
                session_id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                project_key_prefix: row.get(3)?,
                project_status: row.get(4)?,
                story_id: row.get(5)?,
                story_key: row.get(6)?,
                story_title: row.get(7)?,
                story_state: row.get(8)?,
                run_status: row.get(9)?,
                fleet_state: row.get(10)?,
                started_at: row.get(11)?,
                ended_at: row.get(12)?,
                blocked_since: row.get(13)?,
                cost_usd: row.get(14)?,
                tokens_in: row.get(15)?,
                tokens_out: row.get(16)?,
                doing_task_title: row.get(17)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the fleet")?;
    let shaping_rows = shaping_fleet_rows(conn, limit)?;
    let total_rows = rows.len();
    let visible_cost_usd = rows
        .iter()
        .filter_map(|r| r.cost_usd)
        .fold(None, |sum, c| Some(sum.unwrap_or(0.0) + c));
    Ok(FleetList {
        rows,
        shaping_rows,
        total_rows,
        visible_cost_usd,
    })
}

/// The hard ceiling on one blocked-queue window (T-10-05-04).
pub const BLOCKED_QUEUE_MAX_LIMIT: usize = 200;

/// One request waiting on you (FLEET-02, docs/mvp-spec.md §4.1): a Gated action or permission
/// request held by a live session, plus the session, project and Story the queue row names. One
/// entry per waiting request, so the queue's length is the sidebar's count of waiting requests.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockedQueueEntry {
    pub request_id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub created_at: String,
    pub destructive_category: Option<String>,
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    pub blocked_since: String,
}

/// `permissions::PENDING_REQUESTS_FOR_RUN_SQL`'s predicate and `created_at ASC, id ASC` tie-break,
/// generalised across projects. Derived from the pending requests of LIVE sessions, never from
/// `sessions.status = 'blocked'`: v0.1 filtered on that status, `answer_request` wrote `running`
/// back after any answer, and a session still holding other requests vanished from the queue
/// (issue #57). A request on an ended session is not waiting on anyone, so it never appears.
pub const BLOCKED_QUEUE_SQL: &str = "SELECT pr.id, pr.tool_name, pr.input_payload, pr.created_at, \
        pr.destructive_category, ar.id, ar.project_id, p.name, p.key_prefix, \
        ar.story_id, s.key, s.title \
    FROM permission_requests pr \
    JOIN sessions ar ON ar.id = pr.session_id \
    JOIN projects p ON p.id = ar.project_id AND p.hidden = 0 \
    JOIN stories s ON s.id = ar.story_id \
    WHERE ar.status IN ('running', 'blocked') AND pr.status = 'pending' AND pr.expired_at IS NULL \
    ORDER BY pr.created_at ASC, pr.id ASC \
    LIMIT ?1";

/// Every request waiting on you across every registered project, longest-waiting first, at most `limit` (clamped to [`BLOCKED_QUEUE_MAX_LIMIT`]).
pub fn blocked_queue(conn: &Connection, limit: usize) -> anyhow::Result<Vec<BlockedQueueEntry>> {
    let limit = limit.min(BLOCKED_QUEUE_MAX_LIMIT) as i64;
    let mut stmt = conn.prepare(BLOCKED_QUEUE_SQL)?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let created_at: String = row.get(3)?;
            Ok(BlockedQueueEntry {
                request_id: row.get(0)?,
                tool_name: row.get(1)?,
                input_payload: row.get(2)?,
                blocked_since: created_at.clone(),
                created_at,
                destructive_category: row.get(4)?,
                session_id: row.get(5)?,
                project_id: row.get(6)?,
                project_name: row.get(7)?,
                project_key_prefix: row.get(8)?,
                story_id: row.get(9)?,
                story_key: row.get(10)?,
                story_title: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the blocked queue")?;
    Ok(rows)
}

/// The hard ceiling on one window of waiting Rounds.
pub const WAITING_ROUNDS_MAX_LIMIT: usize = 200;

/// One shaping Round Waiting on you (issue #124): open, with its call held by a LIVE shaping
/// session, across every registered project. A shaping session has no Story, so it is not a
/// [`FleetRow`]; the andon strip lights a lamp for each of these, and the sidebar's Waiting-on-you
/// count adds them to the queue's requests. An Epic's Round, a Milestone's (issue #132) or a roadmap
/// Round (issue #133).
#[derive(Debug, Clone, PartialEq)]
pub struct WaitingRound {
    pub round_id: String,
    pub round_number: i64,
    /// `epic` for an Epic's Round, `milestone` for a Milestone's, `roadmap` for a roadmap Round.
    pub subject: String,
    /// The Stage's kind: `challenge_spec`, `slice`, `criteria`, a Milestone's `exit_test`; `None` for a
    /// roadmap Round.
    pub stage_kind: Option<String>,
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    /// The Epic an Epic's Round shapes; `None` for a roadmap Round.
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub epic_title: Option<String>,
    /// The Milestone a Milestone's Round shapes (issue #132); `None` for any other Round.
    pub milestone_id: Option<String>,
    pub milestone_title: Option<String>,
    /// When the Round was posted: it has waited on the developer since.
    pub waiting_since: String,
    /// An Epic's Round: how many of its questions are answered, and how many it asks. A roadmap Round:
    /// how many of its Proposals are decided, and how many it filed.
    pub answered: i64,
    pub questions: i64,
}

/// Every waiting Round, longest waiting first, with the Round id as the final key so two reads of an
/// unchanged database are byte-identical. An Epic's Round names its Epic, a Milestone's its Milestone
/// (issue #132), and a roadmap Round its project.
pub const WAITING_ROUNDS_SQL: &str = concat!(
    "SELECT r.id, r.number, \
        CASE WHEN r.stage_id IS NULL THEN 'roadmap' WHEN st.milestone_id IS NOT NULL THEN 'milestone' ELSE 'epic' END, \
        st.kind, r.session_id, \
        p.id, p.name, p.key_prefix, e.id, e.key, e.title, r.posted_at, \
        CASE WHEN r.stage_id IS NULL \
            THEN (SELECT COUNT(*) FROM proposals pr WHERE pr.round_id = r.id AND pr.state != 'pending') \
            ELSE (SELECT COUNT(*) FROM round_questions q WHERE q.round_id = r.id AND q.answer IS NOT NULL) END, \
        CASE WHEN r.stage_id IS NULL \
            THEN (SELECT COUNT(*) FROM proposals pr WHERE pr.round_id = r.id) \
            ELSE (SELECT COUNT(*) FROM round_questions q WHERE q.round_id = r.id) END, \
        m.id, m.title \
    FROM rounds r \
    LEFT JOIN stages st ON st.id = r.stage_id \
    LEFT JOIN epics e ON e.id = st.epic_id \
    LEFT JOIN milestones m ON m.id = st.milestone_id \
    JOIN projects p ON p.id = r.project_id AND p.hidden = 0 \
    WHERE (r.stage_id IS NULL OR st.epic_id IS NOT NULL OR st.milestone_id IS NOT NULL) AND ",
    crate::query::round_waiting_on_you!(),
    " ORDER BY r.posted_at ASC, r.id ASC LIMIT ?1"
);

/// Every shaping Round waiting on you across every registered project, at most `limit` (clamped to
/// [`WAITING_ROUNDS_MAX_LIMIT`]).
pub fn waiting_rounds(conn: &Connection, limit: usize) -> anyhow::Result<Vec<WaitingRound>> {
    let limit = limit.min(WAITING_ROUNDS_MAX_LIMIT) as i64;
    let mut stmt = conn.prepare(WAITING_ROUNDS_SQL)?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(WaitingRound {
                round_id: row.get(0)?,
                round_number: row.get(1)?,
                subject: row.get(2)?,
                stage_kind: row.get(3)?,
                session_id: row.get(4)?,
                project_id: row.get(5)?,
                project_name: row.get(6)?,
                project_key_prefix: row.get(7)?,
                epic_id: row.get(8)?,
                epic_key: row.get(9)?,
                epic_title: row.get(10)?,
                waiting_since: row.get(11)?,
                answered: row.get(12)?,
                questions: row.get(13)?,
                milestone_id: row.get(14)?,
                milestone_title: row.get(15)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the waiting Rounds")?;
    Ok(rows)
}

// ---------------------------------------------------------------------------------------------
// The worktree inventory (WORK-07, D-177, D-178): Story worktrees across every project, each with
// its cached disk size and a stated disposition. Two phases: a board half under the database lock,
// a git and filesystem half without it.
// ---------------------------------------------------------------------------------------------

/// The hard ceiling on one inventory window. The Tauri command applies its own cap first.
pub const WORKTREE_INVENTORY_MAX_LIMIT: usize = 500;

/// What the git half needs per worktree, resolved from the board so no path, ref or sha crosses IPC.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeInventoryInput {
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    pub story_state: String,
    pub project_id: String,
    pub project_name: String,
    pub project_status: String,
    pub path: String,
    pub branch: String,
    pub size_bytes: Option<i64>,
    pub size_measured_at: Option<String>,
    /// `blocked` or `running` when a session is live on the Story; `blocked` wins over `running`.
    pub live_run_status: Option<String>,
}

/// One inventory row: the facts the renderer shows plus the derived disposition.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeInventoryRow {
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    pub story_state: String,
    pub project_id: String,
    pub project_name: String,
    pub project_status: String,
    pub path: String,
    pub branch: String,
    pub size_bytes: Option<i64>,
    pub size_measured_at: Option<String>,
    pub disposition: ReclaimDisposition,
}

/// The SELECT and joins shared by the inventory and by the single-row re-read the reclaim batch
/// makes (plan 10-09), so the live-session clause that makes a stale selection harmless has exactly
/// one definition. A macro rather than a `const` because `concat!` only accepts literals.
macro_rules! worktree_inventory_select {
    () => {
        "SELECT s.id, s.key, s.title, s.state, p.id, p.name, p.status, \
        w.path, w.branch, w.size_bytes, w.size_measured_at, \
        (SELECT ar.status FROM sessions ar WHERE ar.story_id = s.id AND ar.status IN ('running', 'blocked') \
            ORDER BY ar.status ASC LIMIT 1) \
    FROM worktrees w \
    JOIN stories s ON s.id = w.story_id \
    JOIN projects p ON p.id = w.project_id"
    };
}

/// The inventory statement. Size descending (never-measured last: SQLite sorts NULL lowest), Story
/// key ascending as the tie-break, then the worktree id so two reads are byte-identical.
pub const WORKTREE_INVENTORY_SQL: &str = concat!(
    worktree_inventory_select!(),
    " WHERE p.hidden = 0 ORDER BY w.size_bytes DESC, s.key ASC, w.id ASC LIMIT ?1"
);

const WORKTREE_INVENTORY_ONE_SQL: &str = concat!(worktree_inventory_select!(), " WHERE s.id = ?1");

fn inventory_input_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorktreeInventoryInput> {
    Ok(WorktreeInventoryInput {
        story_id: row.get(0)?,
        story_key: row.get(1)?,
        story_title: row.get(2)?,
        story_state: row.get(3)?,
        project_id: row.get(4)?,
        project_name: row.get(5)?,
        project_status: row.get(6)?,
        path: row.get(7)?,
        branch: row.get(8)?,
        size_bytes: row.get(9)?,
        size_measured_at: row.get(10)?,
        live_run_status: row.get(11)?,
    })
}

/// The board half for ONE Story, read fresh: `None` when the Story has no worktree row. The reclaim
/// calls this per row, at the moment it acts, so a selection made against an earlier read is
/// judged against what is true now.
pub fn worktree_inventory_input_for_story(
    conn: &Connection,
    story_id: &str,
) -> anyhow::Result<Option<WorktreeInventoryInput>> {
    conn.query_row(
        WORKTREE_INVENTORY_ONE_SQL,
        params![story_id],
        inventory_input_from_row,
    )
    .optional()
    .context("failed to read one worktree for reclaim")
}

/// The board half: every Story worktree across every project, at most `limit` (clamped to
/// [`WORKTREE_INVENTORY_MAX_LIMIT`]). Takes only a `&Connection` and spawns no process, so it is
/// safe under the database lock; hand the result to [`finish_worktree_inventory`] once the lock is
/// released.
pub fn worktree_inventory_inputs(
    conn: &Connection,
    limit: usize,
) -> anyhow::Result<Vec<WorktreeInventoryInput>> {
    let limit = limit.min(WORKTREE_INVENTORY_MAX_LIMIT) as i64;
    let mut stmt = conn.prepare(WORKTREE_INVENTORY_SQL)?;
    let inputs = stmt
        .query_map(params![limit], inventory_input_from_row)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the worktree inventory");
    inputs
}

/// The git and filesystem half: takes no connection. Order is preserved. An unreachable project, a
/// missing directory and a live session short-circuit before any git call, and the porcelain read
/// -- through [`porcelain_entries`], the one porcelain site -- runs only for a row whose Story is
/// closed and has no live session. A porcelain read that fails is treated as dirty: a tree git
/// cannot describe is never offered for reclaim.
pub fn finish_worktree_inventory(inputs: Vec<WorktreeInventoryInput>) -> Vec<WorktreeInventoryRow> {
    finish_worktree_inventory_with(inputs, porcelain_entries)
}

/// [`finish_worktree_inventory`] with the porcelain read injected. Production passes
/// [`porcelain_entries`]; a test passes a wrapper that counts and records the paths it is asked
/// about, which is the only way to prove which rows cost a git call. Counting from git's side
/// (a `core.fsmonitor` hook) stopped working on git 2.54, which no longer consults the hook on
/// `git status --porcelain`, so the count has to come from this seam rather than from git.
pub fn finish_worktree_inventory_with(
    inputs: Vec<WorktreeInventoryInput>,
    mut read_porcelain: impl FnMut(&Path) -> anyhow::Result<Vec<PorcelainEntry>>,
) -> Vec<WorktreeInventoryRow> {
    inputs
        .into_iter()
        .map(|input| {
            let reachable = input.project_status != "unreachable";
            let present = reachable && Path::new(&input.path).try_exists().unwrap_or(false);
            let evaluable = reachable && present && input.live_run_status.is_none();
            let story_closed = matches!(input.story_state.as_str(), "merged" | "dropped");
            let dirty = evaluable
                && story_closed
                && read_porcelain(Path::new(&input.path))
                    .map(|e| !e.is_empty())
                    .unwrap_or(true);
            let disposition = reclaim_eligibility(
                &input.story_state,
                input.live_run_status.as_deref(),
                dirty,
                &input.project_status,
                present || !reachable,
            );
            WorktreeInventoryRow {
                story_id: input.story_id,
                story_key: input.story_key,
                story_title: input.story_title,
                story_state: input.story_state,
                project_id: input.project_id,
                project_name: input.project_name,
                project_status: input.project_status,
                path: input.path,
                branch: input.branch,
                size_bytes: input.size_bytes,
                size_measured_at: input.size_measured_at,
                disposition,
            }
        })
        .collect()
}

/// A worktree a measure call should walk: the id and the path the core read from the row.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeMeasureTarget {
    pub story_id: String,
    pub path: String,
}

/// The paths to measure for `story_ids`, or for every worktree when `None`, at most `limit`. An id
/// with no worktree row is simply absent. The renderer only ever names ids; every path comes from
/// the `worktrees` rows here.
///
/// The `None` case is stalest-first (never measured, then oldest measurement), so when there are
/// more worktrees than `limit` each call advances through the set instead of re-walking the same
/// first rows forever. SQLite sorts NULL before every value in an ascending order, which is what
/// puts "never measured" first. The `Some` case silently ignores ids past `limit`; the command
/// refuses an over-long list before calling here.
pub fn worktree_measure_targets(
    conn: &Connection,
    story_ids: Option<&[String]>,
    limit: usize,
) -> anyhow::Result<Vec<WorktreeMeasureTarget>> {
    let mut targets = Vec::new();
    match story_ids {
        Some(ids) => {
            for id in ids.iter().take(limit) {
                if let Some(wt) = crate::domain::worktree::worktree_for_story(conn, id)? {
                    targets.push(WorktreeMeasureTarget {
                        story_id: wt.story_id,
                        path: wt.path,
                    });
                }
            }
        }
        None => {
            let mut stmt = conn.prepare("SELECT story_id, path FROM worktrees WHERE project_id IN (SELECT id FROM projects WHERE hidden = 0) ORDER BY size_measured_at ASC, id ASC LIMIT ?1")?;
            targets = stmt
                .query_map(params![limit as i64], |row| {
                    Ok(WorktreeMeasureTarget {
                        story_id: row.get(0)?,
                        path: row.get(1)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the worktrees to measure")?;
        }
    }
    Ok(targets)
}

/// Cache one measured size: writes `size_bytes` and `size_measured_at` for the one worktree of
/// `story_id` and nothing else. Returns whether a row was updated.
pub fn record_worktree_size(
    conn: &Connection,
    story_id: &str,
    size_bytes: i64,
    measured_at: &str,
) -> anyhow::Result<bool> {
    let changed = conn
        .execute(
            "UPDATE worktrees SET size_bytes = ?1, size_measured_at = ?2 WHERE story_id = ?3",
            params![size_bytes, measured_at, story_id],
        )
        .context("failed to record the worktree size")?;
    Ok(changed == 1)
}
