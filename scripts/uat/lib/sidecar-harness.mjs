/**
 * Shared plumbing for the `scripts/uat/` harness: standing up a scratch repository, resolving a
 * real session's spawn environment, and driving the REAL sidecar over its own stdio protocol.
 *
 * Nothing here reimplements product behaviour. The sidecar is the shipped
 * `packages/sidecar/dist/index.js`, spoken to over exactly the newline-delimited JSON protocol
 * `packages/desktop/src-tauri/src/sidecar.rs` uses; the spawn environment comes from the
 * `uat_session_env` harness binary, which itself calls `flywheel_core::shim::shim_env_for_run`
 * and `flywheel_core::runtime_protocol::runtime_dir`. If the product changes, the harness follows
 * it without being edited.
 *
 * Every helper that allocates something (a temp directory, a child process, a git worktree) also
 * registers its own teardown on the returned {@link Harness}, so a script's single `finally`
 * block cleans up regardless of which assertion failed.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root — `scripts/uat/lib/` is three levels below it. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export const SIDECAR_ENTRY = path.join(REPO_ROOT, "packages", "sidecar", "dist", "index.js");

/** The developer's personal Claude Code configuration directory — the ONE value a config-isolated
 * live run must never resolve to, directly or via prefix (plan 03-20, T-03-20-05). */
export const PERSONAL_CLAUDE_CONFIG_DIR = path.join(os.homedir(), ".claude");

/**
 * Assert, at runtime and THROWING on violation, that a resolved spawn environment cannot reach
 * the developer's personal Claude Code configuration — the isolation `must_haves.truths` requires
 * "asserted by the harness rather than described in a comment" (plan 03-20).
 *
 * Two independent checks, both required:
 * 1. `CLAUDE_CONFIG_DIR` is PRESENT and non-empty. Its absence is exactly as dangerous as a bad
 *    value: `claude` silently falls back to the real `~/.claude` by default when the variable is
 *    unset at all, so a merge-order bug that drops the key would otherwise leak nothing an
 *    equality/prefix check could catch.
 * 2. No value anywhere in `env` equals or starts with {@link PERSONAL_CLAUDE_CONFIG_DIR} —
 *    defense in depth beyond the `CLAUDE_CONFIG_DIR` key alone, since a caller can merge in other
 *    env after `cleanClaudeConfigEnv()` returns.
 */
export function assertClaudeConfigIsolated(env) {
  assert.ok(
    typeof env.CLAUDE_CONFIG_DIR === "string" && env.CLAUDE_CONFIG_DIR.length > 0,
    "HARNESS FAILURE: CLAUDE_CONFIG_DIR is missing (or empty) from the resolved spawn " +
      "environment — without it, Claude Code falls back to the developer's personal " +
      `${PERSONAL_CLAUDE_CONFIG_DIR} by default, which is exactly the isolation this run requires.`,
  );
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    assert.ok(
      value !== PERSONAL_CLAUDE_CONFIG_DIR && !value.startsWith(`${PERSONAL_CLAUDE_CONFIG_DIR}${path.sep}`),
      `HARNESS FAILURE: spawn environment key "${key}" points at the developer's personal Claude ` +
        `config directory (${PERSONAL_CLAUDE_CONFIG_DIR}): ${value}`,
    );
  }
}

/** The cadence the production supervisor touches the heartbeat at, mirroring
 * `runtime_protocol::HEARTBEAT_INTERVAL_MS`. Kept as a literal for the same reason `watchdog.ts`
 * keeps its own fallback literals: this file has no dependency on the Rust crate. */
export const HEARTBEAT_TICK_MS = 2_000;

/** Crockford base32, matching `flywheel_core::ids`'s own alphabet — a run id that fails
 * `is_ulid` is rejected by the product before it reaches any interesting code path, so the
 * harness must mint ids of the real shape rather than convenient strings. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Mint a 26-character Crockford-base32 id of the shape `flywheel_core::ids::is_ulid` accepts.
 * Not a real ULID (no timestamp prefix ordering guarantee) — nothing in the harness depends on
 * ordering, only on the shape predicate the product enforces. */
