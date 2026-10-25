/**
 * Stress data for the critique harness (issue #192), added on top of the seeded world in `m2-fixture.ts`.
 *
 * The M2 fixture is clean: short titles, two projects, a handful of rows. Real boards are not, and the defects
 * the owner hit on his first week (rows drawn twice, a rail that stops short) only show under real shapes. This
 * adds, through the same seeded records so every read follows the same rules:
 *
 * - `p-big` (technical presales): a long project name and repository path, a long key prefix, six Milestones with
 *   long titles and exit tests, nine Epics and fifty-odd Stories with titles up to 200 characters, every Story
 *   state, a Story with two dozen Tasks, eight criteria with long Check commands and seven sessions, a running
 *   session whose log is shaped like real Claude CLI output (hook notices, the stdin warning, rate limits, a long
 *   heredoc command, failed commands with long output), many Needs-you items, eighteen Proposals to triage and a
 *   review with twenty-six changed files on long paths;
 * - empty projects (`p-empty` with no Milestone, `p-fresh` with a Milestone and no Epic), an unreachable one, and
 *   enough others that the rail has to scroll;
 * - settings with many permission rules, a long worktree inventory, and an orphaned run.
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  AcceptanceCriterionDto,
  BlockedQueueEntryDto,
  EpicDto,
  FleetRowDto,
  MilestoneDto,
  MilestoneProgressDto,
  NeedsYouItemDto,
  PendingOrphanDto,
  PermissionRuleDto,
  ReviewFileDto,
  RunSummaryDto,
  StoryDto,
  StoryReviewDto,
  TaskDto,
  TriageProposalDto,
  WorktreeInventoryRowDto,
} from "../../adapters/tauri";
import type { Project } from "../../board/useBoardQuery";
import { answer as m2, SEED } from "./m2-fixture";
import { SYNTHETIC_ENDED_AT, SYNTHETIC_STARTED_AT, syntheticSessionLog } from "../../session/__tests__/fixtures/syntheticSessionLog";

type Args = Record<string, unknown> | undefined;
const arg = (args: Args, name: string) => (args?.[name] as string | undefined) ?? "";
const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

export const BIG = "p-big";
const BIG_NAME = "technical-presales-knowledge-platform";
const BIG_PATH = "/Users/cymarechal/cymarechal/clients/acme-enterprise-holdings/technical-presales-knowledge-platform-monorepo";

const EXTRA_PROJECTS: Project[] = [
  { id: BIG, keyPrefix: "PRESALES", name: BIG_NAME, repoPath: BIG_PATH, defaultBranch: "main", status: "active" },
  { id: "p-empty", keyPrefix: "SCR", name: "scratch", repoPath: "/Users/cymarechal/code/scratch", defaultBranch: "main", status: "active" },
  { id: "p-fresh", keyPrefix: "DOT", name: "dotfiles-and-machine-setup-scripts", repoPath: "/Users/cymarechal/code/dotfiles-and-machine-setup-scripts", defaultBranch: "master", status: "active" },
  { id: "p-gone", keyPrefix: "BILL", name: "legacy-billing-service", repoPath: "/Volumes/External SSD/archive/2024/legacy-billing-service", defaultBranch: "main", status: "unreachable" },
  ...["highknow-marketing-site", "rfp-answer-bot", "linkedin-carousel-generator", "infra-terraform-modules", "mobile-relay-prototype", "customer-demo-environments-for-the-q4-enterprise-roadshow"].map(
    (name, i): Project => ({ id: `p-f${i}`, keyPrefix: `F${i}`, name, repoPath: `/Users/cymarechal/code/${name}`, defaultBranch: "main", status: "active" }),
  ),
];

const BIG_MILESTONES: MilestoneDto[] = [
  { id: "m-b1", projectId: BIG, title: "Ingest the knowledge base", exitTest: "Every document in the shared drive is indexed, chunked and searchable with its source link.", state: "done", current: false, rank: "a" },
  {
    id: "m-b2", projectId: BIG, title: "Answer every inbound RFP question from the knowledge base, with its sources cited inline and a confidence score per answer",
    exitTest: "A presales engineer drops a 300-question RFP spreadsheet in, gets a first draft of every answer with citations within ten minutes, and edits fewer than one answer in five before sending it to the customer, measured over three real RFPs.",
    state: "in_progress", current: true, rank: "b",
  },
  { id: "m-b3", projectId: BIG, title: "Security questionnaires (SIG Lite, CAIQ, and the customers' own bespoke spreadsheets)", exitTest: null, state: "shaping", current: false, rank: "c" },
  { id: "m-b4", projectId: BIG, title: "Demo environments on demand", exitTest: "A seller books a demo and gets a seeded tenant in under five minutes.", state: "shaping", current: false, rank: "d" },
  { id: "m-b5", projectId: BIG, title: "Win/loss analysis", exitTest: null, state: "shaping", current: false, rank: "e" },
  { id: "m-b6", projectId: BIG, title: "Hand the platform over to the enablement team with runbooks, dashboards and an on-call rota", exitTest: null, state: "shaping", current: false, rank: "f" },
];

const EPIC_TITLES = [
  "Parse RFP spreadsheets of every shape customers send, merged cells and hidden sheets included",
  "Retrieve the right passages",
  "Draft answers with inline citations and a confidence score",
  "Review queue for the presales engineer, with side-by-side source previews and one-key accept",
  "Export back into the customer's own template without breaking their formatting",
  "Answer library",
  "Usage analytics and the weekly digest email for presales leadership",
  "Single sign-on with the customer's Okta and Azure AD tenants",
  "Cost controls",
];

const STORY_TITLES = [
  "Read .xlsx files with merged header cells",
  "Detect the question column when the header row is not the first row",
  "Skip hidden sheets and the customer's instructions tab, but keep any question that sits in a hidden row because someone hid it by mistake",
  "Handle .csv exports with semicolon separators and Windows-1252 encoding",
  "Chunk documents on headings",
  "Hybrid BM25 and embedding search with a reranker over the top fifty passages, measured on the 400-question gold set",
  "Cache embeddings by content hash",
  "Cite the paragraph, not the document",
  "Score confidence from retrieval agreement and the model's own self-check, and show it as High, Medium or Low with the reason",
  "Refuse to answer when nothing relevant is found",
  "Keyboard-first review: J and K to move, A to accept, E to edit, R to regenerate with a note",
  "Side-by-side source preview",
  "Write answers back into the customer's own cells, preserving fonts, fills, borders, data validation and the column widths they set",
  "Export a .docx answer pack",
  "Save an accepted answer to the library with its sources",
  "Suggest library answers before generating",
  "Weekly digest email",
  "Okta SAML",
  "Azure AD OIDC with group-to-role mapping, including nested groups and the guest-user edge cases the security review raised",
  "Per-tenant monthly token budget with a hard stop and an admin override",
  "Show cost per RFP",
];

const STATES = ["merged", "merged", "in_review", "running", "running", "ready", "ready", "shaping", "dropped", "running", "in_review", "shaping"];

const bigEpics: EpicDto[] = EPIC_TITLES.map((title, i) => ({
  id: `eb-${i}`, projectId: BIG, milestoneId: "m-b2", key: `PRESALES-${100 + i}`, title,
  problem: i === 1 ? "Presales engineers spend two days per RFP finding the paragraph that already answers a question somewhere in four hundred documents." : null,
  scope: null, outOfScope: null, exitTest: null,
  state: i < 2 ? "done" : i === 8 ? "shaping" : "in_progress", rank: String.fromCharCode(97 + i),
}));

const bigStories: StoryDto[] = [];
bigEpics.forEach((epic, e) => {
  const n = e === 0 ? 4 : e === 3 ? 9 : 5 + (e % 3);
  for (let i = 0; i < n; i++) {
    const k = bigStories.length;
    const state = epic.state === "done" ? (i === n - 1 ? "dropped" : "merged") : epic.state === "shaping" ? "shaping" : STATES[(k + e) % STATES.length];
    bigStories.push({
      id: `sb-${k}`, projectId: BIG, epicId: epic.id, key: `PRESALES-${1001 + k}`,
      title: STORY_TITLES[k % STORY_TITLES.length] + (k >= STORY_TITLES.length ? ` (part ${Math.floor(k / STORY_TITLES.length) + 1})` : ""),
      description: k % 4 === 0 ? `The ${STORY_TITLES[k % STORY_TITLES.length].toLowerCase()} Story, written from the RFP the Acme team sent on 14 October, which had every one of these problems in one file.` : null,
      state, runsAfterStoryId: null, rank: String.fromCharCode(97 + (k % 26)) + k,
    });
  }
});

/** The Story the Story view, the feed and the review are shot on: long title, running, every list long. */
export const LONG_STORY = bigStories.find((s) => s.state === "running") as StoryDto;
LONG_STORY.title =
  "Write answers back into the customer's own spreadsheet cells, preserving fonts, fills, borders, data validation, conditional formatting and the column widths they set, without ever touching a cell outside the answer column";
