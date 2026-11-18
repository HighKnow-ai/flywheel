/**
 * Rename a project (issue #1762), a dialog opened from the project's own menu in the rail ("Rename…").
 * A name is edited in a Dialog with one Field, as every other record is written here (`WriteStoryDialog`);
 * the rail row is a button that selects the project, so an inline edit would fight its click.
 *
 * The core is the one authority on the name: it trims it and refuses an empty, over-long or taken one
 * (`domain::project::validate_project_name`), and its message is shown as it stands under the field, with
 * the dialog still open and the draft kept. The only rule here is that Rename stays off while the field is
 * blank or unchanged, so the common mistakes never cost a round trip. The key prefix is shown and not
 * editable: Story keys are permanent (D-10).
 *
 * Nothing here trusts its own write. After the command resolves, every read that carries the name is
 * invalidated (the projects list that feeds the rail, the breadcrumb and the command palette; the fleet,
 * the queues and the worktree inventory, whose rows name their project), so the new name shows
 * everywhere without a restart.
 */
import { useId, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "@highknow/design";
import { projectRename } from "../adapters/tauri";
import type { Project } from "../board/useBoardQuery";
import { errorText } from "../board/StoryControls";
import {
  blockedQueueQueryKey,
  fleetQueryKey,
  waitingRoundsQueryKey,
  worktreeInventoryQueryKey,
} from "../fleet/useFleet";
import { notify } from "../lib/notify";
import { Button } from "@/components/Button";

/** Every read that shows a project's name, read again after a rename. */
function useInvalidateProjectNames() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    void queryClient.invalidateQueries({ queryKey: waitingRoundsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
  };
}

/** The dialog, open while `project` is set. Each opening starts from the project's current name. */
export function RenameProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  return (
    <Dialog open={project !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {project !== null && <RenameForm key={project.id} project={project} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const refresh = useInvalidateProjectNames();
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const errorId = useId();

  const trimmed = name.trim();
  const canSubmit = trimmed !== "" && trimmed !== project.name && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const renamed = await projectRename(project.id, name);
      refresh();
      notify.success(`Renamed ${project.name} to ${renamed.name}`, {
        description: `Its key stays ${renamed.keyPrefix}.`,
      });
      onDone();
    } catch (err) {
      // The core's own words (empty, too long, taken): the draft stays so the developer can fix it.
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="text-section font-semibold wrap-anywhere">Rename {project.name}</DialogTitle>
        <DialogDescription>
          The name shows in the rail, the breadcrumb and the lists. Story keys do not change.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={nameId}>Project name</FieldLabel>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoFocus
          autoComplete="off"
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? errorId : undefined}
        />
        <FieldDescription>
          Key prefix <span className="font-mono">{project.keyPrefix}</span>, which stays as it is.
        </FieldDescription>
      </Field>
      {error && (
        <p id={errorId} role="alert" className="m-0 text-small text-destructive-text">
          {error}
        </p>
      )}
      <DialogFooter className="mx-0 mb-0 items-center">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSubmit} loading={busy}>
          <Pencil aria-hidden="true" />
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}
