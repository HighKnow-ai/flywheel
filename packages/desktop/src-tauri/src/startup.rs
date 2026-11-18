//! The cold-start path, in one place: both `main.rs` (the app) and `bin/flywheel-headless.rs` (the
//! end-to-end harness's core) call these two functions, so a flow that restarts the headless core
//! proves the steps the app takes at launch and not a copy of them. The same way `roster.rs` shares
//! the command list.
//!
//! The order is the contract:
//!
//! 1. [`adopt_login_path`], first and before any thread starts (it writes the process environment).
//! 2. [`boot`]: open and migrate the database; reconcile projects, worktrees and sessions (D-16,
//!    WORK-06, PROC-05); spawn the sidecar; manage `AppState`; start the git-truth scheduler.
//!
//! Not here: the menu, the plugins and the notification task, which need the real window system and
//! stay in `main.rs`.

use std::sync::Mutex;

use anyhow::Context;
use flywheel_core::login_path::{self, LoginPath};
use tauri::Manager;

use crate::state::AppState;
use crate::{scheduler, sidecar, AppHandle};

/// Issue #88: opened from Finder or the Dock, the app inherits a minimal PATH. Adopt the login
/// shell's PATH first, before any thread starts, so the sidecar, every session, the shim and the
/// Checks all inherit it. On any fallback the warning names what was used and is shown on screen
/// (`settings::launch_environment`); it is also printed here.
pub fn adopt_login_path() -> LoginPath {
    let adopted = login_path::adopt(login_path::RESOLVE_TIMEOUT);
    if let Some(warning) = &adopted.warning {
        eprintln!("flywheel: {warning}");
    }
    adopted
}

/// Open the database, reconcile what the last run left, spawn the sidecar, manage `AppState` and
/// start the scheduler. A failure here aborts startup: the app never proceeds against a
/// half-migrated file, a board that lies about a dead session, or without a sidecar.
pub fn boot(app: &AppHandle) -> anyhow::Result<()> {
    // Open (or create) the one fleet-wide database, backing it up before migrating and applying
    // pragmas, before any window is shown (D-18, T-01-10).
    let db_path = flywheel_core::db::default_db_path()
        .context("failed to resolve the app-data database path")?;
    let backups_dir = flywheel_core::db::default_backups_dir()
        .context("failed to resolve the app-data backups directory")?;
    let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
        .context("failed to open and migrate the database at startup")?;

    // Launch-time reconciliation (D-16, BOARD-10): verify every known project's marker still
    // matches its cached path BEFORE the window is shown. Never scans the disk and never rewrites
    // `repo_path`: a mismatch is surfaced, not silently repaired.
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
        .context("failed to resolve the local human actor for launch-time reconciliation")?;
    flywheel_core::domain::project::reconcile_projects(&mut conn, &actor_id)
        .context("failed to reconcile registered projects at launch")?;

    // Worktrees (WORK-06, D-45): an `active` row no longer on disk is written to `missing` and
    // explained with one event: never repaired, never deleted.
    flywheel_core::domain::worktree::reconcile_worktrees(&mut conn, &actor_id)
        .context("failed to reconcile recorded worktrees at launch")?;

    // Sessions (PROC-05, D-46, D-49, D-50): every `running`/`blocked` row left when the app died is
    // sorted into killed-by-its-watchdog or dead-without-a-record (both written to `abandoned`), or
    // genuinely-still-alive, which is NEVER written to any status and is kept on `AppState` for the
    // recovery modal. Runs BEFORE the sidecar spawns, so the classification is resolved before any
    // new session could start.
    let pending_orphans = flywheel_core::domain::session::reconcile_sessions(&mut conn, &actor_id)
        .context("failed to reconcile in-flight agent runs at launch")?;

    // A sidecar that fails to start means no agent run can ever be driven (PROC-01, PROC-02).
    let sidecar_handle = sidecar::spawn_sidecar(app)
        .context("failed to spawn the flywheel-sidecar process at startup")?;

    app.manage(AppState {
        db: Mutex::new(conn),
        sidecar: Some(sidecar_handle),
        pending_orphans: Mutex::new(pending_orphans),
        focused_story: Mutex::new(None),
        watched_run: Mutex::new(None),
    });

    // D-113/D-114/D-116: the git-truth scheduler starts AFTER `AppState` is managed, so every tick
    // can reach it. Spawned, not awaited: the board's git facts are display freshness, not a startup
    // precondition. It runs inside a spawned task because that is how the call gets a Tokio runtime
    // to start the three tier loops on; nothing in it can fail.
    let scheduler_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        scheduler::start_git_truth_scheduler(scheduler_handle);
    });

    Ok(())
}
