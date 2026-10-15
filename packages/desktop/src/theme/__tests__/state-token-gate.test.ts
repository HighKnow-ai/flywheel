import { describe, expect, it } from "vitest";

/**
 * The state-token gate (Phase 14 plan 04, VIS-01, criterion 3): a production file that names a `--state-*`
 * colour token, other than the one component built to, FAILS THE BUILD. Colour is the fastest channel and
 * never the only one; `legend/StateBadge.tsx` is the only place a state colour is drawn, and it always
 * draws a glyph and a word beside it. A component that reached for the token directly could paint a state
 * as a bare colour.
 *
 * This is a sibling of `brand-rule.test.ts` and not an extension of it, on purpose: `brand-rule` owns an
 * exact-count allowlist over twelve files and its assertion is an equality on a map, so folding a second,
 * differently-shaped rule into it would make one failure message answer two questions. The repo's
 * precedent for self-contained per-file gates (Phase 13, D-23) applies.
 *
 * Two-sided, the way every gate here is (D-23): the planted-fixture tests below prove it FIRES on a
 * violation and stays SILENT on the legitimate consumer, on the definition files, on a comment, and on the
 * pre-existing `.state-*` CSS CLASS namespace in `styles/states-and-confirms.css`. That last one is the
 * trap: a matcher for the bare word `state-` would fail the build on correct code.
 *
 * Equality is byte equality over the raw file text, case-sensitive. A CSS custom property name is itself
 * case-sensitive, so `--State-x` is a different property and is not a reference to ours. No normalisation
 * form or code-point folding is applied; the prefix is a plain ASCII literal.
 *
 * Unlike `brand-rule.test.ts` this file reads no planning document and imports nothing from `node:fs`:
 * everything it needs comes through Vite's `?raw` glob.
 */

/** The one component that may draw with the state tokens. */
const CONSUMER = "legend/StateBadge.tsx";

/** Declaring a token is not consuming one. */
const DEFINITIONS = new Map<string, string>([
  ["styles/tokens.css", "declares every --state-* role in both mode blocks"],
  ["theme/tokens.ts", "the typed per-mode mirror of those declarations"],
]);

/** The custom-property prefix, as ASCII bytes. A leading `--` is what makes it a property and not a class. */
const TOKEN_PREFIX = "--state-";

