# Phase 11 Installed-Build Evidence (plan 11-20)

Recorded 2026-10-14 by the 11-20 executor. Subject: the installed `/Applications/Flywheel.app`
(`CFBundleShortVersionString` `0.1.0`, the `v0.1.0` release installed by plan 11-08). Never a build
directory. Sibling of `11-RELEASE-EVIDENCE.md`, not a replacement for it.

The build is **unsigned and not notarized** (D-REV-60). It was launched through LaunchServices
(`open`) from a copy that carries no quarantine attribute (it was installed by `ditto` from a `curl`
download). That launch raised no dialog. It says **nothing** about what a browser-downloaded,
quarantined copy does, which stays D-REV-62. No `xattr`, `spctl` or `codesign` change was made.

## 1. D-REV-20: what the bundle carries, and what the Dock paints

### Bundle contents, `bash scripts/release/verify-bundle-assets.sh` (exit 0)

```
PASS  Info.plist: CFBundleIconFile=icon.icns is present in Contents/Resources/
PASS  icns hash: installed == src-tauri/icons/icon.icns (f5a8aa464f31629f8b0806b2adb283b56471737fd4d1339aa32d8d5da4c9c98f)
PASS  Info.plist: CFBundleName=Flywheel
PASS  Info.plist: CFBundleIdentifier=com.highknow.flywheel
PASS  bundle member: Contents/MacOS/flywheel-sidecar is executable
PASS  bundle member: Contents/MacOS/flywheel-node is executable
PASS  bundle member: Contents/MacOS/flywheel-shim is executable
PASS  bundle member: Contents/Resources/sidecar/dist/index.js exists
ALL PASS  /Applications/Flywheel.app
```

The installed icon is byte-identical to the tracked source, and the plist references it.

### What the OS paints (screenshots read, not just taken)

The installed application was launched with `open --env HOME=<scratch>` so it used a scratch database,
not the owner's. Screenshots were taken with `screencapture`, an OS-level capture of the real screen.
The full-screen captures also showed an unrelated private browser window behind the app, so they were
**not** kept; each artefact below is a crop of only the Dock strip or only the app's own window.

- **`11-20-dock.png`: the Dock.** The rightmost application icon (the running Flywheel, the one
  launched here) is a blue rounded square carrying a white line drawing of a light bulb with a brain
  inside it: the HighKnow mark. It is not the generic blank-document placeholder and not the Tauri
  scaffold icon. It reads as slightly smaller than its neighbours (it sits inside the squircle with
  visible margin).
- **`11-20-about.png`: the native About panel** (opened through the app menu, `Flywheel > About
  Flywheel`). It shows the same blue squircle with the same bulb-and-brain mark, the name `Flywheel`,
  and `Version 0.1.0 (0.1.0)`.

So the failure this item exists to catch (a generic or scaffold icon despite a correct file in the
bundle) did **not** occur on this machine. Finder's icon for the bundle was not captured.

**D-REV-21 (is the inset margin right beside other icons?)** is an aesthetic judgement and stays routed
to plan 11-21. `11-20-dock.png` is what makes it answerable at one glance: the Flywheel icon is the last
one before the Trash divider, next to Notes and Passwords.

### Unplanned observation: the update banner is drawn (relevant to 11-RELEASE-EVIDENCE section 7, item 1)

With `v0.1.1` published, the installed `0.1.0` window showed, bottom right
(`11-20-update-banner.png`): `Flywheel 0.1.1 is available`, `you have 0.1.0`, the line
`- docs(11-08): record the v0.1.0 release, the unmet Gatekeeper criterion and the fresh-clone build`
(the release body's commit subject), and two buttons, `Install on relaunch` and `Not now`.

This answers question 1 of 11-RELEASE-EVIDENCE section 7 (does a banner appear naming `0.1.1` with the
commit subjects) for a fresh database. It is a screenshot read, not a scripted DOM assertion. **Nothing
was clicked.** Questions 2, 3 and 4 (dismissal, the live-run state, and the install-on-relaunch result)
are still not observed, and criterion 2 (the installed app becomes `0.1.1`) remains unobserved.

## 2. D-REV-22: does dark mode reach the installed app's WKWebView

**Result: yes. With macOS set to Dark the installed `0.1.0` paints the dark token ground; with macOS
set to Light it paints the light one.** Measured on the installed bundle, not a dev build, not a
browser-mode test.

Command: `node scripts/release/verify-appearance.mjs` (exit 0). Output as printed:

```
installed app: /Applications/Flywheel.app
original system appearance: dark=false AppleInterfaceStyle=(absent) SwitchesAutomatically=1
tokens.css --surface-dominant: light=#ffffff dark=#0a0a0a
PASS  AppleInterfaceStyle=Dark  mode=Dark  sampled=#0a0a0a,#0a0a0a,#0a0a0a,#0a0a0a  expected=#0a0a0a  tolerance=+-4/channel  window=1200x800
PASS  AppleInterfaceStyle=(absent)  mode=Light  sampled=#ffffff,#ffffff,#ffffff,#ffffff  expected=#ffffff  tolerance=+-4/channel  window=1200x800
restored system appearance: AppleInterfaceStyle=(absent) (was (absent))
```

How to read it:

- **Expected colours are read from the shipped `packages/desktop/src/styles/tokens.css`** (the first
  `--surface-dominant` is light, the first one after `@media (prefers-color-scheme: dark)` is dark). The
  script contains no hex literal for either ground. The values happened to equal the register's
  `#ffffff` / `#0a0a0a`, but the script did not rely on that.
- **Sampled region:** four points in the left and right margins of the window's content area, at 35-65%
  of the height. That is the full-height `.rack-ground` (`App.css`, `background: var(--surface-dominant)`)
  behind the centred empty state, clear of the title bar, the content column and the update banner. All
  four must match. Dark and Light cannot both pass by accident: the two expected values differ by 245
  per channel against a tolerance of 4.
- **Tolerance:** +-4 of 255 per channel, for display colour management. The sampled values matched
  exactly, so none of the tolerance was used.
- **The capture was read, not only measured.** `11-20-appearance-dark.png` is a visibly dark window
  (near-black ground, light text, the update banner in dark tokens); `11-20-appearance-light.png` is the
  light one. Both are crops of the app window only, taken by `screencapture -R` from the window rectangle.
- **Appearance was changed through System Events (`appearance preferences`), not `defaults write -g
  AppleInterfaceStyle`.** Deviation from the register's wording, deliberate: `defaults write` changes the
  stored value but leaves the menu bar and every running application un-notified, which would have left the
  developer's desktop half-switched. The effect on the stored key is the same and is asserted by the script
  (`AppleInterfaceStyle=Dark` while Dark, absent while Light). The user's `AppleInterfaceStyleSwitchesAutomatically`
  is `1` (auto day/night); it was not touched, and the restore to Light was confirmed afterwards
  (`defaults read -g AppleInterfaceStyle` reports the key absent).
- **What this does and does not establish.** It establishes that the WKWebView follows the OS appearance at
  launch, and that the dark token block is therefore reachable in the shipped app. It does not show a
  *live* switch while the app is running (each appearance was launched fresh), and it measures the ground
  only: the contrast of text and controls in dark remains the job of the contrast tests.
- **No dark-mode bug was found,** so nothing is filed under D-196. The register's recorded fallback
  (a `data-theme` attribute from Tauri's window theme API) is not needed.
- The app ran against a scratch `HOME` per appearance and was quit afterwards; no process survived.
