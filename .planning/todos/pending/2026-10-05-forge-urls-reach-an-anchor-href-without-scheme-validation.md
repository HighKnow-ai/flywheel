---
created: 2026-10-05T17:07:00.000Z
title: Forge-sourced URLs reach an anchor href without scheme validation
area: desktop
severity: minor
files:
  - packages/desktop/src/item-detail/ForgeSection.tsx:89-93
  - packages/desktop/src/item-detail/ForgeSection.tsx:106-108
source: phase-07 verification, Backlog Candidate 6 (code review IN-01)
---

## Problem

`ForgeSection.tsx` renders the forge-supplied `url` and `ciUrl` straight into `<a href>` with
no scheme validation. Those values originate in `gh pr view --json` / `glab mr view --json`
output, so they cross a trust boundary: external process output entering the renderer.

In practice GitHub and GitLab return `https://` URLs for these fields, which is why both the
code review and the phase verification rated this Info/Low rather than a gap. It blocks no
roadmap success criterion and there is no known path by which an attacker controls these
particular fields today.

It is filed anyway because the reasoning that makes it safe is entirely about what the remote
API *currently* returns, not about anything the application enforces. A `javascript:` or
`data:` URL reaching an `href` inside the Tauri webview is a script-execution primitive, and
the only thing standing between that and the renderer right now is the good behaviour of a
third-party API response. That is a thin guarantee to leave implicit at a trust boundary,
and the fix is a few lines.

## Fix

Validate the scheme before rendering: accept `https:` (and `http:` if local forge instances
need it — self-hosted GitLab makes that plausible), and render the link as inert text when
the scheme is anything else. A small shared helper is preferable to an inline check, since
any future surface that renders a forge-supplied URL will want the same guarantee.

Add a test with a `javascript:` URL asserting no anchor `href` is produced, so the guarantee
is enforced rather than assumed.
