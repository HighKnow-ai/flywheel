/**
 * The blocking launch-time orphan recovery modal (PROC-04, D-46, 03-UI-SPEC.md "Orphan recovery
 * modal") — the surface that stands between a crashed session's still-spending process and the
 * board. Reuses `board/DeleteConfirm.tsx`'s exact Radix overlay shape (`createPortal`,
 * `<FocusScope trapped loop>`, `role="alertdialog"`, centered scrim, `--surface-secondary` panel,
 * `--radius-chrome`) at a wider fixed width (560px, mirroring the launch sheet's own precedent of
 * widening the same base pattern for denser content) — with ONE deliberate divergence: this
 * component does NOT compose the dismissable-layer primitive at all. D-46: "the modal is not dismissible while
 * any row is unresolved" — Escape-to-dismiss and click-outside-to-dismiss are properties of that
 * component, so the cleanest way to guarantee this overlay has neither is to never mount it, not
 * to mount it with no-op handlers. `session/PermissionRequestCard.tsx` already establishes the
 * exact same precedent for the exact same reason: a surface whose dismissal would hide an
 * unresolved state does not get a dismiss path.
 *
 * The row set is local component state, seeded ONCE from `usePendingOrphans()` — after that it is
 * owned entirely by this component. A kill invalidates the `["pending-orphans"]` query so the
 * backend list and any other reader stay in agreement, but this component never re-seeds its own
 * rows from a later read: a re-seed would resurrect a row the user already resolved.
 *
 * Per-row state mirrors `PermissionRequestCard.tsx`'s `RowState` shape, with the one divergence
 * the UI-SPEC calls out explicitly: a permission card's failed answer clears back to answerable,
 * but a failed kill row stays mounted with PERMANENT failure copy — there is no retry affordance,
 * because a process Flywheel could not kill needs a human at a terminal, not a second press of the
 * same button (03-UI-SPEC.md "in-flight and failure, per row").
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { useQueryClient } from "@tanstack/react-query";
import { Loader, OctagonX } from "lucide-react";
import { orphanKill, type PendingOrphanDto } from "../adapters/tauri";
import { pendingOrphansQueryKey, usePendingOrphans } from "../board/useBoardQuery";
import { MARKS_BY_ID } from "../legend/marks";
import "../styles/states-and-confirms.css";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A relative "Xm/Xh/Xd ago" label, the absolute timestamp carried in the row's own `title`
 * attribute — mirrors `item-detail/RunsSection.tsx`'s own `relativeTime`, duplicated locally per
 * this codebase's own established per-file convention for this small building block. */
function relativeTime(iso: string): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (deltaSeconds < 60) return "just now";
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** One row's own kill state (`PermissionRequestCard.tsx`'s `RowState` pattern) — `failed` is
 * PERMANENT once set (never cleared back to answerable), which is this modal's one deliberate
 * divergence from that pattern. */
interface OrphanRowState {
  orphan: PendingOrphanDto;
  killing: boolean;
  failed: boolean;
  detail: string | null;
}

function seedRows(orphans: PendingOrphanDto[]): OrphanRowState[] {
  return orphans.map((orphan) => ({ orphan, killing: false, failed: false, detail: null }));
}

