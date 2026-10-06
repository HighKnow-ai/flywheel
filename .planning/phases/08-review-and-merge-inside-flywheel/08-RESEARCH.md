# Phase 8: Review And Merge Inside Flywheel - Research

**Researched:** 2026-10-06
**Domain:** Tauri v2 + Rust core git read/write layer, React diff review surface, SQLite criterion-evidence storage, forge request for an epic branch
**Confidence:** HIGH on the git/merge/diff mechanics (each one executed against git 2.54.0 in a scratch repo this session) and on the in-repo integration seams (every file named below was opened). MEDIUM on the forge-fallback and Tauri threading recommendations (flagged `[ASSUMED]` where applicable).

<user_constraints>
## User Constraints (from CONTEXT.md)

Decision text below is copied verbatim from `08-CONTEXT.md`. The "Rejected:" paragraphs and
"Reversibility" notes are omitted for length — they are in `08-CONTEXT.md` and still bind.

### Locked Decisions

- **D-131:** **Review is a fourth full surface — `ReviewSurface` — pushed into from the board and
  popped back out of.** It takes its shape from the three surfaces `App.tsx` already switches
  between on exactly this pattern: `SessionSurface` (D-31), `SettingsSurface` (D-39) and
  `TriageSurface` (D-103). The board underneath keeps its filters, selection and scroll untouched,
  and the diff gets the full window minus the project rail.
- **D-132:** **One surface serves both scopes, with a header toggle between "this task" and "the
  whole epic".** Task scope renders the task's own criteria rail; epic scope renders the epic's
  criteria plus a roll-up of its tasks. One component, one keyboard map, and the task → epic hop
  mid-review costs no navigation — which matters because the epic diff is what you read
  immediately before opening its request (REVW-05).
- **D-133:** **Four entry points, all of them reusing an existing affordance convention.** A
  "Review" action on `ItemDetailPanel.tsx` beside Start Work (the convention `onStartWork` already
  follows); a single-key action on the focused board card, as `w` already opens Start Work from the
  board list (`board/BoardView.tsx` action ids); the command palette, which already resolves git
  identifiers under D-127, so a branch or commit can land you on its review; and an offer from the
  session surface when a run finishes, which is the moment review is most likely wanted.
- **D-134:** **Three panes: criteria rail, file list, diff — and the diff is always the whole branch
  against its target.** The file list comes from `git.rs::diff_stat_and_names`, which already
  exists and is already cheap, and exists to let you jump around a multi-file branch rather than
  scroll past what you have already read.
- **D-135:** **`react-diff-view` plus `refractor` for highlighting.** Purpose-built unidiff parsing
  and rendering, and — decisively — a decoration API that lets a diff line carry a criterion
  anchor, which is exactly what D-143 needs. Neither library is in `packages/desktop/package.json`
  today; nothing in the workspace renders a diff at all.
- **D-136:** **Unified view only — no split, no toggle.**
- **D-137:** **The file list is eager, the patches are lazy, and nothing is ever truncated.** The
  file list renders immediately from `diff_stat_and_names`; each file's patch text is fetched and
  parsed only when that file is opened, and files open collapsed showing their stat line.
- **D-138:** **The diff is committed work only — the branch against its merge-base — and a dirty
  worktree raises a banner naming the file count.**
- **D-139:** **Checking a criterion during review records an anchor: file, line range, and the sha
  it was read at.** You select a hunk or line range in the diff, then check the criterion against
  it. `acceptance_criteria` today carries `statement`, `verification_hint` and a bare `checked`
  boolean — nothing about *why* — so this is new storage.
- **D-140:** **An anchor is optional, and its absence is visible.** You can always just check the
  box; a criterion checked without an anchor renders a quiet "no evidence" marker in the rail and
  in the item panel.
- **D-141:** **When the anchored file changes afterwards, the anchor is marked stale and the check
  stands.** The anchor keeps its sha and the rail reads "verified at a3f91c, that file has moved
  since". Nothing is unchecked behind the user's back.
- **D-142:** **The context packet carries each criterion's anchor and whether it is stale.** Note
  that `context_packet.rs`'s `CRITERIA_SQL` currently selects `statement, verification_hint`
  only; it carries no `checked` state at all today, so this widens that read.
- **D-143:** **Merges land in a per-epic integration worktree, checked out on the epic's
  integration branch.** The task worktree is never touched, so an agent still working in it cannot
  collide with a merge, and the epic's accumulated diff (REVW-02) has a real checkout to read from.
- **D-144:** **A conflict aborts immediately, names the conflicted files, and offers to start an
  agent session on the task with that conflict as its brief.** `git merge --abort` runs at once, so
  the integration worktree is never left conflicted.
- **D-145:** **A successful local merge raises an "integrated into {epic}" marker and an `events`
  row, and moves no status.** Landing in an integration branch is not shipping; the epic's own
  request is, and D-122 reserves In Review for request-opened and Done for request-merged.
- **D-146:** **A confirm sheet precedes the merge, and `destructive.rs` stays out of it.** The sheet
  shows source branch, target branch, commit count, file count, the number of criteria checked
  without evidence (D-140) and any dirty-worktree warning (D-138).

### Claude's Discretion

- **The epic-level request action.** REVW-05 is epic-scoped, while `ForgeSection.tsx` and
  `forge::create_request_at` are task-scoped today. The expectation is that the epic action reuses
  the same deterministic-draft-then-preview-then-confirm shape plan 07-09 established (the
  component passes an id alone, never a title or body, which is what makes previewed text and
  published text the same text by construction), and that the epic integration branch's own target
  is derived the way D-25/D-26 already derive a task's.
- **The `ReviewSurface` keyboard map.** Expected to follow the conventions
  `AcceptanceCriteriaList.tsx` and the board list already set (`j`/`k` between rows, `Space`/`Enter`
  to toggle, single-key actions, Escape to pop back), extended to the file list and diff panes.
- Also at Claude's discretion: binary files and renames in the diff, generated-file detection,
  whitespace handling, the shape of the patch-text command crossing the IPC boundary, merge commit
  style, and whether the integration branch is pushed after a merge.

### Deferred Ideas (OUT OF SCOPE)

- Conflict resolution inside Flywheel (three-way resolution pane).
- Commit-by-commit diff reading, including reading the D-115 "made outside Flywheel" markers in situ.
- A split diff view.
- A free-text note alongside a criterion anchor.
- Editing a file during review.
- Phase 7 defects listed under "Reviewed Todos (not folded)" in `08-CONTEXT.md`.
- Out of phase (Boundary): any change to how the forge is detected, called or polled (Phase 7
  owns that); worktree creation and removal mechanics (Phase 3 owns those — this phase only asks
  for one more worktree per epic); anything that moves a task to Done (D-122 holds).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVW-01 | Review a task's full diff inside the application with syntax highlighting | New `git.rs` reads `review_files` (`--numstat`+`--name-status`, `-z`, `-M`) and `review_patch` (per-file, `<base>...<head>`); `react-diff-view@3.3.3` + `refractor@5.0.0` through a 1-line adapter (§Standard Stack, §Code Examples 1-3). |
| REVW-02 | Review the accumulated diff of an epic's integration branch | Same two reads with scope=epic: `<default_branch>...<epics.integration_branch>`; integration branch is lazily cut so "not cut yet" is an explicit empty state (§Pitfall 7). |
| REVW-03 | Check off a task's acceptance criteria against the diff | New table `criterion_anchors` (migration `0018`), a `check_criterion_with_anchor` domain fn beside `toggle_criterion`, line anchors via react-diff-view `widgets` + `selectedChanges` + `gutterEvents` (§Pattern 4). |
| REVW-04 | Merge a task branch into its epic integration branch in-app, conflicts surfaced | `git merge-tree --write-tree` dry-run (no state touched) → `git merge --no-ff` in a per-epic integration worktree → `git merge --abort` safety net; per-epic in-process mutex (§Pattern 3, §Pitfalls 1-3). |
| REVW-05 | Open a PR/MR for an epic integration branch in one action | New `assemble_epic_request_draft` + push-then-`create_request_at` (existing connection-free seam) behind a preview/confirm sheet (§Pattern 5). |
</phase_requirements>

## Summary

Phase 8 is overwhelmingly a **composition** phase: every primitive it needs already exists in
`packages/core` (single git construction site `git::git_at`, branch derivation `branch.rs`,
worktree add/prune precedent in `domain/worktree.rs`, the connection-free forge dispatch
`forge::create_request_at`, the `board:changed` push, the events log) or in `packages/desktop`
(the surface chain in `App.tsx`, `AcceptanceCriteriaList.tsx`, the `ForgeSection.tsx`
preview-then-confirm shape, `useRegionBindings`). The genuinely new work is four narrow things:
(1) a handful of new `git.rs` reads/writes — **none of which can reuse `git_at` as-is**, because it
converts any non-zero exit into an `Err` and discards stdout, which is exactly what `git merge-tree`
and `git merge` use to signal "conflict" (a real finding, §Pitfall 1); (2) a `criterion_anchors`
table and the check-with-anchor write; (3) the `ReviewSurface` and its lazy per-file diff rendering;
(4) an epic-scoped draft/push/open path.

Two statements in `08-CONTEXT.md` need correcting before planning, both verified here. First,
`git.rs::diff_stat_and_names` is **not sufficient** for the file list: it returns git's `--stat`
text (whose paths are truncated with `...` at 80 columns — verified) plus a bare `--name-only` list,
with `--no-renames` baked in for the drift detector. The review file list needs per-file
status, added/removed counts and rename pairs, which is a different, additive read (`--numstat -z`
+ `--name-status -z -M`). Do not change `diff_stat_and_names` — `drift.rs` depends on its
`--no-renames` semantics. Second, in `react-diff-view` the "decoration API" (`Decoration`) wraps
*hunks*, not lines; the line-level anchor hook D-135/D-139 want is `widgets` + `selectedChanges` +
`gutterEvents`/`renderGutter`, which is just as good (§Pattern 4) but is a different API from the one
named. Also: **react-diff-view 3.3.3 does not work with refractor 5.x as documented** — passing the
refractor object throws; a one-line adapter (`highlight: (t, l) => refractor.highlight(t, l).children`)
fixes it and was verified this session. The README tells you to pin refractor@3, which drags in an
old `prismjs`; do not follow that.

