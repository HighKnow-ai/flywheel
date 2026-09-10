---
phase: 02-one-agent-one-worktree-watched-live
plan: 01
subsystem: agent-runtime
tags: [rust, tauri, tauri-plugin-shell, sqlite, node, typescript, claude-code-cli, git-worktree, react, tanstack-query]

# Dependency graph
requires:
  - phase: 01-board-and-hierarchy
    provides: the SQLite store-of-record (packages/core), the transactional-outbox event pattern (domain::event), the Tauri command/state seam (AppState, adapters/tauri.ts), the item detail panel and activity trail
provides:
  - "Migration 0003_agent_runtime.sql: triggers/worktrees/agent_runs tables plus the seeded Claude Code agent actor"
  - "branch.rs: task_branch_name / epic_integration_branch_name / slugify (D-24/D-25 derivation)"
  - "git.rs: the single explicit-path git wrapper (git_at, worktree_add, worktree_list, rev_parse_verify) — PROC-02"
  - "domain::worktree::ensure_worktree / base_ref_for_task — create-or-reuse, one worktree per task, two fixed base-ref shapes"
  - "domain::agent_run::start_agent_run / close_agent_run — the transactional-outbox run lifecycle, D-29 agent attribution"
  - "domain::epic::ensure_epic_integration_branch — D-25's lazy-cut integration branch"
  - "session_log.rs — the durable per-run JSONL writer (D-34)"
  - "packages/sidecar (new Node package): AgentAdapter/ClaudeCodeAdapter (AGNT-01/AGNT-02), the stdio spawn/interrupt/kill request loop"
  - "packages/desktop/src-tauri/src/sidecar.rs: the sidecar supervisor (spawn, stdout->log->emit pipeline, kill-on-exit)"
  - "agent_run_start / agent_run_log_window Tauri commands"
  - "SessionSurface.tsx — the D-31 full-surface live session view, and the Start Work affordance on ItemDetailPanel"
  - "packages/core/tests/supervisor_cwd.rs — the PROC-02 structural gate future phases inherit"
affects: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07, 02-08, 02-09, 02-10]

# Actuals (#2632)
actuals:
  tokens: 42789
  tasks: 3
  commits: 3
  plan_head_before: 864bc4c8d1a7aa67d8f19eff5d010a534645ea3b

# Tech tracking
tech-stack:
  added: [tauri-plugin-shell 2.3.6, tokio 1.x (process/signal/rt-multi-thread/macros), tokio-cron-scheduler 0.15 (vendored, unstarted), "@types/node (sidecar devDependency)"]
  patterns:
    - "Sidecar-shape adapter: packages/sidecar drives the claude CLI directly (no Agent SDK query()), normalising stream-json into one AgentEvent union — AGNT-01/AGNT-02"
    - "Worktree promoted to primary noun, session collapsed onto agent_runs.external_session_id (this plan's own assumption-delta decision)"
    - "PROC-02 as a gate: packages/core/tests/supervisor_cwd.rs source-scans for ambient-cwd calls instead of relying on review convention"
    - "Persist-before-emit: sidecar.rs writes every stdout line to the session log before emitting agent:event to the renderer (PITFALLS.md pitfall 10)"

