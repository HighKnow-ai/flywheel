/**
 * Nothing a test file started outlives its jsdom.
 *
 * WORK LEFT BEHIND FAILS THE RUN WITH EVERY TEST PASSED. Once vitest has torn jsdom down, React's next
 * update reads `window.event` and throws `ReferenceError: window is not defined`, and vitest fails the
 * run over an uncaught error. Who wins depends on the order and the machine's load, so it lands on
 * somebody else's change, one run in many. There are three ways there:
 *
 *   - A commit outside `act`: React queues its passive flush on a `setImmediate` it captured when it
 *     loaded, which nothing can cancel. A `stop()` that unmounts outside `act` is enough.
 *   - A `.focus()`: jsdom queues a `selectionchange` on `setImmediate`, and React's listener answers it.
 *   - A library's `setTimeout` that no unmount clears: Sonner calls `setState` 200 ms after a toast's
 *     action is pressed, and TanStack Query sends its notifications on a `setTimeout(0)`.
 *
 * WHY HERE AND NOT `act` AROUND EACH OF THEM. That holds until the next test file forgets.
 *
 * WHY A SENTINEL ROOT AND NOT SOME NUMBER OF `setImmediate` ROUNDS. The scheduler runs its queue in order
 * of expiry and hands back after 5 ms, so the rounds it needs depend on the machine. A render and its
 * passive flush queued now expire after everything already queued, so the sentinel's effect running
 * means all of that has run.
 *
 * WHY CANCEL THE TIMERS AND NOT WAIT THEM OUT. Sonner's timer is private and its 200 ms is an internal
 * number, so a wait would be a guess that a dependency update can quietly make wrong, and a timer of a
 * minute would hold the file for a minute. Nothing can assert on a timer's work once the file is over.
 *
 * THIS MODULE LOADS BEFORE REACT. The scheduler also captures `setTimeout` when it loads, so whichever
 * setup file imports this does so on its first line.
 *
 * WHY HERE AND NOT FROM `@highknow/design`. The package does not publish its test helpers, and this
 * tree imports nothing else from outside itself. It is a copy of that package's `test/settle-react.ts`.
 */
import { afterAll, vi } from "vitest";

const running = new Set<ReturnType<typeof setTimeout>>();

// A Proxy, so the function keeps what `util.promisify` and fake timers read off it.
globalThis.setTimeout = new Proxy(globalThis.setTimeout, {
  apply(real, thisArg, args: unknown[]) {
    const [callback, ...rest] = args;
    if (typeof callback !== "function") return Reflect.apply(real, thisArg, args) as unknown;
    const timer = Reflect.apply(real, thisArg, [
      (...given: unknown[]) => {
        running.delete(timer);
        Reflect.apply(callback, undefined, given);
      },
      ...rest,
    ]) as ReturnType<typeof setTimeout>;
    running.add(timer);
    return timer;
  },
});

export async function settleReact(): Promise<void> {
  // A clock left faked would hold a React loaded from here to a `setImmediate` that never fires.
  vi.useRealTimers();
  // A file in the node environment has no jsdom to outlive, so it does not load React for this.
  if (typeof document !== "undefined") {
    const { createElement, useEffect } = await import("react");
    const { createRoot } = await import("react-dom/client");
    await new Promise<void>((resolve) => {
      function Sentinel() {
        useEffect(() => resolve(), []);
        return null;
      }
      createRoot(document.createElement("div")).render(createElement(Sentinel));
    });
  }
  // After the sentinel, because what it let run can start a timer.
  for (const timer of running) clearTimeout(timer);
  running.clear();
}

afterAll(settleReact);
