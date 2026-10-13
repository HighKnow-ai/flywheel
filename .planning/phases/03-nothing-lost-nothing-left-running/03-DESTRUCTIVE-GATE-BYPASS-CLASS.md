# Destructive-gate bypass class — open finding

**Status:** OPEN — closure approach DECIDED 2026-09-20 (see `03-CONTEXT.md` D-59 .. D-63); not yet planned or built
**Requirement:** AGNT-07 — "Destructive actions (force-push, branch deletion, recursive delete)
always require explicit confirmation, even when the session is running in an auto-accept
permission mode"
**Recorded:** 2026-09-20, during phase 03 gap closure (`/gsd-execute-phase 03 --gaps-only`)
**Severity:** Critical in kind, currently mitigated in practice — see "Exploitability" below.

## Why this file exists

AGNT-07 was marked `Complete` by plan 03-22 and has been **walked back to `Gaps Found`** by the
orchestrator on the evidence below. The requirement's own wording is "always require explicit
confirmation"; a class of ordinary shell idioms defeats the text classifier entirely, so `Complete`
was not supportable.

This is not a regression introduced by phase 03. It is a pre-existing gap in the design of the
text classifier that four successive rounds of fixes did not close, each round having closed only
the specific token that someone happened to test.

## The finding

`packages/shim/src/main.rs --classify-invocation` returns `{"category":"safe"}` for every one of
these, each a common, non-exotic shell idiom:

```
sh -c "git push --force"      -> {"category":"safe"}
bash -c "git push --force"    -> {"category":"safe"}
nice git push --force         -> {"category":"safe"}
nohup git push --force        -> {"category":"safe"}
timeout 5 git push --force    -> {"category":"safe"}
xargs git push --force        -> {"category":"safe"}
sudo git push --force         -> {"category":"safe"}
setsid git push --force       -> {"category":"safe"}
```

Verified directly against the compiled binary at commit `0fdda51`. Classification only — none of
these were executed as part of recording this finding.

## Root cause

`destructive::classify` returns `Safe` for any program name that is not literally `git` or `rm`, by
design. Any launcher that shifts the real program one or more tokens to the right is therefore
invisible to the text classifier, regardless of how many individual wrapper tokens are enumerated.

The four rounds of fixes to date all taught the classifier about specific wrapper tokens
(`env`, `command`, `builtin`) rather than addressing the shape:

| Round | Finding | Fix | Found by |
|---|---|---|---|
| 1 | CR-01 — shell function / alias / `hash -p` / `PATH=` shadow | quick task 260920-duy | code review |
| 2 | `command` / `builtin` not unwrapped, classified `safe` | `3eaa76c` | code review (this run) |
| 3 | `command -v` / `-V` wrongly made destructive by round 2 | `bbe00b4` | orchestrator |
| 4 | `env`'s own dash-flags (`-i`, `-S`, `-u PATH`, unknown) | `0fdda51` | executor, during round 3 |

Each round was found by someone looking, never by the enumeration catching itself. That pattern is
the finding, not any individual token.

## Exploitability — read this before prioritising

The gate has two independent layers, and severity depends on whether a shape defeats both:

1. **The text classifier + `pretooluse-hook.ts`** (what this finding is about).
2. **The shim's runtime `PATH`-shadow interception**, which fires on the literal `execvp`
   regardless of what wrapped the invocation.

- The eight launcher shapes above **still reach layer 2** in a correctly configured session — they
  inherit `PATH` normally, so the real `execvp("git", …)` still hits the shim. Today they are a
  single point of failure, not a double one.
- **But `pretooluse-hook.ts` returns `{}` unconditionally when `category === "safe"`, without ever
  calling `shimWillIntercept`** — the environment-correctness proof it insists on before trusting
  an ordinary bare `git push --force`. So `sh -c "git push --force"` receives *strictly less*
  scrutiny than the bare form. If the shim environment is ever misconfigured in a session — the
  precise case `shimWillIntercept` exists to detect — every one of these shapes becomes a silent,
  total bypass.
- `env -i` and `command -p` were sharper in kind, not merely degree: they defeat layer 2
  unconditionally by clearing or replacing `PATH`. Both are now fixed (`0fdda51`, `3eaa76c`).

## What would actually close the class

