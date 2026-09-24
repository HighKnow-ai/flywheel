---
phase: 05-socratic-epic-authoring
plan: 24
subsystem: testing
tags: [uat, socratic-authoring, instrument-hardening, gap-closure, backend-refusal, transcript-duplication]

requires:
  - phase: 05-socratic-epic-authoring (plans 05-20, 05-21, 05-22, 05-23)
    provides: the fixed capture instrument (whole-turn capture, the conversation driver, the
      window-bounded noWorkPlanned reading) and the honest record of the one authorised live run
      (01M399FP80B184QM2RXTXJDZTK) that this run's own turn 5 — an Anthropic API-level refusal
      silently captured as agent text — diagnosed as a fourth, new instrument-failure mechanism
provides:
  - "readBackendRefusal(text), BACKEND_REFUSAL_KIND, BACKEND_REFUSAL_PREFIX (scripts/uat/lib/sidecar-harness.mjs) — a pure, position-anchored reader that names an Anthropic API-level safety-classifier refusal as a distinct failure class, never a substring match"
  - "a refusal member riding through accumulateTurn/waitForTurn/driveChallengeConversation on every resolution path, null (never undefined) when not refused"
  - "driveChallengeConversation stops immediately at a refused turn — reports it, settles false, sends no further developer turn — never discarding the turns already captured"
  - "the live body fails fast at both places a refusal can land (after the driver returns; around the distillation capture, the place the real run actually died), writing the evidence sheet with whatever was captured before raising a named error, never advancing the stage"
  - "a backend-refuses-mid-conversation --replay-check scenario proving all of the above offline, against the real sidecar, for zero tokens — including that a refused conversation never reaches advance-stage"
  - "buildEvidenceExchanges({ openingPrompt, conversation }) — the ONE shared transcript-assembly path both the live body and the replay branch now consume, closing NF-01 (the live body's own accidental double-capture of its first turn)"
  - "a Refusal column on the capture-integrity table and an optional '## Backend refusal' section rendered above the verdict section, naming the class/classifier/request id, omitted entirely (byte-identical output) when no refusal occurred"
affects: [any-future-live-uat-08-run, phase-06-agent-authored-backlog]

actuals:
  tokens: 15200
  tasks: 2
  commits: 3
plan_head_before: add5e178d62e16d880696ec69bc89fba011f2659

tech-stack:
  added: []
  patterns:
    - "A backend-level error rendered by a CLI on the SAME event shape a genuine reply uses (assistant_text + a clean result marker) is detected by reading the text itself, anchored at the START of the text — never a substring match anywhere in it — because that position anchor is what keeps a false-positive (which aborts a real, in-progress, credential-spending run) at zero."
    - "A failed capture reports what it DID capture rather than discarding it — a detected refusal stops the loop and fails the run, but the evidence sheet is written first, with every turn captured before the refusal preserved verbatim."
    - "One pure assembly function, called by both the live arm and every offline replay scenario, so an assembly defect cannot exist in the live arm alone while the offline arm stays green — this is what let NF-01 (a live-body-only duplicate capture) go uncaught until this plan's own review pass read the transcript against the code."

