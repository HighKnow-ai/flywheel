//! D-113/D-114/D-116's git-truth tick: the first job `tokio-cron-scheduler` has ever actually run
//! in this workspace. Four registrations of the same primitive — a hot tier, a cold tier, a
//! slower fetch, and phase 7 plan 07-07's slower-still forge poll — never one job with internal
//! partitioning (07-CONTEXT.md's own discretion call).
//!
//! Each job locks `AppState.db`, calls the matching sync `flywheel_core::git_facts` function,
//! DROPS the lock, then emits the shared board-invalidation event (see [`emit_board_changed`])
//! at most once per tick — only when a digest of what it just read actually changed, following
//! `sidecar.rs`'s `handle_inbound_git_lock_exhausted`
//! idiom exactly: a failure is an `eprintln!` value, never a panic, never an early return that
//! would kill the scheduler for every future tick.
//!
//! This module owns no state of its own beyond the digest map used to decide whether to emit —
//! every git fact is re-derived fresh from `git_facts_for_task` on every tick (D-75/D-128); the
//! digest is a change-detector for the notification, never an answer to any question a caller
//! asks this module.

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use flywheel_core::domain::actor::system_actor;
use flywheel_core::git_facts::{
    fetch_origin_for_project, git_facts_for_task, tracked_worktrees, GitFacts, TrackedWorktree,
    COLD_TICK_SECS, FETCH_INTERVAL_SECS, FORGE_POLL_SECS, HOT_TICK_SECS,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::state::AppState;

/// The last-emitted digest per task id, keyed so the hot and cold ticks share one map — a task
/// can only be a member of one tier at a time, but sharing avoids a duplicate "changed" emit if a
/// task ever moved tiers mid-session. Never read as an answer to any question other than "did
/// this change since the last tick" (D-75/D-128's discipline — the facts themselves always come
/// fresh from `git_facts_for_task`).
fn digests() -> &'static Mutex<HashMap<String, u64>> {
    static DIGESTS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    DIGESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A digest of `facts`' serialized form — cheap, order-stable (struct field order, not a HashMap),
/// and never stored or read as anything but a change-detector.
fn digest_of(facts: &GitFacts) -> Option<u64> {
    let serialized = serde_json::to_string(facts).ok()?;
    let mut hasher = DefaultHasher::new();
    serialized.hash(&mut hasher);
    Some(hasher.finish())
}

/// Read `task_id`'s git facts and record whether its digest changed since the last tick — the
/// caller decides what to do with that; this function never emits anything itself.
fn read_and_record_change(conn: &rusqlite::Connection, task_id: &str) -> bool {
    let facts = match git_facts_for_task(conn, task_id) {
        Ok(facts) => facts,
        Err(err) => {
            eprintln!("git-truth tick: failed to read git facts for task {task_id}: {err:#}");
            return false;
        }
    };
    let Some(facts) = facts else {
        return false;
    };
    let Some(new_digest) = digest_of(&facts) else {
        return false;
    };
    let mut map = match digests().lock() {
        Ok(map) => map,
        Err(poisoned) => poisoned.into_inner(),
    };
    let changed = map.get(task_id) != Some(&new_digest);
    map.insert(task_id.to_string(), new_digest);
    changed
}

/// The one emit site in this module for the shared `app.emit` board-invalidation event — both the
/// hot and cold tick share this, so neither literally duplicates the event name in source text.
fn emit_board_changed(app: &AppHandle) {
    let _ = app.emit("board:changed", serde_json::json!({ "entity": "git_facts" }));
}

/// D-114's hot tier: every worktree with a live agent session, unioned with whichever task's
/// detail panel is currently open (`AppState.focused_task`) — D-114's "open detail panel" half.
fn run_hot_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut conn) = state.db.lock() else {
        eprintln!("git-truth hot tick: AppState.db lock was poisoned, skipping this tick");
        return;
    };

    let mut task_ids: HashSet<String> = match tracked_worktrees(&conn, true) {
        Ok(rows) => rows.into_iter().map(|w| w.task_id).collect(),
        Err(err) => {
            eprintln!("git-truth hot tick: failed to read tracked worktrees: {err:#}");
            HashSet::new()
        }
    };
    if let Ok(focused) = state.focused_task.lock() {
        if let Some(task_id) = focused.as_ref() {
            task_ids.insert(task_id.clone());
        }
    }

    // LINK-10/D-115: the system actor, resolved once per tick in Rust (never passed in from the
    // renderer — T-01-04). Feeds the one outside-commit-detection call site below.
    let outside_commit_actor_id = match system_actor(&conn) {
        Ok(actor) => Some(actor.id),
        Err(err) => {
            eprintln!("git-truth hot tick: failed to resolve the system actor: {err:#}");
            None
        }
    };

    let mut any_changed = false;
    for task_id in &task_ids {
        if read_and_record_change(&conn, task_id) {
            any_changed = true;
        }
        // LINK-10/D-115: notice a hand-typed commit on this task's branch. Follows
        // `sidecar.rs`'s `handle_inbound_git_lock_exhausted` idiom exactly — a failure is an
        // `eprintln!` value, never a panic, never an early return that abandons the remaining
        // worktrees in this tick. A non-zero count folds into the existing digest
        // change-detector below — not a second emit channel, a second reason the one shared
        // board-invalidation emit fires.
        if let Some(actor_id) = &outside_commit_actor_id {
            match flywheel_core::git_facts::record_outside_commits(&mut conn, task_id, actor_id) {
                Ok(count) if count > 0 => any_changed = true,
                Ok(_) => {}
                Err(err) => eprintln!(
                    "git-truth hot tick: failed to notice outside commits for task {task_id}: {err:#}"
                ),
            }
        }
    }
    drop(conn);

    if any_changed {
        emit_board_changed(app);
    }
}

