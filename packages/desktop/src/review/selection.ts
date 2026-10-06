/**
 * The reader's selection in the review diff (Phase 8 plan 08-06, D-139). It lives on the surface
 * because the rail — a sibling of the diff — is what consumes it. An anchor is one path with one
 * range by schema, so a selection never spans two files: selecting in a second file replaces it.
 * Selecting writes nothing; only the explicit check action turns a selection into evidence.
 */
export interface SelectedChange {
  /** Research assumption A9: a deletion anchors to the old side, anything else to the new side. */
  side: "old" | "new";
  line: number;
}

export interface ReviewSelection {
  path: string;
  /** Keyed by react-diff-view's change key. */
  changes: Record<string, SelectedChange>;
}

export interface AnchorInput {
  path: string;
  side: "old" | "new";
  lineStart: number;
  lineEnd: number;
}

/** Clicking a change adds it; clicking it again removes it; a change in another file replaces the
 * whole selection. Returns `null` when nothing is left selected. */
export function toggleChange(
  selection: ReviewSelection | null,
  path: string,
  key: string,
  change: SelectedChange,
): ReviewSelection | null {
  if (!selection || selection.path !== path) return { path, changes: { [key]: change } };
  const { [key]: existing, ...rest } = selection.changes;
  const changes = existing ? rest : { ...selection.changes, [key]: change };
  return Object.keys(changes).length === 0 ? null : { path, changes };
}

/** The anchor a check would attach: the min and max line of the selected changes on one side — the
 * old side only when every selected change is a deletion, the new side otherwise (deletions have
 * no new-side number, so they are skipped from a mixed range). `undefined` with no selection. */
export function anchorFromSelection(selection: ReviewSelection | null): AnchorInput | undefined {
  if (!selection) return undefined;
  const picked = Object.values(selection.changes);
  if (picked.length === 0) return undefined;
  const side = picked.every((c) => c.side === "old") ? "old" : "new";
  const lines = picked.filter((c) => c.side === side).map((c) => c.line);
  return { path: selection.path, side, lineStart: Math.min(...lines), lineEnd: Math.max(...lines) };
}
