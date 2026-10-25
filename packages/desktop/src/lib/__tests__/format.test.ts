import { describe, expect, it } from "vitest";
import {
  MISSING,
  formatAbsoluteTime,
  formatDuration,
  formatMoney,
  formatRelativeTime,
  formatSessionName,
  formatTokens,
} from "../format";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("formatRelativeTime", () => {
  it("reads just now, then minutes, hours and days ago", () => {
    expect(formatRelativeTime(ago(10), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(3 * 60), NOW)).toBe("3m ago");
    expect(formatRelativeTime(ago(2 * 3600 + 120), NOW)).toBe("2h ago");
    expect(formatRelativeTime(ago(3 * 86400), NOW)).toBe("3d ago");
  });

  it("falls back to the date after a week, and a future time reads just now", () => {
    expect(formatRelativeTime(ago(30 * 86400), NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(NOW - 30 * 86400_000)),
    );
    expect(formatRelativeTime(ago(-60), NOW)).toBe("just now");
  });

  it("accepts a Date or epoch milliseconds, and an unreadable time is the dash", () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000), NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(undefined, NOW)).toBe(MISSING);
    expect(formatRelativeTime("not a time", NOW)).toBe(MISSING);
  });
});

describe("formatAbsoluteTime", () => {
  it("is the date and the time, for the tooltip behind a relative time", () => {
    const at = ago(0);
    expect(formatAbsoluteTime(at)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at)),
    );
    expect(formatAbsoluteTime(null)).toBe(MISSING);
  });
});

describe("formatDuration", () => {
  it("reads as a clock with padded minor units: 3h 07m, 1m 05s, 9s", () => {
    expect(formatDuration(3 * 3600 + 7 * 60 + 12)).toBe("3h 07m");
    expect(formatDuration(65)).toBe("1m 05s");
    expect(formatDuration(9.6)).toBe("9s");
    expect(formatDuration(0.2)).toBe("<1s");
    expect(formatDuration(26 * 3600 + 5 * 60)).toBe("1d 02h");
    expect(formatDuration(-1)).toBe(MISSING);
    expect(formatDuration(undefined)).toBe(MISSING);
  });
});

describe("formatMoney", () => {
  it("is dollars to two decimals, a sliver under a cent says so, and a missing figure is the dash", () => {
    expect(formatMoney(1.5)).toBe("$1.50");
    expect(formatMoney(12.345)).toBe("$12.35");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(0.0004)).toBe("<$0.01");
    expect(formatMoney(null)).toBe(MISSING);
  });
});

describe("formatTokens", () => {
  it("is three significant figures with K, M and B: 1.84M", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1840)).toBe("1.84K");
    expect(formatTokens(12_300)).toBe("12.3K");
    expect(formatTokens(184_000)).toBe("184K");
    expect(formatTokens(1_840_000)).toBe("1.84M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(999_999)).toBe("1M");
    expect(formatTokens(3_200_000_000)).toBe("3.2B");
    expect(formatTokens(undefined)).toBe(MISSING);
  });
});

describe("formatSessionName", () => {
  it("names a session by its ordinal on its Story", () => {
    expect(formatSessionName(8)).toBe("Session 8");
    expect(formatSessionName(null)).toBe("Session");
  });
});
