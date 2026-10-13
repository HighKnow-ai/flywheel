/**
 * The full-surface reconciliation state (D-16, 01-UI-SPEC.md "Project switcher (left rail)" /
 * "State Inventory" / "Copywriting Contract") that REPLACES the board for a project whose marker
 * failed verification (`packages/core::domain::project::reconcile_projects`, run at launch,
 * before the window is shown). Renders exactly the Copywriting Contract's copy and offers
 * exactly ONE action — "Locate Project…" — never a second try-again button and never anything
 * that searches the disk or fixes the mismatch on its own
 * (`<why_this_plan_matters>`: "Nothing was scanned or guessed automatically").
 *
 * `App.tsx` renders this instead of `Board` whenever the currently selected project's
 * `status === "unreachable"` — selecting an unreachable entry in `ProjectRail.tsx` opens this
 * surface, not a board. It fills the content area only: the project rail is rendered beside it by
 * `App.tsx` in every state, so a healthy project stays one click away
 * (`projects/__tests__/unreachable-in-app.test.tsx` renders the real app to prove it).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeCommand, openFolderDialog } from "../adapters/tauri";
import type { Project } from "../board/useBoardQuery";
import "../styles/states-and-confirms.css";

/**
 * `project_relocate` (01-11-PLAN.md Task 2) — the ONLY mutation this surface ever issues.
 * Co-located here rather than added to `board/useBoardQuery.ts` (not one of this plan's `<files>`
 * — every hook that file already exports predates this plan and stays untouched); the query key
 * matches that module's own `["projects"]` exactly, so a successful relocation invalidates the
 * SAME cache `useProjects()` reads from.
 */
function useRelocateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; newRepoPath: string }) =>
      invokeCommand<Project>("project_relocate", {
        projectId: input.projectId,
        newRepoPath: input.newRepoPath,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function ProjectUnreachable({ project }: { project: Project }) {
  const relocateProject = useRelocateProject();

  async function handleLocate() {
    const newRepoPath = await openFolderDialog();
    if (!newRepoPath) return;
    relocateProject.mutate({ projectId: project.id, newRepoPath });
  }

  return (
    <div className="project-unreachable state-surface">
      {/* No eyebrow above the heading: a kicker that only restates the line below it is banned outright by the craft
          floor. The red "Unreachable" marker keeps its job where it is a data channel, the project's own rail entry,
          which is on screen beside this surface (it replaces the board, not the window). */}
      <h1 className="state-heading">Can&rsquo;t find this project</h1>
      <p className="type-body state-body">
        Flywheel expected {project.name} at <span className="state-path">{project.repoPath}</span>, but the
        repository marker there no longer matches. Nothing was scanned or guessed automatically.
      </p>
      <button
        type="button"
        className="type-body control-edge state-action state-action-lead"
        onClick={() => void handleLocate()}
        disabled={relocateProject.isPending}
      >
        Locate Project…
      </button>
      {relocateProject.isError && (
        <p role="alert" className="type-label state-error">
          Couldn&rsquo;t locate this project — {(relocateProject.error as Error).message}
        </p>
      )}
    </div>
  );
}
