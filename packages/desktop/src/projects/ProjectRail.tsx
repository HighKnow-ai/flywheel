/**
 * The sidebar (direction.md § Navigation, docs/mvp-spec.md §7), on shadcn's Sidebar primitives.
 *
 * From the top: the HighKnow mark; Waiting on you (every Gated action, permission request and question
 * a live agent holds, across every project, opening the queue); All agents and Worktrees; then the
 * projects, each with its own Waiting-on-you count and its live Story sessions beneath it; and at the
 * foot Register project, Remove from Flywheel and Settings.
 *
 * Where the developer is, is always marked (issue #104): the current project and the current Story (the
 * Story open in the Story view, or the Story of the open session) are raised cards. A session row opens
 * its Story; its terminal control, and only that, opens the live session. A project with nothing running
 * shows no list.
 *
 * Counts are numerals or nothing, never a raw dot and never a visible zero. The Waiting-on-you count is
 * the queue's own read (one entry per waiting request, plus one per shaping Round a live session is held
 * on, issue #124), so the figure and the list cannot disagree; the
 * live sessions are the fleet's own read, so the sidebar, the andon strip and All agents cannot either.
 * Needs decision (D-46: a past session left something to decide) is a separate figure, never summed in.
 *
 * An unreachable project (D-16) carries a warning glyph AND the word "Unreachable", never a colour alone;
 * `App.tsx` decides that selecting it opens `ProjectUnreachable`.
 *
 * "Remove from Flywheel…" (D-200) hides the CURRENT project only, as a reversible soft-hide. Its
 * confirmation names what is kept (the board, worktrees, runs and activity trail) and afterwards the
 * sidebar selects another project, so the surface never points at one that no longer lists.
 *
 * Register project opens the SAME registration flow ⌘⇧O and the native File menu use
 * (`RegisterProjectFlow.tsx`). Challenges and proposal badges never surface here (D-46/D-82).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BellRing, Folder, FolderMinus, Plus, Settings, SquareStack, Terminal, TriangleAlert } from "lucide-react";
import { projectHide, storyGet, type FleetRowDto, type StoryDto, type WaitingRoundDto } from "../adapters/tauri";
import glyphUrl from "../assets/logo-glyph.svg";
import type { Project } from "../board/useBoardQuery";
import { useRecoverySummary } from "../board/useBoardQuery";
import {
  blockedQueueQueryKey,
  fleetQueryKey,
  useBlockedQueue,
  useFleet,
  useWaitingRounds,
  worktreeInventoryQueryKey,
} from "../fleet/useFleet";
import { isRunStatus } from "../legend/runStatus";
import { StateBadge } from "../components/StateBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useRegisterProjectFlow, useRegistrationErrorNotice } from "./RegisterProjectFlow";
import { lampsFromFleet } from "../shell/AndonStrip";
import { useUiStore } from "../state/uiStore";
import { useOpenWaitingRound, waitingRoundWords } from "../fleet/waitingRound";

const SIDEBAR_WIDTH = "248px";
const NOTICE_VISIBLE_MS = 4000;

/** One row grammar for the sidebar: 36px, icon (18px in navigation) then word, a figure on the right. */
const rowClass =
  "h-9 gap-2.5 rounded-md px-2.5 text-body text-sidebar-foreground [&_svg]:size-[18px] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The current project or Story: a raised card on the sidebar ground, never the brand. */
const currentClass =
  "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-card ring-1 ring-sidebar-border hover:bg-sidebar-primary";

/** A live session: one a person could be watching. Finished sessions stay on All agents only. */
function isLiveSession(row: FleetRowDto): boolean {
  return row.runStatus === "running" || row.runStatus === "blocked";
}

/** The Story the developer is on: the one open in the Story view, or the open session's. */
function usePlaceStoryId(): string | null {
  return useUiStore((state) => (state.activeSessionId ? state.activeSessionStoryId : state.currentStoryId));
}

/** The current Story's record, read under the Story view's own key so the two share one read. Only
 * the Story view's Story is read here; a session's Story is named by its running row. */
function useCurrentStory(currentProjectId: string | undefined): StoryDto | null {
  const storyId = useUiStore((state) => (state.activeSessionId ? null : state.currentStoryId));
  const query = useQuery({
    queryKey: ["board", currentProjectId, "story", storyId],
    queryFn: () => storyGet(storyId as string),
    enabled: Boolean(storyId && currentProjectId),
  });
  return storyId ? (query.data ?? null) : null;
}

