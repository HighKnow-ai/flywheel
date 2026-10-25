/**
 * The ⌘K palette (direction.md § Components: `Command` inside `Dialog`): find a Story in the current
 * project and open it, or go to a place. It is an accelerator, never the only path: every entry here
 * also has a visible control in the sidebar, the strip or a surface header.
 *
 * Opening a Story from here follows the click model like everywhere else: it opens the Story, never its
 * session. Opened by ⌘K (the `open-palette` binding), the search field in every surface header, and the
 * native menu; `paletteOpen` lives in the UI store because the Escape ladder reads it.
 */
import { useQuery } from "@tanstack/react-query";
import { Activity, BellRing, Folder, FolderPlus, Settings, SquareStack } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { storyListForProject } from "../adapters/tauri";
import type { Project } from "../board/useBoardQuery";
import { StateBadge } from "../components/StateBadge";
import { useRegisterProjectFlow } from "../projects/RegisterProjectFlow";
import { useGlobalBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";

/**
 * Words, not scattered letters: every word typed must begin a word of the item (its key, its title, or the
 * hidden words of a place), so "set" finds Settings and not every title holding an s, an e and a t in order,
 * which is what cmdk's fuzzy default does. Items keep their listed order.
 */
export function matchWords(value: string, search: string, keywords?: string[]): number {
  const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => startsAWord(haystack, word)) ? 1 : 0;
}

function startsAWord(haystack: string, word: string): boolean {
  for (let at = haystack.indexOf(word); at !== -1; at = haystack.indexOf(word, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(haystack[at - 1])) return true;
  }
  return false;
}

export function CommandPalette({ projects, currentProjectId }: { projects: Project[]; currentProjectId: string }) {
  const open = useUiStore((state) => state.paletteOpen);
  const setOpen = useUiStore((state) => state.setPaletteOpen);
  const openStory = useUiStore((state) => state.openStory);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const setWorktreeInventoryOpen = useUiStore((state) => state.setWorktreeInventoryOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const { registerProjectFlow } = useRegisterProjectFlow();
  useGlobalBindings({ "open-palette": () => setOpen(true) });

  // The board's own read, so the palette lists exactly what the board shows.
  const storiesQuery = useQuery({
    queryKey: ["board", currentProjectId, "stories"],
    queryFn: () => storyListForProject(currentProjectId),
    enabled: open,
  });
  const stories = storiesQuery.data ?? [];

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search Flywheel"
      description="Find a Story or go to a place."
      className="sm:max-w-xl"
      filter={matchWords}
    >
      <CommandInput placeholder="Find a Story, a project or a place" />
      <CommandList className="max-h-96">
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {stories.length > 0 && (
          <CommandGroup heading="Stories">
            {stories.map((story) => (
              <CommandItem
                key={story.id}
                value={`${story.key} ${story.title}`}
                onSelect={() => run(() => openStory(currentProjectId, story.id))}
              >
                <StateBadge state={story.state} hideLabel className="size-6 justify-center p-0" />
                <span className="min-w-[6ch] shrink-0 font-mono text-small text-muted-foreground">{story.key}</span>
                <span className="truncate">{story.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Projects">
          {projects.map((project, index) => (
            <CommandItem
              key={project.id}
              value={`project ${project.name} ${project.keyPrefix}`}
              onSelect={() => run(() => setCurrentProjectId(project.id))}
            >
              <Folder aria-hidden="true" />
              <span className="truncate">{project.name}</span>
              {index < 9 && <CommandShortcut>{`⌘${index + 1}`}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Places">
          <CommandItem value="Waiting on you requests" onSelect={() => run(() => setFleetSurface({ view: "queue" }))}>
            <BellRing aria-hidden="true" />
            Waiting on you
          </CommandItem>
          <CommandItem value="All agents fleet" onSelect={() => run(() => setFleetSurface({ view: "fleet" }))}>
            <Activity aria-hidden="true" />
            All agents
            <CommandShortcut>⇧⌘F</CommandShortcut>
          </CommandItem>
          <CommandItem value="Worktrees inventory" onSelect={() => run(() => setWorktreeInventoryOpen(true))}>
            <SquareStack aria-hidden="true" />
            Worktrees
          </CommandItem>
          <CommandItem value="Settings" onSelect={() => run(() => setSettingsOpen(true))}>
            <Settings aria-hidden="true" />
            Settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem value="Register project" onSelect={() => run(() => void registerProjectFlow())}>
            <FolderPlus aria-hidden="true" />
            Register project…
            <CommandShortcut>⇧⌘O</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
