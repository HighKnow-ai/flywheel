---
phase: 08-review-and-merge-inside-flywheel
reviewed: 2026-10-07T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - packages/core/Cargo.toml
  - packages/core/src/forge/request_body.rs
  - packages/core/tests/epic_request_draft.rs
  - packages/desktop/src-tauri/src/commands/forge.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/board/__tests__/layer-guard.test.tsx
  - packages/desktop/src/item-detail/__tests__/forge-section.test.tsx
  - packages/desktop/src/review/EpicRequestSheet.tsx
  - packages/desktop/src/review/MergeConfirmSheet.tsx
  - packages/desktop/src/review/ReviewSurface.tsx
  - packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx
  - packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx
  - packages/desktop/src/review/__tests__/browser/review-fixture.ts
  - packages/desktop/src/review/__tests__/epic-request.test.tsx
  - packages/desktop/src/review/__tests__/keyboard-activation.test.tsx
  - packages/desktop/src/review/review.css
  - packages/desktop/src/state/keyboard.ts
  - Cargo.lock
findings:
  critical: 0
  warning: 6
  info: 4
  total: 10
status: issues_found
---

# Phase 8: Code Review Report (gap-closure round: plans 08-13, 08-14, 08-15)

**Reviewed:** 2026-10-07
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

This is an incremental review of the gap-closure work only (commits aa6280c..00c8d7c: G-08-1, G-08-5, G-08-6). It supplements the earlier phase 08 review and does not replace it.

## Summary

No blocker was found. The core claims of the three plans hold up under tracing:

- **08-14 (content hash).** The renderer cannot influence published text. The `contentHash` argument is compared against a hash of a draft the core assembled itself, and that same `draft` object is what `open_epic_request_at` publishes. So the hash can only cause a refusal. The `draftChanged` path returns a bare category. The digests go only to `eprintln!`. No git output or path crosses IPC: every other error in this command goes through `ipc_error` (`failed:<context>`) or `forge_error_code`.
- **08-13 (CSS).** `grep` finds no `prefers-color-scheme` or `[data-theme]` in any stylesheet. The only hits are inside the legibility test, which asserts their absence. The edit-span change is confined to `review.css`.
- **08-15 (focus).** Traced by hand: the epic sheet's focus effect does refocus the remounted Open request button after a `draftChanged` refusal. The sequence is `opening` true, so `primaryKey` is `null` and `focusedKeyRef` resets. Then `opening` false, so the key is `"confirm"` and the new button mounts and takes focus. The missing test is a coverage gap, not a defect.

One of the 08-15 SUMMARY's claims is false as stated: `m` can swallow a keystroke while doing nothing (WR-01). The remaining findings are robustness and consistency problems.

## Warnings

### WR-01: `m` is `preventDefault`ed in epic scope and whenever Merge is not offered, contradicting the "cannot swallow a keystroke" invariant

**File:** `packages/desktop/src/review/ReviewSurface.tsx:240-256`
**Issue:** `useRegionBindings` calls `event.preventDefault()` for any key whose id has an entry in the handler map (`keyboard.ts:788-791`). `EpicRequestBar` honours this by passing `{}` when the action is unavailable (`EpicRequestSheet.tsx:83`), so `r` is correct. `ReviewSurface` does not. It always puts `"open-merge"` in the map, and the handler body checks `mergeOffered` only after the keystroke has already been cancelled. In epic scope, with an integrated task, or with a refused or loading precheck, `m` is cancelled and nothing happens. The browser tests "m does nothing when the precheck refuses" and "m is inert in epic scope" assert only that no dialog opened, so they cannot see this. The same pattern already exists for `c`, `j`, `k` and Enter/Space (pre-existing). Practical harm today is small, because `isTypingTarget` covers input and textarea. It would matter as soon as a `<select>` or `role=combobox` is on this surface. The 08-15 summary's "cannot swallow" claim is nonetheless wrong for `m`, and the two new bindings are inconsistent with each other.
**Fix:** Add the entry only when it can act, as `EpicRequestBar` does:
```tsx
useRegionBindings("review-surface", "review-surface", {
  // ...existing handlers...
  ...(mergeOffered && !sheetOpen ? { "open-merge": () => setMergeOpen(true) } : {}),
});
```
Add a test that dispatches `keydown` `m` on a cancelable event in epic scope and asserts `defaultPrevented === false`. `userEvent.keyboard` cannot observe this.

