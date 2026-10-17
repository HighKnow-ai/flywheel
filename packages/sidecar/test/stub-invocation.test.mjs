/**
 * G-02-1: the first test in this repository that runs the `externalBin` stub the way
 * `tauri-plugin-shell` actually runs it, rather than the way the source tree happens to lay it
 * out. Every pre-existing sidecar test drives `packages/sidecar/dist/index.js` directly, so the
 * stub's own path-resolution logic (`packages/desktop/src-tauri/binaries/
 * flywheel-sidecar-aarch64-apple-darwin`) was never executed by the suite at all — which is
 * exactly how the fixed `../../../` hop that only worked from the stub's checked-in location
 * survived 29 green tests while failing on every real launch.
 *
 * Reuses `shutdown.test.mjs`/`stop.test.mjs`'s real-child-process vocabulary: resolving paths from
 * `import.meta.url`, spawning a real process, speaking the stdin/stdout protocol over a
 * `readline` interface, `waitForCondition`, and an `after()` cleanup net — never a mock of
 * `child_process`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// packages/sidecar/test -> packages/sidecar -> packages -> repository root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
// The generated launcher: `build:dist` copies scripts/launcher.sh here. It is a build output and
// is not tracked (D-192), so a fresh clone has none until `build:dist` has run.
const STUB_PATH = path.join(
  REPO_ROOT,
  "packages",
  "desktop",
  "src-tauri",
  "binaries",
  "flywheel-sidecar-aarch64-apple-darwin",
);
const BUILD_OUTPUT_DIR = path.join(REPO_ROOT, "target");
const BUILD_COMMAND = "npm --prefix packages/sidecar run build";

const SKIP_REASON = fs.existsSync(STUB_PATH)
  ? false
  : `the generated launcher is missing at ${STUB_PATH} — run: npm --prefix packages/sidecar run build:dist`;

/** Every scratch directory a test in this file has created, removed unconditionally after every
 * test has settled — regardless of outcome, so a failing assertion never leaves state behind
 * under `target/` or the OS temp directory. */
const scratchDirs = [];

after(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Copy the tracked stub into a fresh directory and restore its executable mode explicitly —
 * `fs.copyFileSync` preserves the source file's mode on some platforms and not on others, and a
 * non-executable copy would fail this test for the wrong reason (an EACCES, not the resolution
 * logic under test). */
function copyStubInto(dir) {
  const dest = path.join(dir, "flywheel-sidecar");
  fs.copyFileSync(STUB_PATH, dest);
  fs.chmodSync(dest, 0o755);
  return dest;
}

/** A scratch directory created directly under the repository's build-output directory
 * (`target/`, creating it first if absent) — the SAME ancestor depth as the real Tauri-copied
 * binary (`target/<profile>/flywheel-sidecar`), not somewhere under `packages/`. */
function scratchUnderBuildOutput() {
  fs.mkdirSync(BUILD_OUTPUT_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(BUILD_OUTPUT_DIR, "flywheel-stub-invocation-"));
  scratchDirs.push(dir);
  return dir;
}

/** A scratch directory with no ancestor holding the `packages/sidecar/dist` marker at all — an OS
 * temporary directory, entirely outside the repository tree. */
function scratchOutsideRepository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-stub-invocation-"));
  scratchDirs.push(dir);
  return dir;
}

/** Poll `predicate` until it's true or `timeoutMs` elapses. */
async function waitForCondition(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitForCondition timed out");
}

/** Bounds an otherwise-hanging promise with a clear failure instead of stalling the suite. */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test("the stub boots the sidecar from the location tauri copies it to", { skip: SKIP_REASON }, async () => {
  const dir = scratchUnderBuildOutput();
  const copiedStub = copyStubInto(dir);

  const exitInfo = await new Promise((resolve) => {
    const child = spawn(copiedStub, [], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => resolve({ code, stderr }));
  });

  assert.equal(
    exitInfo.code,
    0,
    `expected the copied stub to boot and exit 0 with stdin closed, got exit code ${exitInfo.code}; stderr: ${exitInfo.stderr}`,
  );
});

test("the copied stub answers the readiness handshake on its own protocol", { skip: SKIP_REASON }, async () => {
  const dir = scratchUnderBuildOutput();
  const copiedStub = copyStubInto(dir);

  const child = spawn(copiedStub, [], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const acks = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    stdout += `${line}\n`;
    try {
      const parsed = JSON.parse(line);
      if (parsed.kind === "ack") acks.push(parsed);
    } catch {
      // A non-JSON stdout line is not this test's concern.
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const requestId = "stub-invocation-readiness-check";
    child.stdin.write(`${JSON.stringify({ id: requestId, op: "ping" })}\n`);

    await withTimeout(
      waitForCondition(() => acks.some((ack) => ack.id === requestId)),
      2000,
      `the copied stub never acked the readiness request in time; stdout so far: ${stdout}; stderr so far: ${stderr}`,
    );

    const ack = acks.find((a) => a.id === requestId);
    assert.equal(ack.id, requestId, "the ack must carry the exact request id that was sent");
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.on("exit", resolve));
  }
});

test("the stub run from outside the repository fails with an actionable message", { skip: SKIP_REASON }, async () => {
  const dir = scratchOutsideRepository();
  const copiedStub = copyStubInto(dir);

  const exitInfo = await new Promise((resolve) => {
    const child = spawn(copiedStub, [], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => resolve({ code, stderr }));
  });

  assert.notEqual(
    exitInfo.code,
    0,
    "a stub with no ancestor holding the packages/sidecar/dist marker must exit non-zero",
  );
  assert.ok(
    exitInfo.stderr.includes(BUILD_COMMAND),
    `expected stderr to name the build command (${BUILD_COMMAND}) so the failure is actionable; got: ${exitInfo.stderr}`,
  );
});
