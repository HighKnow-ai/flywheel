---
phase: 02-one-agent-one-worktree-watched-live
plan: 05
subsystem: agent-runtime
tags: [rust, rusqlite, tauri, typescript, node, model-context-protocol, unix-socket, react]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-01's sidecar AgentAdapter/ClaudeCodeAdapter, the stdio request/event loop,
      SidecarHandle, agent_run_start. Plan 02-02's interrupt-then-force stop path and the
      pending_acks request/ack correlation pattern this plan's pending_permission_requests map
      copies. Plan 02-04's agent_run_start instruction/prompt wiring, which this plan does not
      touch."
provides:
  - "migration 0004_permission_gate.sql: permission_requests/permission_rules, both CHECK-constrained
    (AGNT-06, D-38) — the schema, not app code, is the authority for both enum-shaped columns"
  - "domain::permission_request::{create_pending_request, answer_request, AlreadyAnsweredError,
    pending_for_run, find_request} — the once-only answer transition via a guarded UPDATE"
  - "domain::permission_rule::{matching_rule, upsert_rule, revoke_rule, rules_for_project} — D-38's
    project-scoped allow-always store, UNIQUE(project_id, tool_name) as the scope boundary"
  - "domain::agent_run::{set_run_blocked, clear_run_blocked} — transaction-scoped run-status
    transitions, callable only from inside the permission modules' own transactions"
  - "query::permissions::{blocked_task_ids_for_project, blocked_count_for_project} — plan 02-06's
    board indicator and project-rail count read path"
  - "packages/sidecar/src/mcp-permission-server.ts — the permission-prompt MCP server: a
    Unix-socket sidecar-side relay (startPermissionServer) plus a standalone MCP stdio server role
    (runStandaloneServer) the backend spawns per its own --mcp-config"
  - "ClaudeCodeAdapter.resolvePermission, buildClaudeArgv's permission-prompt-tool/mcp-config
    flags, index.ts's permission_answer op"
  - "SidecarHandle.pending_permission_requests / relay_permission_answer(_direct) — the DB-row-id
    to (run_id, mcp_request_id) correlation the outbound answer needs"
  - "commands::agent_run::{process_inbound_permission_request, answer_permission_request,
    agent_run_answer_permission, permission_rules_list, permission_rule_revoke}"
  - "adapters/tauri.ts: answerPermissionRequest, listPermissionRules, revokePermissionRule"
affects: [02-06, 02-10]

# Actuals (#2632)
actuals:
  tokens: 30345
  tasks: 3
  commits: 3
  plan_head_before: 0ffee3c188b0f1b2d0b9db74d4b3ac622db9ab83

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk 1.30.0 (exact pin, checkpoint-approved)", "chrono 0.4 (packages/desktop/src-tauri, newly added dependency)"]
  patterns:
    - "Two-role single file for a mechanism that spans two OS processes: mcp-permission-server.ts
      is imported as a plain module (the sidecar-side Unix-socket relay, no MCP SDK import) AND
      run standalone as its own compiled entry point (the actual MCP server the backend spawns
      per --mcp-config) — one file, two invocation shapes, distinguished by a main-module check"
    - "Correlate two deliberately-distinct ids via an in-memory map on the object that already
      owns the IPC channel (SidecarHandle.pending_permission_requests), mirroring the existing
      pending_acks pattern from plan 02-02 rather than inventing a new DB column for it"
    - "Rule-check-before-request-row: the inbound handler consults permission_rule::matching_rule
      BEFORE ever calling create_pending_request, so a rule match produces zero DB rows for the
      request itself — proven by a row-count assertion, not by inference from code structure"

key-files:
  created:
    - packages/core/src/db/migrations/0004_permission_gate.sql
    - packages/core/src/domain/permission_request.rs
    - packages/core/src/domain/permission_rule.rs
    - packages/core/src/query/permissions.rs
    - packages/core/tests/permission_gate.rs
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/test/permission.test.mjs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/mod.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/query/mod.rs
    - packages/sidecar/package.json
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/index.ts
    - packages/sidecar/test/fake-claude.mjs
    - packages/desktop/src-tauri/Cargo.toml
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts

