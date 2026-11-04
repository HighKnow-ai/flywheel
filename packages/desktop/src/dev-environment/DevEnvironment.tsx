/**
 * Issue #786: a development build's hidden Environment picker, and the indicator that says which
 * Environment the install talks to while it is not production.
 *
 * Hidden: no menu item, no palette entry, no Settings row. ⌘⌥⇧E opens it, and so does the
 * indicator, which shows only while the chosen Environment is not production, so a build talking
 * to staging or a temporary Environment never looks like one talking to production. The Rust core
 * holds the hostnames and the choice (`flywheel_core::environment`); this module only asks for it
 * and shows it.
 *
 * NOT IN A RELEASE BUILD. App.tsx loads this module only behind `import.meta.env.DEV`, which
 * `vite build` replaces with `false`, so the bundle carries neither this module nor the command
 * names below, and a release binary registers no such command anyway (`main.rs`). `npm run build`
 * ends with `scripts/release/check-release-bundle.mjs dist`, which fails the build if either
 * leaked in. That is also why the DTO and the two invokes live here and not in
 * `adapters/tauri.ts`: nothing a release bundle holds may name them.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeCommand } from "../adapters/tauri";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
} from "@highknow/design";

/** Mirrors `commands/dev_environment.rs`'s `DevEnvironmentDto`. */
export interface DevEnvironmentDto {
  /** `production`, `staging`, or `env-<name>`. */
  name: string;
  apiOrigin: string;
  production: boolean;
}

export type DevEnvironmentTier = "production" | "staging" | "temporary";

export const DEV_ENVIRONMENT_QUERY_KEY = ["dev_environment"] as const;

/** ⌘⌥⇧E. Read from `code`, since ⌥ turns `key` into another character on macOS. */
export function isPickerChord(event: KeyboardEvent): boolean {
  return event.metaKey && event.altKey && event.shiftKey && !event.ctrlKey && event.code === "KeyE";
}

const TIERS: readonly { value: DevEnvironmentTier; title: string; description: string }[] = [
  { value: "production", title: "Production", description: "What every release build uses." },
  { value: "staging", title: "Staging", description: "The long-lived copy of production." },
  { value: "temporary", title: "Temporary", description: "A short-lived copy, by its name." },
];

function tierOf(environment: DevEnvironmentDto | undefined): DevEnvironmentTier {
  if (!environment || environment.production) return "production";
  return environment.name === "staging" ? "staging" : "temporary";
}

export function DevEnvironment() {
  const [open, setOpen] = useState(false);
  // Through `invokeCommand` itself, so a test that stubs only `invokeCommand` still renders.
  const query = useQuery({
    queryKey: DEV_ENVIRONMENT_QUERY_KEY,
    queryFn: () => invokeCommand<DevEnvironmentDto | undefined>("dev_environment_get"),
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isPickerChord(event)) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const environment = query.data ?? undefined;
  return (
    <>
      {environment && !environment.production ? (
        <button
          type="button"
          data-slot="dev-environment-indicator"
          onClick={() => setOpen(true)}
          aria-label={`Environment: ${environment.name}. Choose another`}
          className="fixed bottom-2 left-1/2 z-50 -translate-x-1/2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Badge variant="outline" className="bg-background font-mono text-muted-foreground">
            {environment.name}
          </Badge>
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {open ? <PickerForm current={environment} onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PickerForm({ current, onDone }: { current: DevEnvironmentDto | undefined; onDone: () => void }) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const [tier, setTier] = useState<DevEnvironmentTier>(tierOf(current));
  const [name, setName] = useState(current && tierOf(current) === "temporary" ? current.name : "");
  const choose = useMutation({
    mutationFn: () =>
      invokeCommand<DevEnvironmentDto>("dev_environment_choose", {
        tier,
        name: tier === "temporary" ? name : null,
      }),
    onSuccess: (chosen) => {
      queryClient.setQueryData(DEV_ENVIRONMENT_QUERY_KEY, chosen);
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    choose.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Environment</DialogTitle>
        <DialogDescription>
          {current ? `This build talks to ${current.name}, at ${current.apiOrigin}.` : "Development builds only."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <RadioGroup
          aria-label="Environment"
          value={tier}
          onValueChange={(next) => setTier(next as DevEnvironmentTier)}
          className="grid gap-2"
        >
          {TIERS.map((option) => {
            const id = `${baseId}-${option.value}`;
            return (
              <FieldLabel key={option.value} htmlFor={id}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle id={`${id}-title`}>{option.title}</FieldTitle>
                    <FieldDescription>{option.description}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem id={id} value={option.value} aria-labelledby={`${id}-title`} />
                </Field>
              </FieldLabel>
            );
          })}
        </RadioGroup>
        {tier === "temporary" ? (
          <Field>
            <FieldLabel htmlFor={`${baseId}-name`}>Name</FieldLabel>
            <Input
              id={`${baseId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="demo"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </Field>
        ) : null}
        {choose.isError ? <FieldError>{String(choose.error)}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={choose.isPending || (tier === "temporary" && name.trim() === "")}>
          Use this Environment
        </Button>
      </DialogFooter>
    </form>
  );
}