LONG_STORY.description =
  "Customers send their own templates and expect them back unchanged except for the answers. Today the export rewrites the workbook through a library that drops data validation and conditional formatting, so two customers have already sent the file back. Write answers cell by cell into the original package instead.";
export const REVIEW_STORY = bigStories.find((s) => s.state === "in_review") as StoryDto;
const running = bigStories.filter((s) => s.state === "running");
/** Waiting on you: a Gated action, a permission request with a long command, a question. */
const WAITING = running.slice(1, 4);
const STOPPED = running[4];

const longTask = (i: number) =>
  [
    "Read how the export writes the workbook today",
    "Write a failing test from the Acme template with data validation on column D",
    "Open the .xlsx package with the zip reader and patch sheet XML in place",
    "Keep shared strings deduplicated when an answer repeats text already in the workbook, so the file does not grow by a megabyte per export",
    "Preserve conditional formatting ranges",
    "Escape answers that start with =, + or - so Excel does not read them as formulas",
    "Handle merged answer cells",
  ][i % 7] + (i >= 7 ? ` (round ${Math.floor(i / 7) + 1})` : "");

const bigTasks: TaskDto[] = Array.from({ length: 24 }, (_, i) => ({
  id: `tb-${i}`, storyId: LONG_STORY.id, title: longTask(i), state: i < 14 ? "done" : i === 14 ? "doing" : i === 20 ? "dropped" : "open",
  droppedReason: i === 20 ? "Covered by the shared-strings Task above" : null, rank: `a${String(i).padStart(2, "0")}`,
  note: i === 14 ? "Patching sheet1.xml works for plain cells. Merged cells need the mergeCells element read first: the answer goes in the top-left cell only, and the others must stay empty or Excel repairs the file on open and shows the customer a warning." : null,
}));

const check = (id: string, command: string, result: string) => ({ id, command, timeoutSecs: 600, result, commitSha: "7c1e9fa", stale: result === "stale", outputTail: null });
const bigCriteria: AcceptanceCriterionDto[] = [
  ["An exported Acme template opens in Excel without a repair prompt", "pnpm --filter @presales/export test -- --run src/xlsx/__tests__/acme-template-roundtrip.test.ts --reporter=verbose", "passed"],
  ["Data validation, conditional formatting and column widths survive an export unchanged", "pnpm --filter @presales/export test -- --run src/xlsx/__tests__/preserve-formatting.test.ts --reporter=verbose --testTimeout=120000 --bail=1 --no-color", "failed"],
  ["No cell outside the answer column changes, byte for byte, in sheet XML", "node scripts/diff-workbook.mjs fixtures/rfp/acme-2026-10-14.xlsx out/acme-2026-10-14.answered.xlsx --only-column=D", "not_run"],
  ["An answer that starts with = is written as text", "pnpm --filter @presales/export test -- formula-injection", "timed_out"],
  ["Merged answer cells hold the answer once, in their top-left cell", "pnpm --filter @presales/export test -- merged-cells", "stale"],
  ["The export of a 300-question RFP takes under two seconds on the CI runner", "pnpm --filter @presales/export bench -- --filter export-300 --threshold-ms 2000", "passed"],
  ["A presales engineer reads the export and says it looks like the customer's own file", null, null],
  ["Shared strings are not duplicated", "pnpm --filter @presales/export test -- shared-strings", "passed"],
].map(([statement, command, result], i) => ({
  id: `cb-${i}`, storyId: LONG_STORY.id, statement: statement as string, accepted: i === 0, acceptedAt: i === 0 ? ago(600) : null, rank: String.fromCharCode(97 + i),
  check: command ? check(`kb-${i}`, command as string, result as string) : null,
})) as AcceptanceCriterionDto[];

