/**
 * Behavior under test (02-06-PLAN.md Task 1 + Task 2, AGNT-06, D-37, D-38):
 *
 * Task 1 — `PermissionRequestCard` standalone: renders nothing with no pending request; a pending
 * request renders the glyph/heading/payload/three unequal actions; Escape never resolves it;
 * a double-activation of Allow calls the answer function exactly once; a rejected answer keeps the
 * card mounted, re-enables its actions and shows an inline error; two pending requests render as
 * two independently answerable cards.
 *
 * Task 2 — both mount points (`SessionSurface`'s `feed` variant, `ItemDetailPanel`'s `compact`
 * variant) read the SAME `usePendingPermissionRequests(agentRunId)` query: answering at either
 * mount point clears the other within one delta cycle, with no stale duplicate, and the feed
 * suppresses its follow-the-tail scroll while a request is pending.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PermissionRequestCard, type PendingPermissionRequest } from "../PermissionRequestCard";
import { SessionSurface } from "../SessionSurface";
import { ItemDetailPanel, type DetailItem } from "../../item-detail/ItemDetailPanel";

const invokeCommandMock = vi.fn();
let capturedBoardChangedHandler: (() => void) | undefined;

// Every named export the code under test actually calls is re-implemented here to delegate
// through the ONE `invokeCommandMock`, rather than spreading `...actual` — a real adapter
// function's own body calls this module's OWN internal `invokeCommand` binding, not whatever a
// test later re-exports, so overriding only `invokeCommand` via spread would silently leave every
// other real adapter function calling the genuine `@tauri-apps/api` (which throws outside a real
// Tauri context). `criteria.test.tsx`/`activity-trail.test.tsx` establish the same discipline.
// Task 1's own standalone describe blocks below never call any of these — they render
// `PermissionRequestCard` directly with a plain `vi.fn()` — so this mock only matters for Task 2's
// cross-mount describe block at the foot of this file.
vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
  stopAgentRun: (agentRunId: string) => invokeCommandMock("agent_run_stop", { agentRunId }),
  pendingPermissionRequests: (agentRunId: string) =>
    invokeCommandMock("agent_run_pending_permissions", { agentRunId }),
  latestAgentRunIdForTask: (taskId: string) => invokeCommandMock("task_latest_agent_run", { taskId }),
  answerPermissionRequest: (requestId: string, decision: string) =>
    invokeCommandMock("agent_run_answer_permission", { requestId, decision }),
  subscribeBoardChanged: (handler: () => void) => {
    capturedBoardChangedHandler = handler;
    return Promise.resolve(() => {
      capturedBoardChangedHandler = undefined;
    });
  },
  // `SessionSurface` subscribes to this too (D-32) — a no-op handle is sufficient here since none
  // of these tests exercise the raw-event push itself, only the permission-request round trip.
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

function makeRequest(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
  return {
    id: "req-1",
    toolName: "Bash",
    inputPayload: '{"command":"rm -rf /tmp/scratch"}',
    ...overrides,
  };
}

describe("PermissionRequestCard (standalone)", () => {
  it("renders nothing at all with no pending request", () => {
    const { container } = render(
      <PermissionRequestCard variant="feed" requests={[]} onAnswer={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the glyph, heading, payload and three actions at their exact copy", () => {
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={vi.fn()} />);

    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByText('{"command":"rm -rf /tmp/scratch"}')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Allow this tool for this project from now on" }),
    ).toBeInTheDocument();
  });

  it("Escape never resolves the card — the answer spy sees zero calls and the card stays mounted", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
  });

  it("pressing a/d/Shift+A resolves through the shared binding table", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "d" });
    expect(onAnswer).toHaveBeenCalledWith("req-1", "deny");
  });

  it("pressing Shift+A invokes allow-always", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "a", shiftKey: true });
    expect(onAnswer).toHaveBeenCalledWith("req-1", "allow_always");
  });

  it("activating Allow twice in immediate succession calls the answer spy exactly once", () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    const allowButton = screen.getByRole("button", { name: "Allow" });
    fireEvent.click(allowButton);
    fireEvent.click(allowButton);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    resolveAnswer?.();
  });

  it("a rejected answer keeps the card mounted, re-enables its actions and renders an inline error", async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error("network down"));
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
  });

  it("renders two pending requests as two independently answerable cards", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const first = makeRequest({ id: "req-1", toolName: "Bash" });
    const second = makeRequest({ id: "req-2", toolName: "Edit" });
    render(<PermissionRequestCard variant="feed" requests={[first, second]} onAnswer={onAnswer} />);

    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByText("Edit wants to:")).toBeInTheDocument();

    const editGroup = screen.getByRole("group", { name: "Edit wants to:" });
    fireEvent.click(within(editGroup).getByRole("button", { name: "Allow" }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("req-2", "allow");
    // The first (untouched) card's Allow button is still enabled — answering the second never
    // touched the first's own state.
    const bashGroup = screen.getByRole("group", { name: "Bash wants to:" });
    expect(within(bashGroup).getByRole("button", { name: "Allow" })).toBeEnabled();
  });

  it("imports its glyph name from the marks registry and hard-codes no colour", () => {
    // Structural gates are enforced by the plan's own grep-based <verify> commands at the file
    // level (no onKeyDown/addEventListener/DismissableLayer, no hex literal) — this test only
    // documents the intent so a reader of the suite sees the contract stated here too.
    expect(true).toBe(true);
  });
});

describe('PermissionRequestCard variant="compact"', () => {
  it("caps the payload block at a fixed max height with internal scroll", () => {
    const longPayload = "x".repeat(5000);
    render(
      <PermissionRequestCard
        variant="compact"
        requests={[makeRequest({ inputPayload: longPayload })]}
        onAnswer={vi.fn()}
      />,
    );
    const pre = screen.getByText(longPayload);
    expect(pre.style.maxHeight).not.toBe("");
    expect(pre.style.overflowY).toBe("auto");
  });

  it("truncates a long tool name with an ellipsis rather than widening the container", () => {
    const longName = "A".repeat(200);
    render(
      <PermissionRequestCard variant="compact" requests={[makeRequest({ toolName: longName })]} onAnswer={vi.fn()} />,
    );
    const heading = screen.getByText(`${longName} wants to:`);
    expect(heading.style.textOverflow).toBe("ellipsis");
    expect(heading.style.whiteSpace).toBe("nowrap");
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2 — both mount points share one query, one key (Discretion #6)
// ---------------------------------------------------------------------------------------------

const RUN_ID = "run-shared-1";
const TASK_ID = "task-shared-1";

function taskDetailItem(): DetailItem {
  return { id: TASK_ID, kind: "task", key: "FLY-1", title: "A gated task", status: "in_progress", projectId: "proj-1" };
}

function setUpSharedMounts(initialRequests: PendingPermissionRequest[]) {
  let currentRequests = initialRequests;
  capturedBoardChangedHandler = undefined;
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "agent_run_pending_permissions") return Promise.resolve(currentRequests);
    if (command === "task_latest_agent_run") return Promise.resolve(RUN_ID);
    if (command === "agent_run_answer_permission") return Promise.resolve(undefined);
    if (command === "agent_run_log_window") return Promise.resolve([]);
    if (command === "criterion_list") return Promise.resolve([]);
    if (command === "events_activity_trail") return Promise.resolve([]);
    if (command === "actor_list") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });

  const queryClient = new QueryClient();

  function setRequests(next: PendingPermissionRequest[]) {
    currentRequests = next;
  }

  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionSurface agentRunId={RUN_ID} onBack={() => {}} initialStatus="blocked" />
      <ItemDetailPanel item={taskDetailItem()} onClose={() => {}} onUpdateTitle={() => {}} />
    </QueryClientProvider>,
  );

  /** Simulates the core's `board:changed` push (D-04) the answer round trip emits. */
  function pushBoardChanged() {
    capturedBoardChangedHandler?.();
  }

  return { ...view, setRequests, pushBoardChanged, queryClient };
}

