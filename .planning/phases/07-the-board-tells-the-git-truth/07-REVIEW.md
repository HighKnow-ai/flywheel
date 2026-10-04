---
phase: 07-the-board-tells-the-git-truth
reviewed: 2026-10-04T00:00:00Z
depth: standard
files_reviewed: 54
files_reviewed_list:
  - packages/core/Cargo.toml
  - packages/core/src/db/migrations/0017_forge_setting.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/project.rs
  - packages/core/src/domain/settings.rs
  - packages/core/src/domain/task.rs
  - packages/core/src/domain/worktree.rs
  - packages/core/src/forge/github.rs
  - packages/core/src/forge/gitlab.rs
  - packages/core/src/forge/mod.rs
  - packages/core/src/forge/request_body.rs
  - packages/core/src/forge/transitions.rs
  - packages/core/src/git_facts.rs
  - packages/core/src/git_hooks.rs
  - packages/core/src/git_identity.rs
  - packages/core/src/git.rs
  - packages/core/src/lib.rs
  - packages/core/src/query/forge.rs
  - packages/core/src/query/mod.rs
  - packages/core/tests/bin/forge_probe.rs
  - packages/core/tests/commit_msg_hook.rs
  - packages/core/tests/forge_board_flags.rs
  - packages/core/tests/forge_degrade.rs
  - packages/core/tests/forge_normalize.rs
  - packages/core/tests/forge_request_body.rs
  - packages/core/tests/git_facts.rs
  - packages/core/tests/git_hooks_pre_push.rs
  - packages/core/tests/git_identity.rs
  - packages/core/tests/open_worktree.rs
  - packages/core/tests/outside_commit_detection.rs
  - packages/core/tests/status_transitions.rs
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/Cargo.toml
  - packages/desktop/src-tauri/src/commands/forge.rs
  - packages/desktop/src-tauri/src/commands/git_identity.rs
  - packages/desktop/src-tauri/src/commands/git_truth.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/worktree_open.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/scheduler.rs
  - packages/desktop/src-tauri/src/state.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/item-detail/ForgeSection.tsx
  - packages/desktop/src/item-detail/GitFactsSection.tsx
  - packages/desktop/src/item-detail/ItemDetailPanel.tsx
  - packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx
  - packages/desktop/src/item-detail/WorktreeSummary.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/settings/SettingsSurface.tsx
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-10-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 54
**Status:** issues_found

## Summary

Phase 7 wires git and forge truth into the board: a read-only git-facts path, a commit-msg
trailer hook, two independent `gh`/`glab` adapters behind a normalized model, an edge-triggered
forward-only status transition, outside-commit detection, a git-identifier resolver, and a
preview-then-publish forge-request flow. The command-injection and path-containment risk areas
named in the brief are handled well and are directly proven by tests (`open_worktree.rs`'s
dangerous-path case, `git_identity.rs`'s `classify` rejecting `--upload-pack=/bin/sh`,
`forge_request_body.rs`'s/`forge_normalize.rs`'s body-never-in-argv cases). The forward-only,
edge-triggered transition logic in `forge/transitions.rs` is correct and independently traced
against `query/forge.rs`'s baseline reconstruction; `status_transitions.rs` exercises every
branch named in the module header, including the terminal-merge and manual-move-back cases. The
"no forge configured renders nothing" contract holds on both the Rust (`Forge::Local` short-
circuits before any process spawn) and React (`ForgeSection.tsx` early-returns before any header)
halves. Migration `0017_forge_setting.sql` is a single additive `ALTER TABLE ADD COLUMN` with a
schema-level `CHECK`, consistent with the codebase's existing idiom.

The one finding that actually blocks shipping is in the scheduler: the forge-poll and fetch jobs
hold the single application-wide `AppState.db` mutex across unbounded, timeout-free network
subprocess calls (`gh`/`glab`, `git fetch`), which can freeze every other Tauri command in the
app for as long as those calls take.

## Critical Issues

### CR-01: The forge-poll and fetch scheduler ticks hold the app-wide DB mutex across untimed network subprocess calls

**File:** `packages/desktop/src-tauri/src/scheduler.rs:244-308` (forge tick), `packages/desktop/src-tauri/src/scheduler.rs:200-229` (fetch tick)
**Issue:** `AppState.db` (`packages/desktop/src-tauri/src/state.rs:16`) is a single
`Mutex<Connection>` that every Tauri command handler locks before touching the database —
confirmed by grepping every command module, all of which do `state.db.lock()` as their first
statement. `run_forge_tick` acquires that lock at `scheduler.rs:248` and does not drop it
(`scheduler.rs:303`) until after a `for worktree in &worktrees` loop that, for every tracked
worktree, calls `flywheel_core::forge::request_for_branch` (`scheduler.rs:270-274`), which shells
out to `gh pr list`/`gh auth status` or `glab mr list`+`glab mr view` (`forge/github.rs:35-53`,
`forge/gitlab.rs:34-36,86-103`). None of these `Command::new(...).output()`/`.spawn()` calls in
`forge/github.rs`, `forge/gitlab.rs`, or `git.rs`'s `spawn_git` carry any timeout — a slow network
path, an interactively-hanging CLI, or GitHub/GitLab rate-limiting (which can make `gh`/`glab`
retry or stall) blocks that call indefinitely. The same pattern exists in `run_fetch_tick`
(`scheduler.rs:200-229`): the lock is held at line 204 across a `git fetch --quiet origin` call
per active project (`git.rs:221-228`, also untimed) before being dropped only when the function
returns.

