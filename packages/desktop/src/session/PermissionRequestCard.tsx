/**
 * The permission-request card (AGNT-06, D-37, D-38) — ONE component, mounted in two places
 * (02-UI-SPEC.md Discretion #6): the `feed` variant inline in the session transcript
 * (`SessionSurface.tsx`, plan 02-06 Task 2) and the `compact` variant inside the 480px item detail
 * panel (`ItemDetailPanel.tsx`, same task). Both instances read the SAME
 * `usePendingPermissionRequests(agentRunId)` query (`board/useBoardQuery.ts`) and answer through
 * the same `answerPermissionRequest` mutation, so answering in either place resolves both within
 * one pushed-delta cycle (E3's `partial` consideration) — this component itself is presentational:
 * it renders whatever pending set its caller passes and reports back through `onAnswer`.
 *
 * Reusing one component across two mount points is the pattern `ParentPicker`/`StatusPicker`
 * already established in this codebase (02-UI-SPEC.md's own citation) — do not build a second
 * card.
 *
 * **Not dismissible — deliberately, and this is the one place in the whole product that departs
 * from the shared Escape ladder** (`state/keyboard.ts`'s own doc comment on `EscapeLayer`,
 * T-02-16). This file owns no local key handler, no `onKeyDown` prop and no dismissable-layer
 * wrapper — closing the card without answering would hide the blocked state rather than resolve
 * it, and the agent would still be blocked. Its three keyboard shortcuts (`a`/`d`/Shift+A) resolve
 * through `state/keyboard.ts`'s shared `useRegionBindings` hook instead — the window-level
 * listener lives in that module, not here, which is what keeps this file's own key/dismissal
 * surface at zero (this task's own structural verify gate).
 */
import { useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import { MARKS_BY_ID } from "../legend/marks";
import { useRegionBindings } from "../state/keyboard";

export type PermissionRequestCardVariant = "feed" | "compact";

/** One pending `permission_requests` row, projected for this card — mirrors
 * `adapters/tauri.ts`'s `PendingPermissionRequestDto` field-for-field. */
export interface PendingPermissionRequest {
  id: string;
  toolName: string;
  inputPayload: string | null;
}

export type PermissionDecision = "allow" | "deny" | "allow_always";

export interface PermissionRequestCardProps {
  variant: PermissionRequestCardVariant;
  /** Every pending request for the run this card is mounted against, oldest first (E3's
   * zero-one-many resolution: "stacked in creation order, each independently answerable" — never
   * only the first). Renders nothing at all for an empty array — not an empty container, not a
   * placeholder (E3 `empty`). */
  requests: PendingPermissionRequest[];
  onAnswer: (requestId: string, decision: PermissionDecision) => Promise<void>;
}

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** One request row's own answering/error state — independent per request id, so answering one
 * card never touches a sibling's state (E3 `partial`/zero-one-many). */
interface RowState {
  answering: boolean;
  error: string | null;
}

function PermissionRequestRow({
  request,
  variant,
  keyboardEnabled,
  onAnswer,
}: {
  request: PendingPermissionRequest;
  variant: PermissionRequestCardVariant;
  /** True only for the oldest pending request — the one `a`/`d`/Shift+A apply to when more than
   * one request is showing at once. A deliberate, documented simplification: concurrent requests
   * on one run are rare (02-05-SUMMARY's own D4 measured exactly two), and every request stays
   * independently answerable by click regardless of which one currently owns the keyboard. */
  keyboardEnabled: boolean;
  onAnswer: (requestId: string, decision: PermissionDecision) => Promise<void>;
}) {
  const [state, setState] = useState<RowState>({ answering: false, error: null });
  const glyph = MARKS_BY_ID["blocked-indicator"];

  async function answer(decision: PermissionDecision) {
    // A second activation while disabled invokes nothing (T-02-29) — the guard the UI layer adds
    // on top of the core's own guarded once-only write.
    if (state.answering) return;
    setState({ answering: true, error: null });
    try {
      await onAnswer(request.id, decision);
      // On success this row disappears once the shared pending-set query re-reads (Task 2) — no
      // local "answered" state to hold here.
    } catch {
      setState({ answering: false, error: "Could not send your answer. Try again." });
    }
  }

  useRegionBindings("permission-card", "permission-card", {
    "answer-permission-allow": () => {
      if (keyboardEnabled) void answer("allow");
    },
    "answer-permission-deny": () => {
      if (keyboardEnabled) void answer("deny");
    },
    "answer-permission-allow-always": () => {
      if (keyboardEnabled) void answer("allow_always");
    },
  });

  const payloadMaxHeight = variant === "compact" ? 160 : 240;

  return (
    <div
      role="group"
      aria-label={`${request.toolName} wants to:`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-md)",
        borderRadius: "var(--radius-chrome)",
        background: "var(--surface-secondary)",
        color: "var(--text-primary-rack)",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
        <span aria-hidden="true" style={{ color: "var(--blocked-text-rack)", flexShrink: 0, display: "inline-flex" }}>
          <Icon name={glyph?.glyph ?? "ShieldAlert"} />
        </span>
        <span
          className="type-heading"
          title={`${request.toolName} wants to:`}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {request.toolName} wants to:
        </span>
      </div>

      <pre
        className="type-body"
        style={{
          margin: 0,
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxHeight: payloadMaxHeight,
          overflowY: "auto",
          color: "var(--text-primary-rack)",
        }}
      >
        {request.inputPayload ?? ""}
      </pre>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <button
            type="button"
            disabled={state.answering}
            onClick={() => void answer("allow")}
            className="type-body"
            style={{
              background: "var(--accent-nontext)",
              border: "none",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: state.answering ? "default" : "pointer",
              opacity: state.answering ? 0.6 : 1,
            }}
          >
            Allow
          </button>
          <button
            type="button"
            disabled={state.answering}
            onClick={() => void answer("deny")}
            className="type-body"
            style={{
              background: "transparent",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: state.answering ? "default" : "pointer",
              opacity: state.answering ? 0.6 : 1,
            }}
          >
            Deny
          </button>
        </div>
        <button
          type="button"
          disabled={state.answering}
          onClick={() => void answer("allow_always")}
          className="type-label"
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "none",
            color: "var(--text-muted-rack)",
            textDecoration: "underline",
            padding: 0,
            cursor: state.answering ? "default" : "pointer",
            opacity: state.answering ? 0.6 : 1,
          }}
        >
          Allow this tool for this project from now on
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

export function PermissionRequestCard({ variant, requests, onAnswer }: PermissionRequestCardProps) {
  if (requests.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Pending permission requests"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}
    >
      {requests.map((request, index) => (
        <PermissionRequestRow
          key={request.id}
          request={request}
          variant={variant}
          keyboardEnabled={index === 0}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
}
