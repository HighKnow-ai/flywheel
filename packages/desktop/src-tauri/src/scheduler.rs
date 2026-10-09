//! D-113/D-114/D-116's git-truth tick: the first job `tokio-cron-scheduler` has ever actually run
//! in this workspace. Five registrations of the same primitive — a hot tier, a cold tier, a
//! slower fetch, phase 7 plan 07-07's slower-still forge poll, and phase 9 plan 09-07's fan-out
//! dispatch tick — never one job with internal partitioning (07-CONTEXT.md's own discretion
//! call).
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
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// The task's status as of this read (quick task 261005-mn5) — carried through
    /// [`ForgePollResult`] so [`apply_forge_results`] can pass it as the compare-and-swap
    /// precondition on the write, surviving the lock-release window between this read and that
    /// write.
    status_at_poll: String,
}

/// One forge poll's outcome, carrying only what [`apply_forge_results`] needs to re-acquire the
/// lock and write.
struct ForgePollResult {
    task_id: String,
    observed: Option<ForgeRequest>,
    /// Copied from the matching [`ForgePollTarget`] (quick task 261005-mn5) — the status as of
    /// phase one's read, whose survival across the lock-release window is the whole point.
    status_at_poll: String,
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
/// while `AppState.db` is held. Quick task 261005-mn5: that restructure opened a lock-release
/// window a manual status change can land inside, between phase one's read and phase three's
/// write. What makes the write phase safe against that is each target's status captured in phase
/// one (`ForgePollTarget::status_at_poll`) surviving unchanged through phase two into phase
/// three's call to `apply_forge_observation`, which refuses the status write unless the task is
/// still at that captured status when the write actually runs.

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
            // Quick task 261005-mn5: read the task's status now, while still under the lock —
            // this is the value that must survive the lock-release window below unchanged for
            // the write phase's compare-and-swap to mean anything. A failed read is logged and
            // this worktree is omitted, following this function's own established idiom above.
            let status_at_poll: Option<String> = conn
                .query_row(
                    "SELECT status FROM tasks WHERE id = ?1",
                    [&worktree.task_id],
                    |row| row.get(0),
                )
                .map_err(|err| {
                    eprintln!(
                        "git-truth forge tick: failed to read status for task {} ({err}), \
                         skipping this worktree",
                        worktree.task_id
                    );
                })
                .ok();
            if let Some(status_at_poll) = status_at_poll {
                targets.push(ForgePollTarget {
                    task_id: worktree.task_id,
                    forge,
                    repo_path,
                    branch: worktree.branch,
                    status_at_poll,
                });
            }
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
        results.push(ForgePollResult {
            task_id: target.task_id.clone(),
            observed,
            status_at_poll: target.status_at_poll.clone(),
        });
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
            Some(&result.status_at_poll),
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

/// The fan-out dispatch tick's cadence (phase 9 plan 09-07): the same hot cadence the git-truth hot
/// tier uses, because a wave should drain about as fast as a person would notice it had.
pub const DISPATCH_TICK_SECS: u64 = 5;

/// Runs its body only if no other body is running: a firing that arrives while one is in progress
/// does nothing at all (T-09-07-05). A slow evaluation (a spawn sleeps inside the spawn floor, a
/// merge waits on git) therefore cannot overlap itself and double its spawns.
pub(crate) struct SingleFlight(AtomicBool);

impl SingleFlight {
    pub(crate) const fn new() -> Self {
        SingleFlight(AtomicBool::new(false))
    }

    /// `Some(result)` if the body ran, `None` if another was already in flight.
    pub(crate) fn run<R>(&self, body: impl FnOnce() -> R) -> Option<R> {
        struct Reset<'a>(&'a AtomicBool);
        impl Drop for Reset<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        if self.0.swap(true, Ordering::AcqRel) {
            return None;
        }
        let _reset = Reset(&self.0);
        Some(body())
    }
}

