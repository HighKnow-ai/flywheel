//! `fleet_list` — Phase 10 plan 10-01's cross-project fleet read (FLEET-01, FLEET-04, D-163..D-171):
//! every agent run across every registered project, banded and ordered by the Rust core, in ONE
//! call.
//!
//! Read-only, and it takes NO arguments at all: no project id (D-14 — one database holds every
//! project), no path, no ref, no actor. There is therefore no parameter a renderer could widen, and
//! the window is capped server-side. No git process runs here. Plan 10-03 adds one bounded file read
//! per LIVE row (the end of that run's session log, for the activity cell), so the command takes the
//! `async` + `spawn_blocking` shape `board_change_flags` uses: the database lock is released first and
//! the file reads run off the IPC thread.

use serde::Serialize;
use tauri::State;

use super::emit_board_changed;

use super::ipc_error;
use crate::state::AppState;

/// The server-side cap on the fleet window (T-10-01-02/03) — applied here, before the call into
/// `packages/core`, like `BOARD_CHANGE_FLAGS_CAP`. Equal to the core's own backstop clamp.
const FLEET_ROWS_CAP: usize = 200;

/// Mirrors `flywheel_core::query::fleet::FleetRow` field-for-field. `fleetState` is the derived state
/// the renderer draws.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetRowDto {
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
    pub blocked_since: Option<String>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    /// The title of the Story's *doing* Task, or null when none is doing.
    pub doing_task_title: Option<String>,
    /// The end of this run's session log, for the activity cell (plan 10-03, D-167). Always empty for
    /// a run that is not live.
    pub activity: FleetActivityDto,
}

/// Raw tail lines, NOT a rendered string: the normaliser that turns log lines into the line the
/// fleet shows lives in the renderer (the session feed's own `buildFeedRows`) and must not be
/// duplicated here. An empty `lines` is how the renderer tells "nothing to show" from a value;
/// `truncated` separates "nothing there" from "there, but it did not fit the read window".
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetActivityDto {
    pub lines: Vec<String>,
    pub truncated: bool,
}

impl From<flywheel_core::query::fleet::FleetRow> for FleetRowDto {
    fn from(row: flywheel_core::query::fleet::FleetRow) -> Self {
        Self {
            session_id: row.session_id,
            project_id: row.project_id,
            project_name: row.project_name,
            project_key_prefix: row.project_key_prefix,
            project_status: row.project_status,
            story_id: row.story_id,
            story_key: row.story_key,
            story_title: row.story_title,
            story_state: row.story_state,
            run_status: row.run_status,
            fleet_state: row.fleet_state,
            started_at: row.started_at,
            ended_at: row.ended_at,
            blocked_since: row.blocked_since,
            cost_usd: row.cost_usd,
            tokens_in: row.tokens_in,
            tokens_out: row.tokens_out,
            doing_task_title: row.doing_task_title,
            activity: FleetActivityDto::default(),
        }
    }
}

/// Mirrors `flywheel_core::query::fleet::ShapingFleetRow` (issue #239): a live shaping session, named by
/// the Epic, the Milestone or the Roadmap it shapes, with the end of its log for the activity cell.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapingFleetRowDto {
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub project_status: String,
    /// `epic`, `milestone` or `roadmap`.
    pub subject: String,
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub epic_title: Option<String>,
    pub milestone_id: Option<String>,
    pub milestone_title: Option<String>,
    pub run_status: String,
    /// `blocked` while a Round it holds waits on the developer, else `running`.
    pub fleet_state: String,
    pub started_at: String,
    pub blocked_since: Option<String>,
    pub activity: FleetActivityDto,
}

