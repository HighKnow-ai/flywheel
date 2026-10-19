/**
 * Behavior under test (plan 02-04 Task 3, acceptance criteria): the header/placeholder/mode
 * labels, Cancel/Escape leaving the start command uncalled, the Enter/⌘Enter contract inside vs.
 * outside the free-text field, an empty instruction still submitting, and the sizing contract.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaunchSheet } from "../LaunchSheet";

const storyMock = vi.fn();
const startMock = vi.fn();


vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    storyGet: (storyId: string) => storyMock(storyId),
    startSession: (storyId: string, ...rest: unknown[]) =>
      startMock(storyId, ...rest),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

/** The Story the sheet reads for its title (the context packet preview was deleted, #38). */
function makeStory() {
  return {
    id: "story-1",
    projectId: "p",
    epicId: "epic-1",
    key: "FLY-42",
    title: "Wire the launch sheet",
    description: null,
    state: "ready",
    runsAfterStoryId: null,
    rank: "a",
  };
}

function renderSheet(props: Partial<React.ComponentProps<typeof LaunchSheet>> = {}) {
  const queryClient = new QueryClient();
  const onClose = props.onClose ?? vi.fn();
  const onStarted = props.onStarted ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LaunchSheet storyId={props.storyId ?? "story-1"} onClose={onClose} onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onStarted };
}

describe("LaunchSheet", () => {
  it("renders the exact header once the Story resolves", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset();
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());
  });

  it("shows the free-text field's exact placeholder", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset();
    renderSheet();

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("Anything else the agent should know for this run? (optional)"),
      ).toBeInTheDocument(),
    );
  });

  it("offers no permission-mode choice and sends none: the session kind decides it (ADR 0001)", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset().mockResolvedValue({ id: "run-1", storyId: "story-1", status: "running", permissionMode: "acceptEdits" });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    expect(screen.queryByRole("radiogroup", { name: "Permission mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Work" }));

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledWith("story-1", "");
  });

  it("Cancel leaves the start command uncalled", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset();
    const onClose = vi.fn();
    renderSheet({ onClose });

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("Escape leaves the start command uncalled", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset();
    const onClose = vi.fn();
    renderSheet({ onClose });

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("Enter with focus in the body submits", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset().mockResolvedValue({ id: "run-1", storyId: "story-1", status: "running", permissionMode: "acceptEdits" });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
  });

  it("Enter with focus in the free-text field does not submit, but ⌘Enter does", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset().mockResolvedValue({ id: "run-1", storyId: "story-1", status: "running", permissionMode: "acceptEdits" });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    const field = screen.getByLabelText("Instruction");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(startMock).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
  });

  it("shows the core's refusal and lets the developer retry", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset().mockRejectedValueOnce(new Error("story is not ready"));
    const { onStarted } = renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start Work" }));

    expect(await screen.findByText("story is not ready")).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start Work" })).not.toBeDisabled();
  });

  it("submitting with an empty instruction still calls the start command", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset().mockResolvedValue({ id: "run-1", storyId: "story-1", status: "running", permissionMode: "acceptEdits" });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Start Work" }));

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledWith("story-1", "");
  });

  /**
   * WR-03 (plan 05-09 code review): `handleSubmit` previously guarded double-activation with only
   * `if (starting) return`, a React state read — not necessarily flushed to the DOM (or to the
   * closure a second synchronous call reads) before a second activation fires in the same tick.
   * Raw `element.click()` calls (never `fireEvent.click`, which wraps every dispatch in its own
   * `act()` and flushes state between calls) reproduce the exact race, mirroring this codebase's
   * own established pattern for proving a synchronous-tick guard
   * (`session/SessionSurface.tsx`'s "clicking Stop three times in one synchronous tick" test).
   */
  it("clicking Start Work three times in one synchronous tick calls the start command exactly once", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset().mockReturnValue(new Promise(() => {})); // never resolves within the test
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    const submitButton = screen.getByRole("button", { name: "Start Work" }) as HTMLButtonElement;
    submitButton.click();
    submitButton.click();
    submitButton.click();

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
  });

  it("two synchronous Enter keydowns on the dialog call the start command exactly once", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset().mockReturnValue(new Promise(() => {})); // never resolves within the test
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
  });

  it("renders the sheet at 640px wide with an 80vh maximum height", async () => {
    storyMock.mockReset().mockResolvedValue(makeStory());
    startMock.mockReset();
    renderSheet();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveStyle("width: 640px");
    // `toHaveStyle` compares jsdom's RESOLVED computed style, which turns a relative unit like
    // `80vh` into a viewport-dependent pixel value — reading the raw inline style declaration
    // directly is what actually asserts the specified `80vh`, not an incidental resolved number.
    expect(dialog.style.maxHeight).toBe("80vh");
  });

  it("renders nothing when storyId is null", () => {
    storyMock.mockReset();
    startMock.mockReset();
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LaunchSheet storyId={null} onClose={() => {}} onStarted={() => {}} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(storyMock).not.toHaveBeenCalled();
  });
});
