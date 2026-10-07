/**
 * Behavior under test (08-10-PLAN.md, CR-03, REVW-04, REVW-05): a keyboard user can confirm a merge
 * and open an epic request with Enter. `useRegionBindings` listens on `window`; before the fix it
 * called `preventDefault` on Enter and Space for any non-text target, so a focused button's
 * activation was cancelled and no keyboard path to either destructive confirmation existed.
 *
 * jsdom does not synthesize a click from Enter on a focused button, and `user-event` is not a
 * dependency. `pressKey` therefore models the WebView rule locally: dispatch the keydown, and click
 * the element only when nothing cancelled it. That final condition is exactly what the bug violated,
 * so these assertions are behavioural (the mutation ran) rather than a source check.
 *
 * The adapter mock lists ONLY what the surface and the sheets may call; `invokeCommand` rejects any
 * unknown command, so a status write fails structurally (D-122).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRegionBindings } from "../../state/keyboard";
import { MergeConfirmSheet } from "../MergeConfirmSheet";
import { EpicRequestSheet } from "../EpicRequestSheet";
import { ReviewSurface } from "../ReviewSurface";
import type { EpicRequestPreviewDto, MergePreviewDto } from "../../adapters/tauri";

const mergeMock = vi.fn();
const openMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => {
    if (command === "criterion_list") return Promise.resolve([]);
    if (command === "review_criteria_state") return Promise.resolve([]);
    if (command === "criterion_revisions") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected command ${command}`));
  },
  reviewCriteriaState: () => Promise.resolve([]),
  reviewEpicTaskRollup: () => Promise.resolve([]),
  startAgentRun: () => Promise.resolve(),
  worktreeOpen: () => Promise.resolve(),
  reviewFiles: () =>
    Promise.resolve({
      target: {
        state: "resolved",
        postMerge: false,
        base: "flywheel/epic",
        head: "flywheel/task",
        projectId: "p1",
        epicId: "e1",
        taskId: "t1",
      },
      files: [{ path: "src/lib.rs", oldPath: null, status: "M", added: 1, removed: 1, binary: false }],
    }),
  reviewFilePatch: () => Promise.resolve(""),
  criterionCheckWithAnchor: () => Promise.resolve(),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  gitFacts: () => Promise.resolve({ uncommitted: [] }),
  reviewMergePrecheck: () => Promise.resolve(readyPrecheck),
  reviewMergeTask: (...args: unknown[]) => mergeMock(...args),
  forgeEpicRequestDraft: () => Promise.resolve(readyDraft),
  forgeOpenEpicRequest: (...args: unknown[]) => openMock(...args),
  forgeRequestForEpic: () => Promise.resolve(null),
}));

const readyPrecheck: MergePreviewDto = {
  state: "ready",
  epicKey: "FLY-7",
  sourceBranch: "flywheel/fly-9-add-retry",
  targetBranch: "flywheel/fly-7-integration",
  commitCount: 3,
  fileCount: 2,
  conflictedFiles: [],
};

const readyDraft: EpicRequestPreviewDto = {
  blocker: null,
  draft: {
    title: "FLY-7 The epic",
    body: "## Tasks",
    headBranch: "flywheel/epic-7",
    targetBranch: "main",
    contentHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  },
};

/** Focus `el`, dispatch a keydown on it, and click it only if nothing cancelled the keydown. */
function pressKey(el: HTMLElement, key: string): KeyboardEvent {
  el.focus();
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  if (!event.defaultPrevented) el.click();
  return event;
}

const expandSpy = vi.fn();
const buttonClick = vi.fn();
const stableHandlers = { "expand-file": expandSpy };

/** The exact listener under test, live without mounting ReviewSurface or CriteriaRail. */
function Harness({ children }: { children?: React.ReactNode }) {
  useRegionBindings("review-surface", "review-surface", stableHandlers);
  return <>{children}</>;
}

function withClient(node: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  expandSpy.mockReset();
  buttonClick.mockReset();
  mergeMock.mockReset().mockResolvedValue({ kind: "alreadyIntegrated" });
  openMock.mockReset().mockResolvedValue({ kind: "pushedNoRequest" });
});

afterEach(cleanup);

describe("Enter and Space outside an interactive element", () => {
  it("Enter on the body still resolves expand-file and is cancelled", () => {
    render(<Harness />);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(expandSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Space on the body still resolves expand-file and is cancelled", () => {
    render(<Harness />);
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(expandSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("Enter on a focused interactive element", () => {
  it("leaves a plain button's keydown uncancelled, does not fire expand-file, and lets it activate", () => {
    render(
      <Harness>
        <button type="button" onClick={buttonClick}>
          Go
        </button>
      </Harness>,
    );
    const event = pressKey(screen.getByRole("button", { name: "Go" }), "Enter");
    expect(event.defaultPrevented).toBe(false);
    expect(expandSpy).not.toHaveBeenCalled();
    expect(buttonClick).toHaveBeenCalledTimes(1);
  });

  it("lets the Merge confirm sheet's Merge button run the merge with the task id alone", async () => {
    render(
      withClient(
        <Harness>
          <MergeConfirmSheet taskId="t1" onClose={() => {}} />
        </Harness>,
      ),
    );
    const merge = await screen.findByRole("button", { name: "Merge" });
    await waitFor(() => expect((merge as HTMLButtonElement).disabled).toBe(false));
    pressKey(merge, "Enter");
    await waitFor(() => expect(mergeMock).toHaveBeenCalledTimes(1));
    expect(mergeMock.mock.calls[0]).toEqual(["t1"]);
  });

  it("lets the Epic request sheet's Open request button open the request with the epic id alone", async () => {
    render(
      withClient(
        <Harness>
          <EpicRequestSheet epicId="e1" onClose={() => {}} />
        </Harness>,
      ),
    );
    const open = await screen.findByRole("button", { name: "Open request" });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    pressKey(open, "Enter");
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(openMock.mock.calls[0]).toEqual(["e1"]);
  });
});

describe("Escape in the review surface (WR-06)", () => {
  const onBack = vi.fn();
  const swallow = (event: Event) => event.preventDefault();

  function renderSurface() {
    return render(
      withClient(
        <ReviewSurface scope="task" itemId="t1" label="FLY-9 Add retry" onBack={onBack} onOpenSession={() => {}} />,
      ),
    );
  }

  beforeEach(() => onBack.mockClear());
  afterEach(() => window.removeEventListener("keydown", swallow, true));

  it("does not pop the surface for an Escape something else already handled", async () => {
    renderSurface();
    await screen.findByRole("button", { name: "Merge" });
    // Capture phase on window runs before the surface's bubbling listener: ordering is guaranteed.
    window.addEventListener("keydown", swallow, true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("pops the surface once for an unhandled Escape with no sheet open", async () => {
    renderSurface();
    await screen.findByRole("button", { name: "Merge" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("does not pop the surface for an Escape while the merge sheet is open", async () => {
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    await screen.findByRole("dialog", { name: "Merge sheet" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
  });
});
