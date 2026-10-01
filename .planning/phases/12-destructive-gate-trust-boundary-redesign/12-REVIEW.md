---
phase: 12-destructive-gate-trust-boundary-redesign
reviewed: 2026-10-01T10:23:12Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/core/src/git_hooks.rs
  - packages/core/src/lib.rs
  - packages/core/src/domain/project.rs
  - packages/core/tests/git_hooks_pre_push.rs
  - packages/core/tests/destructive_gate_layer_coverage.rs
  - packages/core/tests/destructive_gate_no_new_launcher_tokens.rs
  - packages/core/tests/fixtures/shim-main-string-literals.baseline.txt
  - packages/shim/src/main.rs
  - packages/sidecar/src/sessionstart-hook.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/test/sessionstart-hook.test.mjs
  - packages/sidecar/test/destructive-gate.test.mjs
  - scripts/uat/uat-11-env-file-ordering.mjs
  - scripts/uat/run-all.sh
  - docs/destructive-gate-trust-boundary.md
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-10-01T10:23:12Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This phase adds Layer 3 (git's own `pre-push` hook) and the `--gate-push` shim entry point it
delegates to, plus the `SessionStart` hook that tries to restore P1 (shim leads `PATH`) for the
command shell. The generated shell script was read line by line for quoting, word-splitting, and
fail-open paths; `run_gate_push` was traced for fail-closed behaviour; the install/uninstall paths
were traced for half-configured or silently-unprotected states; `main.rs`'s diff was isolated and
confirmed to touch only the two new call sites (`run_gate_push` and its dispatch check) — none of
the four scope-fenced functions (`resolve_segment_program_index`, `text_can_shadow_path_resolution`,
`text_names_gated_program`, `raw_text_names_path_defeating_wrapper`) were touched. The shim's own
`shim-main-string-literals.baseline.txt` pin was regenerated correctly and the three new test
targets (`git_hooks_pre_push.rs`, `destructive_gate_layer_coverage.rs`,
`destructive_gate_no_new_launcher_tokens.rs`) all pass locally.

One real coverage gap was found: `relocate_project` — the one recovery path offered for an
unreachable project, and the exact path a developer takes after re-cloning a repository (the
`.flywheel/project.json` marker is committed, so it travels with a fresh clone) — never (re-)installs
the Layer 3 pre-push gate at the new `repo_path`, unlike `register_project`, which always does. The
new location's `.git/config` has no `core.hooksPath` (hooks are never part of git history), so the
relocated project silently loses the Layer 3 backstop with no refusal, no log line, and no
documented residual naming this gap — unlike every other install-declines-silently case this phase
already named in `docs/destructive-gate-trust-boundary.md`'s "Named residuals" table.

Two lower-severity items round out the findings: the `pre-push` install's Step 2 refusal check
(default-hooks-dir pre-push) technically covers the scenario correctly per the documented residual,
so that was NOT re-raised; `sessionstart-hook.ts` has no idempotency guard against being invoked more
than once against the same `CLAUDE_ENV_FILE` within a session (benign, but accumulates duplicate
`PATH` segments).

## Critical Issues

### CR-01: `relocate_project` never (re-)installs the Layer 3 pre-push gate at the new location

**File:** `packages/core/src/domain/project.rs:418-477`
**Issue:** `register_project` (lines 321-340) unconditionally calls
`crate::git_hooks::install_pre_push_hook` after every successful registration, on every branch
(fresh repo, marker-matches-known-row, and the clone-onto-another-machine insert), logging any
refusal or error to stderr. `relocate_project` — "the ONLY recovery action offered for an
unreachable project" per its own doc comment — does nothing of the kind: it verifies the marker,
updates `repo_path` inside its transaction, appends a `project.relocated` event, and returns. It
never calls `install_pre_push_hook`.

Because `.flywheel/project.json` is committed (`packages/core/src/marker.rs`'s own module doc: "COMMITTED, never `.gitignore`d"), the marker travels with any fresh `git clone` of the repository. The exact scenario `relocate_project` exists to recover from — a repository moved or re-cloned to a new local path — is therefore precisely the scenario in which the new location's `.git/config` has never had `core.hooksPath` set (git hooks are never part of a repo's tracked history), so Layer 3 is simply absent there. `relocate_project` has every fact it needs (`canonical`, `project_id`) to call `install_pre_push_hook(&canonical, project_id)` exactly as `register_project` does, but does not.

This is worse than every other "install declines" case this phase documents in
`docs/destructive-gate-trust-boundary.md`'s "Named residuals" table: those are logged refusals with
a reason (`RefusedPreexistingHooksPath`/`RefusedPreexistingPrePush`, printed via `eprintln!` in
`register_project`'s own match arms). Here, nothing is even attempted — no refusal value, no log
line, no event, no entry in the trust-boundary document's residuals table (grepped: `relocate` does
not appear anywhere in `docs/destructive-gate-trust-boundary.md`). A developer who hits "Project
unreachable" and relocates believes the project is fully protected again; the force-push and
branch-deletion categories silently fall back to the pre-phase-12, P1-dependent Layer-2-only
posture for that project, indefinitely, with nothing surfaced anywhere.

No test exercises this either: `packages/core/tests/project_reconciliation.rs`'s
`relocate_project` tests (lines 372, 383) assert on the marker-mismatch rejection and the
`repo_path`/event-log update, never on `core.hooksPath` at the new location.

**Fix:**
```rust
// packages/core/src/domain/project.rs, inside relocate_project, after tx.commit() succeeds
// (mirroring register_project's own post-commit install block, lines 325-340):
match crate::git_hooks::install_pre_push_hook(&canonical, project_id) {
    Ok(crate::git_hooks::PrePushInstall::Installed { .. }) => {}
    Ok(crate::git_hooks::PrePushInstall::RefusedPreexistingHooksPath { existing }) => {
        eprintln!(
            "flywheel core: pre-push gate not installed for {canonical_str}: core.hooksPath is already set to {existing:?}"
        );
    }
    Ok(crate::git_hooks::PrePushInstall::RefusedPreexistingPrePush { path }) => {
        eprintln!(
            "flywheel core: pre-push gate not installed for {canonical_str}: a pre-existing pre-push hook already exists at {path:?}"
        );
    }
    Err(e) => {
        eprintln!("flywheel core: pre-push gate not installed for {canonical_str}: {e}");
    }
}
```
Add a test asserting `core.hooksPath` is set (and carries the `PRE_PUSH_MARKER`) at the relocated
path after a successful `relocate_project` call, mirroring
`git_hooks_pre_push.rs`'s existing install-proof tests. If this asymmetry is intentional, it needs
its own row in `docs/destructive-gate-trust-boundary.md`'s "Named residuals" table, per that
document's own stated discipline ("a checked-in adversarial corpus... give round five a spec to fail
against instead of a list to extend").

## Warnings

### WR-01: `sessionstart-hook.ts` has no idempotency guard against repeated invocation within one session

**File:** `packages/sidecar/src/sessionstart-hook.ts:52-53`
**Issue:** `appendFileSync(envFile, line)` runs unconditionally on every invocation, with no check
for whether this exact prepend was already written to `envFile`. `SessionStart` can fire more than
once for the same running session (Claude Code's hook docs distinguish `startup`/`resume`/`clear`/
`compact` sources), and nothing here is scoped to "only the first time." If `CLAUDE_ENV_FILE` is the
same file across those re-fires within one session, each one appends another
`export PATH="<shimDir>:$PATH"\n` line. Functionally harmless (each line still puts the shim
directory first — it's idempotent in effect, not in representation), but it means the file and the
resulting `PATH` grow by one `<shimDir>:` segment per re-fire, and nothing in
`sessionstart-hook.test.mjs` exercises calling the hook twice against the same `envFile` to confirm
this is bounded and harmless as claimed.
**Fix:** Either accept this as a deliberately-unguarded best-effort write (the module doc already
argues forcefully for simplicity over fail-closed behaviour here) and say so explicitly in the doc
comment, or add a cheap guard — e.g., skip the append if `envFile`'s existing content already
contains the exact `shimDir` segment:
```ts
const existing = fs.existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
if (existing.includes(shimDir)) return;
```

### WR-02: Step 2 of `install_pre_push_hook` is correct-but-worth-flagging for future readers

**File:** `packages/core/src/git_hooks.rs:271-279`
**Issue:** Not re-raised as a new defect — `docs/destructive-gate-trust-boundary.md`'s "Named
residuals" table already documents, verbatim, that the install refuses "when `core.hooksPath` is
already set to a non-Flywheel value, **or** the repository already carries a non-sample executable
`pre-push` script," which is exactly what Step 2 does even when Step 1 has already confirmed
`core.hooksPath` points at a Flywheel-owned directory (i.e., a stale `.git/hooks/pre-push` left by
another tool, such as husky or pre-commit writing directly into the default hooks directory,
permanently blocks any future re-install/refresh of an already-working Flywheel hook, with no way to
distinguish "never installed" from "can't be refreshed" in the returned value). This is accepted,
documented behaviour per this phase's own ruling, not a new finding — recorded here only so a future
reviewer does not need to re-derive why Step 2 runs unconditionally.
**Fix:** None required; no action needed unless the "repository where the pre-push install is
REFUSED" residual row is revisited.

## Info

### IN-01: `relocate_project`'s gap is also a documentation gap

**File:** `docs/destructive-gate-trust-boundary.md`
**Issue:** CR-01 above has no corresponding row anywhere in the "Named residuals" table, even though
every other known way Layer 3 can end up absent for a given repository has one. `destructive_gate_layer_coverage.rs`'s `every_named_layer_is_a_real_section_heading_in_the_trust_boundary_doc` test proves the table's *layer names* are backed by real headings, but nothing proves the table's *residual rows* are complete against the actual install call sites.
**Fix:** Once CR-01 is fixed (or explicitly accepted as a residual), add the corresponding row.

---

_Reviewed: 2026-10-01T10:23:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