key-decisions:
  - "The MCP permission server's OWN correlation id (assigned per tool call in
    mcp-permission-server.ts) is deliberately NOT the same id as permission_requests.id (a fresh
    26-char ULID minted by create_pending_request). The two are correlated by
    SidecarHandle.pending_permission_requests, an in-memory map, not by sharing one identifier —
    the DB row's id must satisfy the schema's ULID CHECK constraint, and the MCP layer's id must
    exist before any DB row does (it is assigned the instant the tool call arrives, before the
    rule check even runs)."
  - "The permission-prompt MCP server is a genuinely separate OS process, spawned by the BACKEND
    (claude, or fake-claude.mjs in tests) per its own --mcp-config command/args — never spawned
    directly by the sidecar. A Unix domain socket (opened by the sidecar-side role BEFORE the
    backend is spawned) is the only channel between the two processes, since MCP's stdio
    transport requires the CLIENT (the backend) to own the pipe ends to whatever it spawns."
  - "PermissionRequestEvent gained a requestId field (adapter.ts, outside Task 2's declared file
    list) — see Deviations. Without it the round trip has no way to correlate a relayed answer
    with the specific held call."
  - "The rule short-circuit's auto-resolution event (permission_request.auto_resolved) hangs off a
    fresh, disposable id rather than any permission_requests row, since no such row is ever
    created for a rule match — T-02-27's requirement is that the DECISION is visible in the trail,
    not that it references a request row that structurally cannot exist for this path."

patterns-established:
  - "A Tauri command's IPC-performing side effect (the sidecar relay) is returned as a plain value
    from a testable, Tauri-free function rather than performed inside it — the already-answered
    error's own control flow (a `?` before the relay line) IS the 'relays nothing' proof, tested
    by asserting the function returns Err, not by mocking SidecarHandle."

requirements-completed: [AGNT-06, DATA-06, AGNT-01]

coverage:
  - id: D1
    description: "A pending permission request created by create_pending_request blocks its run in
      the same transaction, and reading the run back shows status = 'blocked'"
    requirement: "AGNT-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/permission_gate.rs#create_pending_request_blocks_the_run_and_raises_a_labeled_event"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::no_matching_rule_produces_a_pending_row_and_blocks_the_run"
        status: pass
    human_judgment: false
  - id: D2
    description: "A pending request can be answered exactly once — a second answer to the same row
      is refused (AlreadyAnsweredError), proven at the event log (exactly one
      permission_request.answered event exists after both calls), and the held MCP tool call
      resolves exactly once (AGNT-06 concurrency requirement)"
    requirement: "AGNT-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/permission_gate.rs#answering_an_already_answered_request_is_refused_and_resolves_nothing_a_second_time"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::answering_an_already_answered_request_returns_the_already_answered_error_with_nothing_left_to_relay"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/permission.test.mjs#an answer whose request id matches no held call is ignored and resolves nothing else"
        status: pass
    human_judgment: false
  - id: D3
    description: "The permission-prompt MCP server genuinely holds a tool call open with no
      self-imposed timeout — waiting 5x the stop grace period (25s) with no answer relayed still
      leaves the call unresolved and the session un-closed"
    requirement: "AGNT-06"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/permission.test.mjs#the permission server never resolves a call from its own state"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two concurrent held calls resolve independently and in the order their answers
      arrive, not the order they were raised"
    requirement: "AGNT-06"
    verification:
      - kind: integration
        ref: "packages/sidecar/test/permission.test.mjs#two concurrent held calls resolve independently and in the order their answers arrive, not the order raised"
        status: pass
    human_judgment: false
  - id: D5
    description: "Allow-always is a project-scoped, per-tool rule (UNIQUE(project_id, tool_name)) —
      a rule granted on one project never matches another project or a different tool"
    requirement: "AGNT-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/permission_gate.rs#matching_rule_never_crosses_a_project_boundary"
        status: pass
    human_judgment: false
  - id: D6
    description: "A tool call matching an existing allow rule resolves with no permission_requests
      row and no blocked run, and the automatic decision still appears in the activity trail"
    requirement: "AGNT-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::a_matching_allow_rule_auto_resolves_with_no_pending_row_and_the_run_stays_running"
        status: pass
    human_judgment: false
  - id: D7
    description: "The permission-prompt server the agent talks to is the one the sidecar supplied
      on the command line (--mcp-config naming exactly one server), never discovered from the
      worktree's own configuration"
    requirement: "AGNT-06"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/permission.test.mjs#buildClaudeArgv appends the permission-prompt tool name and an MCP config naming exactly one server"
        status: pass
    human_judgment: false
  - id: D8
    description: "Assumption A2 (does an individual MCP tool call hold open with no server-side
      timeout) is measured and recorded, including against the real claude CLI"
    verification:
      - kind: e2e
        ref: "manual probe against claude 2.1.236 — see 'Assumption A2: Measured Finding' below"
        status: pass
    human_judgment: true
    rationale: "The mechanism Flywheel owns and controls (the socket relay + standalone MCP
      server) is proven by D3's automated test with no human judgment needed. What required a
      human-supervised real-CLI probe, and surfaced a genuinely new finding beyond what the
      automated suite can check, is whether the REAL claude binary reliably routes every gated
      action through the configured permission-prompt-tool at all — it does not, for commands its
      own internal safety heuristic classifies as read-only/safe. See the dedicated section below."
  - id: D9
    description: "Pressing Start Work, hitting a genuinely gated tool call in the real packaged
      app, seeing the task row flip to blocked, and answering from the board resolves the held
      call end-to-end"
    verification: []
    human_judgment: true
    rationale: "This plan builds the mechanism and its database state only — the plan's own
      Boundary note states the card, blocked row indicator and project-rail count are plan 02-06's
      responsibility. The full stack (packaged app, real claude session, a human watching a row
      flip blocked and answering it) cannot be observed until 02-06 ships the surfaces. Deferred
      to end-of-phase UAT per workflow.human_verify_mode=end-of-phase, the same pattern
      02-01/02-02/02-04-SUMMARY.md used."

