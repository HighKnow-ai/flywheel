/**
 * The e2e harness's second transport (`ws-transport.ts`): frames out and in, errors as Tauri's
 * `invoke` reports them, and the two lists the Rust side must keep in step with the adapter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import adapter from "../tauri.ts?raw";
import core from "../../../src-tauri/src/bin/flywheel-headless.rs?raw";

class FakeSocket extends EventTarget {
  static last: FakeSocket;
  sent: string[] = [];
  constructor(public url: string) {
    super();
    FakeSocket.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(frame: string) {
    this.sent.push(frame);
  }
  receive(frame: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
}

async function transport() {
  vi.resetModules();
  const { connectWsTransport } = await import("../ws-transport");
  return connectWsTransport();
}

describe("the WebSocket transport", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeSocket);
    window.history.replaceState(null, "", "/?flywheelCore=4242&flywheelToken=abc123");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  it("connects to the port and token in the page URL", async () => {
    await transport();
    expect(FakeSocket.last.url).toBe("ws://127.0.0.1:4242/?token=abc123");
  });

  it("sends a command as a frame and resolves with its result", async () => {
    const t = await transport();
    const result = t.invoke<string[]>("project_list", { a: 1 });
    expect(JSON.parse(FakeSocket.last.sent[0] ?? "")).toEqual({ id: 1, cmd: "project_list", args: { a: 1 } });
    FakeSocket.last.receive({ id: 1, ok: ["p"] });
    await expect(result).resolves.toEqual(["p"]);
  });

  it("rejects with the core's own error value, as Tauri's invoke does", async () => {
    const t = await transport();
    const result = t.invoke("story_merge", {});
    FakeSocket.last.receive({ id: 1, err: "failed:story_merge" });
    await expect(result).rejects.toBe("failed:story_merge");
  });

  it("delivers an event's payload to its subscribers until they unsubscribe", async () => {
    const t = await transport();
    const seen: unknown[] = [];
    const stop = t.listen("board:changed", (p) => seen.push(p));
    FakeSocket.last.receive({ event: "board:changed", payload: { entity: "stories" } });
    stop();
    FakeSocket.last.receive({ event: "board:changed", payload: { entity: "tasks" } });
    expect(seen).toEqual([{ entity: "stories" }]);
  });

  it("refuses to connect without an address", async () => {
    window.history.replaceState(null, "", "/");
    await expect(transport()).rejects.toThrow(/flywheelCore/);
  });
});

describe("the headless core's event list", () => {
  it("forwards every event the adapter listens to", () => {
    const listened = [...adapter.matchAll(/listenEvent<.*?>\("([^"]+)"/g)].map((m) => m[1]).sort();
    const forwarded = [...(/FORWARDED_EVENTS: &\[&str\] = &\[([^\]]*)\]/.exec(core)?.[1] ?? "").matchAll(/"([^"]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(listened.length).toBeGreaterThan(0);
    expect(forwarded).toEqual(listened);
  });
});
