/**
 * One Story, opened from its row anywhere it is shown (issue #104). It says where the developer is
 * (project, then Story), offers Back, and gathers everything the M2 flow does to a Story in visible
 * controls: Start, Resume, Drop, the Task checklist, the Acceptance criteria with their Checks, and
 * the session list.
 *
 * Opening a Story never opens its session. The live agent opens only from "Open session", which shows
 * while a session is live; past sessions open from their "Open feed" control.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { blockedSummary, storyGet } from "../adapters/tauri";
import { CriteriaList } from "./CriteriaList";
import {
  DropControl,
  OpenSessionControl,
  PacketSize,
  ResumeControl,
  SessionList,
  StartControl,
  StoryStateWord,
  errorText,
  useStopped,
} from "./StoryBoard";
import { DoingTask, TaskChecklist, useStoryTasks } from "./TaskChecklist";
import { useBoardChangedSubscription } from "./useBoardQuery";
import type { StoryDto } from "../adapters/tauri";
import "../session/session.css";

/** The read of one Story, keyed under the project so `board:changed` keeps it live. The sidebar reads
 * the same key to name the current Story. */
export function storyQueryKey(projectId: string, storyId: string) {
  return ["board", projectId, "story", storyId] as const;
}

export interface StoryViewProps {
  projectId: string;
  projectName: string;
  storyId: string;
  onBack: () => void;
}

export function StoryView({ projectId, projectName, storyId, onBack }: StoryViewProps) {
  useBoardChangedSubscription(projectId);
  const storyQuery = useQuery({
    queryKey: storyQueryKey(projectId, storyId),
    queryFn: () => storyGet(storyId),
  });
  const story = storyQuery.data ?? null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--foreground)" }}>
      <header
        className="session-header"
        style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-md)" }}
      >
        <button type="button" onClick={onBack} className="session-back type-label">
          ← Back
        </button>
        <nav aria-label="You are here" className="type-label" style={{ color: "var(--muted-foreground)" }}>
          {projectName}
          {story ? ` › ${story.key}` : ""}
        </nav>
      </header>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 var(--space-md) var(--space-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
        }}
      >
        {storyQuery.isError && (
          <p className="type-body" style={{ color: "var(--destructive-text)" }}>
            {errorText(storyQuery.error)}
          </p>
        )}
        {storyQuery.isSuccess && !story && (
          <p className="type-body" style={{ color: "var(--muted-foreground)" }}>
            This Story no longer exists.
          </p>
        )}
        {story && <StoryBody projectId={projectId} story={story} />}
      </div>
    </div>
  );
}

function StoryBody({ projectId, story }: { projectId: string; story: StoryDto }) {
  const [error, setError] = useState<string | null>(null);
  const tasks = useStoryTasks(projectId, story.id).data ?? [];
  const stopped = useStopped(projectId, story);
  // The same read the board's rows use, so the two never disagree on Waiting on you.
  const waitingQuery = useQuery({
    queryKey: ["board", projectId, "waiting-on-you"],
    queryFn: () => blockedSummary(projectId),
  });
  const waitingOnYou = (waitingQuery.data?.blockedStoryIds ?? []).includes(story.id);
  const open = story.state !== "merged" && story.state !== "dropped";

  return (
    <>
      <section aria-labelledby="story-heading" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <h1 id="story-heading" className="type-heading" style={{ margin: 0 }}>
          <span className="type-label" style={{ color: "var(--muted-foreground)", marginRight: "var(--space-sm)" }}>
            {story.key}
          </span>
          {story.title}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}>
          <StoryStateWord story={story} stopped={stopped} waitingOnYou={waitingOnYou} />
          <DoingTask tasks={tasks} storyKey={story.key} />
          {open && <PacketSize story={story} />}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}>
          <OpenSessionControl projectId={projectId} story={story} />
          {story.state === "ready" && <StartControl story={story} onError={setError} />}
          {stopped && <ResumeControl story={story} />}
          {open && <DropControl story={story} />}
        </div>
        {error && (
          <p className="type-body" style={{ margin: 0, color: "var(--destructive-text)" }}>
            {error}
          </p>
        )}
        {story.description && (
          <p className="type-body" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {story.description}
          </p>
        )}
      </section>

      <section aria-labelledby="story-criteria-heading">
        <h2 id="story-criteria-heading" className="type-label" style={{ color: "var(--muted-foreground)" }}>
          Acceptance criteria
        </h2>
        <CriteriaList projectId={projectId} storyId={story.id} storyKey={story.key} />
      </section>

      <section aria-labelledby="story-tasks-heading">
        <h2 id="story-tasks-heading" className="type-label" style={{ color: "var(--muted-foreground)" }}>
          Tasks
        </h2>
        <TaskChecklist storyKey={story.key} storyId={story.id} tasks={tasks} />
      </section>

      {story.state !== "shaping" && story.state !== "ready" && (
        <section aria-labelledby="story-sessions-heading">
          <h2 id="story-sessions-heading" className="type-label" style={{ color: "var(--muted-foreground)" }}>
            Sessions
          </h2>
          <SessionList projectId={projectId} story={story} />
        </section>
      )}
    </>
  );
}
