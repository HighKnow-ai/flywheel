# Phase 8: Review And Merge Inside Flywheel - Context

**Gathered:** 2026-10-05
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the review half of the loop: Cyril reads a task's full diff — and its epic
integration branch's accumulated diff — inside Flywheel with syntax highlighting, checks each
acceptance criterion against that diff, merges a task branch into its epic integration branch
from within the application with conflicts surfaced rather than half-applied, and opens a pull or
merge request for a finished epic's integration branch in one action. With it, the whole loop
closes in-app: shape → plan → run → reconstitute → review → merge.

Five requirements: REVW-01 (task diff with syntax highlighting), REVW-02 (epic integration branch
diff), REVW-03 (criteria checked against the diff during review), REVW-04 (in-app merge with
conflicts surfaced), REVW-05 (one-action request for an epic integration branch).

**Not in this phase.** Conflict *resolution* inside Flywheel; commit-by-commit diff reading; a
split-view diff; editing files during review; any change to how the forge is detected, called or
polled (Phase 7 owns that); worktree creation and removal mechanics (Phase 3 owns those — this
phase only asks for one more worktree per epic); anything that moves a task to Done (D-122 holds).

</domain>

<decisions>
## Implementation Decisions

Decision numbering continues from Phase 7 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2,
D-41–D-63 are Phase 3, D-64–D-79 are Phase 4, D-80–D-96 are Phase 5, D-97–D-112 are Phase 6,
D-113–D-130 are Phase 7).

### Where review happens

- **D-131:** **Review is a fourth full surface — `ReviewSurface` — pushed into from the board and
  popped back out of.** It takes its shape from the three surfaces `App.tsx` already switches
  between on exactly this pattern: `SessionSurface` (D-31), `SettingsSurface` (D-39) and
  `TriageSurface` (D-103). The board underneath keeps its filters, selection and scroll untouched,
  and the diff gets the full window minus the project rail.
  Rejected: a diff section inside `ItemDetailPanel.tsx` (no new surface, no new navigation, and the
  diff would sit directly beneath the criteria list it is read against — but a real diff would then
  render at the width of a panel already carrying title, status, criteria, worktree, git facts,
  forge, runs and activity trail); and a full-screen overlay in the manner of `OrphanRecoveryModal`
  / `LaunchSheet` (reachable from anywhere including mid-session, dismissed with Escape — but
  review is a sit-down activity you stay inside for ten minutes, which is not what a modal is for).

- **D-132:** **One surface serves both scopes, with a header toggle between "this task" and "the
  whole epic".** Task scope renders the task's own criteria rail; epic scope renders the epic's
  criteria plus a roll-up of its tasks. One component, one keyboard map, and the task → epic hop
  mid-review costs no navigation — which matters because the epic diff is what you read
  immediately before opening its request (REVW-05).
  Rejected: task scope only in v1, with the epic's accumulated diff as a read-only section on the
  epic's `ItemDetailPanel` (smaller build — but the epic diff would then live somewhere the task
  diff does not, and success criterion 1 asks for both to be readable as one activity); and two
  separate surfaces tuned to their different jobs (clearest intent per surface — but two components
  to keep in agreement and two keyboard maps to learn).

- **D-133:** **Four entry points, all of them reusing an existing affordance convention.** A
  "Review" action on `ItemDetailPanel` beside Start Work (the convention `onStartWork` already
  follows); a single-key action on the focused board card, as `w` already opens Start Work from the
  board list (`board/BoardView.tsx` action ids); the command palette, which already resolves git
  identifiers under D-127, so a branch or commit can land you on its review; and an offer from the
  session surface when a run finishes, which is the moment review is most likely wanted.
  No alternative was argued against here — these are four doors onto one surface, and each one is a
  few lines against a pattern the codebase already has.

