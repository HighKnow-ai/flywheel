import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "@/components/ui/spinner";

describe("Spinner", () => {
  it("alone is a status named Loading, 16px, turning", () => {
    render(<Spinner />);
    const spinner = screen.getByRole("status", { name: "Loading" });
    expect(spinner).toHaveAttribute("data-slot", "spinner");
    expect(spinner.getAttribute("class")).toContain("size-4");
    expect(spinner.getAttribute("class")).toContain("animate-spin");
  });

  it("takes a size and a name", () => {
    render(<Spinner className="size-6" aria-label="Loading the board" />);
    const spinner = screen.getByRole("status", { name: "Loading the board" });
    expect(spinner.getAttribute("class")).toContain("size-6");
    expect(spinner.getAttribute("class")).not.toContain("size-4");
  });
});
