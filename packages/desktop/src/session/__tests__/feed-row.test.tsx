/**
 * Behaviour under test (Story #56, the session feed is readable):
 * - an agent turn renders as markdown, in full, never one clipped line;
 * - a tool call is a compact row; expanded, its input reads as named fields and its output as text —
 *   no JSON anywhere, for any payload shape;
 * - a running call says it is still running, with the time from its heartbeat;
 * - a Proposal and an AskUserQuestion request render as cards;
 * - the git lock-retry line and the lock-exhaustion no-render case (D-53) are unchanged.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedRow, FEED_ROW_TRUNCATION_THRESHOLD, isRowExpandable, type FeedRowData } from "../FeedRow";

function renderRow(row: FeedRowData, opts: { expanded?: boolean; live?: boolean; now?: number } = {}) {
  return render(
    <FeedRow row={row} expanded={opts.expanded ?? false} onToggleExpand={() => {}} live={opts.live} now={opts.now} />,
  );
}

/** No JSON object or array syntax leaks into what the developer reads. */
function expectNoJson(container: HTMLElement) {
  const text = container.textContent ?? "";
  expect(text).not.toMatch(/[{[]\s*"/);
  expect(text).not.toMatch(/"\s*:/);
}

describe("an agent turn", () => {
  it("renders as markdown in full, with no disclosure control", () => {
    const text = `## Findings\n\nThe adapter **drops** results.\n\n${"More words here. ".repeat(30)}\n\n- one\n- two`;
    const { container } = renderRow({ kind: "assistant_text", key: "k", text });
    expect(container.querySelector("h2")?.textContent).toBe("Findings");
    expect(container.querySelector("strong")?.textContent).toBe("drops");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).not.toContain("**");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a tool call", () => {
  const call: FeedRowData = {
    kind: "tool_call",
    key: "k",
    toolName: "Bash",
    input: { command: "npm test", description: "Run the tests", timeout: 120000 },
    output: "5 passed\n0 failed",
  };

  it("is one compact row naming the tool and its target, with the first line of its output", () => {
    const { container } = renderRow(call);
    expect(screen.getByRole("button", { name: /Bash · npm test/ })).toHaveAttribute("aria-expanded", "false");
    expect(container.textContent).toContain("5 passed");
    expect(container.textContent).not.toContain("0 failed");
  });

  it("expanded, shows its input as named fields and its output as text, with no JSON", () => {
    const { container } = renderRow(call, { expanded: true });
    expect(screen.getByText("command")).toBeInTheDocument();
    expect(screen.getByText("Run the tests")).toBeInTheDocument();
    expect(screen.getByText("120000")).toBeInTheDocument();
    expect(container.textContent).toContain("0 failed");
    expectNoJson(container);
  });

  it("renders a structured output as fields too, never as JSON", () => {
    const { container } = renderRow(
      { kind: "tool_call", key: "k", toolName: "mcp__flywheel__story_get", input: {}, output: { key: "FLY-3", criteria: ["a", "b"] } },
      { expanded: true },
    );
    expect(screen.getByText("FLY-3")).toBeInTheDocument();
    expect(screen.getByText("criteria")).toBeInTheDocument();
    expectNoJson(container);
  });

  it("says failed when the tool reported an error", () => {
    renderRow({ ...call, isError: true, output: "1 failed" });
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("while live, says it is still running, using the newer of the heartbeat and the clock", () => {
    const now = Date.parse("2026-10-19T10:00:10.000Z");
    const running: FeedRowData = {
      kind: "tool_call",
      key: "k",
      toolName: "Bash",
      input: { command: "cargo test" },
      startedAt: "2026-10-19T10:00:05.000Z",
      elapsedSeconds: 60,
    };
    renderRow(running, { live: true, now });
    expect(screen.getByText("running · 1m")).toBeInTheDocument();
  });

  it("while live with no heartbeat yet, counts from when the call started", () => {
    const now = Date.parse("2026-10-19T10:00:12.000Z");
    renderRow(
      { kind: "tool_call", key: "k", toolName: "Bash", input: { command: "sleep 30" }, startedAt: "2026-10-19T10:00:05.000Z" },
      { live: true, now },
    );
    expect(screen.getByText("running · 7s")).toBeInTheDocument();
  });

  it("a result with no call loaded reads as a result row with its text", () => {
    const { container } = renderRow({ kind: "tool_result", key: "k", output: "orphaned output" });
    expect(container.textContent).toContain("orphaned output");
    expectNoJson(container);
  });
});

describe("cards", () => {
  it("renders a Proposal as a card with its kind, title and why, and no JSON", () => {
    const { container } = renderRow({
      kind: "proposal",
      key: "k",
      toolName: "mcp__flywheel__propose_story",
      input: { title: "Pair results by id", why: "FIFO by name mispairs concurrent calls", criteria: ["pairs by id", "falls back to name"] },
      output: "Proposal P-12 filed",
    });
    const card = container.querySelector(".session-card");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Proposal · story");
    expect(screen.getByText("Pair results by id")).toBeInTheDocument();
    expect(screen.getByText("FIFO by name mispairs concurrent calls")).toBeInTheDocument();
    expect(screen.getByText("falls back to name")).toBeInTheDocument();
    expect(screen.getByText("Proposal P-12 filed")).toBeInTheDocument();
    expectNoJson(container);
  });

  it("renders an AskUserQuestion request as a card with each question, its options and the answer", () => {
    const { container } = renderRow({
      kind: "question",
      key: "k",
      questions: [
        {
          question: "Which events notify?",
          header: "Triggers",
          options: [
            { label: "Blocked", description: "A run waits on you" },
            { label: "Finished" },
          ],
        },
      ],
      answer: "The user did not answer the questions.",
    });
    expect(container.querySelector(".session-card")).not.toBeNull();
    expect(screen.getByText("Which events notify?")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("A run waits on you")).toBeInTheDocument();
    expect(screen.getByText("The user did not answer the questions.")).toBeInTheDocument();
    expectNoJson(container);
  });
});

describe("git lock-retry transient row and the git-lock-exhaustion no-render case (D-53)", () => {
  it("renders the exact Copywriting Contract line in the muted role", () => {
    renderRow({ kind: "git_retry", key: "k", attempt: 2, max: 5 });
    const node = screen.getByText("git: retrying after index lock (attempt 2/5)…");
    expect(node.style.color).toBe("var(--text-muted-rack)");
  });

  it("a git_lock_exhausted row renders nothing", () => {
    const { container } = renderRow({ kind: "git_lock_exhausted", key: "k" });
    expect(container.textContent).toBe("");
  });
});

describe("an unrecognised line", () => {
  it("is clipped in the Mono stack and offers its full text behind a disclosure", () => {
    const raw = `${"x".repeat(FEED_ROW_TRUNCATION_THRESHOLD + 20)}END`;
    const row: FeedRowData = { kind: "raw", key: "k", raw };
    expect(isRowExpandable(row)).toBe(true);
    const collapsed = renderRow(row);
    expect(screen.getByRole("button", { name: "Expand full text" })).toBeInTheDocument();
    expect(collapsed.container.textContent).not.toContain("END");
    collapsed.unmount();
    renderRow(row, { expanded: true });
    expect(screen.getByText(/END$/)).toBeInTheDocument();
  });
});
