# ADR decisions are stored on the review, and ADR flags are read from git

Decided by Claude under Cyril's delegation in [Flag ADR wording edits, number clashes and missing supersession lines; Not an ADR and Wrong decision become review points](https://github.com/HighKnow-ai/flywheel/issues/164). Relates to ADR-0010.

The developer's decision on each ADR a Story adds is stored on the open review, in `reviews.adr_decisions`, a JSON array next to the hand-off's `adr_notes`. Keep is the default and is not stored. **Not an ADR** and **Wrong decision** (with what is wrong and what it should be) are stored, and while either is there Merge refuses. Neither one sends the Story back by itself. A request for changes appends them to the developer's comments as a list headed "ADR review points:", and the same goes for two of the flags: Renumber and Supersession line missing. Then the Context packet's section 7 carries them unchanged, and the agent adds one Task per point. The comments may be empty when there is at least one point.

The three **flags** (Wording or supersede?, Renumber, Supersession line missing) are worked out from git each time the card is read, and are never stored. They are advice for the developer and do not hold Merge. Merge also writes no `Status: superseded by` line itself. Spec §6 has the old ADR get that line "in the same merge", and since Flywheel never commits outside a worktree, the agent writes it on the branch, and the flag catches it when the agent forgets.

We rejected three alternatives:
- **A table of ADR decisions.** A decision belongs to one review and dies with it: the next hand-off opens a fresh review, and the agent has acted on the points by then. A column on the review keeps that lifetime without a join.
- **Sending the points as structured data in the packet.** Section 7 already carries the request's comments, and the agent already turns each line into a Task. One text path keeps one mechanism, and what the developer previews in the composer is exactly what the agent reads.
- **Merge writing the supersession line.** That is a commit outside a worktree, which spec §6 forbids, and it would make Merge write content the developer never reviewed.

## Consequences

- An ADR marked Not an ADR does not also get a Renumber point, since the file is going away.
- A Wording or supersede? flag is a question for the developer, so it is never sent as a point. If the developer wants a supersession instead, they say so in the comments.
- Merge's refusal names each marked ADR and its decision, so setting an ADR back to Keep is the way out without a round trip to the agent.
- A request for changes reads the flags from git on a best-effort basis: when git cannot answer, the stored decisions still go.
