/**
 * Issue #88: what Flywheel found when it read the login shell's PATH at startup. Shown on every
 * surface, only when something is wrong: the login shell's PATH could not be read (the inherited
 * one was kept), or `claude` is not on the PATH a session will search. Each message names the PATH.
 */
import { useQuery } from "@tanstack/react-query";
import { invokeCommand, type LaunchEnvironmentDto } from "../adapters/tauri";

export const LAUNCH_ENVIRONMENT_QUERY_KEY = ["launch_environment"] as const;

export function LaunchEnvironmentNotice() {
  // Through `invokeCommand` itself, so a test that stubs only `invokeCommand` still renders.
  const query = useQuery({
    queryKey: LAUNCH_ENVIRONMENT_QUERY_KEY,
    queryFn: () => invokeCommand<LaunchEnvironmentDto | undefined>("launch_environment"),
  });
  const messages = [query.data?.pathWarning, query.data?.claudeError].filter(
    (message): message is string => typeof message === "string" && message.length > 0,
  );
  if (messages.length === 0) return null;
  return (
    <div
      role="alert"
      aria-label="Launch environment"
      className="type-label"
      style={{
        position: "fixed",
        top: "var(--space-md)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1400,
        color: "var(--destructive-strip)",
        background: "var(--surface-secondary)",
        border: "1px solid var(--divider)",
        borderRadius: "var(--radius-chrome)",
        padding: "var(--space-sm) var(--space-md)",
        maxWidth: "80vw",
        overflowWrap: "anywhere",
      }}
    >
      {messages.map((message) => (
        <p key={message} style={{ margin: 0 }}>
          {message}
        </p>
      ))}
    </div>
  );
}
