---
slug: uat-08-live-run-starves-on-permission-requests
phase: 05-socratic-epic-authoring
gap_id: G-05-1
status: root-cause-found
opened: 2026-09-24
---

# uat-08's live run starves on unanswered permission requests

## Symptom

`node scripts/uat/uat-08-socratic-authoring.mjs` (live, no `--self-test`), run 2026-09-24:

```
   · spawning a real authoring session (authoring_spawn)
   · waiting for the agent's first reply

❌ FAIL — UAT 8 — Socratic epic authoring, driven live against the real backend

Error: timed out after 120000ms waiting for the agent's first reply.
events so far: ["permission_request","permission_request","permission_request","permission_request",
                "permission_request","permission_request","permission_request","permission_request"]
    at Timeout._onTimeout (scripts/uat/lib/sidecar-harness.mjs:448:11)
[exited with code 1]
```

Everything before the wait succeeded: scratch repo created, project registered
(`01M385SSR9J47131SRCPZC8W7N`), run started in the `challenge` stage
(`01M385SSRPFZM5FW9XMDJ1RGE0`), heartbeat writer on the production cadence, sidecar readiness
handshake complete, `authoring_spawn` accepted. Zero `assistant_text` events followed.

## Root cause

uat-08 never answers the incidental permission requests a real `claude` session raises during its
own startup, so the session is starved before it can emit a single turn.

The shared helper exists and every other live script uses it:

| Script | Drain call |
|---|---|
| `uat-03-destructive-gate.mjs` | local copy of the loop at `:98`, started at `:173` |
| `uat-06-permission-block-lifecycle.mjs` | imports at `:30`, starts at `:193` |
| `uat-07-launcher-shape-gate.mjs` | imports at `:47`, starts at `:164` |
| `uat-08-socratic-authoring.mjs` | **absent** — neither imported nor called |

uat-08's import block (`uat-08-socratic-authoring.mjs:35-42`) pulls only `HEARTBEAT_TICK_MS`,
`probeClaudeAvailable`, `resolveHarnessBinary`, `runScript`, `skip` and `step`.
`grep -n "drain" scripts/uat/uat-08-socratic-authoring.mjs` returns nothing but a prose mention at
`:7` of the sibling scripts it was modelled on.

`lib/sidecar-harness.mjs:495-499` documents this exact starvation in the helper's own doc comment:

> the real `claude` binary issues its own internal session-startup git housekeeping OUTSIDE the
> agent's visible Bash tool-call loop, which still resolves through the same PATH-shimmed directory
> as every other invocation and therefore still reaches the shim's own destructive gate — left
> unanswered, it would starve the session before it ever reaches the deliberate command a script is
> actually measuring.

## Not a production defect

The desktop app answers these requests at the window: `agent_run_answer_permission` is exposed to
the renderer (`packages/desktop/src/adapters/tauri.ts`) and rendered by
`packages/desktop/src/session/PermissionRequestCard.tsx`. Only the headless harness lacks an
answerer.

## Ledger consequence

`05-VALIDATION.md` row 05-10-03 records `node scripts/uat/uat-08-socratic-authoring.mjs --self-test`
as green. That is accurate — the self-test is pure and passes. But the task's deliverable is a live
acceptance run, and the live arm had never been executed end to end before 2026-09-24. The phase's
one live acceptance path was green on its offline half only.

## Fix direction (non-binding)

Mirror `uat-07-launcher-shape-gate.mjs:164`: import `drainIncidentalPermissionRequests`, start it
fire-and-forget after the spawn with a `draining` flag cleared on every exit path, and give it an
`isDeliberate` predicate that never claims a request (this script measures no gated command of its
own). Then re-run live and capture the two verbatim assistant replies the script already prints at
`:252` and `:265`.
