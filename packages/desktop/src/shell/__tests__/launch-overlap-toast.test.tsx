/**
 * D-REV-43: the overlap warning toast, lifted out of App.tsx so it can be tested without an App
 * render harness. Rust composes the sentence; the toast shows it verbatim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LaunchOverlapToast } from "../LaunchOverlapToast";

afterEach(() => vi.useRealTimers());

describe("LaunchOverlapToast", () => {
  it("renders the warning text verbatim when given one", () => {
    render(<LaunchOverlapToast warning="FLY-3 is already running in this worktree." onDismiss={() => {}} />);
    expect(screen.getByRole("note", { name: "Launch overlap warning" })).toHaveTextContent(
      "FLY-3 is already running in this worktree.",
    );
  });

  it("renders nothing when given none", () => {
    const { container } = render(<LaunchOverlapToast warning={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dismisses itself after its timeout", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<LaunchOverlapToast warning="overlap" onDismiss={onDismiss} timeoutMs={15000} />);
    act(() => void vi.advanceTimersByTime(14999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed sooner by the user, by keyboard-reachable button", () => {
    const onDismiss = vi.fn();
    render(<LaunchOverlapToast warning="overlap" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
