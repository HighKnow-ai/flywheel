/**
 * D-151 (phase 09, plan 09-01): the file-set scope gate. A standalone Node entry point invoked per
 * matched `PreToolUse` call — `writeHookSettings`'s third entry (`claude-code-adapter.ts`),
 * matching `SCOPE_GATE_MATCHER` (`Write|Edit|MultiEdit|NotebookEdit`). The structure is
 * `stage-gate-hook.ts`'s: the hook payload is read from stdin and fully drained before anything is
 * decided; THIS session's `FLYWHEEL_RUN_ID` / `FLYWHEEL_RUNTIME_DIR` come from the hook's own
 * environment and never from the payload (a payload is model-adjacent data; a spoofed identity in it
 * must never be able to name another run's state — T-09-01-03); and the per-run marker
 * `<runtimeDir>/scope/<runId>.json` is read FRESH on every call with no cache, which is what makes a
 * live widen (D-152) take effect on the agent's very next tool call with no restart.
 *
 * **The containment decision is not made here.** This hook shells to the shim's `--scope-check`, so
 * the predicate "is this path covered by the declared set" has exactly ONE implementation
 * (`packages/core/src/file_set.rs`), shared with every plan-time overlap check. A second copy in
 * TypeScript would let a plan-time verdict and a run-time verdict drift apart — the failure class this
 * phase exists to prevent. The shim prints `unarmed`, `allow`, or `deny`:
 *
 * - `unarmed` — the task declared nothing (D-150): no opinion, print `{}`, exit 0.
 * - `allow`   — the resolved path is covered by a declared entry: print `{}`, exit 0.
 * - anything else — including a shim that cannot be spawned, exits non-zero, or prints a line that
 *   does not parse, an absent / unreadable / unrecognised-version marker, a missing run identity, a
 *   payload that does not parse, and a matched tool whose input carries no string target path —
 *   DENIES.
 *
 * **Fail closed — and the one place this hook must NOT copy `stage-gate-hook.ts`.** That file ends in
 * a bare `main();`, so a throw inside it exits 1, and a `PreToolUse` hook that exits with any status
 * other than 2 lets the tool call PROCEED. That was measured live against the installed `claude`
 * (09-RESEARCH.md M2: a hook that threw let the `Write` succeed). So here `main` is wrapped in a
 * try/catch, the invocation carries a `.catch`, and `uncaughtException` / `unhandledRejection`
 * handlers are installed — every one of those paths prints the deny decision and exits 2. The deny
 * body is the proven shape: `permissionDecision: "deny"` plus exit code 2 blocks the write even under
 * `bypassPermissions` and `acceptEdits` (M1); the live test extends that to all four accepted modes.
 *
 * **No `timeout` on the settings entry that wires this hook.** A timed-out `PreToolUse` hook does not
 * block the call, so a short timeout would be a silent bypass; this hook keeps its own work bounded
 * instead (one synchronous shim spawn, no socket, no poll, no sleep).
 *
 * **What this guarantees and what it does not.** It prevents writes made through the file-writing
 * tools. A write made through `Bash` (`echo >`, `sed -i`, an installer touching a lockfile) never
 * matches this hook; that gap is detective, not preventive, and is covered by plan 09-02's
 * session-close backstop.
 *
 * **The refusal reason discloses only the refused path (made repository-relative by the shim) and the
 * refused run's OWN declared entries, truncated to the first 20 with a count of the remainder.** It
 * carries nothing from any other run: no other run's set, no task title, no worktree path
 * (T-09-01-07).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** The measured, wired decision value — the one place this hook's own permission decision is named. */
const WIRED_DECISION = "deny" as const;

/** A stable token every refusal carries so a test, a notice, or a backstop can recognise it. */
const REASON_PREFIX = "FLYWHEEL-SCOPE:";

/** How many declared entries a refusal lists before it summarises the rest. */
const MAX_ENTRIES_SHOWN = 20;

/** Tools that carry their target in `notebook_path`; every other matched tool uses `file_path`. */
const NOTEBOOK_TOOL = "NotebookEdit";

