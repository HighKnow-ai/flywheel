/**
 * Writing a Story by hand (issue #50), in a dialog opened from the top bar's "+ Story" (direction.md
 * § Components: Dialog holds Write a Story). It writes a Story with its Acceptance criteria and optional Checks
 * into a chosen Epic, adding a new Milestone or a new Epic on the way when the Story needs one.
 *
 * Issue #201: the Milestone and the Epic are picked with Comboboxes (Popover + Command, DESIGN.md
 * § Components), each ending in "New Milestone…" / "New Epic…", whose fields appear only once picked. Every
 * control sits in a Field with its Label, and the submit sits in a DialogFooter outside the scrolling body, so
 * Write Story is never below the fold however long the criteria list grows. One submit writes whatever is
 * new, in order: the Milestone, then the Epic, then the Story. A failure part-way keeps what was written
 * (picked in its Combobox) and the draft, so trying again never writes the same Milestone twice.
 *
 * A Story is written only inside an Epic (Write Story stays disabled without one, and the core refuses it
 * anyway), and criteria exist only as rows of the Story being written. The board re-reads on `board:changed`;
 * nothing here trusts its own write. The dialog stays open after a Story is written, with the same Epic
 * picked, so several can be written in a row; a toast names each one.
 *
 * The same dialog opens from where the record goes (issue #168, `AddRecordControls.tsx`): an Epic card's
 * + Story with that Epic chosen, and as "Add an Epic" from the Milestone header's + Epic with that Milestone
 * chosen. The top bar carries only + Story (issue #201): the header's + Epic is the one Epic add.
 */
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Tip } from "@/components/Tip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import {
  epicCreate,
  epicList,
  milestoneCreate,
  milestoneList,
  storyWriteByHand,
  type EpicDto,
  type MilestoneDto,
} from "../adapters/tauri";
import { StoryKey } from "../components/StoryKey";
import { notify } from "../lib/notify";
import { errorText } from "./StoryControls";
import { Button } from "@/components/Button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  cn,
} from "@highknow/design";

interface CriterionDraft {
  statement: string;
  checkCommand: string;
}

const EMPTY_CRITERION: CriterionDraft = { statement: "", checkCommand: "" };

/** What a Combobox holds: nothing yet, a record's id, or "a new one", whose fields then show. */
const NEW = "new";

/** A Done or Dropped record takes nothing new: the core refuses it, so it is not offered. */
function isOpen(record: { state: string }): boolean {
  return record.state !== "done" && record.state !== "dropped";
}