Two further plan-shaping facts: all existing Tauri commands are synchronous `fn`s, which Tauri runs
**on the main thread** — fine for a SQLite read, not for a `git merge` or `git push` that can run
for seconds; the new git-shelling commands must be `#[tauri::command(async)]`. And `git_retry`'s
`SpawnFloor::wait_turn` is a *spacing* floor, not a mutex — it does not serialise two merges into the
same integration worktree, so the merge command needs its own per-epic in-process lock.

**Primary recommendation:** Build the tracer as one vertical slice — `review_files`/`review_patch`
core reads → two Tauri commands → a minimal lazy `ReviewSurface` rendering one highlighted file —
then add, in this order: criterion anchors, merge (dry-run → merge → abort-on-failure, per-epic
lock, integration worktree), epic scope, epic request. Use the system `git` CLI through `git.rs`
everywhere; do not add `git2` (it is not in `Cargo.lock`, and the one-construction-site gate
`supervisor_cwd.rs` assumes a single process-spawn path).

## Project Constraints (from CLAUDE.md)

Source: `.claude/CLAUDE.md` (project instructions).

- **Single Tauri adapter seam:** only `packages/desktop/src/adapters/tauri.ts` may import `@tauri-apps/api`. Every new command is a thin typed wrapper there (`invokeCommand<T>`); components never import `invoke`. (Verified: `adapters/tauri.ts` header, lines 1-9.)
- **Git:** the system `git` CLI shelled via the existing wrapper for worktree/branch/merge lifecycle; `git2` is only suggested for "hot-path reads". The codebase has **no** `git2` dependency and `supervisor_cwd.rs` asserts one `Command::new("git")` site. Recommendation: stay CLI-only (§Alternatives).
- **SQLite is Rust-owned** (`rusqlite` in the core; the sidecar never opens the DB). Migrations via `rusqlite_migration` — add `0018_*.sql`, never hand-roll versioning.
- **Server state in TanStack Query, UI state in Zustand** — keep review diff/criteria reads in `useQuery`, only surface-open/scope in `useUiStore`.
- **Local-first, credentials never leave the desk;** forge auth stays with `gh`/`glab` (D-117) — no token handling in Phase 8.
- **GSD workflow enforcement:** all edits go through a GSD command. Not a research concern, noted for the planner.
- **User memory (workspace):** prefer *automated* verification over manual UAT; UI should read bold and modern; authoring/UI flows are structured and UI-driven. Validation Architecture below is therefore test-first, with manual checks limited to visual polish.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Diff generation (file list, per-file patch, merge-base resolution) | Rust core (`packages/core/src/git.rs`) | — | One git construction site (PROC-02); renderer never names a ref or a git flag — it passes scope + id, core derives base/head from the board. |
| Scope resolution (task/epic → repo path, base ref, head ref, integration worktree) | Rust core (`review.rs`, new) | Tauri command layer | Derived from `tasks`/`epics`/`projects`/`epics.integration_branch` per D-25/D-26; mirrors `request_body.rs` target derivation. |
| Merge pre-check, merge, abort, push | Rust core (`git.rs` + `review.rs`) | Tauri command (async) | Git writes belong beside the event log; command only resolves under the DB lock, drops it, runs git, re-locks to append the event. |
| Per-epic merge mutual exclusion | Tauri `AppState` (in-process) | — | `SpawnFloor` only spaces spawns; real exclusion needs a lock keyed by epic id. |
| Criterion anchor storage + staleness | Rust core (`domain/acceptance_criterion.rs`, migration `0018`) | `context_packet.rs` | Storage in SQLite; staleness derived at read time from git (D-75), never stored. |
| Syntax highlighting + diff rendering | Browser / Client (React, `react-diff-view`, `refractor`) | — | Pure presentation of patch text the core already produced. |
| Criteria check interaction (select lines → check) | Browser / Client | Rust core (write) | UI owns selection state; the write is one Tauri command carrying `criterionId + path + side + lines`; sha is resolved **server-side**, never client-supplied. |
| Epic request draft / open | Rust core (`forge/request_body.rs`, `forge/mod.rs`) | Tauri command (async) | Reuses the connection-free `create_request_at`; the renderer passes an `epicId` alone. |
| Surface routing / keyboard | Browser / Client (`App.tsx`, `uiStore.ts`, `state/keyboard.ts`) | — | Fourth surface in the existing chain. |

## Standard Stack

### Core (new dependencies — `packages/desktop/package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react-diff-view` | 3.3.3 (published 2026-03-30) `[VERIFIED: npm registry]` | Unidiff parse (`parseDiff`), render (`Diff`/`Hunk`), tokens, widgets, change selection | Locked by D-135. Peer `react >=16.14.0` (project is React 19). MIT. Deps: `classnames, diff-match-patch, gitdiff-parser, lodash, shallow-equal, warning`. |
| `refractor` | 5.0.0 (published 2025-03-11) `[VERIFIED: npm registry]` | Prism-based tokenizer producing hast nodes | Locked by D-135. **Use 5.x with the adapter below**, not the README's "use refractor@3". |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-virtual` | 3.14.11 (already installed) | Virtualise the file list only if >~200 files | Optional; a 60-file list needs no virtualiser. Do not try to virtualise `react-diff-view`'s `<table>` rows. |
| `@tanstack/react-query` | 5.102.8 (already installed) | Diff/criteria/merge-state reads | Follow `useForgeRequest` (`staleTime: 0`, invalidated by `subscribeBoardChanged`). |
| `zustand` | 5.0.15 (already installed) | `reviewSurface` open/scope field | Same one-field-one-writer pattern as `triageSurfaceProjectId`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| System `git` CLI via `git.rs` | `git2` (libgit2) | Not in `Cargo.lock`; adds a C dependency and a second spawn-free path that bypasses PROC-02; libgit2 worktree/merge semantics lag the CLI (project CLAUDE.md says the same). A 20-file review is 2-3 process spawns — not a hot path. **Do not add.** |
| `refractor@5` + adapter | `refractor@3` per README | 3.x pins `prismjs ~1.27` (older than current fixes). Adapter is one line and verified. |
| Hand-rolled criterion anchor columns on `acceptance_criteria` | Separate `criterion_anchors` table | Recommended: table (§Pattern 2). Columns would force edits to ~8 positional `row.get(N)` constructors of `AcceptanceCriterion`. |

**Installation:**
```bash
cd packages/desktop && npm install react-diff-view@3.3.3 refractor@5.0.0
```
Pin both exactly (the repo pins exact versions everywhere in `package.json`).

**Version verification:** `npm view react-diff-view version` → `3.3.3`; `npm view refractor version` → `5.0.0`; both confirmed this session `[VERIFIED: npm registry]`.

**Bundle weight (measured):** `esbuild --bundle --minify` of `react-diff-view` (Diff, Hunk, parseDiff, tokenize) + `refractor/core` + 15 languages (rust, typescript, tsx, javascript, jsx, json, css, markdown, yaml, toml, bash, sql, python, go, markup), react external → **124 kB minified / 44 kB gzip** `[VERIFIED: esbuild run in scratch dir]`. `lodash` is a transitive dependency of `react-diff-view` (not tree-shakeable through its CJS entry), so some of that 124 kB is lodash. Import languages individually from `refractor/<lang>` and `refractor/core` — **never** `refractor/all` or the bare `refractor` entry (`lib/common.js`), which register 100s of grammars. Lazy-load `ReviewSurface` with `React.lazy` so the board's cold start pays nothing.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `react-diff-view` | npm | ~9 yrs (created 2017-09) | ~335k/wk | github.com/otakustay/react-diff-view | OK | Approved (named in D-135; `gsd-tools query package-legitimacy check` → OK; no postinstall) |
| `refractor` | npm | ~9 yrs (created 2017-08) | ~12.7M/wk | github.com/wooorm/refractor | OK | Approved (named in D-135; seam → OK; no postinstall) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
Transitive (not independently audited, ride along with `react-diff-view`): `gitdiff-parser@0.3.1` (last published 2023-03), `diff-match-patch`, `lodash`, `classnames`, `shallow-equal`, `warning`. `gitdiff-parser` is the one low-activity package; it is the unidiff parser inside the locked library.

## Architecture Patterns

### System Architecture Diagram

```
 BOARD (BoardView 'v' / ItemDetailPanel "Review" / palette / SessionSurface finish offer)
   │  setReviewSurface({ scope:"task"|"epic", itemId })        (useUiStore, one field one writer)
   ▼
 App.tsx chain: settings → triage → [review] → session → unreachable → Board
   │
   ▼
 ReviewSurface (React.lazy)  ── header: ← Board · FW-42 title · [Task|Epic]
   │
   ├─ CriteriaRail ──────────► criterion_list / review_criteria_state ──► criterion_anchors (+ git staleness)
   │       ▲ "check against selection"
   ├─ FileList ───────────────► review_files(scope)            (eager, 1 call)
   │                                  │
   └─ FileDiff (per open file) ─► review_file_patch(scope,path,oldPath)   (lazy, on expand)
            │  parseDiff → tokenize(refractor adapter) → <Diff widgets selectedChanges gutterEvents>
            │  user selects lines ─► criterion_check_with_anchor(criterionId,path,side,start,end)
            ▼
 Tauri commands (commands/review.rs, #[tauri::command(async)])
   lock DB → resolve scope (repo_path, base_ref, head_ref, epic worktree) → DROP lock
   │
   ▼  packages/core
 review.rs ── git.rs (git_at | git_output_at) ──► `git diff … <base>...<head>`  (project repo_path, branch refs only)
   │
   ├─ merge path:  per-epic Mutex ─► merge-tree --write-tree (dry run) ─┬ conflict → files[] → event, NO worktree touched
   │                                                                    └ clean → ensure epic worktree → require clean
   │                                                                              → git merge --no-ff -m … <task branch>
   │                                                                              → fail? MERGE_HEAD present → merge --abort
   │                                                                              → re-lock DB → append `task.integrated` event
   │                                                                              → emit board:changed
   └─ epic request: assemble_epic_request_draft(&Connection) → preview → confirm
                    → git push origin <integration>  (main checkout, plain, never --force)
                    → forge::create_request_at(forge, repo_path, &draft)  → gh/glab
```

