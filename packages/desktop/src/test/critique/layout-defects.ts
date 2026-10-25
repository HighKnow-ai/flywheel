/**
 * The layout-defect check (issue #192): what is wrong with a render whatever the design is.
 *
 * Run in a real engine over the page as it stands, it reports four kinds of defect:
 *
 * - `horizontal-overflow`: the page scrolls sideways, or a visible element reaches past the window's left or
 *   right edge without a scroll container clipping it;
 * - `text-overlap`: two lines of text from different text nodes are drawn over each other, in the same layer
 *   (a dialog over the page, a tooltip, a sticky header and a portal are each their own layer, so text under a
 *   modal never counts). This is how the session feed's rows drawn twice (#190) show up;
 * - `rail-height` / `main-height`: the project rail or the main pane does not reach from the window's top to
 *   its bottom (#191);
 * - `page-scroll`: the window itself scrolls, so the rail and the main pane are carried away with it (the cause of
 *   #191: the shell must be exactly the window, with only the main pane's own scroller moving).
 *
 * Every rectangle is the part of an element the user can see: clipped by each ancestor whose overflow is not
 * visible, so text truncated with an ellipsis, a virtualised row scrolled out of its list and a screen-reader-only
 * label never count.
 */

export type LayoutDefectKind = "horizontal-overflow" | "text-overlap" | "rail-height" | "main-height" | "page-scroll";

export interface LayoutDefect {
  kind: LayoutDefectKind;
  /** One line a person can act on. */
  detail: string;
  /** A short description of the element at fault (tag, slot, role, label, classes and text). */
  where: string;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EPS = 1;

const width = (b: Box) => b.right - b.left;
const height = (b: Box) => b.bottom - b.top;

function intersect(a: Box, b: Box): Box {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function empty(b: Box): boolean {
  return width(b) <= EPS || height(b) <= EPS;
}

function boxOf(r: DOMRect): Box {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

const styleCache = new Map<Element, CSSStyleDeclaration>();
function styleOf(el: Element): CSSStyleDeclaration {
  let s = styleCache.get(el);
  if (!s) {
    s = getComputedStyle(el);
    styleCache.set(el, s);
  }
  return s;
}

function visible(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o: Record<string, boolean>) => boolean }).checkVisibility;
  if (check) return check.call(el, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  for (let e: Element | null = el; e; e = e.parentElement) {
    const s = styleOf(e);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
  }
  return true;
}

function clips(s: CSSStyleDeclaration): { x: boolean; y: boolean } {
  const paint = /paint|strict|content/.test(s.contain);
  return { x: paint || s.overflowX !== "visible", y: paint || s.overflowY !== "visible" };
}

/**
 * The part of `box` (painted by `el` or its text) left visible by the clipping ancestors, from `el` itself up.
 * A fixed ancestor ends the walk: what it holds is clipped by the window only.
 */
function clipped(el: Element, box: Box, includeSelf: boolean): Box {
  let out = box;
  for (
    let e: Element | null = includeSelf ? el : el.parentElement;
    e && e !== document.documentElement;
    e = e.parentElement
  ) {
    // The shell is exactly the window and clips (issue #191): content it cuts off at the window's edge is still
    // past the edge, so it is measured against the window, not hidden by the shell.
    if (e.id === "app-root") break;
    const s = styleOf(e);
    const c = clips(s);
    if (c.x || c.y) {
      const r = boxOf(e.getBoundingClientRect());
      out = intersect(out, {
        left: c.x ? r.left : -Infinity,
        right: c.x ? r.right : Infinity,
        top: c.y ? r.top : -Infinity,
        bottom: c.y ? r.bottom : Infinity,
      });
      if (empty(out)) return out;
    }
    if (s.position === "fixed") break;
  }
  return out;
}

/** The layer a piece of text is painted in: its nearest fixed, sticky or portalled (dialog, popper) ancestor. */
function layerOf(el: Element): Element {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e === document.body) return e;
    const s = styleOf(e);
    if (s.position === "fixed" || s.position === "sticky") return e;
    if (e.hasAttribute("data-radix-popper-content-wrapper")) return e;
    const role = e.getAttribute("role");
    if (role === "dialog" || role === "alertdialog" || role === "tooltip") return e;
  }
  return document.body;
}

