//! D-113/D-114/D-116's git-truth tick, on `tokio-cron-scheduler`. Three registrations of the same
//! primitive — a hot tier, a cold tier and a slower fetch — never one job with internal
//! partitioning (07-CONTEXT.md's own discretion call).
//!
//! This module owns the cadence and the board-invalidation emit only. Each job's body is
//! `flywheel_core::git_tick`, which never holds `AppState.db` while git runs (issue #215): it reads
//! what it needs under the lock, releases it, runs git, then takes the lock again only to write
//! what git showed. A git-facts job emits the shared board-invalidation event (see
//! [`emit_git_facts_changed`]) at most once per tick, only when a digest of what it just read
//! changed. A failure is an `eprintln!` value, never a panic, never an early return that would kill
//! the scheduler for every future tick.
//!
//! The digest map is this module's only state, and it is a change-detector for the notification,
//! never an answer to any question a caller asks (D-75/D-128): every git fact is re-derived fresh
//! on every tick.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use flywheel_core::git_facts::{COLD_TICK_SECS, FETCH_INTERVAL_SECS, HOT_TICK_SECS};
use flywheel_core::git_tick::{self, Digests};
use tauri::{AppHandle, Manager};
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::state::AppState;

/// The last-seen digest per Story id, keyed so the hot and cold ticks share one map.
fn digests() -> &'static Digests {
    static DIGESTS: OnceLock<Digests> = OnceLock::new();
    DIGESTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The one emit site in this module for the shared board-invalidation event. A tick emits AT MOST
/// ONCE; `projects` is every project whose Stories changed during it, each `None` standing for a
/// Story whose project could not be resolved. Exactly one resolved project scopes the event to it;
/// anything else broadcasts, so no reader is left stale.
fn emit_git_facts_changed(app: &AppHandle, projects: HashSet<Option<String>>) {
    if projects.is_empty() {
        return;
    }
    let scope = if projects.len() == 1 { projects.into_iter().next().flatten() } else { None };
    crate::commands::emit_board_changed(app, scope.as_deref(), "git_facts", None);
}

/// D-114's hot tier: every worktree with a live session, unioned with the Story the renderer says
/// it is focused on (`AppState.focused_story`).
fn run_hot_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let focused = state.focused_story.lock().ok().and_then(|focused| focused.clone());
    let story_ids = git_tick::hot_story_ids(&state.db, focused);
    let changed = git_tick::git_facts_tick(&state.db, &story_ids, digests(), "hot");
    emit_git_facts_changed(app, changed);
}

/// D-114's cold tier: every tracked worktree, regardless of hot-tier membership.
fn run_cold_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let story_ids = git_tick::cold_story_ids(&state.db);
    let changed = git_tick::git_facts_tick(&state.db, &story_ids, digests(), "cold");
    emit_git_facts_changed(app, changed);
}

/// D-116's fetch job: `git fetch origin` for every active project, on its own slower cadence. Never
/// emits the board-invalidation event itself — the next hot/cold tick reads and digests the moved
/// `origin/<target>` on its own.
fn run_fetch_tick(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        git_tick::fetch_tick(&state.db);
    }
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
