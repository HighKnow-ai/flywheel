/**
 * Phase 12 plan 12-03 (ROADMAP fork branch 1) — the `SessionStart` hook: writes the shim's shadow
 * directory onto `PATH` via `$CLAUDE_ENV_FILE`, Claude Code's own documented mechanism for
 * persisting an environment change across every subsequent `Bash` call in a session
 * (`code.claude.com/docs/en/hooks`, "CLAUDE_ENV_FILE" section — the official worked example is
 * literally a PATH prepend: `echo 'export PATH="$PATH:./node_modules/.bin"' >> "$CLAUDE_ENV_FILE"`).
 * `CLAUDE_ENV_FILE` is scoped to `SessionStart`/`Setup`/`CwdChanged`/`FileChanged` hooks only — it
 * is NOT available inside `PreToolUse`, which is why this is a second, independent hook
 * registration (`writeHookSettings`'s new `SessionStart` key, below) rather than an addition to
 * `pretooluse-hook.ts`.
 *
 * **Derivation, not a second guess:** the shim directory is `dirname(process.env.FLYWHEEL_SHIM_BIN)`
 * — the SAME derivation `shimWillIntercept` (`pretooluse-hook.ts`) already uses to prove the
 * environment for the `PreToolUse` hook, never a second, independently-computed path.
 *
 * **`[CITED]`, not `[VERIFIED]` (12-RESEARCH.md).** Whether `CLAUDE_ENV_FILE` is actually sourced
 * AFTER the shell snapshot — the ordering this whole mechanism depends on — is not proven by
 * anything in this repository. It is measured live by `scripts/uat/uat-11-env-file-ordering.mjs`
 * (plan 12-05), never by an offline test here. Two caveats, named rather than smoothed over:
 * `anthropics/claude-code#27987` reports the file being written but never sourced for subsequent
 * Bash commands on some Windows builds (unconfirmed on macOS, this product's target platform);
 * `anthropics/claude-code#19357` records a still-open contradiction between Anthropic's own
 * Settings guide and Hooks guide about this variable's role, closed "not planned", no maintainer
 * resolution.
 *
 * **Why this hook's failure mode is a silent no-op, deliberately NOT `pretooluse-hook.ts`'s
 * fail-closed deny.** That hook denies on any uncertainty because it makes a permission decision —
 * letting an unproven environment through would silently widen the destructive-action gate. This
 * hook makes NO decision at all; its only effect is a best-effort PATH restoration. A throw here
 * would surface as a `SessionStart` hook error and could abort session startup, turning a
 * best-effort improvement into an outage — a far worse outcome than leaving today's unreliable PATH
 * premise exactly as unreliable as it already is (`docs/destructive-gate-trust-boundary.md`'s
 * "## Round ten"). Do NOT "fix" this into fail-closed by analogy with its sibling hook; the two have
 * no permission decision in common to be consistent about. The whole body below is wrapped in one
 * try/catch whose catch swallows to a silent no-op — no throw, no stdout, no stderr, exit 0.
 */
import { appendFileSync } from "node:fs";
import { delimiter as pathDelimiter, dirname } from "node:path";

function main(): void {
  try {
    const envFile = process.env.CLAUDE_ENV_FILE;
    const shimBin = process.env.FLYWHEEL_SHIM_BIN;
    // Both must be present: without FLYWHEEL_SHIM_BIN there is no directory to prepend, and
    // inventing one would be worse than doing nothing (this task's own <behavior> contract).
    if (!envFile || !shimBin) {
      return;
    }
    const shimDir = dirname(shimBin);
    // Quoted so a shim directory containing a space survives; `$PATH` left as a literal,
    // unexpanded reference so the SOURCING shell expands it, never this process.
    const line = `export PATH="${shimDir}${pathDelimiter}$PATH"\n`;
    appendFileSync(envFile, line);
  } catch {
    // Silent no-op (see module doc above): a best-effort PATH restoration must never abort
    // session startup. Nothing is written to stdout or stderr.
  }
}

main();
process.exitCode = 0;
