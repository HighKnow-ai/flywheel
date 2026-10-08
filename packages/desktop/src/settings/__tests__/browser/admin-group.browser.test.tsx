/**
 * The expensive gate's capture step for surface group five (08.1 plan 18, D-24): settings with a populated
 * permission-rules table, the triage surface, the open authoring tray (and its amend editor), and the published
 * legend (embedded, and as the dialog), as the REAL components paint them in WebKit at 1440x900 in whichever
 * colour scheme the config selected. Written into `.impeccable/review/` as
 * `admin-group-built-<scheme>-{settings,triage,tray,legend,legend-dialog}-1440x900`.
 *
 * No comp exists for this group (plan 04 comped Mission Control, the item detail and the review surface), so
 * these are reviewed against 08.1-UI-SPEC.md's contract, not an image.
 *
 * Content. The project is the real board's own (`threadfin`, THRE) and the epics are its real epics, from the
 * 08.1-03 export. The real board holds NO authoring proposals and no permission rules, so every proposal and
 * every rule is a FIXTURE, each labelled on the page. Nothing is seeded into the real database.
 *
 * What it pins that jsdom cannot: that no control in the group is filled or painted in the brand, that every
 * control draws a 3:1 boundary, that a lead and its neighbour are the same size, that the chosen value is an
 * ink edge and a foot rule, that the rules table's columns line up, that a proposal row's selection is the
 * neutral rule and a mouse click leaves no ring, that a field wears the ink ring, and that the legend draws what
 * the board draws and the dialog sits on the dialog tier.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { commands, page, userEvent } from "vitest/browser";
import data from "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";

const PROJECT = {
  id: "01M22XBK2AMH58GBVV4VDXT8H3",
  keyPrefix: "THRE",
  name: "threadfin",
  repoPath: "/Users/dev/threadfin",
  defaultBranch: "main",
  status: "active",
};

const proposal = (over: Record<string, unknown>) => ({
  id: "p",
  agentRunId: "run-abc12345",
  epicId: null,
  verb: "create",
  targetType: "task",
  targetId: null,
  parentProposalId: null,
  position: "a0",
  payload: { kind: "task", title: "" },
  status: "pending",
  createdBy: "actor-agent",
  createdAt: "2026-10-08T09:00:00.000Z",
  rationale: "FIXTURE: invented, the real board has no proposals.",
  originLogOffset: null,
  duplicateOf: null,
  duplicateScore: null,
  duplicateCandidate: null,
  ...over,
});
const EPIC_ID = (data.epics.find((e) => e.key === "THRE-6") ?? data.epics[0]).id;
const PROPOSALS = [
  proposal({
    id: "p1",
    epicId: EPIC_ID,
    payload: { kind: "task", title: "FIXTURE: Cache the epic picker's option list", description: "Build it once and reuse it across renders." },
    originLogOffset: 0,
  }),
  proposal({
    id: "p2",
    parentProposalId: "p1",
    position: "a0",
    targetType: "criterion",
    payload: { kind: "criterion", statement: "FIXTURE: the diff shows a memoised source, not a rebuild per keystroke", verification_hint: "read the picker's render path" },
  }),
  proposal({
    id: "p3",
    parentProposalId: "p1",
    position: "a1",
    targetType: "criterion",
    payload: { kind: "criterion", statement: "FIXTURE: a unit test pins the cache key" },
  }),
  proposal({
    id: "p4",
    epicId: EPIC_ID,
    verb: "amend",
    targetId: "t-1",
    payload: { kind: "task", title: "FIXTURE: Rename the worktree summary's open action" },
    duplicateCandidate: { kind: "task", key: "THRE-33", title: "Cache the epic picker" },
  }),
];

const RULES = [
  { id: "r1", projectId: PROJECT.id, toolName: "Bash(npm run test:*)", decision: "allow", createdAt: "2026-09-30T10:00:00.000Z" },
  { id: "r2", projectId: PROJECT.id, toolName: "Edit", decision: "allow", createdAt: "2026-10-02T10:00:00.000Z" },
  { id: "r3", projectId: PROJECT.id, toolName: "mcp__github__create_pull_request_with_a_very_long_name", decision: "allow", createdAt: "2026-10-06T10:00:00.000Z" },
];

const world = { proposals: PROPOSALS as unknown[] };

vi.mock("../../../adapters/tauri", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const route = (command: string): unknown => {
    if (command === "project_list") return [PROJECT];
    if (command === "board_list") return { items: [], issues: [], counts: { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 } };
    return undefined;
  };
  const counts = (n: number) => ({ pending: n, accepted: 0, rejected: 0, merged: 0, deferred: 0 });
  return {
    ...real,
    invokeCommand: (command: string) => Promise.resolve(route(command)),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    getSettings: () =>
      Promise.resolve({
        globalCredentialMode: "local",
        projectOverrides: [{ projectId: PROJECT.id, projectName: PROJECT.name, credentialMode: null }],
        apiKeyConfigured: false,
        apiKeyConfiguredAt: null,
      }),
    backendCapabilityProbe: () => Promise.resolve({ available: true, version: "2.1.0", apiKeyPathUsable: true }),
    projectForgeOverrides: () => Promise.resolve([{ projectId: PROJECT.id, projectName: PROJECT.name, forge: null }]),
    listPermissionRules: () => Promise.resolve(RULES),
    revokePermissionRule: () => Promise.resolve(undefined),
    openCommandTemplate: (surface: string) => Promise.resolve(surface === "editor" ? "code {worktree_path}" : "open -a Terminal {worktree_path}"),
    setOpenCommandTemplate: () => Promise.resolve(undefined),
    setCredentialMode: () => Promise.resolve(undefined),
    authoringProposalsPending: () => Promise.resolve({ proposals: world.proposals, counts: counts(world.proposals.length) }),
    authoringProposalsDeferred: () => Promise.resolve({ proposals: [], counts: counts(0) }),
    authoringProposalLimitNotices: () =>
      Promise.resolve([
        { agentRunId: "run-abc12345", taskId: null, limit: 20, refusedCount: 3, firstRefusedAt: "2026-10-08T09:00:00.000Z", lastRefusedAt: "2026-10-08T09:01:00.000Z" },
      ]),
    authoringProposalsForRun: () => Promise.resolve(world.proposals),
    acceptAuthoringProposal: () => new Promise(() => {}),
    rejectAuthoringProposal: () => new Promise(() => {}),
    amendAuthoringProposal: () => new Promise(() => {}),
  };
});

import tokensCss from "../../../styles/tokens.css?raw";
import typeCss from "../../../styles/type.css?raw";
import motionCss from "../../../styles/motion.css?raw";
import appCss from "../../../App.css?raw";
import adminCss from "../../../styles/admin-surfaces.css?raw";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { SettingsSurface } from "../../SettingsSurface";
import { TriageSurface } from "../../../triage/TriageSurface";
import { ProposalTray } from "../../../authoring/ProposalTray";
import { Legend } from "../../../legend/Legend";
import { DoneWarning } from "../../../board/DoneWarning";
import { resetUiState } from "../../../state/uiStore";
import { LIGHT, DARK } from "../../../theme/tokens";
import { contrastRatio } from "../../../theme/contrast";

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const PALETTE = scheme === "dark" ? DARK : LIGHT;
const OUT = "../../../../../../.impeccable/review";
const OUT_FROM_ROOT = "../../.impeccable/review";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

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

const FIXTURE_NOTE =
  "FIXTURE: the real board has no authoring proposals and no permission rules, so the ones on this page are invented.";

function mount(node: React.ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div className="rack-ground" style={{ height: 900, width: 1440, position: "relative", overflow: "hidden" }}>
        {node}
        <p className="type-label" style={{ position: "absolute", right: 24, bottom: 8, margin: 0, color: "var(--text-muted-rack)", zIndex: 1 }}>
          {FIXTURE_NOTE}
        </p>
      </div>
    </QueryClientProvider>,
  );
}

async function writeHtml(name: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}, ${scheme}</title>` +
    `<style>${tokensCss}\n${typeCss}\n${motionCss}\n${appCss}\n${adminCss}</style></head><body>${document.body.innerHTML}</body></html>`;
  await commands.writeFile(`${OUT_FROM_ROOT}/${name}-${scheme}.html`, html);
}

/** A drawn action: a transparent ground, a 3:1 edge and 4.5:1 text, whatever surface it sits on. */
function expectDrawn(button: HTMLElement, name: string, ground: string) {
  const style = getComputedStyle(button);
  expect(style.backgroundColor, `${name} must not be filled`).toBe(TRANSPARENT);
  expect(ratio(toHex(style.borderTopColor), ground), `${name}'s edge`).toBeGreaterThanOrEqual(3);
  expect(ratio(toHex(style.color), ground), `${name}'s text`).toBeGreaterThanOrEqual(4.5);
}

