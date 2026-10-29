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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedRow, FEED_ROW_TRUNCATION_THRESHOLD, isRowExpandable, type FeedRowData } from "../FeedRow";

function renderRow(
  row: FeedRowData,
  { expanded = false, ...rest }: { expanded?: boolean; live?: boolean; now?: number } = {},
) {
  return render(<FeedRow row={row} expanded={expanded} onToggleExpand={() => {}} {...rest} />);
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

  it("is one compact row: a plain verb, its target and its metrics, the output hidden until expanded", () => {
    const { container } = renderRow({
      ...call,
      startedAt: "2026-10-19T10:00:00.000Z",
      endedAt: "2026-10-19T10:00:41.000Z",
    });
    expect(screen.getByRole("button", { name: "Ran · npm test, done" })).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".feed-call-verb")?.textContent).toBe("Ran");
    const metrics = [...(container.querySelector(".feed-call-metrics")?.children ?? [])].map((el) => el.textContent);
    expect(metrics).toEqual(["done", "41s"]);
    expect(container.textContent).not.toContain("5 passed");
  });

  it("names a board tool by its meaning, never by its MCP name", () => {
    const { container } = renderRow({
      kind: "tool_call",
      key: "k",
      toolName: "mcp__flywheel-board__task_add",
      input: { titles: ["Write the store test"] },
      output: '{"tasks":[]}',
    });
    expect(container.querySelector(".feed-call-verb")?.textContent).toBe("Added Task");
    expect(container.textContent).toContain("Write the store test");
    expect(container.innerHTML).not.toContain("mcp__");
  });

  it("draws a failed Check in red ink and a failed command as the destructive StateBadge (issue #205)", () => {
    const { container } = renderRow({
      kind: "tool_call",
      key: "k",
      toolName: "mcp__flywheel-board__checks_run",
      input: {},
      output: '{"checks":[{"result":"passed"},{"result":"failed"}]}',
    });
    expect(container.querySelector('[data-tone="failed-check"]')).toHaveClass("text-destructive-text");
    cleanup();
    const failed = renderRow({ ...call, isError: true, output: "Exit code 1\nboom" });
    const badge = failed.container.querySelector('[data-slot="badge"][data-state="failed"]');
    expect(badge).toHaveTextContent("exit 1");
    expect(badge).toHaveAttribute("data-tone", "destructive");
  });

  it("expanded, a failed call's error block takes the destructive edge; a clean one keeps the plain edge", () => {
    const failed = renderRow({ ...call, isError: true, output: "Exit code 1\nboom" }, { expanded: true });
    const block = failed.container.querySelector(".feed-call-detail");
    expect(block).toHaveClass("border-destructive");
    expect(screen.getByText("Error")).toHaveClass("text-destructive-text");
    failed.unmount();
    const clean = renderRow(call, { expanded: true });
    expect(clean.container.querySelector(".feed-call-detail")).toHaveClass("border-border");
  });

  it("discloses on a Collapsible, so it opens and closes like every other disclosure", () => {
    const { container } = renderRow(call, { expanded: true });
    expect(container.querySelector('[data-slot="collapsible"]')).toHaveAttribute("data-state", "open");
    expect(container.querySelector('[data-slot="collapsible-content"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /Ran · npm test/ })).toHaveAttribute("aria-expanded", "true");
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
      {
        kind: "tool_call",
        key: "k",
        toolName: "mcp__flywheel__story_get",
        input: {},
        output: { key: "FLY-3", criteria: ["a", "b"] },
      },
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
    expect(screen.getByText("running · 1m 00s")).toBeInTheDocument();
  });

  it("while live with no heartbeat yet, counts from when the call started", () => {
    const now = Date.parse("2026-10-19T10:00:12.000Z");
    renderRow(
      {
        kind: "tool_call",
        key: "k",
        toolName: "Bash",
        input: { command: "sleep 30" },
        startedAt: "2026-10-19T10:00:05.000Z",
      },
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
      input: {
        title: "Pair results by id",
        why: "FIFO by name mispairs concurrent calls",
        criteria: ["pairs by id", "falls back to name"],
      },
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
          options: [{ label: "Blocked", description: "A run waits on you" }, { label: "Finished" }],
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
  it("renders the exact Copywriting Contract line in the muted role, as a notice in the row grid", () => {
    renderRow({ kind: "git_retry", key: "k", attempt: 2, max: 5 });
    const line = screen.getByText("git: retrying after index lock (attempt 2/5)…").closest("p");
    expect(line).toHaveClass("feed-notice", "text-muted-foreground");
  });

  it("a git_lock_exhausted row renders nothing", () => {
    const { container } = renderRow({ kind: "git_lock_exhausted", key: "k" });
    expect(container.textContent).toBe("");
  });
});

describe("worktree-relative paths (issue #205)", () => {
  const ROOT =
    "/Users/cymarechal/cymarechal/clients/acme-enterprise-holdings/technical-presales-knowledge-platform-monorepo";
  const read: FeedRowData = {
    kind: "tool_call",
    key: "k",
    toolName: "Read",
    input: { file_path: `${ROOT}/packages/export/src/xlsx/merge-cells.ts` },
    output: "a\nb",
  };

  it("show a Read relative to the worktree, its file name kept whole and the full path in a Tooltip", async () => {
    const { container } = render(<FeedRow row={read} expanded={false} onToggleExpand={() => {}} root={ROOT} />);
    const target = container.querySelector(".feed-call-target") as HTMLElement;
    expect(target).toHaveTextContent(/^packages\/export\/src\/xlsx\/merge-cells\.ts$/);
    expect(target.textContent).not.toContain("/Users/");
    // Middle truncation: the folders give way first, the file name never does.
    const [dir, base] = Array.from(target.children);
    expect(dir).toHaveClass("truncate");
    expect(base).toHaveTextContent("merge-cells.ts");
    expect(base).toHaveClass("shrink-0");

    fireEvent.pointerMove(target);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(`${ROOT}/packages/export/src/xlsx/merge-cells.ts`);
  });

  it("make a command's mention of the worktree relative too", () => {
    const { container } = render(
      <FeedRow
        row={{
          kind: "tool_call",
          key: "k",
          toolName: "Bash",
          input: { command: `cd ${ROOT} && pnpm test ${ROOT}/packages/export` },
          output: "ok",
        }}
        expanded={false}
        onToggleExpand={() => {}}
        root={ROOT}
      />,
    );
    expect(container.querySelector(".feed-call-target")).toHaveTextContent(/^cd \. && pnpm test packages\/export$/);
  });

  it("leave a path outside the worktree, or with no worktree known, as it is", () => {
    const outside: FeedRowData = { ...read, input: { file_path: "/etc/hosts" } };
    const a = render(<FeedRow row={outside} expanded={false} onToggleExpand={() => {}} root={ROOT} />);
    expect(a.container.querySelector(".feed-call-target")).toHaveTextContent("/etc/hosts");
    a.unmount();
    const b = render(<FeedRow row={read} expanded={false} onToggleExpand={() => {}} />);
    expect(b.container.querySelector(".feed-call-target")).toHaveTextContent(
      `${ROOT}/packages/export/src/xlsx/merge-cells.ts`,
    );
  });
});

describe("notices (issue #205)", () => {
  it("sit in the row grid with an icon: an API error a warning", () => {
    renderRow({
      kind: "system_notice",
      key: "k",
      text: "API Error: 529 Overloaded. Retrying in 4 seconds… (attempt 1 of 10)",
    });
    const line = screen.getByText(/^API Error: 529/).closest("p") as HTMLElement;
    expect(line).toHaveClass("feed-notice");
    expect(line.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
  });

  it("a usage limit reads when it resets, never the raw epoch", () => {
    const resetsAt = new Date(Date.now() + 3 * 3600_000);
    resetsAt.setMinutes(0, 0, 0);
    const { container } = renderRow({ kind: "usage_limit", key: "k", resetsAt: resetsAt.toISOString() });
    const hh = String(resetsAt.getHours()).padStart(2, "0");
    expect(container).toHaveTextContent(new RegExp(`^Usage limit reached · resets (\\w+ )?${hh}:00$`));
    expect(container.textContent).not.toMatch(/\d{10}/);
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
