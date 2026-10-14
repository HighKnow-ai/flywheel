---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-15T09:25:36Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/App.tsx
  - packages/desktop/src/board/__tests__/needs-decision.test.tsx
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx
  - packages/desktop/src/item-detail/__tests__/runs-section.test.tsx
  - packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx
  - packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx
  - packages/desktop/src/item-detail/RunsSection.tsx
  - packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx
  - packages/desktop/src/item-detail/WorktreeSummary.tsx
  - packages/desktop/src/legend/__tests__/legend.test.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/projects/ProjectRail.tsx
  - packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx
  - packages/desktop/src/recovery/OrphanRecoveryModal.tsx
  - packages/desktop/src/session/__tests__/feed-row.test.tsx
  - packages/desktop/src/session/__tests__/permission-card.test.tsx
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/PermissionRequestCard.tsx
  - packages/desktop/src/session/SessionSurface.tsx
findings:
  critical: 5
  warning: 4
  info: 1
  total: 10
status: issues_found
---

# Phase 03 (Part 3/4 — Desktop Frontend): Code Review Report

**Reviewed:** 2026-09-15T09:25:36Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Reviewed the desktop React frontend slice of Phase 03 ("Nothing Lost, Nothing Left Running"):
recovery surfaces (orphan modal, missing-worktree banner, worktree-removal dialog, abandoned-run
acknowledge), the destructive-action permission gate, and the board's Needs Decision pill / rail
badge. The phase's own structural invariants (no dirty-worktree escape hatch, no allow-always on
the destructive gate, two independently-counted rail badges, fail-closed partial reads) all hold
in the code as written and are exercised by the accompanying tests.

The one thing that does **not** hold consistently is the double-activation guard the phase's own
prior plans (03-09, 03-10) already diagnosed and fixed twice: a `useState`-only "in flight" flag
does not stop a second synchronous activation before React flushes the re-render that disables the
button, so a `useRef` guard is required alongside the state flag. Two of the four surfaces that
introduced this pattern in this phase (`WorktreeSummary`'s Recreate/Remove-Record banner,
`RunsSection`'s Acknowledge) carry the `useRef` fix and say so in their own comments. The other two
surfaces that ship in this exact phase — the permission-request card's Allow/Deny/Allow-always
actions and the worktree-removal dialog's Remove action — plus the orphan-recovery modal's
Kill/Kill All (also this phase) and the live session surface's Stop control do **not** carry the
ref guard, despite `PermissionRequestCard.tsx`'s own doc comment citing "T-02-29" for exactly this
class of guard. This is the review's primary finding, filed as five separate BLOCKERs below since
each is an independently reachable path to a duplicate destructive/state-changing command.

## Critical Issues

### CR-01: `PermissionRequestCard`'s Allow/Deny/Allow-always guard is state-only, not ref-guarded — the exact bug this phase already fixed twice elsewhere

**File:** `packages/desktop/src/session/PermissionRequestCard.tsx:182-194`

**Issue:** `answer()` guards re-entry with `if (state.answering) return;` alone:

```ts
async function answer(decision: PermissionDecision) {
  // A second activation while disabled invokes nothing (T-02-29) — the guard the UI layer adds
  // on top of the core's own guarded once-only write.
  if (state.answering) return;
  setState({ answering: true, error: null });
  ...
```

`state.answering` is React state read from the render closure; `setState` does not synchronously
update the closure `answer()` captured, and the `disabled` attribute on the Allow/Deny/Allow-always
buttons is not guaranteed to be in the DOM before a second, closely-spaced activation reaches this
same `answer()` call. `WorktreeSummary.tsx`'s `MissingWorktreeBanner` (this same phase, plan 03-09)
and `RunsSection.tsx`'s abandoned-run Acknowledge (this same phase, plan 03-10) both encountered
this exact defect and fixed it with a `useRef` guard, with a code comment explaining precisely why
`state.answering`-equivalent alone is insufficient. `PermissionRequestCard.tsx` is the single most
reused component in this review's scope — it backs the routine Allow/Deny/Allow-always card AND the
destructive-action gate's Deny/"Allow, just this once" (03-UI-SPEC.md's reversed-emphasis variant,
D-56/D-57) in both the feed and compact mount points. A double-activation here can send two
`agent_run_answer_permission` calls for the same request id, including two DIFFERENT decisions if
the guard is raced (e.g. a fast Allow-then-Deny double-tap), which the current guard cannot rule
out under the documented race.

Note: the existing test `"activating Allow twice in immediate succession calls the answer spy
exactly once"` (`session/__tests__/permission-card.test.tsx:116-132`) passes today only because
`fireEvent.click` in Testing Library flushes React state synchronously inside `act()` between the
two dispatched clicks — it does not reproduce the real browser race the phase's own prior fixes
were written to close, and gives false confidence that this component is already guarded.