Because every other Tauri command (board reads, task mutations, agent-run commands, worktree
removal, etc.) also locks this same mutex, a single hung `gh`/`glab`/`git fetch` invocation — on
an unreachable host, a rate-limited account, or a CLI stuck waiting for an interactive prompt —
freezes the entire application's command surface for as long as that call is stuck, with no
upper bound. This is materially worse than "blocking the other three scheduler jobs" (the risk
area named in the brief): it blocks every user-initiated action in the app, including completely
unrelated operations like moving a card or opening the item detail panel.

**Fix:** Resolve the worktree/project list under the lock, then drop it before making any network
call; only re-acquire the lock for the (fast, local) write that applies the observation or records
the fetch result. Concretely, read `tracked_worktrees`/active-project-ids while holding the
mutex, `drop(conn)`, perform every `request_for_branch`/`fetch_origin_for_project` call with no
lock held, and acquire a fresh short-lived lock only for `apply_forge_observation`'s own
transaction:

```rust
fn run_forge_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return; };

    let (worktrees, actor_id) = {
        let Ok(conn) = state.db.lock() else { /* ... */ return; };
        let worktrees = tracked_worktrees(&conn, false).unwrap_or_default();
        let actor_id = match system_actor(&conn) { Ok(a) => a.id, Err(_) => return };
        (worktrees, actor_id)
        // lock dropped here
    };

    let mut any_changed = false;
    for worktree in &worktrees {
        // Network call happens with NO lock held.
        let observed = flywheel_core::forge::request_for_branch(/* needs its own short conn lock
            just to resolve the stored forge override+repo_path, not held across the subprocess */
            ..., &worktree.project_id, &worktree.branch);
        // Re-acquire the lock only for the local write:
        if let Ok(mut conn) = state.db.lock() {
            if let Ok(outcome) = apply_forge_observation(&mut conn, &worktree.task_id, observed.as_ref(), &actor_id) {
                any_changed |= outcome.status_changed_to.is_some() || outcome.events_appended > 0;
            }
        }
    }
    if any_changed { emit_board_changed(app); }
}
```

`forge::request_for_branch`/`forge_for_project` themselves take `&Connection` to resolve the
stored override and repo path — that read is a single fast `SELECT`, so it can take its own
short-lived lock rather than reusing the caller's. The same restructuring applies to
`run_fetch_tick`: resolve `project_ids` under the lock, drop it, then call `git::fetch_origin`
(not `fetch_origin_for_project`, which re-takes the lock internally) directly against each
`repo_path`. As a secondary, cheaper mitigation independent of the restructuring above, consider
adding a hard wall-clock timeout around the `gh`/`glab`/`git fetch` child processes (e.g. a
watchdog thread that kills the child after N seconds) so a single hung call cannot block
indefinitely even once it no longer holds the DB mutex.

## Warnings

### WR-01: `git_identifier_resolve` builds its title lookup via `format!`-interpolated SQL, breaking the crate's own no-`format!`-SQL convention

**File:** `packages/desktop/src-tauri/src/commands/git_identity.rs:62-69`
**Issue:** `query/mod.rs`'s own header states the crate-wide rule explicitly: "Every SQL statement
in this crate is a literal string bound through named parameters … or `params![]` — never
assembled with the string-interpolation macro this crate's tests grep-gate against." This command
builds its query with `format!("SELECT title FROM {title_table} WHERE id = ?1")` where
`title_table` is `"epics"` or `"tasks"`. Today `title_table` can only ever be one of those two
hardcoded literals, so this is not currently exploitable — but it is the one place in the
phase-7 surface that departs from the established discipline, and it lives in the Tauri command
layer where the `supervisor_cwd.rs`/`T-01-01`/`T-01-23` grep gates that protect `packages/core`
do not reach (those gates scan `packages/core`, not `packages/desktop/src-tauri`). A future edit
that threads a caller-influenced value into `title_table` (or copies this pattern for a less
constrained field) would reintroduce a real injection path with no structural gate to catch it.
**Fix:** Replace the two-armed `format!` with two literal, compile-time `query_row` calls:
```rust
let item_title: String = if resolution.item_kind == "epic" {
    conn.query_row("SELECT title FROM epics WHERE id = ?1", [&resolution.item_id], |row| row.get(0))
} else {
    conn.query_row("SELECT title FROM tasks WHERE id = ?1", [&resolution.item_id], |row| row.get(0))
}.map_err(|e| e.to_string())?;
```

### WR-02: `fetch_origin_for_project`/`git fetch`/`gh`/`glab` subprocess calls carry no execution timeout anywhere in this phase

