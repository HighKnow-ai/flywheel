import { notify as designNotify } from "@highknow/design";

/**
 * After-action feedback (DESIGN.md § Feedback): the one way a screen says what an action just did, through the
 * design system's one `Toaster` (mounted in App.tsx). A toast is for the outcome of something the Developer did
 * (Merged, Discarded, Moved to Epic E-3), never for state the board already shows, and never in place of an
 * inline error on the control that failed.
 *
 *   notify.success("Story moved to E-3", { undo: () => move(back) })
 *   notify.error("Couldn't merge FLY-12", { error })
 *
 * Words: the title says what happened in the past tense, naming the record; a description is one line.
 * Undo is offered for a reversible action and keeps the toast up long enough to reach it. The package carries
 * no copy, so "Undo" is Flywheel's word, passed in here.
 */

export interface NotifyOptions {
  /** One line under the title. */
  description?: string;
  /** Offers Undo; called once if the Developer takes it. */
  undo?: () => void;
  /** A next step that is not Undo ("Open board"); ignored when `undo` is given. */
  action?: { label: string; onClick: () => void };
  /** Replaces a toast already up (by the id an earlier call returned) instead of stacking another. */
  id?: string | number;
}

export interface NotifyErrorOptions extends Omit<NotifyOptions, "undo"> {
  /** The failure; its message is the description when none is given. */
  error?: unknown;
}

export const notify = {
  /** An action finished: "Story moved to E-3". With `undo` or an action, the toast stays eight seconds. */
  success(title: string, options: NotifyOptions = {}): string | number {
    const { description, undo, action, id } = options;
    return designNotify.success(title, {
      description,
      id,
      action: undo ? { label: "Undo", onClick: () => undo() } : action,
    });
  },

  /** An action failed: "Couldn't merge FLY-12", with the failure's own message as the line beneath. */
  error(title: string, options: NotifyErrorOptions = {}): string | number {
    const { description, error, id } = options;
    return designNotify.error(title, { description, error, id });
  },

  /** Takes a toast down early (after its action is overtaken, say). */
  dismiss(id?: string | number): void {
    designNotify.dismiss(id);
  },
};
