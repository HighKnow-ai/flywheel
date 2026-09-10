/**
 * Behavior under test (plan 02-04 Task 3, acceptance criteria): the header/placeholder/mode
 * labels, Cancel/Escape leaving the start command uncalled, the Enter/⌘Enter contract inside vs.
 * outside the free-text field, an empty instruction still submitting, and the sizing contract.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaunchSheet } from "../LaunchSheet";

const previewMock = vi.fn();
const startMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    previewContextPacket: (taskId: string) => previewMock(taskId),
    startAgentRun: (taskId: string, permissionMode: string, instruction?: string) =>
      startMock(taskId, permissionMode, instruction),
  };
});

function makePacket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    taskKey: "FLY-42",
    taskTitle: "Wire the launch sheet",
    taskDescription: "Some task description",
    epicTitle: "Ship phase 2",
    epicDescription: "Epic description",
    criteria: [{ statement: "Does the thing", verificationHint: "run the test" }],
    branch: "flywheel/fly-42-wire-the-launch-sheet",
    baseRef: "main",
    worktreePath: "/Users/dev/Flywheel/FLY/FLY-42",
    renderedPrompt: "# Wire the launch sheet",
    ...overrides,
  };
}

function renderSheet(props: Partial<React.ComponentProps<typeof LaunchSheet>> = {}) {
  const queryClient = new QueryClient();
  const onClose = props.onClose ?? vi.fn();
  const onStarted = props.onStarted ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LaunchSheet taskId={props.taskId ?? "task-1"} onClose={onClose} onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onStarted };
}

describe("LaunchSheet", () => {
  it("renders the exact header once the preview resolves", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset();
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());
  });

  it("shows the free-text field's exact placeholder", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset();
    renderSheet();

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("Anything else the agent should know for this run? (optional)"),
      ).toBeInTheDocument(),
    );
  });

  it("renders the four mode labels with Accept Edits selected by default", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset();
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    const acceptEdits = screen.getByRole("radio", { name: "Accept Edits" });
    const plan = screen.getByRole("radio", { name: "Plan" });
    const askEveryTime = screen.getByRole("radio", { name: "Ask Every Time" });
    const bypass = screen.getByRole("radio", { name: "Bypass Permissions" });

    expect(acceptEdits).toBeInTheDocument();
    expect(plan).toBeInTheDocument();
    expect(askEveryTime).toBeInTheDocument();
    expect(bypass).toBeInTheDocument();
    expect(acceptEdits).toHaveAttribute("aria-checked", "true");
    expect(plan).toHaveAttribute("aria-checked", "false");
  });

  it.each([
    ["Accept Edits", "acceptEdits"],
    ["Plan", "plan"],
    ["Ask Every Time", "default"],
    ["Bypass Permissions", "bypassPermissions"],
  ])("submits %s as the adapter value %s, with no relabeling", async (label, value) => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset().mockResolvedValue({ id: "run-1", taskId: "task-1", status: "running", permissionMode: value });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Start Work" }));

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledWith("task-1", value, "");
  });

  it("Cancel leaves the start command uncalled", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset();
    const onClose = vi.fn();
    renderSheet({ onClose });

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("Escape leaves the start command uncalled", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset();
    const onClose = vi.fn();
    renderSheet({ onClose });

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("Enter with focus in the body submits", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset().mockResolvedValue({ id: "run-1", taskId: "task-1", status: "running", permissionMode: "acceptEdits" });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
  });

  it("Enter with focus in the free-text field does not submit, but ⌘Enter does", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset().mockResolvedValue({ id: "run-1", taskId: "task-1", status: "running", permissionMode: "acceptEdits" });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    const field = screen.getByLabelText("Instruction");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(startMock).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
  });

  it("submitting with an empty instruction still calls the start command", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset().mockResolvedValue({ id: "run-1", taskId: "task-1", status: "running", permissionMode: "acceptEdits" });
    renderSheet();

    await waitFor(() => expect(screen.getByText("Start Work on FLY-42")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Start Work" }));

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledWith("task-1", "acceptEdits", "");
  });

  it("renders the sheet at 640px wide with an 80vh maximum height", async () => {
    previewMock.mockReset().mockResolvedValue(makePacket());
    startMock.mockReset();
    renderSheet();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveStyle("width: 640px");
    // `toHaveStyle` compares jsdom's RESOLVED computed style, which turns a relative unit like
    // `80vh` into a viewport-dependent pixel value — reading the raw inline style declaration
    // directly is what actually asserts the specified `80vh`, not an incidental resolved number.
    expect(dialog.style.maxHeight).toBe("80vh");
  });

  it("renders nothing when taskId is null", () => {
    previewMock.mockReset();
    startMock.mockReset();
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LaunchSheet taskId={null} onClose={() => {}} onStarted={() => {}} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(previewMock).not.toHaveBeenCalled();
  });
});
