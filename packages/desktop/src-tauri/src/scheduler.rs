//! D-113/D-114/D-116's git-truth tick, on `tokio-cron-scheduler`. Three registrations of the same
//! primitive — a hot tier, a cold tier and a slower fetch — never one job with internal
//! partitioning (07-CONTEXT.md's own discretion call).
//!
//! Each git-facts job locks `AppState.db`, calls the matching sync `flywheel_core::git_facts`
//! function, DROPS the lock, then emits the shared board-invalidation event (see
//! [`emit_git_facts_changed`]) at most once per tick — only when a digest of what it just read
//! actually changed. A failure is an `eprintln!` value, never a panic, never an early return that
//! would kill the scheduler for every future tick.
//!
//! This module owns no state of its own beyond the digest map used to decide whether to emit —
//! every git fact is re-derived fresh from `git_facts_for_story` on every tick (D-75/D-128); the
//! digest is a change-detector for the notification, never an answer to any question a caller
//! asks this module.
//!
//! The fetch job runs `git fetch` with **no lock held at all** (07-11, CR-01): it reads the work
//! list under the lock, releases it, then runs the network phase through a function whose
//! signature carries no `Connection` (the type is the enforcement, not a comment).

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use flywheel_core::domain::actor::system_actor;
use flywheel_core::git_facts::{
    git_facts_for_story, tracked_worktrees, GitFacts, COLD_TICK_SECS, FETCH_INTERVAL_SECS, HOT_TICK_SECS,
};
use tauri::{AppHandle, Manager};
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::state::AppState;

/// One active project's fetch target — just enough for [`fetch_origin_for_targets`] to call
/// [`flywheel_core::git::fetch_origin`] with no connection in scope.
struct FetchTarget {
    project_id: String,
    repo_path: String,
}

/// The last-emitted digest per Story id, keyed so the hot and cold ticks share one map. Never read
/// as an answer to any question other than "did this change since the last tick" (D-75/D-128).
fn digests() -> &'static Mutex<HashMap<String, u64>> {
    static DIGESTS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    DIGESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A digest of `facts`' serialized form — cheap, order-stable, and never stored or read as anything
/// but a change-detector.
fn digest_of(facts: &GitFacts) -> Option<u64> {
    let serialized = serde_json::to_string(facts).ok()?;
    let mut hasher = DefaultHasher::new();
    serialized.hash(&mut hasher);
    Some(hasher.finish())
}

