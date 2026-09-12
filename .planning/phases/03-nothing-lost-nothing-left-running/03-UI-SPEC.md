---
phase: "3"
slug: "nothing-lost-nothing-left-running"
status: draft
shadcn_initialized: false
preset: none
component_strategy: a-selfhost-radix
component_strategy_decided: "2026-09-09 (Phase 1 — inherited, not re-decided this phase)"
typeface: "Archivo (variable, wdth+wght axes) — OFL, Omnibus-Type — inherited from Phase 1"
icon_library: lucide-react
radius_strip: "2px"
radius_chrome: "6px"
created: "2026-09-12"
---

# Phase 3 — UI Design Contract

Platform: **macOS desktop only** (Tauri v2 native WebView), unchanged from Phase 1/2. Visitor mode:
**Operate**. This phase extends `01-UI-SPEC.md` and `02-UI-SPEC.md` — it does not re-open anything
either document marks LOCKED (palette, type, radius, spacing, board row anatomy, the rack/strip
material split, the agent signal vocabulary). Where Phase 2 left room, this document resolves
Phase 3's own new surfaces: the worktree-removal verb and its refusal, the launch-time recovery
surfaces (blocking live-orphan modal, missing-worktree decision, abandoned-run acknowledgment), the
git-lock-contention signals, and the destructive-action confirmation gate.

**Standing owner context, binding on this document (see orchestrator prompt "Standing Owner
Context").** The visual direction ("Flight Progress Strips") is under review, but the re-decision
happens in **Phase 10.1**, not here. This document therefore:

- Expresses every new surface in terms of **existing** tokens (`styles/tokens.css`), existing type
  roles, existing radii and existing structural patterns (`DeleteConfirm.tsx`'s overlay shape, the
  Permission-request card's mount-and-mechanism pattern, `WorktreeSummary.tsx`'s absence-is-the-
  state convention, D-37's row-pill-plus-rail-count mechanism).
- Introduces **zero new colour tokens.** Every new signal this phase needs — a missing worktree, an
  abandoned run, a row-level "needs a decision" pill, a destructive-action gate — is expressed by
  pairing an **existing** token (`--destructive-strip` / `--destructive-text-rack`, already used for
  the Phase 2 "Failed" run status) with a **new glyph and printed word**, exactly the way Phase 1's
  five status tints already rely on shape, not colour, to carry distinct meaning. Where this document
  proposes a genuinely new visual treatment (the destructive-gate card's reversed button emphasis,
  below), it is a **structural/behavioural** decision, not a palette one, and survives Phase 10.1's
  re-derivation untouched.
- Flags explicitly, per section, anywhere a later Phase 10.1 re-derivation of the palette would need
  to re-verify a contrast ratio this document reuses. See "Color Additions" below — there is exactly
  one inherited-ratio dependency, and it is already covered by the existing `contrast.test.ts` this
  phase adds no new assertions to.

---

## Build Process Requirement — Binding, Inherited from Phase 1/2

Unchanged: every plan task in this phase that creates or edits UI must load
`reference/craft-floor.md` before editing, run the Impeccable detector once the surface is
functionally complete and fix what it flags, capture screenshots for review, and end by updating
`DESIGN.md`. One phase-3-specific addition, mirroring Phase 2's own rule: **every new mark this
phase introduces must be appended to `packages/desktop/src/legend/marks.ts` (existing `"agent"`
channel — no new `MarkChannel` member needed) before the task is done.** No mark may exist that the
legend does not define.

---

## Discretion Items Resolved (from `03-CONTEXT.md` "Claude's Discretion")

Three of `03-CONTEXT.md`'s open discretion items are UI decisions; the rest (shim identity, the
on-disk runtime protocol, the backoff curve, whether criterion 4's stress run is CI or manual,
dev-vs-packaged parity, and what `delete_task` does with history rows) are backend/process concerns
with no UI surface and are left to the planner untouched.

| # | Item | Resolution | Rationale |
|---|---|---|---|
| 1 | Whether a live orphan found at launch can ever be adopted rather than only killed | **Kill-only.** The blocking modal (see "Orphan recovery modal" below) offers exactly one verb: Kill (per-row) or Kill All. No "Adopt" action exists anywhere in this phase. | Matches `03-CONTEXT.md`'s own stated default ("nothing in this phase's criteria asks for adoption") and D-30's "always a fresh session." Adoption would also require re-establishing a live event stream to a process the current window never spawned — genuinely new plumbing this phase's criteria do not ask for. |
| 2 | Whether the recovery modal's kill action is per-run or all-at-once | **Both.** Each orphan renders its own row with its own "Kill" action, and a "Kill All" primary action resolves every row in the modal in one press. The modal has no manual "close" — it closes itself the instant its list is empty. | A single stray orphan needs a one-click resolution; ten orphans (the fan-out-adjacent worst case this phase pre-empts) need a one-click resolution too. Neither case should force the user to click ten times or find no per-row escape from a bad Kill-All click. |
| 3 | The recovery surface's actual layout | **No new full-page Recovery surface.** Three tiers, each reusing an existing shape: (a) a **blocking overlay** (new, reusing `DeleteConfirm.tsx`'s Radix pattern) for live orphans only; (b) an **inline decision banner inside `WorktreeSummary.tsx`** for a `missing` worktree; (c) an **inline acknowledgment row inside `RunsSection.tsx`** for an `abandoned` run — (b) and (c) both surface at the board-row level via one new "Needs Decision" pill plus a project-rail count, mirroring D-37's mechanism exactly, per `03-CONTEXT.md`'s own instruction not to invent a second one. | D-41 already rejected a project-scoped Worktrees list for this phase on the same reasoning (the single-task case is the only real one while one agent runs at a time); a dedicated cross-project Recovery list is the same over-building one level up, and the fleet view Phase 10 eventually builds is the right home for a true cross-project list. |

---

## Design System

**Unchanged from `01-UI-SPEC.md`/`02-UI-SPEC.md` — pre-populated, not re-decided.**

| Property | Value |
|----------|-------|
| Tool | none — `shadcn` remains deliberately uninitialized (decision, not deferral, carried forward twice now) |
| Preset | not applicable |
| Component library | self-hosted, hand-rolled Radix primitives (`@radix-ui/react-focus-scope`, `@radix-ui/react-dismissable-layer`) |
| Icon library | Lucide (`lucide-react`, ISC) — uniform 2px stroke, outline-only |
| Font | Archivo (OFL, self-hosted variable, `wght` 100–900 / `wdth` 62–125) |

### Component Inventory

Omitted — `Tool: none`, unchanged from Phase 1/2. No shadcn registry exists to enumerate; this
phase's new overlays (`WorktreeRemovalDialog`, `OrphanRecoveryModal`) are hand-authored against the
same Radix `FocusScope`/`DismissableLayer` primitives `DeleteConfirm.tsx` already establishes as the
pattern for every full-screen overlay in this codebase.