/// D-114's cold tier: every tracked worktree, regardless of hot-tier membership.
fn run_cold_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut conn) = state.db.lock() else {
        eprintln!("git-truth cold tick: AppState.db lock was poisoned, skipping this tick");
        return;
    };

    let task_ids: Vec<String> = match tracked_worktrees(&conn, false) {
        Ok(rows) => rows.into_iter().map(|w| w.task_id).collect(),
        Err(err) => {
            eprintln!("git-truth cold tick: failed to read tracked worktrees: {err:#}");
            Vec::new()
        }
    };

    // LINK-10/D-115: the system actor, resolved once per tick in Rust (never passed in from the
    // renderer — T-01-04). Feeds the one outside-commit-detection call site below.
    let outside_commit_actor_id = match system_actor(&conn) {
        Ok(actor) => Some(actor.id),
        Err(err) => {
            eprintln!("git-truth cold tick: failed to resolve the system actor: {err:#}");
            None
        }
    };

    let mut any_changed = false;
    for task_id in &task_ids {
        if read_and_record_change(&conn, task_id) {
            any_changed = true;
        }
        // LINK-10/D-115: see the matching comment in `run_hot_tick` — identical discipline.
        if let Some(actor_id) = &outside_commit_actor_id {
            match flywheel_core::git_facts::record_outside_commits(&mut conn, task_id, actor_id) {
                Ok(count) if count > 0 => any_changed = true,
                Ok(_) => {}
                Err(err) => eprintln!(
                    "git-truth cold tick: failed to notice outside commits for task {task_id}: {err:#}"
                ),
            }
        }
    }
    drop(conn);

    if any_changed {
        emit_board_changed(app);
    }
}

/// D-116's fetch job: `git fetch origin` for every active project, on its own slower cadence,
/// decoupled from both git-facts tiers. Never emits the board-invalidation event itself — a fetch
/// only moves `origin/<target>` and `FETCH_HEAD`'s mtime, both of which the next hot/cold tick
/// will read and digest on its own.
fn run_fetch_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(conn) = state.db.lock() else {
        eprintln!("git-truth fetch tick: AppState.db lock was poisoned, skipping this tick");
        return;
    };

    let mut stmt = match conn.prepare("SELECT id FROM projects WHERE status = 'active'") {
        Ok(stmt) => stmt,
        Err(err) => {
            eprintln!("git-truth fetch tick: failed to prepare project query: {err:#}");
            return;
        }
    };
    let project_ids: Vec<String> = match stmt.query_map([], |row| row.get(0)) {
        Ok(rows) => rows.filter_map(Result::ok).collect(),
        Err(err) => {
            eprintln!("git-truth fetch tick: failed to read active projects: {err:#}");
            Vec::new()
        }
    };

    for project_id in &project_ids {
        if let Err(err) = fetch_origin_for_project(&conn, project_id) {
            eprintln!("git-truth fetch tick: failed to fetch origin for project {project_id}: {err:#}");
        }
    }
}

