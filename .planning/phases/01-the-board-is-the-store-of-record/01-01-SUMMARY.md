---
phase: 01-the-board-is-the-store-of-record
plan: 01
subsystem: infra
tags: [tauri, react, rusqlite, sqlite, ulid, rusqlite_migration, vitest, cargo-workspace, monorepo]

# Dependency graph
requires: []
provides:
  - "Cargo workspace (packages/core, packages/relay-client, packages/desktop/src-tauri)"
  - "Tauri v2 desktop shell (react-ts) with a default-deny capabilities manifest"
  - "packages/desktop/src/adapters/tauri.ts — the single invoke/listen seam"
  - "packages/desktop/src/adapters/queryClient.ts — the configured TanStack QueryClient"
  - "Rust test harness (cargo test) and frontend test harness (Vitest + Testing Library)"
  - "core::db::open_and_migrate — pragmas, backup-before-migrate, first migration"
  - "core::ids::new_id / is_ulid — monotonic ULID generation (DATA-02)"
  - "actors table (human|agent|system) seeded with system + Local User rows (DATA-03 seam)"
  - "packages/relay-client — inert open-core module seam (ARCHITECTURE.md §8)"
affects: ["01-02 (visual world)", "01-03 (tracer slice: create_task/list_board)"]

# Actuals (#2632)
actuals:
  tokens: 13700
  tasks: 3
  commits: 4
plan_head_before: a77103d677ea09bcdcd859b83dbbcb83f086eacb

# Tech tracking
tech-stack:
  added: [tauri@2.11.5, "@tauri-apps/cli@2.11.4", rusqlite@0.40.2, rusqlite_migration@2.6.0, ulid@3.0.0, fractional_index@2.0.2, dirs@6, "@tanstack/react-query@5.102.8", "@tanstack/react-virtual@3.14.11", zustand@5.0.15, vitest@5.0.0, "@testing-library/react@16.3.3", "@testing-library/jest-dom@7.0.1", jsdom@30.0.1]
  patterns:
    - "Single invoke/listen seam (adapters/tauri.ts) — no other renderer file imports @tauri-apps/api"
    - "Backup-before-migrate (D-18): copy the file before any DDL runs, restore-and-refuse on failure rather than down-migrations"
    - "Pragmas re-applied on every connection open, not assumed to persist (01-RESEARCH.md Pitfall 1)"
    - "Process-wide monotonic ULID generator behind once_cell::Lazy<Mutex<_>>"
    - "Cargo dependency-key aliasing (package = \"core\") to avoid shadowing the sysroot core crate in the extern prelude"

key-files:
  created:
    - Cargo.toml
    - packages/core/src/db/mod.rs
    - packages/core/src/db/backup.rs
    - packages/core/src/db/migrations/0001_actors.sql
    - packages/core/src/ids.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/adapters/queryClient.ts
    - packages/desktop/src-tauri/src/state.rs
    - packages/relay-client/src/lib.rs
  modified:
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/tauri.conf.json
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/package.json
    - README.md

key-decisions:
  - "Fixed rusqlite's nonexistent `serde` feature to `serde_json` (the crate has no `serde` feature; 01-RESEARCH.md's install command named the wrong one)"
  - "Aliased the desktop crate's dependency on packages/core to `flywheel_core` (package = \"core\") to avoid a dependency literally named `core` shadowing the sysroot `core` crate, which broke tauri::generate_context!()'s internal unqualified core:: references"
  - "First-ever launch legitimately produces no backup file (backup_database_file is a documented no-op when db_path doesn't exist yet) — the plan's Task 3 human-check text implies a backup should exist after the very first launch, which conflicts with the task's own tested <behavior> bullet; the tested behavior is authoritative"

patterns-established:
  - "TDD task discipline: test(01-01) RED commit (8 of 11 assertions genuinely failing against wrong-behavior stubs) followed by feat(01-01) GREEN commit (all 11 passing)"
  - "packages/core owns the SQLite connection exclusively; no other crate opens the database file directly"

requirements-completed: [DATA-02, DATA-08]