export function newRunId() {
  const bytes = crypto.randomBytes(26);
  let out = "";
  for (let i = 0; i < 26; i += 1) out += CROCKFORD[bytes[i] % 32];
  return out;
}

/** Resolve the compiled harness binary, preferring a debug build and falling back to release —
 * the same two places `destructive-gate.test.mjs` looks for `flywheel-shim`. */
export function resolveHarnessBinary(name) {
  for (const profile of ["debug", "release"]) {
    const candidate = path.join(REPO_ROOT, "target", profile, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Probe whether the real backend binary is available, mirroring
 * `real-claude-argv.test.mjs::probeRealBinaryAvailable`. */
export function probeClaudeAvailable(bin = process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude") {
  const result = spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 5_000 });
  return result.error === undefined && result.status === 0;
}

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd} (status ${result.status}): ${result.stderr ?? ""}`,
    );
  }
  return result;
}

export { git };

/**
 * A harness run's owned resources and teardown stack. Deliberately LIFO: a git worktree must be
 * removed before the repository it lives in is deleted, and a child process must be killed before
 * the directory its cwd points at goes away.
 */
export class Harness {
  constructor(label) {
    this.label = label;
    this.teardowns = [];
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), `flywheel-uat-${label}-`));
    this.onCleanup(() => fs.rmSync(this.root, { recursive: true, force: true }));
    // The whole point of the FLYWHEEL_APP_DATA_DIR seam: everything this run writes — the fleet
    // database, the runtime protocol's heartbeat/kills/runs directories, the per-run PATH shim —
    // lands under `this.root` and nowhere near the developer's own Flywheel data.
    this.appDataDir = path.join(this.root, "appdata");
    fs.mkdirSync(this.appDataDir, { recursive: true });
  }

  onCleanup(fn) {
    this.teardowns.push(fn);
  }

  cleanup() {
    while (this.teardowns.length > 0) {
      const fn = this.teardowns.pop();
      try {
        fn();
      } catch (err) {
        // Teardown is best-effort by construction: a failure to remove one resource must never
        // prevent the remaining ones from being released, and must never mask the assertion
        // failure that brought us here.
        process.stderr.write(`[uat] teardown step failed (continuing): ${String(err)}\n`);
      }
    }
  }

  /**
   * Create a work repository with one commit on `defaultBranch`, plus a local bare repository
   * wired as its `origin`. A bare remote on the filesystem is a real remote as far as git is
   * concerned — `git push --delete origin <branch>` against it is the genuine article, and its
   * refs can be read directly to prove nothing moved.
   */
  createRepoWithRemote({ defaultBranch = "main", extraBranches = [] } = {}) {
    const remotePath = path.join(this.root, "remote.git");
    const workPath = path.join(this.root, "work");

    git(this.root, ["init", "--bare", "--initial-branch", defaultBranch, remotePath]);
    git(this.root, ["init", "--initial-branch", defaultBranch, workPath]);
    git(workPath, ["config", "user.email", "uat@flywheel.invalid"]);
    git(workPath, ["config", "user.name", "Flywheel UAT"]);
    fs.writeFileSync(path.join(workPath, "README.md"), `# UAT scratch repo (${this.label})\n`);
    git(workPath, ["add", "README.md"]);
    git(workPath, ["commit", "-m", "initial commit"]);
    git(workPath, ["remote", "add", "origin", remotePath]);
    git(workPath, ["push", "-u", "origin", defaultBranch]);

    for (const branch of extraBranches) {
      git(workPath, ["branch", branch]);
      git(workPath, ["push", "origin", branch]);
    }

    return { remotePath, workPath, defaultBranch };
  }

  /** Read a remote ref's SHA directly out of the bare repository, or `undefined` when absent.
   * This — not the agent's narration, and not the work repo's stale remote-tracking refs — is
   * what proves whether a branch deletion actually happened. */
  remoteRef(remotePath, branch) {
    const result = git(remotePath, ["rev-parse", "--verify", `refs/heads/${branch}`], {
      allowFailure: true,
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  }

  /**
   * Resolve a real session's spawn environment via the `uat_session_env` binary, which builds it
   * from the production functions. Throws with a build hint rather than a cryptic ENOENT when the
   * binary has not been compiled.
   */
  sessionEnv(runId, defaultBranch = "main") {
    const bin = resolveHarnessBinary("uat_session_env");
    if (bin === undefined) {
      throw new Error(
        "the uat_session_env binary was not found under target/{debug,release} — run " +
          "`cargo build -p core --bin uat_session_env` first",
      );
    }
    const result = spawnSync(bin, [runId, defaultBranch], {
      encoding: "utf8",
      env: { ...process.env, FLYWHEEL_APP_DATA_DIR: this.appDataDir },
    });
    if (result.status !== 0) {
      throw new Error(`uat_session_env failed (status ${result.status}): ${result.stderr ?? ""}`);
    }
    return JSON.parse(result.stdout);
  }

  /**
   * Resolve the `CLAUDE_CONFIG_DIR` a config-isolated live run spawns Claude Code against, and
   * ASSERT (throwing on violation, via {@link assertClaudeConfigIsolated}) that the resolved value
   * cannot reach the developer's personal Claude Code configuration.
   *
   * Honors `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR` as a DURABLE override — a directory a human has
   * already staged, outside this process, with a real login copied into it — and falls back to a
   * fresh scratch directory under `this.root` when unset. This harness NEVER copies, moves, reads
   * or writes `.credentials.json` itself; the override exists so a human can stage that file once,
   * by hand, and every run points at the directory by reference instead.
   *
   * WHY `CLAUDE_CONFIG_DIR` and not `HOME`: plan 03-19 measured that overriding `HOME` breaks
   * `claude`'s own resolution — it resolves through a `mise` shim keyed off the REAL `$HOME` and
   * fails with a config-trust error, so `HOME` isolation produced a DIFFERENT failure rather than
   * a clean room.
   *
   * MEASURED (plan 03-20 Task 2, corrects this comment's own earlier claim): `CLAUDE_CONFIG_DIR`
   * isolates Claude Code's settings, hooks, plugins and MCP server registrations — AND
   * authentication. A brand-new scratch `CLAUDE_CONFIG_DIR` reports `claude auth status` as
   * `{"loggedIn": false}`, confirmed live: `CLAUDE_CONFIG_DIR=<scratch> claude auth status` versus
   * the same command with the variable unset. This is why the override exists at all — without a
   * pre-authenticated durable directory, a config-isolated live session cannot authenticate.
   */
  cleanClaudeConfigEnv() {
    const override = process.env.FLYWHEEL_UAT_CLAUDE_CONFIG_DIR;
    const configDir = override ?? path.join(this.root, "claude-config");
    fs.mkdirSync(configDir, { recursive: true });
    const result = { CLAUDE_CONFIG_DIR: configDir };
    assertClaudeConfigIsolated(result);
    return result;
  }

  /** `FLYWHEEL_UAT_ARTIFACT_DIR` when set, otherwise a `flywheel-uat-artifacts` directory under
   * `os.tmpdir()` — created recursively. Deliberately NOT registered with `onCleanup()`: its whole
   * purpose is to outlive `cleanup()`, since a timeline artifact proving what happened during a run
   * must survive that run's own teardown or there is nothing left to inspect afterward. */
  artifactDir() {
    const dir = process.env.FLYWHEEL_UAT_ARTIFACT_DIR ?? path.join(os.tmpdir(), "flywheel-uat-artifacts");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Serialise `value` (two-space-indented JSON) to `<artifactDir()>/<label>-<timestamp>-<name>.json`
   * and return its absolute path, printed through `step()` so it appears in the script's own
   * stdout — an artifact nobody can find is as good as no artifact. */
  writeArtifact(name, value) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(this.artifactDir(), `${this.label}-${timestamp}-${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
    step(`wrote artifact: ${filePath}`);
    return filePath;
  }

  /**
   * Read back everything plan 03-20's close-provenance instrumentation wrote for `runId` under
   * `runtimeDir` — the run descriptor, the kill record, and the lifecycle JSONL timeline
   * (`packages/sidecar/src/watchdog.ts`'s own append-only file). Each is `null` — or, for
   * `lifecycle`, an empty array — when the file is absent or unparseable. Never throws: this runs
   * while diagnosing a failure, and an instrument that throws while diagnosing a failure is worse
   * than no instrument (the same discipline `resolveCloseOrigin` itself follows).
   */
  snapshotRuntimeDir(runtimeDir, runId) {
    const readJson = (filePath) => {
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        return null;
      }
    };
    const readLifecycle = (filePath) => {
      try {
        const contents = fs.readFileSync(filePath, "utf8");
        return contents
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter((line) => line !== null);
      } catch {
        return [];
      }
    };
    return {
      runDescriptor: readJson(path.join(runtimeDir, "runs", `${runId}.json`)),
      killRecord: readJson(path.join(runtimeDir, "kills", `${runId}.json`)),
      lifecycle: readLifecycle(path.join(runtimeDir, "lifecycle", `${runId}.jsonl`)),
    };
  }

  /**
   * Spawn the real sidecar and complete its readiness handshake — the same `ping` request
   * `spawn_sidecar` sends before it is allowed to return. Returns a {@link SidecarClient}.
   *
   * STALE-WINDOW HAZARD (plan 03-21, disposition `root-cause-identified`/H1 CONFIRMED): any
   * caller measuring a spawned session that outlives `watchdog.ts`'s own heartbeat-staleness
   * window (`DEFAULT_HEARTBEAT_STALE_MS` = 15000ms, or a caller-supplied
   * `FLYWHEEL_HEARTBEAT_STALE_MS` override) MUST run a heartbeat writer on the production cadence
   * (`HEARTBEAT_TICK_MS`, above — see `uat-06-permission-block-lifecycle.mjs`'s `--heartbeat=on`
   * path for the exact pattern: `uat_session_env --touch-heartbeat` touched once before spawn,
   * then on an interval) or the watchdog will correctly, and by design, SIGKILL the whole session
   * group as an unsupervised orphan (D-47/D-48, PROC-04) — this is the watchdog doing its job
   * against a caller that never touched the heartbeat file, not a product defect. Two live
   * measurements (03-20) confirmed this directly: the identical scenario terminated at ~15-16s
   * under `--heartbeat=off` with `closeOrigin: "watchdog-heartbeat-stale"`, and sustained a full
   * 90s observation window with zero termination artifacts under `--heartbeat=on`. This function
   * itself never touches the heartbeat file — that is the caller's responsibility, by design,
   * because only the caller knows how long its own measurement window needs to last.
   */
  async startSidecar({ env = {} } = {}) {
    if (!fs.existsSync(SIDECAR_ENTRY)) {
      throw new Error(
        `the sidecar bundle was not found at ${SIDECAR_ENTRY} — run \`npm --prefix packages/sidecar run build\` first`,
      );
    }
    const child = spawn(process.execPath, [SIDECAR_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FLYWHEEL_APP_DATA_DIR: this.appDataDir, ...env },
    });
    const client = new SidecarClient(child);
    this.onCleanup(() => client.dispose());
    await client.request({ op: "ping" }, 15_000);
    return client;
  }
}

