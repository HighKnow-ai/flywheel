/**
 * The inline acceptance-criteria list inside the item detail panel (BOARD-02, D-05/D-06/D-07).
 * Renders for tasks and epics only — the caller (`ItemDetailPanel.tsx`) never mounts this for an
 * issue (D-07: issues carry no contract).
 *
 * Checking a criterion annotates the strip in place and settles (01-UI-SPEC.md "Selected
 * Direction" — Signature interaction): one row's mark changes and the parent's checked/total
 * count advances via the same `board:changed` invalidation every other mutation already
 * triggers — this component never re-renders the rack itself.
 *
 * Keyboard-operable end to end (01-UI-SPEC.md "Keyboard Map — Item detail panel"): `n` with the
 * list focused adds a new criterion inline (statement first, then the verification hint,
 * both inline — no dialog); `Space`/`Enter` on a row toggles it; `j`/`k` move between rows before
 * toggling; `e` on the focused row opens its inline edit affordance (D-76/D-77, plan 04-10) —
 * statement and hint together, one uninterrupted action, no confirmation dialog. A revised
 * criterion (one with a predecessor) carries a quiet "revised" marker (D-79) that expands to its
 * prior wording on demand — that expand read is the ONLY place superseded wording is reachable;
 * it never enters any agent-facing read.
 */
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as icons from "lucide-react";
import { invokeCommand, type ReviewCriterionStateDto } from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";

export type CriterionParentKind = "task" | "epic";

export interface CriterionDto {
  id: string;
  parentType: string;
  parentId: string;
  statement: string;
  verificationHint: string | null;
  checked: boolean;
  rank: string;
  /** D-77's revision counter (plan 04-10) — 1 for a never-revised row. */
  revision: number;
  /** The chain root's id (plan 04-10) — non-null is what shows the "revised" marker (D-79). */
  revisionOf: string | null;
  /** Non-null means a later revision exists and this row's `statement` is preserved history. */
  supersededAt: string | null;
}

export interface AcceptanceCriteriaListProps {
  parentType: CriterionParentKind;
  parentId: string;
  projectId?: string;
  /** The review rail's hooks (Phase 8 plan 08-06). The rail COMPOSES this list rather than forking
   * it, so these are the only two seams it needs: which row has focus, and a per-row "check
   * against the selected lines" affordance (present only inside the rail). */
  onFocusChange?: (criterionId: string | null) => void;
  onCheckSelected?: (criterionId: string) => void;
  /** Whether a zero-criteria item opens its composer on mount (and focuses the statement input).
   * Defaults to true: that is the item panel's documented zero-item state (01-UI-SPEC.md State
   * Inventory). The review rail passes false, because a surface that owns single-key bindings
   * cannot have a sibling steal focus into a text field — the autofocus swallowed `r`
   * (G-08-R2-1), since `useRegionBindings` rightly declines printable keys while an input has
   * focus. */
  autoOpenWhenEmpty?: boolean;
}

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

function criteriaQueryKey(parentType: string, parentId: string) {
  return ["criteria", parentType, parentId] as const;
}

/** The query key the evidence read lives under — `review/useReviewQuery.ts`'s
 * `reviewCriteriaStateQueryKey` builds the identical key, so the rail and this list share one fetch. */
function evidenceQueryKey(parentType: string, parentId: string) {
  return ["review-criteria-state", parentType, parentId] as const;
}

/**
 * A CHECKED criterion's evidence (REVW-03, D-139/D-140/D-141): the anchored path, range and short
 * sha with how it has aged — or, with no anchor, a quiet "no evidence" marker, never
 * indistinguishable from an anchored check. Unchecked criteria render nothing here. An unknown
 * staleness is a plain sentence and never the fresh marker (T-08-06-03).
 */
