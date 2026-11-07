/**
 * `settle-react.ts` keeps React's late work inside jsdom's life. A helper that returned at once would
 * go on passing every test and fail one run a week, so this proves the thing it exists for: the work
 * is there before it runs, and nothing fires after it.
 *
 * THESE CANNOT FLAKE. They take `window` away only after `settleReact`. A slow machine lets a timer
 * fire while `window` is still there, which proves nothing that run and fails nothing; only a timer
 * that was left running can throw.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toaster } from "@highknow/design";
import { setTimeout as sleep } from "node:timers/promises";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { notify } from "@/lib/notify";
import { settleReact } from "../settle-react";

// This workspace carries no `@types/node`, so the one Node global used here is typed here.
const { process } = globalThis as unknown as {
  process: {
    on(event: "uncaughtException", listener: (error: unknown) => void): void;
    off(event: "uncaughtException", listener: (error: unknown) => void): void;
  };
};

/** What throws while `window` is gone, as it is once vitest has torn jsdom down. */
async function uncaughtWithoutWindow(): Promise<unknown[]> {
  const uncaught: unknown[] = [];
  const record = (error: unknown) => uncaught.push(error);
  process.on("uncaughtException", record);
  const global = globalThis as unknown as { window?: unknown };
  const { window: jsdom } = global;
  delete global.window;
  // On Node's timers, which `settle-react.ts` does not touch, and past Sonner's 200 ms.
  await sleep(300);
  global.window = jsdom;
  process.off("uncaughtException", record);
  return uncaught;
}

describe("settleReact", () => {
  it("waits for the passive effects of a commit made outside act", async () => {
    let ran = 0;
    function Probe() {
      useEffect(() => {
        ran += 1;
      }, []);
      return null;
    }
    // Several, because one is what a single round of `setImmediate` would get through by luck.
    const roots = Array.from({ length: 5 }, () => createRoot(document.createElement("div")));
    for (const root of roots) root.render(createElement(Probe));
    expect(ran).toBe(0);

    await settleReact();

    expect(ran).toBe(5);
  });

  it("clears a timer that would read window after jsdom has gone", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const timer = setTimeout(() => void window.event, 50);

    await settleReact();

    expect(clear).toHaveBeenCalledWith(timer);
    clear.mockRestore();
    expect(await uncaughtWithoutWindow()).toEqual([]);
  });

  it("clears the timer Sonner leaves running after a toast's action is pressed", async () => {
    // Sonner reads the system scheme through matchMedia; jsdom has none.
    if (typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          onchange: null,
          dispatchEvent: () => false,
        }),
      });
    }
    render(<Toaster />);
    act(() => {
      notify.success("Story moved to E-3", { undo: () => undefined });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    cleanup();

    await settleReact();

    expect(await uncaughtWithoutWindow()).toEqual([]);
  });
});
