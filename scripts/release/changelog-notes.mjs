#!/usr/bin/env node
// A release's notes are its section of CHANGELOG.md, written in the change that made each entry,
// in words a Flywheel user recognises. release.yml publishes them as the release body; it used to
// publish the commit subjects since the previous tag, which are written for developers.
//
//   node scripts/release/changelog-notes.mjs v0.1.3 [CHANGELOG.md]
//
// Prints the body of the `## 0.1.3` section (the heading may go on with a date:
// `## 0.1.3 — 2026-10-29`), without its leading and trailing blank lines. Refuses, printing
// nothing, when the tag is malformed or the section is missing or has no `- ` entry: a release
// says what changed, and a placeholder body would hide that it does not.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG_SHAPE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** The body of the `## <version>` section of `text`, or null when there is none. */
export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && l.split(/\s+/)[1] === version);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  while (body.length > 0 && body[0].trim() === "") body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  return body.join("\n");
}

function main() {
  const tag = process.argv[2] ?? "";
  const file =
    process.argv[3] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "CHANGELOG.md");
  const match = TAG_SHAPE.exec(tag);
  if (!match) {
    console.error(`changelog-notes: rejected tag ${JSON.stringify(tag)}; expected v<major>.<minor>.<patch>[-prerelease]`);
    return 1;
  }
  const version = match[1];
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    console.error(`changelog-notes: cannot read ${file}: ${err.message}`);
    return 1;
  }
  const body = changelogSection(text, version);
  if (body === null || !body.split("\n").some((l) => l.startsWith("- "))) {
    console.error(
      `changelog-notes: ${path.basename(file)} has no '## ${version}' section with a '- ' entry. ` +
        "A release moves its Unreleased entries under its version before it is tagged.",
    );
    return 1;
  }
  process.stdout.write(`${body}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
