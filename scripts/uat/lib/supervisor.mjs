#!/usr/bin/env node
/**
 * A minimal stand-in for the Rust supervisor, for UAT item 1 only.
 *
 * It does the two things `packages/desktop/src-tauri/src/sidecar.rs`'s `spawn_sidecar` does that
 * the watchdog can observe: it owns the sidecar process, and it touches the heartbeat file on the
 * production cadence. The heartbeat itself is written by the production function
 * (`runtime_protocol::touch_heartbeat`, via the `uat_session_env --touch-heartbeat` binary), not
 * by a reimplementation here — the point of the test is what happens when the heartbeat STOPS,
 * so the thing that stops must be the real writer.
 *
 * It is deliberately NOT a general-purpose supervisor: no health checks, no restart-on-crash, no
 * database. Those are supervision behaviours; the guarantee under test is a process-tree one.
 *
 * Protocol with the shell script that drives it: one line on stdout,
 * `READY <runId> <sidecarPid>`, once the session's run descriptor has appeared on disk (which is
 * the adapter's own signal that the watchdog wrapper is up and its process group exists). Then it
 * stays alive, ticking the heartbeat, until something kills it.
 *
 * STDIN MODES. The sidecar's stdin is how it learns its supervisor is gone: `rl.on("close")`
 * triggers `shutdownAllSessions()`, its fallback net 2. That net is real product behaviour, but it
 * MASKS the watchdog — the mechanism UAT item 1's kill record actually comes from. So this script
 * supports two shapes:
 *
 *   `piped` (default) — ordinary pipe from this process. Killing this process closes the sidecar's
 *   stdin, and the sidecar tears its own sessions down. This is what a plain `kill -9` of the
 *   supervisor looks like in production.
 *
 *   `fifo` — the sidecar's stdin is a FIFO opened O_RDWR, so the sidecar itself holds a writer and
 *   its stdin NEVER reaches EOF, even after this process dies. That isolates exactly the condition
 *   `watchdog.ts`'s own doc comment names as its reason for existing: a supervisor that has stopped
 *   heartbeating while nothing else has reached the session.
 *
 * Usage: supervisor.mjs <appDataDir> <worktreePath> <prompt> [piped|fifo] [fifoPath]
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { HEARTBEAT_TICK_MS, newRunId, resolveHarnessBinary, SIDECAR_ENTRY } from "./sidecar-harness.mjs";

const [, , appDataDir, worktreePath, prompt, stdinMode = "piped", fifoPath] = process.argv;
if (!appDataDir || !worktreePath || !prompt) {
  process.stderr.write("usage: supervisor.mjs <appDataDir> <worktreePath> <prompt> [piped|fifo] [fifoPath]\n");
  process.exit(2);
}
if (stdinMode === "fifo" && !fifoPath) {
  process.stderr.write("fifo mode requires a fifoPath argument\n");
  process.exit(2);
}

const harnessBin = resolveHarnessBinary("uat_session_env");
if (harnessBin === undefined) {
  process.stderr.write("uat_session_env is not built — run `cargo build -p core --bin uat_session_env`\n");
  process.exit(2);
}

const childEnv = { ...process.env, FLYWHEEL_APP_DATA_DIR: appDataDir };
// UAT item 1 needs a backend that outlives the 15s stale window; the real one will not sleep on
// demand (see lib/long-lived-backend.mjs for the measurement). Opt-in, so this script can still be
// pointed at the real binary by leaving FLYWHEEL_UAT_LONG_LIVED_BACKEND unset.
if (process.env.FLYWHEEL_UAT_LONG_LIVED_BACKEND === "1") {
  childEnv.FLYWHEEL_CLAUDE_BIN = path.join(path.dirname(new URL(import.meta.url).pathname), "long-lived-backend.mjs");
}
const runId = newRunId();

const envResult = spawnSync(harnessBin, [runId, "main"], { encoding: "utf8", env: childEnv });
if (envResult.status !== 0) {
  process.stderr.write(`uat_session_env failed: ${envResult.stderr}\n`);
  process.exit(2);
}
const sessionEnv = JSON.parse(envResult.stdout);
const runtimeDir = sessionEnv.FLYWHEEL_RUNTIME_DIR;

// Touch the heartbeat once BEFORE the session starts, so the watchdog never sees a cold start as
// staleness — exactly why the watchdog has its own "a full stale window since MY start" guard.
spawnSync(harnessBin, ["--touch-heartbeat"], { env: childEnv });

// O_RDWR on a FIFO both avoids the open-blocks-until-a-peer-appears dance and leaves a writer
// attached to the description the sidecar inherits — which is the whole point: its stdin cannot
// reach EOF when this process dies.
const sidecarStdin =
  stdinMode === "fifo" ? fs.openSync(fifoPath, fs.constants.O_RDWR) : "pipe";
// In fifo mode the sidecar's stdout and stderr go to FILES, not to pipes owned by this process.
// A pipe whose read end dies with this process would hand the sidecar an EPIPE on its very next
// event write, killing it — and then the watchdog, whose own stdout is a pipe to the sidecar —
// so the session would collapse through broken pipes before the heartbeat ever went stale, and
// the mechanism under test would never run. Measured: with pipes, the group emptied within a
// second of the kill and no kill record was written.
const sidecarOut =
  stdinMode === "fifo"
    ? fs.openSync(path.join(appDataDir, "sidecar-stdout.log"), "a")
    : "pipe";
const sidecarErr =
  stdinMode === "fifo"
    ? fs.openSync(path.join(appDataDir, "sidecar-stderr.log"), "a")
    : "inherit";
const sidecar = spawn(process.execPath, [SIDECAR_ENTRY], {
  stdio: [sidecarStdin, sidecarOut, sidecarErr],
  env: childEnv,
  // In fifo mode this process is modelling a supervisor that dies while the sidecar lives on, so
  // the sidecar must not be in this process's group — otherwise a group-directed signal would
  // reach it and mask the very condition under test.
  detached: stdinMode === "fifo",
});

/** Where a request is written: the inherited pipe, or our own writer on the FIFO. */
const requestSink =
  stdinMode === "fifo" ? fs.createWriteStream("", { fd: fs.openSync(fifoPath, fs.constants.O_RDWR) }) : sidecar.stdin;

