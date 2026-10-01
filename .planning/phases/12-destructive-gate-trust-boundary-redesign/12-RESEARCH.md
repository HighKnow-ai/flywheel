# Phase 12: Destructive-gate trust boundary redesign - Research

**Researched:** 2026-10-01
**Domain:** Process supervision / agent sandboxing trust boundary (Claude Code `PreToolUse` hooks, shell-snapshot PATH resolution, git-native hook interception)
**Confidence:** MEDIUM — the central design fork is now answerable from official documentation and primary-source evidence (GitHub issue tracker, git-scm.com) without spending a credential, but one half of it (`CLAUDE_ENV_FILE` ordering on THIS machine, THIS Claude Code version) is still only CITED, not VERIFIED, and carries one documented reliability caveat (a Windows bug, not yet observed to affect macOS) that argues for a live falsification run before the planner treats it as settled.

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped to Phase 12 in `.planning/REQUIREMENTS.md` — the roadmap entry itself states `**Requirements**: TBD`. This phase does not add a new capability; it repairs the trust boundary underneath **AGNT-07** ("Destructive actions … always require explicit confirmation, even when the session is running in an auto-accept permission mode"), which `REQUIREMENTS.md` already marks Complete (Phase 3) on the strength of a gate this phase's own debug session proved is currently bypassable. The planner should not invent a new REQ-ID; if this phase needs a traceability row, it is a **re-verification of AGNT-07's acceptance**, not a new requirement.
</phase_requirements>

## Summary

