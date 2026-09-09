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
 * surface, not a board.
 */
import type { CSSProperties } from "react";
import { TriangleAlert } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeCommand, openFolderDialog } from "../adapters/tauri";
import type { Project } from "../board/useBoardQuery";

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

const surfaceStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-md)",
  background: "var(--surface-dominant)",
  color: "var(--text-primary-rack)",
  padding: "var(--space-xl)",
  textAlign: "center",
};

const buttonStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-lg)",
  borderRadius: "var(--radius-chrome)",
  border: "1px solid var(--divider)",
  background: "var(--surface-secondary)",
  color: "var(--accent-text-rack)",
  cursor: "pointer",
};

export function ProjectUnreachable({ project }: { project: Project }) {
  const relocateProject = useRelocateProject();

  async function handleLocate() {
    const newRepoPath = await openFolderDialog();
    if (!newRepoPath) return;
    relocateProject.mutate({ projectId: project.id, newRepoPath });
  }

  return (
    <div className="project-unreachable" style={surfaceStyle}>
      <span aria-hidden="true" style={{ color: "var(--destructive-strip)" }}>
        <TriangleAlert size={32} strokeWidth={2} />
      </span>
      <h1 className="type-heading">Can&rsquo;t find this project</h1>
      <p className="type-body" style={{ maxWidth: "60ch" }}>
        Flywheel expected {project.name} at {project.repoPath}, but the repository marker there no
        longer matches. Nothing was scanned or guessed automatically.
      </p>
      <button
        type="button"
        className="type-body"
        style={buttonStyle}
        onClick={() => void handleLocate()}
        disabled={relocateProject.isPending}
      >
        Locate Project…
      </button>
      {relocateProject.isError && (
        <p className="type-label" style={{ color: "var(--destructive-strip)" }}>
          Couldn&rsquo;t locate this project — {(relocateProject.error as Error).message}
        </p>
      )}
    </div>
  );
}