/**
 * A live sidecar process, with the request/ack correlation and event fan-out its stdio protocol
 * implies. One instance drives one sidecar; a sidecar drives many runs.
 */
export class SidecarClient {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.events = [];
    this.eventWaiters = [];
    this.stderr = "";
    this.closed = false;
    this.nextId = 1;
    // D-87/G-05-1 (plan 05-18): every inbound held request `drainInboundCoreRequests` observed but
    // had no registered handler for — populated by that loop, read by `assertAllHeldRequestsAnswered`
    // and by `waitForEvent`'s own enriched timeout message below.
    this.unansweredHeldRequests = [];

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim().length > 0) this.#handleLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    child.on("close", () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`the sidecar exited before acking. stderr=${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write(`[uat] unparseable sidecar line (ignored): ${line}\n`);
      return;
    }
    if (message.kind === "ack") {
      const waiter = this.pending.get(message.id);
      if (waiter === undefined) return;
      this.pending.delete(message.id);
      if (message.ok) waiter.resolve(message.data);
      else waiter.reject(new Error(`sidecar nacked ${message.id}: ${message.error}`));
      return;
    }
    if (message.kind === "event") {
      this.events.push(message.event);
      // Diagnosing a harness that did not see the event it expected means seeing what it DID see.
      // Opt-in so a normal run stays readable.
      if (process.env.FLYWHEEL_UAT_DUMP_EVENTS === "1") {
        process.stderr.write(`[event] ${JSON.stringify(message.event)}\n`);
      }
      // G-05-1 (plan 05-18): an unrecognised sidecar event kind is logged unconditionally — NOT
      // behind the opt-in above — because silent counting of these is the same class of blindness
      // that let this plan's own gap (an unanswered board_read_request) go unnoticed for a full
      // round. `claude-code-adapter.ts`'s own normaliser falls through to this literal type for
      // every stream shape it does not recognise.
      if (message.event?.type === "unknown") {
        const raw = typeof message.event.raw === "string" ? message.event.raw : JSON.stringify(message.event.raw);
        process.stderr.write(`[uat] unrecognised sidecar event: ${(raw ?? "").slice(0, 200)}\n`);
      }
      // Snapshot and clear before notifying: a waiter's predicate may itself register another
      // waiter, and mutating the array being iterated is how that turns into a dropped event.
      const waiters = this.eventWaiters.splice(0, this.eventWaiters.length);
      for (const waiter of waiters) {
        if (waiter.predicate(message.event)) waiter.resolve(message.event);
        else this.eventWaiters.push(waiter);
      }
    }
  }

  /** Send one request and resolve with its ack's `data` (or reject on a nack/timeout). */
  request(body, timeoutMs = 30_000) {
    const id = `uat-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for an ack to ${body.op}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
    });
  }

  /** Resolve with the first event — already-received ones included — matching `predicate`. */
  waitForEvent(predicate, timeoutMs, description) {
    const existing = this.events.find(predicate);
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((w) => w.resolve !== wrappedResolve);
        // D-87/G-05-1 (plan 05-18): a wait that dies with a held inbound request outstanding
        // names it here — the likely cause of this timeout, not a coincidence alongside it. When
        // `unansweredHeldRequests` is empty this message is byte-identical to before this plan.
        const unanswered = this.unansweredHeldRequests ?? [];
        const unansweredClause =
          unanswered.length > 0
            ? ` UNANSWERED HELD INBOUND REQUESTS (likely cause of this timeout): ` +
              `${JSON.stringify(unanswered)}.`
            : "";
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for ${description}. ` +
              `events so far: ${JSON.stringify(this.events.map((e) => e.type))}.${unansweredClause}`,
          ),
        );
      }, timeoutMs);
      const wrappedResolve = (event) => {
        clearTimeout(timer);
        resolve(event);
      };
      this.eventWaiters.push({ predicate, resolve: wrappedResolve, reject });
    });
  }

  /** Assert that no event matching `predicate` arrives within `windowMs` — the shape "the session
   * stays blocked" needs, which a positive wait can never express. */
  async assertNoEvent(predicate, windowMs, description) {
    const alreadySeen = this.events.find(predicate);
    assert.equal(alreadySeen, undefined, `${description} (already seen before the window opened)`);
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const appeared = this.events.find(predicate);
    assert.equal(appeared, undefined, `${description} — saw ${JSON.stringify(appeared)}`);
  }

  eventsOfType(type) {
    return this.events.filter((event) => event.type === type);
  }

  dispose() {
    if (!this.closed) {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // Already gone — nothing to do.
      }
    }
  }
}

