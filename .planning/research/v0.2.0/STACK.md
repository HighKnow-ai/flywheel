# Technology Stack: v0.2.0 "The Board Thinks With You" (additions only)

**Project:** Flywheel (by HighKnow)
**Researched:** 2026-10-14
**Scope:** What the NEW capabilities need. The v0.1.0 stack (`.planning/research/STACK.md`) is not re-argued and nothing here contradicts it, except where a premise in the v0.1.0 file turns out not to match the tree (see "Corrections").
**Overall confidence:** HIGH on "what is in the tree" and on versions/licences (read from the repo and the npm registry today); MEDIUM on bundle numbers (my own esbuild measurements, floors not ceilings); MEDIUM on CSP behaviour (Tauri docs recalled, not re-verified).

## Verdict in one paragraph

v0.2.0 needs **two small runtime dependencies at most, and one of them is optional**: `react-markdown` + `remark-gfm` to *read* PRDs/ADRs (lazy chunk, about 50 kB gzip), and `diff` (jsdiff, about 3 kB gzip) to turn "current section vs proposed section" into a patch `react-diff-view` can already render. **No rich-text/WYSIWYG editor is added.** Long-form content is stored as Markdown, in **section rows** that are the addressable unit for propose/accept/reject/amend, edited in the `<textarea>` pattern `ProposalAmendEditor` already uses. CodeMirror 6 is named as the pre-chosen escalation with an explicit trigger, not shipped now. The phase layer is a schema migration. Colour needs no library. Agent-assisted review needs no dependency. Everything else on the milestone is Rust/SQL/TypeScript against seams that already exist.

## Corrections to the premise (read before planning)

Verified against the working tree on 2026-10-14. These change the cost arithmetic.

| Claim in the brief / v0.1.0 STACK.md | What the tree actually has | Consequence |
|---|---|---|
| "Monaco is already in the tree" | **Not installed.** `grep -i monaco` over every `package.json`, `package-lock.json` and source file returns nothing. The v0.1.0 `npm install` line listed `@monaco-editor/react`; it was never run. | Monaco is *not* a free reuse. It would be a brand-new, very large dependency. Argued below. |
| `@xyflow/react` validated | **Not installed** either. | The phase/roadmap view must not assume a graph library. It does not need one. |
| `git2` for hot-path diff reads | **Not in any `Cargo.toml`.** `packages/core/src/review.rs` shells out to system `git` (`git diff -z --name-status -M`). | Do not plan on "`git2::Patch::from_buffers` for free". Section diffs are computed in the renderer (jsdiff) or by `git diff --no-index`. |
| `@anthropic-ai/claude-agent-sdk` 0.3.x drives sessions | **Not a dependency of any package.** `packages/sidecar/src/claude-code-adapter.ts` spawns the user's own `claude` binary and normalises its `stream-json` output. The sidecar's only runtime dependency is `@modelcontextprotocol/sdk` 1.30.0. | Agent-assisted review is "another run through the existing adapter". Do not introduce the SDK for it. (The CLAUDE.md stack table still says the SDK; the code says CLI. Worth reconciling in the doc, not in code.) |
| `react-diff-view` installed | Yes, 3.3.3, plus `refractor` 5.0.0 with fifteen individually imported grammars (`review/highlight.ts`), in the lazy `ReviewSurface` chunk (163 kB raw, 55 kB gzip). | Reusable, see below. |

What the desktop package really ships today (`packages/desktop/package.json`): `@radix-ui/react-dismissable-layer`, `@radix-ui/react-focus-scope`, `@tanstack/react-query` 5.102.8, `@tanstack/react-virtual` 3.14.11, `@tauri-apps/api` 2.11.1, `@tauri-apps/plugin-dialog`, `lucide-react` 1.43.0, `react` 19.1, `react-diff-view` 3.3.3, `refractor` 5.0.0, `zustand` 5.0.15. Built output: main chunk 488 kB raw / 133 kB gzip, `ReviewSurface` 55 kB gzip.

---

## 1. PRD and ADR as board records: representation

### Recommendation: Markdown text, stored in **section rows**. Not a blob, not a block-JSON model.

