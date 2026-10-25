/**
 * A fixture backend for Milestone 4's exit test clicked through the real `<App />` (issue #169), for
 * `review-merge-flow.browser.test.tsx`.
 *
 * It answers every IPC command through Tauri's own `mockIPC`, as `test/critique/m2-fixture.ts` does: the m2 world
 * answers everything, with its execution Proposals awaiting triage, its two judged-on changes and FLY-3 In review
 * with its Decisions section turned on. What the walk writes is kept here in memory, following the core's rules:
 *
 * - a decided Proposal (Accept, Edit, Reject) leaves the triage drawer, its Epic row's count and Needs you, and the
 *   Proposals row counts what is left, gone at none;
 * - FLY-3's review starts with two criteria to accept (one pre-ticked by its passed Check) and one new ADR marked
 *   Not an ADR, so Merge is held; ticking a criterion accepts it, and Keep clears the mark;
 * - Merge refuses, in the core's words, while a criterion is unaccepted or an ADR is marked; merged, FLY-3 is
 *   Merged, its review is closed and its Review item leaves Needs you.
 *
 * Every write emits `board:changed` as the core does, so the app refreshes through its one subscription. Nothing
 * here proves the Rust side; `scripts/uat/uat-19-board-and-review.mjs` walks the same flow through the real core,
 * sidecar and MCP server.
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  MergeDto,
  NeedsYouItemDto,
  ReviewFileDto,
  StoryReviewDto,
  TriageProposalDto,
} from "../../../adapters/tauri";
import {
  STORIES,
  answer as m2,
  installFixtureBackend,
  setJudgedOnInFixture,
  setReviewInFixture,
  setTriageInFixture,
} from "../../../test/critique/m2-fixture";

export const PROJECT_ID = "p-fly";
const STORY_ID = "s-3";
/** The new ADR the walk finds marked Not an ADR and sets back to Keep. */
export const HELD_ADR = "docs/adr/0012-direction-file.md";

/**
 * FLY-3's diff is a long one, 26 files as in the stress critique (`s16`, `s17`), so the walk proves Merge stays in
 * reach past every diff (issue #207): the m2 world's three files, then 23 more, each with a 40-line patch.
 */
const EXTRA_FILES: ReviewFileDto[] = Array.from({ length: 23 }, (_, i) => ({
  path: `packages/desktop/src/review/part-${String(i + 1).padStart(2, "0")}.ts`,
  oldPath: null,
  status: "A",
  added: 40,
  removed: 0,
  binary: false,
}));

function extraPatch(path: string): string {
  const lines = Array.from({ length: 40 }, (_, i) => `+export const line${i + 1} = ${i + 1};`);
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1,40 @@",
    ...lines,
    "",
  ].join("\n");
}

type Args = Record<string, unknown> | undefined;
const arg = (args: Args, name: string) => (args?.[name] as string | undefined) ?? "";

