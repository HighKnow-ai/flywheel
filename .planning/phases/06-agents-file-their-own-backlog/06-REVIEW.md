---
phase: 06-agents-file-their-own-backlog
reviewed: 2026-10-01T04:18:12Z
depth: standard
files_reviewed: 48
files_reviewed_list:
  - packages/core/src/db/migrations/0015_proposal_triage_extension.sql
  - packages/core/src/db/migrations/0016_authoring_proposals_fts.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/authoring_proposal.rs
  - packages/core/src/domain/issue.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/query/authoring.rs
  - packages/core/src/query/search.rs
  - packages/core/tests/authoring_acceptance.rs
  - packages/core/tests/authoring_board_read.rs
  - packages/core/tests/authoring_criterion_reachability.rs
  - packages/core/tests/authoring_lifecycle.rs
  - packages/core/tests/authoring_measurement.rs
  - packages/core/tests/authoring_proposal.rs
  - packages/core/tests/authoring_stage.rs
  - packages/core/tests/authoring_tracer.rs
  - packages/core/tests/bin/uat_authoring_ops.rs
  - packages/core/tests/epic_context_packet.rs
  - packages/core/tests/migration_safety.rs
  - packages/core/tests/proposal_channel.rs
  - packages/core/tests/proposal_duplicates.rs
  - packages/core/tests/proposal_limit.rs
  - packages/core/tests/proposal_no_promotion.rs
  - packages/core/tests/proposal_triage_verbs.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/App.tsx
  - packages/desktop/src/authoring/__tests__/proposal-keyboard.test.tsx
  - packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx
  - packages/desktop/src/authoring/ProposalRow.tsx
  - packages/desktop/src/authoring/useAuthoringQuery.ts
  - packages/desktop/src/board/__tests__/triage-lane.test.tsx
  - packages/desktop/src/board/TriageLane.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
  - packages/desktop/src/triage/__tests__/triage-routing.test.tsx
  - packages/desktop/src/triage/__tests__/triage-surface.test.tsx
  - packages/desktop/src/triage/TriageSurface.tsx
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/test/authoring-stage-gate.test.mjs
  - packages/sidecar/test/execution-hook-settings.test.mjs
  - packages/sidecar/test/propose-item-wire.test.mjs
  - scripts/uat/run-all.sh
  - scripts/uat/uat-10-agent-backlog.mjs
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-10-01T04:18:12Z
**Depth:** standard
**Files Reviewed:** 48
**Status:** issues_found

## Summary

This phase's central safety guarantee — no agent-reachable code path can turn a staged
`authoring_proposals` row into canonical board substance without an explicit human triage action —
holds up under adversarial reading. I traced every mutation path in
`domain/authoring_proposal.rs` (create, accept, accept_subtree, merge, defer, reject, amend, the two
bulk verbs), the Tauri command layer (`commands/authoring.rs`), the sidecar wiring
(`claude-code-adapter.ts`/`mcp-permission-server.ts`), and the keyboard/UI surfaces
(`TriageSurface.tsx`, `TriageLane.tsx`, `ProposalRow.tsx`, `state/keyboard.ts`). I did not find a
promotion-without-triage path, a default-focused/auto-accept control, a bulk-accept verb, a silent
drop of a refused or duplicate-flagged proposal, or a path that stages a row outside
`create_proposal_in_tx`'s own transaction. The `PROPOSAL_LIMIT_PER_RUN` boundary is off-by-one
correct (10th succeeds, 11th refused) and is backed by a dedicated adversarial test file. The
migration `0015_proposal_triage_extension.sql` rebuild preserves every row, the self-referential
`parent_proposal_id` link, and all four indexes — and this is independently proven by
`migration_safety.rs`. The `onProposal` wiring fix in `claude-code-adapter.ts` is genuinely
equivalent between `startSession` and `startAuthoringSession` (`runId` always comes from the
closure, never the wire payload, in both).

