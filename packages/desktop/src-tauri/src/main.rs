// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;
mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// `menu.rs`'s custom item ids — the only ones this handler forwards to the frontend as
/// `menu:action` (01-09-PLAN.md Task 2, threat T-01-02). Every other menu event (predefined
/// items — Quit, Close Window, Cut/Copy/Paste/Undo/Redo, Minimize/Maximize/Bring All to Front,
/// About) is already handled natively by Tauri/the OS and needs no forwarding here.
const FORWARDED_MENU_ACTIONS: &[&str] = &["register-project", "create-task", "create-epic", "open-palette"];

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            let conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
                .expect("failed to open and migrate the database at startup");

            app.manage(AppState {
                db: Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::project_register,
            commands::project::project_list,
            commands::task::task_create,
            commands::task::task_update,
            commands::task::task_delete,
            commands::task::task_set_status,
            commands::task::task_reorder,
            commands::task::task_set_priority,
            commands::task::task_set_estimate,
            commands::task::task_set_assignee,
            commands::epic::epic_create,
            commands::epic::epic_update,
            commands::epic::epic_delete,
            commands::epic::epic_set_status,
            commands::epic::epic_reorder,
            commands::epic::epic_set_priority,
            commands::epic::epic_set_estimate,
            commands::epic::epic_set_assignee,
            commands::issue::issue_create,
            commands::issue::issue_update,
            commands::issue::issue_delete,
            commands::issue::issue_reorder,
            commands::board::board_list,
            commands::board::board_search,
            commands::actor::actor_list,
            commands::criterion::criterion_create,
            commands::criterion::criterion_update,
            commands::criterion::criterion_toggle,
            commands::criterion::criterion_reorder,
            commands::criterion::criterion_delete,
            commands::criterion::criterion_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
