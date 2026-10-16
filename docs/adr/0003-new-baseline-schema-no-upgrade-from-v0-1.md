# A new baseline schema for the MVP model, with no upgrade path from v0.1

Decided in [Evolve the current codebase into the new model, or rebuild a lean core?](https://github.com/HighKnow-ai/flywheel/issues/13). The MVP model (Roadmap, Milestone, Epic, Story, Task checklist, Acceptance criterion, Check, Proposal) is reached by replacing the schema, not by migrating it. Migrations 0001–0024 are squashed into one new baseline migration that holds only the new model. The record domain and the reshaped surfaces are rewritten against it, and the plumbing modules (DB and event log, IPC seam, sidecar supervision, Claude Code adapter, worktree lifecycle, git lock retry, crash reconciliation, git truth) are kept in place and re-pointed.

We rejected evolving the schema through migrations 0025 onwards. A rename touching roughly 266 files would carry the old semantics (dispatch plans, file-sets, the provisional tier, issue/task/cycle) into the new model. We also rejected a ground-up rebuild, which would re-solve plumbing that took dozens of gap-closure plans to harden. No board data from v0.1 needs to survive: the live database is mostly seed and UAT records, and real data starts with the MVP's exit test.

## Consequences

- A v0.1 database can't be upgraded. On first launch, a build with the new baseline moves an old-schema database aside as a file and starts empty. It never migrates it.
- Code identifiers follow `GLOSSARY.md` exactly: `story`, `milestone`, `proposal`, `epic`, `roadmap`, `criterion`, `check`. `task` survives only as the Story checklist. No `task`/`cycle`/`issue` aliases remain.
- Frozen subsystems are triaged once, during the schema cut. A repair may only re-point a subsystem at Stories, keeping its meaning. Anything that needs its meaning changed, or that costs more than about half a day, is deleted in the same change.
- A behaviour test of a reshaped subsystem is ported only if it pins an invariant the MVP still holds (for example human-only acceptance, criteria anchored to a Story, termination atomicity). Other tests go with their code.
- Fields discovered after the cut are added as ordinary migrations on top of the baseline.
