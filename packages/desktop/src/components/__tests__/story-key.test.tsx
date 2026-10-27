import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoryKey } from "@/components/StoryKey";
import { RelativeTime } from "@/components/RelativeTime";
import { TooltipProvider } from "@highknow/design";
import { formatAbsoluteTime } from "@/lib/format";

describe("StoryKey", () => {
  it("draws a key in the code face, quiet, tabular and never wrapping", () => {
    render(<StoryKey value="FLY-12" />);
    const key = screen.getByText("FLY-12");
    expect(key).toHaveAttribute("data-slot", "story-key");
    expect(key).toHaveClass(
      "font-mono",
      "whitespace-nowrap",
      "shrink-0",
      "tabular-nums",
      "text-meta",
      "text-muted-foreground",
    );
  });

  it("takes the size of the title beside it, and the surrounding ink on the strip", () => {
    render(<StoryKey value="E-3" size="small" tone="inherit" />);
    const key = screen.getByText("E-3");
    expect(key).toHaveClass("text-small");
    expect(key).not.toHaveClass("text-muted-foreground");
  });
});

describe("RelativeTime", () => {
  it("reads relative, carries the absolute on <time dateTime>, and the dash for an unreadable time", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const at = "2026-10-25T11:57:00Z";
    render(
      <TooltipProvider>
        <RelativeTime at={at} now={now} />
        <RelativeTime at={undefined} now={now} />
      </TooltipProvider>,
    );
    const time = screen.getByText("3m ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", new Date(at).toISOString());
    expect(formatAbsoluteTime(at)).not.toBe("—");
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