### Recommended Project Structure

```
packages/core/src/
├── git.rs                      # + git_output_at, review_files, review_patch, merge_tree_check,
│                               #   merge_no_ff, merge_abort_if_in_progress, worktree_add_existing, push_branch
├── review.rs                   # NEW: ReviewScope resolution, ensure_epic_worktree, merge_task_into_epic,
│                               #      integrated_task_ids, anchor staleness
├── forge/request_body.rs       # + assemble_epic_request_draft (sibling of assemble_request_draft)
├── domain/acceptance_criterion.rs  # + check_criterion_with_anchor, clear anchor on uncheck, copy anchor in revise
├── context_packet.rs           # widen CRITERIA_SQL + render (D-142)
└── db/migrations/0018_criterion_anchors.sql   # + register in db/mod.rs migration_source_list
packages/core/tests/            # review_diff.rs, review_merge.rs, criterion_anchors.rs, epic_request_draft.rs
packages/desktop/src-tauri/src/commands/review.rs   # NEW; add `pub mod review;` + generate_handler! entries
packages/desktop/src/review/
├── ReviewSurface.tsx  CriteriaRail.tsx  FileList.tsx  FileDiff.tsx  MergeConfirmSheet.tsx
├── highlight.ts       # refractor core + registered languages + extension→language map + adapter
└── useReviewQuery.ts  # hooks (same style as useForgeRequest)
```

### Pattern 1: Diff reads — two additive functions, ranges by merge-base

**What:** The review diff is always `<base>...<head>` (three-dot = diff against the merge-base). Base/head are derived server-side from the board:

| Scope | head | base |
|-------|------|------|
| task with epic | `worktrees.branch` (task branch) | `epics.integration_branch` (**local** branch, not `origin/…`) |
| task without epic (D-26) | task branch | `projects.default_branch` |
| epic | `epics.integration_branch` | `projects.default_branch` |

Run against the **project `repo_path`** (branch refs only), not the task worktree: review then survives worktree removal (Phase 3) and needs no checkout. Use the task worktree path only for the dirty-banner porcelain read (reuse `domain::worktree::porcelain_entries` — the one porcelain site — or the existing `useGitFacts().uncommitted`).

**Why local, not `origin/`:** `git_facts.rs` computes `target_ref` as `origin/<integration>`, but the integration branch is created *locally* (`ensure_epic_integration_branch`: `["branch", &branch_name, &default_branch]`, `epic.rs:767`) and never pushed, so that ref does not exist and ahead/behind is withheld. The review base must be the local branch, because D-143 merges land in the local branch.

**File list** — two calls, NUL-delimited so paths with spaces/newlines/quotes are safe (verified output shapes):
```
git diff -z --numstat     -M <base>...<head>   →  "1\t1\tf.txt\0"  ;  rename: "0\t0\t\0old\0new\0"  ;  binary: "-\t-\tbin.dat\0"
git diff -z --name-status -M <base>...<head>   →  "M\0f.txt\0A\0h.txt\0"  ;  rename: "R100\0old\0new\0"
```
**Per-file patch:**
```
git --literal-pathspecs diff --no-color --no-ext-diff --no-textconv -U3 -M <base>...<head> -- <new_path> [<old_path>]
```
Rename gotcha (verified): with `-M` and a pathspec of **only** the new path, git shows the file as a brand-new file (`new file mode`, no `rename from/to`); you must pass **both** old and new paths in the pathspec to get the rename. So `review_files` must return `old_path` for renames and the patch command must accept it.

**Paging/size policy (satisfies D-137 "nothing truncated" without freezing the UI):**
- Eager: `review_files` only (cheap; numstat gives counts so no hunk is parsed).
- Lazy: `review_patch` on file expand; one file per call; IPC returns a `String`.
- Render in **hunk chunks**, not truncation: render the first ~40 hunks (or ≈2,000 changed lines) of an opened file and a "Show next N hunks" control that appends; every line stays reachable. `[ASSUMED: thresholds are heuristics — tune against a real 8,000-line lockfile in the tracer]`.
- Skip *highlighting* (not rendering) for a file with more than ~5,000 changed lines (`added+removed` from numstat); plain text still renders.
- Generated-file detection (discretion): a small constant list (`package-lock.json`, `Cargo.lock`, `pnpm-lock.yaml`, `yarn.lock`, `*.min.js`, `*.map`, `dist/`, `/.snap`) → opens collapsed with a "generated" tag; still openable.
- Binary (`numstat` = `-\t-`): patch text is `Binary files /dev/null and b/bin.dat differ` and `parseDiff` yields no hunks — render a "binary file" row, never call `tokenize`.
- Whitespace (discretion): default exact; keep `-w` as a later toggle (the patch command takes no flag today).
- Big stdout: `proc::output_with_timeout` buffers the whole child output in memory; an 8,000-line patch is ~0.4 MB — fine. If a single file ever exceeds ~10 MB, switch that command's return to `tauri::ipc::Response`; not needed for v1.

### Pattern 2: Criterion anchors — a new table, derived staleness

**Verified current schema** (`0002_board_schema.sql:96-107`): `acceptance_criteria(id, parent_type CHECK IN ('task','epic'), parent_id, statement, verification_hint, checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)), rank, created_by, created_at, updated_at)`, plus `0009_criteria_revisions.sql`: `revision`, `revision_of`, `superseded_at`. Last registered migration is `include_str!("migrations/0017_forge_setting.sql"),` (`db/mod.rs:38`) → new file is **`0018_criterion_anchors.sql`**, appended to `migration_source_list()`.

**Recommendation — separate table, not columns:**
```sql
-- 0018_criterion_anchors.sql — D-139/D-140/D-141: evidence for a checked criterion.
CREATE TABLE criterion_anchors (
    criterion_id TEXT PRIMARY KEY NOT NULL REFERENCES acceptance_criteria(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    side        TEXT NOT NULL DEFAULT 'new' CHECK (side IN ('old', 'new')),
    line_start  INTEGER NOT NULL CHECK (line_start >= 1),
    line_end    INTEGER NOT NULL CHECK (line_end >= line_start),
    sha         TEXT NOT NULL,       -- branch tip the anchor was read at (resolved server-side)
    created_by  TEXT NOT NULL REFERENCES actors(id),
    created_at  TEXT NOT NULL
);
```
Why a table: (a) `AcceptanceCriterion` is built from positional `row.get(N)` SELECTs in ~8 places (`toggle_criterion`, `update_criterion`, `revise_criterion_in_tx`, `reorder_criterion`, `list_criteria`, `list_current_criteria`, `list_revisions_for_root`, …) — a table touches none of them; (b) `foreign_keys=ON` is set at runtime (`db/mod.rs:68`) so `ON DELETE CASCADE` handles both hard-delete sites (`DELETE FROM acceptance_criteria WHERE id = ?1`, `acceptance_criterion.rs:832`, and the by-parent delete at `:889`); (c) absence-of-row **is** the "no evidence" state (D-140) — no sentinel values.

Write path (new fn beside `toggle_criterion`, one transaction, one event, emit `board:changed`):
- `check_criterion_with_anchor(conn, actor_id, criterion_id, Option<AnchorInput{path, side, line_start, line_end}>)`: sets `checked=1`; if an anchor is given, resolves `sha = git rev-parse <head ref>` **server-side** (never trust a renderer sha — T-01-04 discipline) and `INSERT … ON CONFLICT(criterion_id) DO UPDATE`. Event type: reuse `criterion.toggled` (`acceptance_criterion.rs:669`) with an added payload key `anchor` so the activity trail's `label` rendering is unchanged.
- **Unchecking must clear the anchor** (`DELETE FROM criterion_anchors WHERE criterion_id = ?`) in the same transaction — otherwise a re-check silently resurrects stale evidence.
- **`revise_criterion_in_tx` must copy the anchor to the successor row** (it already copies `checked` — see the `INSERT … checked …` at `acceptance_criterion.rs:~510-525`). If it does not, a locked-criterion edit would leave the successor "checked, no evidence" — a regression of D-140 caused by D-77. This is the single easiest thing to miss.
- Existing `criterion_toggle` stays as the "just check the box" path (D-140); keep its behaviour but route its uncheck through the same anchor-clear.

