#!/usr/bin/env node
// The release's SBOM (release.yml) is read from the lockfiles the release builds from, and no
// lockfile names the Node runtime the bundle carries as `flywheel-node`: the sidecar's
// scripts/stage-runtime.mjs downloads it at its pinned NODE_VERSION and checks it against
// nodejs.org's checksums. Without this, an SBOM reader matching a Node advisory against Flywheel
// would find nothing, and the runtime is the largest third-party component in the app. This adds it
// as one CycloneDX component.
//
//   node scripts/release/sbom-add-runtime.mjs <sbom.cdx.json> [repoRoot]
//
// It refuses and writes nothing when the file is not a CycloneDX JSON BOM, or when stage-runtime.mjs
// no longer declares NODE_VERSION as one `const NODE_VERSION = "x.y.z";` line: a version guessed
// from anything looser is a wrong SBOM entry, which is worse than a missing one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STAGE_RUNTIME = "packages/sidecar/scripts/stage-runtime.mjs";
const NODE_VERSION_LINE = /^const NODE_VERSION = "(\d+\.\d+\.\d+)";$/gm;

/** The one pinned Node version stage-runtime.mjs declares; throws on none or several. */
export function nodeVersionFrom(source) {
  const found = [...source.matchAll(NODE_VERSION_LINE)].map((m) => m[1]);
  if (found.length !== 1) {
    throw new Error(
      `${STAGE_RUNTIME}: expected one line \`const NODE_VERSION = "x.y.z";\`, found ${found.length}`,
    );
  }
  return found[0];
}

/** `bom` with the Node runtime as a component, replacing one an earlier run added. */
export function withNodeRuntime(bom, version) {
  if (bom === null || typeof bom !== "object" || bom.bomFormat !== "CycloneDX") {
    throw new Error('not a CycloneDX JSON BOM (no "bomFormat": "CycloneDX")');
  }
  const ref = `pkg:generic/node@${version}`;
  const component = {
    "bom-ref": ref,
    // CycloneDX's "platform": a runtime environment that executes software, which Node is here.
    type: "platform",
    name: "node",
    version,
    purl: ref,
    externalReferences: [{ type: "distribution", url: `https://nodejs.org/dist/v${version}/` }],
  };
  const others = (bom.components ?? []).filter(
    (c) => !(typeof c.purl === "string" && c.purl.startsWith("pkg:generic/node@")),
  );
  return { ...bom, components: [...others, component] };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  const root =
    process.argv[3] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (!file) {
    console.error("usage: sbom-add-runtime.mjs <sbom.cdx.json> [repoRoot]");
    process.exit(2);
  }
  try {
    const version = nodeVersionFrom(fs.readFileSync(path.join(root, STAGE_RUNTIME), "utf8"));
    const bom = withNodeRuntime(JSON.parse(fs.readFileSync(file, "utf8")), version);
    fs.writeFileSync(file, `${JSON.stringify(bom, null, 2)}\n`);
    console.log(`sbom-add-runtime: added node ${version}`);
  } catch (err) {
    console.error(`sbom-add-runtime: ${err.message}`);
    process.exit(1);
  }
}
