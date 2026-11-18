// What release.yml may publish. The installer is not built by the workflow: it is on the draft before the
// tag exists, so these are the refusals that stop the workflow publishing something it did not check.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { assetNames, draftProblems, pickDraft } from "../draft-assets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../draft-assets.mjs");

const NAMES = assetNames("1.2.3");
const asset = (name, state = "uploaded") => ({ id: 1, name, state });
const GOOD = () => ({ draft: true, assets: [asset(NAMES.dmg), asset(NAMES.sums)] });

test("the names are the installer's, its checksum's and the SBOM's", () => {
  assert.deepEqual(NAMES, {
    dmg: "Flywheel_1.2.3_aarch64.dmg",
    sums: "Flywheel_1.2.3_aarch64.dmg.sha256",
    sbom: "Flywheel_1.2.3.cdx.json",
  });
});

test("pick: the one draft of the tag is the one", () => {
  const releases = [
    { id: 1, tag_name: "v1.2.2", draft: false },
    { id: 2, tag_name: "v1.2.3", draft: true },
    { id: 3, tag_name: "v1.2.4", draft: true },
  ];
  assert.deepEqual(pickDraft(releases, "v1.2.3"), { id: 2 });
});

test("pick: a published release of the tag stops the workflow, whatever drafts there are", () => {
  const releases = [
    { id: 1, tag_name: "v1.2.3", draft: false },
    { id: 2, tag_name: "v1.2.3", draft: true },
  ];
  assert.match(pickDraft(releases, "v1.2.3").problem, /already published/);
});

test("pick: no draft for the tag stops the workflow, so a tag pushed any other way publishes nothing", () => {
  assert.match(pickDraft([{ id: 3, tag_name: "v1.2.4", draft: true }], "v1.2.3").problem, /no draft release/);
  assert.match(pickDraft([], "v1.2.3").problem, /no draft release/);
});

test("pick: two drafts of the tag are ambiguous", () => {
  const releases = [
    { id: 2, tag_name: "v1.2.3", draft: true },
    { id: 4, tag_name: "v1.2.3", draft: true },
  ];
  assert.match(pickDraft(releases, "v1.2.3").problem, /2 drafts/);
});

test("pick: a tag that only starts with this one's name is another tag", () => {
  assert.match(pickDraft([{ id: 2, tag_name: "v1.2.30", draft: true }], "v1.2.3").problem, /no draft release/);
});

test("pick: something that is not a list is refused", () => {
  assert.match(pickDraft({ message: "Not Found" }, "v1.2.3").problem, /not an array/);
});

test("check: a draft with the .dmg and its checksum is fit", () => {
  assert.deepEqual(draftProblems(GOOD(), "1.2.3"), []);
});

test("check: the SBOM of an earlier failed run may be there", () => {
  const release = GOOD();
  release.assets.push(asset(NAMES.sbom));
  assert.deepEqual(draftProblems(release, "1.2.3"), []);
});

test("check: a published release is refused", () => {
  const release = GOOD();
  release.draft = false;
  assert.match(draftProblems(release, "1.2.3").join("\n"), /not a draft/);
});

test("check: a missing .dmg or checksum is refused, each by name", () => {
  const noDmg = { draft: true, assets: [asset(NAMES.sums)] };
  const noSums = { draft: true, assets: [asset(NAMES.dmg)] };
  assert.match(draftProblems(noDmg, "1.2.3").join("\n"), /has no Flywheel_1\.2\.3_aarch64\.dmg$/m);
  assert.match(draftProblems(noSums, "1.2.3").join("\n"), /has no .*\.dmg\.sha256$/m);
});

test("check: an installer of another name, or any other file, is refused: only what was signed ships", () => {
  for (const stray of ["Flywheel_1.2.3_x64.dmg", "Flywheel_aarch64.app.tar.gz", "Flywheel_1.2.2_aarch64.dmg", "notarisation.txt"]) {
    const release = GOOD();
    release.assets.push(asset(stray));
    assert.match(draftProblems(release, "1.2.3").join("\n"), new RegExp(`carries ${stray.replace(/\./g, "\\.")}`), stray);
  }
});

test("check: an asset that is not uploaded (an interrupted upload) is refused", () => {
  const release = GOOD();
  release.assets[0] = asset(NAMES.dmg, "starter");
  assert.match(draftProblems(release, "1.2.3").join("\n"), /is in state starter, not uploaded/);
});

test("check: the same name twice is refused", () => {
  const release = GOOD();
  release.assets.push(asset(NAMES.dmg));
  assert.match(draftProblems(release, "1.2.3").join("\n"), /on the draft 2 times/);
});

test("check: something that is not a release is refused", () => {
  assert.equal(draftProblems(null, "1.2.3").length, 1);
  assert.equal(draftProblems({ message: "Not Found" }, "1.2.3").length, 1);
});

function cli(args, stdin) {
  const r = spawnSync(process.execPath, [script, ...args], { input: stdin, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test("cli: pick prints the id, and refuses on stderr with exit 1", () => {
  const ok = cli(["pick", "v1.2.3"], JSON.stringify([{ id: 42, tag_name: "v1.2.3", draft: true }]));
  assert.equal(ok.status, 0);
  assert.equal(ok.out.trim(), "42");
  const none = cli(["pick", "v1.2.3"], "[]");
  assert.equal(none.status, 1);
  assert.equal(none.out, "");
  assert.match(none.err, /no draft release/);
});

test("cli: check exits 0 on a fit draft and 1 on a stray asset", () => {
  assert.equal(cli(["check", "1.2.3"], JSON.stringify(GOOD())).status, 0);
  const bad = GOOD();
  bad.assets.push(asset("Flywheel_1.2.3_x64.dmg"));
  const r = cli(["check", "1.2.3"], JSON.stringify(bad));
  assert.equal(r.status, 1);
  assert.match(r.err, /Flywheel_1\.2\.3_x64\.dmg/);
});

test("cli: input that is not JSON, or a bad tag or version, is refused, never read as fit", () => {
  assert.equal(cli(["pick", "v1.2.3"], "not json").status, 1);
  assert.equal(cli(["check", "1.2.3"], "").status, 1);
  assert.equal(cli(["pick", "1.2.3"], "[]").status, 2);
  assert.equal(cli(["check", "v1.2.3"], "{}").status, 2);
  assert.equal(cli([], "").status, 2);
});
