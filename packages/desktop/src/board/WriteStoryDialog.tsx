/**
 * Writing a Story by hand (issue #50), in a dialog opened from the board's "Story" control
 * (direction.md § Components: Dialog holds Write a Story). It writes a Milestone, an Epic and a Story with
 * its Acceptance criteria and optional Checks. Scaffolding: shaping replaces its role in Milestone 3.
 *
 * A Story is written only inside a chosen Epic (Create Story stays disabled without one, and the core
 * refuses it anyway), and criteria exist only as rows of the Story being written: there is no control
 * that makes a criterion on its own. The board re-reads on `board:changed`; nothing here trusts its own
 * write. The dialog stays open after a Story is written, so several can be written in a row.
 *
 * The same dialog opens from where the record goes (issue #168, `AddRecordControls.tsx`): an Epic card's
 * + Story with that Epic chosen, the Milestone header's + Epic with that Milestone chosen.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { epicCreate, epicList, milestoneCreate, milestoneList, storyWriteByHand } from "../adapters/tauri";
import { errorText } from "./StoryControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CriterionDraft {
  statement: string;
  checkCommand: string;
}

const EMPTY_CRITERION: CriterionDraft = { statement: "", checkCommand: "" };

/** A native select, drawn as the Input is: the control edge, 8px corners, the body size. */
const selectClass =
  "h-8.5 w-full rounded-md border border-input bg-card px-2.5 text-body text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-small font-semibold", className)}>
      {label}
      {children}
    </label>
  );
}

