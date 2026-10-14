---
phase: 02-one-agent-one-worktree-watched-live
plan: 07
subsystem: agent-runtime
tags: [rust, rusqlite, react, tanstack-query, tanstack-virtual, typescript, lucide-react]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-01's session_log.rs writer and first SessionSurface, plan 02-02's Stop
      control and session_closed terminal event, plan 02-03's agent signal vocabulary
      (theme/tokens.ts AGENT group, legend/marks.ts run-status marks, state/keyboard.ts's
      toggle-raw-view ActionId and session-surface region), plan 02-06's PermissionRequestCard
      and useRegionBindings, both left untouched in shape by this plan."
provides:
  - "session_log.rs: LOG_WINDOW_MAX_LIMIT, count_lines, read_window — the bounded, trailing-
    fragment-safe windowed read PROC-07 needed, satisfied by construction rather than by ceiling"
  - "query::agent_runs: runs_for_task / worktree_summary_for_task — the read path a later plan's
    item-detail Runs section and worktree summary wire into"
  - "commands/agent_run.rs: agent_run_log_window (now core-backed), agent_run_raw_window,
    agent_runs_for_task, worktree_summary — four new/changed read commands"
  - "FeedRow.tsx: D-32's row-per-event structured rendering (assistant text, collapsed/expandable
    tool-call rows paired with their tool_result, muted system notices, a raw verbatim fallback
    for anything else)"
  - "useBoardQuery.ts: useSessionFeed (tail-first bidirectional windowed paging), useAgentRuns,
    useWorktreeSummary"
  - "RawLogView.tsx: D-32's raw escape hatch over the persisted JSONL, windowed the same way"
  - "SessionSurface.tsx: the raw-view toggle, the cost/token status strip, and the glyph-and-word
    run-status badge with its running-state pulse"
affects: ["02-08 (item-detail Runs section/worktree summary can consume query::agent_runs and
  useAgentRuns/useWorktreeSummary directly)", "02-10 (Settings surface, unaffected by this plan)"]

# Actuals (#2632)
actuals:
  tokens: 29661
  tasks: 3
  commits: 3
  plan_head_before: 146038def53e05102f10988c787acd832ffc0dbf

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tail-first bidirectional useInfiniteQuery: the initial page's own pageParam is the literal
      string \"tail\" rather than a fixed numeric offset, so a live agent:event invalidation
      re-resolves that ONE page against the log's current total on every refetch (catching up to
      new events) while every OLDER page loaded via fetchPreviousPage keeps its own stable numeric
      offset (appending to a log never shifts an earlier line's offset). Two adapter calls only
      when the log is longer than one page (a total-probe, then the real tail window)."
    - "virtualizer.measure() (not measureElement) to invalidate @tanstack/react-virtual's cached
      row sizes when a row's own fixed-per-state size changes (a tool-call row's expanded vs
      collapsed height) — deterministic recomputation from the same estimateSize function, never
      DOM measurement, preserving Phase 1's fixed-size-only virtualization contract."
    - "Sequential FIFO pairing of tool_call + tool_result events by toolName (no correlation id
      exists on either event in the AgentEvent union) — an accepted simplification under
      concurrent same-named tool calls, documented as a known limitation rather than silently
      assumed correct."
    - "Opportunistic status-strip field extraction (latestNumericField scanning entries newest-to-
      oldest for tokensIn/tokensOut/totalCostUsd) rather than a dedicated live-token event type —
      the sidecar does not yet stream live token counts (only cost, via cost_update/result;
      tokens_in/tokens_out are written once at run close), so a token figure with no matching
      field renders \"—\" rather than a fabricated zero."

key-files:
  created:
    - packages/core/src/query/agent_runs.rs
    - packages/core/tests/session_log_window.rs
    - packages/desktop/src/session/FeedRow.tsx
    - packages/desktop/src/session/RawLogView.tsx
  modified:
    - packages/core/src/session_log.rs
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - packages/desktop/src/styles/motion.css