/** A Story row under its project: a state tile, the key and title, and below them what it is doing. */
function StoryRowButton({
  story,
  detail,
  tile,
  here,
  ariaLabel,
  title,
  onClick,
}: {
  story: { key: string; title: string; id: string };
  detail: string | null;
  tile: React.ReactNode;
  here: boolean;
  ariaLabel: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-story-id={story.id}
      aria-current={here ? "location" : undefined}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-(--duration-state) ease-(--ease) hover:bg-sidebar-accent",
        here && currentClass,
      )}
    >
      <span className="mt-px shrink-0">{tile}</span>
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2 text-small font-semibold">
          <span className="font-mono text-meta font-normal text-muted-foreground">{story.key}</span> {story.title}
        </span>
        {detail && <span className="truncate text-meta text-subtle-foreground">{detail}</span>}
      </span>
    </button>
  );
}

/** One project's running sessions, under its entry, plus the current Story when it is not running.
 * Renders nothing when neither is there. */
function RunningSessions({
  projectId,
  projectName,
  sessions,
  stopped,
  rounds,
  currentStory,
}: {
  projectId: string;
  projectName: string;
  sessions: FleetRowDto[];
  /** This project's Stopped Stories (a Running Story with no live session), each by its newest session. */
  stopped: FleetRowDto[];
  /** Issue #124: this project's shaping Rounds a live session is held on, so the badge and the rows agree. */
  rounds: WaitingRoundDto[];
  currentStory: StoryDto | null;
}) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const openStory = useUiStore((state) => state.openStory);
  const openRound = useOpenWaitingRound();
  const placeEpicId = useUiStore((state) => (state.activeSessionId ? null : state.currentEpicId));
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const placeStoryId = usePlaceStoryId();
  const extraStory =
    currentStory &&
    currentStory.projectId === projectId &&
    !sessions.some((s) => s.storyId === currentStory.id) &&
    !stopped.some((s) => s.storyId === currentStory.id)
      ? currentStory
      : null;
  if (sessions.length === 0 && stopped.length === 0 && rounds.length === 0 && !extraStory) return null;
  return (
    <SidebarMenuSub role="list" aria-label={`${projectName} running sessions`} className="mx-0 ml-4 mr-0 gap-0.5 px-1.5 py-1">
      {/* A shaping Round a live session is held on: Waiting on you, so it leads, and it opens its Epic. */}
      {rounds.map((round) => {
        const words = waitingRoundWords(round);
        return (
          <SidebarMenuSubItem key={round.roundId} className="flex">
            <StoryRowButton
              story={{ id: round.epicId ?? round.roundId, key: words.key, title: words.title }}
              detail={`${words.shortRound} · Waiting on you`}
              tile={<StateBadge state="waiting_on_you" hideLabel className="size-5 justify-center p-0 [&>svg]:size-3.5" />}
              here={round.epicId !== null && round.epicId === placeEpicId}
              ariaLabel={`Open ${words.record}, ${words.round} Waiting on you`}
              title={`${words.record}: ${words.round} waiting on you`}
              onClick={() => openRound(round)}
            />
          </SidebarMenuSubItem>
        );
      })}
      {extraStory && (
        <SidebarMenuSubItem className="flex">
          <StoryRowButton
            story={extraStory}
            detail={null}
            // A Running Story with no live session here is Stopped (the core's own rule), so it never
            // wears the live spinner.
            tile={
              <StateBadge
                state={extraStory.state === "running" ? "stopped" : extraStory.state}
                hideLabel
                className="size-5 justify-center p-0 [&>svg]:size-3.5"
              />
            }
            here
            ariaLabel={`Open Story ${extraStory.key} ${extraStory.title}`}
            title={`${extraStory.key} ${extraStory.title}`}
            onClick={() => openStory(projectId, extraStory.id)}
          />
        </SidebarMenuSubItem>
      )}
      {sessions.map((session) => {
        const doing = session.doingTaskTitle;
        const subject = `${session.storyKey} ${session.storyTitle}`.trim();
        // The core's derived fleet state, never the stored status: a session is waiting on you only
        // while it holds a pending request (#57).
        const waiting = session.fleetState === "blocked";
        const here = session.storyId === placeStoryId;
        return (
          <SidebarMenuSubItem key={session.sessionId} className="flex items-start gap-0.5">
            <StoryRowButton
              story={{ id: session.storyId, key: session.storyKey, title: session.storyTitle }}
              detail={waiting ? "Waiting on you" : doing}
              tile={
                <StateBadge
                  state={waiting ? "waiting_on_you" : "running"}
                  hideLabel
                  className="size-5 justify-center p-0 [&>svg]:size-3.5"
                />
              }
              here={here}
              ariaLabel={doing ? `Open Story ${subject}, doing ${doing}` : `Open Story ${subject}`}
              title={doing ? `${subject}: ${doing}` : subject}
              onClick={() => openStory(session.projectId, session.storyId)}
            />
            {/* The one explicit way to the live agent from the sidebar (issue #104). */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-session-id={session.sessionId}
                  aria-current={session.sessionId === activeSessionId ? "page" : undefined}
                  aria-label={`Open ${subject} session`}
                  onClick={() =>
                    setActiveSessionId(
                      session.sessionId,
                      session.storyId,
                      null,
                      isRunStatus(session.runStatus) ? session.runStatus : null,
                    )
                  }
                  className="mt-1 shrink-0 text-subtle-foreground hover:bg-sidebar-accent hover:text-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground"
                >
                  <Terminal aria-hidden="true" />
                  <span className="sr-only">Session</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Open session</TooltipContent>
            </Tooltip>
          </SidebarMenuSubItem>
        );
      })}
      {/* Stopped Stories stay under their project, after the live ones, in a stable order: they need
          Resume, which their Story offers. No session control: nothing is live to open. */}
      {stopped.map((row) => {
        const subject = `${row.storyKey} ${row.storyTitle}`.trim();
        return (
          <SidebarMenuSubItem key={row.sessionId} className="flex">
            <StoryRowButton
              story={{ id: row.storyId, key: row.storyKey, title: row.storyTitle }}
              detail="Stopped"
              tile={<StateBadge state="stopped" hideLabel className="size-5 justify-center p-0 [&>svg]:size-3.5" />}
              here={row.storyId === placeStoryId}
              ariaLabel={`Open Story ${subject}, Stopped`}
              title={`${subject}: Stopped`}
              onClick={() => openStory(row.projectId, row.storyId)}
            />
          </SidebarMenuSubItem>
        );
      })}
    </SidebarMenuSub>
  );
}

