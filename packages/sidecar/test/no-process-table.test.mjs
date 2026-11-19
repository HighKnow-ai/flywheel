/**
 * The sidecar's tests find the processes they start through pid records (`stubborn-children.mjs`),
 * never through the process table. A name or parent match is machine-wide: it can end another job's
 * process, and an agent sandbox refuses `ps` and `pgrep`, so a refused call leaves a process running
 * (issue #1802). This test reads the test files' own source.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));
const sources = fs
  .readdirSync(here)
  .filter((name) => name.endsWith(".mjs") && name !== SELF)
  .map((name) => ({ name, text: fs.readFileSync(path.join(here, name), "utf8") }));

// A command run through a shell string or an argv call, which is how every earlier use looked.
const PROCESS_TABLE_CALL = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\(\s*[`"'](?:ps|pgrep|pkill|killall)\b/;

test("no sidecar test or fixture runs ps, pgrep, pkill or killall", () => {
  const offenders = sources.filter(({ text }) => PROCESS_TABLE_CALL.test(text)).map(({ name }) => name);
  assert.deepEqual(offenders, []);
});

test("every test file that starts a long-lived fake session records its processes", () => {
  const LONG_LIVED_MODE = /FLYWHEEL_FAKE_(?:STUBBORN|CALL_|BOARD_CALLS)/;
  const offenders = sources
    .filter(({ name }) => name.endsWith(".test.mjs") && name !== "stubborn-children.test.mjs")
    .filter(({ text }) => LONG_LIVED_MODE.test(text) && !text.includes("recordStubbornChildren(import.meta.url)"))
    .map(({ name }) => name);
  assert.deepEqual(offenders, [], "each of these starts a session that can outlive the suite and must end it by pid record");
});

test("the rule catches what it is written for", () => {
  assert.ok(PROCESS_TABLE_CALL.test('execSync(`pgrep -P ${pid}`)'));
  assert.ok(PROCESS_TABLE_CALL.test('spawnSync("ps", ["-A"])'));
  assert.ok(PROCESS_TABLE_CALL.test("execFileSync('pgrep', ['-P', '1'])"));
  assert.ok(!PROCESS_TABLE_CALL.test('spawn(process.execPath, ["-e", "x"])'));
});
