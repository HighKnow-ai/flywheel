//! The native macOS menu bar (01-UI-SPEC.md "App shell & window chrome" — "minimal, native, real
//! destinations only — no placeholder items"; 01-09-PLAN.md Task 2).
//!
//! Every custom item's id is a literal `state/keyboard.ts` `ActionId` string — `main.rs`'s
//! `on_menu_event` handler emits it verbatim as the `menu:action` event payload, and the
//! frontend's `state/keyboard.ts::dispatchAction` re-enters the exact same `resolveBinding`/
//! `useGlobalBindings` path a real keystroke would (threat T-01-02: "menu items invoke the same
//! registered commands as the UI; no menu item is given a broader capability"). This module never
//! calls a Tauri command or mutates state directly — it only ever emits the id.
//!
//! No Help item exists (01-UI-SPEC.md Open Decisions #8): it has no real destination to point to
//! yet, and a menu entry that goes nowhere is worse than its absence — enforced here by simply
//! never building one, not by a runtime check.
//!
//! No "Toggle Group By" item exists either (Open Decisions #9): the secondary "Group by" lens was
//! cut from this phase's scope (a delegated enhancement the planner may drop without violating
//! any locked decision), so a menu entry for it would have no behavior to invoke — the same
//! "no no-op item" discipline the Help omission follows.
//!
//! A custom item's enabled state is driven from the renderer's layer model
//! (`state/keyboard.ts`'s `bindingAllowedInLayer`) via `commands::menu::menu_set_action_enabled`
//! (01-16-PLAN.md Task 2/3, UAT gap G-01-1). A disabled item neither renders as actionable nor
//! fires its key equivalent, so a trapped layer (the item detail panel, a row-level picker, the
//! palette) can never leave an item enabled-but-dead the way the pre-fix bridge did. This is the
//! affordance half of the fix; the guard in the renderer (`useGlobalBindings`, unchanged) remains
//! the enforcement half — an item being enabled here confers no authority of its own.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Manager, Runtime};

use crate::state::MenuHandles;

/// Builds the whole menu bar. Called once from `main.rs`'s `Builder::menu` during setup.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // "Settings…" with the `⌘,` accelerator — the macOS convention for an app's own preferences
    // item, placed in the App menu between About and Quit (plan 02-10 Task 3). This is the first
    // of the product's three routes into the Settings surface (D-39); the other two are the
    // global `⌘,` keystroke itself (`state/keyboard.ts`'s `open-settings` binding, already
    // registered by plan 02-03) and the command palette entry generated from that same binding.
    let open_settings = MenuItemBuilder::with_id("open-settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Flywheel")
        .about(None)
        .separator()
        .item(&open_settings)
        .separator()
        .quit()
        .build()?;

    let register_project = MenuItemBuilder::with_id("register-project", "Register Project…")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let new_task = MenuItemBuilder::with_id("create-task", "New Task")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let new_epic = MenuItemBuilder::with_id("create-epic", "New Epic")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let toggle_palette = MenuItemBuilder::with_id("open-palette", "Toggle Command Palette")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;

    // Register the layer-aware handles BEFORE the five items are placed into their submenus
    // below — `.item(&x)` only ever borrows, but registering here (right after all five exist,
    // right before any submenu references them) is what keeps this the one place a future sixth
    // forwarded item would also need touching. `AppHandle<R>` implements `Manager`, so `manage`
    // is available on any runtime `build_menu` is instantiated against; the one real call site
    // (`tauri::Builder::default()` in `main.rs`) instantiates `R` as `tauri::Wry`, which is the
    // concrete type `commands::menu::menu_set_action_enabled`'s `State<'_, MenuHandles<Wry>>`
    // resolves against (see `state::MenuHandles`'s doc comment for the full generic-vs-concrete
    // resolution).
    app.manage(MenuHandles {
        register_project: register_project.clone(),
        create_task: new_task.clone(),
        create_epic: new_epic.clone(),
        open_palette: toggle_palette.clone(),
        open_settings: open_settings.clone(),
    });

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&register_project)
        .item(&new_task)
        .item(&new_epic)
        .separator()
        .close_window()
        .build()?;

    // Standard macOS defaults only — native text-field Cut/Copy/Paste/Undo/Redo behavior, no
    // custom items (01-UI-SPEC.md "App shell & window chrome").
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View").item(&toggle_palette).build()?;

    // `WINDOW_SUBMENU_ID` is what tells macOS to auto-populate this submenu with the running
    // window list (the same id Tauri's own `Menu::default` uses) — a plain `SubmenuBuilder::new`
    // titled "Window" would render the items below but never gain that native window-list
    // behavior "the standard macOS Window menu" implies.
    let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}