coverage:
  - id: D1
    description: "Cargo workspace with three members (core, relay-client, desktop's Tauri crate); relay-client depended on by neither"
    requirement: ""
    verification:
      - kind: unit
        ref: "cargo metadata --no-deps --format-version 1 (packages: core, relay-client, desktop)"
        status: pass
      - kind: other
        ref: "grep -c relay-client packages/core/Cargo.toml && packages/desktop/src-tauri/Cargo.toml == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Default-deny Tauri capability manifest — no fs:/shell: permission"
    requirement: ""
    verification:
      - kind: other
        ref: "grep -E '\"(fs|shell):' packages/desktop/src-tauri/capabilities/default.json — no matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "Single Tauri invoke/listen seam — no other renderer file imports @tauri-apps/api"
    requirement: ""
    verification:
      - kind: other
        ref: "grep -rlE 'from .@tauri-apps/api' packages/desktop/src | grep -vc adapters/tauri.ts == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Vitest harness runs a passing seed test for queryClient's configured defaults"
    requirement: ""
    verification:
      - kind: unit
        ref: "packages/desktop/src/adapters/__tests__/queryClient.test.ts (3 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "apply_pragmas/open_and_migrate: WAL journal mode, connection-scoped pragmas re-applied on every open, user_version advances to 1 and is idempotent"
    requirement: "DATA-08"
    verification:
      - kind: unit
        ref: "cargo test -p core --test db_bootstrap (7 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "backup_database_file copies the pre-migration file byte-for-byte before any DDL, no-op for a missing path"
    requirement: "DATA-08"
    verification:
      - kind: unit
        ref: "cargo test -p core --test db_bootstrap#open_and_migrate_writes_a_byte_identical_backup_before_migrating, #backing_up_a_missing_path_is_a_no_op"
        status: pass
    human_judgment: false
  - id: D7
    description: "new_id() returns a 26-character, strictly-ascending, duplicate-free ULID across 1,000 successive calls; is_ulid() recognizes the shape"
    requirement: "DATA-02"
    verification:
      - kind: unit
        ref: "cargo test -p core --test ids (4 tests)"
        status: pass
    human_judgment: false
  - id: D8
    description: "actors table enforces the human|agent|system CHECK constraint and is seeded deterministically"
    requirement: "DATA-03 seam"
    verification:
      - kind: unit
        ref: "cargo test -p core --test db_bootstrap#actor_insert_rejects_type_outside_the_fixed_enum"
        status: pass
    human_judgment: false
  - id: D9
    description: "Desktop app launches, opens a window titled Flywheel, renders the React root, and open_and_migrate runs at startup producing a real flywheel.db (wal, user_version=1, actors seeded)"
    requirement: ""
    verification:
      - kind: manual_procedural
        ref: "npm --prefix packages/desktop run tauri dev — screenshot .impeccable/review/01-01-boot-window.png; sqlite3 inspection of the launched app-data database"
        status: pass
    human_judgment: true
    rationale: "A real native window launch and its visual/no-error-overlay confirmation is outside what an automated test asserts in this environment; verified manually this session and documented, but a fresh human glance is the cheapest final check for a GUI launch."

duration: ~30min
completed: 2026-09-09
status: complete
---

# Phase 1 Plan 1: Monorepo Scaffold, Tauri Shell and Database Entry Point Summary

**Cargo workspace + Tauri v2/React shell with dual test harnesses, plus a real `open_and_migrate` — WAL pragmas, backup-before-migrate, and the first `actors` migration — wired into the Tauri setup hook.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-09T09:02:00+08:00 (approx.)
- **Completed:** 2026-09-09T09:27:00+08:00
- **Tasks:** 3
- **Files modified:** 59 (across 4 commits)

## Accomplishments

- Stood up the whole repository from a blank checkout: Cargo workspace, Tauri v2 `react-ts` shell,
  the inert `relay-client` open-core seam, `cargo test` and Vitest harnesses.
