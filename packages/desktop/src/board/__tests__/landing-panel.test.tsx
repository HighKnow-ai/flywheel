/**
 * Behaviour under test (issue #1757, ADR 0042): a Landing Story shows the request it waits for, the note the
 * last answer left, and "Check now"; an In review Story shows its landing only when the request was closed
 * without merging; any other Story shows nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LandingPanel } from "../LandingPanel";
import type { StoryDto, StoryLandingDto } from "../../adapters/tauri";

const storyLanding = vi.fn();
const storyLandingRefresh = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    storyLanding: (...args: unknown[]) => storyLanding(...args),
    storyLandingRefresh: (...args: unknown[]) => storyLandingRefresh(...args),
  };
});

function story(state: string): StoryDto {
  return {
    id: "s1",
    projectId: "p1",
    epicId: "e1",
    key: "FLY-7",
    title: "Parse the config",
    description: null,
    state,
    runsAfterStoryId: null,
    runsAfterReason: null,
    rank: "a",
  } as StoryDto;
}

const open: StoryLandingDto = {
  mode: "pull_request",
  forge: "github",
  requestUrl: "https://github.com/acme/app/pull/7",
  requestState: "open",
  note: null,
};

function renderPanel(state: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LandingPanel projectId="p1" story={story(state)} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  storyLanding.mockReset();
  storyLandingRefresh.mockReset();
});

describe("LandingPanel", () => {
  it("names the request and says what happens when it merges", async () => {
    storyLanding.mockResolvedValue(open);
    renderPanel("landing");
    expect(await screen.findByRole("region", { name: "Landing" })).toHaveTextContent(
      "The pull request is open. FLY-7 moves to Merged when the forge says it merged.",
    );
    expect(screen.getByText("https://github.com/acme/app/pull/7")).toBeInTheDocument();
  });

  it("shows the core's note as it stands, for a CLI that is missing or signed out", async () => {
    storyLanding.mockResolvedValue({
      ...open,
      note: "The GitHub CLI is not signed in. Run `gh auth login`, then merge again.",
    });
    renderPanel("landing");
    expect(await screen.findByRole("status")).toHaveTextContent("gh auth login");
  });

  it("asks the forge at once on Check now and reads the landing again", async () => {
    storyLanding.mockResolvedValue(open);
    storyLandingRefresh.mockResolvedValue(open);
    renderPanel("landing");
    fireEvent.click(await screen.findByRole("button", { name: "Check FLY-7 now" }));
    await waitFor(() => expect(storyLandingRefresh).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(storyLanding).toHaveBeenCalledTimes(2));
  });

  it("shows a refusal of Check now", async () => {
    storyLanding.mockResolvedValue(open);
    storyLandingRefresh.mockRejectedValue("failed:story_landing_refresh:ask");
    renderPanel("landing");
    fireEvent.click(await screen.findByRole("button", { name: "Check FLY-7 now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("failed:story_landing_refresh:ask");
  });

  it("tells an In review Story why it is back when its request was closed, and hides an open one", async () => {
    storyLanding.mockResolvedValue({
      ...open,
      requestState: "closed",
      note: "The pull request was closed without merging. Merge again to open a new one, or request changes.",
    });
    const { unmount } = renderPanel("in_review");
    expect(await screen.findByRole("region", { name: "Request closed" })).toHaveTextContent("closed without merging");
    expect(screen.queryByRole("button", { name: /Check/ })).not.toBeInTheDocument();
    unmount();

    storyLanding.mockResolvedValue(open);
    renderPanel("in_review");
    await waitFor(() => expect(storyLanding).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("asks nothing for a Story that is neither Landing nor In review", () => {
    renderPanel("running");
    expect(storyLanding).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
