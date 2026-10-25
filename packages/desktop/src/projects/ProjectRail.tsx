/**
 * The sidebar (direction.md § Navigation, docs/mvp-spec.md §7), on shadcn's Sidebar primitives.
 *
 * From the top: the HighKnow mark; Waiting on you (every Gated action, permission request and question
 * a live agent holds, across every project, opening the queue); All agents and Worktrees; then the
 * projects, each with its own Needs-you figure, its own menu and its live Story sessions beneath it; and
 * at the foot Register project and Settings.
 *
 * Where the developer is, is always marked (issues #104, #200): the project on screen and the current Story
 * (the Story open in the Story view, or the Story of the open session) are raised cards. The project is
 * derived from what is open, not only from the board behind it: a session of another project's Story raises
 * that project, so the rail and the breadcrumb never disagree. A session row opens its Story; its terminal
 * control, and only that, opens the live session. A project with nothing running shows no list.
 *
 * One meaning per badge (issue #200): the yellow attention Badge is Waiting on you's count and nothing else.
 * The Waiting-on-you count is the queue's own read (one entry per waiting request, plus one per shaping Round
 * a live session is held on, issue #124), so the figure and the list cannot disagree. A project's figure is
 * its Needs-you item count (issue #156), read under the board column's own key, always neutral; what in it
 * is Waiting on you shows as its own row under the project. All agents counts agents as GLOSSARY.md defines
 * them (live sessions, Story or shaping) through the andon strip's own `agentCount`, so the sidebar, the
 * strip and All agents cannot disagree. Counts are numerals or nothing,
 * never a raw dot and never a visible zero.
 *
 * ⌘B (shadcn's own SidebarProvider binding) collapses the rail to icons; every row then names itself in a
 * Tooltip. A project's Tooltip always gives its full name, so a long name truncated in the row is never lost.
 *
 * An unreachable project (D-16) carries a warning glyph AND the word "Unreachable", never a colour alone, and
 * a Tooltip saying where Flywheel looked; `App.tsx` decides that selecting it opens `ProjectUnreachable`.
 *
 * "Remove from Flywheel…" (D-200) lives in each project's own menu, never in the always-visible footer, and
 * is a reversible soft-hide confirmed with ConfirmDestructive. The confirmation names what is kept (the
 * board, worktrees, runs and activity trail); removing the project on screen selects another, so the
 * surface never points at one that no longer lists.
 *
 * Register project opens the SAME registration flow ⌘⇧O and the native File menu use
 * (`RegisterProjectFlow.tsx`); what it reports back is a toast. Challenges never surface here (D-46/D-82).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BellRing,
  Folder,
  FolderMinus,
  MoreHorizontal,
  Plus,
  Settings,
  SquareStack,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { projectHide, storyGet, type FleetRowDto, type StoryDto, type WaitingRoundDto } from "../adapters/tauri";
import logoUrl from "../assets/logo.svg";
import type { Project } from "../board/useBoardQuery";
import {
  blockedQueueQueryKey,
  fleetQueryKey,
  useBlockedQueue,
  useFleet,
  useNeedsYouLists,
  useWaitingRounds,
  worktreeInventoryQueryKey,
} from "../fleet/useFleet";
import { isRunStatus } from "../legend/runStatus";
import { StateBadge } from "../components/StateBadge";
import { StoryKey } from "../components/StoryKey";
import { ConfirmDestructive } from "../components/ConfirmDestructive";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { useRegisterProjectFlow, useRegistrationErrorToast } from "./RegisterProjectFlow";
import { agentCount, lampsFromFleet } from "../shell/AndonStrip";
import { useUiStore } from "../state/uiStore";
import {
  isRoundHere,
  useOpenWaitingRound,
  usePlaceBoardId,
  usePlaceShapingId,
  waitingRoundWords,
} from "../fleet/waitingRound";

/** The rail's width, open and folded to icons (issue #200): 248px open, a 56px column of 36px icon rows. */
const RAIL_WIDTH = "248px";
const RAIL_WIDTH_ICON = "56px";

/** One row grammar for the sidebar: 36px, icon (18px in navigation) then word, a figure on the right.
 * Folded to icons, the row is a 36px square around its icon. */
const rowClass =
  "h-9 gap-2.5 rounded-md px-2.5 text-body text-sidebar-foreground [&_svg]:size-[18px] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-[9px]!";

