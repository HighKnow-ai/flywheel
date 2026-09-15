/**
 * Task 3 (plan 03-07) — resolves RESEARCH.md's Open Question 2 by MEASUREMENT against the real
 * `claude` binary, not by assumption, and then regression-guards the shipped product wiring
 * against the same real binary. Follows `real-claude-argv.test.mjs`'s real-binary pattern:
 * skip visibly (never silently) when the binary is unavailable, and include a falsifiability
 * companion so a broken harness cannot pass vacuously.
 *
 * **The measurement (recorded here, and in `03-07-SUMMARY.md` with the binary's version string).**
 * Run live in this session against `claude 2.1.236` in headless streaming mode
 * (`--permission-mode bypassPermissions`, i.e. auto-accept) with a `--settings`-injected
 * `PreToolUse` hook on the `Bash` matcher, asking the model to run one harmless, observable
 * command (`touch` a marker file) and asserting on the marker file's existence afterward — never
 * on the transcript's own claims:
 *
 *   - No hook opinion at all (`{}`) → the marker file IS created. This is the positive control /
 *     falsifiability companion: proof this harness actually drives the real backend to execute an
 *     unblocked command, so the two "blocked" results below are not vacuously true.
 *   - `permissionDecision: "deny"` → the marker file is NOT created. The transcript's own
 *     `tool_result_meta` names `non_execution_kind: "permission-rule"`.
 *   - `permissionDecision: "ask"` → the marker file is ALSO not created. The transcript's own
 *     `tool_result_meta` names `non_execution_kind: "user-rejected"` — under `bypassPermissions`,
 *     an "ask" a human never gets to answer resolves to a rejection, not a fallthrough to
 *     execution.
 *
 * **Neither candidate ever deferred to a configured `--permission-prompt-tool`** — both settled
 * the tool call directly from the hook's own decision, without an MCP round trip. Since neither
 * value defers, this plan's own decision rule (03-07-PLAN.md Task 3) wires the semantically direct
 * value for an outright refusal: `permissionDecision: "deny"` (`src/pretooluse-hook.ts`'s
 * `WIRED_DECISION`). This makes the hook a REFUSAL layer, not a QUESTION layer, for the narrow
 * class of commands only it (not the D-51 shim) can see — a residual gap named here and in the
 * SUMMARY, never silently claimed as "always asks."
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { buildClaudeArgv, pretoolUseHookScriptPath } from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_HOOK = path.join(__dirname, "mock-decision-hook.mjs");

/** The binary this file probes and spawns for real — `FLYWHEEL_REAL_CLAUDE_BIN` if set, else the
 * plain name resolved from PATH. Mirrors `real-claude-argv.test.mjs`'s own env var exactly, so a
 * developer pointing one at a fixture points both. */
const REAL_CLAUDE_BIN = process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude";

/** Bounded wait for the one-shot availability probe below. */
const AVAILABILITY_PROBE_TIMEOUT_MS = 5_000;

/**
 * Bounded wait for each spawned real turn below. Unlike `real-claude-argv.test.mjs` (argument
 * validation only, settles in well under a second), this file drives a REAL model turn that may
 * call a tool and read its result — measured in this session at 2-11 seconds per turn. Generous
 * ceiling; a turn still running at this deadline is treated as a harness failure, not a success,
 * because (unlike the argv-validation file) this file needs to know the ACTUAL outcome to assert
 * on the marker file.
 */
const SPAWN_DEADLINE_MS = 90_000;

/**
 * Resolve once, before any test runs, whether the real binary is available at all — identical
 * shape to `real-claude-argv.test.mjs::probeRealBinaryAvailable`, duplicated rather than imported
 * since neither file exports it as a shared helper.
 */
function probeRealBinaryAvailable(bin) {
  const result = spawnSync(bin, ["--version"], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: AVAILABILITY_PROBE_TIMEOUT_MS,
  });
  return result.error === undefined && result.status === 0;
}

const AVAILABLE = probeRealBinaryAvailable(REAL_CLAUDE_BIN);

/** `undefined` when the real binary is available; otherwise a sentence naming what was looked for.
 * Passed as `{ skip: SKIP_REASON }` to every real-binary `test(...)` below so a missing binary
 * skips VISIBLY — this suite must never report 0 tests, and must never pass vacuously by silently
 * skipping without saying so (this plan's own `<verify>` gate). */
const SKIP_REASON = AVAILABLE
  ? undefined
  : `the real claude binary ("${REAL_CLAUDE_BIN}") could not be found on PATH or did not answer --version within ${AVAILABILITY_PROBE_TIMEOUT_MS}ms — set FLYWHEEL_REAL_CLAUDE_BIN to point at one, or install the claude CLI, to run these tests`;

