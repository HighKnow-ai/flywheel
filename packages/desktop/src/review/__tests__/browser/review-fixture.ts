/**
 * The one adapter fixture the three real-browser specs share (Phase 8 UAT items 1, 2 and 6).
 *
 * It is the same shape as the jsdom specs' inline `vi.mock` factories — only the named exports the
 * review tree may call, with `invokeCommand` REJECTING any command not listed, so a write the
 * surface is not allowed to make fails structurally rather than silently succeeding (the rule
 * `criteria-rail.test.tsx` and `keyboard-activation.test.tsx` already follow). It lives in its own
 * module because three specs need it and because the browser arm's state has to be resettable
 * between files.
 */
import { vi } from "vitest";
import type {
  AcceptanceCriterionDto,
  EpicRequestPreviewDto,
  EpicTaskRollupRowDto,
  MergePreviewDto,
  ReviewCriterionStateDto,
  ReviewFilesDto,
} from "../../../adapters/tauri";

export const SHA = "abcdef1234567890abcdef1234567890abcdef12";

/** Five languages in one review, because UAT 1's subject is token colour across languages. */
export const PATCHES: Record<string, string> = {
  "src/lib.rs": `diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,8 +1,9 @@
 // Retry the push once before giving up.
 pub fn push_with_retry(remote: &str, attempts: u32) -> Result<(), Error> {
-    let mut tries = 1;
-    while tries < attempts {
+    let mut tries: u32 = 0;
+    while tries <= attempts {
         tries += 1;
+        tracing::debug!("push attempt {tries} to {remote}");
     }
     Ok(())
 }
`,
  "src/review/useReviewQuery.ts": `diff --git a/src/review/useReviewQuery.ts b/src/review/useReviewQuery.ts
index 3333333..4444444 100644
--- a/src/review/useReviewQuery.ts
+++ b/src/review/useReviewQuery.ts
@@ -1,7 +1,8 @@
 import { useQuery } from "@tanstack/react-query";

-export function useReviewFiles(scope: string, itemId: string) {
-  return useQuery({ queryKey: ["review-files"], staleTime: 1000 });
+export function useReviewFiles(scope: "task" | "epic", itemId: string) {
+  const enabled = Boolean(itemId);
+  return useQuery({ queryKey: ["review-files", scope, itemId], enabled, staleTime: 0 });
 }
`,
  "scripts/report.py": `diff --git a/scripts/report.py b/scripts/report.py
index 5555555..6666666 100644
--- a/scripts/report.py
+++ b/scripts/report.py
@@ -1,6 +1,7 @@
 import json

-def summarise(rows):
-    return {"total": len(rows)}
+def summarise(rows, *, checked=0):
+    """Counts, not prose."""
+    return {"total": len(rows), "checked": checked, "ratio": checked / max(len(rows), 1)}
`,
  "src/review/review.css": `diff --git a/src/review/review.css b/src/review/review.css
index 7777777..8888888 100644
--- a/src/review/review.css
+++ b/src/review/review.css
@@ -1,5 +1,6 @@
 .review-diff {
-  --diff-background-color: #171b22;
+  --diff-background-color: transparent;
+  --diff-text-color: var(--text-primary-rack);
   font-size: 12px;
 }
`,
  "package.json": `diff --git a/package.json b/package.json
index 9999999..aaaaaaa 100644
--- a/package.json
+++ b/package.json
@@ -1,5 +1,6 @@
 {
   "name": "flywheel-desktop",
-  "version": "0.1.0",
+  "version": "0.2.0",
+  "private": true,
   "type": "module"
 }
`,
};

/** A patch long enough that the diff pane genuinely overflows at the test viewport — UAT 2's
 * scroll-preservation claim is unmeasurable without real overflow. */
