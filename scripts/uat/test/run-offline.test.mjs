import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { OFFLINE_SCRIPTS, offlineCommands } from "../run-offline.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("every offline script exists and CI runs them through this runner, once", () => {
  for (const [script] of OFFLINE_SCRIPTS) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, script)), `${script} is listed and does not exist`);
  }
  const ci = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.equal(ci.split("node scripts/uat/run-offline.mjs").length - 1, 1);
  // No script is still run by hand beside the runner: that would run it twice.
  for (const [script] of OFFLINE_SCRIPTS) {
    assert.ok(!ci.includes(`node ${script}`), `ci.yml still runs ${script} itself`);
  }
});

test("each script and each mode of the supervision gate is one command, run by the given node", () => {
  const commands = offlineCommands("/usr/bin/node");
  assert.equal(commands.length, OFFLINE_SCRIPTS.length);
  assert.deepEqual(commands[0].argv, ["/usr/bin/node", "scripts/uat/harness-supervision-gate.mjs", "--mode=supervised"]);
  assert.deepEqual(commands[1].argv, ["/usr/bin/node", "scripts/uat/harness-supervision-gate.mjs", "--mode=unsupervised"]);
  assert.equal(new Set(commands.map((c) => c.label)).size, commands.length);
});
