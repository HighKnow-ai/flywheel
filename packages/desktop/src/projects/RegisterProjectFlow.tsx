/**
 * The ONE registration flow every entry point shares (01-UI-SPEC.md "Project switcher (left
 * rail)": the rail's `+` affordance "opens the registration flow, the same flow as
 * File → Register Project… (⌘⇧O)"). `App.tsx` (⌘⇧O / the native File menu), `CommandPalette.tsx`
 * and `ProjectRail.tsx` all call `useRegisterProjectFlow`, so none of them re-derives "open the
 * native folder picker, derive a default name/key prefix from the directory name, call
 * `project_register`".
 *
 * Nothing in `useRegisterProjectFlow` opens a confirmation — like ⌘⇧O, it registers immediately
 * with the derived key prefix. First run (`FirstRun.tsx`) asks for the key in
 * `RegisterProjectDialog` below, because the very first project's key matters most: it becomes
 * immutable at the first item.
 *
 * How a failure is said (critique F4, issue #210): one human line, with the raw message folded
 * behind Details in the code face (`ActionFailure`) where there is a surface to hold it, and an
 * error toast (`useRegistrationErrorToast`) where there is none.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { ChevronRight, OctagonX } from "lucide-react";
import { useProjects, useRegisterProject, type Project } from "../board/useBoardQuery";
import { openFolderDialog } from "../adapters/tauri";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { notify } from "@/lib/notify";

/** How long a registration-failure notice stays visible before auto-clearing — the same
 * transient-notice duration `ProjectRail.tsx`'s pre-existing `alreadyRegistered` notice uses. */
const REGISTRATION_NOTICE_VISIBLE_MS = 4000;

/** A short, uppercase, greppable default derived from a repo path's directory name (D-10).
 * Always emits a prefix `domain/project.rs::validate_key_prefix` accepts (2-10 uppercase
 * letters/digits, starting with a letter) — a directory name like `2024-app` or a single-
 * character name used to derive a prefix that failed validation (CR-02/IN-01), leaving the entry
 * points that register immediately with nothing to show for a rejected registration. Pad short
 * results and force a leading letter rather than relying on every caller to handle it. */
export function deriveKeyPrefix(pathOrName: string): string {
  const base = pathOrName.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const alnum = base.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const candidate = alnum.slice(0, 4);
  const startsWithLetter = /^[A-Z]/.test(candidate);
  const prefixed = startsWithLetter ? candidate : `P${candidate}`.slice(0, 4);
  return prefixed.length >= 2 ? prefixed : "PRJ";
}

/** The folder's own name: a registered project's default name. */
export function folderName(repoPath: string): string {
  return repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
}

/** The raw message of a failure, which reaches the UI as a Tauri command's string or as an Error. */
export function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

/**
 * One human line for a registration that failed, so the raw message (a path, a git command and its exit
 * code) is the detail behind it, never the headline (critique F4).
 */
export function registrationFailureLine(error: unknown): string {
  const raw = failureMessage(error).toLowerCase();
  if (raw.includes("not a git repository")) {
    return "This folder isn’t a git repository. Pick the folder at the top of a git checkout.";
  }
  if (raw.includes("could not be resolved") || raw.includes("no such file")) {
    return "Flywheel couldn’t open this folder. It may have moved, or Flywheel may not be allowed to read it.";
  }
  if (raw.includes("key prefix")) {
    return "The project key must be 2 to 10 capital letters or digits, starting with a letter.";
  }
  return "Flywheel couldn’t add this folder. Nothing was written to the repository.";
}

/**
 * An action that failed, said the same way on the first-run and project surfaces: an Alert with what failed
 * as its title, one human line, and the raw message folded behind Details in the code face, where a git
 * command's `--show-toplevel` keeps its two hyphens (critique F4). `ReadError` is the same shape for a read.
 */
