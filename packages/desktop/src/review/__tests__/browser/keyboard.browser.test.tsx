/**
 * UAT item 6 (CR-03, REVW-03/REVW-04): a keyboard-only pass through review in a real WebView —
 * j/k over the file list, Enter to expand, `c` to check a criterion, Tab to Merge, Enter and Space
 * on the confirm button.
 *
 * This is the item the jsdom suite cannot close, and `__tests__/keyboard-activation.test.tsx` says
 * so in its own header: "jsdom does not synthesize a click from Enter on a focused button […]
 * `pressKey` therefore MODELS the WebView rule locally." Modelling the rule is not measuring it: if
 * the engine's real semantics differed from the model, the jsdom suite would stay green. Here the
 * keystrokes go through Playwright into WebKit — the engine family the macOS shell renders in —
 * so the engine decides.
 *
 * It splits into two independent properties, and they do NOT have the same verdict:
 *
 *   1. ACTIVATION. A focused button must still activate on Enter/Space despite
 *      `useRegionBindings`' `window`-level `preventDefault`, and the region binding must not ALSO
 *      fire. Measured below: CR-03 holds in the real engine.
 *   2. REACHABILITY. The button must be focusable by keyboard in the first place. Measured below,
 *      and the same probe run against both engines:
 *         webkit   — buttons focused by 60 Tab presses: 0.  Merge reached: NO.
 *         chromium — buttons focused before reaching Merge: 4.  Merge reached: YES.
 *      Identical page, identical harness. WebKit excludes `<button>` from sequential focus
 *      navigation unless full keyboard access is on (`WKPreferences.tabFocusesLinks`, NO by
 *      default, mirroring Safari's "Press Tab to highlight each item on a webpage"); nothing in
 *      `src-tauri` sets it, and the command palette registers no merge or request command, so on
 *      macOS there is no keyboard route to either confirmation at all. The reachability test below
 *      is therefore expected to FAIL until that is closed — by setting the webview preference, or
 *      by giving the two actions real bindings (in which case rewrite that test to assert the
 *      binding, not Tab).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// See legibility.browser.test.tsx for why the real module is spread before the override.
vi.mock("../../../adapters/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./review-fixture")).adapterModule(),
}));

import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { ReviewSurface } from "../../ReviewSurface";
import { CONFLICTED_PRECHECK, resetSpies, resetState, spies, state } from "./review-fixture";

/** How many Tab presses a keyboard user may reasonably spend. Bounded so an unreachable control
 * fails rather than hangs. */
const TAB_BUDGET = 60;

function renderSurface() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <div className="rack-ground" style={{ height: "900px" }}>
        <ReviewSurface scope="task" itemId="t1" label="FLY-9 Add push retry" onBack={() => {}} onOpenSession={() => {}} />
      </div>
    </QueryClientProvider>,
  );
}

function fileRows(): HTMLButtonElement[] {
  const nav = document.querySelector('nav[aria-label="Changed files"]');
  return Array.from(nav?.querySelectorAll<HTMLButtonElement>("button[aria-expanded]") ?? []);
}

/** Which file row is the surface's current one, read off the painted selection background rather
 * than a test id. `motion.css` transitions that background, so callers must `waitFor` — a snapshot
 * taken mid-transition legitimately shows two rows tinted. */
function focusedRowIndex(): number {
  return fileRows().findIndex((row) => {
    const bg = getComputedStyle(row).backgroundColor;
    return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
  });
}

function expandedFlags(): string {
  return fileRows()
    .map((r) => (r.getAttribute("aria-expanded") === "true" ? "X" : "-"))
    .join("");
}

function buttonNamed(name: string, within: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === name);
}

/** Focus `name` the way a pointer user or a screen reader lands on it, then press `key` through the
 * real engine. This isolates property 1 (activation) from property 2 (reachability) so a
 * reachability gap cannot mask an activation regression. */
async function activateByKey(name: string, key: string, within: ParentNode = document) {
  const target = buttonNamed(name, within);
  expect(target, `no button named ${JSON.stringify(name)}`).toBeTruthy();
  await waitFor(() => expect((target as HTMLButtonElement).disabled).toBe(false));
  (target as HTMLButtonElement).focus();
  expect(document.activeElement, `${name} did not take focus`).toBe(target);
  await userEvent.keyboard(key);
  return target as HTMLButtonElement;
}

async function surfaceReady() {
  await waitFor(() => expect(fileRows().length).toBeGreaterThan(0));
  await screen.findByRole("button", { name: "Merge" });
  await waitFor(() => expect(focusedRowIndex()).toBe(0));
}

beforeEach(() => {
  resetState();
  resetSpies();
});