**File:** `packages/core/src/git.rs:221-228` (`fetch_origin`), `packages/core/src/forge/github.rs:35-53` (`spawn_gh`), `packages/core/src/forge/gitlab.rs:34-36` (`spawn_glab`)
**Issue:** Every subprocess this phase shells out to (`git fetch`, `gh pr list`/`gh auth status`,
`glab mr list`/`glab mr view`/`glab auth status`) is spawned via a plain `.output()`/`.spawn()`
call with no wall-clock bound. This is the direct mechanism behind CR-01 above, but it is also a
latent problem independent of the locking structure: even after CR-01's fix moves these calls
outside the DB-mutex critical section, a hung `gh`/`glab`/`git fetch` process still never
completes and the scheduler tick that spawned it never finishes, silently starving that one job
(and, for the forge tick specifically, every worktree queued after the stuck one in the same
tick) forever. Related: this is the "missing timeouts" half of the phase's own named risk area #5.
**Fix:** Wrap each subprocess invocation with a bounded wait — either a dedicated watchdog thread
that kills the child after a fixed ceiling (a few seconds is generous for a local `git fetch`;
`gh`/`glab` may need longer but should still be bounded, e.g. 30s), or migrate these call sites to
`tokio::process::Command` with `tokio::time::timeout` now that the desktop crate already depends
on `tokio` with the `time` feature (`packages/desktop/src-tauri/Cargo.toml:18`).

## Info

### IN-01: `ForgeSection.tsx` renders the forge's own `url`/`ciUrl` as live, unsanitized `<a href>` targets

**File:** `packages/desktop/src/item-detail/ForgeSection.tsx:89-93,106-108`
**Issue:** `request.url` and `request.ciUrl` come verbatim from `gh pr list --json ...url...`/
`glab mr list ...web_url...` output (`forge/github.rs:231`, `forge/gitlab.rs:163`) and are passed
straight into `href` with no scheme validation. React does not execute a `javascript:` URI on
render, and the realistic threat model here (the developer's own already-authenticated `gh`/`glab`
CLI talking to their own configured forge) makes this low-severity — but it is nonetheless an
unvalidated external value reaching a navigable `href`, and a forge that returned a non-`http(s)`
scheme (a compromised or misconfigured self-hosted instance) would be followed without complaint
on click. Not severe enough to block, but worth a defensive scheme check if this pattern is
reused elsewhere with a less trusted data source.
**Fix:** Optional: gate rendering the link on `url.startsWith("http://") || url.startsWith("https://")`,
falling back to plain text otherwise.

## Clean Areas Worth Noting

- **Command injection (risk area #1):** Every `git`/`gh`/`glab` invocation in this phase passes an
  argv vector (`Command::new(...).args(&[...])`) — never a shell string. Branch names are always
  `flywheel/`-namespaced (`branch.rs`'s `task_branch_name`/`epic_integration_branch_name`) and can
  never begin with `-`. `git_identity.rs::classify` is a hard allowlist (hex-digest shape or
  `flywheel/`-prefix) that runs *before* any value reaches a subprocess, proven directly against
  `classify("--upload-pack=/bin/sh") == None` in `tests/git_identity.rs:188-192`. The forge
  request body is transported via stdin (`gh --body-file -`) or an owner-only tempfile
  (`glab --description-file`), never argv — proven byte-for-byte in `forge_normalize.rs`'s
  `TRICKY_BODY` tests and `tests/open_worktree.rs`'s dangerous-path case.
- **Path containment (risk area #2):** `worktree_open`'s Tauri command never accepts a path from
  the renderer; it resolves the worktree's path from the `worktrees` table, whose row is only ever
  written by `ensure_worktree`/`recreate_worktree_for_task`, both of which route through
  `git::worktree_add`'s `starts_with(&worktree_root)` guard before any row is inserted. The path
  column is never mutated after insert, so there is no later point where an unvalidated path could
  be substituted in.
- **Forward-only, edge-triggered transitions (risk area #3):** Traced independently against
  `query/forge.rs`'s event-sourced baseline reconstruction and confirmed by
  `status_transitions.rs`'s full suite (terminal-merge, manual-move-back survives a repeat
  identical observation, changes-requested/closed-unmerged never move status, restart-safety).
  The logic is correct, not merely asserted by its own tests written to match the implementation —
  independent tracing through `apply_forge_observation`'s branches confirms it moves status only
  forward and only on an observed state change.
- **Degradation with no forge configured (risk area #4):** `Forge::Local` short-circuits in
  `forge::request_for_branch`/`create_request` before any process is spawned (`forge/mod.rs:181-186,204-211`),
  proven by sabotage in `forge_degrade.rs` (a stub `gh`/`glab` on `PATH` that must never be
  invoked). `ForgeSection.tsx` renders nothing (not even a header) for `noForgeConfigured`/
  `noWorktree`, matching the stated contract exactly.
- **SQL/migration (risk area #6):** `0017_forge_setting.sql` is a single additive `ALTER TABLE
  ADD COLUMN ... CHECK (...)`, consistent with the established migration idiom. Every new query in
  `query/forge.rs` and `forge/request_body.rs` binds through `params![]`/`named_params!` against
  compile-time-literal SQL text.

---

_Reviewed: 2026-10-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
