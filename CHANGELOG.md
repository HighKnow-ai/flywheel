# Changelog

Every release of Flywheel, newest first. A release is the tag `vX.Y.Z`, and its release page
carries its section here. Entries are written in the change that makes them, in words a Flywheel
user would recognise. Releases up to v0.1.2 are described on their release pages only.

## Unreleased

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
