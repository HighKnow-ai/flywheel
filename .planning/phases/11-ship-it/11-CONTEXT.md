# Phase 11: Ship It - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers **a macOS application Cyril installs like any other app, that keeps itself
current, that another developer can clone and build, and whose open-core boundary is provable with
the commercial layer absent** — plus the one-batch redemption of the deferred human-verification
register that every prior phase has been queueing since 2026-10-07.

Concretely: a tag-driven release pipeline producing a `.dmg` and an updater tarball; the Tauri
updater wired to a manifest published with the release; a public, Apache-2.0 repository a stranger
can clone and build from source; a compile-time proof that no feature depends on the relay; and a
full drain of `.planning/DEFERRED-REVIEW.md` against the installed build.

It is **not** new product capability. Nothing on the board, in the agent loop, in dispatch or in
the review surface gains behaviour here, with two named exceptions that exist only because a
register item demanded a decision: a reversible project soft-hide (D-193) and the review anchor
widget's border fix (D-192).

**Out of scope, named explicitly so planning does not drift into it:** the relay, sync, mobile or
web surfaces (RLAY-*); scheduled automations (the `tokio-cron-scheduler` trigger type stays
stubbed); a second agent backend; Intel/universal builds; Windows and Linux bundles; a Homebrew
cask or any other distribution channel beyond GitHub Releases; a marketing site or landing page;
and the ten matched code-quality todos (see `<deferred>`).

</domain>

<decisions>
## Implementation Decisions

Decision ids continue the project-wide sequence; Phase 10 / 08.1 ended at D-181.

### Release pipeline (DIST-01)

- **D-182:** **The signed build is produced by GitHub Actions on a macOS runner, not on Cyril's
  Mac.** The release workflow is the only sanctioned way a Flywheel binary comes into existence.
  Signing material lives in repository secrets: the Developer ID cert (`.p12` + password), an App
  Store Connect API key for notarization, and the Tauri updater's ed25519 private key.
  This is also what makes **DIST-03 continuously true rather than a README claim** — every release
  is itself a clean-clone build, so criterion 3 is verified by CI on every tag instead of asserted.
  There is **no `.github/` directory in the repository today**; this is greenfield.
  Rejected: a local `npm run release` off Cyril's keychain (fastest to a working binary, but
  nothing then verifies the repo builds anywhere but on his machine, which is exactly criterion 3);
  and a split "CI builds, you sign" (avoids putting the cert in GitHub, at the cost of a manual
  step in the middle of every release).
  — **Reversibility:** reversible — a workflow file and a set of secrets; moving to local signing
  later costs nothing already built.

- **D-183:** **arm64 only (`aarch64-apple-darwin`).** One target, matching the only machine that
  will run it. Note the sidecar binary currently exists for this triple only
  (`packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin`), so a universal
  build would need the sidecar built for `x86_64-apple-darwin` too.
  Rejected: a universal2 bundle — doubles build time and sidecar targets for a hypothetical user.
  — **Reversibility:** reversible — adding a second target is a matrix entry plus a sidecar build.

- **D-184:** **A pushed git tag (`v0.1.0`) is the only release trigger, and the tag is the single
  source of the version.** `tauri.conf.json`'s `version` field (today a hand-written `0.1.0`), the
  bundle version, the changelog entry and the updater manifest's `version` are all derived from the
  tag rather than maintained in parallel.
  Rejected: manual `workflow_dispatch` with a typed version — easier to debug, trivially desynced
  from the tag and the changelog.
  — **Reversibility:** reversible.

- **D-185:** **The whole pipeline is built and verified unsigned-first; signing and notarization is
  a single final plan gated on the Apple Developer account.** The account has **not been
  purchased** (`security find-identity -v -p codesigning` reports 0 valid identities on this
  machine), and it is a $99/yr prerequisite only Cyril can satisfy. Therefore: the bundle, the
  updater, the public-repo work, the DIST-04 proof and the register drain are all planned and
  executed against an **ad-hoc-signed local build**, and exactly one plan — the one that adds
  `signingIdentity` / notarization to the workflow and proves criterion 1's "no Gatekeeper
  warning" — carries a `checkpoint:human-action` for buying the account and installing the cert.
  **Nothing but DIST-01 waits on it.**
  Rejected: stopping the phase until the account exists (the phase idles on an errand); and
  shipping unsigned with a documented right-click-Open workaround (knowingly fails criterion 1).
  — **Reversibility:** reversible.