- Implemented `open_and_migrate`: applies the four pragmas (WAL persists in the file; synchronous,
  busy_timeout and foreign_keys are re-applied on every connection open), copies the file before
  migrating (D-18), runs the first migration, and is idempotent on a second call.
- Implemented `new_id()`/`is_ulid()` — a process-wide monotonic ULID generator; 1,000 successive
  calls verified strictly ascending with no duplicates.
- Created the `actors` table (DATA-03 seam) with a DB-level `CHECK` constraint on
  `human|agent|system`, seeded deterministically with a system actor and a "Local User" human actor.
- Wired the Tauri `setup` hook to call `open_and_migrate` before any window is shown and `.manage()`
  the resulting connection — verified end-to-end with a real `tauri dev` launch (window titled
  "Flywheel", `journal_mode=wal`, `user_version=1`, both seed rows present via `sqlite3` inspection).
- Followed genuine TDD discipline for Task 3: a `test(01-01)` RED commit against deliberately wrong
  stubs (8 of 11 assertions failing for the right reason) followed by a `feat(01-01)` GREEN commit
  making all 11 pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify the three flagged npm packages before any install** - `ac41966` (docs) —
   checkpoint gate cleared by the human; recorded the registry evidence (first-publish dates,
   repos, maintainers) into `01-RESEARCH.md` as the audit trail.
2. **Task 2: Scaffold the monorepo, the Tauri shell and both test harnesses** - `286a403` (feat)
3. **Task 3: Database entry point** - `ea84d78` (test, RED) + `0ee1fe5` (feat, GREEN)

**Plan metadata:** commit pending (this SUMMARY + STATE.md + ROADMAP.md docs commit, below).

## Files Created/Modified

- `Cargo.toml` — workspace manifest (`core`, `relay-client`, `desktop/src-tauri`), shared `[profile.release]`
- `packages/core/src/db/mod.rs` — `apply_pragmas`, `open_and_migrate`, `default_db_path`, `default_backups_dir`, `MIGRATIONS`
- `packages/core/src/db/backup.rs` — `backup_database_file` (copy-before-migrate, D-18)
- `packages/core/src/db/migrations/0001_actors.sql` — the `actors` table + two seed rows
- `packages/core/src/ids.rs` — `new_id`, `is_ulid` (DATA-02)
- `packages/desktop/src/adapters/tauri.ts` — `invokeCommand`, `subscribeBoardChanged`
- `packages/desktop/src/adapters/queryClient.ts` — the configured `QueryClient`
- `packages/desktop/src-tauri/src/main.rs` / `state.rs` — the `setup` hook wiring `AppState`
- `packages/relay-client/` — inert open-core seam crate
- `README.md`, `DESIGN.md` — local run/test docs; the no-visual-surface record for this plan

## Decisions Made

- Fixed rusqlite's nonexistent `serde` feature to `serde_json` — the only feature the crate
  actually exposes for JSON handling; `01-RESEARCH.md`'s install command named the wrong one.
- Kept the `core` package name (for `cargo metadata`/workspace-member identity per the plan's
  acceptance criteria) but aliased the *dependency key* in `packages/desktop/src-tauri/Cargo.toml`
  to `flywheel_core` — a dependency literally named `core` shadows the sysroot `core` crate in that
  crate's extern prelude, which broke `tauri::generate_context!()`'s internal unqualified `core::`
  references (confirmed locally: `E0433 cannot find 'option' in 'core'`).
- Treated the tested `<behavior>` bullet ("backing up a missing path is a no-op") as authoritative
  over the Task 3 human-check's informal wording, which implies a backup file should exist after
  the very first launch. A truly fresh install has nothing to back up yet — verified this is the
  correct, intentional behavior, not a gap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `rusqlite`'s `serde` feature does not exist**
- **Found during:** Task 2 (dependency setup)
- **Issue:** `01-RESEARCH.md`'s install command specified `rusqlite --features bundled,serde,chrono`; `rusqlite` 0.40.2 has no `serde` feature (cargo error: "does not have that feature", suggesting the unrelated `series` feature)
- **Fix:** Used `serde_json` instead — the feature that actually exists and is what DATA-01's JSON event-payload encoding needs
- **Files modified:** `packages/core/Cargo.toml`
- **Verification:** `cargo build --workspace` succeeds
- **Committed in:** `286a403` (Task 2 commit)