### WR-02: A `draftChanged` refusal whose refetch returns the same hash gives the user no feedback at all

**File:** `packages/desktop/src/review/EpicRequestSheet.tsx:249-257, 265`
**Issue:** `draftMoved` is `draft.contentHash !== refusedHash`. If the core refuses but the refetched draft hashes the same as the one just refused, the notice never appears. The hash covers ancestry-dependent "integrated" markers (`finish_epic_request_draft` runs git per task), so a transient or flip-flopping git answer is enough to cause this. `opening` returns to false, the sheet looks unchanged, and the click appears to have done nothing. The next click may or may not succeed. Nothing tells the user a refusal happened.
Conversely, once `draftMoved` is true it never clears while the sheet is open. It stays visible after the user has read the new text, and across later unrelated refreshes, until `refusedHash` is overwritten by another refusal.
**Fix:** Track the refusal as an explicit state, not a derived comparison. For example, set `notice: "changed" | "unchanged"` on refusal. Clear it on the next confirm attempt or after the refetch settles. Show "The board changed..." or "Nothing in the text changed. Try again." accordingly. Keep `refusedHash` only if it is still needed for the comparison.

### WR-03: The content hash excludes the head and target branches, yet the sheet header presents them as part of what will be published

**File:** `packages/core/src/forge/request_body.rs:31-52` (consumed at `packages/desktop/src-tauri/src/commands/forge.rs:401`)
**Issue:** The digest is over `title` and `body` only, a decision the doc comment states. The sheet header reads `Open request ${headBranch} → ${targetBranch}` (`EpicRequestSheet.tsx:311`) and the confirm button's footer says "opens the request with exactly this text". `target_branch` comes from `projects.default_branch` (`epic_draft_inputs`). If that value is edited between preview and confirm, the confirm is not refused. The request is then opened against a target the user did not see, and G-08-5's "what you saw is what you sent" is broken for that field. The window is small, but the whole point of 08-14 is to close this class.
**Fix:** Either include both branches in the digest, with the same unambiguous framing as the title and body, or state in the doc comment and the sheet that branches are re-resolved at send time. Including them is one extra `hasher.update` pair per branch, and the existing tests keep working.

### WR-04: The `draftChanged` refusal itself has no test below the renderer mock

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:397-405`; `packages/core/tests/epic_request_draft.rs:226-277`
**Issue:** The new core tests cover `content_hash` as a pure function. The renderer tests mock the rejection with `new Error("draftChanged")`. Nothing exercises the actual guard: "re-assemble, hash, compare, return `draftChanged` before any push, with no CLI output in the string". That one comparison is the security-relevant behaviour of 08-14. It lives only inside a `#[tauri::command]` that needs `State` and `AppHandle`, so it is untestable as written. A refactor that moved the check after `open_epic_request_at` would pass every current test.
**Fix:** Extract a core function, for example `fn require_unchanged(draft: &RequestDraft, previewed: &str) -> Result<(), DraftChanged>`. Test that a mismatch is an error and that a match is `Ok`. Better, test that `open_epic_request_at` is never reached on mismatch, by making the helper own the call order. The command then only maps `DraftChanged` to the bare string.

### WR-05: Merge sheet's result state is still keyboard-unreachable on WKWebView (inconsistent with the epic sheet)

**File:** `packages/desktop/src/review/MergeConfirmSheet.tsx:180-185, 347-355`
**Issue:** The 08-15 premise is that WKWebView never tab-focuses buttons. The epic sheet therefore focuses its primary button in every state, including Close once there is a result (`primaryKey === "close"`). The merge sheet focuses only the Merge button, once, and `focusedRef` is never reset. When the result renders, the Merge button unmounts and focus falls to the focus scope container. Close, "Start a session to resolve" and "Open in editor" then have no keyboard route, apart from Escape, which closes the sheet. After a conflict, the two exits the sheet advertises are mouse-only on macOS, which is the exact defect G-08-6 set out to remove.
**Fix:** Mirror the epic sheet. Use a `primaryRef` and a keyed effect where the key is `confirm` before a result, then `exit` when the result is a conflict (focusing "Start a session to resolve"), and `close` otherwise. Reset the focused key when it becomes `null`.

