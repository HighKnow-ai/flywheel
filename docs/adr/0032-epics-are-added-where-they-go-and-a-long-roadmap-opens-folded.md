# Epics are added where they go, and a long Roadmap opens folded

Decided in [A big project's board opens on what needs you](https://github.com/HighKnow-ai/flywheel/issues/201) (Epic #189), from the M4 design critique (`docs/design/critique-2026-10-m4.md`, F16, F23, F28).

**The top bar offers only + Story.** Story #118 put "+ Epic" beside "+ Story" in the top bar of every project surface, and #168 then added a "+ Epic" to the Milestone header. On the board the two sat 150px apart and did the same thing, and the critique counted five different add styles. The top bar's + Epic is gone. The Milestone header's "+ Epic" is the one Epic add on the board, and Write a Story's Epic Combobox ends in "New Epic…", which covers an Epic whose Milestone is not on screen (the Story view, the session surface). Every add inside a card is now one style: a small ghost button with a plus.

**A Roadmap of more than five Milestones opens folded** to the row the board shows (the Current Milestone, or the one picked), under an "n Milestones" Collapsible trigger, and the Developer's own fold or unfold is remembered per project in localStorage. Five 36px rows sit above a clamped Milestone header with Needs you still in the first viewport at 1280 × 800; a sixth is where the rows start pushing it down. An open roadmap Round shows every row, because its changes are decided on them.

We rejected:

- **Keep + Epic in the top bar and drop it from the header.** The header's control already knows its Milestone, which is the whole point of #168; the top bar's would ask for it again.
- **Always open folded.** On a Roadmap of two to five Milestones the fold hides little and costs a click every time the Developer wants to compare Milestones.
- **Remember the fold in the board store (`uiStore`).** It is UI state, so Zustand is right, but `uiStore` is not persisted, and a fold that resets on every launch is not remembered.

## Consequences

- `agent-station.test.tsx` and `session-surface.test.tsx`, which pinned #118's "both in every top bar", now pin "+ Story only".
- The fold is UI state kept in the browser's storage. If storage is unavailable the fold still works and lasts the session.
