/**
 * 08.1 group-six finish-review closure. The Done warning is a POPOVER (UI-SPEC § Overlay Rule 2:
 * "anchored to a trigger"), so it opens under the row it concerns, names the task, and says in words how
 * many criteria are unchecked ("1/3" read two ways: one unchecked, or one checked).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DoneWarning } from "../DoneWarning";

afterEach(cleanup);

describe("DoneWarning", () => {
  it("names the task and counts the unchecked criteria in words", () => {
    render(<DoneWarning checked={1} total={3} itemKey="THRE-26" onConfirm={() => {}} onCancel={() => {}} />);
    const warning = screen.getByRole("alertdialog");
    expect(warning).toHaveTextContent("THRE-26 · 2 of 3 criteria unchecked. Mark Done anyway?");
    expect(warning.textContent).not.toContain("1/3");
  });

  it("leaves the key out, not 'undefined', for a caller with none", () => {
    render(<DoneWarning checked={0} total={4} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/^4 of 4 criteria unchecked\. Mark Done anyway\?/);
  });

  it("opens under the row it concerns, when it has one", () => {
    render(
      <DoneWarning
        checked={1}
        total={3}
        itemKey="THRE-26"
        anchorRect={{ top: 100, left: 64, bottom: 132 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const style = screen.getByRole("alertdialog").style;
    expect(style.top).toBe("136px");
    expect(style.left).toBe("80px");
    expect(style.bottom).toBe("");
    expect(style.transform).toBe("");
  });

  it("opens above the row when there is no room under it", () => {
    const rect = { top: window.innerHeight - 40, left: 64, bottom: window.innerHeight - 8 };
    render(<DoneWarning checked={1} total={3} anchorRect={rect} onConfirm={() => {}} onCancel={() => {}} />);
    const style = screen.getByRole("alertdialog").style;
    expect(style.top).toBe("");
    expect(style.bottom).toBe("44px");
  });

  it("falls back to the bottom centre for a row that is not on screen", () => {
    render(<DoneWarning checked={1} total={3} onConfirm={() => {}} onCancel={() => {}} />);
    const style = screen.getByRole("alertdialog").style;
    expect(style.left).toBe("50%");
    expect(style.transform).toBe("translateX(-50%)");
  });

  it("still confirms on Enter and cancels on Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DoneWarning checked={1} total={3} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