export function longPatch(hunks: number): string {
  let out =
    "diff --git a/src/long.ts b/src/long.ts\nindex bbbbbbb..ccccccc 100644\n--- a/src/long.ts\n+++ b/src/long.ts\n";
  for (let i = 0; i < hunks; i += 1) {
    const start = i * 12 + 1;
    out += `@@ -${start},4 +${start},4 @@\n`;
    out += ` export const keep${i} = true;\n`;
    out += `-export const old${i} = "before ${i}";\n`;
    out += `+export const next${i} = "after ${i}";\n`;
    out += ` export const tail${i} = ${i};\n`;
  }
  return out;
}

const FILE_ORDER = [
  "src/lib.rs",
  "src/review/useReviewQuery.ts",
  "scripts/report.py",
  "src/review/review.css",
  "package.json",
];

function criterion(id: string, statement: string, checked: boolean): AcceptanceCriterionDto {
  return {
    id,
    parentType: "task",
    parentId: "t1",
    statement,
    verificationHint: null,
    checked,
    rank: id,
    revision: 1,
    revisionOf: null,
    supersededAt: null,
  };
}

function initialCriteria(): ReviewCriterionStateDto[] {
  return [
    {
      criterion: criterion("c1", "The push retries once before reporting failure", true),
      anchor: { path: "src/lib.rs", side: "new", lineStart: 4, lineEnd: 6, sha: SHA },
      staleness: { state: "untouched", commits: null },
    },
    { criterion: criterion("c2", "The query key carries the scope and the item id", false), anchor: null, staleness: null },
    { criterion: criterion("c3", "The summary reports a checked ratio", false), anchor: null, staleness: null },
  ];
}

/** The board's own numbers. UAT 2 asks whether the epic rail's roll-up matches what the board
 * shows; this array IS the board for the browser arm, so the rail's rendered text is compared
 * against these fields rather than against a hand-typed string. */
export function initialRollup(): EpicTaskRollupRowDto[] {
  return [
    { taskId: "t1", key: "FLY-9", title: "Add push retry", status: "in_review", checked: 2, total: 3, withEvidence: 1, withoutEvidence: 1 },
    { taskId: "t2", key: "FLY-10", title: "Carry the scope in the query key", status: "done", checked: 4, total: 4, withEvidence: 4, withoutEvidence: 0 },
    { taskId: "t3", key: "FLY-11", title: "Report a checked ratio", status: "todo", checked: 0, total: 0, withEvidence: 0, withoutEvidence: 0 },
  ];
}

/** Pinned to the `ready` arm so the conflicted variant below can spread it — spreading the union
 * itself widens straight back to the union and no longer satisfies `MergePreviewDto`. */
const READY: Extract<MergePreviewDto, { state: "ready" }> = {
  state: "ready",
  epicKey: "FLY-7",
  sourceBranch: "flywheel/fly-9-add-push-retry",
  targetBranch: "flywheel/fly-7-integration",
  commitCount: 3,
  fileCount: 5,
  conflictedFiles: [],
};

export const READY_PRECHECK: MergePreviewDto = READY;

export const CONFLICTED_PRECHECK: MergePreviewDto = {
  ...READY,
  conflictedFiles: ["src/lib.rs", "src/review/review.css"],
};

export const READY_DRAFT: EpicRequestPreviewDto = {
  blocker: null,
  draft: {
    title: "FLY-7 Review and merge inside Flywheel",
    body: "## Tasks\n\n- FLY-9 Add push retry\n",
    headBranch: "flywheel/fly-7-integration",
    targetBranch: "main",
  },
};

/** Everything a spec may read or rewrite between tests. The annotation is load-bearing: TypeScript
 * narrows a `const` of a union type to its initializer's arm, so without it `precheck` would be
 * inferred as the `ready` variant alone and a spec could not assign the conflicted one. */
export const state: {
  criteria: ReviewCriterionStateDto[];
  rollup: EpicTaskRollupRowDto[];
  precheck: MergePreviewDto;
  longFile: boolean;
} = {
  criteria: initialCriteria(),
  rollup: initialRollup(),
  precheck: READY_PRECHECK,
  longFile: false,
};

