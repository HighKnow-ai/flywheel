//! The desktop shell's modules, as a library so integration tests can drive the commands
//! (issue #220): `main.rs` builds the app from them and stays the one place that registers the
//! command surface (`generate_handler!`).

pub mod commands;
pub mod menu;
pub mod notify;
pub mod roster;
pub mod scheduler;
pub mod sidecar;
pub mod startup;
pub mod state;

/// The Tauri runtime the commands and the sidecar supervisor are written against: the real window
/// system in the app, and, under the `headless` feature, the mock runtime that the end-to-end
/// harness's `flywheel-headless` binary hosts them on (`packages/desktop/README.md`, "End-to-end").
/// The handlers are the same functions in both builds; only this alias differs. The feature exists
/// for that one binary: `main.rs` does not build with it.
#[cfg(not(feature = "headless"))]
pub type Rt = tauri::Wry;
/// See the other [`Rt`].
#[cfg(feature = "headless")]
pub type Rt = tauri::test::MockRuntime;

/// `tauri::AppHandle` on [`Rt`]: what every command that is not generic over the runtime takes.
pub type AppHandle = tauri::AppHandle<Rt>;
