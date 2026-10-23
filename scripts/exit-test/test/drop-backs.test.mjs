// The exit-test script over committed fixtures: transcripts under fixtures/projects and a Flywheel DB
// at fixtures/flywheel.db (see fixtures/flywheel-fixture.sql for what each row is there to test).
// Every run pins TZ=UTC, so the attempt's dates are UTC days here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildFixtureDb } from "./fixtures/build-fixture-db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../drop-backs.mjs");
const fixtures = path.join(here, "fixtures");
const projectsDir = path.join(fixtures, "projects");
const fixtureDb = path.join(fixtures, "flywheel.db");

const RANGE = ["--from", "2026-10-13", "--to", "2026-10-17"];
const COUNTED = ["--project", "/work/alpha", "--project", "/work/beta"];

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC", ...env },
  });
  return result;
}

function runJson(args, env) {
  const result = run([...args, "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const NO_DB = ["--db", path.join(fixtures, "no-such.db")];
const sessionIds = (report) => report.dropBacks.map((d) => d.sessionId);

test("lists the interactive sessions on the counted projects in the dates, and nothing else", () => {
  const report = runJson([...COUNTED, ...RANGE, "--projects-dir", projectsDir, "--db", fixtureDb]);
  assert.deepEqual(sessionIds(report), [
    "aaaaaaa4-0000-4000-8000-000000000004", // began the evening before, went on past midnight
    "aaaaaaa1-0000-4000-8000-000000000001", // in the repo (its subagent is not a session of its own)
    "aaaaaaa2-0000-4000-8000-000000000002", // in a worktree inside the repo
    "aaaaaaa3-0000-4000-8000-000000000003", // in Flywheel's worktree for the project, from the DB
    "ddddddd1-0000-4000-8000-000000000001", // in a subdirectory of the second project
  ]);
  const a3 = report.dropBacks.find((d) => d.sessionId.startsWith("aaaaaaa3"));
  assert.equal(a3.project, "/work/alpha");
  assert.equal(a3.cwd, "/flywheel-root/alpha/ALPHA-1");
  assert.equal(a3.start, "2026-10-16T10:00:00.000Z");
  assert.equal(a3.transcript, path.join(projectsDir, "-flywheel-root-alpha-ALPHA-1", "aaaaaaa3-0000-4000-8000-000000000003.jsonl"));
  // Flywheel's two headless sessions on alpha, in the repo and in its worktree.
  assert.equal(report.ignoredHeadless, 2);
  // Interactive sessions in directories that no longer exist may have been a removed worktree of a
  // counted project, which nothing can tell any more: they are listed apart, to check by hand.
  assert.deepEqual(
    report.unattributed.map((d) => [d.sessionId, d.cwd]),
    [
      ["ccccccc1-0000-4000-8000-000000000001", "/work/alphabet"],
      ["ccccccc2-0000-4000-8000-000000000002", "/work/other"],
    ],
  );
});

test("a worktree only the DB knows is not counted without the DB", () => {
  const report = runJson([...COUNTED, ...RANGE, "--projects-dir", projectsDir, ...NO_DB]);
  assert.ok(!sessionIds(report).some((id) => id.startsWith("aaaaaaa3")));
  assert.equal(report.dropBacks.length, 4);
  // Its directory does not exist here either, so it is listed to check by hand.
  assert.ok(report.unattributed.some((d) => d.sessionId.startsWith("aaaaaaa3")));
  assert.equal(report.db, null);
});

test("finds a worktree that git still knows, outside the repo", () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "exit-test-git-")));
  try {
    const repo = path.join(scratch, "repo");
    const worktree = path.join(scratch, "elsewhere", "feature");
    const git = (...args) => {
      const r = spawnSync("git", args, { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    };
    git("init", "-q", "-b", "main", repo);
    git("-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    git("-C", repo, "worktree", "add", "-q", "-b", "feature", worktree);

    const projects = path.join(scratch, "projects");
    fs.mkdirSync(path.join(projects, "wt"), { recursive: true });
    const line = { type: "user", timestamp: "2026-10-14T09:00:00.000Z", entrypoint: "cli", cwd: worktree, sessionId: "eeeeeee1" };
    fs.writeFileSync(path.join(projects, "wt", "eeeeeee1.jsonl"), JSON.stringify(line) + "\n");

    const report = runJson(["--project", repo, ...RANGE, "--projects-dir", projects, ...NO_DB]);
    assert.deepEqual(sessionIds(report), ["eeeeeee1"]);
    assert.equal(report.dropBacks[0].project, repo);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("reads the secondary numbers for the counted projects and dates, and leaves the DB untouched", () => {
  const before = crypto.createHash("sha256").update(fs.readFileSync(fixtureDb)).digest("hex");
  const report = runJson([...COUNTED, ...RANGE, "--projects-dir", projectsDir, "--db", fixtureDb]);
  assert.deepEqual(report.db, {
    path: fixtureDb,
    gatedActionPrompts: 2,
    permissionRequests: 3,
    proposalsFiled: 3,
    proposalsAccepted: 2,
    sessionsEndedByErrorOrRefusal: 4,
    endingReasons: { api_error: 1, crash: 1, refusal: 1, usage_limit: 1 },
  });
  const after = crypto.createHash("sha256").update(fs.readFileSync(fixtureDb)).digest("hex");
  assert.equal(after, before);
  assert.ok(!fs.existsSync(`${fixtureDb}-wal`) && !fs.existsSync(`${fixtureDb}-journal`));
});

test("reads a DB stopped at migration 0004", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "exit-test-db-"));
  try {
    const oldDb = path.join(scratch, "flywheel.db");
    await buildFixtureDb(oldDb, "0004");
    const report = runJson([...COUNTED, ...RANGE, "--projects-dir", projectsDir, "--db", oldDb]);
    const current = runJson([...COUNTED, ...RANGE, "--projects-dir", projectsDir, "--db", fixtureDb]);
    assert.deepEqual({ ...report.db, path: null }, { ...current.db, path: null });
    assert.deepEqual(sessionIds(report), sessionIds(current));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("finds the DB through FLYWHEEL_APP_DATA_DIR", () => {
  const report = runJson([...COUNTED, ...RANGE, "--projects-dir", projectsDir], { FLYWHEEL_APP_DATA_DIR: fixtures });
  assert.equal(report.db.path, fixtureDb);
});

test("the text report names each drop-back and the numbers, never transcript content", () => {
  const result = run([...COUNTED, ...RANGE, "--projects-dir", projectsDir, "--db", fixtureDb]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Drop-backs: 5/);
  assert.match(result.stdout, /aaaaaaa3-0000-4000-8000-000000000003/);
  assert.match(result.stdout, /Ignored: 2 headless/);
  assert.match(result.stdout, /no longer exist[^\n]*: 2/);
  assert.match(result.stdout, /Gated-action prompts: 2/);
  assert.match(result.stdout, /Proposals filed: 3, accepted: 2/);
  assert.match(result.stdout, /Sessions ended by an error or refusal: 4/);
  assert.doesNotMatch(result.stdout, /fixture"/);
});

test("refuses a run without projects or dates", () => {
  assert.equal(run(RANGE).status, 2);
  assert.equal(run([...COUNTED, "--from", "2026-10-13"]).status, 2);
  assert.equal(run([...COUNTED, "--from", "2026-10-18", "--to", "2026-10-13"]).status, 2);
  assert.equal(run([...COUNTED, "--from", "13/10/2026", "--to", "2026-10-17"]).status, 2);
});
