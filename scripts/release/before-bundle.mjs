#!/usr/bin/env node
// tauri.conf.json's beforeBundleCommand: strips what Flywheel compiled, then refuses to go on if
// dyld could refuse anything the bundle is about to carry.
//
// WHY HERE. `tauri build` compiles, runs this hook, and only then bundles; tauri-action creates the
// draft release only after `tauri build` returns. So a refusal here means no bundle, no draft and
// nothing to clean up, in release.yml and in ci.yml's `dmg` job alike, and that job fails first, on
// `next`, before a tag is spent. It is also before anything would be signed, once Apple signing
// exists: tauri signs inside the bundle step.
//
// WHY APPLE'S STRIP, AND WHY NOT RUSTC'S. Cargo.toml's `strip = false` turns rustc's off, for
// proc-macros and build scripts too (they inherit it). rustc strips with its bundled `rust-objcopy`,
// which at some versions leaves the string table misaligned at an odd indirect symbol count, and a
// proc-macro it leaves that way does not load at all. `xcrun strip` with no flag is what
// `strip = true` asked for: measured on flywheel-shim at rustc 1.99.1, 520,504 bytes against rustc's
// 520,448, and 699,072 unstripped.
//
// ONLY WHAT WE COMPILED IS STRIPPED. flywheel-node is nodejs.org's binary under nodejs.org's
// signature, which a strip would invalidate; it is checked as it stands. A strip re-signs a binary
// the linker signed ad hoc, and arm64 macOS kills a binary whose signature does not hold, so the
// shim is run once afterwards: that is the same tool's result on the same kind of file, on whichever
// Xcode this machine has. The app is not run, because it would open a window.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkPaths } from "./check-macho.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The binaries this hook works on, under the workspace `root`, for `triple`. */
export function binaries(root, triple) {
  const staged = path.join(root, "packages", "desktop", "src-tauri", "binaries");
  // BOTH PLACES, RATHER THAN A GUESS AT WHICH THIS RUN BUILT. TAURI_ENV_TARGET_TRIPLE is set with or
  // without `--target`, so the hook cannot tell `target/<triple>/release` (release.yml) from
  // `target/release` (ci.yml's dmg job, a developer's build). Stripping and checking an older one as
  // well costs nothing: the strip is idempotent, and that binary is either rebuilt or not shipped.
  const apps = [path.join(root, "target", triple, "release"), path.join(root, "target", "release")]
    .map((dir) => path.join(dir, "flywheel-desktop"))
    .filter((file) => fs.existsSync(file));
  return {
    apps,
    shim: path.join(staged, `flywheel-shim-${triple}`),
    node: path.join(staged, `flywheel-node-${triple}`),
  };
}

function appleStrip(file) {
  const r = spawnSync("xcrun", ["strip", file], { encoding: "utf8" });
  if (r.error) throw new Error(`xcrun did not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`xcrun strip ${file} exited ${r.status}: ${r.stderr.trim()}`);
}

/** Throws, naming the file, unless `file` runs. Any exit status will do; a signal will not. */
export function assertRuns(file) {
  const r = spawnSync(file, [], { encoding: "utf8" });
  if (r.error) throw new Error(`${file} did not run: ${r.error.message}`);
  if (r.signal) throw new Error(`${file} was killed by ${r.signal} after the strip: its signature does not hold`);
}

/** The hook's whole job. Returns the refusals from checkPaths; a broken precondition throws. */
export function beforeBundle(root, triple, { runShim = assertRuns } = {}) {
  const { apps, shim, node } = binaries(root, triple);
  if (apps.length === 0) throw new Error(`no flywheel-desktop under ${path.join(root, "target")}`);
  for (const file of [shim, node]) {
    if (!fs.existsSync(file)) throw new Error(`${file} was not staged: run npm --prefix packages/sidecar run build:dist`);
  }
  for (const file of [...apps, shim]) appleStrip(file);
  runShim(shim);
  return checkPaths([...apps, shim, node]).refusals;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // `tauri build --debug` is never a release, and its binaries are not where this looks.
  if (process.env.TAURI_ENV_DEBUG === "true") {
    console.log("before-bundle: a debug bundle ships nowhere, so nothing is stripped or checked");
    process.exit(0);
  }
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE;
  if (!triple) {
    console.error("before-bundle: TAURI_ENV_TARGET_TRIPLE is not set; this is tauri's beforeBundleCommand");
    process.exit(2);
  }
  let refusals;
  try {
    refusals = beforeBundle(path.resolve(here, "..", ".."), triple);
  } catch (err) {
    console.error(`before-bundle: ${err.message}`);
    process.exit(1);
  }
  for (const { file, why } of refusals) console.error(`before-bundle: ${file}: ${why}`);
  if (refusals.length > 0) {
    console.error("before-bundle: dyld could refuse this build, so it is not bundled");
    process.exit(1);
  }
  console.log("before-bundle: stripped with Apple's strip; nothing misaligned and nothing dyld_info objects to");
}