### Self-update (DIST-02)

- **D-186:** **`latest.json` is published as a GitHub Releases asset, served from the stable
  `releases/latest/download/latest.json` URL.** Zero infrastructure and no server to operate — and
  it keeps **DIST-04 honest**: the OSS desktop app's only outbound dependency is `github.com`, not
  a HighKnow service. `tauri-plugin-updater` is **not currently a dependency** of
  `packages/desktop/src-tauri/Cargo.toml`; adding it, and the `plugins.updater` block with the
  ed25519 public key, is part of this phase.
  Rejected: a HighKnow-hosted endpoint (enables staged rollout and channels later, but makes the
  open-source app phone home to commercial infrastructure, muddying the exact boundary criterion 4
  exists to prove); and a `gh-pages` static manifest (same substance, one more moving part).
  — **Reversibility:** costly — the manifest URL is compiled into every shipped binary, so changing
  it later only reaches users who already updated once; a URL migration needs an interim release
  that both endpoints serve.

- **D-187:** **An update is offered, never imposed: a dismissible banner naming the version and
  what changed, which the user accepts; the download applies on relaunch.** Checked on launch and
  periodically thereafter.
  Rejected: silent download with auto-apply on quit (least friction, but a bad release cannot be
  declined and the "what changed" moment is lost); and a Settings-only manual check (criterion 2
  says the user is *offered* a release, which an opt-in-only button is not).
  — **Reversibility:** reversible.

- **D-188:** **The update refuses to apply while any agent run is live, and says so.** The banner
  names the count ("3 agents running"). This reuses the fleet-wide live-run state Phase 10 already
  derives — it introduces no new bookkeeping. This is the same invariant Phase 3 bought: an ADE
  must never restart itself out from under running sessions.
  Rejected: relying on the existing shutdown path with no special case.
  — **Reversibility:** reversible.

- **D-189:** **Two artifacts from one build: a `.dmg` for first install, an `.app.tar.gz` (+ `.sig`)
  for the updater.** Tauri requires the tarball for macOS updates; the `.dmg` is what a first-time
  user expects and keeps the app out of `~/Downloads`.
  Rejected: tarball only.
  — **Reversibility:** reversible.

### Open source and the open-core proof (DIST-03, DIST-04)

- **D-190:** **The repository goes public in this phase with `.planning/` included — all 663 tracked
  files of it.** The planning record is not a liability to scrub; it is the methodology Flywheel
  sells, made legible. Nothing is hidden and no history rewrite is needed.
  Rejected: stripping `.planning/` to a private repo first (a history rewrite that breaks every doc
  path citing `.planning/`, including `relay-client/README.md` and `CLAUDE.md`); and keeping the
  repo private while shipping the binary (DIST-03 would then be verified only by CI, never by an
  actual stranger).
  — **Reversibility:** one-way — a public commit history cannot be recalled; forks and mirrors
  outlive any later decision to close the repository.

- **D-191:** **Apache-2.0.** The standard for developer tooling, carries an explicit patent grant,
  and matches the licensing of the sync engines this project's own stack research settled on.
  Does not constrain the commercial relay. **There is no `LICENSE` file in the repository today.**
  Rejected: MIT (shorter, no patent grant — which matters more than it sounds for a company
  shipping a commercial layer beside the OSS core); and AGPL-3.0 (protects the relay from a hosted
  clone, but chills contributor and corporate adoption of a *desktop* app, where hosting is not the
  threat model).
  — **Reversibility:** one-way in practice — relicensing requires the consent of every contributor
  who has landed code by then.

- **D-192:** **The sidecar is built from source as part of the documented build, and the compiled
  binary leaves the repository and enters `.gitignore`.**
  `packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` is **currently
  committed and tracked**. An opaque binary blob in an OSS repository is a trust problem, and it
  makes criterion 3 a half-truth: a fresh clone today does not *build* a working app, it inherits
  one. The build must produce the `<name>-<target-triple>` artifact Tauri's `externalBin` expects,
  from `packages/sidecar` (whose `build` script is `tsc` today — the self-contained-binary step via
  `pkg`/`nexe` does not yet exist).
  Rejected: keep committing it with a documented rationale.
  — **Reversibility:** reversible, though removing it from `HEAD` does not remove it from history.

