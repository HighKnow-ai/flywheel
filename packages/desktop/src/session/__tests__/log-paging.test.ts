/**
 * Issue #195: a refetch of a live log keeps the window the tail first resolved to.
 *
 * The tail window used to be re-resolved against the log's current length on every refetch, so while an
 * agent worked the loaded window slid forward by every new line: the oldest loaded rows dropped out of
 * the feed and every other row moved up one, on every event, and the row count stayed at 50, so the
 * follow-the-tail effect (keyed on the count) never scrolled the newest line into view.
 */
import { describe, expect, it } from "vitest";
import { LOG_PAGE_SIZE, LOG_PIN_LIMIT, fetchFirstLogPage, type LogPage } from "../logPaging";

interface Page extends LogPage {
  lines: number[];
  limit: number;
}

function logOf(total: number) {
  const calls: { offset: number; limit: number }[] = [];
  const read = (offset: number, limit: number): Promise<Page> => {
    calls.push({ offset, limit });
    const lines = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => offset + i);
    return Promise.resolve({ offset, limit, total, lines });
  };
  return { read, calls };
}

describe("fetchFirstLogPage", () => {
  it("resolves the tail on the first read", async () => {
    const { read } = logOf(130);
    const page = await fetchFirstLogPage(read, "tail", undefined);
    expect(page.offset).toBe(130 - LOG_PAGE_SIZE);
  });

  it("re-reads the window the tail resolved to, not a newer tail, once the log has grown", async () => {
    const first = await fetchFirstLogPage(logOf(130).read, "tail", undefined);
    const grown = logOf(137);
    const again = await fetchFirstLogPage(grown.read, "tail", first);
    expect(again.offset).toBe(first.offset);
    expect(again.lines[0]).toBe(first.lines[0]);
    expect(grown.calls).toEqual([{ offset: first.offset, limit: LOG_PAGE_SIZE }]);
  });

  it("resolves the tail again once the log has run more than LOG_PIN_LIMIT past the pinned window", async () => {
    const first = await fetchFirstLogPage(logOf(130).read, "tail", undefined);
    const far = 130 + LOG_PIN_LIMIT + 1;
    const again = await fetchFirstLogPage(logOf(far).read, "tail", first);
    expect(again.offset).toBe(far - LOG_PAGE_SIZE);
  });

  it("leaves an explicit window alone", async () => {
    const { read } = logOf(500);
    const page = await fetchFirstLogPage(read, { offset: 100, limit: 50 }, { offset: 450, total: 500 });
    expect(page.offset).toBe(100);
  });
});
