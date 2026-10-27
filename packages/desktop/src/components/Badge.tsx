import { createBadge } from "@highknow/design";

/**
 * Pills (direction.md § Components): the design system's Badge with Flywheel's one tone added. The four state
 * tones are the only colours a badge may wear for a state: `attention` is Waiting on you, `running` an agent at
 * work, `destructive` Stopped or failed, and `neutral` everything else, told apart by its icon and word. A state
 * picks its tone through components/StateBadge.tsx, never at the call site. `secondary`, `outline` and `ghost`
 * are for counts and kinds that are not states.
 *
 * `attention` is Flywheel's, added on top of the package's neutral set (ADR 0021, 2026-10-27).
 */
export const Badge = createBadge({
  attention: "bg-attention font-bold text-attention-foreground",
});