const runSummary = (id: string, storyId: string, status: string, startedAgo: number, endedAgo: number | null, endingReason: RunSummaryDto["endingReason"], cost: number | null = null): RunSummaryDto => ({
  id, storyId, status, startedAt: ago(startedAgo), endedAt: endedAgo === null ? null : ago(endedAgo),
  costUsd: cost, tokensIn: cost ? 1_840_000 : null, tokensOut: cost ? 96_400 : null, externalSessionId: null, acknowledgedAt: null, abandonedReason: null, endingReason,
});

const bigRuns: Record<string, RunSummaryDto[]> = {
  [LONG_STORY.id]: [
    runSummary("ses-b1", LONG_STORY.id, "running", 3 * 3600 + 420, null, null),
    runSummary("ses-b0", LONG_STORY.id, "interrupted", 9 * 3600, 8 * 3600 + 1200, "usage_limit", 11.42),
    runSummary("ses-b0c", LONG_STORY.id, "completed", 26 * 3600, 25 * 3600, "ended_without_hand_off", 3.1),
    runSummary("ses-b0d", LONG_STORY.id, "failed", 30 * 3600, 30 * 3600 - 40, "crash"),
    runSummary("ses-b0e", LONG_STORY.id, "interrupted", 50 * 3600, 49 * 3600, "app_quit", 0.8),
    runSummary("ses-b0f", LONG_STORY.id, "interrupted", 74 * 3600, 73 * 3600, "stopped_by_developer", 1.9),
    runSummary("ses-b0g", LONG_STORY.id, "completed", 98 * 3600, 97 * 3600, "handed_off", 6.25),
  ],
};
WAITING.forEach((s, i) => (bigRuns[s.id] = [runSummary(`ses-bw${i}`, s.id, "blocked", 1800 + i * 600, null, null)]));
running.filter((s) => s !== LONG_STORY && !WAITING.includes(s) && s !== STOPPED).forEach((s, i) => (bigRuns[s.id] = [runSummary(`ses-br${i}`, s.id, "running", 900 + i * 300, null, null)]));
bigRuns[STOPPED.id] = [runSummary("ses-bs", STOPPED.id, "interrupted", 7200, 5400, "usage_limit", 4.2)];
bigRuns[REVIEW_STORY.id] = [runSummary("ses-brv", REVIEW_STORY.id, "completed", 10800, 7200, "handed_off", 7.7)];

// ---------------------------------------------------------------------------------------------
// A session log shaped like real Claude CLI output (stream-json through the sidecar).
// ---------------------------------------------------------------------------------------------

let seq = 0;
const ev = (secondsAgo: number, fields: Record<string, unknown>) => ({ seq: seq++, at: ago(secondsAgo), raw: JSON.stringify(fields).slice(0, 400), ...fields });
const call = (t: number, id: string, toolName: string, input: unknown) => ev(t, { type: "tool_call", toolName, input, toolUseId: id });
const result = (t: number, id: string, output: unknown, isError = false) => ev(t, { type: "tool_result", output, toolUseId: id, ...(isError ? { isError: true } : {}) });
const say = (t: number, text: string) => ev(t, { type: "assistant_text", text });
const notice = (t: number, text: string) => ev(t, { type: "system_notice", text });
const BOARD = "mcp__flywheel-board__";

const LONG_HEREDOC = `cat > packages/export/src/xlsx/patch-sheet.ts <<'EOF'
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type { Zip } from "./zip";

/** Write each answer into its cell of the original sheet XML, leaving every other node as it was. */
export async function patchSheet(zip: Zip, sheetPath: string, answers: Map<string, string>): Promise<void> {
  const xml = await zip.readText(sheetPath);
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, trimValues: false });
  const tree = parser.parse(xml);
  for (const row of rowsOf(tree)) for (const cell of cellsOf(row)) {
    const ref = cell[":@"]?.["@_r"];
    if (ref && answers.has(ref)) writeInlineString(cell, answers.get(ref) as string);
  }
  await zip.writeText(sheetPath, new XMLBuilder({ ignoreAttributes: false, preserveOrder: true }).build(tree));
}
EOF`;

const FAILED_OUTPUT = [
  "> @presales/export@0.4.0 test /Users/cymarechal/cymarechal/clients/acme-enterprise-holdings/technical-presales-knowledge-platform-monorepo/packages/export",
  "> vitest run src/xlsx/__tests__/preserve-formatting.test.ts",
  "",
  " RUN  v3.2.4 /Users/cymarechal/cymarechal/clients/acme-enterprise-holdings/technical-presales-knowledge-platform-monorepo/packages/export",
  "",
  " ❯ src/xlsx/__tests__/preserve-formatting.test.ts (6 tests | 2 failed) 1843ms",
  "   ✓ keeps column widths 212ms",
  "   ✓ keeps fonts and fills 198ms",
  "   × keeps data validation on column D 301ms",
  "     → expected '<dataValidations count=\"1\"><dataValidation type=\"list\" allowBlank=\"1\" showInputMessage=\"1\" showErrorMessage=\"1\" sqref=\"D2:D301\"><formula1>\"Yes,No,Partial,Roadmap\"</formula1></dataValidation></dataValidations>' to be present in sheet1.xml",
  "   × keeps conditional formatting 288ms",
  "",
  "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯",
  "",
  " FAIL  src/xlsx/__tests__/preserve-formatting.test.ts > keeps data validation on column D",
  "AssertionError: expected undefined to deeply equal { type: 'list', sqref: 'D2:D301' }",
  " ❯ src/xlsx/__tests__/preserve-formatting.test.ts:48:31",
  "",
  " Test Files  1 failed (1)",
  "      Tests  2 failed | 4 passed (6)",
  "ELIFECYCLE  Test failed. See above for more details.",
].join("\n");