**Fix:**
```ts
const answeringRef = useRef(false);

async function answer(decision: PermissionDecision) {
  if (answeringRef.current) return;
  answeringRef.current = true;
  setState({ answering: true, error: null });
  try {
    await onAnswer(request.id, decision);
  } catch {
    answeringRef.current = false;
    setState({ answering: false, error: "Could not send your answer. Try again." });
  }
}
```

---

### CR-02: `WorktreeRemovalDialog`'s Remove button is state-only guarded — double-activation can issue two `worktree_remove` calls

**File:** `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx:92-103`

**Issue:** Same pattern as CR-01:

```ts
async function handleRemove() {
  // A second activation while disabled invokes nothing — the guard the UI layer adds on top of
  // the backend's own guarded removal.
  if (removeState.removing) return;
  setRemoveState({ removing: true, error: null });
  ...
```

`removeState.removing` is `useState`, not a `useRef`. The backend re-checking porcelain on every
call (D-43) limits the blast radius to "the second call also succeeds harmlessly or the second call
errors on an already-removed worktree," but this is still an unguarded duplicate destructive
command dispatch from the one button in this dialog whose entire reason for existing is to be the
sole gate on an irreversible action.

**Fix:** Add a `useRef` guard mirroring `WorktreeSummary.tsx`'s `actingRef`:
```ts
const removingRef = useRef(false);

async function handleRemove() {
  if (removingRef.current) return;
  removingRef.current = true;
  setRemoveState({ removing: true, error: null });
  try {
    await removeWorktree.mutateAsync();
    onClose();
  } catch {
    removingRef.current = false;
    setRemoveState({ removing: false, error: "Could not remove the worktree. Try again." });
  }
}
```

---

### CR-03: `OrphanRecoveryModal`'s Kill / Kill All have no in-flight guard at all — not even the state check the other unguarded surfaces have

**File:** `packages/desktop/src/recovery/OrphanRecoveryModal.tsx:106-143`

**Issue:** `handleKill` calls `killOne` unconditionally, with no check of the row's own `killing`
flag before dispatching:

```ts
function handleKill(runId: string) {
  setRows((prev) => (prev ?? []).map((row) => (row.orphan.runId === runId ? { ...row, killing: true } : row)));
  void killOne(runId);
}
```

The only thing preventing a second `orphanKill(runId)` call is the Kill button's own conditional
render (`row.failed ? … : row.killing ? "Killing…" : <button onClick={() => handleKill(...)}>`),
which — same race as CR-01/CR-02 — is not guaranteed to have committed before a second activation
reaches `handleKill`. `handleKillAll` has the identical gap, and is worse in effect: it reads the
CURRENT `rows` state synchronously to build `targets`, so two closely-spaced Kill All presses before
the first `setRows` commits will compute the *same* `targets` list twice and fire `orphanKill` twice
per orphan in the list:

```ts
function handleKillAll() {
  const targets = (rows ?? []).filter((row) => !row.killing && !row.failed);
  setRows(...)
  for (const target of targets) {
    void killOne(target.orphan.runId);
  }
}
```

This is the same defect class named in this phase's own prior fixes (WorktreeSummary/RunsSection),
but here there isn't even the (insufficient) `state.acting`-style precondition check — the guard is
entirely absent, relying only on React's render timing. Killing an orphaned process twice is likely
low-consequence on most platforms (a second `SIGKILL`/`SIGTERM` against an already-dead PID
typically no-ops), but this is the one modal in the app explicitly designed to be the last word on
"is anything still running and spending tokens" (D-46) — a duplicate in-flight kill request racing
the first response is exactly the kind of ambiguity this surface exists to eliminate.

