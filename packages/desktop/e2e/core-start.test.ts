/**
 * The start report of the harness's core (issue #1743): it must name the phase a stalled start stopped
 * in, put the core's own lines among the harness's in time order, and read the process table and the
 * `sample` report without a machine to run them on.
 */
import { describe, expect, it } from "vitest";
import { callGraph, parseCoreLog, processTree, StartTimeline } from "./core-start";

const SPAWN_EPOCH = 1_000_000;
const line = (offsetMs: number, sinceMainMs: number, phase: string) =>
  `flywheel-headless: [start] @${SPAWN_EPOCH + offsetMs} +${sinceMainMs} ms ${phase}`;

/** A timeline whose clocks the test moves: `at(ms)` sets the time since the spawn. */
function clocked() {
  let ms = 0;
  const timeline = new StartTimeline({ now: () => ms, epoch: () => SPAWN_EPOCH + ms });
  return { timeline, at: (to: number) => (ms = to) };
}

describe("parseCoreLog", () => {
  it("separates the phase lines from what else the core printed", () => {
    const log = [
      line(2300, 0, "main entered"),
      "flywheel: login shell did not answer in 5 s, using the inherited PATH",
      line(2900, 600, "login path adopted"),
      "",
    ].join("\n");
    expect(parseCoreLog(log)).toEqual({
      phases: [
        { epochMs: SPAWN_EPOCH + 2300, sinceMainMs: 0, phase: "main entered" },
        { epochMs: SPAWN_EPOCH + 2900, sinceMainMs: 600, phase: "login path adopted" },
      ],
      other: ["flywheel: login shell did not answer in 5 s, using the inherited PATH"],
    });
  });

  it("keeps a phase whose name has spaces and digits", () => {
    const { phases } = parseCoreLog(line(5, 5, "listening on 127.0.0.1:51234"));
    expect(phases.map((p) => p.phase)).toEqual(["listening on 127.0.0.1:51234"]);
  });
});

describe("StartTimeline.report", () => {
  it("sets the core's phases among the harness's events by their time", () => {
    const { timeline, at } = clocked();
    timeline.mark("spawning flywheel-headless");
    at(40);
    timeline.mark("exec done (the binary is running)");
    at(2400);
    timeline.mark("first byte of stdout (210 bytes)", "stdout");
    const log = [line(2300, 0, "main entered"), line(2350, 50, "git init done")].join("\n");
    const report = timeline.report(log);
    const rows = report.split("\n").filter((l) => l.startsWith("  +"));
    expect(rows.map((r) => r.replace(/\s+/g, " ").trim())).toEqual([
      "+ 0 ms harness: spawning flywheel-headless",
      "+ 40 ms harness: exec done (the binary is running)",
      "+ 2300 ms core: main entered (core +0 ms)",
      "+ 2350 ms core: git init done (core +50 ms)",
      "+ 2400 ms harness: first byte of stdout (210 bytes)",
    ]);
    expect(report).toContain("(nothing besides the phase lines)");
  });

  it("shows the other stderr lines of the core, so its own warnings are not lost", () => {
    const { timeline } = clocked();
    const report = timeline.report(`${line(10, 0, "main entered")}\nflywheel: a warning`);
    expect(report).toContain("  flywheel: a warning");
  });
});

describe("StartTimeline.stalledAt", () => {
  it("says the core never reached `main` when it wrote no phase line", () => {
    const { timeline } = clocked();
    expect(timeline.stalledAt("")).toMatch(/BEFORE the core's `main`/);
  });

  it("names the last phase the core ended, and how long ago", () => {
    const { timeline, at } = clocked();
    at(60_000);
    const log = [line(2300, 0, "main entered"), line(9800, 7500, "git commit done")].join("\n");
    const said = timeline.stalledAt(log);
    expect(said).toContain('"git commit done"');
    expect(said).toContain("core +7500 ms");
    expect(said).toContain("50.2 s ago");
  });

  it("names the ready line to the WebSocket gap when the server never took the connection", () => {
    const { timeline } = clocked();
    timeline.mark("ready line read", "ready");
    expect(timeline.stalledAt(line(1, 1, "listening on 127.0.0.1:1"))).toMatch(/did not accept the connection/);
  });
});

describe("processTree", () => {
  const TABLE = [
    "  100     1 Ss    01:02   0:00.10   0 /sbin/launchd",
    "  200   100 U+    00:07   0:00.02  19 /tmp/flywheel-e2e/.bin/flywheel-headless --root /tmp/x/run",
    "  210   200 S     00:04   0:00.01  19 /usr/bin/git -C /tmp/x/run/repo commit -m initial commit",
    "  211   210 S     00:04   0:00.00  19 git-remote-helper with a very long command line " + "x".repeat(300),
    "  300   100 S     00:09   0:03.00   0 /usr/bin/other",
  ].join("\n");

  it("lists the core and everything under it, and nothing else", () => {
    const rows = processTree(TABLE, 200);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("pid 200 (parent 100) state U+ up 00:07 cpu 0:00.02 nice 19");
    expect(rows[1]).toContain("pid 210");
    expect(rows[2]).toContain("pid 211");
    expect(rows.join("\n")).not.toContain("/usr/bin/other");
  });

  it("cuts a long command line", () => {
    expect(processTree(TABLE, 200)[2]!.length).toBeLessThan(260);
  });

  it("says so when the core is not in the table", () => {
    expect(processTree(TABLE, 999)).toEqual(["pid 999 is not in the process table: the core has exited"]);
  });
});

describe("callGraph", () => {
  const REPORT = [
    "Analysis of sampling flywheel-headless (pid 1)",
    "",
    "Call graph:",
    "    10 Thread_1   DispatchQueue_1: com.apple.main-thread  (serial)",
    "      10 start  (in dyld) + 6652",
    "        10 __semwait_signal  (in libsystem_kernel.dylib) + 8",
    "",
    "Total number in stack (recursive counted multiple, when >=5):",
    "Binary Images:",
  ].join("\n");

  it("keeps the thread stacks and drops the rest of the report", () => {
    const graph = callGraph(REPORT);
    expect(graph).toContain("Call graph:");
    expect(graph).toContain("__semwait_signal");
    expect(graph).not.toContain("Binary Images");
  });

  it("cuts a long graph and says how much more the file holds", () => {
    const long = `Call graph:\n${Array.from({ length: 100 }, (_, n) => `    ${n} frame`).join("\n")}\nTotal number in stack`;
    const graph = callGraph(long, 10);
    expect(graph.split("\n")).toHaveLength(11);
    expect(graph).toMatch(/91 more lines in the sample file/);
  });

  it("returns a short report that is no call graph as it is", () => {
    expect(callGraph("sample: process is not responding")).toBe("sample: process is not responding");
  });
});
