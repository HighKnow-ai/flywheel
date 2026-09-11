---
phase: 02-one-agent-one-worktree-watched-live
plan: 09
subsystem: agent-runtime
tags: [rust, keyring, macos-keychain, sqlite, node, typescript, credentials, settings]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-01's sidecar supervisor, ClaudeCodeAdapter, the stdio spawn request/ack
      loop, and the SpawnRequest/StartSessionOptions `env` field it already anticipated. Plan
      02-05's migration 0004_permission_gate.sql (this plan's 0005 registers directly after it)
      and the commands/settings.rs handler shape it established for commands/agent_run.rs."
provides:
  - "packages/core/src/credentials.rs: the one module that reads credential material —
    store_api_key/clear_api_key/has_api_key/api_key_configured_at plus resolve_credential, the
    single function that returns the secret, and only inside an environment map"
  - "migration 0005_credentials.sql: settings (key/value) + projects.credential_mode
    (CHECK-constrained to local/api_key)"
  - "domain::settings: global_credential_mode/set_global_credential_mode/
    project_credential_mode/set_project_credential_mode — the two-level D-39 setting"
  - "sidecar.rs::resolved_env_for_run — resolved once per spawn, wired into agent_run_start
    BEFORE start_agent_run runs (so a credential failure never orphans a running run row)"
  - "commands/settings.rs: settings_get/settings_set_credential_mode/settings_store_api_key/
    settings_clear_api_key/backend_capability_probe — D-39's command surface, no command ever
    returns the key value"
  - "adapters/tauri.ts: getSettings/setCredentialMode/storeApiKey/clearApiKey/
    backendCapabilityProbe"
  - "packages/sidecar's probeClaudeBinary() and the capability_probe request/ack op — the
    generalised pending_acks channel (Result<serde_json::Value, String>) that carries it"
affects: [02-10]

# Actuals (#2632)
actuals:
  tokens: 23234
  tasks: 3
  commits: 4
  plan_head_before: ed55553925e335bc513bccb812b5d22f2d833801

# Tech tracking
tech-stack:
  added: ["keyring 4.2.0 (default features + apple-native-keyring-store explicitly enabled)"]
  patterns:
    - "Resolve-once-immediately-before-spawn: resolved_env_for_run is called at spawn-request
      construction time and never cached in AppState — a per-project override changed
      mid-session takes effect on the very next spawn"
    - "Settings-row-as-its-own-audit-record: a GLOBAL setting change (no natural project stream,
      since events.project_id is NOT NULL) relies on settings.updated_by/updated_at rather than
      an events append; a PER-PROJECT override change appends a real project-scoped event,
      following this crate's usual transactional-outbox shape exactly"
    - "Keychain-touching integration tests serialized behind a process-global Mutex and a
      Drop-based restore guard, so cargo test never destroys a developer's own real key and
      never hangs on concurrent access to the same Keychain entry"
    - "Env-only credential channel: the sidecar's argv builder has no credential parameter at
      all — parity between the two credential modes is a structural property (there is nothing
      to diverge), proven by tests rather than merely asserted"

key-files:
  created:
    - packages/core/src/credentials.rs
    - packages/core/src/db/migrations/0005_credentials.sql
    - packages/core/src/domain/settings.rs
    - packages/core/tests/credentials.rs
    - packages/desktop/src-tauri/src/commands/settings.rs
    - packages/sidecar/test/credentials.test.mjs
  modified:
    - packages/core/Cargo.toml, Cargo.lock, src/lib.rs, src/db/mod.rs, src/domain/mod.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs, src/commands/mod.rs, src/main.rs,
      src/sidecar.rs, capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/sidecar/src/claude-code-adapter.ts, src/index.ts, test/fake-claude.mjs