describe("UAT 6 — the file list and the rail, keyboard only", () => {
  it("moves the file focus with j and k and expands the focused file with Enter", async () => {
    renderSurface();
    await surfaceReady();
    expect(fileRows().length).toBeGreaterThan(2);

    await userEvent.keyboard("j");
    await waitFor(() => expect(focusedRowIndex()).toBe(1));
    await userEvent.keyboard("j");
    await waitFor(() => expect(focusedRowIndex()).toBe(2));
    await userEvent.keyboard("k");
    await waitFor(() => expect(focusedRowIndex()).toBe(1));

    expect(expandedFlags()).toBe("-----");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(expandedFlags()).toBe("-X---"));
    await waitFor(() => expect(document.querySelectorAll(".review-diff").length).toBeGreaterThan(0));
  });

  it("checks the criterion the rail has focused with c, carrying the gutter selection as evidence", async () => {
    renderSurface();
    await surfaceReady();

    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelectorAll(".review-diff .diff-gutter").length).toBeGreaterThan(0));

    // The criteria list is the one review control WebKit's sequential focus DOES reach, because it
    // carries an explicit `tabIndex={0}` rather than relying on being a button. It handles j/k
    // itself and stops them, so `j` here focuses a CRITERION, not a file.
    const list = document.querySelector<HTMLElement>('div[role="list"][aria-label="Criteria"]');
    expect(list, "the criteria list is missing").toBeTruthy();
    for (let i = 0; i <= TAB_BUDGET && document.activeElement !== list; i += 1) await userEvent.keyboard("{Tab}");
    expect(document.activeElement, "the criteria list was not reachable by Tab").toBe(list);

    await userEvent.keyboard("j");
    await userEvent.keyboard("c");
    await waitFor(() => expect(spies.check).toHaveBeenCalledTimes(1));
    expect(spies.check.mock.calls[0][0]).toMatchObject({ scope: "task", itemId: "t1", criterionId: "c1" });
  });
});

describe("UAT 6 — Enter and Space really activate a focused button (CR-03)", () => {
  it("opens the merge sheet with Enter on the header button, without also expanding a file", async () => {
    renderSurface();
    await surfaceReady();
    const before = expandedFlags();

    await activateByKey("Merge", "{Enter}");

    await screen.findByRole("dialog", { name: "Merge sheet" });
    // The negative half of CR-03: the window-level region binding must not have fired too.
    expect(expandedFlags(), "Enter both activated the button and expanded a file").toBe(before);
  });

  it("opens the merge sheet with Space on the header button, without also expanding a file", async () => {
    renderSurface();
    await surfaceReady();
    const before = expandedFlags();

    await activateByKey("Merge", " ");

    await screen.findByRole("dialog", { name: "Merge sheet" });
    expect(expandedFlags(), "Space both activated the button and expanded a file").toBe(before);
  });

  it("confirms the merge with Enter on the sheet's button, with the task id as the whole input", async () => {
    renderSurface();
    await surfaceReady();
    await activateByKey("Merge", "{Enter}");
    const sheet = await screen.findByRole("dialog", { name: "Merge sheet" });

    await activateByKey("Merge", "{Enter}", sheet);

    await waitFor(() => expect(spies.mergeTask).toHaveBeenCalledTimes(1));
    expect(spies.mergeTask.mock.calls[0]).toEqual(["t1"]);
  });

  it("confirms the merge with Space on the sheet's button too, exactly once", async () => {
    renderSurface();
    await surfaceReady();
    await activateByKey("Merge", "{Enter}");
    const sheet = await screen.findByRole("dialog", { name: "Merge sheet" });

    await activateByKey("Merge", " ", sheet);

    await waitFor(() => expect(spies.mergeTask).toHaveBeenCalledTimes(1));
    expect(spies.mergeTask.mock.calls[0]).toEqual(["t1"]);
  });

  it("activates both conflict exits with Enter, each naming the conflicted files first", async () => {
    state.precheck = CONFLICTED_PRECHECK;
    spies.mergeTask.mockResolvedValue({ kind: "conflicted", files: ["src/lib.rs", "src/review/review.css"] });
    renderSurface();
    await surfaceReady();
    await activateByKey("Merge", "{Enter}");
    const sheet = await screen.findByRole("dialog", { name: "Merge sheet" });
    await activateByKey("Merge", "{Enter}", sheet);

    // Scoped to the sheet: both paths also appear in the file list behind it.
    await waitFor(() => {
      const listed = Array.from(sheet.querySelectorAll("li")).map((li) => li.textContent?.trim());
      expect(listed).toContain("src/lib.rs");
      expect(listed).toContain("src/review/review.css");
    });

    await activateByKey("Open in editor", "{Enter}", sheet);
    await waitFor(() => expect(spies.worktreeOpen).toHaveBeenCalledTimes(1));
    expect(spies.worktreeOpen.mock.calls[0]).toEqual(["t1", "editor"]);

    await activateByKey("Start a session to resolve", "{Enter}", sheet);
    await waitFor(() => expect(spies.startAgentRun).toHaveBeenCalledTimes(1));
    expect(spies.startAgentRun.mock.calls[0][0]).toBe("t1");
    expect(spies.startAgentRun.mock.calls[0][1]).toBe("acceptEdits");
  });
});

describe("UAT 6 — reaching those buttons with the keyboard alone", () => {
  it("puts the Merge button in the engine's sequential focus order", async () => {
    renderSurface();
    await surfaceReady();
    const merge = buttonNamed("Merge");
    expect(merge).toBeTruthy();

    let buttonsFocused = 0;
    let reached = false;
    for (let i = 0; i < TAB_BUDGET; i += 1) {
      await userEvent.keyboard("{Tab}");
      if (document.activeElement?.tagName === "BUTTON") buttonsFocused += 1;
      if (document.activeElement === merge) {
        reached = true;
        break;
      }
    }

    expect(
      { buttonsFocused, reached },
      `Merge was not reachable in ${TAB_BUDGET} Tab presses; this engine focused ${buttonsFocused} button(s) in total. ` +
        "See this file's header: WebKit omits <button> from sequential focus navigation unless full " +
        "keyboard access is enabled, and no webview preference or key binding supplies another route.",
    ).toEqual({ buttonsFocused: expect.any(Number), reached: true });
  });
});
