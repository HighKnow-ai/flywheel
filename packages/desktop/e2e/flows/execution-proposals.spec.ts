/**
 * UAT 18 (`scripts/uat/uat-18-execution-proposals.mjs`) as a flow: a running Story files Proposals,
 * the core caps them at three, the agent withdraws one and files again, and the developer accepts
 * the New Story and makes it Ready. The core and the sidecar are the real ones; only the agent is
 * scripted. The doc is `docs/flows/execution-proposals.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedProposalsBoard, type Board } from "../seed";
import { AMEND_SCOPE_TEXT, EVIDENCE, NEW_STORY_TITLE, PROPOSALS_AGENT, REFILED_TITLE } from "../agents/proposals-agent";

let board: Board;

interface Proposal {
  id: string;
  verb: string;
  targetType: string;
  state: string;
  payload: { title?: string };
  evidence: string | null;
}
interface Story {
  id: string;
  title: string;
  state: string;
}

/** One line the fake agent printed, parsed; the core's own lines (`session_closed: ...`) are not JSON. */
function parseLine(raw: string | undefined): { type?: string; name?: string; isError?: boolean; text?: string } {
  try {
    return JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
}

flow(
  "a running Story files Proposals, capped at three and withdrawable, and the developer makes one Ready",
  {
    doc: "execution-proposals.md",
    agentScript: PROPOSALS_AGENT,
    seed: async (core) => {
      board = await seedProposalsBoard(core);
    },
  },
  async ({ core }) => {
    const stories = async () => core.call<Story[]>("story_list_for_project", { projectId: board.projectId });
    await core.call("story_start", { storyId: board.storyId });

    // The agent files three, is refused a fourth, withdraws one and files again: six calls, none held.
    await expect.poll(() => core.trace().filter((s) => s.from === "agent").length, { timeout: 60_000 }).toBe(6);

    // The core refused the fourth call in the agent's own log, and the refusal names the way out.
    const [session] = await core.call<{ id: string }[]>("sessions_for_story", { storyId: board.storyId });
    const results = async () => {
      const window = await core.call<{ lines: { text: string }[] }>("session_raw_window", {
        sessionId: session.id,
        offset: 0,
        limit: 100,
      });
      return window.lines
        .map((l) => parseLine(JSON.parse(l.text).raw))
        .filter((r) => r.type === "board_call_result")
        .map((r) => [r.name, r.isError, r.isError ? r.text : ""] as const);
    };
    await expect.poll(async () => (await results()).length, { timeout: 30_000 }).toBe(6);
    expect((await results()).map(([name, isError]) => [name, isError])).toEqual([
      ["propose", false],
      ["propose", false],
      ["propose", false],
      ["propose", true],
      ["proposal_withdraw", false],
      ["propose", false],
    ]);
    expect((await results())[3][2]).toContain("proposal_withdraw");

    // The refused fourth was never filed and the withdrawn New Epic is gone: three are open.
    const pending = await core.call<Proposal[]>("proposal_list_pending", { projectId: board.projectId });
    expect(pending.map((p) => [p.verb, p.targetType, p.payload.title ?? null])).toEqual([
      ["create", "story", NEW_STORY_TITLE],
      ["amend", "epic", null],
      ["create", "story", REFILED_TITLE],
    ]);
    expect(pending.every((p) => p.evidence === EVIDENCE)).toBe(true);
    expect(JSON.stringify(pending[1].payload)).toContain(AMEND_SCOPE_TEXT);

    // Accepting the New Story puts it on the board in Shaping, with its criteria; Make Ready moves it.
    await core.call("proposal_accept", { proposalId: pending[0].id });
    const created = (await stories()).find((s) => s.title === NEW_STORY_TITLE)!;
    expect(created.state).toBe("shaping");
    expect(await core.call<unknown[]>("criterion_list", { storyId: created.id })).toHaveLength(2);
    await core.call("story_make_ready", { storyId: created.id });
    expect((await stories()).find((s) => s.id === created.id)!.state).toBe("ready");
  },
);