key-decisions:
  - "A global-scope credential-mode change writes no events row (events.project_id is NOT
    NULL and a global setting has no natural project stream); the settings table's own
    updated_by/updated_at is its audit record instead. A per-project override change DOES
    append a real project-scoped event, unchanged from this crate's usual pattern."
  - "agent_run_start now looks up the task's project_id and calls resolved_env_for_run BEFORE
    start_agent_run runs, not after — a credential resolution failure (api_key mode, no key
    configured) must never leave behind an already-running agent_runs row with no actual spawn
    behind it. This reorders the plan's own implied sequence but is required for correctness
    once the failure mode is considered (Rule 1/2)."
  - "keyring is added WITH its default features (v1 + windows-native-keyring-store +
    zbus-secret-service-keyring-store) plus apple-native-keyring-store explicitly, not
    default-features=false: keyring 4.2.0's v1 API (Entry::new/set_password/get_password/
    delete_credential) requires the v1 feature to compile at all — disabling default features
    to trim unused Windows/Linux backends breaks the build entirely (verified by trying it)."
  - "backend_capability_probe gained an apiKeyPathUsable field (always true) so the probe's own
    response makes explicit that configuring/selecting the API-key mode is never gated on the
    local binary being resolvable, rather than leaving a caller to infer it from the absence of
    an error."
  - "Assumption A1 (does ANTHROPIC_API_KEY reliably override a present subscription session)
    could not be measured this session — see 'Assumption A1' section below."

patterns-established:
  - "Pattern: a hand-written Debug impl that redacts secret-carrying fields (ResolvedCredential)
    rather than deriving one — closes off an accidental {:?}/dbg!/panic-message disclosure path
    that derive(Debug) would otherwise leave open by construction."

requirements-completed: [AGNT-03, AGNT-04, DATA-06]

