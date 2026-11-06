// tauri's beforeBundleCommand: the order is the point. It strips what Flywheel compiled
// and not what nodejs.org signed, runs the stripped shim, then checks all of it, and a refusal stops
// the bundle. Apple's tools are a stub on PATH that records its calls; the Mach-O files are fabricated
// headers, which the kernel will not execute, so running the shim is tested apart, on scripts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { assertRuns, beforeBundle, binaries } from "../before-bundle.mjs";

const TRIPLE = "aarch64-apple-darwin";

/** The smallest thing the guard reads as a Mach-O: a 64-bit header with no load commands. */
function macho() {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0);
  return b;
}

const CLEAN = "x [arm64]:\n    -platform:\n        platform     minOS      sdk\n           macOS     11.0      15.5\n";

/** A workspace holding what the hook wants, and an `xcrun` stub on PATH logging to `calls()`. */
function workspace(body, { strip = "exit 0", dyld = `cat <<'EOF'\n${CLEAN}EOF\nexit 0` } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "before-bundle-"));
  const before = process.env.PATH;
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const log = path.join(root, "calls.log");
    fs.writeFileSync(log, "");
    fs.writeFileSync(
      path.join(bin, "xcrun"),
      `#!/bin/sh\necho "$@" >>"${log}"\ncase "$1" in\n  strip) ${strip} ;;\n  dyld_info) ${dyld} ;;\nesac\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${before}`;
    const { shim, node } = binaries(root, TRIPLE);
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, macho());
    fs.writeFileSync(node, macho());
    const app = path.join(root, "target", TRIPLE, "release", "flywheel-desktop");
    fs.mkdirSync(path.dirname(app), { recursive: true });
    fs.writeFileSync(app, macho());
    return body({ root, shim, node, app, log, calls: () => fs.readFileSync(log, "utf8") });
  } finally {
    process.env.PATH = before;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const notRun = { runShim: () => {} };

test("binaries finds the app built with --target, without it, or both", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "before-bundle-"));
  try {
    assert.deepEqual(binaries(root, TRIPLE).apps, []);
    const plain = path.join(root, "target", "release", "flywheel-desktop");
    fs.mkdirSync(path.dirname(plain), { recursive: true });
    fs.writeFileSync(plain, "x");
    assert.deepEqual(binaries(root, TRIPLE).apps, [plain]);
    const targeted = path.join(root, "target", TRIPLE, "release", "flywheel-desktop");
    fs.mkdirSync(path.dirname(targeted), { recursive: true });
    fs.writeFileSync(targeted, "x");
    assert.deepEqual(binaries(root, TRIPLE).apps, [targeted, plain]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the app and the shim are stripped, nodejs.org's binary is not, and all three are checked", () => {
  workspace(({ root, app, shim, node, calls }) => {
    assert.deepEqual(beforeBundle(root, TRIPLE, notRun), []);
    const log = calls();
    assert.ok(log.includes(`strip ${app}\n`), log);
    assert.ok(log.includes(`strip ${shim}\n`), log);
    assert.ok(!log.includes(`strip ${node}`), log);
    for (const file of [app, shim, node]) assert.ok(log.includes(`dyld_info -platform ${file}\n`), log);
  });
});

test("the shim runs after its strip, and everything is checked after that", () => {
  workspace(({ root, shim, log, calls }) => {
    beforeBundle(root, TRIPLE, { runShim: (file) => fs.appendFileSync(log, `ran ${file}\n`) });
    const order = calls();
    assert.ok(order.indexOf(`strip ${shim}\n`) < order.indexOf(`ran ${shim}\n`), order);
    assert.ok(order.indexOf(`ran ${shim}\n`) < order.indexOf("dyld_info"), order);
  });
});

test("dyld_info's objection comes back as a refusal, for nodejs.org's binary as for ours", () => {
  workspace(
    ({ root, app, shim, node }) => {
      const refusals = beforeBundle(root, TRIPLE, notRun);
      assert.deepEqual(
        refusals.map((r) => r.file),
        [app, shim, node],
      );
      assert.match(refusals[0].why, /some new objection/);
    },
    { dyld: "echo 'x [arm64]:'; echo '   some new objection'; exit 1" },
  );
});

test("a failing strip stops the hook, naming the file", () => {
  workspace(
    ({ root, app }) => {
      assert.throws(
        () => beforeBundle(root, TRIPLE, notRun),
        (err) => err.message.includes(app) && /exited 3/.test(err.message),
      );
    },
    { strip: "exit 3" },
  );
});

test("nothing built, or nothing staged, is an error rather than a pass", () => {
  workspace(({ root, app, node }) => {
    fs.rmSync(node);
    assert.throws(() => beforeBundle(root, TRIPLE, notRun), /was not staged/);
    fs.rmSync(app);
    assert.throws(() => beforeBundle(root, TRIPLE, notRun), /no flywheel-desktop/);
  });
});

test("assertRuns takes any exit status and refuses a signal: arm64 macOS kills a broken signature", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "before-bundle-"));
  try {
    const refusing = path.join(dir, "refusing");
    fs.writeFileSync(refusing, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assertRuns(refusing);
    const killed = path.join(dir, "killed");
    fs.writeFileSync(killed, "#!/bin/sh\nkill -KILL $$\n", { mode: 0o755 });
    assert.throws(() => assertRuns(killed), /killed by SIGKILL after the strip/);
    assert.throws(() => assertRuns(path.join(dir, "nowhere")), /did not run/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the command line: a debug bundle is skipped, and outside tauri it is a usage error", () => {
  const script = path.resolve(import.meta.dirname, "../before-bundle.mjs");
  const debug = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, TAURI_ENV_DEBUG: "true" } });
  assert.equal(debug.status, 0, debug.stderr);
  assert.match(debug.stdout, /debug bundle/);
  const env = { ...process.env };
  delete env.TAURI_ENV_DEBUG;
  delete env.TAURI_ENV_TARGET_TRIPLE;
  assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8", env }).status, 2);
});