key-decisions:
  - "read_window/count_lines derive a run's log path from agent_run_id alone
    (session_log_path), never from a DB lookup of agent_runs.log_path — the two are always
    identical by construction (D-34, proven by plan 02-01's own agent_tracer.rs assertion), so
    agent_run_log_window no longer queries the database at all."
  - "A trailing fragment (a final line with no newline yet, mid-write) is detected via a single
    trailing-byte Seek check, not a full-file scan — count_lines and read_window both exclude it
    from the total and from the window, so a reader never observes a half-written JSON line."
  - "tool_call/tool_result pairing and the terminal-row/status-strip suppression list
    (init/cost_update/result/permission_request/session_closed) live in SessionSurface.tsx, not
    FeedRow.tsx — FeedRow.tsx stays purely presentational (one FeedRowData in, one row out)."
  - "The tool-call disclosure chevron is a plain text triangle (▸/▾), not a lucide-react icon —
    it is a generic UI affordance, not a signal mark, so it never needs marks.ts's 'always paired
    with a word' discipline; this keeps FeedRow.tsx and the feed's own row list at zero icon
    imports, satisfying its own 'every glyph resolves through the marks registry' acceptance
    criterion trivially (zero glyphs, zero violations) rather than by exception."
  - "The run-status badge's glyph (Task 3) lives in SessionSurface.tsx's header, not FeedRow.tsx —
    the plan's own key_links table names FeedRow.tsx as the file binding to legend/marks.ts, but
    run-status glyphs are a HEADER concern (one badge per surface), not a per-row feed concern;
    SessionSurface.tsx is the actual binding point. Documented as a deviation below."
  - "The raw-view toggle swaps the ENTIRE body area, including the permission-request card's feed
    mount — matching 02-UI-SPEC.md's literal 'swaps the entire body' wording. The card stays
    reachable via the item detail panel's compact mount (02-06) while raw view is open."

patterns-established:
  - "A component with its own isolated tick (StatusStrip's useNowTick) is its own component, not
    inline state in the parent — the re-render boundary IS the file/function boundary, matching
    the board's 'one row moves, the rack does not re-render' thesis applied to the session
    surface's own hot path."

requirements-completed: [PROC-07, AGNT-02, DATA-06]

coverage:
  - id: D1
    description: "PROC-07 satisfied by construction: read_window/count_lines never read the whole
      file into memory, clamp to LOG_WINDOW_MAX_LIMIT internally, and a 10,000-line log requesting
      a window of 50 returns exactly 50 entries with the true total reported"
    requirement: "PROC-07"
    verification:
      - kind: integration
        ref: "packages/core/tests/session_log_window.rs (all 7 cases, including ten_thousand_line_log_returns_exactly_the_requested_window_and_the_true_total)"
        status: pass
      - kind: other
        ref: "grep gate: zero read_to_string|lines().collect() occurrences in session_log.rs"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-32's structured feed: one row per event kind (assistant text, collapsed/
      expandable tool-call paired with its result, muted system notice, raw fallback for anything
      unrecognised), virtualized with a fixed size per row kind, never measured"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx (SessionSurface structured feed describe block, all 12 cases)"
        status: pass
      - kind: other
        ref: "grep gate: zero measureElement occurrences in SessionSurface.tsx/FeedRow.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-33's full scrollback via a tail-first windowed read: the feed loads the most
      recent page first and pages older events backward as the user scrolls toward the top of
      what is loaded, never holding more than the loaded pages"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx#fetches the next older page when scrolled to the top of the loaded window"
        status: pass
    human_judgment: false
  - id: D4
    description: "A failed run's terminal row renders the exact gloss and the error subtype; a
      completed run's renders a plain, non-destructive terminal row; the task's own workflow
      status is untouched either way (D-29, unchanged by this plan)"
    requirement: "DATA-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx (failed and completed terminal row cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-32's raw escape hatch: the verbatim persisted log, line-numbered, paged
      through the same bounded window the structured feed uses, toggled from the header without
      the toggle owning any key of its own"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx (raw view describe cases: toggles/, renders a line number/, pages through the same bounded window/)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The cost/token status strip and the glyph-and-word run-status badge, including
      the running-state pulse collapsing to a static glyph under prefers-reduced-motion without
      ever disappearing"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/session-surface.test.tsx (status strip, five-status glyph-and-word, and both pulse/reduced-motion cases)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The full end-to-end claim: a real packaged app, a real long-running claude
      session streaming into the structured feed live, application memory staying flat in
      Activity Monitor while the transcript grows on disk (ROADMAP success criterion 2)"
    verification: []
    human_judgment: true
    rationale: "This plan builds and unit-tests the mechanism completely (the bounded read, the
      structured rows, the raw view, the status strip), and PROC-07's flat-memory property is
      proven structurally (no whole-file read exists in session_log.rs, verified by a grep gate
      and a 10,000-line test) — but watching a real packaged app's resident memory during an
      actual long-running session has not been observed by a human yet. Deferred to end-of-phase
      UAT per workflow.human_verify_mode=end-of-phase, the same pattern every prior Phase 2 plan's
      SUMMARY used."
  - id: D8
    description: "E2's two backstop UI considerations (partial: cross-mount permission-card
      clearing while the feed is visible; zero-one-many: a single event reads identically to the
      many-event case) are resolved by construction/pre-existing test, not left open"
    verification:
      - kind: integration
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx (Two mount points, one request describe block — plan 02-06, exercises the same cross-mount clearing SessionSurface.tsx's feed mount depends on)"
        status: pass
    human_judgment: true
    rationale: "The zero-one-many resolution (no special single-event styling/copy path exists
      anywhere in FeedRow.tsx or SessionSurface.tsx — verifiable by reading the source, since
      there is no entries.length===1 branch to diverge) is a design-by-omission proof, not a
      dedicated runnable assertion; a human should confirm this reads correctly rather than this
      plan asserting it silently passed."

