// The build-under-test script (issue #1847) with a stubbed build, a temp HOME and a temp Applications folder.
// The real build is never run, no real DB is read, and the keychain is never touched.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { exportCommit, resolveCommit } from "../build-under-test.mjs";
import { checkBoard } from "../preflight-checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "..", "build-under-test.mjs");

function tmpDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "but-test-")));
}

function sqliteFile(file, extra = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from("SQLite format 3\u0000", "latin1"), Buffer.alloc(100), Buffer.from(extra)]));
}

function fakeApp(dir, marker) {
  fs.mkdirSync(path.join(dir, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Contents", "marker.txt"), marker);
}

/** A stub build: writes `target/release/bundle/macos/Flywheel.app` and records its cwd. */
function stubBuild(root) {
  const file = path.join(root, "stub-build.sh");
  fs.writeFileSync(file, '#!/bin/sh\nset -e\nmkdir -p target/release/bundle/macos/Flywheel.app/Contents\necho built > target/release/bundle/macos/Flywheel.app/Contents/marker.txt\npwd > build-cwd.txt\n');
  fs.chmodSync(file, 0o755);
  return file;
}

function setup() {
  const root = tmpDir();
  const home = path.join(root, "home");
  const data = path.join(home, "data");
  const env = { ...process.env, HOME: home, FLYWHEEL_APP_DATA_DIR: data };
  return { root, home, data, db: path.join(data, "flywheel.db"), apps: path.join(root, "Applications"), backups: path.join(root, "backups"), env, build: stubBuild(root) };
}

const exec = (args, env) => spawnSync("node", [script, ...args], { encoding: "utf8", env });

test("builds a clean export of the commit, backs up first, installs, and prints the log lines", () => {
  const t = setup();
  sqliteFile(t.db, "board v1");
  fakeApp(path.join(t.apps, "Flywheel.app"), "old");
  const r = exec(["--commit", "HEAD", "--applications", t.apps, "--backup-dir", t.backups, "--work-dir", path.join(t.root, "work"), "--build-script", t.build], t.env);
  assert.equal(r.status, 0, r.stderr);

  const sha = spawnSync("git", ["-C", here, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  assert.match(r.stdout, new RegExp(`^Commit: ${sha}$`, "m"));
  assert.match(r.stdout, new RegExp(`^Installed: ${path.join(t.apps, "Flywheel.app").replaceAll(".", "\\.")} `, "m"));
  const backup = /^Board backup: (.+)$/m.exec(r.stdout)[1];
  assert.match(path.basename(backup), /^flywheel\.db\.\d{8}T\d{6}Z$/);
  assert.ok(fs.readFileSync(backup).includes("board v1"));
  const previous = /^Previous app: (.+)$/m.exec(r.stdout)[1];
  assert.equal(fs.readFileSync(path.join(previous, "Contents", "marker.txt"), "utf8"), "old");
  assert.equal(fs.readFileSync(path.join(t.apps, "Flywheel.app", "Contents", "marker.txt"), "utf8"), "built\n");
  // The build ran in the export of the commit, not in this checkout.
  assert.equal(fs.readFileSync(path.join(t.root, "work", "flywheel", "build-cwd.txt"), "utf8").trim(), path.join(t.root, "work", "flywheel"));
  // The board DB itself is untouched.
  assert.ok(fs.readFileSync(t.db).includes("board v1"));

  // The preflight accepts this backup as --backup.
  const check = checkBoard({ dbPath: t.db, backupPath: backup });
  assert.equal(check.status, "green", check.detail);
});

test("restore puts the previous app and the backed-up board back and keeps what it replaced", () => {
  const t = setup();
  sqliteFile(t.db, "board v1");
  fakeApp(path.join(t.apps, "Flywheel.app"), "old");
  const r = exec(["--commit", "HEAD", "--applications", t.apps, "--backup-dir", t.backups, "--work-dir", path.join(t.root, "work"), "--build-script", t.build], t.env);
  assert.equal(r.status, 0, r.stderr);
  const backup = /^Board backup: (.+)$/m.exec(r.stdout)[1];
  const previous = /^Previous app: (.+)$/m.exec(r.stdout)[1];
  sqliteFile(t.db, "board v2 written by the new build");
  fs.writeFileSync(`${t.db}-wal`, "stale");

  const back = exec(["restore", "--backup", backup, "--previous-app", previous, "--applications", t.apps, "--backup-dir", t.backups], t.env);
  assert.equal(back.status, 0, back.stderr);
  assert.equal(fs.readFileSync(path.join(t.apps, "Flywheel.app", "Contents", "marker.txt"), "utf8"), "old");
  assert.ok(fs.readFileSync(t.db).includes("board v1"));
  assert.ok(!fs.existsSync(`${t.db}-wal`));
  const kept = fs.readdirSync(t.backups);
  assert.ok(kept.some((f) => f.startsWith("flywheel.db.before-restore-")));
  assert.ok(kept.some((f) => f.startsWith("Flywheel.app.under-test-")));
});

test("with no board DB and no earlier app it says so and still installs", () => {
  const t = setup();
  const r = exec(["--commit", "HEAD", "--applications", t.apps, "--backup-dir", t.backups, "--work-dir", path.join(t.root, "work"), "--build-script", t.build], t.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Board backup: none/m);
  assert.match(r.stdout, /^Previous app: none/m);
  assert.ok(fs.existsSync(path.join(t.apps, "Flywheel.app", "Contents")));
});

test("refuses an unknown commit before it backs up or installs anything", () => {
  const t = setup();
  sqliteFile(t.db);
  const r = exec(["--commit", "no-such-ref-1847", "--applications", t.apps, "--backup-dir", t.backups, "--build-script", t.build], t.env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not a commit/);
  assert.ok(!fs.existsSync(t.backups));
  assert.ok(!fs.existsSync(t.apps));
});

test("a failed build leaves the installed app alone but keeps the backup", () => {
  const t = setup();
  sqliteFile(t.db);
  fakeApp(path.join(t.apps, "Flywheel.app"), "old");
  fs.writeFileSync(t.build, "#!/bin/sh\nexit 3\n");
  const r = exec(["--commit", "HEAD", "--applications", t.apps, "--backup-dir", t.backups, "--work-dir", path.join(t.root, "work"), "--build-script", t.build], t.env);
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(path.join(t.apps, "Flywheel.app", "Contents", "marker.txt"), "utf8"), "old");
  assert.equal(fs.readdirSync(t.backups).length, 1);
});

for (const layout of ["product at the repository root", "product under flywheel/"]) {
  test(`exports the product folder when the ${layout}`, () => {
    const repo = tmpDir();
    const product = layout.endsWith("root") ? repo : path.join(repo, "flywheel");
    fs.mkdirSync(path.join(product, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(product, "scripts", "marker.txt"), "x");
    const git = (...a) => spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "c");
    const { root, prefix, sha } = resolveCommit("HEAD", product);
    const dir = exportCommit({ root, prefix, sha, workDir: path.join(tmpDir(), "work") });
    assert.equal(fs.readFileSync(path.join(dir, "scripts", "marker.txt"), "utf8"), "x");
    assert.ok(!fs.existsSync(path.join(dir, "flywheel")));
  });
}
