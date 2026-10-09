/**
 * Phase 09 plan 09-01 (D-151): behavioural tests for the compiled `scope-hook.js`.
 *
 * Every case runs the SHIPPED compiled hook as a real process (the `authoring-stage-gate.test.mjs`
 * discipline) with identity supplied only through its environment. The hook's containment verdict
 * comes from the shim's `--scope-check`, so most cases here use a tiny scripted stand-in for the shim
 * to isolate the HOOK's own branching: what it does with each thing the shim can say, and — the
 * point of this file — what it does when something goes wrong inside itself. The other half of the
 * contract (the real Rust-written marker read by the real shim) lives in
 * `packages/core/tests/scope_marker_contract.rs`; one case below also runs the real compiled shim
 * against a marker, skipping with a named reason when the binary is not built.
 *
 * Fail-open is the measured failure mode (09-RESEARCH.md M2): a `PreToolUse` hook that exits with
 * any status other than 2 lets the tool call proceed. So the load-bearing assertions here are the
 * "crash" cases — a throw anywhere in the hook must still print a deny body and exit 2.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../dist/scope-hook.js", import.meta.url));
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SELF_DIR, "../../..");

const RUN_ID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

function scratch(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `flywheel-scope-hook-${prefix}-`));
}

/** A stand-in shim: an executable script that prints `stdout` and exits with `status`. */
function fakeShim({ stdout = "", status = 0 } = {}) {
  const dir = scratch("shim");
  const file = path.join(dir, "shim");
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s' '${stdout.replace(/'/g, "'\\''")}'\nexit ${status}\n`, { mode: 0o755 });
  return file;
}

function payload(overrides = {}) {
  return JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: "/tmp/somewhere/file.txt", content: "x" },
    ...overrides,
  });
}

/** Run the compiled hook. `env` replaces the identity vars wholesale; `nodeArgs` lets a case preload
 * a module to make the hook's own internals throw. */
function runHook({ stdin = payload(), env = {}, nodeArgs = [] } = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.FLYWHEEL_RUN_ID;
  delete cleanEnv.FLYWHEEL_RUNTIME_DIR;
  delete cleanEnv.FLYWHEEL_SHIM_BIN;
  const result = spawnSync(process.execPath, [...nodeArgs, HOOK], {
    input: stdin,
    encoding: "utf8",
    env: { ...cleanEnv, ...env },
    timeout: 20_000,
  });
  let body;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    body = undefined;
  }
  return { code: result.status, stdout: result.stdout, body };
}

function goodEnv(shim) {
  return { FLYWHEEL_RUN_ID: RUN_ID, FLYWHEEL_RUNTIME_DIR: scratch("runtime"), FLYWHEEL_SHIM_BIN: shim };
}

