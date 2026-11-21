#!/usr/bin/env node
/**
 * The one command of the live proof before Flywheel's exit-test week (issue #1843, part of #1599). It runs on the
 * OWNER's terminal, because only the owner's login can start an authenticated `claude`, and it spends the
 * owner's Claude usage:
 *
 *   node flywheel/scripts/uat/live-runbook.mjs
 *
 * It builds what the two items need (a no-op when built), then runs, in order:
 *   1. UAT 20, one small Story through a real session: the Gated action asks, a permission ask reaches the
 *      developer, the MCP board tools answer, the session hands off (`uat-20-live-story-session.mjs`);
 *   2. UAT 03, the Gated-action deny-list: every Gated command asks, nothing else does (`uat-03-destructive-gate.mjs`).
 * Item 2 does not start when item 1 failed (a refused or looping session only spends more); pass `--keep-going`
 * to run it anyway.
 *
 * Safe by construction. Both items work on a scratch repository and a scratch Flywheel home under the OS temp
 * directory, and a scratch bare repository is the only remote. Neither opens the real board database, the real
 * keychain or this monorepo, and each caps its own cost (`lib/live-guard.mjs`). The run refuses to start when
 * ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set, so it cannot bill an API key.
 *
 * Prints one `RESULT` line per item, each session's tokens and cost, and where the evidence files are.
 *
 *   --only=story | --only=uat03   run one item
 *   --keep-going                  run item 2 even when item 1 failed
 *   --skip-build                  do not build the prerequisites
 *   --no-wait                     skip the 5 second pause before the first token is spent
 *   --dry-run                     print the plan and run nothing
 *
 * Exit codes: 0 every item passed, 1 an item failed, 3 an item was skipped (no `claude`).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FLYWHEEL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The items, in the order they run. `script` is relative to the flywheel folder. */
export const ITEMS = [
  { id: "story", label: "UAT 20: one real Story session (Gated action, permission ask, board tools, hand-off)", script: "scripts/uat/uat-20-live-story-session.mjs" },
  { id: "uat03", label: "UAT 03: the Gated-action deny-list", script: "scripts/uat/uat-03-destructive-gate.mjs" },
];

/** The build steps, each `[command, args]`, run in the flywheel folder. */
export function buildSteps({ hasSidecarModules }) {
  return [
    ...(hasSidecarModules ? [] : [["npm", ["--prefix", "packages/sidecar", "ci"]]]),
    ["npm", ["--prefix", "packages/sidecar", "run", "build"]],
    ["cargo", ["build", "-p", "flywheel-core", "--bin", "uat_session_env", "--bin", "uat_review_ops"]],
    ["cargo", ["build", "-p", "flywheel-shim"]],
  ];
}

/** The items to run for the given arguments. Throws on an unknown `--only`. */
export function selectItems(argv) {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  if (only === undefined) return ITEMS;
  const picked = ITEMS.filter((item) => item.id === only);
  if (picked.length === 0) throw new Error(`--only=${only}: expected one of ${ITEMS.map((i) => i.id).join(", ")}`);
  return picked;
}

/** The `usage:` and verdict lines of one item's output, for the closing summary. */
export function summaryLines(output) {
  return output
    .split("\n")
    .filter((line) => /^\s+· (usage:|PASS |FAIL |FINDING:|COST GUARD|evidence:)/.test(line) || /^(✅ PASS|❌ FAIL|⏭️\s+SKIP)\s/u.test(line))
    .map((line) => line.trimEnd());
}

/** `PASS`, `FAIL` or `SKIP` from an item's exit code (the UAT scripts exit 3 for a skip). */
export function verdictOf(code) {
  return code === 0 ? "PASS" : code === 3 ? "SKIP" : "FAIL";
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: FLYWHEEL_DIR, stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    const pass = (stream, sink) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        if (capture) output += chunk;
        sink.write(chunk);
      });
    };
    pass(child.stdout, process.stdout);
    pass(child.stderr, process.stderr);
    child.on("error", (error) => resolve({ code: 1, output: `${output}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main(argv) {
  const items = selectItems(argv);
  const dry = argv.includes("--dry-run");
  const steps = argv.includes("--skip-build") ? [] : buildSteps({ hasSidecarModules: fs.existsSync(path.join(FLYWHEEL_DIR, "packages", "sidecar", "node_modules")) });
  const artifactDir = process.env.FLYWHEEL_UAT_ARTIFACT_DIR ?? path.join(os.tmpdir(), "flywheel-uat-artifacts");

  process.stdout.write("Flywheel live proof (issue #1843)\n");
  process.stdout.write("  spends your Claude usage: about one short Story session, then one 18-command session\n");
  process.stdout.write("  works only in scratch folders under the OS temp directory; your board database, keychain and repositories are not touched\n");
  process.stdout.write(`  evidence files: ${artifactDir}\n`);
  for (const [command, args] of steps) process.stdout.write(`  build: ${command} ${args.join(" ")}\n`);
  for (const item of items) process.stdout.write(`  run:   node ${item.script}   (${item.label})\n`);
  if (dry) return 0;

  for (const [command, args] of steps) {
    process.stdout.write(`\n▸ ${command} ${args.join(" ")}\n`);
    const built = spawnSync(command, args, { cwd: FLYWHEEL_DIR, stdio: "inherit" });
    if (built.status !== 0) {
      process.stdout.write(`\nBUILD FAILED: ${command} ${args.join(" ")}. Nothing was spent.\n`);
      return 1;
    }
  }
  if (!argv.includes("--no-wait")) {
    process.stdout.write("\nStarting in 5 seconds. Press Ctrl-C now to stop before any token is spent.\n");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  const results = [];
  for (const item of items) {
    const failedBefore = results.some((r) => r.verdict === "FAIL");
    if (failedBefore && !argv.includes("--keep-going")) {
      results.push({ item, verdict: "NOT RUN", lines: [`not run: an earlier item failed (pass --keep-going to run it anyway)`] });
      continue;
    }
    process.stdout.write(`\n▸ ${item.label}\n`);
    const { code, output } = await run(process.execPath, [item.script], { capture: true });
    results.push({ item, verdict: verdictOf(code), lines: summaryLines(output) });
  }

  process.stdout.write("\n================ RESULT ================\n");
  for (const { item, verdict, lines } of results) {
    process.stdout.write(`RESULT  ${verdict.padEnd(7)} ${item.label}\n`);
    for (const line of lines) process.stdout.write(`${line.startsWith("  ") ? "" : "   "}${line}\n`);
  }
  process.stdout.write(`\nEvidence files (paste the RESULT block above into the issue): ${artifactDir}\n`);
  const verdicts = results.map((r) => r.verdict);
  return verdicts.includes("FAIL") || verdicts.includes("NOT RUN") ? 1 : verdicts.includes("SKIP") ? 3 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
