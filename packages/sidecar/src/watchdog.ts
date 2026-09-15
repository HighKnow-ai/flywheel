/**
 * D-47/D-48's per-session watchdog wrapper (plan 03-02, PROC-03/PROC-04): leads the session's own
 * process group (its own parent, `claude-code-adapter.ts`, is what put it there — see that file's
 * own spawn call), spawns the backend binary as its own child inside that SAME group, and
 * force-kills the whole group the instant the shared heartbeat file goes stale — no interrupt
 * step, no grace window (D-48).
 *
 * This closes the gap nothing else in this codebase covers: every `claude` session already leads
 * its own process group precisely so `interruptSession`/`killSession` can signal exactly one
 * session's subtree, which ALSO means a SIGKILL of the sidecar itself (no `RunEvent::Exit`, no
 * `shutdown_all_sessions()`) never reaches it, and macOS has no `PDEATHSIG` to watch a live parent
 * with. Watching a FILE the Rust core touches on an interval — rather than watching a live parent
 * process handle — is the one mechanism that works identically on every OS Tauri targets
 * (03-RESEARCH.md's own "Don't Hand-Roll" table).
 *
 * Invocation: `node watchdog.js <backendBin> [...backendArgv]`. Every failure mode returns a
 * plain process exit code — this file never panics and never leaves an unsupervised backend
 * process running.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Fallback cadence values, matching `packages/core/src/runtime_protocol.rs`'s own
 * `HEARTBEAT_STALE_MS`/`HEARTBEAT_POLL_MS` constants exactly — used only when the Rust side's
 * `resolved_env_for_run` did not supply an override (e.g. a test spawning this file directly
 * without going through the real sidecar/adapter path). Kept as plain literals rather than an
 * import: this module has no dependency on the Rust crate, by design (T-03-02-06 — no shared
 * code path between the two languages' own runtime-protocol writers). */
const DEFAULT_HEARTBEAT_STALE_MS = 15_000;
const DEFAULT_HEARTBEAT_POLL_MS = 2_000;

/** The one `reason` string every staleness-triggered kill record carries — asserted by this
 * plan's own `<verify>` gate to appear exactly once in this file. */
const STALE_KILL_REASON = "heartbeat-stale";

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function heartbeatPath(runtimeDir: string): string {
  return path.join(runtimeDir, "heartbeat");
}

function killRecordPath(runtimeDir: string, runId: string): string {
  return path.join(runtimeDir, "kills", `${runId}.json`);
}

/** Read the heartbeat file's own recorded RFC3339 timestamp and return its age in milliseconds,
 * or `undefined` when the file is absent, empty, or unparseable — mirrors
 * `runtime_protocol::read_heartbeat_age`'s own "unparseable reads as no evidence of a
 * supervisor, never as fresh" contract exactly, so both sides of this protocol agree on what "no
 * heartbeat" means. */
function heartbeatAgeMs(runtimeDir: string): number | undefined {
  let contents: string;
  try {
    contents = fs.readFileSync(heartbeatPath(runtimeDir), "utf8");
  } catch {
    return undefined;
  }
  const trimmed = contents.trim();
  if (trimmed.length === 0) return undefined;
  const recordedMs = Date.parse(trimmed);
  if (Number.isNaN(recordedMs)) return undefined;
  return Date.now() - recordedMs;
}

/** Best-effort OS-sourced process start time, in epoch milliseconds, for a pid this process just
 * spawned (PROC-03: pairs with a pid everywhere in the runtime protocol so a later liveness check
 * is pid-reuse-safe, plan 03-06). Shells out to `ps -o lstart=`, available on every OS this
 * application ships to today; falls back to the current time — a real but slightly-late value,
 * still strictly more useful than no value at all — if `ps` is unavailable or its output does not
 * parse, since a start-time lookup failing must never abort spawning the backend it describes. */
