/**
 * The record of every stubborn process a sidecar test starts, and the one way to end them.
 *
 * WHY THIS EXISTS: `fake-claude.mjs` in its STUBBORN mode (and the grandchild it forks) ignores
 * SIGINT and never exits on its own. A test that fails, or never tracks the pid it needs, used to
 * leave both running. Flywheel's CI jobs run one after another in one VM, so the e2e job then
 * matched that leftover by its command line, machine-wide.
 *
 * The record is a pid file, not a process-table match: `fake-claude.mjs` appends its own pid and
 * its grandchild's pid to `FLYWHEEL_STUBBORN_PIDFILE`. Each test file gets its own file, so a
 * file's teardown ends only that file's processes (`node --test` runs files concurrently; a broad
 * match once ended a sibling file's live session). `scripts/check-no-stubborn-left.mjs` reads every
 * file of the suite after the run. Neither needs `ps`.
 *
 * Usage, at the top of a test file that starts a stubborn session:
 *   const stubborn = recordStubbornChildren(import.meta.url);
 *   after(() => stubborn.reap());
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The directory that holds one pid file per test file. `npm test` sets it; a lone `node --test
 * file` run falls back to a directory of its own. */
export function stubbornDir() {
  const dir = process.env.FLYWHEEL_STUBBORN_DIR ?? path.join(os.tmpdir(), "flywheel-stubborn-local");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** `true` if `pid` answers a zero-signal probe. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // exists, owned by someone else
  }
}

/** The pids a pid file lists. A missing file lists none. */
export function readPids(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").map(Number).filter((pid) => Number.isInteger(pid) && pid > 1);
}

/** SIGKILL each listed pid that is still alive, and its process group when it leads one (the
 * adapter and the watchdog spawn `detached`, so the session's pid is its group id). Returns the
 * pids that were alive. */
export function killSurvivors(file) {
  const alive = [];
  for (const pid of readPids(file)) {
    if (!isAlive(pid)) continue;
    alive.push(pid);
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // Gone in the gap, or not a group leader.
      }
    }
  }
  return alive;
}

/** Point this test process (and so every child it spawns) at its own pid file, and return the
 * file's teardown. Call once per test file, before any session starts. */
export function recordStubbornChildren(importMetaUrl) {
  const name = path.basename(fileURLToPath(importMetaUrl));
  const file = path.join(stubbornDir(), `${name}.pids`);
  fs.rmSync(file, { force: true });
  process.env.FLYWHEEL_STUBBORN_PIDFILE = file;
  return {
    file,
    /** End every recorded process still alive. Returns their pids. A no-op when none is. */
    reap: () => killSurvivors(file),
  };
}