impl From<flywheel_core::query::fleet::ShapingFleetRow> for ShapingFleetRowDto {
    fn from(row: flywheel_core::query::fleet::ShapingFleetRow) -> Self {
        Self {
            session_id: row.session_id,
            project_id: row.project_id,
            project_name: row.project_name,
            project_key_prefix: row.project_key_prefix,
            project_status: row.project_status,
            subject: row.subject,
            epic_id: row.epic_id,
            epic_key: row.epic_key,
            epic_title: row.epic_title,
            milestone_id: row.milestone_id,
            milestone_title: row.milestone_title,
            run_status: row.run_status,
            fleet_state: row.fleet_state,
            started_at: row.started_at,
            blocked_since: row.blocked_since,
            activity: FleetActivityDto::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetListDto {
    pub rows: Vec<FleetRowDto>,
    /// Every live shaping session (issue #239): agents with no Story, kept apart from `rows`.
    pub shaping_rows: Vec<ShapingFleetRowDto>,
    pub total_rows: usize,
    /// Sum of the visible rows' recorded costs, or null when none has one. An estimate (bundled
    /// price table), computed by the core read so the renderer never sums.
    pub visible_cost_usd: Option<f64>,
}

/// A live run is one a person could be watching: its activity line is a liveness signal, so a
/// terminal row never gets one (and is never read).
fn is_live(run_status: &str) -> bool {
    matches!(run_status, "running" | "blocked")
}

/// Fill `activity` for every live row, reading each run's log tail through `read`. A row whose read
/// fails keeps the empty default, which the renderer draws as an explicit absence — one unreadable
/// log must not fail the whole fleet. `read` is a parameter so a test can count the calls.
fn attach_activity(
    rows: &mut [FleetRowDto],
    read: impl Fn(&str) -> anyhow::Result<flywheel_core::session_log::LogTail>,
) {
    for row in rows.iter_mut().filter(|row| is_live(&row.run_status)) {
        if let Ok(tail) = read(&row.session_id) {
            row.activity = FleetActivityDto {
                lines: tail.lines,
                truncated: tail.truncated,
            };
        }
    }
}

/// Every agent run across every registered project that belongs on the fleet (capped), with the end
/// of each live run's log for the activity cell. Read-only, cross-project by design, accepts no
/// arguments.
#[tauri::command(async)]
pub async fn fleet_list(state: State<'_, AppState>) -> Result<FleetListDto, String> {
    let list = {
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("fleet_list:lock", e))?;
        let list = flywheel_core::query::fleet::fleet_rows(&conn, FLEET_ROWS_CAP)
            .map_err(|e| ipc_error("fleet_list:read", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        list?
    };

    let total_rows = list.total_rows;
    let visible_cost_usd = list.visible_cost_usd;
    let mut rows: Vec<FleetRowDto> = list.rows.into_iter().map(FleetRowDto::from).collect();
    let mut shaping_rows: Vec<ShapingFleetRowDto> = list
        .shaping_rows
        .into_iter()
        .map(ShapingFleetRowDto::from)
        .collect();
    let (rows, shaping_rows) = tauri::async_runtime::spawn_blocking(move || {
        attach_activity(&mut rows, flywheel_core::session_log::read_tail);
        // Every shaping row is live, so each gets its log's end, through the same read.
        for row in shaping_rows.iter_mut() {
            if let Ok(tail) = flywheel_core::session_log::read_tail(&row.session_id) {
                row.activity = FleetActivityDto {
                    lines: tail.lines,
                    truncated: tail.truncated,
                };
            }
        }
        (rows, shaping_rows)
    })
    .await
    .map_err(|e| ipc_error("fleet_list:tail", e))?;

    Ok(FleetListDto {
        total_rows,
        visible_cost_usd,
        rows,
        shaping_rows,
    })
}

/// The server-side cap on the blocked queue (T-10-05-04), equal to the core's backstop clamp.
const BLOCKED_QUEUE_CAP: usize = 200;

/// Mirrors `flywheel_core::query::fleet::BlockedQueueEntry` field-for-field: the pending request the
/// permission card renders, plus the session, project and Story the queue row names.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedQueueEntryDto {
    pub request_id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub created_at: String,
    pub destructive_category: Option<String>,
    /// The rule the card pre-fills, or `None` for a Gated action (`session::card_suggested_rule`).
    pub suggested_rule: Option<String>,
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    pub blocked_since: String,
}

impl From<flywheel_core::query::fleet::BlockedQueueEntry> for BlockedQueueEntryDto {
    fn from(e: flywheel_core::query::fleet::BlockedQueueEntry) -> Self {
        let suggested_rule = super::session::card_suggested_rule(
            &e.tool_name,
            e.input_payload.as_deref(),
            e.destructive_category.as_deref(),
        );
        Self {
            suggested_rule,
            request_id: e.request_id,
            tool_name: e.tool_name,
            input_payload: e.input_payload,
            created_at: e.created_at,
            destructive_category: e.destructive_category,
            session_id: e.session_id,
            project_id: e.project_id,
            project_name: e.project_name,
            project_key_prefix: e.project_key_prefix,
            story_id: e.story_id,
            story_key: e.story_key,
            story_title: e.story_title,
            blocked_since: e.blocked_since,
        }
    }
}

/// Every agent across every registered project currently blocked at a pending permission request
/// (FLEET-02, D-172): live blocks only, one entry per run. Read-only, cross-project by design, takes
/// no arguments. Answering goes through the existing, unchanged `session_answer_permission` (D-173).
/// Pure database read, so it is a plain sync command like the other short reads.
#[tauri::command]
pub fn fleet_blocked_queue(
    state: State<'_, AppState>,
) -> Result<Vec<BlockedQueueEntryDto>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| ipc_error("fleet_blocked_queue:lock", e))?;
    let entries = flywheel_core::query::fleet::blocked_queue(&conn, BLOCKED_QUEUE_CAP)
        .map_err(|e| ipc_error("fleet_blocked_queue:read", e))?;
    Ok(entries
        .into_iter()
        .map(BlockedQueueEntryDto::from)
        .collect())
}

/// The server-side cap on the waiting-Rounds window.
const WAITING_ROUNDS_CAP: usize = 200;

/// Mirrors `flywheel_core::query::fleet::WaitingRound` field-for-field (issue #124): a shaping Round
/// a live session is held on, with the Epic or the Milestone (issue #132) it shapes and how far it is
/// answered.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitingRoundDto {
    pub round_id: String,
    pub round_number: i64,
    /// `epic` for an Epic's Round, `roadmap` for a roadmap Round (issue #133).
    pub subject: String,
    /// `None` for a roadmap Round, which has no Stage.
    pub stage_kind: Option<String>,
    pub session_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    /// The Epic an Epic's Round shapes; `None` for a Milestone's or a roadmap Round.
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub epic_title: Option<String>,
    /// The Milestone a Milestone's Round shapes (issue #132); `None` for any other Round.
    pub milestone_id: Option<String>,
    pub milestone_title: Option<String>,
    pub waiting_since: String,
    pub answered: i64,
    pub questions: i64,
}

