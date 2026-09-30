//! The agent's own board reads (D-87), plus the board-level triage-lane read (D-82) and the
//! rejected-proposal read [`crate::epic_context_packet`]'s `RejectedSet` consumes (D-83). Every
//! function here is bounded from the first line by the SAME `DEFAULT_LIMIT`/`MAX_LIMIT`/clamp
//! idiom `commands/board.rs` established (Don't Hand-Roll a second one) — none takes an `Option`
//! that defaults to unbounded, and none can be asked for `i64::MAX` and comply (05-RESEARCH.md
//! Pitfall 4). This is `01-SECURITY.md` AR-01-04's other half: `domain::epic::list_epics` closes
//! the RENDERER's roster read; this module closes the AGENT's — two reads, two ceilings, one
//! reason each, never one function serving both.
//!
//! Every SQL statement below is a literal `&str`, bound through `params![]`/`named_params![]` —
//! never assembled by `format!`/string interpolation, matching this crate's `query/` discipline
//! everywhere else.
//!
//! Plan 06-05 (PROP-05, D-108/D-112): [`resolve_duplicate_candidate_label`] is the one bounded
//! lookup that turns a `Proposal.duplicate_of` id back into a `kind`/`key`/`title` the staging
//! answer can relay to the model. [`proposal_limit_notices`] is the human-facing read for a
//! throttled run — DERIVED, on every call, from however many `proposal.limit_exhausted` events
//! that run's own refusals appended (never a second stored copy of the warning).

use anyhow::Context;
use rusqlite::{named_params, params, Connection, OptionalExtension};
use serde::Serialize;

use crate::domain::authoring_proposal::{
    pending_proposals_for_run, row_to_proposal, Proposal, PROPOSAL_COLUMNS,
};
use crate::domain::epic::EpicSummary;
use crate::epic_context_packet::TaskRosterEntry;

/// The Rust core returns a page, never the whole board (D-03) — same value `commands/board.rs`
/// uses, redeclared here because an agent-reachable tool call never crosses the Tauri command
/// boundary `commands/board.rs`'s own constants live behind.
pub const DEFAULT_LIMIT: i64 = 200;

/// The domain layer's own cap on the requested limit — independent of, and applied from, the
/// FIRST line of every function below, never retrofitted (05-RESEARCH.md Pitfall 4: a handler that
/// passes `i64::MAX` or omits the parameter "to keep it simple for the agent" is exactly the
/// failure this constant exists to prevent).
pub const MAX_LIMIT: i64 = 500;

/// A caller-supplied `limit` of zero or less falls back to [`DEFAULT_LIMIT`]; any value is
/// clamped to [`MAX_LIMIT`] before the query runs — a 10,000,000 request never reaches SQLite
/// as-is.
fn resolve_limit(limit: i64) -> i64 {
    let base = if limit <= 0 { DEFAULT_LIMIT } else { limit };
    base.min(MAX_LIMIT)
}

