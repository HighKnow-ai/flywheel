/**
 * What a Landing Story waits for (ADR 0042, issue #1757). Merge pushed the Story's branch and opened a
 * pull request (or ran the project's landing command); the Story is Landing until the forge says the
 * request merged, and Flywheel asks it once a minute. "Check now" asks at once.
 *
 * Three things show here and nowhere else: the request's address, the note the last answer left (a CLI
 * that is missing or signed out, auto-merge that could not be turned on), and, on a Story that went
 * back to In review, the reason: the request was closed without merging. The words of a note are the
 * core's own and are shown as they stand.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitPullRequestArrow, RefreshCw } from "lucide-react";
import { storyLanding, storyLandingRefresh, type StoryDto } from "../adapters/tauri";
import { Button } from "@/components/Button";
import { errorText } from "./StoryControls";

/** The read of one Story's landing, keyed under the project so `board:changed` keeps it live. */
export function landingQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "landing", storyId] as const;
}

export function LandingPanel({ projectId, story }: { projectId: string; story: StoryDto }) {
  const landingState = story.state === "landing";
  const query = useQuery({
    queryKey: landingQueryKey(projectId, story.id),
    queryFn: () => storyLanding(story.id),
    enabled: landingState || story.state === "in_review",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const landing = query.data;
  if (!landing) return null;
  // An In review Story shows its landing only when the request was closed: that is why it is back.
  if (!landingState && landing.requestState !== "closed") return null;

  const request = landing.mode === "command" ? "The landing command ran" : "The pull request is open";
  async function checkNow() {
    setBusy(true);
    setError(null);
    try {
      await storyLandingRefresh(story.id);
      await query.refetch();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={landingState ? "Landing" : "Request closed"}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-5 py-4 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <GitPullRequestArrow aria-hidden="true" size={16} />
        <h2 className="m-0 text-section font-semibold">{landingState ? "Landing" : "Request closed"}</h2>
        {landingState && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            aria-label={`Check ${story.key} now`}
            loading={busy}
            onClick={() => void checkNow()}
          >
            <RefreshCw aria-hidden="true" />
            Check now
          </Button>
        )}
      </div>
      {landingState && (
        <p className="m-0 text-small text-muted-foreground">
          {`${request}. ${story.key} moves to Merged when the forge says it merged.`}
        </p>
      )}
      {landing.requestUrl && (
        <p className="m-0 text-small">
          <span className="text-muted-foreground">Request: </span>
          <span className="font-mono wrap-anywhere">{landing.requestUrl}</span>
        </p>
      )}
      {landing.note && (
        <p role="status" className="m-0 text-small text-foreground wrap-anywhere">
          {landing.note}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-small text-destructive-text">
          {error}
        </p>
      )}
    </section>
  );
}
