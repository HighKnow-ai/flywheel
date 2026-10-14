---
phase: 08-review-and-merge-inside-flywheel
plan: 14
subsystem: review
tags: [forge, sha2, tauri-ipc, react, tdd, gap-closure]
gap_closure: true
gap_ids: [G-08-5]

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "forge_epic_request_draft / forge_open_epic_request / EpicRequestSheet (plan 08-08), category-only IPC errors (plan 08-12)"
provides:
  - "RequestDraft::content_hash(): SHA-256 over title, newline, body, 64 lowercase hex"
  - "RequestDraftDto.contentHash on both the epic and the task preview"
  - "forge_open_epic_request(epic_id, content_hash) refuses with the bare category draftChanged before any push"
  - "EpicRequestSheet answers a draftChanged refusal by refetching and showing the current text with a notice"
affects: [08-15, forge_open_request task-request guard follow-up]

actuals:
  tokens: 5900
  tasks: 3
  commits: 3
plan_head_before: 71ba1142c95228aa411dd97e7e1a91927057e556
commits: 3

tech-stack:
  added: ["sha2 0.10 (direct dependency of packages/core; 0.10.9 already resolved in Cargo.lock)"]
  patterns:
    - "Change-detector digest computed in the core only, echoed opaquely by the renderer; the renderer supplies no title, body, branch or target"
    - "A refused confirm is a re-render, not a failure: the refused hash is held as state and the notice derives from the refetched hash differing"

key-files:
  created: []
  modified:
    - packages/core/Cargo.toml
    - Cargo.lock
    - packages/core/src/forge/request_body.rs
    - packages/core/tests/epic_request_draft.rs
    - packages/desktop/src-tauri/src/commands/forge.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/review/EpicRequestSheet.tsx
    - packages/desktop/src/review/__tests__/epic-request.test.tsx
    - packages/desktop/src/review/__tests__/browser/review-fixture.ts
    - packages/desktop/src/review/__tests__/keyboard-activation.test.tsx
    - packages/desktop/src/item-detail/__tests__/forge-section.test.tsx

key-decisions:
  - "SHA-256 via sha2 0.10, not text equality over IPC and not DefaultHasher: keeps the renderer unable to influence published text, honours the WR-08/UAT wording, costs no new package"
  - "The notice is derived from the refused hash (shown while the refetched draft hash differs from it) rather than a boolean cleared on every hash change"
  - "forge_open_request (task request) deliberately NOT guarded here; follow-up recorded"

patterns-established:
  - "draftChanged is a bare category: both digests and the epic id go to the host eprintln! log only"

requirements-completed: [REVW-05]

coverage:
  - id: D1
    description: "A confirm whose draft changed since the preview pushes nothing and returns the bare draftChanged category; the signature still takes no title, body, branch or target"
    requirement: REVW-05
    verification:
      - kind: other
        ref: "cargo build --workspace (signature, ordering of the mismatch Err before open_epic_request_at checked by source inspection)"
        status: pass
    human_judgment: true
    rationale: "The refusal path inside forge_open_epic_request needs a live forge CLI and a real epic to execute end to end; it is covered by compile and source-order checks and by the component test of the sheet's reaction, not by a Rust test of the command itself"
  - id: D2
    description: "The digest is stable on an unchanged board, moves on a checked criterion and on a title change, is 64 lowercase hex, and the title/body boundary cannot be forged"
    requirement: REVW-05
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_request_draft.rs#content_hash_*"
        status: pass
    human_judgment: false
  - id: D3
    description: "A draftChanged rejection re-renders the current text with a notice, raises no alert, keeps the Open-request button live, and the next confirm carries the new hash; every other category still alerts and does not refetch"
    requirement: REVW-05
    verification:
      - kind: unit
        ref: "packages/desktop/src/review/__tests__/epic-request.test.tsx#a draftChanged rejection re-renders the current text with a notice instead of an alert, and the next confirm carries the new hash"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/review/__tests__/epic-request.test.tsx#any other rejection category still alerts and does not re-fetch the draft"
        status: pass
    human_judgment: false
  - id: D4
    description: "Declaring sha2 adds no package to the resolved tree"
    verification:
      - kind: other
        ref: "grep -c '^\\[\\[package\\]\\]' Cargo.lock = 572 before and after; git diff BASE..HEAD -- Cargo.lock has no '^+name = ' line"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-10-07
status: complete
---

# Phase 8 Plan 14: Epic request content-hash guard Summary