if (SKIP_REASON) {
  console.log(`[destructive-gate.test.mjs] SKIPPED (real-binary tests): ${SKIP_REASON}`);
}

/** Resolve the compiled `flywheel-shim` binary the same two places `flywheel_core::shim::
 * resolve_shim_binary` looks (packaged-app layout is not applicable to this dev/test context, so
 * only the `cargo build` layout is probed): next to this test file's own workspace root's
 * `target/{debug,release}/`. `undefined` — never a throw — when neither exists. */
function resolveShimBinaryForTest() {
  const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
  const binName = process.platform === "win32" ? "flywheel-shim.exe" : "flywheel-shim";
  for (const profile of ["debug", "release"]) {
    const candidate = path.join(workspaceRoot, "target", profile, binName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const SHIM_BIN = resolveShimBinaryForTest();
const SHIM_SKIP_REASON = SHIM_BIN
  ? undefined
  : "the compiled flywheel-shim binary was not found under target/{debug,release} — run `cargo build --workspace` first";

if (SHIM_SKIP_REASON) {
  console.log(`[destructive-gate.test.mjs] SKIPPED (shim-binary tests): ${SHIM_SKIP_REASON}`);
}

/** Every real-process this file has spawned, by pid — signalled by process GROUP in the `after()`
 * hook whatever the outcome (RESEARCH.md Pitfall 3, mirrored from `real-claude-argv.test.mjs`). */
const trackedPids = [];

after(() => {
  for (const pid of trackedPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already exited — nothing to clean up.
    }
  }
});

/**
 * Spawn the real binary detached with `argv`, in `cwd`, with `env`, and resolve once the process
 * exits or `SPAWN_DEADLINE_MS` elapses. On a timeout, the process group is force-killed and
 * `exited: false` is returned — treated as a harness failure by every caller below, since (unlike
 * `real-claude-argv.test.mjs`) this file needs the turn to have genuinely finished before its
 * marker-file assertion means anything.
 */
function runClaudeTurn(argv, { cwd, env }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(REAL_CLAUDE_BIN, argv, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (typeof child.pid === "number") trackedPids.push(child.pid);

    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      if (typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      settle({ exited: false, code: undefined, stdout, stderr });
    }, SPAWN_DEADLINE_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      settle({ exited: true, code: null, stdout, stderr: stderr.length > 0 ? stderr : String(err) });
    });
    child.on("close", (code) => {
      settle({ exited: true, code, stdout, stderr });
    });
  });
}

/** A fresh scratch working directory. Deliberately does NOT override `ANTHROPIC_API_KEY`/
 * `ANTHROPIC_BASE_URL` the way `real-claude-argv.test.mjs` does — this file's whole point is a
 * REAL model turn that decides to call a tool, which `real-claude-argv.test.mjs`'s
 * argument-validation-only assertions never reach. Inherits the developer's own real credentials
 * (OAuth via `claude login`, the same ones this very test run's own harness authenticates with) —
 * each real-binary test below spends real API cost, same as this plan's own RESEARCH.md spikes
 * did, live, twice, at planning time. */
function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-destructive-gate-"));
}

function writeMockSettings(dir, decision) {
  const settingsPath = path.join(dir, "settings.json");
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `${process.execPath} ${MOCK_HOOK}` }],
        },
      ],
    },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  return { settingsPath, env: { ...process.env, TEST_HOOK_DECISION: decision } };
}

/**
 * Run one measurement turn: ask the real backend to `touch` a marker file, with `decision`'s mock
 * hook wired in via `--settings`, and report whether the marker exists afterward. `decision` of
 * `"none"` installs the empty-decision positive control.
 */
async function measureMarkerOutcome(decision) {
  const dir = scratchDir();
  const marker = path.join(dir, "marker.txt");
  const { settingsPath, env } = writeMockSettings(dir, decision);

  const argv = buildClaudeArgv({
    prompt: `Run exactly this shell command using the Bash tool and nothing else: touch ${marker}`,
    permissionMode: "bypassPermissions",
    settingsPath,
  });

  const outcome = await runClaudeTurn(argv, { cwd: dir, env });
  assert.ok(
    outcome.exited,
    `the real claude turn for decision=${decision} did not exit within ${SPAWN_DEADLINE_MS}ms — ` +
      `stdout=${JSON.stringify(outcome.stdout)} stderr=${JSON.stringify(outcome.stderr)}`,
  );

  return { markerExists: fs.existsSync(marker), outcome };
}

