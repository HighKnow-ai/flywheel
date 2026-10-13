/**
 * Rust's overlap warning for a launch the user started over a live task (plan 09-13), lifted out of
 * `App.tsx` so it can be tested without an App render harness (D-REV-43). Display state only: the
 * durable record is the `task.launch_overlap` event the launch appended. The sentence is Rust's,
 * shown verbatim and never recomputed here.
 */
import { useEffect } from "react";

export function LaunchOverlapToast({
  warning,
  onDismiss,
  timeoutMs = 15000,
}: {
  warning: string | null;
  onDismiss: () => void;
  timeoutMs?: number;
}) {
  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(timer);
  }, [warning, onDismiss, timeoutMs]);

  if (!warning) return null;
  return (
    <div
      role="note"
      aria-label="Launch overlap warning"
      className="type-label"
      style={{
        position: "fixed",
        bottom: "var(--space-lg)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1400,
        color: "var(--destructive-text-rack)",
        background: "var(--surface-secondary)",
        border: "1px solid var(--divider)",
        borderRadius: "var(--radius-chrome)",
        padding: "var(--space-sm) var(--space-md)",
        maxWidth: "80vw",
        display: "flex",
        gap: "var(--space-md)",
        alignItems: "baseline",
      }}
    >
      <span>{warning}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="type-label"
        style={{ background: "transparent", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0 }}
      >
        Dismiss
      </button>
    </div>
  );
}
