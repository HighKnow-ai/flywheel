/**
 * Boards the flows start from, written through the app's own commands, as the UI would write them
 * (and as `uat_review_ops seed-review` and `uat_shaping_ops` write them for the UAT scripts).
 */
import type { Core } from "./core";

interface Id {
  id: string;
  key?: string;
}

export interface Board {
  projectId: string;
  milestoneId: string;
  epicId: string;
  epicKey: string;
  storyId?: string;
  storyKey?: string;
}

/** A project on the scratch repository, with a Milestone to hang Epics on. */
async function project(core: Core): Promise<Pick<Board, "projectId" | "milestoneId">> {
  const p = await core.call<Id>("project_register", { name: "Threadfin", repoPath: core.project, keyPrefix: "FLY" });
  const m = await core.call<Id>("milestone_create", { projectId: p.id, title: "Board and review", exitTest: null });
  return { projectId: p.id, milestoneId: m.id };
}

/** UAT 19's board: Epic "Parsing" (Ready) with one Ready Story "Parser" and its two criteria. */
export async function seedReviewBoard(core: Core): Promise<Board> {
  const base = await project(core);
  const epic = await core.call<Id>("epic_create", { milestoneId: base.milestoneId, title: "Parsing" });
  await core.call("epic_update", {
    epicId: epic.id,
    title: "Parsing",
    problem: "One bad line stops the parse",
    scope: "The parser",
    outOfScope: null,
    exitTest: "A file with a bad line parses, and the error names the line",
  });
  await core.call("epic_set_state", { epicId: epic.id, to: "ready" });
  const story = await core.call<Id>("story_write_by_hand", {
    epicId: epic.id,
    title: "Parser",
    description: null,
    criteria: [
      { statement: "The parser lives in src/parser.rs", checkCommand: "test -f src/parser.rs" },
      { statement: "A parse error names the line", checkCommand: null },
    ],
  });
  return { ...base, epicId: epic.id, epicKey: epic.key ?? "", storyId: story.id, storyKey: story.key };
}

/**
 * UAT 18's board: UAT 19's, and a second Milestone after the Current one, because a New Epic
 * Proposal lands on the Milestone after it.
 */
export async function seedProposalsBoard(core: Core): Promise<Board> {
  const board = await seedReviewBoard(core);
  await core.call("milestone_create", { projectId: board.projectId, title: "Later", exitTest: null });
  return board;
}

/**
 * UAT 17's board: Milestone "Shaping", still in Shaping, with two Ready Epics that carry an exit test,
 * and a Milestone after it for a roadmap Round to place new work in.
 */
export async function seedRoadmapBoard(core: Core): Promise<Board & { epics: Id[]; laterMilestoneId: string }> {
  const p = await core.call<Id>("project_register", { name: "Threadfin", repoPath: core.project, keyPrefix: "FLY" });
  const m = await core.call<Id>("milestone_create", {
    projectId: p.id,
    title: "Shaping",
    exitTest: "Cyril takes a one-line idea to Ready Stories in Flywheel",
  });
  const later = await core.call<Id>("milestone_create", {
    projectId: p.id,
    title: "Board and review",
    exitTest: "A Story merges in Flywheel alone",
  });
  const epics: Id[] = [];
  for (const [title, exitTest] of [
    ["Rounds", "A Round is answered on the board"],
    ["Roadmap strip", "The Roadmap reads at a glance"],
  ]) {
    const epic = await core.call<Id>("epic_create", { milestoneId: m.id, title });
    await core.call("epic_update", {
      epicId: epic.id,
      title,
      problem: null,
      scope: null,
      outOfScope: null,
      exitTest,
    });
    // Confirming an exit test needs every Story Merged or Dropped. A Merge needs a real branch, which
    // the review flow covers, so each Epic's one Story is Dropped.
    const story = await core.call<Id>("story_create", { epicId: epic.id, title: `${title}: the one slice` });
    await core.call("story_drop", { storyId: story.id });
    await core.call("epic_set_state", { epicId: epic.id, to: "ready" });
    epics.push(epic);
  }
  return {
    projectId: p.id,
    milestoneId: m.id,
    epicId: epics[0].id,
    epicKey: epics[0].key ?? "",
    epics,
    laterMilestoneId: later.id,
  };
}

/** UAT 12's board: one Ready Epic with three Ready Stories, each with one criterion and no Check. */
export async function seedFleetBoard(core: Core): Promise<Board & { stories: Id[] }> {
  const base = await project(core);
  const epic = await core.call<Id>("epic_create", { milestoneId: base.milestoneId, title: "Fleet" });
  await core.call("epic_update", {
    epicId: epic.id,
    title: "Fleet",
    problem: "Runs overlap",
    scope: "Three runs",
    outOfScope: null,
    exitTest: "The fleet reads every run",
  });
  await core.call("epic_set_state", { epicId: epic.id, to: "ready" });
  const stories: Id[] = [];
  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    stories.push(
      await core.call<Id>("story_write_by_hand", {
        epicId: epic.id,
        title,
        description: null,
        criteria: [{ statement: `${title} runs`, checkCommand: null }],
      }),
    );
  }
  return { ...base, epicId: epic.id, epicKey: epic.key ?? "", stories };
}

/** The monorepo flow's board: one Ready Story with one Check, on a project in the `flywheel/` folder. */
export async function seedMonorepoBoard(core: Core): Promise<Board> {
  const base = await project(core);
  const epic = await core.call<Id>("epic_create", { milestoneId: base.milestoneId, title: "Parsing" });
  await core.call("epic_update", {
    epicId: epic.id,
    title: "Parsing",
    problem: "One bad line stops the parse",
    scope: "The parser",
    outOfScope: null,
    exitTest: "A file with a bad line parses",
  });
  await core.call("epic_set_state", { epicId: epic.id, to: "ready" });
  const story = await core.call<Id>("story_write_by_hand", {
    epicId: epic.id,
    title: "Parser",
    description: null,
    criteria: [{ statement: "The parser lives in src/parser.rs", checkCommand: "test -f src/parser.rs" }],
  });
  return { ...base, epicId: epic.id, epicKey: epic.key ?? "", storyId: story.id, storyKey: story.key };
}

/** UAT 16's board: one Epic in Shaping, with no Story, the one-line idea that Shape starts from. */
export async function seedShapingBoard(core: Core): Promise<Board> {
  const base = await project(core);
  const epic = await core.call<Id>("epic_create", {
    milestoneId: base.milestoneId,
    title: "Parse a file with a bad line",
  });
  return { ...base, epicId: epic.id, epicKey: epic.key ?? "" };
}
