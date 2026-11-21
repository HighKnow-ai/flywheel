# A note to a running agent and a Quick Story keep steering work on the board

Decided on 2026-11-20 (issue #1848, part of #1599): the owner said yes. It amends the MVP spec's scope with a new section 4.7 of `docs/mvp-spec.md`.

## Context

No command sends a message to a running session. Outside Shaping and Request changes, the developer cannot ask or steer. During a real week, a quick fix or a "why does this fail?" question then goes to a terminal `claude` in a counted project. That is a drop-back, and the audit for the exit test ranks it the most likely cause of a failed attempt.

## Decision

Add two small things. Both keep the work on the board.

- **A note to the agent.** On a Story with a live session, the developer types a free-text note (at most 1000 characters). The core records it as `sent` in `session_notes`. The sidecar queues it. The agent takes it at its next turn boundary, and never during a tool call. The sidecar then reports it, and the core marks the note `delivered`. The board shows `sent`, then `delivered`.
- **A Quick Story.** One text field writes a Story and starts it. The first line is the title and the whole text is the description. The Story has one default criterion with no Check, judged at review. It lives in the Epic "Quick Stories" of the project, made on first use in the Current Milestone. It starts with the same launch as Start. If the start fails, the Story stays Ready on the board.

### How the agent takes a note

`claude -p` takes one prompt and has no input channel, so a note cannot be typed into a live session. Instead, the session's own `--settings` file carries two hooks that run one script, `packages/sidecar/src/note-hook.ts`:

- `PostToolUse` runs after a tool call has finished. The script adds the notes to the agent's context (`additionalContext`).
- `Stop` runs when the agent is about to end its turn. A waiting note answers `block` with the note as the reason, so the agent reads the note and goes on.

The script asks the sidecar for the waiting notes over the session's own socket, in two phases (issue #1867). The request carries a per-run token that only this hook gets, through the environment of the session, and the sidecar gives no note to a request without it: the socket is in `/tmp`. The first phase leases the notes to the hook, and the sidecar keeps them. The second phase is the hook's word that it printed the notes for the agent. "Delivered" means that second phase. A hook that dies between the two leaves the note pending, and the next turn boundary delivers it once the lease runs out. These two hook output shapes are Claude Code's documented protocol. They are not measured against a real `claude` in this repository: the fake agent plays the same protocol. A live check is owed before the first outside user.

### A note the session never took

A note is never carried to a later session. If the session ends first (stop, crash, end of run), the note reads **Not delivered**, with the words "The session ended before the agent took it, and the next session does not receive it." The text stays on the card. The state is derived on read: a note still `sent` whose session is not live. No write is needed when a session ends, so a crash needs no repair.

## Rejected alternatives

- **`--input-format stream-json` and a stdin channel.** It changes how every session starts and ends, for one feature. The hooks leave the session's argv as it is.
- **Carrying an undelivered note into the next Context packet.** It is friendlier, but a note written for one moment of one session may be wrong for the next. The developer decides, and writes it again, or puts it in the Resume note.
- **Interrupting the agent.** A note that stops a tool call can corrupt the work.
- **A Quick Story without a Story.** The work would not be on the board, with no key, review or worktree. That is the chat blob that the Core Value forbids.

## Consequences

- The Roadmap shows a Milestone "Quick Stories" for a project that has no open Milestone, and an Epic "Quick Stories" in the Current Milestone otherwise. When that Epic closes, the next Quick Story makes a new one.
- A note reaches a blocked session (waiting on a permission) only after it goes on.
- The migration `0017_session_notes.sql` adds one table, classified Runtime.

## Enforced by

- `packages/core/tests/quick_story_and_note.rs` `a_note_is_sent_then_delivered_once` `a_note_still_sent_when_its_session_ends_reads_undelivered` `quick_story_is_ready_with_one_default_criterion_and_the_request_as_its_description`
- `packages/sidecar/test/note-delivery.test.mjs` `a note sent during a tool call reaches the agent after that call, and is reported delivered` `the settings file runs the note hook after a tool call and at the end of a turn` `a client without the run's token gets no note and delivers none` `a hook that dies between the drain and the hand-over leaves the note undelivered until the next turn`
- `packages/desktop/e2e/flows/note-to-agent.spec.ts` `a note sent to a running Story reaches the agent after its current step and shows as delivered`
- `packages/desktop/e2e/flows/note-undelivered.spec.ts` `a note the agent never took reads as not delivered once the session ends`
- `packages/desktop/e2e/flows/quick-story.spec.ts` `a Quick Story is written with the default criterion and started in one step`
