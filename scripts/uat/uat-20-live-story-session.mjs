#!/usr/bin/env node
/**
 * UAT 20 — one small Story through a REAL `claude` session (issue #1843, part of #1599): the Gated action asks,
 * a permission ask reaches the developer, the MCP board tools answer, and the session hands off.
 *
 * Every e2e flow uses `fake-claude.mjs`, so before the exit-test week nothing had run a Story through the real
 * `claude`. This script does, once, small and capped:
 *
 *   - A scratch git repository with a local bare remote, under the OS temp directory, never this monorepo. A
 *     scratch Flywheel home (`FLYWHEEL_APP_DATA_DIR`, `FLYWHEEL_WORKTREE_ROOT`) holds the board: the core's own
 *     functions run through the `uat_review_ops` bridge, which refuses to run without that variable, so the
 *     owner's real board database is never opened.
 *   - The seeded Ready Story "Parser" (two criteria, one with the Check `test -f src/parser.rs`), started as the
 *     desktop's Start does: the Story's worktree and branch, its Context packet, the Story launch policy
 *     (`acceptEdits`, permission prompt on), the session's PATH shim and the board MCP server.
 *   - The packet plus a short operator note: write one file, commit it, run `git push origin HEAD` ONCE (a Gated
 *     action, so the shim asks; this script denies it), hand off, and do nothing else.
 *
 * The cost cap (`lib/live-guard.mjs`): the session is killed on the first backend refusal, rate-limit refusal or
 * `is_error` result, after 30 tool calls, after 6 permission requests, or after 8 minutes. Nothing is retried.
 * The run prints the session's tokens and cost.
 *
 * `--fake` runs the same walk with `fake-claude.mjs` as the agent (zero tokens, no credentials). That is the
 * offline UAT CI runs (`run-offline.mjs`), so the verdicts below are tested on every pull request.
 *
 * The one thing `--fake` cannot show is the real model: whether it asks for anything else, which tools it uses
 * and whether it follows the note. Those are what the live run measures.
 *
 * Exit codes: 0 pass, 1 fail, 3 skipped (no `claude`).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { armGuard, createLiveGuard, createVerdicts, formatUsage, summariseUsage } from "./lib/live-guard.mjs";
import {
  HARNESS_PRECONDITION_PREFIX,
  REPO_ROOT,
  git,
  newRunId,
  probeClaudeAvailable,
  readClaudeAuthStatus,
  resolveHarnessBinary,
  runScript,
  skip,
  step,
  summariseAuthStatus,
} from "./lib/sidecar-harness.mjs";

const FAKE = process.argv.includes("--fake");
const FAKE_CLAUDE = path.join(REPO_ROOT, "packages", "sidecar", "test", "fake-claude.mjs");

/** The cost cap of the live run (see `lib/live-guard.mjs`). */
const MAX_TOOL_CALLS = 30;
const MAX_PERMISSION_ASKS = 6;
const SESSION_DEADLINE_MS = 8 * 60_000;
/** The longest quiet stretch between two events the walk waits for; the deadline above ends a longer session. */
const QUIET_MS = 180_000;
/** Routine (not Gated) asks this run allows, so a Story can still hand off; each one is recorded as a finding. */
const MAX_ROUTINE_ALLOWS = 3;
/** A routine ask naming any of these is denied, whatever its category. */
const NEVER_ALLOW = /\bpush\b|\brm\s+-|\breset\b|\bclean\b|\bpublish\b|\bsudo\b|\bcurl\b|\bwget\b|\bgh\s|\bssh\b|\bchmod\b|\b(npm|pnpm|yarn)\s+(i|install|add)\b/;

const PARSER_PATH = "src/parser.rs";
const PARSER_CONTENT = "// Parses a file.\npub fn parse(_src: &str) {}\n";
const GATED_COMMAND = "git push origin HEAD";

/** Appended to the Story's Context packet. Short on purpose: every word is a token. */
const OPERATOR_NOTE = [
  "",
  "OPERATOR NOTE (a cost-capped check run, not a normal Story). Do exactly these steps and nothing else:",
  `1. Add one Task, "Write ${PARSER_PATH}".`,
  `2. Create ${PARSER_PATH} with exactly these two lines, then git add and git commit it on this branch: ${JSON.stringify(PARSER_CONTENT)}`,
  `3. Run \`${GATED_COMMAND}\` once. If it is declined, say so in one line and go on. Never retry it or try another way.`,
  "4. Hand off. Leave the second criterion for review.",
  "No reads beyond what these steps need, no tests, no Proposals, no other commands. Replies under 20 words.",
].join("\n");

