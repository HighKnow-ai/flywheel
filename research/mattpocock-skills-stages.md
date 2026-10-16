# How mattpocock/skills structures each stage, and what Flywheel can borrow

Research for [How does mattpocock/skills structure each stage, and can Flywheel borrow it?](https://github.com/HighKnow-ai/flywheel/issues/5) (map: issue #4). Written 2026-10-16.

## Sources

- Upstream repo `mattpocock/skills`, `main` at commit `49dd158d1076134a641b33efb035946536778336` (pushed 2026-10-13). Below, `[U:path]` means `https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/<path>`.
- Local installed plugin `mattpocock-skills` 1.3.1 at `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/`. I diffed the eight core SKILL.md files (grilling, to-spec, to-tickets, wayfinder, triage, domain-modeling, tdd, codebase-design) against upstream `main`, and all eight are byte-identical. Everything quoted below holds for both copies.
- Flywheel `LICENSE` (Apache-2.0) and `NOTICE` at the repo root, and `GLOSSARY.md` (not yet committed) in the mvp checkout.

## 1. The architecture of the skill set

Three structural facts shape everything else.

1. **Two tiers: orchestrators and disciplines.** User-invoked skills (`disable-model-invocation: true`) orchestrate a stage. Model-invoked skills hold reusable discipline that any stage can pull in. "A user-invoked skill may invoke model-invoked skills, but never another user-invoked one" [U:README.md, "Reference"]. Several orchestrators are only a few lines long. `grill-with-docs` is literally "Call the Skill tool twice, for "grilling" and "domain-modeling"" [U:skills/engineering/grill-with-docs/SKILL.md].
2. **One interview primitive under every challenge flow.** `grilling` is "the reusable interview primitive behind `grill-me`, `grill-with-docs`, `triage`, `wayfinder` and `improve-codebase-architecture`" [U:README.md].
3. **The tracker is abstract.** Every tracker-touching skill says "The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`" [U:skills/engineering/to-spec/SKILL.md, to-tickets, triage, code-review]. The tracker can be GitHub, GitLab, local files or "anything else you describe" [U:README.md, step 2]. **For Flywheel this is the adaptation seam: the board *is* the tracker.** The skills never assume GitHub semantics beyond "issue", "sub-issue", "native blocking" and "label".

The main flow, as the router skill describes it [U:skills/engineering/ask-matt/SKILL.md]:

```
grill-with-docs ──(optional prototype detour)──► to-spec ──► to-tickets ──► implement per ticket (/clear between)
                                                                              └─ tdd at agreed seams, then code-review
on-ramps:  triage (raw incoming issues) ─► implement
           wayfinder (foggy, multi-session effort) ─► to-spec
closing:   retro (improves the agent's environment, not the code)
```

**Context hygiene is the same thesis as Flywheel's.** "Keep steps 1–3 in one unbroken context window (don't compact or clear until after `/to-tickets`)… Each `/implement` then starts fresh, working from the ticket" [U:skills/engineering/ask-matt/SKILL.md, "Context hygiene"]. In other words: shaping is context-expensive and kept whole, while execution is disposable and rebuilt from the ticket. That is Flywheel's "the board makes `/clear` free" claim, stated as a procedure.

## 2. Stage by stage

Each entry gives inputs, conversation shape, artefact, handoff, and the Flywheel record it would shape.

### grilling (model-invoked primitive) [U:skills/productivity/grilling/SKILL.md]

- **Inputs:** a plan, decision or idea. Nothing else is required.
- **Conversation shape:** the agent maps a **design tree** and works it in **rounds**. Each round asks the whole **frontier**, meaning every decision whose prerequisites are settled. Questions are numbered, each comes with "your recommended answer", and each is worded "so "yes" accepts your recommended answer". A question that depends on another still-open question waits for a later round. "Finding *facts* is your job, never the user's": facts go to subagents, non-blocking, while "the *decisions* are the user's".
- **Artefact:** none of its own. It produces shared understanding.
- **Handoff / exit:** "done when the frontier is empty… Do not act on it until the user confirms you have reached a shared understanding."
- **Flywheel:** this is the **challenge flow** for every record type, the generic "shape it together with an agent" loop the map's Notes call for. The round format (numbered questions, a recommendation, yes means accept) maps directly onto a UI: one card per question, with an accept button.