| Option | Verdict | Why |
|---|---|---|
| One Markdown `TEXT` column per PRD/ADR | **Reject.** | An opaque blob. An agent amend becomes "replace everything", which is the chat-blob failure the Core Value forbids, and the human's only choices are all-or-nothing. It also cannot express "the agent proposes a new Non-goals section" as a create-verb proposal. |
| Structured block model (ProseMirror/Lexical/Slate JSON) in SQLite | **Reject.** | Couples the store of record to an editor library's schema. The agent speaks Markdown natively and the context packet is text, so every agent read/write would pass through parse → tree → serialise. Serialisers normalise (`*` vs `-`, escaping, blank lines), which manufactures spurious diffs inside a *proposal*, the one place diffs must be trustworthy. Also forecloses the relay/web milestone from swapping editors. |
| Per-paragraph block rows | **Reject.** | Too fine. One row per paragraph means rank churn, hundreds of events for one PRD, and a triage tray the human cannot read. A paragraph has no meaning the agent can be challenged about. |
| **Section rows: `heading` + `body_md` TEXT, ranked, revisioned** | **Adopt.** | The section is the unit a human actually adjudicates ("Non-goals", "Context", "Decision") and the unit the Socratic agent argues about. It maps one-to-one onto the existing SHAPE-04 grain (propose / accept / reject / amend per item), so the whole existing proposal machinery applies without a second mechanism. Markdown stays the interchange format, so a PRD is deterministically `concat(sections)`, which is exactly what the context packet needs. |

### Shape (SQL, all additive)

Follow the idioms already in `packages/core/src/db/migrations/`:

- `documents` (`id` ULID, `project_id`, `kind CHECK IN ('prd','adr')`, `title`, `status`): PRD status `draft | signed_off | superseded`; ADR status `proposed | accepted | superseded` with `supersedes_id` nullable self-reference. The `CHECK` is the authority, as in 0002.
- `document_sections` (`id`, `document_id`, `heading`, `body_md`, `rank` via `fractional_index` (already a dependency, used by `ranking.rs`), `revision`, `revision_of`, `superseded_at`). **Copy the criteria revision design from `0009_criteria_revisions.sql` verbatim:** `revision_of` points at the chain root, the superseded row's text is never overwritten, current-revision filter index on `(document_id, superseded_at)`. One indexed query yields a section's whole history.
- An ADR is the same table with a conventional section set (Context, Options, Decision, Consequences). Do **not** give ADRs fixed columns: it forks the proposal/diff/amend code for no gain.
- Links down to epics: a `document_epics (document_id, epic_id)` join, or nullable `epics.prd_id`. Links ADR to PRD and to constrained epics the same way. Plain foreign keys.
- Full-text: add `document_sections_fts` using the **same external-content FTS5 + three triggers pattern** as `tasks_fts`/`epics_fts` (0002). That also gives you duplicate-flagging on proposed sections for free via `query/search.rs`.

### Integration with the existing rules

- **Rust core owns the DB; sidecar never opens it.** The agent proposes through a board tool on the existing MCP/IPC path (the `propose_item` seam), the core stages it. No new transport.
- **Proposals reuse `authoring_proposals`.** Verbs `create | amend | delete` already match section lifecycle. It needs `target_type` widened to include a section/document value. **That `CHECK` cannot be altered in place**: 0015 did a full table rebuild, so this is another rebuild migration, to be written with 0015 as the template.
- **PRD acceptance bar.** The brief wants the PRD to carry the acceptance bar. `acceptance_criteria.parent_type` is `CHECK IN ('task','epic')` (0002). Reusing the individually-checkable criteria rows means widening that CHECK, i.e. rebuilding `acceptance_criteria`, which `criterion_anchors` references with `ON DELETE CASCADE` (0018). **SQLite's `DROP TABLE` performs an implicit `DELETE` that fires FK cascades when foreign keys are on**, so a naive rebuild deletes every anchor. Either follow 0006/0015's exact foreign-key handling and prove anchors survive in a test, or avoid the rebuild by modelling the PRD bar as a Markdown checklist section (loses per-criterion checking). Flag for the planner as the riskiest migration in the milestone.
- **Event log (DATA-01).** `events.stream_type` has **no CHECK** (0002:119), so `document` / `document_section` streams need no schema change. Write through `append_event` inside the mutation's transaction like every other writer. Put ids, `revision` and `revision_of` in the payload, **not the body**: the revision rows are the append-only history, and a body in the log duplicates every edit. A relay subscriber fetches the revision row by id.
- **Single canonical writer.** The Phase 6 source gate bounds who may write board tables. Extend its allowlist deliberately with one new domain module (`domain::document`), and keep staging as the only path that reaches it from an agent.

