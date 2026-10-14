/**
 * The expensive gate's capture step for surface group one (08.1 plan 14, D-24): the board group as
 * the REAL components paint it in WebKit, in whichever colour scheme the config selected, into
 * `.impeccable/review/` beside the approved comps, named `board-group-built-<scheme>-1440x900`.
 *
 * It composes the real components (the project rail, filter bar, epic roster headers, challenge
 * rows, task rows in every selection state, a status band, quick-add and the issues lane) over the
 * real board's own exported data (`comps/comp-data.json`, the same export the comps were drawn from).
 * Nothing is smoothed: the roster's lead epic is the junk epic `test` (0/1), the "No epic" bucket
 * holds all 181 in-review tasks, and most epics read 15 of 60.
 *
 * Three things the real board cannot supply are FIXTURES, labelled as such on the page and in the
 * disclosure line, exactly as the comps label them: pending agent challenges, a commit-ahead
 * worktree and a running agent. The real board has none of the three today.
 *
 * It also writes the rendered page as one self-contained HTML file beside each PNG. The mechanical
 * detector (`detect.mjs`) reads HTML and CSS but not JSX inline styles, so running it on the source
 * files alone would report nothing for most of this surface; running it on this HTML is the check
 * that actually sees what these components paint.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { commands, page } from "vitest/browser";
import tokensCss from "../../../styles/tokens.css?raw";
import typeCss from "../../../styles/type.css?raw";
import motionCss from "../../../styles/motion.css?raw";
import appCss from "../../../App.css?raw";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import data from "../../../../../../.planning/milestones/v0.1.0-phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";
import { BoardRow, ROW_HEIGHT_BY_KIND, type RowKind } from "../../BoardRow";
import { EpicHeaderRow, type EpicChange } from "../../EpicHeaderRow";
import { ChallengeRow } from "../../ChallengeRow";
import { StatusBand } from "../../StatusBand";
import { QuickAdd } from "../../QuickAdd";
import { FilterBar } from "../../FilterBar";
import { IssuesLane } from "../../IssuesLane";
import { ProjectRail } from "../../../projects/ProjectRail";
import App from "../../../App";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState, useUiStore } from "../../../state/uiStore";
import { groupCollapseKey, useCollapseStore } from "../../collapseStore";
import type { AuthoringProposalDto, EpicProgressDto } from "../../../adapters/tauri";
import type { BoardItem, IssueItem, Project } from "../../useBoardQuery";

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
// Relative to the browser project root (packages/desktop): the screenshot path is resolved from the
// test file, the writeFile command from the root — two bases, so two spellings of one directory.
const OUT = "../../../../../../.impeccable/review";
const OUT_FROM_ROOT = "../../.impeccable/review";
const WIDTH = 1440;

type Task = { id: string; epic_id: string | null; key: string; title: string; status: string; priority: number };
const tasks = data.tasks as Task[];
const epics = data.epics as { id: string; key: string; title: string; status: string }[];

const progressFor = (epicId: string | null): EpicProgressDto => {
  const mine = tasks.filter((t) => t.epic_id === epicId);
  const byStatus = ["done", "in_review", "in_progress", "todo", "backlog"]
    .map((status) => ({ status, count: mine.filter((t) => t.status === status).length }))
    .filter((s) => s.count > 0);
  const keys = new Set(mine.map((t) => t.key));
  const checked = (data.criteria as { task_key: string; checked: number }[]).filter((c) => keys.has(c.task_key));
  return {
    epicId,
    byStatus,
    total: mine.length,
    done: mine.filter((t) => t.status === "done").length,
    agentsRunning: 0,
    agentsBlocked: 0,
    criteria: checked.length ? { checked: checked.reduce((n, c) => n + c.checked, 0), total: checked.length } : null,
  };
};

const epicsById = Object.fromEntries(epics.map((e) => [e.id, { id: e.id, key: e.key, title: e.title }]));

const toItem = (t: Task): BoardItem => ({
  id: t.id, kind: "task", key: t.key, title: t.title, status: t.status, rank: "a0", priority: t.priority,
  epicId: t.epic_id, criteriaChecked: 0, criteriaTotal: 0,
});

const projects: Project[] = (data.projects as { id: string; key_prefix: string; name: string; status: string }[]).map((p) => ({
  id: p.id, keyPrefix: p.key_prefix, name: p.name, repoPath: "/repo", defaultBranch: "main",
  // The comp's data names the second project's state "active"; the app's own vocabulary is "reachable".
  status: p.status === "unreachable" ? "unreachable" : "reachable",
}));
const currentProject = projects[1];

const proposal = (id: string, title: string, targetType: string): AuthoringProposalDto => ({
  id, agentRunId: "run-fixture", epicId: null, verb: "create", targetType, targetId: null, parentProposalId: null,
  position: "a0", payload: { kind: targetType, title }, status: "pending", createdBy: "agent", createdAt: "2026-10-08T00:00:00Z",
  rationale: null, originLogOffset: null, duplicateOf: null, duplicateScore: null, duplicateCandidate: null,
});

const FIXTURE_TAG = (
  <span className="type-label control-edge" style={{ borderRadius: "var(--radius-mark)", padding: "0 4px", marginLeft: 6, color: "var(--text-muted-rack)" }}>
    FIXTURE
  </span>
);

const Sized = ({ kind, children }: { kind: RowKind; children: React.ReactNode }) => (
  <div style={{ height: ROW_HEIGHT_BY_KIND[kind] }} className={kind === "epic-header" ? "epic-header-cell" : undefined}>
    {children}
  </div>
);

function Page() {
  const noop = () => {};
  const expanded = epics.find((e) => e.key === "THRE-14")!;
  const expandedTasks = tasks.filter((t) => t.epic_id === expanded.id).slice(0, 12);
  const inReview = tasks.filter((t) => t.status === "in_review").slice(0, 3);
  const issues: IssueItem[] = [
    { id: "i1", key: "FIX-ISSUE-1", title: "FIXTURE: retry budget is hardcoded at 3", kind: "bug", epicId: null, taskId: null },
    { id: "i2", key: "FIX-ISSUE-2", title: "FIXTURE: should the chip row wrap or scroll?", kind: "question", epicId: null, taskId: null },
  ];
  const fixtureChange: EpicChange = { ahead: 3, dirty: true };
  return (
    <div className="rack-ground" style={{ display: "flex", width: WIDTH, height: "auto", minHeight: 900 }}>
      {/* The app shell gives the rail the window's height; here the page is taller than the window. */}
      <div style={{ display: "flex", flexShrink: 0 }}>
        <ProjectRail projects={projects} currentProjectId={currentProject.id} onSelect={noop} />
      </div>
      <main style={{ flex: 1, minWidth: 0 }}>
        <FilterBar projectId={currentProject.id} />
        <div role="list" aria-label="Board">
          {epics.map((epic) => (
            <div key={epic.id}>
              <Sized kind="epic-header">
                <EpicHeaderRow
                  epicId={epic.id} epicKey={epic.key} title={epic.title} progress={progressFor(epic.id)}
                  status={epic.status}
                  // The exported board records no integration branch for any epic (none has been cut).
                  integrationBranch={null}
                  pendingProposalCount={epic.id === expanded.id ? 3 : 0}
                  change={epic.id === expanded.id ? fixtureChange : undefined}
                  collapsed={epic.id !== expanded.id} onToggleCollapsed={noop}
                />
              </Sized>
              {epic.id === expanded.id && (
                <>
                  {["Should a filter chip persist when the owner switches project, or reset? [FIXTURE]", "Proposed task: debounce the chip toggles so one click is one query. [FIXTURE]"].map((title, i) => (
                    <Sized kind="challenge" key={title}>
                      <ChallengeRow proposal={proposal(`p${i}`, title, i === 0 ? "question" : "task")} epicLabel={`${epic.key} ${epic.title}`} />
                    </Sized>
                  ))}
                  <Sized kind="task">
                    <BoardRow
                      item={{ ...toItem(expandedTasks[0]), id: "fx", key: "FIX-1", title: "Cache the chip counts (three commits ahead, tree dirty) [FIXTURE]" }}
                      changeFlag={{ ahead: 3, dirty: true }}
                      hideEpicPill
                    />
                  </Sized>
                  {expandedTasks.map((t, i) => (
                    <Sized kind="task" key={t.id}>
                      {/* The first real task is selected with the list focused; the rest idle. */}
                      <BoardRow item={toItem(t)} epicsById={epicsById} hideEpicPill selected={i === 0} focused={i === 0} blocked={i === 2} ciFailed={i === 3} changeFlag={t.key === "THRE-58" ? { ahead: 0, dirty: true } : undefined} />
                    </Sized>
                  ))}
                </>
              )}
            </div>
          ))}
          <Sized kind="epic-header">
            <EpicHeaderRow epicId={null} title="No epic" progress={progressFor(null)} pendingProposalCount={0} collapsed onToggleCollapsed={noop} />
          </Sized>
        </div>

        <h2 className="type-heading" style={{ margin: "var(--space-lg) var(--space-md) var(--space-sm)" }}>The status lens: the same board, grouped by status</h2>
        <div role="list" aria-label="Status lens">
          <Sized kind="band-header"><StatusBand label="In review" count={181} collapsed={false} onToggleCollapsed={noop} /></Sized>
          {inReview.map((t, i) => (
            // Selected while the list does NOT have focus: the state A-06(b) exists for.
            <Sized kind="task" key={t.id}><BoardRow item={toItem(t)} epicsById={epicsById} selected={i === 0} /></Sized>
          ))}
          <Sized kind="task"><QuickAdd onCreate={noop} /></Sized>
        </div>

        <h2 className="type-heading" style={{ margin: "var(--space-lg) var(--space-md) var(--space-sm)" }}>The issues lane</h2>
        <IssuesLane issues={issues} />

        <p className="type-label" style={{ margin: "var(--space-lg) var(--space-md)", color: "var(--text-muted-rack)", maxWidth: 760 }}>
          FIXTURE rows are stood in for values the real board does not have today: pending agent challenges, a worktree
          three commits ahead and a task blocked or failing CI. Every epic, task, key, title, status and count is the real
          board's own, including the epic titled &quot;test&quot; at 0 of 1 and the 181 in-review tasks that belong to no epic.
          {FIXTURE_TAG}
        </p>
      </main>
    </div>
  );
}

