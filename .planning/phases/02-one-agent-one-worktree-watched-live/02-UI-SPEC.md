---
phase: "2"
slug: "one-agent-one-worktree-watched-live"
status: draft
shadcn_initialized: false
preset: none
component_strategy: a-selfhost-radix
component_strategy_decided: "2026-09-09 (Phase 1 — inherited, not re-decided this phase)"
typeface: "Archivo (variable, wdth+wght axes) — OFL, Omnibus-Type — inherited from Phase 1"
icon_library: lucide-react
radius_strip: "2px"
radius_chrome: "6px"
created: "2026-09-10"
---

# Phase 2 — UI Design Contract

Platform: **macOS desktop only** (Tauri v2 native WebView), unchanged from Phase 1. Visitor mode:
**Operate**. This phase extends `01-UI-SPEC.md` — it does not re-open anything that document marks
LOCKED (palette, type, radius, spacing, board row anatomy, the rack/strip material split). Where
Phase 1 left room, this document resolves Phase 2's own new surfaces: the launch sheet, the live
session surface, the blocked-state signal, the worktree/run/session record view on a task, and the
application's first Settings surface.

**Autonomous run (`--auto`).** Every open question below that would normally be asked was resolved
from `02-CONTEXT.md`'s Decisions/Claude's Discretion, `02-RESEARCH.md`, `01-UI-SPEC.md`, and
`.claude/CLAUDE.md`'s standing preference toward a bolder, more modern resolution wherever Phase 1
left room — recorded with rationale in "Discretion Items Resolved" below, not re-litigated per
element throughout the document.

---

## Build Process Requirement — Binding, Inherited from Phase 1

Unchanged from `01-UI-SPEC.md`: every plan task in this phase that creates or edits UI must load
`reference/craft-floor.md` before editing, run the Impeccable detector once the surface is
functionally complete and fix what it flags, capture screenshots for review, and end by updating
`DESIGN.md`. One phase-2-specific addition: **every new mark this phase introduces (blocked
indicator, run-status badges, permission-decision icons) must be appended to
`packages/desktop/src/legend/marks.ts` before the task is done** — `MarkChannel` gets a new
`"agent"` member for these. No mark may exist that the legend does not define; this is Phase 1's
own rule, unchanged, applied to Phase 2's new vocabulary.

---

## Discretion Items Resolved (Autonomous Run)

| # | Item (from `02-CONTEXT.md` Claude's Discretion) | Resolution | Rationale |
|---|---|---|---|
| 1 | How the worktree, agent-run and session records render on a task | One **Worktree summary line** (1:1, always present once Start Work has run once) plus a **Runs list** (one row per `AgentRun`, newest first). Each run row displays both its run identity and its session identity together (`Run · session {external_session_id}`) rather than as a separate third list — see "Item Detail — Runs Section" below. | Success criterion 5 requires three *linked* record types be visible, not three separate lists. `02-RESEARCH.md` Open Question 2 flags that `AgentRun` and `Session` are 1:1 under D-30 (no resume); a redundant standalone "Sessions" list would duplicate the Runs list row-for-row. This reading is compatible with either final schema shape (single table or two 1:1 tables) the planner chooses. |
| 2 | Whether the DATA-04 trigger record surfaces in the UI at all | **No dedicated Trigger surface.** Each run row's existing actor + relative-timestamp treatment (identical pattern to the Activity Trail) already answers "who/what started this" for the only implemented source, `user_action`. | Building a UI for a one-value enum is speculative surface for a v2 feature (`schedule`/`webhook`) that doesn't exist yet. When those sources land, "via {source}" extends the same label without new UI. |
| 3 | Whether the user can type into a running session to steer it | **Out of scope**, per the context doc's own default. No text-input affordance on the session surface targets the running agent. | No Phase 2 success criterion names it; CONTEXT.md explicitly defaults to out unless nearly free, and it is not — it implies `--input-format stream-json`, an unresearched adapter surface. |
| 4 | What a failed/errored run looks like | Run status gets a fourth visible value beyond running/completed/interrupted: **Failed**, rendered with the new `--destructive-text-rack` token plus a distinct glyph (never colour alone). The session surface shows a terminal banner at the foot of the feed with the `result` event's error subtype. See "Run Status" below. | `agent_runs.status` already includes `'failed'` per `02-RESEARCH.md`'s migration sketch; leaving it undesigned would mean the executor invents it mid-implementation. |
| 5 | Slug drift / duplicate directory names | Out of scope for this UI-SPEC — D-24 fixes the slug at creation (no rename-triggered UI); no duplicate-handling UI is designed because `02-RESEARCH.md`'s worktree-reuse check (`worktrees` table lookup before `git worktree add`) makes a same-task duplicate structurally impossible, and a cross-task collision is a backend uniqueness concern, not a surface this phase renders. | Matches the phase boundary — this is planner/backend territory, not a UI contract gap. |
| 6 | Where the user answers a permission request "from the board" | **Both** the item detail panel and the session surface render the identical permission-request card component when a task's active run is blocked — the item detail panel so the user never has to leave the board to answer, the session surface so it appears in place in the transcript. Answering in either place resolves the same `permission_requests` row. | The phase goal's own wording — "the user answers it from the board" — is stronger than D-32's session-surface-only reading. Reusing one component in two mount points is standard practice already established by this codebase's shared-picker pattern (`ParentPicker` reused across row and detail). |

