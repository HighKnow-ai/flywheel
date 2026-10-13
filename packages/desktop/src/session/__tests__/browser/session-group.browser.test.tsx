/**
 * The expensive gate's capture step for surface group four (08.1 plan 17, D-24): the live session
 * surface mid-run (a feed, the pulse running, a permission request pending), the destructive-gate card,
 * the finished run, and the launch sheet open over the session, as the REAL components paint them in
 * WebKit at 1440x900 in whichever colour scheme the config selected. Written into `.impeccable/review/`
 * as `session-group-built-<scheme>-{session,permission-destructive,finished,launch-sheet}-1440x900`.
 *
 * No comp exists for this group (plan 04 comped Mission Control, the item detail and the review surface),
 * so these are reviewed against 08.1-UI-SPEC.md's contract, not an image.
 *
 * Content. The task is THRE-58, the real board's own task: its key, title, epic, branch, base and its three
 * criteria come from `comp-data.json` (the 08.1-03 export). The real board has NO live run, so every feed
 * row, the pending permission requests and the finished run's failure are FIXTURES, each labelled on the
 * page. Nothing is seeded to make the surface look populated beyond that.
 *
 * What it pins that jsdom cannot: that no action paints the brand or a destructive fill, that every control
 * draws a 3:1 boundary, that a lead and its neighbour are the same size, that the pulse is a real running
 * animation (and is absent, not frozen, under reduced motion), that a text area wears the ink ring, and that
 * the sheet's scrim, shadow and edge resolve to the per-mode roles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { commands, page, userEvent } from "vitest/browser";
import data from "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";

const T0 = Date.now() - 72_000; // the run started 72 seconds ago
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const FIXTURE_EVENTS = [
  { runId: "run-1", seq: 0, at: at(0), raw: "a", type: "assistant_text", text: "FIXTURE: Reading how the dialog takes focus before I change the trap." },
  { runId: "run-1", seq: 1, at: at(2), raw: "b", type: "tool_call", toolName: "Read", input: { file_path: "packages/desktop/src/board/CommandPalette.tsx" } },
  { runId: "run-1", seq: 2, at: at(3), raw: "c", type: "tool_result", toolName: "Read", output: "FIXTURE: 812 lines" },
  { runId: "run-1", seq: 3, at: at(6), raw: "d", type: "assistant_text", text: "FIXTURE: The palette already wraps itself in a FocusScope with trapped and loop, so the launch sheet and the merge sheet can copy that exact shape instead of a hand-rolled keydown handler. I will write the failing test first." },
  { runId: "run-1", seq: 4, at: at(9), raw: "e", type: "tool_call", toolName: "Bash", input: { command: "npm --prefix packages/desktop run test -- src/launch-sheet" } },
  { runId: "run-1", seq: 5, at: at(10), raw: "f", type: "system_notice", text: "FIXTURE: retrying request after a transient error" },
];
const FINISHED_EVENTS = [
  ...FIXTURE_EVENTS.slice(0, 4),
  { runId: "run-1", seq: 6, at: at(60), raw: "g", type: "session_closed", reason: "failed", result: { subtype: "error_max_turns" }, detail: "FIXTURE: the run stopped at its turn limit" },
];

const SUCCEEDED_EVENTS = [
  ...FIXTURE_EVENTS.slice(0, 4),
  { runId: "run-1", seq: 6, at: at(61), raw: "g", type: "session_closed", reason: "completed", result: { subtype: "success" } },
];
// A conversation with the developer's own turn in it (an authoring run). FIXTURE: the real board has none.
const DEVELOPER_TURN_EVENTS = [
  { runId: "run-1", seq: 0, at: at(0), raw: "a", type: "assistant_text", text: "FIXTURE: Before I decompose this: what must stay true if the outbox is replayed twice?" },
  { runId: "run-1", seq: 1, at: at(20), raw: "b", type: "developer_turn", text: "FIXTURE: Replaying must be idempotent, the second pass writes nothing.", origin: "developer", turnId: "t-1" },
  { runId: "run-1", seq: 2, at: at(24), raw: "c", type: "assistant_text", text: "FIXTURE: Understood. Then each task needs a criterion that names the replay." },
];

const REQUESTS = {
  routine: [{ id: "req-1", toolName: "Bash", inputPayload: '{"command":"npm --prefix packages/desktop run test"}', destructiveCategory: null }],
  destructive: [{ id: "req-2", toolName: "Bash", inputPayload: '{"command":"git reset --hard"}', destructiveCategory: "hard-reset" }],
};
const world = { events: FIXTURE_EVENTS as Record<string, unknown>[], requests: REQUESTS.routine as unknown[] };

vi.mock("../../../adapters/tauri", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const comp = (await import(
    "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json"
  )).default as unknown as {
    criteria: { task_key: string; statement: string; verification_hint: string | null }[];
  };
  const packet = {
    taskKey: "THRE-58",
    taskTitle: "Wire up the focus trap #41",
    taskDescription: null,
    epicTitle: "Event log and outbox",
    epicDescription: null,
    criteria: comp.criteria.filter((c) => c.task_key === "THRE-58").map((c) => ({ statement: c.statement, verificationHint: c.verification_hint })),
    summaries: [], // THRE-58 has no prior session: the real board's own state.
    compaction: { total: 0, foldedCount: 0, verbatimCount: 0, foldedRange: null, verbatimRange: null, sentence: null },
    decisions: [],
    drift: [],
    branch: "flywheel/thre-58-wire-up-the-focus-trap-41",
    baseRef: "flywheel/epic/thre-10-event-log-and-outbox",
    worktreePath: "/Users/dev/Flywheel/THRE/THRE-58",
    diff: null,
    renderedPrompt: "",
  };
  return {
    ...real,
    agentRunLogWindow: (_id: string, offset: number, limit: number) =>
      Promise.resolve({ entries: world.events.slice(offset, offset + limit), offset, limit, total: world.events.length }),
    agentRunRawWindow: () => Promise.resolve({ lines: [], offset: 0, limit: 50, total: 0 }),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    pendingPermissionRequests: () => Promise.resolve(world.requests),
    answerPermissionRequest: () => Promise.resolve(undefined),
    stopAgentRun: () => Promise.resolve({ status: "interrupted", sidecarWarning: null }),
    discardSession: () => Promise.resolve({ status: "interrupted", sidecarWarning: null }),
    previewContextPacket: () => Promise.resolve(packet),
    startAgentRun: () => new Promise(() => {}),
    // The authoring run's own reads and writes (the developer's-turn capture).
    authoringProposalsForRun: () => Promise.resolve([]),
    authoringStageAdvance: () => Promise.resolve(undefined),
    authoringStageReturn: () => Promise.resolve(undefined),
    sendAuthoringTurn: () => Promise.resolve(undefined),
  };
});

import tokensCss from "../../../styles/tokens.css?raw";
import typeCss from "../../../styles/type.css?raw";
import motionCss from "../../../styles/motion.css?raw";
import appCss from "../../../App.css?raw";
import sessionCss from "../../session.css?raw";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { SessionSurface } from "../../SessionSurface";
import { BoardRow } from "../../../board/BoardRow";
import { LaunchSheet } from "../../../launch-sheet/LaunchSheet";
import { resetUiState } from "../../../state/uiStore";
import { LIGHT, DARK } from "../../../theme/tokens";
import { contrastRatio } from "../../../theme/contrast";

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PALETTE = scheme === "dark" ? DARK : LIGHT;
const OUT = "../../../../../../.impeccable/review";
const OUT_FROM_ROOT = "../../.impeccable/review";
void data;

const toHex = (computed: string): string => {
  const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
};
const ratio = (a: string, b: string) => contrastRatio(a, b);
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 300));

function mountSession(props: { status?: "running" | "completed" | "failed"; sheet?: boolean; authoring?: boolean } = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div className="rack-ground" style={{ height: 900, width: 1440, display: "flex", flexDirection: "column" }}>
        {/* In flow, above the surface: it used to sit absolutely at the bottom-right, stranded on the blank ground. */}
        <p className="type-label" data-testid="fixture-caption" style={{ margin: 0, padding: "var(--space-xs) var(--space-md)", color: "var(--text-muted-rack)", borderBottom: "1px solid var(--divider)" }}>
          FIXTURE: THRE-58 has no live run on the real board, so the feed, the requests and the failure are invented.
        </p>
        <div style={{ flex: 1, minHeight: 0 }}>
          <SessionSurface
            agentRunId="run-1"
            taskId={props.authoring ? null : "t1"}
            initialStatus={props.status ?? "running"}
            authoringStage={props.authoring ? "challenge" : null}
            onBack={() => {}}
          />
        </div>
      </div>
      {props.sheet && <LaunchSheet taskId="t1" onClose={() => {}} onStarted={() => {}} />}
    </QueryClientProvider>,
  );
}