**2. [Rule 3 - Blocking] A dependency named `core` breaks `tauri::generate_context!()`**
- **Found during:** Task 2 (workspace build verification)
- **Issue:** `packages/desktop/src-tauri/Cargo.toml` depended on `packages/core` under the key `core`, which shadows the sysroot `core` crate in that crate's extern prelude — `tauri::generate_context!()` expands to unqualified `core::option::Option`, expecting `core` to mean the sysroot crate, and failed to compile (`E0433`)
- **Fix:** Verified the collision and the fix in isolated test crates first (see commit body), then aliased the dependency key to `flywheel_core` via Cargo's `package = "core"` syntax — `cargo metadata` still reports the workspace member as `core`; code refers to it as `flywheel_core::...`
- **Files modified:** `packages/desktop/src-tauri/Cargo.toml`, `packages/desktop/src-tauri/src/main.rs`
- **Verification:** `cargo build --workspace` succeeds; the plan's `key_links` grep (`open_and_migrate`) still matches, since it doesn't require a literal `core::` prefix
- **Committed in:** `286a403` (Task 2 commit; the aliasing), `0ee1fe5` (Task 3 commit; the actual `flywheel_core::db::open_and_migrate` call site)

**3. [Rule 3 - Blocking] Vitest's jest-dom setup needs `globals: true` or the `/vitest` entry point**
- **Found during:** Task 2 (test harness verification)
- **Issue:** `import "@testing-library/jest-dom"` calls `expect.extend(...)` against a global `expect` that `vitest.config.ts`'s `globals: false` does not provide, failing with `ReferenceError: expect is not defined`
- **Fix:** Imported `@testing-library/jest-dom/vitest` instead, which registers matchers without requiring global `expect`
- **Files modified:** `packages/desktop/src/test/setup.ts`
- **Verification:** `npm --prefix packages/desktop run test` — 3 passed
- **Committed in:** `286a403` (Task 2 commit)

**4. [Rule 2 - Missing Critical] No cross-platform way to resolve the OS app-data directory**
- **Found during:** Task 3 (`default_db_path`/`default_backups_dir`)
- **Issue:** The plan requires these functions to resolve the OS app-data directory without reading the process cwd, but named no crate for it; using Tauri's own path API would make `packages/core` depend on `packages/desktop`'s runtime, backwards from the intended dependency direction
- **Fix:** Added the `dirs` crate (already present transitively via the Tauri toolchain) as a direct `packages/core` dependency
- **Files modified:** `packages/core/Cargo.toml`, `packages/core/src/db/mod.rs`
- **Verification:** `cargo test -p core` passes; grep for `current_dir`/`env::current_dir` in `packages/core/src` returns 0
- **Committed in:** `0ee1fe5` (Task 3 GREEN commit)

**5. [Rule 3 - Blocking] `AppState`'s `Mutex<Connection>` field needs `rusqlite` directly**
- **Found during:** Task 3 (wiring `state.rs`)
- **Issue:** `packages/desktop/src-tauri` only depended on `packages/core` (aliased `flywheel_core`), not on `rusqlite` itself, so `state.rs`'s `Mutex<rusqlite::Connection>` field type failed to resolve (`E0432`)
- **Fix:** Added a direct `rusqlite` dependency (bundled feature) to `packages/desktop/src-tauri/Cargo.toml`
- **Files modified:** `packages/desktop/src-tauri/Cargo.toml`
- **Verification:** `cargo build --workspace` succeeds
- **Committed in:** `0ee1fe5` (Task 3 commit)