duration: 100min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 5: The Permission Gate — A Held Tool Call, Answered From the Board Summary

**A gated tool call genuinely halts the agent via a Unix-socket-relayed MCP server the backend itself spawns per `--mcp-config`, resolved exactly once by a board decision routed through `permission_requests`' guarded UPDATE, with D-38's allow-always short-circuiting the whole round trip via a `UNIQUE(project_id, tool_name)` rule — and the real `claude` CLI's own built-in safe-command heuristic turns out to bypass the gate entirely for the class of command RESEARCH.md assumed it would always reach.**

## Performance

- **Duration:** ~100 min (continuation session; the plan's package-legitimacy checkpoint was
  resolved by a prior agent — `approved @modelcontextprotocol/sdk@1.30.0`)
- **Started:** 2026-09-11 (continuation)
- **Completed:** 2026-09-11
- **Tasks:** 3/3 completed
- **Files modified:** 22 (7 created, 15 modified)

## Accomplishments

- **Migration `0004_permission_gate.sql`**: `permission_requests`/`permission_rules`, both
  CHECK-constrained (`status IN ('pending','allowed','denied','allowed_always')`,
  `decision IN ('allow','deny')`) — the schema, not app code, is the authority for both. D-38's
  per-project, per-tool scope is a `UNIQUE(project_id, tool_name)` constraint, not a code path.