function realLog(): Record<string, unknown>[] {
  const t0 = 3 * 3600 + 420;
  const out: Record<string, unknown>[] = [
    ev(t0, { type: "init", sessionId: "4b1d9a0e-77c2-4f0e-9d3b-2c6f1a8e5b70" }),
    notice(t0 - 1, "system: hook_started"),
    notice(t0 - 1, "system: hook_response"),
    notice(t0 - 2, "Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer."),
    ev(t0 - 3, { type: "thinking", text: "" }),
    say(t0 - 10, "I'll start from the board: the Story's criteria, the open Tasks and what the last session handed off."),
    call(t0 - 12, "b1", `${BOARD}story_get`, {}),
    result(t0 - 13, "b1", JSON.stringify({ key: LONG_STORY.key, title: LONG_STORY.title, state: "running" })),
  ];
  let t = t0 - 20;
  for (let i = 0; i < 26; i++) {
    const id = `c${i}`;
    const file = `packages/export/src/xlsx/${["zip", "patch-sheet", "shared-strings", "styles", "merge-cells", "validation", "conditional-formatting"][i % 7]}.ts`;
    out.push(call(t, `${id}r`, "Read", { file_path: `${BIG_PATH}/${file}` }));
    out.push(result(t - 1, `${id}r`, Array.from({ length: 30 }, (_, l) => `${String(l + 1).padStart(6)}\t// line ${l + 1} of ${file}`).join("\n")));
    if (i % 5 === 2) out.push(ev(t - 2, { type: "rate_limit", status: "allowed_warning", resetsAt: ago(-3600) }));
    if (i % 4 === 1) out.push(notice(t - 2, "system: hook_started"), notice(t - 2, "system: hook_response"));
    if (i % 3 === 0) {
      out.push(say(t - 3, `Reading \`${file}\`: it ${["opens the package with JSZip and writes it back whole", "rebuilds every row", "keeps an index of shared strings", "never reads styles.xml"][i % 4]}. ${i % 2 ? "That is the source of the lost validation." : "Next I check where the workbook is serialised."}`));
    }
    if (i % 6 === 4) {
      out.push(call(t - 4, `${id}e`, "Edit", { file_path: `${BIG_PATH}/${file}`, old_string: "const workbook = await XLSX.read(buffer, { cellStyles: true });", new_string: "const zip = await Zip.open(buffer);\nawait patchSheet(zip, sheetPathOf(zip, sheet), answers);", replace_all: false }));
      out.push(result(t - 5, `${id}e`, `The file ${BIG_PATH}/${file} has been updated.`));
    }
    if (i % 7 === 5) {
      out.push(call(t - 6, `${id}b`, "Bash", { command: "pnpm --filter @presales/export test -- --run src/xlsx/__tests__/preserve-formatting.test.ts --reporter=verbose 2>&1 | tail -n 80", description: "Run the formatting tests" }));
      out.push(result(t - 50, `${id}b`, FAILED_OUTPUT, true));
      out.push(say(t - 55, "Two still fail: data validation and conditional formatting live in sheet XML **after** `sheetData`, and the builder drops unknown siblings. I'll keep the original nodes and only replace cell values."));
    }
    if (i === 11) {
      out.push(call(t - 7, `${id}h`, "Bash", { command: LONG_HEREDOC, description: "Write the sheet patcher" }));
      out.push(result(t - 8, `${id}h`, ""));
      out.push(call(t - 9, `${id}g`, "Bash", { command: "git add -A && git commit -m 'export: patch sheet XML in place instead of rewriting the workbook through SheetJS, so validation and conditional formatting survive' && git push origin story/presales-1013-preserve-template-formatting", description: "Commit and push" }));
      out.push(result(t - 12, `${id}g`, "error: failed to push some refs to 'github.com:acme-enterprise-holdings/technical-presales-knowledge-platform-monorepo.git'\nhint: Updates were rejected because the remote contains work that you do not have locally.", true));
    }
    if (i === 17) out.push(ev(t - 3, { type: "rate_limit", status: "rejected", resetsAt: ago(-1800) }), notice(t - 3, "API Error: 529 Overloaded. Retrying in 4 seconds… (attempt 1 of 10)"));
    if (i % 8 === 3) {
      out.push(call(t - 9, `${id}t`, `${BOARD}task_update`, { task_id: `tb-${Math.min(13, i)}`, state: "done", note: "Done; see the commit." }));
      out.push(result(t - 10, `${id}t`, JSON.stringify({ tasks: bigTasks.slice(0, 6).map((x) => ({ task_id: x.id, title: x.title, state: x.state })) })));
    }
    t -= 300;
  }
  out.push(say(t, "All six formatting tests pass now. I'll run the whole export suite before touching the merged-cells Task."));
  out.push(call(t - 2, "last", "Bash", { command: "pnpm --filter @presales/export test", description: "Run the export test suite" }));
  out.push(ev(5, { type: "tool_progress", toolUseId: "last", toolName: "Bash", elapsedSeconds: 312 }));
  return out;
}

function endedLog(): Record<string, unknown>[] {
  const t0 = 9 * 3600;
  return [
    ev(t0, { type: "init", sessionId: "0aa1" }),
    notice(t0 - 1, "Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer."),
    say(t0 - 30, "Picking up from the hand-off: the shared-strings Task is next."),
    call(t0 - 40, "e1", "Bash", { command: "pnpm --filter @presales/export test -- shared-strings", description: "Run the shared-strings test" }),
    result(t0 - 90, "e1", FAILED_OUTPUT, true),
    ev(t0 - 100, { type: "rate_limit", status: "rejected", resetsAt: ago(8 * 3600) }),
    notice(t0 - 100, "Claude AI usage limit reached|1761483600"),
    ev(t0 - 101, { type: "result", inputTokens: 1_840_000, outputTokens: 96_400, totalCostUsd: 11.42 }),
    ev(8 * 3600 + 1200, { type: "session_closed", reason: "usage_limit" }),
  ];
}

const RAW_LINES = Array.from({ length: 60 }, (_, i) =>
  JSON.stringify({ type: i % 3 ? "assistant" : "system", subtype: i % 3 ? undefined : "hook_response", message: { content: [{ type: "text", text: `line ${i} of the raw stream-json, as Claude Code wrote it` }] }, session_id: "4b1d9a0e-77c2-4f0e-9d3b-2c6f1a8e5b70" }),
);

// ---------------------------------------------------------------------------------------------
// Reads that the M2 fixture words for flywheel only.
// ---------------------------------------------------------------------------------------------

