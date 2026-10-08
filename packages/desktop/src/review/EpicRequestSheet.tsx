/**
 * Proposing an epic's integration branch to the forge (Phase 8 plan 08-08, REVW-05, D-118/D-120/
 * D-122): the one action in the review phase that publishes board content outside the machine, so it
 * keeps Phase 7's preview-then-confirm discipline (`item-detail/ForgeSection.tsx`).
 *
 * The sheet previews the draft exactly as the command returned it and confirms with an epic id and
 * the content hash that preview carried. This file never builds, trims, re-orders or hashes request
 * text: the preview and the publish come from one core function, and the core refuses a confirm
 * whose draft no longer matches the hash, which is what makes "what you saw is what you sent" a
 * property of the design instead of a promise.
 *
 * Nothing here writes a status or polls: no epic-request observer exists in this phase, so the
 * request ships read-only. A request that merges carries nothing to Done yet.
 *
 * Four things can stop the action, and they read differently on purpose. Three are things the user
 * can change, so each is one sentence naming the fix. "This project has no forge" is a permanent
 * property of the project, so (D-120, absence is the design) it renders nothing at all.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useRegionBindings } from "../state/keyboard";
import * as adapter from "../adapters/tauri";
import "./review.css";
import type { EpicRequestBlockerDto, EpicRequestOutcomeDto, ForgeRequestDto } from "../adapters/tauri";
import { useEpicRequest, useEpicRequestDraft } from "./useReviewQuery";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** A forge-supplied URL is a link target only if it is plain web. Any other scheme (javascript:,
 * data:, file:, a custom handler) renders as text. */
