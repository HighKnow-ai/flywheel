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
/// These same four ids are the exact set `menu_set_action_enabled` (`commands/menu.rs`) accepts
/// (01-16-PLAN.md Task 2, UAT gap G-01-1) — `state/keyboard.ts`'s `MENU_ACTION_IDS` is their
/// renderer-side mirror, kept in sync by hand across the IPC seam since a Rust const and a
/// TypeScript array cannot share a single source.
const FORWARDED_MENU_ACTIONS: &[&str] = &["register-project", "create-task", "create-epic", "open-palette"];

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

            // Spawn the sidecar supervisor before any window is shown, with the same
            // expect-or-crash-loudly idiom the migration step above already uses — a sidecar
            // that fails to start means no agent run can ever be driven, so this never proceeds
            // silently (PROC-01, PROC-02).
            let sidecar_handle = sidecar::spawn_sidecar(app.handle())
                .expect("failed to spawn the flywheel-sidecar process at startup");

            app.manage(AppState {
                db: Mutex::new(conn),
                sidecar: Some(sidecar_handle),
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
            commands::events::events_activity_trail,
            commands::events::events_since_cursor,
            commands::menu::menu_set_action_enabled,
            commands::agent_run::agent_run_preview,
            commands::agent_run::agent_run_start,
            commands::agent_run::agent_run_log_window,
            commands::agent_run::agent_run_stop,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill the sidecar's own process (and, transitively, every session it was driving)
            // on app exit — never leave an orphaned sidecar or agent process behind
            // (RESEARCH.md Pitfall 3, applied at the supervisor-exit level).
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Some(sidecar) = state.sidecar.as_ref() {
                        sidecar.kill();
                    }
                }
            }
        });
}