### domain-modeling (model-invoked) [U:skills/engineering/domain-modeling/SKILL.md, ADR-FORMAT.md, GLOSSARY-FORMAT.md]

- **Inputs:** an ongoing design conversation, plus `GLOSSARY.md`, `docs/adr/` and the code.
- **Conversation shape:** runs alongside grilling. The agent challenges terms against the glossary ("Your glossary defines 'cancellation' as X, but you seem to mean Y"), sharpens fuzzy words, invents edge-case scenarios, and cross-checks claims against the code.
- **Artefacts:** `GLOSSARY.md`, updated inline the moment a term resolves ("Don't batch these up"), and kept "totally devoid of implementation details". It also produces **ADRs**, offered only when all three tests hold: hard to reverse, surprising without context, and the result of a real trade-off. An ADR is `docs/adr/NNNN-slug.md`, and "can be a single paragraph". Status, Considered Options and Consequences are optional.
- **Handoff:** artefacts are written in place. Later stages "respect ADRs in the area you're touching" (to-spec, to-tickets, tdd, triage all say so).
- **Flywheel:** shapes the **ADR** record directly. The three-test gate is the ready-made answer to "when does an agent propose an ADR" (map, "Not yet specified: ADR challenge flow"). Flywheel's GLOSSARY.md already uses this exact format (bold term, definition, `_Avoid_:`). The upstream ADR has no link-to-record field. Flywheel's "linked to the Milestone, Epic or Story where the decision came up" is an addition.

### wayfinder (user-invoked) [U:skills/engineering/wayfinder/SKILL.md]

- **Inputs:** "a loose idea… too big for one agent session". Later sessions take the map.
- **Conversation shape:** charting is two grills. The first, with grilling plus domain-modeling, names the **destination**. The second, breadth-first, maps the **frontier**. Working through the map takes one ticket per session ("never resolve more than one ticket per session", except research). The ticket is claimed by assignment first, then resolved according to its `wayfinder:<type>` label: research (AFK), prototype (HITL), grilling (HITL) or task.
- **Artefact:** a **map** issue (Destination, Notes, Decisions so far, Not yet specified, Out of scope) plus child **decision tickets** with native blocking. The map is "an index, not a store": each decision lives only in its ticket's resolution comment. "Fog" graduates into tickets as resolutions clear it.
- **Handoff:** "it hands off, it doesn't build: merge onto the main flow at `/to-spec`, which collapses the map's linked decisions into a buildable plan" [U:skills/engineering/ask-matt/SKILL.md].
- **Flywheel:** closest analogue to **Roadmap** and **Milestone**. Destination maps to the Milestone's **exit test**. The map's index-not-store rule and fog-of-war sections are a usable model for a Roadmap that agents co-design. Gap: wayfinder resolves decisions toward *one* destination. It has no notion of an *ordered list* of destinations, which is what a Roadmap of Milestones is, and no procedure for reordering them.

### to-spec (user-invoked) [U:skills/engineering/to-spec/SKILL.md]

