---
phase: 11-ship-it
plan: 20
subsystem: distribution
tags: [installed-build, icon, dark-mode, wkwebview, d-rev-20, d-rev-22, dist-01]
requires:
  - phase: 11-ship-it
    provides: "11-08: v0.1.0 installed at /Applications/Flywheel.app, v0.1.1 published"
provides:
  - "scripts/release/verify-bundle-assets.sh: installed icns sha256 == source, Info.plist keys, nested executables"
  - "scripts/release/verify-appearance.mjs: system Dark/Light -> installed app's painted ground, compared to tokens.css"
  - ".planning/phases/11-ship-it/11-INSTALLED-EVIDENCE.md and five screenshots (dock, about, update banner, dark, light)"
affects: [11-21]
status: complete
commits: 3
plan_head_before: 4b33a7c778e7a5cef501ddf1e4a72202409a0870
actuals:
  tokens: 4700
  tasks: 2
  commits: 3
key-files:
  created:
    - scripts/release/verify-bundle-assets.sh
    - scripts/release/verify-appearance.mjs
    - .planning/phases/11-ship-it/11-INSTALLED-EVIDENCE.md
    - .planning/phases/11-ship-it/11-20-dock.png
    - .planning/phases/11-ship-it/11-20-about.png
    - .planning/phases/11-ship-it/11-20-update-banner.png
    - .planning/phases/11-ship-it/11-20-appearance-dark.png
    - .planning/phases/11-ship-it/11-20-appearance-light.png
  modified:
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "Appearance is switched through System Events, not `defaults write -g`: the latter leaves the menu bar and running apps un-notified and the developer's desktop half-switched. The stored-key effect is identical and the script asserts it."
  - "Full-screen captures were not committed: they showed a private browser window behind the app. Only crops of the Dock strip and of the app's own window are kept."
  - "The app ran against a scratch HOME every time so the owner's database was never opened."
requirements-completed: []
duration: "about 15 min"
completed: 2026-10-14
---

# Phase 11 Plan 20: Installed icon and dark mode Summary

**The installed `0.1.0` carries the HighKnow icon byte-for-byte and the OS paints it in the Dock and About panel, and with macOS in Dark it paints the `#0a0a0a` token ground (`#ffffff` in Light), measured from an OS capture and compared against `tokens.css` rather than judged.**

## What was measured

- **D-REV-20.** `verify-bundle-assets.sh` exits 0 on `/Applications/Flywheel.app`: `icon.icns` sha256 `f5a8aa46...c98f` equals `src-tauri/icons/icon.icns`; `CFBundleIconFile`, `CFBundleName=Flywheel`, `CFBundleIdentifier=com.highknow.flywheel`; the three nested executables and `sidecar/dist/index.js` present. The Dock and the native About panel were captured and read: both show the blue squircle with the bulb-and-brain mark, not a placeholder. About reads `Version 0.1.0 (0.1.0)`.
- **D-REV-22.** `verify-appearance.mjs` exits 0. Dark: four sampled ground pixels `#0a0a0a`, expected `#0a0a0a`. Light: `#ffffff`, expected `#ffffff`. Tolerance +-4/channel, unused. The expected colours are parsed out of `tokens.css`; the script has no hex literal for them. The system appearance was restored (key absent, as before) and nothing survived the run. **Dark mode does reach the WKWebView; no bug, nothing filed under D-196.**
- **Unplanned, and worth knowing.** The installed `0.1.0` draws the update banner: "Flywheel 0.1.1 is available / you have 0.1.0", the release-body commit subject, `Install on relaunch` / `Not now`. That answers question 1 of 11-RELEASE-EVIDENCE section 7. Nothing was clicked, so dismissal, the live-run count and the install itself (criterion 2) remain unobserved.

## Not claimed

- **Gatekeeper is untouched.** The app launched through LaunchServices from a copy with no quarantine attribute; no dialog appeared. That says nothing about a browser-downloaded copy (D-REV-62 still open), and DIST-01 criterion 1 stays unmet (D-REV-60/62). No `xattr`, `spctl` or `codesign` change. The updater key (`AB3536BDD39983C5`) and Apple notarization are not conflated anywhere.
- **D-REV-21 (is the icon's margin right beside neighbours?) stays open and routed to 11-21.** `11-20-dock.png` makes it a one-glance question: Flywheel is the last icon before the Trash divider. My own reading is only that the icon looks slightly smaller than its neighbours.
- Finder's rendering of the bundle icon was not captured. The appearance test launches each mode fresh; a live switch while the app runs was not tested, and only the ground is measured (text/control contrast stays with the contrast tests).
- `requirements-completed` is empty on purpose: DIST-01's Gatekeeper criterion is unmet.

## Register

`.planning/DEFERRED-REVIEW.md`: D-REV-20 closed (Dock and About observed, Finder icon not captured), D-REV-22 closed, D-REV-61 gained an `update_11-20` note. No new entry, so no new id allocated.

## Deviations from Plan

**1. [Plan conflict] `defaults write -g AppleInterfaceStyle` replaced by System Events.** Same stored value, asserted by the script; avoids leaving the user's desktop half-switched. Not a weaker check.

**2. [Plan conflict] `screencapture` plus a Node BMP reader instead of the `computer-use` skill.** Both are OS-level captures of the real screen; the script is repeatable without an agent. The screenshots were still read by eye.

**3. [Rule 1 - Bug] BMP height sign.** First run of `verify-appearance.mjs` crashed because `sips` writes a top-down BMP (negative height). Fixed with `Math.abs`; re-run passed. Commit `cfc8663`.

**Total deviations:** 2 plan conflicts, 1 auto-fixed bug. **Impact:** none on the conclusions.

## Known Stubs

None.

## Threat Flags

None. T-11-55 mitigated (hash + plist assertions on the installed copy), T-11-56 mitigated (system appearance restored; key confirmed absent afterwards), T-11-57 mitigated (a pixel from the installed app, compared to the shipped CSS).

## Self-Check: PASSED

- Scripts, evidence file and all five PNGs exist on disk.
- Commits `5c75b59`, `cfc8663`, `63a0c0b` present; `git rev-list --count` from `plan_head_before` is 3 before this file.
- `verify-bundle-assets.sh` exit 0, `bash -n` clean, 0 `target/` references; `verify-appearance.mjs` exit 0, 0 hardcoded ground hex; `AppleInterfaceStyle` appears 7 times in the evidence file; the system appearance key is absent after the run.
- Phase 08 UAT screenshots clean.
