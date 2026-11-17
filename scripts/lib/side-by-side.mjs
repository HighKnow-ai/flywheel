/**
 * Run commands side by side and print each one's output whole, in the order they were given (#1732).
 *
 * For checks that wait on timers and child processes and not on the CPU, such as the offline UAT scripts
 * (`scripts/uat/run-offline.mjs`) and the browser arms (`packages/desktop/scripts/run-browser-arms.mjs`): one
 * after another they took the sum of their waits, and side by side they take about the longest. A caller
 * answers for what its commands share, and these two give every command its own temporary directory, port
 * and cache. This module shares nothing between them: each child has its own pipes and its own output.
 *
 * A command is `{ argv: [executable, ...args], env?: {...}, label?: string }`. `env` is added to the
 * caller's environment for that command alone.
 */
import { spawn } from "node:child_process";
import os from "node:os";

/** How many commands run at once: FLYWHEEL_TEST_CONCURRENCY when it is a positive integer, else the cores. */
export function concurrency(env = process.env, cores = os.availableParallelism()) {
  const raw = Number(env.FLYWHEEL_TEST_CONCURRENCY);
  return Number.isInteger(raw) && raw > 0 ? raw : Math.max(1, cores);
}

/** The label of a command: its own, else its argv. */
export function labelOf(command) {
  return command.label ?? command.argv.join(" ");
}

/**
 * Run `commands` at most `limit` at a time, in the order given. Resolves to one result per command, in the
 * order given: `{ command, label, code, seconds, output }`, with stdout and stderr in one stream. A command
 * that cannot start has `code` -1; one a signal ended has `code` -2.
 */
export async function runAll(commands, { limit, cwd = process.cwd(), env = process.env, onDone = () => {} } = {}) {
  const results = new Array(commands.length);
  let next = 0;
  async function worker() {
    while (next < commands.length) {
      const index = next++;
      const command = commands[index];
      const [executable, ...args] = command.argv;
      const began = Date.now();
      const { code, output } = await new Promise((resolve) => {
        const chunks = [];
        const child = spawn(executable, args, {
          cwd: command.cwd ?? cwd,
          env: { ...env, ...command.env },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (c) => chunks.push(c));
        child.stderr.on("data", (c) => chunks.push(c));
        child.on("error", (err) => resolve({ code: -1, output: `could not start: ${err.message}\n` }));
        child.on("close", (exitCode, signal) =>
          resolve({
            code: exitCode ?? -2,
            output: Buffer.concat(chunks).toString("utf8") + (signal ? `\nkilled by ${signal}\n` : ""),
          }),
        );
      });
      results[index] = { command, label: labelOf(command), code, seconds: (Date.now() - began) / 1000, output };
      onDone(results[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit ?? commands.length, commands.length) }, worker));
  return results;
}

/** The log of the results: each command's output whole under a header, then one line per command. */
export function report(results) {
  const lines = [];
  for (const r of results) {
    lines.push(`::group::${r.label}  (exit ${r.code}, ${r.seconds.toFixed(1)} s)`);
    lines.push(r.output.replace(/\n+$/, ""));
    lines.push("::endgroup::");
  }
  lines.push("");
  for (const r of results) {
    const mark = r.code === 0 ? "ok  " : "FAIL";
    lines.push(`${mark} ${r.seconds.toFixed(1).padStart(6)} s  ${r.label}${r.code === 0 ? "" : `  (exit ${r.code})`}`);
  }
  return lines.join("\n") + "\n";
}

/** Run, print the report and say how many did not exit 0. The caller sets the process exit code from it. */
export async function runAndReport(name, commands, options = {}) {
  const limit = options.limit ?? concurrency();
  process.stdout.write(`${name}: ${commands.length} commands, ${limit} at a time\n`);
  const results = await runAll(commands, { ...options, limit });
  process.stdout.write(report(results));
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length > 0) {
    process.stderr.write(`${name}: ${failed.length} of ${results.length} did not exit 0\n`);
  }
  return failed.length;
}
