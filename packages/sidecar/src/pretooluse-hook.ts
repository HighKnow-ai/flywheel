/**
 * D-55 (plan 03-07), rewritten by plan 03-19 (G-03-3): the backend's own `PreToolUse` hook. It is
 * the refusal layer for the class the shim (D-51) structurally cannot see — a destructive `git`/
 * `rm` invoked by ABSOLUTE PATH, which never resolves through the shim's own `PATH`-shadowed
 * directory at all — and the pass-through layer for the class the shim CAN see, deferring to the
 * shim's own permission socket (D-58) rather than pre-empting it. The question layer is the shim's
 * socket, never this hook.
 *
 * Before plan 03-19, this hook denied every non-`safe` verdict unconditionally — refusing
 * precisely the set the shim's socket would otherwise have asked a human about, so D-58's
 * indefinite block was unreachable for anything the agent ran through Bash (G-03-3, measured live
 * by `scripts/uat/uat-03-destructive-gate.mjs`). Before plan 03-24, the `safe` arm below traded
 * NOTHING for that trust — it printed the empty decision unconditionally, while the non-safe arm
 * already demanded a two-fact proof before deferring. That asymmetry let eight ordinary launcher
 * shapes (`sh -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid`, `bash -c`) receive
 * STRICTLY LESS scrutiny than a bare `git push --force`
 * (`03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`, D-59). This hook now has four branches instead of two:
 *
 * ```
 * category == "safe" && !shimShadowDirectoryProven()                    → deny   [NEW, D-59/D-60]
 * category == "safe" && textCanShadow && namesGatedProgram              → deny   [NEW, D-61]
 * category == "safe" && !(textCanShadow && namesGatedProgram)           → no opinion, exit 0
 * category != "safe" && shimWillIntercept(program)                      → no opinion, exit 0
 * category != "safe" && !shimWillIntercept(program)                     → deny with consequence copy
 * ```
 *
 * The FIRST row applies regardless of `category` in spirit but is only reachable from the `safe`
 * arm here — the non-safe arm's own `shimWillIntercept` call below is the environment proof for
 * ITS branch. An unproven shim shadow directory therefore denies every command that reaches
 * either branch, harmless ones included (D-60): a broken/missing shim install is a hard
 * precondition failure, not a session that silently denies everything with no named cause — the
 * spawn-side loud-failure obligation that goes with this lives in `packages/core/src/shim.rs`.
 *
 * **An unreported or non-boolean-`false` field is read as `true` (unsafe).** A shim binary older
 * than plan 03-24 that never emits `textCanShadowPathResolution`/`namesGatedProgram` therefore
 * denies rather than silently defers — the same fail-closed discipline this file already applies
 * to every other unparseable or absent fact.
 *
 * Deferring on a NON-safe verdict correctly requires TWO separate facts to both hold, proved by
 * TWO separate pieces of code that can each only see their own half (plan 03-20/CR-01, closing a
 * bypass this split left open): the shim's own `--classify-invocation` classifier proves the
 * command TEXT can still reach a real `PATH` search at all — reported here as `invokedBareName` —
 * since bash resolves shell functions, aliases and a `PATH` reassignment BEFORE ever performing
 * that search, and a command that shadows the program name that way defeats it regardless of what
 * this hook's own environment looks like. `shimWillIntercept` (below) proves the ENVIRONMENT: that
 * the shim's shadow directory is actually installed and leads `PATH` right now. Only
 * `invokedBareName === true` AND `shimWillIntercept(program)` together justify deferring; this
 * hook checks `invokedBareName` itself (see `main()` below) precisely because `shimWillIntercept`
 * alone cannot see the text half of the proof. Any failure to establish either half is a `deny`,
 * not an allow. This function proves the SAME kind of environment fact, `shimShadowDirectoryProven`
 * above, for the SAFE arm (D-59) — two call sites, one underlying check.
 *
 * This hook still never waits: the environment proof costs two synchronous `stat` calls in a
 * correctly configured session (`shimWillIntercept`'s own doc comment) — no socket, no poll, no
 * sleep, in either arm.
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
 * PROVES — never assumes — that the shim's (D-51) OWN SHADOW DIRECTORY is installed and leads
 * `PATH` right now. This is only HALF of what "the shim will intercept this invocation" requires,
 * and the caller must hold the other half too (plan 03-20/CR-01): the shim's own
 * `--classify-invocation` classifier proves the TEXT property — that nothing in the raw command
 * text (a shell function/alias/hash-table definition shadowing the name, an `eval`/`source` pulling
 * in a definition, or a `PATH` reassignment) can pre-empt bash's name resolution before it ever
 * reaches a `PATH` search at all — reported as `invokedBareName`. This function proves the
 * ENVIRONMENT property — that if bash's resolution DOES reach a `PATH` search, the shim's shadow is
 * actually sitting there to be found. Bash resolves shell functions and aliases BEFORE it ever
 * performs a `PATH` search, so a command that defines a function or alias named `program` in the
 * same text can satisfy this function's environment check and still never reach the shim at all —
 * which is exactly why the caller must require BOTH facts, not just this one, before deferring
 * (plan 03-19's own most important property, unchanged: the hook is trading its own refusal for the
 * shim's question, and it may only do that when it can show the shim is actually there to ask).
 *
 * Returns `true` ONLY when ALL of the following hold, and `false` the moment any cannot be
 * established:
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

/** The shadow witness entry name the safe branch's environment proof stats — mirrors
 * `shimBinFromEnv`'s own platform convention in `claude-code-adapter.ts` exactly, so both files
 * agree on which name a correctly-installed shim directory must carry (plan 03-24, D-59). */