**Staleness (D-141) — derived at read time, never stored (D-75):** for an anchor `(path, sha)` against head ref `H` (task branch, or integration branch for epic-scope criteria):
```
git rev-list --count <sha>..<H> -- <path>      # 0 → "✓ untouched since";  N → "⚠ file changed since (N commits)"
```
If `<sha>` no longer resolves (rebased + gc'd) report "unknown" — never "untouched". The rail command (`review_criteria_state`) returns `{criterion, anchor?, staleness?}`; the item-panel only needs anchor *presence*, so `criterion_list` can gain a cheap `hasAnchor` boolean via `LEFT JOIN` without any git call. Use the same function from `context_packet.rs` (D-142; the packet already shells git for the diff-so-far, so this is not a new capability).

**Context packet (D-142):** `CRITERIA_SQL` (`context_packet.rs:162-164`) is `SELECT statement, verification_hint FROM acceptance_criteria WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL ORDER BY rank ASC, id ASC`. Widen to `LEFT JOIN criterion_anchors` + `checked`; extend `CriterionEntry` and the render at ~`context_packet.rs:476-487`. The packet is covered by determinism/shape tests (`tests/context_packet.rs`, `tests/five_cycle_reconstitution.rs`, `tests/diff_so_far.rs`) — expect to update expected text; render the new line only when a criterion is checked (absence discipline, same as the other sections).

### Pattern 3: Merge — dry-run, merge in the epic worktree, abort as the safety net

**Verified behaviour (git 2.54.0, scratch repo):**
- `git merge-tree --write-tree --name-only -z --no-messages <target> <source>` → exit `0` clean, exit `1` conflicts, other = real error. Output: `<tree-oid>\0` then conflicted paths each `\0`-terminated. It **mutates no ref, index or working tree** (it writes objects only). Without `--no-messages` the informational text also lands on **stdout** (not stderr), after a blank line.
- A real `git merge --no-ff -m "…" <source>` in a worktree that conflicts exits `1`, leaves `UU f.txt` in `git status --porcelain`, and `MERGE_HEAD` set (`git rev-parse -q --verify MERGE_HEAD` succeeds). `git merge --abort` restores a clean tree and `MERGE_HEAD` disappears (verified: porcelain empty, `rev-parse` exit 1).
- A source already contained in the target: `merge-tree` exit 0, `git merge` prints `Already up to date.` exit 0, **creates no commit** — treat as `AlreadyIntegrated`, write no event.
- `--no-ff` always creates a merge commit even when a fast-forward is possible (verified graph) — gives every integration a durable single commit sha to record and to diff later.

**Required sequence (`review::merge_task_into_epic`), all inside one per-epic exclusive section:**
1. Resolve (under DB lock, then drop it): task branch, epic integration branch, `repo_path`, epic worktree path (`worktree_root()/{key_prefix}/{epic_key}`; epic keys share the project key counter so they cannot collide with task keys — `epic.rs` header lines 5-6).
2. Refuse if the **task worktree** is irrelevant (never touched) but require the **integration worktree clean**: `porcelain_entries(epic_wt)` empty, else a named error — a merge into a dirty tree can fail midway or mix files.
3. If `MERGE_HEAD` already exists in the epic worktree (a crash mid-merge last time) → `git merge --abort` first, then continue.
4. **Dry run:** `merge_tree_check(repo, target=integration, source=task_branch)`. Conflict → return `Conflicted { files }`, append an `events` row (D-144/CONTEXT integration points: "so does an aborted conflicted merge"), emit `board:changed`, and stop — the integration worktree was never touched, so there is nothing to abort. This also feeds the confirm sheet *before* the user presses Merge (call it on sheet open; it is read-only).
5. `ensure_epic_worktree`: if the dir exists use it; else `git worktree prune` then `git worktree add <path> <integration_branch>` (existing-branch form — precedent `worktree.rs:459`; **not** `git::worktree_add`, which refuses an existing branch and always passes `-b`). Reuse its adjacency refusals (path under `worktree_root_from_env()`, not equal to `repo_path`).
6. `git -C <epic_wt> merge --no-ff --no-stat -m "<msg>" <task_branch>`. Success → read `git rev-parse HEAD` as the merge sha.
7. **Any** non-success outcome (conflict that slipped past the dry run, timeout kill, hook failure, signing prompt): if `MERGE_HEAD` exists → `git merge --abort`. Verify porcelain is empty afterwards; if not, return a loud error naming the path — never report success or "nothing changed" without having checked.
8. Re-lock DB; append one event (type `task.integrated`, payload `{label, merge_commit, source_branch, target_branch, commit_count, file_count}`) via `next_sequence` + `append_event` in one transaction; **no status write** (D-145). Drop lock; emit `board:changed` with `{ "entity": "task", "id": task_id }` (shape used by `forge.rs:239-243`).

**Merge commit style (discretion):** `--no-ff`, message `Merge {task_key} {task_title} into {integration_branch}`. The `commit-msg` hook only stamps trailers for `flywheel/<key>…` branches and exits 0 for `flywheel/epic/…` (extraction regex yields an empty key; `git_hooks.rs` commit-msg script) — so the merge commit gets no spurious trailer. Do **not** pass `--no-verify`.

**Integrated marker (D-145), derived at read time:** `integrated(task)` = the latest `task.integrated` event for the task exists **and** `git merge-base --is-ancestor <merge_commit> <integration tip>` succeeds. A bare "task tip is an ancestor of integration" test is wrong: a freshly cut, still-empty task branch is trivially an ancestor (§Pitfall 5).

**Where the merge cannot be dry-run-free:** none — but note `merge-tree` reflects the committed state only; the guard in step 2 covers the dirty case.

### Pattern 4: Rendering — react-diff-view wiring (verified against 3.3.3 source and README)

```ts
// highlight.ts  [VERIFIED: executed in scratch dir against react-diff-view@3.3.3 + refractor@5.0.0]
import { refractor } from "refractor/core";
import rust from "refractor/rust";
import typescript from "refractor/typescript";
import tsx from "refractor/tsx";
import javascript from "refractor/javascript";
import jsx from "refractor/jsx";
import json from "refractor/json";
import css from "refractor/css";
import markdown from "refractor/markdown";
import yaml from "refractor/yaml";
import toml from "refractor/toml";
import bash from "refractor/bash";
import sql from "refractor/sql";
import python from "refractor/python";
import go from "refractor/go";
import markup from "refractor/markup";
[rust, typescript, tsx, javascript, jsx, json, css, markdown, yaml, toml, bash, sql, python, go, markup]
  .forEach((lang) => refractor.register(lang));

// react-diff-view calls `refractor.highlight(text, lang)` and uses the result AS an array of nodes
// (refractor@3 shape). refractor@4/5 return a hast Root. Passing refractor itself throws
// "Invalid attempt to iterate non-iterable instance" (verified). Adapter:
export const diffRefractor = {
  highlight: (text: string, language: string) => refractor.highlight(text, language).children,
};
const EXT: Record<string, string> = { rs: "rust", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  json: "json", css: "css", md: "markdown", yml: "yaml", yaml: "yaml", toml: "toml", sh: "bash",
  sql: "sql", py: "python", go: "go", html: "markup", svg: "markup", xml: "markup" };
export function languageFor(path: string): string | null { /* last extension, lowercased → EXT[ext] ?? null */ }
```
```tsx
// FileDiff.tsx (sketch)
import { Diff, Hunk, parseDiff, tokenize, markEdits, getChangeKey } from "react-diff-view";
import "react-diff-view/style/index.css";
const [file] = parseDiff(patchText);                       // one file per patch (lazy, D-137)
const lang = languageFor(file.newPath);
const tokens = lang && !huge
  ? tokenize(file.hunks, { highlight: true, refractor: diffRefractor as never, language: lang,
                           enhancers: [markEdits(file.hunks, { type: "block" })] })
  : undefined;
<Diff viewType="unified" diffType={file.type} hunks={file.hunks} tokens={tokens}
      selectedChanges={selectedKeys} widgets={anchorWidgets}
      gutterEvents={{ onClick: ({ change }) => toggleSelect(getChangeKey(change)) }}>
  {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
</Diff>
```
- `tsconfig` has `skipLibCheck: true`, so react-diff-view's `import type { highlight } from 'refractor'` (a refractor@3 type that does not exist in 5.x) does not break `tsc`; the `as never` cast on the adapter is what satisfies the option type.
- Change keys (README "Key of change"): insert → `'I' + lineNumber`, delete → `'D' + lineNumber`, normal → `'N' + oldLineNumber`; use the exported `getChangeKey`. `side` for an anchor: `delete` ⇒ `'old'`, otherwise `'new'` (use `computeNewLineNumber`/`computeOldLineNumber` exports from `react-diff-view` utils for the numeric line).
- **Where D-135's "decoration API" actually lives:** `Decoration` renders around *hunks* (hunk headers / "expand context" rows). A criterion badge attached to a line is a **`widgets`** entry (an element rendered under the change's row, keyed by change key — one widget per change); selection highlight is `selectedChanges`; click handling is `gutterEvents`/`codeEvents`; per-line gutter badges are `renderGutter`. The D-139 interaction is fully supported — it just uses these props.
- `oldSource` (full old file for accurate multi-line comment/template-string highlighting) is optional; without it highlighting is per-reconstructed-hunk text. Skip it in v1 (would need a `git show <base>:<path>` per file) — a known highlighting-accuracy tradeoff, not a bug.
- `tokenize` is synchronous on the main thread; the library ships `useTokenizeWorker` if a profile shows jank. v1: tokenize only the hunks currently rendered (chunking above) and skip files over the highlight cap.
- jsdom (vitest) renders the `<table>` fine; assert highlighting by the presence of `.token.keyword` spans.
- Colours: the library's CSS is structural; token colours come from your own CSS on `.token.*` classes — define them from the existing design tokens (`styles/tokens.css`) rather than importing a Prism theme, so the diff matches the bold/modern direction.

### Pattern 5: Epic request (REVW-05) — reuse the Phase 7 seam, add the push

Reuse as-is: `forge::forge_and_repo_path` (resolve under the lock), `forge::create_request_at(forge, repo_path, &RequestDraft)` (connection-free), `forge::request_for_branch_at`, `RequestDraft{title, body, head_branch, target_branch}`, `gh pr create --head … --base … --body-file -` / `glab mr create --source-branch … --target-branch … --description-file …` (`forge/github.rs:118-131`, `forge/gitlab.rs:193-207`).

New:
- `request_body::assemble_epic_request_draft(&Connection, epic_id) -> RequestDraft`: `head_branch = epics.integration_branch` (error naming the epic if NULL — no branch cut yet), `target_branch = projects.default_branch` (the integration branch's own target, D-25/D-26 — no `origin/` prefix, same rule as the task draft's comment at `request_body.rs:63-65`), `title = epic title`, body = key + title, epic `description`, the epic's current-revision criteria checklist (`parent_type='epic'`, real `checked` state, anchors summarised as `path:lines`), then a roll-up of its tasks (key, title, status, `x/y criteria checked`, integrated yes/no). Pure query, no clock, byte-identical on repeated calls (CTX-04) — preview text == published text.
- A **push step before `create_request_at`**: `gh pr create` "Pushes no branch" (`github.rs:136`) and errors if the head is not on the remote. Run `git -C <repo_path> push origin <integration_branch>` via `git_at` (plain push, never `--force`, no `-u` needed because `--head` is explicit). Push from the **main checkout**, not the epic worktree: the pre-push gate hook's territory check lets any push whose `$PWD` is outside `FLYWHEEL_WORKTREE_ROOT` through untouched (`git_hooks.rs` pre-push script, the `case "$PWD" in … *) exit 0 ;;` block), whereas a push from inside the epic worktree would run the force-push/delete ancestry checks (a plain fast-forward passes those too, but there is no reason to enter that code). A rejected non-fast-forward surfaces git's own error; **never** auto-force.
- Pre-conditions to check and name before showing the sheet: integration branch exists locally and has ≥1 commit ahead of `default_branch` (`rev-list --count default..integration`) — otherwise the forge errors "No commits between"; forge is not `Local` (D-120 → render the action not at all); the CLI-error taxonomy (`CliNotInstalled`/`CliNotAuthenticated`/`CliFailed`) is the existing `ForgeError` mapped the same way `forge_open_request` does (`"<category>:<cli>"`, stderr to `eprintln!` only).
- Commands: `forge_epic_request_draft(epic_id)`, `forge_open_epic_request(epic_id)` (id only), and a live read `forge_request_for_epic(epic_id)` = `request_for_branch_at(forge, repo, integration_branch)` for showing "request #N open". The read goes through the **existing** adapters, so Phase 7's "how the forge is called" is unchanged (it is a new *caller*, which CONTEXT's boundary permits).
- **No status writes and no poll registration.** The Phase 7 scheduler's forge job and `forge::transitions::apply_forge_observation` are keyed on **tasks**; D-145 says the epic's merge "carries its tasks to Done", but nothing in Phase 7 observes an *epic* request. Phase 8's boundary forbids moving anything to Done, so v1 shows the epic request read-only. (See Open Question 2.)
- The module header of `forge/mod.rs` states `create_request_at` has "exactly two call sites" (the dispatcher and the one Tauri command). The epic command is a second Tauri caller; no test enforces the count (searched `tests/` — only `forge_normalize.rs` and `forge_live_chain.rs` mention `create_request`), so update that comment, not a gate.