impl From<flywheel_core::query::fleet::WaitingRound> for WaitingRoundDto {
    fn from(r: flywheel_core::query::fleet::WaitingRound) -> Self {
        Self {
            round_id: r.round_id,
            round_number: r.round_number,
            subject: r.subject,
            stage_kind: r.stage_kind,
            session_id: r.session_id,
            project_id: r.project_id,
            project_name: r.project_name,
            project_key_prefix: r.project_key_prefix,
            epic_id: r.epic_id,
            epic_key: r.epic_key,
            epic_title: r.epic_title,
            milestone_id: r.milestone_id,
            milestone_title: r.milestone_title,
            waiting_since: r.waiting_since,
            answered: r.answered,
            questions: r.questions,
        }
    }
}

/// Every shaping Round waiting on you across every registered project (issue #124): what lights a
/// Round's lamp and joins the sidebar's Waiting-on-you count. Read-only, takes no arguments.
#[tauri::command]
pub fn fleet_waiting_rounds(state: State<'_, AppState>) -> Result<Vec<WaitingRoundDto>, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| ipc_error("fleet_waiting_rounds:lock", e))?;
    let rounds = flywheel_core::query::fleet::waiting_rounds(&conn, WAITING_ROUNDS_CAP)
        .map_err(|e| ipc_error("fleet_waiting_rounds:read", e))?;
    Ok(rounds.into_iter().map(WaitingRoundDto::from).collect())
}