- **D-134:** **Three panes: criteria rail, file list, diff — and the diff is always the whole branch
  against its target.** The file list comes from `git.rs::diff_stat_and_names`, which already
  exists and is already cheap, and exists to let you jump around a multi-file branch rather than
  scroll past what you have already read.
  Rejected: adding a commit selector driven by `git_facts.rs`'s commit rows, which would also let
  the "made outside Flywheel" markers (D-115) be read in situ (more faithful to how the work
  actually arrived — but it is a second diff mode to build, and it puts a decision in front of the
  user before they can read anything); and criteria + diff with no file list at all (fewest moving
  parts, and the installed virtualizer would carry it — but navigating a 20-file diff then means
  scrolling).

### What renders the diff

- **D-135:** **`react-diff-view` plus `refractor` for highlighting.** Purpose-built unidiff parsing
  and rendering, and — decisively — a decoration API that lets a diff line carry a criterion
  anchor, which is exactly what D-143 needs. Neither library is in `packages/desktop/package.json`
  today; nothing in the workspace renders a diff at all.
  Rejected: `@monaco-editor/react`'s `DiffEditor` (highlighting for every language, split view, and
  the option to edit a file during review rather than only read it — but a multi-megabyte editor
  runtime inside a Tauri WebView, and a decoration model that is editor-shaped rather than
  diff-line-shaped); and a hand-rolled renderer over the already-installed
  `@tanstack/react-virtual` with Shiki or Prism (zero new rendering dependencies and total control
  over the criteria binding — but it re-implements hunk parsing, word-level intra-line diffing and
  expand-context, all of which `react-diff-view` already does correctly).
  — **Reversibility:** costly — the dependency swap itself is contained, but the criteria-anchor
  interaction in D-143 is built on this library's decoration API, so replacing the renderer means
  re-deriving how an anchor attaches to a diff line.

- **D-136:** **Unified view only — no split, no toggle.** The surface already spends width on a
  criteria rail and a file list, so split would leave two cramped code columns; unified reads at any
  width and is how a diff on a forge reads by default. One mode means nothing to remember and
  nothing to persist.
  Rejected: unified by default with a split toggle and a persisted preference (split is genuinely
  better for reading a rewritten function side by side, and `react-diff-view` serves both from the
  same parsed hunks, so the cost is only a control and a stored preference); and split by default
  (closest to a desktop merge tool — but both columns wrap badly at the width left over after two
  rails, and most agent diffs are additive rather than rewrites).

- **D-137:** **The file list is eager, the patches are lazy, and nothing is ever truncated.** The
  file list renders immediately from `diff_stat_and_names`; each file's patch text is fetched and
  parsed only when that file is opened, and files open collapsed showing their stat line. A
  60-file, 8000-line branch therefore opens instantly and costs only what you actually read.
  Rejected: one `git diff` for the whole branch parsed up front and rendered through the
  virtualizer (continuous scroll across the branch with no per-file click — but parsing an
  8000-line unidiff stalls the surface on open, and a lockfile alone can be most of it); and a hard
  per-file line cap that refuses to render anything larger with a button out to the user's editor
  (bounds the worst case absolutely — but it means the application sometimes declines to show you
  the diff, which is the one thing this phase exists to provide).

- **D-138:** **The diff is committed work only — the branch against its merge-base — and a dirty
  worktree raises a banner naming the file count.** What the diff shows is exactly what a merge
  would bring, which is the claim the merge action rests on. Uncommitted work in the task worktree
  is already tracked by `git_facts.rs`, so the banner costs a read that already happens.
  Rejected: rendering committed and uncommitted hunks together with the uncommitted ones visually
  separated (you would see everything the agent actually did in one read — but the diff would no
  longer equal what merging lands, and a criterion anchored to an uncommitted hunk could be
  satisfied by work that never ships); and a toggle between the two readings (both available on
  demand — but a second diff mode on a surface that just chose to have exactly one).

### What a criterion check records

