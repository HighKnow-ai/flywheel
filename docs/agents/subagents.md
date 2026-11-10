# Sub-agents

How agents delegate. The rules exist because Anthropic's prompt cache expires after 5 minutes idle: waking a 700K-token context after that re-bills all of it as a cache write.

## A finished sub-agent stays finished

Once a sub-agent has handed back (`SubagentHandback`), do not resume it with `SendMessage` after a gap of more than 5 minutes, which a CI run or a review always exceeds. Spawn a **fresh** sub-agent for review fixes and follow-ups, briefed with the PR or branch reference, the review findings and the files to read. Resuming inside 5 minutes is fine.

## Builders verify fast; long waits go elsewhere

A builder sub-agent with a large context runs only quick, scoped checks in its loop: one package's tests and typecheck. A blocking step over 5 minutes (a full test run, waiting on remote CI) runs in the parent orchestrator or in a fresh, clean-context verification sub-agent, not in the builder.

## Screenshots stay out of builders

Never `Read` a `.png` or other image in a builder session or the main implementation session: every image block is re-read on every later turn. Delegate visual critique, layout checks and before/after comparison to a disposable, read-only verifier sub-agent that returns text only: pass or fail per criterion, exact defects, file paths. For a PR body, reference the screenshots by path and the verifier's summary; do not re-open them. Requiring visual verification of UI changes is unchanged; only where the images are read changes.
