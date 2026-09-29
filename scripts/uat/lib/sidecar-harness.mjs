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
 * The prefix every precondition-failure message in this harness family opens with — distinct from
 * an assertion failure raised INSIDE a run, so an operator scanning script output can tell "this
 * run correctly refused to start" apart from "something broke mid-run" at a glance. Both
 * {@link composeIsolatedClaudeConfigDir}'s empty-link-set error and
 * {@link assertBackendAuthenticated}'s refusal messages (plan 05-33) open with this exact string.
 */
export const HARNESS_PRECONDITION_PREFIX = "HARNESS PRECONDITION FAILED:";

/**
 * The ALLOW-list of entries that may be linked, by reference, from the developer's personal Claude
 * Code configuration directory into a composed, isolated one. Anything not named here is denied BY
 * CONSTRUCTION — {@link composeIsolatedClaudeConfigDir} only ever iterates this list, so a future
 * behavioural entry never becomes linkable by omission from a separate deny-list.
 *
 * Exactly one entry today: the dot-credentials JSON file Claude Code stores the claude.ai OAuth
 * token in. Measured directly (plan 05-33's own `measured_ground_truth` item 3): a scratch
 * `CLAUDE_CONFIG_DIR` containing ONLY a symbolic link named `.credentials.json`, pointing at the
 * developer's own file, reports `claude auth status` as logged in via `claude.ai` — the credential
 * is presented, and nothing else in the directory resolves to the developer's own configuration.
 * Kept as an array, not a scalar, so a future measurement that finds a second credential entry
 * extends DATA rather than control flow.
 */
export const CREDENTIAL_LINK_ALLOWLIST = Object.freeze([".credentials.json"]);

/**
 * The entry names that constitute the developer's personal BEHAVIOURAL configuration surface — the
 * user-memory markdown file, the settings JSON and its local sibling, and the skills, agents,
 * commands, hooks, plugins and output-styles directories. None of these may ever appear inside a
 * composed, isolated configuration directory.
 *
 * This list is defense in depth BESIDE {@link CREDENTIAL_LINK_ALLOWLIST}, not instead of it: the
 * allow-list already denies every one of these entries by omission (composition only ever links
 * names on the allow-list). This list exists so a leak — a future change that composes from a full
 * copy, or plants an entry directly — becomes a NAMED failure naming the offending entry, instead
 * of a silent structural one nobody notices until a SHAPE judgement is contaminated.
 */
export const BEHAVIOURAL_CONFIG_DENYLIST = Object.freeze([
  "CLAUDE.md",
  "settings.json",
  "settings.local.json",
  "skills",
  "agents",
  "commands",
  "hooks",
  "plugins",
  "output-styles",
]);

/** True when SOMETHING exists at `candidatePath` — a regular file, a directory, or a symbolic
 * link, broken or not. Deliberately `lstatSync`, never `existsSync`/`statSync`: those FOLLOW a
 * symbolic link and report `false` for a broken one, which would let
 * {@link composeIsolatedClaudeConfigDir} attempt a second `symlinkSync` at a path that already has
 * a filesystem entry and crash with a raw `EEXIST` instead of composing idempotently. */
