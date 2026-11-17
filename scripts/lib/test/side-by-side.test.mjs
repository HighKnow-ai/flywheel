import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { concurrency, report, runAll } from "../side-by-side.mjs";

const node = (code, extra = {}) => ({ argv: [process.execPath, "-e", code], ...extra });

test("concurrency is FLYWHEEL_TEST_CONCURRENCY when it is a positive integer, else the cores", () => {
  assert.equal(concurrency({ FLYWHEEL_TEST_CONCURRENCY: "3" }, 12), 3);
  assert.equal(concurrency({}, 12), 12);
  for (const bad of ["", "0", "-2", "1.5", "many"]) {
    assert.equal(concurrency({ FLYWHEEL_TEST_CONCURRENCY: bad }, 8), 8, `"${bad}"`);
  }
  assert.equal(concurrency({}, 0), 1);
});

test("results come back in the order given, with the exit code and the whole output of each", async () => {
  const results = await runAll(
    [
      node("setTimeout(() => { console.log('slow one'); }, 150)"),
      node("console.log('quick one'); console.error('on stderr'); process.exitCode = 3"),
    ],
    { limit: 2 },
  );
  assert.deepEqual(
    results.map((r) => r.code),
    [0, 3],
  );
  assert.match(results[0].output, /slow one/);
  assert.match(results[1].output, /quick one/);
  assert.match(results[1].output, /on stderr/);
});

test("a command's env and cwd are its own and reach no other command", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-side-by-side-cwd-"));
  try {
    const show = "console.log(`${process.env.ONLY_HERE ?? 'unset'} ${process.cwd()}`)";
    const results = await runAll(
      [node(show, { env: { ONLY_HERE: "mine" }, cwd: dir }), node(show)],
      { limit: 2, env: { PATH: process.env.PATH } },
    );
    assert.equal(results[0].output.trim(), `mine ${fs.realpathSync(dir)}`);
    assert.equal(results[1].output.trim(), `unset ${fs.realpathSync(process.cwd())}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no more than `limit` commands run at once, and every one runs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-side-by-side-test-"));
  try {
    const log = path.join(dir, "log");
    const body = (id) =>
      `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(log)}, 'start ${id}\\n');` +
      `setTimeout(() => { fs.appendFileSync(${JSON.stringify(log)}, 'end ${id}\\n'); }, 100)`;
    const results = await runAll([1, 2, 3, 4, 5].map((id) => node(body(id))), { limit: 2 });
    assert.equal(results.length, 5);
    assert.ok(results.every((r) => r.code === 0));
    let running = 0;
    let peak = 0;
    for (const line of fs.readFileSync(log, "utf8").trim().split("\n")) {
      running += line.startsWith("start") ? 1 : -1;
      peak = Math.max(peak, running);
    }
    assert.equal(running, 0);
    assert.ok(peak <= 2, `${peak} ran at once`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("commands run side by side when the limit allows it", async () => {
  // A barrier, not a stopwatch: each command leaves a marker and waits until all three exist. Run one after
  // another, the first would wait for markers that never come and exit 1 at its own deadline.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-side-by-side-barrier-"));
  try {
    const body = (id) =>
      `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(path.join(dir, `m${id}`))}, '');` +
      `const deadline = Date.now() + 20000;` +
      `const wait = () => fs.readdirSync(${JSON.stringify(dir)}).length === 3 ? process.exit(0)` +
      ` : Date.now() > deadline ? process.exit(1) : setTimeout(wait, 20);` +
      `wait();`;
    const results = await runAll([1, 2, 3].map((id) => node(body(id))), { limit: 3 });
    assert.deepEqual(
      results.map((r) => r.code),
      [0, 0, 0],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a command that cannot start is a failure with a reason, not a hang", async () => {
  const results = await runAll([{ argv: [path.join(os.tmpdir(), "no-such-binary-for-side-by-side")] }], { limit: 1 });
  assert.equal(results[0].code, -1);
  assert.match(results[0].output, /could not start/);
});

test("a command a signal ended is a failure that says so", async () => {
  const results = await runAll([node("process.kill(process.pid, 'SIGKILL')")], { limit: 1 });
  assert.equal(results[0].code, -2);
  assert.match(results[0].output, /killed by SIGKILL/);
});

test("the report names every failure and keeps each output whole", () => {
  const text = report([
    { label: "a.mjs", code: 0, seconds: 1.5, output: "fine\n" },
    { label: "b.mjs --mode=x", code: 3, seconds: 2, output: "SKIP\n\n" },
  ]);
  assert.match(text, /::group::a\.mjs {2}\(exit 0, 1\.5 s\)/);
  assert.match(text, /^FAIL +2\.0 s {2}b\.mjs --mode=x {2}\(exit 3\)$/m);
  assert.match(text, /^ok +1\.5 s {2}a\.mjs$/m);
});
