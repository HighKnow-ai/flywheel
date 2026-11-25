// The configuration half of #1786's steps 1 and 2, judged as text: the window the app opens, and the
// native menu items the human check asks about. The window's real behaviour (move, resize, minimise) is
// the operating system's, and check-menu-bar.mjs reads the packaged menu bar; what a person could still
// get wrong without the check is a config line that turns a window control off, a size below the
// minimum, or a menu item dropped from menu.rs. Plain Node: it runs on Linux.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const desktop = path.resolve(import.meta.dirname, "../../../packages/desktop/src-tauri");
const conf = JSON.parse(fs.readFileSync(path.join(desktop, "tauri.conf.json"), "utf8"));
const menuSource = fs.readFileSync(path.join(desktop, "src/menu.rs"), "utf8");

test("the app opens one main window titled Flywheel, at a size that fits its minimum", () => {
  const windows = conf.app.windows;
  assert.equal(windows.length, 1, "one window opens at launch, not a second one behind it");
  const [win] = windows;
  assert.equal(win.title, "Flywheel");
  assert.ok(win.width >= win.minWidth, `width ${win.width} is below minWidth ${win.minWidth}`);
  assert.ok(win.height >= win.minHeight, `height ${win.height} is below minHeight ${win.minHeight}`);
  assert.ok(win.minWidth > 0 && win.minHeight > 0, "a minimum size is set, so a resize cannot crush the board");
});

test("no window control is switched off, so the window can move, resize, minimise and close", () => {
  const [win] = conf.app.windows;
  for (const key of ["resizable", "minimizable", "maximizable", "closable", "decorations", "visible", "focus"]) {
    assert.notEqual(win[key], false, `the window sets ${key}: false`);
  }
  for (const key of ["alwaysOnTop", "fullscreen"]) {
    assert.notEqual(win[key], true, `the window sets ${key}: true`);
  }
});

test("the menu keeps the standard items the human check names: Quit, Hide, Close Window, Undo, Cut, Copy, Paste", () => {
  for (const item of [".quit()", ".hide()", ".close_window()", ".undo()", ".redo()", ".cut()", ".copy()", ".paste()", ".select_all()", ".minimize()"]) {
    assert.ok(menuSource.includes(item), `menu.rs no longer builds ${item}`);
  }
});

const mainSource = fs.readFileSync(path.join(desktop, "src/main.rs"), "utf8");
const keyboardSource = fs.readFileSync(path.resolve(desktop, "../src/state/keyboard.ts"), "utf8");

/** The custom items of menu.rs: id, title and accelerator, in source order. */
function customItems() {
  const re = /MenuItemBuilder::with_id\("([^"]+)",\s*"([^"]+)"\)\s*\.accelerator\("([^"]+)"\)/g;
  return [...menuSource.matchAll(re)].map((m) => ({ id: m[1], title: m[2], accelerator: m[3] }));
}

test("every menu item and its key equivalent, as the app builds them", () => {
  assert.deepEqual(customItems(), [
    { id: "open-settings", title: "Settings…", accelerator: "CmdOrCtrl+," },
    { id: "register-project", title: "Register Project…", accelerator: "CmdOrCtrl+Shift+O" },
    { id: "create-story", title: "New Story", accelerator: "CmdOrCtrl+N" },
    { id: "create-epic", title: "New Epic", accelerator: "CmdOrCtrl+Shift+N" },
    { id: "open-palette", title: "Toggle Command Palette", accelerator: "CmdOrCtrl+K" },
    { id: "open-fleet", title: "Fleet", accelerator: "CmdOrCtrl+Shift+F" },
  ]);
});

test("the app menu holds About, Settings, Hide and Quit, in that order", () => {
  const app = menuSource.slice(menuSource.indexOf('SubmenuBuilder::new(app, "Flywheel")'), menuSource.indexOf("let register_project"));
  const order = [".about(", ".item(&open_settings)", ".hide()", ".quit()"].map((t) => app.indexOf(t));
  assert.ok(order.every((i) => i >= 0), `the app menu lacks an item: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the app menu items are out of order");
  assert.ok(!menuSource.includes(".hide_others()") && !menuSource.includes('"Help"'), "no item the design leaves out");
});

test("each custom item's action: main.rs forwards its id, and keyboard.ts knows it", () => {
  const forwarded = [...mainSource.match(/FORWARDED_MENU_ACTIONS: &\[&str\] = &\[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const ids = customItems().map((i) => i.id);
  assert.deepEqual([...forwarded].sort(), [...ids].sort(), "a menu item is not forwarded, or a forwarded id has no item");
  for (const id of ids) assert.ok(keyboardSource.includes(`"${id}"`), `${id} is not an ActionId in keyboard.ts`);
  assert.ok(mainSource.includes('app.emit("menu:action", id)'), "main.rs no longer emits menu:action");
});

test("the window menu and file menu keep their standard items", () => {
  for (const item of [".maximize()", ".bring_all_to_front()", "WINDOW_SUBMENU_ID"]) {
    assert.ok(menuSource.includes(item), `menu.rs no longer builds ${item}`);
  }
});