function project(id: string) {
  return [...SEED.PROJECTS].find((p) => p.id === id) as Project;
}

function fleetRow(sessionId: string, story: StoryDto, runStatus: string, fleetState: string, startedAgo: number, blockedAgo: number | null): FleetRowDto {
  const p = project(story.projectId);
  return {
    sessionId, projectId: p.id, projectName: p.name, projectKeyPrefix: p.keyPrefix, projectStatus: "active",
    storyId: story.id, storyKey: story.key, storyTitle: story.title, storyState: story.state, runStatus, fleetState,
    startedAt: ago(startedAgo), endedAt: null, blockedSince: blockedAgo === null ? null : ago(blockedAgo),
    costUsd: null, tokensIn: null, tokensOut: null,
    doingTaskTitle: story === LONG_STORY ? bigTasks[14].title : "Read the code this Story touches",
    activity: { lines: [], truncated: false },
  };
}

function queueEntry(sessionId: string, story: StoryDto, i: number): BlockedQueueEntryDto {
  const p = project(story.projectId);
  const kinds = [
    { toolName: "Bash", inputPayload: JSON.stringify({ command: "git push --force-with-lease origin story/presales-1013-preserve-template-formatting:story/presales-1013-preserve-template-formatting" }), destructiveCategory: "git-push", suggestedRule: null },
    { toolName: "Bash", inputPayload: JSON.stringify({ command: "docker compose -f infra/docker-compose.local.yml --profile search --profile workers up -d --build opensearch embeddings-worker reranker-worker && ./scripts/wait-for-it.sh localhost:9200 --timeout=120" }), destructiveCategory: null, suggestedRule: "Bash(docker compose -f infra/docker-compose.local.yml:*)" },
    { toolName: "AskUserQuestion", inputPayload: JSON.stringify({ questions: [{ question: "The customer's template has answers in column D but the comments for reviewers in column E are also editable. Should the export write the confidence score and the citations into column E, overwrite whatever the customer typed there, or leave column E alone and put them in a new sheet called Sources?", header: "Column E", multiSelect: false, options: [{ label: "A new Sources sheet", description: "Nothing the customer typed is touched; the citations are one click away." }, { label: "Column E, only where it is empty" }, { label: "Leave citations out of the export" }] }] }), destructiveCategory: null, suggestedRule: null },
  ][i];
  return { requestId: `req-b${i}`, ...kinds, createdAt: ago(1800 - i * 200), sessionId, projectId: p.id, projectName: p.name, projectKeyPrefix: p.keyPrefix, storyId: story.id, storyKey: story.key, storyTitle: story.title, blockedSince: ago(1800 - i * 200) };
}

let BIG_QUEUE: BlockedQueueEntryDto[] = [];

function countsOf(stories: StoryDto[]) {
  const waiting = new Set(WAITING.map((s) => s.id));
  const c = { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0 };
  for (const s of stories) {
    if (waiting.has(s.id)) c.waitingOnYou++;
    else if (s.id === STOPPED.id) c.stopped++;
    else if (s.state === "in_review") c.inReview++;
    else c[s.state as "shaping"]++;
  }
  return SEED.counts(c);
}

const BIG_PROGRESS: MilestoneProgressDto = {
  milestoneId: "m-b2", title: BIG_MILESTONES[1].title, exitTest: BIG_MILESTONES[1].exitTest, state: "in_progress", current: true,
  nextMilestoneTitle: BIG_MILESTONES[2].title, counts: countsOf(bigStories), epicsDone: 2, epicsTotal: bigEpics.length,
  epics: bigEpics.map((e) => ({
    epicId: e.id, key: e.key, title: e.title, state: e.state,
    attention: bigStories.some((s) => s.epicId === e.id && WAITING.includes(s)) ? "waiting_on_you" : null,
    counts: countsOf(bigStories.filter((s) => s.epicId === e.id)), proposals: e.id === "eb-3" ? 7 : e.id === "eb-4" ? 4 : 0,
    shaping: e.state === "shaping" ? { stageKind: "slice", stageRank: 2, roundNumber: 3, roundOpen: false, answered: 0, questions: 0 } : null,
  })),
};

const needsYouItem = (kind: NeedsYouItemDto["kind"], rank: number, id: string, since: string, record: NeedsYouItemDto["record"], extra: Partial<NeedsYouItemDto> = {}): NeedsYouItemDto => ({
  kind, rank, id, since, record, sessionId: null, request: null, endingReason: null, missingWorktree: false, doingTaskTitle: null, exitTest: null,
  milestoneTitle: null, round: null, conflicts: [], proposals: null, judgedOn: null, ...extra,
});
const storyRecord = (s: StoryDto): NeedsYouItemDto["record"] => ({ kind: "story", id: s.id, key: s.key, title: s.title, state: null });

function bigNeedsYou(): NeedsYouItemDto[] {
  const items: NeedsYouItemDto[] = BIG_QUEUE.map((q) =>
    needsYouItem(q.toolName === "AskUserQuestion" ? "question" : q.destructiveCategory ? "gated_action" : "permission_request", 1, q.requestId, q.createdAt, storyRecord(WAITING[BIG_QUEUE.indexOf(q)]), {
      sessionId: q.sessionId, request: { id: q.requestId, toolName: q.toolName, inputPayload: q.inputPayload, destructiveCategory: q.destructiveCategory, suggestedRule: q.suggestedRule },
    }),
  );
  items.push(needsYouItem("stopped", 2, STOPPED.id, ago(5400), storyRecord(STOPPED), { sessionId: "ses-bs", endingReason: "usage_limit", doingTaskTitle: "Read the code this Story touches" }));
  const reviews = bigStories.filter((s) => s.state === "in_review");
  reviews.forEach((s, i) => items.push(needsYouItem("review", 3, s.id, ago(7200 - i * 60), storyRecord(s), { conflicts: i === 1 ? ["packages/export/src/xlsx/patch-sheet.ts", "pnpm-lock.yaml"] : [] })));
  items.push(needsYouItem("confirm_exit_test", 4, "eb-1", ago(20000), { kind: "epic", id: "eb-1", key: bigEpics[1].key, title: bigEpics[1].title, state: null }, {
    exitTest: "On the 400-question gold set, the right passage is in the top five for 92% of questions, and the median query takes under 300 ms.", milestoneTitle: BIG_MILESTONES[1].title,
  }));
  items.push(needsYouItem("proposals", 5, BIG, ago(9000), { kind: "project", id: BIG, key: null, title: "", state: null }, { proposals: { count: bigTriage.length, stories: 6, epics: 3, roadmap: true } }));
  return items;
}

