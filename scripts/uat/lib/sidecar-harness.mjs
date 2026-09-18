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
   * Spawn the real sidecar and complete its readiness handshake — the same `ping` request
   * `spawn_sidecar` sends before it is allowed to return. Returns a {@link SidecarClient}.
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
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for ${description}. ` +
              `events so far: ${JSON.stringify(this.events.map((e) => e.type))}`,
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