function fsEntryExists(candidatePath) {
  try {
    fs.lstatSync(candidatePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compose an isolated Claude Code configuration directory at `targetConfigDir` that presents the
 * developer's own credential BY REFERENCE — a symbolic link, never a copy — and contains none of
 * the developer's behavioural configuration.
 *
 * For each name in {@link CREDENTIAL_LINK_ALLOWLIST} that exists in `sourceConfigDir`, creates a
 * symbolic link of the same name inside `targetConfigDir` pointing at the source entry (skipping
 * creation, idempotently, when a filesystem entry of that name already exists at the target —
 * `cleanClaudeConfigEnv()`'s durable-override path may call this repeatedly against the same
 * directory across runs). References only: no byte of the credential is ever read into this
 * process or written anywhere by this function.
 *
 * Throws an error prefixed with {@link HARNESS_PRECONDITION_PREFIX} when zero entries were linked
 * — a composed directory presenting no credential is exactly the unreachable state gap G-05-6
 * exists to close, and it must be reported at composition time, not discovered 33 characters into
 * an agent turn that never authenticated.
 *
 * `sourceConfigDir` defaults to {@link PERSONAL_CLAUDE_CONFIG_DIR}. The parameter exists so
 * `--self-test` drives this REAL function against a synthetic source directory it built itself —
 * never against the developer's own.
 *
 * Returns `{ configDir, linkedEntries, sourceConfigDir }` — `linkedEntries` is the array of names
 * actually present (linked this call, or already linked from a prior call) at `targetConfigDir`.
 */
export function composeIsolatedClaudeConfigDir({ sourceConfigDir = PERSONAL_CLAUDE_CONFIG_DIR, targetConfigDir }) {
  fs.mkdirSync(targetConfigDir, { recursive: true });
  const linkedEntries = [];
  for (const entry of CREDENTIAL_LINK_ALLOWLIST) {
    const sourcePath = path.join(sourceConfigDir, entry);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(targetConfigDir, entry);
    if (!fsEntryExists(targetPath)) {
      fs.symlinkSync(sourcePath, targetPath);
    }
    linkedEntries.push(entry);
  }
  if (linkedEntries.length === 0) {
    throw new Error(
      `${HARNESS_PRECONDITION_PREFIX} composeIsolatedClaudeConfigDir linked zero credential entries ` +
        `from ${sourceConfigDir} — every name in CREDENTIAL_LINK_ALLOWLIST ` +
        `(${CREDENTIAL_LINK_ALLOWLIST.join(", ")}) was absent from that directory, so the composed ` +
        "directory would present no usable credential.",
    );
  }
  return { configDir: targetConfigDir, linkedEntries, sourceConfigDir };
}

/**
 * Assert, at runtime and THROWING on violation, that a resolved spawn environment cannot reach
 * the developer's personal Claude Code configuration — the isolation `must_haves.truths` requires
 * "asserted by the harness rather than described in a comment" (plan 03-20).
 *
 * Two independent checks, always run, both required:
 * 1. `CLAUDE_CONFIG_DIR` is PRESENT and non-empty. Its absence is exactly as dangerous as a bad
 *    value: `claude` silently falls back to the real `~/.claude` by default when the variable is
 *    unset at all, so a merge-order bug that drops the key would otherwise leak nothing an
 *    equality/prefix check could catch.
 * 2. No value anywhere in `env` equals or starts with {@link PERSONAL_CLAUDE_CONFIG_DIR} —
 *    defense in depth beyond the `CLAUDE_CONFIG_DIR` key alone, since a caller can merge in other
 *    env after `cleanClaudeConfigEnv()` returns.
 *
 * When the optional second argument's `configDir` is supplied (plan 05-33, Task 1), three FURTHER
 * directory-content checks run against the composed directory itself, each throwing with the
 * offending entry named:
 * 3. No entry in {@link BEHAVIOURAL_CONFIG_DENYLIST} is present in `configDir`.
 * 4. Every symbolic link present in `configDir` is named in {@link CREDENTIAL_LINK_ALLOWLIST} —
 *    nothing other than the credential may be linked through.
 * 5. Every allow-listed entry present in `configDir` IS a symbolic link, via `lstat` (never a
 *    regular file — a regular file there means the credential was duplicated, not referenced).
 *
 * Entries the backend creates for itself inside the scratch root (`projects`, `sessions`,
 * `backups`, the backend's own dot-file) are ordinary directories/files, named in neither list —
 * they pass all three content checks untouched, which is the intended behaviour (plan 05-33's own
 * `measured_ground_truth` item 5).
 */
export function assertClaudeConfigIsolated(env, { configDir } = {}) {
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

  if (configDir === undefined) return;

  let entries;
  try {
    entries = fs.readdirSync(configDir);
  } catch {
    entries = [];
  }

  for (const denied of BEHAVIOURAL_CONFIG_DENYLIST) {
    assert.ok(
      !entries.includes(denied),
      `HARNESS FAILURE: composed Claude config directory ${configDir} contains the deny-listed ` +
        `behavioural entry "${denied}" — the developer's personal configuration must never reach a ` +
        "config-isolated session under test.",
    );
  }

  for (const entry of entries) {
    const lstat = fs.lstatSync(path.join(configDir, entry));
    if (!lstat.isSymbolicLink()) continue;
    assert.ok(
      CREDENTIAL_LINK_ALLOWLIST.includes(entry),
      `HARNESS FAILURE: composed Claude config directory ${configDir} contains a symbolic link ` +
        `"${entry}" that is not in CREDENTIAL_LINK_ALLOWLIST — nothing other than the credential may ` +
        "be linked through.",
    );
  }

  for (const allowed of CREDENTIAL_LINK_ALLOWLIST) {
    if (!entries.includes(allowed)) continue;
    const lstat = fs.lstatSync(path.join(configDir, allowed));
    assert.ok(
      lstat.isSymbolicLink(),
      `HARNESS FAILURE: composed Claude config directory ${configDir} contains "${allowed}" as a ` +
        "regular file, not a symbolic link — the credential must be referenced, never duplicated.",
    );
  }
}

/**
 * The environment variables that authenticate Claude Code by API key rather than by the
 * developer's own claude.ai subscription login: the Anthropic API key variable and the Anthropic
 * auth token variable. PROJECT.md's execution-model constraint names the developer's EXISTING
 * LOCAL agent credentials as the only authorized path — an API key is a different billing and
 * identity path, not a fallback, and this project's one live run that ever reached the API
 * (validation ledger row `05-22-03`) must have taken this path with nothing recording that it had.
 */
export const API_KEY_ENV_VARS = Object.freeze(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);

/**
 * Delete every name in {@link API_KEY_ENV_VARS} from `env`, mutating it in place, and return the
 * array of names actually removed. Making the credential path deterministic — the subscription
 * login, or a refusal — is the whole point: a run that removed a variable states so via its own
 * `step()` line at the call site, because silence about it is exactly what made ledger row
 * `05-22-03` unreadable after the fact.
 */
export function scrubApiKeyEnv(env) {
  const removed = [];
  for (const name of API_KEY_ENV_VARS) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      delete env[name];
      removed.push(name);
    }
  }
  return removed;
}

/**
 * The fail-closed ALLOW-list of `authMethod` values {@link assertBackendAuthenticated} accepts —
 * exactly the method name the claude.ai subscription login reports. Same shape and same reason as
 * `PASSING_NO_WORK_READINGS` (plan 05-30, `uat-08-socratic-authoring.mjs`): an unrecognised value
 * is refused and reported VERBATIM, never waved through by a deny-list that did not happen to name
 * it.
 */
export const ACCEPTED_AUTH_METHODS = Object.freeze(new Set(["claude.ai"]));

/**
 * Build the summary this harness family carries in evidence: EXACTLY three named keys —
 * `loggedIn`, `authMethod`, `configDirectory` — constructed key by key from `raw`, never by
 * spreading `raw` and deleting fields. A real `claude auth status` payload also carries `email`,
 * `orgId` and `orgName` (plan 05-33's own `measured_ground_truth` item 1) — real developer identity
 * fields that must never be returned, logged, or written to any artifact or repository file. Built
 * key by key so an identity field a future backend version adds is dropped BY CONSTRUCTION, never
 * by a delete-list nobody remembered to update.
 */
export function summariseAuthStatus(raw) {
  return {
    loggedIn: raw?.loggedIn === true,
    authMethod: typeof raw?.authMethod === "string" ? raw.authMethod : "none",
    configDirectory: typeof raw?.configDirectory === "string" ? raw.configDirectory : undefined,
  };
}

/**
 * Run the backend binary's own `auth status` subcommand with the supplied `env`, using the same
 * `spawnSync` convention {@link probeClaudeAvailable} uses, and return the parsed JSON object.
 * Bounded by a short timeout. Returns `null` — never guesses — on a non-zero exit, on empty
 * stdout, or on unparseable stdout; the caller ({@link assertBackendAuthenticated}) decides what an
 * unreadable state means.
 *
 * This function is the ONLY place in the harness that runs the real backend for authentication
 * state, and it is injectable via {@link assertBackendAuthenticated}'s own `readAuthStatus`
 * parameter precisely so no test ever calls it — a self-test that reached this function would be
 * spending a real credential probe, which plan 05-33 exists to make provable WITHOUT.
 */
export function readClaudeAuthStatus({ env, bin = process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude" } = {}) {
  const result = spawnSync(bin, ["auth", "status"], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  const stdout = (result.stdout ?? "").trim();
  if (stdout.length === 0) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Refuse — throwing, prefixed with {@link HARNESS_PRECONDITION_PREFIX} — unless the backend can
 * authenticate as the developer against the composed, isolated `configDir`. Reads the auth status
 * via `readAuthStatus` (defaulting to {@link readClaudeAuthStatus}; every test injects its own),
 * summarises it via {@link summariseAuthStatus}, and refuses when: the read returned nothing
 * readable; the summary's `loggedIn` is not `true`; the summary's `authMethod` is not in
 * {@link ACCEPTED_AUTH_METHODS}; or the summary's `configDirectory` does not match `configDir`
 * (meaning the backend resolved a DIFFERENT directory than the one this harness asserted isolated).
 *
 * Called BEFORE the sidecar is spawned — a refusal here costs no process, no deadline and no
 * credential. Returns the summary on success, held by the caller for Task 3's evidence recording.
 */
export function assertBackendAuthenticated({ env, configDir, readAuthStatus = readClaudeAuthStatus }) {
  const raw = readAuthStatus({ env });
  if (raw === null || raw === undefined) {
    throw new Error(
      `${HARNESS_PRECONDITION_PREFIX} the backend's own auth-status read returned nothing readable ` +
        `while resolving configuration directory ${configDir} — refusing to spawn without a ` +
        "confirmed authentication state.",
    );
  }
  const summary = summariseAuthStatus(raw);
  if (summary.loggedIn !== true) {
    throw new Error(
      `${HARNESS_PRECONDITION_PREFIX} the composed configuration directory ${configDir} presented no ` +
        "usable credential (loggedIn=false) — check that CREDENTIAL_LINK_ALLOWLIST names an entry " +
        "actually present in the developer's own Claude Code configuration directory.",
    );
  }
  if (!ACCEPTED_AUTH_METHODS.has(summary.authMethod)) {
    throw new Error(
      `${HARNESS_PRECONDITION_PREFIX} the backend authenticated by method "${summary.authMethod}", ` +
        `which is not in the accepted allow-list (${[...ACCEPTED_AUTH_METHODS].join(", ")}) — refusing ` +
        "rather than assuming an unrecognised method is acceptable.",
    );
  }
  if (summary.configDirectory !== configDir) {
    throw new Error(
      `${HARNESS_PRECONDITION_PREFIX} the backend reported resolving configuration directory ` +
        `"${summary.configDirectory}", which differs from the composed directory "${configDir}" this ` +
        "harness asserted isolated — refusing rather than trusting a directory nobody asserted.",
    );
  }
  return summary;
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
 * Plan 05-37 (Task 3, gap G-05-7): the bound on how many unmodelled events one run's durable
 * capture will hold, past which no further line is appended. Exists so a pathological stream
 * cannot fill a developer's disk — and is deliberately far above anything observed: live run
 * `01M3C48C3PV1NSGHERBZ587YB1` produced twelve such events in a whole turn, three orders of
 * magnitude below this bound.
 */
export const UNMODELLED_EVENT_CAPTURE_LIMIT = 500;

/**
 * Plan 05-37 (Task 3, gap G-05-7): the bound, in bytes, on a single raw line this run's durable
 * capture will record whole, past which it is cut and the cut is recorded on that same line. Exists
 * so a pathological stream cannot fill a developer's disk with one arbitrarily large line — and is
 * deliberately far above anything observed, for the same reason {@link UNMODELLED_EVENT_CAPTURE_LIMIT}
 * is.
 */
export const UNMODELLED_EVENT_LINE_LIMIT = 65_536;

/**
 * Plan 05-37 (Task 3, gap G-05-7): create a durable, full-fidelity sink for every event
 * `SidecarClient` classifies as `unknown` — the replacement for the 200-character stderr slice that
 * left gap G-05-7's own third finding with only PREFIXES to freeze (see
 * `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json`'s own `note` field). The existing stderr
 * line stays exactly as it is; this sink is added BESIDE it, never instead of it — operators still
 * get the in-run readable signal, and the next round gets the complete record.
 *
 * `filePath` resolves under the caller-supplied `artifactDir` — which the caller MUST have already
 * resolved via `Harness.artifactDir()` (outside `this.root`, outside the repository, outside
 * `.planning/`) — and never anywhere else; this function never resolves a path of its own, by
 * construction, so it can never land the durable capture inside the repository. The captured raw
 * text can include file contents, prompt text and tool arguments, so where it lands is a deliberate
 * act with a blast radius (T-05-37-02).
 *
 * `append(raw)` is a no-op past {@link UNMODELLED_EVENT_CAPTURE_LIMIT} accepted lines — one boundary
 * line is (re)written recording the limit and the running suppressed count, never duplicated. A raw
 * string longer than {@link UNMODELLED_EVENT_LINE_LIMIT} bytes is cut to that length, with the cut
 * and the original length recorded ON the line — a recorded truncation is a fact, a silent one is
 * the defect this task exists to stop repeating. `summary()` returns `{ filePath, appended,
 * suppressed }` for a caller to report once, at teardown.
 *
 * The whole file is rewritten on every `append()` call rather than streamed — deliberately: the cap
 * is 500 lines of a few hundred bytes each, so the total cost is trivial, and a full rewrite is what
 * lets the boundary line be updated (never duplicated) without tracking a byte offset to seek back
 * to.
 */
export function createUnmodelledEventSink({ artifactDir, label }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(artifactDir, `${label}-${timestamp}-unmodelled-events.jsonl`);
  const lines = [];
  let suppressed = 0;

  const flush = () => {
    const body = lines.join("\n");
    if (suppressed > 0) {
      const boundaryLine = JSON.stringify({
        at: new Date().toISOString(),
        limitReached: true,
        limit: UNMODELLED_EVENT_CAPTURE_LIMIT,
        suppressed,
      });
      fs.writeFileSync(filePath, `${body}${body.length > 0 ? "\n" : ""}${boundaryLine}\n`);
    } else {
      fs.writeFileSync(filePath, lines.length > 0 ? `${body}\n` : "");
    }
  };

  return {
    filePath,
    append(raw) {
      if (lines.length >= UNMODELLED_EVENT_CAPTURE_LIMIT) {
        suppressed += 1;
        flush();
        return;
      }
      const text = typeof raw === "string" ? raw : String(raw ?? "");
      const byteLength = Buffer.byteLength(text, "utf8");
      const isTruncated = byteLength > UNMODELLED_EVENT_LINE_LIMIT;
      const storedRaw = isTruncated
        ? Buffer.from(text, "utf8").subarray(0, UNMODELLED_EVENT_LINE_LIMIT).toString("utf8")
        : text;
      lines.push(
        JSON.stringify({
          at: new Date().toISOString(),
          raw: storedRaw,
          ...(isTruncated ? { truncated: true, originalLength: text.length } : {}),
        }),
      );
      flush();
    },
    summary() {
      return { filePath, appended: lines.length, suppressed };
    },
  };
}

/**
 * A harness run's owned resources and teardown stack. Deliberately LIFO: a git worktree must be
 * removed before the repository it lives in is deleted, and a child process must be killed before
 * the directory its cwd points at goes away.
 */
export class Harness {
  #removeRoot;
  #preservedRootPrinted = false;

  constructor(label) {
    this.label = label;
    this.teardowns = [];
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), `flywheel-uat-${label}-`));
    // Plan 05-36 (Task 2, gap G-05-7): the root's own removal is deliberately NOT registered as an
    // ordinary teardown. It used to be registered FIRST here, and teardown is LIFO, so it ran LAST
    // on every exit — success, assertion failure and thrown exception alike — which is exactly what
    // erased the whole diagnostic surface of live run `01M3C48C3PV1NSGHERBZ587YB1`: the composed
    // configuration directory, the scratch repository, the app-data directory and the runtime
    // protocol's own lifecycle JSONL all lived under `this.root`, and none of it survived long
    // enough for anyone to read after the run failed. Held instead as a named private step the
    // class itself knows about — the root is not a peer of the other resources here, it is the
    // thing all of them live inside, and whether it is removed is now a decision `cleanup()` makes
    // explicitly, never an automatic side effect of the teardown stack.
    //
    // This does NOT fix, and was never meant to fix, the artifact directory
    // (`artifactDir()`/`writeArtifact()` below) — that directory resolves OUTSIDE `this.root` (an
    // `os.tmpdir()` sibling) and is never registered for teardown at all, by design, so it already
    // outlives every run regardless of how this run ends. The artifact from the failed live run
    // this plan closes is still on disk today for exactly that reason; Task 2's own self-test
    // checks assert that survival directly rather than leaving it as a doc-comment claim.
    this.#removeRoot = () => fs.rmSync(this.root, { recursive: true, force: true });
    // The whole point of the FLYWHEEL_APP_DATA_DIR seam: everything this run writes — the fleet
    // database, the runtime protocol's heartbeat/kills/runs directories, the per-run PATH shim —
    // lands under `this.root` and nowhere near the developer's own Flywheel data.
    this.appDataDir = path.join(this.root, "appdata");
    fs.mkdirSync(this.appDataDir, { recursive: true });
  }

  onCleanup(fn) {
    this.teardowns.push(fn);
  }

  /**
   * Plan 05-36 (Task 2, gap G-05-7): `preserveRoot` (default `false`) decides whether `this.root`
   * itself is removed once every OTHER teardown has run (LIFO, unchanged). `false` behaves exactly
   * as this method always has. `true` runs every teardown LIFO and skips ONLY the root removal,
   * then writes ONE line to stdout naming the preserved directory and stating, in the same
   * sentence, why it was kept and what it holds — never printed twice, and never printed on the
   * `false` path.
   */
  cleanup({ preserveRoot = false } = {}) {
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
    if (preserveRoot) {
      if (!this.#preservedRootPrinted) {
        this.#preservedRootPrinted = true;
        process.stdout.write(
          `[uat] preserved scratch root (run failed): ${this.root} — kept because the run failed; ` +
            "it holds the composed configuration directory, the scratch repository, the app-data " +
            "directory and the runtime lifecycle records.\n",
        );
      }
      return;
    }
    this.#removeRoot();
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
   * Resolve the `CLAUDE_CONFIG_DIR` a config-isolated live run spawns Claude Code against, compose
   * it (via {@link composeIsolatedClaudeConfigDir}) so it presents the developer's own credential
   * by reference, and ASSERT (throwing on violation, via {@link assertClaudeConfigIsolated}) both
   * that the resolved value cannot reach the developer's personal Claude Code configuration AND
   * that the composed directory's own contents carry nothing behavioural.
   *
   * Honors `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR` as a DURABLE override — a directory a human has
   * already staged, outside this process — and falls back to a fresh scratch directory under
   * `this.root` when unset. This harness NEVER copies, moves, reads or writes the contents of any
   * entry in {@link CREDENTIAL_LINK_ALLOWLIST} itself; it links by reference only. The durable
   * override gets the SAME content assertions as a fresh scratch directory: a human who staged a
   * full copy of their configuration directory (rather than letting this method compose it) fails
   * loudly, because that full copy is precisely the leak the isolation exists to prevent.
   *
   * WHY `CLAUDE_CONFIG_DIR` and not `HOME`: plan 03-19 measured that overriding `HOME` breaks
   * `claude`'s own resolution — it resolves through a `mise` shim keyed off the REAL `$HOME` and
   * fails with a config-trust error, so `HOME` isolation produced a DIFFERENT failure rather than
   * a clean room.
   *
   * CORRECTED (plan 05-33, gap G-05-6 — this paragraph previously claimed the opposite): config
   * isolation and credential availability are SEPARATE concerns, not one switch. Plan 03-20
   * measured that a brand-new, EMPTY scratch `CLAUDE_CONFIG_DIR` reports `claude auth status` as
   * logged out — but plan 05-33 measured further (its own `measured_ground_truth` item 3) that a
   * scratch directory containing ONE symbolic link named `.credentials.json`, pointing at the
   * developer's own file, reports logged in via `claude.ai` while every other entry still resolves
   * against the scratch directory. {@link composeIsolatedClaudeConfigDir} and
   * {@link CREDENTIAL_LINK_ALLOWLIST} are that mechanism: a config-isolated session can
   * authenticate as the developer with NO durable override and NO pre-staged directory required.
   *
   * Records the full composition result on `this.lastComposedClaudeConfig` (never merged into the
   * returned env map — `linkedEntries`/`sourceConfigDir` are not environment variables) so a caller
   * can report the linked-entry count without this method's own return shape changing.
   */
  cleanClaudeConfigEnv() {
    const override = process.env.FLYWHEEL_UAT_CLAUDE_CONFIG_DIR;
    const configDir = override ?? path.join(this.root, "claude-config");
    const composition = composeIsolatedClaudeConfigDir({ targetConfigDir: configDir });
    const result = { CLAUDE_CONFIG_DIR: composition.configDir };
    assertClaudeConfigIsolated(result, { configDir: composition.configDir });
    this.lastComposedClaudeConfig = composition;
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
    // Plan 05-37 (Task 3, gap G-05-7): the durable, full-fidelity capture for every unmodelled
    // event this run's SidecarClient sees, resolved through THIS harness's own artifactDir() — the
    // only permitted destination (T-05-37-02) — never a path this method resolves itself.
    const sink = createUnmodelledEventSink({ artifactDir: this.artifactDir(), label: this.label });
    const client = new SidecarClient(child, sink);
    this.onCleanup(() => client.dispose());
    this.onCleanup(() => {
      const captured = sink.summary();
      if (captured.appended > 0) {
        process.stdout.write(
          `[uat] captured ${captured.appended} unmodelled event(s) (suppressed ${captured.suppressed}) ` +
            `to ${captured.filePath}\n`,
        );
      }
    });
    await client.request({ op: "ping" }, 15_000);
    return client;
  }
}

/**
 * G-05-3 (plan 05-24): the two-word banner Anthropic's own API-level safety-classifier refusal
 * opens with when the `claude` CLI renders it in place of a model turn — read verbatim from turn 5
 * of `05-LIVE-CHALLENGE-TRANSCRIPT.md` (run `01M399FP80B184QM2RXTXJDZTK`), the run that this
 * exact, previously-uncaught mechanism killed. {@link readBackendRefusal} matches this at the very
 * START of a turn's text, never as a substring anywhere in it — see that function's own doc
 * comment for why the position anchor is load-bearing.
 */
export const BACKEND_REFUSAL_PREFIX = "API Error:";

/** The `kind` value {@link readBackendRefusal} stamps on a detected refusal — a distinct,
 * self-naming failure class (the FOURTH this phase has found: not a starved held request (05-18),
 * not a turn-capture timeout (05-20), not a `readNoWorkPlanned` misread (05-21/05-23)). */
export const BACKEND_REFUSAL_KIND = "backend_refusal";

/**
 * Read `text` — a turn's WHOLE accumulated text, from {@link accumulateTurn} — for an Anthropic
 * API-level safety-classifier refusal that the `claude` CLI rendered as though it were a model
 * turn. This is a backend-level error rendered on the SAME event shape a genuine reply uses: it
 * arrives as an ordinary `assistant_text` event and the turn still ends on a genuine `result`
 * line, so the harness cannot tell the two apart from the event stream's shape alone. The text is
 * the only signal available — reading it is not a heuristic standing in for a better check, it IS
 * the check (plan 05-24, T-05-24-01).
 *
 * Returns `null` when `text` is not a refusal — including an empty string, a whitespace-only
 * string, and ordinary prose that merely discusses an error, an API or a safeguard without ever
 * opening its own turn with the backend's own banner. Otherwise returns `{ kind, classifier,
 * requestId, text }`:
 * - `kind` is always {@link BACKEND_REFUSAL_KIND}.
 * - `classifier` is the bracketed detail code on the refusal's own "Details:" line, reported
 *   VERBATIM even when this harness has never seen that code before — never dropped, never
 *   normalised. `undefined` (never an empty string) when the line is absent.
 * - `requestId` is the token on the "Request ID:" line. `undefined` (never an empty string) when
 *   absent — neither field is required for classification, since a future refusal of this family
 *   may carry neither.
 * - `text` is the refusal verbatim, exactly as passed in.
 *
 * Anchored on {@link BACKEND_REFUSAL_PREFIX} at the very START of `text`, after trimming leading
 * whitespace — deliberately NEVER a substring match anywhere in the text. A model turn that
 * discusses an error, an API or a safeguard in its own prose does not OPEN with the backend's own
 * error banner, and this position anchor meaningfully reduces — but does not eliminate — the
 * false-positive risk a substring match anywhere in the text would carry. The residual shape is
 * concrete, not hypothetical: a genuine model turn whose own first words happen to echo the
 * banner text verbatim — for example a reply that opens by quoting a log line the agent just read
 * through a tool — is still misclassified, because nothing distinguishes it from the real banner
 * at the string level (05-REVIEW.md's WR-01, gap `G-05-4`, plan 05-28). The anchor is left this
 * loose on purpose: tightening it further (demanding the "Learn more:" or "Request ID:" markers
 * too) would trade back toward the false-negative direction this function's own comment already
 * names as the worse failure to reintroduce. A false positive here aborts a genuine, in-progress
 * run and costs the credentials it was spending — a strictly worse outcome than the false negative
 * this function exists to close (a refusal quietly read as ordinary agent text) — which is why
 * every check proving this function does NOT fire is written, and passes, before every check
 * proving that it does.
 */
export function readBackendRefusal(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed.startsWith(BACKEND_REFUSAL_PREFIX)) return null;
  const classifierMatch = trimmed.match(/Details:\s*`?\[([^\]]+)\]`?/);
  const requestIdMatch = trimmed.match(/Request ID:\s*(\S+)/);
  return {
    kind: BACKEND_REFUSAL_KIND,
    classifier: classifierMatch ? classifierMatch[1] : undefined,
    requestId: requestIdMatch ? requestIdMatch[1] : undefined,
    text,
  };
}

/**
 * G-05-6 (plan 05-34): the three signals {@link classifyNonConversationTurn} can classify a turn
 * from, named so the ledger and the evidence sheet can say WHICH signal fired — "how did we find
 * out" is exactly the fact that went missing for the six prior rounds of this defect class (plan
 * 05-24 bound its fix to one observed message's literal prefix, and the class survived behind the
 * narrower façade). Frozen so no caller can mutate the vocabulary out from under a reader matching
 * on it.
 */
export const NON_CONVERSATION_SOURCES = Object.freeze({
  /** The assistant envelope's own `is_api_error_message`/`error` fields (G-05-6), carried onto
   * `AssistantTextEvent.isApiErrorMessage`/`errorCode` by `claude-code-adapter.ts`'s normaliser. */
  ASSISTANT_ERROR_FLAG: "assistant_envelope_error_flag",
  /** The result line's own `is_error`/`terminal_reason` fields (G-05-6), carried onto
   * `ResultEvent.isError`/`terminalReason` by the same normaliser. */
  RESULT_ERROR_FLAG: "result_line_error_flag",
  /** {@link readBackendRefusal}'s own text-banner match — the ONLY signal this repository has a
   * real capture for on the safety-classifier refusal shape (05-LIVE-CHALLENGE-TRANSCRIPT.md's
   * turn 5). Retained unweakened; see {@link classifyNonConversationTurn}'s own doc comment for
   * why. */
  TEXT_BANNER: "text_banner",
});

/**
 * G-05-6 (plan 05-34, gap closure): classify a turn as non-conversation — a backend message that
 * is NOT agent speech, whatever its prose says — from categorical facts the wire itself supplies
 * about the events in the turn's own window, falling back to {@link readBackendRefusal}'s text
 * match only when no wire signal fired. This REPLACES prefix-bound text matching as the PRIMARY
 * classification mechanism. Plan 05-24 bound its own fix to `readBackendRefusal`'s one observed
 * message's literal prefix — a sample of one — and the class survived for six more rounds behind
 * that narrower façade (gap G-05-6 is the seventh instance). A categorical wire fact cannot be
 * defeated by an ordinary message shape nobody happened to capture first the way a prose match can.
 *
 * {@link readBackendRefusal} — the text-banner reader — is retained UNWEAKENED as a second,
 * independent signal, and the honest reason is a measurement gap, not a preference: this repository
 * has no raw stream-json capture of the Anthropic safety-classifier refusal shape (only its
 * rendered text, from `05-LIVE-CHALLENGE-TRANSCRIPT.md`'s turn 5) — whether that shape ALSO sets
 * the wire's own error flag is UNMEASURED. Removing the text reader would trade a measured
 * guarantee (the banner reader closes plan 05-24's own gap, proven against real captured text) for
 * an unproven assumption (that the wire flag always accompanies it). So both signals stay, wire
 * checked first purely so the reported {@link NON_CONVERSATION_SOURCES} is the most precise one
 * available when more than one could apply — either signal alone is sufficient to classify.
 *
 * Residual risk, accepted deliberately, in the same spirit as {@link readBackendRefusal}'s own
 * comment weighing false-positive against false-negative: a result line carrying the wire's error
 * flag after genuine agent prose — a turn-limit termination, for example — classifies the WHOLE
 * turn as non-conversation and stops the run. Such a run cannot be judged as a completed
 * conversation anyway, and stopping with a named cause beats waiting out the full proposal deadline
 * the way gap G-05-6's own live run did. The alternative — partitioning classification per event
 * rather than per turn — would reintroduce exactly the kind of prose-shape inference this function
 * exists to remove, in exchange for a residual risk narrower than the class it replaces.
 *
 * `subtype` is NOT a usable signal for this purpose: the real capture this plan implements against
 * (`scripts/uat/fixtures/unauthenticated-cli-first-turn.json`) carries `"subtype":"success"` on a
 * result line whose `is_error` reads `true` — classifying on `subtype` would have read this exact
 * capture as an ordinary success.
 *
 * Returns `null` for an ordinary turn (no wire flag on any event in the window, no text-banner
 * match) — including for empty and whitespace-only text, since {@link readBackendRefusal} already
 * treats those as null. Otherwise returns `{ kind, source, classifier?, requestId?, errorCode?,
 * terminalReason?, text }`: `kind` is always {@link BACKEND_REFUSAL_KIND} (no consumer needs to
 * learn a second discriminant); `source` names which of {@link NON_CONVERSATION_SOURCES} fired;
 * `classifier`/`requestId` are present only when the text-banner reader supplied them;
 * `errorCode`/`terminalReason` are present only when a wire signal supplied them — every absent
 * field reads as absent, never as an empty string.
 */
export function classifyNonConversationTurn({ text, events }) {
  const window = Array.isArray(events) ? events : [];

  for (const event of window) {
    if (event && event.type === "assistant_text" && event.isApiErrorMessage === true) {
      return {
        kind: BACKEND_REFUSAL_KIND,
        source: NON_CONVERSATION_SOURCES.ASSISTANT_ERROR_FLAG,
        ...(typeof event.errorCode === "string" && event.errorCode.length > 0 ? { errorCode: event.errorCode } : {}),
        text,
      };
    }
  }

  for (const event of window) {
    if (event && event.type === "result" && event.isError === true) {
      return {
        kind: BACKEND_REFUSAL_KIND,
        source: NON_CONVERSATION_SOURCES.RESULT_ERROR_FLAG,
        ...(typeof event.terminalReason === "string" && event.terminalReason.length > 0
          ? { terminalReason: event.terminalReason }
          : {}),
        text,
      };
    }
  }

  const banner = readBackendRefusal(text);
  if (banner) {
    return {
      kind: banner.kind,
      source: NON_CONVERSATION_SOURCES.TEXT_BANNER,
      ...(banner.classifier !== undefined ? { classifier: banner.classifier } : {}),
      ...(banner.requestId !== undefined ? { requestId: banner.requestId } : {}),
      text,
    };
  }

  return null;
}

/**
 * G-05-2 (plan 05-20): the pure accumulation half of the turn-boundary primitive — given the
 * FULL event buffer and a `[cursor, …)` window, scans forward for one run's turn and returns
 * either a terminated result (a `result` event for `runId` found within the scan) or the
 * in-progress accumulation if the buffer runs out first. Exported and pure (no timers, no
 * mutation) so `--self-test` can drive the exact shipped code path — cursor exclusion, ordering,
 * run-id exclusion, `backend_echo` exclusion, and the result-vs-unterminated distinction — with a
 * synthetic events array and no waiting at all. {@link SidecarClient.waitForTurn} is the only
 * caller that adds real-time behaviour (the idle window, the deadline) on top of this.
 *
 * Exclusions, both deliberate: an event whose `runId` does not match is never part of this run's
 * turn (one sidecar drives many runs); a `backend_echo` event is the backend restating the
 * harness's OWN turn (see `adapter.ts`'s `BackendEchoEvent` doc comment) and counting it as agent
 * speech would quote the developer to himself.
 *
 * `charCount` sums each chunk's own `.length` — NOT `text.length` after joining, which would also
 * count the blank-line separator between chunks. This is what lets a caller compare `charCount`
 * against "the fixture's own produced character total" with no separator-counting drift.
 *
 * `nonConversation` (plan 05-24's `refusal` field, RENAMED and generalised by plan 05-34/G-05-6):
 * {@link classifyNonConversationTurn} run over the accumulated text AND this turn's own event
 * window on EVERY return path — the result-terminated one and the fall-through one — so every
 * caller ({@link SidecarClient.waitForTurn}'s result path, its idle path, and the partial
 * reconstruction inside its own timeout message) inherits the same reading with no second copy of
 * the logic. `null`, never `undefined`, when the turn is not classified as non-conversation — a
 * caller testing this field with a typo'd name cannot pass by accident. The field name matters: the
 * old name (`refusal`) named one member of the class (plan 05-24's text-banner match) rather than
 * the class itself, and a name that says "refusal" invites the next narrowing the way plan 05-24's
 * own fix did.
 *
 * `pendingToolCallCount` (plan 05-25, WR-04 closure): the number of `tool_call` events in this
 * scanned window, for this run, with no subsequent `tool_result` event for the same run before the
 * window ends — a running FIFO count, incremented on each of this run's own `tool_call` events and
 * decremented on each of this run's own SUBSEQUENT `tool_result` events (floored at zero). Both
 * `ToolCallEvent` and `ToolResultEvent` (`packages/sidecar/src/adapter.ts`) carry the wire's own
 * correlation id (`toolUseId`, G-05-5) — this counter is deliberately a FIFO count rather than an
 * id-keyed one anyway, because its own job is only to answer "is anything outstanding right now",
 * which needs no identity; the id-based pairing itself lives in `correlateProposeAttempts`
 * (`scripts/uat/uat-08-socratic-authoring.mjs`). A value above zero is a FACT about the events
 * themselves — this run has issued a tool call and not yet received its answer — not a guess, and
 * is exactly what lets {@link SidecarClient.waitForTurn} tell "the model is mid-flight on a tool"
 * apart from "the model went quiet with nothing outstanding." Returned on BOTH return paths,
 * exactly like `nonConversation` above.
 *
 * `thinkingCount` (plan 05-38, gap G-05-7 second finding): the number of `thinking` events
 * (`ThinkingEvent`, plan 05-37) in this scanned window, for this run. A reasoning block is not agent
 * speech — it never touches `chunks`/`chunkCount`/`charCount`, so a transcript never quotes it back
 * to the developer as though it were the reply — but it IS the model actively working, and before
 * this counter existed a `thinking` event advanced none of `accumulateTurn`'s progress signals at
 * all: a long reasoning stretch with no text and no tool call would leave `waitForTurn`'s idle timer
 * running unperturbed from whatever it was armed at BEFORE the reasoning began, and it could fire
 * while the model was still actively reasoning. Modelling reasoning (plan 05-37) created this hazard
 * the moment it landed; `thinkingCount` closes it by giving `waitForTurn` a fourth progress signal
 * that a reasoning-only stretch genuinely advances, so it re-arms whichever window applies instead
 * of being invisible to it. Returned on BOTH return paths, exactly like `pendingToolCallCount` above.
 */
export function accumulateTurn(events, runId, cursor) {
  const chunks = [];
  const toolCalls = [];
  const turnEvents = [];
  let pendingToolCallCount = 0;
  let thinkingCount = 0;
  for (let i = cursor; i < events.length; i += 1) {
    const event = events[i];
    if (event.runId !== runId) continue;
    if (event.type === "backend_echo") continue;
    if (event.type === "assistant_text") {
      chunks.push(event.text);
      turnEvents.push(event);
    } else if (event.type === "tool_call") {
      toolCalls.push(event);
      pendingToolCallCount += 1;
      turnEvents.push(event);
    } else if (event.type === "tool_result") {
      if (pendingToolCallCount > 0) pendingToolCallCount -= 1;
      turnEvents.push(event);
    } else if (event.type === "thinking") {
      // Plan 05-38: counted as progress, NEVER as speech — no push onto `chunks`, no contribution
      // to `charCount`. See this function's own doc comment above for the hazard this closes.
      thinkingCount += 1;
      turnEvents.push(event);
    } else if (event.type === "result") {
      turnEvents.push(event);
      const text = chunks.join("\n\n");
      return {
        chunks,
        text,
        chunkCount: chunks.length,
        charCount: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
        toolCalls,
        endedBy: "result",
        endIndex: i + 1,
        nonConversation: classifyNonConversationTurn({ text, events: turnEvents }),
        pendingToolCallCount,
        thinkingCount,
      };
    }
  }
  const text = chunks.join("\n\n");
  return {
    chunks,
    text,
    chunkCount: chunks.length,
    charCount: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    toolCalls,
    endedBy: undefined,
    endIndex: events.length,
    nonConversation: classifyNonConversationTurn({ text, events: turnEvents }),
    pendingToolCallCount,
    thinkingCount,
  };
}

/**
 * Plan 05-38 (Task 1, gap G-05-7): given a turn's own {@link accumulateTurn} reading, decide which
 * window {@link SidecarClient.waitForTurn} should arm next — the PURE arming rule, exported so
 * `--self-test` can drive the exact shipped decision directly against synthetic states, with no
 * timer and no waiting at all, mirroring how {@link accumulateTurn} already lets the pure
 * accumulation half of the turn-boundary primitive be tested this way.
 *
 * Returns `{ window, ms }`:
 * - `"tool-call"` — a tool call is outstanding (`pendingToolCallCount > 0`), demonstrably
 *   mid-flight; arm at `toolCallIdleMs`. This REPLACES plan 05-25's own superseded rule, which
 *   stood the window down entirely in this state (see {@link SidecarClient.waitForTurn}'s own doc
 *   comment for the full history).
 * - `"idle"` — nothing is outstanding and at least one chunk has been captured; arm at `idleMs`,
 *   exactly as before this plan.
 * - `"none"` — neither applies (no chunk yet, nothing pending — a turn that has so far produced
 *   only reasoning, or nothing at all). No window is armed for this state; the caller's own
 *   wall-clock ceiling is the only thing that bounds it.
 */
export function decideTurnArmedWindow(partial, { idleMs, toolCallIdleMs }) {
  if (partial.pendingToolCallCount > 0) return { window: "tool-call", ms: toolCallIdleMs };
  if (partial.chunkCount > 0) return { window: "idle", ms: idleMs };
  return { window: "none", ms: undefined };
}

/**
 * Plan 05-38 (Task 1, gap G-05-7): the tool names {@link SidecarClient.waitForTurn}'s own mid-flight
 * conclusion and deadline failure both name, under the same FIFO-answering assumption
 * {@link accumulateTurn} itself uses — the most recently issued `pendingToolCallCount` of them.
 * Extracted once so both call sites read the identical list rather than two copies of the same
 * slice-and-map that could drift.
 */
function outstandingToolNames(partial) {
  return partial.pendingToolCallCount > 0
    ? partial.toolCalls.slice(partial.toolCalls.length - partial.pendingToolCallCount).map((call) => call.toolName)
    : [];
}

/** The declared idle window a turn may end on when the backend never emits a `result` line. The
 * `result` event is the PRIMARY signal — {@link SidecarClient.waitForTurn} always prefers it — this
 * window exists only so a backend that never emits one degrades into a reported observation
 * (`endedBy: "idle"`) rather than a hang. Callers measuring an edge case pass a short `idleMs`
 * explicitly rather than relying on this default, so their own test budget stays small. */
export const TURN_IDLE_MS = 5_000;

/** Plan 05-25 (WR-04 closure): the pause a REAL model may legitimately take mid-turn with no other
 * sidecar traffic in flight — a different question from the short window a test passes when it is
 * deliberately measuring the degrade path (that is exactly what {@link TURN_IDLE_MS}'s own doc
 * comment already tells such a caller to do). Thirty seconds. Must stay comfortably BELOW the live
 * arm's own per-turn deadline (`TURN_DEADLINE_MS`, `scripts/uat/uat-08-socratic-authoring.mjs`) — a
 * window as long as or longer than the deadline would silently delete the idle-degrade behaviour
 * plan 05-20 built, since the deadline would always fire first. Deliberately NOT a change to
 * {@link TURN_IDLE_MS} itself — the offline arms and the self-test's own timing checks depend on
 * that short default, and retuning a shared default to suit one caller is how a value ends up
 * meaning two different things to two different callers. The live arm passes this EXPLICITLY at
 * each of its own `waitForTurn`/`driveChallengeConversation` call sites rather than inheriting a
 * default tuned for tests. */
export const LIVE_TURN_IDLE_MS = 30_000;

/**
 * Plan 05-38 (Task 1, gap G-05-7 second finding): the window a turn may go completely SILENT for
 * WHILE a tool call is outstanding, before the turn is concluded as having stalled mid-flight — the
 * replacement for plan 05-25's own superseded stand-down, which left the wall-clock deadline
 * (`TURN_DEADLINE_MS`/`LIVE_TURN_CEILING_MS`, `scripts/uat/uat-08-socratic-authoring.mjs`) as the
 * ONLY backstop in this state. Live run `01M3C48C3PV1NSGHERBZ587YB1`'s turn 1 spent essentially its
 * whole life in exactly that state — roughly sixty tool-call/tool-result pairs, several board-read
 * round trips, repeated permission drains, unbroken activity to the 120000ms deadline — and the
 * separate idle guard never got a chance to fire because it was never armed.
 *
 * 120000ms, and it is DERIVED, not guessed: all roughly 130 events of that turn fit inside 120000ms,
 * so no single gap in that turn reached this value. A window set at the one measurement this
 * repository has is therefore generous enough to never have fired on the turn that motivated it,
 * while still being a genuine, finite bound rather than the absence of one. Callers measuring an
 * edge case pass a short, explicit `toolCallIdleMs` instead of relying on this default, exactly as
 * {@link TURN_IDLE_MS}'s own doc comment already tells such a caller to do for the ordinary window.
 */
export const LIVE_TOOL_CALL_IDLE_MS = 120_000;

/** `DRAIN_POLL_MS` (IN-02, 05-REVIEW.md): the per-iteration wait `drainInboundCoreRequests` uses
 * while polling for the next held inbound request — a poll interval, never a deadline, so a
 * caller or a self-test reasoning about the same value has {@link DRAIN_POLL_MS} to reason about
 * rather than a bare literal a future edit could silently retune. */
export const DRAIN_POLL_MS = 5_000;

/**
 * Plan 05-36 (gap G-05-7): thrown by {@link SidecarClient.waitForTurn}'s `fail()` closure when a
 * turn's wall-clock deadline (`timeoutMs`) elapses before the backend's own end-of-turn signal
 * arrives. Carries the SAME structured object `fail()` already computed — `partial` (the exact
 * `accumulateTurn` result), `label`, `timeoutMs`, `unanswered` (the held inbound requests array)
 * and `pendingToolCalls` (the tool-name array the message text already lists) — as OWN properties
 * on the error, not only inside a stringified message. A partial capture that exists only inside a
 * message string is a partial capture that cannot be written to an evidence sheet, which is
 * exactly what destroyed live run `01M3C48C3PV1NSGHERBZ587YB1`: it captured 539 characters of real
 * agent speech across 2 chunks, and every downstream evidence write sat behind the throw this
 * class now carries data through instead of just prose.
 *
 * The message string itself is UNCHANGED, character for character, from what a bare `Error` used
 * to carry — existing assertions on that text (and the committed failure log) depend on it.
 */
export class TurnDeadlineError extends Error {
  constructor(message, { partial, label, timeoutMs, unanswered, pendingToolCalls } = {}) {
    super(message);
    this.name = "TurnDeadlineError";
    this.partial = partial;
    this.label = label;
    this.timeoutMs = timeoutMs;
    this.unanswered = unanswered;
    this.pendingToolCalls = pendingToolCalls;
  }
}

/**
 * A live sidecar process, with the request/ack correlation and event fan-out its stdio protocol
 * implies. One instance drives one sidecar; a sidecar drives many runs.
 *
 * `sink` (plan 05-37, Task 3, gap G-05-7): an OPTIONAL {@link createUnmodelledEventSink} instance —
 * when supplied, every event this client classifies as `unknown` is ALSO appended there, beside the
 * existing stderr line, never instead of it. A client constructed with no sink (every call site in
 * this repository other than `Harness.startSidecar`, including every test that constructs a bare
 * `SidecarClient` directly) behaves exactly as it did before this field existed.
 */
export class SidecarClient {
  constructor(child, sink) {
    this.child = child;
    this.sink = sink;
    this.pending = new Map();
    this.events = [];
    this.eventWaiters = [];
    // G-05-2 (plan 05-20): functions notified on EVERY event push (any type), each an active
    // `waitForTurn` scan re-checking its own window — never a second, separately-maintained copy
    // of the accumulation logic, just a "something changed, look again" nudge.
    this.turnWatchers = [];
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
      // G-05-2 (plan 05-20): notify every active waitForTurn scan that a new event landed, so it
      // re-checks its own window (extends its idle timer, or detects a result marker) without
      // polling. Every event type reaches this — accumulateTurn itself decides what's relevant.
      if (this.turnWatchers.length > 0) {
        for (const watcher of [...this.turnWatchers]) watcher();
      }
      // Diagnosing a harness that did not see the event it expected means seeing what it DID see.
      // Opt-in so a normal run stays readable.
      if (process.env.FLYWHEEL_UAT_DUMP_EVENTS === "1") {
        process.stderr.write(`[event] ${JSON.stringify(message.event)}\n`);
      }
      // G-05-1 (plan 05-18): an unrecognised sidecar event kind is logged unconditionally — NOT
      // behind the opt-in above — because silent counting of these is the same class of blindness
      // that let this plan's own gap (an unanswered board_read_request) go unnoticed for a full
      // round. `claude-code-adapter.ts`'s own normaliser falls through to this literal type for
      // every stream shape it does not recognise. Plan 05-37 (Task 3, gap G-05-7): this 200-
      // character slice is what left G-05-7's own third finding with only PREFIXES to freeze
      // (`scripts/uat/fixtures/live-opus5-unmodelled-shapes.json`) — so it is no longer the whole
      // record. The full line is ALSO kept durably via `this.sink` (when one was supplied), beside
      // this line, never instead of it; this slice remains the in-run readable signal an operator
      // watching stdout/stderr live can actually read.
      if (message.event?.type === "unknown") {
        const raw = typeof message.event.raw === "string" ? message.event.raw : JSON.stringify(message.event.raw);
        process.stderr.write(`[uat] unrecognised sidecar event: ${(raw ?? "").slice(0, 200)}\n`);
        this.sink?.append(raw);
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

  /** G-05-2 (plan 05-20): the watermark a turn capture starts from — call this BEFORE sending the
   * turn whose reply you're about to capture, so `waitForTurn`'s cursor excludes every event
   * already on the wire, including a PRIOR turn's own trailing chunks (closes the identity-only
   * exclusion hazard `waitForEvent`'s buffered-first scan has: an event object being merely
   * DIFFERENT from a previously-seen one is not the same as belonging to the NEW turn). */
  eventCursor() {
    return this.events.length;
  }

  /**
   * G-05-2 (plan 05-20): resolve with the WHOLE turn — every content block the model emitted for
   * `runId` from `cursor` onward, in arrival order, not just the first chunk. Terminates on
   * whichever comes first: the backend's own `result` event for this run (`endedBy: "result"`,
   * the primary signal), or `idleMs` elapsing with at least one chunk already captured and no
   * further event for this run (`endedBy: "idle"` — the degrade path for a backend that never
   * emits `result`). Rejects on `timeoutMs`, naming `label`, stating the chunk/character counts
   * already captured, the event-type list seen so far, and — reusing
   * {@link assertAllHeldRequestsAnswered}'s own starved-request clause — any unanswered held
   * inbound request, since a starved read remains the single likeliest reason a turn never
   * completes.
   *
   * The accumulation itself is {@link accumulateTurn} — this method only adds the real-time
   * waiting (idle timer, deadline) on top of that pure scan, so `--self-test` can exercise the
   * accumulation logic directly with no timers at all, and exercise this method's own timing
   * behaviour separately with a short, explicitly-passed `idleMs`/`timeoutMs`.
   *
   * WR-04 closure (plan 05-25), RETUNED by plan 05-38 (gap G-05-7 second finding): the idle timer
   * is reset ONLY on this watcher's own progress — tracked as the tuple `(chunkCount,
   * toolCalls.length, pendingToolCallCount, thinkingCount)` from {@link accumulateTurn}'s own
   * return — never on an event that advances none of them. A foreign run's event, or a non-turn
   * event for this same run, changes none of the four (they are all already scoped to this `runId`
   * by `accumulateTurn` itself) and therefore touches nothing: this call returns without touching
   * any timer. This is deliberately NOT a raw scan-position index (`events.length`/`endIndex` on
   * the fall-through path) — that value grows on ANY event appended to the shared buffer, including
   * one from a completely different run, and using it as a progress signal would silently
   * reintroduce the exact cross-run coupling this fix removes. `pendingToolCallCount` is a signal
   * `chunkCount`/`toolCalls.length` cannot express on their own: a `tool_result` answering a
   * pending call changes neither of those two numbers, yet it is real progress on this turn that
   * must be allowed to re-arm the window. `thinkingCount` (plan 05-38) closes the hazard plan 05-37
   * created the moment it modelled reasoning: without it, a long reasoning stretch advanced nothing
   * in this tuple, so the ordinary idle timer — armed from whatever chunk arrived BEFORE the
   * reasoning began — could fire while the model was still actively reasoning.
   *
   * Which window is armed for the current state is decided by the PURE, exported
   * {@link decideTurnArmedWindow} — see its own doc comment for the three states. TRADEOFF, restated
   * here because plan 05-25's own version of this paragraph was WRONG in consequence even though it
   * was correct in reasoning, and this directory's own record is more useful than a clean-looking
   * comment: plan 05-25 stood the idle window down ENTIRELY while a tool call was outstanding,
   * reasoning that the outer `timeoutMs` deadline was the honest backstop for that state. Live run
   * `01M3C48C3PV1NSGHERBZ587YB1` spent essentially its ENTIRE first turn in exactly that state —
   * roughly sixty tool-call/tool-result pairs, unbroken activity to the deadline — so the "honest
   * backstop" was the ONLY thing that could fire, and it killed a turn that was still working. Plan
   * 05-38 gives that state a window of its own (`LIVE_TOOL_CALL_IDLE_MS`/`toolCallIdleMs`, DERIVED
   * from that same run — see its own doc comment), so a turn is now bounded by SILENCE in every
   * state a caller can distinguish, never by a budget in one of them.
   *
   * The outer `timeoutMs` deadline is likewise now reset on every notification that advances this
   * watcher's own progress tuple, exactly like the idle windows above — plan 05-38's answer to the
   * gap's own first truth: a live turn must never be bounded by a TOTAL wall-clock budget, only by
   * an absence of progress within a declared window. A turn that keeps producing tool calls, tool
   * results and reasoning back-to-back — never falling silent for as long as `timeoutMs` itself —
   * therefore never reaches the deadline no matter how long its TOTAL run grows, exactly the shape
   * of the turn that killed the live run this plan closes. `timeoutMs` remains a genuine, unarmed-
   * by-nothing backstop: a turn that stops advancing in EVERY sense (no chunk, no tool call, no
   * reasoning) for `timeoutMs` straight — most plausibly before its very first chunk, the one state
   * {@link decideTurnArmedWindow} arms no window for at all — still fails on it, named `label`,
   * exactly as before.
   *
   * The `result` branch (below) is UNCHANGED by any of this — the backend's own end-of-turn line
   * remains the primary signal and always wins immediately, including while a tool call is pending.
   */
  waitForTurn(
    runId,
    cursor,
    { timeoutMs = 30_000, idleMs = TURN_IDLE_MS, toolCallIdleMs = LIVE_TOOL_CALL_IDLE_MS, label = "a turn" } = {},
  ) {
    if (this.turnWatchers === undefined) this.turnWatchers = [];
    return new Promise((resolve, reject) => {
      let settled = false;
      let idleTimer;
      let deadlineTimer;
      // The last-observed progress tuple this watcher has already reacted to — see the doc
      // comment above for why `pendingToolCallCount`/`thinkingCount`, not a raw scan-position
      // index, are members of it.
      let lastChunkCount = 0;
      let lastToolCallCount = 0;
      let lastPendingToolCallCount = 0;
      let lastThinkingCount = 0;

      const cleanup = () => {
        clearTimeout(idleTimer);
        clearTimeout(deadlineTimer);
        this.turnWatchers = this.turnWatchers.filter((watcher) => watcher !== onEvent);
      };

      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const finishIdle = (extra) => {
        if (settled) return;
        finish({ ...accumulateTurn(this.events, runId, cursor), endedBy: "idle", ...(extra ?? {}) });
      };

      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const partial = accumulateTurn(this.events, runId, cursor);
        const unanswered = this.unansweredHeldRequests ?? [];
        const unansweredClause =
          unanswered.length > 0
            ? ` UNANSWERED HELD INBOUND REQUESTS (likely cause of this timeout): ` +
              `${JSON.stringify(unanswered)}.`
            : "";
        // WR-04 closure (plan 05-25): a hang with an outstanding tool call is a DIFFERENT
        // diagnosis from a hang with nothing in flight — name the count and the tool names (the
        // most recently issued `pendingToolCallCount` of them, under the same FIFO-answering
        // assumption `accumulateTurn` itself uses) so a genuine hang is diagnosable from the error
        // alone, beside the existing captured-chunk/character clause and the unanswered-held-
        // request clause above.
        const pendingToolCalls = outstandingToolNames(partial);
        const pendingToolCallsClause =
          partial.pendingToolCallCount > 0
            ? ` OUTSTANDING TOOL CALL(S) (likely cause of this timeout): ` +
              `${partial.pendingToolCallCount} — ` +
              `${JSON.stringify(pendingToolCalls)}.`
            : "";
        // Plan 05-36 (gap G-05-7): the message text below is BYTE-IDENTICAL to what a bare `Error`
        // used to carry — only the class and its own structured properties are new. `partial` is
        // the exact object this closure already computed above, now attached to the error itself
        // rather than existing only inside this string.
        reject(
          new TurnDeadlineError(
            `timed out after ${timeoutMs}ms waiting for ${label}. captured so far: ` +
              `${partial.chunkCount} chunk(s), ${partial.charCount} character(s). events so far: ` +
              `${JSON.stringify(this.events.map((e) => e.type))}.${unansweredClause}${pendingToolCallsClause}`,
            { partial, label, timeoutMs, unanswered, pendingToolCalls },
          ),
        );
      };

      // Plan 05-38: arm whichever window {@link decideTurnArmedWindow} names for the CURRENT
      // state — "tool-call" concludes via the idle marker, naming the outstanding tool(s), so a
      // caller can tell "went quiet holding an unanswered tool call" apart from "went quiet with
      // nothing in flight"; "idle" concludes exactly as it always did; "none" arms nothing here
      // (the state before any chunk/tool/reasoning progress, or reasoning-only so far) — the outer
      // deadline below is what bounds that state.
      const armWindow = (partial) => {
        clearTimeout(idleTimer);
        const decision = decideTurnArmedWindow(partial, { idleMs, toolCallIdleMs });
        if (decision.window === "tool-call") {
          idleTimer = setTimeout(() => {
            const p = accumulateTurn(this.events, runId, cursor);
            finishIdle({ midFlight: true, outstandingTools: outstandingToolNames(p) });
          }, decision.ms);
        } else if (decision.window === "idle") {
          idleTimer = setTimeout(() => finishIdle(), decision.ms);
        }
      };

      // Plan 05-38: the outer ceiling is reset on every notification that advances this watcher's
      // own progress tuple, exactly like the idle windows above — see this method's own doc
      // comment for why a turn must never be bounded by a TOTAL wall-clock budget.
      const armCeiling = () => {
        clearTimeout(deadlineTimer);
        deadlineTimer = setTimeout(fail, timeoutMs);
      };

      const onEvent = () => {
        if (settled) return;
        const partial = accumulateTurn(this.events, runId, cursor);
        if (partial.endedBy === "result") {
          finish(partial);
          return;
        }
        const advanced =
          partial.chunkCount !== lastChunkCount ||
          partial.toolCalls.length !== lastToolCallCount ||
          partial.pendingToolCallCount !== lastPendingToolCallCount ||
          partial.thinkingCount !== lastThinkingCount;
        lastChunkCount = partial.chunkCount;
        lastToolCallCount = partial.toolCalls.length;
        lastPendingToolCallCount = partial.pendingToolCallCount;
        lastThinkingCount = partial.thinkingCount;
        if (!advanced) return;
        armWindow(partial);
        armCeiling();
      };

      this.turnWatchers.push(onEvent);
      armCeiling(); // initial arm, mirroring the pre-05-38 `deadlineTimer = setTimeout(fail, timeoutMs)`
      onEvent(); // handle events already buffered at/after cursor before this call was made
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
 * D-87 (plan 05-18, G-05-1); extended plan 05-49 (G-05-10, deviation — see that plan's own SUMMARY):
 * every event kind the sidecar HOLDS OPEN until the core answers it — `permission_request`
 * (answered via `permission_answer`), `board_read_request` (answered via `authoring_read_answer`),
 * and `proposal_created` (answered via `authoring_proposal_answer`, plan 05-48's D-80/D-81/D-92
 * staging round trip). This is the harness's own registry of the role D-87 assigns to the Rust
 * core: an entry here with no handler registered in a `drainInboundCoreRequests` call starves the
 * session it belongs to, exactly as it starved the live `uat-08` run before plan 05-18 (G-05-1) —
 * and exactly as an UNREGISTERED third kind would have left `uat-08-socratic-authoring.mjs`'s own
 * `createProposalStagedHandler` (plan 05-49) unreachable dead code, since `drainInboundCoreRequests`
 * filters by this very array before ever consulting its `handlers` map. `assertAllHeldRequestsAnswered`'s
 * invariant check (plan 05-18 Task 3) compares this array's length against the sidecar's own
 * answering-op count, so a FOURTH held kind added to `packages/sidecar/src/index.ts` without a
 * corresponding entry here fails a check instead of a live run.
 */
export const HELD_INBOUND_REQUEST_TYPES = Object.freeze([
  "permission_request",
  "board_read_request",
  "proposal_created",
]);

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
        DRAIN_POLL_MS,
        "a held inbound core request (permission_request, board_read_request, or proposal_created)",
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
  // Plan 05-36 (Task 2, gap G-05-7): tracked with a flag the catch sets, not by inspecting
  // `process.exitCode` afterward — the intent ("this body threw a real, non-skip error") must be
  // readable at the call site rather than re-derived from a side channel.
  let preserveRoot = false;
  try {
    await body(harness);
    reportPass(name);
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof SkipError) {
      // A skip is not a failure — there is nothing here for an operator to diagnose, so the root
      // is removed exactly as it is on the success path.
      reportSkip(name, err.message);
      process.exitCode = 3;
    } else {
      process.stdout.write(`\n❌ FAIL — ${name}\n\n${err?.stack ?? String(err)}\n`);
      process.exitCode = 1;
      preserveRoot = true;
    }
  } finally {
    harness.cleanup({ preserveRoot });
  }
}

export class SkipError extends Error {}

export function skip(reason) {
  throw new SkipError(reason);
}
