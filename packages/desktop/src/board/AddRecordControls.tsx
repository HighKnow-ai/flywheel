/**
 * The visible controls for adding to the roster where the record goes (issue #168, docs/mvp-spec.md §7):
 * "+ Story" on an Epic card's heading and "+ Epic" in the Milestone header. Each opens the board's Write a
 * Story / Add an Epic dialog (`WriteStoryDialog.tsx`) with its place already chosen, so the developer names
 * the record instead of finding its Epic or Milestone again. The top bar keeps only + Story, for a record whose
 * place is not on screen; its Write a Story adds a new Milestone or Epic on the way (issue #201).
 *
 * Every add inside a card is the same control (issue #201): a small ghost button, a plus and the record's
 * name.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoryFormDialog } from "./WriteStoryDialog";

/** A Done or Dropped record takes nothing new: the core refuses it, so the control is not offered. */
export function isOpenRecord(state: string): boolean {
  return state !== "done" && state !== "dropped";
}

/** "+ Story" on an open Epic's card: Write a Story inside that Epic. */
export function AddStoryToEpic({
  projectId,
  epic,
}: {
  projectId: string;
  epic: { id: string; key: string; title: string; milestoneId: string; state: string };
}) {
  const [open, setOpen] = useState(false);
  if (!isOpenRecord(epic.state)) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Add a Story to ${epic.key} ${epic.title}`}>
        <Plus aria-hidden="true" />
        Story
      </Button>
      <StoryFormDialog
        projectId={projectId}
        mode={open ? "story" : null}
        preset={{ milestoneId: epic.milestoneId, epicId: epic.id }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** "+ Epic" in an open Milestone's header: Add an Epic inside that Milestone. */
export function AddEpicToMilestone({
  projectId,
  milestone,
}: {
  projectId: string;
  milestone: { id: string; title: string; state: string };
}) {
  const [open, setOpen] = useState(false);
  if (!isOpenRecord(milestone.state)) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Add an Epic to ${milestone.title}`}>
        <Plus aria-hidden="true" />
        Epic
      </Button>
      <StoryFormDialog
        projectId={projectId}
        mode={open ? "epic" : null}
        preset={{ milestoneId: milestone.id }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
