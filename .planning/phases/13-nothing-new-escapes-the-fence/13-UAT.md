---
status: testing
phase: 13-nothing-new-escapes-the-fence
source: [13-VERIFICATION.md]
started: 2026-10-15T15:30:00Z
updated: 2026-10-15T15:30:00Z
---

## Current Test

number: 1
name: Decide the two criterion clauses that cannot exist until Phase 16, neither covered by an override
expected: |
  Owner either accepts an override for each (as was done for the cycle chain and the live run) or
  adds the obligation to Phase 16's success criteria. Today Phase 16 SC4/SC5 mention neither
  `assert_human_actor_in_tx` nor the scale fixture, so nothing downstream forces them.

  (a) "accepting an ADR" refuses an agent at the database — criterion 2, FNC-03
  (b) the 40-ADR / 30 KB PRD scale fixture — criterion 4
awaiting: user response

## Tests

### 1. Decide the two criterion clauses that cannot exist until Phase 16, neither covered by an override
expected: Owner either accepts an override for each, or adds the obligation to Phase 16's success criteria. Phase 16 SC4/SC5 currently mention neither `assert_human_actor_in_tx` nor the scale fixture, so nothing downstream forces them. Clause (a) is "accepting an ADR refuses an agent at the database" (criterion 2, FNC-03); clause (b) is the 40-ADR / 30 KB PRD scale fixture (criterion 4). Both objects (ADR table, PRD table) do not exist yet, so no code can satisfy either today.
result: [pending]

### 2. Confirm the criterion-1 override still reads as intended, given BL-6
expected: Owner confirms the handoff to Phase 14 will be written into Phase 14's criteria, or amends the override reason. The override's stated destination — "clause moved to Phase 14 success criterion 1" — is not true in `ROADMAP.md`: Phase 14 SC1 at line 237 does not carry the cycle-table FK clause. Fix is one sentence appended to Phase 14 SC1.
result: [pending]

### 3. Epic status after the StatusPicker deletion
expected: Owner records derive-from-tasks or a dedicated epic control. Already filed by the owner and deferred to Phase 14 (todos dated 2026-10-15); DRFT-04's text is "a task's status", so the scoping is legitimate. Carried here only so it is not lost.
result: [pending]

### 4. Read the boundary sentence for a 200-summary task as the agent prompt shows it
expected: After 13-17 (one ordinal base per clause) the numbers reconcile with the `### Session N` headings beside them. Current text for the 200-summary fixture: "Summaries 1-20 are folded; 21-25 are carried verbatim. 25 of 200 summaries read; 175 earlier sessions are on the task, readable from the task's own session history." Prompt clarity is a human judgement; the earlier mixed-ordinal defect was fixed in code and tests but never read by a person.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
