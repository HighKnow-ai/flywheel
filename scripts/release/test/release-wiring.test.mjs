// What holds the Mach-O guard in place: each of these is one line in a file nobody
// re-reads, and losing any of them reopens the hazard with nothing failing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("rust-toolchain.toml names an exact version, never a channel that floats", () => {
  assert.match(read("rust-toolchain.toml"), /^channel = "\d+\.\d+\.\d+"$/m);
});

// release.yml builds nothing since the signed installer came from elsewhere, so it installs no Rust toolchain.
test(".github/workflows/ci.yml installs rust-toolchain.toml's version at every use of the setup action", () => {
  const [, channel] = /^channel = "(.+)"$/m.exec(read("rust-toolchain.toml"));
  const steps = read(".github/workflows/ci.yml").match(/uses: dtolnay\/rust-toolchain@[^\n]*\n(?: +with:\n(?: {10}[^\n]*\n)*)?/g) ?? [];
  assert.ok(steps.length > 0, "the action is used");
  for (const step of steps) assert.ok(step.includes(`toolchain: ${channel}\n`), step);
});

for (const workflow of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
  test(`${workflow} checks the finished bundle`, () => {
    assert.match(read(workflow), /node scripts\/release\/check-macho\.mjs/);
  });
}

test("rustc's strip stays off", () => {
  const [profile] = /\[profile\.release\][\s\S]*?(?=\n\[|$)/.exec(read("Cargo.toml"));
  assert.match(profile, /^strip = false$/m);
});

test("tauri runs the hook that strips and checks, between compiling and bundling", () => {
  const conf = JSON.parse(read("packages/desktop/src-tauri/tauri.conf.json"));
  assert.equal(conf.build.beforeBundleCommand, "node ../../scripts/release/before-bundle.mjs");
});

test("a signed bundle carries the entitlements the bundled Node needs under the hardened runtime", () => {
  // A Developer ID build is notarised only with the hardened runtime on, which kills a process that maps
  // executable memory without these keys: the sidecar's Node would die at start, in a signed app only.
  const conf = JSON.parse(read("packages/desktop/src-tauri/tauri.conf.json"));
  assert.equal(conf.bundle.macOS.entitlements, "Entitlements.plist");
  const plist = read("packages/desktop/src-tauri/Entitlements.plist");
  assert.match(plist, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
  assert.match(plist, /<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>\s*<true\/>/);
  // Nothing else is granted without a reason written beside it: a new key is a change to this test.
  const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory"]);
});

// The release ships a .dmg that is built, signed and notarised elsewhere and put on the draft BEFORE the tag
// that starts release.yml exists. These hold the order and the refusals that make that safe: the workflow
// builds nothing, publishes only what it checked, and fails with nothing published otherwise.
const workflow = () => read(".github/workflows/release.yml");
const jobOf = (name) => {
  const text = workflow();
  const at = text.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, `the ${name} job exists`);
  const next = text.slice(at + 1).search(/\n {2}[a-z-]+:\n/);
  return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
};

test("the release publishes only after the job holding the guard succeeded", () => {
  assert.match(jobOf("attest"), /^ {4}needs: release$/m);
  const release = jobOf("release");
  assert.match(release, /check-macho\.mjs/);
  assert.doesNotMatch(release, /check-macho[\s\S]*continue-on-error/);
});

test("the workflow builds no installer: no tauri, no cargo, no npm install, no rust toolchain", () => {
  const steps = [...workflow().matchAll(/^ *(?:- )?(?:run|uses): .*$/gm)].map((m) => m[0]).join("\n");
  for (const forbidden of [/tauri-apps\/tauri-action/, /\btauri build\b/, /\bcargo (build|test)\b/, /\bnpm (ci|install)\b/, /dtolnay\/rust-toolchain/, /Swatinem\/rust-cache/]) {
    assert.doesNotMatch(steps, forbidden);
  }
});

test("the installer is the draft's: found, checked, downloaded, verified, and only then is the page written", () => {
  const release = jobOf("release");
  const at = (re) => release.search(re);
  const order = [
    /draft-assets\.mjs pick/,
    /draft-assets\.mjs check/,
    /releases\/assets\/\$id/,
    /check-signed-dmg\.mjs/,
    /check-macho\.mjs/,
    /--method PATCH/,
    /--method POST/,
  ].map(at);
  assert.ok(order.every((i) => i >= 0), `every step is there: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in this order");
});

test("nothing before the signed-installer check writes to the draft", () => {
  const release = jobOf("release");
  const before = release.slice(0, release.search(/check-signed-dmg\.mjs/));
  assert.doesNotMatch(before, /--method (PATCH|POST|DELETE)/);
});

test("only the attest job publishes, once, and only after the attestations verify", () => {
  const text = workflow();
  const publishes = text.match(/draft=false/g) ?? [];
  assert.equal(publishes.length, 1);
  assert.ok(jobOf("attest").includes("draft=false"));
  const attest = jobOf("attest");
  assert.ok(attest.search(/gh attestation verify/) < attest.search(/draft=false/), "verify, then publish");
  assert.match(attest, /sha256sum -c/, "the checksum is checked against the .dmg that is attested");
});

test("the attest job refuses a draft that carries anything but the installer, its checksum and the SBOM", () => {
  const attest = jobOf("attest");
  assert.match(attest, /\[ "\$NAMES" != "\$WANT" \]/);
  assert.match(attest, /Flywheel_\$\{VERSION\}_aarch64\.dmg\.sha256/);
  assert.match(attest, /state != "uploaded"/);
});

test("the attest job has no checkout, so the OIDC token never meets third-party code", () => {
  assert.doesNotMatch(jobOf("attest"), /actions\/checkout/);
});

test("the release job holds no OIDC token and no attestation right", () => {
  assert.doesNotMatch(jobOf("release"), /id-token|attestations/);
});
