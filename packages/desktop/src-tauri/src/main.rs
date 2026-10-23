// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;
mod notify;
mod scheduler;
mod sidecar;
mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// `menu.rs`'s custom item ids — the only ones this handler forwards to the frontend as
/// `menu:action` (01-09-PLAN.md Task 2, threat T-01-02). Every other menu event (predefined
/// items — Quit, Close Window, Cut/Copy/Paste/Undo/Redo, Minimize/Maximize/Bring All to Front,
/// About) is already handled natively by Tauri/the OS and needs no forwarding here.
///
/// `"open-settings"` is plan 02-10 Task 3's addition (D-39) — extending this closed list by one
/// id, the same discipline every prior addition to this set has followed, never widening the
/// check itself.
///
/// These same five ids are the exact set `menu_set_action_enabled` (`commands/menu.rs`) accepts
/// (01-16-PLAN.md Task 2, UAT gap G-01-1) — `state/keyboard.ts`'s `MENU_ACTION_IDS` is their
/// renderer-side mirror, kept in sync by hand across the IPC seam since a Rust const and a
/// TypeScript array cannot share a single source.
const FORWARDED_MENU_ACTIONS: &[&str] = &[
    "register-project",
    "create-story",
    "create-epic",
    "open-palette",
    "open-settings",
    "open-fleet",
];

