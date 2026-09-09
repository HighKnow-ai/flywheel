/**
 * The ONE registration flow every entry point shares (01-UI-SPEC.md "Project switcher (left
 * rail)": the rail's `+` affordance "opens the registration flow, the same flow as
 * File → Register Project… (⌘⇧O)"). Before this plan, `App.tsx` (⌘⇧O / the native File menu) and
 * `CommandPalette.tsx` ("Register Project…") each hand-rolled their own copy of "open the native
 * folder picker, derive a default name/key prefix from the directory name, call
 * `project_register`" — this module is the single place that sequence lives now, so a future
 * fourth entry point (`ProjectRail.tsx`'s `+` button, this plan) never re-derives it a third
 * time.
 *
 * Nothing here opens a confirmation dialog — like ⌘⇧O today, the flow registers immediately with
 * the derived key prefix. `FirstRun.tsx`'s own two-step confirm-the-prefix flow (the very first
 * project a fresh install ever registers, where getting the prefix right matters more because it
 * becomes immutable at the first item) is intentionally left as its own, separate path — it
 * predates this plan and is not one of this plan's `<files>`.
 */
import { useEffect, useState } from "react";
import { useProjects, useRegisterProject, type Project } from "../board/useBoardQuery";
import { deriveKeyPrefix } from "../board/FirstRun";
import { openFolderDialog } from "../adapters/tauri";

/** How long a registration-failure notice stays visible before auto-clearing — the same
 * transient-notice duration `ProjectRail.tsx`'s pre-existing `alreadyRegistered` notice uses. */
const REGISTRATION_NOTICE_VISIBLE_MS = 4000;

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
 * left for the caller to surface however it already does (mirrors `FirstRun.tsx`'s own
 * `registerProject.isError` pattern), via the returned mutation state below.
 */
export function useRegisterProjectFlow(onRegistered?: (result: RegisterProjectResult) => void) {
  const projectsQuery = useProjects();
  const registerProject = useRegisterProject();

  async function registerProjectFlow() {
    const repoPath = await openFolderDialog();
    if (!repoPath) return;
    const name = repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
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
      // already carry the failure for whichever caller wants to render it, mirroring the
      // existing `registerProject.isError` pattern `FirstRun.tsx` uses. A caller that ignores
      // both (⌘⇧O, the palette) simply leaves the picker's chosen folder unregistered — the
      // user can retry from any entry point.
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
 * that auto-clears after `REGISTRATION_NOTICE_VISIBLE_MS` — the one shared "how a registration
 * failure is worded and how long it stays visible" every caller reuses (CR-02), rather than each
 * of the three entry points that discard `isError`/`error` today re-deriving its own copy and
 * timeout. Mirrors `FirstRun.tsx`'s own inline `registerProject.isError` copy
 * ("Couldn't register this project — {message}") — the caller renders the returned string in
 * whatever container fits its surface (a fixed toast in `CommandPalette.tsx`, an inline notice in
 * `ProjectRail.tsx`/`App.tsx`), styled with `type-label` and `var(--destructive-strip)` the same
 * way `FirstRun.tsx` already does, so there is exactly one error idiom, not a second one invented
 * per call site.
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
    setMessage(`Couldn't register this project — ${(error as Error).message}`);
    const timeout = window.setTimeout(() => setMessage(null), REGISTRATION_NOTICE_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [isError, error]);

  return message;
}