- **Inputs:** the current conversation (usually a just-finished grill), plus codebase exploration, glossary and ADRs.
- **Conversation shape:** deliberately *not* an interview: "Do NOT interview the user; just synthesize". There is one checkpoint. The agent sketches the **test seams** ("the ideal number is one") and confirms them with the user.
- **Artefact:** a spec published as one tracker issue, labelled `ready-for-agent`, with sections Problem Statement, Solution, User Stories ("A LONG, numbered list"), Implementation Decisions, Testing Decisions, Out of Scope and Further Notes. It contains no file paths or code, unless a prototype snippet encodes a decision.
- **Handoff:** to `to-tickets`, in the same context window.
- **Flywheel:** shapes the **Epic** spec. The fit is good, with one tension. Flywheel's Epic is "a short spec covering the problem, the scope and what is out of scope" [GLOSSARY.md], while to-spec demands an "extremely extensive" user-story list. Flywheel should keep Problem, Solution and Out of Scope, keep Testing Decisions (the seams feed **Checks**), and either drop the long user-story list or treat each story line as a seed for a **Story** rather than as body text.

### to-tickets (user-invoked) [U:skills/engineering/to-tickets/SKILL.md]

- **Inputs:** a spec, plan or conversation, or a reference to one, which it fetches with comments.
- **Conversation shape:** draft, then **quiz**. It presents the breakdown as a numbered list (Title, Blocked by, What it delivers) and asks three questions: is the granularity right, are the blocking edges right, should anything be merged or split? It iterates "until the user approves the breakdown".
- **Artefact:** one ticket per **tracer-bullet vertical slice**. Each slice cuts "a narrow but COMPLETE path through every layer", is "demoable or verifiable on its own", and is "sized to fit in a single fresh context window", with prefactoring first. Each ticket has *What to build*, *Acceptance criteria* (checkboxes), *Blocked by* (native edges where the tracker has them), and is a sub-issue of the source. Tickets are labelled `ready-for-agent`. Wide refactors are sequenced expand, migrate batches, then contract.
- **Handoff:** to `implement` per ticket with `/clear` between, or to `implement-spec` across the ready frontier in parallel worktrees [U:skills/engineering/implement-spec/SKILL.md].
- **Flywheel:** shapes the **Story** and its **Acceptance criteria**, nearly one-to-one. "Sized to fit in a single fresh context window" plus "verifiable on its own" is exactly a Story that owns a worktree. Blocking edges and the "frontier" give Story ordering inside an Epic. In Flywheel, the approved breakdown would arrive as a batch of **Proposals** (create Story ×N) accepted together, which is what the quiz step already is.

### tdd (model-invoked) [U:skills/engineering/tdd/SKILL.md, tests.md, mocking.md]

- **Inputs:** a ticket or behaviour, plus the glossary for test naming.
- **Conversation shape:** one human checkpoint up front. "Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam", with a one-line note per seam on what it catches and misses. After that, an AFK loop: red, then green, "One seam, one test, one minimal implementation per cycle". Refactoring is excluded from the loop and belongs to code-review.
- **Artefact:** tests at agreed seams, and code.
- **Handoff:** to `code-review` (a two-axis Standards and Spec review, in parallel subagents, of the diff since a fixed point [U:skills/engineering/code-review/SKILL.md]). The Spec axis checks the diff against the originating issue.
- **Flywheel:** shapes **Checks**: the agreed seam *is* where a Check attaches to an Acceptance criterion. It also informs **Tasks**, since each red-green slice is a natural Task checklist line. code-review's Spec axis is the "judged against the Story's diff at review" step [GLOSSARY.md, Acceptance criterion].

### triage (user-invoked) [U:skills/engineering/triage/SKILL.md, AGENT-BRIEF.md, OUT-OF-SCOPE.md]

