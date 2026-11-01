// The release SBOM's Node runtime component (release.yml's SBOM step).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { nodeVersionFrom, withNodeRuntime } from "../sbom-add-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../sbom-add-runtime.mjs");
const repoRoot = path.resolve(here, "../../..");

const BOM = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  components: [{ "bom-ref": "pkg:cargo/serde@1.0.0", type: "library", name: "serde", purl: "pkg:cargo/serde@1.0.0" }],
};

function fixture(stageRuntime, bom = BOM) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sbom-add-runtime-"));
  fs.mkdirSync(path.join(dir, "packages/sidecar/scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "packages/sidecar/scripts/stage-runtime.mjs"), stageRuntime);
  const file = path.join(dir, "sbom.cdx.json");
  fs.writeFileSync(file, typeof bom === "string" ? bom : JSON.stringify(bom));
  return { dir, file };
}

function run(stageRuntime, bom) {
  const { dir, file } = fixture(stageRuntime, bom);
  try {
    const before = fs.readFileSync(file, "utf8");
    const r = spawnSync(process.execPath, [script, file, dir], { encoding: "utf8" });
    return { ...r, before, after: fs.readFileSync(file, "utf8") };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the real stage-runtime.mjs declares exactly one NODE_VERSION this script can read", () => {
  const source = fs.readFileSync(path.join(repoRoot, "packages/sidecar/scripts/stage-runtime.mjs"), "utf8");
  assert.match(nodeVersionFrom(source), /^\d+\.\d+\.\d+$/);
});

test("adds node at the pinned version and keeps every other component", () => {
  const r = run('const NODE_VERSION = "22.23.3";\n');
  assert.equal(r.status, 0, r.stderr);
  const bom = JSON.parse(r.after);
  assert.deepEqual(bom.components[0], BOM.components[0]);
  const node = bom.components.find((c) => c.name === "node");
  assert.equal(node.version, "22.23.3");
  assert.equal(node.purl, "pkg:generic/node@22.23.3");
  assert.equal(node.type, "platform");
  assert.equal(node.externalReferences[0].url, "https://nodejs.org/dist/v22.23.3/");
});

test("a rerun replaces the node component rather than adding a second one", () => {
  const once = withNodeRuntime(BOM, "22.23.3");
  const twice = withNodeRuntime(once, "22.24.0");
  const nodes = twice.components.filter((c) => c.name === "node");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].version, "22.24.0");
});

test("a BOM with no components gets one", () => {
  const bom = withNodeRuntime({ bomFormat: "CycloneDX", specVersion: "1.6" }, "22.23.3");
  assert.equal(bom.components.length, 1);
});

test("refuses a file that is not a CycloneDX BOM, and leaves it as it was", () => {
  const r = run('const NODE_VERSION = "22.23.3";\n', { spdxVersion: "SPDX-2.3" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a CycloneDX JSON BOM/);
  assert.equal(r.after, r.before);
});

test("refuses when NODE_VERSION is missing, duplicated or not a literal", () => {
  for (const source of [
    "const OTHER = 1;\n",
    'const NODE_VERSION = "22.23.3";\nconst NODE_VERSION = "22.24.0";\n',
    "const NODE_VERSION = process.env.NODE_VERSION;\n",
  ]) {
    const r = run(source);
    assert.equal(r.status, 1, source);
    assert.match(r.stderr, /expected one line/);
    assert.equal(r.after, r.before);
  }
});
