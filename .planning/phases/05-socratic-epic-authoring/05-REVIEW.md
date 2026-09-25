---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-25T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - scripts/uat/uat-08-socratic-authoring.mjs
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/README.md
  - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
  - .planning/REQUIREMENTS.md
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 05: Code Review Report — G-05-4 Closure (plans 05-27, 05-28, 05-29)

**Reviewed:** 2026-09-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

**Supersedes** `05-REVIEW.md` (commit `48e9ad4`, the review of the PRIOR round, which found the
CR-01-class back-to-back-propose collision this round exists to close). That prior review remains
in git history; this file replaces it as the current review for HEAD.

## Summary

This reviews `git diff 9bfe1f9..HEAD` — the three-plan closure (05-27, 05-28, 05-29) that fixes
`isAttemptRefused`'s per-attempt `tool_result` correlation defect (gap `G-05-4`), the fifth
consecutive round this phase has shipped a criterion that could not report a genuine result in this
same narrow region of code.

**The fix is genuinely correct on the shape it targets.** `correlateProposeAttempts`
(`uat-08-socratic-authoring.mjs:2412-2474`) was traced by hand against every adversarial case listed
in the review brief — shared ambiguous result with a later real answer, three-way all-refused,
one-result-for-two-attempts, foreign-`runId` interleaving, answers outside the window, and
out-of-order arrival — and all resolve correctly. This was not taken on faith: the frozen negative
control (`readNoWorkPlannedWithoutClaiming`, lines 2526-2580) was confirmed byte-identical in logic
to the pre-fix `isAttemptRefused` at commit `9bfe1f9` (only the function name and error-message text
differ), and a **mutation test** was run against a scratch copy of the file (reverting
`readNoWorkPlanned` to call the frozen control instead of `correlateProposeAttempts`) — this
genuinely flips five self-test checks, including both new `[Plan 05-27, Task 2]` checks and the
extended order-independence check, from PASS to FAIL. The new tests have real teeth; this is not
another vacuous pass.

**The self-referential defect the review brief asked me to assess is real, but not the product bug.**
Several `05-VALIDATION.md` rows added by this closure (`05-28-02`, `05-29-01`, `05-29-02`) cite bare
`git diff --quiet -- <paths>` (no commit range) as their evidence command. Run post-commit, this
proves only "nothing uncommitted," not "these paths were untouched by this round" — confirmed
empirically (see WR-01 below). The underlying claims happen to be true when checked properly, but the
cited commands cannot themselves prove what the rows say they prove — the exact defect class this
five-round effort exists to eliminate, now appearing in the closure's own bookkeeping rather than in
product logic. Classified as a warning, not a blocker, because no downstream verdict is currently
wrong and the pattern is an inherited convention (`05-26-01`, predating this round) that this round's
plan explicitly told the executor to reuse — not a new invention.

One additional, pre-existing (not introduced by this round) correctness gap in
`correlateProposeAttempts` is also flagged below: the claiming scan treats **any** `tool_result` for
the run as a candidate answer, including one that actually answers an unrelated, non-`propose_*` tool
call interleaved between a propose attempt and its real answer. This can misattribute a genuinely
refused attempt as unrefused. It is not new to this round (the pre-fix algorithm had the identical
gap) and is not part of `G-05-4`'s stated scope, but the new doc comment's stronger claims about
"one-to-one" pairing do not disclose it.

## Warnings

### WR-01: The ledger's own provenance commands cannot report what the rows claim, in the closure meant to end this defect class

**File:** `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md:118-120`
**Issue:** Rows `05-28-02`, `05-29-01` and `05-29-02` each cite a bare `git diff --quiet -- <paths>`
(no commit range) as their verification command:
- `05-28-02` (line 118): `git diff --quiet -- scripts/uat/uat-08-socratic-authoring.mjs scripts/uat/lib packages/`
- `05-29-01` (line 119): `git diff --quiet -- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md`
- `05-29-02` (line 120): `git diff --quiet -- packages/ scripts/`