export function resetState() {
  state.criteria = initialCriteria();
  state.rollup = initialRollup();
  state.precheck = READY_PRECHECK;
  state.longFile = false;
}

export const spies = {
  mergeTask: vi.fn(),
  openEpicRequest: vi.fn(),
  check: vi.fn(),
  startAgentRun: vi.fn(),
  worktreeOpen: vi.fn(),
};

export function resetSpies() {
  spies.mergeTask.mockReset().mockResolvedValue({ kind: "alreadyIntegrated" });
  spies.openEpicRequest.mockReset().mockResolvedValue({ kind: "pushedButNotOpened", branch: "flywheel/fly-7-integration" });
  spies.check.mockReset();
  // `MergeConfirmSheet` reads `run.id` off the result, so the stub returns the run, not its id.
  spies.startAgentRun.mockReset().mockResolvedValue({ id: "run-1" });
  spies.worktreeOpen.mockReset().mockResolvedValue(undefined);
}

function filesDto(): ReviewFilesDto {
  const paths = state.longFile ? ["src/long.ts", ...FILE_ORDER] : FILE_ORDER;
  return {
    target: {
      state: "resolved",
      postMerge: false,
      base: "flywheel/fly-7-integration",
      head: "flywheel/fly-9-add-push-retry",
      projectId: "p1",
      epicId: "e1",
      taskId: "t1",
    },
    files: paths.map((path) => ({ path, oldPath: null, status: "M", added: 3, removed: 2, binary: false })),
  };
}

/** The module `vi.mock("../../../adapters/tauri", …)` substitutes. */
export function adapterModule() {
  return {
    invokeCommand: (command: string) => {
      if (command === "criterion_list") return Promise.resolve(state.criteria.map((s) => s.criterion));
      if (command === "review_criteria_state") return Promise.resolve(state.criteria);
      if (command === "criterion_revisions") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve({ epics: [{ id: "e1", key: "FLY-7", title: "Review and merge inside Flywheel" }] });
      return Promise.reject(new Error(`unexpected command ${command}`));
    },
    reviewFiles: () => Promise.resolve(filesDto()),
    reviewFilePatch: (_scope: unknown, _itemId: unknown, path: string) =>
      Promise.resolve(path === "src/long.ts" ? longPatch(24) : (PATCHES[path] ?? null)),
    reviewCriteriaState: () => Promise.resolve(state.criteria),
    reviewEpicTaskRollup: () => Promise.resolve(state.rollup),
    reviewMergePrecheck: () => Promise.resolve(state.precheck),
    reviewMergeTask: (...args: unknown[]) => spies.mergeTask(...args),
    forgeEpicRequestDraft: () => Promise.resolve(READY_DRAFT),
    forgeOpenEpicRequest: (...args: unknown[]) => spies.openEpicRequest(...args),
    forgeRequestForEpic: () => Promise.resolve(null),
    startAgentRun: (...args: unknown[]) => spies.startAgentRun(...args),
    worktreeOpen: (...args: unknown[]) => spies.worktreeOpen(...args),
    gitFacts: () => Promise.resolve({ uncommitted: [] }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    criterionCheckWithAnchor: (args: { criterionId: string; anchor?: { path: string; side: "old" | "new"; lineStart: number; lineEnd: number } }) => {
      spies.check(args);
      state.criteria = state.criteria.map((s) =>
        s.criterion.id !== args.criterionId
          ? s
          : {
              ...s,
              criterion: { ...s.criterion, checked: true },
              anchor: args.anchor ? { ...args.anchor, sha: SHA } : s.anchor,
              staleness: args.anchor ? { state: "untouched" as const, commits: null } : s.staleness,
            },
      );
      return Promise.resolve();
    },
  };
}