function assertDenied(run, label) {
  assert.equal(run.code, 2, `${label}: expected exit 2, got ${run.code} (stdout ${JSON.stringify(run.stdout)})`);
  assert.equal(run.body?.hookSpecificOutput?.permissionDecision, "deny", `${label}: expected a deny body`);
  assert.equal(run.body.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.ok(
    run.body.hookSpecificOutput.permissionDecisionReason.startsWith("FLYWHEEL-SCOPE:"),
    `${label}: the reason carries the stable prefix`,
  );
}

function assertAllowed(run, label) {
  assert.equal(run.code, 0, `${label}: expected exit 0, got ${run.code}`);
  assert.deepEqual(run.body, {}, `${label}: an allow prints no opinion`);
}

// --- what the hook does with each thing the shim can say -------------------------------------

test("an `allow` verdict from the shim prints no opinion and exits 0", () => {
  const run = runHook({ env: goodEnv(fakeShim({ stdout: '{"decision":"allow"}' })) });
  assertAllowed(run, "allow");
});

test("an `unarmed` verdict from the shim prints no opinion and exits 0", () => {
  const run = runHook({ env: goodEnv(fakeShim({ stdout: '{"decision":"unarmed"}' })) });
  assertAllowed(run, "unarmed");
});

test("a `deny` verdict becomes a deny body naming the refused path and the declared entries", () => {
  const shim = fakeShim({
    stdout: JSON.stringify({ decision: "deny", entries: ["src/a/", "src/b.rs"], relative: "src/c.rs", outsideWorktree: false }),
  });
  const run = runHook({ env: goodEnv(shim) });
  assertDenied(run, "deny");
  const reason = run.body.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /src\/c\.rs/);
  assert.match(reason, /src\/a\//);
  assert.match(reason, /src\/b\.rs/);
  assert.match(reason, /declared file-set/);
});

test("a deny for a path outside the worktree says so", () => {
  const shim = fakeShim({
    stdout: JSON.stringify({ decision: "deny", entries: ["a/"], relative: "/etc/hosts", outsideWorktree: true }),
  });
  const run = runHook({ env: goodEnv(shim) });
  assertDenied(run, "outside");
  assert.match(run.body.hookSpecificOutput.permissionDecisionReason, /outside this task's worktree/);
});

test("the refusal lists the first 20 declared entries and counts the rest", () => {
  const entries = Array.from({ length: 25 }, (_, i) => `d${String(i).padStart(2, "0")}/`);
  const shim = fakeShim({ stdout: JSON.stringify({ decision: "deny", entries, relative: "x.rs", outsideWorktree: false }) });
  const reason = runHook({ env: goodEnv(shim) }).body.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /d19\//);
  assert.doesNotMatch(reason, /d20\//);
  assert.match(reason, /and 5 more/);
});

// --- fail closed ------------------------------------------------------------------------------

test("a shim that exits non-zero denies, even when it printed an allow", () => {
  const run = runHook({ env: goodEnv(fakeShim({ stdout: '{"decision":"allow"}', status: 1 })) });
  assertDenied(run, "shim exit 1");
});

test("a shim that prints nothing, or something unparseable, denies", () => {
  assertDenied(runHook({ env: goodEnv(fakeShim({ stdout: "" })) }), "empty");
  assertDenied(runHook({ env: goodEnv(fakeShim({ stdout: "not json" })) }), "garbage");
  assertDenied(runHook({ env: goodEnv(fakeShim({ stdout: '"allow"' })) }), "a bare string");
});

test("an unrecognised or missing decision denies", () => {
  assertDenied(runHook({ env: goodEnv(fakeShim({ stdout: '{"decision":"maybe"}' })) }), "maybe");
  assertDenied(runHook({ env: goodEnv(fakeShim({ stdout: "{}" })) }), "no decision field");
  assertDenied(runHook({ env: goodEnv(fakeShim({ stdout: '{"decision":"ALLOW"}' })) }), "wrong case");
});

test("a missing shim binary denies", () => {
  assertDenied(runHook({ env: goodEnv("/no/such/flywheel-shim") }), "missing on disk");
  const env = goodEnv(undefined);
  delete env.FLYWHEEL_SHIM_BIN;
  assertDenied(runHook({ env }), "variable unset");
});

test("a shim path that is a directory denies", () => {
  assertDenied(runHook({ env: goodEnv(scratch("not-a-binary")) }), "directory");
});

test("an absent run identity or runtime directory denies", () => {
  const shim = fakeShim({ stdout: '{"decision":"allow"}' });
  const noRun = goodEnv(shim);
  delete noRun.FLYWHEEL_RUN_ID;
  assertDenied(runHook({ env: noRun }), "no FLYWHEEL_RUN_ID");
  const noDir = goodEnv(shim);
  delete noDir.FLYWHEEL_RUNTIME_DIR;
  assertDenied(runHook({ env: noDir }), "no FLYWHEEL_RUNTIME_DIR");
  assertDenied(runHook({ env: { ...goodEnv(shim), FLYWHEEL_RUN_ID: "../x" } }), "path-shaped run id");
});

test("stdin that is not JSON, or is empty, denies", () => {
  const env = goodEnv(fakeShim({ stdout: '{"decision":"allow"}' }));
  assertDenied(runHook({ stdin: "{broken", env }), "broken JSON");
  assertDenied(runHook({ stdin: "", env }), "empty stdin");
});

test("a matched tool whose input has no string target path denies", () => {
  const env = goodEnv(fakeShim({ stdout: '{"decision":"allow"}' }));
  assertDenied(runHook({ stdin: JSON.stringify({ tool_name: "Write", tool_input: { content: "x" } }), env }), "no path");
  assertDenied(runHook({ stdin: JSON.stringify({ tool_name: "Write", tool_input: { file_path: 7 } }), env }), "numeric path");
  assertDenied(runHook({ stdin: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "" } }), env }), "empty path");
  assertDenied(runHook({ stdin: JSON.stringify({ tool_name: "Write" }), env }), "no tool_input");
  assertDenied(runHook({ stdin: "null", env }), "null payload");
  assertDenied(runHook({ stdin: "[]", env }), "array payload");
});