**Optional no-CLI fallback (discretion, `[ASSUMED]` URL shapes):** when `gh`/`glab` is missing or unauthenticated, offer "Open compare page" — build the URL in Rust from `git remote get-url origin` (handle `git@host:owner/repo(.git)` and `https://host/owner/repo(.git)`), e.g. GitHub `https://github.com/{o}/{r}/compare/{base}...{head}?expand=1` and GitLab `https://gitlab.com/{ns}/{r}/-/merge_requests/new?merge_request[source_branch]={head}&merge_request[target_branch]={base}`; percent-encode branch names; open with the OS opener from Rust (no renderer capability exists: `capabilities/default.json` grants no `shell:allow-open`, and the renderer must not gain one). Do not put the body in the URL (length-limited). Mark this task optional; the typed `CliNotInstalled`/`CliNotAuthenticated` outcome the task flow already shows is the baseline.

### Pattern 6: Surface wiring (all verified in-repo)

- `App.tsx` chain order today: `settingsOpen` → `triageSurfaceProjectId` → `activeAgentRunId` → `project.status === "unreachable"` → `<Board>`. Insert `reviewSurface` **after triage and before session**: from the review surface you launch a resolve session (D-144), which sets `activeAgentRunId` — that must be allowed to take the screen, so the session branch must also be able to preempt; simplest is for the "start resolve session" handler to clear `reviewSurface` before `setActiveAgentRunId(...)` (the Triage `onOpenSession` handler does exactly this: `setTriageSurfaceProjectId(null); setActiveAgentRunId(...)`).
- `uiStore.ts`: add `reviewSurface: { scope: "task" | "epic"; itemId: string } | null` + `setReviewSurface`, mirroring `triageSurfaceProjectId` (`uiStore.ts` lines ~138, 240, 330).
- Keys: board-list keys already used are exactly `a ArrowDown ArrowUp Backspace c e End Enter Home j k l m o p r s w`; **`v` is free** (`[VERIFIED: keyboard.ts BINDINGS board-list entries, grep]`) → `{ id: "open-review", region: "board-list", key: "v", label: "Review" }`, task-row-only refusal like `start-work`. Add `"review-surface"` to `FocusRegion` and `UiLayer`, a `REVIEW_SURFACE_ACTION_IDS` set + branch in `bindingAllowedInLayer`, and register with `useRegionBindings("review-surface", "review-surface", handlers)` (`keyboard.ts` ~703-724) — the same hook the permission card uses. `AcceptanceCriteriaList` keeps its own local `onKeyDown` (`j/k`, Space/Enter, `n`, `e`); the rail should reuse that row component rather than re-implement it (CONTEXT: "extend, not fork").
- Entry (4): `ItemDetailPanel.tsx` gets an `onReview?: () => void` prop beside `onStartWork` (line ~70, button ~233); the palette's resolved-git-identifier branch (`CommandPalette.tsx` ~284-297 sets `setDetailItemId(resolution.itemId)`) gains a review-open path; `SessionSurface.tsx` finish state offers it when `status` is a terminal run status (`TERMINAL_STATUSES = ["completed", "failed", "interrupted"]`, line 68) and the run has a `taskId`.
- New legend marks (`legend/marks.ts`; "no mark may exist that the legend does not define"): `integrated`, `criterion-no-evidence`, `criterion-anchor-stale`, `criterion-anchor-fresh`. `MarkChannel` is a closed union — `"criteria"` already exists and fits.
- `capabilities/default.json` documents every app command in its `description` string "for auditability" (not enforced; `generate_handler!` is the real boundary). Append the new command names and their one-line safety contracts there, as every prior phase did.