key-files:
  created: []
  modified:
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "readBackendRefusal anchors BACKEND_REFUSAL_PREFIX ('API Error:') at the START of a turn's trimmed text, never as a substring anywhere in it — the false-positive checks (ordinary prose discussing an error, empty, whitespace) were written and passed BEFORE the positive ones, matching the plan's own stated cost asymmetry (a false positive aborts a genuine run and spends its credentials; a false negative merely reproduces the exact defect this plan closes)."
  - "classifier and requestId are undefined (never empty-string impostors) when their respective lines are absent from the refusal text — neither is required for classification, since a future refusal of this family may carry neither."
  - "driveChallengeConversation returns rather than throws on a detected refusal, per this phase's own standing discipline that a failed capture reports what it DID capture; the live body is the layer that converts a reported refusal into a thrown, named error, after writing the evidence sheet."
  - "The live body's distillation-capture refusal check runs OUTSIDE the try/catch that already exists there for a genuine TIMEOUT — a refusal is a SUCCESSFUL capture (the turn ends cleanly on `result`), so checking it inside the catch would let a real refusal be silently reclassified as a timeout and fall through into the 120s proposal wait this plan exists to prevent entering."
  - "backend-refuses-mid-conversation's 'stage is still challenge' assertion reads through the existing, unmodified, read-only `recent-authoring-runs` bridge subcommand (which already honours FLYWHEEL_APP_DATA_DIR via `default_db_path()`) rather than adding a new subcommand to `uat_authoring_ops.rs` — the plan's own flagged prohibition forbids touching any file under `packages/` to make an instrument assertion pass, and this existing subcommand already reads the scratch database when the harness's own env override is set."
  - "buildEvidenceExchanges is the replay branch's OWN pre-existing, already-correct assembly shape, generalised into a shared function — not a new design. The live body's standalone first-turn capture (the actual NF-01 defect) is deleted outright rather than reconciled with the new function, since driveChallengeConversation, seeded with the identical cursor, already captures that same turn as its own first exchange."
  - "The 'strictly increasing end index' regression check is written to call the NOT-YET-EXISTING buildEvidenceExchanges FIRST and confirmed FAILING (ReferenceError) before the function was implemented — genuine TDD RED, not a hypothetical description of the bug. A companion check proves the pre-fix mechanism itself (a standalone capture, then the driver seeded with the same cursor) produces two byte-identical, same-end-index agent entries — the evidence the duplication was real, not merely inferred from the transcript."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "A backend-level Anthropic safety-classifier refusal — the mechanism that killed this phase's only authorised live run — is now a named, self-describing failure class (readBackendRefusal/BACKEND_REFUSAL_KIND) that stops driveChallengeConversation immediately and fails the live run fast at both places a refusal can land, without discarding captured turns and without advancing the stage. Proven offline, for zero tokens, against the real sidecar and the real watchdog."
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario backend-refuses-mid-conversation"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (6/6 scenarios)"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (68 PASS, 0 FAIL — up from 52)"
        status: pass
      - kind: other
        ref: "node -e checks confirming readBackendRefusal/BACKEND_REFUSAL_KIND/BACKEND_REFUSAL_PREFIX exports and the 6-scenario SCENARIOS set"
        status: pass
    human_judgment: false
  - id: D2
    description: "The transcript a human judges records the conversation exactly once — buildEvidenceExchanges is the one shared assembly path both the live body and every replay scenario use, closing NF-01 (the live body's own accidental double-capture of its seed turn, which made 05-LIVE-CHALLENGE-TRANSCRIPT.md's turns 2 and 3 byte-identical). A refused run's evidence sheet names itself as incomplete immediately above the verdict section."
    requirement: "SHAPE-03"
    verification:
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test — the NF-01 regression check (RED-confirmed before buildEvidenceExchanges existed), the exactly-one-waitForTurn source-scanning check, the refusal-column/section presence-and-ordering checks, the zero-exchange edge case"
        status: pass
      - kind: other
        ref: "test \"$(awk '/^await runScript\\(/{f=1} f' scripts/uat/uat-08-socratic-authoring.mjs | grep -vE '^[[:space:]]*(//|\\*|/\\*)' | grep -c 'waitForTurn(')\" = \"1\""
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: false

duration: ~25 min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 24: Backend Refusal Names Itself, and the Transcript Is Recorded Exactly Once Summary

**A named `readBackendRefusal` reader stops the run at an Anthropic safety-classifier refusal instead of quietly waiting out the proposal deadline, and a single `buildEvidenceExchanges` function closes the live body's own accidental duplicate-turn capture (NF-01) — both proven offline for zero tokens.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-24 (context load + implementation)
- **Completed:** 2026-09-24T11:22:40Z (GREEN commit)
- **Tasks:** 2 (Task 1: tracer/tdd; Task 2: auto/tdd)
- **Files modified:** 3 (`scripts/uat/lib/sidecar-harness.mjs`, `scripts/uat/lib/fake-authoring-claude.mjs`, `scripts/uat/uat-08-socratic-authoring.mjs`)

## Accomplishments

