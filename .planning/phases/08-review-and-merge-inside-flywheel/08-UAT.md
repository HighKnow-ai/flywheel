---
status: testing
phase: 08-review-and-merge-inside-flywheel
source: [08-VERIFICATION.md]
started: 2026-10-07T15:20:00Z
updated: 2026-10-07T15:20:00Z
round: 2
supersedes: "round 1 (6 items, gaps G-08-1/G-08-5/G-08-6) — recoverable at git show f52bd33:.planning/phases/08-review-and-merge-inside-flywheel/08-UAT.md"
---

## Current Test

number: 1
name: m and r reach both confirmations in the real macOS WKWebView
expected: |
  Run `npm --prefix packages/desktop run tauri dev`. Open a task review, press `m`,
  press Enter. Open an epic review, press `r`, press Enter.
  Each sheet opens with its confirm button already focused, and Enter confirms once —
  with no mouse and no Tab.
awaiting: user response

## Tests

### 1. m and r reach both confirmations in the real macOS WKWebView
expected: Each sheet opens with its confirm button focused and Enter confirms once, with no mouse and no Tab
why_human: G-08-6's route is measured in Playwright WebKit, not in the real macOS WKWebView under Tauri. No automation can drive that binary — there is no WebDriver for WKWebView on macOS.
result: [pending]

### 2. A live forge request opens once and reports AlreadyOpen the second time
expected: First call pushes and opens one request; second returns AlreadyOpen with the same request number
command: FLYWHEEL_UAT_GITHUB_REPO=<owner>/flywheel-uat cargo test -p core --test forge_live_github -- --ignored --nocapture
why_human: Carried over from round 1 as still BLOCKED (third-party). It opens a real PR on a real repository with the account owner's credentials, so it is `#[ignore]`d and has never run. Everything else about REVW-05 is proven against a gh/glab stub that is the only substituted component (forge_live_chain.rs).
result: [pending]

### 3. Keyboard route out of a conflicting merge
expected: A keyboard route exists to "Start a session to resolve", "Open in editor" and Close — or the team accepts mouse-only exits on macOS
why_human: WR-05. MergeConfirmSheet focuses only the Merge button, once. After the result renders, that button unmounts and focus falls to the scope container. If WKWebView does not Tab to buttons — the premise 08-15 is built on — those three are mouse-only. Escape still closes.
result: [pending]

### 4. draftChanged is refused before any push or forge call
expected: Rejection is the bare string `draftChanged`; the remote has no new branch or PR; the sheet re-renders the current text
test: Preview an epic request, check a criterion on the board from elsewhere, then confirm. Observe that no `git push` and no `gh pr create` ran and that the sheet shows the new text.
why_human: WR-04, recorded in VERIFICATION.md as behavior_unverified rather than a gap. The comparison lives inside a `#[tauri::command]` taking `State` and `AppHandle`, so no Rust test reaches it, and the renderer tests mock the rejection. The ordering is correct by reading — `forge.rs:401-404` returns before `open_epic_request_at` at 407 — but a refactor moving the check below the push would still pass every current test.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
