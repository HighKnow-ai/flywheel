# Reduced motion removes movement, not feedback

Decided in [One motion, feedback and loading foundation](https://github.com/HighKnow-ai/flywheel/issues/198) (Epic #189), from the M4 design critique (`docs/design/critique-2026-10-m4.md`).

Until now `styles/globals.css` answered `prefers-reduced-motion: reduce` by setting every `transition-duration` and `animation-duration` to `0s`. That removed the movement the setting asks to remove, but it also removed every colour and opacity change: a hover tint, a pill changing state and an overlay arriving all snapped, so a Developer who had asked for less motion got a UI with less feedback. The setting asks for less *vestibular* motion, not for state changes to stop being legible.

Under reduced motion, Flywheel now removes spatial movement and keeps short cross-fades:

- The durations stay as they are, so colour and opacity transitions run on the same tokens in both worlds.
- tw-animate-css's enter and exit translate, scale and rotate variables are pinned to their resting values, so an overlay keeps its fade and loses its slide and zoom.
- A `transition`, `transition-all` or `transition-transform` keeps only its colour, opacity and shadow properties, so a turning chevron snaps while its colour still fades.
- A Collapsible cross-fades at full height instead of growing.
- The Spinner breathes (an opacity pulse) instead of turning, so "under way" still reads.

`components/__tests__/browser/motion.browser.test.tsx` measures both worlds in WebKit (`test:browser`, `test:browser:motion`).

We rejected two other options:

- **Keep zeroing everything.** It's the simplest rule, but it throws away feedback that carries meaning. WCAG 2.3.3 and the platform guidance both target motion, not colour.
- **A per-component `motion-safe:` / `motion-reduce:` variant on every animated class.** It's precise, but every screen would have to remember it. One block in the stylesheet holds the rule for every component, including the shadcn components installed later.

## Consequences

- `direction.md` rule 7 and DESIGN.md § Motion now say "nothing moves" rather than "nothing animates".
- A screen that animates layout through something other than these mechanisms (a raw `transition-[height]`, a `transition-[flex-grow]`) is not covered by the block, and has to handle reduced motion itself.
