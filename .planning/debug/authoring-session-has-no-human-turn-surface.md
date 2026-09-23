---
slug: authoring-session-has-no-human-turn-surface
phase: 05-socratic-epic-authoring
gap_id: G-05-2
status: root-cause-found
opened: 2026-09-24
---

# An authoring session has no human-turn surface

## Symptom

The Product Kill Criterion (`05-SPIKE-FINDINGS.md`) asks for a timed comparison between shaping an
epic in the app and shaping it by prompting `claude` in a terminal. The in-app arm cannot be
staged: a developer cannot say what they want to build, and cannot answer the agent's challenges.

Observed live on 2026-09-24 against a dev build (`npm --prefix packages/desktop run tauri dev`,
real fleet database, `threadfin` project, 180 backlog items): the board renders, but nothing in the
authoring path accepts typed input.

## Root cause

There is no path from a keystroke to an `authoring_turn`. Three independent confirmations:

1. **No composer.** `packages/desktop/src/session/SessionSurface.tsx` contains zero `<textarea>` and
   zero `<input>` elements. The surface renders the feed, the stage indicator
   (`AuthoringStageIndicator`, `:262`) and the Advance/Return controls (`AuthoringStageControls`,
   `:304`) — and nothing that takes text.

2. **No command.** Every command the renderer can invoke is enumerable from
   `packages/desktop/src/adapters/tauri.ts` plus the two direct `invokeCommand` calls in
   `packages/desktop/src/authoring/useAuthoringQuery.ts` (`:138` reject, `:154` amend, `:169`/`:189`
   subtree accept). The authoring set is `authoring_run_start`, `authoring_run_for_epic`,
   `authoring_preview_epic_packet`, `authoring_proposals_for_run`, `authoring_proposals_pending`,
   `authoring_proposal_accept`, `authoring_proposal_reject`, `authoring_proposal_amend`,
   `authoring_subtree_accept`, `authoring_stage_advance`, `authoring_stage_return`. None carries a
   developer message.

3. **No caller.** `send_authoring_turn` (`packages/desktop/src-tauri/src/sidecar.rs:460`) has
   exactly three call sites, all in `packages/desktop/src-tauri/src/commands/authoring.rs`:
   `:650` (reject relays a decision turn), `:699` (amend relays a decision turn) and `:745` (stage
   advance relays the distillation instruction). All three are system-generated.

## Why the challenge stage is the worst case

The opening prompt is `render_epic_prompt(&packet)` (`commands/authoring.rs:198`), assembled
entirely from board state. The authoring variant of the launch sheet deliberately suppresses the
instruction field — `launch-sheet/LaunchSheet.tsx:760` guards it with `!isAuthoring &&`, and the
sheet's submit button reads "Start Shaping" (`:670`) with no text to carry.

For a brand-new epic (`epicId === null`) the packet has no `## Epic` section, no task roster, no
answered assumptions and no rejected proposals — every section of `render_epic_prompt` is omitted
except the last. What the model receives is
`packages/core/src/epic_context_packet.rs:503-509`:

> You are in the challenge stage of a Socratic epic-authoring session. Your job this stage is to
> challenge the developer's framing, not to draft a plan …

There is no framing to challenge, and no way to supply one. The two text channels that do exist —
a rejection reason and an amendment — both require staged proposals, which only appear after the
developer advances out of `challenge` into `decompose`.

## Scope note

This is a missing surface, not a broken mechanism. Everything downstream of a turn works and is
covered by passing tests: the stage gate, the six write tools, the three capped read tools, the
proposal tray's accept/reject/amend/subtree verbs, and the distillation relay. The gap is the one
seam between the developer and the conversation.

## Fix direction (non-binding)

A tauri command that forwards developer text to `sidecar.send_authoring_turn`, a thin wrapper in
`adapters/tauri.ts` following the file's own single-seam rule, and a composer on `SessionSurface`
scoped to the `session-surface` keyboard region (mind the existing bare-`n` Advance binding,
`state/keyboard.ts:177`, against `isTypingTarget`'s guard at `keyboard.ts:234`). The premise of a
new epic needs somewhere to live too — either an instruction field restored to the authoring launch
sheet, or simply the first turn typed into the composer.