- **`domain::permission_request`**: `create_pending_request`/`answer_request` — the once-only
  answer transition is a property of `answer_request`'s guarded `UPDATE ... WHERE status =
  'pending'`, not a read-then-write race; a zero-affected-rows result returns a typed
  `AlreadyAnsweredError`, writes nothing, and appends no second event. Both functions move the
  run's `blocked`/`running` status inside their OWN transaction via new
  `domain::agent_run::set_run_blocked`/`clear_run_blocked`.
- **`domain::permission_rule`**: `matching_rule`/`upsert_rule`/`revoke_rule`/`rules_for_project` —
  a rule earned on one project can structurally never match another (T-02-24), proven by a
  cross-project test.
- **`packages/sidecar/src/mcp-permission-server.ts`** (new file, two roles): `startPermissionServer`
  is the sidecar-side Unix-socket relay (no MCP SDK import, no timer, no allowlist) opened BEFORE
  the backend is spawned; the same file's standalone `runStandaloneServer` role is the actual
  MCP stdio server the backend spawns per its own `--mcp-config`, using the REAL
  `@modelcontextprotocol/sdk@1.30.0` on both the server and (in tests) the client side.
  `fake-claude.mjs`'s new permission-calling mode plays the backend's own role for real,
  including firing two concurrent calls for the concurrency case.
- **`SidecarHandle.pending_permission_requests`**: correlates a `permission_requests.id` (the only
  id the board ever names) with the sidecar's own `(run_id, mcp_request_id)` pair — the two ids
  are deliberately distinct (the DB id is a fresh ULID minted only if no rule matches; the MCP id
  exists the instant the tool call arrives, before any rule check runs).
- **`commands::agent_run::process_inbound_permission_request`**: checks `matching_rule` FIRST — a
  match auto-resolves with zero `permission_requests` rows and the run untouched, but STILL
  appends a `permission_request.auto_resolved` event (T-02-27: a decision the board never shows
  as an event is exactly RESEARCH.md pitfall 4's failure mode). No match falls through to
  `create_pending_request`.
- **`agent_run_answer_permission`/`permission_rules_list`/`permission_rule_revoke`**: the board's
  outbound path, `actor_id` resolved server-side, `decision` validated (`allow`/`deny`/
  `allow_always`) before any DB call, `allow_always` also granting the project rule.

## Task Commits

Each task was committed atomically:

1. **Task 1: The permission tables, the once-only answer, and the project-scoped rule** — `c6808f7` (feat)
2. **Task 2: The MCP permission server — a tool call that does not resolve until a human answers** — `7c5998a` (feat)
3. **Task 3: The answer round-trip — board decision to held call, with the project rule short-circuit** — `656fed9` (feat)

**Plan metadata:** (this commit)

_No REFACTOR commits — Task 1 and Task 2 carried `tdd="true"` in the plan frontmatter, but each
was implemented and its full behavior-covering test suite written together per this plan's own
task shape (no separate RED-fails-first commit was produced), the same pattern 02-01-SUMMARY.md
recorded for its own `tdd="true"` task._

## Files Created/Modified

See `key-files` in frontmatter for the full list.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: the MCP-layer request id and the
database row id are deliberately two different identifiers, correlated by an in-memory map on
`SidecarHandle` rather than a shared value — this is the single design fact that makes the whole
round trip (inbound rule-check-or-block, outbound answer-or-relay) actually work given the
migration's own ULID `CHECK` constraint.

## Assumption A2: Measured Finding

RESEARCH.md flagged A2 as needing an empirical spike: does an individual MCP tool call held by
`--permission-prompt-tool` genuinely stay unresolved with no server-side timeout, distinct from
the documented 30s `MCP_TIMEOUT` (which governs server *connection*)? Task 2 measured this two
ways, and the two measurements disagree in an important, genuinely new way:

**1. The mechanism Flywheel owns (automated, `permission.test.mjs`):** waiting 5× `STOP_GRACE_MS`
(25 seconds) with no answer relayed leaves the held call and the whole session un-closed — no
self-imposed timeout anywhere in `mcp-permission-server.ts`, proven by a real spawned process
(`fake-claude.mjs` as the real MCP client, our own compiled server as the real MCP server), not a
mock. This answers A2's own stated question for the half of the system this plan controls: **no**,
an individual call does not silently time out on our side.

**2. The real `claude` CLI (manual probe, `claude` 2.1.236, this developer's own authenticated
installation, `--permission-mode default` — the most restrictive documented mode):** a probe
script started our real compiled permission server, spawned `claude -p "Use the Bash tool to run
exactly this command: echo hello-from-gated-tool"` with `--permission-prompt-tool`/`--mcp-config`
correctly wired (confirmed via the session's own `init` event:
`"mcp_servers":[{"name":"flywheel-permissions","status":"connected"}]`), and observed the
Bash tool call execute and the WHOLE session complete in ~5-8 seconds — **the permission-prompt
tool was never invoked at all**, and the final `result` event's `"permission_denials":[]` confirms
zero permission decisions were made, requested, or needed. A second attempt with a plausibly
riskier command (`rm -f <scratch file>`) never resolved within a 20-second observation window
(vs. ~5-8s for the safe command) and was killed by the probe's own watchdog, but our own
`onRequest` callback never fired either — the probe could not distinguish "genuinely routed to
the permission gate and correctly held" from "still deciding whether to call the tool at all"
within the time/cost budget available for this spike (each attempt is a real, billed API call).

