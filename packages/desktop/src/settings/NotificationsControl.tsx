import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { Field, FieldContent, FieldDescription, FieldLabel, Switch } from "@highknow/design";
import { notify } from "@/lib/notify";
import { settingsSetNotificationsEnabled, type SettingsDto } from "../adapters/tauri";

/**
 * The one global OS-notification switch (FLEET-05, D-176), covering an agent that blocks, finishes or fails.
 * It shows the stored value, or the value being saved while the write is in flight, so a refused set snaps
 * back. There is deliberately no per-project control here.
 */
export function NotificationsControl({ settings, onChanged }: { settings: SettingsDto; onChanged: () => void }) {
  const id = useId();
  const mutation = useMutation({
    mutationFn: (value: boolean) => settingsSetNotificationsEnabled(value),
    onSuccess: (_data, value) => notify.success(value ? "Notifications turned on" : "Notifications turned off"),
    onError: (error) => notify.error("Couldn't change notifications", { error }),
    onSettled: onChanged,
  });
  const checked = mutation.isPending
    ? (mutation.variables ?? settings.notificationsEnabled)
    : settings.notificationsEnabled;
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>Notify when an agent blocks, finishes or fails</FieldLabel>
        <FieldDescription>A macOS notification, for every project.</FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        data-testid="notifications-switch"
        checked={checked}
        disabled={mutation.isPending}
        onCheckedChange={(value) => mutation.mutate(value)}
      />
    </Field>
  );
}
