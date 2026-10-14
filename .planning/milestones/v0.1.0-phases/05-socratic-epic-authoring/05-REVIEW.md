---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-29T06:57:58Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - packages/core/src/domain/authoring_session.rs
  - packages/core/tests/authoring_criterion_reachability.rs
  - packages/core/tests/authoring_distillation.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/test/authoring-staging-id.test.mjs
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/uat-08-socratic-authoring.mjs
findings:
  critical: 0
  warning: 4
  info: 1
  total: 5
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-29T06:57:58Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This round (plans 05-48/49/50) changes the `propose_*`/`amend_*`/`delete_*` staging tool contract
so the sidecar HOLDS the socket open and resolves it with the Rust-core-minted `proposalId`,
instead of acking receipt immediately. I traced the full round trip: `stageAuthoringProposal`
(mcp-permission-server.ts) mints a `requestId` and holds the connection in `pending` →
`normalizeProposalNotice` carries that id onto the `proposal_created` `AgentEvent` →
`sidecar.rs`'s reader loop calls `handle_inbound_proposal_created` → the Rust core relays exactly
one answer via `SidecarHandle::relay_authoring_proposal_answer` → `index.ts`'s
`authoring_proposal_answer` op → `ClaudeCodeAdapter.resolveProposalStaged` →
`PermissionServerHandle.answerProposalStaged` → the held socket. I also diffed the three
gap-closure commits (8964e25, ffa0200, 3dffa36, 81b1c66) directly rather than only reading the
final state, which surfaced one thing worth naming up front even though it was already fixed
within the same round: the FIRST commit (8964e25) shipped `handle_inbound_proposal_created` with a
bare `let Ok(mut conn) = state.db.lock() else { return };` — a poisoned-mutex path that silently
dropped the held call with no relay at all — and the very next commit (ffa0200) fixed it. No
automated Rust test ever exercised this function to catch that regression in between; it was
caught by hand. That absence of coverage on the exact function this round's own review focus names
is this review's most substantive finding (WR-01 below).

The double-answer concern named in the review brief does not hold up: every settling site
(`resolvePermission`, `answerBoardRead`, `answerProposalStaged`) uses `pending.get`/`.delete`
against a `Map`, which is idempotent against a second call for the same `requestId` (logged
no-op, never a crash or a corrupted map). I could not find a reachable double-answer path.

The never-answered concern IS structurally present in two places, both currently gated by
invariants documented elsewhere in the codebase (so I rate them WARNING, not BLOCKER) rather than
live, reachable bugs: the two "cannot relay" bare returns in `handle_inbound_proposal_created`
(WR-02), and a payload-classification gap in `mcp-permission-server.ts`'s connection dispatcher
(WR-03) that would silently misroute and drop an `authoring_proposal`-shaped payload missing its
`requestId`, rather than answering it with an error.

The two large UAT harness files (`sidecar-harness.mjs`, `uat-08-socratic-authoring.mjs`, ~1,760 and
~7,750 lines) received a targeted, grep-guided pass over the sections this round's return-contract
change touches (`createProposalStagedHandler`, `HELD_INBOUND_REQUEST_TYPES`,
`drainInboundCoreRequests`, the `drafts-criteria-after-second-advance` scenario and its assertions)
rather than a line-by-line read of their full bulk — flagged here for transparency about scope
depth on those two files specifically.

## Warnings

### WR-01: The exact function this round's held-socket contract lives in has zero automated test coverage

