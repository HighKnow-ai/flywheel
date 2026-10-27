/**
 * The top bar fits every window (issue #199), measured in an engine. Was a known layout defect in
 * `test/critique/capture.ts`: at 900 × 600 a long project name or Story key in the breadcrumb was drawn under
 * Search, its ⌘K hint and the add buttons. The header beside the 16rem rail is about 644px wide at that window.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import "../../../styles/globals.css";
import { Button } from "@/components/Button";
import { PageHeader } from "../../PageHeader";

const LONG_PROJECT = "technical-presales-knowledge-base-for-acme"; // 42 characters
const LONG_KEY = "PRESALES-1014";
const SESSION = "ses-7f3c2a9e-41b0-4d55-9c61-2f0e8d3b7a14";

function Header({ width }: { width: number }) {
  return (
    <div style={{ width }}>
      <PageHeader
        onBack={() => {}}
        crumbs={[
          { label: LONG_PROJECT, onSelect: () => {}, ariaLabel: `Open the ${LONG_PROJECT} board` },
          { label: LONG_KEY, mono: true, onSelect: () => {}, ariaLabel: `Open Story ${LONG_KEY}` },
          { label: SESSION, mono: true },
        ]}
        actions={
          <>
            <Button variant="outline">
              <Plus aria-hidden="true" />
              Epic
            </Button>
            <Button>
              <Plus aria-hidden="true" />
              Story
            </Button>
          </>
        }
      />
    </div>
  );
}

function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("the top bar at the window's minimum width", () => {
  it.each([644, 1024, 1184])("never draws a crumb under Search or the add buttons at a %ipx header", (width) => {
    render(<Header width={width} />);
    const controls = [
      screen.getByRole("button", { name: "Search, ⌘K" }),
      screen.getByRole("button", { name: "Epic" }),
      screen.getByRole("button", { name: "Story" }),
    ].map((el) => el.getBoundingClientRect());
    const crumbs = screen.getByRole("navigation", { name: "You are here" });
    const drawn = [...crumbs.querySelectorAll("li")].filter((li) => getComputedStyle(li).display !== "none");
    expect(drawn.length).toBeGreaterThan(0);
    for (const li of drawn) {
      const rect = li.getBoundingClientRect();
      for (const control of controls) expect(overlaps(rect, control), li.textContent ?? "").toBe(false);
    }
    // Every crumb ends inside the breadcrumb: truncated, never spilling past it.
    const bounds = crumbs.getBoundingClientRect();
    for (const li of drawn) expect(li.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right + 0.5);
  });

  it("folds Search to its icon and the Story key into the ellipsis on a narrow header, and keeps the page legible", () => {
    render(<Header width={644} />);
    expect(screen.getByRole("button", { name: "Search, ⌘K" }).getBoundingClientRect().width).toBeLessThan(40);
    expect(screen.getByRole("button", { name: "Show the folded places" })).toBeVisible();
    // Folded: out of the accessibility tree too, so it is reached through the menu.
    expect(screen.queryByRole("button", { name: `Open Story ${LONG_KEY}` })).toBeNull();
    expect(screen.getByText(SESSION).getBoundingClientRect().width).toBeGreaterThanOrEqual(90);
  });

  it("shows every crumb and the full Search on a wide header", () => {
    render(<Header width={1184} />);
    expect(screen.getByRole("button", { name: "Search, ⌘K" }).getBoundingClientRect().width).toBeGreaterThan(200);
    expect(screen.getByRole("button", { name: `Open Story ${LONG_KEY}` })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show the folded places" })).toBeNull();
  });
});