- **Inputs:** raw issues (and optionally external PRs) the user did not create. "Tickets that `/to-tickets` produced are already agent-ready, so don't triage them" [U:skills/engineering/ask-matt/SKILL.md].
- **Conversation shape:** a state machine. There are two category roles (bug, enhancement) and five states: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. Per item the steps are: gather context, run a redundancy check and a prior-rejection check against `.out-of-scope/`, **recommend and wait**, verify the claim (reproduce it), grill if needed, then apply the outcome. Every AI-posted comment starts with a "generated by AI during triage" disclaimer.
- **Artefacts:** an **agent brief** comment ("the brief is the contract"), which is behavioural not procedural, contains no file paths, and must have "concrete, testable acceptance criteria… independently verifiable" plus explicit out-of-scope. It can also produce needs-info notes, or a `.out-of-scope/<concept>.md` file for rejected enhancements.
- **Handoff:** ready-for-agent goes to `implement`.
- **Flywheel:** shapes **Proposal** acceptance, meaning the inbox. Accept maps to ready-for-agent/ready-for-human, reject maps to wontfix, and needs-info maps to "agent, sharpen this". The redundancy and prior-rejection checks, and the out-of-scope knowledge base, are directly useful against the "how many proposals arrive" problem (map, "Proposal inbox"). The brief's AC rules are a good quality bar for Acceptance criteria anywhere.

### codebase-design (model-invoked) [U:skills/engineering/codebase-design/SKILL.md]

- **Inputs:** a module or interface under design. It is "a reference to consult, not a session to run" [U:skills/engineering/tdd/SKILL.md].
- **Shape:** a vocabulary (module, interface, depth, seam, adapter, leverage, locality) and principles: the deletion test, "the interface is the test surface", and "one adapter means a hypothetical seam, two adapters means a real one".
- **Artefact / handoff:** none. It feeds to-spec's seams, tdd's seams and improve-codebase-architecture.
- **Flywheel:** not a record. It shapes the *Implementation and Testing decisions* inside an **Epic** spec and where **Checks** sit. The "two adapters" rule also argues against Flywheel building speculative seams, which matches the relaxed architecture constraint in the map's Notes.

### Other stage-shaping skills found

- **prototype** [U:skills/engineering/prototype/SKILL.md]: a throwaway HTML logic demo or toggleable UI variants. It is kept "as a primary source" on a `prototype/<name>` branch with a pointer from the issue. In Flywheel it is an asset linked from an Epic or Story, or a wayfinder ticket.
- **implement / implement-spec**: the execution stage. implement fetches the ticket, runs tdd at agreed seams, typechecks, runs code-review, then commits. implement-spec runs implementer subagents "each in its own worktree on its own branch" on an integration branch, and talks to them via "context pointers… Don't duplicate information". This is Flywheel's Story execution and context packet.
- **handoff** [U:skills/productivity/handoff/SKILL.md]: "Do not duplicate content already captured in other artifacts… Reference them by path or URL". This is the context-packet principle for rebuilding a Story session.
- **retro** [U:skills/engineering/retro/SKILL.md]: after a session, it suggests *environment* improvements (checks, coding standards, navigation), most severe first. In Flywheel, a retro is a natural source of **Proposals** at the end of a Story session.
- **improve-codebase-architecture**: a survey that "generates an idea" to feed into grill-with-docs. In Flywheel that is a Proposal to create an Epic.

## 3. Stage-to-record map

| Flywheel record | Shaped by | Borrow as-is | Adapt / gap |
|---|---|---|---|
| Roadmap | wayfinder (map) | index-not-store, fog of war, out-of-scope that never graduates | no ordering of several destinations; co-design and reorder flow is new |
| Milestone | wayfinder (destination) | "naming the destination is the first act", grill it first | destination maps to exit test; no dates in either |
| Epic | grill-with-docs, then to-spec | Problem / Solution / Out of scope / Testing decisions; no file paths | cut the "LONG" user-story list to fit a *short* spec |
| Story | to-tickets | tracer-bullet vertical slice, fits one fresh context, blocking edges, frontier | tickets become a batch of Proposals accepted together |
| Task | tdd loop | one red-green slice per step | no upstream equivalent of an agent-maintained checklist |
| Acceptance criterion | to-tickets template, triage AGENT-BRIEF | "concrete, testable… independently verifiable" | judged at review by code-review's Spec axis |
| Check | tdd seams, to-spec Testing decisions | confirm seams with the human before any test | upstream has no executable-attached-to-criterion object |
| ADR | domain-modeling, ADR-FORMAT | three-test gate, one-paragraph format, sequential numbering | add the link to the originating record |
| Proposal | triage (+ retro, improve-codebase-architecture, wayfinder fog graduation as sources) | recommend then wait, redundancy and prior-rejection checks, out-of-scope KB, AI disclaimer | upstream triages *external* issues; Flywheel triages *agent-filed* ones |
| (all records) | grilling | rounds over the frontier, a recommended answer per question, facts are the agent's job | the universal challenge flow |