- **The fourth failure class is named and self-describing.** `readBackendRefusal(text)` (new, `scripts/uat/lib/sidecar-harness.mjs`) reads a turn's whole accumulated text for the exact two-word banner (`BACKEND_REFUSAL_PREFIX = "API Error:"`) Anthropic's own API-level safety-classifier refusal opens with when the `claude` CLI renders it on the SAME event shape a genuine reply uses — an `assistant_text` chunk followed by a clean `result` marker. Anchored at the START of the trimmed text, never a substring match anywhere in it, so ordinary prose that merely discusses an error is never misread as a refusal. Returns `{ kind: BACKEND_REFUSAL_KIND, classifier, requestId, text }` — `classifier` reported verbatim even for a code never seen before, `requestId` genuinely `undefined` (never an empty-string impostor) when absent, `text` the refusal verbatim.
- **The refusal reading rides through every existing consumer with no second copy of the logic.** `accumulateTurn` computes `refusal: readBackendRefusal(text)` on both of its return paths (result-terminated and fall-through), so `SidecarClient.waitForTurn` inherits it on every resolution path — result, idle, and the partial reconstruction inside its own timeout message. `null`, never `undefined`, on a non-refused turn.
- **`driveChallengeConversation` stops at the refusal, immediately.** After each agent turn is captured and pushed onto its own exchange record, a refusal member set on that turn breaks the loop before `extractOpenQuestions` runs and before any developer turn is composed or sent — reporting the refusal on the function's own return, settling `false`, and never discarding the turns already captured (the phase's own standing discipline).
- **The live body fails fast at BOTH places a refusal can land.** Immediately after the driver returns: a reported refusal writes the evidence sheet with whatever was captured so far, then throws a named error (class, classifier, request id) — never advancing the stage. Around the distillation capture — the place the real run actually died — the refusal check runs deliberately OUTSIDE the existing timeout `try`/`catch`, so a successful-but-refused capture can never be silently reclassified as a timeout and fall through into the 120-second proposal wait; the existing timeout-handling catch branch is untouched.
- **Proven offline, for zero tokens, against the real sidecar.** A new `backend-refuses-mid-conversation` fixture (`scripts/uat/lib/fake-authoring-claude.mjs`) reproduces turn 5 of `05-LIVE-CHALLENGE-TRANSCRIPT.md` verbatim as its second scripted turn; the matching `--replay-check` arm confirms the driver stops with `settled=false`, exactly one developer turn sent, the refused turn preserved verbatim in the exchange record, and — critically — that `advance-stage` is never reached, verified through the existing, unmodified, read-only `recent-authoring-runs` bridge subcommand (no `packages/` file touched).
- **NF-01 closed: the transcript now records one conversation, once.** New `buildEvidenceExchanges({ openingPrompt, conversation })` is the ONE assembly path both the live body and every replay scenario now use — the opening developer prompt, then the driver's own exchanges verbatim. The live body's standalone first-turn capture (a second `waitForTurn` call seeded with the SAME cursor `driveChallengeConversation` was already using) is deleted outright; it was capturing the identical turn twice, which is exactly what made `05-LIVE-CHALLENGE-TRANSCRIPT.md`'s own turns 2 and 3 byte-identical. The live body now holds exactly ONE `waitForTurn(` call site (the distillation capture), pinned by a source-scanning self-test check.
- **A refused run says so on its face.** `renderChallengeEvidenceSheet` gained a Refusal column (classifier code per refused agent turn, an em-dash placeholder for every other) and an optional `## Backend refusal` section rendered immediately ABOVE the verdict section — naming the class, classifier and request id and stating plainly the run did not complete — while leaving the verdict lines fillable (the turns captured before the refusal are real model turns a human may legitimately judge). Omitted entirely, byte-identical to before, when no refusal occurred.
- **Final state:** `--self-test` reports 68 PASS / 0 FAIL (up from 52); `--replay-check` reports `✅ PASS` for all six scenarios (five pre-existing plus `backend-refuses-mid-conversation`); `--board-read-check` exits 0; `git diff --quiet -- packages/` clean throughout — no product file touched.

## Task Commits

1. **Task 1: A backend refusal names itself as the fourth failure class and stops the run where it happens** — `adea411` (test)
2. **Task 2, RED: prove NF-01's live-body turn duplication is real, and pin `buildEvidenceExchanges` before it exists** — `662b2c0` (test)
3. **Task 2, GREEN: one shared transcript-assembly path, and a refused run says so on its face** — `b720765` (feat)

**Plan metadata:** this SUMMARY's own commit (pending)

