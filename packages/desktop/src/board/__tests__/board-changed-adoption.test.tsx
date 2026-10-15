/**
 * FNC-07 adoption gate: `subscribeBoardChanged` has exactly three production callers — its own
 * definition, the one shared hook that owns the routing decision, and the reference-counted
 * fleet subscription. A fourth caller is a reader that ignores `payload.projectId` and refetches
 * on every event, which is how 28 of 29 subscribers shipped unrouted.
 */
import { describe, expect, it } from "vitest";

/** Every production source file under `src`, read as text. `import.meta.glob` keeps this gate free
 * of node typings; the negative patterns drop tests (this file included). */
const sources = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/__tests__/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The call under watch, spelled in two halves so this file is not itself a caller. */
const CALL = "subscribeBoardChanged" + "(";

/** path (relative to `src`) -> why it may call `subscribeBoardChanged` directly. */
const ALLOWED: Record<string, string> = {
  "adapters/tauri.ts": "the definition: the single invoke/listen seam",
  "board/useBoardChangedInvalidation.ts": "the one shared consumer that owns the routing decision",
  "fleet/useFleet.ts":
    "module-level reference-counted subscription, not a React hook, and every key it invalidates is account-wide",
};

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

/** Files (relative to `src`) that call `subscribeBoardChanged` outside a whole-line comment. */
function callers(files: Map<string, string>): string[] {
  return [...files]
    .filter(([, text]) => text.split("\n").some((l) => !isComment(l) && l.includes(CALL)))
    .map(([path]) => path)
    .sort();
}

const offenders = (files: Map<string, string>) => callers(files).filter((p) => !(p in ALLOWED));

describe("subscribeBoardChanged adoption gate", () => {
  const real = new Map(Object.entries(sources).map(([p, text]) => [p.replace("/src/", ""), text]));

  it("only the three allow-listed files call it", () => {
    expect(offenders(real)).toEqual([]);
  });

  it("the walker reached the tree, so a path typo cannot turn the gate off", () => {
    expect(real.size).toBeGreaterThan(50);
  });

  it("every allow-listed path exists and carries a reason", () => {
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(real.has(path), path).toBe(true);
      expect(reason.length).toBeGreaterThan(0);
    }
    expect(callers(real)).toEqual(Object.keys(ALLOWED).sort());
  });

  it("fires on a planted fourth caller and stays silent on only the allow-listed three", () => {
    const call = `${CALL}() => {});`;
    const clean = new Map(Object.keys(ALLOWED).map((p) => [p, call]));
    expect(offenders(clean)).toHaveLength(0);
    const planted = new Map(clean).set("board/BoardView.tsx", call);
    expect(offenders(planted)).toHaveLength(1);
    expect(offenders(planted)).toEqual(["board/BoardView.tsx"]);
  });

  it("a whole-line comment mentioning the call is not a caller", () => {
    const files = new Map([["board/x.ts", ` * see ${CALL}handler)\n// ${CALL}`]]);
    expect(offenders(files)).toHaveLength(0);
  });
});