/** The scripted agent of `--fake`: the same steps as the note. */
const FAKE_AGENT_SCRIPT = [
  { name: "task_add", arguments: { titles: [`Write ${PARSER_PATH}`] } },
  { name: "task_update", arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "doing" } },
  { commit: { path: PARSER_PATH, content: PARSER_CONTENT } },
  { name: "task_update", arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "done", note: PARSER_PATH } },
  { run: GATED_COMMAND.split(" ") },
  { name: "handoff", arguments: { next_session_must_know: "The parser stub is in.", decisions: "", adrs: [] } },
];

const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

const inside = (file, dir) => {
  const roots = [dir, realpath(dir)];
  const candidates = [file, realpath(file)];
  return candidates.some((c) => roots.some((r) => c === r || c.startsWith(`${r}${path.sep}`)));
};

/** The real run needs a `claude` that is logged in on the developer's own login, and no API key. */
function assertRealBackendReady() {
  if (!probeClaudeAvailable()) {
    skip("the real `claude` binary is not resolvable: put it on PATH (this item needs a live backend session)");
  }
  const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].filter((name) => (process.env[name] ?? "") !== "");
  if (keys.length > 0) {
    throw new Error(
      `${HARNESS_PRECONDITION_PREFIX} ${keys.join(" and ")} is set. Flywheel runs on the developer's own Claude login, ` +
        `never an API key, and this run would bill the key. Run \`unset ${keys.join(" ")}\` and start again.`,
    );
  }
  const raw = readClaudeAuthStatus({ env: process.env });
  const summary = raw === null ? null : summariseAuthStatus(raw);
  if (summary === null || summary.loggedIn !== true) {
    throw new Error(`${HARNESS_PRECONDITION_PREFIX} \`claude auth status\` says this terminal is not logged in. Run \`claude\` and /login first.`);
  }
  step(`claude is logged in (${summary.authMethod ?? "unknown method"})`);
}