_Note: Task 1 carried `type="tracer" tdd="true"` and Task 2 carried `type="auto" tdd="true"`. Task 1 landed implementation and tests together in one commit (the plan's own instruction for Task 1 was "write the false-positive checks before the positive ones," about ORDERING within the test suite, not a mandated RED/GREEN commit split). Task 2's plan text explicitly instructed writing and confirming-failing the strictly-increasing-end-index check FIRST, so it follows genuine RED → GREEN across two commits — no REFACTOR commit was needed._

## Files Created/Modified

- `scripts/uat/lib/sidecar-harness.mjs` — `readBackendRefusal`, `BACKEND_REFUSAL_KIND`, `BACKEND_REFUSAL_PREFIX`; `accumulateTurn`'s new `refusal` member on both return paths
- `scripts/uat/lib/fake-authoring-claude.mjs` — the new `backend-refuses-mid-conversation` `SCENARIOS` fixture (6 keys total)
- `scripts/uat/uat-08-socratic-authoring.mjs` — `driveChallengeConversation`'s refusal-triggered early return; the live body's two refusal fail-fast sites; the `backend-refuses-mid-conversation` replay-check branch (guarding the shared `advance-stage` call, asserting the stage is still `challenge` via `recent-authoring-runs`); `buildEvidenceExchanges`; the live body's deleted standalone first-turn capture; `renderChallengeEvidenceSheet`'s Refusal column and `## Backend refusal` section; 16 new self-test checks

## Decisions Made

See `key-decisions` in the frontmatter. Summarizing the two load-bearing ones: (1) the refusal detection is deliberately position-anchored and false-positive-checked first, because a false positive here aborts a genuine, credential-spending run — a strictly worse outcome than the false negative this whole plan closes; (2) the live body's distillation-refusal check runs OUTSIDE its pre-existing timeout `try`/`catch`, because a refusal is a *successful* capture (the turn ends on a clean `result`) and checking it inside the catch would silently reclassify it as a timeout, letting the run fall through into the exact 120-second wait this plan exists to prevent entering.

## Deviations from Plan

None from the plan's own text or its four flagged prohibitions — all four were honored:

- **Did not broaden refusal detection until ordinary prose false-positives.** `BACKEND_REFUSAL_PREFIX` is matched only at the START of a trimmed turn's text; the false-positive self-test checks (ordinary prose discussing an error/API/safeguard, empty, whitespace-only) were written and confirmed passing before the positive checks.
- **Did not discard turns already captured on a refusal.** Both live-body fail-fast sites write the evidence sheet — with `buildEvidenceExchanges`'s own assembled list — BEFORE throwing.
- **Did not let a refused, incomplete run present as judgeable.** The `## Backend refusal` section renders immediately above the verdict section, naming the class/classifier/request id and stating plainly the run did not complete.
- **Did not touch `packages/`.** `git diff --quiet -- packages/` was asserted clean after every task. The `backend-refuses-mid-conversation` replay scenario's "still in the challenge stage" assertion reads through the existing, unmodified, read-only `recent-authoring-runs` bridge subcommand instead of adding a new one.

### Unplanned incident (recovered, not a code deviation)

**An ad hoc exploratory check I ran outside this plan's own verify commands briefly triggered the live arm.** After Task 2 landed, I ran a bare `node -e 'import("./scripts/uat/uat-08-socratic-authoring.mjs")'` to sanity-check the module loads cleanly — this is NOT one of the script's documented arms (`--self-test`, `--replay-check`, `--board-read-check`); with no flag, the file falls through to its live `runScript` block. The local `claude` CLI on this machine is not authenticated, so the "session" it drove was a zero-cost, single-turn "Not logged in · Please run /login" exchange — no credentials were spent — but it did overwrite `.planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md` (the real evidence sheet from plan 05-22's authorised run) before I killed the process. Restored via `git checkout --` immediately, confirmed clean (`git status --short` on the file shows no diff, matching commit `b16b3c5`), and confirmed no orphaned sidecar/`claude` process was left running. Recorded here for the record; no code or evidence-file change resulted.

---

**Total deviations:** 0 code deviations. 1 recovered operator incident (documented above), no residual effect.
**Impact on plan:** None — the plan's own scope, prohibitions and evidence file are all intact.

## Issues Encountered

The unplanned incident above is the only issue this session hit; it is fully recovered with no residual effect (see "Unplanned incident" above).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The instrument no longer has a known way to misread an Anthropic API-level refusal as ordinary agent text, and the evidence sheet it produces can no longer duplicate a turn. Both properties are proven offline, for zero tokens, against the real sidecar — no live credential was spent by this plan.
- The next authorised live `uat-08` run is the first one that can trust BOTH: (a) it will fail loudly, naming itself, at the exact moment of a backend refusal rather than dying quietly at the 120-second proposal deadline; and (b) the transcript it leaves behind records the real conversation exactly once, with no instrument-introduced duplication.
- SHAPE-01's dialogue-quality verdict and SHAPE-03's draft-usefulness verdict in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remain, by this plan's own explicit design, `UNJUDGED` — this plan spent nothing and filled no verdict line. Whether and when to spend another authorised live run is a decision for a future plan, exactly as `05-22-PLAN.md`'s own gate established.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `scripts/uat/lib/sidecar-harness.mjs`
- FOUND: `scripts/uat/lib/fake-authoring-claude.mjs`
- FOUND: `scripts/uat/uat-08-socratic-authoring.mjs`
- FOUND: commit `adea411` (Task 1)
- FOUND: commit `662b2c0` (Task 2 RED)
- FOUND: commit `b720765` (Task 2 GREEN)
- Plan-level `<verification>` re-run: `--replay-check` 6/6 PASS (including `backend-refuses-mid-conversation`), `--self-test` 68 PASS / 0 FAIL, `--board-read-check` exit 0, exactly one `waitForTurn(` call site in the live body (awk-scoped, comment-excluded count = 1), `git diff --quiet -- packages/` clean — all pass.
- Confirmed `.planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md` unchanged from commit `b16b3c5` (plan 05-22's authorised live run) — `git status --short` on the file shows no diff.
