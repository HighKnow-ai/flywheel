/**
 * The recorder's own guarantee, in a real engine: it keeps reading the screen when the browser stops delivering
 * animation frames, and a blank state or a shift in that time is still caught. `no-flicker.browser.test.tsx` relies
 * on this: its `samples` count means nothing if the blank-frame and shift checks could not have fired.
 *
 * Animation frames and timers are both driven by hand here, so nothing depends on how fast this machine draws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordFlicker } from "../../flicker-recorder";

describe("recordFlicker", () => {
  let host: HTMLElement;
  let line: HTMLElement;
  let pendingFrames: FrameRequestCallback[];

  /** Deliver one animation frame to whatever is waiting for it. */
  function deliverFrame() {
    const waiting = pendingFrames;
    pendingFrames = [];
    for (const callback of waiting) callback(performance.now());
  }

  beforeEach(() => {
    host = document.createElement("div");
    line = document.createElement("p");
    line.textContent = "A line of text long enough to count as the screen's content.";
    host.append(line);
    document.body.append(host);
    pendingFrames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    host.remove();
  });

  it("reads the screen while no frame arrives, and sees a blank state and a shift in that time", async () => {
    const recorder = recordFlicker(host);
    vi.advanceTimersByTime(200);

    const text = line.textContent;
    line.textContent = "";
    vi.advanceTimersByTime(100);
    line.textContent = text;
    line.style.marginTop = "40px";
    vi.advanceTimersByTime(200);

    const stopped = recorder.stop();
    vi.advanceTimersByTime(100);
    const report = await stopped;

    expect(report.frames).toBe(0);
    expect(report.samples).toBeGreaterThan(5);
    expect(report.blankFrames).toBeGreaterThan(0);
    expect(report.shifted.join("\n")).toContain("<p>");
  });

  it("samples once per frame while frames arrive, with the stand-in staying out of the way", async () => {
    const recorder = recordFlicker(host);
    for (let i = 0; i < 8; i += 1) {
      deliverFrame();
      vi.advanceTimersByTime(50);
    }

    const stopped = recorder.stop();
    deliverFrame();
    const report = await stopped;

    expect(report.frames).toBe(9);
    // The one extra is the reading `stop` always takes.
    expect(report.samples).toBe(10);
    expect(report.blankFrames).toBe(0);
    expect(report.shifted).toEqual([]);
  });

  it("stops without waiting for a frame that never comes", async () => {
    const recorder = recordFlicker(host);
    const stopped = recorder.stop();
    vi.advanceTimersByTime(100);
    await expect(stopped).resolves.toMatchObject({ frames: 0 });
  });
});
