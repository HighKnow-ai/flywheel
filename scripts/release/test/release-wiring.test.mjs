// What holds the Mach-O guard in place: each of these is one line in a file nobody
// re-reads, and losing any of them reopens the hazard with nothing failing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("rust-toolchain.toml names an exact version, never a channel that floats", () => {
  assert.match(read("rust-toolchain.toml"), /^channel = "\d+\.\d+\.\d+"$/m);
});

for (const workflow of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
  test(`${workflow} installs rust-toolchain.toml's version at every use of the setup action`, () => {
    const [, channel] = /^channel = "(.+)"$/m.exec(read("rust-toolchain.toml"));
    const steps = read(workflow).match(/uses: dtolnay\/rust-toolchain@[^\n]*\n(?: +with:\n(?: {10}[^\n]*\n)*)?/g) ?? [];
    assert.ok(steps.length > 0, "the action is used");
    for (const step of steps) assert.ok(step.includes(`toolchain: ${channel}\n`), step);
  });

  test(`${workflow} checks the finished bundle`, () => {
    assert.match(read(workflow), /node scripts\/release\/check-macho\.mjs/);
  });
}

test("rustc's strip stays off", () => {
  const [profile] = /\[profile\.release\][\s\S]*?(?=\n\[|$)/.exec(read("Cargo.toml"));
  assert.match(profile, /^strip = false$/m);
});

test("tauri runs the hook that strips and checks, between compiling and bundling", () => {
  const conf = JSON.parse(read("packages/desktop/src-tauri/tauri.conf.json"));
  assert.equal(conf.build.beforeBundleCommand, "node ../../scripts/release/before-bundle.mjs");
});

test("the release publishes only after the job holding the guard succeeded", () => {
  const workflow = read(".github/workflows/release.yml");
  const attest = workflow.slice(workflow.indexOf("\n  attest:"));
  assert.match(attest, /^ {4}needs: release$/m);
  const release = workflow.slice(workflow.indexOf("\n  release:"), workflow.indexOf("\n  attest:"));
  assert.match(release, /check-macho\.mjs/);
  assert.doesNotMatch(release, /check-macho[\s\S]*continue-on-error/);
});
