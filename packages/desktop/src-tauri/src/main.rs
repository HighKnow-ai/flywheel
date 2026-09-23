// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;
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
const FORWARDED_MENU_ACTIONS: &[&str] =
    &["register-project", "create-task", "create-epic", "open-palette", "open-settings"];

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
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

            // Launch-time reconciliation for agent runs (PROC-05, D-46, D-49, D-50, plan 03-06):
            // every `agent_runs` row still `running`/`blocked` when the app died is sorted into
            // killed-by-its-watchdog, dead-without-a-record, or genuinely-still-alive — the first
            // two are written to `abandoned` here; the third is NEVER written to any status
            // (writing one would be the board lying about a live fact, D-46) and is instead
            // returned as a live-orphan list stored on `AppState` below, for the first paint's
            // recovery modal (plan 03-10) to offer the user a decision. Same expect-or-crash-
            // loudly idiom, same already-resolved `reconcile_actor_id`, and runs BEFORE
            // `spawn_sidecar` so the classification is already resolved before any new session
            // could possibly start.
            let pending_orphans =
                flywheel_core::domain::agent_run::reconcile_agent_runs(&mut conn, &reconcile_actor_id)
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
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::project_register,
            commands::project::project_list,
            commands::project::project_reconcile,
            commands::project::project_relocate,
            commands::task::task_create,
            commands::task::task_update,
            commands::task::task_delete,
            commands::task::task_set_status,
            commands::task::task_reorder,
            commands::task::task_set_priority,
            commands::task::task_set_estimate,
            commands::task::task_set_assignee,
            commands::task::task_set_epic,
            commands::epic::epic_create,
            commands::epic::epic_update,
            commands::epic::epic_delete,
            commands::epic::epic_set_status,
            commands::epic::epic_reorder,
            commands::epic::epic_set_priority,
            commands::epic::epic_set_estimate,
            commands::epic::epic_set_assignee,
            commands::epic::epic_list_all,
            commands::issue::issue_create,
            commands::issue::issue_update,
            commands::issue::issue_delete,
            commands::issue::issue_reorder,
            commands::issue::issue_set_parent,
            commands::board::board_list,
            commands::board::board_search,
            commands::actor::actor_list,
            commands::criterion::criterion_create,
            commands::criterion::criterion_update,
            commands::criterion::criterion_toggle,
            commands::criterion::criterion_reorder,
            commands::criterion::criterion_delete,
            commands::criterion::criterion_list,
            commands::criterion::criterion_revise,
            commands::criterion::criterion_revisions,
            commands::events::events_activity_trail,
            commands::events::events_since_cursor,
            commands::menu::menu_set_action_enabled,
            commands::agent_run::agent_run_preview,
            commands::agent_run::agent_run_start,
            commands::agent_run::agent_run_log_window,
            commands::agent_run::agent_run_raw_window,
            commands::agent_run::agent_runs_for_task,
            commands::agent_run::task_session_summaries,
            commands::agent_run::agent_run_acknowledge,
            commands::agent_run::worktree_summary,
            commands::agent_run::worktree_remove_check,
            commands::agent_run::worktree_remove,
            commands::agent_run::worktree_recreate,
            commands::agent_run::worktree_forget_record,
            commands::agent_run::agent_run_stop,
            commands::agent_run::agent_run_discard,
            commands::agent_run::agent_run_answer_permission,
            commands::agent_run::permission_rules_list,
            commands::agent_run::permission_rule_revoke,
            commands::agent_run::agent_run_pending_permissions,
            commands::agent_run::task_latest_agent_run,
            commands::agent_run::board_blocked_summary,
            commands::agent_run::board_recovery_summary,
            commands::agent_run::agent_runs_pending_orphans,
            commands::agent_run::orphan_kill,
            commands::settings::settings_get,
            commands::settings::settings_set_credential_mode,
            commands::settings::settings_store_api_key,
            commands::settings::settings_clear_api_key,
            commands::settings::backend_capability_probe,
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
