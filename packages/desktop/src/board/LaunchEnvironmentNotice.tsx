/**
 * Issue #88: what Flywheel found when it read the login shell's PATH at startup. Shown only when something is
 * wrong: the login shell's PATH could not be read (the inherited one was kept), or `claude` is not on the
 * PATH a session will search. Each message names the PATH.
 *
 * Issue #210 (critique F6): an Alert in the layout's own flow, in a slot the shell reserves under the andon
 * strip (`App.tsx`) and above first run's floor (`FirstRun.tsx`). It is never fixed over the strip, so no
 * lamp is ever covered, and it offers the one thing to do about it: Open Settings, where the credential path
 * says what the missing `claude` means for sessions.
 */
import { useQuery } from "@tanstack/react-query";
import { Settings, TriangleAlert } from "lucide-react";
import { invokeCommand, type LaunchEnvironmentDto } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";
import { Alert, AlertDescription, AlertTitle, cn } from "@highknow/design";
import { Button } from "@/components/Button";

export const LAUNCH_ENVIRONMENT_QUERY_KEY = ["launch_environment"] as const;

export function LaunchEnvironmentNotice({ className }: { className?: string }) {
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  // Through `invokeCommand` itself, so a test that stubs only `invokeCommand` still renders.
  const query = useQuery({
    queryKey: LAUNCH_ENVIRONMENT_QUERY_KEY,
    queryFn: () => invokeCommand<LaunchEnvironmentDto | undefined>("launch_environment"),
  });
  const claudeError = query.data?.claudeError || null;
  const pathWarning = query.data?.pathWarning || null;
  if (!claudeError && !pathWarning) return null;
  const title = claudeError ? "Flywheel can’t find claude" : "Flywheel couldn’t read your login shell’s PATH";
  return (
    <div data-slot="launch-environment-slot" className={cn("shrink-0 px-5 pt-3", className)}>
      <Alert variant="destructive" aria-label="Launch environment" className="gap-y-1 py-2.5">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle className="text-body font-semibold">{title}</AlertTitle>
        <AlertDescription className="flex min-w-0 flex-col items-start gap-1.5 text-small text-muted-foreground [overflow-wrap:anywhere] [&_p:not(:last-child)]:mb-0">
          {[claudeError, pathWarning]
            .filter((message): message is string => Boolean(message))
            .map((message) => (
              <p key={message} className="m-0">
                {message}
              </p>
            ))}
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings aria-hidden="true" />
            Open Settings
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
