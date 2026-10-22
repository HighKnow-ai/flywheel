import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, told about Flywheel's type scale (styles/globals.css `--text-*`). Without it `text-body`
 * reads as a text COLOUR and a merge silently drops the real colour next to it (`text-primary-foreground`).
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["meta", "small", "body", "row", "section", "title", "milestone", "count", "lead"],
    },
  },
});

/** Merge class names, letting a later Tailwind utility override an earlier one (shadcn/ui, ADR 0004). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
