/**
 * The checks behind `preflight.mjs`, one function each, so each has a test (issue #1600).
 *
 * Every check returns `{ name, status, detail }` with `status` one of `green`, `warn` or `red`, and never
 * throws. Nothing here writes outside a temporary directory it creates and removes, and the board DB is
 * only ever stat'ed, its first bytes read, and opened read-only. Nothing touches the keychain.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SQLITE_MAGIC = "SQLite format 3\u0000";

export const green = (name, detail) => ({ name, status: "green", detail });
export const warn = (name, detail) => ({ name, status: "warn", detail });
export const red = (name, detail) => ({ name, status: "red", detail });

/** The OS app-data DB path, as `drop-backs.mjs` and `packages/core/src/db/mod.rs::app_data_dir` resolve it. */
export function defaultDbPath(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.FLYWHEEL_APP_DATA_DIR && path.isAbsolute(env.FLYWHEEL_APP_DATA_DIR)) {
    return path.join(env.FLYWHEEL_APP_DATA_DIR, "flywheel.db");
  }
  const base =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : platform === "win32"
        ? (env.APPDATA ?? path.join(home, "AppData", "Roaming"))
        : (env.XDG_DATA_HOME ?? path.join(home, ".local", "share"));
  return path.join(base, "Flywheel", "flywheel.db");
}

function isSqliteFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return buf.toString("latin1") === SQLITE_MAGIC;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function defaultRun(cmd, args, cwd) {
  return spawnSync("nice", ["-n", "15", cmd, ...args], { cwd, encoding: "utf8" });
}

/** 1. The build: the sidecar compiles and the shim and core build (or `--skip-build`). */
export function checkBuild({ flywheelDir, skip = false, run = defaultRun }) {
  const name = "build";
  if (skip) return warn(name, "skipped (--skip-build); the sidecar and shim checks below read what is already built");
  const steps = [
    // A fresh checkout has no node_modules, and `tsc` then fails on the SDK import (found by the first dry run).
    ...(fs.existsSync(path.join(flywheelDir, "packages", "sidecar", "node_modules"))
      ? []
      : [["npm", ["--prefix", "packages/sidecar", "ci"]]]),
    ["npm", ["--prefix", "packages/sidecar", "run", "build"]],
    ["cargo", ["build", "-p", "flywheel-shim"]],
    ["cargo", ["check", "-p", "flywheel-core"]],
  ];
  for (const [cmd, args] of steps) {
    const r = run(cmd, args, flywheelDir);
    if (r.status !== 0) {
      const tail = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim().split("\n").slice(-3).join(" | ");
      return red(name, `\`${cmd} ${args.join(" ")}\` failed${r.error ? ` (${r.error.message})` : ""}: ${tail}`);
    }
  }
  return green(name, "sidecar tsc, cargo build -p flywheel-shim, cargo check -p flywheel-core");
}

/** 2. The board DB exists at a known path, and a backup of it exists and is a SQLite file. */
export function checkBoard({ dbPath, backupPath }) {
  const name = "board DB and backup";
  const facts = [`board DB: ${dbPath}`];
  let ok = true;
  if (!fs.existsSync(dbPath)) {
    facts.push("DB not found (Flywheel has not run here yet)");
    ok = false;
  } else if (!isSqliteFile(dbPath)) {
    facts.push("DB is not a SQLite file");
    ok = false;
  }
  if (!backupPath) {
    facts.push("no backup given: copy the DB, then pass --backup <copy>");
    ok = false;
  } else if (path.resolve(backupPath) === path.resolve(dbPath)) {
    facts.push("backup is the DB itself");
    ok = false;
  } else if (!fs.existsSync(backupPath) || !isSqliteFile(backupPath)) {
    facts.push(`backup ${backupPath} is missing or not a SQLite file`);
    ok = false;
  } else {
    facts.push(`backup: ${backupPath} (${fs.statSync(backupPath).size} bytes)`);
  }
  return (ok ? green : red)(name, facts.join("; "));
}