const sources = import.meta.glob(
  ["../../**/*.{ts,tsx,css}", "!../../**/__tests__/**", "!../../**/*.test.*", "!../../test/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** Strip block comments, and line comments in code files (a `//` inside a string is a ponytail below). */
// ponytail: a `//` inside a string literal loses the rest of its line; it can only hide a use, never invent one.
function code(path: string, text: string): string {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return path.endsWith(".css") ? noBlock : noBlock.replace(/(^|[^:\w"'`])\/\/.*$/gm, "$1");
}

/** A glob key is relative to this file (src/theme/__tests__); return the path under src/. */
function fromSrc(key: string): string {
  const parts = ["theme", "__tests__"];
  for (const seg of key.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** The paths, among `entries` (path under src/, raw text), that name a state token without being allowed to. */
function offendersFor(entries: readonly (readonly [string, string])[]): string[] {
  return entries
    .filter(([path]) => path !== CONSUMER && !DEFINITIONS.has(path))
    .filter(([path, text]) => code(path, text).includes(TOKEN_PREFIX))
    .map(([path]) => path);
}

const files = Object.entries(sources)
  // Vite shortens a key to the nearest relative form (`../tokens.ts`), so resolve it back to a path under src/.
  .map(([path, text]) => [fromSrc(path), text] as const);

const WHAT_TO_DO =
  `Render the state through the one component, ${CONSUMER} (<StateBadge state="..." />), which always draws ` +
  "a glyph and a word beside the colour. If a second consumer is genuinely needed, widen CONSUMER or DEFINITIONS " +
  "in theme/__tests__/state-token-gate.test.ts and say why in 14-HIERARCHY.md or the phase direction document.";

describe("the state-token gate (VIS-01): only StateBadge draws with the state tokens", () => {
  it("reads real source (a stubbed ?raw would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(([p]) => p === CONSUMER)).toBe(true);
    for (const definition of DEFINITIONS.keys()) {
      expect(files.some(([p]) => p === definition), `${definition} was not walked`).toBe(true);
    }
    // The consumer and the stylesheet really do carry the prefix, so "no offender" cannot mean "no match anywhere".
    expect(files.find(([p]) => p === CONSUMER)![1]).toContain(TOKEN_PREFIX);
    expect(files.find(([p]) => p === "styles/tokens.css")![1]).toContain(`${TOKEN_PREFIX}needs-you-text`);
  });

  it("passes on the real tree: the one component is the only consumer", () => {
    expect(offendersFor(files), WHAT_TO_DO).toEqual([]);
  });

  it("fires on a direct reference at a path that is not the one consumer, and says what to do", () => {
    const planted = [["board/BoardRow.tsx", 'const c = "var(--state-failed-text)";']] as const;
    expect(offendersFor(planted)).toEqual(["board/BoardRow.tsx"]);
    expect(WHAT_TO_DO).toContain("StateBadge");
    expect(WHAT_TO_DO).toContain("14-HIERARCHY.md");
  });

  it("fires once per offending file, in a stylesheet as well as in a component", () => {
    const planted = [
      ["App.css", ".row { color: var(--state-running-mark); }"],
      ["fleet/FleetSurface.tsx", "style={{ background: `var(--state-needs-you-wash)` }}"],
    ] as const;
    expect(offendersFor(planted)).toEqual(["App.css", "fleet/FleetSurface.tsx"]);
  });

  it("is silent on the one consumer's own path", () => {
    expect(offendersFor([[CONSUMER, "color: `var(--state-${cls}-text)`"]])).toEqual([]);
  });

  it("is silent on the token definition files: declaring a token is not consuming one", () => {
    expect(
      offendersFor([
        ["styles/tokens.css", "--state-quiet-text: #59636e;"],
        ["theme/tokens.ts", "// --state-quiet-text\nconst x = 1;"],
      ]),
    ).toEqual([]);
  });

  it("does not conflate the pre-existing .state-* CSS CLASS namespace with the --state-* token namespace", () => {
    // styles/states-and-confirms.css declares real class selectors with this word. They are correct.
    const planted = [
      ["styles/states-and-confirms.css", ".state-empty { padding: var(--space-md); }\n.state-error .state-title { color: inherit; }"],
      ["board/Empty.tsx", 'return <div className="state-empty state-error" />;'],
    ] as const;
    expect(offendersFor(planted)).toEqual([]);
    // And the real file is walked and really does carry such a class, so the line above is not vacuous.
    const real = files.find(([p]) => p === "styles/states-and-confirms.css");
    expect(real, "styles/states-and-confirms.css was not walked").toBeDefined();
    expect(real![1]).toMatch(/\.state-[a-z]/);
    expect(offendersFor([["styles/states-and-confirms.css", real![1]]])).toEqual([]);
    // A class selector and a custom property on adjacent lines: only the property is an offence.
    expect(offendersFor([["board/X.css", ".state-empty { color: var(--state-failed-text); }"]])).toEqual(["board/X.css"]);
  });

  it("ignores a state token named in a whole-line comment, the house convention for every source gate", () => {
    const planted = [
      ["board/A.tsx", "// do not use --state-failed-text here, render a StateBadge\nconst a = 1;"],
      ["board/B.tsx", "/*\n * --state-failed-text is reserved for StateBadge\n */\nconst b = 1;"],
      ["board/C.css", "/* --state-running-edge */\n.c { color: inherit; }"],
    ] as const;
    expect(offendersFor(planted)).toEqual([]);
  });

  it("matches case-sensitively: the real lower-case spelling is an offender, a case variant is a different property", () => {
    expect(offendersFor([["board/D.css", ".d { color: var(--state-failed-text); }"]])).toEqual(["board/D.css"]);
    expect(offendersFor([["board/E.css", ".e { color: var(--State-failed-text); }"]])).toEqual([]);
    expect(offendersFor([["board/F.css", ".f { color: var(--STATE-failed-text); }"]])).toEqual([]);
  });

  it("matches the prefix as ASCII bytes: a look-alike code point does not create a match", () => {
    // U+2011 non-breaking hyphen and U+FF0D fullwidth hyphen-minus are not the ASCII hyphen-minus.
    expect(offendersFor([["board/G.css", ".g { color: var(--state‑failed-text); }"]])).toEqual([]);
    expect(offendersFor([["board/H.css", ".h { color: var(－－state-failed-text); }"]])).toEqual([]);
  });
});
