//! D-113/D-114/D-116's git-truth tick, on one Tokio task per tier. Three registrations of the same
//! primitive ([`spawn_every`]) — a hot tier, a cold tier and a slower fetch — never one job with
//! internal partitioning (07-CONTEXT.md's own discretion call).
//!
//! Every schedule here is a fixed interval; there is no cron expression. That is why a Tokio
//! interval is enough, and why the cron crates the scheduler used to bring (`tokio-cron-scheduler`,
//! `croner`, `chrono`, `chrono-tz`) are gone (issue #1728, RUSTSEC-2026-0543 and -0555).
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
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use flywheel_core::git_facts::{COLD_TICK_SECS, FETCH_INTERVAL_SECS, HOT_TICK_SECS};
use flywheel_core::git_tick::{self, Digests};
use tauri::Manager;
use tokio::task::JoinHandle;
use tokio::time::{interval_at, Instant, MissedTickBehavior};

use crate::state::AppState;
use crate::AppHandle;

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
    let scope = if projects.len() == 1 {
        projects.into_iter().next().flatten()
    } else {
        None
    };
    crate::commands::emit_board_changed(app, scope.as_deref(), "git_facts", None);
}

/// D-114's hot tier: every worktree with a live session, unioned with the Story the renderer says
/// it is focused on (`AppState.focused_story`).
fn run_hot_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let focused = state
        .focused_story
        .lock()
        .ok()
        .and_then(|focused| focused.clone());
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
    let mut changed = git_tick::git_facts_tick(&state.db, &story_ids, digests(), "cold");
    // Landing Stories wait for their request (ADR 0042): the same minute asks the forge, with the
    // board mutex released while the CLI runs.
    changed.extend(flywheel_core::domain::landing::landing_tick(
        &state.db,
        &flywheel_core::forge::ForgeCli::from_env(),
    ));
    // The Issue mirror's outbox drains on the same tier, one write a second, off the board mutex.
    changed.extend(flywheel_core::domain::issue_mirror::mirror_tick(
        &state.db,
        &flywheel_core::forge::ForgeCli::from_env(),
    ));
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

/// Run `tick` once every `period`, on its own Tokio task, until the runtime ends. The first run is
/// one full `period` after the call, never at the start: the board's git facts are display
/// freshness, and a launch has just read them.
///
/// Three properties keep one bad tick from costing every later one:
/// - Each run is a task of its own that this loop awaits, so a panic inside `tick` ends that run
///   with an `eprintln!` and the next period runs as usual.
/// - Runs of one `name` never overlap: the next period waits for the previous run to end.
/// - A run that overruns its period, or a clock that jumped (a laptop that slept), makes the
///   missed periods one skipped slot, never a burst of catch-up runs ([`MissedTickBehavior::Skip`]).
///
/// `tick` is synchronous because every job body is: `flywheel_core::git_tick` shells out to git.
/// It runs on a runtime worker, as it did under `tokio-cron-scheduler`.
///
/// Must be called inside a Tokio runtime.
fn spawn_every<F>(name: &'static str, period: Duration, tick: F) -> JoinHandle<()>
where
    F: Fn() + Send + Sync + 'static,
{
    let tick = Arc::new(tick);
    // Read here, not inside the task: "one period after the call" must not depend on when the
    // runtime first polls the task.
    let first_run = Instant::now() + period;
    tokio::spawn(async move {
        let mut interval = interval_at(first_run, period);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let run = Arc::clone(&tick);
            if let Err(err) = tokio::spawn(async move { run() }).await {
                eprintln!("flywheel: the {name} git-truth tick failed: {err}");
            }
        }
    })
}

