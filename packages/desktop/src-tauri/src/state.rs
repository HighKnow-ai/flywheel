use rusqlite::Connection;
use std::sync::Mutex;
use tauri::menu::MenuItem;

/// Tauri-managed application state: the single SQLite connection every command handler locks
/// before touching the database. `packages/core` owns the schema and every mutation function;
/// this struct only carries the connection through Tauri's state-management seam.
pub struct AppState {
    pub db: Mutex<Connection>,
}

/// Native menu handles for the four forwarded custom items — `main.rs`'s
/// `FORWARDED_MENU_ACTIONS` and `state/keyboard.ts`'s `MENU_ACTION_IDS` on the TypeScript side.
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
    pub create_task: MenuItem<R>,
    pub create_epic: MenuItem<R>,
    pub open_palette: MenuItem<R>,
}

impl<R: tauri::Runtime> MenuHandles<R> {
    /// Resolves an action id string to its handle, or `None` for anything outside the four
    /// forwarded ids. `commands::menu::menu_set_action_enabled` uses the `None` case to refuse an
    /// unrecognised id rather than silently doing nothing — the renderer may only ever toggle
    /// the four items the menu bar itself declares, never an arbitrary menu node
    /// (threat T-01-16-01).
    pub fn get(&self, action_id: &str) -> Option<&MenuItem<R>> {
        match action_id {
            "register-project" => Some(&self.register_project),
            "create-task" => Some(&self.create_task),
            "create-epic" => Some(&self.create_epic),
            "open-palette" => Some(&self.open_palette),
            _ => None,
        }
    }
}
