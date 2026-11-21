#!/usr/bin/env node
/**
 * The offline UAT of CI's `uat` job (docs/mvp-spec.md section 9): zero tokens, no `claude` binary, no
 * credentials. Runs every script of OFFLINE_SCRIPTS side by side (`scripts/lib/side-by-side.mjs`) and prints
 * each one's output whole, in the order of the list, so the log reads as it did when they ran one after
 * another.
 *
 * WHY SIDE BY SIDE (#1732). The scripts spend their time waiting on timers and child processes (a heartbeat
 * window, a sidecar's start, a Rust harness binary's reply), not on the CPU, so seven of them one after
 * another took the sum of their waits. They share nothing: each one makes its own `mkdtemp` root
 * (`flywheel-uat-<label>-XXXXXX` under `os.tmpdir()`: its app-data dir, worktree root and runtime dir),
 * starts its own sidecar and harness processes, binds no port, and reads only the build the job made before
 * this runs (`packages/sidecar/dist`, `target/debug/*`). No script reads the real `$HOME` (the live scripts,
 * which are not here, are the ones that read `~/.claude`).
 *
 * At most FLYWHEEL_TEST_CONCURRENCY scripts run at once (the gate sets it to the cores its checks really
 * get; unset, it is the machine's cores), so a runner with few cores does not turn a script's own deadline
 * into a failure.
 *
 * Exit 0 only when every script exits 0. A SKIP exits 3 and fails this run, as it did before: a script
 * that cannot run is not one that passed.
 *
 *   node scripts/uat/run-offline.mjs            run every script
 *   node scripts/uat/run-offline.mjs --list     print the commands and run nothing
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAndReport } from "../lib/side-by-side.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The scripts of CI's step "Offline UAT", with their arguments, in the order the log prints them. */
export const OFFLINE_SCRIPTS = [
  ["scripts/uat/harness-supervision-gate.mjs", "--mode=supervised"],
  ["scripts/uat/harness-supervision-gate.mjs", "--mode=unsupervised"],
  ["scripts/uat/uat-12-fleet-live-reads.mjs"],
  ["scripts/uat/uat-16-epic-shaping.mjs"],
  ["scripts/uat/uat-17-roadmap-round.mjs"],
  ["scripts/uat/uat-18-execution-proposals.mjs"],
  ["scripts/uat/uat-19-board-and-review.mjs"],
  ["scripts/uat/uat-20-live-story-session.mjs", "--fake"],
];

/** The commands `node` runs for OFFLINE_SCRIPTS. */
export function offlineCommands(node = process.execPath) {
  return OFFLINE_SCRIPTS.map((script) => ({ argv: [node, ...script], label: `node ${script.join(" ")}` }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--list")) {
    for (const c of offlineCommands("node")) process.stdout.write(`${c.label}\n`);
  } else if ((await runAndReport("offline UAT", offlineCommands(), { cwd: REPO_ROOT })) > 0) {
    process.exitCode = 1;
  }
}