**SHA-256 content hash computed in the core and required by the epic request confirm, which refuses with the bare `draftChanged` category before any push; the sheet answers by re-fetching and showing the current text with a notice. No package added to the lockfile.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-10-07T05:52:52Z
- **Completed:** 2026-10-07T06:23:16Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- `RequestDraft::content_hash()` is the one place the digest is computed. `RequestDraftDto.contentHash` rides on the preview, and `forge_open_epic_request` takes it as a third parameter, re-assembles the draft itself, and returns `Err("draftChanged")` before `open_epic_request_at` when the two differ. Digests and epic id go to `eprintln!` only.
- The sheet echoes the hash unmodified. On `draftChanged` it sets no failure, refetches through the existing `useEpicRequestDraft` query, and renders one `type-label` line saying the board changed and the text below is current. Cancel and Open request stay live.
- Five core tests prove the digest is a real change detector against a real board; two component tests prove the refusal path and that real failure categories still alert.

## Cargo.lock package count

`grep -c '^\[\[package\]\]' Cargo.lock`: **572 before, 572 after.** `git diff $BASE..HEAD -- Cargo.lock` is a single added edge, `"sha2 0.10.9"` in `core`'s dependency list; `grep '^+name = '` over the diff finds nothing. `sha2 0.10.9` was already in the tree (a second `sha2 0.11.0` is also present and unaffected).

## Task Commits

1. **Task 1: hash in the core, refused at the confirm, whole path** (tracer) - `484b76a` (feat)
2. **Task 2: digest is a real change detector** - `68a3efd` (test)
3. **Task 3: refused confirm re-renders instead of alerting** - `57f7846` (test)

**Plan metadata:** committed separately (docs: complete plan)

Tracer gate: interactive run, `end-of-phase`, automated-only `<verify>`. Re-ran build, `epic_request_draft` and `tsc` after Task 1; all passed. Tracer verified end-to-end, then expanded.

## Files Created/Modified

- `packages/core/src/forge/request_body.rs` - `impl RequestDraft { content_hash }`
- `packages/core/Cargo.toml`, `Cargo.lock` - `sha2 = "0.10"` with reasoning comment; one lock edge
- `packages/core/tests/epic_request_draft.rs` - 5 new `content_hash_*` tests (17 -> 22 in the binary)
- `packages/desktop/src-tauri/src/commands/forge.rs` - `content_hash` on the DTO, third parameter and pre-push refusal on the command
- `packages/desktop/src/adapters/tauri.ts` - `contentHash` on the DTO, `forgeOpenEpicRequest(epicId, contentHash)`
- `packages/desktop/src/review/EpicRequestSheet.tsx` - hash echo, `draftChanged` branch, notice
- `packages/desktop/src/review/__tests__/epic-request.test.tsx` - updated confirm assertion, 2 new `it`s (31 -> 33)
- `packages/desktop/src/review/__tests__/browser/review-fixture.ts` - `READY_DRAFT.draft.contentHash` for plan 08-15
- `packages/desktop/src/review/__tests__/keyboard-activation.test.tsx`, `item-detail/__tests__/forge-section.test.tsx` - fixtures carry the new field

## Decisions Made

- Kept to the plan's SHA-256 over title, newline, body. Branches are deliberately not hashed.
- The notice state is the refused hash, not a boolean (see deviation 2).
- `forge_open_request` (Phase 7 task request) is untouched. **Follow-up: apply the same `draftChanged` guard to `forge_open_request`.** `content_hash()` and `RequestDraftDto.contentHash` already serve it, so adoption is a signature parameter and a two-line comparison.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixtures and a sibling test needed the new required field**
- **Found during:** Task 1 (`tsc --noEmit`) and the full jsdom run after Task 3
- **Issue:** `contentHash` is required on `RequestDraftDto`, so four test fixtures stopped type-checking (`forge-section.test.tsx`, `review-fixture.ts`, `epic-request.test.tsx`, `keyboard-activation.test.tsx`), and `keyboard-activation.test.tsx` asserted the old one-argument confirm call. Two of these files are outside the plan's `files_modified`.
- **Fix:** Added a `contentHash` to each fixture in the Task 1 commit so `tsc` stays at its pre-existing baseline; updated the keyboard-activation confirm assertion in the Task 3 commit.
- **Files modified:** the four test files above
- **Verification:** `npm --prefix packages/desktop test`: 51 files, 767 tests pass. `tsc` reports only the pre-existing errors.
- **Committed in:** `484b76a`, `57f7846`