export function installReviewMergeBackend() {
  installFixtureBackend();
  setTriageInFixture(true);
  setJudgedOnInFixture(true);
  setReviewInFixture("decisions");
  const story = STORIES.find((s) => s.id === STORY_ID)!;
  const startState = story.state;

  const decided = new Map<string, "accepted" | "rejected">();
  const accepted: Record<string, boolean> = { "c-3a": false, "c-3b": true, "c-3c": false };
  const adrDecisions: Record<string, "keep" | "not_an_adr"> = { [HELD_ADR]: "not_an_adr" };
  const writes: { cmd: string; args: Record<string, unknown> }[] = [];
  let merged: MergeDto | null = null;

  const changed = (entity: string, id: string | null = null) =>
    emit("board:changed", { projectId: PROJECT_ID, entity, id });

  const triage = () =>
    (m2("proposal_list_for_triage", { projectId: PROJECT_ID }) as TriageProposalDto[]).filter(
      (t) => !decided.has(t.proposal.id),
    );

  function needsYou(projectId: string): NeedsYouItemDto[] {
    const items = (m2("needs_you_list", { projectId }) as NeedsYouItemDto[]).filter(
      (i) =>
        !(i.judgedOn && decided.has(i.judgedOn.proposalId)) && !(i.kind === "review" && i.id === STORY_ID && merged),
    );
    if (projectId !== PROJECT_ID) return items;
    const left = triage();
    return items.flatMap((i) => {
      if (i.kind !== "proposals") return [i];
      if (left.length === 0) return [];
      const epics = new Set(left.map((t) => t.proposal.epicId).filter(Boolean)).size;
      return [
        {
          ...i,
          proposals: {
            count: left.length,
            stories: new Set(left.map((t) => t.storyId)).size,
            epics,
            roadmap: left.some((t) => t.proposal.epicId === null),
          },
        },
      ];
    });
  }

  function review(): StoryReviewDto {
    const base = m2("story_review", { storyId: STORY_ID }) as StoryReviewDto;
    const decisions = base.decisions.map((c) =>
      c.newAdr && adrDecisions[c.path]
        ? { ...c, newAdr: { ...c.newAdr, decision: { kind: adrDecisions[c.path], whatIsWrong: null, shouldBe: null } } }
        : c,
    );
    return {
      ...base,
      storyState: merged ? "merged" : base.storyState,
      review: merged ? null : base.review,
      criteria: base.criteria.map((c) => ({
        ...c,
        accepted: accepted[c.id] ?? c.accepted,
        acceptedAt: accepted[c.id] ? new Date().toISOString() : null,
      })),
      decisions,
      files: [...base.files, ...EXTRA_FILES],
      adrReviewPoints: Object.entries(adrDecisions)
        .filter(([, d]) => d === "not_an_adr")
        .map(([path]) => `Delete \`${path}\`; keep the decision out of docs/adr.`),
    };
  }

  /** `story_merge`'s refusals, in the core's order and words (`domain::story_merge`). */
  function merge(): MergeDto {
    if (story.state !== "in_review") throw "Only a Story In review can be merged.";
    const unaccepted = Object.values(accepted).filter((a) => !a).length;
    if (unaccepted > 0) throw `Accept every criterion before merging: ${unaccepted} not accepted.`;
    const held = Object.entries(adrDecisions).find(([, d]) => d !== "keep");
    if (held) throw `${held[0]} is marked Not an ADR: request changes, or set it back to Keep.`;
    merged = {
      mergeCommit: "c0ffee1d2e3f",
      baseBranch: "main",
      method: "checkout",
      failingChecksOverridden: 0,
      cleanupWarning: null,
      adrsLinked: ["docs/adr/0010-the-andon-is-the-visual-world.md"],
    };
    story.state = "merged";
    return merged;
  }

  function handle(cmd: string, args: Args): unknown {
    const write = (entity: string, id: string | null, apply: () => unknown) => {
      writes.push({ cmd, args: { ...(args ?? {}) } });
      const result = apply();
      void changed(entity, id);
      return result;
    };
    switch (cmd) {
      case "needs_you_list":
        return needsYou(arg(args, "projectId"));
      case "proposal_list_for_triage":
        return arg(args, "projectId") === PROJECT_ID ? triage() : [];
      case "milestone_progress": {
        const progress = m2(cmd, args) as { epics: { epicId: string; proposals: number }[] } | null;
        if (!progress) return null;
        const left = triage();
        return {
          ...progress,
          epics: progress.epics.map((e) => ({
            ...e,
            proposals: left.filter((t) => t.proposal.epicId === e.epicId).length,
          })),
        };
      }
      case "proposal_accept":
      case "proposal_amend":
        return write("proposal", arg(args, "proposalId"), () => void decided.set(arg(args, "proposalId"), "accepted"));
      case "proposal_reject":
        return write("proposal", arg(args, "proposalId"), () => void decided.set(arg(args, "proposalId"), "rejected"));
      case "story_review":
        return arg(args, "storyId") === STORY_ID ? review() : m2(cmd, args);
      case "criterion_accept":
        return write("criterion", arg(args, "criterionId"), () => void (accepted[arg(args, "criterionId")] = true));
      case "criterion_unaccept":
        return write("criterion", arg(args, "criterionId"), () => void (accepted[arg(args, "criterionId")] = false));
      case "story_adr_decide":
        return write(
          "story",
          STORY_ID,
          () => void (adrDecisions[arg(args, "path")] = arg(args, "decision") as "keep" | "not_an_adr"),
        );
      case "story_merge":
        return write("story", null, merge);
      case "review_file_patch": {
        const path = arg(args, "path");
        return EXTRA_FILES.some((f) => f.path === path) ? { patch: extraPatch(path), tooLarge: false } : m2(cmd, args);
      }
      default:
        return m2(cmd, args);
    }
  }

  // Every answer crosses as a copy, as the IPC's serialisation makes it: the m2 world hands out its own objects,
  // and a Story this backend moves in place would otherwise reach React Query as the very object it cached.
  mockIPC(
    (cmd, payload) => {
      const result = handle(cmd, payload as Args);
      return result === undefined ? null : structuredClone(result);
    },
    { shouldMockEvents: true },
  );

  return {
    writes,
    decided,
    get merged() {
      return merged;
    },
    /** Put the shared m2 world back as it was. */
    reset() {
      story.state = startState;
      setTriageInFixture(false);
      setJudgedOnInFixture(false);
      setReviewInFixture("judging");
    },
  };
}
