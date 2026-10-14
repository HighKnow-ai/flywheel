// Drive and read the INSTALLED Flywheel's web content through the macOS accessibility tree (plan 11-21).
//
// Why this exists: DEFERRED-REVIEW.md carried "no WebDriver for WKWebView" as a physical reason a human was
// needed. WKWebView exposes its DOM to macOS accessibility, so buttons, text and fields of the installed app
// are readable and clickable from System Events. This is not WebDriver, but it is a scripted read and click
// of the packaged app, and it closed items the register had filed as human-only.
//
// Needs: Accessibility permission for the terminal running it. Process name is `desktop` (the bundle's
// executable). Run the app against a scratch HOME so it never touches the owner's database:
//   open -n --env HOME=/tmp/scratch-home /Applications/Flywheel.app
//
//   osascript -l JavaScript ax-drive.js list  <scopeGroupName|-> <AXRole|-> <name|-> [maxDepth] [fanOutCap]
//   osascript -l JavaScript ax-drive.js click <scopeGroupName|-> <AXRole>   <name>   [maxDepth] [fanOutCap]
//
// A name ending in `*` is a prefix match. `scope` is an AXGroup's accessible name ("Projects", "Board",
// "Update available"). The board holds hundreds of rows: pass a small fanOutCap (14) and a scope, or the
// walk takes minutes. A capture of ONLY the app window (works while the window is occluded, so nothing
// else on the screen is recorded) is `screencapture -x -o -l<windowNumber> out.png`; get the window number
// from CGWindowListCopyWindowInfo for the app's pid.
function run(argv) {
  const [action, scope, role, name, md, cp] = argv;
  const maxDepth = Number(md || 8), cap = Number(cp || 400);
  const win = Application("System Events").processes.byName("desktop").windows[0];
  const nm = (e) => { try { return e.name() || ""; } catch (x) { return ""; } };
  const rl = (e) => { try { return e.role(); } catch (x) { return ""; } };
  const kidsOf = (e) => { try { return e.uiElements(); } catch (x) { return []; } };
  let root = win;
  if (scope !== "-") {
    let found = null; const q = [[win, 0]];
    while (q.length && !found) {
      const [e, d] = q.shift();
      if (d > 5) continue;
      for (const k of kidsOf(e).slice(0, 60)) {
        if (nm(k) === scope && rl(k) === "AXGroup") { found = k; break; }
        q.push([k, d + 1]);
      }
    }
    if (!found) return "scope not found: " + scope;
    root = found;
  }
  const q = [[root, 0]]; const hits = [];
  while (q.length) {
    const [e, d] = q.shift();
    const r = rl(e), n = nm(e);
    const roleOk = role === "-" || r === role;
    const nameOk = name === "-" || n === name || (name.endsWith("*") && n.startsWith(name.slice(0, -1)));
    if (roleOk && nameOk) {
      if (action === "click") { e.click(); return "clicked " + r + " " + n; }
      let v = ""; try { v = String(e.value() ?? ""); } catch (x) {}
      hits.push(r + "|" + n + "|" + v);
    }
    if (d < maxDepth) for (const k of kidsOf(e).slice(0, cap)) q.push([k, d + 1]);
  }
  return action === "click" ? "not found " + role + " " + name : hits.join("\n");
}
