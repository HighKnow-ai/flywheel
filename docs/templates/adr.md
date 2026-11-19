# <the decision, as a short sentence>

Copy this file to `docs/adr/NNNN-short-title.md`. Use the next free number. The file name is four digits,
a hyphen and lower case words (`^\d{4}-[a-z0-9-]+\.md$`). A number is never used twice. Replace each
instruction with the content. Write in short sentences. Delete this paragraph.

Say who decided, and link the issue. Then state the decision in one or two paragraphs. Name the
alternative that lost, and why.

## Consequences

List what is now true, and what is now harder.

## Enforced by

This section is the last one in the file. `scripts/adr/check-adr-enforcers.mjs` reads it and fails
when it is missing, or when a name in it does not exist. Add the enforcer in the same change as the ADR.

Write one bullet for each thing that keeps the decision true. A bullet starts with `- ` or `* `.
A line that is indented under it belongs to the same bullet.

- The first backticked token is a path. It is relative to the folder that holds `docs/`. It names a
  file that exists, a test, a check script or a workflow. A symlink that leaves the folder fails.
- Each later backticked token is a symbol: a test name, a function or a column. It must appear in
  that file as a whole word, outside a comment line. Renaming the test makes the check fail.
- A bullet whose path is a test file (`tests/*.rs`, `*.test.*`) must name at least one symbol.

Example:

- `packages/core/tests/story_merge.rs` `a_dirty_checkout_of_the_base_branch_refuses_and_says_so`

If no machine can keep the decision, write this one bullet and nothing else. The reason is a full
sentence of at least six words. The check ignores letter case and accepts bold. It refuses a bullet
that is spelled in another way.

- Not machine-enforceable: <the reason>.