const heartbeat = setInterval(() => {
  spawnSync(harnessBin, ["--touch-heartbeat"], { env: childEnv });
}, HEARTBEAT_TICK_MS);

function send(body) {
  requestSink.write(`${JSON.stringify(body)}\n`);
}

send({ id: "sup-ping", op: "ping" });
send({
  id: "sup-spawn",
  op: "spawn",
  runId,
  worktreePath,
  prompt,
  permissionMode: "bypassPermissions",
  env: sessionEnv,
});

// The run descriptor is written by `claude-code-adapter.ts` immediately after it spawns the
// watchdog wrapper, so its appearance is the earliest honest moment to say the process group
// exists and the session is genuinely live.
const descriptorPath = path.join(runtimeDir, "runs", `${runId}.json`);
const deadline = Date.now() + 60_000;
const waitForDescriptor = setInterval(() => {
  if (fs.existsSync(descriptorPath)) {
    clearInterval(waitForDescriptor);
    process.stdout.write(`READY ${runId} ${sidecar.pid}\n`);
    return;
  }
  if (Date.now() > deadline) {
    clearInterval(waitForDescriptor);
    clearInterval(heartbeat);
    process.stderr.write(`the run descriptor never appeared at ${descriptorPath}\n`);
    sidecar.kill("SIGKILL");
    process.exit(3);
  }
}, 250);

// Stay alive. Whatever kills this process is the event under test — so there is deliberately no
// graceful shutdown path here, and no SIGTERM handler that would tidy up the sessions the
// watchdog is supposed to reap on its own.
setInterval(() => {}, 1 << 30);