static DISPATCH_FLIGHT: SingleFlight = SingleFlight::new();

/// The dispatch tick: one pass of read, observe, decide, act, single-flight. Runs on whatever
/// thread calls it, and MUST NOT be called on an async worker: the spawn path sleeps inside the
/// per-repository spawn floor.
fn run_dispatch_tick(app: &AppHandle) {
    DISPATCH_FLIGHT.run(|| crate::commands::dispatch::execute_dispatch_actions(app));
}

/// Ask for a dispatch pass now instead of at the next firing: a session closing, a plan approved or
/// resumed, a gate resumed. On its own thread; if a pass is already running this does nothing, and
/// that pass or the next scheduled one picks the change up.
pub fn nudge_dispatch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || run_dispatch_tick(&app));
}

/// Build, register and start the five D-113/D-114/D-116/phase-07-07/phase-09-07 jobs against `app`'s
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

    // Phase 9 plan 09-07: the fifth job. The body is blocking (a spawn sleeps inside the spawn floor,
    // a merge waits on git), so it runs on a blocking thread, never on the scheduler's async worker.
    let dispatch_app = app.clone();
    let dispatch_job =
        Job::new_repeated_async(Duration::from_secs(DISPATCH_TICK_SECS), move |_uuid, _lock| {
            let app = dispatch_app.clone();
            Box::pin(async move {
                let _ = tauri::async_runtime::spawn_blocking(move || run_dispatch_tick(&app)).await;
            })
        })?;
    sched.add(dispatch_job).await?;

    sched.start().await?;

    Ok(())
}

#[cfg(test)]
mod forge_tick_tests {
    use super::*;

    /// A fresh migrated database with one project (forge forced to `local` so
    /// `forge_and_repo_path` takes its stored-override arm and never shells out to `git` for
    /// detection, D8), one task, and one active `worktrees` row — the shape
    /// `forge_tick_targets`/`poll_forge_targets` need to resolve a target with no subprocess at
    /// all. Copies `commands::agent_run::tests::seeded_conn_with_task`'s fixture shape
    /// (`tempfile::tempdir()` + `std::mem::forget`, `open_and_migrate`,
    /// `local_human_actor_id`, `create_project`, `create_task`) and
    /// `commands::agent_run::tests::seeded_conn_with_running_run`'s `INSERT INTO worktrees`
    /// column list verbatim.
    fn seeded_tick_fixture() -> (rusqlite::Connection, String, String, String) {
        let dir = tempfile::tempdir().expect("failed to create scratch dir");
        let db_path = dir.path().join("flywheel.db");
        let backups_dir = dir.path().join("backups");
        std::mem::forget(dir);

        let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
            .expect("open_and_migrate should succeed");
        let human_actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");
        let project = flywheel_core::domain::project::create_project(
            &mut conn,
            &human_actor_id,
            "Test Project",
            "/tmp/does-not-need-to-exist-for-this-test",
            "FLY",
            "main",
        )
        .expect("create_project should succeed");
        let task = flywheel_core::domain::task::create_task(
            &mut conn,
            &project.id,
            &human_actor_id,
            "Test task",
            None,
        )
        .expect("create_task should succeed");
        let system_actor_id = flywheel_core::domain::actor::system_actor(&conn)
            .expect("seeded system actor should exist")
            .id;

        conn.execute(
            "UPDATE projects SET forge = 'local' WHERE id = ?1",
            rusqlite::params![project.id],
        )
        .expect("failed to force the project's forge to local");

        let now = "2026-01-01T00:00:00.000Z";
        let worktree_id = flywheel_core::ids::new_id();
        conn.execute(
            "INSERT INTO worktrees (
                id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
            ) VALUES (
                ?1, ?2, ?3, '/tmp/does-not-need-to-exist-for-this-test', 'flywheel/test-task',
                'main', 'active', ?4, ?5
            )",
            rusqlite::params![worktree_id, task.id, project.id, human_actor_id, now],
        )
        .expect("failed to insert fixture worktree row");

