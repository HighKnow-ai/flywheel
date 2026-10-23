/**
 * A duplicate's flag (issue #165): what the Proposal repeats, who filed that one, and that accepting it closes
 * this one. The triage drawer's cards and the judged-on cards in Needs you (issue #169) draw the same flag, under
 * what the card names.
 */
import { Copy } from "lucide-react";
import type { DuplicateOfDto } from "../adapters/tauri";

export function DuplicateFlag({ duplicate }: { duplicate: DuplicateOfDto }) {
  return (
    <p data-duplicate-of={duplicate.proposalId} className="m-0 flex min-w-0 items-start gap-1.5 rounded-md bg-secondary px-3 py-2 text-small text-muted-foreground">
      <Copy aria-hidden="true" size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">
        <span className="font-semibold text-foreground">Duplicate of “{duplicate.title}”</span>
        {duplicate.storyKey && (
          <>
            , filed by <span className="font-mono text-meta">{duplicate.storyKey}</span>
          </>
        )}
        . Accepting that one closes this one.
      </span>
    </p>
  );
}
