import { createButton } from "@highknow/design";

/**
 * Every action (direction.md § Components, rule 2): the design system's Button with Flywheel's one tone added.
 *
 * One filled primary per region, brand blue. The only other filled colour is `attention`, and only on an item
 * that is Waiting on you (Answer, Allow once). `destructive` is a text button (Drop), set apart from the
 * primary, and always confirms in an AlertDialog. On a Gated action Deny leads as the filled `neutral` (ink
 * fill) and Allow once is outline. Buttons carry an icon and a word; `loading` puts the Spinner in the icon's
 * place and keeps the label and the width.
 *
 * `attention` is Flywheel's, not the package's: safety yellow means Waiting on you here and nothing else, and a
 * base that shipped it would ask every other HighKnow surface to keep that promise (ADR 0021, 2026-10-27).
 */
export const Button = createButton({
  attention: "bg-attention text-attention-foreground shadow-[0_1px_0_rgb(0_0_0/0.15)] hover:bg-attention/90",
});
