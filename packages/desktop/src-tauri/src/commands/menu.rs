//! `menu_set_action_enabled` — the one command the renderer's `state/menuSync.ts` calls to push
//! the layer guard's verdict onto the native menu bar (01-16-PLAN.md Task 2/3, UAT gap G-01-1's
//! affordance half).
//!
//! This command carries no authority of its own: an item being enabled does not make its action
//! permitted, because every dispatched id still passes `bindingAllowedInLayer` in the renderer
//! (`App.tsx`'s `menu:action` bridge, `state/keyboard.ts`'s `useGlobalBindings`). It only ever
//! flips `MenuItem::set_enabled` on one of the four handles `menu::build_menu` registered — never
//! text, accelerator or structure — and only for an id in that fixed set (threat T-01-16-01): an
//! unrecognised `action_id` is rejected with an explicit error rather than silently doing
//! nothing, so the renderer can never reach an arbitrary menu node through this seam.

use tauri::State;

use crate::state::MenuHandles;

/// Enables or disables one of the four forwarded custom menu items (`main.rs`'s
/// `FORWARDED_MENU_ACTIONS`, `state/keyboard.ts`'s `MENU_ACTION_IDS`). `MenuItem::set_enabled`
/// marshals to the main thread itself (`tauri::menu`'s `run_item_main_thread!`), so this is safe
/// to call from any thread the command handler runs on.
///
/// Bound concretely to `MenuHandles<tauri::Wry>` rather than a generic `Runtime` — see
/// `state::MenuHandles`'s doc comment for why: `generate_handler!` in `main.rs` is only ever
/// monomorphised on the `Builder<Wry>` there, so `Wry` is the only instantiation that can ever be
/// in the state map this command's `State<'_, …>` parameter resolves against.
#[tauri::command]
pub fn menu_set_action_enabled(
    handles: State<'_, MenuHandles<tauri::Wry>>,
    action_id: String,
    enabled: bool,
) -> Result<(), String> {
    let item = handles
        .get(&action_id)
        .ok_or_else(|| format!("unrecognised menu action id: {action_id}"))?;
    item.set_enabled(enabled).map_err(|e| e.to_string())
}