**Fix:** Add a per-row ref set (or a single `Set<string>` ref of in-flight run ids) guarding both
`handleKill` and the per-target dispatch inside `handleKillAll`:
```ts
const killingRef = useRef<Set<string>>(new Set());

async function killOne(runId: string) {
  if (killingRef.current.has(runId)) return;
  killingRef.current.add(runId);
  try {
    const outcome = await orphanKill(runId);
    ...
  } finally {
    if (/* not resolved to removal */) killingRef.current.delete(runId);
  }
}
```
(Adjust exactly where the ref is cleared so a permanently-failed row does not re-admit a retry —
there is deliberately no retry affordance per this file's own doc comment.)

---

### CR-04: `SessionSurface`'s Stop control has no re-entry guard whatsoever — not even a `state.acting`-style precondition

**File:** `packages/desktop/src/session/SessionSurface.tsx:574-586, 683-700`

**Issue:**
```ts
function handleStop() {
  setStopping(true);
  stopAgentRun(agentRunId)
    .then((result) => {
      if (isRunStatus(result.status)) setStatus(result.status);
      setStopWarning(result.sidecarWarning);
    })
    .catch(() => setStopping(false));
}
```
called from:
```tsx
<button type="button" onClick={handleStop} disabled={stopping} ...>
```

Unlike every other unguarded handler in this review (CR-01–CR-03), `handleStop` does not even check
`if (stopping) return;` before dispatching — the ONLY thing standing between one click and two
`agent_run_stop` calls is the `disabled` attribute's own render timing, the exact race this phase's
own prior fixes exist to close. `agent_run_stop`'s own doc comment (`adapters/tauri.ts:307-318`)
describes an "interrupt, then force" semantics, so a duplicate call is plausibly idempotent
server-side, but that is an assumption this file makes silently rather than one the frontend
enforces — every other action in this review at least attempts a JS-level guard.

**Fix:**
```ts
const stoppingRef = useRef(false);

function handleStop() {
  if (stoppingRef.current) return;
  stoppingRef.current = true;
  setStopping(true);
  stopAgentRun(agentRunId)
    .then((result) => {
      if (isRunStatus(result.status)) setStatus(result.status);
      setStopWarning(result.sidecarWarning);
    })
    .catch(() => {
      stoppingRef.current = false;
      setStopping(false);
    });
}
```

---

### CR-05: Missing-worktree banner is bypassable when `path` is empty, silently exposing "Remove Worktree" on a `status: "missing"` row

**File:** `packages/desktop/src/item-detail/WorktreeSummary.tsx:238-240, 304-319`

**Issue:** The file's own doc comment (lines 38-45) states the missing-worktree decision banner is
"an early return… there is no second guard anywhere in this file for that; the early return IS the
guarantee" that Remove Worktree is structurally unreachable while the row is `missing`. The actual
guard, however, is compound:

```ts
if (summary.status === "missing" && isNonEmptyString(summary.path)) {
  return <MissingWorktreeBanner taskId={taskId} path={summary.path} />;
}
```

If `summary.status === "missing"` but `summary.path` is falsy/empty (a malformed or defensively-
degraded wire response — this file elsewhere explicitly designs for exactly that possibility via
`PossiblyPartialSummary`/T-02-37), this condition is false, execution falls through past the
early-return ladder into the ordinary branch/path render, and the **Remove Worktree button renders
for a row Flywheel itself believes is missing from disk** — the one outcome the file's own doc
comment says is structurally impossible. `worktree_remove` would then run against a path git cannot
find, which is a confusing failure mode rather than a guarded one, and — worse — it is the exact
kind of "trust the compile-time contract instead of failing closed" gap T-02-37 exists to close,
in the one file that otherwise defends against it everywhere else.

**Fix:** Gate on `status === "missing"` alone for the early return (never require `path` to be
non-empty to suppress the destructive action), and let the banner itself render its own "path
unavailable" fallback:
```ts
if (summary.status === "missing") {
  return (
    <MissingWorktreeBanner
      taskId={taskId}
      path={isNonEmptyString(summary.path) ? summary.path : "an unknown location"}
    />
  );
}
```

## Warnings

### WR-01: Dirty-worktree heading can read "0 uncommitted changes" while still listing real entries

**File:** `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx:183-196`

**Issue:** The Dirty branch is reached whenever `dirtyCount !== 0 || entries.length !== 0` (i.e.
anything that isn't the exact `dirtyCount === 0 && entries.length === 0` Clean case). The heading
text and pluralisation are derived from `dirtyCount` alone (`Can't remove — {dirtyCount} uncommitted
{plural}`), but a response with `dirtyCount: 0` and a non-empty `entries` array (a plausible partial
inconsistency from the same class of malformed read `looksPartial` already defends against) renders
"Can't remove — 0 uncommitted changes" above a non-empty list of real entries — refusing correctly
(safe), but with a self-contradicting heading. `looksPartial` catches `dirtyCount > 0 && entries.length
=== 0` and empty-path entries, but not this inverse mismatch.

**Fix:** Extend the `looksPartial` check (or the heading derivation) to also treat
`dirtyCount !== entries.length` as a partial/inconsistent read:
```ts
const looksPartial =
  (dirtyCount > 0 && entries.length === 0) ||
  entries.some((entry) => entry.path === "") ||
  dirtyCount !== entries.length;
```

### WR-02: `WorktreeSummaryDto.status` is matched by exact string literal with no defensive fallback for an unrecognised value

**File:** `packages/desktop/src/item-detail/WorktreeSummary.tsx:238`, cross-referenced against `packages/desktop/src/adapters/tauri.ts:220-224`

**Issue:** `worktreeSummary.status` is typed as a bare `string` on the wire (`adapters/tauri.ts`'s
`WorktreeSummaryDto`), and the UI's only branch on it is the literal equality `summary.status ===
"missing"`. If the backend ever emits a status value with different casing, a synonym, or a new
recovery-state string this component doesn't yet know about, the row silently falls through to the
normal branch/path render — including the (otherwise-guarded, per CR-05's fix) Remove Worktree
action — with no visible signal that anything is unusual. This is a cross-boundary assumption this
file's own doc comments elsewhere are careful to defend against (`PossiblyPartialSummary`,
`violatesSingleton`) but do not apply to `status`.

**Fix:** Treat any `status` value that is neither a known "healthy" value nor `"missing"` as at
least worth a visible, non-blocking notice (mirroring the `violatesSingleton` treatment already used
a few lines below), rather than silent pass-through to the normal render.

### WR-03: `RunSummaryDto.abandonedReason` is parsed with `new Date(...)` with no validity check

**File:** `packages/desktop/src/item-detail/RunsSection.tsx:300-308`

**Issue:**
```tsx
{run.abandonedReason
  ? `Flywheel wasn't running to supervise this session — it was stopped at ${new Date(
      run.abandonedReason,
    ).toLocaleString()} because Flywheel had died.`
  : "This run never finished, and Flywheel doesn't know why it stopped."}
```
`adapters/tauri.ts`'s doc comment on `abandonedReason` (lines 194-198) explains it is `null` unless
"a kill record exists for it and parsed successfully" server-side, which makes a malformed value
unlikely — but if the wire value is ever a non-parseable string (a future schema drift, or a
partially-written kill record), `new Date(x).toLocaleString()` renders the literal string
`"Invalid Date"` into this explanatory sentence shown to the user, rather than falling back to the
honest "doesn't know why it stopped" sentence the `null` branch already provides.

**Fix:**
```ts
const abandonedAt = run.abandonedReason ? new Date(run.abandonedReason) : null;
const abandonedAtValid = abandonedAt !== null && !Number.isNaN(abandonedAt.getTime());
```
and branch on `abandonedAtValid` instead of the raw truthiness of `run.abandonedReason`.

### WR-04: `OrphanRecoveryModal`'s "Killing…" row shows no distinct treatment when a kill result arrives as neither killed nor an outright error, if the promise never settles

**File:** `packages/desktop/src/recovery/OrphanRecoveryModal.tsx:106-128`

**Issue:** Not a functional bug today, but worth noting alongside CR-03: `killOne` has no timeout —
if `orphanKill` never resolves or rejects (a hung IPC call), the row is stuck showing "Killing…"
forever with no path back to a Kill button or a failure state, and (per CR-03's `anyUnresolved`
check) "Kill All" stays enabled and could be re-pressed, re-dispatching kills for every OTHER
still-Kill-able row while this one row is silently stuck. Low likelihood, but this modal is
explicitly the app's last line of defense against a lied-about clean launch (03-10 Task 3's own
"criterion 2 honesty" test), so an unbounded hang here is worth a defensive timeout.

**Fix:** Consider a bounded timeout on `orphanKill` (or a visible "taking longer than expected"
state after N seconds) so a hung IPC call cannot leave a row silently un-actionable forever.

## Info

### IN-01: Per-file duplication of `relativeTime`/`MONO_STACK`/status-badge lookups is consistent with this codebase's own stated convention, not an oversight

**File:** `packages/desktop/src/item-detail/RunsSection.tsx`, `packages/desktop/src/recovery/OrphanRecoveryModal.tsx`, `packages/desktop/src/session/SessionSurface.tsx`, `packages/desktop/src/item-detail/WorktreeSummary.tsx`

**Issue:** `relativeTime`, `MONO_STACK`, `prefersReducedMotion`, and the run-status label/colour/mark
lookup tables are each re-declared verbatim (or near-verbatim) in three-to-four files rather than
imported from one shared module. Each file's own doc comment explicitly cites this as a deliberate,
established per-file convention rather than an accident, so this is not filed as a defect — flagged
only as an observation for the reviewer of a future phase: if a fifth or sixth surface needs the
same helpers, the duplication cost (a bug fix in one copy not propagating to the others — e.g. a
future change to `relativeTime`'s boundary rounding) starts to outweigh the stated benefit of
per-file independence.

**Fix:** No action required for this phase. Consider extracting a shared `formatting.ts` if a future
plan adds a fifth call site.

---

_Reviewed: 2026-09-15T09:25:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
