/**
 * The blocking launch-time orphan recovery dialog (PROC-04, D-46, 03-UI-SPEC.md "Orphan recovery modal") —
 * the surface that stands between a crashed session's still-spending process and the board.
 *
 * Issue #210 (critique F5): an AlertDialog, so it arrives and leaves with the shared overlay motion, with one
 * Item row per agent (its running mark, its Story's key and title, when it started), `destructive` Stop
 * buttons, and two answers in the footer: Leave running and Stop n agents. No raw run or session id is shown:
 * the Story names the agent.
 *
 * D-46: the dialog cannot be dismissed WITHOUT ANSWERING. Escape and a click outside are refused, there is no
 * close button, and focus is trapped. It closes itself when its rows run out, which happens two ways: every
 * agent stopped, or the one explicit Leave running press (A-08(b): "keep these" is an answer, not an escape
 * route). Leave running dismisses the rows for this launch only; the launch classification re-runs on the next
 * launch, so a still-running orphan is offered again then.
 *
 * The dialog is itself the confirmation: its title asks the question and its description names the cost, so a
 * row's Stop and the footer's Stop n agents each act on one press. Initial focus is the title, never a Stop,
 * so one errant Enter stops nothing.
 *
 * The row set is local component state, seeded ONCE from `usePendingOrphans()` — after that it is owned
 * entirely by this component. A stop invalidates the `["pending-orphans"]` query so the backend list and any
 * other reader stay in agreement, but this component never re-seeds its own rows from a later read: a re-seed
 * would resurrect a row the user already resolved.
 *
 * A failed stop leaves its row mounted with PERMANENT failure copy and no retry: a process Flywheel could not
 * kill needs a human at a terminal, not a second press of the same button (03-UI-SPEC.md "in-flight and
 * failure, per row").
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OctagonX } from "lucide-react";
import { orphanKill, type PendingOrphanDto } from "../adapters/tauri";
import { pendingOrphansQueryKey, usePendingOrphans } from "../board/useBoardQuery";
import { RelativeTime } from "@/components/RelativeTime";
import { StateBadge } from "@/components/StateBadge";
import { StoryKey } from "@/components/StoryKey";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One row's own stop state — `failed` is PERMANENT once set (never cleared back to answerable). */
interface OrphanRowState {
  orphan: PendingOrphanDto;
  stopping: boolean;
  failed: boolean;
  detail: string | null;
}

function seedRows(orphans: PendingOrphanDto[]): OrphanRowState[] {
  return orphans.map((orphan) => ({ orphan, stopping: false, failed: false, detail: null }));
}

function agents(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}

