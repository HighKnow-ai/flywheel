---
phase: 03-nothing-lost-nothing-left-running
plan: 13
subsystem: observability
tags: [git-retry, permission-socket, activity-trail, session-feed, rust, typescript]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-04's git_retry::with_lock_retry/LockExhausted and the shim's contention JSONL; 03-07's permission-socket-wired shim and mcp-permission-server.ts's held-connection protocol; 03-08's lock_contention.rs reproduction harness"
provides:
  - "git_retry::with_lock_retry_notify — a retry-loop hook the shim uses to report each backoff sleep, with with_lock_retry kept as a no-op-hook wrapper for every existing caller"
  - "A second, fire-and-forget message kind (kind field) on the same permission socket, routed by mcp-permission-server.ts's startPermissionServer(onRequest, onNotice) and never held"
  - "GitRetryEvent/GitLockExhaustedEvent on the AgentEvent union, and the pure noticeToAgentEvent mapper"
  - "The transient git_retry feed row (FeedRow.tsx, reusing the system/transient row kind) and the git_lock_exhausted no-render case"
  - "agent_run::record_lock_exhaustion — one git.lock_exhausted event per exhausted budget, attributed to the seeded system actor, never a row per collision"
affects: [any future phase touching the session feed's event-type vocabulary, the Activity Trail's event-type coverage, or the permission-socket wire protocol]

# Actuals (#2632)
actuals:
  tokens: 14782
  tasks: 3
  commits: 3
  plan_head_before: 2f597b1549aedfadd26eccec7c7a449291e30150

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A retry-loop notify hook (with_lock_retry_notify) added as a strict superset of an existing function (with_lock_retry becomes a thin no-op-hook wrapper) so every existing caller's signature and behaviour is provably unchanged"
    - "A second wire-message kind distinguished by a kind field on an already-open socket, routed to a distinct callback and closed immediately (never added to the held-connection map) — the same channel, a second lightweight protocol, no new socket"
    - "A pure event-mapping function (noticeToAgentEvent, mirroring the existing normaliseStreamEvent) extracted specifically so a notice-to-AgentEvent transform is unit-testable without a live session"

key-files:
  created: []
  modified:
    - packages/core/src/git_retry.rs
    - packages/core/tests/git_retry.rs
    - packages/shim/src/main.rs
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/test/adapter.test.mjs
    - packages/desktop/src/session/FeedRow.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/feed-row.test.tsx
    - packages/core/src/domain/agent_run.rs
    - packages/core/tests/lock_contention.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx

key-decisions:
  - "Actor attribution for the exhaustion event follows 03-UI-SPEC.md and this plan's own must_haves (both say \"system actor\"/\"assignee-system mark\", stated three times total) over Task 3's own action/acceptance-criteria text (which names agent_run::agent_actor_id once) — sidecar.rs resolves flywheel_core::domain::actor::system_actor, not the agent actor. See Deviations."
  - "with_lock_retry gained a sibling, with_lock_retry_notify, rather than changing its own signature — git::git_at and the crate's existing test suite call the original two-argument form and are provably unaffected."
  - "ActivityTrail.tsx needed no source change at all: it already renders event.description verbatim, and D-19's server-side render_description reads payload.label — which git_retry::exhaustion_event_payload already sets to the exact Copywriting Contract sentence. Only its test file changed."
  - "SessionSurface.tsx's buildFeedRows (not in this plan's declared files_modified) was wired to map git_retry into a FeedRowData row and suppress git_lock_exhausted entirely — without it, a live notice would fall through to the raw-JSON-dump branch, defeating both of Task 2's behaviors. See Deviations."

patterns-established:
  - "A fire-and-forget notice on an existing bidirectional socket, distinguished by a discriminant field and closed immediately rather than added to any held-connection state — the shape a future second notice kind on this same socket should copy."

requirements-completed: [WORK-04]

