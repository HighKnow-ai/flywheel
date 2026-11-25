// check-menu-bar.mjs's parsing and judging, on a fixture shaped like read-menu-bar.jxa's output (written
// from menu.rs and AX's documented shape; the first run on a macOS runner prints the real text).
// Plain Node: it runs on Linux, where the Accessibility API does not exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { diffLines, judge, keyEquivalent, renderMenuBar } from "../check-menu-bar.mjs";

const snapshot = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/menu-bar-snapshot.json"), "utf8"));
const EXPECTED = `Flywheel:
  About Flywheel
  ---
  Settings… [⌘,]
  ---
  Quit Flywheel [⌘Q]
File:
  Register Project… [⇧⌘O]
  New Story [⌘N] (disabled)
  New Epic [⇧⌘N] (disabled)
  ---
  Close Window [⌘W]
Edit:
  Undo [⌘Z]
  Redo [⇧⌘Z]
  ---
  Cut [⌘X]
View:
  Toggle Command Palette [⌘K]
  Fleet [⇧⌘F]
`;

test("key equivalents print in macOS's glyph order", () => {
  assert.equal(keyEquivalent("f", 4 | 0), "⌃⌘F");
  assert.equal(keyEquivalent("f", 4 | 2 | 1), "⌃⌥⇧⌘F");
  assert.equal(keyEquivalent("", 0), "");
  assert.equal(keyEquivalent("x", 8), "X");
  assert.equal(keyEquivalent("a", null), "⌘A");
});

test("the menu bar renders as text without the Apple menu or the items macOS adds", () => {
  assert.equal(renderMenuBar(snapshot), EXPECTED);
});

test("a matching baseline and window title pass", () => {
  const verdict = judge({ snapshot, baseline: EXPECTED, windowTitle: "Flywheel" });
  assert.equal(verdict.ok, true, verdict.report);
});

test("a changed item names the line that differs", () => {
  const verdict = judge({ snapshot, baseline: EXPECTED.replace("New Story [⌘N] (disabled)", "New Story [⌘N]"), windowTitle: "Flywheel" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.report, /line 9 - {3}New Story \[⌘N\]\nline 9 \+ {3}New Story \[⌘N\] \(disabled\)/);
});

test("a missing item, an added item and a changed key all fail", () => {
  assert.equal(diffLines("a\nb\n", "a\n").length, 1);
  assert.equal(diffLines("a\n", "a\nb\n").length, 1);
  assert.equal(diffLines("a [⌘N]\n", "a [⇧⌘N]\n").length, 2);
  assert.deepEqual(diffLines("a\n", "a\n"), []);
});

test("a window with another title fails and the report lists the windows seen", () => {
  const verdict = judge({ snapshot: { ...snapshot, windows: ["Untitled"] }, baseline: EXPECTED, windowTitle: "Flywheel" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.report, /no window titled "Flywheel"; windows: \["Untitled"\]/);
});

test("no window at all fails, even when the menu bar matches", () => {
  const verdict = judge({ snapshot: { ...snapshot, windows: [] }, baseline: EXPECTED, windowTitle: "Flywheel" });
  assert.equal(verdict.ok, false);
});

test("no baseline fails and hands back the candidate text", () => {
  const verdict = judge({ snapshot, baseline: null, windowTitle: "Flywheel" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.candidate, EXPECTED);
  assert.match(verdict.report, /no baseline/);
});

test("an Accessibility refusal is reported with its cause", () => {
  const verdict = judge({ snapshot: { error: "osascript is not allowed assistive access (-1719)" }, baseline: EXPECTED, windowTitle: "Flywheel" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.report, /could not be read: .*not allowed assistive/);
});

test("an empty menu bar fails", () => {
  assert.equal(judge({ snapshot: { windows: ["Flywheel"], menus: [] }, baseline: "", windowTitle: "Flywheel" }).ok, false);
});

test("the stored window title is the one tauri.conf.json sets, and the helper reads the same bundle identifier", () => {
  const conf = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../packages/desktop/src-tauri/tauri.conf.json"), "utf8"));
  assert.equal(conf.app.windows[0].title, "Flywheel");
  assert.match(conf.identifier, /^[a-z.]+$/);
});
