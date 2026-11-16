// The preflight's checks (issue #1600), each against a temp directory or an injected runner. No real board DB.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkBoard,
  checkBuild,
  checkClaude,
  checkDropBacks,
  checkProjects,
  checkShim,
  defaultDbPath,
  renderTable,
} from "../preflight-checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dropBacks = path.resolve(here, "..", "drop-backs.mjs");

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preflight-test-")));
}

function sqliteFile(file) {
  fs.writeFileSync(file, Buffer.concat([Buffer.from("SQLite format 3\u0000", "latin1"), Buffer.alloc(100)]));
}

/** A git repo `<root>/flywheel/` with one commit, standing in for the monorepo. */
function fakeMonorepo() {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, "flywheel"));
  fs.writeFileSync(path.join(root, "flywheel", "a.txt"), "a");
  const git = (...args) => spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "init");
  return root;
}

test("defaultDbPath honours FLYWHEEL_APP_DATA_DIR and else the macOS app-data folder", () => {
  assert.equal(defaultDbPath({ FLYWHEEL_APP_DATA_DIR: "/x" }, "darwin", "/h"), "/x/flywheel.db");
  assert.equal(defaultDbPath({}, "darwin", "/h"), "/h/Library/Application Support/Flywheel/flywheel.db");
});

test("checkBuild is green when every step passes, red naming the step that fails, warn when skipped", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "packages", "sidecar", "node_modules"), { recursive: true });
  const calls = [];
  const ok = checkBuild({ flywheelDir: dir, run: (c, a) => (calls.push([c, ...a]), { status: 0 }) });
  assert.equal(ok.status, "green");
  assert.equal(calls.length, 3);
  const bad = checkBuild({ flywheelDir: dir, run: (c, a) => ({ status: a[0] === "build" ? 1 : 0, stderr: "boom" }) });
  assert.equal(bad.status, "red");
  assert.match(bad.detail, /cargo build -p flywheel-shim.*boom/);
  assert.equal(checkBuild({ flywheelDir: dir, skip: true }).status, "warn");
});

test("checkBuild installs the sidecar's dependencies first when node_modules is missing", () => {
  const dir = tmpDir();
  const calls = [];
  checkBuild({ flywheelDir: dir, run: (c, a) => (calls.push(a.join(" ")), { status: 0 }) });
  assert.equal(calls[0], "--prefix packages/sidecar ci");
});

test("checkBoard needs the DB, a backup that is a different SQLite file", () => {
  const dir = tmpDir();
  const db = path.join(dir, "flywheel.db");
  const backup = path.join(dir, "backup.db");
  assert.equal(checkBoard({ dbPath: db, backupPath: backup }).status, "red"); // neither exists
  sqliteFile(db);
  const noBackup = checkBoard({ dbPath: db });
  assert.equal(noBackup.status, "red");
  assert.match(noBackup.detail, /--backup/);
  assert.equal(checkBoard({ dbPath: db, backupPath: db }).status, "red");
  fs.writeFileSync(backup, "not sqlite");
  assert.equal(checkBoard({ dbPath: db, backupPath: backup }).status, "red");
  sqliteFile(backup);
  const ok = checkBoard({ dbPath: db, backupPath: backup });
  assert.equal(ok.status, "green");
  assert.ok(ok.detail.includes(db) && ok.detail.includes(backup));
});

test("checkProjects: Flywheel must be <monorepo>/flywheel, a second project is needed, registration is checked", async () => {
  const mono = fakeMonorepo();
  const fw = path.join(mono, "flywheel");
  const other = fakeMonorepo();
  const none = async () => null;
  assert.equal((await checkProjects({ projects: [fw], flywheelProject: fw, dbPath: "x", readRegistered: none })).status, "red");
  assert.equal((await checkProjects({ projects: [mono, other], flywheelProject: mono, dbPath: "x", readRegistered: none })).status, "red");
  assert.equal((await checkProjects({ projects: [fw, path.join(other, "nope")], flywheelProject: fw, dbPath: "x", readRegistered: none })).status, "red");
  assert.equal((await checkProjects({ projects: [fw, other], flywheelProject: fw, dbPath: "x", readRegistered: none })).status, "warn");
  const part = await checkProjects({ projects: [fw, other], flywheelProject: fw, dbPath: "x", readRegistered: async () => [fw] });
  assert.equal(part.status, "warn");
  assert.ok(part.detail.includes(other));
  const all = await checkProjects({ projects: [fw, other], flywheelProject: fw, dbPath: "x", readRegistered: async () => [fw, other] });
  assert.equal(all.status, "green");
});

