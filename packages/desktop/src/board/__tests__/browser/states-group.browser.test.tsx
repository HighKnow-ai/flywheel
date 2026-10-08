/**
 * The expensive gate's capture step for surface group six (08.1 plan 19, D-24): the first-run state, the
 * unreachable project, the delete confirmation and the orphan recovery modal, as the REAL components paint them
 * in WebKit at 1440x900 in whichever colour scheme the config selected. Written into `.impeccable/review/` as
 * `states-group-built-<scheme>-{first-run,first-run-confirm,unreachable,delete-confirm,done-warning,recovery}-1440x900`.
 *
 * No comp exists for this group, so these are reviewed against 08.1-UI-SPEC.md's contract, not an image.
 *
 * Content. The unreachable project is the real board's own second registration: same name, same key prefix, and
 * (read off a copy of the fleet database) the very same repo path as the active one. The confirmations are
 * captured OVER the real board (the project rail, the 13 epic headers and the first epic's real tasks), because a
 * scrim is judged by what it does to what is behind it. The real board has no live orphan, so the recovery
 * modal's runs are FIXTURES, each labelled in its title. Nothing is seeded into the real database.
 *
 * What it pins that jsdom cannot: that no control in the group is filled or painted in the brand; that every
 * drawn action has a 3:1 edge and 4.5:1 text; that the lead is a 2px edge and its neighbour a 1px one of the same
 * size; that a destructive action is the destructive text role with an icon; that both modals sit on the DIALOG
 * tier in WebKit (the per-mode scrim at full value on frame one, the dialog shadow, the dialog edge); that the
 * board underneath stays legible beneath the scrim; and that the blocking modal still blocks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { commands, page, userEvent } from "vitest/browser";
import data from "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";

// Read off a copy of the fleet database (never the live file): the real second registration is the SAME path.
const REAL_REPO_PATH = "/Users/cymarechal/orca/workspaces/HighKnow-harness/threadfin";
const UNREACHABLE = {
  id: "01M222FWC4FNCQKDZCXD8BEQ68",
  keyPrefix: "THRE",
  name: "threadfin",
  repoPath: REAL_REPO_PATH,
  defaultBranch: "main",
  status: "unreachable",
};
const ACTIVE = { ...UNREACHABLE, id: "01M22XBK2AMH58GBVV4VDXT8H3", status: "active" };

const orphan = (over: Record<string, unknown>) => ({
  runId: "run-1",
  taskId: "t-1",
  taskKey: "FIX-1",
  taskTitle: "",
  epicId: null,
  epicKey: null,
  epicTitle: null,
  projectId: ACTIVE.id,
  externalSessionId: "sess-a1b2c3",
  pid: 4242,
  startedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
  ...over,
});
const ORPHANS = [
  orphan({ runId: "run-1", taskKey: "FIX-1", taskTitle: "FIXTURE: Cache the chip counts" }),
  orphan({ runId: "run-2", taskKey: "FIX-2", taskTitle: "FIXTURE: Debounce the chip toggles", externalSessionId: "sess-d4e5f6", pid: 4310, startedAt: new Date(Date.now() - 3 * 3600_000).toISOString() }),
  orphan({ runId: "run-3", taskId: null, taskKey: null, taskTitle: null, epicId: "e-1", epicKey: "FIX-E1", epicTitle: "FIXTURE: Shaping the filter bar", externalSessionId: null, pid: 4377 }),
];

vi.mock("../../../adapters/tauri", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    pendingOrphans: () => Promise.resolve(ORPHANS),
    orphanKill: () => new Promise(() => {}),
    openFolderDialog: () => Promise.resolve("/Users/dev/flywheel"),
  };
});

import tokensCss from "../../../styles/tokens.css?raw";
import typeCss from "../../../styles/type.css?raw";
import motionCss from "../../../styles/motion.css?raw";
import appCss from "../../../App.css?raw";
import statesCss from "../../../styles/states-and-confirms.css?raw";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { FirstRun } from "../../FirstRun";
import { DeleteConfirm } from "../../DeleteConfirm";
import { DoneWarning } from "../../DoneWarning";
import { BoardRow } from "../../BoardRow";
import { EpicHeaderRow } from "../../EpicHeaderRow";
import { ProjectRail } from "../../../projects/ProjectRail";
import { ProjectUnreachable } from "../../../projects/ProjectUnreachable";
import { OrphanRecoveryModal } from "../../../recovery/OrphanRecoveryModal";
import type { EpicProgressDto } from "../../../adapters/tauri";
import type { BoardItem, Project } from "../../useBoardQuery";
import { LIGHT, DARK } from "../../../theme/tokens";
import { contrastRatio } from "../../../theme/contrast";

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PALETTE = scheme === "dark" ? DARK : LIGHT;
const OUT = "../../../../../../.impeccable/review";
const OUT_FROM_ROOT = "../../.impeccable/review";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const WIDTH = 1440;

const toHex = (computed: string): string => {
  const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)!;
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
};
const ratio = (a: string, b: string) => contrastRatio(a, b);
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 300));
const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
/** A colour as it reads beneath a translucent scrim: the board's own text and ground, dimmed by what covers them. */
const beneath = (hex: string, scrim: string): string => {
  const [sr, sg, sb, sa] = scrim.match(/[\d.]+/g)!.map(Number);
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number, s: number) => Math.round(c * (1 - sa) + s * sa);
  return "#" + [mix((n >> 16) & 255, sr), mix((n >> 8) & 255, sg), mix(n & 255, sb)].map((v) => v.toString(16).padStart(2, "0")).join("");
};