await runScript(
  "uat-20",
  FAKE
    ? "UAT 20 (--fake) — a Story through the sidecar, shim and board tools with a scripted agent (zero tokens)"
    : "UAT 20 — one small Story through a real claude session: Gated action, permission ask, board tools, hand-off",
  async (harness) => {
    if (!FAKE) assertRealBackendReady();
    const bin = resolveHarnessBinary("uat_review_ops");
    if (bin === undefined) {
      throw new Error(
        `${HARNESS_PRECONDITION_PREFIX} the uat_review_ops binary was not found under target/{debug,release}: run ` +
          "`cargo build -p flywheel-core --bin uat_review_ops --bin uat_session_env -p flywheel-shim` first",
      );
    }
    const worktreeRoot = path.join(harness.root, "worktrees");
    fs.mkdirSync(worktreeRoot, { recursive: true });
    const env = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir, FLYWHEEL_WORKTREE_ROOT: worktreeRoot };
    const ops = (...args) => {
      const r = spawnSync(bin, args, { encoding: "utf8", env });
      if (r.status !== 0) throw new Error(`uat_review_ops ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
      return JSON.parse(r.stdout.trim().split("\n").at(-1));
    };

    step(`scratch Flywheel home: ${harness.appDataDir} (the real board database is never opened)`);
    const { remotePath, workPath } = harness.createRepoWithRemote();
    step(`scratch repository: ${workPath}`);
    const seeded = ops("seed-review", workPath);
    const { story } = seeded;
    const started = ops("start-story", story.id);
    const { runId, ...spawn } = started.spawn;
    step(`started ${story.key} "${story.title}": branch ${started.branch}, worktree ${started.worktreePath}`);
    assertNoRealRemote(workPath, remotePath);

    const sidecar = await harness.startSidecar(FAKE ? { env: { FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE } } : {});
    const sessionEnv = {
      ...harness.sessionEnv(runId, "main", { story: { branch: started.branch, worktreePath: started.worktreePath } }),
      ...started.policyEnv,
      ...(FAKE ? { FLYWHEEL_FAKE_BOARD_CALLS: JSON.stringify(FAKE_AGENT_SCRIPT) } : {}),
    };

    const cursor = sidecar.events.length;
    const guard = createLiveGuard({ maxToolCalls: MAX_TOOL_CALLS, maxPermissionAsks: MAX_PERMISSION_ASKS, deadlineMs: SESSION_DEADLINE_MS });
    const armed = armGuard(sidecar, runId, guard, { cursor });
    harness.onCleanup(() => armed.stop());

    step(`spawning the ${FAKE ? "scripted fake" : "REAL claude"} session (mode ${spawn.permissionMode}; cap ${MAX_TOOL_CALLS} tool calls, ${SESSION_DEADLINE_MS / 60_000} min)`);
    await sidecar.request({ ...spawn, runId, prompt: `${spawn.prompt}\n${OPERATOR_NOTE}`, worktreePath: started.worktreePath, env: sessionEnv });

    const permissionAsks = [];
    const boardCalls = [];
    const findings = [];
    let routineAllowed = 0;
    const handled = new Set();
    const mine = (e) => e.runId === undefined || e.runId === runId;
    let closed;
    for (;;) {
      const event = await sidecar.waitForEvent(
        (e) =>
          sidecar.events.indexOf(e) >= cursor &&
          mine(e) &&
          ((e.type === "board_tool_request" && !handled.has(e.requestId)) ||
            (e.type === "permission_request" && !handled.has(e.requestId)) ||
            e.type === "session_closed"),
        QUIET_MS,
        `the session's next board call, permission request or end`,
      );
      if (event.type === "session_closed") {
        closed = event;
        break;
      }
      handled.add(event.requestId);
      if (event.type === "board_tool_request") {
        let answer;
        try {
          ({ answer } = ops("tool-call", runId, event.requestId, event.tool, JSON.stringify(event.args ?? {})));
        } catch (err) {
          answer = { error: String(err.message ?? err) };
          findings.push(`board tool \`${event.tool}\` failed in the core: ${answer.error.slice(0, 200)}`);
        }
        boardCalls.push({ tool: event.tool, error: answer.error ?? null, result: answer.result ?? null });
        step(`board call ${event.tool}: ${answer.error === undefined ? "answered" : `refused (${answer.error.slice(0, 80)})`}`);
        await sidecar.request({ op: "board_tool_answer", runId, requestId: event.requestId, ...answer });
        continue;
      }
      // A permission request: the Gated ones are denied; a routine one is allowed (to let the Story hand off)
      // only when it names nothing destructive, a few times, and is recorded as a finding.
      const command = event.input?.command ?? event.input?.file_path ?? JSON.stringify(event.input ?? {});
      const gated = event.destructiveCategory !== undefined;
      let decision = "deny";
      if (!gated && routineAllowed < MAX_ROUTINE_ALLOWS && !NEVER_ALLOW.test(String(command))) {
        decision = "allow";
        routineAllowed += 1;
      }
      permissionAsks.push({ tool: event.toolName, command: String(command), category: event.destructiveCategory ?? null, decision });
      step(`permission ask: ${event.destructiveCategory ?? "(routine)"} ${event.toolName} ${String(command).slice(0, 100)} -> ${decision}`);
      await sidecar.request({ op: "permission_answer", runId, requestId: event.requestId, decision }).catch(() => {});
    }
    armed.stop();
    ops("session-closed", runId);
    step(`session closed: reason=${closed.reason}`);

    const events = sidecar.events.slice(cursor).filter(mine);
    const usage = summariseUsage(events);
    step(formatUsage(usage));

    const verdicts = createVerdicts();
    const tripped = armed.tripped();
    verdicts.check("the cost guard did not stop the session", tripped === null ? true : tripped.reason);

    // The shim's ask carries the category; a native prompt of the backend for the same command would not.
    const pushAsks = permissionAsks.filter((a) => /(^|\s)git(\s+-\S+(\s+\S+)?)*\s+push\b/.test(a.command));
    const categorised = pushAsks.filter((a) => a.category === "git-push");
    verdicts.check(
      "the Gated `git push` asked, carrying its category (git-push)",
      categorised.length >= 1 || `saw ${pushAsks.length} push ask(s), none with the category; all asks: ${JSON.stringify(permissionAsks)}`,
    );
    verdicts.check("the Gated `git push` asked once, not retried", categorised.length <= 1 || `asked ${categorised.length} times`);
    const others = permissionAsks.filter((a) => !pushAsks.includes(a));
    verdicts.check(
      "no permission ask other than the Gated action",
      others.length === 0 || `other asks: ${JSON.stringify(others.map((a) => `${a.tool}: ${a.command}`))}`,
    );
    verdicts.check(
      "the denied push never ran: the remote has no Story branch",
      harness.remoteRef(remotePath, started.branch) === undefined || `the remote holds ${started.branch}`,
    );
    verdicts.check(
      "the Story's mode is acceptEdits",
      spawn.permissionMode === "acceptEdits" || `the launch policy gave ${spawn.permissionMode}`,
    );
    const edits = events.filter((e) => e.type === "tool_call" && FILE_EDIT_TOOLS.has(e.toolName));
    const outside = edits.map((e) => e.input?.file_path ?? e.input?.notebook_path ?? e.input?.path).filter((f) => typeof f === "string" && !inside(f, started.worktreePath));
    verdicts.check(
      `every file edit stayed inside the worktree (${edits.length} edit call(s) seen)`,
      outside.length === 0 || `edits outside the worktree: ${outside.join(", ")}`,
    );
    const tree = git(started.worktreePath, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout.split("\n");
    verdicts.check(`${PARSER_PATH} is committed on the Story branch`, tree.includes(PARSER_PATH) || `the branch holds: ${tree.join(", ")}`);
    const answered = boardCalls.filter((c) => c.error === null).map((c) => c.tool);
    verdicts.check(
      "the MCP board tools answered (a Task was written)",
      answered.includes("task_add") || `board calls: ${JSON.stringify(boardCalls.map((c) => [c.tool, c.error]))}`,
    );
    const handoff = boardCalls.find((c) => c.tool === "handoff" && c.error === null);
    const handoffResult = handoff?.result === null || handoff === undefined ? null : typeof handoff.result === "string" ? JSON.parse(handoff.result) : handoff.result;
    verdicts.check("the agent handed off", handoff !== undefined || `no answered handoff in: ${JSON.stringify(boardCalls.map((c) => [c.tool, c.error]))}`);
    if (handoffResult !== null) {
      verdicts.check("the Story is In review after the hand-off", handoffResult.story_state === "in_review" || `story_state is ${handoffResult.story_state}`);
      const results = (handoffResult.checks ?? []).map((c) => c.result);
      verdicts.check("the Check ran at hand-off and passed", (results.length === 1 && results[0] === "passed") || `Check results: ${JSON.stringify(results)}`);
    }
    const review = handoff === undefined ? null : ops("review", story.id);
    if (review !== null) {
      const first = review.criteria.find((c) => c.statement === "The parser lives in src/parser.rs");
      verdicts.check(
        "the review card lists the file and pre-ticks the proven criterion",
        (review.files.includes(PARSER_PATH) && first?.preTicked === true) || `files ${JSON.stringify(review.files)}, criterion ${JSON.stringify(first)}`,
      );
    }
    const told = [
      ...events.filter((e) => e.type === "tool_result").map((e) => `${JSON.stringify(e.output ?? "")} ${e.raw ?? ""}`),
      ...events.filter((e) => e.type === "assistant_text").map((e) => e.text ?? ""),
      ...events.filter((e) => e.type === "unknown").map((e) => e.raw ?? ""),
    ];
    verdicts.check("the agent was told the push was declined", told.some((t) => /was declined/.test(t)) || "no tool result or reply says `was declined`");
    verdicts.check("the session ended as completed", closed.reason === "completed" || `session_closed reason is ${closed.reason}`);

    for (const finding of findings) step(`FINDING: ${finding}`);
    const artifact = harness.writeArtifact("live-story-verdicts", {
      backend: FAKE ? "fake-claude" : "claude",
      story: story.key,
      branch: started.branch,
      permissionMode: spawn.permissionMode,
      usage,
      guard: guard.counts(),
      tripped,
      verdicts: verdicts.rows(),
      permissionAsks,
      boardCalls: boardCalls.map((c) => ({ tool: c.tool, error: c.error })),
      findings,
    });
    step(`evidence: ${artifact}`);
    verdicts.finish();
  },
);

/** The scratch remote must be a path under the scratch root, never a hosted one. */
function assertNoRealRemote(workPath, remotePath) {
  const url = git(workPath, ["remote", "get-url", "origin"]).stdout.trim();
  if (url !== remotePath || !path.isAbsolute(url)) {
    throw new Error(`${HARNESS_PRECONDITION_PREFIX} origin of the scratch repository is ${url}, not the scratch bare repository ${remotePath}`);
  }
}
