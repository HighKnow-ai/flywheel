// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::board::board_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