/// The agent's own bounded epic read — the sibling of `domain::epic::list_epics` that closes
/// AR-01-04 from the OTHER side: the renderer's roster carries a high ceiling with a surfaced
/// truncation flag; this is the clamped, cursor-resumable page an agent's `search`/`get_epic`
/// tool set actually calls. `cursor` resumes at the exact `(status, priority, rank, id)` tuple
/// `crate::query::ORDER_BY` sorts by — the same keyset-pagination contract `list_board` already
/// uses, applied here to an epics-only window.
pub fn list_epics_page(
    conn: &Connection,
    project_id: &str,
    limit: i64,
    cursor: Option<&super::BoardCursor>,
) -> anyhow::Result<Vec<EpicSummary>> {
    let resolved_limit = resolve_limit(limit);

    let sql: String = match cursor {
        None => [
            "SELECT b.id, b.key, b.title FROM (",
            "SELECT id, key, title, status, rank, priority FROM epics WHERE project_id = :project_id",
            ") b ",
            super::ORDER_BY,
            " LIMIT :limit",
        ]
        .concat(),
        Some(_) => [
            "SELECT b.id, b.key, b.title FROM (",
            "SELECT id, key, title, status, rank, priority FROM epics WHERE project_id = :project_id",
            ") b WHERE ",
            super::CURSOR_WHERE,
            " ",
            super::ORDER_BY,
            " LIMIT :limit",
        ]
        .concat(),
    };

    let mut stmt = conn.prepare(&sql)?;
    let row_mapper = |row: &rusqlite::Row| {
        Ok(EpicSummary { id: row.get(0)?, key: row.get(1)?, title: row.get(2)? })
    };

    let rows = match cursor {
        None => stmt
            .query_map(
                named_params! { ":project_id": project_id, ":limit": resolved_limit },
                row_mapper,
            )?
            .collect::<Result<Vec<_>, _>>(),
        Some(c) => stmt
            .query_map(
                named_params! {
                    ":project_id": project_id,
                    ":cursor_status": c.status_sort_key,
                    ":cursor_priority": c.priority_sort_key,
                    ":cursor_rank": &c.rank,
                    ":cursor_id": &c.id,
                    ":limit": resolved_limit,
                },
                row_mapper,
            )?
            .collect::<Result<Vec<_>, _>>(),
    };
    rows.context("failed to list the agent's epic page")
}

const AGENT_TASK_CRITERIA_SQL: &str = "SELECT statement, verification_hint FROM acceptance_criteria \
    WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL \
    ORDER BY rank ASC, id ASC";

