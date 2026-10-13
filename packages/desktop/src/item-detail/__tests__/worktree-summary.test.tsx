/**
 * Behavior under test (02-08-PLAN.md Task 1, 02-UI-SPEC.md "Worktree summary", E6; D-130/LINK-11,
 * plan 07-04 Task 3): a task with no worktree renders nothing at all; a task with a worktree
 * renders its branch and absolute path in the Mono role; a long path renders with
 * left-truncation styling while the full string stays in the DOM; the copy affordance copies the
 * full, untruncated path; a null branch renders an inline notice for the missing field while the
 * path still renders; an active worktree renders "Open in editor"/"Open in terminal" buttons that
 * call `worktreeOpen` with the matching surface, share one disabling/error state with each other,
 * and never render a reveal-in-Finder affordance (D-130 rejected that one — its absence assertion
 * is kept exactly as it was).
 *
 * The "missing" describe block below (plan 03-09 Task 2, WORK-06/D-45, 03-UI-SPEC.md
 * "Missing-worktree decision banner") also closes broken window #6
 * (`.planning/WINDOWS.md` row 6, T-02-37's "missing from disk" clause, deferred from Phase 2 to
 * WORK-06) — see the test named for it below.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorktreeSummary } from "../WorktreeSummary";
import type { WorktreeSummaryDto } from "../../adapters/tauri";
import detailCss from "../item-detail.css?raw";

const worktreeSummaryMock = vi.fn();
const worktreeRecreateMock = vi.fn();
const worktreeForgetRecordMock = vi.fn();
const worktreeOpenMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  worktreeSummary: (taskId: string) => worktreeSummaryMock(taskId),
  worktreeRecreate: (taskId: string) => worktreeRecreateMock(taskId),
  worktreeForgetRecord: (taskId: string) => worktreeForgetRecordMock(taskId),
  worktreeOpen: (taskId: string, surface: string) => worktreeOpenMock(taskId, surface),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

function renderSummary(taskId = "task-1") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <WorktreeSummary taskId={taskId} />
    </QueryClientProvider>,
  );
}

const LONG_PATH = "/Users/cyril/Flywheel/threadfin-project/FLY-42-add-worktree-summary";

describe("WorktreeSummary", () => {
  beforeEach(() => {
    worktreeOpenMock.mockReset();
  });

  it("renders nothing at all for a task with no worktree", async () => {
    worktreeSummaryMock.mockResolvedValue(null);
    const { container } = renderSummary();

    await waitFor(() => expect(worktreeSummaryMock).toHaveBeenCalledWith("task-1"));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
  });

  it("renders nothing while the read is in flight", () => {
    worktreeSummaryMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderSummary();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the branch and path as property rows in the body face, not the system monospace stack", async () => {
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const branchNode = await screen.findByText("flywheel/fly-42");
    const pathNode = screen.getByText("/Users/cyril/Flywheel/proj/FLY-42").closest("button") as HTMLElement;
    expect(branchNode.style.fontFamily).toBe("");
    expect(pathNode.style.fontFamily).toBe("");
    expect(screen.getByText("Worktree")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();
  });

  it("renders a long path with left-truncation styling and never wraps to a second row", async () => {
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: LONG_PATH, status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const pathNode = (await screen.findByText(LONG_PATH)).closest("button") as HTMLElement;
    // The full string stays in the DOM (jsdom performs no layout/visual truncation) — the
    // left-truncation contract is proven by the CSS declarations themselves.
    expect(pathNode.className).toContain("detail-clip-left");
    const rule = (selector: string) => {
      const at = detailCss.indexOf(`${selector} {`);
      return at === -1 ? "" : detailCss.slice(at, detailCss.indexOf("}", at));
    };
    expect(rule(".detail-clip-left")).toMatch(/direction:\s*rtl/);
    expect(rule(".detail-clip-left")).toMatch(/text-align:\s*left/);
    expect(rule(".detail-clip")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".detail-clip")).toMatch(/white-space:\s*nowrap/);
    expect(rule(".detail-clip")).toMatch(/min-width:\s*0/);
    // "project and task segments still present" — the tail of the path is what a left-truncation
    // preserves; asserting the full text is present is the DOM-level proof available under jsdom.
    expect(pathNode.querySelector("bdi"), "the path is an isolated LTR run inside the RTL box").not.toBeNull();
    expect(pathNode.textContent).toContain("threadfin-project/FLY-42-add-worktree-summary");
  });

  it("copying the path places the full untruncated path on the clipboard, not the elided string", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: LONG_PATH, status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const copyButton = await screen.findByRole("button", { name: "Copy worktree path" });
    copyButton.click();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_PATH));
  });

  it("renders an inline notice for a null branch while still rendering the path", async () => {
    const summary = { branch: null, path: "/Users/cyril/Flywheel/proj/FLY-42" } as unknown as WorktreeSummaryDto;
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    expect(await screen.findByText("Branch unavailable")).toBeInTheDocument();
    expect(screen.getByText("/Users/cyril/Flywheel/proj/FLY-42")).toBeInTheDocument();
  });

  it("renders an inline notice for a null path while still rendering the branch", async () => {
    const summary = { branch: "flywheel/fly-42", path: null } as unknown as WorktreeSummaryDto;
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    expect(await screen.findByText("Path unavailable")).toBeInTheDocument();
    expect(screen.getByText("flywheel/fly-42")).toBeInTheDocument();
  });

  it("renders Open in editor and Open in terminal buttons for an active worktree, but never a reveal-in-Finder affordance", async () => {
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    await screen.findByText("flywheel/fly-42");
    expect(screen.getByRole("button", { name: /open in editor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open in terminal/i })).toBeInTheDocument();
    // D-130 explicitly rejected reveal-in-Finder — this absence assertion is kept unchanged.
    expect(screen.queryByRole("button", { name: /reveal in finder/i })).not.toBeInTheDocument();
  });

  it("neither Open in editor nor Open in terminal renders for a missing worktree — the existing early return makes them unreachable", async () => {
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "missing" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    await screen.findByText("This worktree is missing from disk.");
    expect(screen.queryByRole("button", { name: /open in editor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in terminal/i })).not.toBeInTheDocument();
  });

  it("Open in editor calls worktreeOpen with the editor surface", async () => {
    worktreeOpenMock.mockResolvedValue(undefined);
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary("task-editor");

    const editorButton = await screen.findByRole("button", { name: /open in editor/i });
    editorButton.click();

    await waitFor(() => expect(worktreeOpenMock).toHaveBeenCalledWith("task-editor", "editor"));
  });

  it("Open in terminal calls worktreeOpen with the terminal surface", async () => {
    worktreeOpenMock.mockResolvedValue(undefined);
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary("task-terminal");

    const terminalButton = await screen.findByRole("button", { name: /open in terminal/i });
    terminalButton.click();

    await waitFor(() => expect(worktreeOpenMock).toHaveBeenCalledWith("task-terminal", "terminal"));
  });

  it("pressing either Open button while one is in flight disables both and issues no second call", async () => {
    let resolveOpen: () => void = () => {};
    worktreeOpenMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const editorButton = await screen.findByRole("button", { name: /open in editor/i });
    const terminalButton = screen.getByRole("button", { name: /open in terminal/i });
    editorButton.click();
    terminalButton.click();

    await waitFor(() => expect(editorButton).toBeDisabled());
    expect(terminalButton).toBeDisabled();
    expect(worktreeOpenMock).toHaveBeenCalledTimes(1);
    resolveOpen();
  });

  it("a rejected Open in editor call renders one failure message naming the program from the error text", async () => {
    worktreeOpenMock.mockRejectedValue(new Error('couldn\'t find "code" — check the command template in Settings'));
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const editorButton = await screen.findByRole("button", { name: /open in editor/i });
    editorButton.click();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("code");
    // Only one failure message renders — the shared slot, not one per button.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

const MISSING_PATH = "/Users/cyril/Flywheel/threadfin-project/FLY-42-missing-worktree";

describe("WorktreeSummary — missing worktree (WORK-06, D-45)", () => {
  // These three are module-level mocks the component calls directly (not props), so — unlike the
  // per-test `vi.fn()` props `PermissionRequestCard`'s own test file uses — call counts and
  // resolved/rejected values persist across tests in this file unless explicitly reset here.
  beforeEach(() => {
    worktreeSummaryMock.mockReset();
    worktreeRecreateMock.mockReset();
    worktreeForgetRecordMock.mockReset();
  });

  function missingSummary(overrides: Partial<WorktreeSummaryDto> = {}): WorktreeSummaryDto {
    return { branch: "flywheel/fly-42", path: MISSING_PATH, status: "missing", ...overrides };
  }

  // Broken window #6 (.planning/WINDOWS.md row 6): T-02-37's "missing from disk" clause was
  // deferred from Phase 2 to WORK-06 — this test is what closes it.
  it("closes broken window #6: tells the user the worktree is not on disk", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    expect(await screen.findByText("This worktree is missing from disk.")).toBeInTheDocument();
  });

  it("replaces the branch/path line entirely — no branch span, no copyable path button, no Remove Worktree action", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    await screen.findByText("This worktree is missing from disk.");
    expect(screen.queryByText("flywheel/fly-42")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy worktree path" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Worktree" })).not.toBeInTheDocument();
  });

  it("renders the glyph, heading, body naming the path, and exactly two equally-weighted actions", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    expect(await screen.findByText("This worktree is missing from disk.")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === `Flywheel expected it at ${MISSING_PATH}, but nothing is there. Recreate it to keep working, or remove the record if you don’t need it anymore.`),
    ).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Recreate Worktree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Record" })).toBeInTheDocument();
  });

  it("gives both actions identical visual weight — same background and border colour", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    const recreateButton = await screen.findByRole("button", { name: "Recreate Worktree" });
    const removeButton = screen.getByRole("button", { name: "Remove Record" });

    expect(getComputedStyle(recreateButton).backgroundColor).toBe(getComputedStyle(removeButton).backgroundColor);
    expect(getComputedStyle(recreateButton).borderColor).toBe(getComputedStyle(removeButton).borderColor);
  });

  it("is absent by construction when the worktree row is not missing — the ordinary branch/path line renders instead", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary({ status: "active" }));
    renderSummary();

    await screen.findByText("flywheel/fly-42");
    expect(screen.queryByText("This worktree is missing from disk.")).not.toBeInTheDocument();
  });

  it("Recreate Worktree calls worktreeRecreate with the task id", async () => {
    worktreeRecreateMock.mockResolvedValue(undefined);
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary("task-missing-1");

    const recreateButton = await screen.findByRole("button", { name: "Recreate Worktree" });
    recreateButton.click();

    await waitFor(() => expect(worktreeRecreateMock).toHaveBeenCalledWith("task-missing-1"));
  });

  it("Remove Record calls worktreeForgetRecord with the task id", async () => {
    worktreeForgetRecordMock.mockResolvedValue(undefined);
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary("task-missing-2");

    const removeButton = await screen.findByRole("button", { name: "Remove Record" });
    removeButton.click();

    await waitFor(() => expect(worktreeForgetRecordMock).toHaveBeenCalledWith("task-missing-2"));
  });

  it("pressing a button while its action is in flight does not issue a second call", async () => {
    let resolveRecreate: () => void = () => {};
    worktreeRecreateMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRecreate = resolve;
      }),
    );
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    const recreateButton = await screen.findByRole("button", { name: "Recreate Worktree" });
    recreateButton.click();
    recreateButton.click();
    recreateButton.click();

    await waitFor(() => expect(worktreeRecreateMock).toHaveBeenCalledTimes(1));
    resolveRecreate();
  });

  it("a rejected recreate leaves the banner mounted and renders an inline error, never unmounting or clearing", async () => {
    worktreeRecreateMock.mockRejectedValue(new Error("git worktree add failed"));
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    const recreateButton = await screen.findByRole("button", { name: "Recreate Worktree" });
    recreateButton.click();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("This worktree is missing from disk.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recreate Worktree" })).toBeInTheDocument();
  });

  it("a rejected forget-record leaves the banner mounted and renders an inline error", async () => {
    worktreeForgetRecordMock.mockRejectedValue(new Error("worktree row not missing"));
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    const removeButton = await screen.findByRole("button", { name: "Remove Record" });
    removeButton.click();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("This worktree is missing from disk.")).toBeInTheDocument();
  });

  it("wraps the interpolated path rather than truncating (overflowWrap: anywhere)", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    const bodyNode = await screen.findByText(
      (_, node) => node?.textContent?.includes(MISSING_PATH) ?? false,
      { selector: "p" },
    );
    expect(bodyNode.style.overflowWrap).toBe("anywhere");
  });

  // Plan 03-18 Task 2 (WORK-06, gap closure): the early return was gated on
  // `summary.status === "missing" && isNonEmptyString(summary.path)` — a pathless missing row fell
  // through to the ordinary render, exposing Remove Worktree on a row the screen just called
  // missing. These three tests each drive a different pathless shape and must all reach the
  // banner, never the ordinary render.
  it.each([
    ["empty string", ""],
    ["null", null],
    ["absent field", undefined],
  ])("renders the missing-worktree banner (not Remove Worktree) when path is %s", async (_label, path) => {
    worktreeSummaryMock.mockResolvedValue(missingSummary({ path } as Partial<WorktreeSummaryDto>));
    renderSummary();

    expect(await screen.findByText("This worktree is missing from disk.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recreate Worktree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Record" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Worktree" })).not.toBeInTheDocument();
  });

  it("the pathless banner body omits the location clause and reads as a complete sentence — never 'at' followed by nothing, never an interpolated empty string", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary({ path: "" } as Partial<WorktreeSummaryDto>));
    renderSummary();

    await screen.findByText("This worktree is missing from disk.");
    expect(
      screen.getByText(
        "Flywheel expected the worktree on disk and found nothing there. Recreate it to keep working, or remove the record if you don’t need it anymore.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\bat\s*,/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bat\.\s/)).not.toBeInTheDocument();
  });

  it("a missing row with a real path still renders the existing sentence naming that path, byte-identical to the populated case", async () => {
    worktreeSummaryMock.mockResolvedValue(missingSummary());
    renderSummary();

    await screen.findByText("This worktree is missing from disk.");
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          `Flywheel expected it at ${MISSING_PATH}, but nothing is there. Recreate it to keep working, or remove the record if you don’t need it anymore.`,
      ),
    ).toBeInTheDocument();
  });

  it("does not reclassify an ordinary pathless ACTIVE row as missing — the hasPath inline-notice path still renders", async () => {
    worktreeSummaryMock.mockResolvedValue(
      missingSummary({ status: "active", path: "" } as Partial<WorktreeSummaryDto>),
    );
    renderSummary();

    expect(await screen.findByText("Path unavailable")).toBeInTheDocument();
    expect(screen.queryByText("This worktree is missing from disk.")).not.toBeInTheDocument();
  });
});