**2. [Rule 1 - Plan inconsistency] Stale-notice state cannot be "a boolean cleared whenever `contentHash` changes"**
- **Found during:** Task 1
- **Issue:** The plan asks for a boolean set on `draftChanged`, a notice shown once the preview re-resolves, and the boolean cleared whenever `draft.contentHash` changes. A refetch that resolves with new text changes the hash, so the notice would vanish the instant it could appear, and the Task 3 assertion that the notice is on screen could never hold.
- **Fix:** State holds the refused hash. The notice renders while the current draft's hash differs from it, so it appears exactly when the re-fetched text is on screen.
- **Files modified:** `packages/desktop/src/review/EpicRequestSheet.tsx`
- **Verification:** the changed-draft component test asserts the notice and the refetched body together.
- **Committed in:** `484b76a`

**3. [Rule 1 - Plan inaccuracy] The title-only mutation does not turn the boundary test red**
- **Found during:** Task 2 mutation check
- **Issue:** The plan says changing `content_hash` to hash only `title` must turn both the criterion-check and the boundary test red. The boundary fixture's two titles differ, so a title-only hash still tells them apart.
- **Fix:** Ran two mutations. Title-only: `content_hash_moves_when_a_criterion_is_checked` fails, the other four pass. No newline separator: `content_hash_distinguishes_where_the_title_ends_and_the_body_begins` fails, the other four pass. The file was restored after each and `git diff` is clean.
- **Committed in:** n/a, verification only

---

**Total deviations:** 3 (1 blocking fixture, 2 plan inconsistencies)
**Impact on plan:** no scope creep. The two plan inconsistencies change how a criterion is verified, not what ships.

## TDD Gate Compliance

Tasks 2 and 3 carry `tdd="true"`, but the plan's tracer ordering puts the implementation (Task 1, `feat`) before the tests, so there is no failing-first `test(...)` commit for them. This is the plan's design, not a missed step. RED was shown by mutation instead, with the failing tests captured above:

- Task 2: title-only mutation and no-separator mutation each turned the relevant test red (deviation 3), then reverted.
- Task 3: forcing the `.catch` to treat every category as a failure turned `a draftChanged rejection re-renders...` red (1 failed, 32 passed), then reverted. The old one-argument confirm assertion also failed (1 failed, 30 passed) between the Task 1 and Task 3 commits, which is why that interval is not a green commit.

`check tdd-red-evidence` was not run: there is no pre-implementation target-test failure to record.

## Issues Encountered

- `cargo test --workspace` stops at the first failing binary. `credentials::resolve_credential_falls_back_to_the_global_default_without_a_project_override` fails because this machine's keychain already holds an API key (environmental, unrelated to this plan). Logged in `deferred-items.md`. Re-ran with `--no-fail-fast` skipping that one test: exit 0, no `FAILED` line anywhere, including `epic_request_draft` (22 pass) and `supervisor_cwd` (5 pass).
- `tsc --noEmit` reports 3 pre-existing `RegExp` errors, not the 2 the plan states. Unchanged by this plan.
- The plan's `@tauri-apps/api` criterion says one path; `grep -rl` lists three. `settings-surface.test.tsx` and `permission-card.test.tsx` are pre-existing test files that mock it. Non-test source imports it only in `adapters/tauri.ts`.
- The worktree's branch is `cymarechal-devoteam/gsd-new-project-ade`, not an `agent-*` branch. This was dispatched as a sequential executor on the main tree, so the per-agent-branch allow-list was not applied; the protected-branch check returned `false`.

## Known Stubs

None.

## Threat Flags

None. The only new IPC value is the opaque digest, which can cause a refusal and never a substitution.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 08-15's keyboard spec can assert the hash crosses: `READY_DRAFT.draft.contentHash` is a fixed 64-hex literal.
- Open follow-up: the `draftChanged` guard on `forge_open_request`.

## Self-Check: PASSED

- All 11 modified files exist; `484b76a`, `68a3efd`, `57f7846` found in `git log`.
- `content_hash` declared on `RequestDraft`; `content_hash: String` is on the DTO and on the command; the mismatch `return Err("draftChanged".to_string())` sits before `open_epic_request_at`.
- `Cargo.lock` package count 572 before and after; no `+name = ` line in the diff.

---
*Phase: 08-review-and-merge-inside-flywheel*
*Completed: 2026-10-07*
