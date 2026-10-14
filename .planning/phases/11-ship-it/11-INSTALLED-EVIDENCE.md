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
