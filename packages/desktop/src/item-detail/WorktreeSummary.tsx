/**
 * The worktree summary line (02-UI-SPEC.md "Worktree summary", DATA-06/WORK-08/LINK-01) — a
 * small embedded section inside the item detail panel, following `AcceptanceCriteriaList.tsx`'s
 * shape but with none of its own header: this section's own defining property is that it renders
 * NOTHING at all until a worktree exists (absence is the design, State Inventory "No worktree
 * yet") — unlike `ActivityTrail.tsx`/`AcceptanceCriteriaList.tsx`, which always render a labeled
 * header even when their own list is empty.
 *
 * Reads through `useWorktreeSummary` (`board/useBoardQuery.ts`, plan 02-07 Task 1). Renders one
 * line: the branch name and the absolute path, both in the Mono role (the local `MONO_STACK`
 * constant `session/FeedRow.tsx`/`session/SessionSurface.tsx`/`session/RawLogView.tsx`/
 * `session/PermissionRequestCard.tsx` each already declare their own copy of — this file follows
 * that same established per-file convention rather than extracting a fifth shared constant).
 *
 * The path truncates from the LEFT (`direction: rtl` + `text-align: left` is the standard CSS
 * technique for this — the browser ellipsizes the leading characters while the trailing ones,
 * the meaningful `{PROJECT}/{TASK}/` tail, stay visible) because the shared `~/Flywheel/` prefix
 * carries no information a supervising user needs to distinguish one task's worktree from
 * another's. Truncation is presentational only — the copy affordance always writes the full,
 * untruncated path to the clipboard (T-02-36).
 *
 * A worktree row with a null branch or path (E6 `partial`) renders the field it does have plus an
 * inline notice naming the one it does not, rather than an empty Mono span or a hidden section —
 * `worktrees.branch`/`worktrees.path` are both `NOT NULL` at the schema level today
 * (`0003_agent_runtime.sql`), so this path is unreachable through the current backend, but the
 * defensive rendering stays because a null here is exactly the kind of schema regression T-02-37
 * says must surface, not silently render blank.
 *
 * No "open in editor/terminal" affordance is rendered — that is `LINK-11`, Phase 7, out of scope
 * here (this file's own structural `<verify>` gate greps for it).
 */
import { useWorktreeSummary } from "../board/useBoardQuery";
import type { WorktreeSummaryDto } from "../adapters/tauri";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export interface WorktreeSummaryProps {
  taskId: string;
}

/** The wire type's own contract says `branch`/`path` are non-null strings — this widened local
 * type is deliberately more permissive so the component can defensively handle a schema
 * regression at runtime (T-02-37) rather than trusting the compile-time guarantee blindly. */
type PossiblyPartialSummary = {
  branch?: string | null;
  path?: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access can be refused by the OS/browser sandbox — this is a best-effort
    // convenience affordance, not a critical path; a failed copy leaves the line exactly as it
    // was, no error state to render (mirrors this codebase's own "no toast for a soft failure"
    // restraint elsewhere).
  }
}

export function WorktreeSummary({ taskId }: WorktreeSummaryProps) {
  const query = useWorktreeSummary(taskId);

  // E6 `loading`: render nothing while the read is in flight — a transitional placeholder would
  // make the section's eventual appearance stop meaning "work has started" (State Inventory).
  if (query.isPending) return null;

  // E6 `empty`: no worktree yet — the section does not exist, not an empty-state placeholder.
  if (!query.data) return null;

  // E6 `zero-one-many` defensive branch: `worktree_summary` returns a single object or `null` by
  // construction (one worktree per task, a UNIQUE constraint) — this guards only against a
  // malformed IPC reply that somehow resolves to an array instead, so a schema regression
  // surfaces as a visible notice rather than a silent `[0]` or a crash.
  const rawData: unknown = query.data;
  const violatesSingleton = Array.isArray(rawData);
  const summary = (violatesSingleton ? (rawData as WorktreeSummaryDto[])[0] : rawData) as
    | PossiblyPartialSummary
    | undefined;
  if (!summary) return null;

  const hasBranch = isNonEmptyString(summary.branch);
  const hasPath = isNonEmptyString(summary.path);

  return (
    <section
      aria-label="Worktree"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
        {hasBranch ? (
          <span
            className="type-body"
            style={{ fontFamily: MONO_STACK, flexShrink: 0, color: "var(--text-primary-rack)" }}
          >
            {summary.branch}
          </span>
        ) : (
          <span className="type-label" style={{ color: "var(--text-muted-rack)", flexShrink: 0 }}>
            Branch unavailable
          </span>
        )}

        {hasPath ? (
          <button
            type="button"
            onClick={() => void copyToClipboard(summary.path as string)}
            aria-label="Copy worktree path"
            title={summary.path as string}
            className="type-body"
            style={{
              fontFamily: MONO_STACK,
              background: "transparent",
              border: "none",
              padding: 0,
              margin: 0,
              color: "var(--text-muted-rack)",
              cursor: "pointer",
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
              unicodeBidi: "plaintext",
            }}
          >
            {summary.path}
          </button>
        ) : (
          <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            Path unavailable
          </span>
        )}
      </div>

      {violatesSingleton && (
        <span role="alert" className="type-label" style={{ color: "var(--destructive-text-rack)" }}>
          More than one worktree was recorded for this task — showing the first.
        </span>
      )}
    </section>
  );
}