One real, provable logic bug surfaced during close reading of `query/search.rs`: the FTS5
syntax-error degradation helper (`is_fts5_syntax_error`) is checked against an `anyhow::Error`
*after* `.context(...)` has already replaced its `Display` text, so the "fts5" substring the check
looks for can never be present. Currently this is masked everywhere it matters (the two
duplicate-detection call sites swallow the error via `.ok()` regardless of what it says), so it is a
WARNING rather than a BLOCKER, but the documented "always degrades to an empty result rather than a
parse error" contract is not actually implemented as written. See CR/WR-01 below.

The dedicated `TriageSurface` is not wired into the keyboard layer model (`state/keyboard.ts`'s
`LayerState`/`topLayer`), so Escape does not close it and the surface shares the same
"global bindings can still reach around a full-screen replacement view" gap that `SessionSurface`/
`SettingsSurface` already had before this phase. This does not threaten the triage-safety guarantee
(no action reachable through it can promote or bulk-accept anything), but it is a real UX
regression risk worth tracking. See WR-02.

## Warnings

### WR-01: `is_fts5_syntax_error` can never match because every caller checks it after `.context(...)` has already replaced the error's Display text

**File:** `packages/core/src/query/search.rs:83-85, 497-507`
**Issue:**
`is_fts5_syntax_error` is defined as:
```rust
fn is_fts5_syntax_error(err: &anyhow::Error) -> bool {
    err.to_string().to_lowercase().contains("fts5")
}
```
`anyhow::Error`'s `Display`/`to_string()` only ever prints the **top-level context message**, not
the underlying error's message — that's only visible via `{:?}` (Debug) or `.chain()`. Every call
site in this file adds a `.context("...")` frame *before* the check runs:

- `search_items_first_page`/`search_items_next_page`/`search_issues`/`search_band_counts` all
  return `rows.context("failed to ...")`, and `search_items` (line ~113-129) then checks
  `is_fts5_syntax_error(&err)` on that already-wrapped error. `err.to_string()` is always something
  like `"failed to search the board window"` — it can never contain `"fts5"`.
- `duplicate_score_lookup` (line ~500-506) is worse: it explicitly rebinds `err` to the
  context-wrapped value *before* calling the check:
  ```rust
  Err(err) => {
      let err = anyhow::Error::from(err).context("failed to look up a duplicate candidate");
      if is_fts5_syntax_error(&err) {   // always false — err.to_string() is the context message
          Ok(None)
      } else {
          Err(err)
      }
  }
  ```

Practical impact today is low because both `create_proposal_in_tx` and `amend_proposal` call
`duplicate_candidate_for(...).ok().flatten()`, discarding any `Err` outright regardless of what it
says — so the broken check never actually blocks a real proposal from being staged. But the
documented contract ("a term of pure punctuation must return a result set rather than a parse
error", "degrading to 'no candidate found' ... exactly as `search_items` already does") is not what
the code does: if SQLite's FTS5 tokenizer ever does reject one of these queries (the module's own
doc comment acknowledges this as a live possibility for a future SQLite version), `search_items`
will propagate a hard `Err` to the renderer instead of gracefully returning an empty window, and any
caller of `duplicate_score_lookup` that does NOT swallow the error (there is currently one, but a
future caller might not) would see the same.

**Fix:** Run the check before adding context, or search the whole chain instead of just the display
string, e.g.:
```rust
fn is_fts5_syntax_error(err: &anyhow::Error) -> bool {
    err.chain().any(|cause| cause.to_string().to_lowercase().contains("fts5"))
}
```
This makes the existing call sites (which already wrap with `.context(...)` first) work as
documented without having to reorder every caller.

### WR-02: `TriageSurface` is not represented in the keyboard layer model, so Escape cannot close it and global bindings are not scoped away from it

