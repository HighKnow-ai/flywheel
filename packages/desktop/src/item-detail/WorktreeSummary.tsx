/**
 * The worktree summary line (02-UI-SPEC.md "Worktree summary", DATA-06/WORK-08/LINK-01) — a
 * small embedded section inside the item detail panel, following `AcceptanceCriteriaList.tsx`'s
 * shape but with none of its own header: this section's own defining property is that it renders
 * NOTHING at all until a worktree exists (absence is the design, State Inventory "No worktree
 * yet") — unlike `ActivityTrail.tsx`/`AcceptanceCriteriaList.tsx`, which always render a labeled
 * header even when their own list is empty.
 *
 * Reads through `useWorktreeSummary` (`board/useBoardQuery.ts`, plan 02-07 Task 1). Renders one
 * rows: the branch name and the absolute path, in the body face. (They were Mono, the system monospace
 * stack; 08.1-15 closure, finding 6, moved them into the panel's one family, as the approved comp prints them.)
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
 * **Open in editor / Open in terminal** (D-130, LINK-11, plan 07-04 Task 3) — two more
 * text-style tertiary actions in the same row as Remove Worktree, each running a
 * user-configurable command template resolved in the Rust core (`domain::worktree::
 * resolve_open_argv`) with this task's worktree path substituted. The renderer never sees a
 * program name, argument or path — it supplies only the task id and one of the two
 * `WorktreeOpenSurface` values. Closes the gate this file's header comment used to reserve for
 * Phase 7.
 *
 * **Remove Worktree** (WORK-03, D-41, plan 03-01 Task 1) — a text-style tertiary action appended
 * after the branch/path row, opening `WorktreeRemovalDialog`. All three tertiary actions share
 * ONE `BannerState`-shaped in-flight/error state object for the open-in-editor/open-in-terminal
 * pair (Remove Worktree opens a dialog instead and has no in-flight state of its own) — the same
 * rationale `MissingWorktreeBanner` below states explicitly: pressing either button disables both
 * and a failure message has one home. Rendered only on the path where `query.data` resolved to a
 * real summary AND the row's status is not `missing` — see `MissingWorktreeBanner` below, which
 * this component renders instead of the branch/path row (and therefore instead of these actions
 * too) whenever the worktree is missing from disk.
 *
 * **Missing-worktree decision banner** (WORK-06, D-45, plan 03-09 Task 2; gated on status alone
 * since plan 03-18 Task 2) — inserted into the early-return ladder below, between the
 * singleton-violation guard and the normal render. When `summary.status === "missing"` this
 * REPLACES the branch/path row and the Remove Worktree action entirely (never renders alongside
 * them — 03-UI-SPEC.md's "Missing-worktree decision banner"), offering exactly two
 * equally-weighted actions: Recreate Worktree and Remove Record. The early return is gated on
 * `status` alone — there is no `path` conjunct — so there is no value of `path` for which a
 * missing row can reach the normal render, and the Remove Worktree action below is structurally
 * unreachable while the row is `missing`; there is no second guard anywhere in this file for that,
 * the early return IS the guarantee. `path` only selects which of the banner's two body sentences
 * renders: the one naming a real path, or — when no usable path is recorded — the one that omits
 * the location clause rather than interpolating an empty string.
 */
import { useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useWorktreeSummary } from "../board/useBoardQuery";
import {
  worktreeForgetRecord,
  worktreeOpen,
  worktreeRecreate,
  type WorktreeOpenSurface,
  type WorktreeSummaryDto,
} from "../adapters/tauri";
import { WorktreeRemovalDialog } from "./WorktreeRemovalDialog";

/** The shared text-style tertiary-action button treatment — Remove Worktree's own existing
 * inline style, factored out so the two new D-130 actions (Open in editor / Open in terminal)
 * render identically rather than duplicating the object literal three times. */
const tertiaryActionButtonStyle = {
  background: "transparent",
  border: "none",
  color: "var(--text-muted-rack)",
  textDecoration: "underline",
  padding: 0,
  cursor: "pointer",
} as const;

/** One banner action's own in-flight/error state (mirrors `session/PermissionRequestCard.tsx`'s
 * `RowState` idiom) — ONE shared object for the whole banner, not one per button, so pressing
 * either button disables both and a failure message has one home. */
interface BannerState {
  acting: boolean;
  error: string | null;
}

// The edge and radius come from the `control-edge` class (a 3:1 control boundary, never the divider).
const bannerActionButtonStyle = {
  padding: "var(--space-xs) var(--space-md)",
  background: "transparent",
  color: "var(--text-primary-rack)",
  cursor: "pointer",
} as const;

