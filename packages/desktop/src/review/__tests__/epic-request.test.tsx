/**
 * Behavior under test (08-08-PLAN.md, REVW-05, REVW-02, D-118/D-120/D-132/D-122): an epic's
 * integration branch is proposed from the review surface by previewing the draft exactly as the
 * command returned it and confirming with an epic id and the content hash that preview carried (a
 * confirm whose draft moved since is refused and re-rendered, G-08-5); each local blocker is named (or, for
 * "no forge", absent); a forge CLI that is missing or unauthenticated is named; a push that landed
 * without a request is reported as exactly that; an epic that already has a request shows it
 * read-only; and the header toggle moves one surface between a task and its epic.
 *
 * The adapter mock lists ONLY what these components may call, so a status setter or a second open
 * path would fail structurally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EpicRequestBar, EpicRequestSheet, safeHref } from "../EpicRequestSheet";
import { ReviewSurface } from "../ReviewSurface";
import { useUiStore } from "../../state/uiStore";
import type {
  EpicRequestOutcomeDto,
  EpicRequestPreviewDto,
  ForgeRequestDto,
  ReviewFilesDto,
} from "../../adapters/tauri";

const draftMock = vi.fn();
const openMock = vi.fn();
const requestMock = vi.fn();
const filesMock = vi.fn();
const criteriaStateMock = vi.fn();
const precheckMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  forgeEpicRequestDraft: (...args: unknown[]) => draftMock(...args),
  forgeOpenEpicRequest: (...args: unknown[]) => openMock(...args),
  forgeRequestForEpic: (...args: unknown[]) => requestMock(...args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  // The surface (the scope toggle) reads these; there is no status setter in this list on purpose.
  reviewFiles: (...args: unknown[]) => filesMock(...args),
  reviewFilePatch: () =>
    Promise.resolve(
      "diff --git a/src/lib.rs b/src/lib.rs\nindex 1111111..2222222 100644\n--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,3 +1,3 @@\n fn main() {\n-    let x = 1;\n+    let x = 2;\n }\n",
    ),
  reviewMergePrecheck: (...args: unknown[]) => precheckMock(...args),
  reviewCriteriaState: (...args: unknown[]) => criteriaStateMock(...args),
  reviewEpicTaskRollup: () => Promise.resolve([]),
  criterionCheckWithAnchor: () => Promise.resolve(),
  invokeCommand: (command: string, args?: { scope?: string; itemId?: string }) => {
    // The item panel's list and the rail share one query key and one fetch, so whichever mounts
    // first supplies the read; both reach the same command.
    if (command === "review_criteria_state") return criteriaStateMock(args?.scope, args?.itemId);
    if (command === "epic_list_all") {
      return Promise.resolve({ epics: [{ id: "e1", key: "FLY-1", title: "The epic" }], total: 1, truncated: false });
    }
    return Promise.resolve([]);
  },
}));

function request(overrides: Partial<ForgeRequestDto> = {}): ForgeRequestDto {
  return {
    state: "Open",
    ci: "None",
    number: 42,
    title: "The epic",
    url: "https://github.com/acme/app/pull/42",
    ciUrl: null,
    isDraft: false,
    targetBranch: "main",
    ...overrides,
  };
}

function ready(): EpicRequestPreviewDto {
  return {
    blocker: null,
    draft: {
      title: "FLY-7 The epic",
      body: "## Criteria\n- [x] it works\n\n## Tasks\n- FLY-8 integrated",
      headBranch: "flywheel/epic-7",
      targetBranch: "main",
      contentHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    },
  };
}

function withClient(node: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

/** The confirm button exists (disabled) before the draft arrives; wait until it is usable. */
async function enabledOpenButton() {
  const button = await screen.findByRole("button", { name: "Open request" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  return button;
}

function renderSheet(onClose = vi.fn()) {
  const result = render(withClient(<EpicRequestSheet epicId="e1" onClose={onClose} />));
  return { ...result, onClose };
}

beforeEach(() => {
  draftMock.mockReset().mockResolvedValue(ready());
  openMock.mockReset();
  requestMock.mockReset().mockResolvedValue(null);
  filesMock.mockReset();
  criteriaStateMock.mockReset().mockResolvedValue([]);
  precheckMock.mockReset().mockReturnValue(new Promise(() => {}));
  useUiStore.setState({ reviewSurface: null });
});

afterEach(cleanup);

describe("EpicRequestSheet: preview then confirm", () => {
  it("previews the title and body exactly as the command returned them", async () => {
    renderSheet();
    const dialog = await screen.findByRole("dialog", { name: "Epic request sheet" });
    expect(await within(dialog).findByText("FLY-7 The epic")).toBeTruthy();
    const pre = dialog.querySelector("pre");
    expect(pre?.textContent).toBe(ready().draft?.body);
    expect(within(dialog).getByText(/flywheel\/epic-7 → main/)).toBeTruthy();
  });

  it("confirming calls the open function with the epic id and the preview's content hash, nothing else", async () => {
    openMock.mockResolvedValue({ kind: "opened", request: request() } satisfies EpicRequestOutcomeDto);
    renderSheet();
    fireEvent.click(await enabledOpenButton());
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    // Two arguments: the epic id and the hash the rendered preview carried. No title, no body, no
    // branch, no target.
    expect(openMock).toHaveBeenCalledWith("e1", ready().draft?.contentHash);
    expect(openMock.mock.calls[0]).toHaveLength(2);
  });

  it("a draftChanged rejection re-renders the current text with a notice instead of an alert, and the next confirm carries the new hash", async () => {
    const movedHash = "1111111111111111111111111111111111111111111111111111111111111111";
    const moved: EpicRequestPreviewDto = {
      blocker: null,
      draft: {
        ...(ready().draft as NonNullable<EpicRequestPreviewDto["draft"]>),
        body: "## Criteria\n- [ ] it works\n- [ ] it was reviewed\n\n## Tasks\n- FLY-8 integrated",
        contentHash: movedHash,
      },
    };
    draftMock.mockReset().mockResolvedValueOnce(ready()).mockResolvedValue(moved);
    openMock
      .mockRejectedValueOnce(new Error("draftChanged"))
      .mockResolvedValue({ kind: "opened", request: request() } satisfies EpicRequestOutcomeDto);
    renderSheet();
    fireEvent.click(await enabledOpenButton());

    const dialog = await screen.findByRole("dialog", { name: "Epic request sheet" });
    expect(await within(dialog).findByText(/The board changed while this sheet was open/)).toBeTruthy();
    await waitFor(() => expect(dialog.querySelector("pre")?.textContent).toBe(moved.draft?.body));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Request result")).toBeNull();
    expect(draftMock).toHaveBeenCalledTimes(2);

    fireEvent.click(await enabledOpenButton());
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2));
    expect(openMock.mock.calls[0]).toEqual(["e1", ready().draft?.contentHash]);
    expect(openMock.mock.calls[1]).toEqual(["e1", movedHash]);
    await screen.findByText(/Request opened/);
  });

  it("any other rejection category still alerts and does not re-fetch the draft", async () => {
    openMock.mockRejectedValue(new Error("cliFailed:gh"));
    renderSheet();
    fireEvent.click(await enabledOpenButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/gh could not be read right now/);
    expect(screen.queryByText(/The board changed while this sheet was open/)).toBeNull();
    expect(draftMock).toHaveBeenCalledTimes(1);
  });

  it("opening the sheet performs no write: only the draft is read", async () => {
    renderSheet();
    await enabledOpenButton();
    expect(draftMock).toHaveBeenCalledWith("e1");
    expect(openMock).not.toHaveBeenCalled();
  });

  it("cancelling closes without any further call", async () => {
    const { onClose } = renderSheet();
    await enabledOpenButton();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("a second activation while the first is in flight does not open twice", async () => {
    let resolveOpen: (value: EpicRequestOutcomeDto) => void = () => {};
    openMock.mockReturnValue(new Promise<EpicRequestOutcomeDto>((r) => (resolveOpen = r)));
    renderSheet();
    const button = await enabledOpenButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(openMock).toHaveBeenCalledTimes(1);
    resolveOpen({ kind: "opened", request: request() });
    await screen.findByText(/Request opened/);
  });
});

describe("EpicRequestSheet: the four blockers", () => {
  it("no integration branch: names it and offers no request action", async () => {
    draftMock.mockResolvedValue({ blocker: "noIntegrationBranch", draft: null });
    renderSheet();
    expect(await screen.findByText(/No integration branch has been cut/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open request" })).toBeNull();
  });

  it("nothing to propose: names it and offers no request action", async () => {
    draftMock.mockResolvedValue({ ...ready(), blocker: "nothingToPropose" });
    renderSheet();
    expect(await screen.findByText(/has nothing the default branch does not/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open request" })).toBeNull();
  });

  it("no remote: names the missing remote", async () => {
    draftMock.mockResolvedValue({ ...ready(), blocker: "noRemote" });
    renderSheet();
    expect(await screen.findByText(/no remote named origin/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open request" })).toBeNull();
  });

  it("no forge: renders nothing at all", async () => {
    draftMock.mockResolvedValue({ ...ready(), blocker: "noForgeConfigured" });
    const { container } = renderSheet();
    await waitFor(() => expect(draftMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(container.innerHTML).toBe("");
    expect(document.body.textContent).toBe("");
  });
});

describe("EpicRequestSheet: what happened", () => {
  async function confirm() {
    fireEvent.click(await enabledOpenButton());
  }

  it("a missing forge CLI is named with the condition", async () => {
    openMock.mockRejectedValue(new Error("cliNotInstalled:gh"));
    renderSheet();
    await confirm();
    expect(await screen.findByText(/gh is not installed/)).toBeTruthy();
  });

  it("an unauthenticated forge CLI is named with the command to run", async () => {
    openMock.mockRejectedValue(new Error("cliNotAuthenticated:glab"));
    renderSheet();
    await confirm();
    expect(await screen.findByText(/glab auth login/)).toBeTruthy();
  });

  it("an unrecognised rejection never prints raw text", async () => {
    openMock.mockRejectedValue(new Error("fatal: something raw from git"));
    renderSheet();
    await confirm();
    expect(await screen.findByText("The request could not be opened.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("something raw");
  });

  it("a rejected push says no request was created", async () => {
    openMock.mockResolvedValue({ kind: "pushRejected" } satisfies EpicRequestOutcomeDto);
    renderSheet();
    await confirm();
    expect(await screen.findByText(/push was rejected, so no request was created/)).toBeTruthy();
  });

  it("a push that landed without a request is reported as exactly that, never as success", async () => {
    openMock.mockResolvedValue({ kind: "pushedButNotOpened", branch: "flywheel/epic-7" } satisfies EpicRequestOutcomeDto);
    renderSheet();
    await confirm();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Pushed, but no request was opened/);
    expect(alert.textContent).toMatch(/flywheel\/epic-7 is now on the remote and no request exists/);
    expect(document.body.textContent).not.toMatch(/Request opened/);
  });

  it("a successful open names the request and is distinct from the partial outcome", async () => {
    openMock.mockResolvedValue({ kind: "opened", request: request() } satisfies EpicRequestOutcomeDto);
    renderSheet();
    await confirm();
    const status = (await screen.findByText(/Request opened/)).closest("p") as HTMLElement;
    expect(status.textContent).toMatch(/Request opened: #42 The epic/);
    expect(status.textContent).not.toMatch(/Pushed, but no request/);
  });

  it("an already-open outcome shows the existing request and says nothing was pushed", async () => {
    openMock.mockResolvedValue({ kind: "alreadyOpen", request: request({ number: 9 }) } satisfies EpicRequestOutcomeDto);
    renderSheet();
    await confirm();
    expect(await screen.findByText(/already has an open request/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/#9/);
    expect(document.body.textContent).toMatch(/Nothing was pushed or created/);
  });

  it("a forge-supplied link is rendered only for a plain web scheme", async () => {
    openMock.mockResolvedValue({
      kind: "opened",
      request: request({ url: "javascript:alert(1)" }),
    } satisfies EpicRequestOutcomeDto);
    renderSheet();
    await confirm();
    await screen.findByText(/Request opened/);
    expect(document.querySelector("a")).toBeNull();
    expect(document.body.textContent).toMatch(/#42 The epic/);
  });
});

describe("safeHref", () => {
  it("allows http and https", () => {
    expect(safeHref("https://github.com/a/b/pull/1")).toBe("https://github.com/a/b/pull/1");
    expect(safeHref("http://forge.local/mr/2")).toBe("http://forge.local/mr/2");
  });

  it("refuses every other scheme and anything unparseable", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ssh://git@host/x", "not a url", ""]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe("EpicRequestBar", () => {
  it("offers the action when nothing blocks it, and opens the sheet on click", async () => {
    const onOpen = vi.fn();
    render(withClient(<EpicRequestBar epicId="e1" onOpen={onOpen} />));
    fireEvent.click(await screen.findByRole("button", { name: "Open request" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("shows an existing open request read-only and offers no second open", async () => {
    requestMock.mockResolvedValue(request({ number: 17 }));
    render(withClient(<EpicRequestBar epicId="e1" onOpen={vi.fn()} />));
    await screen.findByText(/#17 The epic/);
    expect(screen.queryByRole("button", { name: "Open request" })).toBeNull();
    expect(requestMock).toHaveBeenCalledWith("e1");
  });

  it("a merged request for the branch does not hide the action", async () => {
    requestMock.mockResolvedValue(request({ state: "Merged" }));
    render(withClient(<EpicRequestBar epicId="e1" onOpen={vi.fn()} />));
    expect(await screen.findByRole("button", { name: "Open request" })).toBeTruthy();
  });

  it("names a blocker the user can change, and renders nothing for no forge", async () => {
    draftMock.mockResolvedValue({ ...ready(), blocker: "noRemote" });
    const first = render(withClient(<EpicRequestBar epicId="e1" onOpen={vi.fn()} />));
    expect(await screen.findByText(/no remote named origin/)).toBeTruthy();
    first.unmount();

    draftMock.mockResolvedValue({ ...ready(), blocker: "noForgeConfigured" });
    const second = render(withClient(<EpicRequestBar epicId="e1" onOpen={vi.fn()} />));
    await waitFor(() => expect(draftMock).toHaveBeenCalledTimes(2));
    expect(second.container.textContent).toBe("");
  });
});

const FILE = { path: "src/lib.rs", oldPath: null, status: "M", added: 1, removed: 1, binary: false };

/** `reviewFiles` answers by scope: a task resolves against its epic, an epic against the default branch. */
function filesFor(taskEpicId: string | null = "e1", epicResolves = true) {
  filesMock.mockImplementation((scope: string, itemId: string): Promise<ReviewFilesDto> => {
    if (scope === "task") {
      return Promise.resolve({
        target: {
          state: "resolved",
          postMerge: false,
          base: "flywheel/epic-1",
          head: "flywheel/task-1",
          projectId: "p1",
          epicId: taskEpicId,
          taskId: itemId,
        },
        files: [FILE],
      });
    }
    return Promise.resolve(
      epicResolves
        ? {
            target: {
              state: "resolved",
              postMerge: false,
              base: "main",
              head: "flywheel/epic-1",
              projectId: "p1",
              epicId: itemId,
              taskId: null,
            },
            files: [{ ...FILE, path: "src/epic-only.rs" }],
          }
        : {
            target: {
              state: "noIntegrationBranch",
              postMerge: false,
              base: null,
              head: null,
              projectId: null,
              epicId: null,
              taskId: null,
            },
            files: [],
          },
    );
  });
}

function renderSurface(props: {
  scope: "task" | "epic";
  itemId: string;
  label: string;
  fromTask?: { itemId: string; label: string };
}) {
  const client = new QueryClient();
  const ui = (p: typeof props) => (
    <QueryClientProvider client={client}>
      <ReviewSurface {...p} onBack={vi.fn()} />
    </QueryClientProvider>
  );
  const result = render(ui(props));
  return { ...result, rerenderWith: (p: typeof props) => result.rerender(ui(p)) };
}

function mergeReady() {
  return {
    state: "ready",
    epicKey: "FLY-1",
    sourceBranch: "flywheel/task-1",
    targetBranch: "flywheel/epic-1",
    commitCount: 1,
    fileCount: 1,
    conflictedFiles: [],
  };
}

describe("ReviewSurface: the scope toggle", () => {
  it("task scope renders the task's criteria rail and file list and offers Merge, not the request", async () => {
    filesFor();
    precheckMock.mockResolvedValue(mergeReady());
    renderSurface({ scope: "task", itemId: "t1", label: "FLY-9 A task" });
    expect(await screen.findByText("src/lib.rs")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Criteria rail" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Merge" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open request" })).toBeNull();
    await waitFor(() => expect(criteriaStateMock).toHaveBeenCalledWith("task", "t1"));
  });

  it("toggling to the whole epic writes the store field with the epic id and where it came from", async () => {
    filesFor();
    renderSurface({ scope: "task", itemId: "t1", label: "FLY-9 A task" });
    await screen.findByText("src/lib.rs");
    await waitFor(() => expect(screen.getByRole("button", { name: "Whole epic" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Whole epic" }));
    expect(useUiStore.getState().reviewSurface).toEqual({
      scope: "epic",
      itemId: "e1",
      label: "FLY-1 The epic",
      fromTask: { itemId: "t1", label: "FLY-9 A task" },
    });
  });

  it("epic scope renders the epic's criteria and accumulated files, the request action, and no Merge", async () => {
    filesFor();
    precheckMock.mockResolvedValue(mergeReady());
    renderSurface({ scope: "epic", itemId: "e1", label: "FLY-1 The epic", fromTask: { itemId: "t1", label: "FLY-9 A task" } });
    expect(await screen.findByText("src/epic-only.rs")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Open request" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Merge" })).toBeNull();
    await waitFor(() => expect(criteriaStateMock).toHaveBeenCalledWith("epic", "e1"));
    expect(precheckMock).not.toHaveBeenCalled();
  });

  it("toggling back writes the same task into the store", async () => {
    filesFor();
    renderSurface({ scope: "epic", itemId: "e1", label: "FLY-1 The epic", fromTask: { itemId: "t1", label: "FLY-9 A task" } });
    await screen.findByText("src/epic-only.rs");
    fireEvent.click(screen.getByRole("button", { name: "This task" }));
    expect(useUiStore.getState().reviewSurface).toEqual({ scope: "task", itemId: "t1", label: "FLY-9 A task" });
  });

  it("is absent for a task with no epic", async () => {
    filesFor(null);
    renderSurface({ scope: "task", itemId: "t1", label: "FLY-9 A task" });
    await screen.findByText("src/lib.rs");
    expect(screen.queryByRole("group", { name: "Review scope" })).toBeNull();
  });

  it("opening directly in epic scope renders epic scope with no toggle interaction", async () => {
    filesFor();
    renderSurface({ scope: "epic", itemId: "e1", label: "FLY-1 The epic" });
    expect(await screen.findByText("src/epic-only.rs")).toBeTruthy();
    expect(screen.getByText("Epic review")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Review scope" })).toBeNull();
  });

  it("an epic with no integration branch renders the absence, no files, no action, and still its criteria", async () => {
    filesFor("e1", false);
    renderSurface({ scope: "epic", itemId: "e1", label: "FLY-1 The epic" });
    expect(await screen.findByText(/has no integration branch yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open request" })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Changed files" })).queryAllByRole("listitem")).toEqual([]);
    expect(screen.getByRole("complementary", { name: "Criteria rail" })).toBeTruthy();
    await waitFor(() => expect(criteriaStateMock).toHaveBeenCalledWith("epic", "e1"));
  });

  it("switching scope clears the line selection", async () => {
    filesFor();
    const view = renderSurface({ scope: "task", itemId: "t1", label: "FLY-9 A task" });
    fireEvent.click(await screen.findByRole("button", { name: /src\/lib\.rs/ }));
    await waitFor(() => expect(document.querySelector(".diff-gutter-insert")).toBeTruthy());
    fireEvent.click(document.querySelector(".diff-gutter-insert") as HTMLElement);
    await screen.findByText(/Selected: src\/lib\.rs/);

    view.rerenderWith({ scope: "epic", itemId: "e1", label: "FLY-1 The epic", fromTask: { itemId: "t1", label: "FLY-9 A task" } });
    await screen.findByText("src/epic-only.rs");
    expect(screen.queryByText(/Selected:/)).toBeNull();
    expect(screen.getByText(/No lines selected/)).toBeTruthy();
  });
});
