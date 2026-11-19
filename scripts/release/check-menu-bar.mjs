#!/usr/bin/env node
// The packaged app's menu bar, judged as text (issue #1786). Owner decision D4 keeps the app's
// dialogs manual; what a machine can judge is the menu bar and the main window's title, so this
// launches the built .app, reads both through the Accessibility API (read-menu-bar.jxa), renders
// them as plain text and compares that with the stored baseline, menu-bar.baseline.txt.
//
//   node scripts/release/check-menu-bar.mjs <Flywheel.app> [--baseline <file>]
//
// FIRST RUN. With no baseline file the check writes the text it saw to menu-bar.candidate.txt
// beside it, prints it, and fails: a baseline is approved once by a person who reads it, then the
// candidate is committed as menu-bar.baseline.txt. After that the check passes only on the same text.
//
// The text lists every menu and item by title, key equivalent and enabled state. A line a macOS
// release adds to a menu by itself (IGNORED_TITLES) is left out, so a runner image update does not
// change the baseline. The window title is checked on its own against tauri.conf.json's.
//
// Exit 0: same text, and the window opened with the expected title. Exit 1: a difference, a window
// that never opened, an Accessibility refusal, or a first run. Exit 2: usage.
//
// It never touches the keychain: it launches the app with `open` and reads System Events only.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const confPath = path.resolve(here, "../../packages/desktop/src-tauri/tauri.conf.json");
export const DEFAULT_BASELINE = path.join(here, "menu-bar.baseline.txt");
const HELPER = path.join(here, "read-menu-bar.jxa");

/** Items macOS puts into a menu itself, by title. They differ between macOS releases, not between builds. */
export const IGNORED_TITLES = new Set([
  "Start Dictation…",
  "Emoji & Symbols",
  "AutoFill",
  "Enter Full Screen",
  "Exit Full Screen",
  "Show Tab Bar",
  "Hide Tab Bar",
  "Show All Tabs",
  "Move Window to Left Side of Screen",
  "Move Window to Right Side of Screen",
  "Move & Resize",
  "Fill",
  "Center",
  "Return to Previous Size",
  "Zoom",
  "Zoom All",
  "Tile Window to Left of Screen",
  "Tile Window to Right of Screen",
  "Replace Window",
  "Remove Window from Set",
]);

/** The menu bar's own Apple menu belongs to macOS. */
const SYSTEM_MENUS = new Set(["Apple"]);

/** AX modifier bitmask to glyphs, in the order macOS prints them: control, option, shift, command. */
export function keyEquivalent(cmdChar, cmdModifiers) {
  if (!cmdChar) return "";
  const mods = typeof cmdModifiers === "number" ? cmdModifiers : 0;
  const glyphs =
    (mods & 4 ? "⌃" : "") + (mods & 2 ? "⌥" : "") + (mods & 1 ? "⇧" : "") + (mods & 8 ? "" : "⌘");
  return glyphs + cmdChar.toUpperCase();
}

function renderItems(items, depth) {
  const indent = "  ".repeat(depth);
  const lines = [];
  for (const item of items) {
    if (item.title === null || item.title === undefined || item.title === "") {
      lines.push(`${indent}---`);
      continue;
    }
    if (IGNORED_TITLES.has(item.title)) continue;
    const key = keyEquivalent(item.cmdChar, item.cmdModifiers);
    const parts = [item.title];
    if (key) parts.push(`[${key}]`);
    if (item.enabled === false) parts.push("(disabled)");
    lines.push(indent + parts.join(" "));
    if (item.children && item.children.length > 0) lines.push(...renderItems(item.children, depth + 1));
  }
  // A separator the ignored items left first, last or doubled is dropped with them.
  const kept = lines.filter((line, i) => line.trim() !== "---" || (i > 0 && lines[i - 1].trim() !== "---"));
  while (kept.length > 0 && kept[0].trim() === "---") kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim() === "---") kept.pop();
  return kept;
}

/** The menu bar `read-menu-bar.jxa` returned, as the baseline's text (one trailing newline). */
export function renderMenuBar(snapshot) {
  const lines = [];
  for (const menu of snapshot.menus) {
    if (SYSTEM_MENUS.has(menu.title)) continue;
    lines.push(`${menu.title}:`, ...renderItems(menu.children ?? [], 1));
  }
  return lines.join("\n") + "\n";
}