async function writeHtml(name: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}, ${scheme}</title>` +
    `<style>${tokensCss}\n${typeCss}\n${motionCss}\n${appCss}\n${statesCss}</style></head><body>${document.body.innerHTML}</body></html>`;
  await commands.writeFile(`${OUT_FROM_ROOT}/${name}-${scheme}.html`, html);
}

/** A drawn action: a transparent ground, a 3:1 edge and 4.5:1 text, whatever surface it sits on. */
function expectDrawn(button: HTMLElement, name: string, ground: string) {
  const style = getComputedStyle(button);
  expect(style.backgroundColor, `${name} must not be filled`).toBe(TRANSPARENT);
  expect(ratio(toHex(style.borderTopColor), ground), `${name}'s edge`).toBeGreaterThanOrEqual(3);
  expect(ratio(toHex(style.color), ground), `${name}'s text`).toBeGreaterThanOrEqual(4.5);
}

function expectNoFilledButton(root: ParentNode, where: string) {
  const buttons = Array.from(root.querySelectorAll("button"));
  expect(buttons.length, `${where}: found no buttons`).toBeGreaterThan(0);
  for (const b of buttons) {
    const bg = getComputedStyle(b).backgroundColor;
    expect(bg, `${where}: "${b.textContent}" is filled`).toBe(TRANSPARENT);
    expect(bg).not.toBe(rgbOf(PALETTE.accentNontext));
  }
}

function installTauriBridge() {
  const answers: Record<string, unknown> = {
    board_change_flags: [],
    board_blocked_summary: { blockedTaskIds: [], blockedCount: 0 },
    board_recovery_summary: { recoveryTaskIds: [], recoveryCount: 0 },
    actor_list: [],
    epic_list_all: { epics: [] },
  };
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: (command: string) => Promise.resolve(answers[command] ?? 1),
  };
}

type Task = { id: string; epic_id: string | null; key: string; title: string; status: string; priority: number; estimate: number | null };
const tasks = data.tasks as Task[];
const epics = data.epics as { id: string; key: string; title: string; status: string }[];
const epicsById = Object.fromEntries(epics.map((e) => [e.id, { id: e.id, key: e.key, title: e.title }]));
const toItem = (t: Task): BoardItem => ({
  id: t.id, kind: "task", key: t.key, title: t.title, status: t.status, rank: "a0", priority: t.priority,
  epicId: t.epic_id, estimate: t.estimate, criteriaChecked: 0, criteriaTotal: 0,
});
const progressFor = (epicId: string | null): EpicProgressDto => {
  const mine = tasks.filter((t) => t.epic_id === epicId);
  const byStatus = ["done", "in_review", "in_progress", "todo", "backlog"]
    .map((status) => ({ status, count: mine.filter((t) => t.status === status).length }))
    .filter((s) => s.count > 0);
  return { epicId, byStatus, total: mine.length, done: mine.filter((t) => t.status === "done").length, agentsRunning: 0, agentsBlocked: 0, criteria: null };
};
const projects: Project[] = [ACTIVE, UNREACHABLE].map((p) => ({ ...p, status: p.status === "unreachable" ? "unreachable" : "reachable" })) as Project[];

