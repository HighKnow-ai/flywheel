/**
 * Behavior under test (08-01-PLAN.md Task 3, D-135, Pitfall 8): the extension-to-grammar map and
 * the `.children` adapter between refractor 5 (returns a hast root) and `react-diff-view` 3
 * (consumes an array of nodes).
 */
import { describe, expect, it } from "vitest";
import { diffRefractor, languageFor } from "../highlight";

describe("languageFor", () => {
  it("maps known extensions and returns null for an unknown one", () => {
    expect(languageFor("src/lib.rs")).toBe("rust");
    expect(languageFor("src/App.tsx")).toBe("tsx");
    expect(languageFor("Cargo.toml")).toBe("toml");
    expect(languageFor("README.MD")).toBe("markdown");
    expect(languageFor("notes.zzz")).toBeNull();
    expect(languageFor("Makefile")).toBeNull();
  });
});

describe("diffRefractor", () => {
  it("returns an array of nodes, not a hast root", () => {
    const nodes = diffRefractor.highlight("fn main() {}", "rust");
    expect(Array.isArray(nodes)).toBe(true);
    const hasKeyword = nodes.some(
      (node) =>
        node.type === "element" &&
        Array.isArray(node.properties?.className) &&
        node.properties.className.includes("keyword"),
    );
    expect(hasKeyword).toBe(true);
  });
});
