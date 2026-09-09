//! Domain mutation and read functions — the only code in this workspace that executes a
//! mutating SQL statement (ARCHITECTURE.md Anti-Pattern 3, D-03). The renderer and any future
//! sidecar reach the database only through the Rust command surface in `packages/desktop`, which
//! calls straight through to these functions — never by opening the SQLite file itself.

pub mod actor;
pub mod event;
pub mod project;
pub mod task;
