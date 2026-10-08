/**
 * The expensive gate's capture step for surface group two (08.1 plan 15, D-24): the item detail
 * panel, the command palette and an open picker as the REAL components paint them in WebKit, in
 * whichever colour scheme the config selected, into `.impeccable/review/` beside the approved comps,
 * named `detail-group-built-<scheme>-{panel,palette,picker}-1440x900`.
 *
 * The panel is the real task THRE-58 of the real board (its three criteria, its activity trail and its
 * worktree branch are the comp's own export, `comps/comp-data.json`). The real board has no agent runs
 * today, so one running run is a FIXTURE, labelled as such on the page, exactly as the comps label
 * theirs; it exists so the Runs section's Watch Live action can be seen at all.
 *
 * It also pins what a jsdom test cannot: that a mouse click on a criterion paints no ring while keyboard
 * focus does, that no action button paints the brand, that every control in the group draws a 3:1
 * boundary, and that the popover and sheet shadows resolve to the per-mode role values. The rendered
 * page is written as self-contained HTML beside each PNG so the detector, which cannot read JSX inline
 * styles, sees what these components paint.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { commands, page, userEvent } from "vitest/browser";
import tokensCss from "../../../styles/tokens.css?raw";
import typeCss from "../../../styles/type.css?raw";
import motionCss from "../../../styles/motion.css?raw";
import appCss from "../../../App.css?raw";
import detailCss from "../../item-detail.css?raw";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import data from "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";
import { ItemDetailPanel } from "../../ItemDetailPanel";
import { CommandPalette } from "../../../board/CommandPalette";
import { resetUiState, useUiStore } from "../../../state/uiStore";
import { LIGHT, DARK } from "../../../theme/tokens";
import { contrastRatio } from "../../../theme/contrast";

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const PALETTE = scheme === "dark" ? DARK : LIGHT;
const OUT = "../../../../../../.impeccable/review";
const OUT_FROM_ROOT = "../../.impeccable/review";

const TASK = (data.tasks as { id: string; key: string; title: string; status: string; project_id: string }[]).find(
  (t) => t.key === "THRE-58",
)!;
const CRITERIA = (data.criteria as { id: string; task_key: string; statement: string; verification_hint: string | null; checked: number; rank: string }[])
  .filter((c) => c.task_key === TASK.key)
  .map((c) => ({
    id: c.id, parentType: "task", parentId: TASK.id, statement: c.statement, verificationHint: c.verification_hint,
    checked: c.checked === 1, rank: c.rank, revision: 1, revisionOf: null, supersededAt: null,
  }));
const ACTORS = [
  { id: "a-human", actorType: "human", displayName: "Local User" },
  { id: "a-agent", actorType: "agent", displayName: "Claude Code" },
];
const EVENTS = (data.activity as { event_type: string; occurred_at: string; actor: string }[]).slice(0, 8).map((e, i) => ({
  id: `e${i}`, projectId: TASK.project_id, origin: "local", sequence: i,
  actorId: ACTORS.find((a) => a.displayName === e.actor)?.id ?? "a-human",
  eventType: e.event_type, description: e.event_type.replace(".", " "), occurredAt: e.occurred_at,
}));
// FIXTURE: the real board has no agent runs today.
const RUN = {
  id: "run-fixture", taskId: TASK.id, status: "running", startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  endedAt: null, costUsd: 0.1234, tokensIn: null, tokensOut: null, externalSessionId: "FIXTURE", acknowledgedAt: null, abandonedReason: null,
};

function installTauriBridge() {
  const answers: Record<string, unknown> = {
    criterion_list: CRITERIA,
    criterion_revisions: [],
    events_activity_trail: EVENTS,
    actor_list: ACTORS,
    agent_runs_for_task: [RUN],
    agent_run_pending_permissions: [],
    task_session_summaries: [],
    worktree_summary: { branch: "flywheel/thre-58-wire-up-the-focus-trap-41", path: "/Users/dev/flywheel/thre-58", status: "active" },
    project_list: [],
    board_change_flags: [],
    board_blocked_summary: { blockedTaskIds: [], blockedCount: 0 },
    board_recovery_summary: { recoveryTaskIds: [], recoveryCount: 0 },
  };
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: (command: string) => Promise.resolve(command in answers ? answers[command] : null),
  };
}

function Page() {
  return (
    <div className="rack-ground" style={{ display: "flex", justifyContent: "flex-end", width: 1440, height: 900 }}>
      <p className="type-label" style={{ position: "absolute", left: 24, top: 16, margin: 0, color: "var(--text-muted-rack)", maxWidth: 480 }}>
        THRE-58 is the real board&apos;s own task: its criteria, activity and worktree branch are real. The running
        run is a FIXTURE, because the real board has no agent runs today.
      </p>
      <ItemDetailPanel
        item={{ id: TASK.id, kind: "task", key: TASK.key, title: TASK.title, status: TASK.status, projectId: TASK.project_id }}
        onClose={() => {}} onUpdateTitle={() => {}} onSetStatus={() => {}} onStartWork={() => {}} onReview={() => {}}
        trapped={false}
      />
      <CommandPalette />
    </div>
  );
}

function mount() {
  installTauriBridge();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page />
    </QueryClientProvider>,
  );
}

/** The panel slides in over 220ms and the palette settles over 140ms; capture the settled world, not frame one. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 450));

async function writeHtml(name: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}, ${scheme}</title>` +
    `<style>${tokensCss}\n${typeCss}\n${motionCss}\n${appCss}\n${detailCss}</style></head><body>${document.body.innerHTML}</body></html>`;
  await commands.writeFile(`${OUT_FROM_ROOT}/${name}-${scheme}.html`, html);
}

const ratio = (a: string, b: string) => contrastRatio(a, b);
const toHex = (computed: string): string => {
  const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
};

beforeEach(() => {
  resetUiState();
});

describe(`item detail group, built, ${scheme} scheme`, () => {
  it("the panel: drawn actions, hairline sections, a keyboard-only criteria ring", async () => {
    mount();
    const panel = await screen.findByRole("dialog", { name: "THRE-58 detail" });
    await within(panel).findByRole("listitem", { name: /Tab and Shift\+Tab/ });
    await within(panel).findByRole("button", { name: "Watch Live" });

    // No action paints the brand: each is transparent with a 3:1 control edge.
    for (const name of ["Start Work", "Review", "Watch Live"]) {
      const button = within(panel).getByRole("button", { name });
      const style = getComputedStyle(button);
      expect(style.backgroundColor, `${name} must not be filled`).toBe("rgba(0, 0, 0, 0)");
      expect(ratio(toHex(style.borderTopColor), PALETTE.surfaceDominant), `${name}'s edge`).toBeGreaterThanOrEqual(3);
      expect(ratio(toHex(style.color), PALETTE.surfaceDominant), `${name}'s text`).toBeGreaterThanOrEqual(4.5);
    }

    // Mouse: a click moves the cursor and paints no ring. Keyboard: the ring appears on the cursor row.
    const list = within(panel).getByRole("list", { name: "Criteria" });
    const first = within(panel).getByRole("listitem", { name: /Tab and Shift\+Tab/ });
    const second = within(panel).getByRole("listitem", { name: /Closing the dialog/ });
    await userEvent.click(first);
    expect(first.getAttribute("data-focused")).toBe("true");
    expect(getComputedStyle(first).outlineStyle, "a click must not leave a ring").toBe("none");
    list.blur();
    await userEvent.keyboard("{ArrowDown}");
    list.focus();
    await userEvent.keyboard("j");
    await waitFor(() => expect(second.getAttribute("data-focused")).toBe("true"));
    const ring = getComputedStyle(second);
    expect(ring.outlineStyle, "keyboard focus must ring the cursor row").toBe("solid");
    expect(ring.outlineWidth).toBe("2px");
    expect(toHex(ring.outlineColor)).toBe(PALETTE.focusRing);
    expect(getComputedStyle(first).outlineStyle, "only the cursor row rings").toBe("none");
    list.blur();

    await settle();
    await page.screenshot({ path: `${OUT}/detail-group-built-${scheme}-panel-1440x900.png` });
    await writeHtml("detail-group-built");
  });

  it("a picker: the control boundary, the popover shadow, no scrim", async () => {
    mount();
    const panel = await screen.findByRole("dialog", { name: "THRE-58 detail" });
    await userEvent.click(within(panel).getByRole("button", { name: /in progress/i }));
    const menu = await screen.findByRole("menu", { name: "Set status" });
    const style = getComputedStyle(menu);
    expect(ratio(toHex(style.borderTopColor), PALETTE.surfaceDominant), "the picker's edge is the control boundary").toBeGreaterThanOrEqual(3);
    expect(style.boxShadow, "the popover shadow resolves from the role").toContain(scheme === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(31, 35, 40, 0.16)");
    expect(document.querySelector('[role="dialog"][aria-label="Command palette"]'), "a popover dims nothing").toBeNull();
    const chosen = within(menu).getByRole("menuitemradio", { checked: true });
    expect(toHex(getComputedStyle(chosen).borderLeftColor), "the chosen item carries the 2px ink rule").toBe(PALETTE.selectionRule);
    expect(getComputedStyle(chosen).borderLeftWidth).toBe("2px");

    await settle();
    await page.screenshot({ path: `${OUT}/detail-group-built-${scheme}-picker-1440x900.png` });
    await writeHtml("detail-group-picker");
  });

  it("the palette: the per-mode scrim and sheet shadow, a neutral highlighted command", async () => {
    mount();
    await screen.findByRole("dialog", { name: "THRE-58 detail" });
    useUiStore.getState().setPaletteOpen(true);
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    // Frame one: full opacity, full scrim (UI-SPEC § Motion). The scrim resolves from the role.
    expect(getComputedStyle(dialog).backgroundColor).toBe(scheme === "dark" ? "rgba(0, 0, 0, 0.4)" : "rgba(31, 35, 40, 0.4)");
    const panel = document.querySelector(".command-palette") as HTMLElement;
    const style = getComputedStyle(panel);
    expect(style.boxShadow).toContain(scheme === "dark" ? "rgba(0, 0, 0, 0.7)" : "rgba(31, 35, 40, 0.24)");
    expect(ratio(toHex(style.borderTopColor), PALETTE.surfaceDominant), "the palette's edge is the control boundary").toBeGreaterThanOrEqual(3);
    const selected = await waitFor(() => {
      const option = within(panel).getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
      expect(option).toBeTruthy();
      return option!;
    });
    const optionStyle = getComputedStyle(selected);
    expect(toHex(optionStyle.backgroundColor), "the highlighted command is a surface shift").toBe(PALETTE.rowSurfaceSelected);
    expect(toHex(optionStyle.borderLeftColor), "and the 2px ink rule, never the brand").toBe(PALETTE.selectionRule);
    expect(ratio(toHex(optionStyle.color), PALETTE.rowSurfaceSelected), "its text on that surface").toBeGreaterThanOrEqual(4.5);
    // The search field is focused and keeps its ring (it used to be suppressed).
    const input = within(panel).getByRole("textbox", { name: "Command search" });
    expect(getComputedStyle(input).outlineStyle, "the palette's search field rings under keyboard focus").toBe("solid");

    await settle();
    await page.screenshot({ path: `${OUT}/detail-group-built-${scheme}-palette-1440x900.png` });
    await writeHtml("detail-group-palette");
  });
});