**File:** `packages/desktop/src/state/keyboard.ts:406-502`, `packages/desktop/src/triage/TriageSurface.tsx`
**Issue:** `UiLayer` declares a `"triage-surface"` member and `bindingAllowedInLayer` has a branch
for it, but nothing ever sets `topLayer(...)` to `"triage-surface"` — `LayerState`/
`layerStateFromStoreFields` have no field tracking whether the dedicated triage view
(`triageSurfaceProjectId` in `uiStore.ts`) is open, unlike `paletteOpen`/`detailOpen`/`pickerOpen`/
`quickAddOpen`, which all are. Consequences while the triage surface is on screen:
- `nextEscapeLayer` (used by `BoardView.tsx`'s own Escape handler) has no `"triage-surface"` member
  in `EscapeLayer` at all, and in any case `BoardView` itself is unmounted while the triage surface
  renders (per `App.tsx`'s ternary), so Escape does nothing — the only way to leave the surface is
  the "← Board" button.
- `useGlobalBindings`'s window-level listener in `AppShell` (register-project, switch-project,
  open-settings) and in `CommandPalette.tsx` (open-palette) stay mounted and still fire, because
  `topLayer(currentLayerState())` reports `"board"` (none of the tracked flags are true), and
  `bindingAllowedInLayer` permits those ids in `"board"`. `⌘K` opening the full command palette over
  the triage view, or `⌘,` opening Settings over it, is surprising but not new — `SessionSurface`
  already has this same gap (its own `sessionSurfaceOpen` field is explicitly documented as
  "optional ... no component sets it yet"). `create-task`/`create-epic`'s global bindings are
  harmless here since their handlers live in `BoardView.tsx`, which is unmounted.

This is not a safety-guarantee violation — no triage/accept/reject/merge/defer action is reachable
through a global binding, and nothing here can promote a proposal — but it is a real, inheritable UX
regression surface this phase adds a third full-screen view to without closing the gap its two
predecessors already had.

**Fix:** Add a `triageSurfaceOpen` (and, while at it, `settingsOpen`) field to
`LayerState`/`RawLayerFields` the same way `detailOpen`/`quickAddOpen` already are, have
`topLayer` return `"triage-surface"` when it is set, and add a `"triage-surface"` member to
`EscapeLayer`/`nextEscapeLayer` so Escape closes it like every other overlay in the product.

## Info

### IN-01: `ProposalDto::from`'s plain conversion always sets `duplicateCandidate: None`, which is correct today but undocumented as a trap for the next caller

**File:** `packages/desktop/src-tauri/src/commands/authoring.rs:114-136, 156-176`
**Issue:** `authoring_proposals_for_run` (the run-scoped tray read) uses the bare `From` impl, which
hard-codes `duplicate_candidate: None` regardless of whether the row actually carries a
`duplicate_of`. The board-level reads (`authoring_proposals_pending`/`authoring_proposals_deferred`)
instead go through `proposal_dto_with_duplicate_label`, which resolves it. The doc comment explains
this is deliberate ("the tray's own `authoring_proposals_for_run` has no caller that renders the
candidate yet"), but there is nothing enforcing that invariant — a future tray UI change that reads
`proposal.duplicateCandidate` off this DTO would silently always see `None` even for a genuinely
flagged duplicate, with no compiler or test signal pointing at why.
**Fix:** A one-line comment on `ProposalDto`'s `duplicate_candidate` field pointing back at this
asymmetry (which already partially exists) is probably sufficient; alternatively, route
`authoring_proposals_for_run` through `proposal_dto_with_duplicate_label` too, since the cost is one
bounded lookup per already-small, run-scoped window.

### IN-02: `duplicate_match_term` can build very large `OR`-chained FTS5 queries for long titles+bodies

**File:** `packages/core/src/query/search.rs:426-431`
**Issue:** `duplicate_match_term` splits the combined title+body (up to `MAX_PROPOSAL_TITLE_LEN` +
`MAX_PROPOSAL_TEXT_LEN` = 1500 characters) on whitespace and `OR`s a quoted-prefix-phrase per word,
which for dense text can produce on the order of 150-250 disjuncts in a single `MATCH` expression.
This is explicitly not a correctness bug (per-word escaping is correct, per the WR-01 analysis
above) and is out of this review's performance scope, but it is worth a short note since it is a
new, developer-triggerable query shape (every `propose_item`/`propose_task`/etc. call runs this) —
if a future corpus grows large, this is the first place to look for FTS5 query-planning cost.
**Fix:** No action required now; flag for a future phase if duplicate-detection latency becomes
visible.

---

_Reviewed: 2026-10-01T04:18:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
