/**
 * D-55 (plan 03-07), rewritten by plan 03-19 (G-03-3): the backend's own `PreToolUse` hook. It is
 * the refusal layer for the class the shim (D-51) structurally cannot see — a destructive `git`/
 * `rm` invoked by ABSOLUTE PATH, which never resolves through the shim's own `PATH`-shadowed
 * directory at all — and the pass-through layer for the class the shim CAN see, deferring to the
 * shim's own permission socket (D-58) rather than pre-empting it. The question layer is the shim's
 * socket, never this hook.
 *
 * Before this plan, this hook denied every non-`safe` verdict unconditionally — refusing precisely
 * the set the shim's socket would otherwise have asked a human about, so D-58's indefinite block
 * was unreachable for anything the agent ran through Bash (G-03-3, measured live by
 * `scripts/uat/uat-03-destructive-gate.mjs`). It now has two branches instead of one:
 *
 * ```
 * category == "safe"                                → no opinion, exit 0   [unchanged]
 * category != "safe" && shimWillIntercept(program)   → no opinion, exit 0   [NEW — defers to the shim]
 * category != "safe" && !shimWillIntercept(program)   → deny with consequence copy   [unchanged]
 * ```
 *
 * `shimWillIntercept` (below) PROVES interception before deferring — it does not assume it. This
 * is the single most important property in this file: the hook is trading its own refusal for the
 * shim's question, and it may only do that when it can show the shim is actually there to ask. Any
 * failure to establish that is a `deny`, not an allow.
 *
 * **This script NEVER waits.** It reads its own stdin (already fully written by the backend
 * before invoking this hook — not a wait on a human decision), shells out to the shim binary's
 * own `--classify-invocation` mode (a pure, synchronous, socket-free classification —
 * `packages/shim/src/main.rs`), and exits. It never opens a socket, never polls and never sleeps
 * — a source gate (this plan's own `<verify>`, inherited from 03-07's) asserts this, because the
 * moment this script waits it becomes the exact kind of cancellable interception point
 * RESEARCH.md reproduced live: a `PreToolUse` hook that has not exited by its own configured
 * `timeout` (default 600s) is canceled by the backend and the tool call proceeds anyway, even
 * under an auto-accept permission mode. The shim, not this hook, is where D-58's indefinite block
 * lives; this hook's whole job is to be fast enough that its own timeout can never matter.
 *
 * **The wired decision value was MEASURED, not assumed** (RESEARCH.md Open Question 2;
 * `test/destructive-gate.test.mjs` is the checked-in, re-runnable form of this measurement). Both
 * `"deny"` and `"ask"` were run, live, against the real installed `claude` 2.1.236 binary in
 * headless streaming mode under `--permission-mode bypassPermissions` (auto-accept), each with a
 * `--settings`-injected `PreToolUse` hook returning that value for a harmless, observable command
 * (`touch` of a marker file): for BOTH values, the marker file was never created, and the
 * transcript's own `tool_result_meta` named the non-execution kind directly
 * (`"permission-rule"` for `deny`, `"user-rejected"` for `ask`) — neither ever surfaced a
 * consultation of a configured `--permission-prompt-tool`. Since neither defers to it, this hook
 * is wired to `"deny"`, the semantically direct value for an outright refusal, for the class it
 * alone refuses.
 *
 * **Fail-closed.** A payload this script cannot parse, a shim it cannot invoke, a verdict it
 * cannot read from the shim's stdout, or any uncertainty about whether the shim will intercept the
 * command all produce the destructive (`deny`) decision — never the permissive one.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { delimiter as pathDelimiter, dirname, join, resolve as resolvePath } from "node:path";

/** The exact kebab-case category names `destructive::DestructiveCategory::as_str()` mints
 * (`packages/core/src/destructive.rs`), mapped to the UI-SPEC's own consequence-copy wording
 * (`03-UI-SPEC.md` § "Destructive-action gate card") — the same sentences the destructive-action
 * gate card renders, so the agent receives the identical explanation a human would see on the
 * board. Branch-name interpolation ({branch}/{default_branch}) is omitted here: this hook has no
 * access to the project's git state, only the raw command text — the card itself (plan 03-12)
 * renders the fully-interpolated sentence for the human. */
const CONSEQUENCE_COPY: Record<string, string> = {
  "force-push": "This would force-push, overwriting commits already on the remote branch.",
  "branch-deletion": "This would delete a branch.",
  "default-branch-push": "This would push directly to the project's default branch.",
  "hard-reset": "This would discard uncommitted changes in the worktree — permanently.",
  "force-clean": "This would delete every untracked and ignored file in the worktree — permanently.",
  "history-rewrite": "This would rewrite commit history other work may depend on.",
  "recursive-delete": "This would recursively delete files or directories.",
  uncategorized:
    "Flywheel could not confidently classify this command as safe, so it is treated as destructive.",
};

