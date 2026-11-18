#!/usr/bin/env node
// What release.yml finds on the draft it is about to attest and publish, and refuses.
//
// The installer on a Flywheel release is not built by this workflow. A signed and notarised `.dmg`, and its
// checksum, are put on the release's draft BEFORE the tag that starts this workflow exists, so this
// workflow works from what it finds there. It must never publish a draft that carries anything else: a
// second `.dmg`, an installer from another build, a half-uploaded file.
//
//   gh api --paginate repos/<repo>/releases | jq -s 'add // []' | node scripts/release/draft-assets.mjs pick v0.1.5
//   gh api repos/<repo>/releases/<id>          | node scripts/release/draft-assets.mjs check 0.1.5
//
// `pick <tag>` reads the repository's releases (a JSON array) on stdin and prints the id of the one draft
// whose tag is `<tag>`. It refuses when a release for the tag is already published (the repository's
// releases are immutable), when no draft carries the tag, and when two do.
//
// `check <version>` reads one release on stdin. It refuses unless the release is still a draft that carries
// the .dmg and its checksum, both in state `uploaded` (an interrupted upload leaves one in state
// "starter"), and nothing but those two and the SBOM (which this workflow attaches itself, so an earlier
// failed run may have left it there). Every problem is printed. Exit 0: fine. Exit 1: a problem. Exit 2: usage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;
const TAG_SHAPE = /^v\d+\.\d+\.\d+$/;

/** The names a release of `version` may carry: the installer, its checksum, and the SBOM this workflow adds. */
export function assetNames(version) {
  const dmg = `Flywheel_${version}_aarch64.dmg`;
  return { dmg, sums: `${dmg}.sha256`, sbom: `Flywheel_${version}.cdx.json` };
}

/** `{ id }` of the one draft of `tag` among `releases`, or `{ problem }`. */
export function pickDraft(releases, tag) {
  if (!Array.isArray(releases)) return { problem: "the release list is not an array" };
  const mine = releases.filter((r) => r && r.tag_name === tag);
  const published = mine.filter((r) => r.draft === false);
  if (published.length > 0) {
    return { problem: `release ${tag} is already published, so its assets cannot change. Not releasing again` };
  }
  const drafts = mine.filter((r) => r.draft === true);
  if (drafts.length === 0) {
    return {
      problem: `no draft release carries the tag ${tag}: the signed installer is put on the draft before the tag exists, so a tag pushed any other way has nothing to publish`,
    };
  }
  if (drafts.length > 1) return { problem: `${drafts.length} drafts carry the tag ${tag}; delete the extra ones` };
  if (!Number.isInteger(drafts[0].id)) return { problem: "the draft has no numeric id" };
  return { id: drafts[0].id };
}

/** Every reason a draft is not fit to attest and publish, as sentences; none when it is. */
export function draftProblems(release, version) {
  if (!release || typeof release !== "object" || !Array.isArray(release.assets)) {
    return ["the release is not a release object with assets"];
  }
  const names = assetNames(version);
  const allowed = new Set([names.dmg, names.sums, names.sbom]);
  const problems = [];
  if (release.draft !== true) problems.push("the release is not a draft, so its assets cannot change");
  const seen = new Map();
  for (const asset of release.assets) {
    seen.set(asset.name, (seen.get(asset.name) ?? 0) + 1);
    if (!allowed.has(asset.name)) problems.push(`the draft carries ${asset.name}, which this release does not ship`);
    if (asset.state !== "uploaded") problems.push(`${asset.name} is in state ${asset.state}, not uploaded`);
  }
  for (const [name, n] of seen) if (n > 1) problems.push(`${name} is on the draft ${n} times`);
  for (const need of [names.dmg, names.sums]) {
    if (!seen.has(need)) problems.push(`the draft has no ${need}`);
  }
  return problems;
}

function readStdin() {
  return JSON.parse(fs.readFileSync(0, "utf8"));
}

function main(argv) {
  const [mode, arg] = argv;
  if (mode === "pick" && TAG_SHAPE.test(arg ?? "")) {
    let picked;
    try {
      picked = pickDraft(readStdin(), arg);
    } catch (err) {
      console.error(`draft-assets: stdin is not JSON: ${err.message}`);
      return 1;
    }
    if (picked.problem) {
      console.error(`draft-assets: ${picked.problem}`);
      return 1;
    }
    console.log(picked.id);
    return 0;
  }
  if (mode === "check" && VERSION_SHAPE.test(arg ?? "")) {
    let problems;
    try {
      problems = draftProblems(readStdin(), arg);
    } catch (err) {
      console.error(`draft-assets: stdin is not JSON: ${err.message}`);
      return 1;
    }
    for (const p of problems) console.error(`draft-assets: ${p}`);
    if (problems.length > 0) return 1;
    const names = assetNames(arg);
    console.log(`draft-assets: the draft is a draft and carries ${names.dmg} and its checksum`);
    return 0;
  }
  console.error("usage: draft-assets.mjs pick v<major>.<minor>.<patch> | check <major>.<minor>.<patch>   (JSON on stdin)");
  return 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main(process.argv.slice(2)));
