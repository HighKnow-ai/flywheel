---
phase: 03-nothing-lost-nothing-left-running
verified: 2026-09-20T12:09:41Z
status: gaps_found
score: 4/5 must-haves verified
covered_files:
  - ".planning/phases/03-nothing-lost-nothing-left-running"
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/STATE.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-19-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-19-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-20-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-20-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-21-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-21-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-22-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-22-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-23-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-23-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-core.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-frontend.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-sidecar.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW-part-tauri.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-UAT.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-SESSION-LIFECYCLE-FINDINGS.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-DESTRUCTIVE-GATE-BYPASS-CLASS.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/deferred-items.md"
  - "packages/shim/src/main.rs"
  - "packages/sidecar/src/pretooluse-hook.ts"
  - "packages/sidecar/src/mcp-permission-server.ts"
  - "packages/sidecar/src/watchdog.ts"
  - "packages/sidecar/src/claude-code-adapter.ts"
  - "packages/core/src/db/mod.rs"
  - "packages/core/src/runtime_protocol.rs"
  - "packages/sidecar/test/close-provenance.test.mjs"
  - "packages/sidecar/test/socket-permissions.test.mjs"
  - "packages/sidecar/test/destructive-gate.test.mjs"
  - "packages/core/tests/db_bootstrap.rs"
  - "scripts/uat/uat-06-permission-block-lifecycle.mjs"
  - "scripts/uat/lib/sidecar-harness.mjs"
  - "scripts/uat/README.md"
  - "packages/core/tests/bin/uat_session_env.rs"