/** The top bar's one add: "+ Story", filled unless the project has no Milestone yet, when + Milestone leads. */
export function WriteStoryDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const roadmap = useQuery({ queryKey: ["board", projectId, "milestones"], queryFn: () => milestoneList(projectId) });
  const empty = roadmap.isSuccess && roadmap.data.length === 0;
  return (
    <>
      <Button variant={empty ? "outline" : "default"} onClick={() => setOpen(true)} aria-label="Write a Story">
        <Plus aria-hidden="true" />
        Story
      </Button>
      <StoryFormDialog projectId={projectId} mode={open ? "story" : null} onClose={() => setOpen(false)} />
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
      <DialogContent className="flex max-h-[min(88vh,820px)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="text-section font-semibold">
            {mode === "epic" ? "Add an Epic" : "Write a Story"}
          </DialogTitle>
          <DialogDescription>
            {mode === "epic"
              ? "An Epic lives in a Milestone. Pick one, or add a new one, then name the Epic."
              : "A Story lives in an Epic, and an Epic in a Milestone. Pick them, or add new ones, then write the Story."}
          </DialogDescription>
        </DialogHeader>
        {mode !== null && (
          <StoryForm projectId={projectId} withStory={mode === "story"} preset={preset} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StoryForm({
  projectId,
  withStory,
  preset,
  onDone,
}: {
  projectId: string;
  withStory: boolean;
  preset?: StoryFormPreset;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [milestoneChoice, setMilestoneChoice] = useState(preset?.milestoneId ?? "");
  const [newMilestone, setNewMilestone] = useState({ title: "", exitTest: "" });
  // Adding an Epic, the Epic is always a new one.
  const [epicChoice, setEpicChoice] = useState(withStory ? (preset?.epicId ?? "") : NEW);
  const [newEpicTitle, setNewEpicTitle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<CriterionDraft[]>([EMPTY_CRITERION]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Records this dialog wrote, named until the board's re-read lists them.
  const [written, setWritten] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const ids = {
    milestone: useId(),
    milestoneTitle: useId(),
    exitTest: useId(),
    epic: useId(),
    epicTitle: useId(),
    title: useId(),
    description: useId(),
  };

  const milestonesQuery = useQuery({
    queryKey: ["board", projectId, "milestones"],
    queryFn: () => milestoneList(projectId),
  });
  const pickedMilestone = milestoneChoice !== "" && milestoneChoice !== NEW ? milestoneChoice : null;
  const epicsQuery = useQuery({
    queryKey: ["epics", projectId, pickedMilestone],
    queryFn: () => epicList(pickedMilestone as string),
    enabled: pickedMilestone !== null,
  });
  // A new Milestone has no Epic yet: its Story goes into a new one.
  const epic = milestoneChoice === NEW ? NEW : epicChoice;

  const milestones = milestonesQuery.data ?? [];
  const epics = epicsQuery.data ?? [];
  const milestoneLabel = (id: string) => milestones.find((m) => m.id === id)?.title ?? written[id] ?? "";
  const epicOf = (id: string) => epics.find((e) => e.id === id);

  // Rows left wholly blank are dropped; a row with only a Check reaches the core, which refuses it.
  const criteriaWritten = criteria.filter((c) => c.statement.trim() !== "" || c.checkCommand.trim() !== "");
  const milestoneReady = milestoneChoice === NEW ? newMilestone.title.trim() !== "" : milestoneChoice !== "";
  const epicReady = epic === NEW ? newEpicTitle.trim() !== "" : epic !== "";
  const storyReady = title.trim() !== "" && criteriaWritten.some((c) => c.statement.trim() !== "");
  const canSubmit = milestoneReady && epicReady && (!withStory || storyReady);

  function updateCriterion(index: number, patch: Partial<CriterionDraft>) {
    setCriteria((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      let milestoneId = milestoneChoice;
      if (milestoneId === NEW) {
        const exitTest = newMilestone.exitTest.trim();
        const created = await milestoneCreate(projectId, newMilestone.title.trim(), exitTest === "" ? null : exitTest);
        milestoneId = created.id;
        setWritten((was) => ({ ...was, [created.id]: created.title }));
        setMilestoneChoice(created.id);
        setNewMilestone({ title: "", exitTest: "" });
        void queryClient.invalidateQueries({ queryKey: ["board", projectId, "milestones"] });
      }
      let epicId = epic;
      let createdEpic: EpicDto | null = null;
      if (epicId === NEW) {
        createdEpic = await epicCreate(milestoneId, newEpicTitle.trim());
        epicId = createdEpic.id;
        setWritten((was) => ({ ...was, [createdEpic!.id]: createdEpic!.title }));
        setEpicChoice(withStory ? createdEpic.id : NEW);
        setNewEpicTitle("");
        void queryClient.invalidateQueries({ queryKey: ["epics", projectId, milestoneId] });
      }
      if (!withStory) {
        if (createdEpic) notify.success(`Added ${createdEpic.key} ${createdEpic.title}`);
        onDone();
        return;
      }
      const story = await storyWriteByHand(
        epicId,
        title.trim(),
        description.trim() === "" ? null : description.trim(),
        criteriaWritten.map((c) => ({
          statement: c.statement.trim(),
          checkCommand: c.checkCommand.trim() === "" ? null : c.checkCommand.trim(),
        })),
      );
      setTitle("");
      setDescription("");
      setCriteria([EMPTY_CRITERION]);
      notify.success(`Wrote ${story?.key ?? "the Story"}`, { description: "It is on the board, in Shaping or Ready." });
      titleRef.current?.focus();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const epicField =
    epic === NEW ? (
      <Field>
        <FieldLabel htmlFor={ids.epicTitle}>Epic title</FieldLabel>
        <Input
          id={ids.epicTitle}
          value={newEpicTitle}
          onChange={(e) => setNewEpicTitle(e.target.value)}
          placeholder="The problem it solves, in a few words"
          autoFocus={withStory || milestoneChoice !== NEW}
        />
      </Field>
    ) : null;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div data-slot="write-story-body" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <FieldGroup className="gap-6">
          <FieldSet className="gap-4">
            <FieldLegend className="text-row font-semibold">Where it goes</FieldLegend>
            <Field>
              <FieldLabel htmlFor={ids.milestone}>Milestone</FieldLabel>
              <RecordCombobox
                id={ids.milestone}
                value={milestoneChoice}
                display={milestoneChoice === NEW ? "New Milestone" : milestoneLabel(milestoneChoice)}
                placeholder="Pick a Milestone"
                searchLabel="Search Milestones"
                emptyText="No open Milestone by that name."
                newLabel="New Milestone…"
                options={milestones.filter(isOpen).map((m: MilestoneDto) => ({
                  value: m.id,
                  search: m.title,
                  content: (
                    <>
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      {m.current && <span className="shrink-0 text-meta text-muted-foreground">Current</span>}
                    </>
                  ),
                }))}
                onChange={(value) => {
                  if (value === milestoneChoice) return;
                  setMilestoneChoice(value);
                  setEpicChoice(withStory && value !== NEW ? "" : NEW);
                }}
              />
            </Field>
            {milestoneChoice === NEW && (
              <div
                data-slot="new-milestone"
                className="grid gap-4 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
              >
                <Field>
                  <FieldLabel htmlFor={ids.milestoneTitle}>Milestone title</FieldLabel>
                  <Input
                    id={ids.milestoneTitle}
                    value={newMilestone.title}
                    onChange={(e) => setNewMilestone((was) => ({ ...was, title: e.target.value }))}
                    placeholder="The outcome it delivers"
                    autoFocus
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={ids.exitTest}>Exit test</FieldLabel>
                  <Input
                    id={ids.exitTest}
                    value={newMilestone.exitTest}
                    onChange={(e) => setNewMilestone((was) => ({ ...was, exitTest: e.target.value }))}
                    placeholder="Optional: how you will know it is done"
                  />
                </Field>
              </div>
            )}
            {withStory ? (
              <Field data-disabled={milestoneChoice === "" || undefined}>
                <FieldLabel htmlFor={ids.epic}>Epic</FieldLabel>
                <RecordCombobox
                  id={ids.epic}
                  value={epic}
                  display={
                    epic === NEW
                      ? "New Epic"
                      : epicOf(epic)
                        ? `${epicOf(epic)!.key} ${epicOf(epic)!.title}`
                        : (written[epic] ?? "")
                  }
                  placeholder={milestoneChoice === "" ? "Pick a Milestone first" : "Pick an Epic"}
                  searchLabel="Search Epics"
                  emptyText="No open Epic by that name."
                  newLabel="New Epic…"
                  disabled={milestoneChoice === "" || milestoneChoice === NEW}
                  options={epics.filter(isOpen).map((e) => ({
                    value: e.id,
                    search: `${e.key} ${e.title}`,
                    content: (
                      <>
                        <StoryKey value={e.key} /> <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      </>
                    ),
                  }))}
                  onChange={setEpicChoice}
                />
                {milestoneChoice === NEW && (
                  <FieldDescription>A new Milestone starts with a new Epic.</FieldDescription>
                )}
              </Field>
            ) : null}
            {epic === NEW &&
              (withStory ? (
                <div className="rounded-md border border-border bg-muted/40 p-3">{epicField}</div>
              ) : (
                epicField
              ))}
          </FieldSet>

          {withStory && (
            <div className="border-t border-border pt-5">
              <FieldSet className="gap-4">
                <FieldLegend className="text-row font-semibold">The Story</FieldLegend>
                <Field>
                  <FieldLabel htmlFor={ids.title}>Story title</FieldLabel>
                  <Input ref={titleRef} id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={ids.description}>Description</FieldLabel>
                  <Textarea
                    id={ids.description}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </Field>
                <CriteriaRows
                  criteria={criteria}
                  onChange={updateCriterion}
                  onRemove={(index) => setCriteria((rows) => rows.filter((_, i) => i !== index))}
                />
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCriteria((rows) => [...rows, EMPTY_CRITERION])}
                  >
                    <Plus aria-hidden="true" />
                    Add criterion
                  </Button>
                </div>
              </FieldSet>
            </div>
          )}
        </FieldGroup>
      </div>

      <DialogFooter className="mx-0 mb-0 shrink-0 items-center rounded-b-lg bg-muted/50 px-5 py-3">
        {error && (
          <p role="alert" className="m-0 min-w-0 flex-1 text-small text-destructive-text">
            {error}
          </p>
        )}
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSubmit} loading={busy}>
          <Plus aria-hidden="true" />
          {withStory ? "Write Story" : "Add Epic"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The Story's criteria, each a statement and an optional Check command, in Field rows. */
function CriteriaRows({
  criteria,
  onChange,
  onRemove,
}: {
  criteria: CriterionDraft[];
  onChange: (index: number, patch: Partial<CriterionDraft>) => void;
  onRemove: (index: number) => void;
}) {
  const baseId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-small font-semibold">Acceptance criteria</span>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {criteria.map((criterion, index) => (
          // Rows have no identity beyond their position until the Story is written.
          <li key={index} className="flex flex-wrap items-end gap-2">
            <Field className="min-w-56 flex-[2]">
              <FieldLabel
                htmlFor={`${baseId}-c${index}`}
                className="font-normal text-muted-foreground"
              >{`Criterion ${index + 1}`}</FieldLabel>
              <Input
                id={`${baseId}-c${index}`}
                value={criterion.statement}
                onChange={(e) => onChange(index, { statement: e.target.value })}
                placeholder="What must hold when the Story is done"
              />
            </Field>
            <Field className="min-w-40 flex-1">
              <FieldLabel
                htmlFor={`${baseId}-k${index}`}
                className="font-normal text-muted-foreground"
              >{`Check command ${index + 1}`}</FieldLabel>
              <Input
                id={`${baseId}-k${index}`}
                value={criterion.checkCommand}
                onChange={(e) => onChange(index, { checkCommand: e.target.value })}
                placeholder="Optional, e.g. npm test"
                className="font-mono text-small"
              />
            </Field>
            {criteria.length > 1 && (
              <Tip content="Remove this criterion">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove criterion ${index + 1}`}
                  onClick={() => onRemove(index)}
                >
                  <X aria-hidden="true" />
                </Button>
              </Tip>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface ComboboxOption {
  value: string;
  /** What typing in the search matches. */
  search: string;
  content: ReactNode;
}

/**
 * A Combobox (DESIGN.md § Components: Popover + Command): an outline trigger that reads as a field, a
 * searchable list of the open records, and a last "New …" item that asks for the new record's fields.
 */
function RecordCombobox({
  id,
  value,
  display,
  placeholder,
  searchLabel,
  emptyText,
  newLabel,
  options,
  disabled = false,
  onChange,
}: {
  id: string;
  value: string;
  display: string;
  placeholder: string;
  searchLabel: string;
  emptyText: string;
  newLabel: string;
  options: ComboboxOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between px-3 font-normal"
        >
          <span className={cn("min-w-0 truncate", display === "" && "text-muted-foreground")}>
            {display || placeholder}
          </span>
          <ChevronsUpDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
        <Command>
          <CommandInput placeholder={searchLabel} aria-label={searchLabel} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.length > 0 && (
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.search} ${option.value}`}
                    data-checked={option.value === value}
                    onSelect={() => pick(option.value)}
                  >
                    {option.content}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {options.length > 0 && <CommandSeparator />}
            <CommandGroup forceMount>
              <CommandItem value={newLabel} forceMount data-checked={value === NEW} onSelect={() => pick(NEW)}>
                <Plus aria-hidden="true" />
                {newLabel}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