// --- classify-command mode: pure, side-effect-free, no live network call needed ---

test(
  "the shim's --classify-command mode prints a category and performs no execution",
  { skip: SHIM_SKIP_REASON },
  () => {
    const dir = scratchDir();
    const victim = path.join(dir, "victim.txt");
    fs.writeFileSync(victim, "still here");

    const result = spawnSync(SHIM_BIN, ["--classify-command", `rm -rf ${victim}`], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "recursive-delete");
    // The observable side effect: classify-command never executes anything, so the file it just
    // classified as a recursive-delete target must still be exactly where it was.
    assert.ok(fs.existsSync(victim), "classify-command mode must never execute the command it classifies");

    const safeResult = spawnSync(SHIM_BIN, ["--classify-command", "git status"], { encoding: "utf8" });
    assert.equal(safeResult.status, 0);
    assert.equal(safeResult.stdout.trim(), "safe");
  },
);

// --- the live measurement, against the real backend ---

test(
  "falsifiability companion: with no PreToolUse hook opinion, the harmless command actually executes",
  { skip: SKIP_REASON },
  async () => {
    const { markerExists, outcome } = await measureMarkerOutcome("none");
    assert.ok(
      markerExists,
      "the marker file must be created when no hook blocks it — otherwise this harness is not " +
        `genuinely exercising the real binary. stdout=${JSON.stringify(outcome.stdout)}`,
    );
  },
);

test(
  'MEASURED: a "deny" PreToolUse decision prevents the harmless command from executing',
  { skip: SKIP_REASON },
  async () => {
    const { markerExists, outcome } = await measureMarkerOutcome("deny");
    assert.ok(
      !markerExists,
      `a "deny" decision must prevent execution — the marker file must not exist. ` +
        `stdout=${JSON.stringify(outcome.stdout)}`,
    );
  },
);

test(
  'MEASURED: an "ask" PreToolUse decision also prevents the harmless command from executing',
  { skip: SKIP_REASON },
  async () => {
    const { markerExists, outcome } = await measureMarkerOutcome("ask");
    // This is the empirical finding that decides which value the shipped hook wires (see this
    // file's own module doc comment, and `src/pretooluse-hook.ts`'s `WIRED_DECISION`): under
    // `bypassPermissions`, "ask" resolves to a rejection rather than deferring to a human or
    // falling through to execution — measured, not assumed.
    assert.ok(
      !markerExists,
      `an "ask" decision was measured to also prevent execution under bypassPermissions — ` +
        `if this assertion now fails, the measurement has changed and WIRED_DECISION in ` +
        `src/pretooluse-hook.ts must be re-evaluated against this new result. ` +
        `stdout=${JSON.stringify(outcome.stdout)}`,
    );
  },
);

// --- end-to-end: the SHIPPED hook script, wired exactly as production wires it ---

test(
  "the shipped compiled hook blocks a destructive rm invoked by absolute path — the class the shim cannot see",
  { skip: SKIP_REASON ?? SHIM_SKIP_REASON },
  async () => {
    const dir = scratchDir();
    const victimDir = path.join(dir, "victim");
    fs.mkdirSync(victimDir, { recursive: true });
    fs.writeFileSync(path.join(victimDir, "canary.txt"), "still here");

    const settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }],
            },
          ],
        },
      }),
    );

    const argv = buildClaudeArgv({
      // An ABSOLUTE path to the real system `rm` — never `rm` alone — so this never resolves
      // through a PATH-shadowed shim directory at all (T-03-07-05's exact residual class): only
      // the hook, never the shim, can see this invocation.
      prompt: `Run exactly this shell command using the Bash tool and nothing else: /bin/rm -rf ${victimDir}`,
      permissionMode: "bypassPermissions",
      settingsPath,
    });
    const env = { ...process.env, FLYWHEEL_SHIM_BIN: SHIM_BIN };

    const outcome = await runClaudeTurn(argv, { cwd: dir, env });
    assert.ok(
      outcome.exited,
      `the real claude turn did not exit within ${SPAWN_DEADLINE_MS}ms — ` +
        `stdout=${JSON.stringify(outcome.stdout)} stderr=${JSON.stringify(outcome.stderr)}`,
    );
    assert.ok(
      fs.existsSync(victimDir),
      "the shipped PreToolUse hook must have blocked the absolute-path rm — the victim directory " +
        `must still exist. stdout=${JSON.stringify(outcome.stdout)}`,
    );
  },
);
