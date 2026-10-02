/**
 * Behavior under test (07-08-PLAN.md Task 2, D-120/LINK-05/LINK-06/D-123): a task in a project
 * with no forge configured renders no forge section at all — a genuinely empty container, not
 * merely an absent label (D-120, "absence is the design"); a task with an open/changes-requested/
 * merged/closed request renders its number, title, state in words and a link out to the request;
 * CI renders a result with a link out when `ciUrl` is present and nothing at all when there is no
 * CI; an unmet-criteria count renders a visible unresolved marker; and the three CLI-error
 * outcomes each read differently from each other and never render raw stderr text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ForgeSection } from "../ForgeSection";
import type { ForgeReadDto, ForgeRequestDto } from "../../adapters/tauri";

const forgeRequestForTaskMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  forgeRequestForTask: (taskId: string) => forgeRequestForTaskMock(taskId),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

function renderSection(taskId = "task-1") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ForgeSection taskId={taskId} />
    </QueryClientProvider>,
  );
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

  it("renders nothing when the forge is configured but no request exists for this branch (NoRequest)", async () => {
    forgeRequestForTaskMock.mockResolvedValue({ outcome: "noRequest" } satisfies ForgeReadDto);
    const { container } = renderSection();

    await waitFor(() => expect(forgeRequestForTaskMock).toHaveBeenCalledWith("task-1"));
    expect(container).toBeEmptyDOMElement();
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