function Step({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-row font-semibold">{title}</h3>
        {hint && <span className="text-meta text-subtle-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function WriteStoryDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState<"story" | "epic" | null>(null);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen("epic")} aria-label="Add an Epic">
        <Plus aria-hidden="true" />
        Epic
      </Button>
      <Button onClick={() => setOpen("story")} aria-label="Write a Story">
        <Plus aria-hidden="true" />
        Story
      </Button>
      <StoryFormDialog projectId={projectId} mode={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Where the dialog opens: nothing chosen (the top bar), a Milestone (its header's + Epic, issue #168) or an
 * Epic and its Milestone (an Epic card's + Story). The developer can still change either. */
export interface StoryFormPreset {
  milestoneId?: string;
  epicId?: string;
}

/** The Write a Story / Add an Epic dialog, open while `mode` is set. Each opening starts from `preset`. */
export function StoryFormDialog({
  projectId,
  mode,
  preset,
  onClose,
}: {
  projectId: string;
  mode: "story" | "epic" | null;
  preset?: StoryFormPreset;
  onClose: () => void;
}) {
  return (
    <Dialog open={mode !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-section font-semibold">{mode === "epic" ? "Add an Epic" : "Write a Story"}</DialogTitle>
          <DialogDescription>
            {mode === "epic"
              ? "An Epic lives in a Milestone. Choose one, or add one, then name the Epic."
              : "A Story lives in an Epic, and an Epic in a Milestone. Choose them, or add one, then write the Story."}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-5 py-4">
          <StoryForm projectId={projectId} withStory={mode !== "epic"} preset={preset} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StoryForm({
  projectId,
  withStory = true,
  preset,
}: {
  projectId: string;
  withStory?: boolean;
  preset?: StoryFormPreset;
}) {
  const [milestoneId, setMilestoneId] = useState(preset?.milestoneId ?? "");
  const [epicId, setEpicId] = useState(preset?.epicId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState<string | null>(null);

  const milestonesQuery = useQuery({
    queryKey: ["board", projectId, "milestones"],
    queryFn: () => milestoneList(projectId),
  });
  const epicsQuery = useQuery({
    queryKey: ["epics", projectId, milestoneId],
    queryFn: () => epicList(milestoneId),
    enabled: milestoneId !== "",
  });

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="m-0 rounded-md border border-border bg-muted px-3 py-2 text-small text-destructive-text">
          {error}
        </p>
      )}

      <Step title="Where on the Roadmap">
        <Field label="Milestone">
          <select
            value={milestoneId}
            onChange={(event) => {
              setMilestoneId(event.target.value);
              setEpicId("");
            }}
            className={selectClass}
          >
            <option value="">Choose a Milestone</option>
            {(milestonesQuery.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>
        <NewMilestone
          projectId={projectId}
          onCreated={(id) => {
            setMilestoneId(id);
            setEpicId("");
          }}
          onError={setError}
        />
      </Step>

      <Step title="Which problem it belongs to">
        <Field label="Epic">
          <select
            value={epicId}
            onChange={(event) => setEpicId(event.target.value)}
            disabled={milestoneId === ""}
            className={selectClass}
          >
            <option value="">{milestoneId === "" ? "Choose a Milestone first" : "Choose an Epic"}</option>
            {(epicsQuery.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.key} {e.title}
              </option>
            ))}
          </select>
        </Field>
        <NewEpic milestoneId={milestoneId} onCreated={setEpicId} onError={setError} />
      </Step>

      {withStory && (
      <NewStory
        epicId={epicId}
        onError={setError}
        onWritten={(key) => {
          setWritten(key);
          setError(null);
        }}
      />
      )}
      {written && (
        <p role="status" className="m-0 text-small text-muted-foreground">
          {`${written} is written. It is on the board, in Shaping or Ready.`}
        </p>
      )}
    </div>
  );
}

function NewMilestone({
  projectId,
  onCreated,
  onError,
}: {
  projectId: string;
  onCreated: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [exitTest, setExitTest] = useState("");
  const [busy, setBusy] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || title.trim() === "") return;
    setBusy(true);
    onError(null);
    milestoneCreate(projectId, title.trim(), exitTest.trim() === "" ? null : exitTest.trim())
      .then((m) => {
        setTitle("");
        setExitTest("");
        onCreated(m.id);
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <Field label="Milestone title" className="min-w-40 flex-1 font-normal text-muted-foreground">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Exit test" className="min-w-48 flex-[2] font-normal text-muted-foreground">
        <Input value={exitTest} onChange={(e) => setExitTest(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" disabled={busy || title.trim() === ""}>
        <Plus aria-hidden="true" />
        Add Milestone
      </Button>
    </form>
  );
}

function NewEpic({
  milestoneId,
  onCreated,
  onError,
}: {
  milestoneId: string;
  onCreated: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const canSubmit = !busy && milestoneId !== "" && title.trim() !== "";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    onError(null);
    epicCreate(milestoneId, title.trim())
      .then((e) => {
        setTitle("");
        onCreated(e.id);
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <Field label="Epic title" className="min-w-48 flex-1 font-normal text-muted-foreground">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" disabled={!canSubmit}>
        <Plus aria-hidden="true" />
        Add Epic
      </Button>
    </form>
  );
}

function NewStory({
  epicId,
  onError,
  onWritten,
}: {
  epicId: string;
  onError: (message: string | null) => void;
  onWritten: (key: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<CriterionDraft[]>([EMPTY_CRITERION]);
  const [busy, setBusy] = useState(false);

  // Rows left wholly blank are dropped; a row with only a Check reaches the core, which refuses it.
  const written = criteria.filter((c) => c.statement.trim() !== "" || c.checkCommand.trim() !== "");
  const canSubmit = !busy && epicId !== "" && title.trim() !== "" && written.some((c) => c.statement.trim() !== "");

  function updateCriterion(index: number, patch: Partial<CriterionDraft>) {
    setCriteria((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    onError(null);
    storyWriteByHand(
      epicId,
      title.trim(),
      description.trim() === "" ? null : description.trim(),
      written.map((c) => ({
        statement: c.statement.trim(),
        checkCommand: c.checkCommand.trim() === "" ? null : c.checkCommand.trim(),
      })),
    )
      .then((story) => {
        setTitle("");
        setDescription("");
        setCriteria([EMPTY_CRITERION]);
        onWritten(story?.key ?? "The Story");
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={handleSubmit}>
      <Step title="The Story" hint={epicId === "" ? "A Story is written inside an Epic: choose one above." : undefined}>
        <Field label="Story title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="font-normal" />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="font-normal" />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-small font-semibold">Acceptance criteria</span>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {criteria.map((criterion, index) => (
              // Rows have no identity beyond their position until the Story is written.
              <li key={index} className="flex flex-wrap items-end gap-2">
                <Field label={`Criterion ${index + 1}`} className="min-w-56 flex-[2] font-normal text-muted-foreground">
                  <Input
                    value={criterion.statement}
                    onChange={(e) => updateCriterion(index, { statement: e.target.value })}
                    placeholder="What must hold when the Story is done"
                  />
                </Field>
                <Field label={`Check command ${index + 1}`} className="min-w-40 flex-1 font-normal text-muted-foreground">
                  <Input
                    value={criterion.checkCommand}
                    onChange={(e) => updateCriterion(index, { checkCommand: e.target.value })}
                    placeholder="optional, e.g. npm test"
                    className="font-mono text-small"
                  />
                </Field>
                {criteria.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove criterion ${index + 1}`}
                    title="Remove this criterion"
                    onClick={() => setCriteria((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => setCriteria((rows) => [...rows, EMPTY_CRITERION])}>
            <Plus aria-hidden="true" />
            Add criterion
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            Create Story
          </Button>
        </div>
      </Step>
    </form>
  );
}
