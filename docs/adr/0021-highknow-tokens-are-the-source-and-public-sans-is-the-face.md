# HighKnow's tokens are the source, and Public Sans is the face

Decided by Cyril in [Flywheel takes HighKnow's tokens, face and full-colour mark, and keeps its own dark mode and state colours](https://github.com/HighKnow-ai/flywheel/issues/196) (Epic #189): "I'd like us to reuse the tokens from highknow-mvp where possible (keep the dark mode and additional colours you designed) … TL;DR: you have a nice interface, but I'd like it to be more consistent."

Flywheel ships under the HighKnow mark, so its neutrals, brand text and error now come from HighKnow's own token source: `packages/config/tailwind-preset.css` in `github.com/cymarechal/highknow-mvp`, exported as `packages/config/tokens.json`. A copy of that export is vendored at [`docs/design/highknow-tokens.json`](../design/highknow-tokens.json), and its `$vendored` block names the repo, the file and the commit it was copied from. `packages/desktop/src/theme/__tests__/brand-tokens.test.ts` holds every borrowed variable in `globals.css` equal to the vendored value. A HighKnow value moves into Flywheel by re-copying the export: the test then fails until `globals.css` follows it. Every variable keeps its shadcn/ui name (ADR 0004), so no component changes.

The UI face changes from **Barlow** (with Barlow Semi Condensed for count and strip labels) to **Public Sans Variable**, HighKnow's face, through `@fontsource-variable/public-sans` 5.3.0. It is still self-hosted and SIL OFL 1.1. One family now carries every role: the condensed role keeps its variable (`--font-ui-condensed`) and its uppercase tracking, but points at Public Sans. JetBrains Mono stays for keys, branches, paths and commands. Public Sans ships a `tnum` feature, so `.tabular-nums` keeps counts and times on tabular figures; the test reads the font file to prove it.

The mark is drawn in its real colours wherever Flywheel shows it (the rail and first-run): the `#3c64dd` tile with the white glyph, fixed in both schemes, as HighKnow's `Wordmark` draws it. The ink-masked silhouette is gone. The mark is identity, not a state colour, so it doesn't count against the brand blue's one meaning.

We rejected two other options:

- **Copy HighKnow's values in by hand, with no vendored source.** The values would drift from HighKnow the first time either side changed, and nothing would say so.
- **Take HighKnow's whole palette, dark included.** HighKnow's dark scales are built for an overlay that sits over a video call and for a reading surface. Flywheel's dark is built around the andon strip and the lamps. Cyril asked to keep Flywheel's dark and its extra colours.

## Consequences

- Kept as Flywheel's own, and absent from the vendored mapping: the grounds (`--background`, `--card`, `--sidebar`, the dark scale), safety yellow (`--attention`), graphite (`--strip`), the lamps, the Diff Tints (ADR 0011), `--subtle-foreground` and the chart neutrals. `docs/design/direction.md` § Tokens lists which variable carries which HighKnow token.
- Where a HighKnow value fails contrast on a Flywheel ground, the hue is kept and the lightness moves the least amount that passes. The deviation is recorded in `direction.md`. None was needed at the commit this ADR was written against: every borrowed value passes on every ground it's drawn on.
- `--ease-out-quint` (`cubic-bezier(0.16, 1, 0.3, 1)`) is the shared easing token. `--ease` stays as an alias, so the screens that use it don't change.
- `--running-border` is new: HighKnow's brand hair on light, and a Flywheel dark sibling in the same hue. It has no consumer yet. It's there for the Stories that follow the design audit (#192).
- Public Sans is wider than Barlow, so a label that fit in Barlow can wrap or truncate. The browser suites and the critique re-shoot are where that shows.