/** The characters a run id may contain when it becomes a file name: no separator, no dot. */
const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

/** Print the deny decision and exit 2. Never throws, never returns: this is the last line of
 * defence for every failure path, so a failure to WRITE the decision still exits 2. */
function deny(reason: string): never {
  try {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: WIRED_DECISION,
          permissionDecisionReason: `${REASON_PREFIX} ${reason}`,
        },
      }),
    );
  } catch {
    // The exit code below is what blocks the call; there is nothing further to do.
  }
  process.exit(2);
}

function allow(): never {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

process.on("uncaughtException", (err) => deny(`the scope hook failed internally (${String(err)}) — refusing the write`));
process.on("unhandledRejection", (err) => deny(`the scope hook failed internally (${String(err)}) — refusing the write`));

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

/** The target path a matched tool call is about to write, or `undefined` when the input carries no
 * non-empty string where the tool keeps it. */
function targetPathOf(toolName: unknown, toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const input = toolInput as Record<string, unknown>;
  const value = toolName === NOTEBOOK_TOOL ? input.notebook_path : input.file_path;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The refusal text the agent reads back as a tool result. */
function refusalReason(decision: Record<string, unknown>): string {
  const relative = typeof decision.relative === "string" ? decision.relative : "(unresolved path)";
  const entries = Array.isArray(decision.entries)
    ? decision.entries.filter((e): e is string => typeof e === "string")
    : [];
  const shown = entries.slice(0, MAX_ENTRIES_SHOWN).join(", ");
  const more = entries.length > MAX_ENTRIES_SHOWN ? ` and ${entries.length - MAX_ENTRIES_SHOWN} more` : "";
  const where = decision.outsideWorktree === true ? "outside this task's worktree" : "outside this task's declared file-set";
  return (
    `${relative} is ${where} [${shown}${more}]. Stay within the declared file-set; if the task genuinely ` +
    `needs another file, say so in your summary instead of editing it.`
  );
}

async function main(): Promise<void> {
  // Drained fully before any decision (the `pretooluse-hook.ts` / `stage-gate-hook.ts` discipline).
  const raw = await readStdin();

  // Identity: this hook's OWN environment, never the stdin payload (T-09-01-03).
  const runId = process.env.FLYWHEEL_RUN_ID;
  if (!runId) return deny("FLYWHEEL_RUN_ID is not set, so the declared file-set cannot be established");
  if (!SAFE_RUN_ID.test(runId)) return deny("FLYWHEEL_RUN_ID is not a plain run identifier");
  const runtimeDir = process.env.FLYWHEEL_RUNTIME_DIR;
  if (!runtimeDir) return deny("FLYWHEEL_RUNTIME_DIR is not set, so the declared file-set cannot be established");
  const shimBin = process.env.FLYWHEEL_SHIM_BIN;
  if (!shimBin) return deny("FLYWHEEL_SHIM_BIN is not set, so the declared file-set cannot be checked");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return deny("the hook input on stdin did not parse as JSON");
  }
  const call = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const target = targetPathOf(call.tool_name, call.tool_input);
  if (target === undefined) return deny("the tool call carried no target path to check");

  const markerPath = join(runtimeDir, "scope", `${runId}.json`);
  const result = spawnSync(shimBin, ["--scope-check", markerPath, target], { encoding: "utf8" });
  if (result.error) return deny(`the shim could not be invoked: ${result.error.message}`);
  if (result.status !== 0) return deny("the scope check could not establish this task's declared file-set");

  let decision: Record<string, unknown>;
  try {
    decision = JSON.parse((result.stdout ?? "").trim()) as Record<string, unknown>;
  } catch {
    return deny("the scope check produced no readable decision");
  }

  switch (decision.decision) {
    case "unarmed":
    case "allow":
      return allow();
    case "deny":
      return deny(refusalReason(decision));
    default:
      return deny("the scope check produced an unrecognised decision");
  }
}

try {
  main().catch((err) => deny(`the scope hook failed internally (${String(err)}) — refusing the write`));
} catch (err) {
  deny(`the scope hook failed internally (${String(err)}) — refusing the write`);
}