/** `[]` when the texts are the same, else one line per difference: `- expected`, `+ seen`. */
export function diffLines(expected, actual) {
  const want = expected.replace(/\n+$/, "").split("\n");
  const got = actual.replace(/\n+$/, "").split("\n");
  const out = [];
  for (let i = 0; i < Math.max(want.length, got.length); i += 1) {
    if (want[i] === got[i]) continue;
    if (want[i] !== undefined) out.push(`line ${i + 1} - ${want[i]}`);
    if (got[i] !== undefined) out.push(`line ${i + 1} + ${got[i]}`);
  }
  return out;
}

/**
 * Judges one reading. `baseline` is the stored text or null. Returns { ok, report, candidate }:
 * `candidate` is the text to write when there is no baseline.
 */
export function judge({ snapshot, baseline, windowTitle }) {
  if (snapshot.error) return { ok: false, report: `the menu bar could not be read: ${snapshot.error}` };
  const text = renderMenuBar(snapshot);
  const problems = [];
  if (!snapshot.windows.includes(windowTitle)) {
    problems.push(`no window titled ${JSON.stringify(windowTitle)}; windows: ${JSON.stringify(snapshot.windows)}`);
  }
  if (snapshot.menus.length === 0) problems.push("the menu bar has no menu");
  if (baseline === null) {
    problems.push("there is no baseline: the text below is the candidate; a person approves it once and commits it");
    return { ok: false, report: problems.join("\n"), candidate: text, text };
  }
  const diff = diffLines(baseline, text);
  if (diff.length > 0) problems.push(`the menu bar differs from the baseline:\n${diff.join("\n")}`);
  return { ok: problems.length === 0, report: problems.join("\n"), text };
}

function readSnapshot(bundleId) {
  const run = spawnSync("osascript", ["-l", "JavaScript", HELPER, bundleId], { encoding: "utf8" });
  if (run.status !== 0) return { error: `osascript exited ${run.status}: ${run.stderr.trim()}` };
  try {
    return JSON.parse(run.stdout.trim());
  } catch {
    return { error: `osascript printed something that is not JSON: ${run.stdout.slice(0, 200)}` };
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Polls until the window exists and two readings 1.5 s apart give the same text. */
function settledSnapshot(bundleId, windowTitle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let snapshot = { error: "no reading" };
  while (Date.now() < deadline) {
    snapshot = readSnapshot(bundleId);
    // An Accessibility refusal does not heal: stop and say so.
    if (snapshot.error && /not allowed|assistive|-25211|-1719/i.test(snapshot.error)) return snapshot;
    if (!snapshot.error && snapshot.windows.includes(windowTitle) && snapshot.menus.length > 0) {
      const text = renderMenuBar(snapshot);
      if (text === last) return snapshot;
      last = text;
    }
    sleep(1500);
  }
  return snapshot;
}

function main(argv) {
  const app = argv[0];
  if (!app || app.startsWith("--")) {
    console.error("usage: node scripts/release/check-menu-bar.mjs <Flywheel.app> [--baseline <file>]");
    return 2;
  }
  const at = argv.indexOf("--baseline");
  const baselinePath = at >= 0 ? path.resolve(argv[at + 1]) : DEFAULT_BASELINE;
  const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
  const windowTitle = conf.app.windows[0].title;

  const launched = spawnSync("open", ["-n", app], { encoding: "utf8" });
  if (launched.status !== 0) {
    console.error(`could not launch ${app}: ${launched.stderr.trim()}`);
    return 1;
  }
  let snapshot;
  try {
    snapshot = settledSnapshot(conf.identifier, windowTitle, 90_000);
  } finally {
    spawnSync("osascript", ["-e", `tell application id "${conf.identifier}" to quit`], { encoding: "utf8" });
  }
  const baseline = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, "utf8") : null;
  const verdict = judge({ snapshot, baseline, windowTitle });
  if (verdict.candidate !== undefined) {
    const candidatePath = path.join(path.dirname(baselinePath), "menu-bar.candidate.txt");
    fs.writeFileSync(candidatePath, verdict.candidate);
    console.error(`wrote ${candidatePath}`);
  }
  if (verdict.ok) {
    console.log(`menu bar matches ${path.basename(baselinePath)}; window ${JSON.stringify(windowTitle)} opened`);
    return 0;
  }
  console.error(verdict.report);
  // What was seen, in full, so a failure is readable without a rerun.
  console.error("--- menu bar as seen ---");
  console.error(verdict.text ?? JSON.stringify(snapshot, null, 2));
  console.error(`--- windows: ${JSON.stringify(snapshot.windows ?? [])} ---`);
  return 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main(process.argv.slice(2)));
