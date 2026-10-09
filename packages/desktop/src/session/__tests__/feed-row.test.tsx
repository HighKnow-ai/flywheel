/**
 * Behavior under test (G-02-3, Task 2): a collapsed body row (`assistant_text`, `system_notice`,
 * `raw`) clips to one line with an ellipsis rather than reflowing the surface; a row whose content
 * exceeds `FEED_ROW_TRUNCATION_THRESHOLD` offers a disclosure control that reveals the full text in
 * place; a short row offers no control at all; and `feedRowEstimateSize` never varies with content
 * length — only with row kind and expand state — which is the fixed-size virtualization contract
 * 02-UI-SPEC.md's "Performance Contract Additions" requires.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  FeedRow,
  FEED_ROW_HEIGHT,
  FEED_ROW_TRUNCATION_THRESHOLD,
  FEED_TOOL_ROW_EXPANDED_HEIGHT,
  feedRowEstimateSize,
  isRowExpandable,
  type FeedRowData,
} from "../FeedRow";

// The widen call goes through the single adapter module; the verdict is whatever it resolves.
const widenFileSetMock = vi.fn();
vi.mock("../../adapters/tauri", () => ({
  widenFileSet: (taskId: string, entry: string) => widenFileSetMock(taskId, entry),
}));

function longText(markerNearEnd = false): string {
  const filler = "a".repeat(FEED_ROW_TRUNCATION_THRESHOLD + 50);
  return markerNearEnd ? `${filler}END-MARKER` : filler;
}

describe("FeedRow collapsed body rows clip to one line", () => {
  it("clips a long assistant_text row with an ellipsis and no wrap", () => {
    const row: FeedRowData = { kind: "assistant_text", key: "k1", text: longText() };
    const { container } = render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.style.overflow).toBe("hidden");
    expect(span!.style.textOverflow).toBe("ellipsis");
    expect(span!.style.whiteSpace).toBe("nowrap");
  });

  it("renders no disclosure control for a short row", () => {
    const row: FeedRowData = { kind: "assistant_text", key: "k1", text: "short" };
    render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a disclosure control for a long row and toggling it reveals the full text", () => {
    const marker = longText(true);
    const row: FeedRowData = { kind: "assistant_text", key: "k1", text: marker };
    const { rerender } = render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);

    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/END-MARKER/)).not.toBeInTheDocument();

    rerender(<FeedRow row={row} expanded onToggleExpand={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/END-MARKER/)).toBeInTheDocument();
  });

  it("clips a long raw row in the Mono stack and offers a disclosure control", () => {
    const row: FeedRowData = { kind: "raw", key: "k1", raw: longText() };
    const { container } = render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    const span = container.querySelector("span");
    expect(span!.style.textOverflow).toBe("ellipsis");
    expect(span!.style.fontFamily).toContain("monospace");
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("clips a long system_notice row and offers a disclosure control", () => {
    const row: FeedRowData = { kind: "system_notice", key: "k1", text: longText() };
    render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("a tool_call row is always expandable regardless of its payload length", () => {
    const short: FeedRowData = { kind: "tool_call", key: "k1", toolName: "Bash", input: { command: "ls" } };
    expect(isRowExpandable(short)).toBe(true);
  });

  it("isRowExpandable is false for a short assistant_text/system_notice/raw row", () => {
    expect(isRowExpandable({ kind: "assistant_text", key: "k1", text: "short" })).toBe(false);
    expect(isRowExpandable({ kind: "system_notice", key: "k1", text: "short" })).toBe(false);
    expect(isRowExpandable({ kind: "raw", key: "k1", raw: "short" })).toBe(false);
  });

  it("isRowExpandable is true once a row's own text exceeds the truncation threshold", () => {
    expect(isRowExpandable({ kind: "assistant_text", key: "k1", text: longText() })).toBe(true);
    expect(isRowExpandable({ kind: "system_notice", key: "k1", text: longText() })).toBe(true);
    expect(isRowExpandable({ kind: "raw", key: "k1", raw: longText() })).toBe(true);
  });
});

describe("feedRowEstimateSize never varies with content length", () => {
  it("returns the identical collapsed constant for a ten-character and a ten-thousand-character row of the same kind", () => {
    const shortRow: FeedRowData = { kind: "assistant_text", key: "k1", text: "a".repeat(10) };
    const longRow: FeedRowData = { kind: "assistant_text", key: "k2", text: "a".repeat(10_000) };
    expect(feedRowEstimateSize(shortRow, false)).toBe(FEED_ROW_HEIGHT);
    expect(feedRowEstimateSize(longRow, false)).toBe(FEED_ROW_HEIGHT);
    expect(feedRowEstimateSize(shortRow, false)).toBe(feedRowEstimateSize(longRow, false));
  });

  it("returns the expanded constant for any expandable row kind when expanded, never for a collapsed row", () => {
    const longRow: FeedRowData = { kind: "raw", key: "k1", raw: longText() };
    expect(feedRowEstimateSize(longRow, true)).toBe(FEED_TOOL_ROW_EXPANDED_HEIGHT);
    expect(feedRowEstimateSize(longRow, false)).toBe(FEED_ROW_HEIGHT);

    const shortRow: FeedRowData = { kind: "raw", key: "k2", raw: "short" };
    // Not expandable at all — even a stale `expanded=true` must never widen its slot.
    expect(feedRowEstimateSize(shortRow, true)).toBe(FEED_ROW_HEIGHT);
  });
});

describe("git lock-retry transient row and the git-lock-exhaustion no-render case (D-53, plan 03-13)", () => {
  it("renders the exact Copywriting Contract line with the two integers interpolated", () => {
    const row: FeedRowData = { kind: "git_retry", key: "k1", attempt: 2, max: 5 };
    render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    expect(screen.getByText("git: retrying after index lock (attempt 2/5)…")).toBeInTheDocument();
  });

  it("computes the muted rack colour, never the destructive one", () => {
    const row: FeedRowData = { kind: "git_retry", key: "k1", attempt: 1, max: 5 };
    const { container } = render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.style.color).toBe("var(--text-muted-rack)");
    expect(span!.style.color).not.toBe("var(--destructive-text-rack)");
  });

  it("routes through the SAME branch as system_notice — identical role className and colour treatment", () => {
    const retryRow: FeedRowData = { kind: "git_retry", key: "k1", attempt: 1, max: 5 };
    const noticeRow: FeedRowData = { kind: "system_notice", key: "k2", text: "some notice" };
    const retry = render(<FeedRow row={retryRow} expanded={false} onToggleExpand={() => {}} />);
    const notice = render(<FeedRow row={noticeRow} expanded={false} onToggleExpand={() => {}} />);
    const retrySpan = retry.container.querySelector("span");
    const noticeSpan = notice.container.querySelector("span");
    expect(retrySpan!.className).toBe(noticeSpan!.className);
    expect(retrySpan!.style.color).toBe(noticeSpan!.style.color);
  });

  it("a short retry row offers no expand control (no overflow/long-text case is reachable)", () => {
    const row: FeedRowData = { kind: "git_retry", key: "k1", attempt: 1, max: 5 };
    render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(isRowExpandable(row)).toBe(false);
  });

  it("a git_lock_exhausted event renders nothing — the container's own text content is empty", () => {
    const row: FeedRowData = { kind: "git_lock_exhausted", key: "k1" };
    const { container } = render(<FeedRow row={row} expanded={false} onToggleExpand={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("feedRowEstimateSize for git_lock_exhausted is the fixed collapsed constant, never the expanded one", () => {
    const row: FeedRowData = { kind: "git_lock_exhausted", key: "k1" };
    expect(feedRowEstimateSize(row, false)).toBe(FEED_ROW_HEIGHT);
    expect(feedRowEstimateSize(row, true)).toBe(FEED_ROW_HEIGHT);
  });
});

describe("FeedRow scope_denied (D-153)", () => {
  const inside: FeedRowData = { kind: "scope_denied", key: "s1", path: "src/b.rs", tool: "Write", outsideWorktree: false };
  const outside: FeedRowData = { kind: "scope_denied", key: "s2", path: "/Users/x/.claude/notes.md", tool: "Write", outsideWorktree: true };
  const noop = () => {};
  const accepted = { status: "accepted", entries: ["src/a/", "src/b.rs"], refusal: null, collidingPath: null, otherTaskKey: null, markerError: null };

  it("renders its own row kind carrying the refused path, never the raw row", () => {
    const { container } = render(<FeedRow row={inside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    expect(screen.getByText(/src\/b\.rs/)).toBeInTheDocument();
    expect(container.querySelector('[data-kind="scope_denied"]')).not.toBeNull();
    expect(container.textContent).not.toContain("scope_denied");
  });

  it("widens to the refused path with exactly one call", async () => {
    widenFileSetMock.mockReset().mockResolvedValue(accepted);
    render(<FeedRow row={inside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    fireEvent.click(screen.getByRole("button", { name: /widen/i }));
    await waitFor(() => expect(screen.getByText(/widened/i)).toBeInTheDocument());
    expect(widenFileSetMock).toHaveBeenCalledTimes(1);
    expect(widenFileSetMock).toHaveBeenCalledWith("T1", "src/b.rs");
  });

  it("disables the action while in flight, so a second click makes no second call", async () => {
    let resolve: (v: unknown) => void = () => {};
    widenFileSetMock.mockReset().mockReturnValue(new Promise((r) => (resolve = r)));
    render(<FeedRow row={inside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    const button = screen.getByRole("button", { name: /widen/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(widenFileSetMock).toHaveBeenCalledTimes(1);
    resolve(accepted);
    await waitFor(() => expect(screen.getByRole("button", { name: /widen/i })).not.toBeDisabled());
  });

  it("shows the refusal text the command returned and keeps the row", async () => {
    widenFileSetMock.mockReset().mockResolvedValue({
      status: "refused", entries: [], refusal: "src/b.rs overlaps src/b/, which FLY-7 is running against",
      collidingPath: "src/b/", otherTaskKey: "FLY-7", markerError: null,
    });
    const { container } = render(<FeedRow row={inside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    fireEvent.click(screen.getByRole("button", { name: /widen/i }));
    await waitFor(() => expect(screen.getByText(/FLY-7 is running against/)).toBeInTheDocument());
    expect(container.querySelector('[data-kind="scope_denied"]')).not.toBeNull();
    expect(screen.queryByText(/^widened$/i)).not.toBeInTheDocument();
  });

  it("keeps the row in place, marked widened, after an accepted widen", async () => {
    widenFileSetMock.mockReset().mockResolvedValue(accepted);
    const { container } = render(<FeedRow row={inside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    fireEvent.click(screen.getByRole("button", { name: /widen/i }));
    await waitFor(() => expect(container.querySelector('[data-widened="true"]')).not.toBeNull());
    expect(screen.getByText(/src\/b\.rs/)).toBeInTheDocument();
  });

  it("says a partial widen (database wider, scope file not rewritten) plainly", async () => {
    widenFileSetMock.mockReset().mockResolvedValue({ ...accepted, status: "marker_not_rewritten", markerError: "disk full" });
    render(<FeedRow row={inside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    fireEvent.click(screen.getByRole("button", { name: /widen/i }));
    await waitFor(() => expect(screen.getByText(/disk full/)).toBeInTheDocument());
  });

  it("words an outside-the-worktree denial differently and offers no widen", () => {
    const { container: a } = render(<FeedRow row={inside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    const insideText = a.textContent;
    const { container: b } = render(<FeedRow row={outside} expanded={false} onToggleExpand={noop} taskId="T1" />);
    expect(b.textContent).not.toBe(insideText);
    expect(b.textContent).toMatch(/outside the repository/i);
    expect(b.textContent).not.toContain("/Users/x");
    expect(b.querySelector("button")).toBeNull();
  });
});
