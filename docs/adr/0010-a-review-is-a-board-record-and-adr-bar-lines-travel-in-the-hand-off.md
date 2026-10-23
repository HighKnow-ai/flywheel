# A review is a board record, and an ADR's bar lines travel in the hand-off

Decided by Claude under Cyril's delegation in [Decisions section: ADR and glossary changes with each ADR's bar lines and related ADRs, Keep, and Merge links new ADRs](https://github.com/HighKnow-ai/flywheel/issues/161). Relates to ADR-0002.

A **review** is a row on the board (`reviews`), opened by the hand-off in the transaction that moves the Story to In review, and closed by the developer's decision: a request for changes or Merge. It keeps what the developer judges on (the commits compared, the diff's size, the Tasks left open) and what was decided. A Story has at most one open review, so its rows are its review history.

An ADR's **bar lines** (why it is hard to reverse, why it would surprise a reader, which alternative lost, and what it relates to) travel in the `handoff` tool's `adrs` argument, one entry per ADR the branch adds, checked as an ADR draft's bar lines are. They are stored on the review (`reviews.adr_notes`) and shown beside the ADR in the review's Decisions section. They are never parsed out of the ADR file, and never written into it. An ADR accepted while shaping the Epic already carries its bar lines on its Proposal, so the review falls back to those; one with neither shows "No bar lines".

We rejected keeping the review as events only (`story.handed_off`, `story.merged`) and folding them into a review when the card is read. The card needs a stable record to hang the agent's notes, the developer's overrides and later the per-ADR decisions on, and a fold over events cannot hold "the one open review" as a constraint. We also rejected parsing the bar lines out of the ADR file. Spec §6 says the bar lines are shown beside an ADR and never written into it, and a parser would push agents to write them into the file in a fixed shape, then break on every repo whose ADRs follow another template.

## Consequences

- The hand-off can't refuse an ADR for missing bar lines, because it can't see which files are ADRs until the diff is read after the Checks run. A new ADR without them reaches review and is shown as having none, and the developer judges it from the file.
- Merge links each ADR the branch adds to the Story by path, inside the board transaction that marks it Merged. An ADR accepted in shaping keeps its Epic Proposal and gets no second link, and an ADR that some record already links is left as it is.
- The related live ADRs are resolved against the base branch's tip from git (`git ls-tree` and one `git grep` for titles and supersession lines), so the Decisions section needs no checkout of the base branch.
- Keep is the default decision on each new ADR and is not stored. Not an ADR and Wrong decision (#164) are stored on the review.
