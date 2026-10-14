// Builds comps/motion.html: the four motions of 08.1-UI-SPEC.md § Motion, playable, for the D-21
// decision gate (plan 13, Task 3).
//
// The page inlines the REAL packages/desktop/src/styles/{tokens,motion}.css, so the keyframes, the
// easing and the four durations the owner watches are the shipped ones, not a redrawing of them. The
// only script on the page replays an element or moves the selection; every animation is the
// product's own CSS. The speed buttons and the reduced-motion switch only override the custom
// properties, the same lever the product's reduced-motion block uses.
//
//   node .planning/phases/08.1-.../comps/build-motion-comp.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(HERE, "../../../../packages/desktop/src/styles");
const tokens = readFileSync(join(STYLES, "tokens.css"), "utf8");
const motion = readFileSync(join(STYLES, "motion.css"), "utf8");
const dur = (name) => motion.match(new RegExp(`--duration-${name}:\\s*(\\d+)ms;`))?.[1];
const D = { panel: dur("panel"), collapse: dur("collapse"), palette: dur("palette"), select: dur("select") };
if (Object.values(D).some((v) => !v)) throw new Error("motion.css no longer declares the four durations");

// The felt time of the one curve, computed rather than asserted: a front-loaded ease finishes most of
// its travel early, so the number on the label overstates how long a motion feels.
const bezier = (x1, y1, x2, y2) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => { let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (X(m) < x) lo = m; else hi = m; } return Y((lo + hi) / 2); };
};
const ease = bezier(0.16, 1, 0.3, 1);
const reach = (ms, frac) => { for (let x = 0; x <= 1; x += 0.001) if (ease(x) >= frac) return Math.round(x * ms); return ms; };
const felt = (ms) => `90% of the travel by ${reach(ms, 0.9)}ms, 99% by ${reach(ms, 0.99)}ms`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>08.1 motion: the four durations, playable</title>
<style>${tokens}</style>
<style>${motion}</style>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: var(--surface-dominant); color: var(--text-primary-rack); }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0; }
  p { margin: 4px 0; }
  .muted { color: var(--text-muted-rack); }
  .bar { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding: 12px; margin: 16px 0; border: 1px solid var(--divider); background: var(--surface-secondary); }
  button { font: inherit; padding: 4px 10px; border: 1px solid var(--border-control); background: var(--surface-dominant); color: inherit; cursor: pointer; }
  button[aria-pressed="true"] { border-color: var(--accent-nontext); color: var(--accent-text-rack); }
  section { border-top: 1px solid var(--divider); padding: 16px 0; display: grid; grid-template-columns: 360px 1fr; gap: 24px; }
  dl { margin: 8px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  dt { color: var(--text-muted-rack); }
  dd { margin: 0; }
  .stage { position: relative; height: 260px; border: 1px solid var(--divider); overflow: hidden; background: var(--surface-dominant); }
  .row { position: absolute; left: 0; right: 0; height: 32px; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid var(--divider); }
  .row.epic { height: 48px; background: var(--surface-secondary); font-weight: 600; }
  .row.sel { background: var(--row-surface-selected); }
  .sel-row { position: static; transition: background var(--duration-select) var(--ease); }
  .panel { position: absolute; top: 0; right: 0; bottom: 0; width: 220px; padding: 12px; background: var(--surface-secondary); border-left: 1px solid var(--divider); }
  .scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.45); display: flex; justify-content: center; align-items: flex-start; padding-top: 36px; }
  .pal { width: 320px; padding: 10px; background: var(--surface-secondary); border: 1px solid var(--divider); box-shadow: 0 16px 48px rgba(0,0,0,0.5); }
  #stage-group { height: 420px; }
  .live { margin-top: 8px; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<main>
  <h1>The four motions, playable</h1>
  <p class="muted">This page inlines the real <code>motion.css</code> and <code>tokens.css</code>. The animations are the product's own CSS; the buttons only replay them. Press each motion's button a few times, then answer one question: confirm all four, or name a different millisecond value for any of them.</p>
  <div class="bar">
    <span>Speed (all four):</span>
    <span id="speeds"></span>
    <label><input type="checkbox" id="reduce"> Preview reduced motion (the product's reduce block zeroes all four; this page applies the same override)</label>
  </div>

  <section>
    <div>
      <h2>1. Panel slide-in: ${D.panel}ms</h2>
      <dl>
        <dt>Easing</dt><dd>cubic-bezier(0.16, 1, 0.3, 1), the one curve</dd>
        <dt>Technique</dt><dd>transform: translateX(100%) to rest. Width is never animated.</dd>
        <dt>Why this number</dt><dd>A peer surface arriving, not a modal. It travels the furthest (the panel's full 480px) so it gets the longest time.</dd>
        <dt>Felt time</dt><dd>${felt(D.panel)}</dd>
        <dt>Half / double</dt><dd>${D.panel / 2}ms reads as a snap; ${D.panel * 2}ms makes opening a task feel like waiting for a drawer.</dd>
        <dt>Reduced motion</dt><dd>Zero: the panel is simply there.</dd>
      </dl>
      <p><button id="play-panel">Open panel</button></p>
    </div>
    <div class="stage" id="stage-panel"></div>
  </section>

  <section>
    <div>
      <h2>2. Group expand / collapse: ${D.collapse}ms</h2>
      <dl>
        <dt>Easing</dt><dd>the one curve for the rows below; linear per-row share for the wipe</dd>
        <dt>Technique</dt><dd>Rows below travel by transform on the collapse duration. New rows wipe in top-down by clip-path, each an equal share of the duration. Removed rows leave at once. No height, no measurement.</dd>
        <dt>Why this number</dt><dd>Nothing travels far; rows settle. A longer collapse reads as lag.</dd>
        <dt>Half / double</dt><dd>${D.collapse / 2}ms is close to a jump-cut; ${D.collapse * 2}ms and a 20-row group is still unfolding when you reach for the next key.</dd>
        <dt>Felt time</dt><dd>${felt(D.collapse)}. The curve is very front-loaded, so the label overstates how long this feels.</dd>
        <dt>Reduced motion</dt><dd>Zero: rows appear and disappear at once.</dd>
      </dl>
      <p><button id="play-group">Expand</button></p>
    </div>
    <div class="stage" id="stage-group"></div>
  </section>

  <section>
    <div>
      <h2>3. Palette open: ${D.palette}ms</h2>
      <dl>
        <dt>Easing</dt><dd>the one curve</dd>
        <dt>Technique</dt><dd>Full opacity and a full scrim on the first frame, then a transform-only settle of 8px. Never a fade, never a scale.</dd>
        <dt>Why this number</dt><dd>It must feel instant: you pressed a key and are already typing.</dd>
        <dt>The 8px is a judgement</dt><dd>The contract caps the settle at 8px and says plan 13 picks the distance. Plan 09 flagged that cap as its own judgement, not an owner decision. 4px is barely visible; 16px breaks the cap.</dd>
        <dt>Felt time</dt><dd>${felt(D.palette)}</dd>
        <dt>Half / double</dt><dd>${D.palette / 2}ms is a snap with no settle; ${D.palette * 2}ms means the text field is moving while you type into it.</dd>
        <dt>Reduced motion</dt><dd>Zero: the palette is simply there.</dd>
      </dl>
      <p><button id="play-palette">Open palette</button></p>
    </div>
    <div class="stage" id="stage-palette"></div>
  </section>

  <section>
    <div>
      <h2>4. Selection move: ${D.select}ms</h2>
      <dl>
        <dt>Easing</dt><dd>the one curve</dd>
        <dt>Technique</dt><dd>The row wash (background and inset shadow) transitions. Nothing moves.</dd>
        <dt>Why this number</dt><dd>Signals "you moved". Faster is a snap; slower makes holding the arrow key feel sticky.</dd>
        <dt>Felt time</dt><dd>${felt(D.select)}</dd>
        <dt>Half / double</dt><dd>${D.select / 2}ms is a snap; ${D.select * 2}ms leaves a smear behind the cursor at key-repeat speed.</dd>
        <dt>Reduced motion</dt><dd>Zero: the wash changes at once.</dd>
      </dl>
      <p class="muted">Click a row, or focus the list and press the up and down arrows. Hold the key to feel key-repeat.</p>
    </div>
    <div class="stage" id="stage-select" tabindex="0" aria-label="Selection demo"></div>
  </section>

  <p class="live muted" id="readout"></p>
</main>
<script>
  const BASE = ${JSON.stringify(D)};
  const root = document.documentElement;
  let k = 1, reduced = false;
  const apply = () => {
    for (const [name, ms] of Object.entries(BASE)) root.style.setProperty("--duration-" + name, reduced ? "0s" : (ms * k) + "ms");
    document.getElementById("reduced-style")?.remove();
    if (reduced) {
      const s = document.createElement("style"); s.id = "reduced-style";
      s.textContent = "* { animation-duration: 0s !important; transition-duration: 0s !important; }";
      document.head.appendChild(s);
    }
    document.getElementById("readout").textContent = reduced
      ? "Reduced motion previewed: every duration is 0s."
      : "Durations in use: panel " + BASE.panel * k + "ms, collapse " + BASE.collapse * k + "ms, palette " + BASE.palette * k + "ms, select " + BASE.select * k + "ms (speed " + k + "x).";
  };
  const speeds = document.getElementById("speeds");
  for (const f of [0.5, 1, 2]) {
    const b = document.createElement("button"); b.textContent = f + "x"; b.setAttribute("aria-pressed", String(f === 1));
    b.onclick = () => { k = f; for (const o of speeds.children) o.setAttribute("aria-pressed", String(o === b)); apply(); };
    speeds.appendChild(b);
  }
  document.getElementById("reduce").onchange = (e) => { reduced = e.target.checked; apply(); };
  apply();

  // 1. panel
  const sp = document.getElementById("stage-panel");
  sp.innerHTML = '<div class="row epic" style="top:0">Alpha</div><div class="row" style="top:48px">FLY-100 Task 0</div><div class="row" style="top:80px">FLY-101 Task 1</div>';
  document.getElementById("play-panel").onclick = () => {
    sp.querySelector(".panel")?.remove();
    const p = document.createElement("aside"); p.className = "panel panel-slide-in"; p.textContent = "FLY-101 detail";
    sp.appendChild(p);
  };

  // 2. group: a miniature of the rack, rows absolutely positioned by transform, new rows numbered
  const sg = document.getElementById("stage-group");
  let open = false;
  const rowsFor = (o) => [["epic", "Alpha"], ...(o ? Array.from({ length: 6 }, (_, i) => ["task", "FLY-" + (100 + i) + " Task " + i]) : []), ["epic", "Beta"], ["epic", "Gamma"]];
  const render = (entering) => {
    const rows = rowsFor(open); let y = 0;
    const keep = new Set();
    rows.forEach(([kind, label], i) => {
      const key = label; keep.add(key);
      let el = sg.querySelector('[data-k="' + key + '"]');
      const isNew = !el;
      if (isNew) { el = document.createElement("div"); el.dataset.k = key; el.textContent = label; sg.appendChild(el); }
      el.className = "row " + kind + " displace-transition";
      el.style.transform = "translateY(" + y + "px)";
      if (isNew && entering) { const order = entering.indexOf(key); el.classList.add("row-enter"); el.style.setProperty("--enter-i", order); el.style.setProperty("--enter-n", entering.length); }
      y += kind === "epic" ? 48 : 32;
    });
    for (const el of [...sg.children]) if (!keep.has(el.dataset.k)) el.remove();
  };
  render();
  document.getElementById("play-group").onclick = (e) => {
    const before = new Set(rowsFor(open).map((r) => r[1]));
    open = !open;
    render(rowsFor(open).map((r) => r[1]).filter((l) => !before.has(l)));
    e.target.textContent = open ? "Collapse" : "Expand";
  };

  // 3. palette
  const spal = document.getElementById("stage-palette");
  spal.innerHTML = '<div class="row epic" style="top:0">Alpha</div><div class="row" style="top:48px">FLY-100 Task 0</div>';
  document.getElementById("play-palette").onclick = () => {
    spal.querySelector(".scrim")?.remove();
    const s = document.createElement("div"); s.className = "scrim";
    s.innerHTML = '<div class="pal palette-settle"><input placeholder="Type a command..." style="width:100%;padding:6px"><p class="muted">Press the button again to replay.</p></div>';
    s.onclick = () => s.remove();
    spal.appendChild(s);
  };

  // 4. selection
  const ss = document.getElementById("stage-select"); let sel = 1;
  ss.innerHTML = Array.from({ length: 7 }, (_, i) => '<div class="row sel-row" data-i="' + i + '" style="height:32px">FLY-' + (100 + i) + " Task " + i + "</div>").join("");
  const paint = () => ss.querySelectorAll(".sel-row").forEach((r, i) => r.classList.toggle("sel", i === sel));
  paint();
  ss.onclick = (e) => { const r = e.target.closest(".sel-row"); if (r) { sel = Number(r.dataset.i); paint(); } };
  ss.onkeydown = (e) => { if (e.key === "ArrowDown") { sel = Math.min(6, sel + 1); paint(); e.preventDefault(); } if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); } };
</script>
</body>
</html>
`;

const out = join(HERE, "motion.html");
writeFileSync(out, page);
console.log(out);