/** No button on the page is filled, and none paints the brand. */
function expectNoFilledButton(root: ParentNode, where: string) {
  const buttons = Array.from(root.querySelectorAll("button"));
  expect(buttons.length, `${where}: found no buttons`).toBeGreaterThan(0);
  for (const b of buttons) {
    const bg = getComputedStyle(b).backgroundColor;
    expect(bg, `${where}: "${b.textContent}" is filled`).toBe(TRANSPARENT);
    expect(bg).not.toBe(rgbOf(PALETTE.accentNontext));
  }
}

beforeEach(() => {
  resetUiState();
  world.proposals = PROPOSALS;
});

describe(`admin group, built, ${scheme} scheme`, () => {
  it("settings: a chosen value is an ink edge and a foot rule, the table lines up, nothing is filled", async () => {
    mount(<SettingsSurface onBack={() => {}} />);
    await screen.findByRole("table", { name: "Permission rules" });
    await screen.findByText("Edit");
    await waitFor(() => expect(screen.getByLabelText("Open in editor")).toBeTruthy());
    const ground = PALETTE.surfaceDominant;

    expectNoFilledButton(document.body, "settings");

    // The credential path: one chosen, three or two others. The chosen is a value, not a lead.
    const group = screen.getByRole("radiogroup", { name: "Credential path" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    const chosen = radios.find((r) => r.getAttribute("aria-checked") === "true")!;
    const other = radios.find((r) => r !== chosen)!;
    expect(chosen.textContent).toBe("Local Claude Code Credentials");
    const c = getComputedStyle(chosen);
    expect(toHex(c.borderTopColor), "the chosen segment's ink edge").toBe(PALETTE.selectionRule);
    expect(c.borderTopWidth, "a value, not a lead: a 1px box").toBe("1px");
    expect(c.boxShadow, "the 2px ink foot rule").toContain(rgbOf(PALETTE.selectionRule));
    expect(c.backgroundColor, "no brand fill, no surface shift").toBe(TRANSPARENT);
    expect(c.fontWeight, "a chosen segment must not grow: it would push its neighbour").toBe(getComputedStyle(other).fontWeight);
    expect(toHex(getComputedStyle(other).borderTopColor)).toBe(PALETTE.borderControl);
    expectDrawn(other, "the unchosen segment", ground);
    expect(chosen.offsetHeight).toBe(other.offsetHeight);

    // A field: a 3:1 boundary, the ink ring.
    const field = screen.getByLabelText("Open in editor") as HTMLInputElement;
    expect(ratio(toHex(getComputedStyle(field).borderTopColor), ground)).toBeGreaterThanOrEqual(3);
    field.focus();
    await waitFor(() => expect(document.activeElement).toBe(field));
    const ring = getComputedStyle(field);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBe("2px");
    expect(toHex(ring.outlineColor), "the ink rule, not the brand").toBe(PALETTE.selectionRule);
    field.blur();

    // Sections are hairline-separated, not carded.
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".admin-section"));
    expect(sections.length).toBeGreaterThanOrEqual(4);
    expect(getComputedStyle(sections[0]).borderTopWidth).toBe("0px");
    expect(getComputedStyle(sections[1]).borderTopWidth).toBe("1px");
    expect(toHex(getComputedStyle(sections[1]).borderTopColor)).toBe(PALETTE.divider);
    for (const s of sections) expect(getComputedStyle(s).backgroundColor).toBe(TRANSPARENT);

    // The rules table: headings and rows share one grid, so columns line up; hairlines; no fill, no stripe.
    const table = screen.getByRole("table", { name: "Permission rules" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(RULES.length + 1);
    const lefts = (row: HTMLElement) => Array.from(row.children).slice(0, 4).map((el) => Math.round((el as HTMLElement).getBoundingClientRect().left));
    for (const row of rows.slice(1)) expect(lefts(row), "a data row's columns start where the heading's do").toEqual(lefts(rows[0]));
    for (const row of rows) {
      const s = getComputedStyle(row);
      expect(s.backgroundColor, "no fill and no stripe").toBe(TRANSPARENT);
      expect(s.borderBottomWidth).toBe("1px");
      expect(toHex(s.borderBottomColor)).toBe(PALETTE.divider);
    }
    const revokes = within(table).getAllByRole("button", { name: "Revoke" });
    expect(revokes).toHaveLength(RULES.length);
    for (const r of revokes) expectDrawn(r, "Revoke", ground);
    // The long tool name sits in its own cell and does not push Revoke off the row.
    expect(revokes[2].getBoundingClientRect().right).toBeLessThanOrEqual(rows[3].getBoundingClientRect().right);

    await userEvent.hover(screen.getByText(/FIXTURE: the real board/)); // park the pointer
    await settle();
    await page.screenshot({ path: `${OUT}/admin-group-built-${scheme}-settings-1440x900.png` });
    await writeHtml("admin-group-built-settings");
  });

  it("triage: Pending is a chosen value, rows select with the neutral rule, a click leaves no ring, nothing is filled", async () => {
    mount(
      <TriageSurface
        projectId={PROJECT.id}
        epicsById={Object.fromEntries(data.epics.map((e) => [e.id, { id: e.id, key: e.key, title: e.title }]))}
        onOpenSession={() => {}}
        onClose={() => {}}
      />,
    );
    await screen.findByRole("group", { name: /^Proposed task: FIXTURE: Cache the epic picker/ });
    const ground = PALETTE.surfaceDominant;
    expectNoFilledButton(document.body, "triage");

    // Pending / Deferred: a value. Pending is chosen: ink edge + foot rule; both transparent.
    const pending = screen.getByRole("button", { name: "Pending" });
    const deferred = screen.getByRole("button", { name: "Deferred" });
    expect(pending.getAttribute("aria-pressed")).toBe("true");
    expect(toHex(getComputedStyle(pending).borderTopColor)).toBe(PALETTE.selectionRule);
    expect(getComputedStyle(pending).boxShadow).toContain(rgbOf(PALETTE.selectionRule));
    expect(toHex(getComputedStyle(deferred).borderTopColor)).toBe(PALETTE.borderControl);
    expect(getComputedStyle(deferred).boxShadow).toBe("none");
    expectDrawn(deferred, "Deferred", ground);

    // Bulk actions are drawn, disabled until something is selected.
    const rejectSelected = screen.getByRole("button", { name: "Reject selected" });
    expect(ratio(toHex(getComputedStyle(rejectSelected).borderTopColor), ground)).toBeGreaterThanOrEqual(3);

    // The first row holds the cursor: a 2px ink rule and the selected surface. The others reserve the edge and show none.
    const rowsEls = () => Array.from(document.querySelectorAll<HTMLElement>(".proposal-row"));
    const rowsNow = rowsEls();
    expect(rowsNow).toHaveLength(PROPOSALS.length);
    await waitFor(() => expect(rowsNow[0].getAttribute("data-selected")).toBe("true"));
    const first = getComputedStyle(rowsNow[0]);
    expect(first.borderLeftWidth).toBe("2px");
    expect(toHex(first.borderLeftColor)).toBe(PALETTE.selectionRule);
    expect(toHex(first.backgroundColor)).toBe(PALETTE.rowSurfaceSelected);
    const second = getComputedStyle(rowsNow[1]);
    expect(second.borderLeftWidth, "the edge is reserved so a row changing state never reflows").toBe("2px");
    expect(second.borderLeftColor).toBe(TRANSPARENT);
    expect(second.backgroundColor).toBe(TRANSPARENT);
    expect(getComputedStyle(rowsNow[0]).borderBottomWidth).toBe("1px");
    expect(toHex(getComputedStyle(rowsNow[0]).borderBottomColor)).toBe(PALETTE.divider);
    expect(first.borderTopLeftRadius, "rows are square").toBe("0px");

    // The row's actions: drawn, none a lead, the type label is muted and not brand.
    const accept = within(rowsNow[0]).getByRole("button", { name: "Accept" });
    expectDrawn(accept, "Accept", PALETTE.rowSurfaceSelected);
    expect(getComputedStyle(accept).borderTopWidth).toBe("1px");
    const typeLabel = within(rowsNow[0]).getByText("task");
    expect(toHex(getComputedStyle(typeLabel).color)).toBe(PALETTE.textMutedRack);

    // The cursor moves with a mouse click and the rule moves with it; no outline is left behind (the defect class).
    await userEvent.click(rowsNow[3]);
    await waitFor(() => expect(toHex(getComputedStyle(rowsEls()[3]).borderLeftColor)).toBe(PALETTE.selectionRule));
    expect(getComputedStyle(rowsEls()[0]).borderLeftColor).toBe(TRANSPARENT);
    for (const r of rowsEls()) expect(getComputedStyle(r).outlineStyle, "a click must not leave a ring on a row").toBe("none");
    await userEvent.click(rowsNow[0]); // back, so the capture reads the first row as the cursor

    // Inline text actions are ink and underlined, not the brand. The checkbox does not take the system accent.
    const jump = screen.getByRole("button", { name: "Jump to the turn that produced this proposal" });
    expect(toHex(getComputedStyle(jump).color)).toBe(PALETTE.textPrimaryRack);
    expect(getComputedStyle(jump).textDecorationLine).toBe("underline");
    const dup = screen.getByRole("button", { name: /THRE-33 Cache the epic picker/ });
    expect(toHex(getComputedStyle(dup).color)).toBe(PALETTE.textPrimaryRack);
    const check = screen.getAllByRole("checkbox")[0];
    expect(getComputedStyle(check).accentColor).toBe(rgbOf(PALETTE.textPrimaryRack));

    // The limit notice is hairline-bounded and has no fill.
    const notice = screen.getByRole("status");
    expect(getComputedStyle(notice).backgroundColor).toBe(TRANSPARENT);
    expect(toHex(getComputedStyle(notice).borderTopColor)).toBe(PALETTE.divider);

    await userEvent.hover(screen.getByText(/FIXTURE: the real board/)); // park the pointer
    document.querySelectorAll<HTMLElement>("div").forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }); // clicks scrolled the list
    await settle();
    await page.screenshot({ path: `${OUT}/admin-group-built-${scheme}-triage-1440x900.png` });
    await writeHtml("admin-group-built-triage");

    // The merge picker: options are menu rows, not boxed buttons.
    await userEvent.click(within(rowsNow[0]).getByRole("button", { name: "Merge" }));
    const picker = await screen.findByRole("group", { name: "Choose a merge target" });
    const options = within(picker).getAllByRole("button");
    expect(options.length).toBeGreaterThan(2);
    const option = options.find((o) => /THRE-6/.test(o.textContent ?? ""))!;
    expect(getComputedStyle(option).borderTopWidth).toBe("0px");
    expect(getComputedStyle(option).backgroundColor).toBe(TRANSPARENT);
    expectNoFilledButton(picker, "merge picker");

    await userEvent.hover(screen.getByText(/FIXTURE: the real board/)); // park the pointer
    await settle();
    await page.screenshot({ path: `${OUT}/admin-group-built-${scheme}-triage-merge-1440x900.png` });
  });

  it("the tray: the same row as the board's challenge, Save is the one lead, a field wears the ink ring", async () => {
    mount(
      <div style={{ width: 520, padding: 24, height: "100%", overflow: "auto" }}>
        <ProposalTray agentRunId="run-abc12345" />
      </div>,
    );
    const groupRow = await screen.findByRole("group", { name: /^Proposed task: FIXTURE: Cache the epic picker/ });
    await waitFor(() => expect(groupRow.getAttribute("data-selected")).toBe("true"));
    const ground = PALETTE.surfaceDominant;
    expectNoFilledButton(document.body, "tray");

    expect(toHex(getComputedStyle(groupRow).borderLeftColor)).toBe(PALETTE.selectionRule);
    // A drafted criterion nests under its task by indentation alone.
    const criterion = screen.getAllByRole("group", { name: /^Proposed criterion:/ })[0];
    expect(criterion.getBoundingClientRect().left).toBeGreaterThan(groupRow.getBoundingClientRect().left);
    const accept = within(groupRow).getByRole("button", { name: "Accept" });
    const reject = within(groupRow).getByRole("button", { name: "Reject" });
    expectDrawn(accept, "Accept", PALETTE.rowSurfaceSelected);
    expectDrawn(reject, "Reject", PALETTE.rowSurfaceSelected);
    expect(accept.offsetHeight).toBe(reject.offsetHeight);
    // The reject-reason field: a 3:1 boundary.
    const reason = within(groupRow).getByLabelText(/^Reason for rejecting/);
    expect(ratio(toHex(getComputedStyle(reason).borderTopColor), ground)).toBeGreaterThanOrEqual(3);

    // Amend: the editor opens in the row, its first field is focused with the ink ring, Save leads.
    await userEvent.click(within(groupRow).getByRole("button", { name: "Amend" }));
    const title = await screen.findByLabelText("Title");
    await waitFor(() => expect(document.activeElement).toBe(title));
    const ring = getComputedStyle(title);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBe("2px");
    expect(toHex(ring.outlineColor), "the ink rule, not the brand").toBe(PALETTE.selectionRule);
    expect(ratio(toHex(ring.borderTopColor), ground)).toBeGreaterThanOrEqual(3);
    const save = screen.getByRole("button", { name: "Save" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expectDrawn(save, "Save", PALETTE.rowSurfaceSelected);
    expectDrawn(cancel, "Cancel", PALETTE.rowSurfaceSelected);
    expect(getComputedStyle(save).borderTopWidth).toBe("2px");
    expect(toHex(getComputedStyle(save).borderTopColor)).toBe(PALETTE.selectionRule);
    expect(getComputedStyle(cancel).borderTopWidth).toBe("1px");
    expect(save.offsetHeight, "the lead and Cancel are the same height").toBe(cancel.offsetHeight);

    await userEvent.hover(screen.getByText(/FIXTURE: the real board/)); // park the pointer
    await settle();
    await page.screenshot({ path: `${OUT}/admin-group-built-${scheme}-tray-1440x900.png` });
    await writeHtml("admin-group-built-tray");
  });

  it("the legend draws what the board draws: Triangle and Dot, the selection rule, no tint, and the dialog on its tier", async () => {
    render(
      <div className="rack-ground" style={{ height: 900, width: 1440, overflow: "auto" }}>
        <Legend />
      </div>,
    );
    const row = (label: string) => screen.getAllByRole("listitem").find((r) => r.textContent?.startsWith(label))!;
    const svgClass = (label: string) => row(label).querySelector("svg")!.getAttribute("class") ?? "";

    // The marks A-05 changed, and the mark that used to share a glyph with one of them.
    expect(svgClass("Commits ahead")).toContain("lucide-triangle");
    expect(svgClass("Uncommitted changes")).toContain("lucide-dot");
    expect(svgClass("Todo")).toMatch(/lucide-circle(\s|$)/);
    expect(svgClass("Current project")).not.toContain("lucide-dot");
    expect(svgClass("Done")).toContain("lucide-circle-check-big");

    // The selection rule is drawn on the two selected swatches, in the two ink roles, and not on the idle one.
    const swatch = (label: string) => row(label).querySelector<HTMLElement>("[aria-hidden]")!;
    expect(toHex(getComputedStyle(swatch("Selected row")).borderLeftColor)).toBe(PALETTE.selectionRule);
    expect(getComputedStyle(swatch("Selected row")).borderLeftWidth).toBe("2px");
    expect(toHex(getComputedStyle(swatch("Selected, unfocused row")).borderLeftColor)).toBe(PALETTE.selectionRuleUnfocused);
    expect(getComputedStyle(swatch("Idle row")).borderLeftWidth).toBe("1px");
    expect(getComputedStyle(swatch("Hovered row")).borderLeftWidth).toBe("1px");
    // The rule is told from the unfocused rule by more than hue.
    expect(ratio(PALETTE.selectionRule, PALETTE.selectionRuleUnfocused)).toBeGreaterThanOrEqual(3);

    // No status swatch is tinted: it is the same neutral swatch the priority glyphs sit on.
    expect(getComputedStyle(swatch("In Progress")).backgroundColor).toBe(getComputedStyle(swatch("Urgent")).backgroundColor);
    expect(toHex(getComputedStyle(swatch("In Progress")).backgroundColor)).toBe(PALETTE.surfaceSecondary);
    // The glyph is ink, never a strip ink or a brand.
    expect(toHex(getComputedStyle(row("Done").querySelector("svg")!).color)).toBe(PALETTE.textPrimaryRack);

    // Rows are hairline-separated.
    expect(toHex(getComputedStyle(row("Idle row")).borderBottomColor)).toBe(PALETTE.divider);

    await settle();
    await page.screenshot({ path: `${OUT}/admin-group-built-${scheme}-legend-1440x900.png` });
    await writeHtml("admin-group-built-legend");
  });

  it("the legend dialog: --scrim, --shadow-dialog, the dialog-tier edge, a drawn Close, full value on frame one", async () => {
    render(
      <div className="rack-ground" style={{ height: 900, width: 1440, overflow: "hidden" }}>
        <p className="type-body" style={{ padding: 24 }}>The board sits under the dialog; the dark scrim is 0.4 so it still shows.</p>
        <Legend onClose={() => {}} />
      </div>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Legend" });
    const scrim = dialog.parentElement as HTMLElement;
    expect(getComputedStyle(scrim).backgroundColor, "the scrim resolves from --scrim").toBe(
      scheme === "dark" ? "rgba(0, 0, 0, 0.4)" : "rgba(31, 35, 40, 0.4)",
    );
    const d = getComputedStyle(dialog);
    expect(d.boxShadow, "the dialog shadow resolves from --shadow-dialog").toContain(scheme === "dark" ? "rgba(0, 0, 0, 0.65)" : "rgba(31, 35, 40, 0.2)");
    expect(toHex(d.borderTopColor), "the dialog tier's edge").toBe(PALETTE.borderDialog);
    expect(ratio(PALETTE.borderDialog, PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(3);
    expect(d.borderTopLeftRadius).toBe("6px");
    expect(toHex(d.backgroundColor)).toBe(PALETTE.surfaceSecondary);
    expect(getComputedStyle(scrim).opacity).toBe("1");
    expect(d.opacity).toBe("1");
    expect(getComputedStyle(scrim).animationName).toBe("none");
    expect(getComputedStyle(dialog).animationName).toBe("none");
    expectDrawn(screen.getByRole("button", { name: "Close legend" }), "Close", PALETTE.surfaceSecondary);

    await settle();
    await page.screenshot({ path: `${OUT}/admin-group-built-${scheme}-legend-dialog-1440x900.png` });
    await writeHtml("admin-group-built-legend-dialog");
  });

  it("the done warning is a popover: the popover shadow and the popover edge, no scrim", async () => {
    render(<DoneWarning checked={1} total={3} onConfirm={() => {}} onCancel={() => {}} />);
    const warning = await screen.findByRole("alertdialog");
    const s = getComputedStyle(warning);
    expect(toHex(s.borderTopColor), "the popover tier's edge").toBe(PALETTE.borderPopover);
    expect(s.boxShadow, "the popover shadow").toContain(scheme === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(31, 35, 40, 0.16)");
    expect(ratio(PALETTE.borderPopover, PALETTE.surfaceSecondary)).toBeGreaterThanOrEqual(3);
    expect(s.borderTopLeftRadius).toBe("6px");
  });
});
