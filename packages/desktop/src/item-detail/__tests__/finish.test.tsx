/**
 * 08.1 plan 15: what the detail group's finish pass pins. Three owner and reviewer decisions that a
 * later edit could quietly undo:
 *
 *  1. No brand-filled primary buttons (owner decision 2026-10-08). The panel's actions and the Runs
 *     section's Watch Live are drawn with a control edge on the panel's own ground, never an
 *     `--accent-nontext` fill. Ink on that fill measured 3.05:1 light and 4.42:1 dark.
 *  2. The criteria list's ring is `:focus-visible`, not the cursor state: a mouse click moves the
 *     cursor too, and a ring driven by it left a permanent brand-coloured rectangle (08.1-14 finding 1).
 *  3. The destructive dialog draws its scrim and shadow from the per-mode overlay roles.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemDetailPanel, type DetailItem } from "../ItemDetailPanel";
import detailCss from "../item-detail.css?raw";
import removalDialogSource from "../WorktreeRemovalDialog.tsx?raw";
import type { CriterionDto } from "../AcceptanceCriteriaList";

const CRITERIA: CriterionDto[] = [1, 2].map((n) => ({
  id: `c${n}`,
  parentType: "task",
  parentId: "task-1",
  statement: `Criterion ${n}`,
  verificationHint: null,
  checked: false,
  rank: String(n),
  revision: 1,
  revisionOf: null,
  supersededAt: null,
}));

vi.mock("../../adapters/tauri", () => ({
  agentRunsForTask: () =>
    Promise.resolve([
      {
        id: "run-1", taskId: "task-1", status: "running", startedAt: "2026-01-01T00:00:00.000Z", endedAt: null,
        costUsd: null, externalSessionId: null, abandonedReason: null, acknowledgedAt: null,
      },
    ]),
  pendingPermissionRequests: () => Promise.resolve([]),
  answerPermissionRequest: () => Promise.resolve(),
  acknowledgeAgentRun: () => Promise.resolve(),
  sessionSummariesForTask: () => Promise.resolve([]),
  worktreeSummary: () => Promise.resolve(null),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
  invokeCommand: (command: string) => {
    if (command === "criterion_list") return Promise.resolve(CRITERIA);
    if (command === "criterion_revisions") return Promise.resolve([]);
    if (command === "events_activity_trail" || command === "actor_list") return Promise.resolve([]);
    return Promise.resolve(undefined);
  },
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

function renderPanel(item: DetailItem) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ItemDetailPanel item={item} onClose={() => {}} onUpdateTitle={() => {}} onSetStatus={() => {}} />
    </QueryClientProvider>,
  );
}

const TASK: DetailItem = { id: "task-1", kind: "task", key: "FLY-1", title: "A task", status: "in_progress", projectId: "p" };
const EPIC: DetailItem = { id: "epic-1", kind: "epic", key: "FLY-E", title: "An epic", status: "in_progress", projectId: "p" };

function expectDrawnNotFilled(button: HTMLElement) {
  expect(button.className, `${button.textContent} has no control edge`).toContain("control-edge");
  const style = button.getAttribute("style") ?? "";
  expect(style, `${button.textContent} paints the brand`).not.toMatch(/--accent/);
  // `.detail-action` (item-detail.css) is the one rule that sets its ground, and it is transparent.
  expect(button.className).toContain("detail-action");
}

describe("the detail panel's actions are drawn, not brand-filled", () => {
  it("draws Start Work, Review and Watch Live with a control edge", async () => {
    renderPanel(TASK);
    expectDrawnNotFilled(screen.getByRole("button", { name: "Start Work" }));
    expectDrawnNotFilled(screen.getByRole("button", { name: "Review" }));
    expectDrawnNotFilled(await screen.findByRole("button", { name: "Watch Live" }));
  });

  it("draws Continue Shaping on an epic the same way", () => {
    renderPanel(EPIC);
    expectDrawnNotFilled(screen.getByRole("button", { name: "Continue Shaping" }));
  });

  it("the shared action rule sets a transparent ground and no brand colour", () => {
    const rule = detailCss.match(/\.detail-action\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("background: transparent");
    expect(rule).not.toContain("--accent");
  });
});

/** The text of one CSS rule (or the empty string), for assertions on the stylesheet itself. */
const ruleText = (selector: string) => {
  const at = detailCss.indexOf(`${selector} {`);
  return at === -1 ? "" : detailCss.slice(at, detailCss.indexOf("}", at));
};

