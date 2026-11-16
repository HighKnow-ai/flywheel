// Stages what the end-to-end run needs, from a clean clone, without the release bundle's
// downloads (no Node runtime, no release shim):
//
//   1. the sidecar's compiled JavaScript (`packages/sidecar/dist`);
//   2. placeholder `bundle.externalBin` files, because `tauri_build::build()` refuses to compile
//      the crate without them, and the debug shim `flywheel-shim` the sessions' PATH shim resolves;
//   3. the headless core, `flywheel-headless` (feature `headless`, debug profile only);
//   4. the real sidecar launcher as `target/debug/flywheel-sidecar`, next to the core, where
//      `sidecar::spawn_sidecar` looks. It runs the source tree's `dist/index.js` with `node`.
//
// The placeholders are gitignored and `npm --prefix packages/sidecar run build:dist` overwrites them
// with the real files, so a release build is unaffected.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FLYWHEEL_ROOT = path.resolve(here, "..", "..", "..");
export const DEBUG_DIR = path.join(FLYWHEEL_ROOT, "target", "debug");
export const HEADLESS_BIN = path.join(DEBUG_DIR, "flywheel-headless");
export const FAKE_CLAUDE = path.join(FLYWHEEL_ROOT, "packages", "sidecar", "test", "fake-claude.mjs");

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

export function stage() {
  const triple = /^host:\s*(\S+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
  if (!triple) throw new Error("e2e stage: no host triple in `rustc -vV`");

  // 1. The sidecar's JavaScript. `tsc` is incremental, so this is quick once built.
  const sidecar = path.join(FLYWHEEL_ROOT, "packages", "sidecar");
  if (!fs.existsSync(path.join(sidecar, "node_modules"))) run("npm", ["ci", "--no-audit", "--no-fund"], sidecar);
  run("npm", ["run", "build"], sidecar);

  // 2. Placeholders for the bundle's externalBin entries, only where none is staged.
  const tauri = path.join(FLYWHEEL_ROOT, "packages", "desktop", "src-tauri");
  fs.mkdirSync(path.join(tauri, "binaries"), { recursive: true });
  fs.mkdirSync(path.join(tauri, "resources", "sidecar"), { recursive: true });
  const placeholder = "#!/bin/sh\n# e2e placeholder; build:dist stages the real file\nexit 127\n";
  const isPlaceholder = (file) =>
    !fs.existsSync(file) || fs.readFileSync(file).subarray(0, 40).toString().includes("e2e placeholder");
  // The sidecar's entry is the real launcher, as `build:dist` stages it: the sidecar's own tests run it.
  const launcherCopy = path.join(tauri, "binaries", `flywheel-sidecar-${triple}`);
  if (isPlaceholder(launcherCopy) || fs.statSync(launcherCopy).size < 200) {
    fs.copyFileSync(path.join(sidecar, "scripts", "launcher.sh"), launcherCopy);
    fs.chmodSync(launcherCopy, 0o755);
  }
  const node = path.join(tauri, "binaries", `flywheel-node-${triple}`);
  if (!fs.existsSync(node)) fs.writeFileSync(node, placeholder, { mode: 0o755 });

  // 3. The shim first: building the crate copies `binaries/flywheel-shim-<triple>` over
  //    `target/debug/flywheel-shim`, so that file must be the real shim or sessions cannot start. A
  //    staged release shim (`build:dist`) is left alone.
  const built = execFileSync("cargo", ["build", "-p", "flywheel-shim", "--message-format=json"], {
    cwd: FLYWHEEL_ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const artifact = built
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .findLast(
      (m) => m.reason === "compiler-artifact" && m.target?.name === "flywheel-shim" && m.executable,
    )?.executable;
  if (!artifact) throw new Error("e2e stage: cargo reported no flywheel-shim executable");
  const shim = path.join(tauri, "binaries", `flywheel-shim-${triple}`);
  if (isPlaceholder(shim) || fs.statSync(shim).size < 1000) {
    fs.copyFileSync(artifact, shim);
    fs.chmodSync(shim, 0o755);
  }
  // A clobbered `target/debug/flywheel-shim` (an earlier build with a placeholder) is replaced too.
  fs.copyFileSync(shim, path.join(DEBUG_DIR, "flywheel-shim"));
  //    Then the headless core.
  run(
    "cargo",
    ["build", "-p", "flywheel-desktop", "--features", "headless", "--bin", "flywheel-headless"],
    FLYWHEEL_ROOT,
  );

  // 4. The launcher goes in last: building the crate copies the placeholder over it.
  const launcher = path.join(sidecar, "scripts", "launcher.sh");
  fs.copyFileSync(launcher, path.join(DEBUG_DIR, "flywheel-sidecar"));
  fs.chmodSync(path.join(DEBUG_DIR, "flywheel-sidecar"), 0o755);
  fs.chmodSync(FAKE_CLAUDE, 0o755);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) stage();
