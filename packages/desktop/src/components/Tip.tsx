import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@highknow/design";

/**
 * A short explanation or an exact value in the one Tooltip, in place of a `title=` attribute (F58 in the M4
 * critique): the absolute time behind an age, what an estimate means, why a control is off. The child is the
 * trigger, so it keeps its own element and classes. With no `content` it renders the child alone.
 */
export function Tip({ content, children }: { content: ReactNode; children: ReactElement }) {
  if (content === null || content === undefined || content === "" || content === false) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-sm">{content}</TooltipContent>
    </Tooltip>
  );
}