/** The current project or Story: a raised card on the sidebar ground, never the brand. */
const currentClass =
  "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-card ring-1 ring-sidebar-border hover:bg-sidebar-primary";

/** A row's figure: the 20px count, tabular. */
const figureClass = "h-5 min-w-5 rounded-md px-1.5 text-meta tabular-nums";

/** A row's trailing slot (its figure, and on a project its menu), centred on the 36px row's first line. */
const trailingClass = "top-2 peer-data-[size=default]/menu-button:top-2 right-1.5";

/** A live session: one a person could be watching. Finished sessions stay on All agents only. */
function isLiveSession(row: FleetRowDto): boolean {
  return row.runStatus === "running" || row.runStatus === "blocked";
}

/** The Story the developer is on: the one open in the Story view, or the open session's. */
function usePlaceStoryId(): string | null {
  return useUiStore((state) => (state.activeSessionId ? state.activeSessionStoryId : state.currentStoryId));
}

/**
 * The project the developer is in (issue #200): the open session's own project when a session is on screen,
 * read from the fleet's row for it, otherwise the project whose board, Story or shaping view is open. A
 * session opened from Waiting on you or All agents leaves the board behind it where it was, so the board's
 * project alone would raise the wrong one.
 */
function placeProjectId(
  fleetRows: FleetRowDto[],
  activeSessionId: string | null,
  boardProjectId: string | undefined,
): string | undefined {
  if (activeSessionId) {
    const row = fleetRows.find((candidate) => candidate.sessionId === activeSessionId);
    if (row) return row.projectId;
  }
  return boardProjectId;
}

/** The current Story's record, read under the Story view's own key so the two share one read. Only
 * the Story view's Story is read here; a session's Story is named by its fleet row. */
function useCurrentStory(currentProjectId: string | undefined): StoryDto | null {
  const storyId = useUiStore((state) => (state.activeSessionId ? null : state.currentStoryId));
  const query = useQuery({
    queryKey: ["board", currentProjectId, "story", storyId],
    queryFn: () => storyGet(storyId as string),
    enabled: Boolean(storyId && currentProjectId),
  });
  return storyId ? (query.data ?? null) : null;
}

/** The Story a row under a project can name: its id, key, title and state. */
interface PlaceStory {
  id: string;
  projectId: string;
  key: string;
  title: string;
  state: StoryDto["state"];
}

/** A Story row under its project: a state tile, the key and title, and below them what it is doing. The
 * whole subject is in its Tooltip, since the row clamps the title to two lines. */
