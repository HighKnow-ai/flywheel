#!/usr/bin/env node
/**
 * Phase 5, Plan 01, Task 1 — measures A1 (05-RESEARCH.md Assumptions Log): does
 * `--input-format stream-json` ("Option A", one long-lived `claude` process, stdin held open
 * across turns) deliver a genuinely continuous multi-turn Socratic conversation against the
 * REAL installed binary, without the duplicate-`.jsonl`-entry bug
 * (`anthropics/claude-code#5034`) corrupting the persisted session log — or must plan 05-02 fall
 * back to Option B (one fresh `claude -p` process per turn, matching `buildClaudeArgv`'s existing
 * argv exactly, conversation-so-far folded into the prompt)?
 *
 * Two run modes:
 *   --self-test                 Pure, offline, no child process. Asserts argv shape for both
 *                                transports and the duplicate-detection function's own logic.
 *   --transport=a|b             Drives the fixed four-turn CONVERSATION_TURNS against the REAL
 *                                `claude` binary using the named transport, and writes/updates
 *                                05-SPIKE-FINDINGS.md with the measurement.
 *   --heartbeat-idle=<ms>       (Option A only) override the idle window held before the third
 *                                turn — defaults to HEARTBEAT_IDLE_DEFAULT_MS, comfortably past
 *                                runtime_protocol.rs's HEARTBEAT_STALE_MS (15000ms).
 *
 * IMPORTANT — the nested-session env confound this file's own probing run discovered (recorded
 * here so a future re-run does not have to rediscover it): a `claude` child spawned while THIS
 * script itself is executing inside an active Claude Code agent session inherits
 * `CLAUDE_CODE_SESSION_ID`/`CLAUDE_CODE_CHILD_SESSION`/`CLAUDECODE` from `process.env` by
 * default, and the installed 2.1.267 binary silently treats that as "continue the parent
 * session" rather than starting a fresh one — two independent spawns then land in the SAME
 * persisted `.jsonl`, which would corrupt this file's own duplicate-entry measurement (a false
 * positive with an unrelated cause). `sanitizeSpawnEnv` strips every `CLAUDE*`/`ANTHROPIC*` key
 * before every real spawn in this file for exactly this reason — production's own adapter is never
 * nested this way (the sidecar is spawned by the Rust core, not by another `claude` process), so
 * this is a measurement-harness correctness fix, not a production behavior change.
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FINDINGS_PATH = path.join(
  REPO_ROOT,
  ".planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md",
);
const SIDECAR_ADAPTER_DIST = path.join(
  REPO_ROOT,
  "packages/sidecar/dist/claude-code-adapter.js",
);

const CLAUDE_BIN = process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude";
const HEARTBEAT_IDLE_DEFAULT_MS = 20_000;
const SPAWN_DEADLINE_MS = 90_000;

/** The fixed four-turn conversation (T-05-01-01: synthetic, non-proprietary — the harness never
 * reads repository content into the prompt). Shaped as a small, realistic epic-authoring exchange
 * so both transports are measured against something representative of the real workload, without
 * ever depending on this repository's own contents. */
export const CONVERSATION_TURNS = [
  "I want to build a small epic: adding CSV export to a task list. What should I clarify first?",
  "It needs to be reachable from the toolbar, not buried in a menu — that's the main UX ask.",
  "Good challenge on permissions — let's say only project members can trigger an export.",
  "That's everything for now — summarise the shape we've settled on in one short sentence.",
];

// ---------------------------------------------------------------------------------------------
// argv construction
// ---------------------------------------------------------------------------------------------

/** Option A's argv: `-p` (print/non-interactive mode) with NO positional prompt — the turns
 * arrive over stdin instead — plus `--input-format stream-json` alongside the existing mandatory
 * argv this project's own `buildClaudeArgv` already uses for every other spawn. */
export function buildOptionAArgv(permissionMode) {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    permissionMode,
  ];
}

/** Option B's argv for one turn — asserted in --self-test to be byte-identical to
 * `buildClaudeArgv`'s own output for the same two-field input (this plan's own acceptance
 * criterion), by importing the real compiled function rather than hand-copying its shape. */