**File:** `packages/desktop/src-tauri/src/commands/authoring.rs:966-1028` (`handle_inbound_proposal_created`)
**Issue:** `handle_inbound_proposal_created` is the one place that (a) applies an inbound
`proposal_created` event to the database and (b) relays exactly one answer back over the held
socket for every reachable outcome. `git log`/`git show` on this round's own commits prove this
function is genuinely fragile in practice: the first commit of this three-commit sequence
(`8964e25`) shipped it with a bare
`let Ok(mut conn) = state.db.lock() else { return };` — on a poisoned mutex, this silently dropped
the event with **no relay at all**, which is precisely the "staging call that is never answered
would hang the agent turn" failure this review was asked to look for. The very next commit
(`ffa0200`, titled "fix(05-48): relay an answer on every proposal-staging host failure path")
corrected it. Searching the whole workspace for callers of this function
(`grep -rln handle_inbound_proposal_created packages --include='*.rs'`) turns up only
`sidecar.rs` (the call site) and `commands/authoring.rs` (the definition) — no `#[test]` anywhere
calls it, directly or indirectly. `authoring_criterion_reachability.rs` and
`authoring_distillation.rs` (this round's own new/updated tests) both call
`core::domain::authoring_proposal::create_proposal`/`resolve_board_read` directly, bypassing this
function entirely; the UAT harness's `createProposalStagedHandler` (`uat-08-socratic-authoring.mjs`)
also bypasses it, calling the `apply-proposal-created` CLI bridge (which reaches
`apply_proposal_created` directly) and answering the socket itself — it never drives
`handle_inbound_proposal_created`. So the one function actually carrying this round's held-socket
relay logic in the shipped desktop app is verified only by manual review and the costly, human-run
live UAT (`uat-08-socratic-authoring.mjs`, explicitly "not executed by an autonomous CI/executor
run"), not by anything `cargo test` runs.
**Fix:** Add a Rust integration test that drives `handle_inbound_proposal_created` (or a
sans-`AppHandle` refactor of its DB-and-relay core, mirroring how `apply_proposal_created` itself
is already tested independently) against at least: (1) a `Created` outcome relaying
`{proposalId}`, (2) each of `Ignored`/`UnknownRun`/`TerminalRun` relaying its named error string,
and (3) a poisoned `db` mutex relaying `"db mutex poisoned"` rather than silently dropping the
call — the exact regression this round's own history shows can recur silently.

### WR-02: The two "cannot relay" bare-return paths leave a held call permanently unanswered if ever reached, with no defense-in-depth timeout on the caller side

**File:** `packages/desktop/src-tauri/src/commands/authoring.rs:970-975`; `packages/sidecar/src/mcp-permission-server.ts:1016-1047` (`stageAuthoringProposal`)
**Issue:** `handle_inbound_proposal_created` extracts `request_id`/`run_id` from the event and then
has exactly two bare `return`s with no relay: `app.try_state::<AppState>()` failing, and
`state.sidecar.as_ref()` being `None`. Both are documented as "cannot relay — reaching the sidecar
requires state this function has already failed to obtain." That's true in the narrow sense that
there is no `SidecarHandle` to relay *through* on the second path, but the practical consequence
if either is ever reached is worse than a missed relay: `apply_proposal_created` is never called
either (both `return`s occur BEFORE the DB write), so the proposal is silently dropped from the
board AND the agent's `propose_*`/`amend_*`/`delete_*` tool call hangs forever — `stageAuthoringProposal`
opens no timer of any kind ("Deliberately no `setTimeout`/`setInterval` anywhere in this function").
`state.rs`'s own doc comment asserts `sidecar` is `None` "only in a context where the sidecar was
never spawned," which the reader-loop wiring in `sidecar.rs` makes true today (the loop that calls
this handler is only ever spawned after a live sidecar exists) — but that invariant lives in a
different file, is not enforced by any test, and a future refactor (e.g., restructuring startup
ordering, or introducing sidecar restart-on-crash) could silently reopen this exact hang with
nothing to catch it.
**Fix:** At minimum, add a bounded timeout inside `stageAuthoringProposal` (reject after N seconds
with a named error) so a `propose_*` call fails loudly instead of hanging the whole conversation
turn forever if this invariant is ever violated — the existing `board_search`/`epic_get`/`task_list`
read tools share the identical no-timeout design and would benefit from the same backstop. As a
lighter alternative, add a debug-assertion or startup-time invariant test proving `state.sidecar`
is `Some` for the whole lifetime of the reader-loop task that calls this handler.

### WR-03: An `authoring_proposal`-shaped payload missing `requestId` is silently misrouted to the notice branch and dropped with no answer

**File:** `packages/sidecar/src/mcp-permission-server.ts:301-308` (`isAuthoringProposalPayload`), `:449-456` (dispatch order)
**Issue:** This round tightened `isAuthoringProposalPayload` to require a string `requestId`
(correctly, since the held-call contract needs one). But the connection handler's dispatch order
is `isSummaryPayload` → `isAuthoringProposalPayload` → `isBoardReadPayload` → `isNoticePayload` →
(default: routine permission request). `isNoticePayload` only checks "carries some string `kind`
field" — it does **not** check that `kind` is one of `"git_retry"`/`"git_lock_exhausted"`. So a
connection whose payload has `kind: "authoring_proposal"` but a missing/non-string `requestId`
(malformed producer, protocol-version skew between a stale standalone MCP server binary and a
newer sidecar, etc.) fails `isAuthoringProposalPayload`, then falls through and **passes**
`isNoticePayload` (since `"authoring_proposal"` is a string). It is then routed to `onNotice`,
which calls `noticeToAgentEvent` — that function returns `undefined` for an unrecognised `kind`
and the event is silently dropped — and the connection is closed immediately
(`socket.end()`, no data written). `stageAuthoringProposal`'s caller is listening for a `"line"`
event that will never arrive on a socket that was closed with no data, so — if this shape were
ever produced — the calling tool call would hang forever with no error and no diagnostic, which is
exactly the failure mode this review was asked to look for. I could not find a real production
caller that omits `requestId` today (every `propose_*`/`amend_*`/`delete_*` handler in this same
file routes through `stageAuthoringProposal`, which always mints one), so this is latent rather
than live — but the type guard exists specifically to make this shape rejectable, and the dispatch
order defeats that intent for the one case it was added to catch.
**Fix:** Move the `kind === "authoring_proposal"` check ahead of/independent from the strict
`isAuthoringProposalPayload` guard, or add an explicit `else` branch when `parsed.kind ===
"authoring_proposal"` but `isAuthoringProposalPayload` returns false, that writes back an
`{error: ...}` line before closing — mirroring how a malformed request is handled everywhere else
in this file — rather than letting it fall into the broad notice guard.

### WR-04: `run_id` is defaulted to an empty string on extraction, which can misdirect (rather than skip) a relay for a malformed event

**File:** `packages/desktop/src-tauri/src/commands/authoring.rs:967` (`let run_id = event.get("runId").and_then(|v| v.as_str()).unwrap_or_default();`)
**Issue:** Unlike `request_id` (which is `Option<&str>` and gates the whole relay with
`let Some(request_id) = request_id else { return };`), a missing/malformed `runId` on the inbound
event is silently coerced to `""` and used downstream both as `apply_proposal_created`'s own guard
input (which correctly still returns `Ignored`/`UnknownRun` internally via its own ULID check) and
as the literal `run_id` argument to `relay_authoring_proposal_answer("", request_id, result)` when
a `request_id` IS present. This masks the distinction between "a well-formed event that legitimately
failed" (should relay an error to the real, waiting caller) and "an event so malformed it does not
even name a run" (relaying to run id `""` can only ever silently fail on the adapter side via
`UnknownRunError`, which is swallowed) — in the latter case, whatever genuinely held connection the
event's own `requestId` might correspond to is never actually reached, because the value handed to
`relay_authoring_proposal_answer` cannot resolve to any live session.
**Fix:** Treat a missing/non-string `runId` the same way a missing `request_id` is already treated
— bail out early with no relay attempt (it cannot possibly resolve to anything) rather than
threading an empty-string sentinel through the rest of the function as if it were a real value.

## Info

### IN-01: `SidecarHandle::relay_authoring_proposal_answer` has no direct unit test in `sidecar.rs`, unlike its sibling helper functions in the same file

**File:** `packages/desktop/src-tauri/src/sidecar.rs:461-478`
**Issue:** This file's own `#[cfg(test)]` modules exercise `persist_event_line`,
`push_bounded_stderr_tail`, `build_authoring_turn_line`, and the delivery-gating behaviour of
`send_authoring_turn_via` directly and thoroughly. `relay_authoring_proposal_answer` (this round's
new method, mirroring `relay_authoring_read_answer`) has no equivalent direct test in this module
— its only coverage is indirect, through the JS-side `authoring-staging-id.test.mjs` (which never
touches this Rust method) and the manual UAT script. This is consistent with
`relay_authoring_read_answer` also having no direct Rust test, so it is not a new gap this round
introduced, but it compounds WR-01 above.
**Fix:** A small test constructing a `SidecarHandle::without_child_for_tests()` and asserting
`relay_authoring_proposal_answer` produces the expected `authoring_proposal_answer` JSON shape (or
fails cleanly with no child attached) would close this alongside WR-01's broader ask.

---

_Reviewed: 2026-09-29T06:57:58Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
