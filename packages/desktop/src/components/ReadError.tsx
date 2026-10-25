import { ChevronRight, OctagonX, RotateCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** The part of a TanStack query a ReadError needs: its error, its refetch, and whether one is under way. */
export interface ReadErrorQuery {
  error: unknown;
  refetch: () => unknown;
  isFetching?: boolean;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * A read that failed (DESIGN.md § Feedback): the one error state for a query, in place of the content it
 * could not load. A title naming what could not be read, one human line, Try again (the query's own
 * `refetch`, pending while it runs), and the raw message folded away in the code face for a bug report.
 * The query has already retried once (adapters/queryClient.ts), so this shows about a second after a dead
 * read, not seven.
 *
 *   if (storyQuery.isError) return <ReadError title="Couldn't load this Story" query={storyQuery} />;
 */
export function ReadError({
  title,
  description = "Flywheel couldn't read this from its local core. It may be restarting.",
  query,
  className,
}: {
  title: string;
  description?: string;
  query: ReadErrorQuery;
  className?: string;
}) {
  const message = rawMessage(query.error);
  return (
    <Alert variant="destructive" data-slot="read-error" className={cn("gap-y-1.5", className)}>
      <OctagonX aria-hidden="true" />
      <AlertTitle className="text-body font-semibold">{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2.5 text-small text-muted-foreground">
        <p className="m-0">{description}</p>
        <Button size="sm" variant="outline" loading={Boolean(query.isFetching)} onClick={() => void query.refetch()}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        {message && (
          <Collapsible className="w-full">
            <CollapsibleTrigger className="group/details inline-flex items-center gap-1 rounded-sm text-meta text-muted-foreground transition-colors hover:text-foreground">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[state=open]/details:rotate-90"
              />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="m-0 mt-1.5 max-h-40 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-meta whitespace-pre-wrap text-foreground">
                {message}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}
