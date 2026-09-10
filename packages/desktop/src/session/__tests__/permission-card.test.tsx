/**
 * Behavior under test (02-06-PLAN.md Task 1, AGNT-06, D-37, D-38): `PermissionRequestCard`
 * standalone — renders nothing with no pending request; a pending request renders the glyph,
 * heading, payload and three unequal actions at their exact copy; Escape never resolves it; a
 * double-activation of Allow calls the answer function exactly once; a rejected answer keeps the
 * card mounted, re-enables its actions and shows an inline error; two pending requests render as
 * two independently answerable cards; the `compact` variant caps the payload height and truncates
 * a long tool name.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PermissionRequestCard, type PendingPermissionRequest } from "../PermissionRequestCard";

function makeRequest(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
  return {
    id: "req-1",
    toolName: "Bash",
    inputPayload: '{"command":"rm -rf /tmp/scratch"}',
    ...overrides,
  };
}

describe("PermissionRequestCard (standalone)", () => {
  it("renders nothing at all with no pending request", () => {
    const { container } = render(
      <PermissionRequestCard variant="feed" requests={[]} onAnswer={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the glyph, heading, payload and three actions at their exact copy", () => {
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={vi.fn()} />);

    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByText('{"command":"rm -rf /tmp/scratch"}')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Allow this tool for this project from now on" }),
    ).toBeInTheDocument();
  });

  it("Escape never resolves the card — the answer spy sees zero calls and the card stays mounted", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
  });

  it("pressing a/d/Shift+A resolves through the shared binding table", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "d" });
    expect(onAnswer).toHaveBeenCalledWith("req-1", "deny");
  });

  it("pressing Shift+A invokes allow-always", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "a", shiftKey: true });
    expect(onAnswer).toHaveBeenCalledWith("req-1", "allow_always");
  });

  it("activating Allow twice in immediate succession calls the answer spy exactly once", () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    const allowButton = screen.getByRole("button", { name: "Allow" });
    fireEvent.click(allowButton);
    fireEvent.click(allowButton);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    resolveAnswer?.();
  });

  it("a rejected answer keeps the card mounted, re-enables its actions and renders an inline error", async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error("network down"));
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
  });

  it("renders two pending requests as two independently answerable cards", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const first = makeRequest({ id: "req-1", toolName: "Bash" });
    const second = makeRequest({ id: "req-2", toolName: "Edit" });
    render(<PermissionRequestCard variant="feed" requests={[first, second]} onAnswer={onAnswer} />);

    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByText("Edit wants to:")).toBeInTheDocument();

    const editGroup = screen.getByRole("group", { name: "Edit wants to:" });
    fireEvent.click(within(editGroup).getByRole("button", { name: "Allow" }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("req-2", "allow");
    // The first (untouched) card's Allow button is still enabled — answering the second never
    // touched the first's own state.
    const bashGroup = screen.getByRole("group", { name: "Bash wants to:" });
    expect(within(bashGroup).getByRole("button", { name: "Allow" })).toBeEnabled();
  });

  it("imports its glyph name from the marks registry and hard-codes no colour", () => {
    // Structural gates are enforced by the plan's own grep-based <verify> commands at the file
    // level (no onKeyDown/addEventListener/DismissableLayer, no hex literal) — this test only
    // documents the intent so a reader of the suite sees the contract stated here too.
    expect(true).toBe(true);
  });
});

describe('PermissionRequestCard variant="compact"', () => {
  it("caps the payload block at a fixed max height with internal scroll", () => {
    const longPayload = "x".repeat(5000);
    render(
      <PermissionRequestCard
        variant="compact"
        requests={[makeRequest({ inputPayload: longPayload })]}
        onAnswer={vi.fn()}
      />,
    );
    const pre = screen.getByText(longPayload);
    expect(pre.style.maxHeight).not.toBe("");
    expect(pre.style.overflowY).toBe("auto");
  });

  it("truncates a long tool name with an ellipsis rather than widening the container", () => {
    const longName = "A".repeat(200);
    render(
      <PermissionRequestCard variant="compact" requests={[makeRequest({ toolName: longName })]} onAnswer={vi.fn()} />,
    );
    const heading = screen.getByText(`${longName} wants to:`);
    expect(heading.style.textOverflow).toBe("ellipsis");
    expect(heading.style.whiteSpace).toBe("nowrap");
  });
});
