#!/usr/bin/env node
/**
 * The one-week exit test's drop-back count (docs/mvp-spec.md §1, issue #176).
 *
 *   node scripts/exit-test/drop-backs.mjs --project <repo> --project <repo> --from YYYY-MM-DD --to YYYY-MM-DD
 *       [--projects-dir <dir>]... [--db <flywheel.db>] [--json]
 *
 * Lists every interactive `claude` session on a counted project between the two dates (inclusive, in
 * local time), then reads Flywheel's DB read-only for the secondary numbers over the same dates and
 * projects. It prints metadata only (time, project, cwd, session id, transcript path), never what was
 * said: Cyril opens the transcript himself to write the reason line.
 *
 * WHAT A DROP-BACK IS. A Claude Code transcript is `<projects-dir>/<encoded cwd>/<session id>.jsonl`;
 * each record carries `entrypoint`, `cwd`, `sessionId` and `timestamp`. A session is interactive when a
 * record says `"entrypoint": "cli"`. Flywheel spawns `claude -p --output-format stream-json`
 * (packages/sidecar/src/claude-code-adapter.ts), and print mode records `"sdk-cli"`, so Flywheel's
 * headless sessions are ignored (and counted as ignored). Flywheel cannot name its own transcripts
 * instead: `sessions.external_session_id` is never written. Subagent transcripts
 * (`<session id>/subagents/*.jsonl`) belong to their parent session and are not read.
 *
 * A session is on a counted project when a record's `cwd` is the project, inside it, or inside one of
 * its worktrees: those `git worktree list` still knows, and those Flywheel's DB recorded. A session is
 * in the dates when any of its records is.
 *
 * A removed worktree outside the repo leaves nothing that ties it to its project. So an interactive
 * session in the dates that was started in a directory that no longer exists, and that matches no
 * counted project, is listed apart as unattributed, for Cyril to check by hand, rather than dropped.
 *
 * Transcripts are read from `~/.claude/projects` and from `$CLAUDE_CONFIG_DIR/projects` when that is
 * set, unless `--projects-dir` names the directories. The DB is `--db`, else
 * `$FLYWHEEL_APP_DATA_DIR/flywheel.db`, else the OS app-data `Flywheel/flywheel.db`
 * (packages/core/src/db/mod.rs::app_data_dir). It is opened read-only and never created; a missing DB
 * leaves the secondary numbers out. Any schema from migration 0002 on is read.
 *
 * Exit codes: 0 on a report, 2 on bad arguments.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

/** The `ending_reason`s that count as "ended by an error or refusal" (migration 0002's closed set). */
const ERROR_ENDINGS = new Set(["refusal", "api_error", "crash", "usage_limit"]);

function usage(message) {
  console.error(`drop-backs: ${message}`);
  console.error(
    "usage: drop-backs.mjs --project <repo> [--project <repo>]... --from YYYY-MM-DD --to YYYY-MM-DD " +
      "[--projects-dir <dir>]... [--db <flywheel.db>] [--json]",
  );
  process.exit(2);
}

/** `YYYY-MM-DD` as local midnight; `nextDay` gives the following midnight (the range's open end). */
function localDay(text, flag, nextDay = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!m) usage(`${flag} must be a date as YYYY-MM-DD`);
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (nextDay ? 1 : 0));
  if (Number.isNaN(date.getTime())) usage(`${flag} is not a date: ${text}`);
  return date;
}

function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** A path with no trailing separator, so prefix tests compare whole components. */
function normalise(p) {
  const resolved = path.resolve(p);
  return resolved.length > 1 && resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
}

function isWithin(cwd, root) {
  return cwd === root || cwd.startsWith(root + path.sep);
}

/** The worktrees git still knows for `repo`; none when it is not a repository here. */
function gitWorktrees(repo) {
  const result = spawnSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function defaultDbPath() {
  const override = process.env.FLYWHEEL_APP_DATA_DIR;
  if (override && path.isAbsolute(override)) return path.join(override, "flywheel.db");
  const home = os.homedir();
  const base =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? path.join(home, "AppData", "Roaming"))
        : (process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"));
  return path.join(base, "Flywheel", "flywheel.db");
}

function defaultProjectsDirs() {
  const dirs = [];
  if (process.env.CLAUDE_CONFIG_DIR) dirs.push(path.join(process.env.CLAUDE_CONFIG_DIR, "projects"));
  dirs.push(path.join(os.homedir(), ".claude", "projects"));
  return dirs;
}

/** node:sqlite is still experimental on Node 22 and warns on load; that warning is not news here. */
async function loadSqlite() {
  const others = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if (warning.name === "ExperimentalWarning" && /sqlite/i.test(warning.message)) return;
    for (const listener of others) listener(warning);
  });
  return import("node:sqlite");
}

