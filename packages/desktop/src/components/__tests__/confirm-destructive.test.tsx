import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Trash2 } from "lucide-react";
import { ConfirmDestructive } from "@/components/ConfirmDestructive";
import { Button } from "@/components/ui/button";

function renderDrop(onConfirm: () => unknown) {
  render(
    <ConfirmDestructive
      trigger={<Button variant="destructive">Drop</Button>}
      title="Drop FLY-12?"
      description="The Story leaves the board."
      confirmLabel="Drop the Story"
      icon={<Trash2 aria-hidden="true" />}
      onConfirm={onConfirm}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Drop" }));
  return screen.getByRole("alertdialog");
}

describe("ConfirmDestructive", () => {
  it("asks the question, with Cancel on the left as outline and the action on the right as destructive", () => {
    const dialog = renderDrop(() => {});
    expect(dialog).toHaveTextContent("Drop FLY-12?");
    expect(dialog).toHaveTextContent("The Story leaves the board.");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const action = screen.getByRole("button", { name: "Drop the Story" });
    expect(cancel).toHaveAttribute("data-variant", "outline");
    expect(action).toHaveAttribute("data-variant", "destructive");
    // Cancel comes first in the footer: left in a row.
    expect(cancel.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Cancel closes without acting", async () => {
    const onConfirm = vi.fn();
    renderDrop(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the action pending until its promise settles, then closes", async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderDrop(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Drop the Story" }));
    const action = screen.getByRole("button", { name: "Drop the Story" });
    expect(action).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // A second press while pending does nothing.
    fireEvent.click(action);
    expect(onConfirm).toHaveBeenCalledOnce();
    resolve();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("stays open with the failure's message when the action fails", async () => {
    renderDrop(() => Promise.reject(new Error("the worktree is locked")));
    fireEvent.click(screen.getByRole("button", { name: "Drop the Story" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("the worktree is locked");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop the Story" })).not.toHaveAttribute("aria-busy");
  });

  it("can be controlled", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDestructive
        open
        onOpenChange={onOpenChange}
        title="Stop FLY-12's agent?"
        description="The session ends now."
        confirmLabel="Stop the session"
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop the session" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