function git(repo, args) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The `repo_path` of every registered project, or null when there is no DB. Read-only. */
export async function readRegisteredPaths(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  const others = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.name === "ExperimentalWarning" && /sqlite/i.test(w.message)) return;
    for (const l of others) l(w);
  });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT repo_path FROM projects").all().map((r) => r.repo_path);
  } finally {
    db.close();
  }
}

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/** 3. Each counted project is a reachable git checkout; Flywheel's is the `flywheel/` folder of one. */
export async function checkProjects({ projects, flywheelProject, dbPath, readRegistered = readRegisteredPaths }) {
  const name = "counted projects";
  const problems = [];
  const lines = [];
  if (projects.length < 2) problems.push("the rules need two or more counted projects, one that is not Flywheel");
  for (const p of projects) {
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
      problems.push(`${p} is not a directory`);
      continue;
    }
    const top = git(p, ["rev-parse", "--show-toplevel"]);
    if (!top) {
      problems.push(`${p} is not in a git repository`);
      continue;
    }
    const prefix = git(p, ["rev-parse", "--show-prefix"]) ?? "";
    if (p === flywheelProject && prefix !== "flywheel/") {
      problems.push(`${p} is not <monorepo>/flywheel (git prefix "${prefix}")`);
      continue;
    }
    lines.push(`${p} (repo ${top}${prefix ? `, subdir ${prefix.replace(/\/$/, "")}` : ""})`);
  }
  if (problems.length) return red(name, problems.join("; "));
  let registered;
  try {
    registered = await readRegistered(dbPath);
  } catch (error) {
    return red(name, `${lines.join("; ")}; cannot read the DB: ${error.message}`);
  }
  if (registered === null) return warn(name, `${lines.join("; ")}; DB absent, so registration is unchecked`);
  const known = new Set(registered.map(real));
  const missing = projects.filter((p) => !known.has(real(p)));
  if (missing.length) return warn(name, `${lines.join("; ")}; not registered in Flywheel yet: ${missing.join(", ")}`);
  return green(name, `${lines.join("; ")}; all registered`);
}

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 4. `drop-backs.mjs` against the monorepo layout, on synthetic transcripts in a temp directory: a session in
 * `<monorepo>/flywheel` counts, one at the monorepo root and one in another folder do not, and the same holds
 * in every other git worktree of the monorepo. The real transcripts and the real DB are not read.
 *
 * The row's numbers are those sample sessions, so it says they are not drop-backs: a count printed on a row
 * named "drop-backs" read as drop-backs already scored against the test, which counts only from day 1.
 */
export function checkDropBacks({ flywheelProject, scriptPath, run = spawnSync }) {
  const name = "drop-backs on the monorepo layout";
  const notDropBacks = "These are not drop-backs: the exit test counts only sessions from day 1";
  const top = git(flywheelProject, ["rev-parse", "--show-toplevel"]);
  const prefix = git(flywheelProject, ["rev-parse", "--show-prefix"]);
  if (!top || prefix !== "flywheel/") return red(name, `${flywheelProject} is not <monorepo>/flywheel`);
  const worktrees = (git(flywheelProject, ["worktree", "list", "--porcelain"]) ?? "")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-preflight-"));
  try {
    const projectsDir = path.join(tmp, "projects");
    const now = new Date().toISOString();
    const expectIn = [];
    const expectOut = [];
    let n = 0;
    const write = (cwd, bucket) => {
      n += 1;
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const dir = path.join(projectsDir, `-enc-${n}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${JSON.stringify({ entrypoint: "cli", cwd, sessionId: id, timestamp: now })}\n`);
      bucket.push(id);
    };
    for (const wt of worktrees) {
      write(path.join(wt, "flywheel"), expectIn);
      write(path.join(wt, "flywheel", "packages"), expectIn);
      write(wt, expectOut);
      write(path.join(wt, "scripts"), expectOut);
    }
    const today = localToday();
    const result = run(
      process.execPath,
      [scriptPath, "--project", flywheelProject, "--from", today, "--to", today, "--projects-dir", projectsDir, "--db", path.join(tmp, "absent.db"), "--json"],
      { encoding: "utf8" },
    );
    if (result.status !== 0) return red(name, `drop-backs.mjs exited ${result.status}: ${(result.stderr ?? "").trim()}`);
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      return red(name, "drop-backs.mjs printed no JSON");
    }
    const got = new Set(report.dropBacks.map((d) => d.sessionId));
    const missed = expectIn.filter((id) => !got.has(id));
    const wrong = expectOut.filter((id) => got.has(id));
    const sample = `self-check on sample sessions written today in a temp dir, across ${worktrees.length} worktree(s)`;
    if (missed.length || wrong.length) {
      return red(
        name,
        `${sample}: drop-backs.mjs missed ${missed.length} of the ${expectIn.length} in flywheel/ and counted ${wrong.length} of the ${expectOut.length} elsewhere in the monorepo. ${notDropBacks}`,
      );
    }
    return green(
      name,
      `${sample}: drop-backs.mjs counts the ${expectIn.length} in flywheel/ and ignores the ${expectOut.length} elsewhere in the monorepo. ${notDropBacks}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 5. The compiled `flywheel-shim` is somewhere the core finds it, and the real `git` it wraps is on PATH. */
export function checkShim({ flywheelDir, env = process.env, candidatesExtra = [] }) {
  const name = "shim installed";
  const candidates = [
    ...candidatesExtra,
    path.join(flywheelDir, "target", "debug", "flywheel-shim"),
    path.join(flywheelDir, "target", "release", "flywheel-shim"),
    "/Applications/Flywheel.app/Contents/MacOS/flywheel-shim",
  ];
  const found = candidates.find((c) => {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
  if (!found) return red(name, `flywheel-shim not found; probed ${candidates.join(", ")}. Build it: cargo build -p flywheel-shim`);
  const realGit = (env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "git")).find((c) => fs.existsSync(c));
  if (!realGit) return red(name, `${found} exists but git is not on PATH, which the shim wraps`);
  return green(name, `${found}; wraps ${realGit}`);
}

/** 6. The sidecar's own `probeClaudeBinary()` (built `dist/`) finds `claude`, as a session would spawn it. */
export function checkClaude({ flywheelDir, env = process.env, run = spawnSync }) {
  const name = "sidecar finds claude";
  const adapter = path.join(flywheelDir, "packages", "sidecar", "dist", "claude-code-adapter.js");
  if (!fs.existsSync(adapter)) return red(name, `${adapter} is not built; run the build check first`);
  const r = run(
    process.execPath,
    ["--input-type=module", "-e", `const m = await import(${JSON.stringify(adapter)}); console.log(JSON.stringify({ bin: m.resolveClaudeBin(), ...(await m.probeClaudeBinary()) }));`],
    { encoding: "utf8", env },
  );
  if (r.status !== 0) return red(name, `probe failed: ${(r.stderr ?? "").trim().split("\n").slice(-2).join(" | ")}`);
  let out;
  try {
    out = JSON.parse(r.stdout.trim().split("\n").pop());
  } catch {
    return red(name, "probe printed no JSON");
  }
  if (!out.available) {
    return red(name, `\`${out.bin} --version\` did not run. Put claude on PATH, or set FLYWHEEL_CLAUDE_BIN (the app uses your login shell's PATH, this check uses this shell's)`);
  }
  return green(name, `${out.bin} ${out.version ?? ""}`.trim());
}

