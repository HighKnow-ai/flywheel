---
status: complete
phase: 13-nothing-new-escapes-the-fence
source: [13-VERIFICATION.md]
started: 2026-10-15T15:30:00Z
updated: 2026-10-15T16:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Decide the two criterion clauses that cannot exist until Phase 16, neither covered by an override
expected: Owner either accepts an override for each, or adds the obligation to Phase 16's success criteria. Phase 16 SC4/SC5 currently mention neither `assert_human_actor_in_tx` nor the scale fixture, so nothing downstream forces them. Clause (a) is "accepting an ADR refuses an agent at the database" (criterion 2, FNC-03); clause (b) is the 40-ADR / 30 KB PRD scale fixture (criterion 4). Both objects (ADR table, PRD table) do not exist yet, so no code can satisfy either today.
result: pass
reported: "1"
resolution: |
  Owner chose option 1 — add both clauses to Phase 16's success criteria rather than accept
  overrides, so the obligation survives in a place that is checked when the ADR and PRD tables
  land. Neither clause is overridden in Phase 13; both are now enforced downstream.
  - Clause (a) appended to Phase 16 success criterion 4 (the ADR state/writer criterion).
  - Clause (b) appended to Phase 16 success criterion 5 (the bounded-packet criterion).
  Each carries a provenance note naming Phase 13, the reason it could not be asserted there,
  and the owner ruling date (2026-10-15).

### 2. Confirm the criterion-1 override still reads as intended, given BL-6
expected: Owner confirms the handoff to Phase 14 will be written into Phase 14's criteria, or amends the override reason. The override's stated destination — "clause moved to Phase 14 success criterion 1" — is not true in `ROADMAP.md`: Phase 14 SC1 at line 237 does not carry the cycle-table FK clause. Fix is one sentence appended to Phase 14 SC1.
result: pass
reported: "(1)"
resolution: |
  Owner chose option 1 — append the clause to Phase 14 success criterion 2 rather than amend the
  override reason. SC2 is already the Cycle topology criterion ("an epic belongs to at most one
  Cycle, Cycles never nest"), so the FK-chain assertion is the same class of claim and sits
  beside it; SC1's subject is what the user sees plus the column allowlist, where a referential
  integrity assertion would be missed.
  Residual, deliberately left: the Phase 13 override prose still reads "moved to Phase 14 success
  criterion 1" while the clause now lives in SC2. Off by one criterion, same phase. Owner was
  offered the one-word correction and did not take it; recorded here so it is not mistaken for an
  oversight. Tracked as BL-6.

### 3. Epic status after the StatusPicker deletion
expected: Owner records derive-from-tasks or a dedicated epic control. Already filed by the owner and deferred to Phase 14 (todos dated 2026-10-15); DRFT-04's text is "a task's status", so the scoping is legitimate. Carried here only so it is not lost.
result: pass
reported: "confirmed"
resolution: |
  Owner confirmed the deferral to Phase 14 stands, and did not pick a shape now — neither
  derive-from-tasks nor a dedicated epic control is recorded as the decision yet. Phase 13's
  scoping of the StatusPicker deletion to TASK status is correct on DRFT-04's own text ("a
  task's status"); no Phase 13 criterion is weakened by leaving epic status open.
  Open for Phase 14: how an epic's status is set. Not a Phase 13 gap.

### 4. Read the boundary sentence for a 200-summary task as the agent prompt shows it
expected: After 13-17 (one ordinal base per clause) the numbers reconcile with the `### Session N` headings beside them. Current text for the 200-summary fixture: "Summaries 1-20 are folded; 21-25 are carried verbatim. 25 of 200 summaries read; 175 earlier sessions are on the task, readable from the task's own session history." Prompt clarity is a human judgement; the earlier mixed-ordinal defect was fixed in code and tests but never read by a person.
result: pass
reported: "pass"
resolution: |
  Owner read the sentence in its rendered context and accepted it. Confirmed while presenting:
  `render_verbatim_summary_block` / `render_folded_summary_block` in `context_packet.rs` number
  the `### Session N` headings 1..25 window-relative, so the fold clause's `1-20` / `21-25`
  match the headings the reader sees, and the window clause carries counts only (`25 of 200`,
  `175 earlier`). WR-10 is closed on a human reading, not only on the mechanical
  `ranges(fold)==2 / ranges(window)==0` assertion.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
