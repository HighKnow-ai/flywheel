/**
 * Story #206 (critique F20, P3 Kbd): answering down the Waiting-on-you queue, the left button means the same thing on
 * every request card. Deny sits in the first slot of one Button Group on a Gated action and on a permission request,
 * each card keeps its own tones (direction.md § Buttons), the answer keys are shown with Kbd on the row that owns
 * them, and the Always-allow pattern editor is a Popover with an Input Group.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PermissionRequestCard, type PendingPermissionRequest } from "../PermissionRequestCard";

function request(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
  return {
    id: "req-1",
    toolName: "Bash",
    inputPayload: '{"command":"npm test --watch"}',
    destructiveCategory: null,
    suggestedRule: "Bash(npm test --watch)",
    ...overrides,
  };
}

function gated(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
  return request({ inputPayload: '{"command":"git reset --hard"}', destructiveCategory: "hard-reset", suggestedRule: null, ...overrides });
}

/** The answer buttons, in reading order, from the card's one Button Group. */
function answerButtons(scope: HTMLElement = document.body) {
  const group = within(scope).getByRole("group", { name: "Answer" });
  expect(group).toHaveAttribute("data-slot", "button-group");
  return within(group).getAllByRole("button");
}

function expectDenyThenAllow(buttons: HTMLElement[]) {
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toHaveAccessibleName("Deny");
  expect(buttons[1]).toHaveAccessibleName("Allow once");
}

describe("Deny sits in the same slot on every request card", () => {
  it("is the first button of the answer group on a permission request and on a Gated action", () => {
    const { unmount } = render(<PermissionRequestCard variant="feed" requests={[request()]} onAnswer={vi.fn()} />);
    expectDenyThenAllow(answerButtons());
    unmount();

    render(<PermissionRequestCard variant="feed" requests={[gated()]} onAnswer={vi.fn()} />);
    expectDenyThenAllow(answerButtons());
  });

  it("keeps each card's tones: a request's Allow once is the attention fill, a Gated action's Deny the ink fill", () => {
    const { unmount } = render(<PermissionRequestCard variant="feed" requests={[request()]} onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Allow once" })).toHaveAttribute("data-variant", "attention");
    expect(screen.getByRole("button", { name: "Deny" })).toHaveAttribute("data-variant", "outline");
    unmount();

    render(<PermissionRequestCard variant="feed" requests={[gated()]} onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Deny" })).toHaveAttribute("data-variant", "neutral");
    expect(screen.getByRole("button", { name: "Allow once" })).toHaveAttribute("data-variant", "outline");
  });

  it("in a queue of mixed cards, every card's first answer is Deny", () => {
    render(
      <PermissionRequestCard
        variant="feed"
        requests={[request(), gated({ id: "req-2", toolName: "Bash2" }), request({ id: "req-3", toolName: "Edit" })]}
        onAnswer={vi.fn()}
      />,
    );
    for (const name of ["Bash wants to:", "Bash2 wants to:", "Edit wants to:"]) {
      const card = screen.getByRole("group", { name });
      expect(answerButtons(card)[0]).toHaveAccessibleName("Deny");
    }
  });
});

describe("the answer keys are shown with Kbd", () => {
  it("shows D on Deny and A on Allow once, hidden from the accessible name and announced as shortcuts", () => {
    render(<PermissionRequestCard variant="feed" requests={[request()]} onAnswer={vi.fn()} />);
    const deny = screen.getByRole("button", { name: "Deny" });
    const allow = screen.getByRole("button", { name: "Allow once" });
    expect(deny.querySelector('[data-slot="kbd"]')).toHaveTextContent("D");
    expect(allow.querySelector('[data-slot="kbd"]')).toHaveTextContent("A");
    expect(deny).toHaveAttribute("aria-keyshortcuts", "D");
    expect(allow).toHaveAttribute("aria-keyshortcuts", "A");
  });

  it("shows them on a Gated action too", () => {
    render(<PermissionRequestCard variant="feed" requests={[gated()]} onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Deny" }).querySelector('[data-slot="kbd"]')).toHaveTextContent("D");
    expect(screen.getByRole("button", { name: "Allow once" }).querySelector('[data-slot="kbd"]')).toHaveTextContent("A");
  });

  it("shows them only on the row that owns the keys", () => {
    render(
      <PermissionRequestCard variant="feed" requests={[request(), request({ id: "req-2", toolName: "Edit" })]} onAnswer={vi.fn()} />,
    );
    const owner = screen.getByRole("group", { name: "Bash wants to:" });
    const other = screen.getByRole("group", { name: "Edit wants to:" });
    expect(owner.querySelectorAll('[data-slot="kbd"]')).toHaveLength(2);
    expect(other.querySelectorAll('[data-slot="kbd"]')).toHaveLength(0);
    expect(within(other).getByRole("button", { name: "Deny" })).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("shows none when the card does not own the keyboard", () => {
    const { container } = render(
      <PermissionRequestCard variant="feed" keyboardEnabled={false} requests={[request()]} onAnswer={vi.fn()} />,
    );
    expect(container.querySelectorAll('[data-slot="kbd"]')).toHaveLength(0);
  });
});

describe("the Always-allow pattern editor is a Popover with an Input Group", () => {
  it("is closed until asked for, then holds the pre-filled pattern in an Input Group", async () => {
    render(<PermissionRequestCard variant="feed" requests={[request()]} onAnswer={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: "Pattern" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Always allow…" }));
    const field = await screen.findByRole("textbox", { name: "Pattern" });
    expect(field).toHaveValue("Bash(npm test --watch)");
    expect(field.closest('[data-slot="input-group"]')).not.toBeNull();
    expect(field.closest('[data-slot="popover-content"]')).not.toBeNull();
  });

  it("saves the edited pattern from inside the popover", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[request()]} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Always allow…" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Pattern" }), { target: { value: "Bash(npm test:*)" } });
    fireEvent.click(screen.getByRole("button", { name: "Always allow this pattern in this project" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("req-1", "allow_always", "Bash(npm test:*)"));
  });

  it("a Gated action has no Always-allow trigger at all", () => {
    render(<PermissionRequestCard variant="feed" requests={[gated()]} onAnswer={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /always allow/i })).not.toBeInTheDocument();
  });
});