**Dependencies added: none.** Confidence: HIGH (design follows two shipped precedents in this repo; the FK-cascade hazard is documented SQLite behaviour).

---

## 2. Editing and rendering surface

### What I measured

Entry-minimal bundles, esbuild `--minify`, `gzip -9`, React externalised where relevant, prod build. These are floors (a real editor adds theme, keymap, UI), but they rank the options honestly.

| Candidate | Version (npm, 2026-10-14) | Licence | gzip floor | Markdown round trip | Inline accept/reject of agent diff | Verdict |
|---|---|---|---|---|---|---|
| **No editor: `<textarea>` + `react-diff-view`** | already installed | MIT | **0 kB new** | Perfect (the text is the Markdown) | Whole-section accept/reject/amend, i.e. the SHAPE-04 grain | **Adopt for v0.2.0** |
| CodeMirror 6 (`state`+`view`+`commands`) | state 6.7.6, view 6.43.14, commands 6.11.1 | MIT | ~89 kB | Perfect (document *is* Markdown) | — | Escalation |
| CodeMirror 6 + `@codemirror/merge` | merge 6.12.2 | MIT | ~99 kB (~184 kB if `@codemirror/lang-markdown` 6.5.2 is added: it drags in the html/css/js language packages) | Perfect | **Native**: `unifiedMergeView({ original, mergeControls })`, `acceptChunk` / `rejectChunk` commands, `updateOriginalDoc` effect, `mergeControls` may be a render function (verified in the installed `.d.ts`) | **Named escalation, pre-chosen** |
| Lexical | 0.52.0 | MIT | ~144 kB | Lossy: `@lexical/markdown` serialises from its own tree | None built in; custom nodes/decorators | Reject |
| TipTap (`core`/`react`/`starter-kit`/`markdown`) | 3.32.0 | MIT (core); paid "Pro" extensions exist, avoid | ~151 kB | `@tiptap/markdown` is recent; normalises on serialise | None built in; custom ProseMirror decorations | Reject |
| Milkdown (`@milkdown/kit`, commonmark preset only) | 7.22.3 | MIT | ~117 kB (no theme/UI) | Best of the WYSIWYG set (remark based) but still tree → serialise | None built in | Reject |
| Plate | `platejs` 53.3.15 | MIT | not measured (Slate + its own plugin graph) | Slate JSON → Markdown serialiser | None built in | Reject, not worth measuring: shadcn-oriented and the largest dependency graph of the set |
| Monaco | `monaco-editor` 0.57.0 (101 MB unpacked), `@monaco-editor/react` 4.7.0 | MIT | multiple MB, plus web workers | Perfect | Has a diff editor, but whole-pane and no per-chunk accept/reject controls | Reject |

### Why "add nothing" is credible, and why it wins for v0.2.0

1. **The item grain is the section, and a section is small.** The existing contract (D-94, `ProposalAmendEditor.tsx`) already says: the human corrects a staged row *before* it lands, and accepting is a separate later action. Per-hunk partial acceptance inside one section is therefore redundant with **amend**: if the human wants half the agent's rewrite, they amend the staged text, then accept. CodeMirror's per-chunk controls solve a granularity problem the section model deliberately removed.
2. **The diff renderer is already installed and already styled.** `review/FileDiff.tsx` takes a patch string, runs `parseDiff` → `tokenize` → `<Diff>`, and `markEdits` (react-diff-view) gives intra-line edits, which is what prose needs. I tested that `diff@9`'s `structuredPatch` + `formatPatch`, with a `diff --git a/x b/x` first line, parses cleanly in `parseDiff` (1 file, hunk of `normal,delete,insert,normal,insert`). The only new code is a ~10-line adapter. Reuse the existing 55 kB lazy chunk; no new editor chunk.
3. **The edit surface already exists.** A `<textarea>` with native undo, spellcheck and IME is a legitimate Markdown source editor for 50-300 word sections, and it is the pattern the codebase has proven (and tested) for amending staged text.
4. **Markdown-as-source removes a whole class of bug.** No tree, no serialiser, no normalisation drift, no editor schema in the store. The relay milestone can render the same text in a browser with any editor.
5. **Monaco cannot "serve instead".** It is not in the tree, so "reuse" is a false economy; `@monaco-editor/react` loads Monaco from a CDN by default, which breaks local-first/offline and only works today because `tauri.conf.json` has `"csp": null`; Monaco is a code editor with no prose affordances; and its diff view cannot accept or reject per chunk. `react-diff-view` is the right tool already installed.