test("the notebook tool is read from notebook_path and the others from file_path", () => {
  const env = goodEnv(fakeShim({ stdout: '{"decision":"allow"}' }));
  assertAllowed(
    runHook({ stdin: JSON.stringify({ tool_name: "NotebookEdit", tool_input: { notebook_path: "/x/a.ipynb" } }), env }),
    "notebook_path",
  );
  assertDenied(
    runHook({ stdin: JSON.stringify({ tool_name: "NotebookEdit", tool_input: { file_path: "/x/a.ipynb" } }), env }),
    "notebook with only file_path",
  );
  assertDenied(
    runHook({ stdin: JSON.stringify({ tool_name: "Edit", tool_input: { notebook_path: "/x/a.ipynb" } }), env }),
    "edit with only notebook_path",
  );
});

test("the hook passes the marker path and target to the shim and takes identity only from its environment", () => {
  const dir = scratch("argv");
  const record = path.join(dir, "argv.txt");
  const shim = path.join(dir, "shim");
  fs.writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\nprintf '{"decision":"allow"}'\n`, { mode: 0o755 });
  const env = goodEnv(shim);
  const spoof = JSON.stringify({
    tool_name: "Write",
    run_id: "01OTHEROTHEROTHEROTHEROTH0",
    tool_input: { file_path: "/x/y.txt" },
  });
  assertAllowed(runHook({ stdin: spoof, env }), "spoofed payload");
  const argv = fs.readFileSync(record, "utf8").trim().split("\n");
  assert.equal(argv[0], "--scope-check");
  assert.equal(argv[1], path.join(env.FLYWHEEL_RUNTIME_DIR, "scope", `${RUN_ID}.json`));
  assert.equal(argv[2], "/x/y.txt");
});

// --- a throw inside the hook must still deny (the M2 lesson) ----------------------------------

/** Write a preload module and return the `--import` argument that loads it. */
function preload(source) {
  const file = path.join(scratch("preload"), "preload.mjs");
  fs.writeFileSync(file, source);
  return ["--import", file];
}

test("a synchronous throw inside the hook's own body denies and exits 2", () => {
  const nodeArgs = preload(`
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    cp.spawnSync = () => { throw new Error("injected spawn failure"); };
    syncBuiltinESMExports();
  `);
  const run = runHook({ env: goodEnv(fakeShim({ stdout: '{"decision":"allow"}' })), nodeArgs });
  assertDenied(run, "throw in main");
  assert.match(run.body.hookSpecificOutput.permissionDecisionReason, /failed internally/);
});

/** Run the hook with stdin HELD OPEN, so it is still alive (waiting for the payload) when a preload
 * module fires an exception from outside `main`. Resolves with the exit code and stdout. */
function runHookWithStdinHeldOpen({ env, nodeArgs }) {
  return new Promise((resolve, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.FLYWHEEL_RUN_ID;
    delete cleanEnv.FLYWHEEL_RUNTIME_DIR;
    delete cleanEnv.FLYWHEEL_SHIM_BIN;
    const child = spawn(process.execPath, [...nodeArgs, HOOK], { env: { ...cleanEnv, ...env }, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the hook did not exit while stdin was open — it must have swallowed the exception"));
    }, 15_000);
    child.on("close", (code) => {
      clearTimeout(killer);
      let body;
      try {
        body = JSON.parse(stdout);
      } catch {
        body = undefined;
      }
      resolve({ code, stdout, body });
    });
  });
}

test("an uncaught exception outside main denies and exits 2", async () => {
  const nodeArgs = preload(`setTimeout(() => { throw new Error("injected late failure"); }, 50);`);
  const run = await runHookWithStdinHeldOpen({ env: goodEnv(fakeShim({ stdout: '{"decision":"allow"}' })), nodeArgs });
  assertDenied(run, "uncaught exception");
  assert.match(run.body.hookSpecificOutput.permissionDecisionReason, /injected late failure/);
});

test("an unhandled rejection denies and exits 2", async () => {
  const nodeArgs = preload(`setTimeout(() => { Promise.reject(new Error("injected rejection")); }, 50);`);
  const run = await runHookWithStdinHeldOpen({ env: goodEnv(fakeShim({ stdout: '{"decision":"allow"}' })), nodeArgs });
  assertDenied(run, "unhandled rejection");
  assert.match(run.body.hookSpecificOutput.permissionDecisionReason, /injected rejection/);
});

test("even when serialising the deny body fails the hook exits 2", () => {
  const nodeArgs = preload(`
    JSON.stringify = () => { throw new Error("injected stringify failure"); };
  `);
  const run = runHook({ stdin: "{broken", env: goodEnv(fakeShim({ stdout: '{"decision":"allow"}' })), nodeArgs });
  assert.equal(run.code, 2, "the exit code is what blocks the call");
});

// --- the real shim ----------------------------------------------------------------------------

function realShim() {
  const bin = process.platform === "win32" ? "flywheel-shim.exe" : "flywheel-shim";
  for (const profile of ["debug", "release"]) {
    const candidate = path.join(WORKSPACE_ROOT, "target", profile, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

test(
  "against the real compiled shim a hand-written armed marker allows inside and denies outside",
  { skip: realShim() ? false : "the compiled flywheel-shim was not found under target/{debug,release} — run `cargo build --workspace` first" },
  () => {
    const shim = realShim();
    const root = fs.realpathSync(scratch("worktree"));
    const runtimeDir = scratch("runtime");
    fs.mkdirSync(path.join(runtimeDir, "scope"), { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, "scope", `${RUN_ID}.json`),
      JSON.stringify({
        version: 1,
        mode: "armed",
        worktree_root: root,
        case_insensitive: false,
        entries: [{ form: "dir", path: "src/" }],
        written_at: "2026-01-01T00:00:00Z",
      }),
    );
    const env = { FLYWHEEL_RUN_ID: RUN_ID, FLYWHEEL_RUNTIME_DIR: runtimeDir, FLYWHEEL_SHIM_BIN: shim };
    const at = (rel) => payload({ tool_input: { file_path: path.join(root, rel), content: "x" } });

    assertAllowed(runHook({ stdin: at("src/a.rs"), env }), "inside");
    assertDenied(runHook({ stdin: at("README.md"), env }), "outside the set");
    assertDenied(runHook({ stdin: at("src_x/a.rs"), env }), "sibling prefix");
    assertDenied(runHook({ stdin: payload({ tool_input: { file_path: "/etc/hosts" } }), env }), "outside the worktree");
  },
);
