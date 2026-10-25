/**
 * Records what a refetch does to the screen (issue #195): every element removed or added, every frame
 * that went blank, and every layout shift.
 *
 * - Removals and additions come from a `MutationObserver` over the subtree. A refetch whose data did not
 *   change must produce none: an element removed and re-created is a remount, the commonest flicker.
 * - Layout shifts come from `PerformanceObserver('layout-shift')` where the engine has it. WebKit does
 *   not, so the recorder also samples every element's bounding rect once per animation frame and counts
 *   an element whose rect moved since the first frame. That fallback is what catches a count whose
 *   width changes and pushes its neighbours.
 * - A blank frame is a frame in which the subtree's visible text is less than half of the smaller of
 *   what it held at the start and at the end: a list swapped for a loading line, or an empty container
 *   between two renders. Measured against both ends so data that legitimately shrinks is not blank.
 */

export interface FlickerReport {
  removed: string[];
  added: string[];
  /** Elements removed and then added again with the same tag and content: a remount, not a change. */
  recreated: string[];
  /** Attributes that changed on a connected element, as `element [name] before -> after`. A class or
   * `data-*` flag that flips and flips back is a flash (a row's tint, a badge) even with no remount. */
  attributesChanged: string[];
  /** Text nodes whose value changed, as `before -> after`. */
  textChanged: string[];
  blankFrames: number;
  /** Elements whose rect moved, one entry per element, with the first frame it moved in. */
  shifted: string[];
  /** The sum of `layout-shift` entry values, or `null` where the engine has no such entry type. */
  layoutShiftScore: number | null;
  frames: number;
}

export interface FlickerRecorder {
  stop(): Promise<FlickerReport>;
  /** Every element connected at the start, for checking that a node survived by identity. */
  readonly baseline: ReadonlySet<Element>;
}

function describe(node: Node): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    return text ? `#text "${text.slice(0, 60)}"` : null;
  }
  if (!(node instanceof Element)) return null;
  const label = node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 60) ?? "";
  return `<${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}> "${label}"`;
}

function visibleTextLength(root: HTMLElement): number {
  return root.innerText.replace(/\s+/g, "").length;
}

function rectKey(r: DOMRect): string {
  return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
}

export function recordFlicker(root: HTMLElement): FlickerRecorder {
  const removed: string[] = [];
  const added: string[] = [];
  const textChanged: string[] = [];
  const sequence: ["-" | "+", string][] = [];
  const attributesChanged: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const el = record.target as Element;
        const now = el.getAttribute(record.attributeName ?? "");
        if (now !== record.oldValue)
          attributesChanged.push(`${describe(el)} [${record.attributeName}] ${record.oldValue} -> ${now}`);
        continue;
      }
      if (record.type === "characterData") {
        const now = record.target.textContent ?? "";
        if (now !== record.oldValue) textChanged.push(`${record.oldValue ?? ""} -> ${now}`);
        continue;
      }
      for (const node of record.removedNodes) {
        const d = describe(node);
        if (d) {
          removed.push(d);
          sequence.push(["-", d]);
        }
      }
      for (const node of record.addedNodes) {
        const d = describe(node);
        if (d) {
          added.push(d);
          sequence.push(["+", d]);
        }
      }
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
    attributes: true,
    attributeOldValue: true,
  });

  let layoutShiftScore: number | null = null;
  let perf: PerformanceObserver | undefined;
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) {
    layoutShiftScore = 0;
    perf = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        layoutShiftScore = (layoutShiftScore ?? 0) + ((entry as unknown as { value: number }).value ?? 0);
    });
    perf.observe({ type: "layout-shift", buffered: false });
  }

  const elements = Array.from(root.querySelectorAll("*"));
  const baseline = new Set<Element>(elements);
  const startRects = new Map(elements.map((el) => [el, rectKey(el.getBoundingClientRect())]));
  const startText = visibleTextLength(root);
  const shifted = new Map<Element, string>();
  const textPerFrame: number[] = [];
  let frames = 0;
  let running = true;

  const sample = () => {
    if (!running) return;
    frames += 1;
    textPerFrame.push(visibleTextLength(root));
    for (const [el, before] of startRects) {
      if (shifted.has(el) || !el.isConnected) continue;
      const now = rectKey(el.getBoundingClientRect());
      if (now !== before) shifted.set(el, `${describe(el)} ${before} -> ${now} (frame ${frames})`);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  return {
    baseline,
    async stop() {
      // One more frame so the last commit is sampled, then drain the observer.
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      running = false;
      for (const record of observer.takeRecords()) {
        for (const node of record.removedNodes) {
          const d = describe(node);
          if (d) {
            removed.push(d);
            sequence.push(["-", d]);
          }
        }
        for (const node of record.addedNodes) {
          const d = describe(node);
          if (d) {
            added.push(d);
            sequence.push(["+", d]);
          }
        }
      }
      observer.disconnect();
      perf?.disconnect();
      const floor = Math.min(startText, visibleTextLength(root)) / 2;
      const blankFrames = textPerFrame.filter((n) => n < floor).length;
      // In order: an element is re-created when one like it is added AFTER one like it was removed.
      const gone = new Set<string>();
      const recreated: string[] = [];
      for (const [kind, d] of sequence) {
        if (!d.startsWith("<")) continue;
        if (kind === "-") gone.add(d);
        else if (gone.has(d)) recreated.push(d);
      }
      return {
        removed,
        added,
        recreated,
        attributesChanged,
        textChanged,
        blankFrames,
        shifted: [...shifted.values()],
        layoutShiftScore,
        frames,
      };
    },
  };
}