/** The real board behind a confirmation: the rail, every epic header and the first epic's real tasks. */
function BoardBackdrop() {
  const noop = () => {};
  const expanded = epics.find((e) => e.key === "THRE-14")!;
  const expandedTasks = tasks.filter((t) => t.epic_id === expanded.id).slice(0, 14);
  return (
    <div className="rack-ground" style={{ display: "flex", width: WIDTH, height: 900, overflow: "hidden" }}>
      <div style={{ display: "flex", flexShrink: 0 }}>
        <ProjectRail projects={projects} currentProjectId={ACTIVE.id} onSelect={noop} />
      </div>
      <main style={{ flex: 1, minWidth: 0 }}>
        <div role="list" aria-label="Board">
          {epics.map((epic) => (
            <div key={epic.id}>
              <div style={{ height: 56 }} className="epic-header-cell">
                <EpicHeaderRow
                  epicId={epic.id} epicKey={epic.key} title={epic.title} progress={progressFor(epic.id)} status={epic.status}
                  integrationBranch={null} pendingProposalCount={0} collapsed={epic.id !== expanded.id} onToggleCollapsed={noop}
                />
              </div>
              {epic.id === expanded.id &&
                expandedTasks.map((t, i) => (
                  <div key={t.id} style={{ height: 40 }}>
                    <BoardRow item={toItem(t)} epicsById={epicsById} hideEpicPill selected={i === 0} focused={i === 0} />
                  </div>
                ))}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function mountPage(node: React.ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {node}
    </QueryClientProvider>,
  );
}

/** The text of the board, as it reads beneath the scrim: still legible, so the scrim dims it and does not erase it. */
function expectBoardLegibleBeneath(scrim: string, where: string) {
  const ground = beneath(PALETTE.surfaceDominant, scrim);
  const text = beneath(PALETTE.textPrimaryRack, scrim);
  expect(ratio(text, ground), `${where}: the board under the scrim`).toBeGreaterThanOrEqual(4.5);
}

beforeEach(() => {
  installTauriBridge();
});

describe(`states and confirms group, built, ${scheme} scheme${reduced ? ", reduced motion" : ""}`, () => {
  it("first run: the mark, a 20px heading, one 2px ink lead, nothing filled; the confirm step's field wears the ink ring", async () => {
    mountPage(<div style={{ width: WIDTH, height: 900 }}><FirstRun /></div>);
    const ground = PALETTE.surfaceDominant;
    const mark = screen.getByRole("img", { name: /flywheel/i });
    expect(mark.tagName).toBe("IMG");
    await waitFor(() => expect((mark as HTMLImageElement).naturalWidth, "the mark must really load").toBeGreaterThan(0));

    const surface = document.querySelector<HTMLElement>(".first-run")!;
    expect(toHex(getComputedStyle(surface).backgroundColor)).toBe(ground);
    expect(surface.getBoundingClientRect().height, "the state fills the window").toBeGreaterThanOrEqual(880);
    const heading = screen.getByRole("heading", { name: "No projects yet" });
    expect(getComputedStyle(heading).fontSize).toBe("20px");
    expect(getComputedStyle(heading).fontWeight).toBe("600");
    expect(getComputedStyle(heading).marginTop, "the gap is the only spacing").toBe("0px");
    // The explanation is held to a readable measure.
    const body = screen.getByText(/Register a local git repository/);
    expect(body.getBoundingClientRect().width).toBeLessThanOrEqual(60 * 13);
    expect(ratio(toHex(getComputedStyle(body).color), ground)).toBeGreaterThanOrEqual(4.5);

    expectNoFilledButton(document.body, "first run");
    const register = screen.getByRole("button", { name: "Register Project…" });
    expectDrawn(register, "Register Project…", ground);
    const lead = getComputedStyle(register);
    expect(lead.borderTopWidth, "the one lead of the surface").toBe("2px");
    expect(toHex(lead.borderTopColor)).toBe(PALETTE.selectionRule);
    expect(toHex(lead.borderTopColor)).not.toBe(PALETTE.accentNontext);
    expect(lead.borderTopLeftRadius).toBe("6px");

    await userEvent.hover(heading); // park the pointer off the button
    await settle();
    await page.screenshot({ path: `${OUT}/states-group-built-${scheme}-first-run-1440x900.png` });
    await writeHtml("states-group-built-first-run");

    // The second step: confirm the key. The field draws a 3:1 boundary and wears the ink ring, not the brand.
    await userEvent.click(register);
    const field = (await screen.findByLabelText("Project key prefix")) as HTMLInputElement;
    expect(field.value).toBe("FLYW");
    expect(ratio(toHex(getComputedStyle(field).borderTopColor), ground)).toBeGreaterThanOrEqual(3);
    field.focus();
    await waitFor(() => expect(document.activeElement).toBe(field));
    const ring = getComputedStyle(field);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBe("2px");
    expect(toHex(ring.outlineColor), "the ink rule, not the brand").toBe(PALETTE.selectionRule);
    field.blur();
    const confirm = screen.getByRole("button", { name: "Register Project" });
    expectDrawn(confirm, "Register Project", ground);
    expect(getComputedStyle(confirm).borderTopWidth).toBe("2px");
    await userEvent.hover(screen.getByRole("heading", { name: "Register flywheel" }));
    await settle();
    await page.screenshot({ path: `${OUT}/states-group-built-${scheme}-first-run-confirm-1440x900.png` });
  });

  it("unreachable: the real duplicate registration; the glyph is paired with the word; one 2px lead; the path is readable", async () => {
    mountPage(<div style={{ width: WIDTH, height: 900 }}><ProjectUnreachable project={UNREACHABLE as Project} /></div>);
    const ground = PALETTE.surfaceDominant;
    const surface = document.querySelector<HTMLElement>(".project-unreachable")!;
    expect(toHex(getComputedStyle(surface).backgroundColor)).toBe(ground);

    // Glyph and the literal word, in the destructive text role (4.5:1), so it is never colour alone.
    const flag = screen.getByText("Unreachable");
    expect(flag.querySelector("svg"), "the glyph").toBeTruthy();
    expect(flag.querySelector("svg")!.closest("[aria-hidden='true']"), "the glyph is decorative: the word names it").toBeTruthy();
    expect(toHex(getComputedStyle(flag).color)).toBe(PALETTE.destructiveTextRack);
    expect(ratio(toHex(getComputedStyle(flag).color), ground)).toBeGreaterThanOrEqual(4.5);
    expect(getComputedStyle(flag).fontSize).toBe("13px");

    expect(getComputedStyle(screen.getByRole("heading", { name: "Can’t find this project" })).fontSize).toBe("20px");
    const body = screen.getByText(/Nothing was scanned or guessed automatically/);
    expect(body.textContent).toContain(REAL_REPO_PATH);
    expect(body.scrollWidth, "a long path wraps, it does not overflow").toBeLessThanOrEqual(body.clientWidth);

    expectNoFilledButton(document.body, "unreachable");
    const locate = screen.getByRole("button", { name: "Locate Project…" });
    expect(document.querySelectorAll("button"), "exactly one action").toHaveLength(1);
    expectDrawn(locate, "Locate Project…", ground);
    expect(getComputedStyle(locate).borderTopWidth).toBe("2px");
    expect(toHex(getComputedStyle(locate).borderTopColor)).toBe(PALETTE.selectionRule);

    await userEvent.hover(screen.getByRole("heading", { name: "Can’t find this project" }));
    await settle();
    await page.screenshot({ path: `${OUT}/states-group-built-${scheme}-unreachable-1440x900.png` });
    await writeHtml("states-group-built-unreachable");
  });

  it("delete confirm over the real board: dialog tier, the per-mode scrim, Delete is the destructive text role with an icon", async () => {
    const onCancel = vi.fn();
    mountPage(
      <>
        <BoardBackdrop />
        <DeleteConfirm itemType="Task" itemKey="THRE-58" title="Debounce the chip toggles so one click is one query" onConfirm={() => {}} onCancel={onCancel} />
      </>,
    );
    const dialogEl = await screen.findByRole("alertdialog", { name: "Delete Task THRE-58?" });
    expect(document.body.textContent, "the real board is behind the scrim").toContain("THRE-14");

    // The tier, as WebKit computes it: scrim at full value on frame one, dialog shadow, dialog edge, chrome radius.
    const scrim = getComputedStyle(dialogEl);
    expect(scrim.backgroundColor, "the per-mode scrim").toBe(scheme === "dark" ? "rgba(0, 0, 0, 0.4)" : "rgba(31, 35, 40, 0.4)");
    expect(scrim.opacity).toBe("1");
    expect(scrim.animationName, "an overlay never interpolates on mount").toBe("none");
    expect(scrim.position).toBe("fixed");
    expectBoardLegibleBeneath(scrim.backgroundColor, "delete confirm");
    const dialog = dialogEl.firstElementChild as HTMLElement;
    const d = getComputedStyle(dialog);
    expect(toHex(d.borderTopColor), "the dialog-tier edge").toBe(PALETTE.borderDialog);
    expect(d.borderTopWidth).toBe("1px");
    expect(d.borderTopLeftRadius).toBe("6px");
    expect(d.boxShadow, "the dialog shadow").toContain(PALETTE.shadowDialog.match(/rgba\([^)]*\)/)![0]);
    expect(toHex(d.backgroundColor)).toBe(PALETTE.surfaceSecondary);

    // The consequence sentence is the crux of a destructive confirm: primary ink, not muted.
    const consequence = within(dialog).getByText(/will be permanently removed/);
    expect(toHex(getComputedStyle(consequence).color)).toBe(PALETTE.textPrimaryRack);

    // Cancel takes focus; Delete is never the default.
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const del = within(dialog).getByRole("button", { name: "Delete" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expectNoFilledButton(dialog, "delete confirm");
    expectDrawn(cancel, "Cancel", PALETTE.surfaceSecondary);
    expect(getComputedStyle(cancel).borderTopWidth).toBe("1px");

    // Delete: the destructive text role on a 2px edge, never a fill, icon-paired, the same size as Cancel.
    const ds = getComputedStyle(del);
    expect(ds.backgroundColor, "a destructive fill fails AA").toBe(TRANSPARENT);
    expect(toHex(ds.color)).toBe(PALETTE.destructiveTextRack);
    expect(toHex(ds.borderTopColor)).toBe(PALETTE.destructiveTextRack);
    expect(ds.borderTopWidth).toBe("2px");
    expect(ratio(toHex(ds.color), PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(toHex(ds.borderTopColor), PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(3);
    expect(del.querySelector("svg"), "the icon pairs with the word").toBeTruthy();
    expect(toHex(getComputedStyle(del.querySelector("svg")!).color)).toBe(PALETTE.destructiveTextRack);
    expect(del.offsetHeight, "a lead and its neighbour are the same height").toBe(cancel.offsetHeight);

    // The destructive hover: the quiet wash, and the text still clears 4.5 on it (the divider wash did not, in dark).
    await userEvent.hover(del);
    await settle();
    expect(toHex(getComputedStyle(del).borderTopColor), "a destructive action keeps its edge on hover").toBe(PALETTE.destructiveTextRack);
    expect(ratio(PALETTE.destructiveTextRack, PALETTE.rowSurfaceHover)).toBeGreaterThanOrEqual(4.5);
    await userEvent.hover(within(dialog).getByRole("heading"));
    await settle();
    await page.screenshot({ path: `${OUT}/states-group-built-${scheme}-delete-confirm-1440x900.png` });
    await writeHtml("states-group-built-delete-confirm");

    // Escape still cancels.
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("done warning over the real board: still the popover tier, no scrim, appears on frame one", async () => {
    mountPage(
      <>
        <BoardBackdrop />
        <DoneWarning checked={1} total={3} onConfirm={() => {}} onCancel={() => {}} />
      </>,
    );
    const warning = await screen.findByRole("alertdialog", { name: "Unchecked acceptance criteria" });
    const w = getComputedStyle(warning);
    expect(toHex(w.borderTopColor)).toBe(PALETTE.borderPopover);
    expect(w.animationName).toBe("none");
    expect(w.opacity).toBe("1");
    expect(toHex(getComputedStyle(screen.getByText(/Enter to confirm/)).color)).toBe(PALETTE.textMutedRack);
    await settle();
    await page.screenshot({ path: `${OUT}/states-group-built-${scheme}-done-warning-1440x900.png` });
  });

  it("orphan recovery over the real board: dialog tier, Kill All is the destructive text role with an icon, and it still blocks", async () => {
    mountPage(
      <>
        <BoardBackdrop />
        <OrphanRecoveryModal />
      </>,
    );
    const dialogEl = await screen.findByRole("alertdialog");
    await screen.findAllByRole("button", { name: "Kill" });
    expect(document.body.textContent, "the real board is behind the scrim").toContain("THRE-14");

    const scrim = getComputedStyle(dialogEl);
    expect(scrim.backgroundColor, "the per-mode scrim").toBe(scheme === "dark" ? "rgba(0, 0, 0, 0.4)" : "rgba(31, 35, 40, 0.4)");
    expect(scrim.opacity).toBe("1");
    expect(scrim.animationName).toBe("none");
    expectBoardLegibleBeneath(scrim.backgroundColor, "orphan recovery");
    const dialog = dialogEl.firstElementChild as HTMLElement;
    const d = getComputedStyle(dialog);
    expect(toHex(d.borderTopColor), "the dialog-tier edge").toBe(PALETTE.borderDialog);
    expect(d.borderTopLeftRadius).toBe("6px");
    expect(dialog.getBoundingClientRect().width).toBe(560);
    expect(toHex(d.backgroundColor)).toBe(PALETTE.surfaceSecondary);

    // Three runs, a hairline between them (and none after the last), a drawn Kill each.
    const items = within(dialog).getAllByRole("listitem");
    expect(items).toHaveLength(ORPHANS.length);
    expect(getComputedStyle(items[0]).borderBottomWidth).toBe("1px");
    expect(toHex(getComputedStyle(items[0]).borderBottomColor)).toBe(PALETTE.divider);
    expect(getComputedStyle(items[items.length - 1]).borderBottomWidth).toBe("0px");
    expectNoFilledButton(dialog, "orphan recovery");
    const kills = within(dialog).getAllByRole("button", { name: "Kill" });
    expect(kills).toHaveLength(ORPHANS.length);
    for (const k of kills) {
      expectDrawn(k, "Kill", PALETTE.surfaceSecondary);
      expect(getComputedStyle(k).borderTopWidth).toBe("1px");
    }
    await waitFor(() => expect(document.activeElement).toBe(kills[0]));

    const killAll = within(dialog).getByRole("button", { name: "Kill All" });
    const ks = getComputedStyle(killAll);
    expect(ks.backgroundColor, "a destructive fill fails AA").toBe(TRANSPARENT);
    expect(toHex(ks.color)).toBe(PALETTE.destructiveTextRack);
    expect(toHex(ks.borderTopColor)).toBe(PALETTE.destructiveTextRack);
    expect(ks.borderTopWidth).toBe("2px");
    expect(ratio(toHex(ks.color), PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(4.5);
    expect(killAll.querySelector("svg"), "the icon pairs with the word").toBeTruthy();
    expect(killAll.offsetHeight).toBe(kills[0].offsetHeight);

    // The footnote is on the locked scale (11px), not the 10px micro role, and is legible.
    const note = within(dialog).getByText(/spending tokens right now/);
    expect(getComputedStyle(note).fontSize).toBe("11px");
    expect(ratio(toHex(getComputedStyle(note).color), PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(4.5);

    // The running glyph pulses (the carve-out), or sits at full opacity under reduced motion: the class is absent.
    const glyph = dialog.querySelector<HTMLElement>("[aria-hidden='true'].agent-pulse, [aria-hidden='true'] > svg")!.closest<HTMLElement>("span")!;
    if (reduced) {
      expect(glyph.classList.contains("agent-pulse")).toBe(false);
      expect(getComputedStyle(glyph).opacity).toBe("1");
    } else {
      expect(getComputedStyle(glyph).animationName).toBe("agent-pulse");
    }

    await userEvent.hover(within(dialog).getByRole("heading"));
    await settle();
    await page.screenshot({ path: `${OUT}/states-group-built-${scheme}-recovery-1440x900.png` });
    await writeHtml("states-group-built-recovery");

    // It still blocks. Escape does nothing, a click on the scrim does nothing, and nothing behind it can be reached:
    // the hit test over a real board row lands in the blocking layer. (Tab is not probed: WebKit does not Tab to
    // buttons by default, see review/__tests__/browser/keyboard.browser.test.tsx; the trap is pinned in jsdom.)
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog"), "Escape must not dismiss the blocking layer").toBeTruthy();
    await userEvent.click(dialogEl, { position: { x: 8, y: 8 } });
    expect(screen.queryByRole("alertdialog"), "a click on the scrim must not dismiss it").toBeTruthy();
    const row = document.querySelector<HTMLElement>(".board-row")!;
    const at = row.getBoundingClientRect();
    const hit = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
    expect(dialogEl.contains(hit), "paint behind the blocking layer must be unreachable").toBe(true);
  });
});
