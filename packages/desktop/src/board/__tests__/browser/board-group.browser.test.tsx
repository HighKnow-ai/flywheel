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
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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
import data from "../../../../../../.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/comp-data.json";
import { BoardRow, ROW_HEIGHT_BY_KIND, type RowKind } from "../../BoardRow";
import { EpicHeaderRow, type EpicChange } from "../../EpicHeaderRow";
import { ChallengeRow } from "../../ChallengeRow";
import { StatusBand } from "../../StatusBand";
import { QuickAdd } from "../../QuickAdd";
import { FilterBar } from "../../FilterBar";
import { IssuesLane } from "../../IssuesLane";
import { ProjectRail } from "../../../projects/ProjectRail";
import type { AuthoringProposalDto, EpicProgressDto } from "../../../adapters/tauri";
import type { BoardItem, IssueItem, Project } from "../../useBoardQuery";

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
// Relative to the browser project root (packages/desktop): the screenshot path is resolved from the
// test file, the writeFile command from the root — two bases, so two spellings of one directory.
const OUT = "../../../../../../.impeccable/review";
const OUT_FROM_ROOT = "../../.impeccable/review";
const WIDTH = 1440;

type Task = { id: string; epic_id: string | null; key: string; title: string; status: string; priority: number; estimate: number | null };
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
  epicId: t.epic_id, estimate: t.estimate, criteriaChecked: 0, criteriaTotal: 0,
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
  <span className="type-micro control-edge" style={{ borderRadius: "var(--radius-mark)", padding: "0 4px", marginLeft: 6, color: "var(--text-muted-rack)" }}>
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
function installTauriBridge() {
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
    invoke: (command: string) => Promise.resolve(answers[command] ?? 1),
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
    // 08.1-14 finish review, finding 7: a count is never clipped. Every distribution label, including the
    // "No epic" bucket's three-digit one, shows all of its text (it wraps; it does not ellipsize).
    const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-slot="distribution-label"]'));
    expect(labels.length).toBe(epics.length + 1);
    for (const label of labels) {
      expect(label.scrollWidth, `"${label.textContent}" is clipped`).toBeLessThanOrEqual(label.clientWidth);
      expect(getComputedStyle(label).textOverflow, `"${label.textContent}" would ellipsize`).not.toBe("ellipsis");
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
