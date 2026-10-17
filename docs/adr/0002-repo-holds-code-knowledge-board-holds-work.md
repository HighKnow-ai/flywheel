# The repo holds code knowledge; the board holds work

Decided in [Do ADRs live as repo markdown or as board records?](https://github.com/HighKnow-ai/flywheel/issues/8). The board is the store of record for **work**: Milestones, Epics and their specs, Stories, criteria, Proposals, their state and the links between them. The managed project's repo is the store of record for **knowledge about the code**: ADRs in `docs/adr/` and the glossary in `GLOSSARY.md`. The board points into the repo and never copies it.

We chose repo files over ADR records in the board's database. A decision about the code is versioned with the code and lands in the same merge as the change that applies it. Any agent in any worktree can read it without Flywheel, including a bare Claude Code terminal, and it outlives Flywheel if the developer stops using it. The cost: the board cannot query ADR contents, only paths and links. An Epic spec stays on the board because it describes work in flight and goes stale once the Epic is done. Whatever in it should last moves into an ADR or the glossary.

## Consequences

- Repo knowledge reaches the repo only through a Story's worktree, then review, then merge. During shaping, an ADR or glossary change is a Proposal. Once accepted, it is attached to the Epic, and the Epic's first Story writes it verbatim. Flywheel never commits outside a worktree.
- The context packet lists merged ADRs linked to the Story, its Epic and its Milestone by path and title. Only an accepted ADR that hasn't merged yet is sent as full text.
- The review shows changes under `docs/adr/` and to `GLOSSARY.md` in their own Decisions section. It flags an ADR number already taken on the default branch, and the agent renumbers in its worktree. On merge, each new ADR is linked to its Story by path.
- Hand edits made outside Flywheel are allowed. An ADR with no link to a board record is shown as unlinked, with no import step.
