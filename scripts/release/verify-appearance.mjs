#!/usr/bin/env node
// Does macOS Dark/Light actually reach the INSTALLED app's WKWebView? (plan 11-20, D-REV-22, T-11-56/57)
//
// For each appearance: set the system appearance, launch /Applications/Flywheel.app, screenshot the
// app window at OS level, sample ground pixels, and compare to the --surface-dominant token READ FROM
// packages/desktop/src/styles/tokens.css (the shipped bytes; a hardcoded hex would pass forever after
// a token change). Prints one line per appearance, exits non-zero on any mismatch.
//
// Needs: macOS, Accessibility + Screen Recording permission for the terminal running this, and
// FLYWHEEL_APP (default /Applications/Flywheel.app). The app runs against a scratch HOME so it never
// touches the owner's database; it is quit afterwards.
//
// The system appearance is changed through System Events (live, so the menu bar and every running app
// follow) and the original value is restored in a cleanup that also runs on failure and on signals.
// `AppleInterfaceStyle` is absent in Light mode, and absence is the value that gets restored.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const APP = process.env.FLYWHEEL_APP ?? "/Applications/Flywheel.app";
const PROC = "flywheel-desktop"; // the bundle's main executable name, as System Events sees the process
const KEEP = process.env.KEEP_SHOTS_DIR; // optional: copy the window shots here (they hold only the app window)
// Tolerance: +-4 of 255 per channel. Allows for display colour management (the capture is in the
// display's profile, e.g. Display P3) while staying far below the gap between the two grounds.
const TOL = 4;

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const osa = (script) => sh("osascript", ["-e", script]);
const sleep = (s) => spawnSync("sleep", [String(s)]);

// --- tokens: light is the first --surface-dominant (:root), dark the first one after the dark media query.
const css = readFileSync(join(ROOT, "packages/desktop/src/styles/tokens.css"), "utf8");
const ground = (from) => {
  const m = /--surface-dominant:\s*(#[0-9a-fA-F]{6})\s*;/.exec(css.slice(from));
  if (!m) throw new Error("--surface-dominant not found in tokens.css");
  return m[1].toLowerCase();
};
const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
if (darkAt < 0) throw new Error("dark media block not found in tokens.css");
const TOKENS = { Light: ground(0), Dark: ground(darkAt) };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// --- system appearance, with restore.
const readStyle = () => {
  const r = spawnSync("defaults", ["read", "-g", "AppleInterfaceStyle"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "(absent)";
};
const isDark = () => osa('tell application "System Events" to tell appearance preferences to get dark mode') === "true";
const setDark = (on) => osa(`tell application "System Events" to tell appearance preferences to set dark mode to ${on}`);
const originalDark = isDark();
const originalStyle = readStyle();
const originalAuto = spawnSync("defaults", ["read", "-g", "AppleInterfaceStyleSwitchesAutomatically"], { encoding: "utf8" }).stdout.trim();

const quitApp = () => spawnSync("pkill", ["-f", `${APP}/Contents/MacOS/`]);
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  quitApp();
  try { setDark(originalDark); } catch (e) { console.error("RESTORE FAILED:", e.message); }
};
process.on("exit", restore);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => process.exit(130));

// --- window + pixel helpers.
function appWindow() {
  // Largest window of the app, as [x, y, w, h] in points.
  const out = osa(`tell application "System Events" to tell process "${PROC}" to get {position, size} of every window`);
  const n = out.split(",").map((s) => parseInt(s, 10));
  const wins = [];
  for (let i = 0; i + 3 < n.length; i += 4) wins.push([n[i], n[i + 1], n[i + 2], n[i + 3]]);
  return wins.sort((a, b) => b[2] * b[3] - a[2] * a[3])[0];
}

function readBmp(path) {
  const b = readFileSync(path);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22), bpp = b.readUInt16LE(28);
  const stride = Math.floor((bpp * w + 31) / 32) * 4, Bpp = bpp / 8;
  const px = (x, y) => {
    const row = h > 0 ? h - 1 - y : y; // positive height = bottom-up
    const o = off + row * stride + x * Bpp;
    return [b[o + 2], b[o + 1], b[o]]; // BGR(A) -> RGB
  };
  return { w, h: Math.abs(h), px };
}