/// Start the three D-113/D-114/D-116 jobs against `app`'s already-managed `AppState` — called once,
/// after `app.manage(AppState { .. })`, from inside the Tokio runtime (`startup::boot` spawns it).
/// Nothing here can fail: a job is a task, not a registration with a store.
pub fn start_git_truth_scheduler(app: AppHandle) {
    let hot_app = app.clone();
    spawn_every("hot", Duration::from_secs(HOT_TICK_SECS), move || {
        run_hot_tick(&hot_app)
    });

    let cold_app = app.clone();
    spawn_every("cold", Duration::from_secs(COLD_TICK_SECS), move || {
        run_cold_tick(&cold_app)
    });

    let fetch_app = app;
    spawn_every(
        "fetch",
        Duration::from_secs(FETCH_INTERVAL_SECS),
        move || run_fetch_tick(&fetch_app),
    );
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::time::advance;

    use super::*;

    const PERIOD: Duration = Duration::from_secs(5);

    /// Let the loop task and the task it spawns for each run both finish what they can do now.
    async fn settle() {
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }

    /// A tick that only counts its runs.
    fn counter() -> (Arc<AtomicUsize>, impl Fn() + Send + Sync + 'static) {
        let runs = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&runs);
        (runs, move || {
            seen.fetch_add(1, Ordering::SeqCst);
        })
    }

    #[test]
    fn the_three_tiers_keep_their_decided_cadence() {
        assert_eq!(HOT_TICK_SECS, 5, "D-114's hot tier");
        assert_eq!(COLD_TICK_SECS, 60, "D-114's cold tier");
        assert_eq!(FETCH_INTERVAL_SECS, 300, "D-116's fetch");
    }

    #[tokio::test(start_paused = true)]
    async fn the_first_run_is_one_full_period_after_the_start() {
        let (runs, tick) = counter();
        let task = spawn_every("test", PERIOD, tick);
        settle().await;
        assert_eq!(runs.load(Ordering::SeqCst), 0, "nothing at the start");

        advance(PERIOD - Duration::from_millis(1)).await;
        settle().await;
        assert_eq!(runs.load(Ordering::SeqCst), 0, "not one millisecond early");

        advance(Duration::from_millis(1)).await;
        settle().await;
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        task.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn it_runs_again_every_period() {
        let (runs, tick) = counter();
        let task = spawn_every("test", PERIOD, tick);
        for expected in 1..=4 {
            advance(PERIOD).await;
            settle().await;
            assert_eq!(runs.load(Ordering::SeqCst), expected);
        }
        task.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn a_stalled_clock_costs_one_slot_not_a_burst_of_catch_up_runs() {
        let (runs, tick) = counter();
        let task = spawn_every("test", PERIOD, tick);
        advance(PERIOD * 3 + PERIOD / 2).await;
        settle().await;
        assert_eq!(
            runs.load(Ordering::SeqCst),
            1,
            "three periods missed, one run"
        );

        advance(PERIOD).await;
        settle().await;
        assert_eq!(runs.load(Ordering::SeqCst), 2, "and the cadence goes on");
        task.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn a_run_that_panics_does_not_stop_the_later_runs() {
        let runs = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&runs);
        let task = spawn_every("test", PERIOD, move || {
            if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("the first run fails, on purpose");
            }
        });
        for expected in 1..=3 {
            advance(PERIOD).await;
            settle().await;
            assert_eq!(runs.load(Ordering::SeqCst), expected);
        }
        task.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn tiers_with_different_periods_run_on_their_own_cadence() {
        let (hot_runs, hot) = counter();
        let (cold_runs, cold) = counter();
        let hot_task = spawn_every("hot", Duration::from_secs(5), hot);
        let cold_task = spawn_every("cold", Duration::from_secs(60), cold);
        for _ in 0..12 {
            advance(Duration::from_secs(5)).await;
            settle().await;
        }
        assert_eq!(hot_runs.load(Ordering::SeqCst), 12);
        assert_eq!(cold_runs.load(Ordering::SeqCst), 1);
        hot_task.abort();
        cold_task.abort();
    }

    /// Real time on purpose: overlap needs a run that takes longer than its period, and a paused
    /// clock does not move while a thread sleeps. The test can only fail by seeing two runs at once.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn runs_never_overlap_when_a_run_outlasts_its_period() {
        let running = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let runs = Arc::new(AtomicUsize::new(0));
        let (r, m, n) = (Arc::clone(&running), Arc::clone(&most), Arc::clone(&runs));
        let task = spawn_every("test", Duration::from_millis(5), move || {
            let now = r.fetch_add(1, Ordering::SeqCst) + 1;
            m.fetch_max(now, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(30));
            r.fetch_sub(1, Ordering::SeqCst);
            n.fetch_add(1, Ordering::SeqCst);
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while runs.load(Ordering::SeqCst) < 3 && std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        task.abort();
        assert!(
            runs.load(Ordering::SeqCst) >= 3,
            "the schedule kept running"
        );
        assert_eq!(most.load(Ordering::SeqCst), 1, "never two runs at once");
    }
}