function textSnippet(el: Element): string {
  const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/** A short, stable description of an element: enough to find it in the source. */
export function describeElement(el: Element): string {
  const parts = [el.tagName.toLowerCase()];
  const slot = el.getAttribute("data-slot");
  if (slot) parts.push(`[data-slot=${slot}]`);
  const role = el.getAttribute("role");
  if (role) parts.push(`[role=${role}]`);
  const label = el.getAttribute("aria-label");
  if (label) parts.push(`[aria-label="${label.slice(0, 50)}"]`);
  const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
  if (cls) parts.push(`.${cls}`);
  const text = textSnippet(el);
  if (text) parts.push(`“${text}”`);
  return parts.join("");
}

function horizontalOverflow(defects: LayoutDefect[]) {
  const vw = window.innerWidth;
  const root = document.scrollingElement ?? document.documentElement;
  if (root.scrollWidth > vw + EPS) {
    defects.push({
      kind: "horizontal-overflow",
      detail: `the page scrolls sideways: ${root.scrollWidth}px wide in a ${vw}px window`,
      where: "document",
    });
  }
  const reported: Element[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (el instanceof HTMLScriptElement || el instanceof HTMLStyleElement) continue;
    if (reported.some((r) => r.contains(el))) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= EPS || rect.height <= EPS) continue;
    if (rect.right <= vw + EPS && rect.left >= -EPS) continue;
    if (!visible(el)) continue;
    const seen = clipped(el, boxOf(rect), false);
    if (empty(seen)) continue;
    if (seen.right > vw + EPS || seen.left < -EPS) {
      reported.push(el);
      const past =
        seen.right > vw + EPS
          ? `${Math.round(seen.right - vw)}px past the right edge`
          : `${Math.round(-seen.left)}px past the left edge`;
      defects.push({ kind: "horizontal-overflow", detail: `${past} of a ${vw}px window`, where: describeElement(el) });
    }
  }
}

interface TextLine extends Box {
  node: Text;
  owner: Element;
  layer: Element;
}

function textLines(): TextLine[] {
  const lines: TextLine[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\S/.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const owner = n.parentElement;
    if (!owner || owner instanceof HTMLScriptElement || owner instanceof HTMLStyleElement || owner.closest("svg"))
      continue;
    if (!visible(owner)) continue;
    range.selectNodeContents(n);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > EPS && r.height > EPS);
    if (rects.length === 0) continue;
    const layer = layerOf(owner);
    for (const r of rects) {
      const seen = intersect(clipped(owner, boxOf(r), true), { left: 0, top: 0, right: vw, bottom: vh });
      if (empty(seen)) continue;
      // Measure the overlap on the glyphs' own box, but only where the user can see it.
      lines.push({ ...seen, node: n, owner, layer });
    }
  }
  return lines;
}

function textOverlap(defects: LayoutDefect[]) {
  const lines = textLines().sort((a, b) => a.top - b.top);
  const pairs = new Set<string>();
  const ids = new Map<Node, number>();
  const idOf = (n: Node) => {
    if (!ids.has(n)) ids.set(n, ids.size);
    return ids.get(n) as number;
  };
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length && lines[j].top < a.bottom; j++) {
      const b = lines[j];
      if (a.node === b.node || a.layer !== b.layer) continue;
      const o = intersect(a, b);
      if (empty(o)) continue;
      // Two lines touching at their ascender and descender boxes are not an overlap; a third of a line is.
      const minH = Math.min(height(a), height(b));
      const minW = Math.min(width(a), width(b));
      if (height(o) < Math.max(3, minH * 0.35) || width(o) < Math.max(3, Math.min(minW * 0.2, 12))) continue;
      const key = [idOf(a.node), idOf(b.node)].sort().join(":");
      if (pairs.has(key)) continue;
      pairs.add(key);
      defects.push({
        kind: "text-overlap",
        detail: `“${(a.node.nodeValue ?? "").trim().slice(0, 40)}” and “${(b.node.nodeValue ?? "").trim().slice(0, 40)}” overlap by ${Math.round(width(o))}×${Math.round(height(o))}px`,
        where: `${describeElement(a.owner)} ⟷ ${describeElement(b.owner)}`,
      });
    }
  }
}

function fillsHeight(defects: LayoutDefect[], kind: "rail-height" | "main-height", el: Element | null, name: string) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.top > EPS || r.bottom < vh - EPS) {
    defects.push({
      kind,
      detail: `${name} spans ${Math.round(r.top)}px to ${Math.round(r.bottom)}px of a ${vh}px window`,
      where: describeElement(el).slice(0, 120),
    });
  }
}

/** Every layout defect in the page as it is rendered now. */
export function findLayoutDefects(): LayoutDefect[] {
  styleCache.clear();
  const defects: LayoutDefect[] = [];
  const root = document.scrollingElement ?? document.documentElement;
  if (root.scrollHeight > window.innerHeight + EPS) {
    defects.push({
      kind: "page-scroll",
      detail: `the window scrolls: ${root.scrollHeight}px tall in a ${window.innerHeight}px window`,
      where: "document",
    });
  }
  horizontalOverflow(defects);
  textOverlap(defects);
  const appRoot = document.getElementById("app-root");
  fillsHeight(defects, "rail-height", appRoot?.querySelector('[data-slot="sidebar"]') ?? null, "the project rail");
  // The main pane is the column beside the rail: the andon strip and the surface under it (shadcn's SidebarInset).
  fillsHeight(defects, "main-height", appRoot?.querySelector('[data-slot="sidebar-inset"]') ?? null, "the main pane");
  styleCache.clear();
  return defects;
}