/**
 * D-87 (plan 05-18, G-05-1): every event kind the sidecar HOLDS OPEN until the core answers it —
 * `permission_request` (answered via `permission_answer`) and `board_read_request` (answered via
 * `authoring_read_answer`). This is the harness's own registry of the role D-87 assigns to the
 * Rust core: an entry here with no handler registered in a `drainInboundCoreRequests` call starves
 * the session it belongs to, exactly as it starved the live `uat-08` run before this plan (G-05-1).
 * `assertAllHeldRequestsAnswered`'s invariant check (plan 05-18 Task 3) compares this array's
 * length against the sidecar's own answering-op count, so a THIRD held kind added to
 * `packages/sidecar/src/index.ts` without a corresponding entry here fails a check instead of a
 * live run.
 */
export const HELD_INBOUND_REQUEST_TYPES = Object.freeze(["permission_request", "board_read_request"]);

/**
 * Build a `drainInboundCoreRequests` handler for `permission_request` events: resolves `false`
 * (declined ON PURPOSE, not a failure) when `isDeliberate(event)` is true — the caller's own
 * gated command, left alone for the script to answer itself — and otherwise sends
 * `permission_answer` with `decision: "allow"` and resolves `true`.
 */
export function createPermissionAnswerHandler(sidecar, runId, isDeliberate) {
  return async (event) => {
    if (isDeliberate(event)) return false;
    await sidecar
      .request({ op: "permission_answer", runId, requestId: event.requestId, decision: "allow" })
      .catch(() => {});
    return true;
  };
}