### WR-06: Task-scope `forge_open_request` has the same stale-preview gap, and its doc still claims it cannot happen

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:204-210, 164-186, 231`
**Issue:** The comment says the "published text is the previewed text by construction (T-07-09-01)". That is the claim 08-14 just showed false for epics, because re-assembly can differ from the preview after a board change. `RequestDraftDto::from` now computes and ships a `content_hash` for the task preview as well ("unused there yet"), but `forge_open_request` does not accept or check one. The task path publishes to the same possibly-public forge. The DTO field now suggests the guard exists. This predates the gap-closure round, but the new hash makes the asymmetry misleading.
**Fix:** Either thread `content_hash` through `forge_open_request` and `ForgeSection.tsx` in the same way, or correct the comment to say the guarantee holds only for an unchanged board, and track the task path as an open gap.

## Info

### IN-01: Renderer-supplied `content_hash` and `epic_id` are written to the host log unvalidated

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:403`
**Issue:** `content_hash` is an arbitrary renderer-controlled string. It is logged verbatim, so a value with newlines can forge log lines, and a very large value is written in full. It is cheap to reject the malformed case before doing any git work.
**Fix:** Early in the command, if `content_hash.len() != 64` or it contains a non-hex character, return `draftChanged` without logging the raw value.

### IN-02: `keyMatches` ignores `ctrlKey` and `altKey`, so Ctrl+R and Ctrl+M open the confirmation sheets

**File:** `packages/desktop/src/state/keyboard.ts:327-335`
**Issue:** Only `metaKey` and `shiftKey` are compared. On non-macOS builds, Ctrl+R (reload) and Ctrl+M match the new `r` and `m` bindings and are cancelled. The effect is only to open a confirm sheet, not to act, but it is a behaviour change introduced by making bare letters publish-adjacent. Pre-existing for every other letter binding.
**Fix:** Add `Boolean(binding.ctrl) === event.ctrlKey` and the same for `alt`, or reject any event with `ctrlKey || altKey` when `binding.meta` is not set.

### IN-03: The newline separator makes the title/body digest unambiguous only if titles cannot contain a newline

**File:** `packages/core/src/forge/request_body.rs:36-47`
**Issue:** The doc comment says the separator "makes the pair unambiguous". It does not if an epic title may contain `\n`. Title `a\nb` with body `c` and title `a` with body `b\nc` hash identically. The body always starts with `key: title`, so a real edit would still move the hash and this is not exploitable. The claim and the test name overstate it.
**Fix:** Hash a length prefix instead of a separator (`hasher.update((title.len() as u64).to_be_bytes())`), or soften the comment.

### IN-04: Sheet-open `r` is not gated by `sheetOpen`, and `noForgeConfigured` can strand `requestOpen`

**File:** `packages/desktop/src/review/EpicRequestSheet.tsx:81-83, 234`
**Issue:** `EpicRequestBar`'s `offered` ignores whether the sheet is already open, unlike `mergeOffered`, which includes `!mergeOpen`. While the sheet is open, `r` is cancelled and `onOpen` is a no-op. This is harmless but inconsistent. Separately, `if (blocker === "noForgeConfigured") return null` unmounts the sheet without calling `onClose`. If the blocker appears while the sheet is open, the parent's `requestOpen` stays true. That leaves `sheetOpen` true, so j/k and the Escape-to-go-back handler are disabled with nothing on screen. This needs a mid-session forge change to trigger, so it is unlikely.
**Fix:** Call `onClose()` from an effect when the blocker becomes `noForgeConfigured`, and pass `requestOpen` into the bar so the binding map is empty while the sheet is open.

---

## Verified clean (no finding)

- **Epic sheet refocus after `draftChanged`:** works by trace (see Summary). A regression test would still be worthwhile: reject once, refetch, assert `document.activeElement` is the new Open request button.
- **`useRegionBindings` / `EpicRequestBar`:** `r` passes an empty map when unavailable, so it is unclaimed (the `m` half is WR-01). The `bindingAllowedInLayer` allow-lists and the new layer-guard test are correct, and the palette exclusion matches the existing dead-entry pattern.
- **CSS (G-08-1):** edit background is `transparent` and the mark is an inset 2px bottom shadow. Specificity is three classes against react-diff-view's two. No second palette or theme switch was introduced.
- **Cargo:** `sha2 = "0.10"` resolves to the already-present `0.10.9`. `Cargo.lock` gained one dependency edge and no new package.

---

_Reviewed: 2026-10-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
