use rusqlite::Connection;
use std::sync::Mutex;

/// Tauri-managed application state: the single SQLite connection every command handler locks
/// before touching the database. `packages/core` owns the schema and every mutation function;
/// this struct only carries the connection through Tauri's state-management seam.
pub struct AppState {
    pub db: Mutex<Connection>,
}
