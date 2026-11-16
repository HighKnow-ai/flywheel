// The hosted-calls check (ADR 0041): an undeclared HighKnow host fails, a declared one passes.
// Host names are joined from parts so this file is not itself an undeclared mention.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { check, parseAllowlist } from "../check-hosted-calls.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../check-hosted-calls.mjs");
const flywheelRoot = path.resolve(path.dirname(script), "..", "..");
const ZONE = ["highknow", "ai"].join(".");
const DEV = ["highknow", "dev"].join(".");

const HEAD =
  "## Declared hosts\n\n| Host | Path prefix | Purpose | Data sent | Default | Privacy policy | Status |\n|---|---|---|---|---|---|---|\n";
const NOT_CALLED = `| api.${ZONE} | - | the origin | none | n/a | n/a | declared, not called |\n`;
const UPDATES = `| updates.${ZONE} | /v1/check | update check | version, platform | on | https://${ZONE}/privacy#flywheel | called |\n`;

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hosted-calls-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test("an undeclared host in code fails, naming file and line", () => {
  const dir = tree({
    "docs/hosted-calls.md": HEAD + NOT_CALLED,
    "src/a.rs": `// ok\nconst U: &str = "https://telemetry.${ZONE}/x";\n`,
  });
  const problems = check(dir);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].startsWith(`src/a.rs:2 names telemetry.${ZONE}`), true);
  assert.equal(spawnSync("node", [script, dir], { encoding: "utf8" }).status, 1);
});

test("a declared host passes, and a glob row matches", () => {
  const dir = tree({
    "docs/hosted-calls.md": HEAD + NOT_CALLED + `| *-api.${DEV} | - | staging | none | n/a | n/a | declared, not called |\n`,
    "src/a.ts": `const a = "https://api.${ZONE}"; const b = "https://staging-api.${DEV}/v1";`,
    "cfg/tauri.json": `{"identifier": "ai.highknow.flywheel"}`,
  });
  assert.deepEqual(check(dir), []);
  assert.equal(spawnSync("node", [script, dir], { encoding: "utf8" }).status, 0);
});

test("a host in a config file and in a shell script is found, node_modules is not scanned", () => {
  const dir = tree({
    "docs/hosted-calls.md": HEAD + NOT_CALLED,
    "conf/app.toml": `url = "https://x.${DEV}"`,
    "bin/run.sh": `curl https://y.${ZONE}/z`,
    "node_modules/p/i.js": `"https://z.${ZONE}"`,
  });
  assert.equal(check(dir).length, 2);
});

test("a called row needs Default on or opt-in, a path, and an https privacy URL", () => {
  const bad = `| t.${ZONE} | t | telemetry | events | off | none | called |\n`;
  assert.equal(parseAllowlist(HEAD + bad).faults.length, 3);
  assert.deepEqual(parseAllowlist(HEAD + UPDATES).faults, []);
});

test("a missing allowlist or section fails", () => {
  assert.equal(check(tree({ "a.rs": "" })).length, 1);
  assert.equal(parseAllowlist("# nothing").faults.length, 1);
});

test("Flywheel's own tree passes", () => {
  assert.deepEqual(check(flywheelRoot), []);
});
