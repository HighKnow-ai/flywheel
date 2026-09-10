---
phase: 01-the-board-is-the-store-of-record
reviewed: 2026-09-10T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - packages/core/src/domain/issue.rs
  - packages/core/tests/criteria.rs
  - packages/core/tests/hierarchy_workflow.rs
  - packages/desktop/src-tauri/src/commands/issue.rs
  - packages/desktop/src-tauri/src/commands/menu.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/menu.rs
  - packages/desktop/src-tauri/src/state.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/__tests__/layer-guard.test.tsx
  - packages/desktop/src/board/__tests__/menu-bridge.test.tsx
  - packages/desktop/src/projects/RegisterProjectFlow.tsx
  - packages/desktop/src/projects/__tests__/register-project-flow.test.tsx
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/menuSync.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-10
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

This review covered the issue-domain mutation surface (`core::domain::issue`), the Tauri command
layer wrapping it, and the full G-01-1 gap-closure surface (native macOS menu accelerators bypassing
the keyboard layer guard) across the Rust menu builder/state and the renderer's
`keyboard.ts`/`menuSync.ts`/`App.tsx` bridge, plus `RegisterProjectFlow.tsx` and the four associated
test files.

**The specific security boundary called out for scrutiny checks out.** `menu_set_action_enabled`
(`commands/menu.rs`) resolves `action_id` through `MenuHandles::get`'s exhaustive four-arm `match`
(`state.rs`) — anything outside `register-project`/`create-task`/`create-epic`/`open-palette` is
rejected with an explicit error, never silently ignored, and this command never touches menu text,
accelerator or structure — only `set_enabled`. On the renderer side, `App.tsx`'s `menu:action`
listener re-enters `dispatchAction` → the same `resolveGlobalBinding`/`bindingAllowedInLayer` guard
every real keystroke goes through (`state/keyboard.ts`), and `dispatchAction` only ever looks up
`region === "global"` bindings, so a forwarded menu id can dispatch nothing broader than what a real
`⌘`-keystroke could already do. `useMenuLayerSync`'s async push to the native menu is correctly
documented and tested as affordance-only — a keystroke that beats the round trip is still refused by
the JS-side guard. No bypass of the fixed G-01-1 gap was found.

No critical/blocker issues were found: no injection vectors (all SQL is parameterized), no hardcoded
secrets, no dangerous JS sinks (`eval`/`innerHTML`/etc.), no empty catch blocks, and no unregistered
or dangling Tauri commands. The issues below are correctness and maintainability gaps that should
still be fixed — several sit directly adjacent to the exact "layer guard duplicated and drifts"
failure class this phase was created to close.

## Warnings

### WR-01: Title/body length validation counts bytes, not characters

**File:** `packages/desktop/src-tauri/src/commands/issue.rs:42-62`
**Issue:** `validate_title` and `validate_body` use `str::len()`, which in Rust returns the UTF-8
byte length, not the character count the error message claims to measure:

```rust
fn validate_title(title: &str) -> Result<(), String> {
    if title.is_empty() || title.len() > MAX_TITLE_LEN {
        return Err(format!(
            "title must be 1-{MAX_TITLE_LEN} characters, got {} characters",
            title.len()
        ));
    }
    Ok(())
}
```

Any multi-byte UTF-8 content (CJK, Cyrillic, emoji, accented Latin, etc.) is penalized: a title of
200 Chinese characters is 600 bytes and gets rejected as "over 500 characters" even though it is
visually 200 characters, and the reported count in the error text ("got 600 characters") is itself
wrong. Since byte length is always `>=` character count for multi-byte content, this can only
*reject* strings that should be accepted — no oversized string can sneak through — but it is a real,
user-visible correctness bug for any non-ASCII title/body, which is a realistic input for this app.
**Fix:**
```rust
fn validate_title(title: &str) -> Result<(), String> {
    let len = title.chars().count();
    if title.is_empty() || len > MAX_TITLE_LEN {
        return Err(format!(
            "title must be 1-{MAX_TITLE_LEN} characters, got {len} characters"
        ));
    }
    Ok(())
}
```
Apply the same `chars().count()` fix to `validate_body`.

