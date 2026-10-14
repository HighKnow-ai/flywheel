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
import data from "../../../../../../.planning/milestones/v0.1.0-phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";
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
    worktree_summary: { branch: "flywheel/thre-58-wire-up-the-focus-trap-41", path: "/Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin/.flywheel/worktrees/thre-58-wire-up-the-focus-trap-41", status: "active" },
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
        item={{
          id: TASK.id, kind: "task", key: TASK.key, title: TASK.title, status: TASK.status, projectId: TASK.project_id,
          priority: (TASK as unknown as { priority: number }).priority, estimate: (TASK as unknown as { estimate: number }).estimate,
        }}
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

    // 08.1-15 closure, finding 1: nothing in the panel paints past its padding box. The worktree path used to
    // be cut mid-glyph at the panel's right edge because the branch refused to shrink.
    const panelBox = panel.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(panel).paddingRight);
    for (const value of Array.from(panel.querySelectorAll<HTMLElement>(".detail-clip"))) {
      expect(value.getBoundingClientRect().right, `${value.textContent} must stay inside the panel's padding box`).toBeLessThanOrEqual(
        panelBox.right - pad + 0.5,
      );
      expect(value.scrollWidth > value.clientWidth ? getComputedStyle(value).textOverflow : "ellipsis", "a clipped value ellipsises").toBe("ellipsis");
    }
    expect(panel.querySelectorAll(".detail-clip").length, "the branch and the path").toBe(2);
    // The path clips at its START and keeps its tail: the isolated text overflows to the LEFT of its box and its
    // right edge is the box's right edge. (`unicode-bidi: plaintext` clipped both ends in WebKit, so the
    // meaningful end of the path, the task, was the part lost.)
    const pathButton = within(panel).getByRole("button", { name: "Copy worktree path" });
    const pathText = pathButton.querySelector("bdi") as HTMLElement;
    expect(pathText.getBoundingClientRect().left, "the long path overflows at its start").toBeLessThan(pathButton.getBoundingClientRect().left);
    expect(Math.abs(pathText.getBoundingClientRect().right - pathButton.getBoundingClientRect().right), "and its tail is on screen").toBeLessThanOrEqual(1);

    // Finding 6: the panel's one family. No system monospace stack in the worktree rows or the property grid.
    for (const el of Array.from(panel.querySelectorAll<HTMLElement>(".detail-props, .detail-props *"))) {
      expect(getComputedStyle(el).fontFamily, "a second font family in the property rows").not.toMatch(/mono/i);
    }
    const props = panel.querySelector(".detail-props") as HTMLElement;
    expect(within(props).getByText("Priority").nextElementSibling?.textContent).toBe("No priority");

    // Finding 3: a value is not a box, an action is. The status value has no edge; the lead action has the 2px ink edge.
    const statusValue = within(panel).getByRole("button", { name: /in progress/i });
    expect(getComputedStyle(statusValue).borderTopWidth, "the status value is unboxed").toBe("0px");
    const lead = within(panel).getByRole("button", { name: "Start Work" });
    expect(getComputedStyle(lead).borderTopWidth).toBe("2px");
    expect(toHex(getComputedStyle(lead).borderTopColor), "the lead's edge is the ink rule, not the brand").toBe(PALETTE.selectionRule);
    expect(getComputedStyle(within(panel).getByRole("button", { name: "Review" })).borderTopWidth, "secondary actions keep the hairline").toBe("1px");
    expect(lead.getBoundingClientRect().height, "the lead is the same size as its neighbour").toBeCloseTo(
      within(panel).getByRole("button", { name: "Review" }).getBoundingClientRect().height, 0,
    );

    // Finding 2: eight identical events read as one row with a count, and no actor-kind enum or per-row glyph.
    const trail = within(panel).getByRole("list", { name: "Activity trail" });
    expect(within(trail).getAllByRole("listitem")).toHaveLength(1);
    expect(trail.textContent).toContain("×8");
    expect(trail.textContent).not.toMatch(/Human/);
    expect(trail.querySelector("svg")).toBeNull();

    // Finding 8: the pencils are not standing ornament; hover reveals one.
    const pencils = Array.from(panel.querySelectorAll<HTMLElement>(".criterion-edit"));
    expect(pencils).toHaveLength(3);
    for (const p of pencils) expect(getComputedStyle(p).opacity, "hidden at rest").toBe("0");

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
    expect(toHex(style.borderTopColor), "the popover's edge is the popover tier's").toBe(PALETTE.borderPopover);
    expect(style.boxShadow, "the popover shadow resolves from the role").toContain(scheme === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(31, 35, 40, 0.16)");
    expect(document.querySelector('[role="dialog"][aria-label="Command palette"]'), "a popover dims nothing").toBeNull();
    const chosen = within(menu).getByRole("menuitemradio", { checked: true });
    expect(
      chosen.getBoundingClientRect().left - menu.getBoundingClientRect().left,
      "the chosen item's rule is inset from the popover's edge",
    ).toBeGreaterThanOrEqual(6);
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
    const ring = getComputedStyle(input);
    expect(ring.outlineStyle, "the palette's search field rings under keyboard focus").toBe("solid");
    // 08.1-15 closure, finding 5: the ring is ink, not the brand, and sits inside the dialog edge, not on it.
    expect(toHex(ring.outlineColor), "the search ring is the ink rule").toBe(PALETTE.selectionRule);
    expect(Number.parseFloat(ring.outlineOffset), "inset past the dialog's own edge").toBeLessThanOrEqual(-4);
    // Findings 7 and 8: section headers stand over their commands; the highlighted rule sits inside the edge.
    for (const header of ["Navigation", "Project", "Create"]) expect(within(panel).getByText(header)).toBeTruthy();
    expect(within(panel).queryAllByText("Selected item").length, "once, as a header, not on every row").toBeLessThanOrEqual(1);
    expect(
      selected.getBoundingClientRect().left - panel.getBoundingClientRect().left,
      "the 2px rule is inset from the dialog's edge",
    ).toBeGreaterThanOrEqual(6);
    expect(toHex(style.borderTopColor), "the sheet's edge is the sheet tier's").toBe(PALETTE.borderSheet);

    await settle();
    await page.screenshot({ path: `${OUT}/detail-group-built-${scheme}-palette-1440x900.png` });
    await writeHtml("detail-group-palette");
  });
});
