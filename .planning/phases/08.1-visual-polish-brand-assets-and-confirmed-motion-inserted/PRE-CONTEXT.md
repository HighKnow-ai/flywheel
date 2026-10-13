# Phase 8.1 — decisions and findings taken before discuss-phase

Written 2026-10-07, immediately before `/gsd-discuss-phase 8.1`. Read this first:
it answers one question discuss-phase would otherwise ask, and records four findings
that change what this phase has to build. Not a substitute for CONTEXT.md.

## Owner decision already taken

**The brand mark: the HighKnow lightbulb-brain mark, for now.** Asked and answered
2026-10-07. Open since 2026-09-09. Rationale: one asset to produce, no naming or
identity work, unblocks the app icon and the direction round. Flywheel earning its
own mark under HighKnow stays available if it ever gets a commercial identity of its
own — that is the natural companion to the open-desktop / paid-cloud split in
PROJECT.md § Constraints. Recorded in `.planning/PROJECT.md` § Key Decisions and in
`01-UI-SPEC.md` Open Decisions #1.

**Do not re-ask this.** Discuss-phase should take it as settled input.

## Findings that change this phase's scope

1. **`logo.svg` does not exist in the repository.** `01-UI-SPEC.md` Gate A states the
   owner supplied the HighKnow mark as `logo.svg`. A repo-wide `find` returns nothing.
   So success criterion 2 — "The brand asset exists in the repository and any surface
   entitled to render it does so" — starts at zero. This phase must PRODUCE the asset,
   not wire up an existing one. Plan for asset production, not asset integration.

2. **`PRODUCT.md` does not exist in this project.** `01-UI-SPEC.md` pointed the brand
   decision at `PRODUCT.md`; the file is `PROJECT.md`. The pointer dangled for a month,
   which is why the decision sat unresolved. Both references are now corrected. Worth a
   glance for other `PRODUCT.md` references while planning.

3. **The board has no cue for which tasks carry real changes.** Added to this phase's
   ROADMAP scope by owner remark on 2026-10-07 ("we have no cues for actual changes on
   tasks etc."). Measured cost: finding the one reviewable task in a 907-task board
   during Phase 08 UAT required a hand-written SQL join across `worktrees`/`tasks`/
   `epics` plus a `git merge-tree` sweep, because the UI shows nothing. This is
   information design, not brand or motion — but it is the thing that most directly
   made the app feel unusable to its first user, so it should not be the item that gets
   cut if the phase is trimmed.

4. **The criteria rail renders empty on every item reachable today.** The database holds
   four `acceptance_criteria` rows total (2 task, 2 epic) across a 907-task board, and
   none sits on a task with a worktree. Two of those four are probe text (`test`,
   `hello`) typed accidentally into a composer that a focus bug had stolen focus into.
   This matters for the direction round: judging the review surface's left rail against
   real content is impossible right now, and a direction round that evaluates an empty
   rail will design the wrong rail. Tracked as `.planning/DEFERRED-REVIEW.md` D-REV-04.
   Consider seeding criteria BEFORE the direction round, not after.

## Standing constraints the planner must honor

- **Human verification is suspended until Phase 11.** See `.claude/CLAUDE.md` §
  "Human verification is deferred until MVP". No `checkpoint:human-verify`, no UAT
  file; `<verify><human-check>` blocks route to `.planning/DEFERRED-REVIEW.md`.
  **But `checkpoint:decision` is NOT suspended** — and this phase is unusually
  decision-heavy, because it is the only phase permitted to amend `01-UI-SPEC.md`'s
  LOCKED sections. Direction choices are decisions, not verifications: ask them.
- **Re-run a direction round; do not freehand it.** ROADMAP Phase 8.1 notes are explicit:
  the current world (Flight Progress Strips, Impeccable seed `59b0beb9`) was chosen by
  the owner from a direction round, and replacing it by taste-in-the-moment would discard
  the one process that produced an owner-endorsed answer.
- **The measured palette must be re-derived, not recolored.** The AA ratios in
  `01-UI-SPEC.md` § "Pinned brand, and the lifts it requires" (`#7d99ff` at 5.92:1 on the
  rack, `#2d4fb8` at 4.97:1 on the strip) were computed against the cream-strip /
  dark-rack pairing. Change the ground and every one of those numbers is void.
- **Owner wants speed.** See `[[ship-first-drain-bugs-with-flywheel]]` in effect: this
  phase exists so he will actually use the product. Prefer the shortest path that makes
  the app worth looking at all day over exhaustive polish.