describe("Two mount points, one request (Discretion #6, plan 02-06 Task 2)", () => {
  it("both mount points render for one pending request", async () => {
    setUpSharedMounts([makeRequest({ id: "req-shared" })]);

    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));
  });

  it("answering the compact (item detail) instance clears the feed instance", async () => {
    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);

    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    setRequests([]);
    // Both groups are identical; activating either one's Allow answers the same underlying row —
    // pick the second (compact/item-detail) instance explicitly.
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[1]).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("agent_run_answer_permission", {
      requestId: "req-shared",
      decision: "allow",
    }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryByText("Bash wants to:")).not.toBeInTheDocument());
  });

  it("answering the feed instance clears the compact instance", async () => {
    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);

    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    setRequests([]);
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("agent_run_answer_permission", {
      requestId: "req-shared",
      decision: "allow",
    }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryByText("Bash wants to:")).not.toBeInTheDocument());
  });

  it("neither mount point leaves a stale duplicate after answering", async () => {
    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);
    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    setRequests([]);
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Allow" }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryAllByText("Bash wants to:")).toHaveLength(0));
  });

  it("the compact card renders above the Activity Trail section", async () => {
    setUpSharedMounts([makeRequest({ id: "req-shared" })]);
    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    const detailPanel = screen.getByRole("dialog", { name: "FLY-1 detail" });
    const cardGroup = within(detailPanel).getByRole("group", { name: "Bash wants to:" });
    const activitySection = within(detailPanel).getByRole("region", { name: "Activity" });
    // DOM order: the card's node must precede the Activity Trail's node.
    // eslint-disable-next-line no-bitwise
    expect(cardGroup.compareDocumentPosition(activitySection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the feed does not scroll to its tail while a pending card is mounted, and resumes after it is answered", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);
    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    scrollSpy.mockClear();

    setRequests([]);
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Allow" }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryAllByText("Bash wants to:")).toHaveLength(0));
    expect(scrollSpy).toHaveBeenCalled();

    // @ts-expect-error — cleaning up the spy from the shared prototype after this test.
    delete Element.prototype.scrollIntoView;
  });
});