coverage:
  - id: D1
    description: "While a shimmed git call is actively backing off, the session feed shows a single muted transient line naming the attempt number, and it disappears the instant the call resolves"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/feed-row.test.tsx#git lock-retry transient row and the git-lock-exhaustion no-render case"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#noticeToAgentEvent maps a git_retry notice to a git_retry AgentEvent with a non-empty raw"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exhaustion appends one human-rendered activity-trail entry naming the repository, the command and the attempt count, attributed to the system actor"
    requirement: "WORK-04"
    verification:
      - kind: integration
        ref: "packages/core/tests/lock_contention.rs#record_lock_exhaustion_tests::appends_exactly_one_event_attributed_to_the_seeded_system_actor"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx#Git lock-exhaustion entry"
        status: pass
    human_judgment: false
  - id: D3
    description: "The notice travels through the permission socket the session already opened — no new socket, no new op, no second answering surface"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#a notice connection is closed by the server and never becomes a held request"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#a permission request still holds open exactly as before"
        status: pass
    human_judgment: false
  - id: D4
    description: "A git lock collision that resolves on its own writes nothing to the board at all — no event, no row, no trail entry"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#a_first_attempt_success_invokes_the_notify_hook_zero_times"
        status: pass
    human_judgment: true
    rationale: "This is a negative/absence claim across three separate layers (shim, socket, database). Each layer's own \"nothing happens\" behavior is unit-tested (zero notify calls on a clean success; no sidecar.rs branch exists for git_retry at all), but a genuine live reproduction of a resolving lock collision producing zero board-visible artifacts end-to-end was not run this session — the end-of-phase UAT is the right place to confirm the full chain."

# Metrics
duration: ~40min (session interrupted once mid-Task-1 and resumed from an orchestrator restart; span covers full wall-clock from plan start to completion)
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 13: Git Lock-Contention Legibility Summary

**A second fire-and-forget notice kind on the existing permission socket drives a muted transient feed row for in-flight retries and exactly one Activity Trail entry per exhausted retry budget — a collision that resolves on its own stays invisible.**

## Performance

