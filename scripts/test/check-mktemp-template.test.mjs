// The mktemp guard (#1766): bare forms are flagged, templates under TMPDIR and comments are not, and the tree is clean.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { scanText } from "../check-mktemp-template.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../check-mktemp-template.mjs");

test("a bare mktemp, mktemp -d and mktemp -t are flagged in shell, YAML and a package.json command", () => {
  for (const line of [
    'tmp=$(mktemp)',
    'mnt=$(mktemp -d)',
    "x=`mktemp -t flywheel`",
    'mktemp -t "x.XXXXXX"',
    '"test": "A=\\"${A:-$(mktemp -d)}\\" node --test"',
    "      run: mktemp -d",
  ]) {
    assert.equal(scanText(line).found.length, 1, line);
  }
});

test("a template under TMPDIR, a comment and a message are not flagged", () => {
  for (const line of [
    'tmp="$(mktemp -d "${TMPDIR:-/tmp}/flywheel-x.XXXXXX")"',
    "# mktemp -d is bare here",
    'echo "mktemp failed" >&2',
    "the mktemp call is below",
    "      - name: mktemp templates",
    "        name: mktemp templates",
  ]) {
    assert.equal(scanText(line).found.length, 0, line);
  }
});

test("mktemp-ok allows a bare call and reports its reason", () => {
  const { found, allowed } = scanText("x=$(mktemp) # mktemp-ok: runs on a hosted runner only");
  assert.equal(found.length, 0);
  assert.equal(allowed[0].reason, "runs on a hosted runner only");
});

test("the Flywheel tree has no bare mktemp", () => {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
