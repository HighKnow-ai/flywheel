#!/usr/bin/env node
/**
 * The "Build under test" command for the exit test (issue #1847): an unsigned local build of a named commit,
 * installed for the owner, with the board DB backed up first and a way back.
 *
 *   node flywheel/scripts/exit-test/build-under-test.mjs --commit <ref> [--applications /Applications]
 *       [--backup-dir <dir>] [--work-dir <dir>] [--build-script <file>]
 *   node flywheel/scripts/exit-test/build-under-test.mjs restore --backup <file> [--previous-app <dir>]
 *       [--applications /Applications] [--backup-dir <dir>]
 *
 * WHAT IT CHANGES, AND NOTHING ELSE
 *   1. It copies the board DB (`flywheel.db` in the app data folder) to `<backup-dir>/flywheel.db.<UTC stamp>`
 *      with sqlite3's `.backup`, which is safe while the DB is open. It never changes the DB.
 *   2. It exports the commit with `git archive` into `<work-dir>` (a clean tree: no local edit can enter) and
 *      builds the app there. The build is `npm ci` for the sidecar and the desktop, `tauri build --bundles app`,
 *      and `check-release-bundle.mjs`, the same refusals as the release job. `--build-script` replaces this
 *      (the self-test uses it). Nothing is signed and the keychain is never called.
 *   3. It moves an existing `<applications>/Flywheel.app` to `<backup-dir>/Flywheel.app.previous-<stamp>`.
 *   4. It copies the new app to `<applications>/Flywheel.app` and runs
 *      `xattr -dr com.apple.quarantine <applications>/Flywheel.app`. That removes one attribute, from that one
 *      app. A local build has none, so this is normally a no-op; it keeps the step safe if the app was ever copied
 *      through a browser. It does not touch Gatekeeper settings or any other file.
 *   It refuses to run while that app is running. Quit Flywheel first.
 *
 * The last lines on stdout are the three values the exit-test log needs (`Commit:`, `Installed:`, `Board backup:`)
 * plus `Previous app:`, which `restore` takes.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { defaultDbPath } from "./preflight-checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const flywheelDir = path.resolve(here, "..", "..");

/** `20261120T031500Z`, UTC, so file names sort and carry no colon. */
export function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function must(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}

/** True when a process runs from inside `<app>/Contents/MacOS`. */
export function appIsRunning(app) {
  const r = run("pgrep", ["-f", path.join(app, "Contents", "MacOS") + path.sep]);
  return r.status === 0;
}

/** The checkout's root, this product's folder inside it (`prefix`, empty when the product is the root), and the full SHA of `ref`. Throws when `ref` is not a commit. */
export function resolveCommit(ref, cwd = flywheelDir) {
  const top = run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (!top.ok) throw new Error(`${cwd} is not in a git checkout`);
  const sha = run("git", ["-C", top.stdout.trim(), "rev-parse", "--verify", `${ref}^{commit}`]);
  if (!sha.ok) throw new Error(`${ref} is not a commit in this checkout (try git fetch first)`);
  const prefix = run("git", ["-C", cwd, "rev-parse", "--show-prefix"]).stdout.trim();
  return { root: top.stdout.trim(), prefix, sha: sha.stdout.trim() };
}

/** Back up the board DB. Returns the backup path, or null when there is no DB. */
export function backupBoard({ dbPath, backupDir, at }) {
  if (!fs.existsSync(dbPath)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, `flywheel.db.${at}`);
  if (fs.existsSync(dest)) throw new Error(`${dest} exists already; wait a second and run again`);
  const r = run("sqlite3", [dbPath, `.backup '${dest.replaceAll("'", "''")}'`]);
  if (!r.ok) {
    // No sqlite3: a plain copy is right only when the DB is closed and has no -wal file.
    if (fs.existsSync(`${dbPath}-wal`)) throw new Error(`sqlite3 failed (${r.stderr.trim()}) and ${dbPath}-wal exists: quit Flywheel and retry`);
    fs.copyFileSync(dbPath, dest);
  }
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) throw new Error(`backup ${dest} is empty`);
  return dest;
}

