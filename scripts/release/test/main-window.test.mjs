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

test("the menu keeps the standard items the human check names: Quit, Close Window, Undo, Cut, Copy, Paste", () => {
  for (const item of [".quit()", ".close_window()", ".undo()", ".redo()", ".cut()", ".copy()", ".paste()", ".select_all()", ".minimize()"]) {
    assert.ok(menuSource.includes(item), `menu.rs no longer builds ${item}`);
  }
});