The phase description frames a single unanswered question — does Claude Code's `--settings` `env` block apply after the shell snapshot is sourced — as the fork's only missing input. Official documentation answers a related but more useful question directly, without a live run: **the plain `env` block in a settings file does NOT survive the snapshot** (the snapshot's trailing `export PATH=…` is sourced *after* process-environment setup and wins), but Claude Code ships a **different, purpose-built mechanism for exactly this problem** — `CLAUDE_ENV_FILE`, available to `SessionStart` (and `Setup`/`CwdChanged`/`FileChanged`) hooks, whose official example is *literally* `echo 'export PATH="$PATH:./node_modules/.bin"' >> "$CLAUDE_ENV_FILE"`, and whose documented contract ("Variables written to that file persist into subsequent Bash commands for the session") only makes sense if it is sourced after the snapshot on every Bash call. This is `[CITED: code.claude.com/docs/en/hooks]`, not `[VERIFIED]` — Anthropic's own docs contradict each other about this file's role (a known, open GitHub issue), a known Windows bug shows it silently failing to re-apply on some builds, and no test in this repository or this session exercises it against the real `claude 2.1.274` binary installed on this machine. It is the right candidate to spend the next live credential on, but it is a *different* mechanism than the roadmap's literal "`--settings` env block" phrasing, and the planner should fund a SessionStart-hook spike, not a settings-file-env spike.

Independently of that question, this research surfaces a **second, PATH-independent interception point that is not in the roadmap's two-branch fork at all**: git's own `pre-push` hook (`core.hooksPath`), installed once per registered project (it is shared by every linked worktree by default — the exact git config file every worktree of a repo reads unless `extensions.worktreeConfig` is explicitly enabled, which this codebase does not do). A `pre-push` hook receives the local/remote ref and object-name pairs for every ref being pushed **on `git`'s own stdin protocol, straight from the real `git` binary that actually runs the push** — not from PATH resolution, not from a shell snapshot, not from anything the developer's login shell can reorder. It can detect a branch deletion (local object-name is all-zeroes) and a force-push (the push updates a ref whose remote object-name is not an ancestor of the new local object-name) and exit non-zero to abort the push outright, before any data reaches the remote `[CITED: git-scm.com/docs/githooks]`. This closes the **specific, measured incident** (`git push origin --delete uat-doomed-branch` reaching a real remote) at a layer immune to the exact failure class that burned round ten (PATH/shell-init non-determinism), independent of whether `CLAUDE_ENV_FILE` pans out. Its own residual is different in kind, not degree: it is bypassable only by a *deliberate* `git -c core.hooksPath=… push` or a deliberate `git config core.hooksPath` rewrite — not by an ordinary `mise`/`zinit` shell-init side effect — and it does not cover `rm` (a worktree-local, non-remote-reaching destructive action, already lower severity, already covered — imperfectly, as a friction cost, not an exposure — by the existing PATH shim).

**Primary recommendation:** pursue both, because they close different halves of the hole and neither alone is sufficient — (1) install a `pre-push` git hook via `core.hooksPath` at project-registration time (`BOARD-10`'s existing code path) to close the **measured, remote-reaching** incident at a layer the login shell cannot touch, verifiable entirely offline; and (2) spike a `SessionStart` hook writing to `CLAUDE_ENV_FILE` as the cleaner, general-purpose replacement for the PATH-shim's own P1 premise, bundled into the next live UAT pass with the exact falsification command specified below (Open Question section). Do **not** re-attempt round ten's approach (proving P1 from inside the `PreToolUse` hook by reading shell snapshots) — it is the one structural option this research found zero new evidence to resurrect, and the trust-boundary document already states, correctly, that it is not achievable by any mechanism Flywheel currently controls.

## Architectural Responsibility Map

This phase operates within an existing agent-supervision stack, not a typical web-app tier model. Capabilities map onto Flywheel's own five mechanical layers plus one newly-surfaced layer this research adds:

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shim binary install, shadow directory materialisation | Rust core (`packages/core/src/shim.rs`, Layer 0) | — | One-time, pre-spawn, proven exactly once; unaffected by this phase |
| Per-session environment composition (`PATH` prefix, `CLAUDE_CONFIG_DIR`, future `SessionStart` hook / `CLAUDE_ENV_FILE` wiring) | Node sidecar (`packages/sidecar/src/claude-code-adapter.ts`) | Rust core (supplies the shim directory `shim_env_for_run` computed) | The sidecar owns argv/env construction for the spawned `claude` child process — this is where any new hook registration (SessionStart) must be wired, mirroring `writeHookSettings`'s existing pattern |
| Pre-execution text classification (`PreToolUse` hook) | Node sidecar (`packages/sidecar/src/pretooluse-hook.ts`, Layer 1) | — | Fast, synchronous, never waits; this phase does **not** add new logic here — round ten already proved this layer cannot safely re-derive the executing shell's PATH |
| Runtime interception of a resolved `git`/`rm` invocation | OS process (`packages/shim/src/main.rs`, Layer 2) | — | Only reachable when the real `PATH` search lands on the shadow directory; this is precisely the premise this phase cannot make reliable through PATH alone |
| **NEW — remote-reaching git-operation interception independent of PATH** | Git itself, via `core.hooksPath` (a new `packages/core` responsibility, installed at project-registration / worktree-creation time) | Rust core (install-time, alongside `WORK-01`'s worktree creation) | Git consults its own hook configuration when the **real, already-resolved** `git` binary runs — this is the one interception point in the whole stack that a shell's `PATH` reordering cannot touch at all, because it never goes through a `PATH` search a second time once `git` itself is running |
| Human-in-the-loop blocking question | Shim's permission socket (Layer 2) via `--permission-prompt-tool` MCP server | — | Unaffected by this phase; remains the only layer that can genuinely wait indefinitely (`D-58`) |

## Standard Stack

No new external package is required by either fork option. `CLAUDE_ENV_FILE` is a Claude Code CLI/hook convention consumed through the **same** `--settings` JSON + spawnable-script pattern `writeHookSettings` already uses for the `PreToolUse` entry (`packages/sidecar/src/claude-code-adapter.ts:187-214`) — a `SessionStart` hook is just another entry in the same `hooks` object, pointed at a new Node script alongside `pretoolUseHookScriptPath()`. `core.hooksPath` is a native git mechanism, configured via the system `git` CLI this repository already shells out to for worktree lifecycle operations (per this project's own CLAUDE.md stack decision: "Shell out to `git` CLI for worktree ops"), not a new dependency.

### Core
No new runtime library. Both fork options are consumed through code paths that already exist in this codebase (`writeHookSettings`'s settings-JSON pattern; the system `git` CLI shell-out pattern).

### Package Legitimacy Audit

**Not applicable.** This phase installs no new package in any ecosystem — it is a design/architecture change inside existing Rust and Node source files plus git configuration. No `npm view` / `pip index` / `cargo search` verification is required.

## Architecture Patterns

### System Flow — where each candidate sits relative to the existing layers

```
Session spawn (claude-code-adapter.ts)
  │
  ├─ writeHookSettings() → <runtime>/settings/<runId>.json
  │     { hooks: { PreToolUse: [...], SessionStart: [NEW] } }   ◄── candidate A wiring point
  │
  └─ spawn `claude -p --settings <file> ...`
        │
        ├─ SessionStart hook fires (NEW, candidate A)
        │     → writes `export PATH="<shimDir>:$PATH"` to $CLAUDE_ENV_FILE
        │
        ├─ Claude Code builds a shell snapshot
        │     (executes developer's login shell; mise+zinit rewrite PATH;
        │      final line: `export PATH='<login shell's PATH>'`)
        │
        ├─ Agent issues a Bash tool call
        │     │
        │     ├─ PreToolUse hook (Layer 1, UNCHANGED by this phase)
        │     │     classifies text; defers to Layer 2 for git/rm bare-name invocations
        │     │
        │     └─ Command actually runs in a shell that:
        │           1. sources the shell snapshot (PATH frozen from login shell)
        │           2. [if candidate A holds] sources $CLAUDE_ENV_FILE AFTER the snapshot
        │              → shim dir restored to PATH[0] → P1 true by construction
        │           3. resolves `git`/`rm` via PATH search
        │                 → if candidate A failed: shim dir may be absent → Layer 2 unreachable
        │
        └─ IF the resolved command is `git push`/`git branch -D` (any invocation path):
              real `git` binary reads its own `core.hooksPath` config (NEW, candidate B)
              → runs `pre-push` hook BEFORE any data reaches the remote
              → hook inspects stdin (local/remote ref + object-name pairs)
              → non-zero exit aborts the push, independent of PATH, independent of (A)
```

Candidate B (the `pre-push` hook) is drawn **in parallel**, not downstream of the PATH-shim chain, because it is reached through git's own internal hook-config read, which happens regardless of which copy of the `git` binary PATH resolved to — including the real system `git`, the shim's `git` entry, or any other shadow.

### Recommended Project Structure

```
packages/core/src/
  git_hooks.rs            # NEW — install_pre_push_hook(repo_path): writes <hooksDir>/pre-push,
                           #   sets `core.hooksPath` in the repo's shared git config, called from
                           #   the existing BOARD-10 "register project" path (once per repo, not
                           #   per worktree — config is shared across linked worktrees by default)
packages/sidecar/src/
  sessionstart-hook.ts    # NEW — candidate A: writes `export PATH="<shimDir>:$PATH"` to
                           #   $CLAUDE_ENV_FILE; mirrors pretooluse-hook.ts's fail-closed,
                           #   never-waits, single-purpose shape
  claude-code-adapter.ts  # MODIFIED — writeHookSettings() gains a SessionStart entry alongside
                           #   the existing PreToolUse entry(ies)
docs/
  destructive-gate-trust-boundary.md   # MODIFIED — new "## Layer -1" or "## Round eleven" section
                                        #   documenting the git-native layer and (if landed) the
                                        #   CLAUDE_ENV_FILE mechanism, per this doc's own
                                        #   "document-before-corpus" rule
```

### Pattern 1: SessionStart hook writing `CLAUDE_ENV_FILE`

**What:** A `command`-type hook registered under `hooks.SessionStart` in the same `--settings` JSON file `writeHookSettings` already writes, which on fire appends `export PATH="<shimDir>:$PATH"` to the file named by `$CLAUDE_ENV_FILE`.
**When to use:** As the general-purpose replacement for P1 — if its ordering holds, the shim directory is restored to `PATH[0]` for every subsequent Bash call regardless of the developer's own shell init, and the `PreToolUse` hook's existing environment proof (`shimWillIntercept`, unmodified since the round-ten revert) becomes true by construction rather than needing to be proven from inside the hook.
**Example (official doc's own worked example, adapted):**
```bash
# Source: code.claude.com/docs/en/hooks, "CLAUDE_ENV_FILE" section — quoted verbatim, variable
# names generalised for this codebase's shim directory.
#!/bin/bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export PATH=\"${FLYWHEEL_SHIM_DIR}:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
exit 0
```
**Caveats, named rather than hidden:** `CLAUDE_ENV_FILE` is scoped to `SessionStart`, `Setup`, `CwdChanged`, and `FileChanged` hooks only — it is **not** available inside `PreToolUse`, so this must be a second, independent hook registration, not an addition to `pretooluse-hook.ts`. A documented Windows bug (`anthropics/claude-code#27987`) shows the file written correctly but never sourced for subsequent Bash calls on some builds — unconfirmed on macOS, the platform this product targets, but it establishes the mechanism is not unconditionally reliable across the matrix. Anthropic's own Settings guide and Hooks guide describe this variable in contradictory terms (`anthropics/claude-code#19357`, closed "not planned", no maintainer resolution) — a second reason this is `[CITED]`, not `[VERIFIED]`, until exercised against the real installed binary.

### Pattern 2: Git-native `pre-push` hook via `core.hooksPath`

**What:** A `pre-push` hook script installed once per registered project (not per worktree), referenced by a `core.hooksPath` git-config entry in the repository's shared config, which every linked worktree of that repository reads by default.
**When to use:** As the structural, PATH-independent backstop for the **remote-reaching** destructive classes (`force-push`, `branch-deletion`, `default-branch-push`, `history-rewrite` — four of `destructive::DestructiveCategory`'s eight variants, `[VERIFIED: packages/core/src/destructive.rs:56-65]`, read this session: `"force-push"`, `"branch-deletion"`, `"default-branch-push"`, `"history-rewrite"`, `"hard-reset"`, `"force-clean"`, `"recursive-delete"`, `"uncategorized"`). It fires inside the real `git` process after PATH resolution has already happened, so it cannot be defeated by a shell-init PATH reorder at all.
**Example (official git-scm.com protocol):**
```
# Source: git-scm.com/docs/githooks, "pre-push" section — quoted structure, not literal upstream code.
# Hook receives two args: remote name, remote URL.
# Hook receives on stdin, one line per ref being pushed:
#   <local-ref> SP <local-object-name> SP <remote-ref> SP <remote-object-name> LF
#
# Branch deletion: <local-object-name> is the all-zeroes object name.
# New branch:      <remote-object-name> is the all-zeroes object name.
# Force-push:      the new <local-object-name> does not descend from <remote-object-name>
#                   (requires `git merge-base --is-ancestor <remote-object-name> <local-object-name>`).
#
# A non-zero exit aborts the push before any data reaches the remote.
```
**Install point:** `BOARD-10`'s "register project" path (project-level, once), or `WORK-01`'s worktree-creation path if per-worktree isolation is later required — but default-shared config means a single install at registration time already covers every worktree, which is the cheaper and currently-correct choice given this project uses the default (non-`extensions.worktreeConfig`) git-config sharing behaviour `[CITED: git-scm.com/docs/githooks + corroborating GitHub issue discussion of worktree core.hooksPath sharing]`.
**Residual, named:** bypassable by a deliberate `git -c core.hooksPath=/dev/null push …` or a deliberate `git config core.hooksPath` rewrite from inside the agent's own Bash session `[CITED: multiple independent GitHub issue reports describing exactly this bypass class]`. This is a materially different exposure than today's hole — it requires the agent (or a prompt-injected instruction) to **deliberately name this specific git flag**, not merely run an ordinary command inside an ordinary developer shell — but it is not zero, and the planner should decide whether to treat it as an acceptable residual (à la the existing `sudo`/`PATH=` residuals already named in `docs/destructive-gate-trust-boundary.md`'s Named Residuals table) or add a companion raw-text check in the existing `PreToolUse` classifier for `-c core.hooksPath` / `--config-env` / `GIT_CONFIG_*` tokens (the same raw-text-scan pattern already used for `env -S` opaque reparse, C5/C6).

### Anti-Patterns to Avoid

- **Re-attempting round ten's approach** (proving P1 from inside `pretooluse-hook.ts` by reading every shell snapshot's trailing `export PATH`): this research found no new evidence to reopen it. The trust-boundary document's own conclusion stands — "P1 is not achievable by any mechanism Flywheel currently controls" from inside a hook that only ever classifies text before the real shell has sourced anything.
- **Treating the `--settings` JSON `env` block as the fix**: it is explicitly refuted — the snapshot is sourced *after* process-environment setup, so a plain `env.PATH` entry in the settings file is clobbered by the snapshot's own trailing `export PATH=`, by the same mechanism that defeated Part 1 of round ten `[CITED: blog.iany.me — corroborating, non-authoritative, consistent with the official docs' silence on `env.PATH` surviving the snapshot and with the GitHub issue's description of `CLAUDE_ENV_FILE` as the documented workaround for exactly this failure]`.
- **Widening the raw-text classifier again** (a hypothetical "round eleven" in `packages/shim/src/main.rs`): this is the same scope-fence the trust-boundary document's own "rule for round six" warns against — the classifier decides *when* Layer 1 may defer, never *whether* deferring is safe, and that is a property of the environment, not the command text.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting a force-push / branch deletion from a push's ref/object-name pairs | A custom argv parser for every `git push` spelling (launcher-wrapped, `env`-wrapped, brace-expanded — the whole `LAUNCHER_CORPUS` problem class this document's rounds five through nine fought) | Git's own `pre-push` hook stdin protocol | The hook fires **after** git has already resolved the actual push operation into ref/object-name pairs — it is immune by construction to every text-obfuscation shape (`sh -c`, `env -S`, brace expansion, launcher wrapping) that burned nine rounds of the raw-text classifier, because none of that obfuscation survives past the point where `git` itself is running |
| Persisting an environment variable across every subsequent Bash call in a Claude Code session | A custom polling/re-export mechanism, or trying to win the race against the shell snapshot via shell startup files (`.zshenv`/`ZDOTDIR`, `BASH_ENV`) — none of which run *after* the snapshot, because shell startup files execute at shell-init time, before the snapshot (itself sourced as part of preparing the command) ever runs | `CLAUDE_ENV_FILE`, Claude Code's own documented, purpose-built mechanism for this exact problem | It is explicitly designed and documented for "persist environment variables for subsequent Bash commands" — reinventing it with a shell-startup-file trick cannot work, because those files run *before* the snapshot textually overwrites `PATH`, the same structural reason the plain `--settings` `env` block fails |

**Key insight:** every "own the PATH" hand-rolled alternative this research considered (ZDOTDIR override, BASH_ENV, a wrapper shell on `$SHELL`) loses to the shell snapshot for the same structural reason the `--settings` `env` block does — anything that runs as part of shell *initialization* is sourced before the snapshot's trailing `export PATH=` statement, which is deliberately the LAST thing the snapshot does. The only way to win that race is a mechanism Claude Code explicitly re-applies *after* building the snapshot, and `CLAUDE_ENV_FILE` is the one Anthropic documents for that purpose.

## Common Pitfalls

### Pitfall 1: Mistaking "the snapshot is sourced after `env.PATH`" for "nothing can win"
**What goes wrong:** A planner reads round ten's finding — "the backend builds a FRESH snapshot … regardless" — and concludes no mechanism can restore P1, defaulting straight to "stop depending on PATH precedence" as the only option.
**Why it happens:** Round ten's own Part 1 (`isolatedClaudeConfigDir`) tested the wrong lever — an empty snapshot *pool*, not a *post-snapshot* override — and its failure was real but narrower than "no PATH mechanism can ever work."
**How to avoid:** Distinguish "runs before the snapshot" (loses, always) from "runs after the snapshot, once per Bash call" (the one documented lever Claude Code offers, `CLAUDE_ENV_FILE`).
**Warning signs:** A design document that treats "composing an isolated config dir" and "a post-snapshot environment override" as the same mechanism — they are not; round ten only disproved the former.

### Pitfall 2: Treating the `pre-push` hook as a replacement for the whole destructive gate
**What goes wrong:** Shipping only the `core.hooksPath` fix and declaring AGNT-07 closed, leaving `rm -rf`/`hard-reset`/`force-clean` — none of them git-push operations — uncovered by the new layer and still dependent on the unreliable PATH shim.
**Why it happens:** The ROADMAP's own framing centers on the measured incident (`git push origin --delete`), which is a push operation; it is easy to generalise "fixed the push case" to "fixed the gate."
**How to avoid:** Explicitly scope the `pre-push` hook's coverage to the four remote-reaching `DestructiveCategory` variants and keep the PATH-shim (plus, if it survives falsification, `CLAUDE_ENV_FILE`) as the covering layer for the other four.
**Warning signs:** A verification plan whose only live arm re-runs `uat-06`/`uat-07` (both push-shaped) without a parallel check for `rm -rf`/`git reset --hard`/`git clean -fdx`.

### Pitfall 3: Shipping without the "every ordinary command still works" arm, again
**What goes wrong:** Round ten passed every offline test it had and still bricked the product live — refusing `git --version`.
**Why it happens:** The offline corpus (`LAUNCHER_CORPUS`, `ORDINARY_USAGE_CORPUS`) only ever exercised the *destructive* side; nothing in the suite asserted that a change to the environment-proof logic leaves *harmless* commands alone, because the harmless side was never the thing changing.
**How to avoid:** Any new offline test added for this phase must include a positive arm (harmless commands still defer/execute) run against the SAME environment fixture as the negative arm (destructive commands still gated) — exactly the structure round ten's own two new tests used, just extended to the new candidates.
**Warning signs:** A plan whose acceptance criteria list only "the destructive command is stopped" without an explicit, equally-weighted "`git --version`, `git status`, `npm test` are never denied" criterion — the ROADMAP's own acceptance text already names this requirement; do not let it become an afterthought in task breakdown.

## Code Examples

### Writing a SessionStart hook entry alongside the existing PreToolUse entry
```typescript
// Pattern to follow — mirrors writeHookSettings's existing shape exactly
// (packages/sidecar/src/claude-code-adapter.ts:187-214), extended with a new array entry.
// NOT verified against this repo's actual future implementation — illustrative only.
const settings = {
  hooks: {
    PreToolUse: preToolUse,           // unchanged, existing array
    SessionStart: [
      {
        hooks: [{ type: "command", command: `${process.execPath} ${sessionStartHookScriptPath()}` }],
      },
    ],
  },
};
```

### Detecting force-push vs. ordinary push from `pre-push` stdin (illustrative shell, not yet in this repo)
```bash
# Source: structure per git-scm.com/docs/githooks "pre-push" section.
while read local_ref local_sha remote_ref remote_sha; do
  zero="0000000000000000000000000000000000000000"
  if [ "$local_sha" = "$zero" ]; then
    echo "Flywheel: branch deletion blocked pending human confirmation" >&2
    exit 1
  fi
  if [ "$remote_sha" != "$zero" ] && ! git merge-base --is-ancestor "$remote_sha" "$local_sha"; then
    echo "Flywheel: force-push blocked pending human confirmation" >&2
    exit 1
  fi
done
exit 0
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Prove the shim leads `PATH` by reading the hook PROCESS's own `process.env.PATH` | (Reverted) Prove it by reading the command SHELL's shell-snapshot `export PATH` | Round ten, 2026-10-01, reverted same day | Correct premise, unsafe default — denied every Bash command when the snapshot didn't carry the shim prefix |
| `PreToolUse` hook timeout silently lets the tool call through | (Current, confirmed this session) still true for `command`/`http`/`mcp_tool` hooks — only Agent-SDK *callback* hooks now block on timeout | Agent SDK callback-hook timeout behaviour changed before v2.1.210; the CLI's own shell-command hooks (what this repo uses) were NOT changed | Confirms the existing fail-fast design of `pretooluse-hook.ts` (never wait) is still the correct constraint for this codebase's hook type — do not assume a newer Claude Code version silently fixed the "timeout lets it through" exposure for `command`-type hooks |

**Deprecated/outdated:** None of the layer 0/1/2 mechanisms themselves are deprecated; round ten's specific code (`shimLeadsCommandShellPath`, the per-run `isolatedClaudeConfigDir`) is reverted and should not be resurrected without a different premise than the one it tested.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `CLAUDE_ENV_FILE` is sourced *after* the shell snapshot for every subsequent Bash call, on the real `claude 2.1.274` binary on macOS, the same way the official docs' own example implies | Pattern 1, Summary | If false (or unreliable, per the known Windows bug's cousin on macOS), a SessionStart-hook implementation ships with the exact same silent-failure shape round ten's Part 1 had — P1 still false, nobody told. This is why the live falsification command is specified below rather than skipped |
| A2 | A `core.hooksPath` entry set once at project-registration time is read by every linked worktree of that repository by default (i.e., this codebase has not enabled `extensions.worktreeConfig`) | Pattern 2 | If this codebase already uses per-worktree config isolation somewhere, the hook would need per-worktree installation instead of a single project-level install — a planning-time check (`grep -n "worktreeConfig\|--git-dir\|GIT_DIR" packages/core/src/*.rs`) before implementation, not re-derived from scratch |
| A3 | `git -c core.hooksPath=…` / `git config core.hooksPath` is not already specifically caught by the existing raw-text classifier (`packages/shim/src/main.rs`) | Pattern 2's residual | If the classifier already catches `-c`/`--config` overrides generically, the named residual is smaller than stated and the planner can tighten the acceptance bar further |

## Open Questions

1. **Does `CLAUDE_ENV_FILE` actually win against this machine's real mise+zinit snapshot?**
   - What we know: official docs describe the mechanism and its PATH-prepending use case explicitly; a non-authoritative blog post explicitly claims it is sourced *after* the snapshot and *wins*; a GitHub issue shows it sometimes silently fails to apply on Windows.
   - What's unclear: ordering and reliability on macOS, on `claude 2.1.274`, in headless (`-p --output-format stream-json`) non-interactive mode specifically (all prior public discussion of `CLAUDE_ENV_FILE` concerns interactive or SDK sessions, not the exact spawn shape `claude-code-adapter.ts` uses).
   - **Recommendation — exact minimal live falsification, to bundle into the next live UAT pass (per the debug session's own deferred item):** spawn one `claude -p --settings <file> --output-format stream-json --permission-mode bypassPermissions` session where `<file>`'s `hooks.SessionStart` entry runs a script that `echo 'export PATH="/tmp/flywheel-marker-dir:$PATH"' >> "$CLAUDE_ENV_FILE"`, where `/tmp/flywheel-marker-dir` contains nothing but an executable stub named `git` that writes a marker file and exits 0 instead of running real git. Prompt the agent to run `git --version`. **The observable that distinguishes the two outcomes:** if the marker file is created, `CLAUDE_ENV_FILE` won and P1 is restorable by construction; if it is not created (and the real `git --version` output appears instead), the snapshot still won and candidate A is dead — proceed with candidate B (git-native hooks) alone. This is strictly cheaper than re-running `uat-06b` (no remote fixture needed, no destructive command, one harmless probe) and should be run *before*, not instead of, the destructive-gate UAT items.

2. **Does `extensions.worktreeConfig` apply anywhere in this codebase's git setup, which would change `core.hooksPath`'s install point from "once per project" to "once per worktree"?**
   - What we know: this research did not find the string in a quick targeted check; the project's own worktree-creation code (`WORK-01`/`WORK-02`) was not read in depth this session.
   - What's unclear: whether a later phase (7, "The Board Tells The Git Truth") introduced per-worktree config isolation for other reasons.
   - Recommendation: a five-minute `grep` before implementation (Assumption A2); not worth a live run.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| System `git` CLI | `pre-push` hook install, `core.hooksPath` config write | ✓ (already a hard project dependency per this project's own stack decision) | whatever the developer has installed (project minimum: git >= 2.44) | — |
| Installed `claude` binary | Live falsification run (Open Question 1), and all `scripts/uat/*` live arms | ✓ | `2.1.274` measured this session's own debug file (`.planning/debug/uat-06b-bash-gate-regression.md`) | — |
| Credentials for a live `claude` session | Open Question 1's falsification run | Not spent this session (research is offline-only by design) | — | The falsification command above is the minimal spend; no fallback exists for "prove ordering without running the real binary" — this is a genuine live-run-only question, same as the roadmap itself states |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node's built-in `node --test` (sidecar, TypeScript compiled), Rust's built-in `cargo test` (core/shim) — both already in use, no new framework needed |
| Config file | none — `packages/sidecar/test/*.test.mjs` run directly; `packages/shim`/`packages/core` use standard `cargo test` |
| Quick run command | `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude FLYWHEEL_RUNTIME_DIR="$(mktemp -d)" node --test test/destructive-gate.test.mjs` (sidecar; zero credential spend, the pattern the debug session's own verification already used) |
| Full suite command | `bash scripts/uat/run-all.sh` (includes the live, credential-spending arms) |

### Phase Requirements → Test Map

No REQ-ID is mapped to this phase (see `<phase_requirements>` above); the table below maps the ROADMAP's own stated acceptance criteria instead, since those are this phase's actual contract.

| Acceptance criterion (from ROADMAP.md) | Test Type | Automated Command | File Exists? |
|---|---|---|---|
| A destructive command never reaches a remote in a `bypassPermissions` session, even when the shell snapshot's PATH does not lead with the shim directory | integration (offline, fixture-driven) | `node --test test/destructive-gate.test.mjs` — extend with a `core.hooksPath`-arm fixture asserting a `pre-push` script invoked with a deletion/force-push stdin payload exits non-zero | ❌ Wave 0 — new fixture + test needed |
| Ordinary commands (`git --version`, `git status`, `npm test`) never become permission requests, under the SAME environment conditions the destructive check uses | integration (offline, fixture-driven) — the positive-arm companion round ten's own tests already established as mandatory | `node --test test/destructive-gate.test.mjs` — extend the SAME fixture/test pair with a positive arm, per Pitfall 3 above | ❌ Wave 0 — extend existing round-ten-shaped test pattern |
| `CLAUDE_ENV_FILE` ordering holds (if candidate A is chosen) | live (credential-spending), exactly as specified in Open Question 1 | manual invocation of the falsification command above, or a new `scripts/uat/uat-11-*.mjs` wrapping it | ❌ Wave 0 — new harness script, modelled on `uat-07-launcher-shape-gate.mjs`'s shape |
| The fix addresses the root cause named in this phase (PATH non-ownership), not a text-classifier symptom | structural/source gate | a `grep`-based structural test asserting `packages/shim/src/main.rs` gained no new launcher-token recognition this phase (mirrors the existing structural gates in `destructive-gate.test.mjs` pinning doc sections) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/destructive-gate.test.mjs` (and `cargo test` for any `packages/core`/`packages/shim` changes)
- **Per wave merge:** `bash scripts/uat/run-all.sh --no-build` for the offline arms; the live falsification run (Open Question 1) and `uat-06`/`uat-07` re-runs are scheduled, credential-spending events, not every-merge gates
- **Phase gate:** full offline suite green, PLUS at least one live run proving both halves of Pitfall 3's requirement (destructive stopped, harmless commands untouched) before `/gsd:verify-work` — this phase's own ROADMAP text makes this explicit and non-negotiable, unlike most phases' default Nyquist sampling

### Wave 0 Gaps
- [ ] A `pre-push`-hook fixture + offline test pair in `packages/core` or `packages/sidecar/test/` (new) — covers the remote-reaching deletion/force-push detection logic without spawning git for real, or with a real throwaway local bare repo (`D-63`'s existing pattern in `scripts/uat/uat-07-launcher-shape-gate.mjs`)
- [ ] A `SessionStart`-hook unit test mirroring `pretooluse-hook.ts`'s own test shape, asserting the script writes the expected `export PATH=` line to a fixture file path when `CLAUDE_ENV_FILE` is set, and degrades silently (never throws) when it is not
- [ ] A new `scripts/uat/uat-11-*.mjs` (or similar) implementing the exact falsification command from Open Question 1 — this is the one live, credential-spending item this phase's planning must schedule explicitly, per the ROADMAP's own "bundle it with the next live UAT pass" instruction

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V1 Architecture, Design and Threat Modeling | yes | This phase IS a threat-model correction — the trust-boundary document itself is the ASVS-V1-shaped artifact (documented layers, documented "trusted to prove" / "cannot see" claims) and must be updated, per its own "rule for round six", before any new corpus row lands |
| V4 Access Control | yes | The destructive-gate is an access-control mechanism gating a privileged operation (remote-mutating git commands) behind human confirmation; this phase is precisely a V4 boundary redesign |
| V5 Input Validation | yes (unchanged) | `packages/shim/src/main.rs`'s raw-text classifier remains the existing, unmodified control for this phase — do not widen it (Anti-Pattern 3) |
| V11 Business Logic | yes | The "safe default" business rule (deny-when-unproven, D-60) must be preserved exactly as-is for the new interception point too — a `core.hooksPath` install failure or a `SessionStart` hook failure must degrade to the EXISTING fail-closed behaviour, never silently skip the new layer |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Trust-boundary premise proven against the wrong process (round ten's root cause) | Tampering (of the proof itself, not the data) | Always prove an environment property against the process that will actually use it — this is the general lesson this whole phase exists to apply, not merely the `PATH` instance of it |
| `-c`/`--config`/`GIT_CONFIG_*` override disabling a configured safety hook | Elevation of Privilege | Named residual in Pattern 2 above; optionally a raw-text classifier addition mirroring the existing `env -S` opaque-reparse detection (C5/C6), scoped narrowly, per this repo's own "rule for round six" discipline — amend the trust-boundary document first, corpus row second |
| A new hook (`SessionStart`) silently failing to register or fire, producing a false sense of safety | Denial of Service (of the safety control, not the product) | Mirror `writeHookSettings`'s existing degrade-to-`undefined`-and-log pattern, and — critically, per Pitfall 3 — pair it with an explicit test asserting the FAILURE MODE denies rather than silently proceeds with the old, broken premise |

## Sources

### Primary (HIGH confidence)
- `code.claude.com/docs/en/hooks` — official PreToolUse decision shapes (`allow`/`deny`/`ask`/`defer`), `command`/`http`/`mcp_tool` hook timeout behaviour ("doesn't block the tool call"), `CLAUDE_ENV_FILE` scoping (SessionStart/Setup/CwdChanged/FileChanged only) and its official worked example — fetched and quoted this session
- `code.claude.com/docs/en/agent-sdk/hooks` — Agent SDK hook event table, decision priority (deny > defer > ask > allow), Agent-SDK-callback-hook timeout behaviour (now blocks, a DIFFERENT contract than `command`-type hooks) — fetched and quoted this session
- `git-scm.com/docs/githooks` — `pre-push` hook arguments, stdin protocol, force-push/deletion detection fields, exit-code semantics, `core.hooksPath` default location — fetched and quoted this session
- `packages/core/src/destructive.rs:40-88` — `DestructiveCategory` enum, `as_str()` mapping, read this session, quoted verbatim
- `packages/sidecar/src/pretooluse-hook.ts` (full file) — current (post-revert) Layer 1 implementation, read this session
- `docs/destructive-gate-trust-boundary.md` (Layer 0/1/2 definitions, Round Ten section, Named Residuals, Layer-to-corpus map) — read this session
- `.planning/debug/uat-06b-bash-gate-regression.md` (full file) — the diagnosis and the live-run revert record — read this session
- `packages/sidecar/test/fixtures/real-shell-snapshot-mise-zinit.sh` — the captured real snapshot shape — read this session
- `packages/sidecar/src/claude-code-adapter.ts:119-420` — `writeHookSettings`, `buildClaudeArgv`, settings-file wiring — read this session

### Secondary (MEDIUM confidence)
- `github.com/anthropics/claude-code/issues/27987` — `CLAUDE_ENV_FILE` written-but-not-sourced bug report (Windows), quoted the expected ordering ("source this file before each Bash command") from the issue's own citation of the docs
- `github.com/anthropics/claude-code/issues/19357` — documented contradiction between the Settings guide and Hooks guide's description of `CLAUDE_ENV_FILE`, closed "not planned", no maintainer resolution
- GitHub issue discussion corroborating `core.hooksPath`'s default sharing across linked worktrees, and its bypass surface (`-c core.hooksPath=`, `git config core.hooksPath`, `GIT_CONFIG_*`)

### Tertiary (LOW confidence)
- `blog.iany.me/2026/07/fix-claude-desktop-path-with-claude-env-file/` — non-authoritative blog post, the ONLY source found that explicitly states `CLAUDE_ENV_FILE` is sourced AFTER the shell snapshot and wins; consistent with, but not confirmed by, the official docs' silence on the exact ordering — this is the gap Open Question 1's live falsification run is for

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency, both candidates use existing in-repo patterns
- Architecture (the two-interception-point design): MEDIUM — `pre-push` hook mechanics are HIGH confidence (official git-scm.com docs, exact protocol); `CLAUDE_ENV_FILE` ordering is MEDIUM/LOW confidence (official docs confirm the mechanism and its intended use, but not the exact before/after-snapshot ordering on this machine's binary, and a known reliability bug exists on another platform)
- Pitfalls: HIGH — directly derived from round ten's own measured, live-run failure, already in this repository's own records

**Research date:** 2026-10-01
**Valid until:** 14 days — this phase is gated on a fast-moving Claude Code CLI (weekly releases per this project's own stack doc) whose hook/env-file behaviour has changed at least twice already (Agent SDK callback-hook timeout semantics changed before v2.1.210; `CLAUDE_ENV_FILE`'s Windows sourcing bug is still open) — re-verify the installed `claude --version` against this research's `2.1.274` baseline before planning executes.