/** The measured, wired decision value (see this module's own doc comment) — the ONE place this
 * hook's own permission decision is named, so a future re-measurement changes exactly one line. */
const WIRED_DECISION = "deny" as const;

function printDecision(decision: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(decision));
}

/**
 * PROVES — never assumes — that the shim (D-51) sits ahead of `program` on `PATH` and would
 * intercept a bare-name invocation of it. Returns `true` ONLY when ALL of the following hold, and
 * `false` the moment any cannot be established (plan 03-19's own most important property: this
 * hook is trading its own refusal for the shim's question, and it may only do that when it can
 * show the shim is actually there to ask):
 *
 * - `FLYWHEEL_SHIM_BIN` is set;
 * - its directory is the FIRST entry of `PATH` — `flywheel_core::shim::shim_env_for_run` prefixes
 *   exactly that directory onto `PATH` (D-51), so anything else means this is not the environment
 *   this hook was designed for;
 * - that directory contains an executable file named exactly `program` — the shadow entry
 *   `install_for_run` writes.
 *
 * This function itself never waits: `accessSync`/`statSync` are synchronous filesystem stat calls,
 * not a socket read and not a poll loop — this hook still never waits on anything (see this
 * module's own doc comment).
 */
function shimWillIntercept(program: string): boolean {
  const shimBin = process.env.FLYWHEEL_SHIM_BIN;
  if (!shimBin) return false;

  const pathValue = process.env.PATH;
  if (!pathValue) return false;
  const firstSegment = pathValue.split(pathDelimiter)[0];
  if (!firstSegment) return false;

  // `FLYWHEEL_SHIM_BIN`'s own directory must be that exact first PATH segment — not merely
  // "some directory on PATH" — mirroring `shim_env_for_run`'s PATH-prefix construction exactly.
  if (resolvePath(dirname(shimBin)) !== resolvePath(firstSegment)) return false;

  const candidate = join(firstSegment, program);
  try {
    accessSync(candidate, fsConstants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Fail closed: print the destructive decision, naming why this hook could not confirm safety,
 * and exit non-zero (mirrors the shipped shape RESEARCH.md's own verified session observed for a
 * genuine denial). */
function failClosed(reason: string): never {
  printDecision({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: WIRED_DECISION,
      permissionDecisionReason: `Flywheel could not verify this command was safe (${reason}) — refusing it.`,
    },
  });
  process.exit(2);
}

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

async function main(): Promise<void> {
  const raw = await readStdin();

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    failClosed("the hook payload on stdin did not parse as JSON");
  }

  const command = (payload as { tool_input?: { command?: unknown } } | null)?.tool_input?.command;
  if (typeof command !== "string" || command.length === 0) {
    failClosed("no tool_input.command string was present in the hook payload");
  }

  const shimBin = process.env.FLYWHEEL_SHIM_BIN;
  if (!shimBin) {
    failClosed("FLYWHEEL_SHIM_BIN is not set");
  }

  const result = spawnSync(shimBin, ["--classify-invocation", command], { encoding: "utf8" });
  if (result.error) {
    failClosed(`the shim binary could not be invoked: ${result.error.message}`);
  }

  const stdout = (result.stdout ?? "").trim();
  if (stdout.length === 0) {
    failClosed("the shim produced no classification verdict");
  }

  let classification: { category?: unknown; program?: unknown; invokedBareName?: unknown };
  try {
    classification = JSON.parse(stdout);
  } catch {
    failClosed("the shim's --classify-invocation output did not parse as JSON");
  }

  const category = classification.category;
  if (typeof category !== "string" || category.length === 0) {
    failClosed("the shim's --classify-invocation output carried no category");
  }

  if (category === "safe") {
    printDecision({});
    process.exit(0);
  }

  // NEW (plan 03-19, G-03-3): defer to the shim's own socket ONLY when interception is proven —
  // this is the branch that lets the destructive gate ASK a human instead of refusing outright.
  const program = classification.program;
  const invokedBareName = classification.invokedBareName === true;
  if (invokedBareName && typeof program === "string" && program.length > 0 && shimWillIntercept(program)) {
    printDecision({});
    process.exit(0);
  }

  const reason =
    CONSEQUENCE_COPY[category] ??
    `Flywheel classifies this as a destructive "${category}" operation.`;
  printDecision({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: WIRED_DECISION,
      permissionDecisionReason: reason,
    },
  });
  process.exit(2);
}

main();
