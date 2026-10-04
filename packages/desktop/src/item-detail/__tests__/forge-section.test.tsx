/**
 * Behavior under test (07-08-PLAN.md Task 2, D-120/LINK-05/LINK-06/D-123): a task in a project
 * with no forge configured renders no forge section at all — a genuinely empty container, not
 * merely an absent label (D-120, "absence is the design"); a task with an open/changes-requested/
 * merged/closed request renders its number, title, state in words and a link out to the request;
 * CI renders a result with a link out when `ciUrl` is present and nothing at all when there is no
 * CI; an unmet-criteria count renders a visible unresolved marker; and the three CLI-error
 * outcomes each read differently from each other and never render raw stderr text.
 *
 * Also under test (07-09-PLAN.md Task 3, D-118): the open-request action is absent except for the
 * `noRequest` outcome; pressing it previews the draft and sends nothing; cancelling sends nothing;
 * confirming calls `forgeOpenRequest` with the task id alone (never a title or a body); a
 * CliNotInstalled/CliNotAuthenticated/CliFailed outcome during confirm renders the same three
 * distinct notices the read path uses and leaves the preview open. This file never mocks any
 * status-setting adapter function, so a component call to one would surface as an unhandled
 * "is not a function" failure rather than silently passing — the structural half of "this
 * component sets no status itself".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ForgeSection } from "../ForgeSection";
import type { ForgeReadDto, ForgeRequestDto, RequestDraftDto } from "../../adapters/tauri";

const forgeRequestForTaskMock = vi.fn();
const forgeRequestDraftMock = vi.fn();
const forgeOpenRequestMock = vi.fn();

/** Captured so a test can simulate the real app's `board:changed` emission (fired by
 * `forge_open_request` on success) and prove `useForgeRequest` re-fetches through the SAME
 * invalidation path an externally-opened request would use — no bespoke success handling of its
 * own in `OpenRequestAction`. */
let boardChangedHandler: (() => void) | undefined;

vi.mock("../../adapters/tauri", () => ({
  forgeRequestForTask: (taskId: string) => forgeRequestForTaskMock(taskId),
  forgeRequestDraft: (taskId: string) => forgeRequestDraftMock(taskId),
  forgeOpenRequest: (taskId: string) => forgeOpenRequestMock(taskId),
  subscribeBoardChanged: (handler: () => void) => {
    boardChangedHandler = handler;
    return Promise.resolve(() => {});
  },
}));

function renderSection(taskId = "task-1") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ForgeSection taskId={taskId} />
    </QueryClientProvider>,
  );
}

function baseDraft(overrides: Partial<RequestDraftDto> = {}): RequestDraftDto {
  return {
    title: "Add the forge section",
    body: "FLY-1: Add the forge section\n\n## Acceptance Criteria\n\n- [x] It renders\n",
    headBranch: "flywheel/fly-1-add-the-forge-section",
    targetBranch: "main",
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ForgeRequestDto> = {}): ForgeRequestDto {
  return {
    state: "Open",
    ci: "None",
    number: 42,
    title: "Add the forge section",
    url: "https://github.com/example/repo/pull/42",
    ciUrl: null,
    isDraft: false,
    targetBranch: "main",
    ...overrides,
  };
}

beforeEach(() => {
  forgeRequestForTaskMock.mockReset();
  forgeRequestDraftMock.mockReset();
  forgeOpenRequestMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ForgeSection — absence is the design (D-120)", () => {
  it("renders a genuinely empty container — zero children, not merely an absent label — for the no-forge-configured outcome", async () => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noForgeConfigured" } satisfies ForgeReadDto);
    const { container } = renderSection();

    await waitFor(() => expect(forgeRequestForTaskMock).toHaveBeenCalledWith("task-1"));
    await waitFor(() => expect(container.children.length).toBe(0));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the read is in flight", () => {
    forgeRequestForTaskMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a task with no worktree yet (NoWorktree)", async () => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noWorktree" } satisfies ForgeReadDto);
    const { container } = renderSection();

    await waitFor(() => expect(forgeRequestForTaskMock).toHaveBeenCalledWith("task-1"));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders no CLI notice, no existing-request body and nothing else besides the open-request action for NoRequest", async () => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noRequest" } satisfies ForgeReadDto);
    renderSection();

    const button = await screen.findByRole("button", { name: "Open request" });
    expect(button).toBeInTheDocument();
    expect(screen.queryByText(/could not read the forge/i)).not.toBeInTheDocument();
  });
});