- **D-139:** **Checking a criterion during review records an anchor: file, line range, and the sha
  it was read at.** You select a hunk or line range in the diff, then check the criterion against
  it. `acceptance_criteria` today carries `statement`, `verification_hint` and a bare `checked`
  boolean — nothing about *why* — so this is new storage. The criteria rail then distinguishes
  criteria that carry evidence from criteria that were waved through, and a later session can jump
  straight to the code that satisfied each one.
  This is the decision that makes success criterion 2 the daily habit the roadmap's note calls for
  rather than a checkbox that happens to sit beside a diff.
  Rejected: the same checkbox plus an optional free-text note (captures reasoning a line range
  cannot — "verified by running the suite" — and feeds the context packet as prose, but nothing
  connects a criterion to code, so re-reading it later means finding the hunk again by hand); and a
  plain check beside the diff, today's `AcceptanceCriteriaList` rendered in the rail (zero schema
  change, zero new interaction, and the layout alone would still establish the habit — but the
  record afterwards would be indistinguishable from checking criteria off the board blind).
  — **Reversibility:** costly — the storage is additive and the UI is contained, but once anchors
  exist in real review history they are referenced by the context packet (D-142) and by the merge
  confirm sheet (D-146), so removing the notion means unpicking three consumers.

- **D-140:** **An anchor is optional, and its absence is visible.** You can always just check the
  box; a criterion checked without an anchor renders a quiet "no evidence" marker in the rail and
  in the item panel. This is the discipline D-123 already set for merging with unchecked criteria:
  never block, always make the gap impossible to miss.
  It is also what keeps criteria like "the suite still passes" or "the interaction feels right"
  checkable — they have no line to point at.
  Rejected: requiring an anchor, no anchor no check (every check would then be real evidence by
  construction and the record could never lie — but an unanchorable criterion becomes uncheckable
  and the user works around the product); and requiring one with an explicit separate "waive"
  action recording who waived it and when (the strongest record — but a second mutation path, a
  second affordance, and an extra decision on every criterion that genuinely has no line).

- **D-141:** **When the anchored file changes afterwards, the anchor is marked stale and the check
  stands.** The anchor keeps its sha and the rail reads "verified at a3f91c, that file has moved
  since". Nothing is unchecked behind the user's back — D-29's property and D-121's, applied to
  criteria instead of to the status column.
  Rejected: marking it stale and returning the criterion to unchecked so review genuinely happens
  again against the new code (strongest correctness story — but it is the board silently
  overwriting the user's own mark, the exact failure D-121 and "never silently overwritten" exist
  to prevent); and keeping the anchor with no staleness notion at all, as a pure historical record
  (simplest, and the sha is right there — but "all criteria checked" would then say nothing about
  the branch as it stands, which is the claim the merge action rests on).

- **D-142:** **The context packet carries each criterion's anchor and whether it is stale.** A
  resumed session is told "criterion 2 was verified at `src/retry.rs:13-21`, which you have since
  rewritten" — the context-reconstitution thesis doing real work rather than restating the board.
  Note that `context_packet.rs`'s `CRITERIA_SQL` currently selects `statement, verification_hint`
  only; it carries no `checked` state at all today, so this widens that read.
  Rejected: keeping the packet's present shape and leaving the anchor a purely human review
  artifact (small packet, unambiguous agent instructions — but the agent could not then know that
  its own later commit invalidated a verification someone already did); and mentioning an anchor
  only where it has gone stale (almost free, surfaces only the actionable case — but the agent gets
  no positive signal about what has already been confirmed).

### Merging

- **D-143:** **Merges land in a per-epic integration worktree, checked out on the epic's
  integration branch.** The task worktree is never touched, so an agent still working in it cannot
  collide with a merge, and the epic's accumulated diff (REVW-02) has a real checkout to read from.
  Worktree lifecycle is already a solved primitive from Phase 3, and `git_retry.rs` already
  provides `with_lock_retry` plus per-repository serialization (`wait_turn`) for concurrent git
  across the fleet.
  Rejected: checking the integration branch out in the task's own worktree, merging, and switching
  back (no extra worktree to create, track or clean up — but it mutates the directory an agent may
  be mid-session in, and a conflict leaves that worktree conflicted for the agent to inherit); and
  merging refs in the main checkout with no working tree (nothing to create and nothing left dirty
  — but a non-trivial merge needs a working tree to resolve into, so only fast-forwards and clean
  three-way merges would work and the conflict path would have nowhere to land).

