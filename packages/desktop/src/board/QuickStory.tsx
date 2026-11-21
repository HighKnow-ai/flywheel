/**
 * Quick Story (docs/mvp-spec.md §4.7, docs/adr/0044): one text field that writes a Story with the default
 * criterion and starts it, for a one-off fix or a question. The work stays on the board: the Story has a
 * key, a worktree, a session and a review like any other. It is written in the project's "Quick Stories"
 * Epic, which the core makes on first use.
 *
 * The dialog closes when the session has started. A refusal shows inline and keeps the text. When the
 * Story was written but did not start, the refusal says it is on the board, Ready, and the text is kept
 * out of the field because writing it again would make a second Story.
 */
import { useState, type FormEvent } from "react";
import { Zap } from "lucide-react";
import { storyQuickStart } from "../adapters/tauri";
import { Button } from "@/components/Button";
import { notify } from "../lib/notify";
import { errorText } from "./StoryControls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Textarea,
} from "@highknow/design";

const REQUEST_MAX = 4000;

export function QuickStoryDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const request = text.trim();
    if (busy || request === "") return;
    setBusy(true);
    setError(null);
    storyQuickStart(projectId, request)
      .then((started) => {
        setOpen(false);
        setText("");
        notify.success(`Started ${started.story.key}`, {
          description: "A Quick Story: one criterion, judged at review. Its agent is reading it.",
        });
      })
      .catch((err: unknown) => {
        const message = errorText(err);
        // The Story exists when the core says so: the text is on the board, not to be written twice.
        if (message.includes("is on the board")) setText("");
        setError(message);
      })
      .finally(() => setBusy(false));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Quick Story">
          <Zap aria-hidden="true" />
          Quick Story
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="text-section font-semibold">Quick Story</DialogTitle>
            <DialogDescription>
              Say what to fix or ask. A Story with one criterion is written and started now. You judge it at review.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="quick-story-text">What should the agent do?</Label>
            <Textarea
              id="quick-story-text"
              aria-label="Quick Story request"
              value={text}
              maxLength={REQUEST_MAX}
              rows={4}
              onChange={(e) => setText(e.target.value)}
              placeholder="For example: why does the build fail on main?"
              autoFocus
            />
          </div>
          {error && (
            <p role="alert" className="m-0 text-small text-destructive-text">
              {error}
            </p>
          )}
          <DialogFooter className="-mx-4 -mb-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              aria-label="Write and start the Quick Story"
              loading={busy}
              disabled={text.trim() === ""}
            >
              Write and start
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