/// Declares which agent run's session surface is the visible one (D-174), so a notification for
/// the session the user is already watching can be withheld. Writes `AppState.watched_run` and
/// nothing else; `None` means no session is showing. Suppression additionally needs the window to
/// be focused, which Rust reads itself at fire time (T-10-07-03).
#[tauri::command]
pub fn fleet_watch_run(state: State<AppState>, session_id: Option<String>) -> Result<(), String> {
    set_watched_run(&state, session_id)
}

fn set_watched_run(state: &AppState, session_id: Option<String>) -> Result<(), String> {
    let mut watched = state.watched_run.lock().map_err(|e| e.to_string())?;
    *watched = session_id;
    Ok(())
}

/// The server-side cap on the worktree inventory window (T-10-08-02).
const WORKTREE_INVENTORY_CAP: usize = 500;

/// Mirrors `flywheel_core::query::fleet::WorktreeInventoryRow`. `disposition` is `reclaimable`,
/// `in_use` or `keep`, and `reason` is the closed `ReclaimReason` word that justifies it, so a row
/// never reaches the renderer without its basis. `sizeBytes` and `sizeMeasuredAt` are null until the
/// worktree is first measured; null renders blank, never `0 B`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInventoryRowDto {
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    pub story_state: String,
    pub project_id: String,
    pub project_name: String,
    pub project_status: String,
    pub branch: String,
    pub size_bytes: Option<i64>,
    pub size_measured_at: Option<String>,
    pub disposition: String,
    pub reason: String,
}

impl From<flywheel_core::query::fleet::WorktreeInventoryRow> for WorktreeInventoryRowDto {
    fn from(row: flywheel_core::query::fleet::WorktreeInventoryRow) -> Self {
        Self {
            story_id: row.story_id,
            story_key: row.story_key,
            story_title: row.story_title,
            story_state: row.story_state,
            project_id: row.project_id,
            project_name: row.project_name,
            project_status: row.project_status,
            branch: row.branch,
            size_bytes: row.size_bytes,
            size_measured_at: row.size_measured_at,
            disposition: row.disposition.as_str().to_string(),
            reason: row.disposition.reason().as_str().to_string(),
        }
    }
}

/// Every Story worktree across every registered project with its cached size and a derived, named
/// disposition (WORK-07, D-177, D-178). Read-only, cross-project, takes no arguments. The board half
/// runs under the database lock; the git half (ancestry check, porcelain read) runs on the blocking
/// pool after the lock is released.
#[tauri::command(async)]
pub async fn worktree_inventory(
    state: State<'_, AppState>,
) -> Result<Vec<WorktreeInventoryRowDto>, String> {
    let inputs = {
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("worktree_inventory:lock", e))?;
        let inputs =
            flywheel_core::query::fleet::worktree_inventory_inputs(&conn, WORKTREE_INVENTORY_CAP)
                .map_err(|e| ipc_error("worktree_inventory:read", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        inputs?
    };

    let rows = tauri::async_runtime::spawn_blocking(move || {
        flywheel_core::query::fleet::finish_worktree_inventory(inputs)
    })
    .await
    .map_err(|e| ipc_error("worktree_inventory:join", e))?;

    Ok(rows
        .into_iter()
        .map(WorktreeInventoryRowDto::from)
        .collect())
}

/// The server-side cap on how many worktrees one measure call may walk (T-10-08-02). Smaller than
/// [`WORKTREE_INVENTORY_CAP`] on purpose, to bound one call's walking time; "measure all" orders
/// stalest-first so repeated presses reach every row (WR-03).
const WORKTREE_MEASURE_CAP: usize = 200;

/// One worktree's measurement outcome. `sizeBytes` is null when the walk was bounded or failed, in
/// which case nothing was cached; `bounded` says the figure would have been a lower bound.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMeasureDto {
    pub story_id: String,
    pub size_bytes: Option<i64>,
    pub bounded: bool,
    pub error: Option<String>,
}