function processStartTimeMs(pid: number): number {
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim();
    const parsed = Date.parse(output);
    if (!Number.isNaN(parsed)) return parsed;
  } catch {
    // Fall through to the timestamp-at-spawn-time fallback below.
  }
  return Date.now();
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function main(): void {
  const backendBin = process.argv[2];
  const backendArgv = process.argv.slice(3);
  const runtimeDir = process.env.FLYWHEEL_RUNTIME_DIR;
  const runId = process.env.FLYWHEEL_RUN_ID;

  // Fail closed (T-03-02-02): an unsupervised session is exactly what this phase exists to
  // prevent, so a misconfigured wrapper must NEVER degrade into a plain exec of the backend.
  // This check runs BEFORE the backend is ever spawned — source order IS the guarantee here.
  if (!runtimeDir) {
    process.stderr.write(
      "flywheel watchdog: FLYWHEEL_RUNTIME_DIR is not set — refusing to spawn the backend " +
        "unsupervised. This session will not start.\n",
    );
    process.exit(1);
  }
  if (!backendBin) {
    process.stderr.write("flywheel watchdog: no backend binary given (argv[2]).\n");
    process.exit(1);
  }

  const staleMs = readPositiveIntEnv("FLYWHEEL_HEARTBEAT_STALE_MS", DEFAULT_HEARTBEAT_STALE_MS);
  const pollMs = readPositiveIntEnv("FLYWHEEL_HEARTBEAT_POLL_MS", DEFAULT_HEARTBEAT_POLL_MS);
  const watchdogStartedAt = Date.now();

  // This process already leads its own process group (established by its own parent's spawn
  // options in `claude-code-adapter.ts`) — spawning the backend with a second, separate group of
  // its own would fork an UNREACHABLE second group, the exact failure 03-RESEARCH.md's Pitfall 4
  // / Pattern 2 names. `stdio: ["inherit", "pipe", "pipe"]` lets the backend inherit whatever
  // stdin this wrapper itself has, while stdout/stderr are piped so they can be forwarded
  // byte-for-byte below.
  const child = spawn(backendBin, backendArgv, { stdio: ["inherit", "pipe", "pipe"] });

  // Forward the backend's own stdout/stderr byte-for-byte, so the adapter's existing readline and
  // stderr-drain paths see EXACTLY what they saw before this wrapper existed.
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);

  // The backend can fail to spawn at all (a `FLYWHEEL_CLAUDE_BIN` pointing at a path that does
  // not exist, say) — an error only THIS process observes, since the adapter's own child is this
  // wrapper, which spawned fine. Reported as one sentinel-shaped JSON line on this wrapper's own
  // stdout, ahead of any real stream-json the backend never got to produce, so
  // `claude-code-adapter.ts` can still reject `startSession` naming the missing binary exactly as
  // it did before this wrapper existed — never silently downgraded to an ordinary failed close.
  child.on("error", (err) => {
    process.stdout.write(
      `${JSON.stringify({ __flywheelWatchdogSpawnError: true, message: err.message })}\n`,
    );
    stopPolling();
    process.exit(1);
  });

  let heartbeatTimer: NodeJS.Timeout | undefined;

  function stopPolling(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  }

  const forceKillGroup = (reason: string): void => {
    if (runId) {
      try {
        // This process IS the process-group leader (PROC-03's promoted noun) — its OWN pid is
        // the one `interruptSession`/`killSession` already target via `-session.child.pid` in
        // `claude-code-adapter.ts`, and the same pid `claude-code-adapter.ts` recorded as this
        // run's descriptor immediately after spawning it. Recomputed here (rather than read back
        // off that descriptor file) so this kill record never depends on a write that may not
        // have landed yet, or on a run started outside the adapter at all (this file's own test
        // suite spawns it directly).
        writeJsonFile(killRecordPath(runtimeDir, runId), {
          run_id: runId,
          pid: process.pid,
          start_time: processStartTimeMs(process.pid),
          reason,
          killed_at: new Date().toISOString(),
        });
      } catch (err) {
        process.stderr.write(`flywheel watchdog: failed to write kill record: ${String(err)}\n`);
      }
    }
    stopPolling();
    // D-48: the force step, on its own, with no step and no window before it — the negative pid
    // signals the whole process group this wrapper leads, reaching both itself and the backend
    // child inside it.
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      // Already gone — nothing left to signal.
    }
  };

  heartbeatTimer = setInterval(() => {
    const age = heartbeatAgeMs(runtimeDir);
    const sinceStart = Date.now() - watchdogStartedAt;
    if (age === undefined) {
      // No heartbeat evidence at all. Treat as stale only once a FULL stale window has elapsed
      // since THIS watchdog's own start, so a race at launch (heartbeat thread hasn't ticked yet)
      // never kills a freshly started session.
      if (sinceStart >= staleMs) {
        forceKillGroup(STALE_KILL_REASON);
      }
      return;
    }
    if (age >= staleMs) {
      forceKillGroup(STALE_KILL_REASON);
    }
  }, pollMs);
  heartbeatTimer.unref();

  child.on("exit", (code) => {
    stopPolling();
    process.exit(code ?? 1);
  });

  // The existing group-directed interrupt-then-terminate signals still land on this wrapper too,
  // since it now leads the group — forward each to the backend and let its own exit drive this
  // process's exit above, so the existing sequence still produces exactly one clean
  // `session_closed`. A single loop over both signal names, rather than two separate
  // registrations, so no grace-window sequence of its own can creep into this file.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
}

main();
