use rusqlite::Connection;
use std::sync::Mutex;
use tauri::menu::MenuItem;

use crate::sidecar::SidecarHandle;

/// Tauri-managed application state: the single SQLite connection every command handler locks
/// before touching the database. `packages/core` owns the schema and every mutation function;
/// this struct only carries the connection through Tauri's state-management seam.
///
/// `sidecar` is `None` only in a context where the sidecar was never spawned (e.g. a future unit
/// test harness) — `main.rs`'s `.setup()` closure always populates it via its own
/// expect-or-crash-loudly idiom before any window is shown, so every real Tauri command handler
/// can treat a `None` here as "the sidecar failed to start," not a valid steady state.
pub struct AppState {
    pub db: Mutex<Connection>,
    pub sidecar: Option<SidecarHandle>,
    /// The launch-time classification's live-orphan list (plan 03-06, PROC-05, D-46) — populated
    /// EXACTLY ONCE, in `main.rs`'s `.setup()` closure, from `flywheel_core::domain::session::
    /// reconcile_sessions`'s own return value, before any window is shown. `orphan_kill`
    /// (`commands::session`) drains entries out of it as the user resolves each one; nothing
    /// else in this codebase ever repopulates it at runtime — a process orphaned DURING this
    /// session (rather than left over from a previous one) is covered by `RunEvent::Exit` and the
    /// per-session watchdog (plan 03-02), never by this field.
    pub pending_orphans: Mutex<Vec<flywheel_core::domain::session::LiveOrphan>>,
    /// D-114's "open detail panel" half of the git-truth hot tier (Phase 7 plan 07-01,
    /// `scheduler.rs`): the renderer declares which Story it is focused on via
    /// `git_truth_focus_story`, and `None` means none. This is display-freshness
    /// input only — never a source of truth about anything else, and never read by any mutation
    /// path in this codebase.
    pub focused_story: Mutex<Option<String>>,
    /// Phase 10 plan 10-07 (D-174): the agent run whose session surface the renderer is showing
    /// right now, or `None` (the fleet, the board and every other surface all report `None`).
    /// Read only by `notify.rs`, together with the window's focus read in Rust, to withhold the one
    /// banner for the session the user is already looking at.
    pub watched_run: Mutex<Option<String>>,
}

/// Native menu handles for the five forwarded custom items — `main.rs`'s
/// `FORWARDED_MENU_ACTIONS` and `state/keyboard.ts`'s `MENU_ACTION_IDS` on the TypeScript side.
/// `open_settings` is plan 02-10 Task 3's addition (D-39) — the same forwarding/enable-disable
/// discipline Phase 1's original four items already established, extended by one id rather than
/// widened into a general mechanism.
///
/// Registered once in `menu::build_menu`, looked up by
/// `commands::menu::menu_set_action_enabled` to push the renderer's layer verdict onto the
/// native menu bar (01-16-PLAN.md Task 2, UAT gap G-01-1's affordance half — the enforcement
/// half stays in the renderer's `bindingAllowedInLayer`).
///
/// Generic over `R: tauri::Runtime` because `menu::build_menu<R: Runtime>` — the only place this
/// struct is populated — keeps its own generic signature, so it must be generic too to receive
/// `MenuItem<R>` from it. `commands::menu::menu_set_action_enabled`, by contrast, binds
/// concretely to `MenuHandles<tauri::Wry>`: `generate_handler!` in `main.rs` is only ever
/// monomorphised on the `Builder<Wry>` there, so `Wry` is the only instantiation that can ever
/// land in the state map. This keeps a future `MockRuntime` test of `build_menu` itself possible
/// while leaving zero runtime inference at the invoke-handler seam.
pub struct MenuHandles<R: tauri::Runtime> {
    pub register_project: MenuItem<R>,
    pub create_story: MenuItem<R>,
    pub create_epic: MenuItem<R>,
    pub open_palette: MenuItem<R>,
    pub open_settings: MenuItem<R>,
    /// Phase 10 plan 10-01 (D-163): the Fleet item under View.
    pub open_fleet: MenuItem<R>,
}

impl<R: tauri::Runtime> MenuHandles<R> {
    /// Resolves an action id string to its handle, or `None` for anything outside the
    /// forwarded ids. `commands::menu::menu_set_action_enabled` uses the `None` case to refuse an
    /// unrecognised id rather than silently doing nothing — the renderer may only ever toggle
    /// the items the menu bar itself declares, never an arbitrary menu node
    /// (threat T-01-16-01).
    pub fn get(&self, action_id: &str) -> Option<&MenuItem<R>> {
        match action_id {
            "register-project" => Some(&self.register_project),
            "create-story" => Some(&self.create_story),
            "create-epic" => Some(&self.create_epic),
            "open-palette" => Some(&self.open_palette),
            "open-settings" => Some(&self.open_settings),
            "open-fleet" => Some(&self.open_fleet),
            _ => None,
        }
    }
}