### Anti-Patterns to Avoid
- **Calling `git_at` for `merge`/`merge-tree`:** it turns exit 1 into `Err` and drops stdout (`git.rs:78-84`), so a conflict becomes an opaque error string and the file list is lost. Add a raw-output wrapper (§Code Examples 4).
- **Holding `AppState.db` across any git call** in the new commands (Phase 7's own rule, `forge/mod.rs` header "Fourth"). Resolve → drop → git → re-lock → write.
- **Computing the task diff against `origin/<integration>`** — that ref does not exist until the integration branch is pushed.
- **Passing refs, paths-to-run, or shas from the renderer.** Commands take scope + id (and a file path for a patch); everything else is derived server-side.
- **Storing staleness or an "integrated" boolean** — derive both (D-75).
- **Moving any status on merge** (D-145/D-122).
- **Forking `AcceptanceCriteriaList`** — extend/compose it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unidiff parsing, hunk rendering, intra-line edit marking | A custom parser/renderer | `react-diff-view` (`parseDiff`, `Diff`, `Hunk`, `markEdits`) | Locked by D-135; edge cases (no-newline-at-EOF markers, renames, modes) are handled by `gitdiff-parser`. |
| Syntax tokenizing | Regex highlighter / Shiki | `refractor/core` + per-language imports | Locked by D-135; 124 kB total measured. |
| Conflict detection | Parsing `git merge` stdout | `git merge-tree --write-tree --name-only -z` | Exit-code contract + NUL-delimited file list, no worktree mutation. |
| Rename/binary/status detection | Parsing `--stat` text | `git diff -z --numstat` + `--name-status -z -M` | `--stat` truncates long paths with `...` (verified). |
| Lock-retry/backoff for git | A new sleep loop | `git_retry::with_lock_retry` (already inside `git_at`; wrap new raw calls the same way if they write) | One policy workspace-wide (D-54). |
| "Is the merge still in progress" | Tracking in a DB flag | `git rev-parse -q --verify MERGE_HEAD` | Git is the truth (D-75). |
| Forge PR creation | `reqwest`/token handling | Existing `create_request_at` → `gh`/`glab` | D-117: no HTTP client, no credential in this workspace. |
| Worktree add/remove guards | New path-safety code | Copy `worktree_add`'s guards (under `worktree_root_from_env()`, `!= repo_path`) | PROC-02 adjacency discipline. |
| Per-epic exclusion | `SpawnFloor::wait_turn` | A `Mutex<HashSet<String>>` (try-lock by epic id → "merge already in progress") in `AppState` | `wait_turn` only enforces a 400 ms gap between spawn *starts* (`git_retry.rs:252-272`); it does not exclude. |

**Key insight:** every hard part (conflict semantics, hunk parsing, tokenizing, forge dispatch, lock retry) already has a correct implementation either in git itself or in the repo. The risk in this phase is *composition* mistakes — dropped stdout, a held DB lock, a missed `revise` copy — not missing algorithms.

## Common Pitfalls

### Pitfall 1: `git_at` cannot carry merge/merge-tree results
**What goes wrong:** Using `git_at(repo, &["merge-tree", …])` — exit 1 (conflict) becomes `Err("… failed (exit Some(1)): <stderr>")`; stdout (the conflict list) is discarded.
**Why:** `git_at` bails on non-zero (`git.rs:78-84`); only `rev_parse_verify` uses the private `spawn_git` to keep the raw `Output`.
**How to avoid:** add a public `git_output_at(repo, args) -> anyhow::Result<Output>` that wraps `spawn_git` and applies **no** exit policy (the doc on `spawn_git` already says policy belongs to the caller). It remains inside `git.rs`, so `supervisor_cwd.rs`'s single-`Command::new("git")` and `-C`-first assertions still hold. Do not construct a `Command` anywhere else.
**Warning signs:** a conflicted merge in tests surfaces as a generic error with no file names.

### Pitfall 2: A merge left half-applied
**What goes wrong:** Merge started, then the process is killed (120 s `GIT_TIMEOUT_SECS` kill, app quit, `commit.gpgsign` prompt waiting on a pinentry `[ASSUMED]`), leaving `MERGE_HEAD` + a conflicted/dirty integration worktree; the *next* merge fails confusingly (the exact failure D-144 rejects).
**How to avoid:** (a) dry-run with `merge-tree` first so conflicts never reach the worktree; (b) a `finally`-style cleanup — after *any* non-success of the real merge, if `MERGE_HEAD` exists run `merge --abort` and re-check porcelain is empty; (c) at the start of every merge, treat a pre-existing `MERGE_HEAD` as recoverable (`--abort` first) and a pre-existing dirty tree as a named refusal; (d) tests that kill/timeout the merge are impractical — instead unit-test the cleanup function against a hand-built mid-merge state.
**Warning signs:** `git status --porcelain` in `~/Flywheel/<prefix>/<epic-key>` non-empty between merges.

### Pitfall 3: Two merges racing in the same integration worktree
**What goes wrong:** Double-click Merge, or merging two tasks of one epic back-to-back: both run `git merge` in the same worktree → `index.lock` contention (retried 5×, ~3.5 s, then `LockExhausted`) or the second merge lands inside the first's in-progress state.
**How to avoid:** `AppState` gains `merge_locks: Mutex<HashSet<String>>` (epic id); the command `try`-inserts and returns "a merge into this epic is already running" otherwise; remove in a guard `Drop`. Same lock should cover the epic push. The DB mutex is **not** a substitute and must not be held during the merge.
**Scheduler interplay (verified by reading `scheduler.rs`):** the hot/cold ticks only read task worktrees (`git status`, `log`, `rev-list`) and the fetch job runs `git fetch --quiet origin` in the main checkout with no DB lock; neither touches the epic worktree's index or `refs/heads/<integration>`. Shared-`.git` ref/packed-refs lock collisions are already handled by `with_lock_retry` inside `git_at`. No scheduler change is needed. The merge command should emit `board:changed` itself after the write so open panels refresh; `git_facts`' `behind` is computed against `origin/…` and will not change on a local merge — expected, not a bug.

### Pitfall 4: Synchronous Tauri commands run on the main thread
**What goes wrong:** every existing command is a plain `fn` (`grep` for `command(async)`/`async fn`/`spawn_blocking` in `commands/` finds nothing). Tauri docs: *"Commands without the async keyword are executed on the main thread unless defined with #[tauri::command(async)]"* `[CITED: v2.tauri.app/develop/calling-rust]`. A merge (seconds), a push (up to 120 s), or a large `git diff` in a sync command freezes the whole window. (`forge_open_request` already has this latent issue with `gh`.)
**How to avoid:** declare the new git-shelling commands `#[tauri::command(async)]` (runs on a worker, body stays a normal sync fn so `State<AppState>` borrowing is unchanged). Keep trivial SQLite-only commands (`criterion_check_with_anchor` without a git rev-parse) as-is. `[ASSUMED: that State<'_, AppState> compiles unchanged under `command(async)` on a non-async fn — the docs' borrowed-argument warning applies to `async fn`; confirm in the tracer compile.]`
**Warning signs:** the UI beachballs during a merge; cursor/menu unresponsive while pushing.

### Pitfall 5: Diff and marker semantics change after a merge
**What goes wrong:** (a) After a successful `--no-ff` merge, `integration...task` is empty (the task tip is now an ancestor, merge-base == task tip) — the surface would claim "no changes" for work that was just landed. (b) A branch with zero commits of its own is also "an ancestor of the integration branch" the moment it is cut, so an ancestor-only "integrated" test lights the marker on brand-new tasks.
**How to avoid:** for a task with a recorded `task.integrated` event whose `merge_commit` is still an ancestor of the integration tip, show the "integrated into {epic}" state and diff `git diff <merge_commit>^1 <merge_commit>` (what the merge landed; `^1` = the integration side). With no such event, an empty diff is "nothing to review", not "integrated". Derive the marker from event + ancestry, never ancestry alone.
**Warning signs:** the Merge button enabled on an empty diff; the marker on a task with no commits.

### Pitfall 6: Renames and pathspec semantics
**What goes wrong:** patch for a renamed file fetched with the new path alone renders as "new file" (verified); a path containing `*`/`:` is treated as a glob/magic pathspec.
**How to avoid:** carry `old_path` end-to-end and pass both after `--`; use `--literal-pathspecs` (it is a git *global* option: `git -C <repo> --literal-pathspecs diff …` — placing it in `args` after the `-C` pair keeps the `-C`-first invariant). Validate: non-empty, no NUL. A pathspec can only narrow a diff between two refs — it cannot read outside the repo — so this is hardening, not an RCE boundary.

### Pitfall 7: Epic scope when the integration branch does not exist yet
**What goes wrong:** `epics.integration_branch` is NULL until the first task on that epic starts (lazy cut, `ensure_epic_integration_branch`). Epic-scope review/request on such an epic must not error or cut a branch as a side effect.
**How to avoid:** `ReviewScope` resolution returns `NoIntegrationBranch`; UI renders absence (D-120 style) and disables the epic toggle's diff, still showing the epic's criteria. The request action is not offered. **Never** call `ensure_epic_integration_branch` from a read.

### Pitfall 8: Syntax-highlight cost and bundle
**What goes wrong:** importing `refractor` (bare) or `refractor/all` registers hundreds of grammars; tokenizing a multi-thousand-line file on open stalls the surface.
**How to avoid:** `refractor/core` + explicit languages only (measured 44 kB gzip); `React.lazy(ReviewSurface)`; chunk hunks; skip highlighting past the cap; unknown extension → render un-highlighted (do not throw: `refractor.highlight` throws on an unregistered language — guard with `refractor.registered(lang)`).

### Pitfall 9: Anchor line numbers vs. renames/rewrites
**What goes wrong:** anchoring `src/retry.rs:13-21 @a3f91c` then the file is renamed — `rev-list <sha>..HEAD -- <path>` on the old path reports "untouched" because the path no longer changes.
**How to avoid:** staleness for an anchor whose path no longer exists at head, or that appears as a rename source in `--name-status -M <sha>..<head>`, is "moved/changed" (stale), never "untouched". Add a test for rename. D-141 only requires "marked stale"; the exact "(N commits)" count is cosmetic.

### Pitfall 10: Timeouts and prompts for push
**What goes wrong:** `git push` over HTTPS with no credential helper prompts on the terminal; `output_with_timeout` closes stdin (`Stdio::null()`), but git opens `/dev/tty` directly, so under `cargo tauri dev` from a terminal it can block up to 120 s `[ASSUMED]` (a Finder-launched app has no controlling tty and fails fast).
**How to avoid:** set `GIT_TERMINAL_PROMPT=0` for the push (git(1) documents it: *"If this Boolean environment variable is set to false, git will not prompt on the terminal"* — verified in `man git`). Either add `.env("GIT_TERMINAL_PROMPT", "0")` in `spawn_git` (benign for every existing call) or give the push its own tiny `spawn_git` variant. Map a push failure to a named "push rejected / not authenticated" outcome; stderr never crosses IPC.

## Code Examples

### 1. Raw git wrapper + review file list (core, `git.rs`)
```rust
/// Like `git_at` but applies NO exit-status policy — the caller reads `status` and `stdout`.
/// Needed for `merge-tree` (exit 1 = conflicts) and `merge`. Still the one `Command::new("git")` site.
pub fn git_output_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() { bail!("git_output_at refused: repo_path must not be empty"); }
    if args.is_empty() { bail!("git_output_at refused: args must not be empty"); }
    spawn_git(repo_path, args)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReviewFile {
    pub path: String,
    pub old_path: Option<String>,   // Some for renames/copies
    pub status: String,             // "A" | "M" | "D" | "R" (R100 → "R")
    pub added: Option<u32>,         // None for binary
    pub removed: Option<u32>,
    pub binary: bool,
}

/// `git diff -z --name-status -M <range>` then `--numstat -M`, zipped by order (both emit files
/// in the same order). Parse by splitting on '\0': name-status = status token then 1 path
/// (2 for R/C); numstat = "a\tr\tpath" or "a\tr\t" followed by old\0new for renames.
pub fn review_files(repo_path: &Path, base: &str, head: &str) -> anyhow::Result<Vec<ReviewFile>> { /* … */ }
```

### 2. Per-file patch
```rust
pub fn review_patch(repo_path: &Path, base: &str, head: &str, path: &str, old_path: Option<&str>)
    -> anyhow::Result<String>
{
    if path.is_empty() || path.contains('\0') { bail!("review_patch refused: bad path"); }
    let range = format!("{base}...{head}");
    let mut args = vec!["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--no-textconv",
                        "-U3", "-M", range.as_str(), "--", path];
    if let Some(old) = old_path { args.push(old); }
    let out = git_at(repo_path, &args)?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
```

### 3. Merge dry-run (verified output shape)
```rust
pub enum MergePrecheck { Clean, Conflicts(Vec<String>) }
pub fn merge_tree_check(repo_path: &Path, target: &str, source: &str) -> anyhow::Result<MergePrecheck> {
    let out = git_output_at(repo_path,
        &["merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", target, source])?;
    match out.status.code() {
        Some(0) => Ok(MergePrecheck::Clean),
        Some(1) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let mut fields = text.split('\0');
            let _tree_oid = fields.next();
            let mut files: Vec<String> = fields.take_while(|f| !f.is_empty()).map(str::to_string).collect();
            files.sort(); files.dedup();
            Ok(MergePrecheck::Conflicts(files))
        }
        other => bail!("git merge-tree failed (exit {other:?}): {}", String::from_utf8_lossy(&out.stderr)),
    }
}
```
Requires git ≥ 2.38 for `--write-tree`; `MIN_SUPPORTED_GIT` is `(2, 54, 0)` (`git.rs:297`), installed git is 2.54.0.

### 4. Merge + abort-on-failure
```rust
pub fn merge_no_ff(worktree: &Path, source: &str, message: &str) -> anyhow::Result<bool /*committed*/> {
    let out = git_output_at(worktree, &["merge", "--no-ff", "--no-stat", "-m", message, source]);
    let failed = match &out { Ok(o) => !o.status.success(), Err(_) => true };
    if failed {
        // Safety net: never leave MERGE_HEAD behind (D-144).
        if rev_parse_verify(worktree, "MERGE_HEAD")? {
            git_at(worktree, &["merge", "--abort"])?;
        }
        bail!("merge failed and was rolled back");   // include porcelain re-check result
    }
    Ok(!String::from_utf8_lossy(&out.unwrap().stdout).contains("Already up to date"))
}
```
`rev_parse_verify(worktree, "MERGE_HEAD")` already exists (`git.rs:95`) and maps non-zero to `false`.

### 5. Existing-branch worktree for the epic
```rust
pub fn worktree_add_existing(repo_path: &Path, worktree_path: &Path, branch: &str) -> anyhow::Result<Output> {
    // same three refusals as worktree_add (empty repo_path, == repo_path, not under worktree_root_from_env())
    git_at(repo_path, &["worktree", "add", &worktree_path.to_string_lossy(), branch])   // precedent: worktree.rs:459
}
```

### 6. Command shape (Tauri)
```rust
#[tauri::command(async)]   // runs off the main thread
pub fn review_merge_task(state: State<AppState>, app: AppHandle, task_id: String) -> Result<MergeOutcomeDto, String> {
    let plan = { let conn = state.db.lock().map_err(|e| e.to_string())?;
                 flywheel_core::review::plan_merge(&conn, &task_id).map_err(|e| e.to_string())? };   // lock dropped here
    let _guard = state.try_lock_epic(&plan.epic_id).ok_or("a merge into this epic is already running")?;
    let result = flywheel_core::review::run_merge(&plan);              // all git, no DB lock
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::review::record_merge_event(&mut conn, &plan, &result).map_err(|e| e.to_string())?;
    drop(conn);
    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id })).ok();
    Ok(MergeOutcomeDto::from(result))                                  // conflict files OK; raw stderr never
}
```

## Verified In-Repo Values (quoted verbatim, opened this session)

| Fact | Quote | Source |
|------|-------|--------|
| Last migration registered | `include_str!("migrations/0017_forge_setting.sql"),` | `packages/core/src/db/mod.rs:38` |
| Single git spawn + policy split | `fn spawn_git(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {` / `pub fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {` | `packages/core/src/git.rs:43`, `:66` |
| `git_at` discards stdout on non-zero | `if !output.status.success() {` … `return Err(anyhow!(` `"git -C {repo_path:?} {args:?} failed (exit {:?}): {stderr}",` | `git.rs:78-83` |
| Min git | `pub const MIN_SUPPORTED_GIT: (u32, u32, u32) = (2, 54, 0);` | `git.rs:297` |
| Git timeout | `pub const GIT_TIMEOUT_SECS: u64 = 120;` | `packages/core/src/proc.rs:20` |
| Branch namespace / epic branch | `pub const FLYWHEEL_BRANCH_NAMESPACE: &str = "flywheel/";` / `format!("{FLYWHEEL_BRANCH_NAMESPACE}epic/{key_lower}")` | `branch.rs:10`, `:109` |
| Integration branch cut (local) | `crate::git::git_at(repo_path, &["branch", &branch_name, &default_branch])` | `domain/epic.rs:767` |
| Integration event | `"epic.integration_branch_created",` | `domain/epic.rs:796` |
| Task worktree add form (new branch) | `&["worktree", "add", &worktree_path_str, "-b", branch, base_ref],` | `git.rs:134` |
| Existing-branch worktree add precedent | `git::git_at(repo_path, &["worktree", "add", &worktree_path_str, &worktree.branch])` | `domain/worktree.rs:459` |
| Worktree status vocabulary | `status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'merged', 'abandoned', 'missing')),` | `0006_recovery_statuses.sql:45` |
| `worktrees` is one-per-task | `task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),` | `0003_agent_runtime.sql:51` (⇒ an epic worktree cannot live in this table) |
| Criteria table | `checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),` | `0002_board_schema.sql:102` |
| Criterion event type | `"criterion.toggled",` | `domain/acceptance_criterion.rs:669` |
| Packet criteria read | `const CRITERIA_SQL: &str = "SELECT statement, verification_hint FROM acceptance_criteria \` | `context_packet.rs:162` |
| Draft criteria read (already has `checked`) | `const CRITERIA_SQL: &str = "SELECT statement, verification_hint, checked FROM acceptance_criteria \` | `forge/request_body.rs:32` |
| board refresh payload | `serde_json::json!({ "entity": "task", "id": task_id }),` | `desktop/src-tauri/src/commands/forge.rs:241` |
| Board-list keys in use | `a ArrowDown ArrowUp Backspace c e End Enter Home j k l m o p r s w` (`v` unused) | `desktop/src/state/keyboard.ts` BINDINGS (grep of `region: "board-list"`) |
| Layer union | `\| "triage-surface";` ends `UiLayer` | `keyboard.ts:406-416` |
| Run terminal statuses | `const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "interrupted"];` | `desktop/src/session/SessionSurface.tsx:68` |
| Spawn floor = spacing only | `/// closer together than [`SPAWN_FLOOR_MS`]` … `pub const SPAWN_FLOOR_MS: u64 = 400;` | `git_retry.rs:44`, `:229-` |
| Pre-push territory exit | `*) exit 0 ;;` (case on `$PWD` vs `$FLYWHEEL_WORKTREE_ROOT`) | `git_hooks.rs` pre-push script (~80-83) |
| Forge target has no `origin/` | `// … minus the `origin/` prefix that comparison target carries — a base ref passed to `gh pr create` | `forge/request_body.rs:63-65` |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Probe mergeability by running `git merge` then aborting | `git merge-tree --write-tree` (no worktree needed, exit-code contract) | git 2.38 | Conflict preview with zero side effects; `MIN_SUPPORTED_GIT` 2.54 clears it. |
| `refractor@3` array API | `refractor@4/5` hast `Root` | refractor 4 (2022) | `react-diff-view@3.3.3` still expects the array shape → one-line `.children` adapter. |
| Whole-diff single parse | Per-file lazy patches | D-137 | Opens instantly; cost proportional to what is read. |

**Deprecated/outdated:**
- README advice "use refractor@3.x" for react-diff-view: avoidable via the adapter.
- `tauri-plugin-shell` `open` for URLs: not granted to the renderer here; open URLs from Rust if the compare-URL fallback is built.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hunk-chunk (~40 hunks / ~2,000 lines) and highlight-skip (~5,000 lines) thresholds are right | Pattern 1 | UI jank or over-eager skipping; tune in the tracer against a real lockfile diff. |
| A2 | `State<'_, AppState>` compiles unchanged under `#[tauri::command(async)]` on a non-async `fn` | Pitfall 4 | Rewrite signature to `async fn … -> Result` + `spawn_blocking`. Caught at first compile. |
| A3 | `commit.gpgsign=true` pinentry can hang `git merge` until the 120 s kill, leaving `MERGE_HEAD` | Pitfall 2 | Only affects the cleanup-path emphasis; cleanup is required regardless. |
| A4 | `git push` can block on `/dev/tty` when launched from a terminal despite closed stdin | Pitfall 10 | If wrong, `GIT_TERMINAL_PROMPT=0` is still harmless. |
| A5 | GitHub/GitLab compare-URL shapes (`/compare/{base}...{head}?expand=1`, `/-/merge_requests/new?merge_request[source_branch]=…`) | Pattern 5 optional fallback | Fallback opens the wrong page; verify against each forge's docs before building. |
| A6 | Epic integration worktree needs no DB table (path derived `worktree_root()/{key_prefix}/{epic_key}`, existence by `try_exists`, self-healed by `prune` + re-add) | Pattern 3 | If the product later needs per-epic worktree status/removal UI, add `epic_worktrees` then; derivation costs nothing now. |
| A7 | Epic-less tasks (D-26: base = trunk) should get review but **not** an in-app merge in v1 | Open Question 1 | If the user expects trunk merges, a second target resolution + a main-checkout merge policy is needed. |
| A8 | `criterion_anchors` as a separate table (vs. columns) | Pattern 2 | Columns also work; costs ~8 constructor edits. |
| A9 | Anchoring uses new-side line numbers unless the selected change is a deletion | Pattern 4 | Deletion evidence mis-resolved; `side` column covers it. |

## Open Questions

1. **Epic-less tasks — can they be merged in-app?**
   - What we know: REVW-04 says "merge a task branch into its **epic integration branch**". D-26: an epic-less task branches off and targets the trunk. D-143's mechanism is a per-*epic* worktree.
   - What's unclear: whether merging an epic-less task into `default_branch` in-app is wanted (that would touch the user's main checkout, which may be dirty or on another branch).
   - Recommendation: review (diff + criteria) works for every task; the **Merge** action is offered only when the task has an epic with a cut integration branch; epic-less tasks keep Phase 7's task-level "open request" path. Surface this as a plan-time confirmation (A7).
