# A diff draws added and removed lines on their own pale green and red

Decided by Claude under Cyril's delegation in [The review card: failing Checks first, Task warnings, Check objections, the diff, and Re-run Checks](https://github.com/HighKnow-ai/flywheel/issues/157). The review card draws each changed file's patch. An added line sits on a pale green ground (`--diff-insert`) and a removed line on a pale red one (`--diff-delete`), each with its own dark sibling. Each line also carries `+` or `−` in a column of its own, so the change doesn't depend on the tint. These two tokens mean "a line this diff adds" and "a line this diff removes", and they're drawn inside a diff and nowhere else.

This is an exception to DESIGN.md's One Meaning Rule ("no green anywhere", from `docs/design/direction.md`). We took it because a developer reads a diff in green and red in every tool they use: git, GitHub, their editor. A review card that tints diffs any other way makes them translate the colours on the one surface where they read code line by line.

We rejected two other options:

- **The Running tint for added lines and a red tint for removed ones.** Blue means an agent at work or your next action, and red means Stopped or failed. A removed line is neither failed nor a state, and a page of red would read as an alarm.
- **Neutral grounds, with only the `+` and `−` marks.** Meaning wouldn't rest on colour, but a long hunk would lose the at-a-glance shape that makes a diff quick to scan.

## Consequences

- The tints are pale grounds, never fills, pills or icons. A state is never green, and passed still reads from its check icon and its word.
- `theme/__tests__/contrast.test.ts` holds ink and secondary ink on both tints at 4.5:1 in both schemes, so line text and line numbers stay readable.
- `react-diff-view`'s own colours are overridden under `.review-diff` in `globals.css`. The library's default palette doesn't reach the screen.
