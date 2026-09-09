# Self-hosted fonts

**Family:** Archivo
**Designer:** Omnibus-Type (Omnitype)
**Licence:** SIL Open Font License 1.1 ([`OFL.txt`](./OFL.txt), committed alongside the font file
per the licence's own redistribution requirement)
**Source:** `https://github.com/google/fonts/blob/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf`
(Google Fonts' upstream mirror of the Omnibus-Type release), fetched 2026-09-09.
**File:** `Archivo-Variable.ttf` (renamed from the upstream `Archivo[wdth,wght].ttf` — square
brackets in a filename are legal but awkward to reference from `@font-face url()` and from shell
tooling, so the file was renamed on import; the bytes are unmodified, `sha256`
`0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053`).

No CDN request is made for type at runtime — this file is the only source `type.css` references.

## Why one file covers both "Archivo" and "Archivo Condensed"

`01-UI-SPEC.md` names Archivo as the workhorse cut and "Archivo Condensed" as the companion cut for
the stamped key and band headers. Google Fonts merged Archivo's condensed/expanded static families
into the single variable font's `wdth` axis after that constraint was written — there is no longer
a separately-published "Archivo Condensed" package to fetch (confirmed against the upstream
`google/fonts` repository: `ofl/archivocondensed` no longer exists; `ofl/archivo` ships one
variable file with `wdth` 62–125, default 100, and `wght` 100–900, default 600).

The shipped variable file therefore produces **both** cuts:

- The workhorse grotesque cut: `font-stretch: 100%` (the `wdth` axis default).
- The condensed companion cut: a lower `font-stretch` value inside the font's own `wdth` range (see
  `styles/type.css` for the exact value used on the stamped key and band headers).

This is a better outcome against the owner's own stated preference ("prefer variable font files if
available to keep the bundle small") than the two-static-file design implied when the typeface
constraint was written, and it was recorded as a locked decision rather than invented silently —
see `01-UI-SPEC.md` § "Selected Direction — Flight Progress Strips" § Type and § "Open Decisions."

## Tabular figures — verified, not assumed

`01-UI-SPEC.md`'s typeface constraint requires **true tabular figures**, since the rack's fields are
columnar data that must align down a 1,000-row list. This was verified against the actual shipped
font file before locking the decision, using `fontTools` (`pip install fonttools`) to inspect the
font's `GSUB` feature list directly rather than trusting a marketing claim:

```
$ python3 -c "
from fontTools.ttLib import TTFont
f = TTFont('Archivo-Variable.ttf')
gsub = f['GSUB'].table
print(sorted({fr.FeatureTag for fr in gsub.FeatureList.FeatureRecord}))
"
['aalt', 'case', 'ccmp', 'dnom', 'frac', 'liga', 'lnum', 'locl', 'numr', 'onum',
 'ordn', 'pnum', 'rvrn', 'sinf', 'subs', 'sups', 'tnum', 'zero']
```

`tnum` (tabular figure widths) and `lnum` (lining figure shapes) are both present, so
`font-feature-settings: "tnum" 1, "lnum" 1` (paired with `font-variant-numeric: tabular-nums`)
produces real tabular figures, not proportional figures forced to look aligned by other means. This
is wired onto every numeric/columnar field in `styles/type.css`'s `.tabular-nums` utility class,
ready for the key column and every count/badge field that lands starting `01-03`.

## Subsetting

Not performed in this plan. The full variable font (~659KB) is shipped as-is: subsetting
reproducibly requires a checked-in `pyftsubset` invocation (so a rebuild produces byte-identical
output, per the same reproducibility house rule that requires self-hosting in the first place), and
authoring that script was out of scope for the theme-foundation plan. Revisit if bundle size becomes
a measured problem — the axis range and glyph coverage needed by the product (Latin, tabular
figures) are known and a subset definition can be derived from them later.