A bare `git diff --quiet -- <paths>` compares the **working tree against HEAD**. Once the round's
commits land, this exits `0` unconditionally, regardless of what changed in any prior commit — it
proves "nothing uncommitted right now," never "this round's diff left these paths alone." Verified
empirically this session:
```
$ git diff --quiet -- scripts/uat/lib packages/; echo $?
0
$ git diff --quiet 9bfe1f9..HEAD -- scripts/uat/lib; echo $?
1   # sidecar-harness.mjs genuinely changed 18 lines this round (plan 05-28's doc-comment fix)
```
Row `05-29-02` is the more serious instance: even if a commit range were added, bundling `packages/`
and `scripts/` into one command would make the check assert nothing useful about `packages/`
specifically, because `scripts/` is guaranteed to have changed this round — that is the round's whole
deliverable (`git diff --stat 9bfe1f9..HEAD -- scripts/` shows 584 insertions across 4 files). A
correctly-scoped ranged check on `packages/` alone does confirm it is genuinely untouched
(`git diff --quiet 9bfe1f9..HEAD -- packages/` exits `0`), and the transcript file is independently
confirmed byte-identical across the range too — so no row's underlying *claim* is false. But the
*command each row cites as its evidence* cannot distinguish "untouched" from "touched" in either its
bare form (always passes post-commit) or a naively-ranged form bundling `scripts/` (always fails,
because `scripts/` always changes). This is not a new invention of this round: row `05-26-01`
(pre-existing, outside this round's diff) already uses the identical bare-command shape, and
`05-29-PLAN.md` line 140 explicitly directs the executor to reuse "the convention row `05-26-01`
already established" for documentation tasks with no behavioral command — so this round propagated,
rather than introduced, the pattern, and did so on explicit plan instruction.
**Why it matters:** This is precisely the defect class ("a criterion that cannot report a genuine
result") this five-round closure exists to eliminate, now present in the paperwork that certifies the
closure itself. A future round could touch `packages/` and this exact ledger convention would still
print green.
**Fix:** For any ledger row whose evidentiary claim is about what changed *during this round*, cite a
ranged command anchored to the round's base commit, scoped to exactly the path being asserted
untouched — e.g. for `05-29-02`'s `packages/`-untouched claim: `git diff --quiet 9bfe1f9..HEAD --
packages/` (drop `scripts/` from the same command; scripts/ changing is expected and proves nothing
about packages/). For `05-29-01`'s transcript-byte-identical claim: `git diff --quiet 9bfe1f9..HEAD
-- .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md`. Reserve the bare
(no-range) form for what it actually proves — a same-task, pre-commit scope gate during plan
execution (its original, valid use in each plan's own `<verify>` block) — and never reuse that exact
command as post-commit ledger evidence about the round's historical diff.

### WR-02: `correlateProposeAttempts`'s positional claiming can attribute an attempt's answer to an unrelated tool call's result (pre-existing, not introduced this round, but undisclosed by the new doc comment)

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:2454-2470`
**Issue:** The claiming scan (lines 2454-2470) accepts the **earliest unclaimed `tool_result` of any
kind** for the run as a propose attempt's candidate answer — it has no way to tell whether that
`tool_result` actually answers the propose `tool_call` in question or some other, unrelated tool call
that happened to be issued and answered in between. Concretely: a propose attempt at `idx0`, a
non-propose tool call (e.g. a read/lookup tool) at `idx1`, that tool's own unrelated result at `idx2`,
then the propose attempt's real (refusing) answer at `idx3` — the scan claims `idx2` for the propose
attempt (the first unclaimed `tool_result` after `idx0`), reads `refused: false` from its unrelated,
non-refusing text, and never reaches `idx3`. A genuinely-refused attempt reads as unrefused, flipping
`readNoWorkPlanned`'s verdict from `refused` to `violated` for a run where SHAPE-01's challenge stage
actually held.
This is not a new regression: the pre-fix `isAttemptRefused` (and the frozen
`readNoWorkPlannedWithoutClaiming` control, lines 2526-2580) has the identical single-candidate scan
and the identical blindness to non-`tool_result`-typed intervening events being of a *different* tool
call. It is not part of `G-05-4`'s stated scope (which is specifically the back-to-back-*propose*
collision) and no scenario in this repository currently constructs a non-propose tool call
interleaved with a propose attempt during the challenge stage, so it has not been observed to fire on
a real run. It is flagged here because `correlateProposeAttempts`'s new doc comment
(`uat-08-socratic-authoring.mjs:2393-2396`) states "this is what makes the pairing one-to-one —
closing the exact collision `readNoWorkPlannedWithoutClaiming` below cannot see" without disclosing
that one-to-one-ness among candidate results is not the same as correctness of *which* result answers
*which* call — the pairing can still be one-to-one and wrong.
**Why it matters:** SHAPE-01's second half exists specifically to make a genuine violation
unmissable; this residual gap can mask one (in the direction of over-failing a compliant run, which
is the less dangerous of the two possible errors, but still an incorrect reading that could send a
developer chasing a false SHAPE-01 failure).
**Fix:** Either (a) narrow the claiming scan's candidate test to also require that the `tool_result`'s
position is not preceded, within the window, by an intervening *non-propose* `tool_call` for this run
that itself remains unanswered — i.e. only claim a result once every earlier-still-open tool call
(propose or not) has had a chance to claim its own answer first — or (b), more simply, extend the
`role`-capable fixture format (this round's own new capability) with a scenario that interleaves a
non-propose tool call between a propose attempt and its real answer, confirm whether this
misattribution is reachable on the real wire, and document the finding in `README.md` Item 8 either
way (as a sixth, scoped finding, or as a confirmed non-issue) rather than leaving it as an unstated
gap under a doc comment that reads as a stronger guarantee than the code delivers.

## Info

### IN-01: `readBackendRefusal`'s corrected doc comment is accurate but the WR-01 finding it responds to is undated relative to its own citation

**File:** `scripts/uat/lib/sidecar-harness.mjs:384-397`
**Issue:** Minor. The corrected paragraph cites "`05-REVIEW.md`'s WR-01, gap `G-05-4`, plan 05-28" —
but at the time a reader opens this comment, `05-REVIEW.md` will have been superseded by this file
(the prior review's WR-01, at commit `48e9ad4`, is the one being referenced). This is not misleading
today since git history retains the cited commit's content, and the plan explicitly required leaving
the implementation and the surrounding comment otherwise untouched, so this is not something to fix
retroactively — noted only so a future reader is not confused about which `05-REVIEW.md` "WR-01"
refers to once a subsequent round's review overwrites the file again.
**Fix:** None required for this round. If a future round touches this comment again, consider citing
the commit hash (`48e9ad4`) alongside "WR-01" so the reference survives file supersession.

## What Held Up Under Adversarial Tracing

For the record, per the review brief's specific adversarial cases — each traced by hand against
`correlateProposeAttempts` (lines 2412-2474) and confirmed with the mutation test described above:

- **Shared ambiguous result, second attempt's real answer later:** attempt1 claims the shared result;
  attempt2's scan skips the claimed index and reaches its own real answer. Correct (`violated`).
- **Three back-to-back, all refusing:** each claims its own result in turn; all refused. Correct
  (`refused`) — the fix does not over-correct a genuinely all-refused run.
- **Two attempts, one subsequent result:** attempt1 claims it; attempt2's scan is exhausted,
  `answerIndex: null`, `refused: false`. Correct (`violated`), matching the documented "no answer at
  all is unrefused by definition" contract.
- **Foreign-`runId` events inside the range:** excluded from both attempt collection and the claiming
  scan by the `event.runId !== runId` guard at each site; never claimed, never attributed.
- **Answer outside `toIndex`:** the claiming scan is bounded by `toIndex`; an attempt with no answer
  inside the window reads unrefused — a deliberate, documented, conservative design choice (fails the
  criterion rather than silently passing), not a bug.
- **Results before their attempt's own index:** invisible to that attempt (scan starts at
  `attempt.index + 1`) and never available to claim retroactively; consistent with "can't answer a
  call that hasn't happened yet."
- **Ascending-order guarantee:** `attempts` is built in strict ascending index order by construction
  (single forward loop over `[fromIndex, toIndex)`), and `.map()` preserves that order when claiming —
  the "earliest attempt claims earliest unclaimed result" property is structural, not incidental.

The frozen control `readNoWorkPlannedWithoutClaiming` was confirmed line-for-line equivalent (modulo
function/error-message renaming) to the pre-fix `isAttemptRefused`/`readNoWorkPlanned` at commit
`9bfe1f9`, is never referenced from the live body (confirmed by direct grep of every call site — the
only calls after the live body's `await runScript(` boundary at line 3391 are to the fixed
`readNoWorkPlanned`), and is asserted, by name, never to be called live by its own dedicated
self-test check (`[Plan 05-27, Task 2] the frozen control is never referenced from the live body`,
which itself passes).

The `role` fixture field (`fake-authoring-claude.mjs:419-421`) is genuinely fixture-only: stripped
from `wireBlock` before it is written (`const { delayMs: _delayMs, role: _role, ...wireBlock } =
block;`), used only to select the stream envelope's own `type`/`message.role` for the scripted
backend process — it has no path into what the live arm (which never imports
`fake-authoring-claude.mjs`) sees.

`REQUIREMENTS.md`'s SHAPE-01/SHAPE-03 lines and the `05-VALIDATION.md` manual-only notes were checked
against what was actually delivered and neither overclaims: both still read UNJUDGED for the live
dialogue-quality/draft-usefulness halves, both correctly narrow the "instrument fixed" claim to the
one-to-one claimed pairing this round proved, and no ledger row was found claiming a live run that did
not happen.

---

_Reviewed: 2026-09-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
