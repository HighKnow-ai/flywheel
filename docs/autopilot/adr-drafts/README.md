# Autopilot architecture: ADR drafts

Drafts from the Autopilot wayfinder (issue #2095), proposed on 2026-11-27. They take effect with the Autopilot spec in `docs/mvp-spec.md`.

A draft is not an ADR yet, so it stays out of `docs/adr/`. The Story that builds a draft numbers it into `docs/adr/`, together with the tests it names under "Enforced by". `scripts/adr/check-adr-enforcers.mjs` refuses an ADR whose enforcer does not exist, so a draft cannot be numbered before its tests.

| Draft | Decides |
|---|---|
| [1](1-an-accepted-epic-grants-autopilot-its-stories-acts.md) | One Authority module decides every act; accepting an Epic writes a grant |
| [2](2-a-story-launches-from-the-core-attended-or-unattended.md) | A Story launches from the core through one interface, attended or unattended |
| [3](3-a-landing-carries-one-or-more-stories.md) | A Landing carries one or more Stories, so a Batch is the general case |
| [4](4-autopilot-is-a-pure-plan-applied-on-the-cold-tick.md) | Autopilot is a pure plan, applied on the cold tick |
| [5](5-the-run-ledger-holds-every-verdict.md) | The Run ledger holds every verdict and replaces `check_runs` |
| [6](6-one-session-policy-decides-ask-deny-or-park.md) | One session policy in the core decides ask, deny or park |
| [7](7-a-core-write-returns-its-change-notices.md) | A core write returns its change notices |

Order of building: 2, 3 (with one Story per Landing) and 7 first, because they change no behaviour. Then 1, 5 and 6. Then 4.
