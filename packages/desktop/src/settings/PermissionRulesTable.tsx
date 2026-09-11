/**
 * The Settings surface's Permission Rules table (D-38, 02-UI-SPEC.md "Permission rules", E7) —
 * every allow-always rule the user has granted, across every registered project, listed with its
 * project, tool name, decision and granted date, and a `Revoke` action per row. This is the only
 * place a granted rule can be inspected and withdrawn (02-RESEARCH.md's Security Domain: a stale
 * rule surviving a repurposed project, T-02-04).
 *
 * `listPermissionRules` (plan 02-05) is per-project — this table fans out one call per registered
 * project (`useProjects()`, `board/useBoardQuery.ts`) and merges the results, tagging each row
 * with its own project's name, so a rule can never be read as global (T-02-45): the project column
 * is on every row, not an implicit grouping the reader has to infer.
 *
 * Revoke calls `revokePermissionRule` and then re-reads (invalidating this table's own query) —
 * it never optimistically drops the row before the underlying write lands, because the row
 * represents granted authority and the list must reflect what is actually stored. The mutation
 * appends an event (plan 02-05's `permission_rule` domain module), so a revocation is as auditable
 * as the grant it undoes; this table relies on that happening elsewhere rather than writing to the
 * activity trail itself.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listPermissionRules, revokePermissionRule, subscribeBoardChanged, type PermissionRuleDto } from "../adapters/tauri";
import type { Project } from "../board/useBoardQuery";

/** The exact copy from 02-UI-SPEC.md's Copywriting Contract ("Settings — permission rules, empty
 * state") — tells the user where rules come from rather than just reporting their absence. */
const EMPTY_STATE_COPY =
  "No rules yet — they're created from a permission request's \"Allow this tool for this project from now on\" action.";

interface RuleRow extends PermissionRuleDto {
  projectName: string;
}

function rulesQueryKey(projectIds: string[]) {
  return ["permission-rules", ...projectIds] as const;
}

/** A row-shaped placeholder for the window between this table mounting and its fan-out read
 * resolving — never the empty-state copy during a load, which would tell the user something false
 * about their own security posture (E7 loading). Same minimal pattern
 * `settings/SettingsSurface.tsx`'s own `SectionSkeleton` uses. */
function RowsSkeleton() {
  const barStyle = { height: 12, borderRadius: "var(--radius-chrome)", background: "var(--divider)" };
  return (
    <div
      aria-hidden="true"
      data-testid="permission-rules-skeleton"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}
    >
      <div style={{ ...barStyle, width: "80%" }} />
      <div style={{ ...barStyle, width: "55%" }} />
    </div>
  );
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString();
}

export interface PermissionRulesTableProps {
  /** The full registered-project roster (`useProjects()`) — fetched by the caller
   * (`SettingsSurface.tsx`), not by this component, matching `AssigneePicker.tsx`'s own
   * "the roster is fetched by the caller" convention. */
  projects: Project[];
  /** Whether the CALLER's own project-roster read is still in flight — `projects` reads as an
   * empty array both while the roster is loading and once it genuinely resolves to zero projects,
   * and those two states must render differently here (skeleton vs. the real empty-state copy).
   * Defaults to `false` so a caller that has already resolved its roster (or has none to track)
   * is unaffected. */
  loadingProjects?: boolean;
}

export function PermissionRulesTable({ projects, loadingProjects = false }: PermissionRulesTableProps) {
  const queryClient = useQueryClient();
  const projectIds = projects.map((project) => project.id);
  const queryKey = rulesQueryKey(projectIds);

  const rulesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const perProject = await Promise.all(
        projects.map((project) =>
          listPermissionRules(project.id).then((rules): RuleRow[] =>
            rules.map((rule) => ({ ...rule, projectName: project.name })),
          ),
        ),
      );
      return perProject.flat();
    },
    enabled: projects.length > 0,
  });

  // Revoking a rule appends a project-scoped event (plan 02-05's `revoke_rule`), which reaches
  // the board through the same `board:changed` push every other surface already subscribes to
  // (D-04) — this table never trusts its own write as already resolved, matching every other hook
  // in `useBoardQuery.ts`.
  useEffect(() => {
    if (projects.length === 0) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, projectIds.join(",")]);

  const revokeMutation = useMutation({
    mutationFn: (ruleId: string) => revokePermissionRule(ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const rules: RuleRow[] = rulesQuery.data ?? [];
  // Loading while the CALLER's own roster is still resolving (an empty `projects` array is
  // ambiguous between "still loading" and "genuinely zero") OR while this table's own fan-out
  // read is in flight for a non-empty roster — never merely `rulesQuery.isPending` alone, which
  // stays permanently true for a roster that resolves to zero projects (the query is `enabled`
  // only when `projects.length > 0` and therefore never settles on its own in that case).
  const loading = loadingProjects || (rulesQuery.isPending && projects.length > 0);

  return (
    <div role="table" aria-label="Permission rules" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {loading ? (
        <RowsSkeleton />
      ) : rules.length === 0 ? (
        <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
          {EMPTY_STATE_COPY}
        </p>
      ) : (
        rules.map((rule) => (
          <div key={rule.id} role="row" style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
            <span
              className="type-body"
              style={{
                flexShrink: 0,
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {rule.projectName}
            </span>
            <span
              className="type-body"
              style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {rule.toolName}
            </span>
            <span className="type-label" style={{ color: "var(--text-muted-rack)", flexShrink: 0 }}>
              {rule.decision}
            </span>
            <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)", flexShrink: 0 }}>
              {formatDate(rule.createdAt)}
            </span>
            <button
              type="button"
              onClick={() => revokeMutation.mutate(rule.id)}
              className="type-label"
              style={{
                flexShrink: 0,
                background: "transparent",
                border: "1px solid var(--divider)",
                borderRadius: "var(--radius-chrome)",
                color: "var(--text-primary-rack)",
                padding: "var(--space-xs) var(--space-sm)",
                cursor: "pointer",
              }}
            >
              Revoke
            </button>
          </div>
        ))
      )}
    </div>
  );
}