/**
 * The rail's hooks reach the core through Tauri's global bridge, which does not exist in a plain
 * browser. This answers the three reads the rail makes with the real board's own numbers (five
 * worktrees, nothing blocked, nothing awaiting a decision) and swallows event subscriptions.
 */
function installTauriBridge(refuse: string[] = []) {
  const answers: Record<string, unknown> = {
    board_change_flags: (data.worktrees as { task_id: string; ahead: number; dirty: boolean }[]).map((w) => ({
      taskId: w.task_id, epicId: null, ahead: w.ahead, dirty: w.dirty,
    })),
    board_blocked_summary: { blockedTaskIds: [], blockedCount: 0 },
    board_recovery_summary: { recoveryTaskIds: [], recoveryCount: 0 },
    actor_list: [],
    epic_list_all: { epics: epics.map((e) => ({ id: e.id, key: e.key, title: e.title })) },
  };
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: (command: string) =>
      refuse.includes(command) ? Promise.reject(new Error(`${command} refused`)) : Promise.resolve(answers[command] ?? 1),
  };
}

describe(`board group one, built, ${scheme} scheme`, () => {
  it("renders every real component of the group and captures it for the finish reviewer", async () => {
    installTauriBridge();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
    const root = document.querySelector(".rack-ground") as HTMLElement;
    // The page really is the group: the rail's three sections, the epic roster, and the row kinds.
    for (const label of ["Projects", "Fleet", "Review queue"]) expect(root.textContent).toContain(label);
    expect(root.querySelectorAll(".epic-header-row").length).toBe(epics.length + 1);
    expect(root.querySelectorAll('[role="listitem"].board-row').length).toBeGreaterThan(10);
    // Finding 3: the comp's full sub-label, read off the roster.
    expect(root.textContent).toContain("THRE-4 \u00b7 backlog \u00b7 no integration branch yet");
    // 08.1-14 finish review, finding 7: a count is never clipped. Every distribution label, including the
    // "No epic" bucket's three-digit one, shows all of its text (it wraps; it does not ellipsize).
    const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-slot="distribution-label"]'));
    expect(labels.length).toBe(epics.length + 1);
    for (const label of labels) {
      expect(label.scrollWidth, `"${label.textContent}" is clipped`).toBeLessThanOrEqual(label.clientWidth);
      expect(getComputedStyle(label).textOverflow, `"${label.textContent}" would ellipsize`).not.toBe("ellipsis");
      // 11-17 finish review (group one): at the full window width the caption fits on ONE line, the "No epic" bucket's
      // three-digit count included ("186 / open" had wrapped). Wrapping stays the fallback at narrow widths, never the norm.
      const lines = document.createRange();
      lines.selectNodeContents(label);
      expect(lines.getClientRects().length, `"${label.textContent}" wraps at ${WIDTH}px`).toBe(1);
    }
    // Finding 8: all three fixture kinds are tagged, the two challenge rows included.
    for (const challenge of Array.from(root.querySelectorAll('[data-challenge-id]'))) {
      expect(challenge.textContent, "a challenge row stands in for a fixture without saying so").toContain("[FIXTURE]");
    }
    expect(root.querySelectorAll('[data-challenge-id]').length).toBe(2);

    await page.screenshot({ path: `${OUT}/board-group-built-${scheme}-1440x900.png` });
    // The whole page, not only the first window of it: the roster, the status lens and the lane.
    // A headless WebKit paints only the viewport, so the viewport is grown to the page for this shot.
    await page.viewport(WIDTH, root.scrollHeight);
    await page.screenshot({ path: `${OUT}/board-group-built-${scheme}-full.png` });
    await page.viewport(WIDTH, 900);

    // Self-contained HTML for the detector: the real stylesheets inlined, the DOM as rendered.
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>board group one, built, ${scheme}</title>` +
      `<style>${tokensCss}\n${typeCss}\n${motionCss}\n${appCss}</style></head><body>${document.body.innerHTML}</body></html>`;
    await commands.writeFile(`${OUT_FROM_ROOT}/board-group-built-${scheme}.html`, html);
  });
});

/**
 * D-REV-10, the layout half: a challenge row is ONE 48px line of the rack. A staged proposal with a
 * long agent-written title must truncate the title (the one flexible piece) and keep the type label,
 * Accept and Reject inside the row, also while a failed decision adds its error beside them. The
 * accept itself (task appears, epic total +1, failed accept leaves the row) is proved against a fake
 * core in `challenge-inline.test.tsx`; this is the part jsdom cannot measure, which has no layout.
 *
 * Width 716 is the board column at the 900px window minimum beside the 184px project rail, detail panel closed.
 */
describe(`challenge row at ${ROW_HEIGHT_BY_KIND.challenge}px, measured in WebKit, ${scheme} scheme`, () => {
  const LONG = "Should a filter chip persist when the owner switches project, or reset to the default every single time the board is opened again? ".repeat(2);

  function renderChallenge() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <div className="rack-ground" style={{ width: 716 }}>
          <Sized kind="challenge">
            <ChallengeRow proposal={proposal("p-long", LONG, "question")} epicLabel="THRE-14 Filters" />
          </Sized>
        </div>
      </QueryClientProvider>,
    );
    return document.querySelector<HTMLElement>("[data-challenge-id]")!;
  }

  /** Every piece of the row, named, that sits outside the row's own box. */
  function escapes(row: HTMLElement): string[] {
    const box = row.getBoundingClientRect();
    return Array.from(row.querySelectorAll<HTMLElement>("span, button"))
      .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).slice(0, 30), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5 || r.left < box.left - 0.5 || r.right > box.right + 0.5))
      .map(({ name, r }) => `${name} spans x ${Math.round(r.left)}-${Math.round(r.right)}, y ${Math.round(r.top)}-${Math.round(r.bottom)} outside the row x ${Math.round(box.left)}-${Math.round(box.right)}, y ${Math.round(box.top)}-${Math.round(box.bottom)}`);
  }

  it("truncates a long title with an ellipsis and keeps the label, Accept and Reject inside the 48px row", () => {
    const row = renderChallenge();
    expect(row.getBoundingClientRect().height).toBe(ROW_HEIGHT_BY_KIND.challenge);
    expect(row.scrollWidth, "the row overflows sideways instead of truncating its title").toBeLessThanOrEqual(row.clientWidth);

    const title = screen.getByText(LONG.trim());
    expect(getComputedStyle(title).textOverflow).toBe("ellipsis");
    expect(title.scrollWidth, "the title is not long enough to exercise truncation").toBeGreaterThan(title.clientWidth);
    expect(title.getBoundingClientRect().height, "the title wrapped onto a second line").toBeLessThan(ROW_HEIGHT_BY_KIND.challenge / 2);

    for (const name of [/^Accept /, /^Reject /]) {
      const button = screen.getByRole("button", { name });
      expect(button.getBoundingClientRect().height, `${name} button is taller than its row`).toBeLessThanOrEqual(ROW_HEIGHT_BY_KIND.challenge);
    }
    expect(escapes(row), "a piece of the challenge row escapes its 48px box").toEqual([]);
  });

  it("keeps the same pieces inside the row, and the title still readable, when a failed decision adds its error", async () => {
    installTauriBridge(["authoring_proposal_accept"]);
    const row = renderChallenge();
    await userEvent.click(screen.getByRole("button", { name: /^Accept / }));
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Could not accept");

    expect(row.getBoundingClientRect().height).toBe(ROW_HEIGHT_BY_KIND.challenge);
    expect(escapes(row), "the error pushed a piece of the challenge row out of its 48px box").toEqual([]);
    // The error must not squeeze the title to nothing: a row that says "Could not accept" about a
    // proposal the reader can no longer identify is not legible.
    const title = screen.getByText(LONG.trim());
    expect(title.clientWidth, "the error squeezed the title out of the row").toBeGreaterThanOrEqual(80);
  });
});

/**
 * D-REV-12: the board group mounted inside the REAL app shell, not a page of components. `<App />`
 * renders `AppShell` (not exported), which composes the project rail, the `Board` header, the filter
 * bar, `BoardView` (lens toggle, summary line, the virtualised rack) and the overlays. Only the Tauri
 * bridge is stood in for, and it answers with the same real-board export (`comp-data.json`) the group
 * capture above composes by hand; the two staged challenges reuse that capture's `proposal()` helper
 * and its FIXTURE labelling rather than seeding a second fixture.
 *
 * This task only CAPTURES. It asserts that every element D-REV-12's truth names which the source
 * draws is on the page and stacked in the order the comp stacks it; whether the page matches the comp
 * is the finish reviewer's judgement (plan 11-17 task 2), not this test's. NOTE for that reviewer: the
 * shipped source draws the masthead as the bare project name (`.board-header`) and has no `Mission
 * Control` heading or `threadfin . N epics . N tasks` subhead; this test does not assert their absence
 * and does not invent them.
 */
describe(`board group one, mounted in the real app shell (AppShell via <App />), ${scheme} scheme`, () => {
  // The first epic that has tasks, so the open epic, its two challenges and its first tasks sit in the
  // first window of the virtualised rack (the group capture above opens THRE-14, which would be below the fold).
  const expandedEpic = epics.find((e) => e.key === "THRE-6")!;
  const items = (): BoardItem[] => [
    ...tasks.map(toItem),
    ...epics.map((e) => ({ id: e.id, key: e.key, title: e.title, status: e.status, rank: "a0", priority: 0, epicId: null, kind: "epic" as const })),
  ];
  const worktreeTaskIds = new Set((data.worktrees as { task_id: string }[]).map((w) => w.task_id));

  function installShellBridge() {
    const counts = {
      backlog: tasks.filter((t) => t.status === "backlog").length,
      todo: tasks.filter((t) => t.status === "todo").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      inReview: tasks.filter((t) => t.status === "in_review").length,
      done: tasks.filter((t) => t.status === "done").length,
    };
    const staged = [
      "Should a filter chip persist when the owner switches project, or reset? [FIXTURE]",
      "Proposed task: debounce the chip toggles so one click is one query. [FIXTURE]",
    ].map((title, i) => ({ ...proposal(`shell-p${i}`, title, i === 0 ? "question" : "task"), epicId: expandedEpic.id }));
    const answer = (command: string, args: Record<string, unknown> = {}): unknown => {
      switch (command) {
        case "project_list":
          return projects;
        case "board_list":
        case "board_search": {
          const filter = (args.filter ?? {}) as { hasWorktree?: boolean; epicIds?: (string | null)[] };
          const rows = items()
            .filter((r) => !filter.epicIds || filter.epicIds.includes(r.kind === "epic" ? r.id : r.epicId))
            .filter((r) => !filter.hasWorktree || worktreeTaskIds.has(r.id));
          return { items: rows.slice(0, (args.limit as number) ?? 200), issues: [], counts };
        }
        case "epic_list_all":
          return { epics: epics.map((e) => ({ id: e.id, key: e.key, title: e.title, status: e.status, integrationBranch: null })), total: epics.length, truncated: false };
        case "board_epic_progress":
          return [...epics.map((e) => progressFor(e.id)), progressFor(null)];
        case "authoring_proposals_pending":
          return { proposals: staged, counts: { pending: staged.length, accepted: 0, rejected: 0, merged: 0, deferred: 0 } };
        case "board_change_flags":
          return (data.worktrees as { task_id: string; ahead: number; dirty: boolean }[]).map((w) => ({ taskId: w.task_id, epicId: null, ahead: w.ahead, dirty: w.dirty }));
        case "board_blocked_summary":
          return { blockedTaskIds: [], blockedCount: 0 };
        case "board_recovery_summary":
          return { recoveryTaskIds: [], recoveryCount: 0 };
        case "actor_list":
          return [];
        default:
          return null;
      }
    };
    (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: (command: string, args?: Record<string, unknown>) => {
        return Promise.resolve(answer(command, args));
      },
    };
  }

  afterEach(() => {
    cleanup();
    queryClient.clear();
    resetUiState();
    useCollapseStore.setState({ collapsedByProject: {} });
  });

  it("captures the masthead, lens toggle, summary line, filter bar and rack as AppShell lays them out", async () => {
    installShellBridge();
    resetUiState();
    useCollapseStore.setState({ collapsedByProject: {} });
    useUiStore.setState({ currentProjectId: currentProject.id });
    // One epic open so the challenge rows and the task rows are in the shot.
    useCollapseStore.getState().expand(currentProject.id, groupCollapseKey("epic", expandedEpic.id));
    // `main.tsx` mounts into `#root`, and App.css gives `#root` the window's height; a bare RTL container
    // would not, and the rail and rack would size to their content instead of the window.
    const mount = document.body.appendChild(document.createElement("div"));
    mount.id = "root";
    render(<App />, { container: mount });

    await waitFor(() => expect(document.querySelectorAll(".epic-header-row").length).toBeGreaterThan(3));
    await waitFor(() => expect(document.querySelectorAll("[data-challenge-id]").length).toBe(2));
    await waitFor(() => expect(document.querySelector("[data-summary-line]")).not.toBeNull());

    const root = document.getElementById("app-root") as HTMLElement;
    // The shell, not a page: the rail beside the board column, and the masthead naming the project.
    for (const label of ["Projects", "Fleet", "Review queue"]) expect(root.textContent).toContain(label);
    const masthead = root.querySelector<HTMLElement>("header.board-header")!;
    expect(masthead.textContent).toBe(currentProject.name);
    // The vertical order the comp stacks: masthead, filter bar, lens toggle, summary line, then the rack.
    const filterBar = root.querySelector<HTMLElement>('[role="search"]')!;
    const lensToggle = screen.getByRole("button", { name: "Group by epic" }).parentElement!;
    const summary = root.querySelector<HTMLElement>("[data-summary-line]")!;
    const rack = root.querySelector<HTMLElement>('[role="list"][aria-label="Board"]')!;
    const tops = [masthead, filterBar, lensToggle, summary, rack].map((el) => el.getBoundingClientRect().top);
    expect(tops, "masthead, filter bar, lens toggle, summary line and rack must stack top-down").toEqual([...tops].sort((a, b) => a - b));
    expect(screen.getByRole("button", { name: "Group by status" })).toBeTruthy();
    expect(root.querySelectorAll('[role="listitem"].board-row').length, "the expanded epic's task rows are in the shot").toBeGreaterThan(0);

    await page.screenshot({ path: `${OUT}/board-shell-built-${scheme}-1440x900.png` });
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>board group one in the app shell, ${scheme}</title>` +
      `<style>${tokensCss}\n${typeCss}\n${motionCss}\n${appCss}</style></head><body>${document.body.innerHTML}</body></html>`;
    await commands.writeFile(`${OUT_FROM_ROOT}/board-shell-built-${scheme}.html`, html);
  });
});
