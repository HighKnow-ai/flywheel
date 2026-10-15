/**
 * Phase 14 plan 14-06 (RECD-10, D-11): closing a Cycle asks per unfinished epic. The two decisive
 * assertions encode D-11: every choice control starts unselected, and the number of choice groups
 * equals the number of unfinished epics with no extra group anywhere (no apply-to-all).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CycleCloseDialog } from "../CycleCloseDialog";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  cycleClose: (cycleId: string, choices: unknown) => invokeCommandMock("cycle_close", { cycleId, choices }),
}));

const EPICS = [
  { id: "e1", key: "FLY-1", title: "Alpha" },
  { id: "e2", key: "FLY-2", title: "Beta" },
  { id: "e3", key: "FLY-3", title: "Gamma" },
];
const LATER = [{ id: "c2", key: "FLY-10", goal: "Reviews land" }];

function open(epics = EPICS, targets = LATER) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CycleCloseDialog
        projectId="proj-1"
        cycleId="c1"
        cycleGoal="Ship the board"
        epics={epics}
        targets={targets}
        onDone={onDone}
        onCancel={onCancel}
      />
    </QueryClientProvider>,
  );
  return { invalidate, onDone, onCancel };
}

const closeButton = () => screen.getByRole("button", { name: "Close cycle" }) as HTMLButtonElement;
const group = (title: string) => screen.getByRole("radiogroup", { name: new RegExp(title) });
const pick = (title: string, label: RegExp) => fireEvent.click(within(group(title)).getByRole("radio", { name: label }));

beforeEach(() => invokeCommandMock.mockReset().mockResolvedValue(undefined));

describe("CycleCloseDialog", () => {
  it("shows one row per unfinished epic, each naming the epic", () => {
    open();
    for (const e of EPICS) expect(group(e.title).getAttribute("aria-label") ?? group(e.title).textContent).toBeTruthy();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
    for (const e of EPICS) expect(screen.getByText(new RegExp(`${e.key}.*${e.title}`))).toBeTruthy();
  });

  it("starts with every choice control on every row unselected", () => {
    open();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(9);
    expect(radios.every((r) => r.checked === false)).toBe(true);
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("");
  });

  it("has exactly one choice group per unfinished epic and no control that applies a choice to many", () => {
    open();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(EPICS.length);
    expect(screen.getAllByRole("checkbox")).toHaveLength(0);
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.sort()).toEqual(["Cancel", "Close cycle"]);
  });

  it("offers exactly three choices per row", () => {
    open();
    const labels = within(group("Alpha")).getAllByRole("radio").map((r) => r.getAttribute("aria-label") ?? r.closest("label")?.textContent);
    expect(labels).toHaveLength(3);
  });

  it("disables the confirm until every row has a choice and says how many still need one", () => {
    open();
    expect(closeButton().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("3 epics still need a choice");
    pick("Alpha", /Return to no cycle/);
    expect(screen.getByRole("status").textContent).toContain("2 epics still need a choice");
    pick("Beta", /Leave in this cycle/);
    expect(screen.getByRole("status").textContent).toContain("1 epic still needs a choice");
    expect(closeButton().disabled).toBe(true);
    pick("Gamma", /Return to no cycle/);
    expect(closeButton().disabled).toBe(false);
  });

  it("does not count a move as decided until a target cycle is named", () => {
    open();
    pick("Alpha", /Return to no cycle/);
    pick("Beta", /Leave in this cycle/);
    pick("Gamma", /Move to a later cycle/);
    expect(closeButton().disabled).toBe(true);
    fireEvent.change(within(group("Gamma").closest("fieldset") ?? document.body).getByRole("combobox"), { target: { value: "c2" } });
    expect(closeButton().disabled).toBe(false);
  });

  it("sends one disposition per epic and re-reads the cycle region instead of patching it", async () => {
    const { invalidate, onDone } = open();
    pick("Alpha", /Move to a later cycle/);
    fireEvent.change(within(group("Alpha").closest("fieldset") ?? document.body).getByRole("combobox"), { target: { value: "c2" } });
    pick("Beta", /Return to no cycle/);
    pick("Gamma", /Leave in this cycle/);
    fireEvent.click(closeButton());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(invokeCommandMock).toHaveBeenCalledWith("cycle_close", {
      cycleId: "c1",
      choices: [
        { epicId: "e1", choice: "move_to", targetCycleId: "c2" },
        { epicId: "e2", choice: "unassign" },
        { epicId: "e3", choice: "leave_here" },
      ],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cycle-region", "proj-1"] });
  });

  it("asks nothing when every epic is finished", () => {
    open([]);
    expect(screen.queryAllByRole("radiogroup")).toHaveLength(0);
    expect(screen.getByText(/nothing to decide/i)).toBeTruthy();
    expect(closeButton().disabled).toBe(false);
  });

  it("cancels without sending anything", () => {
    const { onCancel } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(invokeCommandMock).not.toHaveBeenCalled();
  });
});
