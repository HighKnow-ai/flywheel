import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ITEMS, buildSteps, selectItems, summaryLines, verdictOf } from "../live-runbook.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "live-runbook.mjs");
const FLYWHEEL_DIR = path.resolve(path.dirname(SCRIPT), "..", "..");

test("every item is a script that exists, story first", () => {
  assert.deepEqual(ITEMS.map((i) => i.id), ["story", "uat03"]);
  for (const item of ITEMS) assert.ok(fs.existsSync(path.join(FLYWHEEL_DIR, item.script)), item.script);
});

test("--only picks one item and refuses an unknown one", () => {
  assert.deepEqual(selectItems(["--only=uat03"]).map((i) => i.id), ["uat03"]);
  assert.equal(selectItems([]).length, 2);
  assert.throws(() => selectItems(["--only=nope"]), /expected one of story, uat03/);
});

test("the build steps install sidecar modules only when missing and build the shim last", () => {
  const fresh = buildSteps({ hasSidecarModules: false });
  assert.deepEqual(fresh[0], ["npm", ["--prefix", "packages/sidecar", "ci"]]);
  const built = buildSteps({ hasSidecarModules: true });
  assert.equal(built.length, fresh.length - 1);
  assert.deepEqual(built.at(-1), ["cargo", ["build", "-p", "flywheel-shim"]]);
});

test("exit codes map to PASS, SKIP and FAIL", () => {
  assert.deepEqual([0, 3, 1, 2].map(verdictOf), ["PASS", "SKIP", "FAIL", "FAIL"]);
});

test("the summary keeps the verdict, check, usage and evidence lines and drops the rest", () => {
  const output = [
    "   · scratch repository: /tmp/x",
    "   · usage: 1 turn(s), 4 tool call(s), input tokens 10, output tokens 5, cost $0.0100",
    "   · PASS  the agent handed off",
    "   · FAIL  something: why",
    "   · FINDING: a thing",
    "   · evidence: /tmp/a.json",
    "",
    "✅ PASS — UAT 20 — name",
  ].join("\n");
  assert.deepEqual(
    summaryLines(output).map((l) => l.trim().split(" ")[0] + " " + l.trim().split(" ")[1]),
    ["· usage:", "· PASS", "· FAIL", "· FINDING:", "· evidence:", "✅ PASS"],
  );
});

test("--dry-run prints the plan and runs nothing", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--dry-run", "--skip-build"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /spends your Claude usage/);
  assert.match(r.stdout, /run:   node scripts\/uat\/uat-20-live-story-session\.mjs/);
  assert.match(r.stdout, /run:   node scripts\/uat\/uat-03-destructive-gate\.mjs/);
  assert.doesNotMatch(r.stdout, /build:/);
});
