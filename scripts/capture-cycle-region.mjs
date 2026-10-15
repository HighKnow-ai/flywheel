#!/usr/bin/env node
// Photograph the RUNNING desktop application on the demonstration board, in both appearances
// (phase 14, plan 14-10, VIS-07, D-27). Usage: node scripts/capture-cycle-region.mjs
//
// This script captures and nothing else. It never writes the owner's yes or no; everything up to the
// judgement is automated and the judgement is a person's (D-27).
//
// What it does, in order:
//   1. refuses to run without the demo database (names scripts/demo-board.sh, which creates it);
//   2. builds the desktop binary unconditionally, so each image is of the code in the working tree, and
//      proves with `strings` that the binary honours the app-data seam (a stale one silently opens the
//      developer's REAL fleet database);
//   3. starts the frontend dev server when the debug binary needs one (it loads from localhost:1420);
//   4. launches the binary against the demo database only, ONCE: a second launch would rewrite the
//      seeded running and blocked runs to abandoned, so the appearance is switched live instead;
//   5. screenshots the whole application window at OS level in Dark then Light, checks each image's
//      ground against --surface-dominant READ FROM tokens.css, and writes capture-manifest.json naming
//      the binary and the database behind every image;
//   6. quits the app, stops the dev server it started, and restores the system appearance (also on
//      failure and on signals).
//
// Re-seed first for a clean board:  DEMO_SEED_ONLY=1 scripts/demo-board.sh
// Needs macOS and Accessibility + Screen Recording permission for the terminal running this.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".planning/phases/14-cycles-on-screen-state-in-colour/screenshots");
const PROC = "desktop"; // the binary's name, as System Events sees the process
const DEV_PORT = 1420;
const TOL = 4; // +-4 of 255 per channel, as scripts/release/verify-appearance.mjs justifies
const MIN_GROUND_SHARE = 0.2; // the dominant surface is the page ground, so a real board is mostly it

const fail = (msg, code = 1) => { console.error(`FAIL  ${msg}`); process.exit(code); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim();
const osa = (script) => sh("osascript", ["-e", script]);
const sleep = (s) => spawnSync("sleep", [String(s)]);

if (process.platform !== "darwin") fail("macOS only", 2);

// --- 1. the demo database, resolved as scripts/demo-board.sh resolves it (<repo>/target/demo-board/appdata).
if (!readFileSync(join(ROOT, "scripts/demo-board.sh"), "utf8").includes('DEMO_BASE="${REPO_ROOT}/target/demo-board"')) {
  fail("scripts/demo-board.sh no longer puts the board at target/demo-board; update this script to match", 2);
}
const APP_DATA = join(ROOT, "target/demo-board/appdata");
const WORKTREES = join(ROOT, "target/demo-board/worktrees");
const DB = join(APP_DATA, "flywheel.db");
if (!existsSync(DB)) fail(`no demo database at ${DB}. Create it with: DEMO_SEED_ONLY=1 scripts/demo-board.sh`, 2);

// --- 2. build unconditionally, then prove the seams.
console.log("building the desktop binary (cargo build -p desktop)");
const build = spawnSync("cargo", ["build", "-p", "desktop"], { cwd: ROOT, stdio: "inherit" });
if (build.status !== 0) fail("cargo build -p desktop failed", 2);
const BIN = join(ROOT, "target/debug/desktop");
if (!existsSync(BIN)) fail(`${BIN} is absent after the build`, 2);
// `grep -c`, not `grep -q`: under pipefail a matching -q kills `strings` with SIGPIPE and a hit reads as a miss.
const strings = (needle) => Number(sh("bash", ["-c", `strings "${BIN}" | grep -c "${needle}" || true`]));
for (const seam of ["FLYWHEEL_APP_DATA_DIR", "FLYWHEEL_WORKTREE_ROOT"]) {
  if (strings(seam) === 0) fail(`${BIN} does not reference ${seam}; it predates that seam and would open the REAL fleet database. Rebuild: cargo build -p desktop`, 2);
}
const needsDevServer = strings(`localhost:${DEV_PORT}`) > 0;

// --- 3. the dev server, when the binary loads its frontend from it.
const listening = () => spawnSync("lsof", ["-nP", `-iTCP:${DEV_PORT}`, "-sTCP:LISTEN"]).status === 0;
let vite = null;
if (needsDevServer && !listening()) {
  console.log(`starting the dev server on ${DEV_PORT}`);
  vite = spawn("npm", ["--prefix", join(ROOT, "packages/desktop"), "run", "dev"], { stdio: "ignore" });
  for (let i = 0; i < 60 && !listening(); i++) sleep(0.5);
  if (!listening()) fail(`the dev server never listened on ${DEV_PORT}`, 2);
}

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

let app = null;
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  if (app) app.kill();
  if (vite) vite.kill();
  try { setDark(originalDark); } catch (e) { console.error("RESTORE FAILED:", e.message); }
};
process.on("exit", restore);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => process.exit(130));

// --- window + pixel helpers.
function appWindow() {
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
    const o = off + (h > 0 ? h - 1 - y : y) * stride + x * Bpp;
    return [b[o + 2], b[o + 1], b[o]];
  };
  return { w, h: Math.abs(h), px };
}

