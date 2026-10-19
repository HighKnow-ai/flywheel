/**
 * Issue #81: a Gated push asks once. The permission server issues an approval when the developer
 * allows a Gated action the shim asked one for, answers `push_approval_check` from that record so
 * git's pre-push hook can skip its own prompt, and forgets it on `push_approval_revoke`.
 *
 * The last test drives the compiled `flywheel-shim` against the real server: the shim's git child
 * (a fake `git` that runs the shim's own `--check-push-approval`) sees a live approval, and the
 * approval is gone once the shim exits. It skips visibly when the shim binary has not been built.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { test } from "node:test";

import { startPermissionServer } from "../dist/mcp-permission-server.js";
import { waitForListening } from "./socket-test-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Send one line and resolve with the parsed answer line (or `undefined` when the server closes
 * without one). */
function roundTrip(socketPath, message) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => client.write(JSON.stringify(message) + "\n"));
    let answer;
    createInterface({ input: client }).once("line", (line) => {
      answer = JSON.parse(line);
    });
    client.once("error", reject);
    client.once("close", () => resolve(answer));
  });
}

/** Start a server that records every held request, and resolve it with `decide(request)`. */
async function serverAnswering(decide) {
  const requests = [];
  const handle = startPermissionServer(
    (request) => {
      requests.push(request);
      handle.resolvePermission(request.requestId, decide(request));
    },
    () => {},
  );
  await waitForListening(handle.socketPath);
  return { handle, requests };
}

const check = (socketPath, approval) => roundTrip(socketPath, { kind: "push_approval_check", approval });
const revoke = (socketPath, approval) => roundTrip(socketPath, { kind: "push_approval_revoke", approval });

function gatedRequest(requestId, issueApproval) {
  return {
    requestId,
    toolName: "Bash",
    input: { command: "git push --force origin main", destructiveCategory: "force-push" },
    ...(issueApproval ? { issueApproval: true } : {}),
  };
}

test("an allowed request that asks for an approval gets one, live until revoked, then never again", async () => {
  const { handle } = await serverAnswering(() => "allow");
  try {
    const answer = await roundTrip(handle.socketPath, gatedRequest("r1", true));
    assert.equal(answer.decision, "allow");
    assert.equal(typeof answer.approval, "string");
    assert.ok(answer.approval.length >= 32, "an approval is long enough not to be guessed");

    assert.deepEqual(await check(handle.socketPath, answer.approval), { approved: true });
    assert.deepEqual(
      await check(handle.socketPath, answer.approval),
      { approved: true },
      "a check does not spend it: one invocation may push several refs",
    );
    assert.deepEqual(await revoke(handle.socketPath, answer.approval), { revoked: true });
    assert.deepEqual(await check(handle.socketPath, answer.approval), { approved: false });
    assert.deepEqual(await revoke(handle.socketPath, answer.approval), { revoked: false });
  } finally {
    handle.close();
  }
});

test("each allowed request gets its own approval", async () => {
  const { handle } = await serverAnswering(() => "allow");
  try {
    const first = await roundTrip(handle.socketPath, gatedRequest("r1", true));
    const second = await roundTrip(handle.socketPath, gatedRequest("r2", true));
    assert.notEqual(first.approval, second.approval);
    await revoke(handle.socketPath, first.approval);
    assert.deepEqual(await check(handle.socketPath, second.approval), { approved: true });
  } finally {
    handle.close();
  }
});

test("a denied request, or one that asks for no approval, gets none", async () => {
  const { handle } = await serverAnswering((request) => (request.requestId === "denied" ? "deny" : "allow"));
  try {
    assert.deepEqual(await roundTrip(handle.socketPath, gatedRequest("denied", true)), { decision: "deny" });
    assert.deepEqual(await roundTrip(handle.socketPath, gatedRequest("plain", false)), { decision: "allow" });
  } finally {
    handle.close();
  }
});

test("a forged or missing approval is never on record", async () => {
  const { handle } = await serverAnswering(() => "allow");
  try {
    await roundTrip(handle.socketPath, gatedRequest("r1", true));
    assert.deepEqual(await check(handle.socketPath, "forged-by-the-agent"), { approved: false });
    assert.deepEqual(await check(handle.socketPath, undefined), { approved: false });
    assert.deepEqual(await check(handle.socketPath, ""), { approved: false });
  } finally {
    handle.close();
  }
});

test("an approval check is not a held request and raises no prompt", async () => {
  const { handle, requests } = await serverAnswering(() => "allow");
  try {
    await check(handle.socketPath, "anything");
    await revoke(handle.socketPath, "anything");
    assert.equal(requests.length, 0);
  } finally {
    handle.close();
  }
});

function resolveShimBinaryForTest() {
  const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
  for (const profile of ["debug", "release"]) {
    const candidate = path.join(workspaceRoot, "target", profile, "flywheel-shim");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const SHIM_BIN = resolveShimBinaryForTest();
const SHIM_SKIP_REASON = SHIM_BIN
  ? undefined
  : "the compiled flywheel-shim binary was not found under target/{debug,release} — run `cargo build --workspace` first";
if (SHIM_SKIP_REASON) console.log(`[push-approval.test.mjs] SKIPPED (shim-binary test): ${SHIM_SKIP_REASON}`);

test(
  "the compiled shim hands its git child a live approval and revokes it once git exits",
  { skip: SHIM_SKIP_REASON },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-push-approval-"));
    const verdictFile = path.join(dir, "verdict");
    // A fake `git`: asks the real server, through the shim's own hook-side mode, whether the
    // approval it inherited is live — exactly the question the pre-push hook asks.
    const fakeGit = path.join(dir, "git");
    fs.writeFileSync(
      fakeGit,
      `#!/bin/sh\nif '${SHIM_BIN}' --check-push-approval; then echo live; else echo none; fi > '${verdictFile}'\nprintf '%s' "$FLYWHEEL_PUSH_APPROVAL" > '${verdictFile}.value'\n`,
    );
    fs.chmodSync(fakeGit, 0o755);

    const { handle, requests } = await serverAnswering(() => "allow");
    try {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("FLYWHEEL_") && !key.startsWith("GIT_CONFIG")),
      );
      Object.assign(env, {
        FLYWHEEL_REAL_GIT: fakeGit,
        FLYWHEEL_PERMISSION_SOCKET: handle.socketPath,
        FLYWHEEL_STORY_BRANCH: "flywheel/s-1",
        FLYWHEEL_WORKTREE_PATH: dir,
        // An inherited value is never forwarded: the child must see the one this run was issued.
        FLYWHEEL_PUSH_APPROVAL: "inherited-from-the-agent",
      });
      const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(SHIM_BIN, ["push", "--force", "origin", "main"], { argv0: "git", cwd: dir, env });
        child.once("error", reject);
        child.once("exit", resolve);
      });
      assert.equal(exitCode, 0);

      assert.equal(requests.length, 1, "one Gated-action prompt");
      assert.equal(requests[0].issueApproval, true, "the shim asks for an approval on a gated git call");
      assert.equal(fs.readFileSync(verdictFile, "utf8").trim(), "live", "git's child saw a live approval");
      const handed = fs.readFileSync(`${verdictFile}.value`, "utf8");
      assert.notEqual(handed, "inherited-from-the-agent");
      assert.deepEqual(await check(handle.socketPath, handed), { approved: false }, "revoked once git exited");
    } finally {
      handle.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
