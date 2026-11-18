/**
 * The record and the check that keep a stubborn test child from outliving the suite. Runs real
 * processes: a stand-in that never exits, and `fake-claude.mjs` in its STUBBORN mode.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { isAlive, killSurvivors, readPids } from "./stubborn-children.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");
const CHECK = path.join(__dirname, "..", "scripts", "check-no-stubborn-left.mjs");

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-stubborn-test-"));

async function waitUntilGone(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return !isAlive(pid);
}

test("the check fails on a recorded process that is still alive, ends it, and then passes", async () => {
  const dir = scratch();
  const child = spawn(process.execPath, ["-e", "process.on('SIGINT', () => {}); setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  try {
    fs.writeFileSync(path.join(dir, "leaky.test.mjs.pids"), `${child.pid}\n`);
    const first = spawnSync(process.execPath, [CHECK], { env: { ...process.env, FLYWHEEL_STUBBORN_DIR: dir }, encoding: "utf8" });
    assert.equal(first.status, 1, `the check must fail on a live recorded process: ${first.stdout}${first.stderr}`);
    assert.match(first.stderr, new RegExp(`${child.pid} \\(leaky\\.test\\.mjs\\.pids\\)`));
    assert.ok(await waitUntilGone(child.pid), "the check must end the survivor it reports");

    const second = spawnSync(process.execPath, [CHECK], { env: { ...process.env, FLYWHEEL_STUBBORN_DIR: dir }, encoding: "utf8" });
    assert.equal(second.status, 0, `nothing is left, so the check must pass: ${second.stderr}`);
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the check ignores a live process that no pid file of the suite names", () => {
  const dir = scratch();
  try {
    // This test process is alive and is not recorded: the check must not match it by any other means.
    const result = spawnSync(process.execPath, [CHECK], { env: { ...process.env, FLYWHEEL_STUBBORN_DIR: dir }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fake-claude's stubborn mode records itself and its grandchild, and reaping ends both", async () => {
  const dir = scratch();
  const file = path.join(dir, "fake.pids");
  const fake = spawn(process.execPath, [FAKE_CLAUDE], {
    env: { ...process.env, FLYWHEEL_FAKE_STUBBORN: "1", FLYWHEEL_STUBBORN_PIDFILE: file },
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    const grandchildPid = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no grandchild_pid line in time")), 15_000);
      createInterface({ input: fake.stdout }).on("line", (line) => {
        if (!line.includes("grandchild_pid")) return;
        clearTimeout(timer);
        resolve(JSON.parse(line).pid);
      });
    });
    const recorded = readPids(file);
    assert.ok(recorded.includes(fake.pid), "the fixture must record its own pid");
    assert.ok(recorded.includes(grandchildPid), "the fixture must record its grandchild's pid");

    const reaped = killSurvivors(file);
    assert.ok(reaped.includes(fake.pid) && reaped.includes(grandchildPid));
    assert.ok(await waitUntilGone(fake.pid), "the fixture must be gone after the reap");
    assert.ok(await waitUntilGone(grandchildPid), "the grandchild must be gone after the reap");
  } finally {
    fake.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
