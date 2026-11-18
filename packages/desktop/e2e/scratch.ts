/**
 * The end of a flow's scratch root: stop everything that still runs on it, then remove it.
 *
 * Why it is not one `fs.rmSync`. On the gate (run 44204397397, 2026-11-18) a flow that had hit its own
 * timeout failed its teardown with `ENOTEMPTY: directory not empty, rmdir '.../run/app-data/runtime'`.
 * Ending the core does not end what the core started: the sidecar, and the agents it runs, are other
 * processes, and one of them was still writing into the folder the harness was removing. With two
 * workers on one Mac that race is more likely, not less.
 *
 * So the end has two steps, and neither may fail a test:
 *
 * 1. `reapProcesses` ends every process that belongs to the core: its process group (the core leads
 *    one, `detached` in `startCore`), its descendants, and any process whose command line holds the
 *    scratch folder's unique name. It waits until they are gone.
 * 2. `removeScratch` removes the folder, with retries for a writer that is still going, and, when it
 *    cannot, returns a message that names the process holding it. The caller keeps the folder and
 *    reports the message; a late writer is a finding about a process, not a failure of the flow.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  stat: string;
  command: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The rows of `ps -axo pid=,ppid=,pgid=,stat=,command=`. */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), stat: m[4]!, command: m[5]! });
  }
  return rows;
}

function processTable(): Promise<ProcessRow[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid=,pgid=,stat=,command="],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 32 << 20 },
      (err, stdout) => (err ? reject(err) : resolve(parseProcessTable(stdout))),
    );
  });
}

/**
 * The processes of a core, from one table: those in its process group, those whose command line holds
 * `marker` (the scratch folder's unique name, which every agent's command line carries) and everything
 * below either. A zombie is gone for this purpose: it holds nothing and only its parent can remove it.
 * `except` are never taken: the harness itself and the processes above it.
 */
export function ownedProcesses(
  rows: readonly ProcessRow[],
  by: { group: number | undefined; marker: string; except: ReadonlySet<number> },
): ProcessRow[] {
  const alive = rows.filter((r) => !r.stat.startsWith("Z") && !by.except.has(r.pid));
  const owned = new Set<number>(
    alive
      .filter((r) => (by.group !== undefined && r.pgid === by.group) || r.command.includes(by.marker))
      .map((r) => r.pid),
  );
  // A child of an owned process is owned, whatever group it moved to (an agent may lead its own).
  for (let grew = true; grew;) {
    grew = false;
    for (const r of alive) {
      if (!owned.has(r.pid) && owned.has(r.ppid)) {
        owned.add(r.pid);
        grew = true;
      }
    }
  }
  return alive.filter((r) => owned.has(r.pid));
}

/** The harness's own process and the chain above it: never taken, whatever their command line says. */
function ownChain(rows: readonly ProcessRow[]): Set<number> {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const chain = new Set<number>([process.pid]);
  for (
    let pid = byPid.get(process.pid)?.ppid;
    pid !== undefined && pid > 1 && !chain.has(pid);
    pid = byPid.get(pid)?.ppid
  ) {
    chain.add(pid);
  }
  return chain;
}

const describe = (r: ProcessRow) =>
  `pid ${r.pid} (${r.command.length > 140 ? `${r.command.slice(0, 139)}…` : r.command})`;

/**
 * End every process that belongs to the core and wait until none is left, killing again what is
 * forked meanwhile. Returns a description of each process still alive after `waitMs` (none, normally).
 */
export async function reapProcesses(by: {
  group: number | undefined;
  marker: string;
  waitMs?: number;
}): Promise<string[]> {
  const deadline = Date.now() + (by.waitMs ?? 10_000);
  for (;;) {
    let left: ProcessRow[];
    try {
      const rows = await processTable();
      left = ownedProcesses(rows, { group: by.group, marker: by.marker, except: ownChain(rows) });
    } catch (err) {
      return [`could not read the process table: ${String(err)}`];
    }
    if (left.length === 0) return [];
    if (Date.now() >= deadline) return left.map(describe);
    // The group first: one signal reaches what forks while the rows are read.
    if (by.group !== undefined) {
      try {
        process.kill(-by.group, "SIGKILL");
      } catch {
        // No such group any more.
      }
    }
    for (const r of left) {
      try {
        process.kill(r.pid, "SIGKILL");
      } catch {
        // Gone already.
      }
    }
    await sleep(100);
  }
}

/** The processes that hold `dir`: an open file or working directory in it (`lsof`), or its name in their command line. */
export async function holdersOf(dir: string, marker: string): Promise<string[]> {
  const found = new Map<number, string>();
  const byFile = new Promise<void>((resolve) => {
    // -F pcn: one `p<pid>`, `c<command>` and `n<name>` line for each open file under the directory.
    execFile(
      "lsof",
      ["-nP", "-F", "pcn", "+D", dir],
      { encoding: "utf8", timeout: 8_000, maxBuffer: 16 << 20 },
      (_err, stdout) => {
        // lsof exits 1 when it finds nothing: that is an answer, not a failure. A timeout leaves what it printed.
        let pid = 0;
        let command = "";
        for (const line of String(stdout ?? "").split("\n")) {
          if (line.startsWith("p")) pid = Number(line.slice(1));
          else if (line.startsWith("c")) command = line.slice(1);
          else if (line.startsWith("n") && pid > 0 && !found.has(pid))
            found.set(pid, `pid ${pid} (${command}) has ${line.slice(1)} open`);
        }
        resolve();
      },
    );
  });
  // The `lsof` above and the `ps` of this table carry the folder in their own command line. Neither holds it.
  const ownTools = (r: ProcessRow) => /^(\S*\/)?(lsof|ps)(\s|$)/.test(r.command);
  const byName = processTable()
    .then((rows) =>
      ownedProcesses(rows, { group: undefined, marker, except: ownChain(rows) }).filter((r) => !ownTools(r)),
    )
    .catch(() => [] as ProcessRow[]);
  const [, named] = await Promise.all([byFile, byName]);
  for (const r of named) if (!found.has(r.pid)) found.set(r.pid, describe(r));
  return [...found.values()];
}

/**
 * Remove a scratch folder. A writer that is still going recreates what the removal deleted, so the
 * removal is retried, a little longer each time. Never throws. Returns `null` when the folder is gone,
 * otherwise what went wrong and which process holds the folder: the caller keeps the folder and says so.
 */
export async function removeScratch(
  dir: string,
  // The removal itself, so a test can make it fail the way a late writer does.
  remove: (dir: string) => Promise<void> = (d) =>
    fs.promises.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
): Promise<string | null> {
  let failure: unknown;
  try {
    await remove(dir);
    return null;
  } catch (err) {
    failure = err;
  }
  const marker = dir.split("/").filter(Boolean).at(-1) ?? dir;
  const holders = await holdersOf(dir, marker);
  const code = (failure as { code?: string } | undefined)?.code ?? String(failure);
  return holders.length === 0
    ? `could not remove ${dir} (${code}), and no process was found holding it`
    : `could not remove ${dir} (${code}); still held by ${holders.join("; ")}`;
}
