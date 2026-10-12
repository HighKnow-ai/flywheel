import { useMutation } from "@tanstack/react-query";
import { settingsSetNotificationsEnabled, type SettingsDto } from "../adapters/tauri";
import "../styles/admin-surfaces.css";

/**
 * The one global OS-notification switch (FLEET-05, D-176): a single checkbox covering an agent that
 * blocks, finishes or fails. Controlled by the stored value, so a refused set snaps back. There is
 * deliberately no per-project control here.
 */
export function NotificationsControl({ settings, onChanged }: { settings: SettingsDto; onChanged: () => void }) {
  const mutation = useMutation({
    mutationFn: (value: boolean) => settingsSetNotificationsEnabled(value),
    onSettled: onChanged,
  });
  return (
    <label className="type-body" style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
      <input
        type="checkbox"
        data-testid="notifications-switch"
        className="admin-check"
        style={{ marginTop: 0 }}
        checked={settings.notificationsEnabled}
        disabled={mutation.isPending}
        onChange={(event) => mutation.mutate(event.target.checked)}
      />
      Notify when an agent blocks, finishes or fails
    </label>
  );
}
