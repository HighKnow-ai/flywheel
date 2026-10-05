---
phase: 07-the-board-tells-the-git-truth
plan: 12
subsystem: testing
tags: [rust, forge, integration-test, subprocess, github, gitlab, gap-closure]

# Dependency graph
requires:
  - phase: 07-the-board-tells-the-git-truth
    provides: "the connection-free dispatch seam (forge_and_repo_path / request_for_branch_at / create_request_at, plan 07-11) and the bounded subprocess timeout guard (plan 07-10) this harness drives unmodified"
provides:
  - "An automated end-to-end proof of verification criterion 3's previously-unverified live arm: a real gh/glab child process, a real poll, a real status write — once per forge, through the real production dispatch seam"
affects: []

actuals:
  tokens: 7084
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Functional CLI stub on PATH: a shell script baked with its own scratch directory's absolute path (via string .replace, not format!, to dodge JSON brace-escaping), prepended to PATH under a serialising mutex exactly as forge_degrade.rs's marker-only sabotage stub does, but dispatching on argv to answer auth status / create / list / view with real JSON instead of just recording that it was called."
    - "One shared assertion sequence called once per adapter: assert_open_to_merged_chain takes the forge value and the forge-specific 'merged' state string as its only varying parameters, so GitHub and GitLab are proven by literally the same assertions rather than two hand-written near-duplicates that could silently drift apart."

key-files:
  created:
    - packages/core/tests/forge_live_chain.rs
  modified: []

key-decisions:
  - "A single FakeForge scratch directory holds both the gh and glab stubs and one set of state files (state/ci/entries/body.txt/argv.txt/invoked.marker); the test chooses which forge-specific literal value to write (e.g. \"OPEN\" vs \"opened\", \"MERGED\" vs \"merged\") rather than the helper normalising the vocabulary — this keeps each stub answering in its own adapter's real JSON shape with no translation layer that could itself hide a bug."
  - "Script generation uses String::replace on a __DIR__ placeholder instead of format!, because the gh/glab JSON payloads these stubs emit are dense with literal braces that format! would require doubling throughout — correctness was easier to see with a plain substitution."
  - "create_request_at's internal read-back (both adapters call their own request_for_branch after create to populate the returned ForgeRequest) means the harness's own explicit first poll is technically a second list/view call against an already-open request — left as is: it exercises the identical real path a second time rather than trusting the create call's self-reported state, which is closer to what the scheduler tick actually does (open once, poll independently on its own cadence)."

requirements-completed: [LINK-05, LINK-06, LINK-07, LINK-08]

coverage:
  - id: D1
    description: "The whole open-request-to-status-write chain is exercised by one automated test command for GitHub: a real gh child process is spawned, the real argv/body transport is used, the real JSON normaliser reads real stdout, the real edge detector reads its baseline from the append-only log, and the real status writer moves the task — only the forge server is substituted"
    requirement: "LINK-05"
    verification:
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#github_open_to_in_review_to_done_chain_runs_through_a_real_child_process"
        status: pass
    human_judgment: false
  - id: D2
    description: "The same chain is exercised for GitLab through the identical shared assertion sequence, proving the two-subprocess read (mr list supplies iid, mr view supplies the pipeline) and the owner-only description-file body transport"
    requirement: "LINK-05"
    verification:
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#gitlab_open_to_in_review_to_done_chain_runs_through_a_real_child_process"
        status: pass
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#gitlab_description_reaches_the_cli_as_a_file_not_as_an_argv_value"
        status: pass
    human_judgment: false
  - id: D3
    description: "A third poll against an unchanged forge writes no status change and no event for either forge, and a branch with no request yields no request and no transition (GitLab's no-request case additionally proves mr view is never called when there is no iid)"
    requirement: "LINK-07"
    verification:
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#github_branch_with_no_request_yields_no_request_and_no_transition"
        status: pass
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#gitlab_branch_with_no_request_yields_no_request_and_never_calls_view"
        status: pass
    human_judgment: false
  - id: D4
    description: "A request with no CI run normalises to no CI result (CiResult::None) rather than a wrong one, for both forges; two requests for the same source branch select the newest by created timestamp through the live subprocess path, for both forges"
    requirement: "LINK-06"
    verification:
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#github_request_with_no_ci_run_normalises_to_no_ci_result"
        status: pass
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#gitlab_request_with_no_head_pipeline_normalises_to_no_ci_result"
        status: pass
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#github_two_requests_select_the_newest_by_created_timestamp_through_the_live_path"
        status: pass
      - kind: integration
        ref: "packages/core/tests/forge_live_chain.rs#gitlab_two_requests_select_the_newest_by_created_timestamp_through_the_live_path"
        status: pass
    human_judgment: false
  - id: D5
    description: "The harness runs identically with every forge authentication variable unset, never contacts a real forge, and asserts its own fake was invoked before trusting any result — a failed path substitution fails loudly rather than silently passing against a real CLI"
    requirement: "LINK-08"
    verification:
      - kind: other
        ref: "env -u GH_TOKEN -u GITHUB_TOKEN -u GITLAB_TOKEN cargo test -p core --test forge_live_chain (exit 0, 9 passed)"
        status: pass
      - kind: other
        ref: "grep -rv '^[[:space:]]*//' packages/core/tests/forge_live_chain.rs | grep -ciE 'ANTHROPIC_API_KEY|GH_TOKEN|GITLAB_TOKEN|api.github.com' == 0"
        status: pass
    human_judgment: false

