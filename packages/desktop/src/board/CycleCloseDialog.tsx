import type { UnfinishedEpicDto } from "../adapters/tauri";

export interface CycleCloseDialogProps {
  projectId: string;
  cycleId: string;
  cycleGoal: string;
  epics: UnfinishedEpicDto[];
  targets: { id: string; key: string; goal: string }[];
  onDone: () => void;
  onCancel: () => void;
}

export function CycleCloseDialog(_props: CycleCloseDialogProps) {
  return null;
}
