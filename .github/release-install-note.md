## Opening Flywheel for the first time (this build is not signed)

Flywheel is not signed with an Apple Developer ID and is not notarized, so macOS blocks the app the first time you open it.

If you downloaded the `.dmg` in a browser, macOS says that **"Flywheel.app is damaged and can't be opened"** and offers only **Move to Trash** and **Cancel**. The app is not damaged. There is no Open button, so right-click and Open does not help.

To open it:

1. Drag `Flywheel.app` from the `.dmg` into `/Applications`.
2. In Terminal, remove the quarantine mark that your browser put on the download:

   ```bash
   xattr -cr /Applications/Flywheel.app
   ```

3. Open Flywheel as usual.

Only do this for a build you downloaded from this repository's releases page. The command removes a macOS safety check for that one app.

This was observed on one Mac (macOS 26). Other macOS versions may word the dialog differently.
