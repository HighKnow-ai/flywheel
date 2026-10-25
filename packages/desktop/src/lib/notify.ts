import { toast } from "sonner";

/**
 * After-action feedback (DESIGN.md § Feedback): the one way a screen says what an action just did. A toast is
 * for the outcome of something the Developer did (Merged, Discarded, Moved to Epic E-3), never for state the
 * board already shows, and never in place of an inline error on the control that failed.
 *
 *   notify.success("Story moved to E-3", { undo: () => move(back) })
 *   notify.error("Couldn't merge FLY-12", { error })
 *
 * Words: the title says what happened in the past tense, naming the record; a description is one line.
 * Undo is offered for a reversible action and keeps the toast up long enough to reach it.
 */

const SUCCESS_MS = 4000;
const UNDO_MS = 8000;
const ERROR_MS = 8000;

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

function errorLine(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return undefined;
}

export const notify = {
  /** An action finished: "Story moved to E-3". With `undo`, the toast offers Undo for eight seconds. */
  success(title: string, options: NotifyOptions = {}): string | number {
    const { description, undo, action, id } = options;
    return toast.success(title, {
      id,
      description,
      duration: undo || action ? UNDO_MS : SUCCESS_MS,
      action: undo
        ? { label: "Undo", onClick: () => undo() }
        : action
          ? { label: action.label, onClick: () => action.onClick() }
          : undefined,
    });
  },

  /** An action failed: "Couldn't merge FLY-12", with the failure's own message as the line beneath. */
  error(title: string, options: NotifyErrorOptions = {}): string | number {
    const { description, error, id } = options;
    return toast.error(title, {
      id,
      description: description ?? errorLine(error),
      duration: ERROR_MS,
      closeButton: true,
    });
  },

  /** Takes a toast down early (after its action is overtaken, say). */
  dismiss(id?: string | number): void {
    toast.dismiss(id);
  },
};
