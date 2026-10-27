import { ReadError as DesignReadError } from "@highknow/design";

/** The part of a TanStack query a ReadError needs: its error, its refetch, and whether one is under way. */
export interface ReadErrorQuery {
  error: unknown;
  refetch: () => unknown;
  isFetching?: boolean;
}

/**
 * A read that failed (DESIGN.md § Feedback): the one error state for a query, in place of the content it
 * could not load. The design system's `ReadError` in Flywheel's words: a title naming what could not be read,
 * one human line, Try again (the query's own `refetch`, pending while it runs), and the raw message folded
 * away behind Details in the code face, for a bug report, because Flywheel's readers are developers. The query
 * has already retried once (adapters/queryClient.ts), so this shows about a second after a dead read, not seven.
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
  return (
    <DesignReadError
      title={title}
      description={description}
      error={query.error}
      onRetry={() => void query.refetch()}
      retryLabel="Try again"
      retrying={Boolean(query.isFetching)}
      rawMessage="disclosure"
      detailsLabel="Details"
      className={className}
    />
  );
}
