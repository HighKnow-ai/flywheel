import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The whole text of something cut short, in a Tooltip, and only while it is cut short (F58 in the M4 critique:
 * the `title=` attribute replaced by the one Tooltip). Wrap the element that truncates or clamps:
 *
 *   <TruncateTip text={project.name}>
 *     <span className="truncate">{project.name}</span>
 *   </TruncateTip>
 *
 * Whether it is cut is measured when the Tooltip would open, so a name that fits shows no tooltip and hovering
 * never repeats what is already on screen. `mono` sets the tooltip in the code face, for a path or a command.
 */
export function TruncateTip({
  text,
  mono = false,
  children,
}: {
  text: ReactNode;
  mono?: boolean;
  children: ReactElement;
}) {
  const trigger = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  function cut() {
    const el = trigger.current;
    return !!el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  }
  if (text === null || text === undefined || text === "") return children;
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && cut())}>
      <TooltipTrigger
        asChild
        ref={(element) => {
          trigger.current = element;
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className={cn("max-w-md break-words whitespace-pre-wrap", mono && "font-mono break-all")}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