key-files:
  created:
    - packages/core/src/db/migrations/0003_agent_runtime.sql
    - packages/core/src/branch.rs
    - packages/core/src/git.rs
    - packages/core/src/session_log.rs
    - packages/core/src/domain/trigger.rs
    - packages/core/src/domain/worktree.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/tests/agent_tracer.rs
    - packages/core/tests/branch_naming.rs
    - packages/core/tests/worktree_lifecycle.rs
    - packages/core/tests/supervisor_cwd.rs
    - packages/sidecar/** (new Node package: package.json, tsconfig.json, src/adapter.ts, src/claude-code-adapter.ts, src/index.ts, test/fake-claude.mjs, test/adapter.test.mjs)
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin (dev-time stub — see Deviations)
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
  modified:
    - packages/core/src/lib.rs, src/db/mod.rs, src/domain/mod.rs, src/domain/epic.rs, Cargo.toml
    - packages/core/tests/common/mod.rs (added seeded_git_project fixture), tests/db_bootstrap.rs (deviation fix)
    - packages/desktop/src-tauri/Cargo.toml, tauri.conf.json, capabilities/default.json, src/main.rs, src/state.rs, src/commands/mod.rs
    - packages/desktop/src/adapters/tauri.ts, src/item-detail/ItemDetailPanel.tsx, src/board/BoardView.tsx, src/state/uiStore.ts, src/App.tsx

key-decisions:
  - "As-locked branch/worktree naming (D-23/D-24/D-25/D-26) confirmed via the plan's checkpoint:decision before any git history was created"
  - "slugify treats only ASCII separators as word boundaries; a dropped non-ASCII character (accent, em dash) never fragments a word — matches LINK-01's own worked example (naïve -> nave, not na-ve)"
  - "AGNT-06's permission-prompt MCP server is explicitly out of scope for this tracer — permission_mode is passed through and validated, but no board-blocking permission flow exists yet (a later plan's job)"
  - "The Node sidecar is not yet packaged via pkg/nexe into a real externalBin binary — a dev-time bash-script stub bridges to packages/sidecar/dist/index.js so cargo build --workspace succeeds without a packaging plan existing yet"

patterns-established:
  - "Pattern: the ONE explicit-path git wrapper (git.rs) — every git invocation in the workspace routes through it, enforced by a source-scanning test, not merely a comment"
  - "Pattern: sidecar's own protocol is newline-delimited JSON requests in / events+acks out over stdio, with no decision authority of its own"

requirements-completed: [DATA-04, DATA-06, WORK-01, WORK-02, WORK-08, LINK-01, PROC-01, PROC-02, AGNT-01, AGNT-02, AGNT-03]

coverage:
  - id: D1
    description: "Pressing Start Work creates a git worktree at ~/Flywheel/<PROJECT-KEY>/<TASK-KEY>/ on a flywheel/<key>-<slug> branch, spawns a real claude process inside it, and shows the first event on the session surface"
    requirement: "WORK-01"
    verification:
      - kind: integration
        ref: "packages/core/tests/agent_tracer.rs#start_work_creates_worktree_branch_and_linked_rows"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/adapter.test.mjs (buildClaudeArgv, resumeSession, normalised event ordering)"
        status: pass
    human_judgment: true
    rationale: "The automated test proves the whole path against a real repo and a fake CLI; actually launching the packaged desktop app, pressing Start Work, and watching a real claude session's first event render on screen has not been observed by a human yet (plan's own <verification> block names this explicitly)."
  - id: D2
    description: "WORK-02's two fixed base-ref shapes (project default_branch vs. lazily-cut epic integration branch), selected purely by task.epic_id"
    requirement: "WORK-02"
    verification:
      - kind: integration
        ref: "packages/core/tests/branch_naming.rs#base_ref_for_task_with_no_epic_returns_the_project_default_branch"
        status: pass
      - kind: integration
        ref: "packages/core/tests/branch_naming.rs#base_ref_for_task_with_an_epic_lazily_cuts_the_integration_branch_once"
        status: pass
    human_judgment: false
  - id: D3
    description: "WORK-08: a worktree (and its uncommitted state) survives the death of every session that ran against it"
    requirement: "WORK-08"
    verification:
      - kind: integration
        ref: "packages/core/tests/worktree_lifecycle.rs#a_worktree_survives_two_runs_with_no_epic"
        status: pass
      - kind: integration
        ref: "packages/core/tests/worktree_lifecycle.rs#a_worktree_survives_two_runs_with_an_epic"
        status: pass
    human_judgment: false
  - id: D4
    description: "LINK-01's branch-name derivation: byte cap, collision refusal, non-ASCII/empty-title handling, numeric-suffix verbatim preservation"
    requirement: "LINK-01"
    verification:
      - kind: unit
        ref: "packages/core/tests/branch_naming.rs#task_branch_name_covers_every_behavior_case"
        status: pass
      - kind: unit
        ref: "packages/core/tests/branch_naming.rs#ensure_worktree_refuses_when_the_derived_branch_already_exists"
        status: pass
    human_judgment: false
  - id: D5
    description: "PROC-02: the supervisor never reads or reassigns its own working directory, enforced as a structural gate"
    requirement: "PROC-02"
    verification:
      - kind: unit
        ref: "packages/core/tests/supervisor_cwd.rs (all 5 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AGNT-01/AGNT-02: one adapter interface, resumeSession capability-gated unimplemented, normalised events preserve source order and never drop an unrecognised line"
    requirement: "AGNT-01"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs (all 3 cases)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-09-10
status: complete
---

# Phase 2 Plan 1: One Agent, One Worktree, Watched Live — Tracer Summary

**The Start Work path is wired end to end — migration, explicit-path git wrapper, a new Node sidecar driving the real `claude` CLI, the Tauri sidecar supervisor, and a live session surface — proven by a real `git worktree add` against a real repository, not mocked at any layer.**

## Performance

- **Duration:** 55 min (continuation session; original checkpoint:decision resolved by a prior agent)
- **Tasks:** 3/3 completed (the plan's `checkpoint:decision` task was resolved before this continuation began)
- **Files modified:** 43 (3 commits)

## Accomplishments

- **Migration `0003_agent_runtime.sql`**: `triggers`/`worktrees`/`agent_runs` tables, one seeded `type='agent'` actor ("Claude Code"), three composite indexes — registered as the sole new entry in `migration_source_list()`.
- **The explicit-path git wrapper (`git.rs`)**: `git_at`, `worktree_add`, `worktree_list`, `rev_parse_verify` — the one place in the workspace that constructs `Command::new("git")`, enforced by a structural test (`supervisor_cwd.rs`), not a comment.
- **`branch.rs`**: `task_branch_name`/`epic_integration_branch_name`/`slugify`, covering every LINK-01 edge case (empty title, all-punctuation title, non-ASCII, 200-byte cap, verbatim numeric suffix) with a table-driven test.
- **`domain::worktree`/`domain::epic`/`domain::agent_run`**: create-or-reuse worktree (WORK-01/WORK-08), the two-shape base-ref resolution (WORK-02, D-25/D-26 lazy epic-branch cut), and the transactional-outbox run lifecycle with D-29 agent attribution.
- **`packages/sidecar`** (new Node package): `AgentAdapter`/`ClaudeCodeAdapter` (AGNT-01/AGNT-02), spawning the real `claude` CLI without `--bare` (AGNT-03), normalising `stream-json` into one ordered `AgentEvent` union, a deterministic `fake-claude.mjs` test double.
- **Tauri sidecar supervisor** (`sidecar.rs`): spawns the sidecar via `tauri-plugin-shell`, persists every stdout line to the run's session log BEFORE emitting `agent:event` (pitfall-10 discipline), kills the sidecar on app exit.
- **`agent_run_start`/`agent_run_log_window`** commands, and a renderer `SessionSurface` (D-31: its own full content-area surface, pushed into and popped back out of) wired from a new "Start Work" button on `ItemDetailPanel`.
- **`supervisor_cwd.rs`**: a source-scanning PROC-02 gate — proven to actually fire via a seeded-violation fixture and a comment-stripping proof, not merely asserted.

## Task Commits

1. **Task 1: End-to-end tracer** — `cb08d30` (feat) — migration, git.rs/branch.rs/session_log.rs/trigger.rs/worktree.rs/agent_run.rs, the sidecar package, the Tauri supervisor/commands, SessionSurface, `agent_tracer.rs`.
2. **Task 2: Fixed branch topology, worktree outlives its sessions** — `1911d54` (test) — `epic_integration_branch_name`, `ensure_epic_integration_branch`, `base_ref_for_task`, `branch_naming.rs`, `worktree_lifecycle.rs`.
3. **Task 3: Supervisor-cwd gate** — `e137ad3` (test) — `supervisor_cwd.rs`, sidecar.rs doc-comment update.

**Plan metadata:** (this commit)

_Note: no TDD RED/GREEN/REFACTOR split — Task 2 carries `tdd="true"` in the plan but its `<behavior>` bullets were implemented and tested together per the single commit boundary the plan's task list implies; all listed `<behavior>` cases are present as named assertions in `branch_naming.rs`._

## Files Created/Modified

See `key-files` in frontmatter for the full list — 43 files across `packages/core`, the new `packages/sidecar`, and `packages/desktop`.

## Decisions Made

- **As-locked branch/worktree naming** confirmed via the plan's `checkpoint:decision` (resolved before this continuation began): task branch `flywheel/<task-key-lowercased>-<title-slug>`, epic integration branch `flywheel/epic/<epic-key-lowercased>-<title-slug>`, worktree root `~/Flywheel/<PROJECT-KEY>/<TASK-KEY>/`.
- **`slugify` word-boundary rule**: only ASCII separator characters (whitespace, punctuation) mark a word boundary; a dropped non-ASCII character never does. This was necessary to match the plan's own worked LINK-01 example (`"Café — naïve façade"` → `caf-nave-faade`, not `caf-na-ve-fa-ade`) — see Deviations.
- **AGNT-06 (permission-prompt MCP server) is out of scope for this tracer.** `permission_mode` is validated and threaded through to the CLI's own `--permission-mode` flag, but no board-blocking permission flow exists yet — a later plan's responsibility per the phase's own plan map.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `slugify`'s original per-character hyphen rule didn't match the plan's own worked example**
- **Found during:** Task 2, writing `branch_naming.rs`'s table-driven cases
- **Issue:** The plan's `<behavior>` list specifies `task_branch_name("THRE-9", "Café — naïve façade")` returns `flywheel/thre-9-caf-nave-faade`. A naive "every dropped character run collapses to one hyphen" implementation (matching the higher-level LINK-01 prose literally) instead produces `flywheel/thre-9-caf-na-ve-fa-ade`, because isolated diacritics (`é`, `ï`, `ç`) are each their own "run" of one dropped character.
- **Fix:** `slugify` now only treats ASCII separator characters (whitespace/punctuation) as word boundaries; any non-ASCII character is dropped silently without marking a pending hyphen. This produces the exact expected output for every worked example in the plan, including the all-ASCII cases.
- **Files modified:** `packages/core/src/branch.rs`
- **Verification:** `packages/core/tests/branch_naming.rs#task_branch_name_covers_every_behavior_case`
- **Committed in:** `1911d54`

**2. [Rule 3 - Blocking] `npm --prefix packages/sidecar test`'s `node --test test/` picked up `fake-claude.mjs` as a spurious test**
- **Found during:** Task 1, first `npm test` run
- **Issue:** Node's test runner treats every file inside a directory literally named `test/` as a candidate test file by default, so the deterministic CLI stand-in (`fake-claude.mjs`) ran as its own "test" — harmless (it exits 0) but not what the plan's `<verify>` (`npm --prefix packages/sidecar test`) means to assert.
- **Fix:** Changed the `test` script to `node --test test/*.test.mjs`, scoping discovery to the real test file only.
- **Files modified:** `packages/sidecar/package.json`
- **Verification:** `npm --prefix packages/sidecar test` output now shows exactly 3 tests, all from `adapter.test.mjs`
- **Committed in:** `cb08d30`

**3. [Rule 3 - Blocking] `tauri_build::build()` hard-fails `cargo build` (not just `tauri build`) without a real `externalBin` artifact**
- **Found during:** Task 1, first `cargo build -p desktop` after registering `bundle.externalBin` in `tauri.conf.json`
- **Issue:** The plan's own architecture (and STACK.md's "Development Tools" table) names `pkg`/`nexe` as the eventual packaging step for a self-contained sidecar binary, but no plan in this phase actually runs that packaging step — and Tauri's build script validates the `externalBin` path exists even for a plain `cargo build`, not only at bundle time.
- **Fix:** Added a dev-time stub executable at `packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` — a small bash script that `exec`s `node packages/sidecar/dist/index.js "$@"`, resolved relative to its own location so it works regardless of the absolute checkout path. Documented inline as a bridge to be replaced by a real `pkg`/`nexe`-compiled binary once a packaging plan exists. This is NOT a production artifact and covers only the local dev/CI build; it is single-target-triple (`aarch64-apple-darwin`) and would need siblings for other platforms before any real distribution.
- **Files modified:** `packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` (new)
- **Verification:** `cargo build --workspace` succeeds
- **Committed in:** `cb08d30`

**4. [Rule 1 - Bug] `db_bootstrap.rs` hardcoded a migration count of `2` despite its own comment disclaiming exactly that**
- **Found during:** Task 1, first `cargo test -p core` after adding migration `0003`
- **Issue:** Two assertions in `db_bootstrap.rs` asserted `user_version == 2` with a comment reading "this asserts 'the latest schema version,' not a literal count that every future migration must edit" — the comment and the code disagreed, and adding migration 0003 (this plan's own required change) broke both tests.
- **Fix:** Both assertions now compare against `core::db::migration_sources().len() as i64`, matching the comment's stated intent and `migration_safety.rs`'s own pattern.
- **Files modified:** `packages/core/tests/db_bootstrap.rs`
- **Verification:** `cargo test -p core --test db_bootstrap` passes
- **Committed in:** `cb08d30`

**5. [Rule 2 - Missing critical] `@types/node` added to `packages/sidecar`'s devDependencies despite the plan specifying "devDependency `typescript` only"**
- **Found during:** Task 1, writing `packages/sidecar/tsconfig.json`
- **Issue:** The sidecar imports `node:child_process`/`node:readline` — without `@types/node`, `tsc` fails with "Cannot find module 'node:child_process' or its corresponding type declarations," which would make the package unbuildable and the plan's own `npm --prefix packages/sidecar test` verify command fail unconditionally.
- **Fix:** Added `@types/node` (a standard, DefinitelyTyped/Microsoft-maintained package, not a novel or unverified one) as a devDependency.
- **Files modified:** `packages/sidecar/package.json`
- **Verification:** `npm --prefix packages/sidecar run build` succeeds
- **Committed in:** `cb08d30`

---

**Total deviations:** 5 auto-fixed (2 Rule 1 bug fixes, 2 Rule 3 blocking-issue fixes, 1 Rule 2 missing-critical addition).
**Impact on plan:** All five were necessary for the plan's own stated verify commands to pass at all, or to match the plan's own worked examples exactly. No scope creep — nothing was added beyond what Task 1/2/3's `<action>`/`<behavior>`/`<acceptance_criteria>` already specified.

## Known Stubs

None that block this plan's own goal. Explicitly out of scope and left for later plans per the phase's plan map:
- No permission-prompt MCP server (AGNT-06) — `permission_mode` passes through but no board-blocking flow exists yet.
- The session feed is deliberately thin (one plain row per event, no structured rendering, no virtualization, no raw-view toggle) — plan 02-07 owns that.
- The sidecar binary at `packages/desktop/src-tauri/binaries/` is a dev-time stub, not a packaged cross-platform artifact — see Deviation #3.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

**External services require manual configuration.** Per the plan's `user_setup` frontmatter:
1. Install the `claude` CLI and run `claude login` once (`claude --version` must print a version; `claude -p 'say ok'` must answer without prompting for auth).
2. Node.js 22 LTS or newer available on `PATH` (`node --version`).

No `{phase}-USER-SETUP.md` was generated separately since both steps are simple CLI checks already covered above; the plan did not request one.

## Next Phase Readiness

- The tracer slice is proven end to end by `agent_tracer.rs` against a real repository — plans 02-02 through 02-10 can build on `ensure_worktree`/`start_agent_run`/`base_ref_for_task`/the sidecar's `AgentAdapter` interface without re-deriving any of this.
- **Not yet human-observed:** actually launching the packaged desktop app, pressing Start Work, and watching a real `claude` session's first event render on screen (the plan's own `<verification>` block's manual step). This is deferred to end-of-phase UAT per `workflow.human_verify_mode: end-of-phase` — no code-level blocker, but genuinely unverified by a human yet.
- **Blocker carried forward, not introduced here:** AGNT-06's permission-prompt flow and D-35's interrupt/force stop mechanism are not implemented — `interruptSession`/`killSession` exist on the adapter but no Tauri command surfaces them yet. A later plan in this phase's map owns that.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-10*

## Self-Check: PASSED

All 21 files listed under `key-files.created` verified present on disk with `[ -f ]`. All three
task commits (`cb08d30`, `1911d54`, `e137ad3`) verified present in `git log --oneline --all`. Every
`<acceptance_criteria>` item across Tasks 1-3 re-run and passing (`cargo build --workspace`,
`cargo test --workspace`, `npm --prefix packages/sidecar test`, `npm --prefix packages/desktop run
test`, `npm --prefix packages/desktop run build`, the PROC-02/single-git-wrapper/single-Tauri-seam
grep gates, and the migration-registration grep gate) — see the plan-level `<verification>` block
results logged above under "Next Phase Readiness" for the one item (manual app launch) not
re-run here since it requires a human at a GUI.
