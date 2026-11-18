#!/usr/bin/env node
/**
 * The exit-test preflight (issue #1600): run before day 1 of the one-week attempt.
 *
 *   node flywheel/scripts/exit-test/preflight.mjs --project <other counted repo> [--project ...]
 *       --backup <copy of flywheel.db> [--db <flywheel.db>] [--skip-build]
 *
 * `<monorepo>/flywheel` (this folder's project) is always counted. Prints a green/red table and exits 1 when
 * any row is red. Read-only: the board DB is opened read-only, the keychain is never touched, and the only
 * writes are build output and a temp directory removed again. What it cannot check, the owner does
 * (flywheel/docs/exit-test/attempt-2.md): run one Story end to end in the app.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { checkBoard, checkBuild, checkClaude, checkClaudeConfigDir, checkDropBacks, checkProjects, checkShim, defaultDbPath, renderTable } from "./preflight-checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const flywheelDir = path.resolve(here, "..", "..");

const { values } = parseArgs({
  options: {
    project: { type: "string", multiple: true },
    backup: { type: "string" },
    db: { type: "string" },
    "skip-build": { type: "boolean" },
  },
});

const dbPath = path.resolve(values.db ?? defaultDbPath());
const projects = [...new Set([flywheelDir, ...(values.project ?? []).map((p) => path.resolve(p))])];

const results = [];
results.push(checkBuild({ flywheelDir, skip: values["skip-build"] }));
results.push(checkBoard({ dbPath, backupPath: values.backup ? path.resolve(values.backup) : undefined }));
results.push(await checkProjects({ projects, flywheelProject: flywheelDir, dbPath }));
results.push(checkDropBacks({ flywheelProject: flywheelDir, scriptPath: path.join(here, "drop-backs.mjs") }));
results.push(checkShim({ flywheelDir }));
results.push(checkClaude({ flywheelDir }));
results.push(checkClaudeConfigDir());

console.log(renderTable(results));
const failed = results.filter((r) => r.status === "red").length;
console.log(failed ? `\n${failed} red: fix them before day 1.` : "\nNo red rows.");
process.exit(failed ? 1 : 0);