export function OrphanRecoveryModal() {
  const query = usePendingOrphans();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<OrphanRowState[] | null>(null);
  // Initial focus is the heading, never a Kill: this modal blocks the board and cannot be dismissed, so a button
  // that kills a running agent must not be the thing one errant Enter lands on (`board/DeleteConfirm.tsx` focuses
  // Cancel for the same reason; this dialog has no safe button, so the title takes it).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The run ids currently in flight for a kill. A row's `killing` flag alone is not a sufficient
  // guard against two activations in one synchronous tick — React has not necessarily flushed the
  // re-render that replaces the Kill button with the "Killing…" label before a second `.click()`
  // fires — and a ref reads and writes synchronously with no such window (mirrors
  // `item-detail/RunsSection.tsx`'s `ackActingRef` / `session/PermissionRequestCard.tsx`'s
  // `answeringRef`). Row state stays the source of truth for what renders; this ref only guards
  // dispatch. A SET rather than a single boolean because this modal kills several runs
  // concurrently by design — Kill All dispatches one call per row, and a single boolean would let
  // the first dispatch suppress every sibling.
  const killingRef = useRef<Set<string>>(new Set());

  // Seed exactly once, from the first list this component ever observes — never re-seed from a
  // later read (a re-seed would resurrect a row the user already resolved via a kill).
  useEffect(() => {
    if (rows === null && query.data) {
      setRows(seedRows(query.data));
    }
  }, [query.data, rows]);

  async function killOne(runId: string) {
    try {
      const outcome = await orphanKill(runId);
      queryClient.invalidateQueries({ queryKey: pendingOrphansQueryKey() });
      if (outcome.killed) {
        // The row is removed here — it can never be re-activated, so the guard entry is left in
        // place deliberately (deleting would reopen the exact window this guard closes, for the
        // brief span between the resolved promise and the row's removal from `rows`).
        setRows((prev) => (prev ?? []).filter((row) => row.orphan.runId !== runId));
      } else {
        // The call is over and the row did not disappear (permanent failure) — release the guard
        // entry, mirroring `RunsSection.tsx`'s `acknowledge()` catch-path reset. There is no retry
        // affordance for a failed row, but the guard must not outlive the call it protected.
        killingRef.current.delete(runId);
        setRows((prev) =>
          (prev ?? []).map((row) =>
            row.orphan.runId === runId
              ? { ...row, killing: false, failed: true, detail: outcome.detail }
              : row,
          ),
        );
      }
    } catch {
      killingRef.current.delete(runId);
      setRows((prev) =>
        (prev ?? []).map((row) =>
          row.orphan.runId === runId ? { ...row, killing: false, failed: true, detail: null } : row,
        ),
      );
    }
  }

  function handleKill(runId: string) {
    // A second activation while the ref already holds this run id invokes nothing — the
    // synchronous-tick guard.
    if (killingRef.current.has(runId)) return;
    killingRef.current.add(runId);
    setRows((prev) => (prev ?? []).map((row) => (row.orphan.runId === runId ? { ...row, killing: true } : row)));
    void killOne(runId);
  }

  function handleKillAll() {
    const targets = (rows ?? []).filter((row) => !row.killing && !row.failed && !killingRef.current.has(row.orphan.runId));
    for (const target of targets) {
      killingRef.current.add(target.orphan.runId);
    }
    setRows((prev) =>
      (prev ?? []).map((row) => (targets.some((t) => t.orphan.runId === row.orphan.runId) ? { ...row, killing: true } : row)),
    );
    for (const target of targets) {
      void killOne(target.orphan.runId);
    }
  }

  if (!rows || rows.length === 0) return null;

  const count = rows.length;
  const heading = `Flywheel found ${count} agent process${count === 1 ? "" : "es"} still running from a previous session.`;
  const runningMark = MARKS_BY_ID["run-running"];
  const pulsing = !prefersReducedMotion();
  const anyUnresolved = rows.some((row) => !row.failed);

  return createPortal(
    <FocusScope
      trapped
      loop
      asChild
      onMountAutoFocus={(event) => {
        event.preventDefault();
        headingRef.current?.focus();
      }}
    >
      {/*
        D-46, T-03-10-01: no dismissable-layer primitive here, deliberately (see file doc comment above) —
        this overlay has no Escape binding, no click-outside dismissal and no close button. It
        closes itself the instant its own row list becomes empty (the `!rows || rows.length === 0`
        early return above), and never before — even when every remaining row is a permanently
        failed kill (`anyUnresolved` stays true, matching `PermissionRequestCard.tsx`'s own
        "cannot be dismissed without answering" precedent).
      */}
      <div role="alertdialog" aria-label={heading} className="confirm-scrim">
        <div className="confirm-dialog confirm-dialog-wide">
          <h2 ref={headingRef} tabIndex={-1} className="type-heading confirm-heading">
            {heading}
          </h2>

          <div
            role="list"
            aria-label="Orphaned agent processes"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-md)",
              maxHeight: 400,
              overflowY: "auto",
              minWidth: 0,
            }}
          >
            {rows.map((row, index) => {
              const { orphan } = row;
              const hasTask = isNonEmptyString(orphan.taskKey) || isNonEmptyString(orphan.taskTitle);
              const hasEpic = isNonEmptyString(orphan.epicKey) || isNonEmptyString(orphan.epicTitle);
              // A run with no session id has nothing to say here: the bare word "Run" dangled with no
              // separator and no id after it, so the line is not printed at all.
              const identityLine = orphan.externalSessionId ? `Run · session ${orphan.externalSessionId}` : null;
              const absolute = new Date(orphan.startedAt).toLocaleString();

              return (
                <div
                  key={orphan.runId}
                  role="listitem"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-xs)",
                    minWidth: 0,
                    // A hairline between runs, so each reads as its own: the list is the whole point of the dialog.
                    borderBottom: index < rows.length - 1 ? "1px solid var(--divider)" : undefined,
                    paddingBottom: index < rows.length - 1 ? "var(--space-md)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
                    <span
                      aria-hidden="true"
                      className={pulsing ? "agent-pulse" : undefined}
                      style={{ color: "var(--accent-text-rack)", flexShrink: 0, display: "inline-flex" }}
                    >
                      <Loader size={16} strokeWidth={2} aria-label={runningMark?.label} />
                    </span>
                    <span className="type-label" style={{ color: "var(--text-primary-rack)" }}>
                      Running (from a previous session)
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
                    {hasTask ? (
                      <>
                        <span
                          className="type-body"
                          style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', flexShrink: 0 }}
                        >
                          {orphan.taskKey}
                        </span>
                        <span className="type-body" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {orphan.taskTitle}
                        </span>
                      </>
                    ) : hasEpic ? (
                      <>
                        <span
                          className="type-body"
                          style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', flexShrink: 0 }}
                        >
                          {orphan.epicKey}
                        </span>
                        <span className="type-body" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {orphan.epicTitle ?? "Shaping an epic"}
                        </span>
                      </>
                    ) : orphan.taskId === null ? (
                      // An authoring run always carries `taskId: null` (D-84, never both never
                      // neither) — this case is a fresh-epic session, where no `epics` row exists
                      // yet for `epicKey`/`epicTitle` to resolve against. Not the generic
                      // "unresolvable" fallback below, which is reserved for a genuine task run
                      // whose task row is somehow missing.
                      <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
                        Shaping a new epic
                      </span>
                    ) : (
                      <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
                        an unresolvable task
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
                      {identityLine && (
                        <span
                          className="type-label"
                          style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', color: "var(--text-muted-rack)" }}
                        >
                          {identityLine}
                        </span>
                      )}
                      <time
                        className="type-label"
                        dateTime={orphan.startedAt}
                        title={absolute}
                        style={{ color: "var(--text-muted-rack)" }}
                      >
                        Started {relativeTime(orphan.startedAt)}
                      </time>
                    </div>

                    {row.failed ? (
                      <span role="alert" className="type-label" style={{ color: "var(--destructive-text-rack)" }}>
                        Couldn&apos;t kill this process (PID {orphan.pid}). It&apos;s still running. Kill it from
                        a terminal, then reopen Flywheel.
                      </span>
                    ) : row.killing ? (
                      <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
                        Killing…
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleKill(orphan.runId)}
                        className="type-body control-edge confirm-action"
                      >
                        Kill
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              disabled={!anyUnresolved}
              onClick={handleKillAll}
              className="type-body control-edge confirm-action confirm-action-destructive"
            >
              <OctagonX size={14} strokeWidth={2} aria-hidden="true" />
              Kill All
            </button>
          </div>

          <p className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            Every process above is spending tokens right now — Flywheel didn&apos;t start any of
            them this time.
          </p>
        </div>
      </div>
    </FocusScope>,
    document.body,
  );
}