const scratch = mkdtempSync(join(tmpdir(), "flywheel-cycle-capture-"));
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const git = (...a) => sh("git", ["-C", ROOT, ...a]);

function capture(mode) {
  setDark(mode === "Dark");
  sleep(3); // live switch: the webview follows prefers-color-scheme without a relaunch
  const style = readStyle();
  const wantStyle = mode === "Dark" ? "Dark" : "(absent)";
  if (style !== wantStyle) throw new Error(`system did not switch: AppleInterfaceStyle is ${style}, wanted ${wantStyle}`);
  osa(`tell application "System Events" to set frontmost of process "${PROC}" to true`);
  sleep(2);
  const [x, y, w, h] = appWindow();
  const image = join(OUT, `cycle-region-${mode.toLowerCase()}.png`);
  const bmp = join(scratch, `${mode}.bmp`);
  sh("screencapture", ["-x", "-R", `${x},${y},${w},${h}`, image]);
  if (!existsSync(image) || statSync(image).size < 10_000) throw new Error("the screenshot is empty; does this terminal have Screen Recording permission?");
  sh("sips", ["-s", "format", "bmp", image, "--out", bmp]);
  const img = readBmp(bmp);
  const want = hex(TOKENS[mode]);
  let hit = 0, total = 0;
  for (let py = 0; py < img.h; py += 6) for (let px = 0; px < img.w; px += 6) {
    total++;
    if (img.px(px, py).every((c, i) => Math.abs(c - want[i]) <= TOL)) hit++;
  }
  const share = hit / total;
  const ok = share >= MIN_GROUND_SHARE;
  console.log(`${ok ? "PASS" : "FAIL"}  mode=${mode}  AppleInterfaceStyle=${style}  ground ${TOKENS[mode]} covers ${(share * 100).toFixed(1)}% of ${img.w}x${img.h} (need >= ${MIN_GROUND_SHARE * 100}%)  ${image}`);
  if (!ok) throw new Error(`the ${mode} image does not look like the application's ground; refusing to keep it`);
  return { appearance: mode, appleInterfaceStyle: style, image: relative(ROOT, image), imageSha256: sha256(image), capturedAt: new Date().toISOString(), window: { x, y, w, h }, groundToken: TOKENS[mode], groundShare: Number(share.toFixed(3)) };
}

// --- 4-6. launch once, capture both, write the manifest.
let ok = false;
let manifestPath = "";
try {
  mkdirSync(OUT, { recursive: true });
  // What the database held BEFORE the app touched it: proves the running and blocked runs were fresh.
  let runsBefore = "(sqlite3 unavailable)";
  try { runsBefore = sh("sqlite3", [`file:${DB}?immutable=1`, "select status||'='||count(*) from agent_runs group by status order by status"]).replace(/\n/g, " "); } catch { /* best effort */ }

  console.log(`launching ${BIN} on ${DB}`);
  app = spawn(BIN, [], { stdio: "ignore", env: { ...process.env, FLYWHEEL_APP_DATA_DIR: APP_DATA, FLYWHEEL_WORKTREE_ROOT: WORKTREES } });
  let win;
  for (let i = 0; i < 45 && !win; i++) {
    sleep(1);
    try { win = appWindow(); } catch { /* not up yet */ }
  }
  if (!win) throw new Error("the app window never appeared");
  sleep(8); // first paint, the board query, the Cycle region mount

  const shots = [capture("Dark"), capture("Light")];
  const releaseBin = join(ROOT, "target/release/desktop");
  const manifest = {
    note: "Evidence that each image is of the running application on the demonstration board. Written by scripts/capture-cycle-region.mjs. Records no judgement.",
    binary: { path: BIN, profile: "debug", builtThisRun: true, mtime: statSync(BIN).mtime.toISOString(), sha256: sha256(BIN), honoursAppDataSeam: true, loadsFrontendFrom: needsDevServer ? `http://localhost:${DEV_PORT} (packages/desktop working tree)` : "bundled" },
    notUsed: existsSync(releaseBin) ? { path: releaseBin, mtime: statSync(releaseBin).mtime.toISOString(), reason: "stale release binary; scripts/demo-board.sh would prefer it" } : null,
    database: { path: DB, appDataDir: APP_DATA, agentRunsBeforeLaunch: runsBefore },
    source: { gitHead: git("rev-parse", "HEAD"), dirtyFiles: git("status", "--porcelain", "--", "packages", "scripts").split("\n").filter(Boolean) },
    systemAppearance: { before: originalStyle },
    images: shots.map((s) => ({ ...s, binary: BIN, database: DB })),
  };
  manifestPath = join(OUT, "capture-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  ok = true;
} catch (e) {
  console.error("FAIL ", e.message);
} finally {
  restore();
}
sleep(1);
const after = readStyle();
console.log(`restored system appearance: AppleInterfaceStyle=${after} (was ${originalStyle})`);
if (after !== originalStyle) { console.error("FAIL  appearance was not restored"); ok = false; }
if (ok) for (const m of ["dark", "light"]) console.log(`image:    ${join(OUT, `cycle-region-${m}.png`)}`);
if (ok) console.log(`manifest: ${manifestPath}`);
process.exit(ok ? 0 : 1);
