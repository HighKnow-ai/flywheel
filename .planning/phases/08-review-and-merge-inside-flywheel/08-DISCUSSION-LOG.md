# Phase 8: Review And Merge Inside Flywheel - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-05
**Phase:** 8-Review And Merge Inside Flywheel
**Areas discussed:** Review surface & layout, Diff rendering engine, Criteria-to-diff binding, Merge & conflict behaviour

---

## Review surface & layout

### Where does diff review happen?

| Option | Description | Selected |
|--------|-------------|----------|
| A fourth full surface | A `ReviewSurface` alongside `SessionSurface`/`TriageSurface`/`SettingsSurface` — pushed into from a task or epic, popped back to the board. Reuses the shell pattern three surfaces already follow; the diff gets the full window; the board keeps its filters and scroll underneath. | ✓ |
| A section in ItemDetailPanel | Diff renders as another section under `WorktreeSummary`/`GitFactsSection`, beneath the criteria list it is read against. No new surface or navigation — but a real diff competes for width with a panel already carrying criteria, worktree, runs, forge and activity trail. | |
| A full-screen overlay | Diff opens as a modal layer like `OrphanRecoveryModal`/`LaunchSheet`. Reachable from anywhere including mid-session, dismissed with Escape — but review is a sit-down activity and a modal is the wrong shape for something you stay in for ten minutes. | |

**User's choice:** A fourth full surface
**Notes:** Chosen with the three-pane preview (criteria rail / diff pane) in view. → D-131

### Task vs. epic — one surface or two?

| Option | Description | Selected |
|--------|-------------|----------|
| One surface, scope toggle | Same `ReviewSurface` for both; a header control switches between "this task" and "the whole epic". One component, one keyboard map, and the task→epic hop costs no navigation. | ✓ |
| Task scope only in v1 | `ReviewSurface` reviews a task; the epic's accumulated diff (REVW-02) renders as a read-only section on the epic's `ItemDetailPanel`. Smaller build — but the epic diff then lives somewhere the task diff does not. | |
| Two separate surfaces | A task review surface and an epic review surface, each tuned to its own job. Clearest intent per surface, but two components to keep in agreement and two keyboard maps. | |

**User's choice:** One surface, scope toggle
**Notes:** → D-132

### How do you get into the ReviewSurface?

| Option | Description | Selected |
|--------|-------------|----------|
| Action on the item panel | A "Review" affordance on `ItemDetailPanel` next to Start Work — the convention `onStartWork` already follows. | ✓ |
| Board-list keyboard action | A single-key action on the focused board card, as `w` already opens Start Work (`BoardView.tsx` action ids). | ✓ |
| Command palette | `CommandPalette.tsx` already resolves git identifiers (D-127) — "review FW-42", or paste a branch/commit and land on its review. | ✓ |
| From the session surface | When an agent run finishes, the session surface offers "Review this work". | ✓ |

**User's choice:** All four (multi-select)
**Notes:** → D-133

### What else does the surface carry?

| Option | Description | Selected |
|--------|-------------|----------|
| File list + whole-branch diff | A file list from `diff_stat_and_names` to jump around, and the diff is always the full branch against its target — one diff, one truth. | ✓ |
| Add a commit selector | Same, plus the commit list from `git_facts.rs` to read one commit at a time, including "made outside Flywheel" markers (D-115) in situ. More faithful to how work arrived, but two diff modes and a decision before reading anything. | |
| Just criteria + diff | One continuous diff you scroll, criteria beside it. Fewest moving parts and the virtual scroller carries it, but navigating a 20-file diff means scrolling past everything already read. | |

**User's choice:** File list + whole-branch diff
**Notes:** → D-134

---

## Diff rendering engine

### What renders the diff?

| Option | Description | Selected |
|--------|-------------|----------|
| react-diff-view + refractor | Purpose-built unidiff parser and renderer with a decoration API that lets a diff line carry a criterion anchor. Two small new deps, no editor runtime. | ✓ |
| Monaco DiffEditor | A real editor: highlighting for every language, split view, and the option to edit during review. But a multi-megabyte editor runtime inside a Tauri WebView, with an editor-shaped rather than diff-line-shaped decoration model. | |
| Hand-rolled over react-virtual | Parse unified diff ourselves, render through the installed virtualizer, highlight with Shiki or Prism. Zero new rendering deps and total control — but re-implements hunk parsing, word-level intra-line diff and expand-context. | |

**User's choice:** react-diff-view + refractor
**Notes:** The decoration API was the deciding factor; it is what the criteria-anchor decision depends on. → D-135

### Unified or split view?

| Option | Description | Selected |
|--------|-------------|----------|
| Unified, no toggle | One column of +/- lines. The surface already spends width on a criteria rail and file list; unified reads at any width. One mode, nothing to persist. | ✓ |
| Unified default, split toggle | Both modes, unified wins on open, the choice persists. Split is better for a rewritten function side by side; `react-diff-view` serves both from the same hunks. | |
| Split default | Side-by-side on open. Closest to a desktop merge tool — but both columns wrap badly after two rails, and most agent diffs are additive. | |