function runOne(mode, scratch) {
  setDark(mode === "Dark");
  sleep(2);
  const style = readStyle();
  const wantStyle = mode === "Dark" ? "Dark" : "(absent)";
  if (style !== wantStyle) throw new Error(`system did not switch: AppleInterfaceStyle is ${style}, wanted ${wantStyle}`);

  quitApp();
  sleep(2);
  const home = mkdtempSync(join(scratch, `home-${mode}-`));
  sh("open", ["-n", "--env", `HOME=${home}`, APP]);
  let win;
  for (let i = 0; i < 30 && !win; i++) {
    sleep(1);
    try { win = appWindow(); } catch { /* process not up yet */ }
  }
  if (!win) throw new Error("the app window never appeared");
  osa(`tell application "System Events" to set frontmost of process "${PROC}" to true`);
  sleep(4); // first paint plus the empty-state mount

  const [x, y, w, h] = win;
  const png = join(scratch, `${mode}.png`), bmp = join(scratch, `${mode}.bmp`);
  sh("screencapture", ["-x", "-R", `${x},${y},${w},${h}`, png]);
  sh("sips", ["-s", "format", "bmp", png, "--out", bmp]);
  if (KEEP) copyFileSync(png, join(KEEP, `11-20-appearance-${mode.toLowerCase()}.png`));
  const img = readBmp(bmp);

  // Sampled region: the left and right margins of the window's content area, at 35-65% of the height.
  // That is the full-height `.rack-ground` (App.css) behind the centred empty state, clear of the title
  // bar (top 5%), of the centred content column (x in 25-75%), and of the update banner (bottom right,
  // below 70% of the height). Four points, all of which must match.
  const pts = [[0.08, 0.35], [0.08, 0.65], [0.92, 0.35], [0.92, 0.55]].map(([fx, fy]) => [Math.round(fx * img.w), Math.round(fy * img.h)]);
  const want = hex(TOKENS[mode]);
  const got = pts.map(([px, py]) => img.px(px, py));
  const ok = got.every((g) => g.every((c, i) => Math.abs(c - want[i]) <= TOL));
  const fmt = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  console.log(
    `${ok ? "PASS" : "FAIL"}  AppleInterfaceStyle=${style}  mode=${mode}  sampled=${got.map(fmt).join(",")}  expected=${TOKENS[mode]}  tolerance=+-${TOL}/channel  window=${w}x${h}`,
  );
  return ok;
}

// --- main
if (process.platform !== "darwin") { console.error("macOS only"); process.exit(2); }
try { sh("test", ["-d", APP]); } catch { console.error(`FAIL  ${APP} is absent (a development build is not the subject)`); process.exit(2); }
console.log(`installed app: ${APP}`);
console.log(`original system appearance: dark=${originalDark} AppleInterfaceStyle=${originalStyle} SwitchesAutomatically=${originalAuto || "(absent)"}`);
console.log(`tokens.css --surface-dominant: light=${TOKENS.Light} dark=${TOKENS.Dark}`);

const scratch = mkdtempSync(join(tmpdir(), "flywheel-appearance-"));
let allOk = true;
try {
  for (const mode of ["Dark", "Light"]) allOk = runOne(mode, scratch) && allOk;
} catch (e) {
  console.error("FAIL ", e.message);
  allOk = false;
} finally {
  restore();
}
sleep(1);
const after = readStyle();
console.log(`restored system appearance: AppleInterfaceStyle=${after} (was ${originalStyle})`);
if (after !== originalStyle) { console.error("FAIL  appearance was not restored"); allOk = false; }
process.exit(allOk ? 0 : 1);
