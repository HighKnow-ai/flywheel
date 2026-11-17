/// <reference types="vite/client" />
/**
 * The screens the M2-to-M4 walk does not reach, and every screen again on stress data (issue #192): the steps
 * the 2 parts (`stress-1` to `stress-2`, `*.critique.browser.test.tsx`) share.
 *
 * The walk (`m2-flow-1` to `m2-flow-6`, steps in `m2-walk.tsx`) runs on clean data. The parts render the real `<App />` over
 * `stress-fixture.ts`: a project with a long name and path, fifty-odd Stories with long titles, a session log
 * shaped like real Claude CLI output, many Needs-you items and Proposals, a review with twenty-six files; plus
 * the empty projects, first run, Register project, an unreachable project, Settings, Worktrees, an orphaned run,
 * a missing `claude`, a read that fails, the launch sheet, the palette and the Merge dialogs. Each screen goes
 * through `capture()`: four window sizes, the layout-defect check, and in the critique run a screenshot.
 *
 * Screens are named `s<nn>-…` so they sort after the walk's numbered ones.
 *
 * WHY 2 FILES AND NOT ONE (#1732): the screens wait on real timers and not on the CPU, and Vitest runs the files
 * of a browser arm side by side, each in its own page. The reasons, and the rule for a new screen, are in
 * `m2-walk.tsx`. Each part writes its own defect report, `layout-defects-stress-<part>-<scheme>.json`.
 */
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import { queryClient } from "../../adapters/queryClient";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { useTriageDrawer } from "../../proposals/triageStore";
import App from "../../App";
import { setReviewInFixture } from "./m2-fixture";
import { BIG, installStressBackend, setBigReviewMergeable, STRESS, type StressOptions } from "./stress-fixture";
import { at } from "../present";
import { settle } from "./capture";

export const { LONG_STORY, REVIEW_STORY } = STRESS;

/** Catches a render error, so a screen that crashes (as s33 did before #197) fails its own test, not the whole run. */
export class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  override render() {
    return this.state.crashed ? <p role="alert">The app crashed</p> : this.props.children;
  }
}

export async function renderApp(options: StressOptions = {}, before?: () => void) {
  installStressBackend(options);
  before?.();
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(
    <CrashBoundary>
      <App />
    </CrashBoundary>,
    { container: root },
  );
  await settle(700);
}

export async function bigBoard(before?: () => void, options: StressOptions = {}) {
  await renderApp(options, () => {
    useUiStore.getState().setCurrentProjectId(BIG);
    before?.();
  });
  await waitFor(() => {
    if (!document.body.textContent?.includes(STRESS.BIG_NAME)) throw new Error("the big project is not on screen yet");
  });
  if (!before) await screen.findAllByText(/Answer every inbound RFP question/);
  await settle();
}

export async function click(label: string | RegExp, container: HTMLElement | null = null) {
  const scope = container ? within(container) : screen;
  await userEvent.click(at(await scope.findAllByRole("button", { name: label }), 0));
}

/**
 * The hooks every part runs: state is reset before each screen and the DOM and the IPC mock are torn down
 * after it. Call it once, inside the part's `describe`.
 */
export function registerHooks() {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    useTriageDrawer.getState().closeTriage();
    setReviewInFixture("judging");
    setBigReviewMergeable(false);
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });
}
