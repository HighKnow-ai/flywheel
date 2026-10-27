/**
 * The HighKnow mark in its real colours (issue #196): wherever Flywheel shows a logo (the project rail and the
 * first-run empty state), it is the brand tile `#3c64dd` with the white glyph, fixed in both schemes, as
 * HighKnow's own `Wordmark` draws it. No ink-masked silhouette.
 *
 * The mark is an `<img>` of `assets/logo.svg`, a byte-identical copy of HighKnow's `docs/design/assets/logo.svg`.
 * An image cannot read the page's tokens, so neither scheme can recolour it: that is the point. It stays a
 * reference to a static file, never injected markup (T-08.1-05).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@highknow/design";
import { FirstRun } from "../../board/FirstRun";
import { ProjectRail } from "../../projects/ProjectRail";
import { contrastRatio } from "../contrast";

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: () => Promise.resolve(undefined),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  fleetBlockedQueue: () => Promise.resolve([]),
  fleetList: () => Promise.resolve({ rows: [], totalRows: 0, visibleCostUsd: null }),
  fleetWaitingRounds: () => Promise.resolve([]),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

afterEach(cleanup);

const SRC = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/theme\/__tests__\/[^/]+$/, "/");
const text = (rel: string): string => new TextDecoder().decode(readFileSync(SRC + rel));
const LOGO = text("assets/logo.svg");

function withClient(node: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider>{node}</SidebarProvider>
    </QueryClientProvider>,
  );
}

const SURFACES = {
  rail: () =>
    withClient(
      <ProjectRail
        projects={[
          { id: "p1", keyPrefix: "FLY", name: "Flywheel", repoPath: "/r", defaultBranch: "main", status: "active" },
        ]}
        currentProjectId="p1"
        onSelect={() => {}}
      />,
    ),
  "first-run": () => withClient(<FirstRun />),
} as const;

/** `hsl(h, s%, l%)` to `#rrggbb`, so the logo's own notation can be compared with the pinned hex. */
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return "#" + [f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

describe("assets/logo.svg is the brand tile with the white glyph", () => {
  it("fills its tile with the pinned brand #3c64dd", () => {
    const fill = LOGO.match(/<rect[^>]*fill="hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)"/);
    expect(fill, "the tile's fill").not.toBeNull();
    const [, h, s, l] = fill!.map(Number);
    expect(hslToHex(h, s / 100, l / 100)).toBe("#3c64dd");
  });

  it("draws the glyph in white, readable on the tile", () => {
    expect(LOGO).toMatch(/<g fill="white"/);
    expect(contrastRatio("#ffffff", "#3c64dd")).toBeGreaterThanOrEqual(4.5);
  });

  it("is the only logo asset: the ink-masked glyph is gone", () => {
    expect(() => text("assets/logo-glyph.svg")).toThrow();
  });
});

describe.each(Object.keys(SURFACES) as (keyof typeof SURFACES)[])("the %s mark", (surface) => {
  it("is a named <img> of the full-colour logo, not a mask", () => {
    const { container } = SURFACES[surface]();
    const mark = screen.getByRole("img", { name: "Flywheel by HighKnow" });
    expect(mark.tagName).toBe("IMG");
    expect(mark.getAttribute("src")).toMatch(/logo\.svg$/);
    expect(mark.style.maskImage || mark.style.webkitMaskImage).toBe("");
    expect(container.querySelector("[style*='mask']")).toBeNull();
  });

  it("takes no colour from the theme, so it is the same tile in light and dark", () => {
    SURFACES[surface]();
    const mark = screen.getByRole("img", { name: "Flywheel by HighKnow" });
    expect(mark.className).not.toMatch(/\bdark:|invert|grayscale|bg-|text-/);
    expect(mark.style.filter).toBe("");
  });
});

describe("no stylesheet recolours the mark", () => {
  it.each(["styles/globals.css"])("%s draws no mask, filter or token fill on a mark", (file) => {
    const css = text(file);
    for (const rule of css.matchAll(/\.(?:rail|first-run)-mark\s*\{([^}]*)\}/g)) {
      expect(rule[1]).not.toMatch(/mask|filter|background-color|var\(--/);
    }
  });
});
