use rusqlite::Connection;
use std::sync::Mutex;

/// Tauri-managed application state: the single SQLite connection every command handler locks
/// before touching the database. `packages/core` owns the schema and every mutation function;
/// this struct only carries the connection through Tauri's state-management seam.
pub struct AppState {
    // No #[tauri::command] handler reads this yet — the first one lands in plan 01-03's
    // tracer slice (create_task / list_board). Silencing dead_code here is deliberate: the
    // field's presence and type are what this plan's task verifies.
    #[allow(dead_code)]
    pub db: Mutex<Connection>,
}
