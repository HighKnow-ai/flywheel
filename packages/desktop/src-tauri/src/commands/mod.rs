//! `#[tauri::command]` handlers, one module per entity — the only code in `packages/desktop`
//! that calls into `packages/core`'s mutation functions. Every handler locks `AppState.db`,
//! validates its input shape and length before calling into the core, stamps `actor_id` from the
//! local human actor on the Rust side (T-01-04, never from a renderer-supplied claim), and, after
//! a successful mutation, emits `board:changed` (D-04).

pub mod board;
pub mod epic;
pub mod issue;
pub mod project;
pub mod task;