async function writeHtml(name: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}, ${scheme}</title>` +
    `<style>${tokensCss}\n${typeCss}\n${motionCss}\n${appCss}\n${sessionCss}</style></head><body>${document.body.innerHTML}</body></html>`;
  await commands.writeFile(`${OUT_FROM_ROOT}/${name}-${scheme}.html`, html);
}

/** A drawn action: a transparent ground, a 3:1 edge and 4.5:1 text, whatever surface it sits on. */
function expectDrawn(button: HTMLElement, name: string, ground: string) {
  const style = getComputedStyle(button);
  expect(style.backgroundColor, `${name} must not be filled`).toBe("rgba(0, 0, 0, 0)");
  expect(ratio(toHex(style.borderTopColor), ground), `${name}'s edge`).toBeGreaterThanOrEqual(3);
  expect(ratio(toHex(style.color), ground), `${name}'s text`).toBeGreaterThanOrEqual(4.5);
}

beforeEach(() => {
  resetUiState();
  world.events = FIXTURE_EVENTS;
  world.requests = REQUESTS.routine;
});

describe(`session group, built, ${scheme} scheme${reduced ? ", reduced motion" : ""}`, () => {
  it("the session mid-run: a real pulse, drawn header actions, one lead, a routine permission card", async () => {
    mountSession();
    const discard = await screen.findByRole("button", { name: "Discard" });
    const stop = screen.getByRole("button", { name: "Stop" });
    const viewRaw = screen.getByRole("button", { name: "View raw" });
    const ground = PALETTE.surfaceDominant;
    for (const [name, button] of [["Discard", discard], ["Stop", stop], ["View raw", viewRaw]] as const) expectDrawn(button, name, ground);

    // One lead per header (2px ink), its neighbours on the 1px control edge, all the same size. While a run
    // is live the lead is STOP, the one action a running session offers; Discard is the most destructive
    // control on the page and sits on the plain edge.
    expect(getComputedStyle(stop).borderTopWidth, "Stop leads a live run").toBe("2px");
    expect(toHex(getComputedStyle(stop).borderTopColor)).toBe(PALETTE.selectionRule);
    expect(getComputedStyle(discard).borderTopWidth, "Discard never leads a live run").toBe("1px");
    expect(toHex(getComputedStyle(discard).borderTopColor)).toBe(PALETTE.borderControl);
    expect(discard.offsetHeight, "the lead and its neighbour are the same height").toBe(stop.offsetHeight);

    // The meter prints figures or nothing: a running session has no totals yet, so no dashes and no bare words.
    expect(document.body.textContent).not.toMatch(/—\s*in|—\s*out/);
    expect(screen.queryByLabelText("Tokens in")).toBeNull();

    // The transcript sits on the floor, not at the top of blank ground, and the page ends on a bar.
    const scroll = screen.getByTestId("session-feed-scroll");
    const content = scroll.firstElementChild as HTMLElement;
    const gap = scroll.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom;
    expect(gap, "the newest content is on the floor (one gutter of padding above the bar)").toBeLessThan(24);
    const floor = document.querySelector<HTMLElement>(".session-floor")!;
    await waitFor(() => expect(floor.textContent).toBe("Waiting on you: answer the permission request above."));
    expect(Math.abs(floor.getBoundingClientRect().bottom - 900), "the bar is the page's floor").toBeLessThan(2);
    expect(getComputedStyle(screen.getByTestId("fixture-caption")).position).toBe("static");

    // The pulse: a real, infinite opacity animation, or (under reduced motion) no animation class at all.
    const badge = screen.getByText("Running");
    const glyph = badge.querySelector<HTMLElement>("[aria-hidden]")!;
    if (reduced) {
      expect(document.querySelector(".agent-pulse"), "omitted, not frozen").toBeNull();
      expect(getComputedStyle(glyph).animationName).toBe("none");
      expect(getComputedStyle(glyph).opacity).toBe("1");
    } else {
      const style = getComputedStyle(glyph);
      expect(style.animationName).toBe("agent-pulse");
      expect(style.animationIterationCount).toBe("infinite");
      expect(glyph.getAnimations().length, "the engine is running it").toBeGreaterThan(0);
    }

    // The live mark: the call in flight carries a caret that pulses where the work is (and is a plain mark under
    // reduced motion), not only the glyph at the far top-left.
    const live = await screen.findByRole("button", { name: /Bash · npm --prefix/ });
    const caret = live.querySelector<HTMLElement>(".feed-caret")!;
    expect(caret, "the running tool row carries the caret").toBeTruthy();
    if (reduced) {
      expect(getComputedStyle(caret).animationName).toBe("none");
    } else {
      expect(getComputedStyle(caret).animationName).toBe("agent-pulse");
      expect(caret.getAnimations().length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: /Read · packages\/desktop/ }).querySelector(".feed-caret"), "a finished call is not live").toBeNull();

    // The routine card: a 3:1 edge (not a fill, not a stripe), Allow the lead, Deny beside it.
    const group = await screen.findByRole("group", { name: "Bash wants to:" });
    const card = getComputedStyle(group);
    expect(card.backgroundColor, "the card is not filled").toBe("rgba(0, 0, 0, 0)");
    expect(card.borderLeftWidth).toBe(card.borderTopWidth);
    expect(ratio(toHex(card.borderTopColor), ground), "the card's edge").toBeGreaterThanOrEqual(3);
    const allow = screen.getByRole("button", { name: "Allow" });
    const deny = screen.getByRole("button", { name: "Deny" });
    expectDrawn(allow, "Allow", ground);
    expect(getComputedStyle(allow).borderTopWidth).toBe("2px");
    // Deny is the secondary answer: text and a caret, no box. It used to be a 1px box beside a 2px box.
    const denyStyle = getComputedStyle(deny);
    expect(denyStyle.borderTopWidth, "Deny has no box").toBe("0px");
    expect(denyStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(ratio(toHex(denyStyle.color), ground), "Deny's text").toBeGreaterThanOrEqual(4.5);
    expect(deny.textContent).toBe("Deny›");
    // The permanent grant is below a gutter, and its scope is carried by weight, not an underline.
    const grant = screen.getByRole("button", { name: "Allow this tool for this project from now on" });
    expect(grant.getBoundingClientRect().top - deny.getBoundingClientRect().bottom, "a gutter before the permanent grant").toBeGreaterThanOrEqual(12);
    expect(getComputedStyle(grant).textDecorationLine).toBe("none");
    expect(getComputedStyle(grant.querySelector("strong")!).fontWeight).toBe("600");
    expect(ratio(toHex(getComputedStyle(grant).color), ground), "the grant's text").toBeGreaterThanOrEqual(4.5);

    await settle();
    await page.screenshot({ path: `${OUT}/session-group-built-${scheme}-session-1440x900.png` });
    await writeHtml("session-group-built-session");

    // A mouse click on a disclosure row leaves no ring: rings are :focus-visible only. After the capture,
    // because the expanded row reserves its fixed 296px slot.
    const toolRow = await screen.findByRole("button", { name: /Read · packages\/desktop/ });
    await userEvent.click(toolRow);
    expect(getComputedStyle(toolRow).outlineStyle, "a click must not leave a ring on a feed row").toBe("none");
    await userEvent.hover(screen.getByText(/FIXTURE: THRE-58 has no live run/)); // park the pointer
  });

  it("the destructive gate: Deny leads in the destructive text role, the card edge is destructive, no fill", async () => {
    world.requests = REQUESTS.destructive;
    mountSession();
    const group = await screen.findByRole("group", { name: "Bash wants to:" });
    const ground = PALETTE.surfaceDominant;
    const card = getComputedStyle(group);
    expect(toHex(card.borderTopColor)).toBe(PALETTE.destructiveTextRack);
    expect(card.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(card.borderLeftWidth, "no side stripe").toBe(card.borderTopWidth);
    expect(screen.getByText("Destructive action — needs your OK")).toBeTruthy();
    expect(group.querySelector("svg"), "paired with a glyph").toBeTruthy();

    const deny = screen.getByRole("button", { name: "Deny" });
    const allowOnce = screen.getByRole("button", { name: "Allow, just this once" });
    const denyStyle = getComputedStyle(deny);
    expect(denyStyle.backgroundColor, "the old destructive fill is gone").toBe("rgba(0, 0, 0, 0)");
    expect(toHex(denyStyle.color)).toBe(PALETTE.destructiveTextRack);
    expect(toHex(denyStyle.borderTopColor)).toBe(PALETTE.destructiveTextRack);
    expect(denyStyle.borderTopWidth).toBe("2px");
    expect(ratio(PALETTE.destructiveTextRack, ground), "Deny's text").toBeGreaterThanOrEqual(4.5);
    expect(ratio(PALETTE.destructiveTextRack, PALETTE.surfaceSecondary), "Deny's text on the surface").toBeGreaterThanOrEqual(4.5);
    expectDrawn(allowOnce, "Allow, just this once", ground);
    expect(getComputedStyle(allowOnce).borderTopWidth).toBe("1px");
    expect(deny.offsetHeight).toBe(allowOnce.offsetHeight);
    expect(screen.queryByRole("button", { name: /from now on/i })).toBeNull();

    // Hovered, Deny keeps its destructive edge and sits on the quiet inset wash. It used to take App.css's
    // --divider wash, under which the destructive text role is 4.2:1 in dark (the detector's finding).
    await userEvent.hover(deny);
    const hovered = getComputedStyle(deny);
    expect(toHex(hovered.borderTopColor), "the edge stays destructive while hovered").toBe(PALETTE.destructiveTextRack);
    expect(hovered.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(hovered.boxShadow, "the inset wash is --row-surface-hover").toContain(
      scheme === "dark" ? "rgb(12, 12, 12)" : "rgb(250, 251, 252)",
    );
    expect(ratio(PALETTE.destructiveTextRack, PALETTE.rowSurfaceHover), "Deny's text on its hovered paint").toBeGreaterThanOrEqual(4.5);
    await userEvent.hover(screen.getByText(/FIXTURE: THRE-58 has no live run/)); // park the pointer

    await settle();
    await page.screenshot({ path: `${OUT}/session-group-built-${scheme}-permission-destructive-1440x900.png` });
    await writeHtml("session-group-permission-destructive");
  });

  it("the finished run: Review changes leads, the failure is a hairline notice, nothing pulses", async () => {
    world.events = FINISHED_EVENTS;
    world.requests = [];
    mountSession({ status: "failed" });
    const review = await screen.findByRole("button", { name: "Review changes" });
    expectDrawn(review, "Review changes", PALETTE.surfaceDominant);
    expect(getComputedStyle(review).borderTopWidth).toBe("2px");
    expect(document.querySelector(".agent-pulse")).toBeNull();
    const notice = (await screen.findByText(/This run ended in an error/)).parentElement as HTMLElement;
    const style = getComputedStyle(notice);
    expect(style.backgroundColor, "a notice has no fill").toBe("rgba(0, 0, 0, 0)");
    expect(toHex(style.borderTopColor)).toBe(PALETTE.divider);

    await settle();
    await page.screenshot({ path: `${OUT}/session-group-built-${scheme}-finished-1440x900.png` });
    await writeHtml("session-group-finished");
  });

  it("the succeeded run: the terminal state a run is meant to reach, with its floor and Review changes", async () => {
    world.events = SUCCEEDED_EVENTS;
    world.requests = [];
    mountSession({ status: "completed" });
    const review = await screen.findByRole("button", { name: "Review changes" });
    expectDrawn(review, "Review changes", PALETTE.surfaceDominant);
    expect(getComputedStyle(review).borderTopWidth).toBe("2px");
    expect(document.querySelector(".agent-pulse"), "nothing pulses once the run has ended").toBeNull();
    expect(document.querySelector(".feed-caret")).toBeNull();
    await screen.findByText("Completed", { selector: "span, p, div" });
    expect(document.querySelector(".session-floor")?.textContent).toMatch(/^This run has ended\./);
    // The notice for success is plain: no destructive role anywhere on the page.
    expect(document.querySelector("[style*='destructive']")).toBeNull();

    await settle();
    await page.screenshot({ path: `${OUT}/session-group-built-${scheme}-succeeded-1440x900.png` });
    await writeHtml("session-group-succeeded");
  });

  it("the developer's turn: an authoring run with the composer as its floor, the developer's own words in the feed", async () => {
    world.events = DEVELOPER_TURN_EVENTS;
    world.requests = [];
    mountSession({ authoring: true });
    const composer = await screen.findByRole("textbox", { name: "Message" });
    await screen.findByText(/Replaying must be idempotent/);
    const send = screen.getByRole("button", { name: "Send" });
    expectDrawn(send, "Send", PALETTE.surfaceDominant);
    expect(getComputedStyle(send).borderTopWidth, "Send is the composer's lead").toBe("2px");
    // The composer is the floor of this state, so there is no second bar under it.
    expect(document.querySelector(".session-floor")).toBeNull();
    const field = getComputedStyle(composer);
    expect(ratio(toHex(field.borderTopColor), PALETTE.surfaceDominant), "the composer's boundary").toBeGreaterThanOrEqual(3);
    expect(Math.abs(send.closest("div")!.parentElement!.getBoundingClientRect().bottom - 900), "the composer is on the page's floor").toBeLessThan(2);

    await settle();
    await page.screenshot({ path: `${OUT}/session-group-built-${scheme}-developer-turn-1440x900.png` });
    await writeHtml("session-group-developer-turn");
  });

  it("the launch sheet: --scrim, --shadow-sheet, the sheet-tier edge, drawn controls, a lead, an ink ring", async () => {
    mountSession({ sheet: true });
    const dialog = await screen.findByRole("dialog", { name: "Launch sheet" });
    await screen.findByText("Start Work on THRE-58");
    const scrim = dialog.parentElement as HTMLElement;
    expect(getComputedStyle(scrim).backgroundColor, "the scrim resolves from --scrim").toBe(
      scheme === "dark" ? "rgba(0, 0, 0, 0.4)" : "rgba(31, 35, 40, 0.4)",
    );
    const sheet = getComputedStyle(dialog);
    expect(sheet.boxShadow, "the sheet shadow resolves from --shadow-sheet").toContain(scheme === "dark" ? "rgba(0, 0, 0, 0.7)" : "rgba(31, 35, 40, 0.24)");
    expect(toHex(sheet.borderTopColor), "the sheet tier's edge").toBe(PALETTE.borderSheet);
    expect(ratio(PALETTE.borderSheet, PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(3);
    expect(sheet.borderTopLeftRadius).toBe("6px");
    // Frame one is at full value: no fade on mount.
    expect(getComputedStyle(scrim).opacity).toBe("1");
    expect(getComputedStyle(dialog).opacity).toBe("1");

    const ground = PALETTE.surfaceSecondary;
    const start = screen.getByRole("button", { name: "Start Work" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expectDrawn(start, "Start Work", ground);
    expectDrawn(cancel, "Cancel", ground);
    expect(getComputedStyle(start).borderTopWidth).toBe("2px");
    expect(toHex(getComputedStyle(start).borderTopColor)).toBe(PALETTE.selectionRule);
    expect(getComputedStyle(cancel).borderTopWidth).toBe("1px");
    expect(start.offsetHeight, "the lead and Cancel are the same height").toBe(cancel.offsetHeight);

    // The mode choice: all four are drawn controls; the chosen one wears an ink edge, a 2px foot rule and weight 600.
    const modes = screen.getAllByRole("radio");
    expect(modes).toHaveLength(4);
    for (const mode of modes) expectDrawn(mode, `mode ${mode.textContent}`, ground);
    const chosen = modes.find((m) => m.getAttribute("aria-checked") === "true")!;
    expect(chosen.textContent).toBe("Accept Edits");
    expect(toHex(getComputedStyle(chosen).borderTopColor)).toBe(PALETTE.selectionRule);
    expect(getComputedStyle(chosen).borderTopWidth, "a value, not a lead: 1px box").toBe("1px");
    expect(getComputedStyle(chosen).boxShadow, "the 2px ink foot rule").toContain(scheme === "dark" ? "rgb(237, 237, 237)" : "rgb(31, 35, 40)");
    expect(getComputedStyle(chosen).fontWeight).toBe("600");
    const other = modes.find((m) => m !== chosen)!;
    expect(getComputedStyle(other).fontWeight).toBe("400");
    expect(toHex(getComputedStyle(other).borderTopColor)).toBe(PALETTE.borderControl);

    // A-08(c): Bypass Permissions alone is the destructive TEXT role (no fill, same edge as its neighbours), 4.5:1
    // in this scheme, and choosing it prints what it does.
    const bypass = modes.find((m) => m.textContent === "Bypass Permissions")!;
    expect(toHex(getComputedStyle(bypass).color), "Bypass's label").toBe(PALETTE.destructiveTextRack);
    expect(ratio(PALETTE.destructiveTextRack, ground), "Bypass's label on the sheet").toBeGreaterThanOrEqual(4.5);
    expect(getComputedStyle(bypass).backgroundColor, "text role only, no fill").toBe("rgba(0, 0, 0, 0)");
    expect(toHex(getComputedStyle(bypass).borderTopColor), "the edge stays a control edge").toBe(PALETTE.borderControl);
    for (const m of modes.filter((x) => x !== bypass)) expect(toHex(getComputedStyle(m).color), m.textContent!).not.toBe(PALETTE.destructiveTextRack);
    expect(screen.queryByText(/won't ask before editing files/)).toBeNull();
    fireEvent.click(bypass);
    const consequence = await screen.findByText(/won't ask before editing files or running commands/);
    expect(ratio(toHex(getComputedStyle(consequence).color), ground), "the consequence line").toBeGreaterThanOrEqual(4.5);
    expect(consequence.getBoundingClientRect().height, "one line").toBeLessThanOrEqual(parseFloat(getComputedStyle(consequence).lineHeight) * 1.5);
    expect(toHex(getComputedStyle(bypass).borderTopColor), "chosen: the ink rule").toBe(PALETTE.selectionRule);
    expect(ratio(PALETTE.destructiveTextRack, PALETTE.rowSurfaceHover), "Bypass's label on its hover wash").toBeGreaterThanOrEqual(4.5);
    fireEvent.click(modes.find((m) => m.textContent === "Accept Edits")!);

    // The instruction field: a 3:1 control boundary, and the ink ring (not the engine's system ring).
    const field = screen.getByLabelText("Instruction") as HTMLTextAreaElement;
    // The placeholder is a role a step below muted: not the engine's unowned grey (about 8.5:1 in dark, which
    // made the dark sheet look as if a prompt were already typed), and the same ratio in both schemes.
    const placeholder = toHex(getComputedStyle(field, "::placeholder").color);
    expect(placeholder, "the placeholder is --text-placeholder").toBe(PALETTE.textPlaceholder);
    const placeholderRatio = ratio(placeholder, PALETTE.surfaceDominant);
    expect(placeholderRatio).toBeLessThan(ratio(PALETTE.textMutedRack, PALETTE.surfaceDominant));
    expect(placeholderRatio).toBeGreaterThanOrEqual(4.5);
    expect(ratio(toHex(getComputedStyle(field).borderTopColor), PALETTE.surfaceDominant)).toBeGreaterThanOrEqual(3);
    field.focus();
    await waitFor(() => expect(document.activeElement).toBe(field));
    const ring = getComputedStyle(field);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBe("2px");
    expect(toHex(ring.outlineColor), "the ink rule, not the brand and not the system ring").toBe(PALETTE.selectionRule);

    await settle();
    await page.screenshot({ path: `${OUT}/session-group-built-${scheme}-launch-sheet-1440x900.png` });
    await writeHtml("session-group-launch-sheet");
  });
});

// D-REV-33 (plan 11-14): the scope-denied feed row and the per-task refusal badge, measured in WebKit.
// Layout and reachability only: whether a truncated row or a 12px glyph beside a count is "noticeable"
// is aesthetic judgement and stays in the register. No font size is touched here (11-18 owns that).
describe(`scope-denied feed row and refusal badge, ${scheme} scheme`, () => {
  const SHORT_PATH = "src/a.rs";
  const LONG_PATH = `src/${"deeply-nested-directory-name/".repeat(10)}file.rs`; // 300+ characters
  const denial = (seq: number, path: string) => ({
    runId: "run-1", seq, at: at(seq), raw: `s${seq}`, type: "scope_denied", tool: "Write", path, outsideWorktree: false,
  });

  async function mountWithDenial(path: string) {
    world.events = [denial(0, path)];
    world.requests = [];
    mountSession();
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-kind="scope_denied"]');
      expect(el, "the denial row").not.toBeNull();
      return el!;
    });
    return row;
  }

  it("a 300-character refusal stays one line: the row is exactly as tall as with a short one, and the widen action stays inside it", async () => {
    expect(LONG_PATH.length).toBeGreaterThanOrEqual(300);
    const shortRow = await mountWithDenial(SHORT_PATH);
    const shortHeight = shortRow.getBoundingClientRect().height;
    const shortSlot = shortRow.closest<HTMLElement>('[data-testid="feed-row-slot"]')!.getBoundingClientRect().height;
    cleanup();

    const row = await mountWithDenial(LONG_PATH);
    const slot = row.closest<HTMLElement>('[data-testid="feed-row-slot"]')!;
    const text = row.querySelector<HTMLElement>("span.type-micro")!;
    const widen = screen.getByRole("button", { name: "Widen scope to this path" });

    expect(row.getBoundingClientRect().height, "row height does not grow with the message").toBe(shortHeight);
    expect(slot.getBoundingClientRect().height, "the reserved slot is the same too").toBe(shortSlot);
    expect(text.scrollWidth, "the long message is really cut, by an ellipsis, not wrapped").toBeGreaterThan(text.clientWidth);
    expect(getComputedStyle(text).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(text).whiteSpace).toBe("nowrap");
    expect(text.textContent).toContain(LONG_PATH); // the whole message is in the DOM, only painted short
    expect(text.getAttribute("title")).toContain(LONG_PATH);

    const r = row.getBoundingClientRect();
    const w = widen.getBoundingClientRect();
    expect(w.left, "widen is not pushed out the left").toBeGreaterThanOrEqual(r.left);
    expect(w.right, "widen is not pushed out the right").toBeLessThanOrEqual(r.right + 0.5);
    expect(w.top).toBeGreaterThanOrEqual(r.top);
    expect(w.bottom).toBeLessThanOrEqual(r.bottom + 0.5);
    expect(w.width, "the action keeps its natural width").toBeGreaterThan(40);
    expect(text.getBoundingClientRect().right, "the text ends before the action begins").toBeLessThanOrEqual(w.left + 0.5);
  });

  it("the widen action is reachable from the keyboard (Option+Tab: WebKit's plain Tab skips every button by default, see review/keyboard.browser.test.tsx)", async () => {
    await mountWithDenial(LONG_PATH);
    const widen = screen.getByRole("button", { name: "Widen scope to this path" });
    expect(widen.tagName, "a native button, so Enter and Space activate it").toBe("BUTTON");
    expect(widen.getAttribute("tabindex"), "not taken out of the focus order").not.toBe("-1");
    expect((widen as HTMLButtonElement).disabled).toBe(false);
    let reached = false;
    for (let i = 0; i < 20 && !reached; i++) {
      await userEvent.keyboard("{Alt>}{Tab}{/Alt}");
      reached = document.activeElement === widen;
    }
    expect(reached, "sequential focus arrives at the widen action within 20 presses").toBe(true);
  });

  it("a count of 20 renders a badge, a task with none renders nothing at all", async () => {
    const item = { id: "t-20", key: "FLY-20", title: "Fought its file set", status: "in_progress", rank: "10", priority: 0, epicId: null, kind: "task" } as const;
    const { unmount } = render(
      <div style={{ width: 716 }} className="rack-ground">
        <BoardRow item={item} scopeDenied={20} />
        <BoardRow item={{ ...item, id: "t-0", key: "FLY-0", title: "Never refused" }} />
      </div>,
    );
    const badges = screen.getAllByTestId("scope-badge");
    expect(badges, "only the task with refusals carries a badge").toHaveLength(1);
    expect(badges[0].textContent).toBe("20");
    expect(badges[0].getAttribute("aria-label")).toBe("20 scope refusals");
    const b = badges[0].getBoundingClientRect();
    expect(b.width, "the count is painted, with its glyph").toBeGreaterThan(12);
    const row = badges[0].closest<HTMLElement>('[role="listitem"]')!.getBoundingClientRect();
    expect(b.right).toBeLessThanOrEqual(row.right);
    expect(b.top).toBeGreaterThanOrEqual(row.top);
    expect(b.bottom).toBeLessThanOrEqual(row.bottom);
    const quiet = screen.getByText("Never refused").closest<HTMLElement>('[role="listitem"]')!;
    expect(quiet.querySelector('[data-testid="scope-badge"]'), "zero is an absent badge, not a printed 0").toBeNull();
    expect(quiet.getAttribute("aria-label")).not.toMatch(/scope refusal/);
    unmount();
  });
});
