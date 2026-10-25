/**
 * Behaviour under test (issue #204, DESIGN.md § Feedback): a Story's actions acknowledge themselves the same
 * way everywhere. Start, Resume and Make Ready show a pending state on their own Button (the Spinner, `aria-busy`,
 * the label kept) and say what happened in a toast; Stop and Drop confirm in ConfirmDestructive, the one
 * confirmation for what cannot be taken back. On a roster row each next action is outline, so a card holds one
 * filled primary; a session's ending reads as a StateBadge, a crash in red.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DropControl, MakeReadyControl, ResumeControl, StartControl, StopControl, endingBadge } from "../StoryControls";
import { stateToneOf } from "../../components/StateBadge";
import type { StoryDto } from "../../adapters/tauri";

const storyStart = vi.fn();
const storyResume = vi.fn();
const storyMakeReady = vi.fn();
const storyDrop = vi.fn();
const stopSession = vi.fn();
const notifySuccess = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    storyStart: (...args: unknown[]) => storyStart(...args),
    storyResume: (...args: unknown[]) => storyResume(...args),
    storyMakeReady: (...args: unknown[]) => storyMakeReady(...args),
    storyDrop: (...args: unknown[]) => storyDrop(...args),
    stopSession: (...args: unknown[]) => stopSession(...args),
  };
});

vi.mock("@/lib/notify", () => ({
  notify: { success: (...args: unknown[]) => notifySuccess(...args), error: vi.fn(), dismiss: vi.fn() },
}));

const STORY: StoryDto = {
  id: "s12",
  projectId: "p1",
  epicId: "e1",
  key: "FLY-12",
  title: "Parser",
  description: null,
  state: "ready",
  runsAfterStoryId: null,
  rank: "a",
};

/** A promise the test settles by hand, so the pending state can be looked at. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Pending, as DESIGN.md § Buttons has it: busy, the Spinner in the icon's place, the label kept. */
function expectPending(button: HTMLElement, label: string) {
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "true");
  expect(button.querySelector("[data-slot=spinner]")).not.toBeNull();
  expect(button).toHaveTextContent(label);
}

beforeEach(() => {
  storyStart.mockReset();
  storyResume.mockReset();
  storyMakeReady.mockReset();
  storyDrop.mockReset();
  stopSession.mockReset();
  notifySuccess.mockReset();
});