---

## Design System

**Unchanged from `01-UI-SPEC.md` — pre-populated, not re-decided.**

| Property | Value |
|----------|-------|
| Tool | none — `shadcn` remains deliberately uninitialized (decision, not deferral, carried forward) |
| Preset | not applicable |
| Component library | self-hosted, hand-rolled Radix primitives (`@radix-ui/react-focus-scope`, `@radix-ui/react-dismissable-layer`, already dependencies) |
| Icon library | Lucide (`lucide-react`, ISC) — uniform 2px stroke, outline-only |
| Font | Archivo (OFL, self-hosted variable, `wght` 100–900 / `wdth` 62–125) |

### Component Inventory

Omitted — `Tool: none`, unchanged from Phase 1. No shadcn registry exists to enumerate.

---

## Surface Inventory

New surfaces this phase adds to Phase 1's inventory:

| Surface | Kind | Always present? |
|---------|------|-----------------|
| Launch sheet | overlay (Radix Dialog pattern, reuses palette's focus-trap machinery) | on demand — Start Work |
| Live session surface | full surface, replaces board content area | on demand — pushed into from a task with a run, popped back out of |
| Permission-request card | inline, blocking | on demand — mounted in item detail panel AND session surface simultaneously wherever the task's active run is blocked |
| Blocked indicator | row-level mark + project-rail count | on demand — only while a task's active run is blocked |
| Runs section | embedded section inside item detail panel | yes, once ≥1 `AgentRun` exists for the task |
| Worktree summary | embedded line inside item detail panel | yes, once a worktree exists for the task |
| Settings surface | full surface, replaces board content area (first Settings surface in the product) | on demand — menu bar / ⌘, / command palette |

Unchanged from Phase 1: app shell, project rail, board list, item detail panel shell, quick-add,
command palette, search & filter, activity trail, first-run/project-unreachable states.

---

## Information Architecture & Layout

### Launch sheet (D-27)

**Layout decision: a centred overlay dialog, not the 480px item-detail panel and not a full-page
route.** The item-detail panel is a frequent glance surface (Phase 1's own reasoning) and this is a
rare, deliberate, one-time-per-run action whose content — the full assembled context packet — does
not fit that panel's width. It reuses the command palette's existing overlay/scrim/focus-trap
mechanics (Radix `Dialog`-equivalent) rather than inventing a new overlay pattern.

- **Width 640px** (wider than the 480px detail panel — the context packet needs legible line
  length), **max-height 80vh**, scrollable body, centred with scrim.
- Header: "Start Work on `{TASK-KEY}`" (Heading role, 15px/600).
- Body (scrollable, read-only, Body role 13px/400): the rendered `assembleContextPacket(taskId)`
  output — epic title/description, task title/description, every acceptance criterion with its
  verification hint, and the branch/worktree facts that will be created (`flywheel/{slug}` →
  `{base-ref}`, path `~/Flywheel/{PROJECT}/{TASK}/`) — printed in Mono (see Typography) so the
  branch name and path read as literal, copyable strings, not prose.
- Below the packet, pinned (not scrolled away): an optional free-text instruction field (multi-line,
  placeholder "Anything else the agent should know for this run? (optional)") and a permission-mode
  selector (segmented control: **Accept Edits** [default, D-36] / Plan / Ask Every Time /
  Bypass Permissions — labels match the adapter's `--permission-mode` values one-to-one so what the
  user picks is exactly what gets passed, no relabeling).
- Footer: "Start Work" primary button (accent, chrome radius) + "Cancel" (text button). `Enter`
  submits from anywhere in the sheet except inside the free-text field (where `Enter` inserts a
  newline — `⌘Enter` submits from inside that field instead, matching the detail panel's existing
  `⌘Enter`-to-save convention). `Escape` cancels — **nothing is spawned, no worktree is created, no
  process starts** until this dialog's primary action fires.
- Reopening this sheet on a task that already has a worktree renders the same packet against the
  *existing* worktree's facts (branch/path already fixed, D-30) — the header text and packet content
  make this legible without a separate "resuming" affordance existing.

### Live session surface (D-31)

**Layout decision: a full surface that replaces the board's content area, pushed into and popped
back out of** — not a route with its own window, not a tab inside the item-detail panel, not a
dockable pane. The project rail stays visible at the window's left edge (navigation continuity is
preserved — the user can still ⌘1…⌘9 to another project without first backing out), but the board
list, top bar and item-detail panel are replaced entirely by this surface while it is open. This is
also the surface `FLEET-03` (Phase 10) jumps into from any project's fleet entry, so its shape is
being built for real, not as a placeholder.

**Header (fixed, does not scroll with the feed):**
- Back affordance (`←` icon + "Board") returns to the board, focus restored to the task's row.
- Task key + title (Heading role), status pill (reused board glyph+word), run status badge (see
  "Run Status" below).
- **Cost/token status strip**, right-aligned: elapsed time, tokens in/out, running cost in USD — each
  figure set in Archivo's tabular (`tnum`) figures so the numbers do not jitter as they update live,
  matching Phase 1's own verified rationale for choosing Archivo. Updates on each `cost_update`/
  `result` event; no animation on the numeral change itself (Motion, below).
- "Stop" button (destructive-adjacent styling, not full destructive — see Color) — visible only
  while the run is `running` or `blocked`; disabled with a brief "Stopping…" label while the
  interrupt-then-force sequence (D-35) is in flight, and removed once the run reaches a terminal
  state.

**Body — the structured feed (D-32), full scrollback via windowed read (D-33):**
- A single vertically-scrolling, virtualized list (`@tanstack/react-virtual`, same library as the
  board — no new dependency), one `AgentEvent` per row. Scrolling near the top of the currently
  loaded window triggers the next page of older events via the same `LIMIT`/`OFFSET`-shaped windowed
  read `02-RESEARCH.md` models on `query::events::activity_trail` — **never a full in-memory
  transcript** (PROC-07 satisfied by construction, matching D-33's own stated intent).
- **Row kinds:**
  - *Assistant text* — rendered as prose, Body role, `text-primary-rack`. Left-aligned, no avatar
    chrome (this is not a chat UI — there is exactly one speaker class per row, distinguished by row
    kind, not by a per-message avatar).
  - *Tool call* — collapsed to one Mono-set line: `{tool-name} · {target}` (e.g.
    `Bash · npm test`, `Edit · src/board/BoardRow.tsx`), `text-muted-rack`, with a chevron affordance
    that expands it in place to the full input/output, monospace, in a scrollable sub-block capped
    at a fixed max-height (long output scrolls inside the row, the row does not grow the whole feed
    unboundedly). Collapsed by default; a tool call the user has expanded stays expanded as new
    events arrive below it.
  - *System/transient* (`api_retry`, etc.) — a single muted Micro-role line, never styled as an error.
  - *Permission-request card* — see "Permission-request card" below; renders inline at its position
    in the feed and does not auto-scroll the feed away from it while it is pending.
  - *Result / terminal* — the closing row for a `completed`/`failed`/`interrupted` run; see "Run
    Status."
- **"View raw" affordance:** a persistent toggle in the header (not per-row) that swaps the entire
  body for the raw, persisted JSONL (`<app-data>/sessions/<agent-run-id>.jsonl`, D-34), monospace,
  line-numbered, read-only, windowed the same way. This is the escape hatch D-32 requires to exist —
  cheap because the file must be written regardless, and it is what lets the user verify a
  structured row's ground truth without leaving the app.

### Permission-request card (AGNT-06, D-37, D-38)

One component, mounted in two places (see Discretion #6): inline in the session feed at its natural
position, and as a compact variant inside the item-detail panel whenever the task's active run has a
`pending` `permission_requests` row. Both instances read/write the same row — answering in either
place resolves both.

**Visual treatment — deliberately the loudest thing on either surface it appears on** (Impeccable's
"restrained is the floor" rule permits exactly one loudest element per view, and this is it, by
design — an agent genuinely blocked and silently waiting is the single failure mode `02-RESEARCH.md`
Pitfall 4/D-37 exist to prevent):
- 4px left border stripe in `--blocked-text-rack` (session feed) / `--blocked-text-strip` (item
  detail, which sits on the panel's rack-secondary background, so it also uses the rack token — see
  Color for which surfaces get which token).
- A `ShieldAlert` (Lucide) glyph + the tool name in Heading weight, plus the tool's input payload
  rendered read-only in Mono beneath it (what it's asking permission to do, not just its name — a
  bare tool name is not enough information to approve or deny responsibly).
- Three actions, deliberately unequal weight, matching D-38's "prompt fatigue is what kills
  unattended running" concern: **"Allow"** (accent-filled button, chrome radius — the common case)
  · **"Deny"** (outline button, same weight as Allow visually so denying is never harder to reach)
  · **"Allow this tool for this project from now on"** (text-style tertiary action, smaller, beneath
  the two buttons — visually secondary on purpose, so a blanket rule is a considered action, not the
  reflexive click).
- **No Escape-to-dismiss.** Escape does not resolve this card — the agent is still blocked until one
  of the three actions fires. This is a deliberate deviation from every other inline/overlay pattern
  in this product, and it is deliberate: dismissing the card without answering it would hide the
  blocked state, not resolve it.

### Board list additions (D-37)

- **Blocked indicator:** a new row-level mark, layered onto the existing status glyph (never
  replacing it — a blocked task is still visibly "In Progress" by its five-state glyph; blocked is
  an orthogonal signal, not a sixth workflow state, since BOARD-04's fixed five states are LOCKED and
  this phase does not touch them). Rendered as a small pill immediately trailing the status glyph:
  `ShieldAlert` glyph + "Blocked" word (never colour alone, matching Phase 1's house rule), in
  `--blocked-text-strip`. Clicking it opens the item detail panel directly to the permission-request
  card (not just the panel's default view) — the fastest path from "I see something needs me" to
  "I answered it."
- **Project rail:** the current project's rail entry gains a small count badge (numeral, not a raw
  dot) showing how many tasks in this project are currently blocked — 0 renders no badge at all
  (never a visible "0"). This is explicitly the per-project half of the mechanism `FLEET-02`
  generalises across projects in Phase 10 (per D-37/CONTEXT.md), so it is built as the real
  mechanism, not a placeholder.

### Item detail panel additions

Two new sections appended to the existing panel (title, description, pickers, acceptance criteria,
activity trail — all unchanged), inserted **above** the Activity Trail so a supervising user sees
"what's running" before "what happened":

**Worktree summary** (always present once a worktree exists for the task; absent before the first
Start Work):
- One line: branch name (Mono) + a copyable absolute path (Mono, truncated from the left if
  needed since the meaningful tail is `{PROJECT}/{TASK}/`, not the `~/Flywheel/` prefix).
- No "open in editor/terminal" affordance yet — that is `LINK-11`, Phase 7, explicitly out of scope
  here; this line is informational only in Phase 2.

**Runs section** (present once ≥1 `AgentRun` exists; each row):
- Run status badge (see "Run Status" below) · relative start time (absolute on hover, matching the
  Activity Trail's own convention) · duration (for terminal runs) or a live elapsed counter (for a
  running/blocked run) · cost so far.
- Permission-request card mounts inline under its run's row if that run is currently blocked (see
  above).
- Selecting a run row (that is not the currently-open live session) opens it read-only in the session
  surface — the same surface, no separate "history viewer" is built, since the windowed-read design
  already makes an old run's transcript exactly as reachable as a live one's.
- The **currently active/most-recent run's row** carries a "Watch Live" (running/blocked) or "View"
  (terminal) action button that is the primary way into the session surface, mirroring the "Start
  Work" primary action's visual weight when a run is active — this is the button success criterion 2
  ("watches the agent's output stream live") resolves to.

### Run Status

Four values, each a distinct glyph + word pairing (never colour alone), added to
`legend/marks.ts` under the new `"agent"` channel:

| Status | Glyph | Word | Colour role |
|---|---|---|---|
| running | `Loader` (with the pulse treatment, Motion below) | "Running" | `accent-text-rack` (existing token — reused, not new) |
| blocked | `ShieldAlert` | "Blocked" | `--blocked-text-rack` / `--blocked-text-strip` (new) |
| completed | `CircleCheckBig` | "Completed" | `--success-text-rack` (new) |
| failed | `CircleX` | "Failed" | `--destructive-text-rack` (new) |
| interrupted | `CircleSlash` | "Interrupted" | `text-muted-rack` (existing — deliberately muted, not alarming: D-35 states an interrupted run is a normal, user-initiated outcome, not an error) |

**Failed-run terminal row (session feed):** a banner-style final row, `--destructive-text-rack` left
border (same 4px stripe language as the permission card, establishing "left-border stripe = needs
your attention" as one consistent grammar across both), showing the `result` event's error subtype
in Mono and a one-line human gloss above it (see Copywriting Contract).

### Settings surface (D-39 — first Settings surface in the product)

**Layout decision: a full surface, same shell pattern as the live session surface** (replaces the
board content area, project rail stays visible, a "← Board" back affordance) — not a modal, because
it holds a form the user may want to leave open and return to (credential resolution is not a quick
glance-and-close interaction the way a picker is).

Reached via: the app menu's "Settings…" item (⌘, — the macOS convention this product has not yet had
occasion to claim), the command palette ("Open Settings"), and nowhere else in Phase 2 (no inline
settings-adjacent affordance is invented on the board or the launch sheet).

Content:
- **Credential path** — a segmented control, "Local Claude Code Credentials" (default) /
  "API Key". Selecting API Key reveals a password-style input (masked, no "show" toggle — a
  Keychain-backed secret should not be re-displayable from the UI once saved, matching D-39's
  "never in SQLite, never in a config file" discipline extended to "never re-rendered either").
  Saving writes to the macOS Keychain via the `keyring` crate; the field clears and shows only "API
  key configured on {date}" afterward, with a "Replace" action to overwrite it.
- **Per-project override** — a list of every registered project, each with its own optional
  override of the same segmented control, defaulting to "Use global default." This is literally the
  same two-value control reused per row, not a second design.
- **Permission rules** (D-38's inspectable/revocable allow-always list, flagged as a Settings
  obligation by `02-RESEARCH.md`'s Security Domain table) — a per-project, per-tool table: tool name,
  decision (allow/deny), granted date, and a "Revoke" action per row. Empty state: "No rules yet —
  they're created from a permission request's 'Allow this tool for this project from now on' action."

---

## Row Anatomy Additions

Only new elements; everything in Phase 1's Row Anatomy (status glyph, key, title, estimate,
epic pill, assignee, criteria count, priority glyph, actor-of-last-change) is unchanged and holds its
fixed left-to-right order. The blocked indicator (above) inserts immediately after the status glyph
and is **exempt from the progressive-disclosure truncation ladder**, the same way the criteria
checked/total count is exempt in Phase 1 — a blocked task must never silently lose its blocked signal
at a narrower window width, for the same reason D-08 made criteria-count structurally exempt.

---

## Keyboard Map Additions

All additions register in `state/keyboard.ts`'s single key→action map, per Phase 1's established
discipline — none is a competing per-component handler.

### Board list (new, in addition to Phase 1's existing bindings)

| Key | Action |
|-----|--------|
| `w` | Start Work on the selected task (opens the launch sheet) |
| `l` | Open the selected task's live session surface (only enabled if an `AgentRun` exists; otherwise a no-op, matching the existing pattern of pickers being no-ops on inapplicable rows) |

Neither collides with Phase 1's existing single-letter list bindings (`j k o c s p e a m`).

### Launch sheet (focus inside the dialog)

| Key | Action |
|-----|--------|
| Enter | Start Work (submits), except while the free-text field has focus |
| ⌘Enter | Start Work, from inside the free-text field |
| Tab / Shift+Tab | Move between the free-text field and the permission-mode control |
| Escape | Cancel — nothing is spawned |

### Live session surface (focus in the surface)

| Key | Action |
|-----|--------|
| Escape | Return to the board, focus restored to the task's row |
| ⌘. | Stop the session (interrupt, then force — D-35) |
| `j` / `k` | Move through the feed one row at a time (does not scroll the page, moves a roving-focus cursor over rows, matching the board list's own `j`/`k` idiom) |
| `r` | Toggle raw JSONL view |
| Space / Enter (on a collapsed tool-call row) | Expand/collapse that row |

### Permission-request card (focus on the card, wherever it is mounted)

| Key | Action |
|-----|--------|
| `a` | Allow (once) |
| `d` | Deny |
| Shift+A | Allow this tool for this project from now on |

Scoped to the card's own focus region — this does not collide with the board list's unrelated `a`
(assignee picker), since Phase 1's focus-owner model already makes single-letter bindings
region-scoped, not global.

### Global (additions)

| Key | Action |
|-----|--------|
| ⌘, | Open Settings |

### Command palette (additions to Phase 1's command set)

Must include, alongside Phase 1's existing set: "Start Work: {task}" (when a task is selected and has
no active run) · "Open Live Session: {task}" (when one exists) · "Stop Session" (when a session is
running/blocked, scoped to the currently open session surface) · "Open Settings."

---

## State Inventory Additions

| Surface | State | Behavior / Copy |
|---------|-------|------------------|
| Launch sheet | Context packet still assembling (should be near-instant — a pure query, D-28) | No skeleton needed at this speed; if it exceeds ~200ms, the packet body shows the same skeleton-row treatment as the board's cold-query state rather than a spinner. |
| Session surface | Fresh session, zero events yet (process spawning) | A single "Starting session…" row with the pulse treatment (Motion), replaced by the first real event the moment it arrives — never a spinner replacing the whole surface. |
| Session surface | Run reaches a terminal state | The Stop button is removed; the terminal row (Run Status) appears as the feed's last row; the header's run-status badge updates. |
| Session surface | Run fails | Destructive-styled terminal banner (Run Status); the task itself does **not** move off In Progress (D-29 — nothing ever moves a task out of In Progress in this phase) — a failed run is visible on the run, not represented as a board-status change. |
| Item detail | No worktree yet | Worktree summary section is simply absent (not an empty-state placeholder) — its first appearance IS the signal that work has started, matching Phase 1's "never blank, never hidden" instinct applied in reverse (absence itself is the honest state here, unlike the "No epic" pill which must always render). |
| Item detail | No runs yet | Runs section absent, same reasoning as above. |
| Board row | Task blocked | Blocked indicator pill renders; status glyph is unchanged (still shows the task's actual five-state status, per the "orthogonal signal" decision above). |
| Settings | No API key configured, global default is Local Credentials | API key field shows placeholder only, no "configured" copy; the Local Credentials option shows no further UI (nothing to configure — it reads the system keychain implicitly). |
| Settings | `claude` CLI not detected on the machine (per `02-RESEARCH.md`'s Environment Availability table) | A non-blocking inline notice under Credential Path: "Local credentials require the `claude` CLI, which wasn't found. The API key path still works." — never a hard error, since the API-key path remains fully usable (matches the adapter's capability-probe pattern). |
| Permission-request card | Pending | Renders per "Permission-request card" above; persists until answered. |
| Permission-request card | Resolved (by the other mount point, e.g. answered from item detail while viewing the session surface) | The card in the *other* location updates/disappears live via the same pushed-delta mechanism (D-04) that already drives the board — no polling, no stale second copy. |

---

## Performance Contract Additions

- The session feed's virtualization follows Phase 1's exact `@tanstack/react-virtual` pattern —
  fixed `estimateSize` per row kind (a collapsed tool-call row and an assistant-text row may have
  different fixed heights, but each is still fixed, never measured) — consistent with Phase 1's
  explicit rejection of `measureElement` for the same reasons (predictable virtualization at volume).
  An **expanded** tool-call row is the one exception: its expanded content block has its own
  fixed max-height with internal scroll (specified above), so it never breaks the row-list's fixed
  outer height.
- **What must never happen:** the renderer holding the full session transcript in memory at once
  (PROC-07, satisfied by the windowed-read design itself — this is a structural property of D-33's
  design, not a runtime check to add).
- Cost/token status strip figures update on each relevant event without re-rendering the rest of the
  header or the feed — an isolated re-render boundary, matching the board's existing "one row moves,
  the rack does not re-render" performance thesis applied to the session surface's own hot path.

---

## Motion Additions

Intent and role only, inheriting Phase 1's single easing curve (`--ease`) and the
`prefers-reduced-motion` contract — no new curve, no new duration token family.

- **Live session surface entry/exit:** slides in from the trailing edge over the board content area,
  mirroring the item-detail panel's own established motion (D-31 explicitly frames the session
  surface as a peer of the panel, "pushed into... popped back out of" — same verb, same motion).
- **Running-state pulse** (the `Loader` glyph in the header and on any "running" row-status badge):
  a slow, subtle opacity pulse — the *one* place in this product a non-mechanical, continuous
  animation is justified, because it is signalling "a process is alive right now," not decorating a
  state change. Collapses to a static glyph under `prefers-reduced-motion` (never removed
  entirely — the running state must still be visually legible, just without the pulse).
  This is a **deliberate, scoped exception** to Phase 1's "never a fade / mechanical settle only"
  rule — that rule governs *state-change* transitions (a row moving, a status changing); a
  liveness indicator for an unattended long-running process is a different category of motion, not a
  violation of the rule it sits beside.
- **Permission-request card appearance:** no entrance animation beyond what the feed's own
  virtualization naturally does when a new row mounts — it must not fade or bounce in, matching
  Phase 1's "never a fade" rule literally, since this IS a state change (blocked ↔ not blocked).
- **Cost/token figure updates:** no transition on the numeral change itself (a ticking-odometer
  effect would be decorative motion on a data readout, which Phase 1's "no decorative hover motion"
  rule already rules out by extension).
- **Blocked indicator pill appearance/removal on a board row:** a plain state change, matching
  Phase 1's rule for the row itself — this pill is part of the row, not a separate animated overlay.

---

## Typography Additions

No new type **roles** — Micro/Label/Body/Heading (10/11/13/15px, weights 400/600) from
`01-UI-SPEC.md` cover every new surface's needs. One addition:

**Mono utility** (not a new role — a font-family override applied to existing roles where content is
literal/technical rather than prose): branch names, worktree paths, tool-call target lines, tool
input/output payloads, the raw JSONL viewer, and run identifiers (`external_session_id`). Font stack:
`ui-monospace, "SF Mono", Menlo, Consolas, monospace` — the system stack, deliberately no new
self-hosted monospace webfont for a single utility need. Applied at the Body role's size/weight/line-
height (13px/400/1.4) by default; the raw JSONL viewer and expanded tool-call payloads may use a
smaller Label-sized (11px) mono variant when a payload is long, to fit more on screen without
wrapping every line.

---

## Color Additions

Four new token roles, added to `packages/desktop/src/styles/tokens.css` alongside Phase 1's existing
block, each computed against the same WCAG AA methodology Phase 1 used (contrast ratios below are the
value the executor's runnable assertion, `theme/__tests__/contrast.test.ts`, must reproduce — not a
substitute for that test):

| Token | Value | Measured | Usage |
|---|---|---|---|
| `--success-text-rack` | `#5fbf8e` | 7.67:1 on `#171b22`, 7.01:1 on `#1e232b` | "Completed" run-status glyph+word, on rack surfaces only |
| `--destructive-text-rack` | `#d9776c` | 5.60:1 on `#171b22`, 5.12:1 on `#1e232b` | "Failed" run-status glyph+word, failed-run terminal banner border, on rack surfaces only — distinct from the existing `--destructive-strip` (`#9c351c`), which is calibrated for the light strip surface, not the dark rack |
| `--blocked-text-rack` | `#dda845` | 8.03:1 on `#171b22`, 7.34:1 on `#1e232b` | Blocked indicator and permission-card border, wherever rendered on a rack surface (session surface, item detail panel) |
| `--blocked-text-strip` | `#7a4e19` | 5.43–5.74:1 across all five strip tints (backlog/todo/in-progress/in-review/done) | Blocked indicator pill on the board row itself, which sits on strip stock, not rack |

**Why a rack/strip pair for blocked but not for success/destructive:** run status (completed/failed)
only ever renders on rack surfaces in this phase (session surface header, item-detail Runs list) —
neither appears on a board row directly. The blocked indicator is the one new signal that renders on
*both* material families (board row = strip; session surface and item detail = rack), so it is the
one that needs both variants, following the same logic Phase 1 already applied to `text-primary`/
`text-muted`/`accent-text` each having a `-rack` and `-strip` pair.

**Reused, not new:** running-state accent (`accent-text-rack`, `#7d99ff`), interrupted-state muted
text (`text-muted-rack`), the permission card's "Allow" button (`accent-nontext`, `#3c64dd`, chrome
radius — same token Phase 1 already reserves for "primary interactive emphasis").

**The 60/30/10 discipline still holds.** None of these four new tokens is a decorative addition —
each is a distinguishability requirement for a new *signal* (blocked, failed, completed), the same
justification Phase 1's five status tints and destructive token already used. Accent (`#3c64dd`/
`#7d99ff`) remains reserved for the same short list Phase 1 defined, unchanged — none of Phase 2's
new elements are added to that reserved list; a running session's pulse deliberately reuses the
existing accent rather than claiming a new "loudest" role for itself.

---

## Copywriting Contract Additions

| Element | Copy |
|---------|------|
| Start Work CTA (board row / item detail / launch sheet submit) | "Start Work" — identical string in all three places |
| Launch sheet header | "Start Work on {TASK-KEY}" |
| Launch sheet free-text placeholder | "Anything else the agent should know for this run? (optional)" |
| Stop CTA | "Stop" |
| Stop in-flight | "Stopping…" |
| Permission card — allow | "Allow" |
| Permission card — deny | "Deny" |
| Permission card — allow-always | "Allow this tool for this project from now on" |
| Permission card, tool input label | "{tool_name} wants to:" — followed by the raw input payload in Mono |
| Blocked indicator pill | "Blocked" |
| Blocked, project-rail badge (tooltip) | "{N} task{s} waiting on you" |
| Run status words | "Running" / "Blocked" / "Completed" / "Failed" / "Interrupted" |
| Failed-run terminal banner (gloss line above the raw error subtype) | "This run ended in an error. The worktree was left as-is — nothing was lost." |
| Watch-live primary action (item detail, active run) | "Watch Live" |
| View primary action (item detail, terminal run) | "View" |
| Worktree summary, no editor/terminal action yet (not rendered as an affordance — informational only) | n/a — no copy needed, see State Inventory |
| Settings — credential path, local option | "Local Claude Code Credentials" |
| Settings — credential path, API key option | "API Key" |
| Settings — API key configured | "API key configured on {date}." — button: "Replace" |
| Settings — CLI not detected notice | "Local credentials require the `claude` CLI, which wasn't found. The API key path still works." |
| Settings — permission rules, empty state | "No rules yet — they're created from a permission request's \"Allow this tool for this project from now on\" action." |
| Settings — permission rule row action | "Revoke" |
| Session surface back affordance | "← Board" |
| Session surface, spawning | "Starting session…" |
| Destructive confirmation | **None in this phase.** AGNT-07 (destructive-action confirmation inside a running session — force-push, branch deletion, recursive delete) is explicitly Phase 3 scope, not Phase 2. Stop (D-35) is not itself destructive — it leaves the worktree exactly as the agent left it and commits nothing on the user's behalf, so it requires no confirmation copy. |

---

## UI Considerations

State coverage resolved against this phase's new shapes (empty / loading / error / populated /
partial / overflow / zero-one-many / long-text). Empty- and error-state copy live in the Copywriting
Contract addition above; this section covers coverage status and references those rows.

Applicable state considerations resolved: 9 covered, 2 backstop, 1 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| zero-one-many | Worktree summary / Runs section, 0 vs many | ✅ covered | Absent entirely at zero (State Inventory Additions); Runs section is a normal windowed/virtualized list at many, same pattern as the board. |
| empty | Settings, permission rules table | ✅ covered | Explicit empty-state copy (Copywriting Contract Additions). |
| empty | Session surface, zero events (spawning) | ✅ covered | "Starting session…" pulse row, replaced by first real event (State Inventory Additions). |
| loading | Launch sheet, context packet assembly | ✅ covered | Near-instant by design (pure query); skeleton fallback specified if it isn't. |
| error | Failed run | ✅ covered | Destructive terminal banner + gloss copy; task status explicitly does not change (State Inventory Additions, Copywriting Contract Additions). |
| error | `claude` CLI not detected | ✅ covered | Non-blocking inline notice, API-key path remains usable (State Inventory Additions). |
| overflow | Session feed at long-running-session volume | ✅ covered | Windowed read against the persisted log, identical pattern to the board's proven 1,000+-item virtualization (Performance Contract Additions). |
| overflow | Expanded tool-call payload, very long output | ✅ covered | Fixed max-height sub-block with internal scroll, never grows the row (Live Session Surface section). |
| long-text | Worktree path truncation | ✅ covered | Truncates from the left so the meaningful `{PROJECT}/{TASK}/` tail stays visible (Item Detail Panel Additions). |
| partial | Permission card answered from one mount point while the other is visible on screen | 🧪 backstop | Specified to update live via the existing pushed-delta mechanism (State Inventory Additions), but not verified against a real simultaneous-visibility scenario in this spec — executor should confirm during UAT that no stale duplicate card is ever visible for more than one delta cycle. |
| overflow | Cost/token status strip at very large numbers (a multi-hour, high-cost run) | 🧪 backstop | Tabular-figure layout assumed to accommodate growth without reflow; not verified against a real large-number case in this spec. |
| overflow | Settings, a project list long enough to need its own scrolling within the per-project override table | ⚠ unresolved | Not specified here — likely fine at Phase 2's realistic project counts (Phase 1's own ⌘1–⌘9 backstop already flags "many registered projects" as an open question), but the planner should confirm rather than assume. |

---

## Open Decisions the Builder Must Not Invent

Carried forward from `01-UI-SPEC.md` (unchanged, still open where noted): Help menu destination
(#8), Group By lens scope (#9), project-rail overflow beyond nine (#10) — none of these are Phase 2
concerns and none is resolved here.

New for Phase 2:

1. **Whether Flywheel's Settings surface is single-window-modal-like (blocks returning to the board
   while open) or a true peer surface the user can leave mid-edit** — this document specifies the
   latter (same shell pattern as the session surface, a "← Board" affordance, not a dialog), but
   whether unsaved edits in the credential form should warn on navigate-away was not resolved here.
   Default to no warning (every field in this phase's Settings surface is atomic — the segmented
   control and the Keychain write both commit immediately on interaction, so there is no
   "unsaved" state to lose).
2. **The exact expanded-tool-call max-height value** (Performance Contract Additions specifies "a
   fixed max-height," not a pixel number) — left to the planner/executor as an implementation
   density decision, consistent with Phase 1's own treatment of non-structural pixel specifics.

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