2. **Who carries an epic's tasks to Done when its request merges?**
   - What we know: D-145 says "the epic's merge is what carries its tasks to Done"; Phase 7's poller/`apply_forge_observation` are task-keyed; Phase 8 forbids moving to Done (boundary + D-122).
   - What's unclear: nothing in Phase 7 observes an *epic* request, so that carry-forward has no implementer yet.
   - Recommendation: Phase 8 ships the epic request **read-only** (live `forge_request_for_epic`); record the missing epic-request observer as a follow-up for a later phase. Do not smuggle a status writer in.
3. **Push policy.**
   - Recommendation: do **not** push after a merge (local-first, merge stays reversible, D-145). Push only as the first step of the confirmed epic-request action.
4. **Sheet-time dry-run vs. race.** The pre-check on sheet-open can go stale before the user confirms; the real merge re-runs the dry-run (step 4), so correctness never depends on the earlier read. Only the confirm sheet's "will conflict" hint can be momentarily stale.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | all diff/merge/push | ✓ | 2.54.0 (Apple Git-157) | — (hard requirement; `merge-tree --write-tree` needs ≥2.38) |
| `gh` | REVW-05 (GitHub) | ✓ | 2.102.0, authenticated (github.com / cymarechal) | typed `CliNotInstalled`/`CliNotAuthenticated` outcome (+ optional compare-URL fallback) |
| `glab` | REVW-05 (GitLab) | ✓ | 1.120.0 | same |
| Node / npm | frontend deps | ✓ | v24.21.0 / 11.19.0 | — |
| Rust toolchain | core + Tauri | ✓ | cargo/rustc 1.98.1 | — |

