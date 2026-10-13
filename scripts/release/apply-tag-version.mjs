#!/usr/bin/env node
// D-184: the pushed git tag is the single source of the release version. This stamps it into the
// three places a version is written by hand, or refuses and changes nothing.
//
//   node scripts/release/apply-tag-version.mjs v0.1.0 [repoRoot]
//
// packages/sidecar/package.json also carries a version and is deliberately NOT stamped: it is a
// private workspace package whose version is never published and never read at runtime. Do not
// "fix" the omission.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG_SHAPE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

const tag = process.argv[2] ?? "";
const root = process.argv[3] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const match = TAG_SHAPE.exec(tag);
if (!match) {
  console.error(`apply-tag-version: rejected tag ${JSON.stringify(tag)}; expected v<major>.<minor>.<patch>[-prerelease], e.g. v0.1.0 or v0.1.0-rc.1`);
  process.exit(1);
}
const version = match[1];

const stampJson = (rel) => {
  const file = path.join(root, rel);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof json.version !== "string") throw new Error(`${rel}: no "version" key`);
  json.version = version;
  return [file, `${JSON.stringify(json, null, 2)}\n`];
};

// Only the first `version = "..."` inside [package]. The dependency lines and comments in this file
// carry pinned strings (=2.11.5, =2.4.0) that a file-wide substitution would rewrite.
const stampCargo = (rel) => {
  const file = path.join(root, rel);
  let table = "";
  let done = false;
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => {
    const t = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (t) table = t[1].trim();
    if (!done && table === "package" && /^version\s*=\s*"/.test(line)) {
      done = true;
      return `version = "${version}"`;
    }
    return line;
  });
  if (!done) throw new Error(`${rel}: no version key in [package]`);
  return [file, lines.join("\n")];
};

try {
  // Compute every new content before writing any, so a bad manifest never leaves a half-stamp.
  const writes = [
    stampJson("packages/desktop/src-tauri/tauri.conf.json"),
    stampCargo("packages/desktop/src-tauri/Cargo.toml"),
    stampJson("packages/desktop/package.json"),
  ];
  for (const [file, content] of writes) fs.writeFileSync(file, content);
  console.log(`apply-tag-version: stamped ${version}`);
} catch (err) {
  console.error(`apply-tag-version: ${err.message}`);
  process.exit(1);
}