test("checkDropBacks counts flywheel/ and ignores the rest of the monorepo, then cleans up", () => {
  const mono = fakeMonorepo();
  const fw = path.join(mono, "flywheel");
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("flywheel-preflight-"));
  const r = checkDropBacks({ flywheelProject: fw, scriptPath: dropBacks });
  assert.equal(r.status, "green", r.detail);
  assert.match(r.detail, /counts 2 sessions in flywheel\/ across 1 worktree/);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("flywheel-preflight-")), before);
});

test("checkDropBacks is red for a project that is not <monorepo>/flywheel, and when the script misbehaves", () => {
  const mono = fakeMonorepo();
  assert.equal(checkDropBacks({ flywheelProject: mono, scriptPath: dropBacks }).status, "red");
  const fw = path.join(mono, "flywheel");
  // A script that counts everything wrongly counts the root sessions.
  const bad = tmpDir();
  const script = path.join(bad, "all.mjs");
  fs.writeFileSync(script, 'console.log(JSON.stringify({dropBacks:[]}))');
  assert.equal(checkDropBacks({ flywheelProject: fw, scriptPath: script }).status, "red");
  fs.writeFileSync(script, "process.exit(2)");
  assert.match(checkDropBacks({ flywheelProject: fw, scriptPath: script }).detail, /exited 2/);
});

test("checkShim finds an executable shim and the real git, and is red without either", () => {
  const dir = tmpDir();
  const shim = path.join(dir, "target", "debug", "flywheel-shim");
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  const gitDir = path.join(dir, "bin");
  fs.mkdirSync(gitDir);
  fs.writeFileSync(path.join(gitDir, "git"), "");
  fs.writeFileSync(shim, "");
  fs.chmodSync(shim, 0o644);
  const env = { PATH: gitDir };
  // Not executable: the only probe left is the installed app, which a test machine may have, so name a dir with none.
  const missing = checkShim({ flywheelDir: dir, env, candidatesExtra: [] });
  if (!fs.existsSync("/Applications/Flywheel.app/Contents/MacOS/flywheel-shim")) assert.equal(missing.status, "red");
  fs.chmodSync(shim, 0o755);
  const ok = checkShim({ flywheelDir: dir, env });
  assert.equal(ok.status, "green");
  assert.ok(ok.detail.includes(shim));
  assert.equal(checkShim({ flywheelDir: dir, env: { PATH: dir } }).status, "red");
});

test("checkClaude runs the sidecar's own probe: green with a working FLYWHEEL_CLAUDE_BIN, red without, red unbuilt", () => {
  const dir = tmpDir();
  assert.equal(checkClaude({ flywheelDir: dir }).status, "red"); // not built
  const dist = path.join(dir, "packages", "sidecar", "dist");
  fs.mkdirSync(dist, { recursive: true });
  // A stand-in for the compiled adapter: the contract is only resolveClaudeBin and probeClaudeBinary.
  fs.writeFileSync(
    path.join(dist, "claude-code-adapter.js"),
    `import { spawnSync } from "node:child_process";
export const resolveClaudeBin = () => process.env.FLYWHEEL_CLAUDE_BIN ?? "claude";
export const probeClaudeBinary = async () => {
  const r = spawnSync(resolveClaudeBin(), ["--version"], { encoding: "utf8" });
  return r.status === 0 ? { available: true, version: r.stdout.trim() } : { available: false };
};`,
  );
  const fake = path.join(dir, "fake-claude");
  fs.writeFileSync(fake, "#!/bin/sh\necho 9.9.9 fake\n");
  fs.chmodSync(fake, 0o755);
  const ok = checkClaude({ flywheelDir: dir, env: { ...process.env, FLYWHEEL_CLAUDE_BIN: fake } });
  assert.equal(ok.status, "green");
  assert.match(ok.detail, /9\.9\.9/);
  const bad = checkClaude({ flywheelDir: dir, env: { ...process.env, FLYWHEEL_CLAUDE_BIN: path.join(dir, "absent") } });
  assert.equal(bad.status, "red");
  assert.match(bad.detail, /FLYWHEEL_CLAUDE_BIN/);
});

test("renderTable prints one aligned row per check", () => {
  const out = renderTable([
    { name: "a", status: "green", detail: "ok" },
    { name: "bbb", status: "red", detail: "no" },
  ]);
  assert.deepEqual(out.split("\n"), ["GREEN  a    ok", "RED    bbb  no"]);
});