### Registry Safety

Not applicable — no registry in use (`Tool: none`, decided).

---

## Surface Inventory

New surfaces this phase adds to Phase 1/2's inventory:

| Surface | Kind | Always present? |
|---------|------|-----------------|
| Worktree removal dialog | overlay (reuses `DeleteConfirm.tsx`'s Radix pattern) | on demand — "Remove Worktree" action in `WorktreeSummary` |
| Orphan recovery modal | overlay, **blocking**, launch-time only | on demand — only when ≥1 orphaned agent process is found still running at launch (D-46) |
| Missing-worktree decision banner | inline, embedded in `WorktreeSummary` | on demand — only while a task's worktree row is `missing` (D-45) |
| Abandoned-run acknowledgment | inline, embedded in a run row inside `RunsSection` | on demand — only while a task's most recent relevant run is `abandoned` and unacknowledged (D-49) |
| "Needs Decision" indicator | row-level mark + project-rail count | on demand — while a task has an unresolved missing-worktree or abandoned-run item (D-46) |
| Destructive-action gate card | inline, blocking — a `destructive` variant of the existing Permission-request card | on demand — mounted in the same two places (item detail panel, session feed) whenever the pending `permission_requests` row matches D-56's fixed list |
| Git lock-retry transient row | inline, embedded in the session feed | on demand — rare; renders only while a shimmed `git` call is actively backing off (D-51/D-54) |
| Git lock-exhaustion entry | embedded in the Activity Trail | on demand — rare; renders only once a shimmed `git` call exhausts its retry budget (D-53) |

Unchanged from Phase 1/2: app shell, project rail, board list, item detail panel shell, quick-add,
command palette, search & filter, activity trail, launch sheet, live session surface, permission-
request card (routine variant), blocked indicator, worktree summary line, runs section, settings
surface, first-run/project-unreachable states.

---

## Information Architecture & Layout

### Worktree removal (D-41, D-42, D-43, D-44)

**Layout decision: one new action appended to the existing `WorktreeSummary` line, opening one new
overlay dialog that reuses `DeleteConfirm.tsx`'s exact Radix pattern** (`FocusScope` trapped/looped,
`DismissableLayer`, centered scrim, `--surface-secondary` panel, `--radius-chrome`). No new overlay
mechanism is invented — this is the same shape the codebase already uses for every destructive
confirmation.