- **D-144:** **A conflict aborts immediately, names the conflicted files, and offers to start an
  agent session on the task with that conflict as its brief.** `git merge --abort` runs at once, so
  the integration worktree is never left conflicted — that is success criterion 3's "rather than
  failing silently or half-merging", read literally. The resolve-session offer keeps the loop inside
  Flywheel without building a merge tool.
  Rejected: leaving the merge in progress and listing the conflicted files with a route out to the
  user's editor or a terminal (matches what a developer expects from git — but it leaves a
  half-merged worktree the user must remember to finish or abort, and the next merge attempt then
  fails confusingly); and aborting, then resolving conflicts inside the `ReviewSurface` using the
  renderer D-135 chose (fully closes the loop with no external tool — but an in-app merge tool is
  its own product, and `react-diff-view` renders diffs, not conflict resolution).

- **D-145:** **A successful local merge raises an "integrated into {epic}" marker and an `events`
  row, and moves no status.** Landing in an integration branch is not shipping; the epic's own
  request is, and D-122 reserves In Review for request-opened and Done for request-merged. The
  epic's merge is what carries its tasks to Done.
  Rejected: moving the task to In Review, since a merged task is genuinely past coding and the
  board would visibly drain as work lands (but D-122 names request-opened as the one trigger for
  In Review, so the column would gain two owners with different semantics, and a local merge is
  reversible in a way an open request is not); and moving it to Done (simplest mental model — but it
  directly contradicts D-122, and a task marked Done can still be lost if the epic's branch is
  never merged).

- **D-146:** **A confirm sheet precedes the merge, and `destructive.rs` stays out of it.** The sheet
  shows source branch, target branch, commit count, file count, the number of criteria checked
  without evidence (D-140) and any dirty-worktree warning (D-138) — the launch sheet's own "see it
  before you spend it" shape (plan 02-04) applied to a git write instead of a model call.
  `destructive.rs` exists to classify what *agents* try to run; the user's own deliberate action is
  not what it was built to police.
  Rejected: merging immediately with no confirmation (one action, result reported, and a confirm
  step on every merge becomes a reflex click that confirms nothing — but the unchecked-criteria and
  dirty-worktree warnings would then have nowhere to land before the fact); and routing the merge
  through `destructive.rs` so one gate and audit trail covers every git write and Phase 12's
  trust-boundary redesign covers this for free (one gate for all git writes — but it conflates
  agent-issued commands with user-initiated ones, which is the distinction that gate is built on).

### Claude's Discretion

Two areas were identified and deliberately left to research and planning, both because they are
reuse-shaped rather than genuinely open:

- **The epic-level request action.** REVW-05 is epic-scoped, while `ForgeSection.tsx` and
  `forge::create_request_at` are task-scoped today. The expectation is that the epic action reuses
  the same deterministic-draft-then-preview-then-confirm shape plan 07-09 established (the
  component passes an id alone, never a title or body, which is what makes previewed text and
  published text the same text by construction), and that the epic integration branch's own target
  is derived the way D-25/D-26 already derive a task's.
- **The `ReviewSurface` keyboard map.** Expected to follow the conventions
  `AcceptanceCriteriaList.tsx` and the board list already set (`j`/`k` between rows, `Space`/`Enter`
  to toggle, single-key actions, Escape to pop back), extended to the file list and diff panes.

Also at Claude's discretion: binary files and renames in the diff, generated-file detection,
whitespace handling, the shape of the patch-text command crossing the IPC boundary, merge commit
style, and whether the integration branch is pushed after a merge.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § "Phase 8: Review And Merge Inside Flywheel" — the goal, the four
  success criteria, the Phase 7 dependency, and the note explaining why criterion 2 is the one
  that turns the core value into a daily habit.
