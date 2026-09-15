/**
 * D-55 (plan 03-07) — the backend's own `PreToolUse` hook: a fast, synchronous classifier that
 * fires BEFORE the backend's `--permission-prompt-tool` machinery is ever consulted (Phase 2's
 * 02-05 finding), covering what the shim (D-51) structurally cannot see — a destructive `git`/
 * `rm` invoked by absolute path, which never resolves through the shim's own `PATH`-shadowed
 * directory at all.
 *
 * **This script NEVER waits.** It reads its own stdin (already fully written by the backend
 * before invoking this hook — not a wait on a human decision), shells out to the shim binary's
 * own `--classify-command` mode (a pure, synchronous, socket-free classification —
 * `packages/shim/src/main.rs`), and exits. It never opens a socket, never polls and never sleeps
 * — a source gate (this plan's own `<verify>`) asserts this, because the moment this script waits
 * it becomes the exact kind of cancellable interception point RESEARCH.md reproduced live:
 * a `PreToolUse` hook that has not exited by its own configured `timeout` (default 600s) is
 * canceled by the backend and the tool call proceeds anyway, even under an auto-accept permission
 * mode. The shim, not this hook, is where D-58's indefinite block lives; this hook's whole job is
 * to be fast enough that its own timeout can never matter.
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
 * is wired to `"deny"`, the semantically direct value for an outright refusal (per this plan's own
 * decision rule for the "neither defers" outcome). This means this hook is a REFUSAL layer, not a
 * QUESTION layer, for the narrow class of commands only it (not the shim) can see — a real, named
 * residual gap recorded in this plan's own SUMMARY, not a silently-claimed "always asks."
 *
 * **Fail-closed.** A payload this script cannot parse, a shim it cannot invoke, or a verdict it
 * cannot read from the shim's stdout all produce the destructive (`deny`) decision — never the
 * permissive one.
 */
import { spawnSync } from "node:child_process";

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

  const result = spawnSync(shimBin, ["--classify-command", command], { encoding: "utf8" });
  if (result.error) {
    failClosed(`the shim binary could not be invoked: ${result.error.message}`);
  }

  const verdict = (result.stdout ?? "").trim();
  if (verdict.length === 0) {
    failClosed("the shim produced no classification verdict");
  }

  if (verdict === "safe") {
    printDecision({});
    process.exit(0);
  }

  const reason =
    CONSEQUENCE_COPY[verdict] ??
    `Flywheel classifies this as a destructive "${verdict}" operation.`;
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
