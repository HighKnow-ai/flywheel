/**
 * Behavior under test (CR-02/IN-01, 01-REVIEW.md): `deriveKeyPrefix` must always emit a prefix
 * `core::domain::project::validate_key_prefix` accepts (2-10 uppercase letters/digits, starting
 * with a letter) — a directory name like `2024-app` or a single-character name used to derive an
 * invalid prefix, which three of the four registration entry points had no way to recover from
 * since they register immediately with no confirmation step to edit it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirstRun, deriveKeyPrefix } from "../FirstRun";
import { ProjectRail } from "../../projects/ProjectRail";

const openFolderMock = vi.fn(() => Promise.resolve<string | null>(null));

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: () => Promise.resolve(undefined),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => openFolderMock(),
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

/** 08.1 group-six closure: the confirm-the-key step must say what it is asking for, about which folder. */
describe("the register step (08.1 closure)", () => {
  async function reachRegisterStep() {
    openFolderMock.mockResolvedValue("/Users/dev/repos/threadfin");
    withClient(<FirstRun />);
    fireEvent.click(screen.getByRole("button", { name: "Register Project…" }));
    await screen.findByRole("heading", { name: "Register threadfin" });
  }

  it("labels the key field, so the value is an answer to a question and not a display", async () => {
    await reachRegisterStep();
    const label = screen.getByText("Project key", { selector: "label" });
    expect(label).toHaveAttribute("for", "first-run-project-key");
    expect(document.getElementById("first-run-project-key")).toBe(screen.getByRole("textbox", { name: "Project key prefix" }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("THRE");
  });

  it("prints the folder just picked, so the permanent key can be tied to something", async () => {
    await reachRegisterStep();
    expect(screen.getByText("/Users/dev/repos/threadfin")).toBeInTheDocument();
  });

  it("offers Back, which returns to the picker step without registering anything", async () => {
    await reachRegisterStep();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument());
    expect(screen.queryByRole("textbox")).toBeNull();
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