**User's choice:** Unified, no toggle
**Notes:** → D-136

### A task branch touches 60 files and 8000 changed lines — what does the surface do?

| Option | Description | Selected |
|--------|-------------|----------|
| File list eager, patches lazy | File list renders immediately from `diff_stat_and_names`; each file's patch is fetched and parsed only when opened; files open collapsed with their stat line. Nothing truncated or hidden. | ✓ |
| Load everything, virtualize | One `git diff` for the whole branch, parsed up front, rendered through react-virtual. Continuous scroll with no per-file click — but parsing an 8000-line unidiff stalls the surface on open, and a lockfile alone can be most of it. | |
| Hard per-file line cap | Any file over N changed lines renders its stat line and a "too large to display" notice with a button out to the editor. Bounds the worst case — but the app then sometimes refuses to show you the diff. | |

**User's choice:** File list eager, patches lazy
**Notes:** → D-137

### Does the review diff include uncommitted worktree changes?

| Option | Description | Selected |
|--------|-------------|----------|
| Committed only, with a banner | The diff is the branch against its merge-base — what a merge would actually bring. A dirty worktree raises a banner at the top naming the file count. | ✓ |
| Include them, marked distinctly | Committed and uncommitted hunks both render, visually separated. You see everything the agent did in one read — but the diff no longer equals what merging lands, and a criterion could be satisfied by work that never ships. | |
| A toggle between the two | Committed-only by default, with a control to fold uncommitted work in. Both readings on demand — but a second diff mode on a surface that just chose to have one. | |

**User's choice:** Committed only, with a banner
**Notes:** Banner copy from the preview: "⚠ 3 files uncommitted in the worktree — not in this diff, and a merge will not carry them." → D-138

---

## Criteria-to-diff binding

### What does checking a criterion during review record?

| Option | Description | Selected |
|--------|-------------|----------|
| Anchor to a diff location | Select a hunk or line range, then check the criterion against it. The check stores file + line range + the sha it was read at. The rail shows which criteria have evidence and which were waved through. | ✓ |
| Check plus an optional note | Free-text note typed while the diff is on screen. Captures reasoning a line range cannot and feeds the context packet as prose — but nothing connects a criterion to code. | |
| Plain check beside the diff | Today's `AcceptanceCriteriaList` in the rail with the diff next to it. Zero schema change, zero new interaction — but the record afterwards is indistinguishable from checking criteria off the board blind. | |

**User's choice:** Anchor to a diff location
**Notes:** `acceptance_criteria` carries only a bare `checked` boolean today, so this is new storage. → D-139

### Is an anchor required to check a criterion?

| Option | Description | Selected |
|--------|-------------|----------|
| Optional, absence is visible | You can always just check the box; a check with no anchor renders a quiet "no evidence" marker. Same discipline as D-123: never block, always make the gap impossible to miss. | ✓ |
| Required — no anchor, no check | Every check is real evidence by construction — but "the suite still passes" has no line to point at, so it becomes uncheckable and the user works around the product. | |
| Required, with an explicit waive | Anchor by default; a separate "waive" action records who waived it and when. Strongest record — but a second mutation path and an extra decision on every unanchorable criterion. | |

**User's choice:** Optional, absence is visible
**Notes:** → D-140

### The anchored file is rewritten by later commits — what happens to the anchor?

| Option | Description | Selected |
|--------|-------------|----------|
| Mark it stale, keep the check | The anchor keeps its sha; the rail reads "verified at a3f91c, that file has moved since". Nothing is unchecked behind the user's back. | ✓ |
| Mark stale and uncheck it | Review genuinely has to happen again against the new code. Strongest correctness story — but it is the board silently overwriting the user's own mark, the failure D-121 exists to prevent. | |
| Keep it, no staleness notion | The anchor is a historical record of what was read and when. Simplest, and the sha is right there — but "all criteria checked" then says nothing about the branch as it stands. | |

**User's choice:** Mark it stale, keep the check
**Notes:** → D-141

### Does the context packet carry anchors?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, anchors and staleness | Each criterion in the packet gains its anchor and whether it is stale: "criterion 2 was verified at retry.rs:13-21, which you have since rewritten". | ✓ |
| Criteria only, not anchors | The packet keeps today's shape. Small and unambiguous — but the agent cannot know its own later commit invalidated a verification someone already did. | |
| Anchors only when stale | Mentions an anchor only where it has gone stale. Almost free, surfaces only the actionable case — but no positive signal about what is already confirmed. | |

**User's choice:** Yes, anchors and staleness
**Notes:** `context_packet.rs`'s `CRITERIA_SQL` currently selects `statement, verification_hint` only and carries no `checked` state at all — this widens that read. → D-142

