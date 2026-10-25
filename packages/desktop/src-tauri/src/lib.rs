//! The desktop shell's modules, as a library so integration tests can drive the commands
//! (issue #220): `main.rs` builds the app from them and stays the one place that registers the
//! command surface (`generate_handler!`).

pub mod commands;
pub mod menu;
pub mod notify;
pub mod scheduler;
pub mod sidecar;
pub mod state;
