---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-25T07:30:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/test/adapter.test.mjs
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/README.md
  - scripts/uat/uat-08-socratic-authoring.mjs
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 05: Code Review Report — G-05-5 Closure (plans 05-30, 05-31, 05-32)

**Reviewed:** 2026-09-25T07:30:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

**Supersedes** `05-REVIEW.md` (the review of the G-05-4 closure round, which found `WR-02` — the
positional claiming scan's exposure to an interleaved, non-`propose_*` tool call). That prior review
remains in git history; this file replaces it as the current review for HEAD.

## Summary

This reviews the G-05-5 gap-closure round (commits `70232b4`, `046c029`, `3228bd7`, `6eba790`,
`c35c22c` — plans 05-30/05-31/05-32), which replaces `correlateProposeAttempts`'s positional
claiming scan with an exact lookup on the Anthropic wire's own `tool_use.id` /
`tool_result.tool_use_id` correlation, carried end-to-end through `adapter.ts`'s `ToolCallEvent`/
`ToolResultEvent` and `claude-code-adapter.ts`'s `normaliseStreamEvent`.

**The fix is correct, and the prior round's WR-02 is genuinely closed.** I traced the id-carry at
the adapter seam by hand, then verified it empirically rather than by inspection alone:

- Built the package (`npm run build` in `packages/sidecar`) — clean, no type errors.
- Ran `packages/sidecar/test/adapter.test.mjs` in full — 25/25 pass, including all eight new
  `toolUseId` round-trip/absence/neighbouring-field tests.
- Ran `scripts/uat/uat-08-socratic-authoring.mjs --self-test` — all checks pass, including the six
  new Plan 05-31 "Check A"–"Check F" cases that assert the shipped id-based reading against the
  frozen positional control side by side.
- **Mutation-tested both layers** to confirm the test battery has real teeth, not vacuous coverage:
  - Removed the `toolUseId` conditional-spread from `normaliseStreamEvent`'s `tool_call` branch in
    `claude-code-adapter.ts` — `adapter.test.mjs` immediately reports 2 failures (23/25 pass).
  - Commented out the `uncorrelatable` early-return in `readNoWorkPlanned`
    (`uat-08-socratic-authoring.mjs`) — `--self-test` immediately reports 2 failures (Check E,
    Check F).
  - Both mutations were reverted; the working tree is clean of my own edits afterward.
- Confirmed the false-fail direction WR-02 flagged (an unrelated read's non-refusing result masking
  a propose attempt's genuine refusal) is now covered by Plan 05-31's "Check B", which the prior
  review's own repro shape maps directly onto, and passes correctly under the new id-based pairing.

I did not find a defect in `normaliseStreamEvent`'s new correlation-id carry, in
`correlateProposeAttempts`'s rewritten exact-lookup pairing, or in the `uncorrelatable` fail-closed
gating (`PASSING_NO_WORK_READINGS`). The one frozen negative control
(`correlateProposeAttemptsPositionally`) is correctly unreferenced from the live body, and round 6's
now-superseded frozen control is confirmed fully deleted, not merely unreferenced.

One documentation-accuracy issue is flagged below: `scripts/uat/README.md`'s own scenario catalogue
now describes a live behavior that this round's own code change removed.

## Warnings

### WR-01: `README.md`'s `back-to-back-proposals` bullet describes a comparison this round's own diff deleted from that scenario

**File:** `scripts/uat/README.md:227-230`
**Issue:** The bullet reads:

> `back-to-back-proposals` — two propose calls issued back-to-back inside the challenge stage and
> answered by two distinct unnamed results, the first refusing and the second not, proving the
> reading is `violated` **and that the correlation as it shipped on 2026-09-24 still reads `refused`
> over the same run**.

The bolded clause describes a side-by-side comparison against the pre-claiming ("as it shipped on
2026-09-24") algorithm. That comparison genuinely existed in the `back-to-back-proposals` branch of
`runReplayCheckScenario` before this round — but this round's own commit explicitly retired it:

```js
// Plan 05-30 (G-05-5 closure): the round-6 side-by-side comparison against the pre-claiming
// algorithm that used to live here is retired — the property it guarded is subsumed by the id
// lookup — and the file's one remaining frozen control (`correlateProposeAttemptsPositionally`)
// is exercised offline in `--self-test`, not against this live-driven fixture.
```

Confirmed by direct inspection of `runReplayCheckScenario`'s current `back-to-back-proposals`
branch (`uat-08-socratic-authoring.mjs:3466-3540`): it computes `claimedReading` and asserts
`"violated"`, but no longer computes or asserts a `preClaimingReading` value anywhere in that
branch. Also confirmed by grep: `readNoWorkPlannedWithoutClaiming` (the "as it shipped on
2026-09-24" algorithm the bullet's clause refers to) no longer exists anywhere in the file as a
callable function — only as historical prose. The bullet is describing behavior this round itself
removed, in the same file this round edited two paragraphs earlier in the same list to bump the
scenario count from seven to ten.
**Why it matters:** This README is the operator-facing narrative of what `--replay-check` proves per
scenario (its own stated purpose: "each proving one thing the live arm would otherwise be the only
way to check"). A reader relying on this bullet to know what `back-to-back-proposals` currently
exercises would believe it still cross-checks against the frozen pre-claiming algorithm; it does
not — that cross-check now lives only in `--self-test`'s own dedicated Plan 05-31 checks, over
different (interleaved-read and id-less) fixtures, not over the `back-to-back-proposals` replay
scenario at all.
**Fix:** Update the bullet to describe what the scenario now actually proves — e.g.:

```md
  - `back-to-back-proposals` — two propose calls issued back-to-back inside the challenge stage and
    answered by two distinct results (each carrying its own correlation id), the first refusing and
    the second not, proving the id-based pairing keeps the two attempts' answers distinct and reads
    `violated`. (The retired positional algorithm's own vacuous `refused` reading over this same
    shape is exercised offline instead, in `--self-test`'s `correlateProposeAttemptsPositionally`
    checks, not against this live-driven scenario.)
```

## Info

### IN-01: `correlateProposeAttempts`'s answer lookup does a `.has()` then a separate `.get()` where one call would do

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:2841`
**Issue:** Minor style nit, not a correctness issue — every value ever stored in `resultIndexById`
is a valid non-negative array index (never `undefined`), so the two-call idiom:

```js
const answerIndex = resultIndexById.has(attempt.toolUseId) ? resultIndexById.get(attempt.toolUseId) : null;
```

can be one call:

```js
const found = resultIndexById.get(attempt.toolUseId);
const answerIndex = found !== undefined ? found : null;
```

**Fix:** Optional simplification; no behavioral difference. Not worth a dedicated round, but flagging
since it's touched by this closure's own rewrite.

---

_Reviewed: 2026-09-25T07:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