        (conn, task.id, human_actor_id, system_actor_id)
    }

    /// A synthetic observed merge — no subprocess, no network — mirroring
    /// `tests/status_transitions.rs`'s own `request` helper's synthetic-value discipline.
    fn merged_request() -> ForgeRequest {
        ForgeRequest {
            state: flywheel_core::forge::ForgeState::Merged,
            ci: flywheel_core::forge::CiResult::None,
            number: 42,
            title: "Test PR".to_string(),
            url: "https://example.invalid/pr/42".to_string(),
            ci_url: None,
            is_draft: false,
            target_branch: "main".to_string(),
        }
    }

    /// Count events of a given type in `task_id`'s activity trail — mirroring
    /// `tests/status_transitions.rs`'s own `count_events_of_type` helper.
    fn count_events_of_type(conn: &rusqlite::Connection, task_id: &str, event_type: &str) -> usize {
        flywheel_core::query::events::activity_trail(conn, "task", task_id, 200, 0)
            .expect("trail read should succeed")
            .into_iter()
            .filter(|e| e.event_type == event_type)
            .count()
    }

    /// Seed the restart-safe forge baseline at `Open` by appending one synthetic
    /// `forge.state_changed` event directly — copying `tests/status_transitions.rs`'s
    /// `append_forge_event` fixture body inline, since that helper lives in a different crate
    /// and cannot be imported here.
    fn seed_open_baseline(conn: &mut rusqlite::Connection, project_id: &str, actor_id: &str, task_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let tx = conn.transaction().expect("transaction should open");
        let sequence = flywheel_core::domain::event::next_sequence(&tx, project_id, "local")
            .expect("sequence should allocate");
        let payload = serde_json::json!({
            "state": "Open",
            "ci": "None",
            "label": "synthetic forge event",
        });
        flywheel_core::domain::event::append_event(
            &tx,
            project_id,
            "local",
            sequence,
            "task",
            task_id,
            Some(task_id),
            None,
            actor_id,
            flywheel_core::forge::transitions::EVENT_FORGE_STATE_CHANGED,
            &payload,
            &now,
        )
        .expect("append_event should succeed");
        tx.commit().expect("commit should succeed");
    }

    #[test]
    fn a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation() {
        let (mut conn, task_id, human_actor_id, system_actor_id) = seeded_tick_fixture();

        // 1. The task starts in review, with an Open baseline — the state the tick would have
        //    captured on phase one's read.
        flywheel_core::domain::task::set_task_status(&mut conn, &human_actor_id, &task_id, "in_review")
            .expect("moving to in_review should succeed");
        let project_id: String = conn
            .query_row("SELECT project_id FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))
            .expect("project_id read should succeed");
        seed_open_baseline(&mut conn, &project_id, &human_actor_id, &task_id);

        // 2. Phase one of the tick: resolve targets under the (conceptual) lock.
        let targets = forge_tick_targets(&conn);
        assert_eq!(targets.len(), 1, "exactly one active worktree should resolve to one target");
        assert_eq!(targets[0].task_id, task_id);

        // 3. The lock-release window: the user drags the card back to `in_progress` by hand
        //    while the (simulated) network poll is in flight.
        flywheel_core::domain::task::set_task_status(&mut conn, &human_actor_id, &task_id, "in_progress")
            .expect("the manual move should succeed");

        // Baseline taken right before the tick's own write phase, so the two fixture-driven
        // status changes above (to in_review, then to in_progress) are not mistaken for
        // something the tick itself appended.
        let status_changed_before_tick = count_events_of_type(&conn, &task_id, "task.status_changed");

        // 4. Phase two's result, as it would have come back from a slow `gh`/`glab` call: a
        //    merged observation for the one target resolved above, carrying the status
        //    `forge_tick_targets` actually captured — never hardcoded, so a scheduler that
        //    failed to capture the status still fails this test.
        let results = vec![ForgePollResult {
            task_id: targets[0].task_id.clone(),
            observed: Some(merged_request()),
            status_at_poll: targets[0].status_at_poll.clone(),
        }];

        // 5. Phase three: apply under the re-acquired lock.
        apply_forge_results(&mut conn, &results, &system_actor_id);

        // 6. The fix: the captured status (`in_review`) no longer matches what is in the
        //    database (`in_progress`), so the status write is refused. `status` is kept on the
        //    assertion's left so a failure's `left:` line names what was actually written.
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))
            .expect("status read should succeed");
        assert_eq!(
            status, "in_progress",
            "a manual move landing inside the forge tick's lock-release window must survive a \
             stale merged observation — the forge must not overwrite a column a human just moved"
        );

        // The refusal's trace: exactly one `forge.status_write_skipped` event, and zero
        // `task.status_changed` events appended by this tick (the status writer never ran).
        assert_eq!(
            count_events_of_type(&conn, &task_id, "forge.status_write_skipped"),
            1,
            "a refused status write must leave exactly one trace in the activity trail"
        );
        assert_eq!(
            count_events_of_type(&conn, &task_id, "task.status_changed") - status_changed_before_tick,
            0,
            "a refused status write must never append a task.status_changed event"
        );

        // D4: the baseline still advances to Merged on the refusal, so the next tick never
        // retries the overwrite 120 seconds later.
        let baseline = flywheel_core::query::forge::latest_forge_baseline(&conn, &task_id)
            .expect("baseline read should succeed");
        assert_eq!(
            baseline.state,
            flywheel_core::forge::ForgeState::Merged,
            "the baseline must advance to Merged even on a refused write, so the next tick \
             re-observes no edge and never retries the overwrite"
        );
    }

    #[test]
    fn forge_tick_targets_captures_each_tasks_status_as_of_the_read() {
        let (mut conn, task_id, human_actor_id, _system_actor_id) = seeded_tick_fixture();
        flywheel_core::domain::task::set_task_status(&mut conn, &human_actor_id, &task_id, "in_review")
            .expect("moving to in_review should succeed");

        let targets = forge_tick_targets(&conn);

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].status_at_poll, "in_review");
    }

    #[test]
    fn poll_forge_targets_threads_the_captured_status_into_each_result() {
        let (conn, task_id, _human_actor_id, _system_actor_id) = seeded_tick_fixture();

        let targets = forge_tick_targets(&conn);
        assert_eq!(targets.len(), 1);

        // `projects.forge = 'local'` (set by the fixture) exercises this with no subprocess at
        // all (D8) — `request_for_branch_at` answers `Ok(None)` for `Forge::Local` directly.
        let results = poll_forge_targets(&targets);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].task_id, task_id);
        assert_eq!(results[0].status_at_poll, targets[0].status_at_poll);
        assert!(results[0].observed.is_none(), "Forge::Local must observe no request");
    }

    #[test]
    fn a_merged_observation_still_carries_an_unmoved_task_to_done() {
        let (mut conn, task_id, human_actor_id, system_actor_id) = seeded_tick_fixture();

        flywheel_core::domain::task::set_task_status(&mut conn, &human_actor_id, &task_id, "in_review")
            .expect("moving to in_review should succeed");
        let project_id: String = conn
            .query_row("SELECT project_id FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))
            .expect("project_id read should succeed");
        seed_open_baseline(&mut conn, &project_id, &human_actor_id, &task_id);

        let targets = forge_tick_targets(&conn);
        assert_eq!(targets.len(), 1);

        // Baseline taken right before the tick's own write phase, so the fixture's own move to
        // in_review is not mistaken for something the tick itself appended.
        let status_changed_before_tick = count_events_of_type(&conn, &task_id, "task.status_changed");

        // NO manual move in between — the guard is a precondition, not a blanket refusal.
        let results = vec![ForgePollResult {
            task_id: targets[0].task_id.clone(),
            observed: Some(merged_request()),
            status_at_poll: targets[0].status_at_poll.clone(),
        }];

        apply_forge_results(&mut conn, &results, &system_actor_id);

        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))
            .expect("status read should succeed");
        assert_eq!(status, "done", "an unmoved task's merge observation must still carry it to done");

        assert_eq!(
            count_events_of_type(&conn, &task_id, "task.status_changed") - status_changed_before_tick,
            1,
            "the status writer must have fired exactly once"
        );
        assert_eq!(
            count_events_of_type(&conn, &task_id, "forge.status_write_skipped"),
            0,
            "an unmoved task's merge must never be refused — this is what stops the fix from \
             passing the regression test by refusing every write"
        );
    }
}

