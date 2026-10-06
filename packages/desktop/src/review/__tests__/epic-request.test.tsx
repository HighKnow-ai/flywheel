/**
 * Behavior under test (08-08-PLAN.md, REVW-05, REVW-02, D-118/D-120/D-132/D-122): an epic's
 * integration branch is proposed from the review surface by previewing the draft exactly as the
 * command returned it and confirming with an epic id ALONE; each local blocker is named (or, for
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
import type {
  EpicRequestOutcomeDto,
  EpicRequestPreviewDto,
  ForgeRequestDto,
} from "../../adapters/tauri";

const draftMock = vi.fn();
const openMock = vi.fn();
const requestMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  forgeEpicRequestDraft: (...args: unknown[]) => draftMock(...args),
  forgeOpenEpicRequest: (...args: unknown[]) => openMock(...args),
  forgeRequestForEpic: (...args: unknown[]) => requestMock(...args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
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

  it("confirming calls the open function with the epic id and no other field", async () => {
    openMock.mockResolvedValue({ kind: "opened", request: request() } satisfies EpicRequestOutcomeDto);
    renderSheet();
    fireEvent.click(await enabledOpenButton());
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    // One argument, and it is the epic id: no title, no body, no branch, no target.
    expect(openMock.mock.calls[0]).toEqual(["e1"]);
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
