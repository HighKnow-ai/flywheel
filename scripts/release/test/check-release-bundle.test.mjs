// The release bundle check (issue #786): a bundle naming a non-production Environment or carrying
// the Environment picker fails; a clean one passes; a path holding no file fails rather than
// passing by checking nothing. The fixtures are small `.app`- and `dist`-shaped trees.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { scan } from "../check-release-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../check-release-bundle.mjs");

/** A release-shaped bundle: a binary, a resource and a JavaScript chunk, plus `extra` files. */
function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-release-bundle-"));
  const files = {
    "Flywheel.app/Contents/MacOS/flywheel-desktop": Buffer.concat([
      Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x01]),
      Buffer.from("https://api.highknow.ai\0settings_get\0"),
    ]),
    "Flywheel.app/Contents/Info.plist": "<plist><key>CFBundleIdentifier</key><string>ai.highknow.flywheel</string></plist>",
    "dist/assets/index-abc123.js": 'invoke("settings_get");const DevEnvironment=null;',
    ...extra,
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("a release-shaped bundle with neither string passes", () => {
  const dir = fixture();
  try {
    const r = run(path.join(dir, "Flywheel.app"), path.join(dir, "dist"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a binary naming a non-production hostname fails, naming the file", () => {
  const binary = "Flywheel.app/Contents/MacOS/flywheel-desktop";
  const dir = fixture({
    [binary]: Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from("https://staging-api.highknow.dev\0")]),
  });
  try {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(`${path.join(dir, binary)} contains "highknow.dev"`), r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a chunk carrying the picker fails", () => {
  const dir = fixture({ "dist/assets/DevEnvironment-x1.js": 'invokeCommand("dev_environment_choose",{tier})' });
  try {
    const r = run(path.join(dir, "dist"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /DevEnvironment-x1\.js contains "dev_environment" \(the development builds' Environment picker\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every hit is reported, not only the first", () => {
  const dir = fixture({
    "a.js": "env-demo-api.highknow.dev dev_environment_get",
    "b.js": "staging-api.highknow.dev",
  });
  try {
    const { hits } = scan([dir]);
    assert.deepEqual(
      hits.map((h) => [path.basename(h.file), h.needle]),
      [
        ["a.js", "highknow.dev"],
        ["a.js", "dev_environment"],
        ["b.js", "highknow.dev"],
      ],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a symbolic link is not followed out of the bundle", () => {
  const outside = fixture({ "leak.js": "staging-api.highknow.dev" });
  const dir = fixture();
  try {
    fs.symlinkSync(path.join(outside, "leak.js"), path.join(dir, "dist", "link.js"));
    assert.equal(run(path.join(dir, "dist")).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("a path holding no file fails rather than passing vacuously", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-release-bundle-empty-"));
  try {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nothing was checked/);
    assert.equal(run(path.join(dir, "missing")).status, 1);
    assert.equal(run().status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