**Missing dependencies with no fallback:** none. **Missing with fallback:** none on this machine; end users without `gh`/`glab` fall to the typed error (and optional compare URL).

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Rust | `cargo test` (integration tests in `packages/core/tests/*.rs`; fixtures `tests/common/mod.rs` → `seeded_git_project()` gives a real git repo + registered project) |
| Frontend | Vitest 5.0.0 + jsdom + Testing Library (`packages/desktop/vitest.config.ts`, `src/test/setup.ts`) |
| Quick run (Rust) | `cargo test -p core --test review_diff` (or `review_merge`, `criterion_anchors`, `epic_request_draft`) |
| Quick run (UI) | `cd packages/desktop && npx vitest run src/review` |
| Full suite | `cargo test --workspace` and `cd packages/desktop && npm test` (`npx tsc --noEmit` via `npm run build`'s `tsc`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REVW-01 | `review_files` returns A/M/D/R + counts + binary + `old_path`; patch for a rename includes `rename from/to`; binary yields no hunks | integration (real repo) | `cargo test -p core --test review_diff` | ❌ Wave 0 |
| REVW-01 | A `.rs` patch tokenizes with the adapter (`.token.keyword`) and an unregistered language renders plain without throwing | unit (vitest) | `npx vitest run src/review/__tests__/highlight.test.ts` | ❌ Wave 0 |
| REVW-01 | Per-file lazy fetch: opening a file calls patch once; files open collapsed | component | `npx vitest run src/review/__tests__/file-diff.test.tsx` | ❌ Wave 0 |
| REVW-02 | Epic scope diff = `default...integration`; NULL integration branch → explicit empty state, no branch cut | integration | `cargo test -p core --test review_diff -- epic` | ❌ Wave 0 |
| REVW-03 | `check_criterion_with_anchor` stores server-resolved sha; uncheck clears anchor; `revise_criterion` (locked) copies anchor; hard delete cascades | integration | `cargo test -p core --test criterion_anchors` | ❌ Wave 0 |
| REVW-03 | Staleness: untouched → 0; changed → N; renamed/deleted path → stale; unresolvable sha → unknown | integration | `cargo test -p core --test criterion_anchors -- stale` | ❌ Wave 0 |
| REVW-03 | Packet carries checked + anchor + stale line; no line when unchecked | integration | `cargo test -p core --test context_packet` (updated) | ✅ exists, update |
| REVW-03 | Rail shows "no evidence" / "untouched since" / "file changed since" marks; Space toggles, `c` checks against selection | component | `npx vitest run src/review/__tests__/criteria-rail.test.tsx` | ❌ Wave 0 |
| REVW-04 | Clean merge: merge commit exists, event row written, **no status change**, task worktree untouched | integration | `cargo test -p core --test review_merge -- clean` | ❌ Wave 0 |
| REVW-04 | Conflict: names files, integration worktree clean afterwards (`porcelain` empty, no `MERGE_HEAD`), event written | integration | `cargo test -p core --test review_merge -- conflict` | ❌ Wave 0 |
| REVW-04 | Pre-existing `MERGE_HEAD` / dirty integration worktree → recovered / named refusal | integration | `cargo test -p core --test review_merge -- recovery` | ❌ Wave 0 |
| REVW-04 | Already-integrated → no commit, no event; marker derived from event + ancestry (empty new branch is NOT integrated) | integration | `cargo test -p core --test review_merge -- marker` | ❌ Wave 0 |
| REVW-04 | Per-epic lock rejects a second concurrent merge | unit | `cargo test -p desktop merge_lock` (or core-level guard test) | ❌ Wave 0 |
| REVW-04 | `supervisor_cwd.rs` still green (one `Command::new("git")`, `-C` first, no `current_dir`) | gate | `cargo test -p core --test supervisor_cwd` | ✅ exists |
| REVW-05 | `assemble_epic_request_draft` deterministic (two calls byte-identical), head/target correct, errors on NULL integration branch | integration | `cargo test -p core --test epic_request_draft` | ❌ Wave 0 |
| REVW-05 | Open flow via fake `gh` (pattern in `forge_live_chain.rs`): push then `pr create --head <integration> --base <default>` | integration | `cargo test -p core --test forge_live_chain` (extend) | ✅ exists, extend |
| REVW-05 | Epic sheet previews then confirms with id only (no title/body passed) | component | `npx vitest run src/item-detail/__tests__/forge-section.test.tsx` pattern → `src/review/__tests__/epic-request.test.tsx` | ❌ Wave 0 |
| All | New `ActionId`/region/layer: `v` not colliding; `bindingAllowedInLayer` scoped to review layer | unit | `npx vitest run src/state` (existing keyboard tests) | ✅ exists, extend |

### Sampling Rate
- **Per task commit:** the single targeted `--test`/`vitest run <file>` above plus `cargo test -p core --test supervisor_cwd`.
- **Per wave merge:** `cargo test --workspace` and `cd packages/desktop && npm test && npx tsc --noEmit`.
- **Phase gate:** full suite green before `/gsd:verify-work`. Per the user's preference, visual polish is the only manual item.

### Wave 0 Gaps
- [ ] `packages/core/tests/review_diff.rs`, `review_merge.rs`, `criterion_anchors.rs`, `epic_request_draft.rs` — use `common::seeded_git_project()`; set `FLYWHEEL_WORKTREE_ROOT` to a tempdir (as `worktree_lifecycle.rs` does) so epic worktrees land under it.
- [ ] A git fixture helper (two diverging task branches off an integration branch, one clean pair, one conflicting pair) in `tests/common/mod.rs`.
- [ ] `packages/desktop/src/review/__tests__/` (highlight, file-diff, criteria-rail, epic-request).
- [ ] Framework installs: `npm install react-diff-view@3.3.3 refractor@5.0.0` (vitest already present).

## Security Domain

`security_enforcement` is enabled (`.planning/config.json`, ASVS level 1, block on high).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (forge auth delegated to `gh`/`glab`, D-117) | — |
| V3 Session Management | no | — |
| V4 Access Control | yes (renderer → command boundary) | Commands accept ids/paths only; refs, repo paths, shas, titles and bodies are derived server-side; actor resolved server-side (`local_human_actor_id`, T-01-04). |
| V5 Input Validation | yes | Validate patch `path` (non-empty, no NUL, `--literal-pathspecs`, after `--`); validate scope enum; cap anchor line numbers and `path` length (mirror `MAX_STATEMENT_LEN` style caps in `criterion.rs`); `classify`-style gating if any ref ever comes from the palette. |
| V6 Cryptography | no | — |
| V12 Files/Resources | yes | Epic worktree path must pass the same guards as `worktree_add` (under `worktree_root_from_env()`, `!= repo_path`). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Argument/option injection into git via path or ref | Tampering | Refs never from renderer; paths after `--` with `--literal-pathspecs`; no shell (argv only, `git_at`). |
| Branch/commit message injection via task title into the merge message | Tampering | Passed as one argv element to `-m` (no shell); titles are single-line board data. |
| Publishing board content to a public forge | Information disclosure | Preview-then-confirm with id-only call (T-07-09-01 shape); body assembled once; epic draft is the same function for preview and publish. |
| Forge URL rendered as an anchor `href` without scheme validation | Spoofing/XSS | Existing deferred Phase 7 defect — **do not** reuse the raw `request.url` for the new epic link without allow-listing `https:`; if the compare-URL fallback is built, construct it in Rust from the parsed remote. |
| Raw CLI stderr (may echo tokens/paths) crossing IPC | Information disclosure | Map to category strings; `eprintln!` only (T-07-08-01 pattern). |
| Silent overwrite of a user's mark | Tampering (repudiation) | D-141: staleness never unchecks; unchecking is an explicit user action that clears the anchor in the same transaction. |
| Force-push / history rewrite via the push step | Tampering | Plain `git push origin <branch>` only; no `--force*` in the argv; a non-fast-forward is surfaced, never retried with force. |
| `destructive.rs` bypass concern | Elevation | D-146 deliberately keeps the user's own merge outside the agent gate; the agent-facing gate (shim/hook) is untouched because merges run from Rust, not from an agent's shell. |

## Sources

### Primary (HIGH confidence)
- In-repo source read this session: `packages/core/src/{git.rs, git_retry.rs, git_facts.rs, branch.rs, proc.rs, forge/{mod,github,gitlab,request_body,transitions}.rs, domain/{epic,worktree,acceptance_criterion}.rs, context_packet.rs, db/mod.rs, git_hooks.rs, query/forge.rs}`, migrations `0002/0003/0006/0009/0017`, `packages/desktop/src-tauri/src/{commands/{forge,git_truth,criterion,mod}.rs, scheduler.rs, state.rs, main.rs}`, `capabilities/default.json`, `packages/desktop/src/{App.tsx, state/{keyboard,uiStore}.ts, item-detail/{AcceptanceCriteriaList,ForgeSection}.tsx, adapters/tauri.ts}`.
- `react-diff-view@3.3.3` README + `src/` (installed into a scratch dir): tokenize contract, change keys, widgets, Decoration semantics, exports.
- Executed experiments (scratch repo, git 2.54.0): `merge-tree` exit codes and `-z` output; `merge`/`--abort` state transitions; `--no-ff`; already-integrated; `numstat`/`name-status -z -M` shapes; `--stat` path truncation; rename-with-pathspec behaviour; binary numstat/patch.
- Executed experiments (scratch node): `parseDiff` + `tokenize` with refractor 5 raw (fails) vs adapter (works); esbuild bundle size.
- `gsd-tools query package-legitimacy check --ecosystem npm react-diff-view refractor` → both OK.
- npm registry: versions/dates/dist-tags via `npm view`.
- `man git` (`GIT_TERMINAL_PROMPT`).

### Secondary (MEDIUM confidence)
- Tauri docs — https://v2.tauri.app/develop/calling-rust/ — sync commands run on the main thread; `#[tauri::command(async)]`; borrowed-argument rule for `async fn`.

### Tertiary (LOW confidence — flagged `[ASSUMED]` above)
- GitHub/GitLab compare-URL formats; `commit.gpgsign` hang behaviour; `/dev/tty` prompt behaviour under a terminal-launched dev build; chunk/skip thresholds.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions from the registry, wiring executed locally, legitimacy seam OK.
- Architecture (diff + merge mechanics): HIGH — each git behaviour exercised against the installed git; seams located in source.
- Anchor storage / context packet: MEDIUM-HIGH — schema and read sites read in full; the table-vs-columns choice is a recommendation (A8).
- Forge fallback & Tauri threading: MEDIUM — documented behaviour, not exercised end-to-end here.
- Pitfalls: HIGH for 1, 3, 5, 6, 7, 8 (reproduced or read in code); MEDIUM for 2/4/10 where an environment condition is assumed.

**Research date:** 2026-10-06
**Valid until:** 2026-11-05 (stable stack; re-check `react-diff-view`/`refractor` majors and the installed git minor if planning slips).
