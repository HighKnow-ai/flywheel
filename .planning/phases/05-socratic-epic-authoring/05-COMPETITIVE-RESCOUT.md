# Nimbalyst Competitive Re-scout — Phase 5, Plan 01, Task 3

**Closes:** `.planning/STATE.md` Blockers/Concerns row *"Nimbalyst competitive checkpoint. Ships
local desktop + Claude Code + worktrees + kanban already. Re-scout before Phase 5 (Socratic
authoring) to confirm the moat is still where the research said it was."*

**Re-scouted:** 2026-09-23, against sources dated 2026-09-08 through 2026-09-23 (i.e. everything
from `.planning/research/COMPETITION.md`'s own cutoff date forward). Every URL below was fetched
live during this task, not recalled from training data.

---

## What `research/COMPETITION.md` (2026-09-08) said

Nimbalyst was named **"the single most concrete threat in the market"**: MIT-licensed, local
desktop, kanban board over Claude Code/Codex sessions, git worktrees already built. It was missing
four things relative to Flywheel's Active requirements: acceptance criteria as a schema field, an
epic layer, Socratic authoring, and agent-authored backlog proposals. The document's own risk
table rated *"Nimbalyst adds epics + acceptance criteria + fleet view"* likelihood **HIGH**,
impact **MEDIUM-HIGH**, reasoning that "the delta to Flywheel's schema is comparatively small"
given the team had already flipped Crystal→Nimbalyst and closed-source→MIT within roughly two
months — a team shipping at that velocity could plausibly close a schema gap in weeks.

## What is true today (15 days later)

**Nimbalyst still has no epic concept and no acceptance-criteria field.** This is the load-bearing
finding this re-scout exists to make, and it is checked three independent ways, all negative:

1. **The README** (`github.com/Nimbalyst/nimbalyst`, fetched 2026-09-23) describes "Task
   Tracking" as: *"Keep track of your plans, bugs, features, todos etc. Have the agent edit tasks,
   add them, move them, and execute them. Humans view and edit them too."* A flat item list with
   agent-writable status, not a two-level hierarchy with checkable sub-items.
2. **The changelog** (`nimbalyst.com/changelog`, fetched 2026-09-23, covering every release from
   0.75.5 through the current 0.78.0, dated September 8–14, 2026 — i.e. entirely inside this
   re-scout's window) contains zero occurrences of "epic," "acceptance," "hierarchy," or
   "Socratic" across ten release entries. What *did* ship in that window: remote/cloud sandbox
   execution via Cloudflare (0.78.0, Sept 14 — a move AWAY from pure local-first, not toward
   Flywheel's schema), and "coordinating agents read sibling reports during long-running work
   without replaying them as extra turns" (0.77.5, Sept 9) — a multi-agent coordination feature,
   not a context-reconstitution-from-acceptance-criteria mechanism; the two are easy to conflate
   and are not the same thing.
3. **The docs** (`docs.nimbalyst.com/task-management/item-types-and-fields`,
   `.../custom-tracker-types`, `.../overview`, all fetched 2026-09-23) contain zero occurrences of
   "acceptance," "epic," or "checklist" across all three pages.

**What Nimbalyst DOES have, found during this re-scout and not called out by name in the original
document:** `docs.nimbalyst.com/task-management/linking-tracker-items` documents a
**user/agent-configurable parent/child relationship field** on "custom tracker types" — the
worked example shown is a Module/Submodule/Feature hierarchy, set up by asking the in-app agent to
"update the schema to support linked trackers... a parent can have multiple children," or by hand
under Settings → Project → Trackers. This is a real, shipped mechanism for building *a* hierarchy —
but it is a generic, user-authored relationship field on an otherwise schema-flexible item type,
not a fixed, first-class Epic→Task concept enforced by the product itself the way Flywheel's
five-state CHECK constraint is (Phase 1, D-…: "the schema, not app code, is the authority"). A
Nimbalyst user could hand-configure something that *looks* like an epic hierarchy; nothing in the
product ships it, names it, or attaches acceptance criteria to it as a checkable field.

**A further structural difference this re-scout surfaced:** the README's own wording — "Have the
agent edit tasks, add them, move them, and execute them" — describes the agent writing tracker
items directly, with no accept/reject/amend gate mentioned anywhere in the docs or changelog
checked. This is the opposite of this phase's own D-80/D-96 (a session-scoped staging table; the
canonical board is untouched until a human accepts each item individually) and of
`ARCHITECTURE.md`'s Anti-Pattern 2 (agents never write `Task`/`Epic` directly). If accurate,
Nimbalyst's task tracker is closer to "the agent's scratchpad, visible to a human" than to
Flywheel's human-is-the-write-gate model — a genuine product-philosophy difference, not just a
missing field.

## Verdict

**Socratic epic authoring is still an unclaimed differentiator.** Fifteen days of Nimbalyst's own
shipped changelog (0.75.5→0.78.0, three release cycles) add zero epic/acceptance-criteria/Socratic
surface — the gap `research/COMPETITION.md` identified on 2026-09-08 is, if anything, wider than
assumed, because the one hierarchy-adjacent feature that did exist (user-configurable parent/child
tracker relationships) turns out to be generic schema tooling rather than a purpose-built epic
concept, and the agent-writes-tasks-directly model this re-scout surfaced is a harder gap to close
than a missing field, since closing it would mean reversing a design stance (agent as direct
writer) rather than adding one (an epic type). The original document's own caveat still applies in
the other direction, though: Nimbalyst is shipping fast (four release entries in the last nine days
alone) and explicitly told its own users the AI agent can edit tracker type schemas on request —
"add an epic hierarchy and an acceptance-criteria checklist field" is a request a Nimbalyst user
could plausibly make of their own agent today, even without Nimbalyst the company building it as a
first-class feature. The moat is not "this is hard to build technically" — `research/COMPETITION.md`
already conceded that — it is "this is hard to build as a *coherent, human-gated, board-native*
system while also shipping the surrounding supervision/worktree apparatus," and nothing observed in
this window changes that assessment.

## Sources (all fetched live, 2026-09-23)

- `https://github.com/Nimbalyst/nimbalyst` (README, "Task Tracking" feature description)
- `https://nimbalyst.com/changelog` (releases 0.75.5–0.78.0, dated 2026-09-08 through 2026-09-14)
- `https://nimbalyst.com/` (homepage FAQ/description, no epic/acceptance-criteria language)
- `https://docs.nimbalyst.com/task-management/item-types-and-fields`
- `https://docs.nimbalyst.com/task-management/custom-tracker-types`
- `https://docs.nimbalyst.com/task-management/linking-tracker-items` (the parent/child relationship-field finding)
- `https://docs.nimbalyst.com/task-management/overview`
- Cross-checked against `.planning/research/COMPETITION.md` (researched 2026-09-08), the original assessment this document re-scouts