function EvidenceLine({ entry }: { entry: ReviewCriterionStateDto }) {
  const noEvidence = MARKS_BY_ID["criterion-no-evidence"];
  const fresh = MARKS_BY_ID["criterion-anchor-fresh"];
  const stale = MARKS_BY_ID["criterion-anchor-stale"];
  const muted = { color: "var(--text-muted-rack)", display: "inline-flex", alignItems: "center", gap: 4 } as const;
  const { anchor, staleness } = entry;

  if (!anchor) {
    return (
      <span className="type-label" style={muted}>
        <Icon name={noEvidence?.glyph ?? "CircleSlash"} size={12} />
        {noEvidence?.label}
      </span>
    );
  }

  const range = anchor.lineStart === anchor.lineEnd ? `${anchor.lineStart}` : `${anchor.lineStart}–${anchor.lineEnd}`;
  let ageMark = null;
  if (staleness?.state === "untouched") {
    ageMark = (
      <span style={muted}>
        <Icon name={fresh?.glyph ?? "Anchor"} size={12} />
        {fresh?.label}
      </span>
    );
  } else if (staleness?.state === "changed") {
    const n = staleness.commits ?? 0;
    ageMark = (
      <span style={muted}>
        <Icon name={stale?.glyph ?? "History"} size={12} />
        {stale?.label} — {n} commit{n === 1 ? "" : "s"} since
      </span>
    );
  } else if (staleness?.state === "movedOrChanged") {
    ageMark = (
      <span style={muted}>
        <Icon name={stale?.glyph ?? "History"} size={12} />
        {stale?.label} — file moved or changed
      </span>
    );
  } else if (staleness?.state === "unknown") {
    ageMark = <span style={muted}>recorded commit can no longer be found</span>;
  }

  return (
    <span className="type-label" style={{ ...muted, flexWrap: "wrap", columnGap: "var(--space-sm)" }}>
      <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }}>
        {anchor.path}:{range} ({anchor.side}) @ {anchor.sha.slice(0, 7)}
      </span>
      {ageMark}
    </span>
  );
}

/**
 * The quiet "revised" marker (D-79) — rendered only beside a criterion whose `revisionOf` is
 * non-null. Activating it fetches the chain's history lazily (`enabled` keyed on the expanded
 * state, mirroring this file's own `useQuery` conventions), so a task with many criteria issues
 * one history query only when a developer actually asks for it, never one per row on mount
 * (T-04-27). Expands to the prior statements, oldest first, each carrying its own revision
 * number — the superseded wording surfaces here and nowhere an agent reads (T-04-12).
 */
