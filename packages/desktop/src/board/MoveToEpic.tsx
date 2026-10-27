/**
 * "Move to Epic…" in the Story view (issue #168, docs/mvp-spec.md §7): the developer re-parents an open
 * Story to another open Epic of its project. A Combobox (Popover plus Command, issue #204) lists the open
 * Epics under their Milestones, in Roadmap order, with a search field and a check on the Epic the Story is
 * in now; picking another calls the core's `story_move`, which lands the Story at the end of that Epic with
 * its key, criteria, Tasks and worktree untouched. The board re-reads on `board:changed`; nothing here trusts
 * its own write. A toast says where it went and offers Undo (a move back); a refusal from the core is said
 * in the Story card, as Start's is.
 */
import { useState } from "react";
import { ArrowRightLeft, ChevronsUpDown } from "lucide-react";
import { storyMove, type StoryDto } from "../adapters/tauri";
import { Button } from "@/components/Button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@highknow/design";
import { notify } from "@/lib/notify";
import { isOpenRecord } from "./AddRecordControls";
import { useProjectEpics } from "./StoryBoard";
import { errorText } from "./StoryControls";

export function MoveToEpicControl({
  projectId,
  story,
  onError,
}: {
  projectId: string;
  story: StoryDto;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const epics = useProjectEpics(projectId);
  // A Merged or Dropped Story stays in the Epic it closed in.
  if (story.state === "merged" || story.state === "dropped") return null;

  // The open Epics and the Story's own, gathered under their Milestones in Roadmap order.
  const groups: { milestoneId: string; milestoneTitle: string; epics: typeof epics }[] = [];
  for (const entry of epics) {
    if (entry.epic.id !== story.epicId && !isOpenRecord(entry.epic.state)) continue;
    const last = groups[groups.length - 1];
    if (last?.milestoneId === entry.milestone.id) last.epics.push(entry);
    else groups.push({ milestoneId: entry.milestone.id, milestoneTitle: entry.milestone.title, epics: [entry] });
  }
  const others = epics.filter(({ epic }) => epic.id !== story.epicId && isOpenRecord(epic.state)).length;
  const keyOf = (epicId: string | null) => epics.find(({ epic }) => epic.id === epicId)?.epic.key ?? null;

  function move(epicId: string, epicKey: string, undoTo: string | null) {
    setOpen(false);
    setBusy(true);
    onError(null);
    storyMove(story.id, epicId)
      .then(() => {
        const back = undoTo;
        notify.success(`Moved ${story.key} to ${epicKey}`, {
          undo: back ? () => move(back, keyOf(back) ?? "its Epic", null) : undefined,
        });
      })
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          loading={busy}
          aria-label={`Move ${story.key} to another Epic`}
        >
          <ArrowRightLeft aria-hidden="true" />
          Move to Epic…
          <ChevronsUpDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command label={`Epics to move ${story.key} to`}>
          <CommandInput placeholder="Search Epics" aria-label="Search Epics" />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-4 text-small text-muted-foreground">
              {others === 0 ? "No other open Epic in this project" : "No Epic matches"}
            </CommandEmpty>
            {groups.map((group, index) => (
              <div key={group.milestoneId}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group.milestoneTitle}>
                  {group.epics.map(({ epic }) => {
                    const current = epic.id === story.epicId;
                    return (
                      <CommandItem
                        key={epic.id}
                        value={`${epic.key} ${epic.title}`}
                        data-checked={current}
                        disabled={current}
                        onSelect={() => move(epic.id, epic.key, story.epicId)}
                        className="text-body data-[disabled=true]:opacity-100 *:[svg:last-child]:text-running"
                      >
                        <span className="w-14 shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
                          {epic.key}
                        </span>{" "}
                        <span className="min-w-0 flex-1 truncate">{epic.title}</span>
                        {current && <span className="sr-only">(the Story's Epic now)</span>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