/**
 * Flywheel's DB, read-only: the counted projects' worktrees and the secondary numbers over the dates.
 * Every value is filtered here rather than in SQL, because the core writes RFC 3339 with an offset and
 * text comparison would mis-order those.
 */
async function readDb(dbPath, projectRoots, from, toExclusive) {
  if (!fs.existsSync(dbPath)) return null;
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const inRange = (ts) => {
      const t = Date.parse(ts ?? "");
      return !Number.isNaN(t) && t >= from.getTime() && t < toExclusive.getTime();
    };
    const projectOf = new Map();
    for (const row of db.prepare("SELECT id, repo_path FROM projects").all()) {
      const candidates = new Set([normalise(row.repo_path), normalise(realpathOr(row.repo_path))]);
      const root = projectRoots.find((p) => p.roots.some((r) => candidates.has(r)));
      if (root) projectOf.set(row.id, root);
    }
    const counted = (row) => projectOf.has(row.project_id);

    const worktrees = db.prepare("SELECT project_id, path FROM worktrees").all().filter(counted);
    for (const row of worktrees) projectOf.get(row.project_id).worktrees.add(normalise(row.path));

    const requests = db
      .prepare("SELECT project_id, created_at, destructive_category FROM permission_requests")
      .all()
      .filter((r) => counted(r) && inRange(r.created_at));
    const proposals = db.prepare("SELECT project_id, state, created_at, decided_at FROM proposals").all().filter(counted);
    const sessionColumns = new Set(db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name));
    const endingReasons = {};
    let ended = 0;
    if (sessionColumns.has("ending_reason")) {
      for (const s of db.prepare("SELECT project_id, started_at, ended_at, ending_reason FROM sessions").all()) {
        if (!counted(s) || !ERROR_ENDINGS.has(s.ending_reason) || !inRange(s.ended_at ?? s.started_at)) continue;
        ended += 1;
        endingReasons[s.ending_reason] = (endingReasons[s.ending_reason] ?? 0) + 1;
      }
    }
    return {
      path: dbPath,
      gatedActionPrompts: requests.filter((r) => r.destructive_category != null).length,
      permissionRequests: requests.length,
      proposalsFiled: proposals.filter((p) => inRange(p.created_at)).length,
      proposalsAccepted: proposals.filter((p) => p.state === "accepted" && inRange(p.decided_at)).length,
      sessionsEndedByErrorOrRefusal: sessionColumns.has("ending_reason") ? ended : null,
      endingReasons: Object.fromEntries(Object.entries(endingReasons).sort(([a], [b]) => a.localeCompare(b))),
    };
  } finally {
    db.close();
  }
}

/** One top-level transcript's metadata: its entrypoints, the cwds it ran in, and its timestamps. */
function readTranscript(file) {
  const entrypoints = new Set();
  const cwds = [];
  const times = [];
  let sessionId;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== "object" || record === null) continue;
    if (typeof record.entrypoint === "string") entrypoints.add(record.entrypoint);
    if (typeof record.cwd === "string" && !cwds.includes(record.cwd)) cwds.push(record.cwd);
    if (typeof record.sessionId === "string") sessionId ??= record.sessionId;
    const t = Date.parse(record.timestamp ?? "");
    if (!Number.isNaN(t)) times.push(t);
  }
  return { entrypoints, cwds, times, sessionId: sessionId ?? path.basename(file, ".jsonl") };
}

function* topLevelTranscripts(projectsDir) {
  let dirs;
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(projectsDir, dir.name);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path.join(full, entry.name);
    }
  }
}

