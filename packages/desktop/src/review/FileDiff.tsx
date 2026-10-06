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
import { useMemo, useState } from "react";
import { Diff, Hunk, markEdits, parseDiff, tokenize } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./review.css";
import { diffRefractor, languageFor } from "./highlight";

/** Hunks rendered per chunk. A heuristic, not a measurement (research assumption A1) — a constant
 * so it is tunable without a structural change. */
export const HUNK_CHUNK = 40;

/** Changed lines above which tokenizing is skipped (the patch still renders as plain text).
 * Same status as `HUNK_CHUNK`: a heuristic held in one place. */
export const HIGHLIGHT_LINE_CAP = 5000;

const BINARY_PATCH = /^(Binary files .* differ|GIT binary patch)$/m;

const noticeStyle = { color: "var(--text-muted-rack)", margin: 0, padding: "var(--space-xs) var(--space-md)" };

export function FileDiff({ patch, path }: { patch: string; path: string }) {
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
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            color: "var(--accent-text-rack)",
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
