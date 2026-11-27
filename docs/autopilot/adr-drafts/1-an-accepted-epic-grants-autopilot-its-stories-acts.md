# Accepting an Epic grants Autopilot its Stories' acts, and one Authority module decides every act

Draft, proposed on 2026-11-27 in the Autopilot wayfinder (issue #2095). It takes effect when the Autopilot spec lands, and gets its number then.

## Context

Principle 3 says the Developer decides: acceptance, merge and every Gated action are the Developer's explicit act. The core enforces this with `assert_human_actor`, which is called 42 times in 17 files. `is_human_transition` in `domain/story.rs` adds a table of Story moves, and four `refuse_bare_*` guards in the desktop's `commands/story.rs` repeat some of the same rules. The check is an exact match on `actors.type = 'human'`.

Under Autopilot, the Developer accepts one Epic Proposal, and the Epic's Stories then start, have their criteria accepted on passing Checks, take corrections and merge, with no click per step. The current code has no place to record that delegation. Each act would need its own exception.

## Decision

- **One Authority module in the core decides every act.** It names each act: Start, Resume, Accept criterion, Request changes, Merge, Make Ready, Drop, Close Stage, Confirm exit test and Decide Proposal. It answers `may(principal, act, record)` with Allowed, or Refused and a reason.
- **There are two principals:** the Developer, and Autopilot acting under a grant.
- **A grant is written when the Developer accepts an Epic Proposal.** It covers that Epic's Stories, for four acts:
  - Start;
  - Accept criterion, only on a passing Check in the run of record;
  - Take a correction (back to Running from In review);
  - Merge through the Merge gate, except for a prepare-only Story.
- **A grant never covers** a Gated action, a decision on a Proposal, Close Stage, Confirm exit test, Drop, or the merge of a prepare-only Story.
- **Withdraw revokes the grant.** Work already running finishes, and nothing new starts.
- **Autopilot is its own actor.** Every act it takes records the grant id in the event log, so each unattended act traces back to the Developer's one decision.
- **Pause is a project switch, not a grant.** The Autopilot tick reads it.
- Every `assert_human_actor` call, `is_human_transition` and the `refuse_bare_*` guards are replaced by a call to Authority.

## Rejected alternatives

- **A new actor type checked at each call site.** It adds an exception to 42 call sites and leaves the rule in 17 files.
- **A grant per Story.** The Developer decides once per Epic.
- **Autopilot acting as the Developer.** The event log could then not tell an unattended act from a click.

## Consequences

- Principle 3 in `PRODUCT.md` becomes: "The Developer decides once, upfront, and can withdraw it." The spec says which acts a grant covers.
- A migration adds the grants table and an Autopilot actor.
- The exact `'human'` match in `domain/actor.rs` moves into Authority, as the rule for the Developer principal.

## Enforced by

To be written with the Story that builds it:

- `packages/core/tests/authority.rs`: `every_act_is_allowed_or_refused_for_each_principal_as_the_table_says` `a_withdrawn_grant_refuses_the_next_start` `a_grant_never_merges_a_prepare_only_story` `every_autopilot_act_records_its_grant_in_the_event_log`
- `packages/desktop/e2e/flows/`: `accepting an Epic Proposal lets Autopilot start its first Ready Story`