const CONFIG_MARKER = "__FLYWHEEL_CONFIG_DIR__";

/**
 * 7. The terminal's `CLAUDE_CONFIG_DIR` is what the app's `claude` will use (issue #1758). The app, opened from
 * the Finder, has no such variable and takes the one a login shell reports (`login_path.rs`). So ask a login shell,
 * started without the variable, what it sets, and compare with this terminal. Claude Code keys its stored login to
 * the config folder, so a difference means the app reads another login than the one `/login` just refreshed.
 */
export function checkClaudeConfigDir({ env = process.env, run = spawnSync } = {}) {
  const name = "claude config folder";
  const shell = env.SHELL || "/bin/zsh";
  const { CLAUDE_CONFIG_DIR: _own, ...finderLike } = env;
  const r = run(shell, ["-l", "-i", "-c", `printf '${CONFIG_MARKER}%s${CONFIG_MARKER}' "$CLAUDE_CONFIG_DIR"`], {
    encoding: "utf8",
    env: finderLike,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  const m = new RegExp(`${CONFIG_MARKER}(.*)${CONFIG_MARKER}`, "s").exec(r.stdout ?? "");
  if (r.status !== 0 || !m) {
    return warn(name, `could not ask ${shell} -l -i for CLAUDE_CONFIG_DIR${r.error ? ` (${r.error.message})` : ""}; the app may not see it either`);
  }
  // The app ignores a relative or tilde value (login_path.rs), so it would run without the variable.
  const reported = m[1].trim();
  const app = path.isAbsolute(reported) ? reported : "";
  const terminal = (env.CLAUDE_CONFIG_DIR ?? "").trim();
  if (app === terminal) return green(name, terminal ? `CLAUDE_CONFIG_DIR=${terminal} in the terminal and in the app` : "CLAUDE_CONFIG_DIR unset in both");
  return warn(
    name,
    `the terminal has CLAUDE_CONFIG_DIR=${terminal || "(unset)"} but the app's claude would use ${app || "(unset)"}${reported && !app ? ` (the login shell's ${reported} is not an absolute path, so the app ignores it)` : ""}. ` +
      "Claude Code keeps its login per config folder, so /login in this terminal does not refresh the app's login. " +
      "Set the variable in ~/.zshenv, or log in once with the app's value",
  );
}

/** Renders results as a table; `red` rows make the run fail. */
export function renderTable(results) {
  const mark = { green: "GREEN", warn: "WARN ", red: "RED  " };
  const width = Math.max(...results.map((r) => r.name.length));
  return results.map((r) => `${mark[r.status]}  ${r.name.padEnd(width)}  ${r.detail}`).join("\n");
}
