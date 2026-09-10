## Deferred Items

- `ItemDetailPanel.tsx:219` hard-codes `color: "#ffffff"` on the "Start Work" button label instead of a token
  status: open
  **What:** Task 1's plan-specified `<verify>` gate (`grep -rlE '#[0-9a-fA-F]{6}' packages/desktop/src | grep -vcE 'styles/tokens\.css|theme/tokens\.ts|theme/__tests__/contrast\.test\.ts'` must equal `0`) fails because of this one pre-existing literal. It was introduced by plan 02-01 (the Start Work tracer), not by 02-03, and `ItemDetailPanel.tsx` is outside 02-03's `files_modified` scope — out of scope per the executor's scope-boundary rule (only auto-fix issues directly caused by the current task's changes). No hex literal exists in any file 02-03 actually touched; the other three Task 1 verify commands (theme test suite, `--blocked-text-strip` count, `tsc`/`vite build`) all pass cleanly.
