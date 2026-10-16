---
created: 2026-10-05T16:32:00.000Z
title: Live-chain tests inconsistently assert that the fake CLI was actually reached
area: core
severity: trivial
files:
  - packages/core/tests/forge_live_chain.rs:929-933
  - packages/core/tests/forge_live_chain.rs:994-1158
source: phase-07 gap-closure code review (07-REVIEW.md, LOW-01)
---

## Problem

`assert_open_to_merged_chain` — the shared helper both full-chain tests call — asserts
`fake.invoked()` before trusting any result. The guard exists for a stated reason: if the
PATH substitution ever failed, the test would silently exercise a real `gh`/`glab` on the
developer's machine instead of the harness's stub, and a harness that can pass without
reaching its own fake proves nothing.

Several standalone tests in the same file exercise `request_for_branch_at` directly and
assert on its result without that guard, including
`github_branch_with_no_request_yields_no_request_and_no_transition`,
`github_request_with_no_ci_run_normalises_to_no_ci_result` and
`gitlab_request_with_no_head_pipeline_normalises_to_no_ci_result`.

In practice a real `gh`/`glab` run against the scratch repo these tests seed — no real
forge-side request, and an explicit `forge` override forcing a CLI call — would very likely
fail loudly on its own (no repo context, not authenticated) and still fail the test through
its `.expect(...)` calls. So a false pass is unlikely. The issue is that the file enforces
its own "never silently trust a real CLI" guarantee unevenly, which invites someone to copy
the weaker pattern into a future test where it does matter.

## Fix

Add `assert!(fake.invoked(), ...)` to the remaining standalone tests, matching
`assert_open_to_merged_chain`'s own safety rationale. Better still, route the assertion into
a small helper so the guard cannot be omitted by a new test.