/**
 * The generalised drain (plan 05-18, G-05-1): plays the Rust core's own role for every HELD
 * inbound request type in {@link HELD_INBOUND_REQUEST_TYPES}, dispatching by `event.type` to
 * `handlers[event.type]`. `drainIncidentalPermissionRequests` below is now a thin preset over this
 * loop rather than a second, separately-maintained copy of it (the promote this plan makes,
 * 05-18-PLAN.md's own `assumption_delta_decision`).
 *
 * Keeps a `seen` Set keyed on `` `${type}:${requestId}` `` so an event is only ever offered to a
 * handler once, even across repeated matches of the SAME predicate (mirrors the prior
 * `drainIncidentalPermissionRequests`'s own `handled` Set, generalised to every held type). Uses
 * the identical short 5000ms per-iteration wait and swallow-and-continue-on-timeout shape the
 * prior loop used, so `shouldStop()` stays promptly re-checked rather than one dangling long wait
 * keeping the event loop alive past the point the main flow has finished.
 *
 * A matched event with NO registered handler in `handlers` is a harness gap, not a silent no-op:
 * it is pushed onto `sidecar.unansweredHeldRequests` (initialised to an empty array here if the
 * passed-in object does not already carry one, so a minimal stub sidecar works too) and one stderr
 * line is written naming the type and the request id — the starvation this whole loop exists to
 * prevent is made visible the moment it happens, not 120 seconds later as "the agent went quiet".
 */