export interface ProjectRailProps {
  projects: Project[];
  currentProjectId: string | undefined;
  onSelect: (project: Project) => void;
}

/** A labelled group. `role="group"` named by its label, so a screen reader hears the section; the label
 * is drawn only where the eye needs it. */
function Section({
  id,
  label,
  visibleLabel = false,
  children,
}: {
  id: string;
  label: string;
  visibleLabel?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SidebarGroup role="group" aria-labelledby={id} className="px-2 py-1.5">
      <SidebarGroupLabel asChild className={cn(!visibleLabel && "sr-only")}>
        <h2
          id={id}
          className="m-0 h-7 px-2.5 font-condensed text-meta font-semibold tracking-[0.06em] text-muted-foreground uppercase"
        >
          {label}
        </h2>
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0.5">{children}</SidebarMenu>
    </SidebarGroup>
  );
}

export function ProjectRail({ projects, currentProjectId, onSelect }: ProjectRailProps) {
  const [notice, setNotice] = useState<string | null>(null);
  // The project id the open confirmation is FOR, so switching project never carries it across.
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const fleetSurface = useUiStore((state) => state.fleetSurface);
  const setWorktreeInventoryOpen = useUiStore((state) => state.setWorktreeInventoryOpen);
  const worktreeInventoryOpen = useUiStore((state) => state.worktreeInventoryOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const {
    registerProjectFlow,
    isError: registerIsError,
    error: registerError,
  } = useRegisterProjectFlow((result) => {
    if (result.alreadyRegistered) {
      // Re-registering the same repository is a visible event, never a silent one (D-15).
      setNotice(`"${result.project.name}" was already registered.`);
      window.setTimeout(() => setNotice(null), NOTICE_VISIBLE_MS);
    }
  });
  const registrationErrorNotice = useRegistrationErrorNotice(registerIsError, registerError);
  // Every hook is called above the early return below, so their order never changes (Rules of Hooks).
  const queue = useBlockedQueue().data ?? [];
  const waitingRounds = useWaitingRounds().data ?? [];
  const waitingCount = queue.length + waitingRounds.length;
  const recoveryCount = useRecoverySummary(currentProjectId).data?.recoveryCount ?? 0;
  const fleetRows = useFleet().data?.rows ?? [];
  const liveSessions = fleetRows.filter(isLiveSession);
  // The strip's own rule for Stopped, so the sidebar and the lamps agree.
  const stoppedRows = lampsFromFleet(fleetRows)
    .filter((lamp) => lamp.tone === "stopped")
    .map((lamp) => lamp.row);
  const currentStory = useCurrentStory(currentProjectId);

  const currentProject = projects.find((project) => project.id === currentProjectId);

  async function removeCurrentProject() {
    if (!currentProject) return;
    try {
      await projectHide(currentProject.id);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error));
      return;
    }
    setConfirmingRemoveId(null);
    setRemoveError(null);
    // Land on another project before the list refetches, so the surface never points at a project
    // that no longer lists. With none left, the empty list sends the app back to first run.
    const next = projects.find((project) => project.id !== currentProject.id);
    if (next) onSelect(next);
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    void queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
  }

  if (projects.length === 0) {
    // `App.tsx` renders `FirstRun` instead; this guard keeps the component honest on its own.
    return null;
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": SIDEBAR_WIDTH } as React.CSSProperties}
      className="h-full min-h-0 w-auto shrink-0"
    >
      <Sidebar collapsible="none" className="border-r border-sidebar-border">
        <nav aria-label="Projects" className="flex min-h-0 flex-1 flex-col">
          <SidebarHeader className="flex-row items-center gap-2.5 px-4 pt-4 pb-2">
            {/* The HighKnow mark in ink (PRODUCT.md: the sidebar is one of the few surfaces that render a logo).
                Not on a brand tile: brand blue means an agent at work or your next action, nothing else. A CSS
                mask over the glyph-only asset lets the ink token colour it; it stays a static file reference. */}
            <span
              role="img"
              aria-label="Flywheel by HighKnow"
              className="rail-mark shrink-0"
              style={{ maskImage: `url(${glyphUrl})`, WebkitMaskImage: `url(${glyphUrl})` }}
            />
            <span aria-hidden="true" className="text-section font-bold">
              Flywheel
            </span>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <Section id="rail-waiting" label="Waiting on you">
              {/* At the very top (docs/mvp-spec.md §4.1): what a live agent can't go on without, across
                  every project, outranks everything below it. */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label={waitingCount > 0 ? `Open Waiting on you, ${waitingCount} waiting` : "Open Waiting on you"}
                  title="Every Gated action, permission request, question and shaping Round waiting on you, across every project"
                  aria-current={fleetSurface?.view === "queue" ? "page" : undefined}
                  onClick={() => setFleetSurface({ view: "queue" })}
                  className={cn(rowClass, fleetSurface?.view === "queue" && currentClass)}
                >
                  <BellRing aria-hidden="true" />
                  <span className="flex-1">Waiting on you</span>
                  {waitingCount > 0 && (
                    <Badge
                      variant="attention"
                      data-count="waiting"
                      title={waitingCount === 1 ? "1 waiting on you" : `${waitingCount} waiting on you`}
                      className="h-5 min-w-5 rounded-md px-1.5 text-meta tabular-nums"
                    >
                      {waitingCount}
                    </Badge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </Section>

            <Section id="rail-fleet" label="Fleet">
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label="Open fleet"
                  title="Every agent across every project"
                  aria-current={fleetSurface?.view === "fleet" ? "page" : undefined}
                  onClick={() => setFleetSurface({ view: "fleet" })}
                  className={cn(rowClass, fleetSurface?.view === "fleet" && currentClass)}
                >
                  <Activity aria-hidden="true" />
                  <span className="flex-1">All agents</span>
                  {liveSessions.length > 0 && (
                    <span className="text-small font-semibold text-muted-foreground tabular-nums">{liveSessions.length}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label="Open worktree inventory"
                  title="Every Story worktree across every project, with its disk usage"
                  aria-current={worktreeInventoryOpen ? "page" : undefined}
                  onClick={() => setWorktreeInventoryOpen(true)}
                  className={cn(rowClass, worktreeInventoryOpen && currentClass)}
                >
                  <SquareStack aria-hidden="true" />
                  <span>Worktrees</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </Section>

            {recoveryCount > 0 && (
              <Section id="rail-review-queue" label="Review queue">
                {/* Never merged with the waiting count (D-46): a different urgency, so a different row. It
                    opens All agents, not the queue: the queue holds requests waiting on you only. */}
                <SidebarMenuItem>
                  <SidebarMenuButton aria-label="Open decisions" onClick={() => setFleetSurface({ view: "fleet" })} className={rowClass}>
                    <TriangleAlert aria-hidden="true" />
                    <span className="flex-1">Needs decision</span>
                    <span
                      data-count="needs-decision"
                      title={recoveryCount === 1 ? "1 task needs a decision." : `${recoveryCount} tasks need a decision.`}
                      className="text-small font-semibold text-destructive-text tabular-nums"
                    >
                      {recoveryCount}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Section>
            )}

            <Section id="rail-projects" label="Projects" visibleLabel>
              {projects.map((project) => {
                const isCurrent = project.id === currentProjectId;
                const isUnreachable = project.status === "unreachable";
                const projectWaiting =
                  queue.filter((entry) => entry.projectId === project.id).length +
                  waitingRounds.filter((round) => round.projectId === project.id).length;
                return (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      title={project.name}
                      aria-label={isUnreachable ? `${project.name}, Unreachable` : project.name}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => onSelect(project)}
                      className={cn(rowClass, "h-auto min-h-9 py-1.5", isCurrent && currentClass, isUnreachable && "text-muted-foreground")}
                    >
                      <Folder aria-hidden="true" className="self-start mt-0.5" />
                      <span className="flex min-w-0 flex-1 flex-col items-start">
                        <span className="flex max-w-full min-w-0 items-baseline gap-1.5">
                          <span className="truncate">{project.name}</span>
                          <span className="shrink-0 font-mono text-meta font-normal text-subtle-foreground">{project.keyPrefix}</span>
                        </span>
                        {isUnreachable && (
                          // The word AND a glyph, never a colour change alone; its own line, so the name is
                          // never truncated to make room for it.
                          <span className="inline-flex items-center gap-1 text-meta font-semibold text-destructive-text [&_svg]:size-3!">
                            <TriangleAlert aria-hidden="true" />
                            Unreachable
                          </span>
                        )}
                      </span>
                      {projectWaiting > 0 && (
                        <Badge
                          variant="attention"
                          title={`${projectWaiting} waiting on you in ${project.name}`}
                          className="h-5 min-w-5 rounded-md px-1.5 text-meta tabular-nums"
                        >
                          {projectWaiting}
                        </Badge>
                      )}
                    </SidebarMenuButton>
                    <RunningSessions
                      projectId={project.id}
                      projectName={project.name}
                      sessions={liveSessions.filter((session) => session.projectId === project.id)}
                      stopped={stoppedRows.filter((row) => row.projectId === project.id)}
                      rounds={waitingRounds.filter((round) => round.projectId === project.id)}
                      currentStory={currentStory}
                    />
                  </SidebarMenuItem>
                );
              })}
            </Section>
          </SidebarContent>

          <SidebarFooter className="gap-0.5 border-t border-sidebar-border px-2 py-2">
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label="Register Project…"
                  title="Register a git repository as a project"
                  onClick={() => void registerProjectFlow()}
                  className={cn(rowClass, "text-muted-foreground")}
                >
                  <Plus aria-hidden="true" />
                  <span>Register project…</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {currentProject && confirmingRemoveId !== currentProject.id && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-label="Remove from Flywheel…"
                    title="Hide this project. Nothing is deleted."
                    onClick={() => setConfirmingRemoveId(currentProject.id)}
                    className={cn(rowClass, "text-muted-foreground")}
                  >
                    <FolderMinus aria-hidden="true" />
                    <span>Remove from Flywheel…</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label="Open Settings"
                  aria-current={settingsOpen ? "page" : undefined}
                  onClick={() => setSettingsOpen(true)}
                  className={cn(rowClass, "text-muted-foreground", settingsOpen && currentClass)}
                >
                  <Settings aria-hidden="true" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            {currentProject && confirmingRemoveId === currentProject.id && (
              <div
                role="group"
                aria-label={`Remove ${currentProject.name} from Flywheel`}
                className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-card"
              >
                <p className="m-0 text-small">
                  Remove {currentProject.name} from Flywheel? Its board, worktrees, runs and activity trail are all
                  kept, and nothing is deleted. Register the repository again to bring it back.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="neutral" onClick={() => void removeCurrentProject()}>
                    Remove from Flywheel
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirmingRemoveId(null);
                      setRemoveError(null);
                    }}
                  >
                    Keep it
                  </Button>
                </div>
                {removeError && (
                  <p role="alert" className="m-0 text-meta text-destructive-text">
                    Couldn&rsquo;t remove it: {removeError}
                  </p>
                )}
              </div>
            )}
            {notice && (
              <div role="status" className="px-2.5 text-meta text-muted-foreground">
                {notice}
              </div>
            )}
            {registrationErrorNotice && (
              <div role="status" className="px-2.5 text-meta text-destructive-text">
                {registrationErrorNotice}
              </div>
            )}
          </SidebarFooter>
        </nav>
      </Sidebar>
    </SidebarProvider>
  );
}
