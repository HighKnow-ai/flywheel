# Worktrees gets a select-all that only selects; the one confirmation stays

Decided in [All agents and Worktrees are Tables with headers](https://github.com/HighKnow-ai/flywheel/issues/208) (Epic #189), from the M4 design critique (F3).

Plan 10-09 (D-179) gave the worktree inventory per-row checkboxes and deliberately no select-all and no reclaim-everything action: "there would be no way to keep one". With thirteen or more reclaimable worktrees across several projects, ticking each row is the slow part of reclaiming disk, and the critique (F3) asked for a Checkbox select-all.

The inventory now has a select-all Checkbox in its table header. It selects the reclaimable rows only. It doesn't act: any row can still be cleared before anything happens, the header reads as partial (a dash) once one is, and the reclaim still goes through the one ConfirmDestructive that names the count and the total size. The core still re-derives every row's eligibility when it acts and refuses one an agent started in since the list was read. So D-179's concern holds: there is always a way to keep one, and nothing is removed without its own confirmation.

We rejected two other options:

- **Keep D-179 as it was.** It's safe, but it makes the common case (reclaim everything merged) a row-by-row chore, which is exactly the friction that leaves worktrees on disk.
- **A "Reclaim all reclaimable" button.** It's one press, but it removes in one step what the Developer has not looked at. D-179 rejected it by name, and this decision keeps that rejection.

## Consequences

- `fleet/WorktreeInventory.tsx` and its tests drop the "no select-all" assertion and test that select-all selects reclaimable rows only, can be partly undone, and submits nothing until confirmed.
- A reclaim that removed everything reports in a toast; one that left a row behind lists every outcome inline, as before. A call that fails outright keeps the confirmation open with the failure.