export function OrphanRecoveryModal() {
  const query = usePendingOrphans();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<OrphanRowState[] | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // The run ids currently in flight for a stop. A row's `stopping` flag alone is not a sufficient guard
  // against two activations in one synchronous tick — React has not necessarily flushed the re-render before a
  // second `.click()` fires — and a ref reads and writes synchronously with no such window. A SET, because this
  // dialog stops several runs concurrently by design.
  const stoppingRef = useRef<Set<string>>(new Set());
  // The rows last drawn, so the dialog keeps its words while it fades out after its last row resolves.
  const lastShown = useRef<OrphanRowState[]>([]);

  // Seed exactly once, from the first list this component ever observes — never re-seed from a later read.
  useEffect(() => {
    if (rows === null && query.data) {
      setRows(seedRows(query.data));
    }
  }, [query.data, rows]);

  async function stopOne(runId: string) {
    try {
      const outcome = await orphanKill(runId);
      queryClient.invalidateQueries({ queryKey: pendingOrphansQueryKey() });
      if (outcome.killed) {
        // The row is removed — it can never be re-activated, so the guard entry is left in place deliberately.
        setRows((prev) => (prev ?? []).filter((row) => row.orphan.runId !== runId));
      } else {
        // The call is over and the row did not disappear (permanent failure): release the guard entry.
        stoppingRef.current.delete(runId);
        setRows((prev) =>
          (prev ?? []).map((row) =>
            row.orphan.runId === runId ? { ...row, stopping: false, failed: true, detail: outcome.detail } : row,
          ),
        );
      }
    } catch {
      stoppingRef.current.delete(runId);
      setRows((prev) =>
        (prev ?? []).map((row) =>
          row.orphan.runId === runId ? { ...row, stopping: false, failed: true, detail: null } : row,
        ),
      );
    }
  }

  function handleStop(runId: string) {
    // A second activation while the ref already holds this run id invokes nothing — the synchronous-tick guard.
    if (stoppingRef.current.has(runId)) return;
    stoppingRef.current.add(runId);
    setRows((prev) => (prev ?? []).map((row) => (row.orphan.runId === runId ? { ...row, stopping: true } : row)));
    void stopOne(runId);
  }

  // A-08(b): the non-destructive answer. Emptying the rows closes the dialog, and `rows` is never re-seeded, so
  // it stays gone for this launch. Stops already in flight finish in the background.
  function handleLeave() {
    setRows([]);
  }

  function handleStopAll() {
    const targets = (rows ?? []).filter(
      (row) => !row.stopping && !row.failed && !stoppingRef.current.has(row.orphan.runId),
    );
    for (const target of targets) stoppingRef.current.add(target.orphan.runId);
    setRows((prev) =>
      (prev ?? []).map((row) =>
        targets.some((t) => t.orphan.runId === row.orphan.runId) ? { ...row, stopping: true } : row,
      ),
    );
    for (const target of targets) void stopOne(target.orphan.runId);
  }

  const open = Boolean(rows && rows.length > 0);
  if (open) lastShown.current = rows as OrphanRowState[];
  const shown = open ? (rows as OrphanRowState[]) : lastShown.current;
  // Never seen a row: nothing to draw and nothing to fade out.
  if (shown.length === 0) return null;

  const count = shown.length;
  const pulsing = !prefersReducedMotion();
  const stoppable = shown.filter((row) => !row.failed);
  const anyStopping = shown.some((row) => row.stopping);
  const idle = stoppable.filter((row) => !row.stopping);
  const title = `${agents(count)} still running from a previous session`;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className="gap-5 sm:max-w-xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle ref={titleRef} tabIndex={-1} className="text-section font-semibold outline-none">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-body">
            {count === 1 ? "It is" : "Each is"} spending tokens now, and Flywheel didn&rsquo;t start{" "}
            {count === 1 ? "it" : "them"} this time. Stop {count === 1 ? "it" : "them"}, or leave{" "}
            {count === 1 ? "it" : "them"} running until you next open Flywheel.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ItemGroup aria-label="Agents still running" className="max-h-[min(400px,50vh)] gap-2 overflow-y-auto">
          {shown.map((row) => {
            const { orphan } = row;
            const hasStory = isNonEmptyString(orphan.storyKey) || isNonEmptyString(orphan.storyTitle);
            const who = isNonEmptyString(orphan.storyKey) ? `${orphan.storyKey}’s agent` : "this agent";
            return (
              <Item key={orphan.runId} role="listitem" variant="outline" size="sm" className="flex-nowrap">
                <ItemMedia>
                  <StateBadge state="running" variant="inline" hideLabel pulse={pulsing} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="flex w-full min-w-0 items-baseline gap-2 text-body font-semibold">
                    {hasStory ? (
                      <>
                        {isNonEmptyString(orphan.storyKey) && <StoryKey value={orphan.storyKey} size="small" />}
                        <span className="min-w-0 line-clamp-2">{orphan.storyTitle}</span>
                      </>
                    ) : (
                      <span className="font-normal text-muted-foreground">An unresolvable Story</span>
                    )}
                  </ItemTitle>
                  {row.failed ? (
                    <p role="alert" className="m-0 text-small text-destructive-text">
                      Couldn&rsquo;t stop it (PID {orphan.pid}). It&rsquo;s still running: stop it from a terminal,
                      then reopen Flywheel.
                    </p>
                  ) : (
                    <ItemDescription className="text-small">
                      Started <RelativeTime at={orphan.startedAt} />
                    </ItemDescription>
                  )}
                </ItemContent>
                {!row.failed && (
                  <ItemActions>
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={row.stopping}
                      aria-label={`Stop ${who}`}
                      onClick={() => handleStop(orphan.runId)}
                    >
                      Stop
                    </Button>
                  </ItemActions>
                )}
              </Item>
            );
          })}
        </ItemGroup>

        <AlertDialogFooter>
          <Button variant="outline" onClick={handleLeave}>
            Leave running
          </Button>
          <Button
            variant="destructive"
            disabled={idle.length === 0 && !anyStopping}
            loading={anyStopping && idle.length === 0}
            onClick={handleStopAll}
          >
            <OctagonX aria-hidden="true" />
            {stoppable.length > 0 ? `Stop ${agents(stoppable.length)}` : "Stop agents"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
