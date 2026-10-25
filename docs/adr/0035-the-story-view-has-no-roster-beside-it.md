# The Story view has no roster beside it

Decided in [The Story view](https://github.com/HighKnow-ai/flywheel/issues/204) (Epic #189), from finding F38 of the M4 design critique (`docs/design/critique-2026-10-m4.md`).

DESIGN.md promised a split that was never built: at content widths of 1280px and up, the Story view would sit beside a 470px roster. The Story view itself was capped at 1240px and centred, so at 1920 × 1200 it read as a narrow column, while the paragraph describing it promised a layout no screen had. The critique asked for one of two things: build the split on Resizable, or correct DESIGN.md.

We corrected DESIGN.md. The Story view takes the whole content area at every width, in cards up to 1240px wide and centred, as All agents and the shaping views are. It has no roster beside it.

- **The board is one Back away.** The Story view opens from a row, and Back returns to the board. A second roster beside the Story would repeat the board, not add to it.
- **The split costs the panels the Story view exists for.** At 1280 × 800 the content area is about 1000px wide. A 470px roster would leave about 530px for the Story, so Acceptance criteria and Tasks would stack instead of standing side by side, and the station's live tail would truncate every command.
- **Resizable is not installed.** Building the split meant installing a primitive and a persisted width for one screen, during a pass whose aim is fewer one-off layouts.

## Consequences

- DESIGN.md § Layout describes the Story view as it is built, and no longer lists the split as "not built yet".
- If the Developer needs to read the roster beside a Story, the place to answer that is the board (a Story preview in a Sheet, say), not a second layout for the Story view.