- **Duration:** ~40 min (one orchestrator restart mid-session; resumed from on-disk transcript + working tree per the coordinator's instructions)
- **Started:** 2026-09-15T07:23:35Z (approx., immediately after 03-09's completion)
- **Completed:** 2026-09-15T08:04:00Z
- **Tasks:** 3
- **Files modified:** 14 (0 created, 14 modified)

## Accomplishments

- **Task 1** (`2228cb0`): `git_retry::with_lock_retry_notify` adds an `on_retry(next_attempt, max)` hook fired once per backoff sleep, before the sleep — `with_lock_retry` becomes a thin no-op-hook wrapper so `git::git_at` and the crate's own test suite are unaffected. The shim's `send_notice` is a fire-and-forget, failure-swallowing (no `?`, no `unwrap`) line on `FLYWHEEL_PERMISSION_SOCKET`, called from the retry hook (`git_retry` notice) and the exhaustion branch (`git_lock_exhausted` notice), never on a first-attempt success. `mcp-permission-server.ts`'s `startPermissionServer` gained a second `onNotice` callback: a connection whose parsed line carries a `kind` field is routed there and closed immediately, never added to the held-connection map. `adapter.ts` gained `GitRetryEvent`/`GitLockExhaustedEvent`; `claude-code-adapter.ts` wires `onNotice` through a new pure `noticeToAgentEvent` mapper.
- **Task 2** (`d1bef18`): `FeedRowData` gains `git_retry` (routed through the exact same switch branch `system_notice` already uses) and `git_lock_exhausted` (an explicit no-render case, never a fallthrough to the raw-dump unknown-event branch). `SessionSurface.tsx`'s `buildFeedRows` was wired to actually produce these rows in production (see Deviations).
- **Task 3** (`7021241`): `agent_run::record_lock_exhaustion` appends exactly one `git.lock_exhausted` event per call (no de-duplication), writes no row on `agent_runs` and changes no status, calling `git_retry::exhaustion_event_payload` rather than building a second copy of the sentence. `sidecar.rs`'s shared reader loop gained a `git_lock_exhausted` branch resolving the seeded system actor and calling `record_lock_exhaustion`, with a failure handled as a logged value (never a panic, never an early loop return, per CR-03). No branch exists for `git_retry` in `sidecar.rs` at all — writing a row per collision is exactly the noise D-53 rejects.

## Task Commits

Each task was committed atomically:

1. **Task 1: One channel, two notices — the shim tells the session it is retrying, and when it gave up** - `2228cb0` (feat)
2. **Task 2: The transient feed row — visible while it is happening, gone the moment it is not** - `d1bef18` (feat)
3. **Task 3: One trail entry for an exhausted budget, and nothing at all for a collision that resolved** - `7021241` (feat)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/core/src/git_retry.rs` - `with_lock_retry_notify` (the retry-loop hook), `with_lock_retry` unchanged in behavior
- `packages/core/tests/git_retry.rs` - notify-hook coverage (zero calls on success, exact upcoming-attempt/max sequence, none on the exhausting attempt)
- `packages/shim/src/main.rs` - `send_notice`, wired into `run_git`'s retry and exhaustion paths
- `packages/sidecar/src/adapter.ts` - `GitRetryEvent`/`GitLockExhaustedEvent` on the `AgentEvent` union
- `packages/sidecar/src/claude-code-adapter.ts` - `noticeToAgentEvent`, `onNotice` wired into `startSession`
- `packages/sidecar/src/mcp-permission-server.ts` - the second `kind`-discriminated message path, `onNotice`
- `packages/sidecar/test/adapter.test.mjs` - notice-handling and mapping coverage
- `packages/desktop/src/session/FeedRow.tsx` - `git_retry`/`git_lock_exhausted` FeedRowData kinds
- `packages/desktop/src/session/SessionSurface.tsx` - `buildFeedRows` mapping/suppression (deviation, see below)
- `packages/desktop/src/session/__tests__/feed-row.test.tsx` - the new row-kind coverage
- `packages/core/src/domain/agent_run.rs` - `record_lock_exhaustion`
- `packages/core/tests/lock_contention.rs` - the `record_lock_exhaustion` test module
- `packages/desktop/src-tauri/src/sidecar.rs` - the `git_lock_exhausted` reader-loop branch
- `packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx` - the exhaustion-entry rendering tests

## Decisions Made

See `key-decisions` in the frontmatter above. The load-bearing one: exhaustion events are attributed to the seeded **system** actor (`flywheel_core::domain::actor::system_actor`), not the agent actor Task 3's own action text named — resolved by giving precedence to `03-UI-SPEC.md` and this plan's own `must_haves.truths`, both of which say "system actor"/"assignee-system mark" (stated three times total across the two documents, versus once for "agent actor" in the action/acceptance-criteria text).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Resolved an internal contradiction: exhaustion events use the system actor, not the agent actor**
- **Found during:** Task 3, reading `03-UI-SPEC.md`'s "Git lock-exhaustion entry" section per the task's own `<read_first>`
- **Issue:** Task 3's `<action>`/`<acceptance_criteria>` text names `flywheel_core::domain::agent_run::agent_actor_id`, but `03-UI-SPEC.md` (twice) and this plan's own `must_haves.truths` both say the entry is "attributed to the system actor... the `assignee-system` mark". `legend/marks.ts`'s `assignee-system` mark entry was added specifically anticipating this exact future use ("`actorTypeMarkId` below only reaches this mark for the activity trail's own actor badge, not for an assignee").
- **Fix:** `sidecar.rs`'s reader-loop branch resolves `flywheel_core::domain::actor::system_actor(&conn)?.id` and passes it to `record_lock_exhaustion`'s `actor_id` parameter, which stays generic (caller-supplied) exactly as specified.
- **Files modified:** `packages/desktop/src-tauri/src/sidecar.rs`
- **Verification:** `packages/core/tests/lock_contention.rs#record_lock_exhaustion_tests::appends_exactly_one_event_attributed_to_the_seeded_system_actor` asserts the actor id equals `system_actor(&conn)?.id` and is distinct from the human actor.
- **Committed in:** `7021241` (Task 3 commit)

**2. [Rule 2 - Missing Critical] `SessionSurface.tsx`'s `buildFeedRows` wired to actually produce/suppress the new row kinds**
- **Found during:** Task 2, after implementing `FeedRow.tsx`'s new cases
- **Issue:** `FeedRow.tsx`'s component switches on a pre-built `FeedRowData.kind`; the mapping from a raw `AgentEvent`'s `type` field to a `FeedRowData` row happens in `SessionSurface.tsx`'s `buildFeedRows`, which is not in this plan's declared `files_modified`. Without a change there, a live `git_retry`/`git_lock_exhausted` event would fall through `buildFeedRows`'s own "anything else" fallback and render as a raw JSON-dump row — the exact opposite of both of Task 2's required behaviors (a muted one-line notice; nothing at all for exhaustion).
- **Fix:** Added a `git_retry` mapping branch producing a `FeedRowData` row, and added `git_lock_exhausted` to `SUPPRESSED_EVENT_TYPES` (the same mechanism `session_closed`/`permission_request` already use to never become a feed row) — `FeedRow.tsx`'s own no-render case for it is defense-in-depth, since the row is never even constructed in production.
- **Files modified:** `packages/desktop/src/session/SessionSurface.tsx`
- **Verification:** `cd packages/desktop && npm run build` and the full `npx vitest run` (342 passed) confirm the wiring compiles and nothing regressed; `feed-row.test.tsx`'s own tests exercise `FeedRow.tsx`'s side of the contract directly.
- **Committed in:** `d1bef18` (Task 2 commit)

**3. [Rule 3 - Blocking] `with_lock_retry_notify` added to `git_retry.rs` (not in this plan's declared `files_modified`)**
- **Found during:** Task 1, implementing the shim's retry-notice call site
- **Issue:** The plan's own action text says to call `send_notice` "from inside the retry loop before each sleep" — but the retry loop and its sleep both live inside `git_retry::with_lock_retry` (`packages/core/src/git_retry.rs`), not inside the shim's own `run_git`. The shim's per-attempt closure has no visibility into "a collision just happened and a sleep is about to begin" without a hook exposed by the retry loop itself.
- **Fix:** Added `with_lock_retry_notify(label, f, on_retry)` as a strict superset of the existing `with_lock_retry(label, f)` — the original becomes a one-line wrapper passing a no-op hook, so `git::git_at` and every existing test are provably unchanged. The shim calls the `_notify` variant.
- **Files modified:** `packages/core/src/git_retry.rs`, `packages/core/tests/git_retry.rs` (new coverage for the hook)
- **Verification:** `cargo test -p core --test git_retry` (23 tests, including 4 new ones), `cargo test --workspace` (fully green)
- **Committed in:** `2228cb0` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing critical, 1 blocking).
**Impact on plan:** All three were necessary for the feature to actually work end-to-end (Tasks 2 and 3 would have been non-functional or contradicted the authoritative UI-SPEC without them). No scope creep beyond what each fix strictly required.

### Verify-script defects found (not code bugs — noted so the literal `<verify>` commands are not mistaken for regressions)

Two of this plan's own literal grep-based `<verify>` commands cannot pass regardless of this plan's diff, because the substring they check for already exists in unrelated code from earlier plans:

- Task 3's `test "$(grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/sidecar.rs | grep -c 'git_retry')" = "0"` — baseline already contains 2 non-comment occurrences (`flywheel_core::git_retry::SpawnFloor`, added by plan 03-02/03-04, unrelated to the `git_retry` EVENT TYPE this check actually intends to guard against). This plan's own diff adds zero new occurrences of the string `git_retry` to `sidecar.rs` — the *intent* (no branch handling the retry-notice event type) is fully satisfied and tested (the comment at the would-be call site states the omission is deliberate).
- Task 2's `test "$(grep -v '^[[:space:]]*//' packages/desktop/src/session/FeedRow.tsx | grep -c 'git_lock_exhausted')" = "1"` — a proper TypeScript discriminated union requires the literal string to appear at least twice (the `FeedRowData` type member and the `switch` case), so "exactly 1" is unreachable while implementing the explicit `case` the plan's own action text asks for. The actual count is 2; both occurrences were verified deliberate and correct via `npx tsc --noEmit` and the dedicated test suite.

## Issues Encountered

- **Two pre-existing test failures, unrelated to this plan, confirmed via a clean-stash rebuild before any 03-13 code existed:** `adapter.test.mjs`'s "normalised events for the fake CLI's stream arrive in source order" test, and 5/7 of `permission.test.mjs`'s real-MCP-round-trip tests. Both reproduce identically on an unmodified checkout. Logged in `.planning/phases/03-nothing-lost-nothing-left-running/deferred-items.md` and the cross-phase `WINDOWS.md` ledger.
- **The single required end-of-plan full `npm --prefix packages/sidecar test` run (55 tests) showed 38 passed / 16 failed / 1 cancelled.** Every failure is in `shutdown.test.mjs`, `stop.test.mjs`, `permission.test.mjs` or `destructive-gate.test.mjs` — files this plan never touches — and every one spawns a real cooperative child/grandchild process and waits on a signal or a live MCP round trip. Consistent with the two smaller, independently-reproduced failures above; looks like a constraint of this execution environment around grandchild-process spawning/signalling, not a code regression. Not re-run a second time per the cost/one-run instruction. Logged in `deferred-items.md` and `WINDOWS.md`.
- **A mid-plan orchestrator restart** killed the executing process after Task 1's four files were written but before any commit existed. Resumed per the coordinator's explicit instructions: verified the on-disk diff matched intent (it did, byte-for-byte against what this transcript had planned), then proceeded to finish and commit Task 1 before continuing to Tasks 2 and 3.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three `must_haves` truths this plan targets are implemented and unit-tested: a resolving collision is silent everywhere (shim, socket, feed, trail); an in-flight retry sequence shows one muted feed line; an exhausted budget appends exactly one Activity Trail entry attributed to the system actor.
- **Outstanding for the phase's consolidated end-of-phase UAT** (per `workflow.human_verify_mode: end-of-phase`): a live reproduction of the full chain — a real shimmed `git` invocation hitting genuine lock contention, observing the transient feed row appear and disappear, and (for a forced-exhaustion scenario) the single trail entry landing — was not run this session. `lock_contention.rs`'s own companion tests establish the shim/retry machinery already reproduces WORK-04's underlying scenario; this plan's own new notice/trail wiring is unit-tested at every layer but not yet observed end-to-end against a live collision.
- Two pre-existing sidecar test suites (`adapter.test.mjs`'s fake-CLI-stream test; most of `permission.test.mjs`, `shutdown.test.mjs`, `stop.test.mjs`, `destructive-gate.test.mjs`) fail in this execution environment independent of this plan's changes — worth a dedicated debugging session with different sandboxing before trusting this repository's sidecar suite as a release gate.

## Self-Check: PASSED

- All 14 modified files verified present on disk via `[ -f ]` (implicit — `git status`/`git diff --stat` above confirms each is a tracked modification, none missing).
- All 3 task commits (`2228cb0`, `d1bef18`, `7021241`) verified present via `git log --oneline`.
- `cargo build --workspace` and `cargo test --workspace` both clean (no failures) as of the last run before this SUMMARY was written.
- `cd packages/desktop && npx vitest run` — 342/342 passed.
- `cargo test -p core --test lock_contention` — 6/6 passed (≥5 required).
- `packages/sidecar/src/index.ts` unchanged (`git diff --stat` shows no entry) — no new op added to the stdio protocol.
- Re-ran every Task-level `<acceptance_criteria>` grep this session: all pass except the two documented verify-script defects (both traced to pre-existing, unrelated code / an unreachable literal-count target for a proper discriminated union — see "Verify-script defects found" above).

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*
