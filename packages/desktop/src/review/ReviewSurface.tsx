/**
 * The review surface (Phase 8 plan 08-01, REVW-01/REVW-02, D-131/D-132/D-137): the fourth full
 * surface, pushed into from the item detail panel and popped back out of with "← Board" or
 * Escape — `triage/TriageSurface.tsx`'s sibling shell. The board's own state lives in the store
 * and is untouched underneath. Nothing here is a modal.
 *
 * One scope-agnostic surface over both a task (its branch against its epic integration branch)
 * and an epic (the integration branch against the default branch). The file list is ONE git read
 * on open; a file's patch is fetched only once it is expanded, and every file starts collapsed.
 *
 * The criteria rail (plan 08-06) is the leftmost pane. The surface owns the reader's line selection
 * (an anchor is one path with one range, so a selection never spans files) because the rail — a
 * sibling of the diff — is what consumes it; the diff reports gutter clicks up and renders the
 * highlight and anchor badges back down. Like `item-detail/GitFactsSection.tsx`, the file list renders nothing at all while its read is
 * in flight — absence is the design, not a placeholder.
 */
import { useEffect, useMemo, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import { MARKS_BY_ID } from "../legend/marks";
import type { ReviewFileDto, ReviewScopeDto } from "../adapters/tauri";
import { useEpics } from "../board/useBoardQuery";
import { nextSelectionId, useRegionBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import { CriteriaRail, useCheckAgainstSelection } from "./CriteriaRail";
import { EpicRequestBar, EpicRequestSheet } from "./EpicRequestSheet";
import { FileDiff, type AnchorBadge } from "./FileDiff";
import { MergeConfirmSheet } from "./MergeConfirmSheet";
import { toggleChange, type ReviewSelection, type SelectedChange } from "./selection";
import { useMergePrecheck, useReviewCriteriaState, useReviewFiles, useReviewPatch } from "./useReviewQuery";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const GENERATED_FILES = ["package-lock.json", "Cargo.lock", "pnpm-lock.yaml", "yarn.lock"];

/** Lockfiles, minified bundles, sourcemaps, build output and snapshots — tagged and collapsed,
 * never hidden and never refused. A constant list, not detection. */
function isGenerated(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return (
    GENERATED_FILES.includes(name) ||
    path.endsWith(".min.js") ||
    path.endsWith(".map") ||
    path.startsWith("dist/") ||
    path.includes("/dist/") ||
    path.endsWith(".snap")
  );
}

function FilePatch({
  scope,
  itemId,
  file,
  visible,
  selection,
  onSelectChange,
  anchors,
}: {
  scope: ReviewScopeDto;
  itemId: string;
  file: ReviewFileDto;
  visible: boolean;
  selection: ReviewSelection | null;
  onSelectChange: (path: string, key: string, change: SelectedChange) => void;
  anchors: AnchorBadge[];
}) {
  const patch = useReviewPatch(scope, itemId, file.path, file.oldPath, true);
  return (
    <section style={{ display: visible ? "block" : "none", marginBottom: "var(--space-lg)" }}>
      <h3
        className="type-label"
        style={{ fontFamily: MONO_STACK, margin: 0, padding: "var(--space-sm) var(--space-md)", borderBottom: "1px solid var(--divider)" }}
      >
        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      </h3>
      {patch.isError && (
        <p role="alert" className="type-label" style={{ color: "var(--destructive-text-rack)", padding: "var(--space-sm) var(--space-md)", margin: 0 }}>
          Could not read this file's diff.
        </p>
      )}
      {patch.data === null && (
        <p className="type-label" style={{ color: "var(--text-muted-rack)", padding: "var(--space-sm) var(--space-md)", margin: 0 }}>
          No diff available.
        </p>
      )}
      {typeof patch.data === "string" && (
        <FileDiff
          patch={patch.data}
          path={file.path}
          selection={selection}
          onSelectChange={(key, change) => onSelectChange(file.path, key, change)}
          anchors={anchors}
        />
      )}
    </section>
  );
}

/** The `integrated` legend mark (plan 08-06 defined it; this is its first renderer). Word and glyph,
 * never colour alone. */
function IntegratedMark() {
  const mark = MARKS_BY_ID.integrated;
  const Glyph = (icons as unknown as Record<string, ComponentType<{ size?: number; strokeWidth?: number }>>)[
    mark?.glyph ?? "GitMerge"
  ];
  return (
    <span className="type-label" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--success-text-rack)" }}>
      {Glyph && <Glyph size={14} strokeWidth={2} />}
      {mark?.label ?? "Integrated"}
    </span>
  );
}

/** Why the Merge action is absent, in the surface's own voice. `noBranch` and `noIntegrationBranch`
 * are already said by the file list's own empty states, so they add nothing here. */
function MergeRefusalNote({ category }: { category: string }) {
  let text: string | null = null;
  if (category === "noEpic") {
    text =
      "Review works for every task, but an in-app merge needs an epic with a cut integration branch. This task has no epic — open a request for it from the item panel instead.";
  } else if (category === "nothingToMerge") {
    text = "Nothing to merge: this branch has no commits ahead of its epic's integration branch.";
  }
  if (!text) return null;
  return (
    <p className="type-label" style={{ margin: 0, padding: "var(--space-xs) var(--space-md)", color: "var(--text-muted-rack)", borderBottom: "1px solid var(--divider)" }}>
      {text}
    </p>
  );
}

export interface ReviewSurfaceProps {
  scope: ReviewScopeDto;
  itemId: string;
  /** The item's key and title, for the header. */
  label: string;
  /** For an epic review reached from a task: the task to return to when the scope is toggled back. */
  fromTask?: { itemId: string; label: string };
  onBack: () => void;
  /** Called by the merge sheet's resolve-a-conflict offer once it has started a session. */
  onOpenSession?: (agentRunId: string, epicId: string | null, logOffset: number | null) => void;
}

export function ReviewSurface({ scope, itemId, label, fromTask, onBack, onOpenSession }: ReviewSurfaceProps) {
  const filesQuery = useReviewFiles(scope, itemId);
  const files = filesQuery.data?.files ?? [];
  const target = filesQuery.data?.target;

  const rows = files.map((f) => ({ ...f, id: f.path }));
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  // `opened` is every file ever expanded (its patch hook stays mounted, so collapsing and
  // re-expanding never re-requests); `expanded` is what is currently shown.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (files.length > 0 && (!focusedPath || !files.some((f) => f.path === focusedPath))) {
      setFocusedPath(files[0].path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesQuery.data]);

  function toggle(path: string) {
    setOpened((prev) => new Set(prev).add(path));
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // The merge action exists for a task only. The precheck is the dry run (free, writes nothing); it
  // is read here, not only in the sheet, because whether the action is offered depends on it.
  const isTask = scope === "task";
  const mergePrecheck = useMergePrecheck(itemId, isTask);
  const [mergeOpen, setMergeOpen] = useState(false);
  const integrated = isTask && target?.postMerge === true;
  // Whether Merge is offered. One expression, read by the button and by the `m` binding, so the
  // keystroke and the button can never be offered under different conditions (G-08-6).
  const mergeOffered = isTask && !integrated && !mergeOpen && mergePrecheck.data?.state === "ready";
  // The epic's request action is epic scope only; it is the mirror of Merge, which is task scope only.
  const [requestOpen, setRequestOpen] = useState(false);
  // A sheet owns the keyboard while it is open.
  const sheetOpen = mergeOpen || requestOpen;

  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [focusedCriterionId, setFocusedCriterionId] = useState<string | null>(null);

  // A selection is one range in one file in one scope, and the opened files are that scope's: carrying
  // either across a scope change would offer evidence from a diff the reader is no longer looking at.
  useEffect(() => {
    setSelection(null);
    setFocusedCriterionId(null);
    setOpened(new Set());
    setExpanded(new Set());
  }, [scope, itemId]);

  // The scope toggle rewrites the one store field that says what the surface shows, so the scope
  // survives a remount. A task hops to its own epic (from the resolved target); an epic hops back to
  // the task it was reached from. There is nothing to hop to otherwise, so no toggle.
  const setReviewSurface = useUiStore((state) => state.setReviewSurface);
  const epicRoster = useEpics(isTask ? (target?.projectId ?? undefined) : undefined);
  const hopEpicId = isTask ? target?.epicId : null;
  const canToggle = isTask ? Boolean(hopEpicId) : Boolean(fromTask);
  function switchScope(next: ReviewScopeDto) {
    if (next === scope) return;
    if (next === "epic" && hopEpicId) {
      const epic = (epicRoster.data?.epics ?? []).find((e) => e.id === hopEpicId);
      setReviewSurface({
        scope: "epic",
        itemId: hopEpicId,
        label: epic ? `${epic.key} ${epic.title}` : "Epic",
        fromTask: { itemId, label },
      });
    } else if (next === "task" && fromTask) {
      setReviewSurface({ scope: "task", itemId: fromTask.itemId, label: fromTask.label });
    }
  }
  const checkAgainstSelection = useCheckAgainstSelection(scope, itemId, selection);
  const criteriaState = useReviewCriteriaState(scope, itemId);
  // Anchored criteria by file, as badges. Absent anchors are simply absent: no badge, no claim.
  const anchorsByPath = useMemo(() => {
    const out: Record<string, AnchorBadge[]> = {};
    for (const s of criteriaState.data ?? []) {
      if (!s.anchor || !s.criterion.checked) continue;
      (out[s.anchor.path] ??= []).push({
        criterionId: s.criterion.id,
        statement: s.criterion.statement,
        side: s.anchor.side,
        lineEnd: s.anchor.lineEnd,
      });
    }
    return out;
  }, [criteriaState.data]);

  function selectChange(path: string, key: string, change: SelectedChange) {
    setSelection((current) => toggleChange(current, path, key, change));
  }

  useRegionBindings("review-surface", "review-surface", {
    "check-with-selection": () => {
      if (!sheetOpen && focusedCriterionId) checkAgainstSelection(focusedCriterionId);
    },
    "move-down": () => {
      if (!sheetOpen) setFocusedPath((current) => nextSelectionId(rows, current, 1));
    },
    "move-up": () => {
      if (!sheetOpen) setFocusedPath((current) => nextSelectionId(rows, current, -1));
    },
    "expand-file": () => {
      if (!sheetOpen && focusedPath) toggle(focusedPath);
    },
    "open-merge": () => {
      if (!sheetOpen && mergeOffered) setMergeOpen(true);
    },
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // With a sheet open, Escape closes the sheet (which handles it itself), not the surface. An
      // Escape a sheet or a criterion input already handled (defaultPrevented) is not this
      // surface's to act on either (WR-06).
      if (event.key === "Escape" && !event.defaultPrevented && !sheetOpen) onBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack, sheetOpen]);

  let listBody;
  if (filesQuery.isError) {
    listBody = (
      <p role="alert" className="type-label" style={{ color: "var(--destructive-text-rack)", margin: 0, padding: "var(--space-md)" }}>
        Could not read this branch's changes.
      </p>
    );
  } else if (!target) {
    listBody = null;
  } else if (target.state === "noIntegrationBranch") {
    listBody = (
      <p className="type-body" style={{ margin: 0, padding: "var(--space-md)", color: "var(--text-muted-rack)" }}>
        {label} has no integration branch yet, so there is nothing to review. It is cut when its first task starts.
      </p>
    );
  } else if (target.state === "noBranch") {
    listBody = (
      <p className="type-body" style={{ margin: 0, padding: "var(--space-md)", color: "var(--text-muted-rack)" }}>
        {label} has no branch yet. Start work on it to create one.
      </p>
    );
  } else if (files.length === 0) {
    listBody = (
      <p className="type-body" style={{ margin: 0, padding: "var(--space-md)", color: "var(--text-muted-rack)" }}>
        No changes against {target.base}.
      </p>
    );
  } else {
    listBody = (
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {files.map((file) => {
          const isOpen = expanded.has(file.path);
          return (
            <li key={file.path}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                  setFocusedPath(file.path);
                  toggle(file.path);
                }}
                className="type-label review-file"
                data-focused={focusedPath === file.path}
              >
                <span style={{ fontFamily: MONO_STACK, color: "var(--text-muted-rack)", width: "1.5ch" }}>
                  {file.status}
                </span>
                <span style={{ fontFamily: MONO_STACK, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                </span>
                {isGenerated(file.path) && (
                  <span style={{ color: "var(--text-muted-rack)" }}>generated</span>
                )}
                {file.binary ? (
                  <span style={{ color: "var(--text-muted-rack)" }}>binary</span>
                ) : (
                  <span style={{ fontFamily: MONO_STACK }}>
                    <span style={{ color: "var(--success-text-rack)" }}>+{file.added ?? 0}</span>{" "}
                    <span style={{ color: "var(--destructive-text-rack)" }}>−{file.removed ?? 0}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--text-primary-rack)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-md)",
          padding: "var(--space-md)",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="type-label"
          style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
        >
          ← Board
        </button>
        <span className="type-heading">{label}</span>
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          {scope === "epic" ? "Epic review" : "Task review"}
        </span>
        {canToggle && (
          <span role="group" aria-label="Review scope" style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
            {(["task", "epic"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                onClick={() => switchScope(option)}
                className="type-label control-edge review-scope"
              >
                {option === "task" ? "This task" : "Whole epic"}
              </button>
            ))}
          </span>
        )}
        {integrated && <IntegratedMark />}
        {target?.state === "resolved" && (
          <span className="type-label" style={{ fontFamily: MONO_STACK, color: "var(--text-muted-rack)", marginLeft: "auto" }}>
            {integrated ? `merged: ${(target.head ?? "").slice(0, 7)} against its first parent` : `${target.head} → ${target.base}`}
          </span>
        )}
        {mergeOffered && (
          <button
            type="button"
            onClick={() => setMergeOpen(true)}
            className="type-label control-edge review-action"
            style={{ marginLeft: target?.state === "resolved" ? 0 : "auto" }}
          >
            Merge
          </button>
        )}
      </header>
      {isTask && !integrated && mergePrecheck.data?.state === "refused" && (
        <MergeRefusalNote category={mergePrecheck.data.category} />
      )}
      {scope === "epic" && target?.state === "resolved" && <EpicRequestBar epicId={itemId} onOpen={() => setRequestOpen(true)} />}
      {requestOpen && <EpicRequestSheet epicId={itemId} onClose={() => setRequestOpen(false)} />}
      {mergeOpen && (
        <MergeConfirmSheet
          taskId={itemId}
          onClose={() => setMergeOpen(false)}
          // Clear this surface before the session takes the screen, rather than stacking on it.
          onOpenSession={(agentRunId) => {
            onBack();
            onOpenSession?.(agentRunId, null, null);
          }}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ width: "clamp(260px, 26%, 360px)", overflowY: "auto", borderRight: "1px solid var(--divider)" }}>
          <CriteriaRail
            scope={scope}
            itemId={itemId}
            selection={selection}
            onCheck={checkAgainstSelection}
            onFocusChange={setFocusedCriterionId}
          />
        </div>
        <nav
          aria-label="Changed files"
          style={{ width: "clamp(260px, 30%, 380px)", overflowY: "auto", borderRight: "1px solid var(--divider)" }}
        >
          {listBody}
        </nav>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          {expanded.size === 0 && files.length > 0 && (
            <p className="type-label" style={{ color: "var(--text-muted-rack)", padding: "var(--space-md)", margin: 0 }}>
              Expand a file to read its diff.
            </p>
          )}
          {files
            .filter((f) => opened.has(f.path))
            .map((file) => (
              <FilePatch
                key={file.path}
                scope={scope}
                itemId={itemId}
                file={file}
                visible={expanded.has(file.path)}
                selection={selection}
                onSelectChange={selectChange}
                anchors={anchorsByPath[file.path] ?? []}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
