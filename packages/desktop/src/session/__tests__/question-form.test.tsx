/**
 * Story #206 (critique F49): the question card's choices are shadcn Radio Group and Checkbox inside Field labels, never
 * raw `<input type=radio|checkbox>`, and they still answer with the keyboard: arrows move a single choice, Space toggles
 * a multiple one, and typing an answer of your own picks "Other".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuestionForm } from "../QuestionForm";

const QUESTIONS = [
  {
    question: "Which colour should the button be?",
    header: "Colour",
    multiSelect: false,
    options: [
      { label: "Red", description: "Warm" },
      { label: "Blue", description: "Calm" },
    ],
  },
  {
    question: "Which platforms should we ship to?",
    header: "Platforms",
    multiSelect: true,
    options: [
      { label: "macOS", description: "" },
      { label: "Linux", description: "" },
    ],
  },
];

afterEach(() => cleanup());

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const view = render(<QuestionForm questions={QUESTIONS} onSubmit={onSubmit} />);
  return { ...view, onSubmit };
}

describe("the question form's choices", () => {
  it("uses Radio Group and Checkbox inside Field labels, with no raw radio or checkbox input", () => {
    const { container } = renderForm();
    expect(container.querySelector('input[type="radio"]:not([aria-hidden="true"])')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]:not([aria-hidden="true"])')).toBeNull();

    const single = screen.getByRole("radiogroup", { name: "Which colour should the button be?" });
    expect(single).toHaveAttribute("data-slot", "radio-group");
    const red = screen.getByRole("radio", { name: /Red/ });
    expect(red).toHaveAttribute("data-slot", "radio-group-item");
    expect(red.closest('[data-slot="field-label"]')).not.toBeNull();

    const mac = screen.getByRole("checkbox", { name: "macOS" });
    expect(mac).toHaveAttribute("data-slot", "checkbox");
    expect(mac.closest('[data-slot="field-label"]')).not.toBeNull();
  });

  it("names each choice by its label and description", () => {
    renderForm();
    expect(screen.getByRole("radio", { name: /Red/ })).toHaveAccessibleName(expect.stringContaining("Red"));
    expect(screen.getByRole("radio", { name: /Red/ })).toHaveAccessibleDescription("Warm");
    expect(screen.getByRole("radio", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Other" })).toBeInTheDocument();
  });

  it("moves a single choice with the arrow keys", async () => {
    renderForm();
    const red = screen.getByRole("radio", { name: /Red/ });
    fireEvent.click(red);
    expect(red).toBeChecked();
    act(() => red.focus());
    fireEvent.keyDown(red, { key: "ArrowDown" });
    const blue = screen.getByRole("radio", { name: /Blue/ });
    // Radix moves roving focus on the next tick.
    await waitFor(() => expect(blue).toHaveFocus());
    expect(blue).toBeChecked();
    expect(red).not.toBeChecked();
  });

  it("toggles a multiple choice, and sends what was picked", async () => {
    const { onSubmit } = renderForm();
    fireEvent.click(screen.getByRole("radio", { name: /Blue/ }));
    const mac = screen.getByRole("checkbox", { name: "macOS" });
    fireEvent.click(mac);
    fireEvent.click(screen.getByRole("checkbox", { name: "Linux" }));
    fireEvent.click(mac);
    expect(mac).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      "Which colour should the button be?": ["Blue"],
      "Which platforms should we ship to?": ["Linux"],
    });
  });

  it("typing your own answer picks Other: the radio for a single choice, the checkbox for a multiple one", () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: /Red/ }));
    fireEvent.change(screen.getByLabelText("Your own answer to: Which colour should the button be?"), {
      target: { value: "Teal" },
    });
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Red/ })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("Your own answer to: Which platforms should we ship to?"), {
      target: { value: "FreeBSD" },
    });
    expect(screen.getByRole("checkbox", { name: "Other" })).toBeChecked();
  });

  it("disables every choice while the answer is sending", async () => {
    let resolve: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderForm(onSubmit);
    fireEvent.click(screen.getByRole("radio", { name: /Red/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "macOS" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Blue/ })).toBeDisabled());
    expect(screen.getByRole("checkbox", { name: "Linux" })).toBeDisabled();
    await act(async () => resolve());
  });
});
