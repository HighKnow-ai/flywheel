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
//!
//! Phase 07 plan 07-11 (closing verification Gap 1 / code review CR-01): the forge and fetch jobs
//! run their subprocess calls — `gh`/`glab` and `git fetch` — with **no lock held at all**.
//! `AppState.db` is a single app-wide `Mutex<Connection>` every Tauri command locks as its first
//! statement; a tick that held that mutex across an unbounded-latency network call would freeze
//! every other command for as long as the call took. Both jobs are therefore split into named
//! phases: read the work list under the lock, release the lock, run the network phase through a
//! function whose signature carries no `Connection` (the type is the enforcement, not a comment),
//! then — forge only — re-acquire the lock briefly to write. The hot and cold tiers above never
//! leave the local filesystem, so they keep their original single-lock shape unchanged.

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use flywheel_core::domain::actor::system_actor;
use flywheel_core::forge::{Forge, ForgeRequest};
use flywheel_core::git_facts::{
    git_facts_for_task, tracked_worktrees, GitFacts, TrackedWorktree, COLD_TICK_SECS,
    FETCH_INTERVAL_SECS, FORGE_POLL_SECS, HOT_TICK_SECS,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::state::AppState;

/// One worktree's forge poll target, already resolved to a forge and repo path (phase 07 plan
/// 07-11) — [`poll_forge_targets`] takes a slice of these and no `Connection`, which is what
/// guarantees the network phase runs with no lock held.
struct ForgePollTarget {
    task_id: String,
    forge: Forge,
    repo_path: std::path::PathBuf,
    branch: String,
}

/// One forge poll's outcome, carrying only what [`apply_forge_results`] needs to re-acquire the
/// lock and write.
struct ForgePollResult {
    task_id: String,
    observed: Option<ForgeRequest>,
}

/// One active project's fetch target — just enough for [`fetch_origin_for_targets`] to call
/// [`flywheel_core::git::fetch_origin`] with no connection in scope.
struct FetchTarget {
    project_id: String,
    repo_path: String,
}

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

/// Phase one of the fetch tick: every active project's id and repo path, read under the lock. The
/// returned `Vec` owns its data, so the prepared statement (which borrows `conn`) is dropped
/// before this function returns and before the caller releases the connection guard.
fn fetch_tick_targets(conn: &rusqlite::Connection) -> Vec<FetchTarget> {
    let mut stmt = match conn.prepare("SELECT id, repo_path FROM projects WHERE status = 'active'")
    {
        Ok(stmt) => stmt,
        Err(err) => {
            eprintln!("git-truth fetch tick: failed to prepare project query: {err:#}");
            return Vec::new();
        }
    };
    let targets: Vec<FetchTarget> = match stmt.query_map([], |row| {
        Ok(FetchTarget { project_id: row.get(0)?, repo_path: row.get(1)? })
    }) {
        Ok(rows) => rows.filter_map(Result::ok).collect(),
        Err(err) => {
            eprintln!("git-truth fetch tick: failed to read active projects: {err:#}");
            Vec::new()
        }
    };
    targets
}

/// Phase two of the fetch tick: `git fetch origin` for every target. Takes NO connection — that
/// absence is the fix: this function runs with no lock held at all, so a hung `git fetch` can
/// never block any other command. A fetch writes nothing to the database, so there is no write
/// phase to follow this one.
fn fetch_origin_for_targets(targets: &[FetchTarget]) {
    for target in targets {
        if let Err(err) =
            flywheel_core::git::fetch_origin(std::path::Path::new(&target.repo_path))
        {
            eprintln!(
                "git-truth fetch tick: failed to fetch origin for project {}: {err:#}",
                target.project_id
            );
        }
    }
}

/// D-116's fetch job: `git fetch origin` for every active project, on its own slower cadence,
/// decoupled from both git-facts tiers. Never emits the board-invalidation event itself — a fetch
/// only moves `origin/<target>` and `FETCH_HEAD`'s mtime, both of which the next hot/cold tick
/// will read and digest on its own.
///
/// Phase 07 plan 07-11: acquires the lock once to build the target list, releases it with an
/// explicit `drop`, then runs every fetch with no lock held. A tick with no active projects
/// returns right after the (single) lock acquisition, never touching the network phase.
fn run_fetch_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(conn) = state.db.lock() else {
        eprintln!("git-truth fetch tick: AppState.db lock was poisoned, skipping this tick");
        return;
    };

    let targets = fetch_tick_targets(&conn);
    drop(conn);

    if targets.is_empty() {
        return;
    }

    fetch_origin_for_targets(&targets);
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
///
/// Phase 07 plan 07-11 restructures this tick into three named phases — [`forge_tick_targets`]
/// (read, under the lock), [`poll_forge_targets`] (the network phase, no connection at all) and
/// [`apply_forge_results`] (write, under a briefly re-acquired lock) — so the forge CLI never runs
/// while `AppState.db` is held.

/// Phase one of the forge tick: every tracked worktree's forge poll target, read under the lock.
/// Resolves each distinct `project_id` exactly once through
/// [`flywheel_core::forge::forge_and_repo_path`], memoised in a local map — several worktrees in
/// the same project cost one resolution, not one per worktree. A worktree whose project fails to
/// resolve is logged and omitted from the returned list; the remaining worktrees are unaffected.
fn forge_tick_targets(conn: &rusqlite::Connection) -> Vec<ForgePollTarget> {
    let worktrees: Vec<TrackedWorktree> = match tracked_worktrees(conn, false) {
        Ok(rows) => rows,
        Err(err) => {
            eprintln!("git-truth forge tick: failed to read tracked worktrees: {err:#}");
            Vec::new()
        }
    };

    let mut resolved: HashMap<String, (Forge, std::path::PathBuf)> = HashMap::new();
    let mut targets = Vec::with_capacity(worktrees.len());
    for worktree in worktrees {
        let resolution = if let Some(cached) = resolved.get(&worktree.project_id) {
            Some(cached.clone())
        } else {
            match flywheel_core::forge::forge_and_repo_path(conn, &worktree.project_id) {
                Ok(pair) => {
                    resolved.insert(worktree.project_id.clone(), pair.clone());
                    Some(pair)
                }
                Err(err) => {
                    eprintln!(
                        "git-truth forge tick: failed to resolve forge for project {} (task {}): \
                         {err:#}, skipping this worktree",
                        worktree.project_id, worktree.task_id
                    );
                    None
                }
            }
        };
        if let Some((forge, repo_path)) = resolution {
            targets.push(ForgePollTarget {
                task_id: worktree.task_id,
                forge,
                repo_path,
                branch: worktree.branch,
            });
        }
    }
    targets
}

/// Phase two of the forge tick: poll every target's forge. Takes NO connection — that absence is
/// the fix: this function runs with no lock held at all, so a hung `gh`/`glab` can never block any
/// other command. A read that errors is logged and skipped, never applied — an unreachable forge
/// must never be mistaken for a closed request.
fn poll_forge_targets(targets: &[ForgePollTarget]) -> Vec<ForgePollResult> {
    let mut results = Vec::with_capacity(targets.len());
    for target in targets {
        let observed = match flywheel_core::forge::request_for_branch_at(
            target.forge,
            &target.repo_path,
            &target.branch,
        ) {
            Ok(observed) => observed,
            Err(err) => {
                eprintln!(
                    "git-truth forge tick: forge read failed for task {} ({err}), skipping \
                     this worktree without applying an observation",
                    target.task_id
                );
                continue;
            }
        };
        results.push(ForgePollResult { task_id: target.task_id.clone(), observed });
    }
    results
}

/// Phase three of the forge tick: apply every poll result through the edge detector, under a
/// briefly re-acquired lock. Returns whether anything changed, so the caller knows whether to emit
/// the shared board-invalidation event.
fn apply_forge_results(
    conn: &mut rusqlite::Connection,
    results: &[ForgePollResult],
    actor_id: &str,
) -> bool {
    let mut any_changed = false;
    for result in results {
        match flywheel_core::forge::transitions::apply_forge_observation(
            conn,
            &result.task_id,
            result.observed.as_ref(),
            actor_id,
        ) {
            Ok(outcome) => {
                if outcome.status_changed_to.is_some() || outcome.events_appended > 0 {
                    any_changed = true;
                }
            }
            Err(err) => eprintln!(
                "git-truth forge tick: failed to apply forge observation for task {}: {err:#}",
                result.task_id
            ),
        }
    }
    any_changed
}

fn run_forge_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(conn) = state.db.lock() else {
        eprintln!("git-truth forge tick: AppState.db lock was poisoned, skipping this tick");
        return;
    };

    let targets = forge_tick_targets(&conn);

    let Ok(actor) = system_actor(&conn) else {
        eprintln!("git-truth forge tick: failed to resolve the system actor, skipping this tick");
        drop(conn);
        return;
    };
    let actor_id = actor.id;
    drop(conn);

    if targets.is_empty() {
        return;
    }

    let results = poll_forge_targets(&targets);

    if results.is_empty() {
        return;
    }

    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut conn) = state.db.lock() else {
        eprintln!(
            "git-truth forge tick: AppState.db lock was poisoned while re-acquiring to write, \
             skipping the write phase"
        );
        return;
    };
    let any_changed = apply_forge_results(&mut conn, &results, &actor_id);
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
