/**
 * Behavior under test (01-06-PLAN.md Task 3, component bullet): with zero criteria the list
 * renders its empty form (the inline composer opens on its own, mirroring the board's own
 * zero-item empty state) and the Done warning does not render; with two of three criteria
 * checked, the badge reads `2/3`.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcceptanceCriteriaList, type CriterionDto } from "../AcceptanceCriteriaList";
import { DoneWarning } from "../../board/DoneWarning";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
}));

function renderList(criteria: CriterionDto[]) {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "criterion_list") {
      return Promise.resolve(criteria);
    }
    return Promise.resolve(undefined);
  });

  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AcceptanceCriteriaList parentType="task" parentId="task-1" projectId="proj-1" />
    </QueryClientProvider>,
  );
}

const THREE_CRITERIA: CriterionDto[] = [
  {
    id: "c1",
    parentType: "task",
    parentId: "task-1",
    statement: "Handles empty input",
    verificationHint: "cargo test -p core",
    checked: true,
    rank: "1",
  },
  {
    id: "c2",
    parentType: "task",
    parentId: "task-1",
    statement: "Rejects malformed data",
    verificationHint: null,
    checked: true,
    rank: "2",
  },
  {
    id: "c3",
    parentType: "task",
    parentId: "task-1",
    statement: "Logs the rejection reason",
    verificationHint: "manual check",
    checked: false,
    rank: "3",
  },
];

describe("AcceptanceCriteriaList", () => {
  it("renders its empty form when the parent has zero criteria", async () => {
    renderList([]);

    // The inline composer opens on its own (mirrors the board's own zero-item empty state) —
    // this IS the empty form, not a static message.
    const statementInput = await screen.findByLabelText("New criterion statement");
    expect(statementInput).toBeInTheDocument();
    // Focus lands in the composer via a follow-on effect — wait for it rather than racing it.
    await waitFor(() => expect(document.activeElement).toBe(statementInput));

    // The header badge reads 0/0 for a parent with no criteria.
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("reads 2/3 when two of three criteria are checked", async () => {
    renderList(THREE_CRITERIA);

    await waitFor(() => expect(screen.getByText("Handles empty input")).toBeInTheDocument());

    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("Rejects malformed data")).toBeInTheDocument();
    expect(screen.getByText("Logs the rejection reason")).toBeInTheDocument();
    expect(screen.getByText("cargo test -p core")).toBeInTheDocument();
  });

  it("is keyboard-operable: n opens the composer when criteria already exist", async () => {
    renderList(THREE_CRITERIA);

    await waitFor(() => expect(screen.getByText("Handles empty input")).toBeInTheDocument());
    expect(screen.queryByLabelText("New criterion statement")).not.toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Criteria" });
    fireEvent.keyDown(list, { key: "n" });

    expect(await screen.findByLabelText("New criterion statement")).toBeInTheDocument();
  });

  it("toggles the focused criterion on Enter without a pointer", async () => {
    renderList(THREE_CRITERIA);

    await waitFor(() => expect(screen.getByText("Logs the rejection reason")).toBeInTheDocument());

    const list = screen.getByRole("list", { name: "Criteria" });
    // Three "j" presses from no selection walk: null -> c1 -> c2 -> c3 (the third, unchecked row).
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "Enter" });

    // `mutate()` invokes its mutationFn (and therefore `invokeCommand`) asynchronously.
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("criterion_toggle", { criterionId: "c3" }),
    );
  });
});

describe("DoneWarning — never fires when there is nothing to warn about", () => {
  it("renders nothing when the criteria total is zero", () => {
    const { container } = render(
      <DoneWarning checked={0} total={0} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when every criterion is already checked", () => {
    const { container } = render(
      <DoneWarning checked={3} total={3} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the exact copy and confirms on Enter when criteria are unchecked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(<DoneWarning checked={2} total={3} onConfirm={onConfirm} onCancel={onCancel} />);

    const dialog = screen.getByRole("alertdialog");
    expect(screen.getByText("2/3 criteria unchecked. Mark Done anyway?")).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape without confirming", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(<DoneWarning checked={0} total={2} onConfirm={onConfirm} onCancel={onCancel} />);

    const dialog = screen.getByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