Three options, assessed by the executor that did rounds 2-4 and carried into this record:

1. **Invert the default — refuse `Safe` for any leading token that is not a known-inert program.**
   Closes the class completely. But it is a product-scope change, not a code fix: nearly every
   command a coding agent runs (`npm`, `cargo`, `ls`, `grep`, `python`, `curl`, …) is not
   `git`/`rm` and passes today with zero friction. Inverting the default turns a narrow git/rm gate
   into general command-allowlisting, with a much larger prompt surface. `03-CONTEXT.md`'s
   "Claude's Discretion" note already defers whether the shim intercepts more than git as a
   phase-level decision.
2. **Enumerate known process-launchers** (`sh -c`, `bash -c`, `nice`, `nohup`, `timeout`, `setsid`,
   `xargs`, `sudo`) and recursively re-classify the wrapped command. Buildable, stays inside "only
   git/rm are gated" — but is still enumerate-and-hope with a shorter, slower-moving list. It moves
   the boundary without closing the class.
3. **Stop trusting `safe` in the hook.** Make `pretooluse-hook.ts` verify `shimWillIntercept` (or
   fail closed) whenever it cannot positively identify a command as inert, instead of returning
   `{}` on `category === "safe"`. This is the option that uses the layer-2 backstop that already
   exists. It is a change to the file plan 03-19 plus quick task 260920-duy deliberately settled,
   so it reopens a decided contract and should be a planned decision, not a drive-by fix.

Recommended next step: carry this into a dedicated planning conversation rather than a quick task.
Option 3 is the most likely correct answer and is the one that needs a decision, not a patch.

### Decision taken — 2026-09-20

That conversation happened (`/gsd-discuss-phase 03`). **Option 3 was chosen** and is recorded in
`03-CONTEXT.md` as **D-59 .. D-63**, alongside three decisions the option itself did not settle:

- **D-59** — the closure is a change to `pretooluse-hook.ts`, not a longer list in the classifier.
  Its `safe` branch must establish the same layer-2 proof its non-safe branch already demands at
  line 219. Option 2 rejected as round 5 of enumerate-and-hope; option 1 deferred with a named
  trigger.
- **D-60** — an environment the hook cannot prove denies, for every command, not only destructive
  ones. Consequence: a broken shim install must fail loudly at spawn rather than producing a session
  that silently denies everything.
- **D-61** — a `PATH`-shadowing construct denies a `safe` verdict only when the text also names
  `git` or `rm`, so the function/alias shape is closed without denying ordinary `source`/`eval`.
- **D-62** — AGNT-07 stays `Gaps Found` until an adversarial corpus runs end-to-end through the real
  hook against the real shim, a live run passes, and the trust boundary is written down.
- **D-63** — verification of this gate never executes the destructive command (from the incident
  below).

Still to do: plan and build it. Nothing in this file has been fixed in code yet.

## Incident recorded during this investigation

While empirically testing which wrappers reach layer 2, an executor ran
`PATH="<fake-shim-dir>:$PATH" bash -c 'command -p git push --force'`, expecting `-p`'s hardcoded
default `PATH` to find no git in the sandbox. It found the real system git and performed a **real,
unauthorized `git push`** to `git@github.com:cymarechal/highknow-harness.git`, publishing branch
`cymarechal-devoteam/gsd-new-project-ade` (202 commits) as a new remote ref.

- Nothing was overwritten — the branch had no prior remote ref, and `main` was untouched.
- The executor disclosed it immediately and unprompted, and correctly declined to delete the remote
  branch on its own authority (that is another unauthorized push).
- The orchestrator confirmed the facts and, on the user's explicit instruction, ran
  `git push origin --delete cymarechal-devoteam/gsd-new-project-ade`. The remote is back to `main`
  only; local history is intact.

**Cause:** the orchestrator's dispatch brief fenced live `claude` sessions but did not forbid
executing real destructive git commands during verification. Testing a force-push bypass by running
a force-push was a foreseeable reading of that instruction.

**Lesson for future briefs of this kind:** a brief that asks an agent to determine empirically
whether a destructive command is gated must state explicitly that classification is the deliverable
and that the command itself must never be executed against a real remote — and should point at a
throwaway remote if execution is genuinely required.