duration: 130min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 7: A Bounded Window, a Structured Feed, and the Raw Escape Hatch Summary

**The live session surface reads a windowed, never-whole-file slice of the persisted JSONL log (flat memory by construction, D-33), renders it as one structured row per event with a real raw-view toggle and a live cost/token status strip, closing ROADMAP success criterion 2's "watch a long-running session live with memory staying flat."**

## Performance

- **Duration:** ~130 min
- **Started:** 2026-09-11
- **Completed:** 2026-09-11
- **Tasks:** 3/3 completed
- **Files modified:** 14 (4 created, 10 modified)

## Accomplishments

- **`session_log.rs`**: `LOG_WINDOW_MAX_LIMIT`, `count_lines`, `read_window` — a buffered,
  skip/take windowed read that never materialises the whole file, clamps internally to 100 rows
  regardless of what a caller requests, excludes an in-flight write's trailing fragment from both
  the total and the window, and degrades a malformed line to an `unknown` entry rather than
  dropping it. Proven by a 10,000-line test asserting a window of 50 returns exactly 50 entries
  and the true total.
- **`query::agent_runs`** (new): `runs_for_task`/`worktree_summary_for_task` — the read path a
  later plan's item-detail Runs section and worktree summary wire into.
- **`commands/agent_run.rs`**: `agent_run_log_window` now delegates straight to
  `read_window` (no DB lookup — the log path is derivable from the run id alone); new
  `agent_run_raw_window`/`agent_runs_for_task`/`worktree_summary` read commands, registered in
  `main.rs` and the capability roster comment.
- **`FeedRow.tsx`** (new): one row per event kind — assistant text as prose, a tool call collapsed
  to `{tool} · {target}` with a chevron that expands to show its paired input/output in a fixed
  max-height, internally scrolling sub-block, a muted system-notice line, and a raw verbatim
  fallback for anything the switch does not recognise, so nothing the backend produced can vanish
  between the log and the screen (T-02-33).
