/**
 * The Prism tokenizer adapter for the review surface's diff renderer (Phase 8 plan 08-01, D-135).
 *
 * Imports `refractor/core` plus fifteen individual grammars — never the package's barrel entry or
 * its all-grammars entry, which register hundreds of grammars and are the difference between a
 * ~44 kB gzip budget and a multi-hundred-kB one.
 *
 * `react-diff-view@3`'s tokenizer calls `refractor.highlight(text, language)` and feeds the result
 * to its own tree builder as an ARRAY of nodes. `refractor@5` returns a hast ROOT instead, so
 * handing the library the refractor object directly throws at render time (its README is
 * written against refractor 3). `diffRefractor` is the one-line `.children` adapter that closes
 * that gap — do not "simplify" it away.
 */
import { refractor } from "refractor/core";
import bash from "refractor/bash";
import css from "refractor/css";
import go from "refractor/go";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import markdown from "refractor/markdown";
import markup from "refractor/markup";
import python from "refractor/python";
import rust from "refractor/rust";
import sql from "refractor/sql";
import toml from "refractor/toml";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";

for (const grammar of [
  markup,
  css,
  javascript,
  jsx,
  typescript,
  tsx,
  json,
  markdown,
  yaml,
  toml,
  bash,
  sql,
  python,
  go,
  rust,
]) {
  refractor.register(grammar);
}

/** Lowercased file extension to grammar name. Anything absent renders un-highlighted. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  sql: "sql",
  py: "python",
  go: "go",
  html: "markup",
  svg: "markup",
  xml: "markup",
};

/** The grammar for `path`'s extension, or `null` when none is mapped or registered. Every call
 * site relies on this to render plain text rather than throw (Pitfall 8). */
export function languageFor(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const language = LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
  return language && refractor.registered(language) ? language : null;
}

/** The shape `tokenize({ refractor })` expects — typed loosely because the library's own typing
 * names refractor 3's return type. */
export const diffRefractor = {
  highlight: (text: string, language: string) => refractor.highlight(text, language).children,
};
