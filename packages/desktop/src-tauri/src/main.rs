// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(feature = "headless", allow(unused))]

use flywheel_desktop_lib::{commands, menu, notify, startup, state};

use state::AppState;
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

#[cfg(feature = "headless")]
fn main() {
    eprintln!("flywheel-desktop does not run with the `headless` feature; run flywheel-headless");
    std::process::exit(2);
}

#[cfg(not(feature = "headless"))]
fn main() {
    // The shared cold-start path (`startup.rs`): the login PATH first, before any thread starts.
    startup::adopt_login_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // D-175: granted to the Rust core only. No notification permission is added to the window.
        .plugin(tauri_plugin_notification::init())
        .menu(menu::build_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if FORWARDED_MENU_ACTIONS.contains(&id) {
                let _ = app.emit("menu:action", id);
            }
        })
        .setup(|app| {
            // Database, reconciliation, sidecar, AppState and the scheduler: one function, shared
            // with the headless core (startup.rs). A failure aborts startup.
            startup::boot(app.handle()).expect("failed to start Flywheel");

            // D-174/D-175: the one task that closes each coalescing window and shows the banner.
            notify::spawn_notify_task(app.handle().clone());

            Ok(())
        })
        // The command surface is `src/roster.rs`'s one list; `tests/handler_roster.rs` owns it.
        .invoke_handler(flywheel_desktop_lib::command_roster!())
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
                            eprintln!(
                                "failed to signal live agent sessions during app exit: {err:#}"
                            );
                        }
                        sidecar.kill();
                    }
                }
            }
        });
}
