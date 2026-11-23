# Changelog

Every release of Flywheel, newest first. A release is the tag `vX.Y.Z`, and its release page
carries its section here. Entries are written in the change that makes them, in words a Flywheel
user would recognise. Releases up to v0.1.2 are described on their release pages only.

## Unreleased

- Merge now lands a Story by pull request by default. Each project has a landing mode: a pull
  request on GitHub or a merge request on GitLab, a landing command that you name, or the local
  merge for a project with no forge. The old local merge left a commit that a repository with
  pull requests only could not take. A Story shows a Landing state and a Landing panel with a
  "Check now" button. Flywheel also polls the request and marks the Story merged when the forge
  merges it. Merge keeps the same refusals in every mode.
- You can send a note to a running Story session. The Story view shows each note as Sent,
  Delivered or Not delivered. The agent receives the note at its next turn boundary, never in the
  middle of a tool call.
- The board's top bar has a Quick Story button. One text field writes a Story in the project's
  "Quick Stories" Epic and starts it.
- A project can list untracked files in `.flywheel/worktree-include`. A new Story worktree gets a
  copy of each plain line, or a link for each `link: path` line. Use this for `.env` or
  `node_modules`. When a failed Check looks like a missing install, the review card shows a
  "Dependencies missing" line.
- You can rename a project from its menu in the rail.
- A project can declare a sandbox policy in the `sandbox` block of its `.claude/settings.json`.
  Flywheel then starts every session of that project under the policy, with a strict network
  allowlist and only its own MCP server. Flywheel refuses a session that does not start with the
  sandbox on. A project with no policy starts as before.
- An app opened from the Finder now gives the agent the same `CLAUDE_CONFIG_DIR` as your login
  shell. Before, the agent could read a different and expired Claude login than the one in your
  terminal. Flywheel ignores a value that is not an absolute path.
- Flywheel no longer depends on `chrono` and `chrono-tz`, which RustSec marks as unmaintained.
  It now uses `jiff`. Stored timestamps keep the same text format. The lockfile also takes `url`
  2.5.9, which fixes RUSTSEC-2026-0592 (unbounded recursion on nested `blob:` URLs). You can
  check both with `cargo deny check`.

## 0.2.0 — 2026-11-06

- Each file attached to a release now carries a GitHub artifact attestation, and the release
  carries a CycloneDX SBOM listing what the app is built from. To check that a download came from
  this repository's release workflow, run
  `gh attestation verify <file> --repo HighKnow-ai/flywheel`. The README's "Verifying a download"
  section has the details.
- The Roadmap and a Story's Acceptance criteria no longer jump when a slow first load finishes.
  Their rows used to appear below the loading placeholder and move up when it left.

## 0.1.3 — 2026-10-29

- If you installed 0.1.1, download this release by hand. 0.1.1 looks for updates in a file that
  releases no longer publish, so it will not offer this one.
- A panel whose data arrives just as its loading placeholder is due no longer flashes: it used to
  draw, vanish behind the placeholder and draw again, replaying its entrance and losing keyboard
  focus. And a loading placeholder, once shown, now gives way after 350 ms instead of 400.