#[cfg(test)]
mod dispatch_tick_tests {
    use super::*;

    #[test]
    fn a_second_firing_while_one_is_in_progress_performs_no_evaluation() {
        let flight = SingleFlight::new();
        let evaluations = std::cell::Cell::new(0);
        let outer = flight.run(|| {
            evaluations.set(evaluations.get() + 1);
            // An overlapping firing arrives mid-evaluation.
            let inner = flight.run(|| evaluations.set(evaluations.get() + 1));
            assert!(inner.is_none(), "the overlapping firing must not run");
        });
        assert!(outer.is_some());
        assert_eq!(evaluations.get(), 1, "exactly one evaluation happened");
        assert!(flight.run(|| ()).is_some(), "the flag clears afterwards");
    }

    #[test]
    fn a_panicking_pass_does_not_wedge_the_flag() {
        let flight = SingleFlight::new();
        let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| flight.run(|| panic!("boom"))));
        assert!(caught.is_err());
        assert!(flight.run(|| ()).is_some(), "the next firing must still be able to run");
    }

    /// The pass acquires the lock to read, releases it, and only then spawns: the spawn closure runs
    /// with the lock free. `try_lock` failing here would mean a lock held across the launch, which
    /// holds every other command for as long as the spawn floor sleeps (T-09-07-04).
    #[test]
    fn no_database_lock_is_held_across_the_spawn() {
        let dir = tempfile::tempdir().expect("scratch dir");
        let conn = flywheel_core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
            .expect("open_and_migrate");
        let human = flywheel_core::domain::actor::local_human_actor_id(&conn).expect("human");
        let system = flywheel_core::domain::actor::system_actor(&conn).expect("system").id;
        let mut conn = conn;
        let project = flywheel_core::domain::project::create_project(&mut conn, &human, "P", "/repo", "FLY", "main")
            .expect("project");
        let epic = flywheel_core::domain::epic::create_epic(&mut conn, &project.id, &human, "E", None).expect("epic");
        flywheel_core::domain::task::create_task(&mut conn, &project.id, &human, "T", Some(&epic.id)).expect("task");
        let plan = flywheel_core::domain::dispatch_plan::create_plan_for_epic(&mut conn, &epic.id, &human).expect("plan");
        flywheel_core::domain::dispatch_plan::approve_and_start(&mut conn, &plan, &human).expect("start");

        let db = Mutex::new(conn);
        let mut spawned = 0;
        let report = flywheel_core::dispatch_exec::run_pass(&db, chrono::Utc::now().timestamp(), &system, |_p, _t| {
            assert!(db.try_lock().is_ok(), "the database lock must be free while a run is being launched");
            spawned += 1;
            Err("not launching in a unit test".to_string())
        })
        .expect("pass");
        assert_eq!(spawned, 1, "the ready task was handed to the launcher");
        assert_eq!(report.spawned, 0);
        // A failed launch is a named cause on the task, not a lost task.
        let conn = db.lock().expect("lock");
        let state: String = conn
            .query_row("SELECT state FROM dispatch_plan_tasks WHERE plan_id = ?1", [&plan], |r| r.get(0))
            .expect("state");
        assert_eq!(state, "needs_attention");
    }
}
