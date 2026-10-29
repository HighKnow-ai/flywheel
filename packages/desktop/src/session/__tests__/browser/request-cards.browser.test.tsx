/// <reference types="vite/client" />
/**
 * The request cards, measured in an engine (Story #206): answering down the Waiting-on-you queue, Deny is in the same
 * place on a Gated action and on a permission request, nothing in a card overflows it at any of the four window sizes,
 * the Always-allow editor opens inside the window, and the drawn answer keys read on every button fill.
 *
 * Runs under every browser config (light, dark, reduced motion). With `VITE_S206_SHOTS=before|after` it also writes one
 * PNG per window size into the git-ignored `target/s206/` at the repo root, for the PR's before/after.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import "../../../styles/globals.css";
import { applyColorScheme } from "../../../theme/colorScheme";
import { PermissionRequestCard, type PendingPermissionRequest } from "../../PermissionRequestCard";
import { at } from "../../../test/present";

// The app sets `.dark` on <html> from the system appearance; do the same, so the dark config measures the dark world.
applyColorScheme();

const SIZES = [
  [900, 600],
  [1280, 800],
  [1440, 900],
  [1920, 1200],
] as const;

const SHOTS = import.meta.env.VITE_S206_SHOTS as string | undefined;
const SCHEME = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const REQUESTS: PendingPermissionRequest[] = [
  {
    id: "gated",
    toolName: "Bash",
    inputPayload: JSON.stringify({
      command: "git push --force origin story/fly-206-request-cards-in-one-button-group",
    }),
    destructiveCategory: "force-push",
    suggestedRule: null,
  },
  {
    id: "request",
    toolName: "Bash",
    inputPayload: JSON.stringify({ command: "npm --prefix packages/desktop test -- permission-request" }),
    destructiveCategory: null,
    suggestedRule: "Bash(npm --prefix packages/desktop test:*)",
  },
  {
    id: "question",
    toolName: "AskUserQuestion",
    inputPayload: JSON.stringify({
      questions: [
        {
          question: "Which side should Deny sit on?",
          header: "Layout",
          multiSelect: false,
          options: [
            { label: "Left", description: "First in the group, as macOS puts Cancel" },
            { label: "Right", description: "Last in the group" },
          ],
        },
        {
          question: "Which cards should show the keys?",
          header: "Keys",
          multiSelect: true,
          options: [
            { label: "Permission request", description: "" },
            { label: "Gated action", description: "" },
          ],
        },
      ],
    }),
    destructiveCategory: null,
    suggestedRule: null,
  },
];

/** The queue as the Waiting-on-you column holds it (400px), beside the feed's own width, on the page background. */
function Queue() {
  const answer = () => new Promise<void>(() => {});
  return (
    <div className="flex min-h-screen items-start gap-6 bg-background p-6 text-foreground">
      <div data-testid="column" className="w-[400px] shrink-0">
        <PermissionRequestCard variant="compact" requests={REQUESTS} onAnswer={answer} onAnswerQuestion={answer} />
      </div>
      <div data-testid="feed" className="min-w-0 max-w-[860px] flex-1">
        <PermissionRequestCard
          variant="feed"
          keyboardEnabled={false}
          requests={REQUESTS}
          onAnswer={answer}
          onAnswerQuestion={answer}
        />
      </div>
    </div>
  );
}

function rect(element: Element) {
  return element.getBoundingClientRect();
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await document.fonts.ready;
}

describe(`the request cards in an engine (${SCHEME})`, () => {
  for (const [width, height] of SIZES) {
    it(`puts Deny in one slot and overflows nothing at ${width}×${height}`, async () => {
      await page.viewport(width, height);
      render(<Queue />);
      await settle();
      if (SHOTS)
        await page.screenshot({ path: `../../../../../../target/s206/${SHOTS}-${width}x${height}-${SCHEME}.png` });

      for (const region of ["column", "feed"]) {
        const scope = screen.getByTestId(region);
        const cards = within(scope).getAllByRole("group", { name: "Bash wants to:" });
        expect(cards).toHaveLength(2);
        const denies = cards.map((card) => within(card).getByRole("button", { name: "Deny" }));
        const allows = cards.map((card) => within(card).getByRole("button", { name: "Allow once" }));
        // Same slot: the first of the group, at the same x on both cards, Allow once straight after it.
        expect(Math.abs(rect(at(denies, 0)).left - rect(at(denies, 1)).left)).toBeLessThan(1);
        for (let i = 0; i < 2; i += 1) {
          expect(rect(at(denies, i)).right).toBeLessThanOrEqual(rect(at(allows, i)).left + 1);
        }

        for (const card of within(scope).getAllByRole("group", { name: /wants to:|has a question/ })) {
          const box = rect(card);
          for (const child of card.querySelectorAll("button, input, pre, p, legend, label")) {
            const r = rect(child);
            if (r.width === 0) continue;
            expect(r.right, `${child.textContent} overflows its card at ${width}px`).toBeLessThanOrEqual(box.right + 1);
          }
        }
      }
      // The question card lays its two questions side by side only when the card itself is wide enough.
      for (const region of ["column", "feed"]) {
        const form = within(screen.getByTestId(region)).getByRole("form", { name: "Answer the agent's question" });
        const fieldsets = [...form.querySelectorAll("fieldset")];
        const sideBySide = Math.abs(rect(at(fieldsets, 0)).top - rect(at(fieldsets, 1)).top) < 1;
        expect(sideBySide, `${region} at ${width}px`).toBe(rect(form).width >= 672);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    });
  }

  it("draws the answer keys legibly on the attention fill, the ink fill and an outline", async () => {
    await page.viewport(1440, 900);
    // One card per request, so each owns the keys: the Gated action (ink fill, outline) and the request (attention fill).
    const answer = () => new Promise<void>(() => {});
    render(
      <div className="flex w-[400px] flex-col gap-3 bg-background p-6">
        <PermissionRequestCard variant="compact" requests={[at(REQUESTS, 0)]} onAnswer={answer} />
        <PermissionRequestCard variant="compact" requests={[at(REQUESTS, 1)]} onAnswer={answer} />
      </div>,
    );
    await settle();
    const buttons = screen.getAllByRole("button", { name: /^(Deny|Allow once)$/ });
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      const key = button.querySelector('[data-slot="kbd"]') as HTMLElement;
      expect(key).not.toBeNull();
      // The key takes the button's own text colour, so it can never be the muted grey-on-ink of a stock Kbd.
      expect(getComputedStyle(key).color).toBe(getComputedStyle(button).color);
      expect(rect(key).height).toBeGreaterThan(0);
    }
  });

  it("opens the Always-allow editor inside the window, its field focused", async () => {
    await page.viewport(900, 600);
    render(<Queue />);
    await settle();
    const column = screen.getByTestId("column");
    await userEvent.click(within(column).getByRole("button", { name: "Always allow…" }));
    const field = await screen.findByRole("textbox", { name: "Pattern" });
    await waitFor(() => expect(field).toHaveFocus());
    const popover = field.closest('[data-slot="popover-content"]') as HTMLElement;
    await settle();
    const box = rect(popover);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    if (SHOTS) await page.screenshot({ path: `../../../../../../target/s206/${SHOTS}-popover-900x600-${SCHEME}.png` });
  });
});