### The one honest cost of "add nothing"

Reading a PRD as raw Markdown source looks unfinished, and the milestone goal includes "a tool worth returning to". PRDs and ADRs are read far more often than edited. So the one addition I recommend is a **read-only renderer**, not an editor:

| Library | Version | Licence | gzip | Why |
|---|---|---|---|---|
| `react-markdown` | 10.1.0 (peer `react >=18`) | MIT | ~38 kB | Emits React elements, **never `dangerouslySetInnerHTML`**; raw HTML in the source is not rendered by default; `javascript:` URLs are stripped by the default URL transform. Matters because the *agent* authors this text and renders inside a Tauri WebView whose IPC is reachable from script. |
| `remark-gfm` | 4.0.1 | MIT | ~12 kB (50 kB gzip total with react-markdown, measured) | PRDs and ADRs use tables, task lists, strikethrough. |
| `diff` (jsdiff) | 9.0.0 | BSD-3-Clause | ~3 kB | Section-vs-proposal patch for `react-diff-view`. Myers diff is not "a few lines"; hand-rolling it is the wrong lazy. |

All three load only in the document surfaces' lazy chunk. The existing app already splits `ReviewSurface`/`FleetSurface`, so there is a precedent.

**Read-view rules (not optional):**
- `disallowedElements={['img']}` and render `a` as inert text with the URL in a tooltip. A normal anchor click navigates the *application* WebView. Do not add an opener plugin for this.
- `tauri.conf.json` has `"csp": null` today. **Set a CSP in the same phase that first renders agent-authored text** (`default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, plus the IPC origins Tauri documents). Verify against the Tauri v2 CSP guide when planning; I did not re-verify the exact directive list. A CSP is cheap now and an incident later.

### CodeMirror 6: the pre-chosen escalation

Add it **only if** one of these becomes true, and nothing else: (a) real sections routinely exceed a screen so a `<textarea>` is unusable; (b) the owner asks to accept part of an agent rewrite *without* amending; (c) a live inline-suggestion UX (agent typing into the doc while the human watches) is wanted. If triggered: `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.14, `@codemirror/commands` 6.11.1, `@codemirror/merge` 6.12.2 (all MIT), as a lazy chunk, about +99 kB gzip, using styled-source (headings sized via a `HighlightStyle` drawn from `tokens.css`), not live-preview. Skip `lang-markdown` unless syntax colouring is demanded, because it adds ~85 kB gzip of html/css/js grammars. This is a drop-in replacement for the `<textarea>`: the data model does not change, which is the point of choosing Markdown-in-sections.

**Open-core check:** react-markdown, remark-gfm, CodeMirror: MIT. jsdiff: BSD-3-Clause (permissive; keep the notice in third-party attributions). No copyleft, no AGPL, no "source-available" editor. TipTap's paid Pro tier and Plate's commercial templates are the licence risks avoided by not choosing them.

---

## 3. Phase / cycle layer above epics

**Confirmed: schema migration only, no dependency.**

- `phases` table (`id`, `project_id`, `title`, `goal`, `rank` via `fractional_index`, optional `starts_on`/`ends_on` via `chrono`, `status`).
- `ALTER TABLE epics ADD COLUMN phase_id TEXT REFERENCES phases(id)`. SQLite allows `ADD COLUMN ... REFERENCES` when the default is NULL, so **no table rebuild**, unlike the CHECK widenings above. The fixed epic → task → issue spine and the status CHECK are untouched, so BOARD-01 holds structurally.
- Progress: extend `query/epic_progress.rs` to aggregate by phase. It is a derived read, stored nowhere (the repo's established "derive, do not store" stance, cf. reclaim eligibility and `stale`).
- Roadmap on screen: a virtualised list/timeline using `@tanstack/react-virtual` already installed. `@xyflow/react` is **not** needed and is not installed; do not add it for a linear roadmap.
- Events: `phase` stream type needs no schema change (`events.stream_type` is unconstrained).

Confidence: HIGH.

---

## 4. Dark-first visual direction and colour

### What `tokens.css` provides today

Read from `packages/desktop/src/styles/tokens.css` and `motion.css`:

- **Mechanism.** Light values in `:root`; one `@media (prefers-color-scheme: dark)` block re-declares *every* mirrored name. There is no user toggle and no `data-theme` attribute. `contrast.test.ts` finds each mode's block by **splitting the file at that media-query line** (`DARK_BLOCK_START`), and `theme/tokens.ts` is a typed mirror (`LIGHT`/`DARK`: `Palette`) asserted equal to the CSS per mode. A Playwright dark arm exists (`vitest.browser.dark.config.ts`, `colorScheme: "dark"`).
- **Dark palette.** Near-black ground `#0a0a0a`, surface `#0f0f0f`, divider `#2c2c2c`, control border `#707070`, three overlay-edge tiers by lightness, text `#ededed` / `#8b8b8b` / placeholder `#7c7c7c`, row surfaces `#0c0c0c`–`#101010`, scrim 0.4.
- **Colour roles.** One brand blue (`#3c64dd`, lifted to `#5175e1` for text in dark, derived "by search, not by eye"), and exactly three data channels: success `#3fb950`, destructive `#f85149`, blocked `#d29922`. `legend/runStatus.ts` maps run states onto them: running = brand, blocked = blocked, completed = success, failed/abandoned = destructive, interrupted = muted, awaiting_review = ink.
- **Type, space, radius, motion.** Archivo variable font; spacing scale xs..3xl; radii 3px/6px; one easing and five named durations; reduced-motion zeroes them.

### What is missing for the new direction

1. **Roles with no colour of their own:** `merged`, `proposed` / agent-authored, `in_review` as a distinct hue, per-phase accent, ADR status (`proposed/accepted/superseded`), PRD signed-off. Today these must borrow from five roles; "colour carries state" needs about 3-5 more *named* roles, not a ramp per hue.
2. **Fill/tint variants.** Every role is text-or-edge only. Decision D-11 explicitly retired fills and tints ("colour is a data channel only"), and `brand-rule.test.ts` enforces an allowlist of where the brand may be spent, mirrored against `08.1-UI-SPEC.md`. **"Saturated accents" partly reverses D-11.** Say so in the requirements and update spec, allowlist and tests together ("widen both together, or neither", per that test's own comment). This is a design decision with test fallout, not a library question.
3. **Dark-first as a mechanism.** Today dark is "whatever the OS says". If dark must be the *default* regardless of OS, `:root` must flip and the test's split point changes. Any restructure must change `DARK_BLOCK_START` and the drift parser in lockstep, or the "drift check compares a mode against its own block" guarantee silently breaks.
4. **Saturated accents on near-black fail WCAG 2 easily** (saturated blues and reds are low-luminance). Each new role needs a dark-lifted text variant in the existing pattern (`accent-nontext` vs `accent-text-rack`).
5. **A monospace stack** for Markdown source and ADR text: use the system stack (`ui-monospace, SFMono-Regular, Menlo`); no font dependency.

### Is a colour library warranted? **No.**

| Candidate | Version | Licence | Verdict |
|---|---|---|---|
| **Nothing new** | — | — | **Adopt.** `theme/contrast.ts` already implements WCAG 2.x luminance and contrast in 41 lines, and `contrast.test.ts` already asserts every text role ≥ 4.5:1 and every non-text role ≥ 3:1 on every surface, per mode, against the shipped CSS bytes. The existing method for choosing a value (hold hue and saturation, step lightness until the worst surface clears the target) is a 10-line loop. |
| `culori` | 4.0.2 | MIT | Excellent library (OKLCH/OKLab, `wcagContrast`), 17 kB gzip floor. As a **one-off** it is perfect: run it via `npx` in a scratch script to pick hex values, then commit the hex. Committing it as a dependency buys nothing at runtime, because tokens are static hex mirrored into `tokens.ts` for the tests. |
| `colorjs.io` | 0.7.1 | MIT | 15.8 MB unpacked, pre-1.0 API, includes APCA. No runtime use. |
| `chroma-js` | 3.2.0 | BSD-3-Clause AND Apache-2.0 | Dual-licence notice burden, no advantage. |

**Rule:** colour values are computed once, offline, and committed as hex in `tokens.css` and `tokens.ts`. If ramps ever become *runtime* (user-chosen accent, per-project colour), revisit and add `culori` then. Native CSS `oklch()` / `color-mix()` are not used here because the typed mirror and contrast test require literal hex.

Should the team want APCA (perceptual contrast, better for light-on-dark saturated text) as a *second* check, that is a test-only addition (a devDependency), and a deliberate departure from the WCAG 2 standard the whole token system is built on. Not recommended for this milestone.

Confidence: HIGH on the inventory (read from files); MEDIUM on the "saturated accents fail WCAG 2 easily" claim (general colour-science knowledge, to be proven by the contrast test during the phase).

---

## 5. Agent-assisted review

**Confirmed: no new dependency.** Everything needed is in the tree:

- **Running it:** a pre-review is another agent run through `packages/sidecar/src/claude-code-adapter.ts` (the user's own `claude` binary, no API key, which matches the standing rule), read-only toolset, using the same permission and scope hooks as an execution run.
- **Getting structured output back:** a board tool exposed over the sidecar's existing MCP server path (`@modelcontextprotocol/sdk` 1.30.0 is already its dependency) in the manner of `propose_item`: `record_verdict(criterion_id, verdict, evidence)`. Do not parse prose out of the stream.
- **Where verdicts land:** a small `review_verdicts` table keyed to `acceptance_criteria` (current revision) and the run, with a nullable link to the existing `criterion_anchors` row (path, side, line range, sha) as evidence. The agent's verdict is a *proposal the user adjudicates*; it must not flip `acceptance_criteria.checked`. That keeps the Phase 6 structural no-promotion guarantee: route through staging, do not give the review writer a direct write to `checked`.
- **Showing it:** `review/CriteriaRail.tsx`, `FileDiff.tsx` (which already accepts `anchors` badges) and `DecisionFoot.tsx` render verdicts; `react-query` carries server state, Zustand carries UI state.
- **Staleness:** reuse the existing derive-from-git-on-read approach for anchors (D-141); no `stale` column.

**Do not add `@anthropic-ai/claude-agent-sdk`.** It is not currently used; the registry shows 0.3.299 with licence `SEE LICENSE IN README.md` (Anthropic's terms, not an OSI licence), which is a poor fit for an open-core desktop app's dependency tree, and it is unnecessary here.

Confidence: HIGH that no dependency is needed; MEDIUM on the exact tool shape, which belongs in phase research.

---

## Recommended additions (the entire list)

| Library | Version | Licence | Where | Gzip | Required? |
|---|---|---|---|---|---|
| `react-markdown` | 10.1.0 | MIT | desktop, lazy document chunk | ~38 kB | Recommended (read view) |
| `remark-gfm` | 4.0.1 | MIT | desktop, same chunk | ~12 kB | Recommended with the above |
| `diff` | 9.0.0 | BSD-3-Clause | desktop, same chunk | ~3 kB | Required if proposals render as diffs |
| *(escalation)* `@codemirror/state` / `view` / `commands` / `merge` | 6.7.6 / 6.43.14 / 6.11.1 / 6.12.2 | MIT | desktop, lazy | ~99 kB total | Only on the triggers in section 2 |

Rust: **no new crates.** `fractional_index`, `chrono`, `sha2`, `rusqlite`, `rusqlite_migration`, `ulid` cover phases, sections, hashing and ranking.

## Do NOT add

| Do not add | Reason |
|---|---|
| Lexical, TipTap/ProseMirror, Milkdown, Plate (any WYSIWYG) | 117-151 kB gzip each for a capability the section model removes the need for; every one forces a tree ↔ Markdown serialiser that manufactures spurious diffs in agent proposals; none ships accept/reject-as-decoration; TipTap's paid Pro tier and Plate's commercial surface add licence risk to the open-core boundary. |
| `monaco-editor` / `@monaco-editor/react` | Not in the tree despite the brief; multi-MB; CDN loader by default breaks local-first (and is masked by `csp: null`); no prose features; its diff pane has no per-chunk accept/reject. Remove it from the v0.1.0 install line so nobody runs it. |
| `@codemirror/*` **now** | Right tool, wrong milestone. Ship the textarea; escalate on a stated trigger. |
| `@xyflow/react` | Not installed; the phase roadmap is a linear list. |
| `culori`, `colorjs.io`, `chroma-js` as dependencies | Colour is a build-time, one-off job with an existing contrast harness. Use `culori` through `npx` for the one-off if wanted. |
| `marked` / `markdown-it` + `DOMPurify` / `dangerouslySetInnerHTML` | Turns agent-authored text into an HTML injection surface inside a WebView with IPC access. `react-markdown` renders elements, not strings. |
| `@anthropic-ai/claude-agent-sdk` | Unused today, non-OSI licence, unnecessary for pre-review. |
| `diff-match-patch` | Last published 2022, Apache-2.0, no advantage over jsdiff 9. |
| Yjs / Automerge / CRDT text, ElectricSQL etc. | Already banned; concurrent-text merging is a relay-milestone problem. Revision rows plus an append-only log keep that door open. |
| A `similar`/`comrak`/`pulldown-cmark` Rust crate | Would move Markdown/diff concerns into the core with no consumer; the renderer does presentation. Revisit only if the *sidecar or core* must parse Markdown (e.g. extracting headings server-side), which nothing in v0.2.0 requires. |

## Installation

```bash
# desktop, only if the read view and diff proposals are in scope
npm --prefix packages/desktop install --save-exact react-markdown@10.1.0 remark-gfm@4.0.1 diff@9.0.0
```

(Existing repo convention is exact pins in `packages/desktop/package.json`.) No dev dependencies. No Cargo changes.

## Roadmap implications

1. **Migrations first.** One phase lands `phases`, `documents`/`document_sections` (+FTS), and the two CHECK-widening rebuilds (`authoring_proposals.target_type`, and the `acceptance_criteria.parent_type` decision). Flag the criterion-anchor cascade hazard for deeper phase research.
2. **CSP before the first agent-authored Markdown renders.** Same phase as the document read view.
3. **Visual direction after the IA exists**, as the milestone already says; its spec change (reversing D-11's no-fills rule, widening the brand allowlist and the dark-block split) is a tracked deliverable, not an incidental edit.
4. **Research flags:** phase for migration rebuilds (deeper research: yes); document read view and CSP (light research on Tauri v2 CSP directives); agent-review tool shape (phase-level research); phase layer and colour roles (standard patterns, none needed).

## Sources and confidence

- Repo files read 2026-10-14: `.planning/PROJECT.md`, `.planning/research/STACK.md`, `CLAUDE.md`, `packages/desktop/package.json`, `src/styles/tokens.css`, `motion.css`, `src/theme/tokens.ts`, `contrast.ts`, `__tests__/contrast.test.ts`, `__tests__/brand-rule.test.ts`, `src/legend/runStatus.ts`, `src/review/FileDiff.tsx`, `highlight.ts`, `src/authoring/ProposalAmendEditor.tsx`, `packages/core/Cargo.toml`, `packages/core/src/db/migrations/0002, 0009, 0015, 0018`, `packages/core/src/domain/event.rs`, `authoring_proposal.rs`, `packages/sidecar/package.json`, `src/claude-code-adapter.ts`, `src-tauri/tauri.conf.json`. HIGH.
- npm registry (`npm view`, 2026-10-14): versions and licences for every package named above. HIGH for version/licence, since they are the registry's own fields. (`@anthropic-ai/claude-agent-sdk`'s licence field reads `SEE LICENSE IN README.md`; I did not read the README terms.)
- Bundle sizes: esbuild minify + `gzip -9` of minimal import sets in a scratch directory, 2026-10-14. MEDIUM (floors, my measurement, not vendor figures).
- `@codemirror/merge` API (`unifiedMergeView`, `mergeControls` as boolean or function, `acceptChunk`, `rejectChunk`, `updateOriginalDoc`, `allowInlineDiffs`, `collapseUnchanged`): read from the installed 6.12.2 `dist/index.d.ts`; changelog from the CodeMirror merge repo. HIGH.
- jsdiff → `react-diff-view` `parseDiff` compatibility: executed locally with `diff@9.0.0` and `react-diff-view@3.3.3`. HIGH.
- SQLite `DROP TABLE` implicit `DELETE` with foreign keys on, and `ADD COLUMN ... REFERENCES` with NULL default: documented SQLite behaviour, recalled not re-fetched. MEDIUM; prove with a test in the migration phase.
- Tauri v2 CSP directive details: not re-verified. LOW-MEDIUM; confirm during phase research.