fn main() {
    // Issue #88: opened from Finder or the Dock, the app inherits a minimal PATH. Adopt the login
    // shell's PATH first, before any thread starts (it writes the process environment), so the
    // sidecar, every session, the shim and the Checks all inherit it. An interactive login shell
    // first, then a login shell, each bounded by a timeout; on any fallback the warning names what
    // was used and is shown on screen (`settings::launch_environment`).
    let login_path = flywheel_core::login_path::adopt(flywheel_core::login_path::RESOLVE_TIMEOUT);
    if let Some(warning) = &login_path.warning {
        eprintln!("flywheel: {warning}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // D-175: granted to the Rust core only. No notification permission is added to the window.
        .plugin(tauri_plugin_notification::init())
        .menu(|app| menu::build_menu(app))
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if FORWARDED_MENU_ACTIONS.contains(&id) {
                let _ = app.emit("menu:action", id);
            }
        })
        .setup(|app| {
            // Open (or create) the one fleet-wide database, backing it up before migrating and
            // applying pragmas, before any window is shown. A migration failure aborts startup
            // with the error surfaced — this never proceeds against a half-migrated file
            // (D-18, T-01-10).
            let db_path = flywheel_core::db::default_db_path()
                .expect("failed to resolve the app-data database path");
            let backups_dir = flywheel_core::db::default_backups_dir()
                .expect("failed to resolve the app-data backups directory");
            let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
                .expect("failed to open and migrate the database at startup");

            // Launch-time reconciliation (D-16, BOARD-10): verify every known project's marker
            // still matches its cached path BEFORE the window is shown, so a moved repository
            // surfaces as unreachable immediately rather than only after the user tries to open
            // it. Never scans the disk and never rewrites `repo_path` — a mismatch is surfaced,
            // not silently repaired.
            let reconcile_actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn)
                .expect("failed to resolve the local human actor for launch-time reconciliation");
            flywheel_core::domain::project::reconcile_projects(&mut conn, &reconcile_actor_id)
                .expect("failed to reconcile registered projects at launch");

            // Launch-time reconciliation for worktrees (WORK-06, D-45): a `worktrees` row the
            // database calls `active` that is no longer present on disk is written to `missing`
            // and explained with one event — never repaired, never deleted, path/branch/
            // base_branch never rewritten. Same expect-or-crash-loudly idiom and the same
            // already-resolved `reconcile_actor_id` as `reconcile_projects` immediately above.
            flywheel_core::domain::worktree::reconcile_worktrees(&mut conn, &reconcile_actor_id)
                .expect("failed to reconcile recorded worktrees at launch");

            // Launch-time reconciliation for sessions (PROC-05, D-46, D-49, D-50, plan 03-06):
            // every `sessions` row still `running`/`blocked` when the app died is sorted into
            // killed-by-its-watchdog, dead-without-a-record, or genuinely-still-alive — the first
            // two are written to `abandoned` here; the third is NEVER written to any status
            // (writing one would be the board lying about a live fact, D-46) and is instead
            // returned as a live-orphan list stored on `AppState` below, for the first paint's
            // recovery modal (plan 03-10) to offer the user a decision. Same expect-or-crash-
            // loudly idiom, same already-resolved `reconcile_actor_id`, and runs BEFORE
            // `spawn_sidecar` so the classification is already resolved before any new session
            // could possibly start.
            let pending_orphans =
                flywheel_core::domain::session::reconcile_sessions(&mut conn, &reconcile_actor_id)
                    .expect("failed to reconcile in-flight agent runs at launch");

            // Spawn the sidecar supervisor before any window is shown, with the same
            // expect-or-crash-loudly idiom the migration step above already uses — a sidecar
            // that fails to start means no agent run can ever be driven, so this never proceeds
            // silently (PROC-01, PROC-02).
            let sidecar_handle = sidecar::spawn_sidecar(app.handle())
                .expect("failed to spawn the flywheel-sidecar process at startup");

            app.manage(AppState {
                db: Mutex::new(conn),
                sidecar: Some(sidecar_handle),
                pending_orphans: Mutex::new(pending_orphans),
                focused_story: Mutex::new(None),
                watched_run: Mutex::new(None),
            });

            // D-113/D-114/D-116 (Phase 7 plan 07-01): start the git-truth scheduler AFTER
            // AppState is managed above, so every tick it fires can reach it via
            // `app.try_state::<AppState>()`. Spawned rather than awaited directly here — the
            // board's git facts are display-freshness furniture, not a startup precondition, so
            // this must not hold up the first paint the way the migration/reconciliation/sidecar
            // steps above correctly do. A start failure still crashes loudly (LINK-10: a board
            // that silently never refreshes is the exact failure this phase exists to remove),
            // just inside the spawned task rather than blocking `.setup()`.
            let scheduler_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                scheduler::start_git_truth_scheduler(scheduler_handle)
                    .await
                    .expect("failed to start the git-truth scheduler");
            });

            // D-174/D-175: the one task that closes each coalescing window and shows the banner.
            notify::spawn_notify_task(app.handle().clone());

            Ok(())
        })
        // This list is the enforcement point for the app's command surface: a #[tauri::command]
        // is reachable from the webview only if it is named here. The roster string in
        // `capabilities/default.json` is documentation, not enforcement. Adding a command means
        // adding it here; `tests/handler_roster.rs` fails the build if the two drift in either
        // direction (a command declared but not listed, or an entry naming no command).
        .invoke_handler(tauri::generate_handler![
            commands::project::project_register,
            commands::project::project_list,
            commands::project::project_reconcile,
            commands::project::project_relocate,
            commands::project::project_hide,
            commands::project::project_restore,
            commands::roadmap::milestone_create,
            commands::roadmap::milestone_list,
            commands::roadmap::milestone_set_state,
            commands::roadmap::milestone_move,
            commands::roadmap::milestone_progress,
            commands::epic::epic_create,
            commands::epic::epic_list,
            commands::epic::epic_update,
            commands::epic::epic_set_state,
            commands::shaping::epic_shape,
            commands::shaping::epic_shaping_session,
            commands::shaping::epic_shaping_rounds,
            commands::shaping::round_accept,
            commands::shaping::round_answer,
            commands::shaping::round_accept_all,
            commands::shaping::shaping_continue,
            commands::shaping::stage_close,
            commands::roadmap_round::roadmap_revisit,
            commands::roadmap_round::roadmap_round_read,
            commands::roadmap_round::roadmap_round_dismiss,
            commands::shaping::milestone_shape,
            commands::shaping::milestone_shaping_session,
            commands::shaping::milestone_shaping_rounds,
            commands::shaping::milestone_shaping_continue,
            commands::story::story_create,
            commands::story::story_drop,
            commands::story::story_list,
            commands::story::story_get,
            commands::story::story_context_packet_size,
            commands::story::story_update,
            commands::story::story_set_state,
            commands::story::story_write_by_hand,
            commands::story::story_list_for_project,
            commands::criterion::criterion_create,
            commands::criterion::criterion_list,
            commands::criterion::criterion_amend,
            commands::criterion::criterion_accept,
            commands::criterion::criterion_unaccept,
            commands::criterion::criterion_delete,
            commands::criterion::check_set,
            commands::criterion::check_remove,
            commands::task::task_add,
            commands::task::task_list,
            commands::task::task_move,
            commands::task::task_rename,
            commands::task::task_set_note,
            commands::task::task_set_state,
            commands::proposal::proposal_list_pending,
            commands::proposal::proposal_accept,
            commands::proposal::proposal_amend,
            commands::proposal::proposal_reject,
            commands::actor::actor_list,
            commands::events::events_activity_trail,
            commands::events::events_since_cursor,
            commands::menu::menu_set_action_enabled,
            commands::session::session_start,
            commands::session::story_start,
            commands::session::story_resume,
            commands::session::story_stopped,
            commands::session::session_log_window,
            commands::session::session_raw_window,
            commands::session::sessions_for_story,
            commands::session::session_get,
            commands::session::story_session_summaries,
            commands::session::session_acknowledge,
            commands::session::session_acknowledge_many,
            commands::session::worktree_summary,
            commands::session::worktree_remove_check,
            commands::session::worktree_remove,
            commands::session::worktree_recreate,
            commands::session::worktree_forget_record,
            commands::session::session_stop,
            commands::session::session_discard,
            commands::session::session_answer_permission,
            commands::session::session_answer_question,
            commands::session::permission_rules_list,
            commands::session::permission_rule_revoke,
            commands::session::session_pending_permissions,
            commands::session::story_latest_session,
            commands::session::board_blocked_summary,
            commands::session::board_recovery_summary,
            commands::session::sessions_pending_orphans,
            commands::session::orphan_kill,
            commands::settings::settings_get,
            commands::settings::launch_environment,
            commands::settings::settings_set_credential_mode,
            commands::settings::settings_store_api_key,
            commands::settings::settings_clear_api_key,
            commands::settings::backend_capability_probe,
            commands::settings::settings_set_notifications_enabled,
            commands::git_identity::git_identifier_resolve,
            commands::git_truth::git_facts,
            commands::git_truth::git_truth_focus_story,
            commands::worktree_open::worktree_open,
            commands::worktree_open::open_command_template,
            commands::worktree_open::set_open_command_template,
            commands::fleet::fleet_list,
            commands::fleet::fleet_blocked_queue,
            commands::fleet::fleet_waiting_rounds,
            commands::fleet::fleet_watch_run,
            commands::fleet::worktree_inventory,
            commands::fleet::worktree_measure,
            commands::fleet::worktree_reclaim,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // On app exit, tell the sidecar to end every live session BEFORE killing the sidecar
            // itself (CR-02). Every `claude` session is spawned `detached: true`
            // (`claude-code-adapter.ts`'s `startSession`) precisely so it becomes its own
            // process-group leader, independent of the sidecar's own group — so the sidecar's own
            // kill (below) cannot reach any of them. `shutdown_all_sessions` is the only thing
            // that still can, which is why it MUST run first: killing the supervisor before the
            // sessions would remove the only thing left able to signal them. A shutdown failure is
            // only logged, never allowed to skip the kill — a wedged or crashed sidecar must never
            // make the product unquittable.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Some(sidecar) = state.sidecar.as_ref() {
                        if let Err(err) = sidecar.shutdown_all_sessions() {
                            eprintln!("failed to signal live agent sessions during app exit: {err:#}");
                        }
                        sidecar.kill();
                    }
                }
            }
        });
}