**Conclusion, recorded as a Phase 3 input, not resolved here:** the installed `claude` CLI applies
its OWN internal bash-command safety classification BEFORE ever consulting a configured
`--permission-prompt-tool`, for at least the class of command it judges read-only/harmless — this
happens even in `--permission-mode default`, the mode RESEARCH.md and D-36 both assumed would gate
"everything except file edits inside the worktree." This is a genuinely new finding beyond what
RESEARCH.md's own synthesis anticipated: D-36's stated intent ("stops for everything else — shell
commands, network access, anything outside the tree") is not fully what the installed CLI version
does. **This does not invalidate this plan's own mechanism** — the gate correctly holds and
resolves every call that DOES reach it (D3/D4 above), and the plan's own load-bearing prohibition
("never a sidecar-local default or allowlist") is upheld: nothing in Flywheel's own code silently
approved anything: the CLI itself never asked. But it means the coverage D-36/D-37 promise
("stops for everything else") is narrower than designed until a follow-up phase either confirms
which commands the CLI classifies as safe, or forces every prompt through the gate via a stricter
flag (`bypassPermissions` is the opposite direction; whether a documented flag exists to disable
the CLI's own bash-safety heuristic was not investigated this session — flagged for Phase 3).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] `PermissionRequestEvent` had no `requestId` field**
- **Found during:** Task 2, writing `permission.test.mjs`'s first test — every call to
  `adapter.resolvePermission(runId, request.requestId, "allow")` silently no-op'd
  (`[flywheel-permissions] no held call for requestId=undefined — ignoring`), because the
  pre-existing `PermissionRequestEvent` interface (`adapter.ts`, shipped by an earlier plan)
  declared only `toolName`/`input` — no id at all.
- **Issue:** Without a correlation id on the emitted event, there is no way for the Rust core (or
  anything downstream) to know which specific held MCP call a later `resolvePermission` call
  should settle — the round trip this plan exists to build is structurally impossible without it.
- **Fix:** Added `requestId: string` to `PermissionRequestEvent` and set it from the MCP server's
  own assigned id in `claude-code-adapter.ts`'s emission code.
- **Files modified:** `packages/sidecar/src/adapter.ts` (outside Task 2's declared `<files>` list),
  `packages/sidecar/src/claude-code-adapter.ts`
- **Verification:** `npm --prefix packages/sidecar test` — all 16 tests pass, including every
  `permission.test.mjs` case that depends on `requestId` being present and correct.
- **Committed in:** `7c5998a` (Task 2 commit)

**2. [Rule 3 - Blocking] `chrono` was not a dependency of `packages/desktop/src-tauri`**
- **Found during:** Task 3, writing `process_inbound_permission_request`'s auto-resolution event
  timestamp
- **Issue:** `packages/core` depends on `chrono`, but `packages/desktop/src-tauri` did not — the
  auto-resolution event append (a NEW call site this plan introduces directly in
  `commands/agent_run.rs`, not inside `packages/core`) needed `chrono::Utc::now()` and would not
  compile without it.
- **Fix:** Added `chrono = { version = "0.4", default-features = false, features = ["clock"] }` to
  `packages/desktop/src-tauri/Cargo.toml`, matching `packages/core`'s own exact version/feature
  pin.
- **Files modified:** `packages/desktop/src-tauri/Cargo.toml`, `Cargo.lock`
- **Verification:** `cargo build --workspace` succeeds
- **Committed in:** `656fed9` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 missing-critical addition, 1 Rule 3 blocking-issue
fix). **Impact on plan:** Deviation #1 is the most consequential — without it, the entire
mechanism this plan exists to build (a relayed answer resolving a specific held call) could not
function at all; every downstream test in `permission.test.mjs` depends on it. No scope creep
beyond what each task's own action/behavior/acceptance criteria already required.

## Known Stubs

None that block this plan's own goal. Explicitly out of scope and left for plan 02-06 per this
plan's own Boundary note: the blocked task-row indicator, the project-rail blocked count's UI
consumption (the query functions exist and are tested; nothing renders them yet), and the
permission-answer UI itself (no `PermissionRequestCard.tsx` — the board decision in this plan's
own tests is simulated by calling `agent_run_answer_permission`/`resolvePermission` directly, not
by clicking anything). Plan 02-10's Settings surface owns `permission_rules_list`/
`permission_rule_revoke`'s UI consumption — both commands exist and are tested, nothing renders
them yet either.

## Issues Encountered

The Assumption A2 empirical spike surfaced a genuinely new, unplanned finding (the real CLI's own
bash-command safety heuristic bypassing the configured permission-prompt-tool for at least some
commands) rather than a clean pass/fail on the question RESEARCH.md posed. Documented in full
above rather than glossed over — this is exactly the kind of result an empirical spike exists to
surface, not a project blocker for this plan (the mechanism this plan owns works correctly for
every call that DOES reach it), but a real gap between D-36's designed intent and observed CLI
behavior that the next phase touching this mechanism should investigate before relying on
"acceptEdits stops for everything but file edits" as a blanket guarantee.

## User Setup Required

None beyond what plan 02-01 already established (a working, authenticated `claude` CLI) — no new
external service configuration required. The `@modelcontextprotocol/sdk` install required no
credentials.

## Next Phase Readiness

- Plan 02-06 can build the blocked task-row indicator and project-rail count directly against
  `query::permissions::{blocked_task_ids_for_project, blocked_count_for_project}` and the
  `board:changed` emission this plan's inbound/outbound paths already produce.
- Plan 02-10's Settings surface can build its allow-always rule list/revoke UI directly against
  `permission_rules_list`/`permission_rule_revoke` and `adapters/tauri.ts`'s
  `listPermissionRules`/`revokePermissionRule` — both are implemented and tested, awaiting only a
  rendering surface.
- **Not yet human-observed:** the plan's own `<verification>` block's implicit end-to-end claim —
  pressing Start Work in the real packaged app, hitting a genuinely gated tool call, watching the
  task row (once 02-06 ships it), and answering from the board. Deferred to end-of-phase UAT per
  `workflow.human_verify_mode: end-of-phase`, the same pattern every prior Phase 2 plan's SUMMARY
  used.
- **Carried forward, not resolved here:** the real `claude` CLI's own bash-command safety
  heuristic appears to bypass the permission-prompt-tool entirely for at least some commands,
  even in `--permission-mode default`. This is a genuine gap between D-36's designed intent and
  observed CLI behavior — flagged as a Phase 3 input per the plan's own instruction, not fixed in
  this plan (the mechanism itself is correct; what commands reach it is the open question).
- Every checkpoint this plan's own `<tasks>` block declared has been resolved — the plan is fully
  closed out.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 7 files listed under `key-files.created` verified present on disk with `[ -f ]`. All 3 task
commits (`c6808f7`, `7c5998a`, `656fed9`) verified present in `git log --oneline --all`. Every
`<acceptance_criteria>` item across Tasks 1-3 re-run and passing: `cargo test -p core --test
permission_gate` (9/9), `cargo test -p core --test migration_safety` (5/5), `cargo test -p core`
(full suite green), `npm --prefix packages/sidecar test` (16/16, including the 25-second
never-self-resolves proof), `npm --prefix packages/sidecar run build` (clean), `cargo build
--workspace` (clean), `cargo test -p desktop` (14/14, all new), `npm --prefix packages/desktop run
build` (clean, no `error TS`), `npm --prefix packages/desktop run test` (202/202, unchanged), plus
every grep-based structural gate this plan's own `<verify>` blocks name (the `UNIQUE
(project_id, tool_name)` single-occurrence gate, the no-string-interpolated-SQL gate across the
three new domain/query modules, the SDK exact-pin gate, the no-timer/no-allowlist gate in
`mcp-permission-server.ts`, the `main.rs` single-registration gate, and the capabilities-roster
gate) — all PASS. Assumption A2 was measured against the real `claude` CLI, not merely the fake
backend; the finding is recorded above with its evidence. The one item not re-run here is genuinely
outside this plan's own scope per its Boundary note (the board-visible blocked indicator and the
permission-answer UI, owned by plan 02-06) — see "Next Phase Readiness."