- `.planning/REQUIREMENTS.md` lines 129–133 — REVW-01 through REVW-05, the five requirements this
  phase closes.
- `.planning/PROJECT.md` — the core value ("every unit of agent work is anchored to a structured
  board item with real acceptance criteria"), the context-reconstitution thesis that D-142 serves,
  and the architecture constraint that no v1 decision may foreclose scheduled automations, team
  collaboration, the mobile/web relay, or additional agent backends.

### Prior-phase decisions this phase builds on
- `.planning/phases/07-the-board-tells-the-git-truth/07-CONTEXT.md` — D-115 (a commit no agent run
  produced is marked and trailed), D-117 (the `gh`/`glab` adapter), D-118 (Flywheel opens the
  request itself, pre-filled from the board item — the shape D-146's confirm sheet and the epic
  request action both follow), D-120 (absence is the design when no forge is configured), D-121
  (status transitions are edge-triggered and hand the column back), D-122 (only request-opened →
  In Review and merged → Done, forward only — the rule D-145 obeys), D-123 (a merge carries a task
  to Done even with unchecked criteria, and raises a visible marker — the discipline D-140
  inherits), D-127 (the command palette resolves git identifiers — one of D-133's four doors).
- `.planning/phases/04-clear-is-free/04-CONTEXT.md` — D-70/D-71 (the diff-so-far is `--stat` and
  changed paths, never hunk bodies, in two labelled committed/uncommitted sections — the precedent
  D-138's banner follows and the reason this phase is the first to render hunk bodies at all),
  D-75 (derive at read time, never store a verdict), D-76/D-77/D-79 (criterion revisions, the
  mechanism anchors must not disturb).
- `.planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md` — worktree lifecycle, the
  primitive D-143 asks for one more instance of; D-42 (`git status --porcelain` rendered as rows),
  D-51 (the `git` shim on the worktree PATH), D-54 (one shared backoff policy).
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-CONTEXT.md` — D-24 (task branch
  naming), D-25 (epic integration branch), D-26 (an epic-less task branches off and targets the
  trunk) — together these derive every merge target and diff base this phase needs; D-29 (status
  moves in, never out), D-31 (the pushed-into/popped-back-out-of surface shell D-131 copies),
  D-37 (board-visible flags).
- `.planning/phases/01-the-board-is-the-store-of-record/01-CONTEXT.md` — D-05/D-06/D-07
  (acceptance criteria belong to tasks and epics, never issues — so the criteria rail is absent in
  no valid review scope), D-10 (immutable key prefix).

### UI conventions
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` § "Selected Direction" and
  § "Keyboard Map — Item detail panel" — the interaction grammar `AcceptanceCriteriaList.tsx`
  implements and the criteria rail must not contradict.
- `.planning/phases/02-one-agent-one-worktree-watched-live/02-UI-SPEC.md` — the launch sheet's
  "see it before you spend it" shape, which D-146's confirm sheet reuses.
- `.planning/phases/03-nothing-lost-nothing-left-running/03-UI-SPEC.md` — the worktree and
  recovery surfaces' own conventions.

### Trust boundary and git invariants
- `docs/destructive-gate-trust-boundary.md` — the gate D-146 deliberately stays outside, and the
  layers it must not disturb.
- `packages/core/src/git.rs` header comment — PROC-02: the one and only `Command::new("git")` site
  in the workspace, with `-C <repo_path>` always the first two arguments. **HARD CONSTRAINT:**
  every git invocation this phase adds (patch text, merge, merge-base, abort) goes through
  `crate::git::git_at`. `packages/core/tests/supervisor_cwd.rs` asserts that construction site
  appears exactly once; a second one fails that test immediately.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/git.rs::diff_stat_and_names` — file names plus added/removed counts against a
  base ref. Already cheap, already used. D-134's file list and D-137's eager-list/lazy-patch split
  are built directly on it. It returns **no patch text** — that is the one new git read this phase
  needs.
- `packages/core/src/git.rs::git_at` — the single permitted git construction site; every new
  invocation goes through it.
- `packages/core/src/git_retry.rs` — `with_lock_retry`, `with_lock_retry_notify` and a per-repo
  `wait_turn` serializer. The merge in D-143 is a git write on a shared repository, so it belongs
  inside these.
- `packages/core/src/git_facts.rs` — `CommitRow`, ahead/behind, uncommitted-change tracking,
  `record_outside_commits`. Supplies D-138's dirty-worktree banner and D-146's commit count for
  free.
- `packages/core/src/branch.rs` — `task_branch_name`, `epic_integration_branch_name`, the single
  `slugify`. Derives the merge source, the merge target, and the integration worktree's branch.
- `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` — checkable, keyboard-driven
  criteria rows with revision markers (D-76/D-77/D-79). The criteria rail should extend this
  component rather than fork it; `CriterionDto` is where the anchor fields land.
- `packages/desktop/src/item-detail/ForgeSection.tsx` — the task-level open-request flow with
  deterministic draft, preview before send, and `forgeOpenRequest(taskId)` passing an id alone.
  The epic-level REVW-05 action reuses this shape.
- `packages/core/src/forge/` — `create_request_at`, `request_for_branch_at`, `request_body.rs`
  (the deterministic draft), `transitions.rs`. REVW-05's machinery already exists at task scope.
- `@tanstack/react-virtual` 3.14.11 — already a dependency and already used for board lists;
  available for the file list and for long single-file patches.

### Established Patterns
- **The pushed-into / popped-back-out-of surface.** `App.tsx` switches between `SettingsSurface`,
  `TriageSurface`, `SessionSurface` and the board, each replacing the content area entirely while
  leaving the board's own state intact underneath (D-31, D-39, D-103). `ReviewSurface` is the
  fourth, and must be ordered in that conditional chain deliberately.
- **Live reads, never cached verdicts.** `useForgeRequest` and friends in
  `board/useBoardQuery.ts` use `staleTime: 0` and are invalidated by `subscribeBoardChanged`
  (D-75). Diff reads, anchor staleness and merge state all follow this.
- **Absence is the design.** `WorktreeSummary.tsx` and `ForgeSection.tsx` render nothing at all
  rather than a labelled empty state (D-120) — unlike `ActivityTrail.tsx` and
  `AcceptanceCriteriaList.tsx`, which always render a header. `ReviewSurface`'s panes must each
  pick a side of this deliberately.
- **One construction site for `git`.** Asserted structurally by
  `packages/core/tests/supervisor_cwd.rs`.
- **Tauri commands live in `packages/desktop/src-tauri/src/commands/`,** one module per domain
  (`forge.rs`, `git_truth.rs`, `criterion.rs`, …). Raw CLI stderr never crosses the IPC boundary.

### Integration Points
- **New git reads** — patch text per file, merge-base resolution, merge, `--abort`. All inside
  `packages/core/src/git.rs` via `git_at`.
- **`acceptance_criteria` schema** — a migration adding anchor storage (file path, line range,
  sha). Current columns: `statement`, `verification_hint`, `checked`, `rank`, plus the revision
  columns from `0009_criteria_revisions.sql`.
- **`packages/core/src/context_packet.rs`** — `CRITERIA_SQL` currently selects `statement,
  verification_hint` only and carries no `checked` state; D-142 widens that read and the rendered
  packet section around line 478.
- **`packages/desktop/src/App.tsx`** — the surface conditional chain gains `ReviewSurface`.
- **`packages/desktop/src/board/BoardView.tsx`** — a new single-key board action id (D-133).
- **`packages/desktop/src/authoring`/`session`** — the session surface's finish state gains the
  "review this work" offer (D-133).
- **`packages/desktop/src/legend/marks.ts`** — the "integrated" marker (D-145), the "no evidence"
  marker (D-140) and the "stale anchor" marker (D-141) are legend entries.
- **`events` table** — a merge writes one row (D-145); so does an aborted conflicted merge.
- **`packages/desktop/package.json`** — `react-diff-view` and `refractor` added (D-135).

</code_context>

<specifics>
## Specific Ideas

Four layout and copy sketches were chosen explicitly during the discussion and should be treated
as the intended shape, not as illustrations:

- **The surface** — project rail, then a header reading `← Board · FW-42 Add retry` with the
  Task | Epic scope toggle, then three panes left to right: criteria rail, file list with per-file
  stat, diff.
- **The criteria rail** — a checked criterion with an anchor reads `☑ retries 3x →
  src/retry.rs:13-21 @a3f91c`; one without reads `☑ logs each ○ no evidence`; a stale one adds
  `⚠ file changed since (2 commits)` and a fresh one `✓ untouched since`. A rail footer counts
  checks without evidence.
- **The dirty-worktree banner** — "⚠ 3 files uncommitted in the worktree — not in this diff, and a
  merge will not carry them."
- **The conflict result** — "✕ Merge aborted — 3 conflicts, nothing changed", the conflicted file
  paths listed, then two actions: start a session to resolve, or open in editor.
- **The confirm sheet** — "Merge FW-42 → flywheel/fw-7-integration", then commit and file counts,
  then the warning lines, then Merge / Cancel.

</specifics>

<deferred>
## Deferred Ideas

- **Conflict resolution inside Flywheel.** A three-way resolution pane in the `ReviewSurface` was
  considered and rejected in D-144 as its own product. If the resolve-session path proves
  insufficient in practice, this is the follow-on.
- **Commit-by-commit diff reading**, including reading the D-115 "made outside Flywheel" markers in
  situ. Rejected in D-134 as a second diff mode; worth revisiting if whole-branch reading proves
  too coarse.
- **A split diff view**, rejected in D-136 on width grounds. `react-diff-view` serves it from the
  same parsed hunks, so it remains a toggle away if the rails ever collapse.
- **A free-text note alongside a criterion anchor**, rejected in D-139 in favour of the anchor
  itself. It captures reasoning a line range cannot and would be additive.
- **Editing a file during review**, which is what the Monaco alternative in D-135 would have
  bought. Out of scope for a review surface.

### Reviewed Todos (not folded)

`todo.match-phase 8` returned ten matches; none were folded. All ten scored on the bare keyword
"review" or on `area: core` rather than on this phase's subject matter, and every one is a Phase 7
defect or an unrelated backlog item. Folding any of them would widen this phase rather than clarify
it. Listed here so a future phase knows they were considered:

- `git_identity builds a table name into SQL with format!, against the crate convention` (core) —
  Phase 7 defect, unrelated to review or merge.
- `Live-chain tests inconsistently assert that the fake CLI was actually reached` (core) — test
  hygiene, unrelated.
- `Timeout-boundary race misreports a child that just finished as TimedOut` (core) — supervision,
  unrelated.
- `Subprocess timeout guard leaks reader threads under a sustained forge outage` (core) — Phase 7
  forge polling, unrelated to this phase's forge use.
- `Socratic challenge should be structured like GSD's questioning, not one wall of questions`
  (authoring) — Phase 5 scope.
- `Forge resolution failures are not memoised, so they retry per worktree every tick` (desktop) —
  Phase 7 polling defect.
- `Forge-sourced URLs reach an anchor href without scheme validation` (desktop) — Phase 7 defect;
  adjacent, since this phase adds an epic request link, but the fix belongs where the defect is.
- `Adapter drops assistant text when a stream line carries text and tool_use` (general) —
  adapter-layer, unrelated.
- `G-05-8 AskUserQuestion invisible and board unwritable in live run` (tooling) — unrelated.
- `Handoff sheet drops questions the agent asked` (tooling) — unrelated.

</deferred>

---

*Phase: 8-Review And Merge Inside Flywheel*
*Context gathered: 2026-10-05*