/// The agent's own bounded task-roster read for one epic — same current-revision-criteria
/// discipline `epic_context_packet.rs` holds (`superseded_at IS NULL`), bounded by `limit` from
/// the first line rather than the packet's own unbounded (task-count-scoped, never agent-facing
/// unbounded) roster walk.
pub fn list_tasks_for_epic(
    conn: &Connection,
    epic_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<TaskRosterEntry>> {
    let resolved_limit = resolve_limit(limit);

    let mut task_stmt = conn.prepare(
        "SELECT key, title, status, id FROM tasks WHERE epic_id = ?1 ORDER BY rank ASC, id ASC LIMIT ?2",
    )?;
    let tasks: Vec<(String, String, String, String)> = task_stmt
        .query_map(params![epic_id, resolved_limit], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to list tasks for the agent's epic read")?;

    let mut result = Vec::with_capacity(tasks.len());
    for (key, title, status, task_id) in tasks {
        let mut criteria_stmt = conn.prepare(AGENT_TASK_CRITERIA_SQL)?;
        let criteria = criteria_stmt
            .query_map(params![task_id], |row| {
                Ok(crate::context_packet::CriterionEntry {
                    statement: row.get(0)?,
                    verification_hint: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .context("failed to read a task's acceptance criteria for the agent's epic read")?;
        result.push(TaskRosterEntry { key, title, status, criteria });
    }
    Ok(result)
}

/// Plan 05-05 (D-87): one epic's own facts, for the agent's `epic_get` read tool. A single-row
/// lookup needs no `limit` — bounding is moot at cardinality one — but IS scoped SERVER-SIDE to
/// `project_id`: an `epic_id` naming an epic outside this project (or naming no epic at all)
/// returns `None` rather than the row, never a distinguishable "forbidden" — 05-RESEARCH.md's V4
/// row (and T-05-05-03) requires exactly this: the difference between "not found" and "forbidden"
/// is itself a disclosure.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEpicDetail {
    pub id: String,
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
}

/// Look up one epic by id, scoped server-side to `project_id` — the ONLY function `epic_get`'s
/// inbound handler may call. Returns `Ok(None)` for an epic outside this project or one that does
/// not exist at all; never distinguishes the two.
pub fn get_epic_for_agent(
    conn: &Connection,
    project_id: &str,
    epic_id: &str,
) -> anyhow::Result<Option<AgentEpicDetail>> {
    conn.query_row(
        "SELECT id, key, title, description, status FROM epics WHERE id = ?1 AND project_id = ?2",
        params![epic_id, project_id],
        |row| {
            Ok(AgentEpicDetail {
                id: row.get(0)?,
                key: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
            })
        },
    )
    .optional()
    .context("failed to read the agent's single-epic detail")
}

/// The agent's own bounded free-text search — reuses `query::search::search_items`'s existing FTS
/// path rather than a second search implementation (Don't Hand-Roll). Returns only the board
/// items half of the window; the issues lane is not part of the agent's read surface in this plan.
pub fn search_board_for_agent(
    conn: &Connection,
    project_id: &str,
    term: &str,
    limit: i64,
) -> anyhow::Result<Vec<super::BoardItem>> {
    let resolved_limit = resolve_limit(limit);
    let window = super::search::search_items(
        conn,
        project_id,
        term,
        &super::BoardFilter::default(),
        resolved_limit,
        None,
    )?;
    Ok(window.items)
}

/// Per-status proposal counts (mirrors `board_band_counts`'s own discipline: one grouped
/// aggregate, never a per-row follow-up query) — lets the triage lane's header report scale
/// without a second query. Plan 06-06: widened to all five statuses (`merged`/`deferred` added)
/// so a decided row is never invisible in the totals.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProposalStatusCounts {
    pub pending: i64,
    pub accepted: i64,
    pub rejected: i64,
    pub merged: i64,
    pub deferred: i64,
}

/// [`list_pending_proposals`]'s return shape — the bounded window plus the project's per-status
/// counts, so the triage lane can report "N pending, M total" without a second round trip.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProposalWindow {
    pub proposals: Vec<Proposal>,
    pub counts: ProposalStatusCounts,
}

fn proposal_status_counts(conn: &Connection, project_id: &str) -> anyhow::Result<ProposalStatusCounts> {
    let mut stmt = conn.prepare(
        "SELECT status, COUNT(*) FROM authoring_proposals WHERE project_id = ?1 GROUP BY status",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    let mut counts = ProposalStatusCounts::default();
    for row in rows {
        let (status, count) = row.context("failed to read proposal status counts")?;
        match status.as_str() {
            "pending" => counts.pending = count,
            "accepted" => counts.accepted = count,
            "rejected" => counts.rejected = count,
            "merged" => counts.merged = count,
            "deferred" => counts.deferred = count,
            _ => {}
        }
    }
    Ok(counts)
}

/// The board-level triage lane's own read (D-82) — every PENDING proposal across the project,
/// newest first with `id` as a stable tie-break, bounded from the first line. Reads through
/// `idx_authoring_proposals_project_status` (`project_id`, `status`, `created_at DESC`, migration
/// `0012_authoring_proposals_project_status_index.sql`), so a project-wide scan of a
/// potentially-large `authoring_proposals` table stays indexed, not a full table scan.
pub fn list_pending_proposals(
    conn: &Connection,
    project_id: &str,
    limit: i64,
    cursor: Option<(&str, &str)>,
) -> anyhow::Result<ProposalWindow> {
    let resolved_limit = resolve_limit(limit);

    let sql: String = match cursor {
        None => [
            "SELECT ",
            PROPOSAL_COLUMNS,
            " FROM authoring_proposals WHERE project_id = ?1 AND status = 'pending' \
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        ]
        .concat(),
        Some(_) => [
            "SELECT ",
            PROPOSAL_COLUMNS,
            " FROM authoring_proposals WHERE project_id = ?1 AND status = 'pending' \
             AND (created_at, id) < (?3, ?4) \
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        ]
        .concat(),
    };

    let mut stmt = conn.prepare(&sql)?;
    let proposals: Vec<Proposal> = match cursor {
        None => stmt
            .query_map(params![project_id, resolved_limit], row_to_proposal)?
            .collect::<Result<Vec<_>, _>>(),
        Some((created_at, id)) => stmt
            .query_map(params![project_id, resolved_limit, created_at, id], row_to_proposal)?
            .collect::<Result<Vec<_>, _>>(),
    }
    .context("failed to list pending proposals")?;

    let counts = proposal_status_counts(conn, project_id)?;
    Ok(ProposalWindow { proposals, counts })
}

/// The indexed, bounded read [`crate::epic_context_packet`]'s `RejectedSet` consumes (D-83) —
/// every REJECTED proposal for one epic, newest first, bounded from the first line. Reads through
/// `idx_authoring_proposals_epic_status` (`epic_id`, `status`, `created_at DESC`).
pub fn list_rejected_for_epic(
    conn: &Connection,
    epic_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<Proposal>> {
    let resolved_limit = resolve_limit(limit);

    let sql: String = [
        "SELECT ",
        PROPOSAL_COLUMNS,
        " FROM authoring_proposals WHERE epic_id = ?1 AND status = 'rejected' \
         ORDER BY created_at DESC, id DESC LIMIT ?2",
    ]
    .concat();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![epic_id, resolved_limit], row_to_proposal)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list rejected proposals for epic")
}

/// Plan 06-06 (PROP-06): the deferred filter's own read — every DEFERRED proposal across the
/// project, newest first with `id` as a stable tie-break, bounded from the first line. Mirrors
/// [`list_pending_proposals`]'s exact signature, cursor handling and `PROPOSAL_COLUMNS`
/// composition (the same shape, one different status value in the WHERE clause), reading through
/// the same `idx_authoring_proposals_project_status` index so a deferred-only scan stays indexed.
/// A deferred proposal is recallable (D-102) — this is the read that makes it so.
pub fn list_deferred_proposals(
    conn: &Connection,
    project_id: &str,
    limit: i64,
    cursor: Option<(&str, &str)>,
) -> anyhow::Result<ProposalWindow> {
    let resolved_limit = resolve_limit(limit);

    let sql: String = match cursor {
        None => [
            "SELECT ",
            PROPOSAL_COLUMNS,
            " FROM authoring_proposals WHERE project_id = ?1 AND status = 'deferred' \
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        ]
        .concat(),
        Some(_) => [
            "SELECT ",
            PROPOSAL_COLUMNS,
            " FROM authoring_proposals WHERE project_id = ?1 AND status = 'deferred' \
             AND (created_at, id) < (?3, ?4) \
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        ]
        .concat(),
    };

    let mut stmt = conn.prepare(&sql)?;
    let proposals: Vec<Proposal> = match cursor {
        None => stmt
            .query_map(params![project_id, resolved_limit], row_to_proposal)?
            .collect::<Result<Vec<_>, _>>(),
        Some((created_at, id)) => stmt
            .query_map(params![project_id, resolved_limit, created_at, id], row_to_proposal)?
            .collect::<Result<Vec<_>, _>>(),
    }
    .context("failed to list deferred proposals")?;

    let counts = proposal_status_counts(conn, project_id)?;
    Ok(ProposalWindow { proposals, counts })
}

/// One authoring run's Product Kill Criterion measurement (gap G-05-2's third item, plan 05-13):
/// derived from the board, never recalled. How many task proposals and how many criterion
/// proposals this run had ACCEPTED, how many of those accepted criterion proposals had ALSO been
/// AMENDED before acceptance, the run's own start timestamp, the timestamp of its last acceptance
/// (`None` when nothing was accepted), and the elapsed minutes between them (`None` alongside it,
/// never an error). A read-only aggregate: this function inserts, updates and deletes nothing, and
/// two calls against an unchanged database produce the identical result.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringRunMeasurement {
    pub accepted_task_proposals: i64,
    pub accepted_criterion_proposals: i64,
    pub amended_before_accept: i64,
    pub started_at: String,
    pub last_accepted_at: Option<String>,
    pub elapsed_minutes: Option<f64>,
}

/// Measure one authoring run (T-05-13's Task 3). `limit` bounds the two row-returning reads this
/// derives from — this run's own proposals, and this run's own amended proposal ids — through
/// this module's own [`resolve_limit`], exactly like [`list_rejected_for_epic`]/
/// [`list_pending_proposals`] do above. Acceptance and amendment are both derived from the event
/// rows `domain::authoring_proposal`'s `accept_proposal_in_tx`/`amend_proposal` already append
/// (`event_type` `proposal.accepted`/`proposal.amended`, `stream_type` `authoring_proposal`) —
/// never a second, hand-rolled notion of "accepted"/"amended" that could drift from the one the
/// proposal lifecycle itself already appends. Amendment can only ever happen while a proposal is
/// still `pending` (`amend_proposal` refuses an already-decided row), so any `proposal.amended`
/// event recorded for a proposal necessarily happened BEFORE that proposal's own eventual
/// `proposal.accepted` event, if it has one — "amended before accept" reduces to "amended at all,
/// among the accepted".
///
/// WR-05: the last acceptance and the amended-ids set are two SEPARATE reads, not one ordered
/// combined read. A single newest-first window would correctly keep the last acceptance but
/// necessarily discard an amendment that happened earlier in the run, since an amendment always
/// precedes the acceptance it belongs to — one window cannot serve both ends of one set.
pub fn measure_authoring_run(
    conn: &Connection,
    run_id: &str,
    limit: i64,
) -> anyhow::Result<AuthoringRunMeasurement> {
    let resolved_limit = resolve_limit(limit);

    let started_at: String = conn
        .query_row(
            "SELECT started_at FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .with_context(|| format!("authoring run {run_id:?} not found"))?;

    let mut proposal_stmt = conn.prepare(
        "SELECT id, target_type, status FROM authoring_proposals WHERE agent_run_id = ?1 \
         ORDER BY created_at DESC, id DESC LIMIT ?2",
    )?;
    let proposals: Vec<(String, String, String)> = proposal_stmt
        .query_map(params![run_id, resolved_limit], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read this run's own proposals for measurement")?;

    let accepted_task_proposals = proposals
        .iter()
        .filter(|(_, target_type, status)| target_type == "task" && status == "accepted")
        .count() as i64;
    let accepted_criterion_ids: std::collections::HashSet<&str> = proposals
        .iter()
        .filter(|(_, target_type, status)| target_type == "criterion" && status == "accepted")
        .map(|(id, _, _)| id.as_str())
        .collect();
    let accepted_criterion_proposals = accepted_criterion_ids.len() as i64;

    // The last acceptance is a single-row aggregate over the WHOLE matching set, not a bounded
    // row scan: there is no bound left here for a bound to truncate, so this statement carries no
    // ORDER BY and no LIMIT by design. `MAX` over an empty set yields SQL NULL, which `query_row`
    // reads straight into `None` — the existing no-acceptances case, with no special branch.
    let last_accepted_at: Option<String> = conn
        .query_row(
            "SELECT MAX(e.occurred_at) FROM events e \
             JOIN authoring_proposals p ON p.id = e.stream_id \
             WHERE p.agent_run_id = ?1 AND e.stream_type = 'authoring_proposal' \
             AND e.event_type = 'proposal.accepted'",
            params![run_id],
            |row| row.get(0),
        )
        .context("failed to read this run's last acceptance timestamp for measurement")?;

    // The amended-ids read is DISTINCT by proposal, not by amendment event: the bound counts
    // amended PROPOSALS, so a proposal amended repeatedly never spends the window more than once,
    // and an amendment far older than a later acceptance still survives a small bound.
    let mut amended_stmt = conn.prepare(
        "SELECT DISTINCT e.stream_id FROM events e \
         JOIN authoring_proposals p ON p.id = e.stream_id \
         WHERE p.agent_run_id = ?1 AND e.stream_type = 'authoring_proposal' \
         AND e.event_type = 'proposal.amended' \
         ORDER BY e.stream_id DESC LIMIT ?2",
    )?;
    let amended_ids: std::collections::HashSet<String> = amended_stmt
        .query_map(params![run_id, resolved_limit], |row| row.get(0))?
        .collect::<Result<std::collections::HashSet<_>, _>>()
        .context("failed to read this run's amended proposal ids for measurement")?;

    let amended_before_accept = accepted_criterion_ids
        .iter()
        .filter(|id| amended_ids.contains(**id))
        .count() as i64;

    let elapsed_minutes = match &last_accepted_at {
        Some(last) => {
            let start = chrono::DateTime::parse_from_rfc3339(&started_at)
                .context("failed to parse the run's own start timestamp")?;
            let end = chrono::DateTime::parse_from_rfc3339(last)
                .context("failed to parse the run's last acceptance timestamp")?;
            Some((end - start).num_seconds() as f64 / 60.0)
        }
        None => None,
    };

    Ok(AuthoringRunMeasurement {
        accepted_task_proposals,
        accepted_criterion_proposals,
        amended_before_accept,
        started_at,
        last_accepted_at,
        elapsed_minutes,
    })
}

/// One row of the run picker the terminal drives the comparison's in-app arm from (05-17-PLAN.md
/// Task 1, gap HUMAN-02): a developer finds the run id here instead of reading it off a UI
/// surface.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentAuthoringRun {
    pub run_id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub status: String,
    pub authoring_stage: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

/// The newest-first, bounded list of authoring runs (`authoring_stage IS NOT NULL`) — every run
/// `start_authoring_run` has ever created, whether still running or already closed, so a run the
/// comparison wants to measure is found by asking the board, never by hand-copying an id off a UI
/// surface. Bounded by [`resolve_limit`] on its own first line, exactly like every other read in
/// this module. Ordered `started_at DESC, id DESC` — the same tie-break idiom
/// [`list_rejected_for_epic`] uses — so the list is stable across calls even when two runs share a
/// start timestamp. Read-only: inserts, updates and deletes nothing.
pub fn list_recent_authoring_runs(
    conn: &Connection,
    limit: i64,
) -> anyhow::Result<Vec<RecentAuthoringRun>> {
    let resolved_limit = resolve_limit(limit);

    let sql = "SELECT id, project_id, epic_id, status, authoring_stage, started_at, ended_at \
         FROM agent_runs WHERE authoring_stage IS NOT NULL \
         ORDER BY started_at DESC, id DESC LIMIT ?1";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![resolved_limit], |row| {
            Ok(RecentAuthoringRun {
                run_id: row.get(0)?,
                project_id: row.get(1)?,
                epic_id: row.get(2)?,
                status: row.get(3)?,
                authoring_stage: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list recent authoring runs")
}

/// D-87 (plan 05-05, extracted plan 05-18/G-05-1), widened plan 05-44 (gap G-05-9): the ONE
/// board-read dispatch, called from BOTH `commands::authoring::handle_inbound_board_read_request`
/// (the real desktop app's own inbound handler) and the UAT bridge's `answer-board-read`
/// subcommand — never a second copy of this arithmetic anywhere else (SHAPE-02's own integrity
/// requirement). Resolves the run's own `project_id` from `agent_runs` INSIDE this function's
/// body — scope comes from the run's row, NEVER from anything `event` itself claims (T-05-05-03 /
/// T-05-18-01) — then applies the SAME clamp-and-peek arithmetic `handle_inbound_board_read_request`
/// applied before this extraction (a request one row past the resolved limit, itself clamped at
/// [`MAX_LIMIT`], so a page's own length need not be trusted to report truncation) and dispatches
/// on `event`'s `readKind` string to exactly one of [`search_board_for_agent`],
/// [`get_epic_for_agent`], [`list_tasks_for_epic`] or (plan 05-44) `pending_proposals_for_run`.
/// Performs no writes. An unrecognised `readKind` returns `Err` naming the offending kind — never
/// panics, matching every read in this module's own discipline.
///
/// The fourth kind, `"list_proposals"` (gap G-05-9): scoped by the `run_id` PARAMETER this
/// function already receives — never from anything `event` claims — exactly like `list_tasks`'s
/// own epic-scoping guarantee above. This is the read that closes the gap: a proposal's id was
/// never returned to the agent that staged it, so `propose_criterion`'s REQUIRED
/// `parent_proposal_id` was unreachable in a fresh-epic session by construction. Each row is
/// projected to `id`/`verb`/`targetType`/`parentProposalId`/`status`/`label` only —
/// `project_id`/`created_by`/`agent_run_id` are the run's own internals and are never serialised
/// onto an agent-facing page (T-05-44-02).
/// Plan 06-05 (D-108): one candidate's own `kind`/`key`/`title`, resolved by id, across the SAME
/// four corpora `query::search::duplicate_candidate_for` scores against — a `Proposal`'s
/// `duplicate_of` may name a task, an epic, an issue, or another proposal, and this is the ONE
/// place that turns "an id" back into "what kind of thing, with what title" for the relayed
/// staging answer. `key` is `None` for a proposal candidate (a proposal has no key until it is
/// accepted), mirroring `query::search::DuplicateCandidate`'s own field.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidateLabel {
    pub kind: String,
    pub key: Option<String>,
    pub title: String,
}

/// Resolve `candidate_id`'s own label with ONE bounded lookup (`LIMIT 1` over a four-arm
/// `UNION ALL`) — never a per-corpus round trip. Returns `None` when the id no longer resolves to
/// anything (e.g. the target row was deleted between the scoring pass and this read); the caller
/// degrades that to omitting the candidate field entirely, never an error.
pub fn resolve_duplicate_candidate_label(
    conn: &Connection,
    candidate_id: &str,
) -> anyhow::Result<Option<DuplicateCandidateLabel>> {
    let sql = "SELECT 'task', key, title FROM tasks WHERE id = ?1 \
        UNION ALL \
        SELECT 'epic', key, title FROM epics WHERE id = ?1 \
        UNION ALL \
        SELECT 'issue', key, title FROM issues WHERE id = ?1 \
        UNION ALL \
        SELECT 'proposal', NULL, COALESCE( \
            json_extract(payload, '$.title'), \
            json_extract(payload, '$.statement'), \
            json_extract(payload, '$.assumption'), \
            '(untitled proposal)' \
        ) FROM authoring_proposals WHERE id = ?1 \
        LIMIT 1";
    conn.query_row(sql, params![candidate_id], |row| {
        Ok(DuplicateCandidateLabel { kind: row.get(0)?, key: row.get(1)?, title: row.get(2)? })
    })
    .optional()
    .context("failed to resolve a duplicate candidate's label")
}

/// One throttled run's human-facing notice (plan 06-05, D-112) — DERIVED from however many
/// `proposal.limit_exhausted` events that run's refusals appended, never a second stored copy of
/// the warning (D-74/D-75's rule, applied verbatim). `limit` and `refused_count` are both read
/// back off the events themselves, so this struct never hand-rolls its own notion of either.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLimitNotice {
    pub agent_run_id: String,
    pub task_id: Option<String>,
    pub limit: i64,
    pub refused_count: i64,
    pub first_refused_at: String,
    pub last_refused_at: String,
}

/// One notice per throttled run in `project_id`, derived on EVERY read from the
/// `proposal.limit_exhausted` events those runs' refusals appended — D-53's "count every refusal,
/// surface only the exhaustion" expressed as a `GROUP BY`: however many refusal events a run
/// produced, a caller gets exactly one notice for it. Nothing writes a second copy of the warning
/// line anywhere. Bounded through this module's own [`resolve_limit`], exactly like every other
/// read here. Newest-last-refusal first.
pub fn proposal_limit_notices(
    conn: &Connection,
    project_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<ProposalLimitNotice>> {
    let resolved_limit = resolve_limit(limit);

    let sql = "SELECT stream_id, MAX(task_id), \
        MAX(CAST(json_extract(payload, '$.limit') AS INTEGER)), \
        COUNT(*), MIN(occurred_at), MAX(occurred_at) \
        FROM events \
        WHERE project_id = ?1 AND event_type = 'proposal.limit_exhausted' \
        GROUP BY stream_id \
        ORDER BY MAX(occurred_at) DESC \
        LIMIT ?2";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![project_id, resolved_limit], |row| {
            Ok(ProposalLimitNotice {
                agent_run_id: row.get(0)?,
                task_id: row.get(1)?,
                limit: row.get(2)?,
                refused_count: row.get(3)?,
                first_refused_at: row.get(4)?,
                last_refused_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to derive proposal limit notices")
}

pub fn resolve_board_read(
    conn: &Connection,
    run_id: &str,
    event: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let project_id: String = conn
        .query_row(
            "SELECT project_id FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .context("agent_run not found for a board read request")?;

    let requested_limit = event.get("limit").and_then(|v| v.as_i64()).unwrap_or(0);
    let resolved_limit = if requested_limit <= 0 { DEFAULT_LIMIT } else { requested_limit }
        .min(MAX_LIMIT);
    // One past the resolved limit, itself clamped at MAX_LIMIT — a request already sitting at the
    // ceiling cannot peek past it, which is an accepted, documented edge case (truncation at the
    // exact ceiling reads `false` rather than `true`), not a silent unbounded read.
    let peek_limit = (resolved_limit + 1).min(MAX_LIMIT);

    let read_kind = event.get("readKind").and_then(|v| v.as_str()).unwrap_or("");

    match read_kind {
        "search" => {
            let term = event.get("term").and_then(|v| v.as_str()).unwrap_or("");
            let mut items = search_board_for_agent(conn, &project_id, term, peek_limit)?;
            let truncated = items.len() as i64 > resolved_limit;
            items.truncate(resolved_limit.max(0) as usize);
            let items_json: Vec<serde_json::Value> = items
                .iter()
                .map(|item| {
                    serde_json::json!({
                        "id": item.id,
                        "kind": item.kind,
                        "key": item.key,
                        "title": item.title,
                        "status": item.status,
                        "epicId": item.epic_id,
                    })
                })
                .collect();
            // 05-RESEARCH.md Pitfall 4 / D-87: a true `total` for an FTS match count would need a
            // second, separately-maintained count query mirroring `search_items`'s own predicate —
            // out of this plan's proportionate scope. `truncated` alone already tells the model it
            // is looking at a page, never the whole board.
            Ok(serde_json::json!({ "items": items_json, "truncated": truncated }))
        }
        "get_epic" => {
            let epic_id = event.get("epicId").and_then(|v| v.as_str()).unwrap_or("");
            let epic = get_epic_for_agent(conn, &project_id, epic_id)?;
            let found = epic.is_some();
            Ok(serde_json::json!({ "epic": epic, "found": found }))
        }
        "list_tasks" => {
            let epic_id = event.get("epicId").and_then(|v| v.as_str()).unwrap_or("");
            // Server-side scoping (T-05-05-03): confirm the epic is this run's own project's
            // BEFORE listing its tasks — an epic_id from another project reads not-found rather
            // than the row, never distinguishable from "this epic does not exist".
            let scoped = get_epic_for_agent(conn, &project_id, epic_id)?;
            if scoped.is_none() {
                return Ok(serde_json::json!({
                    "tasks": [], "found": false, "truncated": false, "total": 0
                }));
            }
            let mut tasks = list_tasks_for_epic(conn, epic_id, peek_limit)?;
            let truncated = tasks.len() as i64 > resolved_limit;
            tasks.truncate(resolved_limit.max(0) as usize);
            let total: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE epic_id = ?1",
                    params![epic_id],
                    |row| row.get(0),
                )
                .context("failed to count the epic's own tasks")?;
            Ok(serde_json::json!({
                "tasks": tasks, "found": true, "truncated": truncated, "total": total
            }))
        }
        "list_proposals" => {
            // Plan 05-44 (gap G-05-9): reads NOTHING from `event` except `limit` — this run's own
            // pending proposals are scoped by the `run_id` PARAMETER this function already
            // received, never from anything `event` itself claims (T-05-05-03 / V4 Access
            // Control), exactly like `list_tasks`'s own epic-scoping above.
            let mut proposals = pending_proposals_for_run(conn, run_id, peek_limit)?;
            let truncated = proposals.len() as i64 > resolved_limit;
            proposals.truncate(resolved_limit.max(0) as usize);
            let rows: Vec<serde_json::Value> = proposals
                .iter()
                .map(|p| {
                    serde_json::json!({
                        "id": p.id,
                        "verb": p.verb,
                        "targetType": p.target_type,
                        "parentProposalId": p.parent_proposal_id,
                        "status": p.status,
                        "label": p.payload.label(),
                    })
                })
                .collect();
            Ok(serde_json::json!({ "proposals": rows, "truncated": truncated }))
        }
        other => anyhow::bail!("unknown board read kind {other:?}"),
    }
}
