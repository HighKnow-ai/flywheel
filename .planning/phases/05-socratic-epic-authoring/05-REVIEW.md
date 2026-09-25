---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-25T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/test/adapter.test.mjs
  - scripts/uat/fixtures/unauthenticated-cli-first-turn.json
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/README.md
  - scripts/uat/uat-08-socratic-authoring.mjs
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
status: issues_found
---

# Phase 05: Code Review Report — G-05-6 closure (plans 05-33, 05-34, 05-35)

**Reviewed:** 2026-09-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the three-plan closure for gap G-05-6 (an unauthenticated CLI's login notice being read as
agent speech, plus the credential/config-isolation seam that produced it), weighting attention to
`git diff e057324..HEAD` and `git diff bd94c51^^^^^..HEAD` across the eight listed files.

The two things this review was specifically asked to check both hold:

- **No API-key credential path was introduced.** `scripts/uat/lib/sidecar-harness.mjs`'s
  `API_KEY_ENV_VARS`/`scrubApiKeyEnv` only *remove* `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from
  the spawn environment; `ACCEPTED_AUTH_METHODS` fail-closed-allows only `"claude.ai"`;
  `assertBackendAuthenticated` refuses (throws, prefixed `HARNESS PRECONDITION FAILED:`) rather than
  falling back to any other credential path. `CREDENTIAL_LINK_ALLOWLIST` links exactly one entry
  (`.credentials.json`) by symbolic reference, never a copy, and `assertClaudeConfigIsolated`'s three
  new content checks (denylist, allowlist-only-symlinks, allowlist-entries-must-be-symlinks) are
  defense-in-depth against that link ever becoming a full copy. No hardcoded secret, API key literal,
  or credential value appears anywhere in the eight files.
- **The new normalised error fields at the adapter seam omit absent fields, never fabricate, and
  never throw.** `AssistantTextEvent.isApiErrorMessage`/`errorCode` and
  `ResultEvent.isError`/`terminalReason` (`packages/sidecar/src/adapter.ts`) are populated in
  `claude-code-adapter.ts::normaliseStreamEvent` (lines 660-671, 690-696) with conditional spreads
  keyed on strict type checks (`=== true` / `typeof … === "string" && … .length > 0` /
  `typeof … === "boolean"`), so a block declaring neither field omits the key entirely, and every
  path is covered by dedicated tests in `adapter.test.mjs` (including the frozen real fixture) that
  assert key-presence, not just value equality.

The recurring "a shipped description outlives the code it describes" defect class this phase names
seven times did **not** recur in this closure: the README's "Eleven scenarios" list matches
`Object.keys(SCENARIOS)` in `fake-authoring-claude.mjs` exactly (11 distinct, non-colliding keys);
every `.refusal`/`refusal:` reference in `uat-08-socratic-authoring.mjs` was renamed to
`.nonConversation`/`nonConversation:` with no stragglers (`grep` found zero); the fixture-provenance
claims in `scripts/uat/README.md`, the fixture's own `note` field, and the three independent readers
of that fixture (`adapter.test.mjs`, `fake-authoring-claude.mjs`, `uat-08-socratic-authoring.mjs`)
all resolve to the same on-disk file and agree on its shape (3 lines, `is_error: true`,
`terminal_reason: "api_error"`, `subtype: "success"`).

Three warnings below are real quality/robustness gaps, none of them security- or data-loss-shaped.

## Warnings

### WR-01: The advance-stage skip for a non-conversation replay scenario is gated on a literal scenario-name list, not on the categorical fact the driver already computed

**File:** `scripts/uat/uat-08-socratic-authoring.mjs:4281`
**Issue:** This closure's own README (and the code's own comments, e.g. `classifyNonConversationTurn`'s
doc comment in `sidecar-harness.mjs`) states the operating rule this whole G-05-5/G-05-6 lineage was
built to enforce: *"When a verification instrument is reconstructing a fact the product already
receives, the fix belongs at the seam that dropped it — not in the instrument."* The gate that
decides whether `--replay-check` calls `advance-stage` after `driveChallengeConversation` returns
violates exactly that rule:

```js
if (scenarioName === "backend-refuses-mid-conversation" || scenarioName === "unauthenticated-backend-first-turn") {
  step("skipping advance-stage for this scenario — a refused conversation never reaches it (D-90)");
  ...
} else {
  step("advancing the stage (Cyril's own gate, D-90) through the bridge, mirroring the live body");
  const advanced = runOps(opsBin, harness.appDataDir, ["advance-stage", runId]);
  ...
}
```

The driver already returns `conversation.nonConversation` (non-null exactly when the run stopped on
a non-conversation turn) — the categorical fact this branch needs. Instead the branch re-derives it
by matching the scenario's own *name*, the identical class of positional/name-based inference this
phase's README calls out as the root cause of six (now effectively eight) consecutive rounds of this
defect. If a future scenario is added that also produces a non-conversation classification (which is
exactly the pattern this closure predicts will keep happening — it is the *third* scenario in this
family after `backend-refuses-mid-conversation` and `unauthenticated-backend-first-turn`) and its
name is not added to this `||` chain, the harness will call `advance-stage` on a run that never
settled — the precise "D-90's gate opened on an unfinished conversation" failure class this whole
closure exists to prevent, now reintroduced inside the instrument that is supposed to catch it.

**Fix:**
```js
if (conversation.nonConversation) {
  step("skipping advance-stage — the conversation stopped on a non-conversation turn (D-90)");
  ...
} else {
  step("advancing the stage (Cyril's own gate, D-90) through the bridge, mirroring the live body");
  ...
}
```
This also lets the assertion at line ~4289 (`authoringStage` still `"challenge"`) run unconditionally
for any non-conversation scenario, present or future, with no name list to keep in sync.

### WR-02: `isApiErrorMessage` silently drops an explicit wire `false`, unlike its sibling `isError` introduced in the same closure

**File:** `packages/sidecar/src/claude-code-adapter.ts:669`; doc: `packages/sidecar/src/adapter.ts:34-39`
**Issue:** The `ResultEvent.isError` field (same commit, same closure) is explicitly documented and
tested to carry a literal wire `false` as a real reading — "a literal `false` is a real reading and
is carried, never dropped as falsy" (`adapter.ts:137-140`), implemented as
`...(typeof result.is_error === "boolean" ? { isError: result.is_error } : {})` and proven by
`adapter.test.mjs`'s "a result line's error flag literally false is carried as false" test.

`AssistantTextEvent.isApiErrorMessage`, introduced in the identical commit for the identical purpose
(carrying the wire's own error-shaped boolean faithfully), does not get the same treatment:

```ts
...(envelope.is_api_error_message === true ? { isApiErrorMessage: true } : {}),
```

A wire envelope carrying `is_api_error_message: false` explicitly is indistinguishable, at this
seam, from an envelope that declares no such field at all — both produce no `isApiErrorMessage` key.
There is no test asserting this case either way, so the asymmetry is unintentional-looking rather
than a documented design choice: the doc comment for `isApiErrorMessage` only specifies the
*absent* case ("Absent entirely — never present-but-false — when the backend's own envelope
declared no such flag"), leaving the explicit-`false` case unaddressed, whereas its sibling field's
doc comment addresses it directly. If a future backend version emits `is_api_error_message: false`
as a positive "this is not an error" signal (mirroring how `is_error` is apparently present on
every result line, true or false), that signal is currently discarded rather than carried, and
nothing in this closure's own test suite would catch a regression either way.

**Fix:** Either mirror the `isError` idiom exactly —
```ts
...(typeof envelope.is_api_error_message === "boolean" ? { isApiErrorMessage: envelope.is_api_error_message } : {}),
```
— or, if the asymmetry is deliberate (e.g. because this field is genuinely never emitted as `false`
on the real wire), add one sentence to the doc comment stating that and one test asserting an
explicit `false` is *also* dropped, so a future reader cannot mistake the gap for an oversight the
way this review did.

### WR-03: `normaliseStreamEvent` can throw on a stdout line that parses as JSON `null`

**File:** `packages/sidecar/src/claude-code-adapter.ts:596` (pre-existing code, exercised by the
function this review's brief specifically asked to verify never throws)
**Issue:** `startSession`'s/`startAuthoringSession`'s `rl.on("line", ...)` handler wraps `JSON.parse(line)`
in a `try`/`catch` specifically so a non-JSON line degrades to a `system_notice` rather than crashing
— but `JSON.parse("null")` does not throw; it returns the primitive `null`. That value is then passed
straight to `normaliseStreamEvent(parsed, line, ...)`, whose very first statement is
`if (parsed.type === "system" && ...)`. Reading `.type` off `null` throws a `TypeError`
*outside* the try/catch that guarded the parse, inside a synchronous `readline` `'line'` event
handler — an exception there is uncaught and will crash the sidecar process for the *whole fleet*,
not just the one run whose backend emitted the stray line. The same hazard exists for any other
JSON scalar that is not an object (`true`, `42`, `"a string"`) — `.type` is `undefined` on those
(no throw), but `null.type` throws.

This is not part of the wire-error-fact carry this closure added, but it sits directly inside the
function this review was asked to confirm "must not throw on such a block," and a real (if unlikely)
backend line shaped this way — or a future fixture/scenario author who writes `printLine(null)` by
mistake in `fake-authoring-claude.mjs` — would reproduce it immediately.

**Fix:** Guard at the top of `normaliseStreamEvent`, or in the `rl.on("line", ...)` callers right
after the successful parse:
```ts
if (parsed === null || typeof parsed !== "object") {
  return { ...base, type: "unknown" };
}
```

---

_Reviewed: 2026-09-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