- **`useSessionFeed`** (`useBoardQuery.ts`): a tail-first bidirectional `useInfiniteQuery` — loads
  the most recent page first, pages older events backward via `fetchPreviousPage` as the user
  scrolls toward the top of what is loaded, and re-resolves its own tail page fresh on every live
  `agent:event` invalidation so new events simply appear without a second mechanism.
- **`SessionSurface.tsx`**: virtualized with this codebase's own fixed-size
  `@tanstack/react-virtual` configuration (`virtualizer.measure()`, never `measureElement`), a
  "Starting session…" pulse row for the zero-event case, a terminal row (destructive banner +
  gloss + error subtype for a failed run, a plain row otherwise), a "View raw"/"View structured"
  header toggle bound to the `toggle-raw-view` action id, a right-aligned cost/token status strip
  in its own isolated-re-render component, and a glyph-and-word run-status badge with a running-
  state opacity pulse that collapses to a static glyph under `prefers-reduced-motion`.
- **`RawLogView.tsx`** (new): the verbatim persisted log, monospace, line-numbered, read-only,
  paged through `agentRunRawWindow` with the same tail-first bounded window the structured feed
  uses.

## Task Commits

Each task was committed atomically:

1. **Task 1: A bounded window over the persisted log** — `44ff60d` (feat)
2. **Task 2: One row per event — prose, collapsed tool calls, and a terminal row** — `a3ad0ad` (feat)
3. **Task 3: The raw escape hatch and the live cost strip** — `e5d5d88` (feat)

**Plan metadata:** (this commit)

_No TDD RED/GREEN/REFACTOR split — Tasks 1 and 2 carry `tdd="true"` in the plan frontmatter, but
each was implemented and its full behavior-covering test suite written together per this plan's
own task shape, the same convention every prior Phase 2 plan's SUMMARY recorded for its own
`tdd="true"` tasks._

## Files Created/Modified

See `key-files` in frontmatter for the full list.

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: `useSessionFeed`'s tail-first
`pageParam` design (a literal `"tail"` for the initial page, numeric offsets for everything paged
in afterward) is what lets a live invalidation re-resolve the tail page against the log's current
total while every older loaded page keeps its own stable offset — no second "check for new
events" mechanism was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The running-state pulse's keyframes needed a home outside this plan's
declared `files_modified`**
- **Found during:** Task 3, implementing the run-status badge's pulse
- **Issue:** The plan's own action text requires "a slow, subtle opacity pulse" on the running
  badge, collapsing under `prefers-reduced-motion` — this requires a CSS keyframe animation
  somewhere, but `styles/motion.css` (this codebase's single motion contract, per its own doc
  comment) is not in this plan's declared file list.
- **Fix:** Added the `agent-pulse` keyframe and class to `styles/motion.css` — the established,
  single home for every motion rule in this product, rather than inventing a second stylesheet or
  an inline `<style>` block for one animation.
- **Files modified:** `packages/desktop/src/styles/motion.css`
- **Verification:** `grep -c 'prefers-reduced-motion' styles/motion.css` (already ≥1, unaffected);
  the reduced-motion test asserts the class is correctly omitted.
- **Committed in:** `e5d5d88` (Task 3)

---

**Total deviations:** 1 auto-fixed (Rule 3 — a blocking necessity for implementing the plan's own
stated pulse requirement, in the one file this codebase's own convention says a motion rule
belongs in).
**Impact on plan:** Necessary for Task 3's own acceptance criteria to be satisfiable at all. No
scope creep — nothing was added beyond what Task 3's own action/behavior already required.

