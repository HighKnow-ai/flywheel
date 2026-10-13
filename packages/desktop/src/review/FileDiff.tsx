/**
 * One file's patch rendered as a unified diff (Phase 8 plan 08-01, D-135/D-136): `parseDiff` ->
 * `tokenize` (Prism via the `.children` adapter in `highlight.ts`) -> `<Diff>`. Unified only —
 * there is no split view and no toggle, so there is nothing to remember or persist.
 *
 * Nothing is silently shortened. A long file renders its first `HUNK_CHUNK` hunks and a control
 * that names how many remain; highlighting is skipped above `HIGHLIGHT_LINE_CAP` changed lines
 * and the plain text still renders, with a line saying so. A binary file renders one binary line
 * and calls no tokenizer.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  computeNewLineNumber,
  computeOldLineNumber,
  Diff,
  getChangeKey,
  Hunk,
  markEdits,
  parseDiff,
  tokenize,
  type RenderGutter,
} from "react-diff-view";
import "react-diff-view/style/index.css";
import "./review.css";
import { diffRefractor, languageFor } from "./highlight";
import type { ReviewSelection, SelectedChange } from "./selection";

/** Hunks rendered per chunk. A heuristic, not a measurement (research assumption A1) — a constant
 * so it is tunable without a structural change. */
export const HUNK_CHUNK = 40;

/** Changed lines above which tokenizing is skipped (the patch still renders as plain text).
 * Same status as `HUNK_CHUNK`: a heuristic held in one place. */
export const HIGHLIGHT_LINE_CAP = 5000;

/** The sign column (three-3, WCAG 1.4.1): change is the row tint AND a text glyph, so it survives
 * greyscale and colour-blind vision. It sits in the gutter cell that holds the line number — the new
 * side of an added row, the old side of a removed one — so context rows and the empty cells carry none. */
const renderGutter: RenderGutter = ({ change, side, renderDefault, wrapInAnchor }) => {
  const sign = change.type === "insert" && side === "new" ? "+" : change.type === "delete" && side === "old" ? "-" : null;
  return wrapInAnchor(
    <>
      {sign && <span className="diff-sign">{sign}</span>}
      {renderDefault()}
    </>,
  );
};

const BINARY_PATCH = /^(Binary files .* differ|GIT binary patch)$/m;

const noticeStyle = { color: "var(--text-muted-rack)", margin: 0, padding: "var(--space-xs) var(--space-md)" };

/** A criterion already anchored to a line of this file — rendered as a badge after that line. */
export interface AnchorBadge {
  criterionId: string;
  statement: string;
  side: "old" | "new";
  lineEnd: number;
}

export interface FileDiffProps {
  patch: string;
  path: string;
  /** The surface's selection; only highlighted here when it belongs to this file. */
  selection?: ReviewSelection | null;
  /** Reports a gutter click upward. The surface owns the selection (the rail is a sibling). */
  onSelectChange?: (key: string, change: SelectedChange) => void;
  /** Criteria anchored in THIS file. Widgets carry board text only, never patch content. */
  anchors?: AnchorBadge[];
}

export function FileDiff({ patch, path, selection = null, onSelectChange, anchors = [] }: FileDiffProps) {
  const [shown, setShown] = useState(HUNK_CHUNK);

  const parsed = useMemo(() => {
    if (BINARY_PATCH.test(patch)) return { binary: true as const };
    const file = parseDiff(patch)[0];
    if (!file) return { binary: false as const, file: null };
    let changedLines = 0;
    for (const hunk of file.hunks) {
      for (const change of hunk.changes) if (change.type !== "normal") changedLines += 1;
    }
    return { binary: false as const, file, changedLines };
  }, [patch]);

  const language = languageFor(path);
  const skipHighlight = parsed.binary || !parsed.file ? false : parsed.changedLines > HIGHLIGHT_LINE_CAP;

  const tokens = useMemo(() => {
    if (parsed.binary || !parsed.file || !language || skipHighlight) return null;
    try {
      return tokenize(parsed.file.hunks, {
        highlight: true,
        refractor: diffRefractor as never,
        language,
        enhancers: [markEdits(parsed.file.hunks, { type: "block" })],
      });
    } catch {
      return null;
    }
  }, [parsed, language, skipHighlight]);

  // Line-level hooks (D-135 corrected by research): `Decoration` wraps hunks, so the selection
  // highlight is `selectedChanges`, the click is `gutterEvents`, and an anchor badge is a `widgets`
  // entry keyed by change key. Hooks stay above the early returns below.
  const selectedChanges = useMemo(
    () => (selection && selection.path === path ? Object.keys(selection.changes) : []),
    [selection, path],
  );

  const gutterEvents = useMemo(
    () =>
      onSelectChange
        ? {
            onClick: ({ change }: { change: Parameters<typeof getChangeKey>[0] | null }) => {
              if (!change) return;
              const deleted = change.type === "delete";
              onSelectChange(getChangeKey(change), {
                side: deleted ? "old" : "new",
                line: deleted ? computeOldLineNumber(change) : computeNewLineNumber(change),
              });
            },
          }
        : undefined,
    [onSelectChange],
  );

  const widgets = useMemo(() => {
    const out: Record<string, ReactNode> = {};
    if (parsed.binary || !parsed.file || anchors.length === 0) return out;
    for (const hunk of parsed.file.hunks) {
      for (const change of hunk.changes) {
        const onThisLine = anchors.filter((a) =>
          a.side === "old"
            ? change.type !== "insert" && computeOldLineNumber(change) === a.lineEnd
            : change.type !== "delete" && computeNewLineNumber(change) === a.lineEnd,
        );
        if (onThisLine.length === 0) continue;
        out[getChangeKey(change)] = (
          <div className="type-label review-anchor-widget control-edge">
            {onThisLine.map((a) => (
              <span key={a.criterionId}>Evidence for: {a.statement}</span>
            ))}
          </div>
        );
      }
    }
    return out;
  }, [parsed, anchors]);

  if (parsed.binary) {
    return (
      <p className="type-label" style={noticeStyle}>
        Binary file — not shown.
      </p>
    );
  }
  if (!parsed.file || parsed.file.hunks.length === 0) {
    return (
      <p className="type-label" style={noticeStyle}>
        No line changes (a rename, copy or mode change only).
      </p>
    );
  }

  const { file } = parsed;
  const visible = file.hunks.slice(0, shown);
  const remaining = file.hunks.length - visible.length;

  return (
    <div>
      {skipHighlight && (
        <p className="type-label" style={noticeStyle}>
          Syntax highlighting skipped: {parsed.changedLines.toLocaleString()} changed lines. The full
          diff is shown as plain text.
        </p>
      )}
      <Diff
        viewType="unified"
        diffType={file.type}
        hunks={visible}
        tokens={tokens}
        selectedChanges={selectedChanges}
        gutterEvents={gutterEvents}
        renderGutter={renderGutter}
        widgets={widgets}
        className="review-diff"
      >
        {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
      </Diff>
      {remaining > 0 && (
        <button
          type="button"
          className="type-label"
          onClick={() => setShown((n) => n + HUNK_CHUNK)}
          style={{
            background: "transparent",
            border: "1px solid var(--border-control)",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            cursor: "pointer",
            margin: "var(--space-sm) var(--space-md)",
            padding: "var(--space-xs) var(--space-md)",
          }}
        >
          Show {Math.min(remaining, HUNK_CHUNK)} more of {remaining} remaining hunks
        </button>
      )}
    </div>
  );
}
