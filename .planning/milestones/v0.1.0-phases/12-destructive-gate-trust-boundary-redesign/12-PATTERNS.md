# Phase 12: Destructive-gate trust boundary redesign - Pattern Map

**Mapped:** 2026-10-01
**Files analyzed:** 7 (new/modified files named by RESEARCH.md + VALIDATION.md Wave 0)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `packages/core/src/git_hooks.rs` (NEW) | service (git config/hook install) | file-I/O + shell-out | `packages/core/src/git.rs` | exact (same crate, same shell-out discipline) |
| `packages/sidecar/src/sessionstart-hook.ts` (NEW) | middleware/hook script | request-response (stdin/stdout, one-shot process) | `packages/sidecar/src/pretooluse-hook.ts` | exact (same hook-script shape, fail-closed-adjacent) |
| `packages/sidecar/src/claude-code-adapter.ts` (MODIFIED — `writeHookSettings`) | service/config-writer | CRUD (settings JSON write) | itself, lines 119-214 (pre-existing `PreToolUse` entry) | exact (extend in place) |
| `packages/sidecar/test/destructive-gate.test.mjs` (MODIFIED — new arms) | test | integration / fixture-driven | itself (existing file) + `scripts/uat/lib/sidecar-harness.mjs`'s `createRepoWithRemote` | exact |
| `packages/sidecar/test/*sessionstart-hook*.test.mjs` (NEW, Wave 0) | test | unit | `packages/sidecar/test/pretooluse-hook` test pattern (see note below — exact file not located, inferred from module doc) | role-match |
| `scripts/uat/uat-11-*.mjs` (NEW, Wave 0) | test (live UAT harness) | event-driven, credential-spending | `scripts/uat/uat-07-launcher-shape-gate.mjs` + `scripts/uat/run-all.sh` registration | exact |
| `packages/core/tests/*` structural gate (NEW, e.g. `destructive_gate_no_new_launcher_tokens.rs`) | test (structural/source gate) | batch (static source scan) | `packages/core/tests/proposal_no_promotion.rs` (source-scanning helpers) and `packages/core/tests/supervisor_cwd.rs` (single-construction-site grep assertion) | exact |