/** Export the commit's product folder (`prefix`, or the whole tree) into `<workDir>/flywheel` and return that folder. */
export function exportCommit({ root, prefix = "", sha, workDir }) {
  if (fs.existsSync(workDir) && fs.readdirSync(workDir).length > 0) throw new Error(`${workDir} is not empty; pass another --work-dir`);
  fs.mkdirSync(workDir, { recursive: true });
  const buildDir = path.join(workDir, "flywheel");
  fs.mkdirSync(buildDir);
  const tree = prefix ? `${sha}:${prefix.replace(/\/$/, "")}` : sha;
  const archive = spawnSync("git", ["-C", root, "archive", "--format=tar", tree], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr}`);
  const tar = spawnSync("tar", ["-x", "-C", buildDir], { input: archive.stdout });
  if (tar.status !== 0) throw new Error("tar -x failed");
  return buildDir;
}

/** Build the app in `<buildDir>` and return the path of `Flywheel.app`. */
export function buildApp({ buildDir, buildScript }) {
  const app = path.join(buildDir, "target", "release", "bundle", "macos", "Flywheel.app");
  if (buildScript) {
    must(buildScript, [], { cwd: buildDir });
  } else {
    must("npm", ["--prefix", "packages/sidecar", "ci"], { cwd: buildDir });
    must("npm", ["--prefix", "packages/desktop", "ci"], { cwd: buildDir });
    must("npm", ["--prefix", "packages/desktop", "run", "tauri", "--", "build", "--bundles", "app"], { cwd: buildDir });
    must("node", ["scripts/release/check-release-bundle.mjs", app, "packages/desktop/dist"], { cwd: buildDir });
  }
  if (!fs.existsSync(path.join(app, "Contents"))) throw new Error(`the build left no app at ${app}`);
  return app;
}

/** Copy an app bundle, keeping symlinks and modes. */
function copyApp(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

/** Remove the quarantine attribute from the installed app only. Returns a one-line statement. */
function clearQuarantine(installed) {
  if (process.platform !== "darwin") return "quarantine: not macOS, nothing changed";
  const r = run("xattr", ["-dr", "com.apple.quarantine", installed]);
  return r.ok ? `quarantine: ran xattr -dr com.apple.quarantine on ${installed} only` : `quarantine: xattr failed (${r.stderr.trim()}); the app may need it cleared by hand`;
}

export function install({ builtApp, applications, backupDir, at }) {
  const installed = path.join(applications, "Flywheel.app");
  fs.mkdirSync(applications, { recursive: true });
  let previous = null;
  if (fs.existsSync(installed)) {
    fs.mkdirSync(backupDir, { recursive: true });
    previous = path.join(backupDir, `Flywheel.app.previous-${at}`);
    copyApp(installed, previous);
  }
  copyApp(builtApp, installed);
  return { installed, previous, quarantine: clearQuarantine(installed) };
}

/** Put the previous app and the backed-up DB back. The replaced app and DB are kept, not deleted. */
export function restore({ backup, previousApp, applications, backupDir, dbPath, at }) {
  const installed = path.join(applications, "Flywheel.app");
  if (appIsRunning(installed)) throw new Error(`${installed} is running: quit Flywheel first`);
  if (!fs.existsSync(backup)) throw new Error(`backup ${backup} does not exist`);
  if (previousApp && !fs.existsSync(path.join(previousApp, "Contents"))) throw new Error(`${previousApp} is not an app`);
  fs.mkdirSync(backupDir, { recursive: true });
  const lines = [];
  if (fs.existsSync(dbPath)) {
    const aside = path.join(backupDir, `flywheel.db.before-restore-${at}`);
    fs.copyFileSync(dbPath, aside);
    lines.push(`Board replaced by the backup; the board as it was: ${aside}`);
  }
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(backup, dbPath);
  if (previousApp) {
    if (fs.existsSync(installed)) {
      const aside = path.join(backupDir, `Flywheel.app.under-test-${at}`);
      copyApp(installed, aside);
      lines.push(`App replaced by the previous build; the build under test: ${aside}`);
    }
    copyApp(previousApp, installed);
    lines.push(clearQuarantine(installed));
  } else {
    lines.push("No --previous-app: the installed app was left as it is.");
  }
  return lines;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      commit: { type: "string" },
      applications: { type: "string", default: "/Applications" },
      "backup-dir": { type: "string" },
      "work-dir": { type: "string" },
      "build-script": { type: "string" },
      backup: { type: "string" },
      "previous-app": { type: "string" },
    },
  });
  const at = stamp();
  const applications = path.resolve(values.applications);
  const backupDir = path.resolve(values["backup-dir"] ?? path.join(os.homedir(), "Flywheel-backups"));
  const dbPath = defaultDbPath();

  if (positionals[0] === "restore") {
    if (!values.backup) throw new Error("restore needs --backup <the Board backup path>");
    for (const line of restore({ backup: path.resolve(values.backup), previousApp: values["previous-app"] && path.resolve(values["previous-app"]), applications, backupDir, dbPath, at })) console.log(line);
    console.log("Restored. Open Flywheel.");
    return;
  }
  if (positionals.length > 0 || !values.commit) throw new Error("usage: build-under-test.mjs --commit <ref> [--applications <dir>] [--backup-dir <dir>] | restore --backup <file> [--previous-app <dir>]");

  const { root, prefix, sha } = resolveCommit(values.commit);
  const installedApp = path.join(applications, "Flywheel.app");
  if (appIsRunning(installedApp)) throw new Error(`${installedApp} is running: quit Flywheel first`);
  const backup = backupBoard({ dbPath, backupDir, at });
  console.log(backup ? `backup done: ${backup}` : `no board DB at ${dbPath}: nothing to back up`);
  const workDir = path.resolve(values["work-dir"] ?? path.join(process.env.TMPDIR ?? os.tmpdir(), `flywheel-build-under-test-${sha.slice(0, 12)}-${at}`));
  const buildDir = exportCommit({ root, prefix, sha, workDir });
  const builtApp = buildApp({ buildDir, buildScript: values["build-script"] && path.resolve(values["build-script"]) });
  const { installed, previous, quarantine } = install({ builtApp, applications, backupDir, at });
  console.log(`\n${quarantine}`);
  console.log("\nPaste these lines under \"Build under test\" in attempt-2.md:\n");
  console.log(`Commit: ${sha}`);
  console.log(`Installed: ${installed} (unsigned local build; build tree ${workDir})`);
  console.log(`Board backup: ${backup ?? "none (no board DB existed)"}`);
  console.log(`Previous app: ${previous ?? "none (no earlier install)"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`build-under-test: ${e.message}`);
    process.exit(1);
  });
}