**6. [Rule 1 - Bug] `Connection::open` does not create parent directories**
- **Found during:** Task 3 (first-launch verification via real `tauri dev`)
- **Issue:** On a genuinely fresh install, the OS app-data directory (`~/Library/Application Support/Flywheel`) does not exist yet; `rusqlite::Connection::open` fails rather than creating it
- **Fix:** `open_and_migrate` now creates `db_path`'s parent directory before opening the connection
- **Files modified:** `packages/core/src/db/mod.rs`
- **Verification:** Verified via a real `tauri dev` launch against a freshly-removed app-data directory; produced `flywheel.db` correctly
- **Committed in:** `0ee1fe5` (Task 3 commit)

**7. [Rule 3 - Blocking] `[profile.release]` in a non-root Cargo.toml is ignored, with a warning**
- **Found during:** Task 2 (first `cargo build --workspace`)
- **Issue:** `[profile.release]` was in `packages/desktop/src-tauri/Cargo.toml`; Cargo ignores per-member profile tables and warns
- **Fix:** Moved `[profile.release]` to the workspace root `Cargo.toml`
- **Files modified:** `Cargo.toml`, `packages/desktop/src-tauri/Cargo.toml`
- **Verification:** `cargo build --workspace` — warning gone
- **Committed in:** `286a403` (Task 2 commit)

---

**Total deviations:** 7 auto-fixed (2 Rule 1 bugs, 1 Rule 2 missing-critical, 4 Rule 3 blocking-issue fixes)
**Impact on plan:** All auto-fixes were necessary for the workspace to compile and run correctly, or
for correctness (first-launch directory creation). No scope creep — no new features were added
beyond what Task 2/3 already specified.

## Issues Encountered

- Naming the domain crate's Cargo package `core` collides with the Rust sysroot `core` crate the
  moment a proc-macro in the *dependent* crate expands unqualified `core::` references — confirmed
  via an isolated two-crate reproduction before touching the real workspace. Resolved via Cargo's
  `package = "..."` dependency-key aliasing (see Deviation #2). This is worth flagging for later
  plans in this phase: any new crate that depends on `packages/core` should use the `flywheel_core`
  dependency-key alias, not a bare `core = { path = ... }` entry.

## User Setup Required

None — no external service configuration required. (Prerequisite toolchain versions — Rust, Node,
npm, git — are documented in `README.md`.)

## Next Phase Readiness

- Both test harnesses are green (`cargo test --workspace`, `npm --prefix packages/desktop run test`),
  so plan `01-02` (the visual world) and `01-03` (the tracer slice) both carry runnable verification
  from their first task, as this plan's objective required.
- `open_and_migrate` and the `actors` table are real and tested — `01-03`'s `create_task`/`list_board`
  transactional-outbox work has a real database to write against.
- `packages/desktop/src/adapters/tauri.ts` and `adapters/queryClient.ts` are ready for `01-03`'s
  first real `invokeCommand` call and `board:changed` subscription.
- No blockers. One naming caveat carried forward for future plans in this phase: depend on
  `packages/core` via the `flywheel_core` (aliased) dependency key, not a bare `core` key (see
  Issues Encountered).

## Known Stubs

None. `App.tsx` intentionally renders no visual content in this plan (documented in `DESIGN.md`,
not a stub — the Flight Progress Strips world is explicitly out of scope until plan `01-02`).

## Self-Check: PASSED

- FOUND: packages/core/src/db/mod.rs
- FOUND: packages/core/src/db/backup.rs
- FOUND: packages/core/src/db/migrations/0001_actors.sql
- FOUND: packages/core/src/ids.rs
- FOUND: packages/desktop/src/adapters/tauri.ts
- FOUND: packages/desktop/src/adapters/queryClient.ts
- FOUND: packages/desktop/src-tauri/src/state.rs
- FOUND: packages/relay-client/src/lib.rs
- FOUND commit ac41966 (docs(01-01): record human verification of flagged npm packages)
- FOUND commit 286a403 (feat(01-01): scaffold monorepo, Tauri shell and both test harnesses)
- FOUND commit ea84d78 (test(01-01): add failing tests for the database entry point)
- FOUND commit 0ee1fe5 (feat(01-01): implement the database entry point)

---
*Phase: 01-the-board-is-the-store-of-record*
*Completed: 2026-09-09*