## 4. Licence

**Verdict: MIT, compatible with Flywheel's Apache-2.0. Borrowing is allowed with one obligation: ship the copyright and permission notice with any substantial portion.**

- **Exact licence:** MIT License, "Copyright (c) 2026 Matt Pocock" [U:LICENSE]. GitHub's API reports `MIT` for the repo, and the plugin manifest says `"license": "MIT"` [U:.claude-plugin/plugin.json].
- **The one condition:** "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." There is no copyleft, no patent clause and no endorsement clause.
- **Compatibility:** Flywheel is Apache-2.0 (`LICENSE`). MIT-licensed material can be included in an Apache-2.0 distribution. The adapted prompts stay under MIT for the copied portions, and Flywheel's own changes can be Apache-2.0.

What Flywheel has to do if it embeds adapted prompts (verbatim or close paraphrase):

1. **Ship the MIT text with the binary and the source.** Put the full MIT notice in, for example, `LICENSES/mattpocock-skills.txt` (or a THIRD-PARTY file), and make sure it is bundled into the desktop app's resources. The prompts ship inside the app, so the notice has to as well, for example in an "Open-source licences" view.
2. **Add a line to `NOTICE`.** Apache-2.0 doesn't require this for third-party MIT code, but Flywheel's NOTICE already credits the bundled Node.js runtime, and this matches that convention: "This product includes prompts adapted from mattpocock/skills (https://github.com/mattpocock/skills), Copyright (c) 2026 Matt Pocock, under the MIT License (see LICENSES/mattpocock-skills.txt)."
3. **Mark the adapted files.** Keep them in one module with a header naming the source skill and upstream commit, and note that they were modified. Apache §4(b) asks for modification notices on Apache-licensed files. It isn't strictly needed for MIT parts, but it is cheap and keeps the provenance clear.
4. **Ideas are free; wording is what's licensed.** Re-expressing the *method* in Flywheel's own words carries no obligation: design tree, frontier, tracer bullets, the three-test ADR gate, the triage states. Copyright covers expression, not concepts. Attribution is still good form, given the product idea explicitly draws on these skills.
5. **Watch the one embedded third-party piece.** `pr`'s Summary section is "reproduced almost word for word" from Dex Horthy's `show-me` skill in humanlayer/humanlayer [U:skills/engineering/pr/CREDITS.md]. I did not check that repo's licence. If Flywheel adapts `pr`, check humanlayer's licence first. None of the eight core stage skills carry such a credit.
6. **Don't imply endorsement.** MIT grants no trademark rights. Credit "adapted from mattpocock/skills", but don't use Matt Pocock's name or the "Skills For Real Engineers" branding to market Flywheel.

## 5. Takeaways for the MVP spec

- Borrow the **grilling primitive** wholesale as the single challenge flow behind every record type. Its round format is already UI-shaped.
- The **orchestrator plus discipline split** is a cheap architecture for Flywheel's built-in method. Each record type's flow is a thin orchestrator over shared disciplines (grilling, domain-modeling, codebase-design, tdd).
- **The board replaces `/setup-matt-pocock-skills`.** Every skill reaches the tracker through an abstract "issue tracker" vocabulary, so adapting them is mostly a matter of rebinding issue, sub-issue, blocking and label onto Epic, Story, blocking and state.
- New design is needed where upstream has no stage: **Roadmap ordering**, **Proposals filed by agents during execution** (triage only handles human-filed incoming work), **Check** as a first-class object, and **Task** as an agent-maintained checklist.