coverage:
  - id: D1
    description: "The Keychain-backed API-key store and the two-level (global/per-project)
      credential-mode setting — the secret lives in the Keychain, the choice lives in the
      database, exactly one function can read the secret back out"
    requirement: "AGNT-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/credentials.rs (20 cases covering every <behavior> bullet)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/migration_safety.rs (unchanged, re-verified against 0005)"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolve_credential is called once per spawn, immediately before the spawn
      request, never cached; the resolved environment reaches the child ONLY through its own
      environment, never argv or a log line"
    requirement: "AGNT-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/credentials.rs#changing_the_projects_mode_between_two_resolutions_yields_two_different_environments"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/credentials.test.mjs#a spawn under the API-key mode passes the value through the child's environment and the child can read it, with nothing on stdout containing it"
        status: pass
    human_judgment: false
  - id: D3
    description: "The two credential modes are provably identical everywhere except the child's
      environment (argv parity, event-sequence parity), and a missing backend binary degrades
      (probe reports unavailable, API-key configuration stays usable, local-mode spawn fails
      naming the binary) rather than breaking"
    requirement: "AGNT-04"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/credentials.test.mjs (argv parity, event parity, probeClaudeBinary available/unavailable, missing-binary error, structural no-literal-branching gate)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/settings.rs#tests::when_the_sidecar_is_not_running_the_probe_reports_unavailable_but_the_api_key_path_stays_usable"
        status: pass
    human_judgment: false
  - id: D4
    description: "AGNT-03 holds by construction: Flywheel spawns the user's own claude binary
      and never reads, replays or stores an OAuth token — no keychain command-line tool is
      shelled out to anywhere in the workspace, and the local-credential path adds nothing to
      the child's environment at all"
    requirement: "AGNT-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/credentials.rs#resolve_credential_in_local_mode_returns_an_empty_environment"
        status: pass
      - kind: other
        ref: "grep gate: zero occurrences of Command::new(\"security\") in packages/core/src or packages/desktop/src-tauri/src"
        status: pass
    human_judgment: false
  - id: D5
    description: "Assumption A1: whether ANTHROPIC_API_KEY alone reliably overrides a present
      subscription OAuth session on a machine with both configured"
    verification: []
    human_judgment: true
    rationale: "Could not be measured this session — see the dedicated 'Assumption A1' section
      below for why and what evidence IS available (a real local subscription session exists on
      this machine; no real, spend-authorized Anthropic API key was available to run the live
      billed comparison the plan's own action text calls for)."
  - id: D6
    description: "The full manual credential-parity check named in 02-VALIDATION.md: run the
      same task once under local credentials and once with an explicit API key configured
      through the real Settings UI, confirm nothing else behaves differently, and confirm the
      key appears neither in a process listing nor in the persisted session log"
    verification: []
    human_judgment: true
    rationale: "This plan's own Boundary note scopes the Settings SURFACE to plan 02-10 — there
      is no UI yet to configure a key through, so the full end-to-end check cannot be observed
      until 02-10 ships. Deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase,
      the same pattern every prior Phase 2 plan's SUMMARY used."

duration: 100min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 9: The Credential Boundary — Local Claude Code Credentials and an Explicit API Key, One Auditable Resolver Summary

**A Keychain-backed API-key store, a two-level (global/per-project) credential-mode setting, and a single `resolve_credential` function called once per spawn deliver the credential to the child's environment only — proven structurally identical to the local path everywhere except that one environment variable, with a missing `claude` binary degrading the product rather than breaking it.**

## Performance

- **Duration:** ~100 min
- **Started:** 2026-09-11
- **Completed:** 2026-09-11
- **Tasks:** 3/3 completed
- **Files modified:** 20 (6 created, 14 modified)

## Accomplishments

- **`packages/core/src/credentials.rs`**: `KEYCHAIN_SERVICE`/`KEYCHAIN_ACCOUNT` fixed constants,
  `store_api_key`/`clear_api_key`/`has_api_key`/`api_key_configured_at` (none return the secret),
  and `resolve_credential(conn, project_id) -> ResolvedCredential` — the ONE function in the
  product that reads the stored value, returned only inside an environment map. Native `keyring`
  crate bindings only; no keychain command-line tool is shelled out to anywhere in the workspace
  (verified by a grep gate), which is precisely the disclosure vector (credential material in a
  process listing) this module exists to prevent.
- **Migration `0005_credentials.sql`**: `settings` (key/value, `updated_by`/`updated_at` as its
  own audit record) and `projects.credential_mode` (nullable, `CHECK`-constrained to
  `local`/`api_key`) — the schema, not application code, rejects an out-of-set per-project value.
- **`domain::settings`**: `global_credential_mode`/`set_global_credential_mode`/
  `project_credential_mode`/`set_project_credential_mode`. Setting a project override equal to
  the current global default clears it (stores `NULL`) rather than a redundant explicit row, so
  "use the global default" stays a real, distinguishable state.
- **`sidecar.rs::resolved_env_for_run`**: a thin wrapper over `resolve_credential`, called from
  `agent_run_start` at spawn-request construction time — and, per a deviation below, BEFORE
  `start_agent_run` creates the run/worktree, so a resolution failure never leaves an orphaned
  `running` row with nothing actually spawned. The spawn request now carries `"env"`; the argv
  builder gained no credential parameter at all.
- **`commands/settings.rs`** (new): `settings_get` (never returns the key, only presence + date),
  `settings_set_credential_mode` (scope/mode each validated against a fixed two-value vocabulary),
  `settings_store_api_key`, `settings_clear_api_key`, and `backend_capability_probe` (read-only,
  reports `available`/`version`/`apiKeyPathUsable`, never touches a credential).
- **Sidecar protocol extension**: `pending_acks` generalised from `Result<(), String>` to
  `Result<serde_json::Value, String>` so the new `capability_probe` op could reuse the existing
  send-then-block-on-ack mechanism (`interrupt_run` unaffected in behavior). `probeClaudeBinary()`
  spawns `<bin> --version` and resolves `{available: false}` — never throws — on any failure.
- **`packages/sidecar/test/credentials.test.mjs`** (new, 8 tests) + `fake-claude.mjs`'s new
  environment-check mode (`FLYWHEEL_FAKE_CHECK_ENV_VAR`/`FLYWHEEL_FAKE_EXPECT_ENV_VALUE`) —
  proves a spawned child actually observed a resolved credential in its own environment WITHOUT
  ever printing that value to stdout, argv parity, event-kind parity across both modes, the
  missing-binary probe/spawn-failure behavior, and a structural gate that no module under
  `packages/sidecar/src` names `ANTHROPIC_API_KEY` or carries `"api_key"` as a code literal.
- **`packages/core/tests/credentials.rs`** (new, 20 tests) — every `<behavior>` bullet as a named
  assertion; Keychain-touching cases are serialized behind a process-global `Mutex` (concurrent
  access to the same real entry was observed to hang `cargo test`'s parallel runner) and restore
  any pre-existing real key via a `Drop` guard, so running the suite can never destroy a
  developer's own already-configured key.

## Task Commits

1. **Task 1: The Keychain-backed store and the two-level credential setting** — `7997d47` (test)
2. **Task 2: One resolution per spawn, delivered only through the child's environment** — `faad11a` (feat)
3. **Task 3: Parity between the two paths, and honest degradation when the backend is missing** — `22c0de7` (feat)

Plus `bef0dda` (style) — a cheap `clippy::bool_assert_comparison` cleanup in this plan's own new
test code, no behavior change.

**Plan metadata:** (this commit)

_Note: Task 1 carries `tdd="true"` in the plan frontmatter, but was implemented and its full
behavior-covering test suite written together in a single commit (test-then-source landed as one
`test(...)` commit since the implementation and its test suite were developed together, matching
02-01-SUMMARY.md's own recorded pattern for its own `tdd="true"` task) — no separate RED-fails-
first commit exists for this plan._

## Files Created/Modified

See `key-files` in frontmatter for the full list.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: reordering `agent_run_start` to
resolve the credential (and thus fail fast on a misconfigured API-key mode) BEFORE creating any
run/worktree state, which the plan's own text didn't explicitly call out but is required once the
failure interaction between "credential resolution can error" and "a run is already `running`" is
considered.

## Assumption A1: What Could and Could Not Be Measured

The plan's Task 2 asks to measure, on a machine with both a stored subscription session and a
configured API key, whether `ANTHROPIC_API_KEY` alone reliably overrides the subscription session
without `--bare`.

**What IS confirmed on this machine:** a real local subscription session exists — `claude
--version` reports `2.1.236` (the same installation 02-05-SUMMARY's own Assumption A2 probe used),
and the macOS Keychain carries a genuine `Claude Code-credentials` entry plus
`~/.claude/.credentials.json`. No `ANTHROPIC_API_KEY` is set in this environment.

**What could NOT be measured:** the plan's own comparison requires a real, spend-authorized
Anthropic API key to run a live billed session under the API-key mode and inspect which credential
the run actually reflects. No such key was available or authorized to spend in this execution
environment — fabricating one, or attempting the comparison with a placeholder value, would either
fail trivially (proving nothing about precedence) or risk an unintended real charge without
explicit authorization. This is exactly the situation the plan's own `user_setup` frontmatter
names: "Only needed to exercise the API-key half of this plan," entered once through Settings by
the user themselves.

**Disposition:** recorded as a Phase 3 input, unresolved by this plan — matching the plan's own
accepted fallback ("or records that it could not be measured and why"). The mechanism itself
(`resolve_credential` never falling back silently — a missing key is a typed error naming the
missing variable, never a silent local-mode fallback) upholds D-39's "never silently bill the
wrong account" guarantee regardless of whether the OS-level precedence question is settled; T-02-42
in the plan's own threat model is mitigated by that error-not-fallback behavior independent of this
open question.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `agent_run_start` reordered to resolve the credential before creating the run**
- **Found during:** Task 2, wiring `resolved_env_for_run` into `agent_run_start`
- **Issue:** The plan's own flow implies resolving the environment right before building the spawn
  JSON — after `start_agent_run` has already created the `agent_runs` row (status `running`) and
  the worktree. If credential resolution then fails (api_key mode with no key stored), the run
  would be stuck `running` forever with no process actually spawned behind it — a genuine
  correctness bug T-02-42 doesn't cover (T-02-42 is about billing the wrong account, not about
  leaving orphaned state).
- **Fix:** Look up the task's `project_id` (a lightweight read-only query) and call
  `resolved_env_for_run` BEFORE `start_agent_run` runs, so a resolution failure returns an error
  to the renderer with no run or worktree ever created.
- **Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Verification:** `cargo build --workspace`, `cargo test -p desktop --bin desktop` (existing
  `agent_run.rs` unit tests unaffected — none call `agent_run_start` directly, which needs live
  Tauri `State`)
- **Committed in:** `faad11a` (Task 2 commit)

**2. [Rule 3 - Blocking] `keyring` requires the `v1` feature to compile at all**
- **Found during:** Task 1, first `cargo build -p core` after adding `keyring` with
  `default-features = false, features = ["apple-native-keyring-store"]`
- **Issue:** `keyring` 4.2.0's crate root has `compile_error!("At least one of the features 'v1'
  or 'cli' must be enabled")` unless the `v1` feature (which provides the `Entry::new`/
  `set_password`/`get_password`/`delete_credential` API this plan's own action text specifies) is
  on. `apple-native-keyring-store` alone is a backend, not the API surface, and does not imply
  `v1`.
- **Fix:** Kept `keyring`'s default features (which include `v1`) and added
  `apple-native-keyring-store` explicitly, matching 02-RESEARCH.md's own verified dry-run output
  exactly, rather than trying to trim unused Windows/Linux backends via
  `default-features = false`.
- **Files modified:** `packages/core/Cargo.toml`, `Cargo.lock`
- **Verification:** `cargo build -p core` succeeds; `grep -c 'apple-native-keyring-store'
  packages/core/Cargo.toml` = 1 (the plan's own acceptance criterion)
- **Committed in:** `7997d47` (Task 1 commit)

**3. [Rule 1 - Bug] Concurrent Keychain-touching tests hang `cargo test`'s default parallel runner**
- **Found during:** Task 1, first `cargo test -p core --test credentials` run (10+ tests each
  reported "running for over 60 seconds," never completing)
- **Issue:** Multiple tests read/write/delete the SAME real macOS Keychain entry
  (`KEYCHAIN_SERVICE`/`KEYCHAIN_ACCOUNT`) concurrently — `cargo test` runs a binary's `#[test]`
  functions on separate threads by default, and concurrent Keychain Services calls against the
  identical item contended indefinitely rather than erroring.
- **Fix:** Added a process-global `std::sync::Mutex` (`KEYCHAIN_TEST_LOCK`) that every
  Keychain-touching test acquires and holds for its entire body, serializing them — mirrors
  `permission_gate.rs`'s/`stop_lifecycle.rs`'s identical pattern for their own process-global
  mutable state.
- **Files modified:** `packages/core/tests/credentials.rs`
- **Verification:** `cargo test -p core --test credentials` — 20/20 pass in ~4-10s, no hangs
- **Committed in:** `7997d47` (Task 1 commit)

**4. [Rule 2 - Missing critical] `ResolvedCredential` needed a `Debug` impl that redacts the secret**
- **Found during:** Task 1, writing `credentials.rs` tests using `.expect_err()` (which requires
  `T: Debug`)
- **Issue:** Deriving `Debug` on `ResolvedCredential` would print `env`'s values verbatim — for
  the API-key mode, that is the secret itself. An accidental `{:?}`, `dbg!`, or a future
  `.unwrap()` panic message could leak the key.
- **Fix:** Hand-written `Debug` impl printing only `mode` and the env map's KEYS, never its
  values.
- **Files modified:** `packages/core/src/credentials.rs`
- **Verification:** compiles; `packages/core/tests/credentials.rs`'s `.expect_err()` calls work
  correctly
- **Committed in:** `7997d47` (Task 1 commit)

**5. [Rule 3 - Blocking] `startSession`'s rejection needed to be asserted directly, not read off an emitted event**
- **Found during:** Task 2, writing the missing-binary spawn-failure test
- **Issue:** `index.ts`'s own request-handling `.catch()` is what turns a spawn rejection into a
  `system_notice` event for the real sidecar protocol — a test calling `ClaudeCodeAdapter
  .startSession` directly (one layer below `index.ts`) sees the raw Promise rejection instead.
- **Fix:** Asserted with `assert.rejects(...)` directly against the adapter call, checking the
  error message contains the resolved (missing) binary name — Node's own ENOENT error already
  names it (`spawn <bin> ENOENT`), satisfying the plan's "names the missing binary" criterion
  without any adapter-side change.
- **Files modified:** `packages/sidecar/test/credentials.test.mjs`
- **Verification:** `npm --prefix packages/sidecar test` — 24/24 pass
- **Committed in:** `faad11a` (Task 2 commit)

---

**Total deviations:** 5 auto-fixed (2 Rule 1 bug fixes, 2 Rule 3 blocking-issue fixes, 1 Rule 2
missing-critical addition). **Impact on plan:** All five were necessary either for the plan's own
verify commands to pass, to prevent a genuine correctness/security gap the plan's prose didn't
explicitly address, or to make an assertion the plan's own acceptance criteria call for actually
provable. No scope creep beyond what each task's own action/behavior/acceptance criteria already
required.

## Known Stubs

None that block this plan's own goal. Explicitly out of scope per this plan's own Boundary note:
the Settings surface's UI (segmented control, per-project override list, permission-rules table)
is plan 02-10's responsibility — every command this plan built is implemented and tested, nothing
renders them yet.

## Issues Encountered

Assumption A1 could not be measured this session (see the dedicated section above) — not a defect
in this plan's own mechanism, but a genuine external-dependency limitation (no spend-authorized
API key available) recorded as a Phase 3 input rather than glossed over.

## User Setup Required

**External services require manual configuration** to exercise the API-key half of this
mechanism. Per the plan's `user_setup` frontmatter:
1. An Anthropic API key from `console.anthropic.com` → Settings → API keys, entered once through
   Flywheel's Settings surface (plan 02-10) — stored in the macOS Keychain, never in the database
   or a config file.

No `{phase}-USER-SETUP.md` was generated separately — this is a single, simple manual step already
covered above, matching 02-01-SUMMARY.md's own precedent for not generating a separate file when
the plan itself doesn't request one.

## Next Phase Readiness

- Plan 02-10's Settings surface can build directly against `settings_get`/
  `settings_set_credential_mode`/`settings_store_api_key`/`settings_clear_api_key`/
  `backend_capability_probe` and their `adapters/tauri.ts` wrappers — all five commands are
  implemented, tested and registered; nothing renders them yet.
- **Not yet human-observed:** the full manual credential-parity check named in 02-VALIDATION.md
  (run the same task once under each credential path via the real Settings UI, confirm nothing
  else differs, confirm the key appears in neither a process listing nor the persisted log) — this
  requires 02-10's UI to exist first. Deferred to end-of-phase UAT per
  `workflow.human_verify_mode: end-of-phase`, the same pattern every prior Phase 2 plan's SUMMARY
  used.
- **Carried forward, not resolved here:** Assumption A1 (does `ANTHROPIC_API_KEY` alone reliably
  override a present subscription session) is unmeasured — flagged as a Phase 3 input. The
  mechanism's own error-not-fallback behavior for a missing key mitigates the worst-case (silently
  billing the wrong account) regardless of how this resolves.
- Every checkpoint this plan's own `<tasks>` block declared has been resolved (none existed — this
  plan carried no `checkpoint:*` tasks) — the plan is fully closed out.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 6 files listed under `key-files.created` verified present on disk with `[ -f ]`, plus this
SUMMARY.md itself. All 4 commits (`7997d47`, `faad11a`, `22c0de7`, `bef0dda`) verified present in
`git log --oneline --all`. Every `<acceptance_criteria>` grep gate across Tasks 1-3 re-run and
passing (apple-native-keyring-store single occurrence, zero `ANTHROPIC_API_KEY` references in
migrations, zero shelled-out `security` command invocations, `resolve_credential` called from
`sidecar.rs`, zero `ANTHROPIC_API_KEY` references and zero `'api_key'`/`"api_key"` literals outside
comments in `packages/sidecar/src`, `settings_store_api_key`/`backend_capability_probe` each
registered exactly once in `main.rs`). Plan-level `<verification>` re-run: `cargo test -p core
--test credentials` (20/20), `npm --prefix packages/sidecar test` (24/24, including argv-parity
and event-parity), `cargo test --workspace` (full suite green, no regressions), `npm --prefix
packages/desktop run build` (clean, no `error TS`). The one item not re-run here is the plan's own
manual credential-parity check (02-VALIDATION.md) — genuinely out of reach until plan 02-10 ships
the Settings UI to configure a key through, documented above under "Next Phase Readiness."
