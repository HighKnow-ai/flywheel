/**
 * The Settings surface's Permission rules table (D-38, E7): every allow-always rule the user has granted, across
 * every registered project, listed with its project, tool, pattern and granted date, and a Revoke action per
 * row. This is the only place a granted rule can be inspected and withdrawn (T-02-04: a stale rule surviving a
 * repurposed project).
 *
 * `listPermissionRules` is per-project, so this table fans out one call per registered project and merges the
 * results, tagging each row with its own project's name, so a rule can never be read as global (T-02-45): the
 * project column is on every row, not an implicit grouping the reader has to infer.
 *
 * Revoke calls `revokePermissionRule` and then re-reads: it never optimistically drops the row before the write
 * lands, because the row represents granted authority and the list must reflect what is actually stored.
 *
 * Layout (#209): a fixed-layout Table, so a long pattern truncates inside its own column (the full text in a
 * Tooltip) instead of drawing over the Granted date beside it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/Button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  useLoadingPhase,
} from "@highknow/design";
import { ReadError } from "@/components/ReadError";
import { RelativeTime } from "@/components/RelativeTime";
import { notify } from "@/lib/notify";
import { listPermissionRules, revokePermissionRule, type PermissionRuleDto } from "../adapters/tauri";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import type { Project } from "../board/useBoardQuery";

/** Tells the user where rules come from rather than just reporting their absence. */
export const EMPTY_TITLE = "No rules yet";
export const EMPTY_DESCRIPTION =
  "They're created from a permission request's “Always allow this pattern in this project” action.";

interface RuleRow extends PermissionRuleDto {
  projectName: string;
}

function rulesQueryKey(projectIds: string[]) {
  return ["permission-rules", ...projectIds] as const;
}

/** Skeleton rows in the table's own shape while the fan-out read is in flight: never the empty state during a
 * load, which would tell the user something false about their own security posture (E7 loading). */
function RowsSkeleton() {
  return (
    <div aria-hidden="true" data-testid="permission-rules-skeleton" className="flex flex-col gap-3 py-1">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-4">
          <Skeleton className="h-3.5 w-[18%]" />
          <Skeleton className="h-3.5 w-[12%]" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-7 w-18" />
        </div>
      ))}
    </div>
  );
}

/** A cell's text on one line, cut with an ellipsis inside its column, the whole text in a Tooltip: a cell that
 * names granted authority never hides any of it. */
function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("block truncate", className)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-md break-all">{text}</TooltipContent>
    </Tooltip>
  );
}

export interface PermissionRulesTableProps {
  /** The full registered-project roster (`useProjects()`), fetched by the caller. */
  projects: Project[];
  /** Whether the caller's own roster read is still in flight: an empty `projects` reads the same while it loads
   * and once it resolves to zero projects, and those must render differently (skeleton vs. empty state). */
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

  // Revoking appends a project-scoped event, which reaches the board through the same `board:changed` push every
  // other surface subscribes to (D-04).
  useBoardChangedInvalidation({ kind: "account" }, projects.length > 0 ? [queryKey] : []);

  const revokeMutation = useMutation({
    mutationFn: (rule: RuleRow) => revokePermissionRule(rule.id),
    onSuccess: async (_data, rule) => {
      await queryClient.invalidateQueries({ queryKey });
      notify.success(`Revoked ${rule.tool} in ${rule.projectName}`, {
        description: "Its next request will ask you again.",
      });
    },
  });

  // Loading while the caller's roster is still resolving, or while this table's own fan-out read is in flight
  // for a non-empty roster. Never `rulesQuery.isPending` alone: it stays true for a zero-project roster, where
  // the query is disabled and never settles.
  const loading = loadingProjects || (rulesQuery.isPending && projects.length > 0);
  // The loading rule (DESIGN.md § Feedback): nothing for 150 ms, then the skeleton, held at least 400 ms.
  const loadingPhase = useLoadingPhase(loading);
  if (loadingPhase === "skeleton") return <RowsSkeleton />;
  if (loading) return null;
  if (rulesQuery.isError) return <ReadError title="Couldn't load the permission rules" query={rulesQuery} />;

  const rules: RuleRow[] = rulesQuery.data ?? [];
  if (rules.length === 0) {
    return (
      <Empty className="border border-border p-6">
        <EmptyHeader>
          <EmptyTitle>{EMPTY_TITLE}</EmptyTitle>
          <EmptyDescription>{EMPTY_DESCRIPTION}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Table aria-label="Permission rules" className="table-fixed text-body">
        <colgroup>
          <col className="w-[20%]" />
          <col className="w-[14%]" />
          <col />
          <col className="w-24" />
          <col className="w-24" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-0 text-small text-muted-foreground">Project</TableHead>
            <TableHead className="text-small text-muted-foreground">Tool</TableHead>
            <TableHead className="text-small text-muted-foreground">Pattern</TableHead>
            <TableHead className="text-small text-muted-foreground">Granted</TableHead>
            <TableHead className="pr-0">
              <span className="sr-only">Action</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => {
            const revoking = revokeMutation.isPending && revokeMutation.variables?.id === rule.id;
            return (
              <TableRow key={rule.id}>
                <TableCell className="pl-0">
                  <TruncatedText text={rule.projectName} />
                </TableCell>
                <TableCell>
                  <TruncatedText text={rule.tool} />
                </TableCell>
                <TableCell>
                  {rule.pattern === "*" ? (
                    <span className="text-muted-foreground">every input</span>
                  ) : (
                    <TruncatedText text={rule.pattern} className="font-mono text-small text-muted-foreground" />
                  )}
                </TableCell>
                <TableCell className="text-small text-muted-foreground">
                  <RelativeTime at={rule.createdAt} />
                </TableCell>
                <TableCell className="pr-0 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={revoking}
                    // One revoke at a time per rule: a second click while the write is in flight would fire it twice.
                    onClick={() => revokeMutation.mutate(rule)}
                  >
                    <ShieldOff aria-hidden="true" />
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {revokeMutation.isError && (
        // The row is kept (it is still granted authority) and the failure is named in place.
        <p role="alert" className="m-0 text-small text-destructive-text">
          Couldn&rsquo;t revoke this rule: {(revokeMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
