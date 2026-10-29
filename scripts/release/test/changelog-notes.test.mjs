// The release body comes from CHANGELOG.md's section for the tag (release.yml's notes step).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { changelogSection } from "../changelog-notes.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../changelog-notes.mjs");

const CHANGELOG = `# Changelog

Preamble.

## Unreleased

- Not yet released.

## 0.1.3 — 2026-10-29

- The board loads faster.
- If you installed 0.1.1, download this release by hand.

## 0.1.2

- Older.
`;

function run(tag, text = CHANGELOG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-notes-"));
  const file = path.join(dir, "CHANGELOG.md");
  fs.writeFileSync(file, text);
  try {
    return spawnSync(process.execPath, [script, tag, file], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the tag's section, with a dated heading, is the body", () => {
  const r = run("v0.1.3");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "- The board loads faster.\n- If you installed 0.1.1, download this release by hand.\n");
});

test("the last section ends at the end of the file", () => {
  assert.equal(changelogSection(CHANGELOG, "0.1.2"), "- Older.");
});

test("a version that is only a prefix of a heading is not that heading", () => {
  assert.equal(changelogSection(CHANGELOG, "0.1"), null);
});

test("a tag with no section is refused, printing no body", () => {
  const r = run("v0.1.4");
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /no '## 0\.1\.4' section/);
});

test("a section with no entry is refused", () => {
  const r = run("v0.2.0", "# Changelog\n\n## 0.2.0\n\nNothing listed.\n");
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
});

test("a malformed tag is refused", () => {
  const r = run("0.1.3");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rejected tag/);
});
