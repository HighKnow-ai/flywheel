//! `#[tauri::command]` handlers, one module per entity — the only code in `packages/desktop`
//! that calls into `packages/core`'s mutation functions. Every handler locks `AppState.db`,
//! validates its input shape and length before calling into the core, stamps `actor_id` from the
//! local human actor on the Rust side (T-01-04, never from a renderer-supplied claim), and, after
//! a successful mutation, emits `board:changed` (D-04).

pub mod actor;
pub mod agent_run;
pub mod authoring;
pub mod board;
pub mod criterion;
pub mod epic;
pub mod events;
pub mod git_truth;
pub mod issue;
pub mod menu;
pub mod project;
pub mod settings;
pub mod task;