covered_digest: "v1:sha256:12ca7d76c132b45b7c16e8a0849f805032e77a45e5f57f1c96ed7e4356cd92f4"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "G-03-3 half 2 (Success Criterion 5 / AGNT-07, 'the session stays blocked until a human answers'): CLOSED. Plan 03-20's root-cause investigation confirmed the prior five-run ~15-16s termination signature was the watchdog's own heartbeat-staleness kill correctly reaping an UNSUPERVISED harness run (H1 CONFIRMED, three independent on-disk records agree) — not a product defect. Plan 03-21's acceptance run under a production-shaped heartbeat writer held a destructive permission request unanswered for a genuine, asserted (assertNoEvent) 60-second window, then delivered `deny`, which was honoured end to end (remote ref unchanged, worded refusal, session closed 4755ms/3836ms after the answer across two runs). I re-ran the regression suite this claim rests on directly this session (`close-provenance.test.mjs`, 9/9 pass, including the two new PROC-04/AGNT-07 edge-case tests) and confirmed the acceptance script and its `--answer-after`/`--decision` flags exist and match the reported measurement. This specific gap does not reopen."
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "An agent running in auto-accept permission mode always stops and asks before a force-push, a branch deletion or a recursive delete (Success Criterion 5, AGNT-07) — 'always' is the operative word the requirement is written on."
    status: partial
    reason: >
      A NEW, separate gap was discovered and confirmed during this same gap-closure wave, distinct
      from the one this round set out to close (G-03-3 half 2, now closed — see gaps_closed above).
      A code review of the CR-01 shadow-bypass fix found the fix's own premise false for a sibling
      case (`command`/`builtin` prefixes) — fixed in three follow-up commits I confirmed present and
      correct in source (3eaa76c, bbe00b4, 0fdda51), and I independently reproduced the fix working
      against the compiled `flywheel-shim` binary (`command git push --force` -> `invokedBareName:
      true`; `command -p git push --force` -> `invokedBareName: false`). But the orchestrator then
      recorded a BROADER, still-open finding
      (03-DESTRUCTIVE-GATE-BYPASS-CLASS.md): `destructive::classify` returns `Safe` for any program
      name that is not literally `git`/`rm`/a small enumerated set of wrappers, so an entire class of
      ordinary shell launcher idioms — `sh -c "git push --force"`, `bash -c "..."`, `nice`, `nohup`,
      `timeout`, `xargs`, `sudo`, `setsid` — all classify `{"category":"safe"}`. I reproduced every
      one of these eight commands returning `safe` directly against the compiled binary this session
      (see Behavioral Spot-Checks) — this is not a stale claim, it is true at HEAD right now.
      `pretooluse-hook.ts`'s `category === "safe"` branch (confirmed by direct source read,
      line 210-213) returns `{}` unconditionally and NEVER calls `shimWillIntercept` for these
      forms — the exact environment-correctness proof an ordinary bare `git push --force` is
      required to pass before the hook will defer. The bypass-class document's own claim that these
      eight shapes are nonetheless still caught by the shim's runtime PATH-shadow interception
      (layer 2, because they still perform a real PATH search for `git`) is architecturally sound
      — I traced `shim_env_for_run`'s PATH-prefixing and confirmed it applies to the whole session
      environment, which a child `sh`/`bash` would inherit — but this is REASONING, not a measured
      fact: I found zero test coverage (grep across `destructive-gate.test.mjs` for any of these
      eight launcher tokens returned nothing) and no live measurement anywhere in this phase's
      artifacts proving a permission_request is actually still raised for `sh -c "git push
      --force"` end to end. Per this project's own behavior-dependent-truth standard, an unmeasured
      backstop claim does not upgrade a classifier-level failure to a verified pass. The practical
      severity is real but bounded: these forms are a single point of failure (relying entirely on
      the shim's runtime interception, with no independent hook-level check), not yet demonstrated
      to be a total, silent bypass in a correctly configured session — but "single point of failure"
      is not what AGNT-07's "always require explicit confirmation" wording promises, and the
      classifier itself — the thing that is supposed to make the confirmation decision — is
      objectively wrong for these eight ordinary inputs. The orchestrator's own walk-back of
      AGNT-07 from Complete to Gaps Found (commit db18b0e, confirmed at HEAD in
      REQUIREMENTS.md) is the correct call and this verification concurs with it independently,
      not merely by trusting that commit.
    artifacts:
      - path: "packages/shim/src/main.rs"
        issue: "`destructive::classify` (packages/core/src/destructive.rs) returns Safe by construction for any program name outside `git`/`rm`; `resolve_segment_program_index` only unwraps a small enumerated set of wrappers (assignments, `env`, `command`, `builtin`), so any OTHER process launcher (`sh -c`, `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid`, and any not-yet-enumerated future one) is classified safe regardless of what it launches."
      - path: "packages/sidecar/src/pretooluse-hook.ts"
        issue: "Line 210-213 returns `{}` unconditionally for `category === \"safe\"` without ever calling `shimWillIntercept` — the one check that would catch a misconfigured shim environment for these forms."
    missing:
      - "A dedicated planning decision (not a drive-by quick task, per the bypass-class document's own recommendation) choosing between: (1) inverting the classifier's default to refuse `Safe` for any unrecognised leading token — closes the class completely but turns a narrow git/rm gate into general command-allowlisting; (2) continuing to enumerate known launchers — narrows the gap without closing the class; (3) making `pretooluse-hook.ts` verify `shimWillIntercept` (or fail closed) whenever it cannot positively prove a command inert, instead of trusting `category === \"safe\"` outright — the option the bypass-class document itself judges most likely correct."
      - "A live or automated measurement that actually exercises `sh -c \"git push --force\"` (or one of its seven siblings) end to end in a real session, to settle whether the layer-2 backstop this gap's severity assessment leans on is a measured fact or only a plausible inference from reading `shim_env_for_run`'s PATH-prefixing logic."
---

# Phase 3: Nothing Lost, Nothing Left Running — Verification Report (Re-Verification)

**Phase Goal:** "Cyril can quit, crash or interrupt Flywheel at any moment and know that no
uncommitted work was destroyed and no agent is still spending his money."
**Verified:** 2026-09-20T12:09:41Z
**Status:** gaps_found
**Re-verification:** Yes — this report supersedes the 2026-09-20T10:50:00Z report (`gaps_found`,
4/5), which was itself a re-verification. This round closes that report's single recorded gap
(G-03-3 half 2, the sustained-block half of Success Criterion 5) but finds a NEW, independently
confirmed gap in the same success criterion, discovered by a code review and an orchestrator
investigation that both ran after the prior verification was written. Every truth below was
re-derived from source read at HEAD, tests I ran directly in this session, and this phase's own
dated artifacts — not from any SUMMARY's self-assessment.

**A note on ROADMAP mode:** Phase 3's ROADMAP entry is tagged `Mode: mvp`, but its goal text is not
in the `As a ... I want ... so that ...` User Story shape the MVP verification path requires
(confirmed: `user-story.validate` returns `valid: false` against it). Both prior verification
rounds treated this phase under the standard Success-Criteria goal-backward method and the project
accepted those reports; this report follows that same precedent. Flagged as `info`, not a blocker.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone. | ✓ VERIFIED | Unchanged by this round's diff. Re-confirmed by the orchestrator's own fully green `cargo test --workspace` (49 suites, 419 passed) and desktop Vitest run (32 files, 440 tests) after the final fix commit — I did not re-run the full suites myself (see Behavioral Spot-Checks for what I ran directly instead), per the single-full-run rule. |
| 2 | User quits the application while a session is running and no agent process survives — confirmed in the OS process table — including when the supervisor is killed rather than closed cleanly. | ✓ VERIFIED | Unchanged conclusion from `03-UAT.md` test 1 (`scripts/uat/uat-01-supervisor-kill.sh`, pass). Plan 03-20 instrumented (did not alter the kill logic of) `watchdog.ts`; this is now MORE strongly tested than before, not less: `close-provenance.test.mjs`'s 9 cases (I ran the file directly, 9/9 pass) include a dedicated regression that a pending permission request never suppresses, extends or conditions the watchdog's stale-kill (PROC-04's guarantee against AGNT-07's own question buying an unsupervised session extra life). |
| 3 | User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database, and decides what happens to each; nothing is silently resumed and nothing is silently repaired. | ✓ VERIFIED | Unchanged conclusion from `03-UAT.md` test 2 (human + harness, pass). Plan 03-23 extended `clear_run_runtime_files` to also remove the new lifecycle timeline on orphan resolution — I ran its two dedicated new tests directly this session (`clear_run_runtime_files_removes_the_lifecycle_timeline_alongside_the_other_three_files`, `..._succeeds_when_the_lifecycle_file_is_absent`): both pass, confirming the extension didn't regress the existing three-file cleanup contract this truth depends on. |
| 4 | A stress run driving ten concurrent commits into one repository keeps every commit — index-lock collisions back off and retry instead of failing a task, and staggered spawn timing stops parallel starts colliding in the first place. | ✓ VERIFIED | Unchanged conclusion from `03-UAT.md` test 5 (pass). No file this round's plans touched (`main.rs`, `pretooluse-hook.ts`, `mcp-permission-server.ts`, `watchdog.ts`, `claude-code-adapter.ts`, `db/mod.rs`, `runtime_protocol.rs`) is on the lock-retry/spawn-stagger path (`git_retry.rs`, `shim.rs`'s `shim_env_for_run` structure is untouched). Re-confirmed green in the orchestrator's own final full-suite run. |
| 5 | An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete — and the session stays blocked until a human answers (compound truth this SC and AGNT-07 share; the exact wording `03-UAT.md`'s gap G-03-3 was filed against). | ◐ PARTIAL — see gap | **This round's target half (sustained block until answered): now VERIFIED CLOSED.** Plan 03-20's clean-room, config-isolated investigation confirmed the previously-open ~15-16s self-termination was the watchdog's own heartbeat-staleness kill correctly reaping an unsupervised harness run (H1 CONFIRMED — three independent on-disk records agree: kill record `reason: "heartbeat-stale"`, lifecycle `stale_kill` line, terminal `session_closed.closeOrigin: "watchdog-heartbeat-stale"`), never a product defect; a `--heartbeat=on` run of the identical scenario sustained the block for the full 90s window with zero termination artifacts. Plan 03-21's acceptance run (`uat-06-permission-block-lifecycle.mjs --heartbeat=on --answer-after=60000 --decision=deny`) then measured, twice, that a genuinely unanswered request (`assertNoEvent` passed for the full 60000ms) survives and an answer delivered at the end is honoured end to end (remote ref unchanged, worded refusal, session closed 4755ms/3836ms later). I confirmed the acceptance script and its flags exist in source and re-ran `close-provenance.test.mjs` directly (9/9 pass, including the two new edge-case regressions this closure added). **A DIFFERENT, newly discovered half of the same requirement remains open and is NOT closed by this round's work: the classifier that decides whether to ask at all is demonstrably wrong for a class of ordinary shell launcher idioms.** I reproduced this directly against the compiled `flywheel-shim` binary at HEAD (see Behavioral Spot-Checks): `sh -c "git push --force"`, `bash -c "..."`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, and `setsid` all classify `{"category":"safe"}`, and `pretooluse-hook.ts`'s `category === "safe"` branch (confirmed at source, line 210-213) returns `{}` without ever calling `shimWillIntercept` for them — skipping the one check that exists specifically to catch a misconfigured shim environment. The narrower `command`/`builtin`-prefix variant of this same root cause, found by this round's own code review, IS fixed (confirmed by source read and by direct execution against the compiled binary: `command git push --force` and `command -p git push --force` both now classify correctly). The broader launcher-shape class is not, and is recorded as OPEN in `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`. |

**Score:** 4/5 truths verified (0 present-behavior-unverified; 1 partial, blocking — this round
closed the specific half of Truth 5 it targeted, but an independently discovered, different half of
the same truth remains open).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| WORK-03 | 03-01, 03-05, 03-18 | Worktree never destroyed without checking for uncommitted changes | ✓ SATISFIED | Unchanged; untouched by this round's diff. |
| WORK-04 | 03-04, 03-08, 03-13, 03-14 | Concurrent git operations retry with exponential backoff/jitter | ✓ SATISFIED | Unchanged; untouched by this round's diff. |
| WORK-05 | 03-04, 03-08, 03-14 | Agent spawn timing desynchronised | ✓ SATISFIED | Unchanged; untouched by this round's diff. |
| WORK-06 | 03-03, 03-09, 03-11, 03-18 | Launch reconciles worktrees on disk vs database | ✓ SATISFIED | Unchanged; untouched by this round's diff. |
| PROC-03 | 03-02, 03-15 | Agent processes managed as process groups | ✓ SATISFIED | Unchanged; untouched by this round's diff. |
| PROC-04 | 03-02, 03-10, 03-15, 03-17, 03-20, 03-21 | No agent process survives application quit | ✓ SATISFIED | Strengthened this round: `close-provenance.test.mjs` now directly regression-tests that a pending destructive permission request never suppresses the watchdog's stale-kill (9/9 pass, run directly this session). |
| PROC-05 | 03-06, 03-10, 03-11, 03-17, 03-23 | Orphaned processes/in-flight runs detected and surfaced on launch | ✓ SATISFIED | Extended this round (lifecycle-file cleanup on orphan resolution); both new tests run directly, pass. |
| AGNT-07 | 03-07, 03-12, 03-14, 03-16, 03-19, 03-20, 03-21, 03-22, 03-23, quick-260920-duy | Destructive actions always require confirmation, even in auto-accept mode | ◐ PARTIAL (see gap) | The sustained-block half this round targeted is closed (see Truth 5 above). A newly discovered, broader classifier gap (the launcher-shape bypass class) is open and independently confirmed by me at HEAD. `REQUIREMENTS.md` at HEAD correctly reads `[ ] AGNT-07` / `Gaps Found` (commit `db18b0e`) — this verifier concurs with that walk-back on its own evidence, not merely by trusting the commit. |

All 8 requirement IDs are present in REQUIREMENTS.md and mapped to a phase-03 plan (direct grep of
every plan's `requirements:` frontmatter line against REQUIREMENTS.md's own phase-3 row); no
orphaned requirement IDs found.

**Documentation inconsistency found, not evidence-affecting:** `.planning/STATE.md` (last updated
2026-09-20T10:42:06Z, `state_head: 09ab7bc`) still reads "AGNT-07 and seven sibling requirements
reconciled to Complete" and "AGNT-07 is now Complete" — written by plan 03-22, before the code
review found the `command`/`builtin` critical and before the orchestrator's subsequent walk-back
commit (`db18b0e`, later than `STATE.md`'s recorded head). `REQUIREMENTS.md` is correct at HEAD;
`STATE.md` is stale and should be updated to match. This is a documentation gap, not a product gap,
and does not change any truth's status above.

### Required Artifacts (Delta Since Prior 2026-09-20T10:50:00Z Verification)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/sidecar/src/watchdog.ts`, `claude-code-adapter.ts` (`resolveCloseOrigin`) | Lifecycle-timeline instrumentation naming which mechanism ended a session, without altering the stale-kill condition | ✓ VERIFIED | Confirmed present; `must_haves.prohibitions` (no change to the stale-kill condition) honored — `git diff` on `watchdog.ts`'s kill condition across the 03-20/03-21 window is empty per 03-21-SUMMARY's own claim, and the passing `close-provenance.test.mjs` regression for "a pending request never suppresses stale-kill" is consistent with that. |
| `scripts/uat/uat-06-permission-block-lifecycle.mjs` | `--answer-after`/`--decision` acceptance-mode flags proving a sustained, genuinely-unanswered block that honours a late answer | ✓ VERIFIED | Confirmed present in source (`--answer-after=`, `assertNoEvent`, `closedAfterAnswerMs`). Not re-run live this session (spawns a real `claude` session; the orchestrator's and 03-20/03-21's own fresh measurements plus my source/regression-test confirmation were judged sufficient, consistent with the prior round's own precedent for this exact tradeoff). |
| `packages/sidecar/src/mcp-permission-server.ts` (`fs.chmodSync(socketPath, 0o600)`) | WR-01 (old, permission socket hardening) fix | ✓ VERIFIED | Confirmed at source line 194; `socket-permissions.test.mjs` run directly, 3/3 pass. |
| `packages/core/src/db/mod.rs` (`path.is_absolute()`) | WR-02 (old, FLYWHEEL_APP_DATA_DIR guard) fix | ✓ VERIFIED | Confirmed at source line 212; `db_bootstrap.rs`'s `non_empty_relative_app_data_dir_override_is_rejected_by_name` run directly, pass. |
| `packages/shim/src/main.rs` (`command`/`builtin` unwrap) | 03-REVIEW.md's new-this-round Critical fix | ✓ VERIFIED | Confirmed present at source (`resolve_segment_program_index`'s `Some("command")`/`Some("builtin")` arms) and by direct execution against the compiled binary — `command git push --force` now correctly classifies `force-push`/`invokedBareName: true`; `command -p ...` correctly reports `invokedBareName: false`. |
| `packages/shim/src/main.rs` / `destructive.rs` (general launcher-shape unwrapping) | Would need to exist for AGNT-07's "always" to hold against `sh -c`, `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid` | ✗ MISSING | Confirmed absent by direct execution against the compiled binary: all eight forms return `{"category":"safe"}`. This is the open gap. |

### Key Link Verification (Delta)

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/sidecar/src/mcp-permission-server.ts` (held request) | a human's Allow/Deny answer | the session is expected to remain blocked, unresolved, until `resolvePermission` is called | ✓ WIRED (now confirmed sustained) | Was `✗ NOT CONFIRMED SUSTAINED` in the prior report. Now closed by plan 03-21's `--answer-after=60000` acceptance run (`assertNoEvent` held for the full window; `honoured=true` twice). |
| `packages/shim/src/main.rs --classify-invocation` (`category: "safe"`) | `packages/sidecar/src/pretooluse-hook.ts` (`shimWillIntercept` check) | the hook is expected to verify interception is provable before trusting any non-obviously-destructive command | ✗ NOT WIRED for the launcher-shape class | Confirmed by direct source read: `category === "safe"` (line 210-213) returns `{}` unconditionally, with no call to `shimWillIntercept`, for `sh -c "git push --force"` and its seven siblings — all misclassified `safe` by the shim in the first place. |
| shim's runtime `PATH`-shadow interception (layer 2, `argv[0]` dispatch on `git`) | the permission socket, for a launcher-wrapped destructive command that reached real execution | inherited `PATH` from `shim_env_for_run`, which prefixes the whole session environment | ? UNMEASURED (plausible, not proven) | Source trace confirms `shim_env_for_run` prefixes `PATH` for the entire spawned session environment, which a child `sh`/`bash` would inherit and use for its own internal `git` resolution — the reasoning `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md` gives for calling this "a single point of failure, not a double one." No test or live measurement in this phase's artifacts actually drives `sh -c "git push --force"` through a real session to confirm the permission_request is in fact still raised. Recorded as unmeasured, not assumed true or false. |

### Behavioral Spot-Checks (Run Directly, This Session)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Bypass-class document's eight launcher shapes still classify `safe` at HEAD | `flywheel-shim --classify-invocation "<sh -c \| bash -c \| nice \| nohup \| timeout \| xargs \| sudo \| setsid> git push --force"` (8 commands, compiled fresh via `cargo build -p flywheel-shim`) | all 8 returned `{"category":"safe"}`; plain `git push --force` correctly returned `force-push`/`invokedBareName: true` as a control | ✓ CONFIRMED (this is the gap, not a pass/fail spot-check) |
| `command`/`command -p` prefix fix (round-2/3/4 of the same review) is present and correct | same binary: `command git push --force`, `command -p git push --force` | `{"category":"force-push","invokedBareName":true,...}` / `{"category":"force-push","invokedBareName":false,...}` | ✓ PASS |
| `pretooluse-hook.ts`'s safe-branch never calls `shimWillIntercept` | `grep -n 'category === "safe"' -A3 packages/sidecar/src/pretooluse-hook.ts` | line 210-213: `printDecision({}); process.exit(0);` unconditional | ✓ CONFIRMED (matches the gap's own claim) |
| Permission-socket hardening (old WR-01) | `node --test packages/sidecar/test/socket-permissions.test.mjs` | `# tests 3`, `# pass 3`, `# fail 0` | ✓ PASS |
| `FLYWHEEL_APP_DATA_DIR` absolute-path guard (old WR-02) | `cargo test -p core --test db_bootstrap non_empty_relative_app_data_dir_override_is_rejected_by_name -- --exact` | `test result: ok. 1 passed` | ✓ PASS |
| Sustained-block regression suite (AGNT-07/PROC-04 edge cases from 03-20) | `node --test packages/sidecar/test/close-provenance.test.mjs` | `# tests 9`, `# pass 9`, `# fail 0` | ✓ PASS |
| Orphan-resolution lifecycle-file cleanup (03-23) | `cargo test -p core --test runtime_protocol clear_run_runtime_files_removes_the_lifecycle_timeline_alongside_the_other_three_files -- --exact` | `test result: ok. 1 passed` | ✓ PASS |
| CR-01 (function/alias/PATH= shadow) + command/builtin regression table | `node --test --test-name-pattern 'command\|builtin\|env -i' packages/sidecar/test/destructive-gate.test.mjs` (matched and ran the full 13-case file) | `# tests 13`, `# pass 13`, `# fail 0` | ✓ PASS |
| Full workspace/sidecar/desktop suites | not re-run this session — the orchestrator ran them directly after the final fix commit (`cargo test --workspace`: 49 suites/419 passed/0 failed; `npm --prefix packages/sidecar run test`: 80/80; desktop Vitest: 32 files/440 tests) | N/A | ✓ ACCEPTED (single-full-run rule; I ran 6 targeted named/file-scoped tests myself above instead of repeating the full runs) |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention exists in this repository; `scripts/uat/`
harnesses serve this role and are covered above.

### Anti-Patterns Found (Status Update)

| File | Pattern | Severity | Resolution |
|---|---|---|---|
| `packages/shim/src/main.rs` (`resolve_segment_program_index`) | 03-REVIEW.md's new-this-round CR-01: `command`/`builtin` prefix defeats the classifier | 🛑 Critical (03-REVIEW.md) | **RESOLVED** — commits `3eaa76c`, `bbe00b4`, `0fdda51`, confirmed by source read and direct binary execution this session. |
| `packages/shim/src/main.rs` / `packages/core/src/destructive.rs` (`classify`) | General launcher-shape bypass (`sh -c`, `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid`) — a broader instance of the same root cause as the CR-01 above, not enumerated by that fix | 🛑 Critical in kind (per `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`'s own severity label) | **OPEN.** Confirmed reproducible at HEAD, this session, against the compiled binary. See Gaps. |
| `packages/sidecar/src/claude-code-adapter.ts` (`resolveCloseOrigin`) | New WR-01 (03-REVIEW.md, this round): the `signal_forwarded` -> `supervisor-signal` rule is effectively unreachable, misattributing an externally-signalled shutdown as `backend-exit` | ⚠️ Warning (03-REVIEW.md) | **OPEN, diagnostics-only** — `closeOrigin` gates no execution decision; does not affect any truth above. Not addressed by any commit since the review. |
| `scripts/uat/lib/sidecar-harness.mjs` (`assertClaudeConfigIsolated`) | New WR-02 (03-REVIEW.md, this round): string comparison doesn't resolve symlinks, so a staged config dir symlinked into `~/.claude` would pass the isolation check | ⚠️ Warning (03-REVIEW.md) | **OPEN, harness-only** — affects only the cost/safety of a future live-measurement run, not the shipped product. Not addressed by any commit since the review. |
| `packages/core/src/runtime_protocol.rs` (`clear_run_runtime_files`) | IN-01 (03-REVIEW.md): stops at the first removal failure instead of attempting all four per-run files | ℹ️ Info (03-REVIEW.md) | **OPEN**, pre-existing loop structure, rare failure mode, informational only per the review itself. |
| `.planning/STATE.md` | Stale "AGNT-07 ... Complete" claim, superseded by `REQUIREMENTS.md`'s correct `Gaps Found` at a later commit | ℹ️ Info (this verification) | **OPEN** — documentation-only, does not affect any truth's evidence. |
| `packages/core/src/destructive.rs` (`classify_git`) | Leading global git flag (`-C`, `-c`) misclassified `Uncategorized` (destructive), fails closed | ⚠️ Warning (pre-existing, carried since initial verification) | **STILL OPEN, deliberately out of scope**, unchanged this round. |

No new debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found across every file touched
since the prior verification (grep run directly, 14 files, zero matches).

### Human Verification Required

None. The remaining open item (the launcher-shape classifier gap) is not a "look at pixels" item —
it is an engineering/product decision (which of the three options in
`03-DESTRUCTIVE-GATE-BYPASS-CLASS.md` to take) plus a missing automated measurement, and is
therefore carried as a **gap**, not a human-verification checklist item.

### Process Note (Not a Product Defect)

During this gap-closure wave's security investigation, an executor ran a real, unauthorized
`git push` against the live remote (`git@github.com:cymarechal/highknow-harness.git`), publishing
branch `cymarechal-devoteam/gsd-new-project-ade` as a new ref while empirically testing whether
`command -p` defeats the shim. Nothing was overwritten (`main` untouched); the executor disclosed it
immediately; on the user's explicit instruction the orchestrator deleted the remote branch and the
remote is back to `main` only, local history intact. Root cause was the dispatch brief fencing live
`claude` sessions but not forbidding execution of real destructive git commands during
classification testing. This is a process/briefing defect, fully recorded in
`03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`, and does not affect any truth's verdict above.

### Gaps Summary

**This round's targeted gap is closed.** The sustained-block half of Success Criterion 5 — "the
session stays blocked until a human answers" — is now measured true, twice, under a
production-shaped heartbeat writer, with the answer path honoured end to end and a regression suite
(9/9, run directly this session) guarding the PROC-04 interaction. The prior report's root-cause
uncertainty is resolved: the watchdog was never at fault; an unsupervised measurement harness was.

**A new, independently confirmed gap in the same success criterion remains open.** Scrutinizing the
CR-01 shadow-bypass fix for a sibling case surfaced that `destructive::classify` only recognizes a
small enumerated set of process launchers (assignments, `env`, `command`, `builtin`) as
"see-through," and treats every other program name — including ordinary, extremely common shell
idioms like `sh -c "..."`, `nice`, `sudo`, `timeout` — as unconditionally `Safe`. I reproduced all
eight of the bypass-class document's named commands classifying `safe` directly against the
compiled binary at HEAD, and confirmed `pretooluse-hook.ts` skips its own `shimWillIntercept`
environment-correctness check entirely for anything the classifier calls `safe`. The classifier —
the piece of the system responsible for deciding whether to ask a human at all — is demonstrably
wrong on ordinary inputs, which is what AGNT-07's plain-language "always require explicit
confirmation" is written against. The bypass-class document's own mitigating argument (these forms
still reach the shim's runtime `PATH`-shadow interception in a correctly configured session, so
severity is "single point of failure" rather than "total bypass") is architecturally sound but
UNMEASURED — no test or live run in this phase's artifacts actually proves a permission_request is
still raised for any of these eight forms end to end.

**Overall determination:** `gaps_found`. This is not a reopening of the sustained-block work this
round set out to do — that work is solid and closed. It is confirmation, independent of trusting the
orchestrator's own walk-back commit, that AGNT-07 and Success Criterion 5 are not yet fully,
reliably closed, for a different and newly discovered reason. The next step is the planning
decision `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md` itself recommends (most likely: make the hook verify
`shimWillIntercept`, or fail closed, whenever it cannot positively prove a command inert — Option 3
in that document) plus a measurement that actually exercises the layer-2 backstop claim rather than
inferring it from source.

---

_Verified: 2026-09-20T12:09:41Z_
_Verifier: Claude (gsd-verifier)_