function StoryRowButton({
  story,
  detail,
  tile,
  here,
  ariaLabel,
  hint,
  onClick,
}: {
  story: { key: string; title: string; id: string };
  detail: string | null;
  tile: React.ReactNode;
  here: boolean;
  ariaLabel: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarMenuSubButton
          asChild
          className={cn(
            "h-auto min-w-0 flex-1 translate-x-0 items-start gap-2 px-2 py-1.5 text-left transition-colors duration-(--duration-state) ease-(--ease) hover:bg-sidebar-accent",
            "[&>span:last-child]:overflow-visible [&>span:last-child]:whitespace-normal",
            here && currentClass,
          )}
        >
          <button
            type="button"
            data-story-id={story.id}
            aria-current={here ? "location" : undefined}
            aria-label={ariaLabel}
            onClick={onClick}
          >
            <span className="mt-px shrink-0">{tile}</span>
            <span className="flex min-w-0 flex-col">
              <span className="line-clamp-2 text-small font-semibold">
                {story.key && (
                  <>
                    <StoryKey value={story.key} />{" "}
                  </>
                )}
                {story.title}
              </span>
              {detail && <span className="truncate text-meta text-subtle-foreground">{detail}</span>}
            </span>
          </button>
        </SidebarMenuSubButton>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-80">
        {hint}
      </TooltipContent>
    </Tooltip>
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
  currentStory: PlaceStory | null;
}) {
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const openStory = useUiStore((state) => state.openStory);
  const openRound = useOpenWaitingRound();
  const placeBoardId = usePlaceBoardId();
  const placeShapingId = usePlaceShapingId();
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
    <SidebarMenuSub
      role="list"
      aria-label={`${projectName} running sessions`}
      className="mx-0 ml-4 mr-0 gap-0.5 px-1.5 py-1"
    >
      {/* A shaping Round a live session is held on: Waiting on you, so it leads, and it opens its Epic. */}
      {rounds.map((round) => {
        const words = waitingRoundWords(round);
        return (
          <SidebarMenuSubItem key={round.roundId} className="flex">
            <StoryRowButton
              story={{ id: round.epicId ?? round.milestoneId ?? round.roundId, key: words.key, title: words.title }}
              detail={`${words.shortRound} · Waiting on you`}
              tile={
                <StateBadge state="waiting_on_you" hideLabel className="size-5 justify-center p-0 [&>svg]:size-3.5" />
              }
              here={isRoundHere(round, placeBoardId, placeShapingId)}
              ariaLabel={`Open ${words.record}, ${words.round} Waiting on you`}
              hint={`${words.record}: ${words.round} waiting on you`}
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
            hint={`${extraStory.key} ${extraStory.title}`}
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
              hint={waiting ? `${subject}: Waiting on you` : doing ? `${subject}: ${doing}` : subject}
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
              hint={`${subject}: Stopped`}
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
  /** The project whose board (or Story, Epic or Milestone view) is behind whatever is open. */
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

/** A row's Tooltip, shown open or folded: its name (folded, where the word is gone) and what it opens. */
function rowTooltip(label: string, detail: string | null, collapsed: boolean) {
  return {
    hidden: !collapsed && !detail,
    children: (
      <span className="flex max-w-72 flex-col">
        {collapsed && <span className="font-semibold">{label}</span>}
        {detail && <span>{detail}</span>}
      </span>
    ),
  };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function ProjectRail({ projects, currentProjectId, onSelect }: ProjectRailProps) {
  // The project whose removal is being confirmed, if any.
  const [removing, setRemoving] = useState<Project | null>(null);
  const queryClient = useQueryClient();
  const { state: sidebarState } = useSidebar();
  const collapsed = sidebarState === "collapsed";
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const fleetSurface = useUiStore((state) => state.fleetSurface);
  const setWorktreeInventoryOpen = useUiStore((state) => state.setWorktreeInventoryOpen);
  const worktreeInventoryOpen = useUiStore((state) => state.worktreeInventoryOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const activeSessionId = useUiStore((state) => state.activeSessionId);
  const {
    registerProjectFlow,
    isError: registerIsError,
    error: registerError,
  } = useRegisterProjectFlow((result) => {
    if (result.alreadyRegistered) {
      // Re-registering the same repository is a visible event, never a silent one (D-15).
      notify.success(`${result.project.name} was already registered`, {
        description: "Nothing changed: it keeps its board and history.",
      });
    }
  });
  // A failure is the same error toast ⌘⇧O and the File menu raise (issue #210).
  useRegistrationErrorToast(registerIsError, registerError);
  // Every hook is called above the early return below, so their order never changes (Rules of Hooks).
  const queue = useBlockedQueue().data ?? [];
  const waitingRounds = useWaitingRounds().data ?? [];
  const waitingCount = queue.length + waitingRounds.length;
  // Every project's Needs-you list, the same read the board's column makes (issue #156).
  const needsYouLists = useNeedsYouLists(projects.map((project) => project.id));
  const fleet = useFleet().data;
  const fleetRows = fleet?.rows ?? [];
  const liveSessions = fleetRows.filter(isLiveSession);
  // Issue #239: a shaping session working between Rounds is an agent too.
  const agents = agentCount(fleetRows, waitingRounds, fleet?.shapingRows ?? []);
  // The strip's own rule for Stopped, so the sidebar and the lamps agree.
  const stoppedRows = lampsFromFleet(fleetRows)
    .filter((lamp) => lamp.tone === "stopped")
    .map((lamp) => lamp.row);
  const hereProjectId = placeProjectId(fleetRows, activeSessionId, currentProjectId);
  const viewedStory = useCurrentStory(currentProjectId);
  // The Story to raise under its project: the Story view's, or the open session's, named by its fleet row.
  const sessionRow = activeSessionId ? fleetRows.find((row) => row.sessionId === activeSessionId) : undefined;
  const currentStory: PlaceStory | null = sessionRow
    ? {
        id: sessionRow.storyId,
        projectId: sessionRow.projectId,
        key: sessionRow.storyKey,
        title: sessionRow.storyTitle,
        state: sessionRow.storyState as StoryDto["state"],
      }
    : viewedStory;

  async function removeProject(project: Project) {
    // A failure throws into ConfirmDestructive, which keeps the dialog open and says why.
    await projectHide(project.id);
    // Land on another project before the list refetches, so the surface never points at a project
    // that no longer lists. With none left, the empty list sends the app back to first run.
    if (project.id === currentProjectId || project.id === hereProjectId) {
      const next = projects.find((candidate) => candidate.id !== project.id);
      if (next) onSelect(next);
    }
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    void queryClient.invalidateQueries({ queryKey: blockedQueueQueryKey() });
    void queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
    notify.success(`Removed ${project.name} from Flywheel`, {
      description: "Register the repository again to bring it back.",
    });
  }

  if (projects.length === 0) {
    // `App.tsx` renders `FirstRun` instead; this guard keeps the component honest on its own.
    return null;
  }

  return (
    // The `SidebarProvider` is the app shell in `App.tsx`, with the main pane as its `SidebarInset` (issue #191).
    // The rail's own widths are set here, on a box that draws nothing, so both the Sidebar's gap and its
    // fixed container read them.
    <div
      className="contents"
      style={{ "--sidebar-width": RAIL_WIDTH, "--sidebar-width-icon": RAIL_WIDTH_ICON } as React.CSSProperties}
    >
      <Sidebar collapsible="icon" className="border-sidebar-border">
        <nav aria-label="Projects" className="flex min-h-0 flex-1 flex-col">
          <SidebarHeader className="flex-row items-center gap-2.5 px-4 pt-4 pb-2 transition-[padding] group-data-[collapsible=icon]:px-3.5">
            {/* The HighKnow mark in its real colours (PRODUCT.md: the sidebar is one of the few surfaces that render
                a logo; issue #196): the #3c64dd tile with the white glyph, fixed in both schemes, as HighKnow's
                Wordmark draws it. The mark is identity, not a state colour (direction.md § The mark). A static file
                reference, never inline markup. */}
            <img src={logoUrl} alt="Flywheel by HighKnow" className="block size-7 shrink-0" />
            <span aria-hidden="true" className="truncate text-section font-bold group-data-[collapsible=icon]:hidden">
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
                  tooltip={rowTooltip(
                    waitingCount > 0 ? `Waiting on you · ${waitingCount}` : "Waiting on you",
                    "Every Gated action, permission request, question and shaping Round waiting on you, across every project",
                    collapsed,
                  )}
                  aria-current={fleetSurface?.view === "queue" ? "page" : undefined}
                  onClick={() => setFleetSurface({ view: "queue" })}
                  className={cn(rowClass, "relative", fleetSurface?.view === "queue" && currentClass)}
                >
                  <BellRing aria-hidden="true" />
                  <span className="flex-1">Waiting on you</span>
                  {waitingCount > 0 && (
                    // The one attention Badge in the rail. Folded to icons it rides the bell's corner, so what
                    // waits on you is still counted.
                    <Badge
                      variant="attention"
                      data-count="waiting"
                      className={cn(
                        figureClass,
                        "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:min-w-4 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:text-[10px]",
                      )}
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
                  tooltip={rowTooltip(
                    agents > 0 ? `All agents · ${agents}` : "All agents",
                    "Every agent across every project",
                    collapsed,
                  )}
                  aria-current={fleetSurface?.view === "fleet" ? "page" : undefined}
                  onClick={() => setFleetSurface({ view: "fleet" })}
                  className={cn(rowClass, fleetSurface?.view === "fleet" && currentClass)}
                >
                  <Activity aria-hidden="true" />
                  <span className="flex-1">All agents</span>
                  {agents > 0 && (
                    // An agent is a live session, Story or shaping (GLOSSARY.md "Agent"): the strip's own count (#199).
                    <span data-count="agents" className="text-small font-semibold text-muted-foreground tabular-nums">
                      {agents}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label="Open worktree inventory"
                  tooltip={rowTooltip(
                    "Worktrees",
                    "Every Story worktree across every project, with its disk usage",
                    collapsed,
                  )}
                  aria-current={worktreeInventoryOpen ? "page" : undefined}
                  onClick={() => setWorktreeInventoryOpen(true)}
                  className={cn(rowClass, worktreeInventoryOpen && currentClass)}
                >
                  <SquareStack aria-hidden="true" />
                  <span>Worktrees</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </Section>

            <Section id="rail-projects" label="Projects" visibleLabel>
              {projects.map((project, index) => {
                const isCurrent = project.id === hereProjectId;
                const isUnreachable = project.status === "unreachable";
                const needsYou = needsYouLists[index]?.data ?? [];
                const needsYouWords =
                  needsYou.length > 0 ? plural(needsYou.length, "item needs you", "items need you") : null;
                return (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      aria-label={isUnreachable ? `${project.name}, Unreachable` : project.name}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => onSelect(project)}
                      // The full name is always in the Tooltip: the row truncates a long one.
                      tooltip={{
                        hidden: false,
                        children: (
                          <span className="flex max-w-72 flex-col">
                            <span className="font-semibold break-words">
                              {project.name} <span className="font-mono font-normal">{project.keyPrefix}</span>
                            </span>
                            {isUnreachable && (
                              <span>Unreachable: Flywheel can't find its repository at {project.repoPath}</span>
                            )}
                            {needsYouWords && <span>{needsYouWords}</span>}
                          </span>
                        ),
                      }}
                      className={cn(
                        rowClass,
                        "h-auto min-h-9 py-1.5",
                        isCurrent && currentClass,
                        isUnreachable && "text-muted-foreground",
                      )}
                    >
                      {isUnreachable ? (
                        <TriangleAlert aria-hidden="true" className="mt-0.5 self-start text-destructive-text" />
                      ) : (
                        <>
                          <Folder
                            aria-hidden="true"
                            className="mt-0.5 self-start group-data-[collapsible=icon]:hidden"
                          />
                          {/* Folded to icons, the project shows its key prefix: every row a folder would be the same. */}
                          <span
                            aria-hidden="true"
                            className="hidden w-full justify-center font-mono text-[11px] leading-[18px] font-semibold group-data-[collapsible=icon]:flex"
                          >
                            {project.keyPrefix.slice(0, 3)}
                          </span>
                        </>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col items-start group-data-[collapsible=icon]:hidden">
                        <span className="flex max-w-full min-w-0 items-baseline gap-1.5">
                          <span className="truncate">{project.name}</span>
                          <StoryKey value={project.keyPrefix} className="text-subtle-foreground" />
                        </span>
                        {isUnreachable && (
                          // The word AND a glyph, never a colour change alone; its own line, so the name is
                          // never truncated to make room for it.
                          <span className="text-meta font-semibold text-destructive-text">Unreachable</span>
                        )}
                      </span>
                    </SidebarMenuButton>
                    {needsYou.length > 0 && (
                      // The project's figure, neutral: the attention Badge is Waiting on you's alone (issue #200).
                      // It gives its place to the project's menu while the row is hovered or focused.
                      <SidebarMenuBadge
                        className={cn(
                          trailingClass,
                          "transition-opacity duration-(--duration-feedback) group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0 group-has-[[data-state=open]]/menu-item:opacity-0",
                        )}
                      >
                        <Badge variant="secondary" data-count="needs-you" className={figureClass}>
                          {needsYou.length}
                        </Badge>
                      </SidebarMenuBadge>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction
                          showOnHover
                          aria-label={`Project actions for ${isUnreachable ? `${project.name}, Unreachable` : project.name}`}
                          className={cn(
                            trailingClass,
                            "size-5 transition-opacity duration-(--duration-feedback) data-[state=open]:bg-sidebar-accent data-[state=open]:opacity-100",
                          )}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start" className="min-w-52">
                        <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(project)}>
                          <FolderMinus aria-hidden="true" />
                          Remove from Flywheel…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                  aria-label="Register project…"
                  tooltip={rowTooltip("Register project…", "Register a git repository as a project", collapsed)}
                  onClick={() => void registerProjectFlow()}
                  className={cn(rowClass, "text-muted-foreground")}
                >
                  <Plus aria-hidden="true" />
                  <span>Register project…</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  aria-label="Open Settings"
                  tooltip={rowTooltip("Settings", null, collapsed)}
                  aria-current={settingsOpen ? "page" : undefined}
                  onClick={() => setSettingsOpen(true)}
                  className={cn(rowClass, "text-muted-foreground", settingsOpen && currentClass)}
                >
                  <Settings aria-hidden="true" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </nav>
      </Sidebar>
      <ConfirmDestructive
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.name ?? "this project"} from Flywheel?`}
        description="Its board, worktrees, runs and activity trail are all kept, and nothing is deleted. Register the repository again to bring it back."
        confirmLabel="Remove from Flywheel"
        icon={<FolderMinus aria-hidden="true" />}
        onConfirm={() => (removing ? removeProject(removing) : undefined)}
      />
    </div>
  );
}
