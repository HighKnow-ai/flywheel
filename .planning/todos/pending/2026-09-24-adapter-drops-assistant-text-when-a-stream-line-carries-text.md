---
created: 2026-09-24T06:28:06.727Z
title: Adapter drops assistant text when a stream line carries text and tool_use
area: general
severity: major
files:
  - packages/sidecar/src/claude-code-adapter.ts:589-612
---

## Problem

`normaliseStreamLine` (or its equivalent block-dispatch in
`packages/sidecar/src/claude-code-adapter.ts:589-612`) tests `content.find(tool_use)` and
**returns from that branch before the text branch is ever reached**. When a single
stream-json assistant line carries both a text content block and a `tool_use` content
block, the text reaches no event at all — it is silently discarded rather than emitted as
`assistant_text`.

Consequence in shipped product code: the desktop session feed renders agent narration from
`assistant_text` events. Any turn where Claude Code packs narration and a tool call into
the same stream line would show the tool call with **no accompanying narration** — the user
sees the agent act without seeing it say why. There is no error, no log line, and no
partial render; the text simply never existed as far as the UI is concerned.

**Why this is latent rather than active today.** This repo's own live measurement against
claude 2.1.267 — `scripts/spike/authoring-transport-spike.mjs:114-119` — records that the
real binary splits content blocks across separate stream-json lines sharing one
`message.id`. Under that emission shape the text block and the tool_use block arrive on
different lines, each hits its own branch, and nothing is lost. The defect is therefore
one upstream emission change away from becoming visible, and it would become visible as
"the agent stopped explaining itself", which is very hard to attribute back to this line.

**Provenance.** Found incidentally during the Phase 05 diagnosis of gap `G-05-2`
(`.planning/debug/uat-08-live-transcript-unjudgeable.md`, 2026-09-24). It was **not** the
mechanism behind that gap — G-05-2's two root causes are both harness-side, in
`scripts/uat/`. This finding is shipped product code, in a different subsystem, on a
different failure path, and was deliberately kept out of the G-05-2 gap-closure wave so
that wave's verification stays a clean proof that the verification instrument is
trustworthy. Captured here so it is not lost with the debug session.

Severity is recorded as `major` on the taxonomy's "wrong behavior with no workaround"
rule — when it triggers there is no fallback and no signal. It is not `blocker` because it
does not trigger against the current binary's emission shape.

## Solution

TBD — not yet designed. The shape of the fix is to stop treating the content blocks as a
tagged union chosen by `find`, and instead iterate every block in the line, emitting one
event per block, so text and tool_use on the same line both survive. Verify with a unit
test that feeds a single stream-json line carrying both block types and asserts both an
`assistant_text` and a `tool_call` event come out — the repo's offline normaliser tests
already provide the harness for this and cost no tokens.

Worth confirming against the current `@anthropic-ai/claude-agent-sdk` / claude binary
whether combined-block lines are actually reachable, before deciding priority.