- **The action:** "Remove Worktree" — a text-style tertiary affordance at the end of the Worktree
  summary line (Tab-reachable in the panel's existing focus order; no dedicated keyboard shortcut,
  matching Settings' "Replace" action having none either). Rendered only once a worktree exists
  (mirrors the whole line's own "absence is the state" rule) and hidden entirely for a `missing`
  worktree (see "Missing-worktree decision banner" below — a missing worktree offers Recreate/Remove
  Record instead, never a plain removal action, since there is nothing on disk to check for
  uncommitted changes).
- **The dialog — one component, three rendered states, resolved by a fresh `git status --porcelain`
  read taken at open time (never cached):**
  1. **Checking** (transient, expected sub-100ms): a single centered micro-line, "Checking for
     uncommitted changes…" — no skeleton at this speed, matching the launch sheet's own treatment of
     its near-instant context-packet assembly (`02-UI-SPEC.md`).
  2. **Clean → Confirm state:** heading "Remove worktree for `{TASK-KEY}`?"; body "Everything in it
     is committed — nothing will be lost. The directory at `{path}` will be deleted."; buttons
     "Remove" (destructive-styled, same treatment as `DeleteConfirm`'s "Delete" button — border/
     background `--destructive-strip`, text `--text-primary-rack`, never `autoFocus`ed) / "Cancel"
     (`autoFocus`ed, mirroring `DeleteConfirm`'s "a stray Enter lands on Cancel, not the destructive
     action" rule). `Escape` cancels.
  3. **Dirty → Refusal state (D-42, D-43):** heading "Can't remove — `{N}` uncommitted change`{s}`";
     body lists **every** `git status --porcelain` entry as one row each — status word (see mapping
     below) in `type-label`, path in Mono, in the order git reports them — followed by "Commit,
     stash, or discard these changes in a terminal, then try again. Flywheel won't remove a worktree
     that would lose work." **Exactly one button: "OK"** (there is no "Remove Anyway" — D-43's "no
     escape hatch" is structural, not merely the default). `Escape` closes the dialog identically to
     clicking OK; the worktree is untouched either way.
     **At volume:** the entry list scrolls inside a fixed max-height region so the dialog keeps a
     stable size and its OK button stays reachable on a worktree with hundreds of dirty files. Every
     entry stays present inside that scroll region — the list is never capped or elided with an "and
     `{N}` more" line, because criterion 1 is "shows **exactly** what would have been lost" and a
     truncated list does not.
- **Porcelain status-word mapping** (D-42's four named outcomes, plus a defensive fallback so an
  uncommon porcelain code is never silently dropped): `M` → "Modified" · `A` → "Added" · `D` →
  "Deleted" · `??` → "Untracked" · anything else (`R`enamed, `C`opied, a merge-conflict code, etc.)
  → "Changed" (a generic but honest word — never a blank cell, never the raw two-letter code).
- **Task-delete interaction (D-44):** attempting to delete a task while its `worktrees` row still
  exists now surfaces an updated blocked-delete message (replaces `02-CONTEXT.md`'s prior
  agent-run-history wording where a worktree specifically is the blocker) — see Copywriting Contract.
  The message is actionable: it names the fix (remove the worktree first) rather than merely stating
  the block, per D-44's own framing ("the refusal becomes the actionable sentence D-40 intended").

### Orphan recovery modal (D-46, D-47, D-49, D-50)

**Layout decision: a centered, blocking overlay, reusing `DeleteConfirm.tsx`'s exact Radix pattern
at a wider fixed width** (matches the launch sheet's precedent of widening the same base pattern for
denser content) — appears the instant the window paints if, and only if, the launch-time reconciler
found ≥1 agent process from a previous session still genuinely alive. Everything else the reconciler
finds (a `missing` worktree, an already-dead `running` row) does **not** appear here — see "Needs
Decision" below.

- **Width 560px**, centered, scrim, no maximum content height concern (the realistic N of orphans at
  Phase 3's one-agent-at-a-time scale is small — this is not a virtualized list).
- **No `Escape`-to-dismiss, no click-outside-to-dismiss, and no manual close button** — deliberately,
  the same deviation the Permission-request card already establishes (`02-UI-SPEC.md`: "dismissing
  the card without answering it would hide the blocked state, not resolve it"). The modal closes
  itself the instant its own list becomes empty.
- **Heading:** "Flywheel found `{N}` agent process`{es}` still running from a previous session."
- **Body — one row per live orphan:** task key + title (Mono key, Body title) — or, defensively, "an
  unresolvable task" if the run's `task_id` cannot be joined (should not occur; `agent_runs.task_id`
  is a `NOT NULL` FK, but this is the same defensive-rendering instinct `WorktreeSummary.tsx` already
  applies to a schema regression) — plus the run's identity (`Run · session {external_session_id}`,
  matching Phase 2's own row convention), a relative "Started `{time}` ago" (absolute on hover), and a
  per-row **"Kill"** button (outline style, same visual weight D-38 already establishes for a "Deny"
  button — never harder to reach than the primary action). The row's leading glyph reuses `run-
  running`'s existing `Loader` mark **with its pulse** (`agent-pulse`, `02-UI-SPEC.md` Motion) — it
  genuinely is a live process — labeled "Running (from a previous session)" rather than a bare
  "Running," so it reads distinctly from an ordinary in-window running run.
- **A single "Kill All" primary action** (filled, `--destructive-strip` background /
  `--text-primary-rack` text, same treatment as `DeleteConfirm`'s "Delete") resolves every row in one
  press. No confirmation-within-a-confirmation for Kill All — there is no data-loss risk in killing a
  process (PROC-04 is about processes, not worktree content; D-43's separate, stricter refusal
  already protects the worktree itself).
- **Footer note:** "Every process above is spending tokens right now — Flywheel didn't start any of
  them this time." This is the literal restatement of the phase's own framing ("Nothing Left Running
  cannot wait") and is the reason this is the one recovery tier that blocks.
- **What this modal deliberately does not show:** live cost/token figures (`AGNT-08`, Phase 10's
  scope — this phase shows only what the database already recorded from the process's last known
  state, never a re-attached live stream), and no "View Live" affordance into the session surface —
  the process is being killed, not observed.
- **In-flight and failure, per row** (decided during the UI-consideration probe; closes this
  document's former Open Decision #1). Between the Kill press and the row resolving, the row shows a
  transient "Killing…" label in place of its Kill button. If the kill **fails** — the process refuses
  to die, or the PID is gone but the OS still reports it — **the row persists** with inline failure
  copy naming the PID and stating that Flywheel could not kill it. The modal is **not dismissible
  while any row is unresolved**, failed rows included. This is the difference between criterion 2
  being honest and being merely attempted: the app must never reach the board implying a clean launch
  it did not achieve. A Kill All that partially fails leaves exactly the failed rows mounted and
  clears the rest.
- Once every row resolves (by Kill or Kill All), the modal unmounts and the board renders normally.
  Each killed run transitions to `abandoned` (D-49) and — if a kill record exists (D-50) — becomes
  the same acknowledgment-pending row the next section describes, so a user who kills five orphans in
  the modal then sees five acknowledgment prompts waiting in their respective tasks' Runs sections.
  This is intentional, not a duplicate surface: the modal's job is only to stop the spend; the
  acknowledgment's job is to record that the user has seen the fact of what happened.

### Missing-worktree decision banner (D-45)

Appended **inside `WorktreeSummary.tsx`**, replacing the ordinary branch+path line's content
entirely while the worktree's status is `missing` (never rendered alongside the normal line — a
worktree is either present-as-recorded or explained, never both at once):

- Leading glyph `TriangleAlert` (new mark `worktree-missing`) in `--destructive-text-rack` (the panel
  sits on rack material) — reusing the existing token, per this document's "zero new colour tokens"
  rule.
- Heading (Label role, not a full `type-heading` — this is a line-level banner, not a section):
  "This worktree is missing from disk."
- Body: "Flywheel expected it at `{path}`, but nothing is there. Recreate it to keep working, or
  remove the record if you don't need it anymore."
- Two actions, equal visual weight (neither is "more correct" than the other — this is a genuine
  either/or, not a safe-default/destructive pair): **"Recreate Worktree"** (re-runs worktree creation
  against the same recorded branch/base — near-instant, same latency class as the original Start
  Work flow) and **"Remove Record"** (drops the `worktrees` row only; nothing on disk to touch, since
  there is nothing on disk). Either action clears the task's "Needs Decision" pill immediately — a
  decision was made, which is exactly what D-45/criterion 3 require.
- No third option, no "ignore" — matching every other recovery decision in this phase, an
  acknowledgment-only path does not exist here because unlike the abandoned-run case (below) there
  genuinely is a fork in the road (recreate vs. drop) with two different downstream states.

### Abandoned-run acknowledgment (D-49, D-50)

Appended **inside `RunsSection.tsx`**, as a variant of an ordinary run row rather than a separate
list:

- Run-status badge uses the new `run-abandoned` mark: glyph `Unplug` (distinct from `Interrupted`'s
  `CircleSlash` — an interrupted run was a normal, user-initiated Stop; an abandoned run is the
  product's own supervision failing to reach a clean end, D-49's whole reason for existing as a
  separate status), word "Abandoned," colour `--destructive-text-rack` (reusing the existing "Failed"
  token — an abandoned run is, from the user's point of view, in the same "something went wrong"
  family as a failed one, even though its *cause* is entirely different and the copy below makes that
  difference legible).
- Beneath the badge, one line of explanatory copy sourced from D-50's kill record when one exists:
  "Flywheel wasn't running to supervise this session — it was stopped at `{time}` because Flywheel
  had died." If no kill record exists for this run (an edge case — the reconciler found a `running`
  row with no matching watchdog kill-record file, e.g. an even earlier crash before this phase's
  watchdog existed, or a corrupted record), fall back to the honest, weaker claim: "This run never
  finished, and Flywheel doesn't know why it stopped." — never inventing a specific reason the data
  does not support.
- A single **"Acknowledge"** button clears this task's "Needs Decision" pill. This is the one
  recovery action in this phase that changes nothing about the underlying record — the run is already
  `abandoned`, already terminal, already exactly what it will remain. Acknowledging is a statement
  that the user has seen it, not a repair — matching the phase's own "nothing is silently resumed and
  nothing is silently repaired" instinct precisely: there is nothing left *to* repair here, only to
  see.
- Selecting this run row (same interaction as any other terminal run, `02-UI-SPEC.md`) still opens its
  transcript read-only in the session surface — an abandoned run's history is exactly as inspectable
  as any other, per D-33's windowed-read design.

### "Needs Decision" indicator (D-46, reusing D-37's mechanism)

A new row-level mark, **structurally identical in mechanism to the existing Blocked indicator** (a
pill trailing the status glyph, exempt from the progressive-disclosure truncation ladder, plus a
project-rail count) but a **distinct signal**, rendered whenever either recovery item above is
outstanding for a task:

- Glyph `TriangleAlert` (new mark `recovery-needed` — deliberately the same glyph as
  `worktree-missing`'s banner icon, the row-level pill being a rollup of the same underlying fact;
  Phase 2 already established this precedent — `run-blocked` and `blocked-indicator` share `ShieldAlert`),
  word "Needs Decision," colour `--destructive-strip` on board rows (strip material) /
  `--destructive-text-rack` on rack surfaces — the existing rack/strip pair Phase 2 already reserves
  for anything that must render on both materials, reused here rather than adding a fifth token pair.
- **Distinguishable from Blocked at a glance:** different glyph (`TriangleAlert` vs. `ShieldAlert`),
  different word ("Needs Decision" vs. "Blocked"), different colour family (destructive-red vs.
  blocked-amber) — satisfies the accessibility rule that two orthogonal signals sharing a mechanism
  must never be confusable.
- Clicking it opens the item detail panel scrolled directly to whichever section holds the actionable
  content — `WorktreeSummary` first if a missing worktree is outstanding, `RunsSection` if only an
  abandoned run is (panel order is unchanged from Phase 2: Worktree summary above Runs section above
  Activity trail) — the same "fastest path from seeing it to answering it" reasoning Phase 2 already
  applied to the Blocked pill.
- **Project rail:** a second, visually distinct count badge (destructive-red family, next to the
  existing amber Blocked badge) — never merged into one number, since the two badges carry different
  urgency (Blocked = a live agent is waiting on you right now; Needs Decision = a past session left
  something for you to decide, no live spend attached). Tooltip: "`{N}` task`{s}` need a decision."
  Zero renders no badge, matching the Blocked badge's own "never a visible 0" rule.

### Destructive-action gate card (D-55, D-56, D-57, D-58)

**A `destructive` variant of the existing Permission-request card** — same mechanism, same two mount
points (item detail panel, session feed), same underlying `permission_requests` row, per D-58 ("blocks
indefinitely, exactly like any other permission request"). It is visually distinguished from the
routine variant along three axes, each chosen specifically to defeat approval-by-muscle-memory rather
than merely to look "more serious":

1. **Different border-stripe colour and glyph.** Routine card: 4px `--blocked-text-rack`/`-strip`
   stripe, `ShieldAlert` glyph, heading is just the tool name. Destructive card: 4px
   `--destructive-text-rack` stripe (reusing the existing token — no new colour), **new mark
   `destructive-gate`**, glyph `OctagonAlert` (a stop-sign shape, categorically different from the
   shield used everywhere else in this product's permission vocabulary), heading **"Destructive
   action — needs your OK"** printed above the tool name, not the tool name alone.
2. **Explicit, per-category consequence copy** — never a bare tool name or raw command string alone
   (the tool's raw input payload still renders in Mono beneath it, per Phase 2's existing rule, but a
   human sentence sits above it now):

   | D-56 category | Consequence copy |
   |---|---|
   | Force-push | "This would force-push to `{branch}`, overwriting any commits already there." |
   | Branch deletion | "This would delete the branch `{branch}`." |
   | Push to the project's default branch | "This would push directly to `{default_branch}`, the project's main branch." |
   | `git reset --hard` | "This would discard uncommitted changes in the worktree — permanently." |
   | `git clean -fdx` | "This would delete every untracked and ignored file in the worktree — permanently." |
   | History rewrite (`filter-branch`, or a rebase onto a published ref) | "This would rewrite commit history other work may depend on." |
3. **Reversed button emphasis — the load-bearing decision this phase adds.** A routine card renders
   Allow filled/primary (the common, expected answer) and Deny outline/secondary. A **destructive**
   card renders **Deny filled/primary** and **Allow outline/secondary**, and Allow's printed label
   changes to **"Allow, just this once"** rather than the bare word "Allow" — reinforcing D-57's
   structural absence of any standing grant. A user who has built the reflex of hitting the filled
   button to approve routine permission requests hits **Deny** by that same reflex here — the reflex
   is repurposed as the safety mechanism, rather than fought with a delay or a typed-confirmation
   step (both considered and rejected: a typed confirmation was already rejected for D-43's worktree
   removal on the same "rigidity is the feature, friction is not" reasoning, and a timed delay would
   contradict D-58's "no second timeout mechanism").
4. **No third action.** The routine card's tertiary "Allow this tool for this project from now on" is
   **structurally absent** from this variant — not merely hidden by a flag, so it can never regress
   back in for a destructive category (D-57).
5. **Keyboard:** `a` (Allow, just this once) / `d` (Deny) — same physical bindings as the routine
   card, unchanged in `state/keyboard.ts`; only the visual weight each key's button carries differs.
   `Shift+A` has no effect while this variant holds focus, since it renders no allow-always action to
   trigger.
6. **Uncategorized destructive commands fail closed into this variant.** A command that trips the
   destructive shim but matches **none** of D-56's six categories still renders the destructive card
   — stop-sign glyph, reversed button emphasis, no allow-always — with generic consequence copy
   naming the raw command rather than a specific effect. It never falls through to the routine
   permission card. The six-category table above is a table of *better copy*, not a gate on *which
   treatment applies*: an unrecognized dangerous command is the case where approve-by-reflex is most
   dangerous, so it must not be the case that inherits the routine card's Allow-primary layout.

### Git lock-retry transient row (D-51, D-53, D-54)

**Reuses the existing "System/transient" feed-row kind** (`02-UI-SPEC.md`: "a single muted Micro-role
line, never styled as an error") — no new visual component. Renders only while a shimmed `git`
invocation is actively backing off from an `.git/index.lock` collision:

- Copy: "git: retrying after index lock (attempt `{n}`/`{max}`)…" — Micro role, `text-muted-rack`,
  identical treatment to the existing `api_retry`-style row.
- **Per D-53, this row appears only while retries are in flight and never for a collision that
  resolves on its own without user-visible delay** — the collision counter is silent by design;
  only a *sequence* of retries taking visible wall-clock time produces this row, and only because the
  agent's own tool-call row is otherwise sitting apparently idle (the phase's own stated worry: "a
  slow commit does not read as a hang").
- Disappears the instant the underlying `git` call either succeeds or exhausts its budget — it never
  lingers as a stale row once the outcome is known.

### Git lock-exhaustion entry (D-53, D-19)

**Reuses the existing Activity Trail** (`01-UI-SPEC.md`, BOARD-09) — no new surface. Renders as one
more human-rendered entry, per D-19's existing "event payloads are designed for human rendering"
rule:

- Copy: "Git lock contention: `{command}` in `{repository}` failed after `{N}` attempts." — actor
  attributed to the system actor (per D-19/DATA-03's human/agent/system triad, `assignee-system`
  mark), timestamped like every other trail entry.
- This is the **only** git-lock-contention artifact that is ever board-visible per D-53's own
  decision — a resolved retry sequence writes nothing to the trail, keeping the signal-to-noise ratio
  D-53 explicitly protects.

---

## Row Anatomy Additions

Only new elements; everything in Phase 1/2's Row Anatomy (status glyph, key, title, estimate, epic
pill, assignee, criteria count, priority glyph, actor-of-last-change, the Blocked indicator) is
unchanged and holds its fixed left-to-right order. The new **"Needs Decision" pill** inserts
immediately after the Blocked indicator (i.e., trailing the status glyph, then Blocked if present,
then Needs Decision if present) and is, like Blocked, **structurally exempt from the progressive-
disclosure truncation ladder** — a task must never silently lose a signal that exists specifically
because a previous session ended badly.

---

## Keyboard Map Additions

All additions register in `state/keyboard.ts`'s single key→action map, per the established
discipline — none is a competing per-component handler. Most of this phase's new affordances
(Remove Worktree, Recreate/Remove Record, Acknowledge, Kill/Kill All) are plain Tab-reachable buttons
with no dedicated shortcut, matching the precedent Settings' "Replace" action already sets — a
dedicated single-letter binding is reserved for actions used constantly, not once-per-crash actions.

### Destructive-action gate card (focus on the card, wherever it is mounted)

| Key | Action |
|-----|--------|
| `a` | Allow, just this once — same binding as the routine card's Allow, restyled per "Destructive-action gate card" above |
| `d` | Deny — same binding as the routine card's Deny, restyled to the primary/filled position |

`Shift+A` is inert here (no allow-always action exists on this variant). No `Escape` binding — same
"cannot be dismissed" rule the routine card already establishes.

### Orphan recovery modal (focus inside the modal)

No `Escape` binding (see "Orphan recovery modal" above — the modal cannot be dismissed, only
resolved). `Tab`/`Shift+Tab` move between each row's "Kill" button and the "Kill All" action; `Enter`
activates the focused button, matching ordinary button semantics — no new binding table entries
required.

---

## State Inventory Additions

| Surface | State | Behavior / Copy |
|---------|-------|------------------|
| Worktree removal dialog | Checking (transient) | "Checking for uncommitted changes…" — no skeleton at this speed (see Information Architecture). |
| Worktree removal dialog | Clean | Confirm state: Remove/Cancel, per Copywriting Contract. |
| Worktree removal dialog | Dirty | Refusal state: porcelain rows + count, single "OK" button, no destructive path (D-43). |
| Orphan recovery modal | ≥1 live orphan at launch | Blocking, per-row Kill + Kill All, per Information Architecture. |
| Orphan recovery modal | Last row resolved | Modal unmounts immediately; no manual close ever existed. |
| WorktreeSummary | Worktree `missing` (D-45) | Banner replaces the branch/path line entirely; Recreate/Remove Record, per Copywriting Contract. |
| WorktreeSummary | Worktree present-and-verified | Unchanged from Phase 2 — branch + copyable path. |
| RunsSection | A run is `abandoned` and unacknowledged | Badge + explanatory line + "Acknowledge" button, per Copywriting Contract. |
| RunsSection | An abandoned run has been acknowledged | Row renders exactly as any other terminal run's history — the acknowledgment itself carries no lingering visual mark once cleared, since the badge/word "Abandoned" already remains permanently on the row as the historical fact; only the task's "Needs Decision" pill clears. |
| Board row | Task has an unresolved recovery item | "Needs Decision" pill renders, per Row Anatomy Additions. |
| Board row / detail | Task delete attempted while a `worktrees` row exists (D-44) | Blocked-delete toast with the updated, actionable copy (see Copywriting Contract) — replaces the prior agent-run-history-only wording specifically when a worktree is the blocking row. |
| Session feed | A shimmed `git` call is retrying (D-51) | Transient system row, per Information Architecture; disappears on resolution either way. |
| Activity trail | A shimmed `git` call exhausted its retry budget (D-53) | One human-rendered entry naming repository/command/attempt count; never repeated per individual retry. |
| Permission mechanism | A pending request matches D-56's destructive list | Destructive-gate card variant renders instead of the routine card, in both existing mount points. |

---

## Performance Contract Additions

No new performance obligations beyond what Phase 1/2 already established. The orphan recovery
modal's row list is bounded by the realistic count of agent processes a single developer's machine
can have running at once (not a virtualization concern at Phase 3's one-agent-at-a-time scale); the
porcelain-status rows in the worktree removal dialog are bounded by the files actually dirty in one
worktree, read once at dialog-open time, never polled.

---

## Motion Additions

Inherits the single easing curve (`--ease`) and the `prefers-reduced-motion` contract, unchanged —
no new curve, no new duration token.

- **Orphan recovery modal:** no entrance animation — it is present the instant the window paints
  (Phase 1's "no page-load choreography" rule applies literally here, since this modal *is* part of
  the very first paint on a launch that needs it). A resolved row is removed as a plain state change,
  never a fade or slide-out (Phase 1's "never a fade" rule, unchanged).
- **Missing-worktree banner / abandoned-run acknowledgment / "Needs Decision" pill:** plain state
  changes on appearance and on resolution — identical treatment to the Blocked pill's own "a plain
  state change, matching Phase 1's rule for the row itself" (`02-UI-SPEC.md`).
- **Destructive-action gate card:** no entrance animation beyond what the feed's own virtualization
  naturally does when the row mounts — identical rule to the routine Permission-request card
  (`02-UI-SPEC.md` Motion Additions), since this is the same underlying state change (blocked ↔ not
  blocked) wearing a different variant.
- **Worktree removal dialog's Checking → Clean/Dirty transition:** a plain content swap inside the
  same mounted overlay, no cross-fade — consistent with "a strip moves or it does not... never a
  fade" applied to dialog content rather than a board row.
- **Git lock-retry transient row:** appears/disappears exactly as any other feed row mounts/unmounts
  under virtualization — no special-cased animation.

---

## Typography Additions

No new type roles and no new Mono-utility rule — Micro/Label/Body/Heading (10/11/13/15px, weights
400/600) and the existing Mono utility (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`, from
`02-UI-SPEC.md`) cover every new surface's needs. Applied to: the porcelain rows' paths, the
orphan modal's PID/session-id fields, the destructive-gate card's flagged command string, and the
git-lock exhaustion entry's repository/command names — every one of these is literal/technical
content, exactly the category Phase 2's Mono rule already exists for.

---

## Color Additions

**Zero new colour tokens this phase.** Every new signal reuses an existing token, distinguished by a
new glyph and printed word rather than a new hue:

| New signal | Reused token(s) | Distinguished by |
|---|---|---|
| `worktree-missing` banner icon | `--destructive-text-rack` | `TriangleAlert` glyph + "This worktree is missing from disk" heading |
| `run-abandoned` badge | `--destructive-text-rack` | `Unplug` glyph + "Abandoned" word (vs. `Failed`'s `CircleX` + "Failed", and `Interrupted`'s `CircleSlash` + "Interrupted") |
| `recovery-needed` row pill | `--destructive-strip` (board rows) / `--destructive-text-rack` (rack surfaces) | `TriangleAlert` glyph + "Needs Decision" word (vs. Blocked's `ShieldAlert` + "Blocked", amber family) |
| `destructive-gate` card stripe | `--destructive-text-rack` | `OctagonAlert` glyph + "Destructive action — needs your OK" heading (vs. the routine card's `ShieldAlert` + bare tool name) |
| Orphan modal's live-process rows | `--accent-text-rack` (existing `run-running` token, unchanged) | reused verbatim — this is genuinely the same "running" fact, only the context copy ("from a previous session") differs |
| "Kill" / "Kill All" / "Remove" buttons | `--destructive-strip` background, `--text-primary-rack` text | identical treatment to `DeleteConfirm.tsx`'s existing "Delete" button — no new button style |

**The one inherited-ratio dependency for Phase 10.1 to be aware of:** every reuse above rests on
`--destructive-text-rack` (`#d9776c`, measured 5.60:1 on `#171b22` / 5.12:1 on `#1e232b`) and
`--destructive-strip` (`#9c351c`, measured 4.94:1 on strip stock) continuing to clear AA once
Phase 10.1 re-derives the palette against a new ground. `theme/__tests__/contrast.test.ts` already
asserts both ratios today; this phase adds no new assertion because it adds no new value — Phase
10.1's own re-derivation work is what must re-run that existing test, not this phase.

The 60/30/10 discipline is unaffected: none of the above claims any share of "loudest" — the
destructive family already carries that weight from Phase 2's "Failed" status, and this phase adds
meaning to it (via glyph/word) rather than adding a competing accent.

---

## Copywriting Contract Additions

| Element | Copy |
|---------|------|
| Remove Worktree action (WorktreeSummary) | "Remove Worktree" |
| Removal dialog — checking | "Checking for uncommitted changes…" |
| Removal dialog — confirm heading | "Remove worktree for `{TASK-KEY}`?" |
| Removal dialog — confirm body | "Everything in it is committed — nothing will be lost. The directory at `{path}` will be deleted." |
| Removal dialog — confirm buttons | "Remove" (destructive) / "Cancel" |
| Removal dialog — refusal heading | "Can't remove — `{N}` uncommitted change`{s}`" |
| Removal dialog — refusal body | "Commit, stash, or discard these changes in a terminal, then try again. Flywheel won't remove a worktree that would lose work." |
| Removal dialog — refusal button | "OK" |
| Porcelain status words | "Modified" / "Added" / "Deleted" / "Untracked" / "Changed" (fallback for any other code) |
| Blocked-delete toast (task has a worktree, D-44) | "Cannot delete this task: a worktree exists for it. Remove the worktree first, then delete." |
| Orphan modal heading | "Flywheel found `{N}` agent process`{es}` still running from a previous session." |
| Orphan modal row — running label | "Running (from a previous session)" |
| Orphan modal row — kill action | "Kill" |
| Orphan modal — kill-all action | "Kill All" |
| Orphan modal — footer note | "Every process above is spending tokens right now — Flywheel didn't start any of them this time." |
| Orphan modal — unresolvable task fallback | "an unresolvable task" |
| Orphan modal row — kill in flight | "Killing…" |
| Orphan modal row — kill failed | "Couldn't kill this process (PID `{pid}`). It's still running. Kill it from a terminal, then reopen Flywheel." |
| Missing-worktree heading | "This worktree is missing from disk." |
| Missing-worktree body | "Flywheel expected it at `{path}`, but nothing is there. Recreate it to keep working, or remove the record if you don't need it anymore." |
| Missing-worktree actions | "Recreate Worktree" / "Remove Record" |
| Abandoned-run explanation (kill record present) | "Flywheel wasn't running to supervise this session — it was stopped at `{time}` because Flywheel had died." |
| Abandoned-run explanation (no kill record) | "This run never finished, and Flywheel doesn't know why it stopped." |
| Abandoned-run action | "Acknowledge" |
| Needs-Decision pill | "Needs Decision" |
| Needs-Decision, project-rail badge (tooltip) | "`{N}` task`{s}` need a decision." |
| Destructive-gate heading | "Destructive action — needs your OK" |
| Destructive-gate consequence copy | See the D-56 category table in "Information Architecture & Layout" § Destructive-action gate card |
| Destructive-gate consequence copy — uncategorized command | "This command can destroy work, and Flywheel doesn't recognise exactly what it would do." (the raw command still renders in Mono beneath it) |
| Destructive-gate actions | "Deny" (primary/filled) / "Allow, just this once" (outline) |
| Git lock-retry (session feed, transient) | "git: retrying after index lock (attempt `{n}`/`{max}`)…" |
| Git lock-exhaustion (activity trail) | "Git lock contention: `{command}` in `{repository}` failed after `{N}` attempts." |

---

## UI Considerations

State coverage resolved against this phase's eight new surfaces by the UI-consideration probe
(`ui-consideration-probe.cjs`), not by a hand pass — so the two git-lock surfaces and the
categories an earlier grouped pass folded together are each covered on their own row below.

Element kinds were **confirmed, not accepted** from the heuristic classifier: the "Needs Decision"
indicator classified as `list-collection` only and was corrected to `list-collection +
interactive-control + static-content`, which is what raises its long-text row. The classifier is
lossy in the under-detecting direction, so this confirmation step — not the cue match — is what
makes the coverage below sound.

Empty- and error-state **copy** lives in the Copywriting Contract above; this section covers
coverage STATUS and references those rows rather than restating them.

**Applicable state considerations: 64 raised — 31 covered (explicit), 18 backstop, 15 dismissed
with reason, 0 unresolved.**

Four rows were **decided by the owner during this probe** rather than lifted from the prose, and
are marked `[decided]`: E2/loading and E2/error (per-row in-flight state and kill-failure
behaviour — together these close Open Decision #1 below), E6/partial (a destructive command
matching none of D-56's six categories), and E1/overflow (the dirty-file list at volume). Each is
`✅ covered`, not `🧪 backstop` — they are contract now, and the builder must not re-decide them.

Status vocabulary matches `01-UI-SPEC.md`: `✅ covered` lifts into `must_haves.truths` as a plain
truth; `🧪 backstop` lifts as `{ statement, verification: backstop }` and, at verify time, is
confirmed only by explicit evidence or routes to `human_needed` — never a silent pass; `⊘ dismissed`
carries a reason and is deliberately not lifted.

### Worktree removal dialog (E1)

*Element kinds: form, list-collection, interactive-control, static-content*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ✅ covered | The "Remove Worktree" action is not rendered in `WorktreeSummary` when the task has no worktree record, so the dialog has no zero-data state — it always opens against a known worktree path. |
| loading | ✅ covered | While `git status --porcelain` is in flight the dialog shows the Checking state: a single Micro-role line, never a skeleton or spinner (sub-100ms expected). |
| error | 🧪 backstop | If the porcelain read itself fails — e.g. the worktree directory was deleted out from under Flywheel between the summary line rendering and the dialog opening — the dialog surfaces the read failure and refuses the removal. It must never present the Clean state on an unreadable worktree. Exact copy and treatment are not pinned here. |
| populated | ✅ covered | The Dirty refusal state renders every `git status --porcelain` entry as its own row: the porcelain status word mapped per the Copywriting Contract, plus the file path in Mono. |
| partial | 🧪 backstop | A porcelain read that returns but is truncated or only partially parseable is treated as dirty and refuses the removal — never rendered as a partial list. Fail closed toward preserving work. |
| overflow | ✅ covered **[decided]** | The dirty-file list scrolls inside a fixed max-height region so the dialog keeps a stable overall size and its Cancel/Remove buttons stay reachable regardless of file count. Every entry is present inside the scroll region — the list is never capped or elided with an "and N more" line, so criterion 1's "shows exactly what would have been lost" holds at any volume. |
| zero-one-many | ✅ covered | The refusal heading interpolates singular/plural — "Can't remove — `{N}` uncommitted change`{s}`" — per the Copywriting Contract. The zero case is the Clean state, which carries its own distinct copy rather than an empty list. |
| long-text | ✅ covered | Paths render in Mono and inherit `DeleteConfirm.tsx`'s existing max-width body treatment; the dialog does not grow horizontally to fit an unusually long path. |

### Orphan recovery modal (E2)

*Element kinds: list-collection, interactive-control, static-content*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ✅ covered | The modal is structurally never mounted when the launch reconciler finds zero live orphans — its existence is conditioned on `N ≥ 1`, so there is no empty state to design. |
| loading | ✅ covered **[decided]** | Reconciliation completes in `main.rs` `setup()` before any window paints, so the modal has no initial load state. Per-row kill actions **do** carry an in-flight state: a row shows a transient "Killing…" label between the Kill press and the row resolving. Closes Open Decision #1. |
| error | ✅ covered **[decided]** | When a kill fails, the row **persists** in the modal with inline failure copy naming the PID and stating that Flywheel could not kill it. The modal cannot be dismissed while any row is unresolved — the app must not reach the board claiming a clean launch it did not achieve. This is what makes criterion 2 honest rather than merely attempted. |
| populated | ✅ covered | Each row shows task identity, run identity, a relative start timestamp and a Kill action; a Kill All primary action resolves every row. |
| partial | ✅ covered | A Kill All that succeeds for some rows and fails for others leaves exactly the failed rows mounted with their failure copy while successful rows disappear. The modal stays blocking until the remainder are resolved. |
| overflow | 🧪 backstop | The orphan row list scrolls within the fixed 560px-wide modal rather than growing it past the viewport; the exact max-height is not pinned. |
| zero-one-many | ✅ covered | Heading copy interpolates singular/plural ("process" vs. "processes") per the Copywriting Contract; zero is unreachable by construction. |
| long-text | 🧪 backstop | An unusually long task title in a modal row follows the board row's truncate-not-wrap convention; not separately confirmed for this surface. |

### Missing-worktree decision banner (E3)

*Element kinds: list-collection, interactive-control, static-content*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ✅ covered | Absent by construction whenever the worktree row's status is not `missing` — absence is the state, matching `WorktreeSummary`'s existing convention. It never renders alongside the ordinary branch+path line; it replaces that line entirely. |
| loading | 🧪 backstop | "Recreate Worktree" re-runs worktree creation in the same latency class as the original Start Work flow; whether it needs its own loading state is left as an implementation density decision (Open Decision #2 below). |
| error | 🧪 backstop | If "Recreate Worktree" fails — base ref gone, disk unavailable — the banner stays mounted and surfaces the failure rather than clearing the task's "Needs Decision" pill. A failed recreate is not a decision made. |
| populated | ✅ covered | Glyph, Label-role heading, body naming the expected path, and two equal-weight actions (Recreate Worktree / Remove Record) render together as soon as the worktree row reads `missing`. There is no third option and no "ignore". |
| partial | ⊘ dismissed | The banner has no partial data shape — a worktree row is either `missing` or it is not, and there is no intermediate record for it to render. |
| overflow | 🧪 backstop | A long recorded path in the body wraps within the item detail panel rather than truncating — the path is the actionable content, not decoration. Not separately pinned in this document. |
| zero-one-many | ⊘ dismissed | Singleton surface — one banner per worktree row, never a collection, so there is no zero/one/many axis. |
| long-text | 🧪 backstop | The interpolated filesystem path can be arbitrarily long; it inherits the item detail panel's body wrapping rather than the board row's truncation ladder. |

### Abandoned-run acknowledgment (E4)

*Element kinds: list-collection, interactive-control, static-content*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ✅ covered | Absent by construction whenever the task's most recent relevant run is not `abandoned`, or is already acknowledged — matching `RunsSection`'s existing absence-is-the-state convention. |
| loading | 🧪 backstop | The Acknowledge round trip is a single record write; whether it shows an in-flight state is not pinned. |
| error | 🧪 backstop | If Acknowledge fails to persist, the badge and explanatory line stay mounted and the task's "Needs Decision" pill does not clear. |
| populated | ✅ covered | Run-status badge carrying the `run-abandoned` mark (`Unplug` glyph, word "Abandoned", `--destructive-text-rack`), one explanatory line beneath it sourced from the watchdog kill record, and a single Acknowledge button. Selecting the row still opens its transcript read-only. |
| partial | ✅ covered | When no kill record exists for the run — **including when a record exists but is malformed or unparseable** — the copy falls back to the honest weaker claim ("This run never finished, and Flywheel doesn't know why it stopped"), never inventing a specific reason the data does not support. |
| overflow | ⊘ dismissed | One explanatory line inside an existing run row; it has no container of its own to exceed beyond the row's inherited treatment. |
| zero-one-many | ⊘ dismissed | Singleton per run row rather than a collection — there is no zero/one/many axis. |
| long-text | ⊘ dismissed | The only interpolated value in this copy is a fixed-width timestamp; no long-text case is reachable. |

### "Needs Decision" indicator (E5)

*Element kinds: list-collection, interactive-control, static-content (corrected from the classifier's `list-collection` alone)*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ✅ covered | No pill and no rail badge when zero tasks in the project have an outstanding recovery item — matching the Blocked badge's own "never a visible 0" rule. |
| loading | ⊘ dismissed | The pill is derived from already-loaded board state; it has no independent fetch and therefore no loading state. |
| error | ⊘ dismissed | The pill renders from local board state and issues no request of its own that can fail. |
| populated | ✅ covered | Pill renders trailing the Blocked pill when both are present, or trailing the status glyph alone; the project rail renders a separate destructive-family count badge, never merged into the amber Blocked count. |
| partial | ⊘ dismissed | The pill is a boolean rollup over a task's outstanding recovery items — there is no partial state between present and absent. |
| overflow | ✅ covered | Exempt from the row's progressive-disclosure truncation ladder per Row Anatomy Additions — never silently dropped at a narrower window width. |
| zero-one-many | ✅ covered | Rail-badge tooltip interpolates singular/plural ("`{N}` task`{s}` need a decision"); zero renders no badge at all. |
| long-text | ✅ covered | When a long task title, a Blocked pill and a Needs Decision pill compete for row width, **both pills hold their space and the title truncates**. The pills sit above the title in the truncation ladder: a dropped pill loses a signal, a truncated title loses only characters. |

### Destructive-action gate card (E6)

*Element kinds: form, list-collection, interactive-control, static-content*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ⊘ dismissed | The card is mounted only against a pending `permission_requests` row; with no pending request there is no card, so it has no zero-data state. |
| loading | 🧪 backstop | Between pressing Deny or "Allow, just this once" and the request resolving, the card stays visible and its buttons do not accept a second press; exact in-flight treatment is not pinned. |
| error | 🧪 backstop | If answering fails at the IPC layer the card stays mounted and unanswered rather than optimistically clearing — mirroring the same open backstop the routine permission-request card already carries in `02-UI-SPEC.md` E3. |
| populated | ✅ covered | Destructive border stripe, `OctagonAlert` glyph, "Destructive action — needs your OK" heading above the tool name, the per-category consequence sentence, the raw payload in Mono, and the reversed Deny-primary / "Allow, just this once"-secondary button pair with no third action. |
| partial | ✅ covered **[decided]** | A command that trips the destructive shim but matches **none** of D-56's six categories still renders the **destructive** variant — stop-sign glyph, reversed button emphasis, no allow-always — with generic consequence copy naming the raw command rather than a specific effect. It never falls through to the routine permission card: an unrecognized dangerous command **fails closed** into the strong gate. |
| overflow | 🧪 backstop | A long raw command payload in the Mono block scrolls or wraps within the card rather than expanding it past its mount container; not pinned. |
| zero-one-many | 🧪 backstop | Where several destructive requests are pending at once they queue as separate cards in mount order rather than merging into one; not pinned in this document. |
| long-text | 🧪 backstop | Long interpolated branch names inside consequence copy wrap rather than truncate — the branch name is the load-bearing detail of the sentence. |

### Git lock-retry transient row (E7)

*Element kinds: list-collection, static-content*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ✅ covered | No row at all for a collision that resolves without user-visible delay — the collision counter is silent by design (D-53). Only a retry sequence taking visible wall-clock time produces a row. |
| loading | ✅ covered | The row **is** the in-flight state: "git: retrying after index lock (attempt `{n}`/`{max}`)…" in Micro role, `text-muted-rack`, never styled as an error. |
| error | ✅ covered | The row never renders the failure itself — it disappears the instant the underlying `git` call either succeeds or exhausts its budget, and never lingers as a stale row. Exhaustion surfaces as the Activity Trail entry (E8) instead. |
| populated | ✅ covered | A single muted Micro-role line in the session feed, identical in treatment to the existing `api_retry`-style transient row. |
| partial | ⊘ dismissed | A single interpolated line with no independent fields — it has no partial-data shape. |
| overflow | ⊘ dismissed | One short Micro-role line inside the feed's existing row treatment; it cannot exceed its container. |
| zero-one-many | 🧪 backstop | Where several shimmed `git` calls back off concurrently, whether each gets its own row or they collapse into one is not pinned; at Phase 3's one-agent-at-a-time scale concurrent retries within a single session are not expected. |
| long-text | ⊘ dismissed | Copy is fixed apart from two small integers; no long-text case is reachable. |

### Git lock-exhaustion entry (E8)

*Element kinds: list-collection, static-content*

| Category | Status | Resolution / Reason |
|----------|--------|---------------------|
| empty | ✅ covered | A resolved retry sequence writes nothing to the trail — this entry is the only board-visible git-lock-contention artifact that ever exists (D-53), protecting the signal-to-noise ratio D-53 explicitly guards. |
| loading | ⊘ dismissed | Activity Trail entries are historical records rendered from already-loaded events; the entry has no load state of its own. |
| error | ⊘ dismissed | The entry **is** the error record; it has no failure mode of its own beyond the trail's existing rendering. |
| populated | ✅ covered | One human-rendered trail entry — "Git lock contention: `{command}` in `{repository}` failed after `{N}` attempts." — attributed to the system actor with the `assignee-system` mark and timestamped like every other entry. |
| partial | ⊘ dismissed | The entry is written from a complete event payload or not at all; there is no partial shape. |
| overflow | 🧪 backstop | A long interpolated command string inherits the Activity Trail's existing entry treatment rather than defining its own; not separately pinned. |
| zero-one-many | ✅ covered | Repeated exhaustions append as ordinary separate trail entries; the trail's existing ordering, grouping and density rules apply unchanged. |
| long-text | 🧪 backstop | The interpolated command can be arbitrarily long; it follows the trail's existing entry wrapping rather than a new rule. |

---

## Open Decisions the Builder Must Not Invent

Carried forward from `01-UI-SPEC.md`/`02-UI-SPEC.md` (unchanged, still open where noted): Help menu
destination (#8), Group By lens scope (#9), project-rail overflow beyond nine (#10), Settings
unsaved-edit warning (Phase 2 #1), expanded-tool-call max-height pixel value (Phase 2 #2) — none of
these are Phase 3 concerns and none is resolved here.

New for Phase 3:

1. ~~**Whether a long-running "Kill All" (many orphans at once) needs any per-row in-flight
   indicator**~~ — **CLOSED during the UI-consideration probe.** A row shows a transient "Killing…"
   label between the Kill press and the row resolving, and a row whose kill **fails** persists with
   inline failure copy naming the PID while the modal stays undismissable. See `## UI Considerations`
   → Orphan recovery modal (E2), rows `loading` and `error`. This is contract, not an implementation
   density call: criterion 2 asserts no agent process survives, so the modal must not be dismissible
   in a state where one does.
2. **Whether the missing-worktree banner's "Recreate Worktree" action reuses the exact latency
   treatment of the original Start Work flow (a spinner-free, near-instant round trip) or needs its
   own loading state** — not specified here; left as an implementation density decision, consistent
   with how Phase 1/2 treat non-structural timing specifics.
3. **Whether `git-lock-retry`'s transient row needs a Legend entry** — resolved as **no** in this
   document (mirrors the existing `api_retry` row, which was never added to `legend/marks.ts`
   either), but flagged here since it is a departure from this phase's own "append every new mark"
   rule and should not be silently revisited without noting why.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Dimension 7 Inventory Provenance: PASS

**Approval:** pending