/// Read `story_id`'s git facts and record whether its digest changed since the last tick — the
/// caller decides what to do with that; this function never emits anything itself.
fn read_and_record_change(conn: &rusqlite::Connection, story_id: &str) -> bool {
    let facts = match git_facts_for_story(conn, story_id) {
        Ok(facts) => facts,
        Err(err) => {
            eprintln!("git-truth tick: failed to read git facts for Story {story_id}: {err:#}");
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
    let changed = map.get(story_id) != Some(&new_digest);
    map.insert(story_id.to_string(), new_digest);
    changed
}

/// The one emit site in this module for the shared board-invalidation event. A tick emits AT MOST
/// ONCE; `projects` is every project whose Stories changed during it, each `None` standing for a
/// Story whose project could not be resolved. Exactly one resolved project scopes the event to it;
/// anything else broadcasts, so no reader is left stale.
fn emit_git_facts_changed(app: &AppHandle, projects: HashSet<Option<String>>) {
    let scope = if projects.len() == 1 { projects.into_iter().next().flatten() } else { None };
    crate::commands::emit_board_changed(app, scope.as_deref(), "git_facts", None);
}

/// One git-facts pass over `story_ids`: digest each, notice hand-made commits on each Story's
/// branch (LINK-10/D-115), and return every project whose facts changed. A failure on one Story is
/// logged and never abandons the rest of the tick.
fn record_ticks(conn: &mut rusqlite::Connection, story_ids: &[String], tier: &str) -> HashSet<Option<String>> {
    // The system actor, resolved once per tick in Rust (never passed in from the renderer, T-01-04).
    let outside_commit_actor_id = match system_actor(conn) {
        Ok(actor) => Some(actor.id),
        Err(err) => {
            eprintln!("git-truth {tier} tick: failed to resolve the system actor: {err:#}");
            None
        }
    };
    let mut changed_projects: HashSet<Option<String>> = HashSet::new();
    for story_id in story_ids {
        if read_and_record_change(conn, story_id) {
            changed_projects.insert(crate::commands::project_of(conn, "stories", story_id));
        }
        if let Some(actor_id) = &outside_commit_actor_id {
            match flywheel_core::git_facts::record_outside_commits(conn, story_id, actor_id) {
                Ok(count) if count > 0 => {
                    changed_projects.insert(crate::commands::project_of(conn, "stories", story_id));
                }
                Ok(_) => {}
                Err(err) => eprintln!(
                    "git-truth {tier} tick: failed to notice outside commits for Story {story_id}: {err:#}"
                ),
            }
        }
    }
    changed_projects
}

/// D-114's hot tier: every worktree with a live session, unioned with the Story the renderer says
/// it is focused on (`AppState.focused_story`).
fn run_hot_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut conn) = state.db.lock() else {
        eprintln!("git-truth hot tick: AppState.db lock was poisoned, skipping this tick");
        return;
    };

    let mut story_ids: HashSet<String> = match tracked_worktrees(&conn, true) {
        Ok(rows) => rows.into_iter().map(|w| w.story_id).collect(),
        Err(err) => {
            eprintln!("git-truth hot tick: failed to read tracked worktrees: {err:#}");
            HashSet::new()
        }
    };
    if let Ok(focused) = state.focused_story.lock() {
        if let Some(story_id) = focused.as_ref() {
            story_ids.insert(story_id.clone());
        }
    }
    let story_ids: Vec<String> = story_ids.into_iter().collect();
    let changed_projects = record_ticks(&mut conn, &story_ids, "hot");
    drop(conn);

    if !changed_projects.is_empty() {
        emit_git_facts_changed(app, changed_projects);
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

    let story_ids: Vec<String> = match tracked_worktrees(&conn, false) {
        Ok(rows) => rows.into_iter().map(|w| w.story_id).collect(),
        Err(err) => {
            eprintln!("git-truth cold tick: failed to read tracked worktrees: {err:#}");
            Vec::new()
        }
    };
    let changed_projects = record_ticks(&mut conn, &story_ids, "cold");
    drop(conn);

    if !changed_projects.is_empty() {
        emit_git_facts_changed(app, changed_projects);
    }
}

/// Phase one of the fetch tick: every active project's id and repo path, read under the lock.
fn fetch_tick_targets(conn: &rusqlite::Connection) -> Vec<FetchTarget> {
    let mut stmt = match conn.prepare("SELECT id, repo_path FROM projects WHERE status = 'active' AND hidden = 0")
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
/// absence is the fix: a hung `git fetch` can never block any other command. A fetch writes nothing
/// to the database, so there is no write phase to follow this one.
fn fetch_origin_for_targets(targets: &[FetchTarget]) {
    for target in targets {
        if let Err(err) = flywheel_core::git::fetch_origin(std::path::Path::new(&target.repo_path)) {
            eprintln!(
                "git-truth fetch tick: failed to fetch origin for project {}: {err:#}",
                target.project_id
            );
        }
    }
}

/// D-116's fetch job: `git fetch origin` for every active project, on its own slower cadence. Never
/// emits the board-invalidation event itself — the next hot/cold tick reads and digests the moved
/// `origin/<target>` on its own.
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

/// Build, register and start the three D-113/D-114/D-116 jobs against `app`'s already-managed
/// `AppState` — called once, after `app.manage(AppState { .. })`, from `main.rs`'s `.setup()`.
pub async fn start_git_truth_scheduler(app: AppHandle) -> anyhow::Result<()> {
    let sched = JobScheduler::new().await?;

    let hot_app = app.clone();
    let hot_job = Job::new_repeated_async(Duration::from_secs(HOT_TICK_SECS), move |_uuid, _lock| {
        let app = hot_app.clone();
        Box::pin(async move { run_hot_tick(&app) })
    })?;
    sched.add(hot_job).await?;

    let cold_app = app.clone();
    let cold_job = Job::new_repeated_async(Duration::from_secs(COLD_TICK_SECS), move |_uuid, _lock| {
        let app = cold_app.clone();
        Box::pin(async move { run_cold_tick(&app) })
    })?;
    sched.add(cold_job).await?;

    let fetch_app = app.clone();
    let fetch_job = Job::new_repeated_async(Duration::from_secs(FETCH_INTERVAL_SECS), move |_uuid, _lock| {
        let app = fetch_app.clone();
        Box::pin(async move { run_fetch_tick(&app) })
    })?;
    sched.add(fetch_job).await?;

    sched.start().await?;

    Ok(())
}
