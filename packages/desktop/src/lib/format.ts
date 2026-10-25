/**
 * One vocabulary for numbers and times (DESIGN.md § Feedback, "One vocabulary for ids and numbers"). Every
 * screen formats a time, a duration, money, a token count or a session's name through here, so the same
 * figure reads the same everywhere. A value that is missing or cannot be read is the dash, never `0` or `NaN`.
 *
 * Relative times carry their absolute time in a Tooltip: draw them with `components/RelativeTime.tsx`.
 */

/** The mark for a figure that is missing or cannot be read. */
export const MISSING = "—";

type TimeInput = string | number | Date | null | undefined;

function toMs(at: TimeInput): number | null {
  if (at === null || at === undefined || at === "") return null;
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/** A time relative to `now`: "just now", "3m ago", "2h ago", "3d ago", then the date ("12 Oct"). */
export function formatRelativeTime(at: TimeInput, now: number = Date.now()): string {
  const ms = toMs(at);
  if (ms === null) return MISSING;
  const seconds = Math.floor((now - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(
    undefined,
    sameYear ? { day: "numeric", month: "short" } : { dateStyle: "medium" },
  ).format(new Date(ms));
}

/** The absolute date and time, for the Tooltip behind a relative time. */
export function formatAbsoluteTime(at: TimeInput): string {
  const ms = toMs(at);
  if (ms === null) return MISSING;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A duration in seconds as a clock reading: "<1s", "9s", "1m 05s", "3h 07m", "1d 02h". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return MISSING;
  if (seconds < 1) return "<1s";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${pad(h % 24)}h`;
}

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** US dollars to two decimals: "$1.50", "$1,234.50"; a sliver under half a cent reads "<$0.01". */
export function formatMoney(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return MISSING;
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return MONEY.format(usd);
}

const TOKEN_UNITS = [
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/** A token count to three significant figures: "950", "12.3K", "184K", "1.84M", "3.2B". */
export function formatTokens(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count) || count < 0) return MISSING;
  if (count < 1000) return String(Math.round(count));
  for (let index = TOKEN_UNITS.length - 1; index >= 0; index -= 1) {
    const unit = TOKEN_UNITS[index];
    const scaled = Number((count / unit.at).toPrecision(3));
    const next = TOKEN_UNITS[index - 1];
    // 999_999 rounds to 1000K: it belongs to the next unit up.
    if (next && scaled >= 1000) continue;
    if (!next || count < next.at) return `${scaled}${unit.suffix}`;
  }
  return String(count);
}

/** A session named by its ordinal on its Story: "Session 8". */
export function formatSessionName(ordinal: number | null | undefined): string {
  return ordinal ? `Session ${ordinal}` : "Session";
}