describe("ForgeSection — the open-request action is absent except for NoRequest (D-118)", () => {
  it("is absent for the request outcome — the section already renders an existing request", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest(),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);
    renderSection();

    await screen.findByText("Open");
    expect(screen.queryByRole("button", { name: "Open request" })).not.toBeInTheDocument();
  });

  it("is absent for the CLI-error outcomes", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "cliNotInstalled",
      cli: "gh",
    } satisfies ForgeReadDto);
    renderSection();

    await screen.findByText(/not installed/i);
    expect(screen.queryByRole("button", { name: "Open request" })).not.toBeInTheDocument();
  });
});

describe("ForgeSection — preview, then open (plan 07-09, D-118)", () => {
  it("pressing the action fetches and renders the draft's title and body, sending nothing yet", async () => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noRequest" } satisfies ForgeReadDto);
    forgeRequestDraftMock.mockResolvedValue(baseDraft());
    renderSection();

    const button = await screen.findByRole("button", { name: "Open request" });
    fireEvent.click(button);

    await screen.findByText("Add the forge section");
    expect(screen.getByText(/Acceptance Criteria/)).toBeInTheDocument();
    expect(forgeRequestDraftMock).toHaveBeenCalledWith("task-1");
    expect(forgeOpenRequestMock).not.toHaveBeenCalled();
  });

  it("cancelling returns to the button and sends nothing", async () => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noRequest" } satisfies ForgeReadDto);
    forgeRequestDraftMock.mockResolvedValue(baseDraft());
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Open request" }));
    await screen.findByText("Add the forge section");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Add the forge section")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Open request" })).toBeInTheDocument();
    expect(forgeOpenRequestMock).not.toHaveBeenCalled();
  });

  it("confirming calls forgeOpenRequest with the task id alone and disables the control while in flight", async () => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noRequest" } satisfies ForgeReadDto);
    forgeRequestDraftMock.mockResolvedValue(baseDraft());
    let resolveOpen: (() => void) | undefined;
    forgeOpenRequestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveOpen = () =>
          resolve({
            state: "Open",
            ci: "None",
            number: 1,
            title: "Add the forge section",
            url: "https://github.com/example/repo/pull/1",
            ciUrl: null,
            isDraft: false,
            targetBranch: "main",
          } satisfies ForgeRequestDto);
      }),
    );
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Open request" }));
    await screen.findByText("Add the forge section");

    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    fireEvent.click(confirmButton);

    expect(forgeOpenRequestMock).toHaveBeenCalledTimes(1);
    expect(forgeOpenRequestMock).toHaveBeenCalledWith("task-1");
    expect(forgeOpenRequestMock.mock.calls[0]).toHaveLength(1);
    await waitFor(() => expect(confirmButton).toBeDisabled());

    resolveOpen?.();
    await waitFor(() => expect(forgeOpenRequestMock).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["cliNotInstalled:gh", /not installed/i],
    ["cliNotAuthenticated:glab", /not authenticated/i],
    ["cliFailed:gh", /could not read the forge/i],
  ])("a %s rejection renders its own notice and leaves the preview open to retry", async (message, pattern) => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noRequest" } satisfies ForgeReadDto);
    forgeRequestDraftMock.mockResolvedValue(baseDraft());
    forgeOpenRequestMock.mockRejectedValue(new Error(message));
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Open request" }));
    await screen.findByText("Add the forge section");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(pattern)).toBeInTheDocument();
    // The preview stays open — title/body and the confirm control are still present to retry.
    expect(screen.getByText("Add the forge section")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("a successful open renders the new request's state, with no separate success banner", async () => {
    forgeRequestForTaskMock.mockResolvedValueOnce({ outcome: "noRequest" } satisfies ForgeReadDto);
    forgeRequestDraftMock.mockResolvedValue(baseDraft());
    forgeOpenRequestMock.mockResolvedValue({
      state: "Open",
      ci: "None",
      number: 7,
      title: "Add the forge section",
      url: "https://github.com/example/repo/pull/7",
      ciUrl: null,
      isDraft: false,
      targetBranch: "main",
    } satisfies ForgeRequestDto);
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Open request" }));
    await screen.findByText("Add the forge section");

    // Once `forgeOpenRequest` resolves, the real app's `board:changed` emit invalidates
    // `useForgeRequest` — simulated here by resolving the mock and then firing the SAME
    // `subscribeBoardChanged` handler the component itself registered.
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest({ number: 7, url: "https://github.com/example/repo/pull/7" }),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(forgeOpenRequestMock).toHaveBeenCalledTimes(1));
    boardChangedHandler?.();

    const link = await screen.findByRole("link", { name: /#7 Add the forge section/i });
    expect(link).toHaveAttribute("href", "https://github.com/example/repo/pull/7");
    expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
  });
});

