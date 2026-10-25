/**
 * An item leaving a list (DESIGN.md § Motion, issue #203): when an answer or a decision takes a card off a list,
 * the card stays drawn in its place, inert, while its height collapses to nothing on the state duration, so the
 * cards under it slide up instead of jumping. Under reduced motion it fades where it stands, then goes.
 *
 * `useLeavingItems` keeps a departed item in the rendered list, at the place it held, until `done` is called for
 * it; `animateLeave` runs the collapse on the element and resolves when it ends. Both lists that use it (Needs you
 * and the triage drawer) move the keyboard to the card now in the departed card's place, skipping `[data-leaving]`.
 */
import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";

export interface Shown<T> {
  item: T;
  key: string;
  /** Off the list: drawn only while it animates out. */
  leaving: boolean;
}

interface Departed<T> {
  item: T;
  key: string;
  index: number;
}

/**
 * The list to draw: `items` in their order, with every item that just left kept at the place it held, marked
 * `leaving`, until `done(key)`. An item that comes back while still leaving is simply in the list again.
 */
export function useLeavingItems<T>(items: readonly T[], keyOf: (item: T) => string): { shown: Shown<T>[]; done: (key: string) => void } {
  const signature = items.map(keyOf).join("\u0000");
  const [previous, setPrevious] = useState<{ signature: string; items: readonly T[] }>({ signature, items });
  const [departed, setDeparted] = useState<Departed<T>[]>([]);

  // Adjusted during render (React's "storing information from previous renders"), so the frame that drops an
  // item from `items` already draws it as leaving: it never blinks out for a frame first.
  let leaving = departed;
  if (previous.signature !== signature) {
    const present = new Set(items.map(keyOf));
    const gone = previous.items.flatMap((item, index) => (present.has(keyOf(item)) ? [] : [{ item, key: keyOf(item), index }]));
    leaving = [...departed.filter((d) => !present.has(d.key) && !gone.some((g) => g.key === d.key)), ...gone];
    setPrevious({ signature, items });
    setDeparted(leaving);
  }

  const shown: Shown<T>[] = items.map((item) => ({ item, key: keyOf(item), leaving: false }));
  for (const d of [...leaving].sort((a, b) => a.index - b.index)) {
    shown.splice(Math.min(d.index, shown.length), 0, { item: d.item, key: d.key, leaving: true });
  }
  return {
    shown,
    done: (key) => setDeparted((was) => was.filter((d) => d.key !== key)),
  };
}

function durationMs(value: string, fallback: number): number {
  const v = value.trim();
  if (v.endsWith("ms")) return parseFloat(v) || fallback;
  if (v.endsWith("s")) return (parseFloat(v) || fallback / 1000) * 1000;
  return fallback;
}

/** Whether the Developer asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Collapse `element` out of its list on `--duration-state` and the one curve: its height, its opacity and the
 * list's gap beside it go to nothing together, clipped while it moves. Under reduced motion only its opacity
 * changes. Resolves once it has run (at once where the engine has no Web Animations, as in jsdom).
 */
export function animateLeave(element: HTMLElement): Promise<void> {
  if (typeof element.animate !== "function") return Promise.resolve();
  const root = getComputedStyle(document.documentElement);
  const duration = durationMs(root.getPropertyValue("--duration-state"), 160);
  const easing = root.getPropertyValue("--ease-out-quint").trim() || "ease-out";
  let keyframes: Keyframe[];
  if (prefersReducedMotion()) {
    keyframes = [{ opacity: 1 }, { opacity: 0 }];
  } else {
    const height = element.getBoundingClientRect().height;
    const parent = element.parentElement;
    const gap = parent ? parseFloat(getComputedStyle(parent).rowGap) || 0 : 0;
    // The gap that would be left behind closes with it: the one after the card, or before the last one.
    const side = element.nextElementSibling ? "marginBottom" : "marginTop";
    const closes = element.nextElementSibling || element.previousElementSibling ? gap : 0;
    keyframes = [
      { height: `${height}px`, opacity: 1, overflow: "hidden", [side]: "0px" },
      { height: "0px", opacity: 0, overflow: "hidden", [side]: `${-closes}px` },
    ];
  }
  const animation = element.animate(keyframes, { duration, easing, fill: "forwards" });
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * A list item that, once `leaving`, is inert and hidden from assistive tech while it collapses, then calls
 * `onLeft`. The live region of its list says what went.
 */
export function LeavingItem({ leaving, onLeft, ...props }: ComponentProps<"li"> & { leaving: boolean; onLeft: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const left = useRef(onLeft);
  left.current = onLeft;
  useLayoutEffect(() => {
    if (!leaving || !ref.current) return;
    let live = true;
    void animateLeave(ref.current).then(() => {
      if (live) left.current();
    });
    return () => {
      live = false;
    };
  }, [leaving]);
  return (
    <li
      ref={ref}
      data-leaving={leaving ? "" : undefined}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      {...props}
    />
  );
}