export function safeHref(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** One sentence per blocker the user can act on; `null` means render nothing at all. */
function blockerSentence(blocker: EpicRequestBlockerDto): string | null {
  switch (blocker) {
    case "noIntegrationBranch":
      return "No integration branch has been cut for this epic yet. It is cut when the first task starts.";
    case "nothingToPropose":
      return "The integration branch has nothing the default branch does not. Merge a task into it first.";
    case "noRemote":
      return "This repository has no remote named origin. Add one to propose this branch.";
    case "noForgeConfigured":
    default:
      return null;
  }
}

function RequestLink({ request }: { request: ForgeRequestDto }) {
  const href = safeHref(request.url);
  const text = `#${request.number} ${request.title}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--accent-text-rack)", overflowWrap: "anywhere" }}>
      {text}
    </a>
  ) : (
    <span style={{ overflowWrap: "anywhere" }}>{text}</span>
  );
}

function isOpenRequest(request: ForgeRequestDto | null | undefined): request is ForgeRequestDto {
  return Boolean(request) && (request?.state === "Open" || request?.state === "ChangesRequested");
}

/** What the epic review shows beside its diff: the existing request read-only, a named reason the
 * action is unavailable, the action itself, or nothing. */
export function EpicRequestBar({ epicId, onOpen }: { epicId: string; onOpen: () => void }) {
  const preview = useEpicRequestDraft(epicId, true);
  const existing = useEpicRequest(epicId);

  // Whether the action is offered. One expression, read by the button and by the `r` binding, so the
  // keystroke can never open a sheet the bar would not offer (G-08-6). With no forge this is false
  // and the empty map below leaves `r` unclaimed: absence is the design (D-120).
  const offered = !isOpenRequest(existing.data) && Boolean(preview.data?.draft) && !preview.data?.blocker;
  // Before every conditional return, so hook order is stable.
  useRegionBindings("review-surface", "review-surface", offered ? { "open-epic-request": onOpen } : {});

  const barStyle = {
    margin: 0,
    padding: "var(--space-xs) var(--space-md)",
    borderBottom: "1px solid var(--divider)",
    color: "var(--text-muted-rack)",
  } as const;

  if (isOpenRequest(existing.data)) {
    return (
      <p className="type-label" style={barStyle}>
        Request <RequestLink request={existing.data} /> —{" "}
        {existing.data.state === "ChangesRequested" ? "changes requested" : "open"}
      </p>
    );
  }
  if (!preview.data) return null;
  if (preview.data.blocker) {
    const sentence = blockerSentence(preview.data.blocker);
    // The no-integration-branch absence is already said by the file list; only the two blockers the
    // file list cannot say appear here.
    if (!sentence || preview.data.blocker === "noIntegrationBranch") return null;
    return (
      <p className="type-label" style={barStyle}>
        {sentence}
      </p>
    );
  }
  if (!offered) return null;
  return (
    <div style={{ ...barStyle, display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
      <button
        type="button"
        onClick={onOpen}
        className="type-label control-edge review-action"
      >
        Open request
      </button>
    </div>
  );
}

type Failure = { code: string; detail: string };

/** The bare category `forge_open_epic_request` rejects with when the draft changed since the preview. */
const DRAFT_CHANGED = "draftChanged";

/** The command rejects with `"<category>:<detail>"`. Anything else is the generic failure; raw text
 * is never shown (the core logs it). */
function parseFailure(err: unknown): Failure {
  const message = err instanceof Error ? err.message : String(err);
  const [code, ...rest] = message.split(":");
  return { code, detail: rest.join(":") };
}

function failureText({ code, detail }: Failure): string {
  switch (code) {
    case "cliNotInstalled":
      return `${detail} is not installed, so a request cannot be opened from here. Nothing was pushed.`;
    case "cliNotAuthenticated":
      return `${detail} is installed but not authenticated — run ${detail} auth login. Nothing was pushed.`;
    case "cliFailed":
    case "malformedJson":
      return `${detail} could not be read right now. Nothing was pushed. Details are in the application log.`;
    case "blocked":
      return blockerSentence(detail as EpicRequestBlockerDto) ?? "This project has no forge.";
    default:
      return "The request could not be opened.";
  }
}

function OutcomeBody({ outcome }: { outcome: EpicRequestOutcomeDto }) {
  if (outcome.kind === "opened") {
    return (
      <p role="status" className="type-body" style={{ margin: 0 }}>
        Request opened: <RequestLink request={outcome.request} />
      </p>
    );
  }
  if (outcome.kind === "alreadyOpen") {
    return (
      <p role="status" className="type-body" style={{ margin: 0 }}>
        This epic already has an open request: <RequestLink request={outcome.request} />. Nothing was pushed or
        created.
      </p>
    );
  }
  if (outcome.kind === "pushRejected") {
    return (
      <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
        The push was rejected, so no request was created. Details are in the application log.
      </p>
    );
  }
  return (
    <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
      Pushed, but no request was opened. <span style={{ fontFamily: MONO_STACK }}>{outcome.branch}</span> is now on
      the remote and no request exists for it. Check the forge, then open the request again.
    </p>
  );
}

export interface EpicRequestSheetProps {
  epicId: string;
  onClose: () => void;
}

export function EpicRequestSheet({ epicId, onClose }: EpicRequestSheetProps) {
  const preview = useEpicRequestDraft(epicId, true);
  const [opening, setOpening] = useState(false);
  const [outcome, setOutcome] = useState<EpicRequestOutcomeDto | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The hash of the draft the core refused as stale (G-08-5). Kept as a value rather than a flag so
  // the notice appears exactly when the re-fetched draft differs from the one that was refused.
  const [refusedHash, setRefusedHash] = useState<string | null>(null);
  // A ref is the synchronous guard: a second activation can fire before the disabling re-render.
  const openingRef = useRef(false);
  // The primary footer button takes focus (G-08-6): Tab does not reach buttons in WKWebView, and
  // Radix's own grab would land on Cancel by DOM order. Focused once each time it (re)appears, so a
  // later render cannot pull focus back from wherever the reader has since moved it.
  const primaryRef = useRef<HTMLButtonElement>(null);
  const focusedKeyRef = useRef<string | null>(null);

  const draft = preview.data?.draft ?? null;
  const blocker = preview.data?.blocker ?? null;
  const done = outcome !== null || failure !== null;
  // Which button is primary right now: Close once there is a result or a blocker, Open request while
  // a draft is ready, none while the request is in flight.
  const primaryKey = done || blocker ? "close" : opening ? null : draft ? "confirm" : null;
  // Declared above the early return below so the hook count never changes with the blocker.
  useEffect(() => {
    if (!primaryKey) {
      focusedKeyRef.current = null;
      return;
    }
    if (focusedKeyRef.current !== primaryKey && primaryRef.current) {
      focusedKeyRef.current = primaryKey;
      primaryRef.current.focus();
    }
  }, [primaryKey]);

  // This project has no forge: no sheet, no action, no empty state.
  if (blocker === "noForgeConfigured") return null;

  function handleCancel() {
    if (!openingRef.current) onClose();
  }

  function handleConfirm() {
    if (openingRef.current || !draft || blocker) return;
    openingRef.current = true;
    setOpening(true);
    const sentHash = draft.contentHash;
    adapter
      .forgeOpenEpicRequest(epicId, sentHash)
      .then(setOutcome)
      .catch((err: unknown) => {
        const parsed = parseFailure(err);
        // The board moved after the user read the preview and nothing was pushed: show the current
        // text rather than a failure, so the next action is reading it.
        if (parsed.code === DRAFT_CHANGED) {
          setRefusedHash(sentHash);
          void preview.refetch();
        } else {
          setFailure(parsed);
        }
      })
      .finally(() => {
        openingRef.current = false;
        setOpening(false);
      });
  }

  const draftMoved = refusedHash !== null && draft !== null && draft.contentHash !== refusedHash;
  const blockedText = blocker ? blockerSentence(blocker) : null;

  return createPortal(
    <FocusScope trapped loop asChild onMountAutoFocus={(event) => event.preventDefault()}>
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          handleCancel();
        }}
        onPointerDownOutside={handleCancel}
        asChild
      >
        <div role="presentation" className="review-sheet-scrim">
          <div role="dialog" aria-label="Epic request sheet" className="review-sheet" style={{ width: 640 }}>
            <header style={{ padding: "var(--space-md)", borderBottom: "1px solid var(--divider)", flexShrink: 0 }}>
              <span className="type-heading" style={{ fontFamily: MONO_STACK, overflowWrap: "anywhere" }}>
                {done
                  ? "Request result"
                  : draft
                    ? `Open request ${draft.headBranch} → ${draft.targetBranch}`
                    : "Open request"}
              </span>
            </header>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "var(--space-md)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-sm)",
              }}
            >
              {preview.isError && (
                <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                  Could not prepare this request. Close this sheet and try again.
                </p>
              )}
              {blockedText && !done && (
                <p className="type-body" style={{ margin: 0 }}>
                  {blockedText}
                </p>
              )}
              {outcome && <OutcomeBody outcome={outcome} />}
              {failure && (
                <p role="alert" className="type-body" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                  {failureText(failure)}
                </p>
              )}
              {!done && !blocker && draft && (
                <>
                  {draftMoved && (
                    <p className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
                      The board changed while this sheet was open. The text below is the current text.
                    </p>
                  )}
                  <p className="type-body" style={{ margin: 0, fontWeight: 600 }}>
                    {draft.title}
                  </p>
                  <pre
                    className="type-body"
                    style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit" }}
                  >
                    {draft.body}
                  </pre>
                  <p className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
                    This pushes the integration branch to origin, then opens the request with exactly this text.
                  </p>
                </>
              )}
            </div>

            <div
              style={{
                flexShrink: 0,
                borderTop: "1px solid var(--divider)",
                padding: "var(--space-md)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-sm)",
              }}
            >
              {done || blocker ? (
                <button
                  ref={primaryRef}
                  type="button"
                  onClick={onClose}
                  className="type-body"
                  style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
                >
                  Close
                </button>
              ) : opening ? (
                <span role="status" className="type-body" style={{ color: "var(--text-muted-rack)" }}>
                  Opening…
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="type-body"
                    style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    ref={primaryRef}
                    type="button"
                    onClick={handleConfirm}
                    disabled={!draft}
                    className="type-body control-edge review-action"
                  >
                    Open request
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}