const bigTriage: TriageProposalDto[] = Array.from({ length: 18 }, (_, i) => {
  const epic = i < 7 ? bigEpics[3] : i < 11 ? bigEpics[4] : i < 15 ? bigEpics[6] : null;
  const filer = bigStories[(i * 3) % bigStories.length];
  const verb = ["create", "create", "amend", "reorder", "create", "drop"][i % 6];
  const titles = [
    "Remember the reviewer's last position in a 300-question RFP across app restarts",
    "Bulk-accept every High-confidence answer in one keystroke",
    "Flag answers whose sources are older than the product's last release",
    "Export a diff of what changed since the customer's previous RFP of the same template",
  ];
  return {
    proposal: {
      id: `pt-${i}`, projectId: BIG, sessionId: `ses-br0`, epicId: epic?.id ?? null, verb, targetType: verb === "create" ? "story" : "story",
      targetId: verb === "create" ? null : bigStories[i].id,
      payload: verb === "create" ? { title: titles[i % 4], description: "Reviewers lose their place when the app restarts mid-RFP, and they told us twice in the pilot that finding it again takes minutes in a 300-row sheet.", criteria: i % 2 ? [{ statement: "Reopening the RFP lands on the last reviewed question", check_command: "pnpm --filter @presales/review test -- resume-position" }] : [] } : verb === "amend" ? { field: "title", text: titles[(i + 1) % 4] } : verb === "reorder" ? { rank: "a5" } : {},
      rationale: "Found while running the review queue against the Acme RFP: three reviewers hit it in the first hour.", state: "pending", createdAt: ago(9000 - i * 300), rejectionReason: null, stageId: null, roundId: null,
      evidence: i % 3 === 0 ? `${BIG_PATH}/packages/review/src/queue/ReviewQueue.tsx:214` : null,
    },
    storyId: filer.id, storyKey: filer.key, storyTitle: filer.title, epicKey: epic?.key ?? null, epicTitle: epic?.title ?? null, milestoneTitle: epic ? BIG_MILESTONES[1].title : null,
    targetKey: verb === "create" ? null : bigStories[i].key, targetTitle: verb === "create" ? null : bigStories[i].title,
    reorder: verb === "reorder" ? { nowAfter: bigStories[i + 1].key, proposedAfter: bigStories[i + 3].key } : null,
  } as TriageProposalDto;
});

const REVIEW_FILES: ReviewFileDto[] = [
  ...Array.from({ length: 22 }, (_, i): ReviewFileDto => ({
    path: `packages/export/src/xlsx/${["writers", "readers", "styles", "__tests__/fixtures/customer-templates"][i % 4]}/${["patch-sheet-xml-in-place", "shared-strings-index", "conditional-formatting-ranges", "data-validation-preserver", "merged-cell-top-left-writer"][i % 5]}${i}.${i % 4 === 3 ? "xlsx" : "ts"}`,
    oldPath: i === 4 ? "packages/export/src/xlsx/legacy/sheetjs-workbook-rewriter.ts" : null,
    status: i === 4 ? "R" : i % 7 === 0 ? "A" : i % 11 === 0 ? "D" : "M",
    added: i % 4 === 3 ? null : 12 + i * 7, removed: i % 4 === 3 ? null : i * 3, binary: i % 4 === 3,
  })),
  { path: "pnpm-lock.yaml", oldPath: null, status: "M", added: 1204, removed: 388, binary: false },
  { path: "docs/adr/0007-write-answers-by-patching-sheet-xml-instead-of-rewriting-the-workbook.md", oldPath: null, status: "A", added: 48, removed: 0, binary: false },
  { path: "GLOSSARY.md", oldPath: null, status: "M", added: 6, removed: 1, binary: false },
  { path: "packages/export/package.json", oldPath: null, status: "M", added: 2, removed: 1, binary: false },
];

let mergeable = false;
/** Every criterion accepted and nothing uncommitted, so Merge is offered with the one failing Check (screen s18). */
export function setBigReviewMergeable(on: boolean) {
  mergeable = on;
}

function bigReview(storyId: string): StoryReviewDto {
  const s = bigStories.find((x) => x.id === storyId) ?? REVIEW_STORY;
  const base = SEED.reviewOf("s-3");
  const failing = { checkId: "kr-1", criterionId: "cr-1", command: bigCriteria[1].check?.command ?? "", result: "failed", stale: false, commitSha: "7c1e9fa", outputTail: FAILED_OUTPUT, objections: [] };
  return {
    ...base, storyId: s.id, storyKey: s.key,
    review: base.review && { ...base.review, files: REVIEW_FILES.length, added: 1841, removed: 512 },
    criteria: bigCriteria.map((c, i) => ({ id: `cr-${i}`, statement: c.statement, accepted: mergeable || i === 0, acceptedAt: mergeable || i === 0 ? ago(60) : null, preTicked: c.check?.result === "passed", check: c.check ? { checkId: `kr-${i}`, criterionId: `cr-${i}`, command: c.check.command, result: c.check.result, stale: c.check.stale, commitSha: "7c1e9fa", outputTail: i === 1 ? FAILED_OUTPUT : null, objections: [] } : null })),
    failingChecks: [failing],
    files: REVIEW_FILES,
    uncommitted: mergeable ? [] : ["packages/export/src/xlsx/writers/patch-sheet-xml-in-place0.ts"],
  };
}