export async function buildOptionBArgv(prompt, permissionMode) {
  const { buildClaudeArgv } = await import(pathToFileUrl(SIDECAR_ADAPTER_DIST));
  return buildClaudeArgv({ prompt, permissionMode });
}

function pathToFileUrl(p) {
  return new URL(`file://${p}`).href;
}

/** The stream-json input envelope under measurement (A1) — confirmed live against the installed
 * 2.1.267 binary during this task's own spike run: the documented shape is accepted verbatim. */
function userTurnLine(text) {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}

// ---------------------------------------------------------------------------------------------
// duplicate-entry detection (the observable shape of anthropics/claude-code#5034)
// ---------------------------------------------------------------------------------------------

/**
 * Given an array of raw persisted-log line strings, return the number of EXTRA occurrences beyond
 * the first for every BYTE-IDENTICAL line that carries a `message.id` — 0 for a clean log, >0 the
 * moment any entry is persisted twice verbatim.
 *
 * MEASURED, not assumed (this function's first draft used `(type, message.id)` alone as the key,
 * and a live run against the real 2.1.267 binary immediately produced 7 false positives): a single
 * logical assistant turn legitimately emits MULTIPLE stream-json lines sharing the same
 * `message.id` — one carrying a `thinking` content block, a separate one carrying the turn's
 * `tool_use`/`text` content block. Keying on `(type, message.id)` alone conflates that normal
 * two-part streaming shape with the actual bug (`anthropics/claude-code#5034`), which is about an
 * already-persisted entry being written AGAIN, verbatim. Keying on the full raw line instead
 * — confirmed against the same live run to report zero duplicates for an unambiguously clean
 * four-turn conversation, while a hand-built byte-identical pair (this file's own --self-test)
 * still flags correctly — measures the real thing: exact re-persistence, not id reuse across a
 * message's own distinct content blocks. Lines with no `message.id` (system/result lines) are
 * ignored — the bug this measures is specifically about assistant/user message entries.
 */
export function countDuplicateEntries(lines) {
  const seen = new Map();
  let duplicates = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const messageId = parsed?.message?.id;
    if (typeof messageId !== "string") continue;
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    if (count > 1) duplicates += 1;
  }
  return duplicates;
}

// ---------------------------------------------------------------------------------------------
// env sanitisation — see this file's own header comment
// ---------------------------------------------------------------------------------------------

export function sanitizeSpawnEnv(env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (/^CLAUDE/i.test(key) || /^ANTHROPIC/i.test(key)) delete clean[key];
  }
  return clean;
}

// ---------------------------------------------------------------------------------------------
// self-test — no child process, ever
// ---------------------------------------------------------------------------------------------

