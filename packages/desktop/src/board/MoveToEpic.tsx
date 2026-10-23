/**
 * "Move to Epic…" in the Story view (issue #168, docs/mvp-spec.md §7): the developer re-parents an open
 * Story to another open Epic of its project. A menu lists those Epics under their Milestones, in Roadmap
 * order; picking one calls the core's `story_move`, which lands the Story at the end of that Epic with its
 * key, criteria, Tasks and worktree untouched. The board re-reads on `board:changed`; nothing here trusts
 * its own write. A refusal from the core is said in the Story card, as Start's is.
 */
import { useState } from "react";
import { ArrowRightLeft, ChevronDown } from "lucide-react";
import { storyMove, type StoryDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const [busy, setBusy] = useState(false);
  const epics = useProjectEpics(projectId);
  // A Merged or Dropped Story stays in the Epic it closed in.
  if (story.state === "merged" || story.state === "dropped") return null;

  // The other open Epics, gathered under their Milestones in Roadmap order.
  const groups: { milestoneId: string; milestoneTitle: string; epics: typeof epics }[] = [];
  for (const entry of epics) {
    if (entry.epic.id === story.epicId || !isOpenRecord(entry.epic.state)) continue;
    const last = groups[groups.length - 1];
    if (last?.milestoneId === entry.milestone.id) last.epics.push(entry);
    else groups.push({ milestoneId: entry.milestone.id, milestoneTitle: entry.milestone.title, epics: [entry] });
  }

  function move(epicId: string) {
    setBusy(true);
    onError(null);
    storyMove(story.id, epicId)
      .catch((err: unknown) => onError(errorText(err)))
      .finally(() => setBusy(false));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy} aria-label={`Move ${story.key} to another Epic`}>
          <ArrowRightLeft aria-hidden="true" />
          Move to Epic…
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto max-w-96 min-w-64">
        {groups.length === 0 && <DropdownMenuItem disabled>No other open Epic in this project</DropdownMenuItem>}
        {groups.map((group, index) => (
          <DropdownMenuGroup key={group.milestoneId}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="type-condensed text-meta">{group.milestoneTitle}</DropdownMenuLabel>
            {group.epics.map(({ epic }) => (
              <DropdownMenuItem key={epic.id} onSelect={() => move(epic.id)} className="text-body">
                <span className="w-14 shrink-0 font-mono text-meta text-muted-foreground">{epic.key}</span>{" "}
                <span className="truncate">{epic.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
