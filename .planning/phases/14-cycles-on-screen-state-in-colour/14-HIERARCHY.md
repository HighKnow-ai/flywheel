# Phase 14 Hierarchy Statement: the Cycle region

**Status:** WRITTEN BEFORE THE VISUAL WORK (criterion 5, D-04). Committed ahead of any plan-14-02
commit that touches `packages/desktop/src/board/CycleRegion.tsx`.
**Scope:** structure and weight only. Token values, washes, the dark-first switch and the
per-surface signal budget are Phase 18 (roadmap decision 3).

This is a phase artifact, not a sentence in a plan. Its only job is to be the standard the built
region is judged against by plan 14-09 (on the demonstration board) and plan 14-10 (the owner, on the
running application). If the built region and this statement disagree, one of them is wrong, and the
owner is not asked to reconcile them.

---

## 1. The focal point, and what it is not

**The focal point of the board surface is the epic roster.** Per D-03, work is driven from the
roster, so the roster keeps the hierarchy lead. The Cycle region **orients**: it answers "where does
the work stand and what is ahead" so that nobody has to go and look, and then it gets out of the way
of the roster.

**The Cycle region is the focal point of itself.** Inside its own bounds, one thing leads (the
current Cycle's goal and progress). That is the sense in which this region has a focal point. It is
not the focal point of the board.

Two alternatives were considered and declined, and the decline is part of the statement:

- **A region that leads the whole surface** was declined (D-03, the owner's recorded direction:
  "epic roster leads, progress + roadmap always visible" are two separate things). A Cycle region
  louder than the roster would teach the developer that the Cycle is where work happens. It is not.
  Work happens in the epics under it.
- **Making the progress figure the single focal element** was declined, because criterion 1 asks for
  the goal to be seen as well as the progress. A number alone is a position with no meaning; the goal
  is what gives it one. It would also make the figure the thing the eye lands on, which is the shape
  of a scoreboard.

The region is non-virtualized and sits above the status bands (D-01). Position already says "this is
the frame the rest sits in"; the weight must not contradict it.

## 2. The three levels, named

The three levels are **internal to the region** (D-03). They are three, and only three.

### Level 1: the current Cycle (loud)

- **Belongs here:** the current Cycle's goal; its printed progress fraction (done over total, in
  words and numbers); its counts (epics, agents running, agents blocked) as secondary text beside or
  beneath the goal.
- **Must NOT compete here:** any later Cycle; any control; any decoration of the figure (no trend, no
  comparison, no target); any state colour. The progress figure is a position, not a score.

### Level 2: the later Cycles (quiet)

- **Belongs here:** one line per later Cycle, in rank order: the goal and the epic count. When the
  roster is truncated, one sentence stating how many Cycles exist beyond those shown.
- **Must NOT compete here:** progress figures (a later Cycle has none worth printing yet); expanded
  detail; any weight, size or surface step that makes a later line read as a peer of Level 1.

### Level 3: the frame (recessive)

- **Belongs here:** the region's own container: its surface step, its divider, its padding, and the
  stated absences ("No cycle is active.", "No tasks in this cycle yet"). It exists so that Levels 1
  and 2 sit on something, and so that the region reads as one unit above the roster.
- **Must NOT compete here:** nothing in the frame may draw the eye before Level 1 does. An absence
  is stated in muted body text, never in a box, banner or icon.

## 3. How each level is distinguished

The distinction is carried by **type scale, weight, spacing, position, and the one surface step the
token set already provides**. Specifically:

| Channel | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Type scale and weight | the heading step (the 15px, 600 step) | the body step (13px, 400) | the body or label step, muted ink |
| Position | first, at the top of the region | beneath Level 1, in rank order | the container around both |
| Spacing | the most space around it | tighter; lines stack with the small gap | the region's padding and its divider |
| Surface step | on the region's one surface step (`--surface-secondary`) | same surface, no further step | same surface; the divider is the only edge |

**Colour is not one of the channels carrying this hierarchy.** The state vocabulary that plans 14-04
and 14-07 build is a channel for STATE. Spending it, or any new accent, on structural hierarchy would
make the region compete with the signal it exists to orient around, and would teach the developer
that a coloured thing means "important" rather than "this is in this state". The region is read in
ink and weight; if it needs colour to establish its hierarchy, the hierarchy has failed.

## 4. The judgement procedure

Anyone who has not read the plans can apply this. Do it on the demonstration board (14-09) or on the
running application (14-10), at the board's normal density, with at least one later Cycle present.

1. **Squint test, whole surface.** Look at the board for two seconds, as you would on arriving. Say
   aloud what your eye landed on first. **Pass:** the epic roster (its lead row) or the region's
   Level 1, with the roster not visibly outweighed. **Fail:** a later Cycle line, the frame, or a
   figure outside Level 1 drew the eye first; or the region as a whole outweighs the roster.
2. **Name the levels.** Point at the region and name three things in order: the loud thing, the
   quiet things, the frame. **Pass:** each is findable and is what section 2 says it is. **Fail:**
   two things look equally loud; or a later Cycle line looks like a second current Cycle; or the
   frame has acquired a border, banner, icon or box of its own.
3. **Cover the colour.** Mentally (or with a greyscale filter) remove all colour. **Pass:** the
   three levels are still distinguishable, because type, weight, spacing and position carry them.
   **Fail:** the hierarchy only holds when colour is present.
4. **Read the figure as a position.** Read the progress text aloud. **Pass:** it says where the work
   stands (done over total, or that there are no tasks yet) and nothing else. **Fail:** it contains a
   trend, a comparison with another Cycle, a target, or praise or reproach (this is the phase's
   prohibition on turning a fact into a scoreboard).
5. **Test the absences.** Look at, or force, a project with no active Cycle, a Cycle with no epics,
   and an epic with no tasks. **Pass:** each says something true in words. **Fail:** a zero percent,
   an empty bar, or a blank where a number belongs.

A region **realises the statement** only if all five pass. A fail names the step and the thing seen,
so it can be acted on in the phase's tuning loop (D-28) and never deferred to Phase 18.

## 5. What this statement does NOT decide

- **Token values:** no colour value, wash, edge or mark is chosen here. Those belong to the phase's
  direction document, produced and tuned later on the demonstration board.
- **The dark-first switch and the per-surface signal budget:** Phase 18 (roadmap decision 3, VIS-05
  and VIS-08). This statement takes the structure and nothing else.
- **State colour anywhere in the region:** the state vocabulary (plans 14-04 and 14-07) decides
  where a state class may appear. This statement only says the structural hierarchy does not use it.
- **Exact pixel sizes beyond the existing type steps.** The region uses the type and spacing steps
  the product already has. If those prove insufficient to establish three levels, that is a finding
  for the tuning loop, not a licence to add a new step here.
- **Close flow, scope-drift line and any control inside the region** (plan 14-06). When they land they
  must sit within these three levels and not add a fourth.
