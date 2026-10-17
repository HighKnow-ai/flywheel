/**
 * Plan 11-01 tracer proof: a built `Flywheel.app`, copied to a directory that contains no
 * Flywheel source, starts its own sidecar and acks a `ping`. The copy lives under `os.tmpdir()`
 * on purpose — the launcher's source-tree fallback walks up for `packages/sidecar/dist`, so a
 * bundle left inside the repository could pass on that fallback while its packaged branch is
 * broken. Same real-child-process vocabulary as `stub-invocation.test.mjs`; no mocks.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const APP = path.join(REPO_ROOT, "target", "release", "bundle", "macos", "Flywheel.app");
const SKIP_REASON = fs.existsSync(APP)
  ? false
  : `no built bundle at ${APP} — run: npm --prefix packages/desktop run tauri build`;

const scratchDirs = [];
after(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function copyBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-packaged-sidecar-"));
  scratchDirs.push(dir);
  const copy = path.join(dir, "Flywheel.app");
  execFileSync("cp", ["-R", APP, copy]);
  return { dir, copy };
}

test("the copied bundle carries its runtime, shim and compiled sidecar", { skip: SKIP_REASON }, () => {
  const { copy } = copyBundle();
  for (const member of [
    "Contents/MacOS/flywheel-sidecar",
    "Contents/MacOS/flywheel-node",
    "Contents/MacOS/flywheel-shim",
    "Contents/Resources/sidecar/dist/index.js",
  ]) {
    assert.ok(fs.existsSync(path.join(copy, member)), `bundle is missing ${member}`);
  }
});

test("the bundle's sidecar acks a ping from outside the source tree", { skip: SKIP_REASON }, async () => {
  const { dir, copy } = copyBundle();
  const child = spawn(path.join(copy, "Contents/MacOS/flywheel-sidecar"), [], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

  const ack = new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.kind === "ack" && msg.id === "p1") resolve(msg);
      } catch {
        // Non-JSON stdout is not this test's concern.
      }
    });
    child.on("exit", (code) => reject(new Error(`sidecar exited ${code} before acking; stderr: ${stderr}`)));
    setTimeout(() => reject(new Error(`no ack within 10s; stderr: ${stderr}`)), 10_000).unref();
  });

  try {
    child.stdin.write(`${JSON.stringify({ id: "p1", op: "ping" })}\n`);
    const msg = await ack;
    assert.equal(msg.ok, true, "ping must be acked with ok: true");
  } finally {
    child.stdin.end();
    child.kill();
  }
});
