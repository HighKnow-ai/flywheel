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
 * toggling.
 */
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as icons from "lucide-react";
import { invokeCommand } from "../adapters/tauri";
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
}

export interface AcceptanceCriteriaListProps {
  parentType: CriterionParentKind;
  parentId: string;
  projectId?: string;
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

export function AcceptanceCriteriaList({ parentType, parentId, projectId }: AcceptanceCriteriaListProps) {
  const queryClient = useQueryClient();
  const queryKey = criteriaQueryKey(parentType, parentId);

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

  // Zero criteria: the composer opens on its own, exactly like the board's own zero-item state
  // ("quick-add is already visible and focused so the first keystroke creates the first item" —
  // 01-UI-SPEC.md State Inventory). Opens once per mount, so cancelling (Escape) is honored.
  useEffect(() => {
    if (!autoOpenedRef.current && criteriaQuery.data && criteriaQuery.data.length === 0) {
      autoOpenedRef.current = true;
      setAddStep("statement");
    }
  }, [criteriaQuery.data]);

  useEffect(() => {
    if (addStep === "statement") statementInputRef.current?.focus();
    if (addStep === "hint") hintInputRef.current?.focus();
  }, [addStep]);

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

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return; // an inline composer input owns its own keys
    switch (event.key) {
      case "n":
        event.preventDefault();
        startAdding();
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
          const mark = criterion.checked ? checkedMark : uncheckedMark;
          return (
            <div
              key={criterion.id}
              role="listitem"
              aria-label={`${criterion.statement}, ${criterion.checked ? "checked" : "unchecked"}`}
              onClick={() => {
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
                cursor: "pointer",
              }}
            >
              <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, marginTop: 2 }}>
                <Icon name={mark?.glyph ?? "Square"} />
              </span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="type-body">{criterion.statement}</span>
                {criterion.verificationHint && (
                  <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                    {criterion.verificationHint}
                  </span>
                )}
              </span>
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