const SHADOW_WITNESS_ENTRY_NAME = process.platform === "win32" ? "git.exe" : "git";

/**
 * D-59/D-60 (plan 03-24): PROVES — never assumes — that the shim's (D-51) own shadow directory is
 * installed and leads `PATH` right now, for the SAFE branch. A thin named wrapper over
 * `shimWillIntercept(SHADOW_WITNESS_ENTRY_NAME)` — introduces no new mechanism: it is the SAME two
 * synchronous `accessSync`/`statSync` calls the non-safe branch already pays, applied to the safe
 * branch for the first time. `git`/`git.exe` is used as the witness entry because
 * `install_for_run` always installs it (unlike `rm`, which the safe branch's own command text may
 * never mention), so its presence proves the shadow directory itself, independent of which
 * program (if any) the safe command names.
 */
function shimShadowDirectoryProven(): boolean {
  return shimWillIntercept(SHADOW_WITNESS_ENTRY_NAME);
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

  let classification: {
    category?: unknown;
    program?: unknown;
    invokedBareName?: unknown;
    textCanShadowPathResolution?: unknown;
    namesGatedProgram?: unknown;
  };
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
    // Step 1 (D-59/D-60): the safe branch now proves the SAME environment fact the non-safe
    // branch already proves below, before it trusts a "safe" verdict at all. An unprovable
    // environment denies EVERY command, harmless ones included — the misconfigured-session case
    // is exactly where this refusal layer is the only one left standing.
    if (!shimShadowDirectoryProven()) {
      failClosed("the shim's shadow directory could not be proven installed and leading PATH");
    }

    // Step 2 (D-61): a value that is not the boolean `false` is read as `true` — an older shim
    // that does not report a field must be treated as unprovable, never as safe. Only when the
    // text can BOTH pre-empt PATH resolution AND name a program this shim gates is safety
    // unprovable; deny only then, so ordinary `source`/`eval` that name neither stay deferrable.
    const textCanShadow = classification.textCanShadowPathResolution !== false;
    const namesGatedProgram = classification.namesGatedProgram !== false;
    if (textCanShadow && namesGatedProgram) {
      failClosed(
        "this command's text can pre-empt PATH resolution and names a program Flywheel gates, so its safety cannot be proven",
      );
    }

    // Step 3: both facts clear — defer.
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
