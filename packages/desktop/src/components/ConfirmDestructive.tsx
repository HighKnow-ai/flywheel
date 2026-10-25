import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

function errorLine(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Something went wrong.";
}

/**
 * The one confirmation for an action that cannot be taken back (DESIGN.md § Feedback): Stop, Discard, Kill,
 * Drop, Remove, Reclaim. An AlertDialog with the question as its title ("Stop FLY-12's agent?"), the
 * consequence as one line, Cancel on the left as outline and the action on the right as `destructive`, named
 * by its verb and object ("Stop the session"), never "OK" or "Yes".
 *
 * `onConfirm` may return a promise: the action shows as pending (Button `loading`) and the dialog can't be
 * dismissed until it settles; it closes on success, and on failure stays open with the failure's message,
 * so the Developer can try again or cancel. Open it from a `trigger`, or control it with `open` and
 * `onOpenChange`.
 *
 *   <ConfirmDestructive
 *     trigger={<Button variant="destructive"><Trash2 aria-hidden="true" />Drop</Button>}
 *     title="Drop FLY-12?"
 *     description="The Story leaves the board. Its worktree and branch are kept."
 *     confirmLabel="Drop the Story"
 *     icon={<Trash2 aria-hidden="true" />}
 *     onConfirm={() => dropStory.mutateAsync(id)}
 *   />
 */
export function ConfirmDestructive({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  icon,
  onConfirm,
  children,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** The action's icon, as on the button that opened the dialog. */
  icon?: ReactNode;
  onConfirm: () => unknown;
  /** Anything more the decision needs, between the description and the buttons. */
  children?: ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = openProp ?? openState;

  function setOpen(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  }

  async function confirm() {
    if (pending) return;
    setError(null);
    let result: unknown;
    try {
      result = onConfirm();
    } catch (caught) {
      setError(errorLine(caught));
      return;
    }
    if (result instanceof Promise) {
      setPending(true);
      try {
        await result;
      } catch (caught) {
        setPending(false);
        setError(errorLine(caught));
        return;
      }
      setPending(false);
    }
    if (openProp === undefined) setOpenState(false);
    onOpenChange?.(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      {/* The content's own `data-[size=default]:sm:max-w-sm` outranks a bare `sm:max-w-md`, so the width names the
          same variant; a long object name in the title wraps instead of widening the dialog. */}
      <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-section font-semibold wrap-anywhere">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error && (
          <p role="alert" className="m-0 text-small text-destructive-text">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button variant="destructive" loading={pending} onClick={() => void confirm()}>
            {icon}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