function RevisedMarker({ criterionId }: { criterionId: string }) {
  const [expanded, setExpanded] = useState(false);

  const revisionsQuery = useQuery({
    queryKey: ["criterion-revisions", criterionId],
    queryFn: () => invokeCommand<CriterionDto[]>("criterion_revisions", { criterionId }),
    enabled: expanded,
  });

  // "Prior" wording only — the current row is already visible in the list, so the expand
  // affordance renders history, not a redundant restatement of what the row already shows.
  const history = (revisionsQuery.data ?? [])
    .filter((revision) => revision.id !== criterionId)
    .sort((a, b) => a.revision - b.revision);

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", marginLeft: "var(--space-xs)" }}>
      <button
        type="button"
        className="type-label"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide prior wording" : "Show prior wording"}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((prev) => !prev);
        }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--text-muted-rack)",
          textDecoration: "underline dotted",
        }}
      >
        revised
      </button>
      {expanded && history.length > 0 && (
        <ul style={{ margin: "var(--space-xs) 0 0", paddingLeft: "var(--space-md)" }}>
          {history.map((revision) => (
            <li key={revision.id} className="type-label" style={{ color: "var(--text-muted-rack)" }}>
              rev {revision.revision}: {revision.statement}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function AcceptanceCriteriaList({
  parentType,
  parentId,
  projectId,
  onFocusChange,
  onCheckSelected,
  autoOpenWhenEmpty = true,
}: AcceptanceCriteriaListProps) {
  const queryClient = useQueryClient();
  const queryKey = criteriaQueryKey(parentType, parentId);
  const evidenceKey = evidenceQueryKey(parentType, parentId);

  // D-140: the absence of evidence must be visible wherever a criterion appears, so the item panel
  // reads the same anchors the review rail does. While this has not loaded nothing is claimed.
  const evidenceQuery = useQuery({
    queryKey: evidenceKey,
    queryFn: async () =>
      (await invokeCommand<ReviewCriterionStateDto[]>("review_criteria_state", {
        scope: parentType,
        itemId: parentId,
      })) ?? [],
  });
  const evidenceById = new Map((evidenceQuery.data ?? []).map((entry) => [entry.criterion.id, entry]));

  const criteriaQuery = useQuery({
    queryKey,
    queryFn: () => invokeCommand<CriterionDto[]>("criterion_list", { parentType, parentId }),
  });
  const criteria = criteriaQuery.data ?? [];

  const createCriterion = useMutation({
    mutationFn: (input: { statement: string; verificationHint?: string }) =>
      invokeCommand<CriterionDto>("criterion_create", {
        projectId,
        parentType,
        parentId,
        statement: input.statement,
        verificationHint: input.verificationHint,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleCriterion = useMutation({
    mutationFn: (criterionId: string) => invokeCommand<CriterionDto>("criterion_toggle", { criterionId }),
    // Unchecking clears the criterion's anchor in the same core transaction, so evidence refreshes too.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: evidenceKey }),
      ]),
  });

  // D-76/D-77 (plan 04-10): the edit affordance's own mutation, following `toggleCriterion`'s
  // exact useMutation + invokeCommand + invalidateQueries shape. The domain layer decides in
  // place vs. appended revision — this mutation carries no lock logic and no confirmation of its
  // own (D-77 chose an edit that appends over rigidity precisely because nothing can be lost
  // here; D-42's show-what-is-at-stake instinct is reserved for destructive operations).
  const reviseCriterion = useMutation({
    mutationFn: (input: { criterionId: string; statement: string; verificationHint?: string }) =>
      invokeCommand<CriterionDto>("criterion_revise", {
        criterionId: input.criterionId,
        statement: input.statement,
        verificationHint: input.verificationHint,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [addStep, setAddStep] = useState<"idle" | "statement" | "hint">("idle");
  const [draftStatement, setDraftStatement] = useState("");
  const [draftHint, setDraftHint] = useState("");
  const statementInputRef = useRef<HTMLInputElement>(null);
  const hintInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    onFocusChange?.(focusedId);
  }, [focusedId, onFocusChange]);

  // The edit affordance (plan 04-10) — `n`/add's sibling, not its clone: editing an EXISTING
  // criterion already has both fields in hand, so it is one inline step (statement + hint
  // together), not add's sequential reveal.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraftStatement, setEditDraftStatement] = useState("");
  const [editDraftHint, setEditDraftHint] = useState("");
  const editStatementInputRef = useRef<HTMLInputElement>(null);

  // Zero criteria: the composer opens on its own, exactly like the board's own zero-item state
  // ("quick-add is already visible and focused so the first keystroke creates the first item" —
  // 01-UI-SPEC.md State Inventory). Opens once per mount, so cancelling (Escape) is honored.
  useEffect(() => {
    if (!autoOpenWhenEmpty) return;
    if (!autoOpenedRef.current && criteriaQuery.data && criteriaQuery.data.length === 0) {
      autoOpenedRef.current = true;
      setAddStep("statement");
    }
  }, [criteriaQuery.data, autoOpenWhenEmpty]);

  useEffect(() => {
    if (addStep === "statement") statementInputRef.current?.focus();
    if (addStep === "hint") hintInputRef.current?.focus();
  }, [addStep]);

  useEffect(() => {
    if (editingId) editStatementInputRef.current?.focus();
  }, [editingId]);

  const checkedCount = criteria.filter((c) => c.checked).length;

  function moveFocus(delta: number) {
    if (criteria.length === 0) return;
    const currentIndex = criteria.findIndex((c) => c.id === focusedId);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : criteria.length - 1
        : Math.min(Math.max(currentIndex + delta, 0), criteria.length - 1);
    setFocusedId(criteria[nextIndex]?.id ?? null);
  }

  function startAdding() {
    setDraftStatement("");
    setDraftHint("");
    setAddStep("statement");
  }

  function cancelAdding() {
    setAddStep("idle");
    setDraftStatement("");
    setDraftHint("");
    listRef.current?.focus();
  }

  function submitAdding() {
    const statement = draftStatement.trim();
    if (statement.length === 0) {
      cancelAdding();
      return;
    }
    const hint = draftHint.trim();
    createCriterion.mutate({ statement, verificationHint: hint.length > 0 ? hint : undefined });
    setAddStep("idle");
    setDraftStatement("");
    setDraftHint("");
    listRef.current?.focus();
  }

  function startEditing(criterionId: string) {
    const criterion = criteria.find((c) => c.id === criterionId);
    if (!criterion) return;
    setEditingId(criterionId);
    setEditDraftStatement(criterion.statement);
    setEditDraftHint(criterion.verificationHint ?? "");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditDraftStatement("");
    setEditDraftHint("");
    listRef.current?.focus();
  }

  function submitEditing() {
    if (!editingId) return;
    const statement = editDraftStatement.trim();
    if (statement.length === 0) {
      cancelEditing();
      return;
    }
    const hint = editDraftHint.trim();
    reviseCriterion.mutate({
      criterionId: editingId,
      statement,
      verificationHint: hint.length > 0 ? hint : undefined,
    });
    setEditingId(null);
    setEditDraftStatement("");
    setEditDraftHint("");
    listRef.current?.focus();
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return; // an inline composer input owns its own keys
    switch (event.key) {
      case "n":
        event.preventDefault();
        startAdding();
        break;
      case "e":
        if (focusedId) {
          event.preventDefault();
          startEditing(focusedId);
        }
        break;
      case "j":
        event.preventDefault();
        moveFocus(1);
        break;
      case "k":
        event.preventDefault();
        moveFocus(-1);
        break;
      case " ":
      case "Enter":
        if (focusedId) {
          event.preventDefault();
          toggleCriterion.mutate(focusedId);
        }
        break;
      default:
        break;
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      submitEditing();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  function handleStatementKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      if (draftStatement.trim().length === 0) {
        cancelAdding();
        return;
      }
      setAddStep("hint");
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelAdding();
    }
  }

  function handleHintKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      submitAdding();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelAdding();
    }
  }

  const checkedMark = MARKS_BY_ID["criterion-checked"];
  const uncheckedMark = MARKS_BY_ID["criterion-unchecked"];

  return (
    <section aria-label="Acceptance criteria" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          Acceptance criteria
        </span>
        <span className="type-label tabular-nums">
          {checkedCount}/{criteria.length}
        </span>
      </header>

      <div
        ref={listRef}
        role="list"
        aria-label="Criteria"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}
      >
        {criteria.length === 0 && addStep === "idle" && (
          <p className="type-body" style={{ color: "var(--text-muted-rack)", margin: 0 }}>
            No criteria yet. Press <kbd>n</kbd> to add one.
          </p>
        )}

        {criteria.map((criterion) => {
          const focused = criterion.id === focusedId;
          const editing = criterion.id === editingId;
          const mark = criterion.checked ? checkedMark : uncheckedMark;
          return (
            <div
              key={criterion.id}
              role="listitem"
              aria-label={`${criterion.statement}, ${criterion.checked ? "checked" : "unchecked"}`}
              onClick={() => {
                if (editing) return; // the edit inputs own clicks while active
                setFocusedId(criterion.id);
                toggleCriterion.mutate(criterion.id);
              }}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--space-sm)",
                padding: "var(--space-xs) var(--space-sm)",
                borderRadius: "var(--radius-chrome)",
                outline: focused ? "2px solid var(--focus-ring)" : "none",
                outlineOffset: -2,
                cursor: editing ? "default" : "pointer",
              }}
            >
              <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, marginTop: 2 }}>
                <Icon name={mark?.glyph ?? "Square"} />
              </span>
              {editing ? (
                <span
                  style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", flex: 1 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    ref={editStatementInputRef}
                    className="type-body"
                    aria-label="Edit criterion statement"
                    value={editDraftStatement}
                    onChange={(event) => setEditDraftStatement(event.target.value)}
                    onKeyDown={handleEditKeyDown}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--divider)",
                      borderRadius: "var(--radius-chrome)",
                      color: "inherit",
                      padding: "var(--space-xs) var(--space-sm)",
                    }}
                  />
                  <input
                    className="type-label"
                    aria-label="Edit criterion verification hint"
                    placeholder="Verification hint (optional)…"
                    value={editDraftHint}
                    onChange={(event) => setEditDraftHint(event.target.value)}
                    onKeyDown={handleEditKeyDown}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--divider)",
                      borderRadius: "var(--radius-chrome)",
                      color: "inherit",
                      padding: "var(--space-xs) var(--space-sm)",
                    }}
                  />
                </span>
              ) : (
                <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <span className="type-body">
                    {criterion.statement}
                    {criterion.revisionOf && <RevisedMarker criterionId={criterion.id} />}
                  </span>
                  {criterion.verificationHint && (
                    <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                      {criterion.verificationHint}
                    </span>
                  )}
                  {criterion.checked && evidenceQuery.data && (
                    <EvidenceLine
                      entry={evidenceById.get(criterion.id) ?? { criterion, anchor: null, staleness: null }}
                    />
                  )}
                </span>
              )}
              {!editing && onCheckSelected && (
                <button
                  type="button"
                  className="type-label"
                  aria-label={`Check "${criterion.statement}" against the selected lines`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFocusedId(criterion.id);
                    onCheckSelected(criterion.id);
                  }}
                  style={{
                    background: "none",
                    border: "1px solid var(--divider)",
                    borderRadius: "var(--radius-chrome)",
                    flexShrink: 0,
                    cursor: "pointer",
                    color: "var(--accent-text-rack)",
                  }}
                >
                  Check against selection
                </button>
              )}
              {!editing && (
                <button
                  type="button"
                  aria-label={`Edit criterion "${criterion.statement}"`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFocusedId(criterion.id);
                    startEditing(criterion.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    flexShrink: 0,
                    marginTop: 2,
                    cursor: "pointer",
                    color: "var(--text-muted-rack)",
                  }}
                >
                  <Icon name="Pencil" size={12} />
                </button>
              )}
            </div>
          );
        })}

        {addStep === "statement" && (
          <input
            ref={statementInputRef}
            className="type-body"
            aria-label="New criterion statement"
            placeholder="Statement…"
            value={draftStatement}
            onChange={(event) => setDraftStatement(event.target.value)}
            onKeyDown={handleStatementKeyDown}
            style={{
              background: "transparent",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              color: "inherit",
              padding: "var(--space-xs) var(--space-sm)",
            }}
          />
        )}
        {addStep === "hint" && (
          <input
            ref={hintInputRef}
            className="type-label"
            aria-label="New criterion verification hint"
            placeholder="Verification hint (optional)…"
            value={draftHint}
            onChange={(event) => setDraftHint(event.target.value)}
            onKeyDown={handleHintKeyDown}
            style={{
              background: "transparent",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              color: "inherit",
              padding: "var(--space-xs) var(--space-sm)",
            }}
          />
        )}
      </div>
    </section>
  );
}