**Read-only reference, not modified:** `packages/shim/src/main.rs` (classifier — must NOT gain new launcher-token recognition this phase) and `packages/core/src/destructive.rs` (`DestructiveCategory` enum — read by the new `pre-push` hook's category reasoning, not edited).

## Pattern Assignments

### `packages/core/src/git_hooks.rs` (NEW — service, file-I/O + shell-out)

**Analog:** `packages/core/src/git.rs` (full file read, 260 lines)

**Module-doc / shell-out discipline pattern** (lines 1-44):
```rust
//! The explicit-absolute-path git wrapper (PROC-02): the ONE place in this workspace that
//! constructs a `Command::new("git")`. `packages/core/tests/supervisor_cwd.rs` (plan 02-01 Task 3)
//! asserts this structurally — every other module that needs git shells out through here, never by
//! constructing its own `Command`.

fn spawn_git(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to spawn git -C {repo_path:?} {args:?}"))
}

pub fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() {
        bail!("git_at refused: repo_path must not be empty");
    }
    if args.is_empty() {
        bail!("git_at refused: args must not be empty");
    }
    let label = format!("git -C {repo_path:?} {args:?}");
    let outcome = crate::git_retry::with_lock_retry(&label, |_attempt| {
        let output = spawn_git(repo_path, args)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "git -C {repo_path:?} {args:?} failed (exit {:?}): {stderr}",
                output.status.code()
            ));
        }
        Ok(output)
    })?;
    Ok(outcome.value)
}
```

**CRITICAL constraint for the new file:** `packages/core/tests/supervisor_cwd.rs` structurally asserts that `Command::new("git")` appears EXACTLY ONCE in the whole workspace, inside `packages/core/src/git.rs` (see Shared Patterns below). `git_hooks.rs` must therefore call `crate::git::git_at(repo_path, &["config", "core.hooksPath", ...])` to set the config — it must NOT construct its own `Command::new("git")`. This is a hard gate, not a style preference; a new construction site will fail the existing structural test.

**Error handling pattern:** non-zero exit becomes `anyhow::Error` via `git_at`'s own bail — reuse this, don't hand-roll a second error path.

**Install-point caller (register_project):** `packages/core/src/domain/project.rs`, `register_project` (lines ~218-260+) — the existing BOARD-10 project-registration function. New hook-install call belongs inside or immediately after this function's transaction commit, following its own stated rule: "The marker file write happens ONLY after the transaction commits (T-01-30): a failed database write never leaves a marker behind." The `core.hooksPath` git-config write is a parallel filesystem/git side effect and should follow the same "only after commit" discipline — do not interleave it with the `rusqlite` transaction.
```rust
pub fn register_project(
    conn: &mut Connection,
    actor_id: &str,
    repo_path: &Path,
    name: &str,
    key_prefix: &str,
) -> anyhow::Result<Project> {
    validate_key_prefix(key_prefix)?;
    let canonical = repo_path.canonicalize()
        .with_context(|| format!("repository path {repo_path:?} could not be resolved"))?;
    // ... existing marker read, transaction, commit ...
}
```

---

### `packages/sidecar/src/sessionstart-hook.ts` (NEW — middleware/hook script, request-response)

**Analog:** `packages/sidecar/src/pretooluse-hook.ts` (full file, 343 lines, read this session)

**Fail-closed / never-wait discipline** (module doc, lines 59-91, condensed):
```typescript
/**
 * This script NEVER waits. It reads its own stdin (...), ... and exits. It never opens a
 * socket, never polls and never sleeps.
 *
 * Fail-closed. A payload this script cannot parse, ... all produce the destructive (`deny`)
 * decision — never the permissive one.
 */
```
For `sessionstart-hook.ts`, the equivalent discipline (per RESEARCH.md Pattern 1 and the Known Threat Patterns table) is: a write failure to `$CLAUDE_ENV_FILE` must degrade to **silent no-op, never throw** — unlike `pretoolUseHookScriptPath`'s "fail closed = deny", a `SessionStart` hook has no permission decision to make; its only job is a best-effort PATH restoration, so its failure mode is "the old unreliable PATH shim premise still applies" (logged), not a process crash.

**Decision-return / stdin reading shape:**
```typescript
function printDecision(decision: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(decision));
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}
```
`sessionstart-hook.ts` does not need `printDecision` (no `PreToolUse` decision schema applies to `SessionStart`), but should mirror `readStdin`'s synchronous/promise shape if it needs the hook payload at all — per RESEARCH.md's own worked example, the core logic is actually simpler (read `$CLAUDE_ENV_FILE` from `process.env`, `fs.appendFileSync`, exit 0) and does not need stdin at all:
```bash
# Source: code.claude.com/docs/en/hooks, quoted in 12-RESEARCH.md Pattern 1
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export PATH=\"${FLYWHEEL_SHIM_DIR}:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
exit 0
```
Translate to the sidecar's Node/TS idiom (mirroring `pretooluse-hook.ts`'s `fs`/`path` import style, lines 93-95):
```typescript
import { appendFileSync } from "node:fs";
```

**Shim-shadow-directory sourcing pattern to reuse (do not reinvent the "first PATH segment" logic):** `shimWillIntercept` (pretooluse-hook.ts lines 154-174) already derives the shim directory from `FLYWHEEL_SHIM_BIN`'s dirname — `sessionstart-hook.ts` should derive the directory to write into `$CLAUDE_ENV_FILE` the SAME way (`dirname(process.env.FLYWHEEL_SHIM_BIN)`), not via a second independently-computed path, matching this codebase's own stated discipline ("Deliberately reads the value back rather than re-resolving a second, independently-computed path").

---

### `packages/sidecar/src/claude-code-adapter.ts` (MODIFIED — `writeHookSettings`)

**Analog:** itself — the existing `PreToolUse` wiring, lines 108-214 (read this session)

