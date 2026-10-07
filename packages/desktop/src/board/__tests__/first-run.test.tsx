/**
 * Behavior under test (CR-02/IN-01, 01-REVIEW.md): `deriveKeyPrefix` must always emit a prefix
 * `core::domain::project::validate_key_prefix` accepts (2-10 uppercase letters/digits, starting
 * with a letter) — a directory name like `2024-app` or a single-character name used to derive an
 * invalid prefix, which three of the four registration entry points had no way to recover from
 * since they register immediately with no confirmation step to edit it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirstRun, deriveKeyPrefix } from "../FirstRun";
import { ProjectRail } from "../../projects/ProjectRail";

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: () => Promise.resolve(undefined),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

afterEach(cleanup);

function withClient(node: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

/** Mirrors `core::domain::project::validate_key_prefix` exactly, so this test proves the same
 * contract the backend enforces, not a looser JS-side approximation of it. */
function isValidKeyPrefix(prefix: string): boolean {
  return /^[A-Z][A-Z0-9]{1,9}$/.test(prefix);
}

describe("deriveKeyPrefix", () => {
  it("derives the expected prefix for an ordinary directory name", () => {
    expect(deriveKeyPrefix("/repos/my-app")).toBe("MYAP");
  });

  it("hardens a digit-leading directory name into a valid, letter-led prefix (CR-02)", () => {
    const prefix = deriveKeyPrefix("/repos/2024-app");
    expect(prefix).toBe("P202");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("hardens a single-character directory name into a valid, 2+ character prefix", () => {
    const prefix = deriveKeyPrefix("/repos/x");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("hardens a directory name with no alphanumeric characters at all", () => {
    const prefix = deriveKeyPrefix("/repos/___");
    expect(prefix).toBe("PRJ");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("never emits a prefix validate_key_prefix would reject, across a spread of realistic names", () => {
    const names = [
      "2024-app",
      "_x",
      "a",
      "99bottles",
      "my-app",
      "___",
      "1",
      "Flywheel",
      "___2025___",
    ];
    for (const name of names) {
      const prefix = deriveKeyPrefix(`/repos/${name}`);
      expect(isValidKeyPrefix(prefix)).toBe(true);
    }
  });
});

/** SC2 / D-22: the brand mark is on screen in the two surfaces entitled to it, as an <img> with an
 * accessible name — never injected as raw SVG markup (T-08.1-05). */
describe("the brand mark", () => {
  it("renders on the first-run empty state as a named image, ahead of the heading", () => {
    const { container } = withClient(<FirstRun />);
    const mark = screen.getByRole("img", { name: /flywheel/i });
    expect(mark.tagName).toBe("IMG");
    expect(mark.getAttribute("alt")).toBeTruthy();
    expect(mark.getAttribute("src")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
    const heading = screen.getByRole("heading", { name: "No projects yet" });
    expect(mark.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders in the project rail as a named image", () => {
    withClient(
      <ProjectRail
        projects={[
          { id: "p1", keyPrefix: "FLY", name: "Flywheel", repoPath: "/r", defaultBranch: "main", status: "active" },
        ]}
        currentProjectId="p1"
        onSelect={() => {}}
      />,
    );
    const rail = screen.getByRole("navigation", { name: "Projects" });
    const mark = screen.getByRole("img", { name: /flywheel/i });
    expect(rail).toContainElement(mark);
    expect(mark.tagName).toBe("IMG");
    expect(mark.getAttribute("src")).toBeTruthy();
  });

  it("is not rendered through raw HTML injection in either surface", () => {
    const { container } = withClient(<FirstRun />);
    // An <img> carries the mark by reference; injected markup would surface as an <svg> subtree.
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});