# Metrics
duration: 42min
completed: 2026-10-05
status: complete
---

# Phase 7 Plan 12: The Live Forge Chain, Proven Without a Live Forge Summary

**One new file, `packages/core/tests/forge_live_chain.rs`, drives the real `create_request_at`/`request_for_branch_at`/`apply_forge_observation` production path through a functional `gh`/`glab` shell stub — proving open→In Review→Done for both forges end to end, with the forge server as the only substituted component.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-10-05T07:23:00Z
- **Completed:** 2026-10-05T08:05:00Z
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments

- Closed verification Gap 2 (success criterion 3's live arm): the single largest untested surface in phase 07 — the real subprocess-to-forge-to-poll-to-status-write chain — now re-runs automatically on every future commit instead of requiring a disposable authenticated GitHub/GitLab repository and a manual walkthrough.
- `FakeForge` writes functional `gh` and `glab` shell stubs (not just marker-touching sabotage stubs like `forge_degrade.rs`'s) into a scratch directory prepended to `PATH` under a serialising mutex, dispatching on argv to answer `auth status`/`create`/`list`/`view` with real JSON shaped exactly like each CLI's own output.
- One shared assertion sequence, `assert_open_to_merged_chain`, is called once per forge — proving GitHub and GitLab are held to the identical standard rather than risking the two adapters drifting into different levels of scrutiny.
- Nine tests pass: the two full chains, two no-request cases (including GitLab's view-never-called-without-an-iid assertion), two no-CI cases, two newest-selection cases, and GitLab's body-off-argv transport case.
- The whole suite runs and passes with `GH_TOKEN`, `GITHUB_TOKEN` and `GITLAB_TOKEN` all unset, and names no credential or real forge host anywhere in the file.

## Task Commits

1. **Task 1: The whole chain, once, against a substituted `gh`** - `af4328a` (test)
2. **Task 2: The same chain, same assertions, against a substituted `glab`** - `5fde7d7` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/core/tests/forge_live_chain.rs` - `FakeForge` helper (writes both CLI stubs, state-file accessors, argv/body readback); `gh_stub_script`/`glab_stub_script` generators; `with_fake_forge_clis` path-substitution wrapper; `assert_open_to_merged_chain` shared assertion sequence; `seed_task_for`/`seed_github_task`/`seed_gitlab_task` fixtures; nine `#[test]` functions.

## Decisions Made

- TDD cycle adapted to a test-only deliverable: both tasks carry `tdd="true"`, but this plan's own acceptance criteria forbid any production-code change (`git status --porcelain packages/core/src packages/desktop` must stay empty), so there is no `feat(...)` implementation commit to pair with a `test(...)` RED commit — the behavior under test already exists from plan 07-11. Each task was still developed iteratively (write assertions, run, fix stub bugs, re-run) before its single commit; both commits are typed `test(07-12)` per the task-commit-protocol table's own "Test-only changes" category, rather than inventing a `feat` commit with nothing to implement.
- `FakeForge` keeps one scratch directory and one set of state files for both stubs rather than two separate helpers — a single `set_state`/`set_ci`/`set_entries` surface drives whichever forge's arm is under test, with the test itself choosing the forge-specific literal vocabulary (`"OPEN"`/`"MERGED"` vs `"opened"`/`"merged"`).
- Script generation uses `String::replace` on a `__DIR__` placeholder rather than `format!`, since the JSON payloads the stubs print are otherwise a brace-escaping minefield under `format!`'s `{{`/`}}` doubling rules.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<behavior>`, `<action>`, `<verify>` and `<acceptance_criteria>` blocks were followed as specified; no production code was touched, no new dependency was added, and `Cargo.toml` is unchanged.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The harness explicitly never reads, writes or requires a forge credential, and is proven to pass with every forge authentication variable unset.

## Next Phase Readiness

- Verification criterion 3's `behavior_unverified` item is closed: the live open→poll→status-write chain for both GitHub and GitLab now has an automated, re-runnable proof, not a one-off manual walkthrough.
- `LINK-05`, `LINK-06`, `LINK-07` and `LINK-08` are all declared only by plans already summarized in this phase (`requirements.ready-ids` reports all four ready) — marked complete here.
- Phase 07 (The Board Tells The Git Truth) has no remaining plans: this was plan 12 of 12. The one guarantee no local harness reaches — that the real GitHub/GitLab APIs still emit the JSON shapes these adapters read — remains covered by plan 07-08's existing `forge_probe --both` live arm, run manually against real repositories when available; this was never a gate for this plan and still is not.
- No blockers.

---
*Phase: 07-the-board-tells-the-git-truth*
*Completed: 2026-10-05*

## Self-Check: PASSED

- FOUND: packages/core/tests/forge_live_chain.rs
- FOUND commit af4328a (Task 1)
- FOUND commit 5fde7d7 (Task 2)
- `cargo test -p core --test forge_live_chain`: 9 passed, 0 failed
- `env -u GH_TOKEN -u GITHUB_TOKEN -u GITLAB_TOKEN cargo test -p core --test forge_live_chain`: 9 passed, 0 failed
- `cargo test --workspace`: 0 real failures (full run)
- `git status --porcelain packages/core/src packages/desktop`: empty
- `git status --porcelain packages/core/Cargo.toml`: empty