/// Measure the disk usage of the named Stories' worktrees (all of them when none are named) and cache
/// each result with the moment it was taken. Takes ids only: every path is read from the
/// `worktrees` rows, the walk never follows a symlink and is bounded, and it runs on the blocking
/// pool with the database lock released. A bounded walk is reported and not cached, because a
/// lower bound is not a size.
#[tauri::command(async)]
pub async fn worktree_measure(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    story_ids: Option<Vec<String>>,
) -> Result<Vec<WorktreeMeasureDto>, String> {
    // An over-long explicit list is refused as a whole, never silently truncated (WR-03).
    if let Some(ids) = &story_ids {
        if ids.len() > WORKTREE_MEASURE_CAP {
            return Err(format!(
                "worktree_measure refused: {} worktrees named, at most {WORKTREE_MEASURE_CAP} at a time",
                ids.len()
            ));
        }
    }
    let targets = {
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("worktree_measure:lock", e))?;
        let targets = flywheel_core::query::fleet::worktree_measure_targets(
            &conn,
            story_ids.as_deref(),
            WORKTREE_MEASURE_CAP,
        )
        .map_err(|e| ipc_error("worktree_measure:read", e));
        // Released explicitly: the walk below can take seconds and must never hold the mutex.
        drop(conn);
        targets?
    };

    let walked = tauri::async_runtime::spawn_blocking(move || {
        targets
            .into_iter()
            .map(|t| {
                let result =
                    flywheel_core::domain::worktree::worktree_size(std::path::Path::new(&t.path));
                (t.story_id, result)
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| ipc_error("worktree_measure:join", e))?;

    let measured_at = chrono::Utc::now().to_rfc3339();
    let mut out = Vec::with_capacity(walked.len());
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("worktree_measure:lock", e))?;
        for (story_id, result) in walked {
            out.push(match result {
                Ok(size) if !size.bounded => {
                    let bytes = i64::try_from(size.bytes).unwrap_or(i64::MAX);
                    match flywheel_core::query::fleet::record_worktree_size(
                        &conn,
                        &story_id,
                        bytes,
                        &measured_at,
                    ) {
                        Ok(true) => WorktreeMeasureDto {
                            story_id,
                            size_bytes: Some(bytes),
                            bounded: false,
                            error: None,
                        },
                        // No row was updated: the worktree was reclaimed or forgotten while the walk ran,
                        // so nothing was cached and the renderer must not be told otherwise.
                        Ok(false) => WorktreeMeasureDto {
                            story_id,
                            size_bytes: None,
                            bounded: false,
                            error: Some("worktree no longer exists".to_string()),
                        },
                        Err(e) => WorktreeMeasureDto {
                            story_id,
                            size_bytes: None,
                            bounded: false,
                            error: Some(e.to_string()),
                        },
                    }
                }
                Ok(_) => WorktreeMeasureDto {
                    story_id,
                    size_bytes: None,
                    bounded: true,
                    error: None,
                },
                Err(e) => WorktreeMeasureDto {
                    story_id,
                    size_bytes: None,
                    bounded: false,
                    error: Some(e.to_string()),
                },
            });
        }
    }
    // The fleet inventory spans every project: broadcast.
    emit_board_changed(&app, None, "worktree_size", None);
    Ok(out)
}

/// The server-side cap on one reclaim batch (T-10-09-04). Refuses an oversized list as a whole.
pub const RECLAIM_BATCH_CAP: usize = 50;

