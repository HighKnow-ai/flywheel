import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MISSING, formatAbsoluteTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A time as it reads at a glance ("3m ago") with the absolute time in a Tooltip and on `<time dateTime>`
 * (DESIGN.md § Components). `now` is the caller's clock, so a list of rows ticks together; it defaults to the
 * moment of render. An unreadable time is the dash, with no tooltip.
 */
export function RelativeTime({
  at,
  now,
  className,
}: {
  at: string | number | Date | null | undefined;
  now?: number;
  className?: string;
}) {
  const relative = formatRelativeTime(at, now);
  if (relative === MISSING) return <span className={className}>{MISSING}</span>;
  const date = new Date(typeof at === "string" ? Date.parse(at) : (at as number | Date));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={date.toISOString()} className={cn("whitespace-nowrap tabular-nums", className)}>
          {relative}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatAbsoluteTime(at)}</TooltipContent>
    </Tooltip>
  );
}
