/**
 * The git-truth section (Phase 7 plan 07-01, LINK-02/LINK-09) — branch, ahead/behind against the
 * integration target (with the age of the fetch it was measured against, D-116), the commit
 * window, and uncommitted changes. Reads through `useGitFacts` (`board/useBoardQuery.ts`),
 * refreshed by the scheduler's own tick (D-113/D-114) through the same `board:changed`
 * subscription every other live section in this panel already uses — no polling interval, no
 * second push channel.
 *
 * Follows `WorktreeSummary.tsx`'s stated discipline, not `ActivityTrail.tsx`'s: this section
 * renders NOTHING at all — no labelled header, no placeholder — while the read is in flight or
 * when the task has no worktree (`git_facts` resolves to `null`). `ActivityTrail.tsx`'s own
 * "always render a header, even when empty" rule does not apply here.
 *
 * The ahead/behind figure and its fetch age are rendered from ONE expression (`aheadBehindLine`
 * below) so neither can ever appear without the other (D-116's own prohibition: a number measured
 * against a stale remote ref must never read as current with no age attached). When the
 * comparison target does not resolve locally, the figure is withheld entirely — a sentence naming
 * the target, never a fabricated `0/0`.
 *
 * `useEffect` below calls `gitTruthFocusTask` on mount and with `null` on unmount — D-114's "open
 * detail panel" half of the hot tier. This runs unconditionally (ahead of the loading/no-data
 * early return), because focus is about which panel is open, not about whether its data has
 * resolved yet.
 */
import { useEffect } from "react";
import { useGitFacts } from "../board/useBoardQuery";
import { gitTruthFocusTask, type CommitRowDto } from "../adapters/tauri";
import { porcelainStatusWord } from "./WorktreeRemovalDialog";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** A short, human relative-age clause for a commit's `committedAt` timestamp — never a bare ISO
 * string in the row. */
function formatRelativeTime(isoTimestamp: string): string {
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return isoTimestamp;
  const diffMs = Date.now() - then;
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** The fetch-age clause D-116 requires alongside every rendered ahead/behind figure —
 * `null`/unparseable renders as "never fetched", never a blank or a stale-looking number. */
function formatFetchAge(lastFetchAt: string | null): string {
  if (!lastFetchAt) return "never fetched";
  const fetchedAt = new Date(lastFetchAt).getTime();
  if (Number.isNaN(fetchedAt)) return "never fetched";
  const minutes = Math.max(0, Math.round((Date.now() - fetchedAt) / 60000));
  return `as of ${minutes}m ago`;
}

function CommitRow({ commit }: { commit: CommitRowDto }) {
  return (
    <li style={{ display: "flex", gap: "var(--space-sm)", minWidth: 0, alignItems: "baseline" }}>
      <span className="type-label" style={{ fontFamily: MONO_STACK, flexShrink: 0 }}>
        {commit.shortSha}
      </span>
      <span
        className="type-body"
        style={{ overflowWrap: "anywhere", minWidth: 0, flex: 1, color: "var(--text-primary-rack)" }}
      >
        {commit.subject}
      </span>
      <span className="type-label" style={{ flexShrink: 0, color: "var(--text-muted-rack)" }}>
        {formatRelativeTime(commit.committedAt)}
      </span>
    </li>
  );
}

export interface GitFactsSectionProps {
  taskId: string;
}

export function GitFactsSection({ taskId }: GitFactsSectionProps) {
  const query = useGitFacts(taskId);

  useEffect(() => {
    // Best-effort (mirrors `WorktreeSummary.tsx`'s `copyToClipboard` precedent): a failure to
    // register focus is display-freshness furniture, not a critical path, and must never surface
    // as an unhandled rejection or crash the panel.
    Promise.resolve(gitTruthFocusTask(taskId)).catch(() => {});
    return () => {
      Promise.resolve(gitTruthFocusTask(null)).catch(() => {});
    };
  }, [taskId]);

  // E6 `loading`/`empty`, following WorktreeSummary.tsx's discipline: nothing renders while the
  // read is in flight, and nothing renders for a task with no worktree — never a labelled header,
  // never a placeholder.
  if (query.isPending || !query.data) return null;

  const facts = query.data;
  const hasComparison = facts.ahead !== null && facts.behind !== null;
  const aheadBehindLine = hasComparison
    ? `${facts.ahead === 0 && facts.behind === 0 ? "Up to date" : `${facts.ahead} ahead, ${facts.behind} behind`} (${formatFetchAge(facts.lastFetchAt)})`
    : null;

  return (
    <section
      aria-label="Git truth"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0 }}
    >
      <span
        className="type-body"
        style={{ fontFamily: MONO_STACK, color: "var(--text-primary-rack)" }}
      >
        {facts.branch}
      </span>

      {hasComparison ? (
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          {aheadBehindLine}
        </p>
      ) : (
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          Comparison target <span style={{ fontFamily: MONO_STACK }}>{facts.targetRef}</span> is
          not reachable locally — fetch to measure
        </p>
      )}

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
        }}
      >
        {facts.commits.map((commit) => (
          <CommitRow key={commit.sha} commit={commit} />
        ))}
      </ul>
      {facts.commitsTruncated > 0 && (
        <p className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          +{facts.commitsTruncated} earlier commits
        </p>
      )}

      {facts.uncommitted.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          {facts.uncommitted.map((entry, index) => (
            <li key={index} style={{ display: "flex", gap: "var(--space-sm)", minWidth: 0 }}>
              <span className="type-label" style={{ flexShrink: 0 }}>
                {porcelainStatusWord(entry.code)}
              </span>
              <span
                className="type-body"
                style={{ fontFamily: MONO_STACK, overflowWrap: "anywhere", minWidth: 0 }}
              >
                {entry.path}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