/// One selected worktree's outcome (WORK-07, D-179). `removed` is the only success claim; a refused
/// row carries `reason` (a closed `ReclaimReason` word: it was not, or no longer is, reclaimable)
/// or `error` (it was reclaimable but the removal itself failed, or the id named nothing).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimOutcomeDto {
    pub story_id: String,
    pub removed: bool,
    pub reason: Option<String>,
    pub error: Option<String>,
}

impl From<flywheel_core::domain::worktree::ReclaimOutcome> for ReclaimOutcomeDto {
    fn from(o: flywheel_core::domain::worktree::ReclaimOutcome) -> Self {
        Self {
            story_id: o.story_id,
            removed: o.removed,
            reason: o.reason.map(|r| r.as_str().to_string()),
            error: o.error,
        }
    }
}

/// Refuses a batch longer than [`RECLAIM_BATCH_CAP`] before anything is removed.
fn check_reclaim_batch(len: usize) -> Result<(), String> {
    if len > RECLAIM_BATCH_CAP {
        return Err(format!("worktree_reclaim refused: {len} worktrees selected, at most {RECLAIM_BATCH_CAP} at a time"));
    }
    Ok(())
}

/// Reclaim the named Stories' worktrees (WORK-07, D-179). Takes Story ids and NOTHING else: no path, ref,
/// sha, actor, and no parameter of any kind that could skip a guard. Per row, the core re-derives
/// eligibility with the inventory's own function (so a selection that went stale is refused) and
/// then calls the unchanged `remove_worktree_for_story`, whose own `git status --porcelain` re-read
/// remains the final guard. Results are per row; one refusal never fails the batch.
///
/// Like `worktree_remove`, this never holds the shared database mutex across a git call and never
/// runs git on the IPC thread: the mutex is taken only to resolve the actor, then
/// the batch runs on the blocking pool over a connection of its own (WAL plus `busy_timeout`),
/// each Story under its work lock ([`reclaim_with_story_work`]).
#[tauri::command(async)]
pub async fn worktree_reclaim(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    story_ids: Vec<String>,
) -> Result<Vec<ReclaimOutcomeDto>, String> {
    check_reclaim_batch(story_ids.len())?;

    let actor = {
        let conn = state
            .db
            .lock()
            .map_err(|e| ipc_error("worktree_reclaim:lock", e))?;
        let actor = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .map_err(|e| ipc_error("worktree_reclaim:actor", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        actor?
    };
    let db_path = super::board_path(&state.db)?;

    let outcomes = tauri::async_runtime::spawn_blocking(move || {
        reclaim_with_story_work(&db_path, &story_ids, &actor)
    })
    .await
    .map_err(|e| ipc_error("worktree_reclaim:join", e))?
    .map_err(|e| ipc_error("worktree_reclaim:git", e))?;

    // A reclaim batch can span projects, and no single project is honest here: broadcast.
    emit_board_changed(&app, None, "worktree", None);
    Ok(outcomes.into_iter().map(ReclaimOutcomeDto::from).collect())
}

/// Reclaim each of `story_ids` on a connection of its own on the database at `db_path`, each one
/// holding its Story's work lock ([`super::story_work`], issue #220), so a reclaim never interleaves
/// with a Start, a Drop or a Merge on the same Story. One Story's lock at a time: a batch never
/// holds two, so it cannot deadlock against another command.
pub fn reclaim_with_story_work(
    db_path: &std::path::Path,
    story_ids: &[String],
    actor: &str,
) -> anyhow::Result<Vec<flywheel_core::domain::worktree::ReclaimOutcome>> {
    let mut conn = super::open_beside(db_path).map_err(anyhow::Error::msg)?;
    let mut seen = std::collections::HashSet::new();
    let mut outcomes = Vec::new();
    for story_id in story_ids.iter().filter(|id| seen.insert(id.as_str())) {
        outcomes.extend(super::with_story_work(story_id, || {
            flywheel_core::domain::worktree::reclaim_worktrees(
                &mut conn,
                std::slice::from_ref(story_id),
                actor,
            )
        }));
    }
    Ok(outcomes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flywheel_core::session_log::LogTail;
    use std::cell::Cell;

    fn row(id: &str, run_status: &str) -> FleetRowDto {
        FleetRowDto {
            session_id: id.to_string(),
            project_id: "p".into(),
            project_name: "P".into(),
            project_key_prefix: "P".into(),
            project_status: "active".into(),
            story_id: "s".into(),
            story_key: "P-1".into(),
            story_title: "A Story".into(),
            story_state: "running".into(),
            run_status: run_status.into(),
            fleet_state: run_status.into(),
            started_at: "2026-10-12T00:00:00Z".into(),
            ended_at: None,
            blocked_since: None,
            cost_usd: None,
            tokens_in: None,
            tokens_out: None,
            doing_task_title: None,
            activity: FleetActivityDto::default(),
        }
    }

    fn tail(line: &str) -> anyhow::Result<LogTail> {
        Ok(LogTail {
            lines: vec![line.to_string()],
            truncated: false,
        })
    }

    #[test]
    fn fleet_watch_run_sets_the_field_and_clears_it_when_passed_nothing() {
        let state = AppState {
            db: std::sync::Mutex::new(rusqlite::Connection::open_in_memory().unwrap()),
            sidecar: None,
            pending_orphans: std::sync::Mutex::new(Vec::new()),
            focused_story: std::sync::Mutex::new(None),
            watched_run: std::sync::Mutex::new(None),
        };
        set_watched_run(&state, Some("run-1".into())).unwrap();
        assert_eq!(state.watched_run.lock().unwrap().as_deref(), Some("run-1"));
        set_watched_run(&state, None).unwrap();
        assert_eq!(*state.watched_run.lock().unwrap(), None);
    }

    #[test]
    fn only_live_rows_are_read_and_terminal_rows_never_are() {
        let calls = Cell::new(0);
        let mut rows = vec![
            row("a", "running"),
            row("b", "blocked"),
            row("c", "completed"),
            row("d", "failed"),
            row("e", "interrupted"),
            row("f", "abandoned"),
        ];
        attach_activity(&mut rows, |_| {
            calls.set(calls.get() + 1);
            tail("{}")
        });
        assert_eq!(calls.get(), 2);
        assert_eq!(rows[0].activity.lines, vec!["{}".to_string()]);
        assert_eq!(rows[1].activity.lines, vec!["{}".to_string()]);
        assert!(rows[2..].iter().all(|r| r.activity.lines.is_empty()));
    }

    #[test]
    fn a_database_whose_only_runs_are_terminal_makes_no_read_at_all() {
        let calls = Cell::new(0);
        let mut rows = vec![row("a", "completed"), row("b", "abandoned")];
        attach_activity(&mut rows, |_| {
            calls.set(calls.get() + 1);
            tail("{}")
        });
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn a_failed_read_leaves_that_row_empty_and_does_not_fail_the_rest() {
        let mut rows = vec![row("bad", "running"), row("good", "running")];
        attach_activity(&mut rows, |id| {
            if id == "bad" {
                Err(anyhow::anyhow!("nope"))
            } else {
                tail("{}")
            }
        });
        assert!(rows[0].activity.lines.is_empty());
        assert_eq!(rows[1].activity.lines.len(), 1);
    }

    #[test]
    fn the_truncated_flag_is_carried_through() {
        let mut rows = vec![row("a", "running")];
        attach_activity(&mut rows, |_| {
            Ok(LogTail {
                lines: Vec::new(),
                truncated: true,
            })
        });
        assert!(rows[0].activity.truncated);
    }

    #[test]
    fn a_reclaim_batch_over_the_cap_is_refused_whole_and_one_at_the_cap_is_not() {
        assert!(check_reclaim_batch(0).is_ok());
        assert!(check_reclaim_batch(RECLAIM_BATCH_CAP).is_ok());
        assert!(check_reclaim_batch(RECLAIM_BATCH_CAP + 1).is_err());
    }
}