---

## Merge & conflict behaviour

### Where does the merge run?

| Option | Description | Selected |
|--------|-------------|----------|
| A per-epic integration worktree | Each epic gets its own worktree on its integration branch; merges land there. Task worktrees are never touched, and the epic's accumulated diff has a real checkout to read from. | ✓ |
| In the task's own worktree | Check out the integration branch there, merge, switch back. No extra worktree — but it mutates a directory an agent may be mid-session in, and a conflict leaves that worktree conflicted for the agent to inherit. | |
| Bare, in the main repo | Merge refs directly with no working tree. Nothing to create or leave dirty — but a non-trivial merge needs a working tree, so only fast-forwards and clean merges work and the conflict path has nowhere to land. | |

**User's choice:** A per-epic integration worktree
**Notes:** `git_retry.rs` already provides `with_lock_retry` and per-repo `wait_turn` serialization. → D-143

### The merge conflicts — what does Flywheel do?

| Option | Description | Selected |
|--------|-------------|----------|
| Abort, name the files, offer a resolve run | `git merge --abort` immediately — the integration worktree is never left conflicted. The surface names the conflicted files and offers to start an agent session on the task with that conflict as its brief. | ✓ |
| Leave it conflicted, show the files | The merge stays in progress; the surface lists conflicted files and routes out to an editor or terminal. Matches git expectations — but leaves a half-merged worktree to remember, and the next attempt fails confusingly. | |
| Abort and resolve conflicts in-app | Three-way resolution inside the `ReviewSurface`. Fully closes the loop — but an in-app merge tool is its own product, and `react-diff-view` renders diffs, not conflict resolution. | |

**User's choice:** Abort, name the files, offer a resolve run
**Notes:** → D-144

### What happens to the task's status after a successful local merge?

| Option | Description | Selected |
|--------|-------------|----------|
| Integrated marker, no status move | A visible "merged into FW-7" marker plus an `events` row; the column does not change. Respects D-122's forward-only forge-driven rule — landing in an integration branch is not shipping. | ✓ |
| Move the task to In Review | A merged task is past coding, and the board drains visibly as work lands. But D-122 names request-opened as the one trigger for In Review, giving that column two owners with different semantics. | |
| Move the task to Done | Simplest mental model and the board clears as you merge — but it contradicts D-122, and a task marked Done can still be lost if the epic's branch is never merged. | |

**User's choice:** Integrated marker, no status move
**Notes:** The question was posed with D-122 and D-29 stated explicitly. → D-145

### Does merging need a confirmation, and does destructive.rs classify it?

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm sheet, not the destructive gate | `destructive.rs` classifies what agents try to run, so it stays out. The surface shows source, target, commit count, unchecked-criteria count and dirty-worktree warning before anything happens — the launch sheet's "see it before you spend it" shape applied to a git write. | ✓ |
| Merge immediately, no confirmation | One action, it merges, the result is reported. A merge into an integration branch is cheap and reversible — but the warnings then have nowhere to land before the fact. | |
| Route it through destructive.rs | One gate and audit trail for all git writes, and Phase 12's trust-boundary redesign covers it for free — but that gate exists to judge agent-issued commands, not the user's own deliberate action. | |

**User's choice:** Confirm sheet, not the destructive gate
**Notes:** → D-146

---

## Claude's Discretion

Two gray areas were identified and offered at the end of the discussion; the user chose to leave
them to research and planning because both are reuse-shaped rather than genuinely open:

- The epic-level request action — whether it reuses `ForgeSection.tsx`'s deterministic-draft /
  preview / confirm shape from plan 07-09, and how the epic integration branch's own target is
  derived from D-25/D-26.
- The `ReviewSurface` keyboard map — expected to extend the conventions
  `AcceptanceCriteriaList.tsx` and the board list already set.

Also left to discretion: binary files and renames in the diff, generated-file detection,
whitespace handling, the shape of the patch-text command crossing the IPC boundary, merge commit
style, and whether the integration branch is pushed after a merge.

## Deferred Ideas

- Conflict resolution inside Flywheel (rejected in D-144 as its own product).
- Commit-by-commit diff reading, including reading D-115 outside-commit markers in situ (rejected
  in D-134 as a second diff mode).
- A split diff view (rejected in D-136 on width grounds; a toggle away from the same parsed hunks).
- A free-text note alongside a criterion anchor (rejected in D-139 in favour of the anchor itself).
- Editing a file during review (what the Monaco alternative in D-135 would have bought).

### Todos reviewed and not folded

`todo.match-phase 8` returned ten matches. None were folded, and the fold prompt was skipped rather
than put to the user: all ten scored on the bare keyword "review" or on `area: core` rather than on
this phase's subject matter, and every one is a Phase 7 defect or an unrelated backlog item. The
full list with reasons is recorded in `08-CONTEXT.md` under `<deferred>`.
