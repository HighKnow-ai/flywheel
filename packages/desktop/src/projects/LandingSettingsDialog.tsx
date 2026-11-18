/**
 * What Merge does in a project (ADR 0042, issue #1757), a dialog opened from the project's menu in the rail
 * ("Landing…"). Merge opens a pull request by default; a project can name a landing command instead; a
 * project with no remote on a known forge keeps the local merge.
 *
 * The core is the one authority: it refuses a command mode with no command, a command of more than one line
 * and an unknown method, and its sentence is shown as it stands with the draft kept. The forge is read from
 * the URL of `origin`; the field names it only for a host Flywheel cannot know, such as a self-hosted GitLab.
 */
import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequestArrow } from "lucide-react";
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
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@highknow/design";
import { projectLandingGet, projectLandingSet, type ProjectLandingDto } from "../adapters/tauri";
import type { Project } from "../board/useBoardQuery";
import { errorText } from "../board/StoryControls";
import { notify } from "../lib/notify";
import { Button } from "@/components/Button";

/** The read of a project's landing setting. */
export function landingSettingsQueryKey(projectId: string) {
  return ["projects", projectId, "landing"] as const;
}

/** The dialog, open while `project` is set. Each opening starts from the project's stored setting. */
export function LandingSettingsDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  return (
    <Dialog open={project !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {project !== null && <LandingForm key={project.id} project={project} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

const FORGE_WORDS = { github: "GitHub", gitlab: "GitLab" } as const;

function LandingForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const query = useQuery({
    queryKey: landingSettingsQueryKey(project.id),
    queryFn: () => projectLandingGet(project.id),
    gcTime: 0,
  });
  if (query.data === undefined) {
    return (
      <DialogHeader>
        <DialogTitle className="text-section font-semibold wrap-anywhere">{`Landing for ${project.name}`}</DialogTitle>
        <DialogDescription>
          {query.isError ? errorText(query.error) : "Reading the project's landing setting."}
        </DialogDescription>
      </DialogHeader>
    );
  }
  return <LandingFields project={project} stored={query.data} onDone={onDone} />;
}

function LandingFields({
  project,
  stored,
  onDone,
}: {
  project: Project;
  stored: ProjectLandingDto;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ProjectLandingDto["mode"]>(stored.mode);
  const [command, setCommand] = useState(stored.command ?? "");
  const [forge, setForge] = useState<string>(stored.forge ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const errorId = useId();

  const detected = stored.detectedForge === null ? "no known forge" : FORGE_WORDS[stored.detectedForge];
  const canSubmit = !busy && (mode === "pull_request" || command.trim() !== "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await projectLandingSet(project.id, {
        mode,
        command: command.trim() === "" ? null : command,
        forge: forge === "github" || forge === "gitlab" ? forge : null,
        method: stored.method,
      });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      notify.success(`Landing set for ${project.name}`, {
        description: mode === "command" ? "Merge runs the landing command." : "Merge opens a pull request.",
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="text-section font-semibold wrap-anywhere">{`Landing for ${project.name}`}</DialogTitle>
        <DialogDescription>
          What Merge does with a Story. A project with no remote on a known forge keeps the local merge.
        </DialogDescription>
      </DialogHeader>
      <RadioGroup
        aria-label="Landing mode"
        value={mode}
        onValueChange={(next) => setMode(next === "command" ? "command" : "pull_request")}
        disabled={busy}
        className="flex flex-col gap-2"
      >
        <span className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-pr`} value="pull_request" />
          <Label htmlFor={`${id}-pr`} className="text-small font-semibold">
            Pull request
          </Label>
        </span>
        <span className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-command`} value="command" />
          <Label htmlFor={`${id}-command`} className="text-small font-semibold">
            Landing command
          </Label>
        </span>
      </RadioGroup>
      {mode === "command" && (
        <Field>
          <FieldLabel htmlFor={`${id}-cmd`}>Landing command</FieldLabel>
          <Input
            id={`${id}-cmd`}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            aria-describedby={error !== null ? errorId : undefined}
          />
          <FieldDescription>
            Runs in the Story's worktree in place of the local merge, with FLYWHEEL_STORY_KEY, FLYWHEEL_STORY_BRANCH and
            FLYWHEEL_BASE_BRANCH set.
          </FieldDescription>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor={`${id}-forge`}>Forge</FieldLabel>
        <select
          id={`${id}-forge`}
          value={forge}
          onChange={(e) => setForge(e.target.value)}
          disabled={busy}
          className="h-9 rounded-md border border-input bg-card px-2 text-small"
        >
          <option value="">{`Detect from the remote (${detected})`}</option>
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </select>
        <FieldDescription>
          Name it only for a host Flywheel cannot know, such as a self-hosted GitLab. A self-hosted GitLab is reached
          through the host of the `origin` remote.
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
          <GitPullRequestArrow aria-hidden="true" />
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