/**
 * D-45's missing-worktree decision banner. Exists only here (this component is not reused
 * anywhere else) — kept local rather than extracting a shared module for a single call site.
 *
 * The two actions carry IDENTICAL visual treatment (same border/background/text colour) —
 * `03-UI-SPEC.md` is explicit this is a genuine either/or, not a safe-default/destructive pair, so
 * `Remove Record` deliberately does NOT reuse `WorktreeRemovalDialog.tsx`'s destructive
 * button style: nothing is destroyed on disk by it, and destructive weight would misreport what it
 * does.
 *
 * On success this component renders nothing new locally — the banner disappears only because
 * `worktree_recreate`/`worktree_forget_record` both emit `board:changed`, `useWorktreeSummary`
 * re-reads, and the row's `status` is no longer `"missing"`. A rejected call sets `error` and
 * leaves `acting` false; the banner never unmounts and never clears itself (a failed recreate is
 * not a decision made, 03-UI-SPEC.md E3 `error`).
 */
function MissingWorktreeBanner({ taskId, path }: { taskId: string; path?: string | null }) {
  const [state, setState] = useState<BannerState>({ acting: false, error: null });
  // `state.acting` alone is not a sufficient guard against two clicks arriving in the same
  // synchronous tick (React's state update has not necessarily flushed to the DOM, and the
  // `disabled` attribute with it, before a second `.click()` fires) — a ref reads/writes
  // synchronously with no such window, so it is the actual guard; `state.acting` remains the
  // source of truth for what the UI renders (disabled/opacity).
  const actingRef = useRef(false);

  async function recreate() {
    if (actingRef.current) return;
    actingRef.current = true;
    setState({ acting: true, error: null });
    try {
      await worktreeRecreate(taskId);
      // No local success state to set: the board:changed emit above invalidates
      // useWorktreeSummary, which re-reads and flips status away from "missing" — that re-render
      // is what removes this banner, never a local optimistic flag.
    } catch {
      actingRef.current = false;
      setState({ acting: false, error: "Couldn't recreate this worktree. Try again." });
    }
  }

  async function forgetRecord() {
    if (actingRef.current) return;
    actingRef.current = true;
    setState({ acting: true, error: null });
    try {
      await worktreeForgetRecord(taskId);
    } catch {
      actingRef.current = false;
      setState({ acting: false, error: "Couldn't remove this record. Try again." });
    }
  }

  return (
    <div
      role="group"
      aria-label="Worktree missing from disk"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{ color: "var(--destructive-text-rack)", flexShrink: 0, display: "inline-flex" }}
        >
          <TriangleAlert size={16} strokeWidth={2} />
        </span>
        <span className="type-label" style={{ color: "var(--text-primary-rack)" }}>
          This worktree is missing from disk.
        </span>
      </div>

      <p className="type-body" style={{ margin: 0, overflowWrap: "anywhere", color: "var(--text-primary-rack)" }}>
        {isNonEmptyString(path) ? (
          <>
            Flywheel expected it at {path}, but nothing is there. Recreate it to keep working, or
            remove the record if you don&rsquo;t need it anymore.
          </>
        ) : (
          <>
            Flywheel expected the worktree on disk and found nothing there. Recreate it to keep
            working, or remove the record if you don&rsquo;t need it anymore.
          </>
        )}
      </p>

      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button
          type="button"
          disabled={state.acting}
          onClick={() => void recreate()}
          className="type-body control-edge"
          style={{ ...bannerActionButtonStyle, opacity: state.acting ? 0.6 : 1 }}
        >
          Recreate Worktree
        </button>
        <button
          type="button"
          disabled={state.acting}
          onClick={() => void forgetRecord()}
          className="type-body control-edge"
          style={{ ...bannerActionButtonStyle, opacity: state.acting ? 0.6 : 1 }}
        >
          Remove Record
        </button>
      </div>

      {state.error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}

export interface WorktreeSummaryProps {
  taskId: string;
}

/** The wire type's own contract says `branch`/`path` are non-null strings — this widened local
 * type is deliberately more permissive so the component can defensively handle a schema
 * regression at runtime (T-02-37) rather than trusting the compile-time guarantee blindly. */
type PossiblyPartialSummary = {
  branch?: string | null;
  path?: string | null;
  status?: string | null;
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
  const [removalDialogOpen, setRemovalDialogOpen] = useState(false);

  // D-130's shared in-flight/error state for the Open in editor / Open in terminal pair — ONE
  // object for both actions, mirroring `MissingWorktreeBanner`'s own `BannerState` rationale:
  // pressing either button disables both and a failure message has one home.
  const [openState, setOpenState] = useState<BannerState>({ acting: false, error: null });
  // Synchronous guard against a second click landing before React's `disabled` attribute has
  // flushed — same reasoning as `MissingWorktreeBanner`'s own `actingRef`.
  const openActingRef = useRef(false);

  async function openWorktree(surface: WorktreeOpenSurface) {
    if (openActingRef.current) return;
    openActingRef.current = true;
    setOpenState({ acting: true, error: null });
    try {
      await worktreeOpen(taskId, surface);
      openActingRef.current = false;
      setOpenState({ acting: false, error: null });
    } catch (err) {
      openActingRef.current = false;
      setOpenState({
        acting: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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

  // Missing-worktree decision banner (WORK-06, D-45): an early return, inserted between the
  // singleton-violation guard above and the normal branch/path render below — this REPLACES that
  // render entirely rather than layering onto it (03-UI-SPEC.md "never rendered alongside the
  // normal line"), and is what makes the Remove Worktree action below structurally unreachable
  // while the row is missing. Gated on `status` alone (plan 03-18 Task 2) — there is no `path`
  // conjunct here, so no value of `path` (empty, null, or absent) can let a missing row fall
  // through to the normal render below; the banner itself decides how to phrase a location it
  // does not have.
  if (summary.status === "missing") {
    return <MissingWorktreeBanner taskId={taskId} path={summary.path} />;
  }

  const hasBranch = isNonEmptyString(summary.branch);
  const hasPath = isNonEmptyString(summary.path);

  return (
    <section
      aria-label="Worktree"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}
    >
      {/* Two property rows in the body face (the panel's one family; the branch and path were set in the system
          monospace stack, a second family). Each value sits in a `minmax(0, 1fr)` column and ellipsises
          within it: the branch from the right, the path from the LEFT so the meaningful tail stays. A
          `flex-shrink: 0` on the branch used to push the path past the panel's padding box (08.1-15 closure,
          finding 1). */}
      <dl className="detail-props">
        <dt className="type-body">Worktree</dt>
        <dd>
          {hasBranch ? (
            <span
              className="type-body tabular-nums detail-clip"
              title={summary.branch as string}
              style={{ color: "var(--text-primary-rack)" }}
            >
              {summary.branch}
            </span>
          ) : (
            <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
              Branch unavailable
            </span>
          )}
        </dd>

        <dt className="type-body">Path</dt>
        <dd>
          {hasPath ? (
            <button
              type="button"
              onClick={() => void copyToClipboard(summary.path as string)}
              aria-label="Copy worktree path"
              title={summary.path as string}
              className="type-body tabular-nums detail-clip detail-clip-left"
            >
              {/* `bdi` isolates the path as left-to-right text inside the right-to-left box, so the ellipsis lands at
                  the START and the meaningful tail stays. `unicode-bidi: plaintext` on the box did not do this in
                  WebKit: it clipped both ends. */}
              <bdi>{summary.path}</bdi>
            </button>
          ) : (
            <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
              Path unavailable
            </span>
          )}
        </dd>
      </dl>

      {violatesSingleton && (
        <span role="alert" className="type-label" style={{ color: "var(--destructive-text-rack)" }}>
          More than one worktree was recorded for this task — showing the first.
        </span>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setRemovalDialogOpen(true)}
          className="type-label"
          style={tertiaryActionButtonStyle}
        >
          Remove Worktree
        </button>

        <button
          type="button"
          disabled={openState.acting}
          onClick={() => void openWorktree("editor")}
          className="type-label"
          style={{ ...tertiaryActionButtonStyle, opacity: openState.acting ? 0.6 : 1 }}
        >
          Open in editor
        </button>

        <button
          type="button"
          disabled={openState.acting}
          onClick={() => void openWorktree("terminal")}
          className="type-label"
          style={{ ...tertiaryActionButtonStyle, opacity: openState.acting ? 0.6 : 1 }}
        >
          Open in terminal
        </button>
      </div>

      {openState.error && (
        <span role="alert" className="type-label" style={{ color: "var(--destructive-text-rack)" }}>
          {openState.error}
        </span>
      )}

      {removalDialogOpen && (
        <WorktreeRemovalDialog taskId={taskId} onClose={() => setRemovalDialogOpen(false)} />
      )}
    </section>
  );
}