const RULES: PermissionRuleDto[] = [
  ...["Bash(pnpm --filter @presales/export test:*)", "Bash(docker compose -f infra/docker-compose.local.yml --profile search --profile workers up -d --build:*)", "Bash(node scripts/diff-workbook.mjs:*)", "Read(//Users/cymarechal/cymarechal/clients/acme-enterprise-holdings/**)", "WebFetch(domain:learn.microsoft.com)", "mcp__playwright__browser_navigate", "Bash(git commit:*)", "Bash(npx impeccable detect:*)"].map(
    (pattern, i): PermissionRuleDto => ({ id: `rule-${i}`, projectId: i < 5 ? BIG : "p-fly", tool: pattern.split("(")[0], pattern, createdAt: ago(86400 * (i + 1)) }),
  ),
  ...Array.from({ length: 10 }, (_, i): PermissionRuleDto => ({ id: `rule-x${i}`, projectId: "p-fly", tool: "Bash", pattern: `Bash(npm --prefix packages/desktop run test:${["browser", "critique", "layout-defects", "browser:dark", "browser:motion"][i % 5]}:*)`, createdAt: ago(3600 * (i + 2)) })),
];

const INVENTORY: WorktreeInventoryRowDto[] = bigStories.slice(0, 22).map((s, i) => ({
  storyId: s.id, storyKey: s.key, storyTitle: s.title, storyState: s.state, projectId: BIG, projectName: BIG_NAME, projectStatus: "active",
  branch: `story/${s.key.toLowerCase()}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
  sizeBytes: i % 5 === 4 ? null : (i + 1) * 187_000_000, sizeMeasuredAt: i % 5 === 4 ? null : ago(3600),
  disposition: s.state === "merged" || s.state === "dropped" ? "reclaimable" : s.state === "running" ? "in_use" : "keep",
  reason: (s.state === "merged" ? "merged" : s.state === "dropped" ? "dropped" : s.state === "running" ? "sessionning" : i % 3 ? "uncommitted_changes" : "story_open") as WorktreeInventoryRowDto["reason"],
}));

const ORPHANS: PendingOrphanDto[] = [
  { runId: "run-o1", storyId: LONG_STORY.id, storyKey: LONG_STORY.key, storyTitle: LONG_STORY.title, projectId: BIG, externalSessionId: "4b1d9a0e-77c2-4f0e-9d3b-2c6f1a8e5b70", pid: 48213, startedAt: ago(7200) },
  { runId: "run-o2", storyId: "s-4", storyKey: "FLY-4", storyTitle: "Make clicking and navigation predictable", projectId: "p-fly", externalSessionId: null, pid: 51877, startedAt: ago(3600) },
];

const BIG_VISIT = {
  total: 64,
  events: Array.from({ length: 30 }, (_, i) => {
    const s = bigStories[i % bigStories.length];
    const kinds = [
      ["story.state_changed", "Moved Story from running to in_review"],
      ["story.handed_off", "Handed off for review: 6 Checks passed, 2 failed, 1 timed out"],
      ["proposal.filed", "Proposed to create a story"],
      ["task.state_changed", "Marked a Task done"],
      ["session.ended", "Session ended: usage limit reached at 11:42, resets at 16:00"],
    ][i % 5];
    return { id: `evb-${i}`, projectId: BIG, origin: "local", sequence: 500 + i, actorId: "a-dev", eventType: kinds[0], description: kinds[1], occurredAt: ago(40000 - i * 1200), subjectKey: s.key, subjectTitle: s.title };
  }),
};

// ---------------------------------------------------------------------------------------------
// Install.
// ---------------------------------------------------------------------------------------------

let seeded = false;
function seed() {
  if (seeded) return;
  seeded = true;
  SEED.PROJECTS.push(...EXTRA_PROJECTS);
  SEED.MILESTONES[BIG] = BIG_MILESTONES;
  SEED.MILESTONES["p-fresh"] = [{ id: "m-f1", projectId: "p-fresh", title: "Rebuild a laptop from zero in under an hour", exitTest: null, state: "shaping", current: true, rank: "a" }];
  SEED.EPICS["m-b2"] = bigEpics;
  SEED.STORIES.push(...bigStories);
  SEED.TASKS[LONG_STORY.id] = bigTasks;
  SEED.CRITERIA[LONG_STORY.id] = bigCriteria;
  Object.assign(SEED.RUNS, bigRuns);
  SEED.SUMMARIES[LONG_STORY.id] = [
    { sessionId: "ses-b0g", createdAt: ago(97 * 3600), isStub: false, nextSessionMustKnow: "The export goes through SheetJS, which rewrites the workbook and drops data validation and conditional formatting. Patch sheet XML in place instead: see ADR 0007. The Acme template in fixtures/rfp/ reproduces both losses.", decisions: "Patch sheet XML in place (ADR 0007). Keep SheetJS for reading only." },
    { sessionId: "ses-b0", createdAt: ago(8 * 3600 + 1200), isStub: true, nextSessionMustKnow: "Ended: usage limit. Doing: Keep shared strings deduplicated when an answer repeats text already in the workbook. Last message: \"Two still fail: data validation and conditional formatting live in sheet XML after sheetData.\"", decisions: "" },
  ];
  SEED.LOGS["ses-b1"] = realLog();
  SEED.LOGS["ses-b0"] = endedLog();
  // The 168-line log #190 was reproduced from (overlapping pages drew rows twice): reused as it is.
  SEED.LOGS["ses-bsyn"] = syntheticSessionLog();
  SEED.RUNS[LONG_STORY.id].push({ ...runSummary("ses-bsyn", LONG_STORY.id, "completed", 0, 0, "handed_off", 0.42), startedAt: SYNTHETIC_STARTED_AT, endedAt: SYNTHETIC_ENDED_AT });
  BIG_QUEUE = WAITING.map((s, i) => queueEntry(`ses-bw${i}`, s, i));
  SEED.QUEUE.push(...BIG_QUEUE);
  BIG_QUEUE.forEach((q) => (SEED.PENDING[q.sessionId] = [{ id: q.requestId, toolName: q.toolName, inputPayload: q.inputPayload, createdAt: q.createdAt, destructiveCategory: q.destructiveCategory, suggestedRule: q.suggestedRule }]));
  SEED.FLEET_ROWS.push(
    fleetRow("ses-b1", LONG_STORY, "running", "running", 3 * 3600 + 420, null),
    ...WAITING.map((s, i) => fleetRow(`ses-bw${i}`, s, "blocked", "blocked", 1800 + i * 600, 1800 - i * 200)),
    ...running.filter((s) => s !== LONG_STORY && !WAITING.includes(s) && s !== STOPPED).map((s, i) => fleetRow(`ses-br${i}`, s, "running", "running", 900 + i * 300, null)),
  );
  SEED.PROGRESS[BIG] = BIG_PROGRESS;
  SEED.PACKET[LONG_STORY.id] = 31_200;
}

export interface StressOptions {
  /** No project registered: first run. */
  noProjects?: boolean;
  /** `plugin:dialog|open` answers this folder (Register project). */
  pickedFolder?: string | null;
  /** `project_register` fails with this message. */
  registerError?: string | null;
  /** An orphaned run is found at launch. */
  orphans?: boolean;
  /** The launch environment cannot find `claude`. */
  claudeMissing?: boolean;
  /** These commands reject, as the core does when a read fails. */
  failing?: string[];
}

/** Route every IPC call to the seeded world plus the stress projects. Call before the first render. */
export function installStressBackend(options: StressOptions = {}) {
  seed();
  mockIPC(
    (cmd, payload) => {
      const args = payload as Args;
      if (options.failing?.includes(cmd)) throw new Error(`database is locked (code 5): ${cmd} could not read the board`);
      const pid = arg(args, "projectId");
      switch (cmd) {
        case "project_list": return options.noProjects ? [] : SEED.PROJECTS;
        case "plugin:dialog|open": return options.pickedFolder ?? null;
        case "project_register":
          if (options.registerError) throw new Error(options.registerError);
          return { id: "p-new", keyPrefix: "NEW", name: "new", repoPath: options.pickedFolder ?? "", defaultBranch: "main", status: "active" };
        case "sessions_pending_orphans": return options.orphans ? ORPHANS : [];
        case "launch_environment":
          return options.claudeMissing
            ? { path: "/usr/bin:/bin:/usr/sbin:/sbin", pathWarning: "PATH is the minimal one macOS gives apps opened from the Dock; your shell's PATH was not read.", claudeError: "`claude` was not found on PATH. Install Claude Code, or set its path in Settings." }
            : m2(cmd, args);
        case "roster_rows": {
          const rows = m2(cmd, args) as { storyId: string; attention: string | null; endingReason: string | null }[];
          return rows.map((r) =>
            WAITING.some((s) => s.id === r.storyId) ? { ...r, attention: "waiting_on_you" } : r.storyId === STOPPED.id ? { ...r, attention: "stopped", endingReason: "usage_limit", liveSessionId: null } : r,
          );
        }
        // Issue #205: the long Story's worktree, so its feed reads paths relative to it.
        case "worktree_summary":
          return arg(args, "storyId") === LONG_STORY.id ? { branch: "story/presales-1014", path: BIG_PATH, status: "ok" } : m2(cmd, args);
        case "story_stopped": return arg(args, "storyId") === STOPPED.id ? { sessionId: "ses-bs", endingReason: "usage_limit", endedAt: ago(5400) } : m2(cmd, args);
        case "board_blocked_summary":
          if (pid === BIG) return { blockedStoryIds: WAITING.map((s) => s.id), waitingEpicIds: [], waitingMilestoneIds: [], roadmapWaiting: false, blockedCount: WAITING.length };
          if (pid !== "p-fly" && pid !== "p-hkw") return { blockedStoryIds: [], waitingEpicIds: [], waitingMilestoneIds: [], roadmapWaiting: false, blockedCount: 0 };
          return m2(cmd, args);
        case "needs_you_list": return pid === BIG ? bigNeedsYou() : m2(cmd, args);
        case "proposal_list_for_triage": return pid === BIG ? bigTriage : m2(cmd, args);
        case "board_visit": return pid === BIG ? BIG_VISIT : m2(cmd, args);
        case "milestone_progress":
          if (pid === "p-fresh") return { milestoneId: "m-f1", title: "Rebuild a laptop from zero in under an hour", exitTest: null, state: "shaping", current: true, nextMilestoneTitle: null, counts: SEED.counts({}), epicsDone: 0, epicsTotal: 0, epics: [] };
          return m2(cmd, args);
        case "story_review": return bigStories.some((s) => s.id === arg(args, "storyId")) ? bigReview(arg(args, "storyId")) : m2(cmd, args);
        case "review_file_patch": {
          const path = arg(args, "path");
          if (!REVIEW_FILES.some((f) => f.path === path)) return m2(cmd, args);
          const lines = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? `+  const cell${i} = sheet.cells.get("D${i + 2}") ?? createInlineStringCell("D${i + 2}", answers.get("D${i + 2}") ?? "", { preserveStyleIndex: true });` : i % 3 === 1 ? `-  workbook.Sheets[name]["D${i + 2}"] = { t: "s", v: answer };` : `   // row ${i + 2}`));
          return { patch: [`diff --git a/${path} b/${path}`, "index 41d07e2..7c1e9fa 100644", `--- a/${path}`, `+++ b/${path}`, "@@ -1,40 +1,40 @@", ...lines, ""].join("\n"), tooLarge: false };
        }
        case "session_raw_window": {
          const offset = Number(args?.offset ?? 0);
          const limit = Number(args?.limit ?? 50);
          return { lines: RAW_LINES.slice(offset, offset + limit).map((line, i) => ({ seq: offset + i, line })), offset, limit, total: RAW_LINES.length };
        }
        case "settings_get":
          return {
            globalCredentialMode: "local",
            projectOverrides: SEED.PROJECTS.map((p, i) => ({ projectId: p.id, projectName: p.name, credentialMode: i === 2 ? "api_key" : null })),
            apiKeyConfigured: true, apiKeyConfiguredAt: ago(86400 * 12), notificationsEnabled: true,
          };
        case "backend_capability_probe": return { available: true, version: "2.1.27 (Claude Code)", apiKeyPathUsable: true };
        case "permission_rules_list": return pid ? RULES.filter((r) => r.projectId === pid) : RULES;
        case "worktree_inventory": return INVENTORY;
        case "open_command_template": return null;
        default: return m2(cmd, args);
      }
    },
    { shouldMockEvents: true },
  );
}

/** Tell the app the board changed, as the core does after a write. */
export function boardChanged(projectId = BIG) {
  return emit("board:changed", { projectId, entity: "story", id: null });
}

export const STRESS = { LONG_STORY, REVIEW_STORY, WAITING, STOPPED, BIG_NAME };