**Also worth noting (not a deviation, a documented interpretation):** the plan's own `key_links`
table names `FeedRow.tsx` as the file binding to `legend/marks.ts` for "run-status and tool-call
glyphs." In practice, run-status glyphs are a HEADER concern (one badge per surface, built in
Task 3) and there is no "tool-call" mark in `legend/marks.ts`'s `agent` channel at all (only the
five run-status marks and `blocked-indicator`) — so the actual binding point is
`SessionSurface.tsx`, not `FeedRow.tsx`. `FeedRow.tsx` itself renders zero icons (the tool-call
disclosure is a plain text triangle, not a signal mark), which satisfies its own "every glyph
resolves through the marks registry" acceptance criterion by having no glyphs to violate it.

## Known Stubs

None that block this plan's own goal. Two known, accepted limitations, both documented in
`key-decisions`:
- **Tool-call/tool_result pairing is FIFO-by-toolName**, not by a true correlation id (none exists
  on either event in the sidecar's `AgentEvent` union). Under concurrent same-named tool calls,
  pairing could attach the wrong result to the wrong call. Documented, not fixed — fixing it would
  require extending the sidecar's own event shapes with a call-correlation id, which is outside
  this UI-only plan's scope (a Rule 4 architectural change, not attempted here).
- **Live token counts are not available from the current event stream.** The sidecar's
  `cost_update`/`result` events report cost but not tokens (`agent_runs.tokens_in`/`tokens_out`
  are written once at run close, not streamed). The status strip's token fields render "—" rather
  than a fabricated zero whenever no event field is present — an honest degradation, not a broken
  feature, but a real gap between what 02-UI-SPEC.md's status strip describes and what the current
  backend actually streams live.

## Issues Encountered

None beyond the deviation and known stubs documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `query::agent_runs`/`useAgentRuns`/`useWorktreeSummary` are built and read-tested but not yet
  wired into any UI — plan 02-08 (or whichever plan owns the item-detail panel's Runs section and
  worktree summary) can consume them directly.
- **Requirements PROC-07/AGNT-02/DATA-06** are shared with sibling plans in this phase (02-01
  through 02-09 variously declare them); per the shared-ID gate, they become eligible to mark
  complete only once every plan declaring them has a SUMMARY — 02-08 has not run yet as of this
  plan's completion.
- **Not yet human-observed:** the full end-to-end claim — a real packaged app, a real long-running
  session, resident memory watched in Activity Monitor staying flat while the transcript grows on
  disk (ROADMAP success criterion 2's own manual verification step). Deferred to end-of-phase UAT
  per `workflow.human_verify_mode: end-of-phase`, the same pattern every prior Phase 2 plan's
  SUMMARY used.
- The live token-count gap (see Known Stubs) is a real product gap worth flagging for whoever next
  extends the sidecar's event stream — it is not this plan's own defect, but the strip's accuracy
  depends on it being closed eventually.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All 4 files listed under `key-files.created` verified present on disk with `[ -f ]`. All 3 task
commits (`44ff60d`, `a3ad0ad`, `e5d5d88`) verified present in `git log --oneline --all`. Every
`<acceptance_criteria>` item across Tasks 1-3 re-run and passing: `cargo test -p core --test
session_log_window` (7/7), `cargo test -p core` (full suite green), `cargo build --workspace`
(clean), `npm --prefix packages/desktop run test` (247/247), `npm --prefix packages/desktop run
build` (clean, no `error TS`), the no-whole-file-read grep gate and the `LOG_WINDOW_MAX_LIMIT`
occurrence-count gate on `session_log.rs`, the no-`measureElement` grep gate on
`SessionSurface.tsx`/`FeedRow.tsx`, the no-hex-literal grep gate across `packages/desktop/src`,
the `prefers-reduced-motion` occurrence gate on `motion.css`, and the no-`@tauri-apps/api`-outside-
`adapters/tauri.ts` grep gate — all PASS. The plan-level `<verification>` block's one manual item
(watching real resident memory during a real long-running session) is not re-run here — it
requires a human at a GUI — see "Next Phase Readiness."