function sessionRow(transcript, project, cwd, file) {
  return {
    start: new Date(Math.min(...transcript.times)).toISOString(),
    project,
    cwd,
    sessionId: transcript.sessionId,
    transcript: file,
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function localStamp(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        project: { type: "string", multiple: true },
        from: { type: "string" },
        to: { type: "string" },
        "projects-dir": { type: "string", multiple: true },
        db: { type: "string" },
        json: { type: "boolean" },
      },
    }));
  } catch (error) {
    usage(error.message);
  }
  if (!values.project?.length) usage("name at least one counted project with --project");
  if (!values.from || !values.to) usage("give the attempt's dates with --from and --to");
  const from = localDay(values.from, "--from");
  const toExclusive = localDay(values.to, "--to", true);
  if (toExclusive <= from) usage("--to is before --from");

  // Each counted project, under the path as given and as resolved, with its worktrees.
  const projects = values.project.map((p) => {
    const given = normalise(p);
    const roots = [...new Set([given, normalise(realpathOr(given))])];
    const worktrees = new Set(gitWorktrees(given).map(normalise));
    return { path: given, roots, worktrees };
  });

  const dbPath = path.resolve(values.db ?? defaultDbPath());
  const dbReport = await readDb(dbPath, projects, from, toExclusive);

  const projectFor = (cwd) => {
    const c = normalise(cwd);
    return projects.find((p) => p.roots.some((r) => isWithin(c, r)) || [...p.worktrees].some((w) => isWithin(c, w)));
  };

  const projectsDirs = [...new Set((values["projects-dir"] ?? defaultProjectsDirs()).map((d) => normalise(d)))];
  const dropBacks = [];
  const unattributed = [];
  const ignoredByEntrypoint = {};
  for (const dir of projectsDirs) {
    for (const file of topLevelTranscripts(dir)) {
      // A transcript last written before the range began has no record in it.
      if (fs.statSync(file).mtimeMs < from.getTime()) continue;
      const t = readTranscript(file);
      if (!t.times.some((x) => x >= from.getTime() && x < toExclusive.getTime())) continue;
      let match;
      for (const cwd of t.cwds) {
        const project = projectFor(cwd);
        if (project) {
          match = { project, cwd };
          break;
        }
      }
      if (!match) {
        if (t.entrypoints.has("cli") && t.cwds.length > 0 && !fs.existsSync(t.cwds[0])) {
          unattributed.push(sessionRow(t, null, t.cwds[0], file));
        }
        continue;
      }
      if (!t.entrypoints.has("cli")) {
        const key = [...t.entrypoints].sort().join("+") || "none";
        ignoredByEntrypoint[key] = (ignoredByEntrypoint[key] ?? 0) + 1;
        continue;
      }
      dropBacks.push(sessionRow(t, match.project.path, match.cwd, file));
    }
  }
  const byStart = (a, b) => a.start.localeCompare(b.start) || a.sessionId.localeCompare(b.sessionId);
  dropBacks.sort(byStart);
  unattributed.sort(byStart);
  const ignoredHeadless = Object.values(ignoredByEntrypoint).reduce((a, b) => a + b, 0);

  const report = {
    from: values.from,
    to: values.to,
    projects: projects.map((p) => p.path),
    projectsDirs,
    dropBacks,
    ignoredHeadless,
    ignoredByEntrypoint,
    unattributed,
    db: dbReport,
  };
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const out = [];
  out.push(`Exit-test drop-backs, ${values.from} to ${values.to} (local time)`);
  out.push("Counted projects:", ...report.projects.map((p) => `  ${p}`));
  out.push("Transcripts read from:", ...projectsDirs.map((d) => `  ${d}`));
  out.push("");
  out.push(`Drop-backs: ${dropBacks.length}`);
  for (const d of dropBacks) {
    out.push(`  ${localStamp(d.start)}  ${d.project}  session ${d.sessionId}`);
    out.push(`      cwd ${d.cwd}`);
    out.push(`      ${d.transcript}`);
  }
  const byEntrypoint = Object.entries(ignoredByEntrypoint)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  out.push(`Ignored: ${ignoredHeadless} headless sessions on the counted projects${byEntrypoint ? ` (${byEntrypoint})` : ""}`);
  out.push("");
  out.push(
    `Interactive sessions started in a directory that no longer exists, on no counted project (check ` +
      `by hand whether each was a removed worktree of one): ${unattributed.length}`,
  );
  for (const d of unattributed) {
    out.push(`  ${localStamp(d.start)}  session ${d.sessionId}`);
    out.push(`      cwd ${d.cwd}`);
    out.push(`      ${d.transcript}`);
  }
  out.push("");
  if (!dbReport) {
    out.push(`Flywheel DB: none at ${dbPath}, so no secondary numbers.`);
  } else {
    const reasons = Object.entries(dbReport.endingReasons)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    out.push(`Flywheel DB (read-only): ${dbReport.path}`);
    out.push(`  Gated-action prompts: ${dbReport.gatedActionPrompts} (permission requests in all: ${dbReport.permissionRequests})`);
    out.push(`  Proposals filed: ${dbReport.proposalsFiled}, accepted: ${dbReport.proposalsAccepted}`);
    out.push(
      `  Sessions ended by an error or refusal: ${dbReport.sessionsEndedByErrorOrRefusal ?? "unknown (DB older than migration 0002)"}` +
        (reasons ? ` (${reasons})` : ""),
    );
  }
  console.log(out.join("\n"));
}

await main();