describe("ForgeSection — the request (LINK-05)", () => {
  it("renders the request's number, title and an external link to its URL", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest(),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);
    renderSection();

    const link = await screen.findByRole("link", { name: /#42 Add the forge section/i });
    expect(link).toHaveAttribute("href", "https://github.com/example/repo/pull/42");
  });

  it.each([
    ["Open", "Open"],
    ["ChangesRequested", "Changes requested"],
    ["Merged", "Merged"],
    ["ClosedUnmerged", "Closed without merging"],
  ] as const)("renders the %s state in words, not colour alone", async (state, word) => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest({ state }),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);
    renderSection();

    expect(await screen.findByText(word)).toBeInTheDocument();
  });
});

describe("ForgeSection — CI (LINK-06)", () => {
  it.each([
    ["Pending", "CI pending"],
    ["Passed", "CI passed"],
    ["Failed", "CI failed"],
  ] as const)("renders the %s CI result with a link out when ciUrl is present", async (ci, word) => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest({ ci, ciUrl: "https://ci.example.invalid/run/9" }),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);
    renderSection();

    const link = await screen.findByRole("link", { name: word });
    expect(link).toHaveAttribute("href", "https://ci.example.invalid/run/9");
  });

  it("renders the CI result as plain text, not a link, when ciUrl is absent", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest({ ci: "Failed", ciUrl: null }),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);
    renderSection();

    expect(await screen.findByText("CI failed")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "CI failed" })).not.toBeInTheDocument();
  });

  it("renders no CI element at all when the request has no CI", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest({ ci: "None", ciUrl: null }),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);
    renderSection();

    await screen.findByText("Open");
    expect(screen.queryByText(/CI /i)).not.toBeInTheDocument();
  });
});

describe("ForgeSection — unresolved acceptance criteria (D-123)", () => {
  it("renders a visible unresolved marker naming the count when the task carries an unmet-criteria count", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest({ state: "Merged" }),
      unmetCriteria: 2,
    } satisfies ForgeReadDto);
    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent(/2 unresolved acceptance criteria/i);
  });

  it("renders no marker when there is no unmet-criteria count", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "request",
      request: baseRequest({ state: "Merged" }),
      unmetCriteria: 0,
    } satisfies ForgeReadDto);
    renderSection();

    await screen.findByText("Merged");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ForgeSection — the three distinguishable CLI errors (RESEARCH.md open question 3)", () => {
  it("names the missing command for a CLI-not-installed outcome", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "cliNotInstalled",
      cli: "gh",
    } satisfies ForgeReadDto);
    renderSection();

    expect(await screen.findByText(/not installed/i)).toBeInTheDocument();
    expect(screen.getByText("gh")).toBeInTheDocument();
  });

  it("names the auth command for a CLI-not-authenticated outcome", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "cliNotAuthenticated",
      cli: "glab",
    } satisfies ForgeReadDto);
    renderSection();

    expect(await screen.findByText(/not authenticated/i)).toBeInTheDocument();
    expect(screen.getByText("glab auth login")).toBeInTheDocument();
  });

  it("the not-installed and not-authenticated notices are different text", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "cliNotInstalled",
      cli: "gh",
    } satisfies ForgeReadDto);
    const { container: installedContainer } = renderSection("task-a");
    await screen.findByText(/not installed/i);
    const installedText = installedContainer.textContent;

    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "cliNotAuthenticated",
      cli: "gh",
    } satisfies ForgeReadDto);
    const { container: authContainer } = renderSection("task-b");
    await screen.findByText(/not authenticated/i);
    const authText = authContainer.textContent;

    expect(installedText).not.toBe(authText);
  });

  it("renders one generic notice for CliFailed and never renders stderr text", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "cliFailed",
      cli: "gh",
    } satisfies ForgeReadDto);
    const { container } = renderSection();

    expect(await screen.findByText(/could not read the forge/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/stderr|fatal:|exit status/i);
  });

  it("renders the same generic notice for MalformedJson", async () => {
    forgeRequestForTaskMock.mockResolvedValue({
      outcome: "malformedJson",
      cli: "glab",
    } satisfies ForgeReadDto);
    renderSection();

    expect(await screen.findByText(/could not read the forge/i)).toBeInTheDocument();
  });
});
