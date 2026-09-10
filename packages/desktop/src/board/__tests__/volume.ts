/**
 * The only fixture in the desktop suite large enough to leave the virtualizer's mounted window.
 *
 * Two consecutive major UAT gaps in this phase — G-01-2 (`epic-roster.test.tsx`) and G-01-4
 * (`quick-add-focus.test.tsx`) — shared the same root shape: an assumption true at small N and
 * false at volume. Every other fixture in this repo tops out at 13 rows
 * (`epic-roster.test.tsx`), and at that size `BoardView.tsx`'s `useVirtualizer` mounts every row
 * comfortably inside its overscan window, so a "row is not mounted yet" defect is structurally
 * unreachable under test below this volume.
 *
 * `MOUNTABLE_ROW_ESTIMATE` is not a bare literal: it is computed from three named local
 * constants, each mirroring a real value that lives in a different file. If any of those three
 * values changes, this estimate moves with it, and the suite's own self-check
 * (`quick-add-focus.test.tsx`'s `the_volume_fixture_exceeds_what_the_harness_can_mount`) fails
 * the moment `VOLUME_ROW_COUNT`'s margin over the estimate disappears — instead of the suite
 * quietly continuing to pass while no longer reaching the defect.
 */
import type { BoardItem } from "../useBoardQuery";

/** Mirrors `test/setup.ts`'s `HTMLElement.prototype.offsetHeight` stub — the jsdom viewport
 * height `@tanstack/virtual-core` measures the scroll container against. */
const JSDOM_VIEWPORT_HEIGHT = 800;

/** Mirrors `BoardRow.tsx` line 52 — `ROW_HEIGHT`, the one constant row height every row in the
 * rack (headers and items alike) uses. */
const ROW_HEIGHT = 40;

/** Mirrors `BoardView.tsx`'s `useVirtualizer({ overscan: 10 })` call. */
const OVERSCAN = 10;

/** Mirrors `BoardView.tsx`'s `BAND_ORDER` — one header row per status band, always rendered even
 * when that band holds zero items ("Board list" spec), so it always costs a virtual row slot. */
const BAND_HEADER_COUNT = 5;

/** The board's own top-of-Backlog quick-add row — one more fixed row before any item, per
 * `BoardView.tsx`'s `rows` memo ("Quick-add lives at the top of Backlog"). */
const QUICK_ADD_ROW_COUNT = 1;

/**
 * The number of virtual rows the jsdom test harness can mount at once: the rows that fit inside
 * the viewport, plus overscan on both ends. Computed from `JSDOM_VIEWPORT_HEIGHT`, `ROW_HEIGHT`
 * and `OVERSCAN` above — never written as a bare literal — so a change to any of the three moves
 * this estimate rather than silently leaving the fixture's margin unchecked.
 */
export const MOUNTABLE_ROW_ESTIMATE = Math.ceil(JSDOM_VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;

/**
 * The shared fixture size. Must stay comfortably above `MOUNTABLE_ROW_ESTIMATE` — enforced by
 * `quick-add-focus.test.tsx`'s `the_volume_fixture_exceeds_what_the_harness_can_mount`, never
 * trusted from this comment alone.
 */
export const VOLUME_ROW_COUNT = 60;

/** Crockford's base32 alphabet (excludes I, L, O, U) — the same alphabet a real ULID uses. */
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encodes `n` as a fixed 26-character Crockford base32 string. ULID-shaped on purpose: plan
 * 01-19's `no_row_renders_a_raw_internal_identifier_at_volume` (G-01-2) scans rendered text for a
 * 26-character Crockford base32 pattern, and a fixture built from short ids like `"1"`/`"2"`
 * could never match that pattern — the assertion would pass over a fixture that could never
 * produce a real leak. This makes it a real assertion instead.
 */
function toCrockfordBase32(n: number): string {
  let value = n;
  let out = "";
  do {
    out = CROCKFORD_BASE32[value % 32] + out;
    value = Math.floor(value / 32);
  } while (value > 0);
  return out.padStart(26, "0");
}

/**
 * Backlog-status `BoardItem` rows with sequential keys, sequential ranks, and a distinct
 * 26-character Crockford-base32 identifier per row (see `toCrockfordBase32`). Defaults to
 * `VOLUME_ROW_COUNT` so every consumer builds the same shared fixture unless it deliberately
 * asks for a different size.
 */
export function buildVolumeItems(count: number = VOLUME_ROW_COUNT): BoardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: toCrockfordBase32(i + 1),
    key: `FLY-${i + 1}`,
    title: `Backlog task ${i}`,
    status: "backlog",
    rank: String(i + 1).padStart(4, "0"),
    priority: 0,
    epicId: null,
    kind: "task",
  }));
}

/**
 * A conservative estimate of the fixture's total virtualized row count once rendered by
 * `BoardView.tsx`: every band header (`BAND_HEADER_COUNT`), the quick-add row
 * (`QUICK_ADD_ROW_COUNT`), and every item row. Used only to clamp `DEEP_SCROLL_OFFSET` below the
 * fixture's actual scrollable height.
 */
function estimateTotalRowCount(itemCount: number): number {
  return BAND_HEADER_COUNT + QUICK_ADD_ROW_COUNT + itemCount;
}

/** How far past `MOUNTABLE_ROW_ESTIMATE` to scroll before treating a row as "genuinely
 * unmounted" — pure safety margin so this offset does not land right at the boundary. */
const DEEP_SCROLL_SAFETY_MARGIN_ROWS = 10;

/**
 * A scroll offset far past the mounted window: `MOUNTABLE_ROW_ESTIMATE` rows plus a safety
 * margin, converted to pixels by `ROW_HEIGHT` — derived, never hard-coded — then clamped below
 * the fixture's total scrollable height (via `estimateTotalRowCount`) so the virtualizer is
 * never asked to scroll past its own content.
 */
export const DEEP_SCROLL_OFFSET = Math.min(
  (MOUNTABLE_ROW_ESTIMATE + DEEP_SCROLL_SAFETY_MARGIN_ROWS) * ROW_HEIGHT,
  Math.max(0, estimateTotalRowCount(VOLUME_ROW_COUNT) * ROW_HEIGHT - JSDOM_VIEWPORT_HEIGHT),
);

/**
 * Sets `el.scrollTop` and dispatches a real `scroll` `Event` on it, so the virtualizer re-reads
 * the offset. This is the *reader* half of the same jsdom gap `test/setup.ts`'s `scrollTo` stub
 * covers on the writer side: jsdom implements `scrollTop` as a stored property, but does nothing
 * when it changes unless something dispatches the event that says so.
 */
export function scrollBoardTo(container: HTMLElement, offset: number): void {
  container.scrollTop = offset;
  container.dispatchEvent(new Event("scroll"));
}