**Sibling-script-path helper pattern** (lines 104-116):
```typescript
export function pretoolUseHookScriptPath(): string {
  return fileURLToPath(new URL("./pretooluse-hook.js", import.meta.url));
}

export function stageGateHookScriptPath(): string {
  return fileURLToPath(new URL("./stage-gate-hook.js", import.meta.url));
}
```
Add a `sessionStartHookScriptPath()` following the exact same idiom, pointed at `./sessionstart-hook.js`.

**`writeHookSettings` core pattern to extend** (lines 187-214, the actual function body):
```typescript
export function writeHookSettings(
  runtimeDir: string,
  runId: string,
  includeAuthoringStageGate: boolean,
): string | undefined {
  try {
    const settingsPath = permissionSettingsPath(runtimeDir, runId);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const preToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> = [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }],
      },
    ];
    if (includeAuthoringStageGate) {
      preToolUse.push({ /* ... */ });
    }
    const settings = { hooks: { PreToolUse: preToolUse } };
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return settingsPath;
  } catch (err) {
    console.error(`flywheel sidecar: failed to write PreToolUse hook settings for ${runId}: ${String(err)}`);
    return undefined;
  }
}
```
Add a `SessionStart` key to the `hooks` object — RESEARCH.md's own illustrative snippet (Code Examples section) already shows the exact shape:
```typescript
const settings = {
  hooks: {
    PreToolUse: preToolUse,
    SessionStart: [
      { hooks: [{ type: "command", command: `${process.execPath} ${sessionStartHookScriptPath()}` }] },
    ],
  },
};
```

**Degrade-to-`undefined`-and-log failure pattern (reuse exactly, do not add a second try/catch shape):** the existing `catch` block above (`console.error(...); return undefined;`) already covers a `SessionStart`-entry write failure, since it is the same `fs.writeFileSync` call — no new error-handling code is needed, only the new array entry inside the existing `try`.

---

### `packages/sidecar/test/destructive-gate.test.mjs` (MODIFIED — new `core.hooksPath`/pre-push arm + benign-commands positive arm)

**Analog:** itself (existing file, 3128 lines) + `scripts/uat/lib/sidecar-harness.mjs`'s `createRepoWithRemote`

**Existing file's own documented "zero-credential" structure** (module doc, lines 1-48, condensed):
```javascript
/**
 * RUNNING THIS FILE AT ZERO CREDENTIAL COST.
 * ...
 * FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude FLYWHEEL_RUNTIME_DIR="$(mktemp -d)" \
 *   node --test test/destructive-gate.test.mjs
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { buildClaudeArgv, pretoolUseHookScriptPath } from "../dist/claude-code-adapter.js";
```
New `core.hooksPath`/`pre-push` test arm: build a throwaway bare+work repo exactly as `createRepoWithRemote` does (below), install the `pre-push` script via `packages/core`'s new `git_hooks.rs` logic (or a Node-side equivalent spawn of the installed script directly — since this file tests offline, it should invoke the shell script the same way git itself would: pipe the ref/object-name stdin lines and assert exit code), never needing a real `claude` session for this arm.

**`createRepoWithRemote` fixture pattern** (`scripts/uat/lib/sidecar-harness.mjs`, lines 611-631, full method):
```javascript
createRepoWithRemote({ defaultBranch = "main", extraBranches = [] } = {}) {
  const remotePath = path.join(this.root, "remote.git");
  const workPath = path.join(this.root, "work");

  git(this.root, ["init", "--bare", "--initial-branch", defaultBranch, remotePath]);
  git(this.root, ["init", "--initial-branch", defaultBranch, workPath]);
  git(workPath, ["config", "user.email", "uat@flywheel.invalid"]);
  git(workPath, ["config", "user.name", "Flywheel UAT"]);
  fs.writeFileSync(path.join(workPath, "README.md"), `# UAT scratch repo (${this.label})\n`);
  git(workPath, ["add", "README.md"]);
  git(workPath, ["commit", "-m", "initial commit"]);
  git(workPath, ["remote", "add", "origin", remotePath]);
  git(workPath, ["push", "-u", "origin", defaultBranch]);

  for (const branch of extraBranches) {
    git(workPath, ["branch", branch]);
    git(workPath, ["push", "origin", branch]);
  }

  return { remotePath, workPath, defaultBranch };
},