### WR-02: `useRegistrationErrorNotice` assumes a JS `Error`, but Tauri commands reject with a plain string

**File:** `packages/desktop/src/projects/RegisterProjectFlow.tsx:104`
**Issue:**
```ts
setMessage(`Couldn't register this project — ${(error as Error).message}`);
```
Every Tauri command in this codebase returns `Result<T, String>` (see `commands/issue.rs`,
`commands/project.rs`, etc. — every handler ends `.map_err(|e| e.to_string())?`). Tauri's
`invoke()` (`@tauri-apps/api/core`) rejects the JS promise with the raw `Err` payload as returned by
the backend — i.e. a plain `string`, not a JS `Error` instance. `useRegisterProject()`'s mutation
therefore surfaces `registerProject.error` as that string. `(error as Error).message` on a string
value is `undefined`, so a real registration failure (e.g. "project already registered at a
different path", a disk error, an invalid key prefix) renders as:

> Couldn't register this project — undefined

The unit test for this hook (`register-project-flow.test.tsx`) only ever passes `new Error(...)`
values, so it cannot catch this — it tests a shape the real IPC boundary never actually produces.
This is a pre-existing pattern in `FirstRun.tsx:101` and `ProjectUnreachable.tsx:93`, but this phase
newly centralizes it into `useRegistrationErrorNotice`, the shared hook all four registration entry
points (rail `+`, `⌘⇧O`, palette, and — via `RegisterProjectProbe`-style reuse — future callers) now
render through, so the bug's blast radius just grew from one call site to the single shared one.
**Fix:** Normalize the error before formatting, and cover it with a test that mimics the real IPC
rejection shape (a plain string), not just an `Error`:
```ts
function messageFor(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
setMessage(`Couldn't register this project — ${messageFor(error)}`);
```

### WR-03: The six-field layer object is constructed twice, independently, inside `BoardView`

**File:** `packages/desktop/src/board/BoardView.tsx:393-398` and `:663-668`
**Issue:** The exact same `topLayer({ paletteOpen, detailOpen: detailItemId !== null, pickerOpen:
activePicker !== null || deleteTarget !== null || pendingDone !== null, quickAddOpen })` literal is
built twice in this file: once in `handleContainerKeyDown` (the keyboard path) and again in
`IssuesLane`'s `onOpenParentPicker` callback (the CR-02 click path). Both derive "what layer is on
top right now" from the same six store fields, but as two independent literals rather than one
shared value.

This is the same failure shape this phase exists to close (G-01-1: a guard duplicated across two
entry points that can silently drift apart — there, keyboard vs. native-menu; here, keyboard vs.
pointer). If a future layer field is added to the store (another modal, another trapped scope) and
one of these two literals is updated while the other is not, the click path and the keyboard path
will disagree about the current layer, silently reopening exactly the "two trapped scopes at once"
class of bug `layer-guard.test.tsx`'s CR-02 regression test was written to catch — but only for
whichever call site was missed, so the existing test suite would not necessarily catch a *new*
field being added.
**Fix:** Compute the layer once per render and pass it to both call sites:
```tsx
const currentLayer = topLayer({
  paletteOpen,
  detailOpen: detailItemId !== null,
  pickerOpen: activePicker !== null || deleteTarget !== null || pendingDone !== null,
  quickAddOpen,
});
// ...
function handleContainerKeyDown(event) {
  // ...
  if (!bindingAllowedInLayer(binding.id, currentLayer)) return;
  // ...
}
// ...
onOpenParentPicker={(issue, anchorEl) => {
  if (currentLayer !== "board" && currentLayer !== "quick-add") return;
  // ...
}}
```

### WR-04: No test (Rust or cross-language) guards `FORWARDED_MENU_ACTIONS` / `build_menu`'s item ids / `MenuHandles::get` against drifting apart

**File:** `packages/desktop/src-tauri/src/main.rs:21`, `packages/desktop/src-tauri/src/menu.rs:41-52`, `packages/desktop/src-tauri/src/state.rs:39-47`
**Issue:** The set of four forwarded menu-action ids is hand-maintained in at least three places on
the Rust side alone: `main.rs`'s `FORWARDED_MENU_ACTIONS` const, the literal ids passed to
`MenuItemBuilder::with_id` in `menu.rs::build_menu`, and the match arms in
`MenuHandles::get` (`state.rs`) — plus a fourth hand-kept mirror on the TypeScript side,
`state/keyboard.ts`'s `MENU_ACTION_IDS`, which the file's own doc comments already flag as
"kept in sync by hand across the IPC seam since a Rust const and a TypeScript array cannot share a
single source." `menu-bridge.test.tsx` has a test asserting every `MENU_ACTION_IDS` entry resolves
to a global `BINDINGS` entry, which protects the TS side. There is no equivalent Rust `#[cfg(test)]`
assertion (none exists in `main.rs`, `menu.rs`, or `state.rs`) that `FORWARDED_MENU_ACTIONS`, the ids
built in `build_menu`, and `MenuHandles::get`'s recognized set are the same four strings.

Impact today is low (a mismatch degrades the affordance or silently drops a menu-item's forwarding,
rather than bypassing the guard — the JS-side guard is independent and unaffected), but it is exactly
the class of hand-synced-invariant this phase's own commentary identifies as fragile, and it is
currently unprotected on the Rust side.
**Fix:** Add a unit test in `state.rs` (or a new `menu.rs` `#[cfg(test)]` module) asserting
`FORWARDED_MENU_ACTIONS.iter().all(|id| MenuHandles::<MockRuntime>::get(...).is_some())` — or, more
directly, derive `FORWARDED_MENU_ACTIONS` from a single array shared with `MenuHandles::get`'s match
arms so there is one Rust-side source instead of three.

## Info

### IN-01: `register-project-flow.test.tsx` covers only half of `RegisterProjectFlow.tsx`

**File:** `packages/desktop/src/projects/__tests__/register-project-flow.test.tsx`
**Issue:** Every test in this file exercises `useRegistrationErrorNotice` only. `useRegisterProjectFlow`
itself — the folder-dialog call, the `knownIds` "already registered" dedup snapshot, the
`onRegistered` callback, and the swallowed-error `catch` — has no direct test in this file (or,
apparently, anywhere in the reviewed file set). Given the file name and the module's stated role as
"the ONE registration flow every entry point shares," a reader would reasonably expect this file to
cover the flow itself, not only its error-notice helper.
**Fix:** Add coverage for `useRegisterProjectFlow` directly: a successful registration calling
`onRegistered` with `alreadyRegistered: false`/`true` in each case, and a rejected `mutateAsync` call
leaving `isError`/`error` set without throwing out of `registerProjectFlow()`.

### IN-02: Title is trimmed before validation/storage; body is not

**File:** `packages/desktop/src-tauri/src/commands/issue.rs:74, 120-123`
**Issue:** `issue_create`/`issue_update` trim `title` before validating and storing it
(`title.trim()`, `title.as_deref().map(str::trim)`), but `body` is validated and stored exactly as
received, with no trim. This may be intentional (bodies are markdown-ish free text where leading/
trailing whitespace could matter), but the asymmetry is not documented anywhere in this file, unlike
most other behavioral choices in this module which get an explicit rationale comment.
**Fix:** Either add a one-line comment stating this is deliberate, or trim `body` too for
consistency with `title`.

---

_Reviewed: 2026-09-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