export async function drainInboundCoreRequests(sidecar, runId, { handlers, shouldStop }) {
  if (sidecar.unansweredHeldRequests === undefined) sidecar.unansweredHeldRequests = [];
  const seen = new Set();
  while (!shouldStop()) {
    let event;
    try {
      event = await sidecar.waitForEvent(
        (e) => HELD_INBOUND_REQUEST_TYPES.includes(e.type) && !seen.has(`${e.type}:${e.requestId}`),
        5_000,
        "a held inbound core request (permission_request or board_read_request)",
      );
    } catch {
      continue;
    }
    seen.add(`${event.type}:${event.requestId}`);
    const handler = handlers[event.type];
    if (handler === undefined) {
      sidecar.unansweredHeldRequests.push({
        type: event.type,
        requestId: event.requestId,
        at: new Date().toISOString(),
      });
      process.stderr.write(
        `HARNESS FAILURE: unanswered held inbound request — type=${event.type} ` +
          `requestId=${event.requestId} has no registered handler in this drain call. The sidecar ` +
          "holds this call open until the core answers it, so this is a missing handler in the " +
          "harness, not an agent that went quiet.\n",
      );
      continue;
    }
    await handler(event);
  }
}

/**
 * Auto-allow every `permission_request` a session raises EXCEPT the one `isDeliberate` names —
 * the SAME loop `uat-03-destructive-gate.mjs` keeps as its own local copy, DELIBERATELY not
 * replaced by a call to this one: that script is a verified artifact of the previous verification
 * round, and this gap-closure run does not perturb it. Its exported signature and observable
 * behaviour are unchanged by this plan — it is now the permission-shaped PRESET of the generalised
 * `drainInboundCoreRequests` above (plan 05-18, G-05-1), rather than a second, separately-maintained
 * copy of the same held-request loop.
 *
 * See `uat-03-destructive-gate.mjs`'s own identical function for the full rationale: the real
 * `claude` binary issues its own internal session-startup git housekeeping OUTSIDE the agent's
 * visible Bash tool-call loop, which still resolves through the same PATH-shimmed directory as
 * every other invocation and therefore still reaches the shim's own destructive gate — left
 * unanswered, it would starve the session before it ever reaches the deliberate command a script
 * is actually measuring. This loop exists ONLY so a script can observe the mechanism it is
 * actually about; it changes no production classification and answers nothing a caller asserts on.
 */
