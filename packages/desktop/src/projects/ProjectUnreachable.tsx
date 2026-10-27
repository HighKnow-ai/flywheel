/**
 * The reconciliation state (D-16, 01-UI-SPEC.md "State Inventory") that REPLACES the board for a project
 * whose marker failed verification (`packages/core::domain::project::reconcile_projects`, run at launch,
 * before the window is shown). Nothing here searches the disk or fixes the mismatch on its own ("Nothing was
 * scanned or guessed automatically").
 *
 * Issue #210 (critique F7): it keeps the shell. The rail is beside it (`App.tsx`) and the top bar is above it,
 * with the project's name as the page, so this reads as the project's own page and not a void. The floor is
 * Empty with an Alert naming where Flywheel looked, and two answers: Locate project… (the primary) and
 * Remove from Flywheel… (confirmed, the board kept).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderMinus, FolderSearch, FolderX } from "lucide-react";
import { invokeCommand, openFolderDialog, projectHide } from "../adapters/tauri";
import type { Project } from "../board/useBoardQuery";
import { blockedQueueQueryKey, fleetQueryKey, worktreeInventoryQueryKey } from "../fleet/useFleet";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { useUiStore } from "../state/uiStore";
import { ActionFailure } from "./RegisterProjectFlow";
import { ConfirmDestructive } from "@/components/ConfirmDestructive";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@highknow/design";
import { Button } from "@/components/Button";

/**
 * `project_relocate` (01-11-PLAN.md Task 2) — co-located here; the query key matches
 * `board/useBoardQuery.ts`'s own `["projects"]` exactly, so a successful relocation invalidates the SAME
 * cache `useProjects()` reads from.
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

export function ProjectUnreachable({ project, projects }: { project: Project; projects?: Project[] }) {
  const relocateProject = useRelocateProject();
  const queryClient = useQueryClient();
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);

  async function handleLocate() {
    const newRepoPath = await openFolderDialog();
    if (!newRepoPath) return;
    relocateProject.mutate({ projectId: project.id, newRepoPath });
  }

  async function handleRemove() {
    await projectHide(project.id);
    // Land on another project before the list refetches, as the rail's own Remove does; with none left, the
    // empty list sends the app back to first run.
    const next = (projects ?? []).find((candidate) => candidate.id !== project.id);
    setCurrentProjectId(next?.id ?? null);
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    void queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
  }

  return (
    <div data-slot="project-unreachable" className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: project.name }]} />
      <SurfaceBody className="flex flex-col">
        <Empty className="min-h-0">
          <EmptyHeader className="max-w-lg gap-3">
            <EmptyMedia variant="icon" className="size-10 text-destructive-text [&_svg:not([class*='size-'])]:size-5">
              <FolderX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              {/* No eyebrow above the heading: the rail's "Unreachable" marker keeps that job. */}
              <h1 className="m-0 text-title font-semibold tracking-tight">Can&rsquo;t find this project</h1>
            </EmptyTitle>
            <EmptyDescription className="text-body">
              Locate the repository if it moved. Remove it if it is gone: its board stays in Flywheel.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-lg gap-4">
            <Alert className="text-left">
              <FolderSearch aria-hidden="true" />
              <AlertTitle className="text-body font-semibold">Flywheel expected {project.name} here</AlertTitle>
              <AlertDescription className="flex min-w-0 flex-col gap-1 text-small text-muted-foreground [&_p:not(:last-child)]:mb-0">
                <p className="m-0 font-mono break-all text-foreground">{project.repoPath}</p>
                <p className="m-0">
                  The repository marker there no longer matches. Nothing was scanned or guessed automatically.
                </p>
              </AlertDescription>
            </Alert>
            {relocateProject.isError && (
              <ActionFailure
                title="Couldn’t locate this project"
                line="Flywheel couldn’t use the folder you picked. Pick the folder this project’s repository moved to."
                error={relocateProject.error}
              />
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ConfirmDestructive
                trigger={
                  <Button variant="destructive">
                    <FolderMinus aria-hidden="true" />
                    Remove from Flywheel…
                  </Button>
                }
                title={`Remove ${project.name} from Flywheel?`}
                description="It leaves the project list. Its board, worktrees, runs and activity trail are kept, and registering the folder again brings it back."
                confirmLabel="Remove the project"
                icon={<FolderMinus aria-hidden="true" />}
                onConfirm={handleRemove}
              />
              <Button loading={relocateProject.isPending} onClick={() => void handleLocate()}>
                <FolderSearch aria-hidden="true" />
                Locate project…
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </SurfaceBody>
    </div>
  );
}
