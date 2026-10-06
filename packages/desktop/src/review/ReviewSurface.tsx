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
import { useEffect, useMemo, useState } from "react";
import type { ReviewFileDto, ReviewScopeDto } from "../adapters/tauri";
import { nextSelectionId, useRegionBindings } from "../state/keyboard";
import { CriteriaRail, useCheckAgainstSelection } from "./CriteriaRail";
import { FileDiff, type AnchorBadge } from "./FileDiff";
import { toggleChange, type ReviewSelection, type SelectedChange } from "./selection";
import { useReviewCriteriaState, useReviewFiles, useReviewPatch } from "./useReviewQuery";

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

export interface ReviewSurfaceProps {
  scope: ReviewScopeDto;
  itemId: string;
  /** The item's key and title, for the header. */
  label: string;
  onBack: () => void;
  /** Reserved for plan 08-07's resolve-session offer; `App.tsx` already supplies it. */
  onOpenSession?: (agentRunId: string, epicId: string | null, logOffset: number | null) => void;
}

export function ReviewSurface({ scope, itemId, label, onBack }: ReviewSurfaceProps) {
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

  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [focusedCriterionId, setFocusedCriterionId] = useState<string | null>(null);
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
      if (focusedCriterionId) checkAgainstSelection(focusedCriterionId);
    },
    "move-down": () => setFocusedPath((current) => nextSelectionId(rows, current, 1)),
    "move-up": () => setFocusedPath((current) => nextSelectionId(rows, current, -1)),
    "expand-file": () => {
      if (focusedPath) toggle(focusedPath);
    },
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

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
                className="type-label"
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--space-sm)",
                  width: "100%",
                  textAlign: "left",
                  background: focusedPath === file.path ? "var(--row-surface-selected)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--divider)",
                  color: "var(--text-primary-rack)",
                  cursor: "pointer",
                  padding: "var(--space-xs) var(--space-md)",
                }}
              >
                <span style={{ fontFamily: MONO_STACK, color: "var(--accent-text-rack)", width: "1.5ch" }}>
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
        {target?.state === "resolved" && (
          <span className="type-label" style={{ fontFamily: MONO_STACK, color: "var(--text-muted-rack)", marginLeft: "auto" }}>
            {target.head} → {target.base}
          </span>
        )}
      </header>
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
