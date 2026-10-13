# Superseded phase-02 reports

These are kept verbatim as history, not as live phase state. They sit in this subdirectory because
the phase-completion predicate scans `*-VERIFICATION*.md` in the phase directory and treated a
superseded report's own `status:` as current — an archive dated 2026-09-11T00:00Z with
`status: gaps_found` blocked the phase long after every gap it named was closed.

Nothing in them was edited. Rewriting a historical report's status to unblock a gate would destroy
the very record that makes the gate worth having.

- `02-VERIFICATION.pre-gap-closure.md` — the verification written BEFORE plans 02-15..02-18 existed.
  Its 2 failed criteria became gaps G-02-1..G-02-4, all since closed and verified. Superseded by
  `../02-VERIFICATION.md` (status: passed).
- `02-REVIEW.pre-gap-closure.md` — the code review from the same round, if present. Superseded by
  `../02-REVIEW.md` and `../02-REVIEW-FIX.md`.
