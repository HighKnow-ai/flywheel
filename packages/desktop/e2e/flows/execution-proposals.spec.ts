/**
 * UAT 18 (`scripts/uat/uat-18-execution-proposals.mjs`) as a flow, through the real UI: a running Story
 * files Proposals, the core caps them at three, the agent withdraws one and files again, and the developer
 * accepts the New Story and makes it Ready. The developer starts the Story on the board, reads the Proposals
 * in the Needs you list, the triage drawer and the session feed, accepts one in the drawer and selects Make
 * Ready on the board. The renderer, the core and the sidecar are the real ones; only the agent is scripted.
 * The doc is `docs/flows/execution-proposals.md`.
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
  async ({ page, core, open, shot }) => {
    const stories = async () => core.call<Story[]>("story_list_for_project", { projectId: board.projectId });
    const triage = page.getByRole("dialog", { name: /^Triage Proposals/ });
    const triageCount = triage.getByRole("heading", { name: /^Triage Proposals/ });

    // S1: the developer starts the Ready Story with its Start button on the board.
    await open();
    await page.getByRole("button", { name: `Start ${board.storyKey}` }).click();

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

    // The agent's calls on the screen: the Story's session feed lists the six answers, and the fourth is the
    // refusal that names `proposal_withdraw`. Then the developer goes back to the board.
    await page
      .getByRole("list", { name: "Parsing Stories", exact: true })
      .getByRole("button", { name: `Open Story ${board.storyKey} Parser` })
      .click();
    await page.getByRole("button", { name: `Open feed of session ${session.id}` }).click();
    const answers = page
      .getByRole("list", { name: "Session events" })
      .getByRole("listitem")
      .filter({ hasText: "board_call_result" });
    await expect(answers).toHaveCount(6);
    const refusal = answers.nth(3);
    await expect(refusal).toContainText('"isError":true');
    await refusal.getByRole("button", { name: "Expand full text" }).click();
    await expect(refusal).toContainText("withdraw one with proposal_withdraw before filing another");
    await shot("refused-fourth-call");
    await page.getByRole("button", { name: "Open the Threadfin board" }).click();

    // The same three on the screen. The Amend Epic spec is a card of its own in Needs you, with its evidence.
    // The two New Stories wait in the triage drawer, one card each, and the New Epic is nowhere.
    await expect(page.getByRole("group", { name: "Scope, before and after" })).toContainText(AMEND_SCOPE_TEXT);
    await expect(page.getByText(`Evidence: ${EVIDENCE}`)).toBeVisible();
    await page.getByRole("button", { name: "Triage 2 Proposals", exact: true }).click();
    await expect(triageCount).toContainText("2");
    await expect(triage.getByText(NEW_STORY_TITLE, { exact: true })).toBeVisible();
    await expect(triage.getByText(REFILED_TITLE, { exact: true })).toBeVisible();
    await expect(triage.getByText("Error recovery")).toHaveCount(0);
    await expect(triage.getByText(`Evidence: ${EVIDENCE}`)).toHaveCount(2);
    await shot("proposals-in-triage");

    // S8: the developer accepts the first New Story in the drawer. It is on the board in Shaping, with its
    // two criteria, and the drawer keeps the other one.
    await triage.getByRole("button", { name: `Accept New Story “${NEW_STORY_TITLE}”` }).click();
    await expect(triageCount).toContainText("1");
    await triage.getByRole("button", { name: "Close", exact: true }).click();
    await expect(triage).toBeHidden();
    const created = (await stories()).find((s) => s.title === NEW_STORY_TITLE)!;
    expect(created.state).toBe("shaping");
    expect(await core.call<unknown[]>("criterion_list", { storyId: created.id })).toHaveLength(2);
    const card = page
      .getByRole("list", { name: "Parsing Stories", exact: true })
      .getByRole("listitem")
      .filter({ hasText: NEW_STORY_TITLE });
    await expect(card.getByText("Shaping", { exact: true })).toBeVisible();

    // S9: the developer selects Make Ready on that Story. The Epic is already Ready, so no Stage close can do
    // it. The Story is Ready and offers Start.
    await card.getByRole("button", { name: /^Make FLY-\d+ Ready$/ }).click();
    await expect(card.getByText("Ready", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Start FLY-\d+$/ })).toBeVisible();
    expect((await stories()).find((s) => s.id === created.id)!.state).toBe("ready");
    await shot("story-ready");
  },
);