export function ActionFailure({ title, line, error }: { title: string; line: string; error: unknown }) {
  const raw = failureMessage(error);
  return (
    <Alert variant="destructive" data-slot="action-failure" className="gap-y-1.5">
      <OctagonX aria-hidden="true" />
      <AlertTitle className="text-body font-semibold">{title}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col items-start gap-2 text-small text-muted-foreground [&_p:not(:last-child)]:mb-0">
        <p className="m-0">{line}</p>
        {raw && (
          <Collapsible className="w-full min-w-0">
            <CollapsibleTrigger className="group/details inline-flex items-center gap-1 rounded-sm text-meta text-muted-foreground transition-colors hover:text-foreground">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[state=open]/details:rotate-90"
              />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre
                data-slot="action-failure-detail"
                className="m-0 mt-1.5 max-h-40 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-meta break-all whitespace-pre-wrap text-foreground [font-variant-ligatures:none]"
              >
                {raw}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** The folder picked for registration, waiting on its key. */
export interface PendingRegistration {
  repoPath: string;
  name: string;
}

/**
 * Register project's confirm step (critique F4): a Dialog that names the folder, asks for the project key in
 * a Field with its default filled in, and says what failed in an Alert above the buttons. The key becomes
 * permanent once the first item exists, which is why this step exists at all. A successful registration
 * replaces first run with the board, so the dialog needs no success state of its own.
 */
export function RegisterProjectDialog({
  pending,
  onOpenChange,
}: {
  /** The folder being registered; `null` closes the dialog. */
  pending: PendingRegistration | null;
  onOpenChange: (open: boolean) => void;
}) {
  const registerProject = useRegisterProject();
  const { reset } = registerProject;
  const [keyPrefix, setKeyPrefix] = useState("");
  // The last folder asked about, so the dialog keeps its words while it fades out after closing.
  const [shown, setShown] = useState<PendingRegistration | null>(pending);
  const keyId = useId();
  const pendingPath = pending?.repoPath ?? null;
  const pendingName = pending?.name ?? null;

  useEffect(() => {
    if (pendingPath === null || pendingName === null) return;
    setShown({ repoPath: pendingPath, name: pendingName });
    setKeyPrefix(deriveKeyPrefix(pendingName));
    reset();
  }, [pendingPath, pendingName, reset]);

  function setOpen(open: boolean) {
    if (!open && registerProject.isPending) return;
    onOpenChange(open);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!pending || registerProject.isPending) return;
    const prefix = keyPrefix.trim().toUpperCase();
    if (!prefix) return;
    registerProject.mutate({ name: pending.name, repoPath: pending.repoPath, keyPrefix: prefix });
  }

  const example = keyPrefix.trim().toUpperCase() || "KEY";
  return (
    <Dialog open={pending !== null} onOpenChange={setOpen}>
      <DialogContent className="gap-5 sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-section font-semibold">Register {shown?.name}</DialogTitle>
          {/* The folder the key is for: the dialog asks for a permanent key, so it says which folder that is. */}
          <DialogDescription className="font-mono text-small break-all">{shown?.repoPath}</DialogDescription>
        </DialogHeader>
        <form id={`${keyId}-form`} onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor={keyId}>Project key</FieldLabel>
            <Input
              id={keyId}
              className="font-mono tabular-nums"
              value={keyPrefix}
              onChange={(event) => setKeyPrefix(event.target.value.toUpperCase())}
              maxLength={10}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={registerProject.isError || undefined}
            />
            <FieldDescription>
              Every Story key starts with it, as in <span className="font-mono">{example}-1</span>. It can&rsquo;t
              change once the first Story exists.
            </FieldDescription>
          </Field>
          {registerProject.isError && (
            <ActionFailure
              title={`Couldn’t register ${shown?.name ?? "this folder"}`}
              line={registrationFailureLine(registerProject.error)}
              error={registerProject.error}
            />
          )}
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={registerProject.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form={`${keyId}-form`} loading={registerProject.isPending} disabled={!keyPrefix.trim()}>
            Register project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface RegisterProjectResult {
  project: Project;
  /**
   * True when the registered repository's marker already named a project this app already knew
   * about (re-registering the same repository, or adopting a clone of a project registered
   * elsewhere, D-15) — the caller may surface this so re-adopting a clone is a visible event,
   * never a silent one, without this module dictating HOW each caller shows it (a transient
   * notice in `ProjectRail.tsx`; ignored entirely by the keyboard/palette entry points, where a
   * user who explicitly re-registered a known repository is less likely to be surprised by it).
   */
  alreadyRegistered: boolean;
}

/**
 * `onRegistered` fires only after a SUCCESSFUL registration — a rejected/errored mutation is
 * left for the caller to surface however it already does, via the returned mutation state below.
 */
export function useRegisterProjectFlow(onRegistered?: (result: RegisterProjectResult) => void) {
  const projectsQuery = useProjects();
  const registerProject = useRegisterProject();

  async function registerProjectFlow() {
    const repoPath = await openFolderDialog();
    if (!repoPath) return;
    const name = folderName(repoPath);
    // Snapshot BEFORE the mutation — the query cache is invalidated/refetched on success, so this
    // is the only point at which "did we already know this project" can be answered.
    const knownIds = new Set((projectsQuery.data ?? []).map((project) => project.id));

    try {
      const project = await registerProject.mutateAsync({
        name,
        repoPath,
        keyPrefix: deriveKeyPrefix(name),
      });
      onRegistered?.({ project, alreadyRegistered: knownIds.has(project.id) });
    } catch {
      // Swallowed here — `registerProject.isError`/`registerProject.error` (returned below)
      // already carry the failure for whichever caller wants to render it. The user can retry
      // from any entry point.
    }
  }

  return {
    registerProjectFlow,
    isPending: registerProject.isPending,
    isError: registerProject.isError,
    error: registerProject.error,
  };
}

/**
 * Turns a `useRegisterProjectFlow` mutation's `isError`/`error` into a transient message string
 * that auto-clears after `REGISTRATION_NOTICE_VISIBLE_MS`, for a caller that draws its own inline
 * notice (`ProjectRail.tsx`). A caller with no surface of its own uses `useRegistrationErrorToast`.
 */
export function useRegistrationErrorNotice(isError: boolean, error: unknown): string | null {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isError) {
      // WR-01: a successful retry flips `isError` back to `false` before the previous failure's
      // timeout has fired — without this branch, the effect's cleanup cancels that pending
      // `clearTimeout` and then returns early here without ever clearing `message` itself,
      // leaving the stale "Couldn't register this project — …" notice on screen indefinitely.
      setMessage(null);
      return;
    }
    setMessage(`Couldn't register this project — ${failureMessage(error)}`);
    const timeout = window.setTimeout(() => setMessage(null), REGISTRATION_NOTICE_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [isError, error]);

  return message;
}

/**
 * A registration that failed from an entry point with no surface of its own (⌘⇧O, the File menu): an error
 * toast (DESIGN.md § Feedback, #198), titled with the outcome, its line the human reason.
 */
export function useRegistrationErrorToast(isError: boolean, error: unknown) {
  useEffect(() => {
    if (!isError) return;
    notify.error("Couldn’t register this project", { description: registrationFailureLine(error) });
  }, [isError, error]);
}