/// Phase 7 plan 07-07's forge-poll job: the slowest of the four, decoupled from the three
/// git-facts ticks above — a forge read crosses the network and hits a real API rate limit a
/// local git read never does (`FORGE_POLL_SECS`'s own doc comment, `07-RESEARCH.md`'s named
/// anti-pattern). For every tracked worktree, reads the forge state for its branch and hands the
/// observation to the edge detector with the system actor resolved here in Rust — never passed in
/// from the renderer (T-01-04), following the exact resolve-once-per-tick shape
/// `run_hot_tick`/`run_cold_tick` already use for the same reason.
///
/// A forge read that errors (CLI missing, unauthenticated, network failure) is **skipped, not
/// applied** — the loop moves on to the next worktree without calling the edge detector at all,
/// so an unreachable forge can never be mistaken for a closed request. Every other failure follows
/// `sidecar.rs`'s `handle_inbound_git_lock_exhausted` idiom: a logged value, never a panic, never
/// an early return that abandons the remaining worktrees in this poll.
fn run_forge_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut conn) = state.db.lock() else {
        eprintln!("git-truth forge tick: AppState.db lock was poisoned, skipping this tick");
        return;
    };

    let worktrees: Vec<TrackedWorktree> = match tracked_worktrees(&conn, false) {
        Ok(rows) => rows,
        Err(err) => {
            eprintln!("git-truth forge tick: failed to read tracked worktrees: {err:#}");
            Vec::new()
        }
    };

    let Ok(actor) = system_actor(&conn) else {
        eprintln!("git-truth forge tick: failed to resolve the system actor, skipping this tick");
        drop(conn);
        return;
    };
    let actor_id = actor.id;

    let mut any_changed = false;
    for worktree in &worktrees {
        let observed = match flywheel_core::forge::request_for_branch(
            &conn,
            &worktree.project_id,
            &worktree.branch,
        ) {
            Ok(observed) => observed,
            Err(err) => {
                eprintln!(
                    "git-truth forge tick: forge read failed for task {} ({err}), skipping \
                     this worktree without applying an observation",
                    worktree.task_id
                );
                continue;
            }
        };

        match flywheel_core::forge::transitions::apply_forge_observation(
            &mut conn,
            &worktree.task_id,
            observed.as_ref(),
            &actor_id,
        ) {
            Ok(outcome) => {
                if outcome.status_changed_to.is_some() || outcome.events_appended > 0 {
                    any_changed = true;
                }
            }
            Err(err) => eprintln!(
                "git-truth forge tick: failed to apply forge observation for task {}: {err:#}",
                worktree.task_id
            ),
        }
    }
    drop(conn);

    if any_changed {
        emit_board_changed(app);
    }
}

/// Build, register and start the four D-113/D-114/D-116/phase-07-07 jobs against `app`'s
/// already-managed `AppState` — called once, after `app.manage(AppState { .. })`, from
/// `main.rs`'s `.setup()`.
pub async fn start_git_truth_scheduler(app: AppHandle) -> anyhow::Result<()> {
    let sched = JobScheduler::new().await?;

    let hot_app = app.clone();
    let hot_job = Job::new_repeated_async(Duration::from_secs(HOT_TICK_SECS), move |_uuid, _lock| {
        let app = hot_app.clone();
        Box::pin(async move { run_hot_tick(&app) })
    })?;
    sched.add(hot_job).await?;

    let cold_app = app.clone();
    let cold_job =
        Job::new_repeated_async(Duration::from_secs(COLD_TICK_SECS), move |_uuid, _lock| {
            let app = cold_app.clone();
            Box::pin(async move { run_cold_tick(&app) })
        })?;
    sched.add(cold_job).await?;

    let fetch_app = app.clone();
    let fetch_job =
        Job::new_repeated_async(Duration::from_secs(FETCH_INTERVAL_SECS), move |_uuid, _lock| {
            let app = fetch_app.clone();
            Box::pin(async move { run_fetch_tick(&app) })
        })?;
    sched.add(fetch_job).await?;

    let forge_app = app.clone();
    let forge_job =
        Job::new_repeated_async(Duration::from_secs(FORGE_POLL_SECS), move |_uuid, _lock| {
            let app = forge_app.clone();
            Box::pin(async move { run_forge_tick(&app) })
        })?;
    sched.add(forge_job).await?;

    sched.start().await?;

    Ok(())
}