describe("an action is told apart from a value (08.1-15 closure, finding 3)", () => {
  it("the status control is a value and a caret: no control edge, no box", () => {
    renderPanel(TASK);
    const status = screen.getByRole("button", { name: /in progress/i });
    expect(status.className).toContain("detail-value-control");
    expect(status.className, "a value must not wear an action's edge").not.toContain("control-edge");
    expect(status.querySelector("svg"), "the caret").not.toBeNull();
    expect(ruleText(".detail-value-control")).toMatch(/border:\s*none/);
    expect(ruleText(".detail-value-control")).toMatch(/background:\s*transparent/);
  });

  it("a task leads with Start Work and an epic with Continue Shaping; Review is never the lead", () => {
    const task = renderPanel(TASK);
    expect(screen.getByRole("button", { name: "Start Work" }).className).toContain("detail-action-lead");
    expect(screen.getByRole("button", { name: "Review" }).className).not.toContain("detail-action-lead");
    expect(task.container.querySelectorAll(".detail-actions .detail-action-lead")).toHaveLength(1);
    task.unmount();
    const epic = renderPanel(EPIC);
    expect(screen.getByRole("button", { name: "Continue Shaping" }).className).toContain("detail-action-lead");
    expect(epic.container.querySelectorAll(".detail-actions .detail-action-lead")).toHaveLength(1);
  });

  it("the Runs section's one leading action is Watch Live, and it is the only lead in the section", async () => {
    renderPanel(TASK);
    const watch = await screen.findByRole("button", { name: "Watch Live" });
    expect(watch.className).toContain("detail-action-lead");
    expect(screen.getByRole("region", { name: "Runs" }).querySelectorAll(".detail-action-lead")).toHaveLength(1);
  });

  it("the lead is a 2px ink edge (the selection rule's device), never the brand or a fill", () => {
    const rule = ruleText(".detail-action.detail-action-lead");
    expect(rule).toMatch(/border:\s*2px solid var\(--selection-rule\)/);
    expect(rule).not.toMatch(/--accent|background/);
  });
});

describe("the property grid prints only values it has (08.1-15 closure, finding 6)", () => {
  it("prints Priority as a label/value row when the item carries it", () => {
    renderPanel({ ...TASK, priority: 2 });
    const grid = screen.getByRole("dialog", { name: "FLY-1 detail" }).querySelector(".detail-props") as HTMLElement;
    expect(within(grid).getByText("Priority").nextElementSibling?.textContent).toBe("High");
  });

  it("prints no row for a value it does not have, and no placeholder", () => {
    renderPanel(TASK);
    const grid = screen.getByRole("dialog", { name: "FLY-1 detail" }).querySelector(".detail-props") as HTMLElement;
    expect(within(grid).queryByText("Priority")).toBeNull();
    expect(grid.textContent).not.toMatch(/—|n\/a|none/i);
  });

  it("prints `No priority` for the fact priority 0", () => {
    renderPanel({ ...TASK, priority: 0 });
    const grid = screen.getByRole("dialog", { name: "FLY-1 detail" }).querySelector(".detail-props") as HTMLElement;
    expect(within(grid).getByText("Priority").nextElementSibling?.textContent).toBe("No priority");
  });
});

describe("the criteria's edit affordance is not standing ornament (08.1-15 closure, finding 8)", () => {
  it("hides the pencil at rest and reveals it on row hover and keyboard focus", async () => {
    renderPanel(TASK);
    const pencil = (await screen.findAllByRole("button", { name: /Edit criterion/ }))[0];
    expect(pencil.className).toContain("criterion-edit");
    expect(ruleText(".criterion-edit")).toMatch(/opacity:\s*0/);
    expect(detailCss).toMatch(/\.criterion-row:hover \.criterion-edit/);
    expect(detailCss).toMatch(/\.criterion-edit:focus-visible/);
  });
});

describe("the title gets its emphasis from space, not from a form-field underline", () => {
  it("has no standing border-bottom in its inline style and a hover/focus edge in the stylesheet", () => {
    renderPanel(TASK);
    const title = screen.getByLabelText("Title");
    expect(title.getAttribute("style") ?? "").not.toMatch(/border/);
    expect(ruleText(".detail-title")).toMatch(/border-bottom:\s*1px solid transparent/);
    expect(detailCss).toMatch(/\.detail-title:hover,\s*\.detail-title:focus\s*\{[^}]*--border-control/);
  });
});

describe("the criteria list ring follows :focus-visible", () => {
  it("clicking a row moves the cursor but paints no inline ring", async () => {
    renderPanel(TASK);
    const panel = screen.getByRole("dialog", { name: "FLY-1 detail" });
    const row = await within(panel).findByRole("listitem", { name: /Criterion 1/ });
    fireEvent.click(row);
    expect(row.getAttribute("data-focused")).toBe("true");
    expect(row.getAttribute("style") ?? "").not.toMatch(/outline/);
  });

  it("item-detail.css rings the cursor row only while the list is keyboard-focused", () => {
    const rule = detailCss.match(/\.criteria-list:focus-visible \.criterion-row\[data-focused="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "no :focus-visible rule for the cursor row").toContain("var(--focus-ring)");
    // Not a bare `.criterion-row[data-focused]` rule: that would ring a clicked row too.
    expect(detailCss).not.toMatch(/^\.criterion-row\[data-focused="true"\]/m);
  });
});

describe("the group declares no literal colour, scrim or shadow", () => {
  it("the stylesheet carries none", () => {
    const code = detailCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}\b/);
  });

  it("the removal dialog's scrim and shadow are the per-mode roles, and Remove is not a fill", () => {
    expect(removalDialogSource).toContain('background: "var(--scrim)"');
    expect(removalDialogSource).toContain('boxShadow: "var(--shadow-dialog)"');
    expect(removalDialogSource).toContain('border: "1px solid var(--border-dialog)"');
    const destructive = removalDialogSource.match(/const destructiveButtonStyle[\s\S]*?\n\};/)?.[0] ?? "";
    expect(destructive).toContain('background: "transparent"');
    expect(destructive).toContain('color: "var(--destructive-text-rack)"');
  });
});
