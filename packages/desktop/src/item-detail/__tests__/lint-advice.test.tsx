/**
 * Behavior under test (phase 15 plan 06, D-25): the lint that refuses an agent's draft is shown to a
 * human typing the same criterion as ADVICE — beside the field, in muted ink, never an alert, never
 * focus-stealing — and the save path is untouched. A human's text is never refused.
 *
 * The composer has no Save button: Enter on the statement moves to the hint, Enter on the hint
 * saves. "Save stays available" therefore means that sequence still creates the criterion with the
 * advice on screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcceptanceCriteriaList, type CriterionDto } from "../AcceptanceCriteriaList";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
}));

const COMPOUND = "Rejects an empty title and logs the refusal";
const CLEAN = "Rejects an empty title with a named error";
const ADVICE = 'criterion refused as compound: it joins two claims with "and".';

const EXISTING: CriterionDto = {
  id: "c1",
  parentType: "task",
  parentId: "task-1",
  statement: "Returns 404 for an unknown id",
  verificationHint: "curl",
  checked: false,
  rank: "1",
  revision: 1,
  revisionOf: null,
  supersededAt: null,
};

function renderList(criteria: CriterionDto[] = []) {
  invokeCommandMock.mockReset().mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "criterion_list") return Promise.resolve(criteria);
    if (command === "review_criteria_state") return Promise.resolve([]);
    if (command === "criterion_lint_advice") {
      return Promise.resolve(String(args?.statement).includes(" and ") ? ADVICE : null);
    }
    return Promise.resolve(undefined);
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AcceptanceCriteriaList parentType="task" parentId="task-1" projectId="proj-1" />
    </QueryClientProvider>,
  );
}

const creates = () => invokeCommandMock.mock.calls.filter(([command]) => command === "criterion_create");
const advice = () => screen.queryByRole("note", { name: "Criterion advice" });

async function typeStatement(text: string) {
  const input = await screen.findByLabelText("New criterion statement");
  fireEvent.change(input, { target: { value: text } });
  return input;
}

beforeEach(() => invokeCommandMock.mockReset());

describe("criterion lint advice on human-typed text", () => {
  it("shows the core's sentence beside the field and leaves the field usable", async () => {
    renderList();
    const input = await typeStatement(COMPOUND);

    expect(await screen.findByRole("note", { name: "Criterion advice" })).toHaveTextContent(ADVICE);
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute("readonly");
  });

  it("saves the same statement anyway: a human's text is never refused", async () => {
    renderList();
    const input = await typeStatement(COMPOUND);
    await screen.findByRole("note", { name: "Criterion advice" });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(await screen.findByLabelText("New criterion verification hint"), { key: "Enter" });

    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0][1]).toMatchObject({ statement: COMPOUND, parentId: "task-1" });
  });

  it("shows nothing for a clean statement", async () => {
    renderList();
    await typeStatement(CLEAN);

    await waitFor(() =>
      expect(invokeCommandMock.mock.calls.some(([command]) => command === "criterion_lint_advice")).toBe(true),
    );
    expect(advice()).not.toBeInTheDocument();
  });

  it("is not an alert and does not move focus", async () => {
    renderList();
    const input = await typeStatement(COMPOUND);
    input.focus();
    const focusedBefore = document.activeElement;

    const note = await screen.findByRole("note", { name: "Criterion advice" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(note.getAttribute("role")).not.toBe("alert");
    expect(document.activeElement).toBe(focusedBefore);
    expect(document.activeElement).toBe(input);
  });

  it("clears on cancel and on a successful save", async () => {
    renderList();
    let input = await typeStatement(COMPOUND);
    await screen.findByRole("note", { name: "Criterion advice" });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(advice()).not.toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("list", { name: "Criteria" }), { key: "n" });
    input = await typeStatement(COMPOUND);
    await screen.findByRole("note", { name: "Criterion advice" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(await screen.findByLabelText("New criterion verification hint"), { key: "Enter" });
    await waitFor(() => expect(advice()).not.toBeInTheDocument());
    expect(creates()).toHaveLength(1);
  });

  it("leaves the keyboard map alone: n opens the composer and Enter saves with advice on screen", async () => {
    renderList([EXISTING]);
    const list = await screen.findByRole("list", { name: "Criteria" });
    await screen.findByText(EXISTING.statement);

    fireEvent.keyDown(list, { key: "n" });
    const input = await typeStatement(COMPOUND);
    await screen.findByRole("note", { name: "Criterion advice" });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(await screen.findByLabelText("New criterion verification hint"), { key: "Enter" });
    await waitFor(() => expect(creates()).toHaveLength(1));
  });

  it("advises in the inline edit too, and the edit still saves", async () => {
    renderList([EXISTING]);
    fireEvent.click(await screen.findByRole("button", { name: `Edit criterion "${EXISTING.statement}"` }));
    const input = await screen.findByLabelText("Edit criterion statement");
    fireEvent.change(input, { target: { value: COMPOUND } });

    expect(await screen.findByRole("note", { name: "Criterion advice" })).toHaveTextContent(ADVICE);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(invokeCommandMock.mock.calls.filter(([command]) => command === "criterion_revise")).toHaveLength(1),
    );
  });
});
