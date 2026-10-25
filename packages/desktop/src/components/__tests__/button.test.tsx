import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";

describe("Button loading", () => {
  it("shows the Spinner in place of the icon, keeps the label and sets aria-busy", () => {
    render(
      <Button loading>
        <Play data-testid="icon" aria-hidden="true" />
        Start
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Start" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Start");
    expect(screen.queryByTestId("icon")).toBeNull();
    const spinner = button.querySelector('[data-slot="spinner"]');
    expect(spinner).not.toBeNull();
    // The spinner takes the icon's slot: first child, the same 16px square, and silent (aria-busy speaks).
    expect(button.firstElementChild).toBe(spinner);
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(spinner).not.toHaveAttribute("role");
  });

  it("keeps the leading icon's own size classes on the spinner, so the width does not move", () => {
    render(
      <Button loading size="xs">
        <Play className="size-3" aria-hidden="true" />
        Run
      </Button>,
    );
    const spinner = screen.getByRole("button").querySelector('[data-slot="spinner"]');
    expect(spinner?.getAttribute("class")).toContain("size-3");
  });

  it("adds the spinner before the label when the button has no icon", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.firstElementChild).toHaveAttribute("data-slot", "spinner");
    expect(button).toHaveTextContent("Save");
  });

  it("swallows clicks while pending but stays focusable (not disabled), so focus is not lost", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Merge
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Merge" });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does nothing different when not loading", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick}>
        <Play data-testid="icon" aria-hidden="true" />
        Start
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Start" });
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
