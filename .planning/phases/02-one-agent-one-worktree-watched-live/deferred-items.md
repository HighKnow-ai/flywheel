## Deferred Items

- `ItemDetailPanel.tsx:219` hard-codes `color: "#ffffff"` on the "Start Work" button label instead of a token
  status: open
  **What:** Task 1's plan-specified `<verify>` gate (`grep -rlE '#[0-9a-fA-F]{6}' packages/desktop/src | grep -vcE 'styles/tokens\.css|theme/tokens\.ts|theme/__tests__/contrast\.test\.ts'` must equal `0`) fails because of this one pre-existing literal. It was introduced by plan 02-01 (the Start Work tracer), not by 02-03, and `ItemDetailPanel.tsx` is outside 02-03's `files_modified` scope — out of scope per the executor's scope-boundary rule (only auto-fix issues directly caused by the current task's changes). No hex literal exists in any file 02-03 actually touched; the other three Task 1 verify commands (theme test suite, `--blocked-text-strip` count, `tsc`/`vite build`) all pass cleanly.

- Task 2's `<verify>` gate `grep -v '^[[:space:]]*//' packages/desktop/src/legend/marks.ts | grep -c 'export const MARKS'` reports `2`, not `1`
  status: resolved
  **What:** The gate's pattern `'export const MARKS'` is a substring match that also matches the pre-existing `export const MARKS_BY_ID` declaration (present since Phase 1, verified via `git show <pre-02-03 commit>:.../marks.ts` — count was already 2 before this plan touched the file). The real acceptance criterion — "exactly one `MARKS` array" — holds: `grep -c '^export const MARKS:'` (the exact declaration line, not the substring) returns `1`, as does `grep -c '^export type MarkChannel'`. This is a pre-existing false-negative in the verify script's grep precision, not a second registry introduced by this plan.