remoteRef(remotePath, branch) {
  const result = git(remotePath, ["rev-parse", "--verify", `refs/heads/${branch}`], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : undefined;
},
```
This is the existing D-63-compliant "only a local throwaway bare repo, never a network remote" pattern — reuse directly for the offline `pre-push` fixture (it is already importable from `scripts/uat/lib/sidecar-harness.mjs`, or copy the two methods inline into `test/destructive-gate.test.mjs`'s own fixture helpers if that test file does not currently import the UAT harness lib — check before assuming cross-import).

**Mandatory positive arm (Pitfall 3 in RESEARCH.md):** every new negative-arm test (destructive stopped) needs a sibling positive-arm test (benign commands — `git --version`, `git status`, `npm test` — never denied), run against the SAME fixture/environment. The existing file already has this shape for the `PreToolUse` hook (see its own three-measurement description, lines 14-23) — extend identically for the new `pre-push`/`core.hooksPath` arm and the `SessionStart` arm.

---

### `packages/sidecar/test/*sessionstart-hook*.test.mjs` (NEW, Wave 0)

**Analog:** no standalone `pretooluse-hook.test.mjs` file was located as a separate file in the time budget for this mapping — the equivalent unit-test coverage for `pretooluse-hook.ts` appears to live inside `destructive-gate.test.mjs` itself (which imports `pretoolUseHookScriptPath` from `../dist/claude-code-adapter.js` and spawns the compiled hook directly). **Recommendation for the planner:** follow the SAME pattern — add the `SessionStart` hook's unit coverage as new `test(...)` blocks inside `destructive-gate.test.mjs` (or a new sibling file named analogously, e.g. `sessionstart-hook.test.mjs`, importing `sessionStartHookScriptPath` the same way), rather than inventing a different test-file convention. Assert: (a) given `CLAUDE_ENV_FILE` pointing at a fixture path, the script appends the expected `export PATH=` line; (b) given `CLAUDE_ENV_FILE` unset, the script exits 0 without throwing and without creating any file.

---

### `scripts/uat/uat-11-*.mjs` (NEW, Wave 0 — live falsification harness)

**Analog:** `scripts/uat/uat-07-launcher-shape-gate.mjs` (full file, 343 lines, read this session) + its registration in `scripts/uat/run-all.sh`

**Harness shape to copy** (module doc + imports, lines 1-45):
```javascript
#!/usr/bin/env node
/**
 * UAT item N ...
 * Costs real tokens: it drives a real model turn against the real installed backend.
 */
import assert from "node:assert/strict";

import {
  drainIncidentalPermissionRequests,
  newRunId,
  probeClaudeAvailable,
  runScript,
  skip,
  step,
} from "./lib/sidecar-harness.mjs";
```

**Skip-when-unavailable + scratch-repo-creation pattern** (lines 78-95):
```javascript
await runScript(
  "launcher-shape-gate",
  "UAT 7 — launcher-wrapped destructive command, measured live against a throwaway remote (D-63)",
  async (harness) => {
    if (!probeClaudeAvailable()) {
      skip("the real `claude` binary is not resolvable — this item needs a live backend session");
    }

    step("creating a scratch repository with a local bare remote (D-63: the only remote in play)");
    const { remotePath, workPath, defaultBranch } = harness.createRepoWithRemote({
      extraBranches: [DOOMED_BRANCH],
    });
    // ...
  },
);
```
`uat-11-*.mjs` adapts this exact shape for RESEARCH.md's Open Question 1 falsification: instead of a destructive-command probe, it spawns one `claude -p --settings <file> ...` session with a `SessionStart` hook writing a marker-directory `git` shim into `$CLAUDE_ENV_FILE`, prompts `git --version`, and asserts on the marker file's existence (not on transcript narration) — mirroring this file's own "assert on the marker file, never on the transcript's own claims" discipline (see `destructive-gate.test.mjs`'s module doc, same rule, lines 10-11).

**D-63 remote-safety constraint (must be copied verbatim as a comment, not just as behavior):**
```
D-63 — THE ONLY REMOTE THIS SCRIPT MAY EVER TOUCH IS THE LOCAL BARE REPOSITORY
`harness.createRepoWithRemote` CREATES INSIDE THE HARNESS SCRATCH DIRECTORY.
```
This phase's live arm does not need a remote at all (RESEARCH.md: "no remote fixture needed, no destructive command, one harmless probe") but the file should still state D-63 explicitly, since it is the project's standing safety invariant for any live-`claude` UAT script.

**Registration pattern** (`scripts/uat/run-all.sh`, existing lines around 78-92):
```bash
  node scripts/uat/uat-07-launcher-shape-gate.mjs
  node scripts/uat/uat-08-socratic-authoring.mjs
  node scripts/uat/uat-09-product-kill-criterion.mjs
```
Add `node scripts/uat/uat-11-*.mjs` as a new line in the same list, in numeric sequence.

---

### Structural/source gate — "no new launcher tokens in `packages/shim/src/main.rs`" (NEW, Wave 0)

**Analog 1 — source-scanning helpers:** `packages/core/tests/proposal_no_promotion.rs` (lines 1-60, read this session)
```rust
//! Self-contained per this repo's own precedent (`app_exit_ordering.rs`/`session_closed_call_site.rs`):
//! carries its own copies of `workspace_root`/`is_whole_line_comment`/`sources_under` rather than
//! sharing `authoring_proposal.rs`'s — which this file never modifies.

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().expect("packages/core should have a parent")
        .parent().expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() { walk(&path, out); }
            else if path.extension().is_some_and(|e| e == "rs" || e == "ts" || e == "tsx") {
                out.push(path);
            }
        }
    }
    // ... collects (path, contents) pairs
}
```

**Analog 2 — the exact "grep for a forbidden construction" + line-window assertion shape:** `packages/core/tests/supervisor_cwd.rs`, lines 188-253 (the existing single-`Command::new("git")`-construction-site test):
```rust
#[test]
fn only_git_rs_constructs_command_new_git() {
    // ... walks workspace sources, for each line:
    if raw_line.contains("Command::new(\"git\")") {
        // ... collect violations outside packages/core/src/git.rs
    }
    assert!(
        violations.is_empty(),
        "found Command::new(\"git\") outside packages/core/src/git.rs:\n{}",
        violations_report
    );
}

