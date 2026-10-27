import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Toaster } from "@highknow/design";
import { notify } from "@/lib/notify";

beforeAll(() => {
  // Sonner reads the system scheme through matchMedia; jsdom has none.
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      }),
    });
  }
});

describe("Toaster and notify", () => {
  it("mounts one live region, bottom-right", () => {
    render(<Toaster />);
    const region = screen.getByRole("region", { name: /notifications/i });
    expect(region).toBeInTheDocument();
    act(() => {
      notify.success("Story moved to E-3");
    });
    return waitFor(() => {
      const toast = screen.getByText("Story moved to E-3").closest("[data-sonner-toast]");
      expect(toast).toHaveAttribute("data-y-position", "bottom");
      expect(toast).toHaveAttribute("data-x-position", "right");
      expect(toast).toHaveAttribute("data-type", "success");
    });
  });

  it("offers Undo on a reversible action, and Undo calls back once", async () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      notify.success("Discarded FLY-12's worktree", { undo });
    });
    const button = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(button);
    expect(undo).toHaveBeenCalledOnce();
  });

  it("offers a next step that is not Undo, named by its label", async () => {
    const openBoard = vi.fn();
    render(<Toaster />);
    act(() => {
      notify.success("FLY-3 merged into main", {
        description: "Worktree cleaned.",
        action: { label: "Open board", onClick: openBoard },
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Open board" }));
    expect(openBoard).toHaveBeenCalledOnce();
  });

  it("reports a failure with its own message as the line beneath", async () => {
    render(<Toaster />);
    act(() => {
      notify.error("Couldn't merge FLY-12", { error: new Error("the base branch moved") });
    });
    expect(await screen.findByText("Couldn't merge FLY-12")).toBeInTheDocument();
    expect(screen.getByText("the base branch moved")).toBeInTheDocument();
    const toast = screen.getByText("Couldn't merge FLY-12").closest("[data-sonner-toast]");
    expect(toast).toHaveAttribute("data-type", "error");
  });
});