- **D-193:** **DIST-04 is proven by a CI job that builds the workspace with
  `packages/relay-client` deleted entirely and runs the full test suite.** If any feature path
  gates on it, the build breaks. This makes the open-core seam a **compile-time fact rather than a
  promise** — which is precisely what the roadmap note asks for ("the clean module seam must hold
  with the relay entirely absent"). The crate is already documented as dependency-free and
  depended-on by nothing (`packages/relay-client/README.md`), so the job should pass on day one;
  its value is that it *keeps* passing.
  Rejected: an offline run plus a no-auth source audit (proves behaviour, not structure); and both
  (more phase weight for a second-order check).
  — **Reversibility:** reversible.

### Deferred-review redemption

- **D-194:** **All 55 register items are drained in one pass — the full promise, not a subset.**
  `.planning/DEFERRED-REVIEW.md` holds ~41 items marked `automatable: YES`/`MOSTLY`/`PARTLY` and
  ~12 that genuinely need a human. Every automatable item is automated and run **before** anything
  is put in front of Cyril, per the register's own protocol and `CLAUDE.md`. This is the larger
  half of the phase by volume — larger than the shipping work — and planning must size it as such.
  Rejected: triaging into ship-blocking vs post-ship (smaller phase, but walks back the October
  commitment); and draining only what an installed build unlocks (leaves ~35 automatable items
  indefinitely unverified).
  — **Reversibility:** reversible.

- **D-195:** **The drain does not gate the `v0.1.0` tag.** The release pipeline, updater, public
  repo and open-core proof close the shipping half and the tag goes out; the drain then runs
  **against the tagged, installed build**. This is the only ordering that makes the register's own
  unreachable items answerable at all — D-REV-20 (what the Dock paints), D-REV-22 (the painted
  ground in system Dark), D-REV-36, D-REV-52 (a banner in Notification Center) and D-REV-53 (the
  first-run notification permission prompt) each require an installed signed bundle, which requires
  the tag. Gating the tag on the register deadlocks.
  Rejected: "v0.1.0 means reviewed" — strictest reading of the October decision, and circular.
  — **Reversibility:** reversible.

- **D-196:** **Register items that survive automation and are not ship-blocking become real epics,
  tasks and issues on Flywheel's own board, and are drained by Flywheel's agents.** The register
  file stops being the holding pen. This is deliberate dogfooding and it is the only thing that
  makes the v1 success metric ("Cyril runs a full week of real work from Flywheel") concrete rather
  than aspirational.
  Rejected: leaving them in `DEFERRED-REVIEW.md` with a new `redeem_at` past MVP (no tooling
  change, but it re-opens the holding pen it was decided to close); and GitHub issues on the public
  repo (fine for bugs, wrong for "does this read well" aesthetic judgements).
  — **Reversibility:** reversible.

### Register decisions settled in this discussion

These five register items were `needs-owner-decision` / `contradicted-by-measurement` — not tests.
They were answered here, **before planning**, because each changes what gets built. The planner
treats them as locked and the drain does not re-ask them.

- **D-197 (closes D-REV-01):** **AGNT-07 is narrowed to match the shipped refusal.** The
  requirement text becomes "a destructive action is refused before it reaches the remote, and the
  user is told", replacing the claim that the gate *asks* a human and blocks. Phase 12 measured the
  shipped behaviour twice: safety holds, the remote ref is unchanged, the agent is told — but no
  permission request is raised, because the `pre-push` hook refuses outright and D-58's indefinite
  block is unreachable for anything run through `Bash`. The requirement is the side that is wrong.
  Phase 12's whole lesson was that the ask-path's premise (Flywheel's shim at `PATH` position 0) is
  unachievable; rewording costs a sentence, re-plumbing the ask costs a phase in the one subsystem
  that has already bricked the product once.
  Rejected: making the hook defer to the shim's socket; and a both-ways gate (refuse with no
  socket, ask when Flywheel supervises).
  — **Reversibility:** reversible — a requirements edit plus the register closure.

- **D-198 (closes D-REV-13 and D-REV-30):** **`01-UI-SPEC.md` is amended to match the product, not
  the reverse.** Four amendments, one document: (1) a zero criteria count (`0/0`) and "No priority"
  render **nothing** in a task row's tail, extending A-03's change-cue rule — the count is then
  absent exactly when the Done warning cannot fire, which is consistent with D-08; (2) the Done
  warning's shipped string (`{key} · {n} of {total} criteria unchecked. Mark Done anyway?`) becomes
  the Copywriting Contract's string, replacing the stale one; (3) the remaining `type-micro` (10px)
  survivors — the feed system notice and the assignee picker — move to the 08.1 scale's 11px floor;
  (4) **key alignment on pill-bearing rows is left as it is** — reserving an alignment slot on every
  row costs more than it buys, and pills trailing the status glyph is Row Anatomy's deliberate
  choice. The next phase must inherit a document that agrees with what shipped.
  Rejected: conforming the product back to the contract (preserves the Phase 1 contract's
  authority, undoes reviewer-driven improvements); and reconciling the copy only.
  — **Reversibility:** reversible.

- **D-199 (closes D-REV-28):** **The brand rule is widened and the one real floor violation is
  fixed.** `08.1-UI-SPEC.md`'s permitted-uses list gains **text links and text actions, the run
  status, and the live authoring stage** alongside progress, the commits-ahead count and the focus
  ring. Separately, `review/review.css`'s `.review-anchor-widget` 2px brand **left border becomes a
  neutral control edge** — it is not covered by A-06 (which decided neutral ink, not an accent) and
  it is exactly the pattern the craft floor's coloured-side-border ban names. The widened rule stays
  enforceable by the same grep / computed-style test shape that already pins no-fill buttons.
  Rejected: holding the rule and moving every link and action to ink with weight (strongest brand
  discipline, touches five surfaces for a cosmetic gain).
  — **Reversibility:** reversible.

- **D-200 (closes D-REV-29):** **Project removal is a reversible soft-hide, never a delete.** A
  "Remove from Flywheel" command marks the project hidden; its board, worktrees, runs and activity
  trail stay in SQLite and can be restored. Deleting a project's board is the one irreversible act
  in an application whose core promise is that nothing is lost. The immediate case this unblocks is
  real: the live board carries a duplicate registration stuck in `unreachable` (same name, same
  `THRE` prefix, same `repo_path` as the active project) with no way out of the surface.
  Rejected: hard delete behind a typed confirmation (reclaims the duplicate's space, contradicts
  "nothing lost"); and soft-hide now with a purge filed post-ship (the purge is the part that
  contradicts the promise, so deferring it defers nothing worth having).
  — **Reversibility:** reversible — a `hidden` flag and a filter; the rows are never destroyed.

### Claude's Discretion

Nothing was answered "you decide". Within the locked decisions above, planning owns: the exact
workflow file layout and action versions; whether the sidecar's self-contained binary comes from
`pkg` or `nexe`; the periodic update-check interval; changelog generation mechanics; the shape of
the `relay-client`-deleted CI job (a stripped checkout vs a Cargo feature-gated workspace member);
and the order in which the ~41 automatable register items are batched.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The register and the rule that produced it
- `.planning/DEFERRED-REVIEW.md` — all 55 deferred human-verification items with `truth`,
  `why_deferred`, `risk_if_wrong`, `automatable` and the redemption protocol. **The single largest
  input to this phase.** D-REV-01, 13, 28, 29 and 30 are closed by D-197…D-200 above and must not
  be re-asked; D-REV-04, 37 and 38 are already closed/resolved.
- `.claude/CLAUDE.md` § "Human verification is deferred until MVP" — the owner decision of
  2026-10-07, the deferral mechanism, and the Phase 11 redemption clause. Also § "GSD Workflow
  Enforcement".
- `.planning/ROADMAP.md` § "Phase 11: Ship It" — the four success criteria, the open-core note on
  criterion 4, and the "Deferred review redemption (added 2026-10-07)" clause.

### Requirements and project contract
- `.planning/REQUIREMENTS.md` — DIST-01…DIST-04 (lines 137-140); **AGNT-07 is amended by D-197**.
- `.planning/PROJECT.md` — core value, the open-core revenue boundary, and the v1 success metric
  that D-196's dogfooding makes concrete.

### Build, bundle and distribution
- `packages/desktop/src-tauri/tauri.conf.json` — `productName: Flywheel`,
  `identifier: com.highknow.flywheel`, `version: 0.1.0` (to be tag-derived per D-184),
  `bundle.targets: "all"`, `externalBin: ["binaries/flywheel-sidecar"]`. **No `plugins.updater`
  block and no `bundle.macOS.signingIdentity` yet.**
- `packages/desktop/src-tauri/Cargo.toml` — Tauri is pinned `=2.11.5` with
  `tauri-plugin-notification =2.4.0` (D-181). The updater plugin must be pinned the same way.
- `README.md` — prerequisites table, run and test instructions. This is the document criterion 3
  is measured against; it does not yet mention the sidecar build or a release.
- `packages/sidecar/package.json` — `build: tsc`. No self-contained-binary step exists (D-192).
- `.gitignore` — must gain the sidecar binary path (D-192).

### Open-core boundary
- `packages/relay-client/README.md` — states the crate is dependency-free, depended on by nothing,
  and that the OSS packages build and run with it present but unused. D-193's CI job turns this
  prose into a test.
- `ARCHITECTURE.md` §8 "Open-Core Module Boundary" — **DOES NOT EXIST.** `relay-client/README.md`
  cites it as the document that defines the open-core boundary, and the repository has no
  `ARCHITECTURE.md` at all. This is a live DIST-03 gap: the one document a contributor is pointed
  to for the architecture is missing, in the phase whose criterion 3 is "a developer clones the
  repository and builds". Planning must either write it or correct the citation.

### UI contracts amended by this phase
- `.planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md` — Row Anatomy (the priority
  glyph and criteria count "never dropped"), the State Inventory "zero-one-many" row, and the
  Copywriting Contract. **Amended by D-198.**
- `.planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md`
  — the brand rule's permitted uses, the type scale's 11px floor, and the craft floor's
  coloured-side-border ban. **Amended by D-199.**

### Prior phase context carried forward
- `.planning/phases/10-fleet-supervision-across-every-project/10-CONTEXT.md` — D-163…D-181,
  including the Tauri pin rationale and the live-run state D-188 reuses.
- `docs/destructive-gate-trust-boundary.md` — the gate's layers and premises; the document D-197's
  requirement edit must stay consistent with.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 10's fleet live-run derivation** — D-188's "refuse to update while agents are running"
  needs a count of live runs across all projects. That read already exists and returns a 200-row
  window in 4ms under 5,000 runs; no new query shape is required.
- **`agent_runs.acknowledged_at`** — already load-bearing for fleet retention (D-165); relevant if
  the update banner needs a dismissed-state analogue.
- **`packages/sidecar/test/fake-claude.mjs`** — the scripted fake CLI the register repeatedly names
  as the thing that makes its live-path items automatable (D-REV-34, D-REV-35).
- **`scripts/uat/uat-*.mjs`** — existing harnesses (`uat-03-destructive-gate.mjs`,
  `uat-10-agent-backlog.mjs`) that already drive real `claude` sessions; the pattern for the
  register's remaining live items.
- **`dispatch_auto_merge.rs`, `dispatch_plan.rs`, `scope_widen.rs`** — the Rust harnesses the
  register names by file for a dozen automatable items (D-REV-37…46); they already drive real runs
  and real git.
- **`legibility.browser.test.tsx`, `dispatch-layout.browser.test.tsx`, `contrast.test.ts`,
  `board-group.browser.test.tsx`, `wave-plan-sheet.test.tsx`** — the WebKit/browser-mode tests the
  register names as the cheapest path for roughly a dozen more.
- **`impeccable-finish-reviewer`** — the register marks eight items (D-REV-11, 12, 14…19, 26) as
  "the orchestrator can spawn this again, it needs no human". That is a subagent call, not a UAT
  round.

### Established Patterns
- **Pinned Tauri versions** (`=2.11.5`, `=2.4.0`) — the updater plugin follows, exactly pinned.
- **Source-level invariant gates** — Phase 6's canonical-writer gate and Phase 12's
  install-at-every-mutation-path invariant are the precedent for D-193: prove a boundary by a check
  that fails the build, not by a convention. D-193 is the same move at workspace scale.
- **Sidecar as `externalBin` with target-triple suffix** — Tauri resolves
  `binaries/flywheel-sidecar-<triple>`; D-192's build step must produce exactly that name.
- **`.planning/` is tracked** (663 files) — D-190 makes this public; nothing needs moving.

### Integration Points
- **`.github/workflows/` — does not exist.** The release workflow, the clean-clone build proof and
  the `relay-client`-deleted job all land here. This is the phase's one genuinely new subsystem.
- **`tauri.conf.json`** — gains `plugins.updater` (endpoint + ed25519 pubkey) and
  `bundle.macOS` signing fields; its `version` stops being hand-written.
- **`LICENSE` — does not exist.** Apache-2.0 text at the repository root, plus the header/`NOTICE`
  convention if planning decides one is warranted.
- **The update banner** mounts in the shell beside the existing surfaces
  (`SessionSurface`/`TriageSurface`/`ReviewSurface`/`SettingsSurface` pattern, `useUiStore`).
- **Project soft-hide (D-200)** needs a core command, a confirmation, and a filter on every
  project-listing read — including the project rail and the Phase 10 fleet and worktree views.

</code_context>

<specifics>
## Specific Ideas

- **"Nothing but DIST-01 waits on your credit card"** — the ordering constraint behind D-185. The
  phase must be fully plannable and almost fully executable with zero Apple credentials present.
- **The register drain is the bulk of the phase, and that was chosen deliberately.** Cyril took
  "all of it, in one pass" over the smaller triage option while simultaneously refusing to let it
  gate the tag. Planning must honour both: ship first, then drain completely.
- **Dogfooding is the point of D-196,** not a nicety — the register's survivors are the first real
  backlog Flywheel drains with Flywheel.
- **The duplicate `unreachable` project on the live board** is a concrete, present defect D-200
  exists to fix, not a hypothetical.

</specifics>

<deferred>
## Deferred Ideas

- **Universal / Intel builds, Windows and Linux bundles** — the pipeline is built so a target is a
  matrix entry (D-183); adding one is a later decision, not this phase.
- **Homebrew cask or any channel beyond GitHub Releases** — out of scope.
- **Staged rollout / release channels (beta, stable)** — foreclosed by nothing, enabled by a
  hosted manifest, which D-186 deliberately declined for now.
- **A marketing site, landing page, screenshots or README-as-front-door polish** — raised and
  declined for this phase. The repository goes public; making it *attractive* is separate work.
- **D-REV-25's junk `test` epic (181 tasks, no criteria) on the live board** — raised and declined
  as a discussion area. It is a data decision, and per D-196 it is exactly the kind of thing that
  becomes a Flywheel board issue and gets drained by Flywheel.
- **A real purge for hidden projects** — D-200 ships soft-hide only; irreversible deletion is not
  deferred work so much as deliberately unbuilt.

### Reviewed Todos (not folded)
All ten pending todos that matched this phase were reviewed and **not folded**. They are
code-quality items, not distribution, and Cyril's standing position is to ship first and drain bugs
through Flywheel (D-196 is where they go):

- *Forge resolution failures are not memoised, so they retry per worktree every tick* (desktop)
- *Forge-sourced URLs reach an anchor href without scheme validation* (desktop) — considered for
  folding on the grounds that shipping a signed public binary raises its stakes; still deferred.
- *`git_identity` builds a table name into SQL with `format!`, against the crate convention* (core)
  — same consideration, same outcome.
- *Live-chain tests inconsistently assert that the fake CLI was actually reached* (core)
- *Timeout-boundary race misreports a child that just finished as `TimedOut`* (core)
- *Subprocess timeout guard leaks reader threads under a sustained forge outage* (core)
- *Adapter drops assistant text when a stream line carries text and `tool_use`* (general)
- *Socratic challenge should be structured like GSD's questioning, not one wall of questions*
  (authoring)
- *Handoff sheet drops questions the agent asked* (tooling)
- *G-05-8 AskUserQuestion invisible and board unwritable in live run* (tooling)

</deferred>

---

*Phase: 11-Ship It*
*Context gathered: 2026-10-12*