#[test]
fn command_new_git_always_followed_by_dash_c_flag() {
    // For every `Command::new("git")` call site (a builder chain spanning a few lines), the very
    // next non-comment line must be `.arg("-C")` — asserted via a small line-window scan.
    for (idx, line) in lines.iter().enumerate() {
        if !line.contains("Command::new(\"git\")") { continue; }
        // ... window check
        _ => panic!("expected .arg(\"-C\") immediately after Command::new(\"git\") at line {}, window:\n{window}", idx + 1),
    }
    assert!(call_sites_checked > 0, "expected at least one Command::new(\"git\") call site in git.rs");
}
```
The new structural gate for this phase follows the SAME shape: walk `packages/shim/src/main.rs`'s source lines (or diff this phase's version against a pinned baseline string set) and assert no NEW launcher-token literal (`"sh"`, `"bash"`, `"nice"`, `"nohup"`, `"timeout"`, `"xargs"`, `"sudo"`, `"setsid"`, or a new `match` arm in the classifier dispatch) was added, mirroring `only_git_rs_constructs_command_new_git`'s "walk sources, assert absence, fail loud with the violating line" structure. Place it in `packages/core/tests/` (new file, e.g. `destructive_gate_no_new_launcher_tokens.rs`), following `proposal_no_promotion.rs`'s self-contained-helpers precedent rather than sharing a module.

---

## Shared Patterns

### Fail-closed / degrade-safely discipline
**Source:** `packages/sidecar/src/pretooluse-hook.ts` module doc (lines 86-91) and `packages/sidecar/src/claude-code-adapter.ts`'s `writeHookSettings` catch block (lines 210-213)
**Apply to:** `sessionstart-hook.ts`, `git_hooks.rs`'s install call site inside `register_project`, and `writeHookSettings`'s `SessionStart` extension.
```typescript
// claude-code-adapter.ts's existing degrade pattern — reuse verbatim, do not invent a second shape
} catch (err) {
  console.error(`flywheel sidecar: failed to write PreToolUse hook settings for ${runId}: ${String(err)}`);
  return undefined;
}
```
The Known Threat Patterns table in RESEARCH.md states this explicitly: "Mirror `writeHookSettings`'s existing degrade-to-`undefined`-and-log pattern, and — critically — pair it with an explicit test asserting the FAILURE MODE denies rather than silently proceeds with the old, broken premise."

### Single `Command::new("git")` construction-site invariant
**Source:** `packages/core/src/git.rs` (module doc, lines 1-4) + `packages/core/tests/supervisor_cwd.rs` (structural test, lines 188-253)
**Apply to:** `git_hooks.rs` — MUST route every git invocation (including `git config core.hooksPath ...` and any hook-file write verification) through `crate::git::git_at`, never a new `Command::new("git")`. This is a pre-existing, currently-passing structural test; a naive implementation of `git_hooks.rs` that shells out directly will break CI immediately, not just violate style.

### D-63 — throwaway-local-bare-repo-only discipline for any live or git-mutating test
**Source:** `scripts/uat/uat-07-launcher-shape-gate.mjs` (lines 19-32) and `scripts/uat/lib/sidecar-harness.mjs`'s `createRepoWithRemote`
**Apply to:** the new `core.hooksPath`/`pre-push` offline test arm, and `uat-11-*.mjs`. Never add, name, or push to a network remote; the only remote any new test may touch is the one `createRepoWithRemote` creates inside the harness scratch directory.

### Zero-credential-first test design
**Source:** `packages/sidecar/test/destructive-gate.test.mjs` module doc (lines 1-48)
**Apply to:** the new `core.hooksPath` arm and the `SessionStart`-hook unit test — both must run fully offline (`FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude`), with only `uat-11-*.mjs` spending real credentials, per RESEARCH.md's explicit scoping.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/sidecar/test/*sessionstart-hook*.test.mjs` as a STANDALONE file | test | unit | No standalone `pretooluse-hook.test.mjs` file was found as this hook's direct analog in the time budget — its unit coverage appears folded into `destructive-gate.test.mjs` itself. Planner should decide: fold the new `SessionStart` coverage into the same file (matching the apparent existing convention) or create a new sibling file; either is defensible, but there is no separate "one hook, one test file" precedent to point to with certainty. |
| `docs/destructive-gate-trust-boundary.md` new section | documentation | — | Not a code file; no "pattern" analog applies beyond this doc's own existing section structure (Layer 0/1/2 definitions, Round Ten section, Named Residuals), which RESEARCH.md already quotes directly — the planner should follow the doc's own existing heading conventions rather than a separate code analog. |

All seven RESEARCH.md/VALIDATION.md-named files have a located, git-tracked analog. No gitignored/mirror paths were encountered — all analogs above live under `packages/`, `scripts/`, confirmed as ordinary tracked source in this worktree.

## Metadata

**Analog search scope:** `packages/core/src/`, `packages/core/tests/`, `packages/sidecar/src/`, `packages/sidecar/test/`, `packages/shim/src/`, `scripts/uat/`
**Files scanned:** ~15 read/grepped directly (`claude-code-adapter.ts`, `pretooluse-hook.ts`, `destructive-gate.test.mjs`, `uat-07-launcher-shape-gate.mjs`, `run-all.sh`, `sidecar-harness.mjs`, `destructive.rs`, `git.rs`, `domain/project.rs`, `domain/worktree.rs`, `supervisor_cwd.rs`, `proposal_no_promotion.rs`, `main.rs`)
**Pattern extraction date:** 2026-10-01