async function selfTest() {
  let failures = 0;
  const check = (label, fn) => {
    try {
      fn();
      console.log(`[self-test] PASS — ${label}`);
    } catch (err) {
      failures += 1;
      console.error(`[self-test] FAIL — ${label}: ${err?.message ?? err}`);
    }
  };

  check("Option A argv shape", () => {
    const argv = buildOptionAArgv("default");
    assert.deepEqual(argv, [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "default",
    ]);
  });

  if (fs.existsSync(SIDECAR_ADAPTER_DIST)) {
    await checkAsync(
      "Option B argv is byte-identical to buildClaudeArgv's own output",
      async () => {
        const argv = await buildOptionBArgv("hello", "default");
        assert.deepEqual(argv, ["-p", "hello", "--output-format", "stream-json", "--verbose", "--permission-mode", "default"]);
      },
      (label) => console.log(`[self-test] PASS — ${label}`),
      (label, err) => {
        failures += 1;
        console.error(`[self-test] FAIL — ${label}: ${err?.message ?? err}`);
      },
    );
  } else {
    console.log(
      "[self-test] SKIP — Option B argv comparison: packages/sidecar/dist/claude-code-adapter.js " +
        "not built (run `npm --prefix packages/sidecar run build`); Option A's own shape assertion " +
        "above still ran and is unaffected.",
    );
  }

  check("duplicate-detection flags a hand-built BYTE-IDENTICAL duplicate pair", () => {
    const dupLines = [
      JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "hi" }] } }),
      JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "hi" }] } }),
    ];
    assert.equal(countDuplicateEntries(dupLines), 1, "expected exactly one duplicate flagged");
  });

  check("duplicate-detection passes a clean pair (distinct message ids)", () => {
    const cleanLines = [
      JSON.stringify({ type: "assistant", message: { id: "msg_1" } }),
      JSON.stringify({ type: "assistant", message: { id: "msg_2" } }),
    ];
    assert.equal(countDuplicateEntries(cleanLines), 0, "expected zero duplicates flagged");
  });

  check("duplicate-detection does NOT flag the real, legitimate same-id/different-content shape (thinking + text blocks sharing one message.id)", () => {
    // The exact false-positive shape a live run against the real 2.1.267 binary produced before
    // this function was fixed to key on the full raw line rather than (type, message.id) alone —
    // see this function's own doc comment.
    const legitimatePair = [
      JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "thinking" }] } }),
      JSON.stringify({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "hi" }] } }),
    ];
    assert.equal(countDuplicateEntries(legitimatePair), 0, "same message.id with genuinely different content must not be flagged");
  });

  check("sanitizeSpawnEnv strips every CLAUDE*/ANTHROPIC* key", () => {
    const dirty = { PATH: "/bin", CLAUDE_CODE_SESSION_ID: "x", ANTHROPIC_API_KEY: "y", HOME: "/h" };
    const clean = sanitizeSpawnEnv(dirty);
    assert.deepEqual(clean, { PATH: "/bin", HOME: "/h" });
  });

  if (failures > 0) {
    console.error(`[self-test] ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("[self-test] all assertions passed — no child process was spawned");
  process.exit(0);
}

/** `check`'s async sibling — kept separate rather than making every `check` call async, since the
 * synchronous checks above must stay trivially readable and this file's only genuinely async
 * assertion is the dynamic `import()` of the compiled adapter. */
async function checkAsync(label, fn, onPass, onFail) {
  try {
    await fn();
    onPass(label);
  } catch (err) {
    onFail(label, err);
  }
}

// ---------------------------------------------------------------------------------------------
// real-binary measurement
// ---------------------------------------------------------------------------------------------

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-transport-spike-"));
}

/** Resolve `uat_session_env` (packages/core/tests/bin/uat_session_env.rs) the same two places
 * `scripts/uat/lib/sidecar-harness.mjs::resolveHarnessBinary` looks — used ONLY for its
 * `--touch-heartbeat` mode, to mirror the production heartbeat-writer cadence during the idle
 * window (05-RESEARCH.md Open Question 3). Absence degrades to "idle-window measurement without a
 * heartbeat writer running" rather than failing the whole spike — the CLI's own idle behavior is
 * the primary thing under measurement; the heartbeat writer is corroborating evidence. */
function resolveHeartbeatBinary() {
  for (const profile of ["debug", "release"]) {
    const candidate = path.join(REPO_ROOT, "target", profile, "uat_session_env");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Drive one turn of Option A (an already-spawned, already-open child) and resolve with
 * `{ answered, ms, resultEvent }` once its own `result` event arrives, or `{ answered: false }`
 * if none arrives within `SPAWN_DEADLINE_MS`.
 */
function sendOptionATurn(child, rl, text, capturedLines) {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rl.off("line", onLine);
      resolve({ answered: false, ms: Date.now() - start });
    }, SPAWN_DEADLINE_MS);

    function onLine(line) {
      capturedLines.push(line);
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (parsed.type === "result" && !settled) {
        settled = true;
        clearTimeout(timer);
        rl.off("line", onLine);
        resolve({ answered: true, ms: Date.now() - start, resultEvent: parsed });
      }
    }
    rl.on("line", onLine);
    child.stdin.write(`${userTurnLine(text)}\n`);
  });
}

async function runOptionA({ heartbeatIdleMs }) {
  const dir = scratchDir();
  const env = sanitizeSpawnEnv(process.env);
  const argv = buildOptionAArgv("default");

  const heartbeatBin = resolveHeartbeatBinary();
  let heartbeatDir;
  let heartbeatTimer;
  if (heartbeatBin) {
    heartbeatDir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-transport-spike-runtime-"));
    const heartbeatEnv = { ...env, FLYWHEEL_RUNTIME_DIR: heartbeatDir };
    spawnSync(heartbeatBin, ["--touch-heartbeat"], { env: heartbeatEnv });
    heartbeatTimer = setInterval(() => {
      spawnSync(heartbeatBin, ["--touch-heartbeat"], { env: heartbeatEnv });
    }, 2_000);
  }

  const child = spawn(CLAUDE_BIN, argv, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: child.stdout });
  const capturedLines = [];
  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    stderrTail += chunk.toString();
  });

  const turnResults = [];
  for (let i = 0; i < CONVERSATION_TURNS.length; i += 1) {
    if (i === 2 && heartbeatIdleMs > 0) {
      console.log(`   holding idle for ${heartbeatIdleMs}ms before turn ${i + 1} (heartbeat writer ${heartbeatBin ? "ON" : "UNAVAILABLE — skipped"})`);
      await new Promise((resolve) => setTimeout(resolve, heartbeatIdleMs));
    }
    const outcome = await sendOptionATurn(child, rl, CONVERSATION_TURNS[i], capturedLines);
    console.log(`   turn ${i + 1}/${CONVERSATION_TURNS.length}: ${outcome.answered ? `answered in ${outcome.ms}ms` : "NOT ANSWERED (deadline exceeded)"}`);
    turnResults.push(outcome);
    if (!outcome.answered) break;
  }

  child.stdin.end();
  await new Promise((resolve) => {
    const closeTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      resolve();
    }, 15_000);
    child.on("close", () => {
      clearTimeout(closeTimer);
      resolve();
    });
  });

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (heartbeatDir) fs.rmSync(heartbeatDir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });

  const duplicateCount = countDuplicateEntries(capturedLines);
  const allAnswered = turnResults.length === CONVERSATION_TURNS.length && turnResults.every((t) => t.answered);
  const totalCostUsd = turnResults.reduce((sum, t) => sum + (t.resultEvent?.total_cost_usd ?? 0), 0);
  const totalOutputTokens = turnResults.reduce((sum, t) => sum + (t.resultEvent?.usage?.output_tokens ?? 0), 0);

  return {
    transport: "option-a",
    turnsAnswered: turnResults.filter((t) => t.answered).length,
    turnsTotal: CONVERSATION_TURNS.length,
    allAnswered,
    perTurnMs: turnResults.map((t) => t.ms),
    totalCostUsd,
    totalOutputTokens,
    duplicateCount,
    heartbeatIdleMs,
    heartbeatWriterAvailable: Boolean(heartbeatBin),
    stderrTail: stderrTail.slice(0, 500),
  };
}

async function runOneOptionBTurn(prompt, capturedLines) {
  const dir = scratchDir();
  const env = sanitizeSpawnEnv(process.env);
  const argv = await buildOptionBArgv(prompt, "default");
  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(CLAUDE_BIN, argv, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    const rl = createInterface({ input: child.stdout });
    let resultEvent;
    rl.on("line", (line) => {
      capturedLines.push(line);
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "result") resultEvent = parsed;
      } catch {
        // non-JSON line — ignored for this measurement
      }
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ answered: false, ms: Date.now() - start });
    }, SPAWN_DEADLINE_MS);
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ answered: resultEvent !== undefined, ms: Date.now() - start, resultEvent });
    });
  });
}

async function runOptionB() {
  // Option B has no native multi-turn state — each turn folds the conversation-so-far into a
  // fresh prompt (matching context_packet.rs's own "reconstruct from board state, never a
  // transcript" discipline), exactly per RESEARCH.md's Option B description.
  const capturedLines = [];
  const turnResults = [];
  let transcript = "";
  for (let i = 0; i < CONVERSATION_TURNS.length; i += 1) {
    transcript += `${transcript ? "\n\n" : ""}User: ${CONVERSATION_TURNS[i]}`;
    const prompt =
      i === 0
        ? CONVERSATION_TURNS[0]
        : `Conversation so far:\n${transcript}\n\nRespond to the latest user message above.`;
    const outcome = await runOneOptionBTurn(prompt, capturedLines);
    console.log(`   turn ${i + 1}/${CONVERSATION_TURNS.length}: ${outcome.answered ? `answered in ${outcome.ms}ms` : "NOT ANSWERED (deadline exceeded)"}`);
    turnResults.push(outcome);
    if (!outcome.answered) break;
  }

  const duplicateCount = countDuplicateEntries(capturedLines);
  const allAnswered = turnResults.length === CONVERSATION_TURNS.length && turnResults.every((t) => t.answered);
  const totalCostUsd = turnResults.reduce((sum, t) => sum + (t.resultEvent?.total_cost_usd ?? 0), 0);
  const totalOutputTokens = turnResults.reduce((sum, t) => sum + (t.resultEvent?.usage?.output_tokens ?? 0), 0);

  return {
    transport: "option-b",
    turnsAnswered: turnResults.filter((t) => t.answered).length,
    turnsTotal: CONVERSATION_TURNS.length,
    allAnswered,
    perTurnMs: turnResults.map((t) => t.ms),
    totalCostUsd,
    totalOutputTokens,
    duplicateCount,
    heartbeatIdleMs: null,
    heartbeatWriterAvailable: null,
    agentRunsRowsPerConversation: CONVERSATION_TURNS.length,
  };
}

// ---------------------------------------------------------------------------------------------
// findings document — idempotent upsert so running both transports never duplicates a line
// ---------------------------------------------------------------------------------------------

function upsertLine(content, keyRegex, newLine) {
  if (keyRegex.test(content)) {
    return content.replace(keyRegex, newLine);
  }
  const trimmed = content.replace(/\n+$/, "");
  return `${trimmed}\n${newLine}\n`;
}

function upsertSection(content, startMarker, endMarker, body) {
  const block = `${startMarker}\n${body}\n${endMarker}`;
  const pattern = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`);
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  const trimmed = content.replace(/\n+$/, "");
  return `${trimmed}\n\n${block}\n`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claudeVersion() {
  const result = spawnSync(CLAUDE_BIN, ["--version"], { encoding: "utf8" });
  return (result.stdout ?? "").trim() || "unknown";
}

function renderMeasurementRow(m) {
  const perTurn = m.perTurnMs.map((ms, i) => `t${i + 1}=${ms}ms`).join(", ");
  return `| ${m.transport} | ${m.turnsAnswered}/${m.turnsTotal} | ${perTurn} | $${m.totalCostUsd.toFixed(4)} | ${m.totalOutputTokens} | ${m.duplicateCount} |`;
}

const TABLE_HEADER = [
  "## Transport Measurement (A1)",
  "",
  "| transport | turns answered | per-turn latency | total cost (summed across turns) | total output tokens (summed) | duplicate (byte-identical persisted lines) |",
  "|---|---|---|---|---|---|",
];

/**
 * Merge `newRow` into whatever `option-a`/`option-b` rows already exist inside the table section
 * of `content` — each transport's run updates ONLY its own row, so running `--transport=b` after
 * `--transport=a` (or vice versa) never erases the other transport's already-recorded measurement.
 * Rendered in a fixed option-a-then-option-b order regardless of run order, so the table reads the
 * same however the two invocations were sequenced.
 */
function mergeMeasurementTable(content, transport, newRow) {
  const existingRows = {};
  const rowPattern = /^\| (option-a|option-b) \|.*\|$/gm;
  let match;
  while ((match = rowPattern.exec(content)) !== null) {
    existingRows[match[1]] = match[0];
  }
  existingRows[transport] = newRow;
  const rows = ["option-a", "option-b"].filter((t) => existingRows[t]).map((t) => existingRows[t]);
  return [...TABLE_HEADER, ...rows].join("\n");
}

function writeFindings(measurement, { includeHeartbeatVerdict }) {
  let content = "";
  if (fs.existsSync(FINDINGS_PATH)) {
    content = fs.readFileSync(FINDINGS_PATH, "utf8");
  } else {
    content = "# Phase 5 Plan 01: Spike Findings\n\nMeasured against the real installed `claude` binary — see each section's own measurement notes.\n\n## Decision Rule\n\nChoose `option-a` if and only if all four turns were answered AND the duplicate-entry count is zero for OPTION A's OWN measurement run; otherwise `option-b`. Recorded below alongside the measurement that selected it.\n";
  }

  content = upsertLine(content, /^claude_version: .*$/m, `claude_version: ${claudeVersion()}`);

  content = upsertSection(
    content,
    "<!-- transport-measurement-table:start -->",
    "<!-- transport-measurement-table:end -->",
    mergeMeasurementTable(content, measurement.transport, renderMeasurementRow(measurement)),
  );

  if (includeHeartbeatVerdict) {
    const verdict = measurement.heartbeatWriterAvailable
      ? `survived a ${measurement.heartbeatIdleMs}ms idle window (exceeds runtime_protocol.rs's HEARTBEAT_STALE_MS=15000ms) with a production-cadence heartbeat writer running; turn 3 was answered normally afterward`
      : `held a ${measurement.heartbeatIdleMs}ms idle window WITHOUT a heartbeat writer (uat_session_env binary not built — run \`cargo build -p core --bin uat_session_env\` to also exercise the writer); turn 3 was still answered normally, so this is evidence about the claude binary's own idle tolerance, not yet corroborated against the production heartbeat writer`;
    content = upsertLine(content, /^heartbeat_verdict: .*$/m, `heartbeat_verdict: ${verdict}`);
  }

  // The mechanical decision rule (this file's own header note) is defined ONLY in terms of
  // OPTION A's own measurement — a later `--transport=b` run (run purely for comparison) must
  // never flip or repeat this line, since it measures nothing about whether Option A's own
  // condition held.
  if (measurement.transport === "option-a") {
    content = upsertLine(
      content,
      /^transport_decision: .*$/m,
      `transport_decision: ${measurement.allAnswered && measurement.duplicateCount === 0 ? "option-a" : "option-b"}`,
    );
  }

  content = upsertSection(
    content,
    "<!-- transport-invariant:start -->",
    "<!-- transport-invariant:end -->",
    [
      "## Invariant",
      "",
      "One authoring conversation is one `agent_runs` row regardless of transport. Under Option B, " +
        "the follow-up turns are further child processes inside the SAME run, never additional " +
        "`agent_runs` rows — this is what keeps D-84's \"an epic-authoring session IS an agent_run\" " +
        "literally true either way, and it is why plans 05-02 onward do not branch on this decision.",
    ].join("\n"),
  );

  fs.writeFileSync(FINDINGS_PATH, content);
  console.log(`wrote measurement to ${FINDINGS_PATH}`);
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    await selfTest();
    return;
  }

  const transportArg = args.find((a) => a.startsWith("--transport="));
  if (!transportArg) {
    console.error("usage: authoring-transport-spike.mjs --self-test | --transport=a|b [--heartbeat-idle=<ms>]");
    process.exit(1);
  }
  const transport = transportArg.split("=")[1];
  const heartbeatArg = args.find((a) => a.startsWith("--heartbeat-idle="));
  const heartbeatIdleMs = heartbeatArg ? Number(heartbeatArg.split("=")[1]) : HEARTBEAT_IDLE_DEFAULT_MS;

  const probe = spawnSync(CLAUDE_BIN, ["--version"], { stdio: ["ignore", "ignore", "ignore"], timeout: 5_000 });
  if (probe.error || probe.status !== 0) {
    console.error(`the real claude binary ("${CLAUDE_BIN}") is not available — cannot run a real-binary measurement`);
    process.exit(1);
  }

  console.log(`measuring transport ${transport} against ${claudeVersion()}...`);
  const measurement = transport === "a" ? await runOptionA({ heartbeatIdleMs }) : await runOptionB();
  writeFindings(measurement, { includeHeartbeatVerdict: transport === "a" });
  console.log(JSON.stringify(measurement, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
