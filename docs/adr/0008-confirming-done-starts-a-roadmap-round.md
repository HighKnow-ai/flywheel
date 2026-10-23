# Confirming an Epic or Milestone Done starts a roadmap Round

Decided when Epic [#60](https://github.com/HighKnow-ai/flywheel/issues/60) was sliced, and recorded in [Confirming an Epic or Milestone Done runs a roadmap Round](https://github.com/HighKnow-ai/flywheel/issues/134). The roadmap Round itself shipped in [#133](https://github.com/HighKnow-ai/flywheel/issues/133) (PR [#146](https://github.com/HighKnow-ai/flywheel/pull/146)), with the triggers already in its schema (`rounds.trigger_type`: `revisit`, `epic_done`, `milestone_done`, migration `0009_roadmap_rounds.sql`). When Cyril confirms an Epic's exit test, Flywheel marks it Done and starts a short roadmap Round on its Milestone. When he confirms a Milestone's exit test, it marks it Done and starts a Roadmap Round. Each packet names its trigger. The click is the consent to spend tokens: there is no second "run a Round?" prompt. If Cyril is away, the Round waits as "Shaping Round waiting".

We rejected asking first, with a Needs-you item or a toast offering to revisit the Roadmap after Done. The roadmap Round is the only time an agent speaks up unprompted about the Roadmap (spec §3), and finishing an Epic or a Milestone is when what was learned can change it. An offer is easy to dismiss without reading, which turns the unprompted Round back into one Cyril has to remember to start. The cost is that confirming Done spends tokens without a separate yes. We also rejected any trigger from Story execution (a merge, a hand-off, a session event). It would interrupt work in flight with Roadmap questions and spend tokens Cyril never chose to spend.

## Consequences

- A project has at most one open roadmap Round (`idx_rounds_one_open_roadmap`). A trigger that fires while one is open opens no second Round: it is recorded for the open one, whose next packet names it.
- No Story transition, hand-off or session event starts a roadmap Round. The only triggers are the two confirmations and the "Revisit roadmap" button.
- Declining an exit test starts no Round. It keeps the record In progress and reopens shaping.
