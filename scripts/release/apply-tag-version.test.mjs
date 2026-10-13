// Drives apply-tag-version.mjs against copies of the real manifests in a temp tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const SCRIPT = path.join(here, "apply-tag-version.mjs");
const FILES = [
  "packages/desktop/src-tauri/tauri.conf.json",
  "packages/desktop/src-tauri/Cargo.toml",
  "packages/desktop/package.json",
];

const temps = [];
after(() => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function tree(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tagver-"));
  temps.push(dir);
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
  }
  mutate?.(dir);
  return dir;
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");
const run = (tag, dir) => spawnSync(process.execPath, [SCRIPT, tag, dir], { encoding: "utf8" });

test("stamps the tag version into all three manifests and prints it", () => {
  const dir = tree();
  const r = run("v9.8.7-rc.1", dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /9\.8\.7-rc\.1/);
  assert.equal(JSON.parse(read(dir, FILES[0])).version, "9.8.7-rc.1");
  assert.equal(JSON.parse(read(dir, FILES[2])).version, "9.8.7-rc.1");
  assert.match(read(dir, FILES[1]), /^version = "9\.8\.7-rc\.1"$/m);
  // Cargo pins in dependency lines survive.
  assert.match(read(dir, FILES[1]), /=2\.11\.5/);
  assert.match(read(dir, FILES[1]), /=2\.6\.3/);
});

test("a malformed tag exits non-zero and writes nothing", () => {
  const dir = tree();
  const before = FILES.map((f) => read(dir, f));
  for (const bad of ["vnot-a-version", "0.1.0", "v1.2", "v1.2.3; rm -rf /", ""]) {
    const r = run(bad, dir);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /expected v<major>/);
  }
  assert.deepEqual(FILES.map((f) => read(dir, f)), before);
});

test("a second run with the same tag changes no bytes", () => {
  const dir = tree();
  run("v0.4.2", dir);
  const once = FILES.map((f) => read(dir, f));
  run("v0.4.2", dir);
  assert.deepEqual(FILES.map((f) => read(dir, f)), once);
  // Comments in Cargo.toml survive.
  assert.equal(read(dir, FILES[1]).split("\n").length, fs.readFileSync(path.join(REPO, FILES[1]), "utf8").split("\n").length);
});

test("a manifest missing its version key is an error naming the file, with no half-stamp", () => {
  const dir = tree((d) => {
    const p = path.join(d, FILES[2]);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    delete j.version;
    fs.writeFileSync(p, JSON.stringify(j));
  });
  const before = FILES.map((f) => read(dir, f));
  const r = run("v1.0.0", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /packages\/desktop\/package\.json/);
  assert.deepEqual(FILES.map((f) => read(dir, f)), before);
});