export async function drainIncidentalPermissionRequests(sidecar, runId, isDeliberate, shouldStop) {
  await drainInboundCoreRequests(sidecar, runId, {
    handlers: { permission_request: createPermissionAnswerHandler(sidecar, runId, isDeliberate) },
    shouldStop,
  });
}

/**
 * The named assertion (plan 05-18 Task 3, G-05-1's `missing[]` item 3): throws when
 * `sidecar.unansweredHeldRequests` is a non-empty array, so a live run that limps to its own
 * verdict with a starved read outstanding fails NAMING the read, rather than reporting a
 * misleading per-criterion result 120 seconds later. An absent or empty array is a pass. The
 * sidecar holds a call matching {@link HELD_INBOUND_REQUEST_TYPES} open until the core answers
 * it — an entry surviving to this call means a missing handler in THIS harness, never an agent
 * that went quiet.
 */
export function assertAllHeldRequestsAnswered(sidecar) {
  const unanswered = sidecar.unansweredHeldRequests ?? [];
  assert.equal(
    unanswered.length,
    0,
    "HARNESS FAILURE: held inbound request never answered — " +
      `${JSON.stringify(unanswered)}. The sidecar holds a call of this shape open until the core ` +
      "answers it, so this is a missing handler in the harness, not an agent that went quiet.",
  );
}

/** Pretty result reporting, shared by every script so `run-all.sh` sees one consistent shape. */
export function reportPass(name) {
  process.stdout.write(`\n✅ PASS — ${name}\n`);
}

export function reportSkip(name, reason) {
  process.stdout.write(`\n⏭️  SKIP — ${name}: ${reason}\n`);
}

export function step(message) {
  process.stdout.write(`   · ${message}\n`);
}

/**
 * Run a script body with a harness, converting an assertion failure into a non-zero exit and a
 * legible message. Exit code 3 means "skipped, prerequisite missing" so `run-all.sh` can report
 * that distinctly from a real failure — a harness that cannot run is not a harness that passed.
 */
export async function runScript(label, name, body) {
  const harness = new Harness(label);
  try {
    await body(harness);
    reportPass(name);
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof SkipError) {
      reportSkip(name, err.message);
      process.exitCode = 3;
    } else {
      process.stdout.write(`\n❌ FAIL — ${name}\n\n${err?.stack ?? String(err)}\n`);
      process.exitCode = 1;
    }
  } finally {
    harness.cleanup();
  }
}

export class SkipError extends Error {}

export function skip(reason) {
  throw new SkipError(reason);
}