describe("Start, Resume and Make Ready: pending, then a toast", () => {
  it("Start shows it is starting on its own Button, then says the Story started", async () => {
    const start = deferred();
    storyStart.mockReturnValue(start.promise);
    wrap(<StartControl story={STORY} onError={() => {}} />);
    const button = screen.getByRole("button", { name: "Start FLY-12" });
    fireEvent.click(button);
    expectPending(button, "Start");
    fireEvent.click(button);
    expect(storyStart).toHaveBeenCalledTimes(1);
    expect(notifySuccess).not.toHaveBeenCalled();
    await act(async () => start.resolve());
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
    expect(notifySuccess).toHaveBeenCalledWith(
      "Started FLY-12",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("Start says a refusal where it was clicked, and toasts nothing", async () => {
    storyStart.mockRejectedValue(new Error("FLY-12 runs after FLY-11"));
    const onError = vi.fn();
    wrap(<StartControl story={STORY} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "Start FLY-12" }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith("FLY-12 runs after FLY-11"));
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("Make Ready shows it is pending, then says the Story is Ready", async () => {
    const make = deferred();
    storyMakeReady.mockReturnValue(make.promise);
    wrap(<MakeReadyControl story={{ ...STORY, state: "shaping" }} onError={() => {}} />);
    const button = screen.getByRole("button", { name: "Make FLY-12 Ready" });
    fireEvent.click(button);
    expectPending(button, "Make Ready");
    await act(async () => make.resolve());
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("FLY-12 is Ready", expect.anything()));
  });

  it("Resume starts the new session from its dialog, pending on that Button, then says it resumed", async () => {
    const resume = deferred();
    storyResume.mockReturnValue(resume.promise);
    wrap(<ResumeControl story={STORY} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume FLY-12" }));
    const dialog = await screen.findByRole("dialog", { name: "Resume FLY-12" });
    fireEvent.change(within(dialog).getByLabelText("Resume note for FLY-12"), { target: { value: "Skip the docs" } });
    const submit = within(dialog).getByRole("button", { name: "Start the new session for FLY-12" });
    fireEvent.click(submit);
    expectPending(submit, "Start the new session");
    await act(async () => resume.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(storyResume).toHaveBeenCalledWith("s12", "Skip the docs");
    expect(notifySuccess).toHaveBeenCalledWith("Resumed FLY-12", expect.anything());
  });
});

describe("Stop and Drop confirm in ConfirmDestructive", () => {
  it("Stop asks first, with Keep running on the left and the destructive Stop the session on the right", async () => {
    const stop = deferred<{ status: string; sidecarWarning: string | null }>();
    stopSession.mockReturnValue(stop.promise);
    wrap(<StopControl story={{ ...STORY, state: "running" }} sessionId="ses-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Stop FLY-12" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Stop FLY-12's agent?" });
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Keep running", "Stop the session"]);
    const confirm = within(dialog).getByRole("button", { name: "Stop the session" });
    expect(confirm).toHaveAttribute("data-variant", "destructive");
    expect(stopSession).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expectPending(confirm, "Stop the session");
    await act(async () => stop.resolve({ status: "interrupted", sidecarWarning: null }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(stopSession).toHaveBeenCalledWith("ses-1");
    expect(notifySuccess).toHaveBeenCalledWith("Stopped FLY-12's agent", expect.anything());
  });

  it("Stop stays open and says so when the process could not be confirmed stopped", async () => {
    stopSession.mockResolvedValue({ status: "interrupted", sidecarWarning: "the sidecar did not answer" });
    wrap(<StopControl story={{ ...STORY, state: "running" }} sessionId="ses-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Stop FLY-12" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop the session" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("the sidecar did not answer");
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("Drop asks first, drops on the destructive action, and says so", async () => {
    storyDrop.mockResolvedValue(undefined);
    wrap(<DropControl story={STORY} />);
    fireEvent.click(screen.getByRole("button", { name: "Drop FLY-12" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Drop FLY-12?" });
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Keep", "Drop the Story"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep" }));
    expect(storyDrop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Drop FLY-12" }));
    fireEvent.click(await screen.findByRole("button", { name: "Drop the Story" }));
    await waitFor(() => expect(storyDrop).toHaveBeenCalledWith("s12"));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Dropped FLY-12", expect.anything()));
  });
});

describe("One filled primary per region", () => {
  it("draws Start, Make Ready and Resume as outline unless asked for the filled primary", () => {
    wrap(
      <>
        <StartControl story={STORY} onError={() => {}} />
        <MakeReadyControl story={{ ...STORY, state: "shaping" }} onError={() => {}} />
        <ResumeControl story={STORY} />
        <StartControl story={{ ...STORY, key: "FLY-13" }} onError={() => {}} variant="default" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Start FLY-12" })).toHaveAttribute("data-variant", "outline");
    expect(screen.getByRole("button", { name: "Make FLY-12 Ready" })).toHaveAttribute("data-variant", "outline");
    expect(screen.getByRole("button", { name: "Resume FLY-12" })).toHaveAttribute("data-variant", "outline");
    expect(screen.getByRole("button", { name: "Start FLY-13" })).toHaveAttribute("data-variant", "default");
  });
});

describe("A session's ending as a StateBadge", () => {
  it("reads a hand-off as completed and a crash, an API error or a refusal in red, in words", () => {
    expect(endingBadge("handed_off")).toEqual({ state: "completed", label: "Handed off" });
    for (const reason of ["crash", "api_error", "refusal"] as const) {
      expect(stateToneOf(endingBadge(reason).state)).toBe("destructive");
    }
    expect(endingBadge("crash").label).toBe("Crashed");
    expect(stateToneOf(endingBadge("stopped_by_developer").state)).toBe("neutral");
    expect(endingBadge("usage_limit").label).toBe("Usage limit");
    expect(endingBadge(null).label).toBe("Ending unknown");
  });
});
