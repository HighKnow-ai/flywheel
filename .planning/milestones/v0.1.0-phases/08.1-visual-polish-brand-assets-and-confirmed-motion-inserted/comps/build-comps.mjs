// Builds the three 08.1 comps as static HTML from comps/comp-data.json (the exported real board).
//
// Static on purpose: the detector and a plain `grep` can read the markup, the owner can open the file
// with no server, and every epic of the real board is a real `data-epic-row` element in the source.
// Nothing from the JSON reaches the markup unescaped (T-08.1-11): every value goes through esc().
//
// Values the real board does not have today (no running agent, no pending proposal, no commit ahead)
// come from the FIXTURE block below, and every place one is shown is tagged FIXTURE or carries a dagger.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(HERE, "comp-data.json"), "utf8"));
const LOGO = "../../../../packages/desktop/src/assets/logo.svg";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- fixtures: the things the real board does not have today ----------
const FIXTURE = {
  epicKey: "THRE-14",
  proposals: [
    "Should a filter chip persist when the owner switches project, or reset?",
    "Search and the filter bar both own a query. Which one wins when they disagree?",
    "Proposed task: debounce the chip toggles so one click is one query.",
  ],
  agentsRunning: 1,
  blockedOn: { key: "THRE-38", minutes: 130 },
  task: { key: "FIX-1", title: "Cache the chip counts (three commits ahead, tree dirty)", status: "in_progress", ahead: 3, dirty: true },
};

// ---------- derive the board ----------
const STATUS = ["backlog", "todo", "in_progress", "in_review", "done"];
const STATUS_LABEL = { backlog: "Backlog", todo: "Todo", in_progress: "In progress", in_review: "In review", done: "Done" };
const project = data.projects.find((p) => p.status === "active") ?? data.projects[0];
const epics = data.epics.filter((e) => e.project_id === project.id);
const tasks = data.tasks.filter((t) => t.project_id === project.id);
const epicById = new Map(epics.map((e) => [e.id, e]));
const wtByTask = new Map(data.worktrees.map((w) => [w.task_id, w]));
const critByTask = new Map();
for (const c of data.criteria) {
  if (c.parent_type !== "task") continue;
  if (!critByTask.has(c.parent_id)) critByTask.set(c.parent_id, []);
  critByTask.get(c.parent_id).push(c);
}

function bucket(epicId) {
  const list = tasks.filter((t) => (epicId === null ? t.epic_id === null : t.epic_id === epicId));
  const counts = Object.fromEntries(STATUS.map((s) => [s, 0]));
  for (const t of list) counts[t.status] += 1;
  const crit = list.flatMap((t) => critByTask.get(t.id) ?? []);
  let ahead = 0;
  let dirty = false;
  for (const t of list) {
    const w = wtByTask.get(t.id);
    if (w) {
      ahead += w.ahead ?? 0;
      dirty ||= !!w.dirty;
    }
  }
  return { list, counts, total: list.length, crit, ahead, dirty };
}

const rows = [
  ...epics.map((e) => ({ epic: e, ...bucket(e.id) })),
  { epic: null, ...bucket(null) },
];
// the fixture task rolls into its epic
const fixRow = rows.find((r) => r.epic?.key === FIXTURE.epicKey);
if (fixRow) {
  fixRow.ahead += FIXTURE.task.ahead;
  fixRow.dirty ||= FIXTURE.task.dirty;
}

// ---------- small renderers ----------
const D = '<span class="dagger" title="includes fixture values">&#8224;</span>';
const FX = '<span class="fixture-tag">FIXTURE</span>';

const glyph = (status) => {
  const base = 'class="glyph" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"';
  const shapes = {
    backlog: '<circle cx="7" cy="7" r="5.25" stroke-dasharray="2 2"/>',
    todo: '<circle cx="7" cy="7" r="5.25"/>',
    in_progress: '<circle cx="7" cy="7" r="5.25"/><path d="M7 1.75a5.25 5.25 0 0 1 0 10.5z" fill="currentColor" stroke="none"/>',
    in_review: '<circle cx="7" cy="7" r="5.25"/><circle cx="7" cy="7" r="1.75" fill="currentColor" stroke="none"/>',
    done: '<circle cx="7" cy="7" r="6" fill="currentColor" stroke="none"/><path d="M4.4 7.2l1.7 1.7 3.4-3.5" stroke="var(--surface-dominant)"/>',
  };
  const style = status === "done" ? ' style="color:var(--success-text-rack)"' : "";
  return `<svg ${base}${style}><title>${esc(STATUS_LABEL[status])}</title>${shapes[status]}</svg>`;
};

const priority = (p) => {
  const filled = p === 0 ? 0 : 5 - p;
  const bars = [0, 1, 2, 3]
    .map((i) => `<rect x="${1 + i * 3.5}" y="${10 - (i + 1) * 2.4}" width="2.2" height="${(i + 1) * 2.4}" rx="0.6" fill="currentColor" opacity="${i < filled ? 1 : 0.22}"/>`)
    .join("");
  return `<svg class="glyph" width="14" height="12" viewBox="0 0 15 12" aria-hidden="true">${bars}</svg>`;
};

const cueAhead = (n) =>
  `<span class="cue ahead"><svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M5.5 1.5L10 9.5H1z" fill="currentColor"/></svg><span class="tnum">${n}</span></span>`;
const cueDirty = () =>
  `<span class="cue" title="Uncommitted changes"><svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="3.2" fill="currentColor"/></svg></span>`;

const distribution = (counts, total) =>
  `<div class="dist-wrap"><div class="dist" role="img" aria-label="${esc(
    STATUS.map((s) => `${counts[s]} ${STATUS_LABEL[s]}`).join(", "),
  )}">${["done", "in_review", "in_progress", "todo", "backlog"]
    .filter((s) => counts[s] > 0)
    .map((s) => `<i class="s-${s}" style="flex:${counts[s]}"></i>`)
    .join("")}</div><div class="legend tnum">${counts.in_progress} active, ${counts.in_review} in review, ${total - counts.done} open</div></div>`;

const epicRow = (r, { expanded = false } = {}) => {
  const e = r.epic;
  const key = e?.key ?? "No epic";
  const name = e?.title ?? "No epic";
  const pct = r.total ? Math.round((r.counts.done / r.total) * 100) : 0;
  const isFix = e?.key === FIXTURE.epicKey;
  const proposals = isFix ? FIXTURE.proposals.length : 0;
  const agents = isFix ? FIXTURE.agentsRunning : 0;
  const critTotal = r.crit.length;
  const critDone = r.crit.filter((c) => c.checked).length;
  const critText = critTotal ? `${critDone}/${critTotal} criteria checked` : "no criteria yet";
  const sub = e
    ? `${key} · ${STATUS_LABEL[e.status].toLowerCase()}${e.integration_branch ? ` · ${e.integration_branch}` : " · no integration branch yet"}`
    : "tasks not placed in an epic yet";
  const cues = [r.ahead > 0 ? cueAhead(r.ahead) : "", r.dirty ? cueDirty() : ""].join("");
  return `<li class="row" data-row-kind="epic" data-epic-row="${esc(key)}" data-expanded="${expanded}">
  <div class="ep-title"><div class="name">${esc(name)}</div><div class="sub">${esc(sub)}</div></div>
  <div class="progress"><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(name)} progress"><i style="width:${pct}%"></i></div><div class="value tnum">${r.counts.done}/${r.total}</div><div class="crit">${esc(critText)}</div></div>
  ${distribution(r.counts, r.total)}
  <div class="stat ${agents ? "" : "zero"}"><strong class="tnum">${agents}${isFix ? D : ""}</strong>agents</div>
  <div class="stat ${proposals ? "" : "zero"}"><strong class="tnum">${proposals}${isFix ? D : ""}</strong>proposals</div>
  <div class="right">${cues}</div>
</li>`;
};

const challengeRow = (text) =>
  `<li class="row" data-row-kind="challenge" data-fixture="true">
  <svg class="glyph" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="5.25"/><path d="M5.4 5.6a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.2M7 10v.1"/></svg>
  <div class="task-title">${esc(text)}${FX}</div>
  <span class="muted">Agent challenge</span>
  <span class="btn">Answer</span>
</li>`;

const taskRow = (t, { selected = false, fixture = false } = {}) => {
  const w = wtByTask.get(t.id);
  const crit = critByTask.get(t.id) ?? [];
  const ahead = fixture ? FIXTURE.task.ahead : w?.ahead ?? 0;
  const dirty = fixture ? FIXTURE.task.dirty : !!w?.dirty;
  const cues = [ahead > 0 ? cueAhead(ahead) : "", dirty ? cueDirty() : ""].join("");
  return `<li class="row" data-row-kind="task" data-selected="${selected}"${fixture ? ' data-fixture="true"' : ""}>
  ${glyph(t.status)}
  <span class="key tnum">${esc(t.key)}</span>
  <span class="task-title">${esc(t.title)}${fixture ? FX : ""}</span>
  <span class="muted tnum right">${crit.length ? `${crit.filter((c) => c.checked).length}/${crit.length}` : ""}</span>
  <span class="right">${cues}</span>
  ${priority(t.priority)}
</li>`;
};

const bandRow = (status, count) =>
  `<li class="row" data-row-kind="band"><span>${esc(STATUS_LABEL[status])}</span><span class="tnum">${count}</span></li>`;

// active work first inside an expanded epic, so the owner sees what is moving
const ACTIVE_FIRST = ["in_progress", "in_review", "todo", "backlog", "done"];
const orderTasks = (list) =>
  [...list].sort((a, b) => ACTIVE_FIRST.indexOf(a.status) - ACTIVE_FIRST.indexOf(b.status) || (wtByTask.has(b.id) ? 1 : 0) - (wtByTask.has(a.id) ? 1 : 0));

function roster({ expandKey, selectKey, limit = 18, only = null, withFixtureTask = false, withChallenges = false }) {
  const parts = [];
  for (const r of rows) {
    if (only && r.epic && !only.includes(r.epic.key)) continue;
    const key = r.epic?.key ?? "No epic";
    const open = key === expandKey;
    parts.push(epicRow(r, { expanded: open }));
    if (!open) continue;
    if (withChallenges && key === FIXTURE.epicKey) FIXTURE.proposals.forEach((p) => parts.push(challengeRow(p)));
    if (withFixtureTask && key === FIXTURE.epicKey) parts.push(taskRow({ ...FIXTURE.task, id: "fixture", priority: 2 }, { fixture: true }));
    const ordered = orderTasks(r.list);
    ordered.slice(0, limit).forEach((t) => parts.push(taskRow(t, { selected: t.key === selectKey })));
    if (ordered.length > limit)
      parts.push(`<li class="row" data-row-kind="task"><span></span><span></span><span class="task-title muted">${ordered.length - limit} more tasks. The list is virtualized; the rest scroll in.</span></li>`);
  }
  return `<ul class="roster">${parts.join("\n")}</ul>`;
}

// ---------- the computed "what this says" block (D-09): six fixed clauses, no I/O ----------
function says() {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const inReview = tasks.filter((t) => t.status === "in_review");
  const orphanReview = inReview.filter((t) => t.epic_id === null).length;
  const epicNoCrit = rows.filter((r) => r.epic && r.crit.length === 0).length;
  const dirtyWt = data.worktrees.filter((w) => w.dirty);
  const clauses = [
    `${done} of ${total} tasks across ${epics.length} epics are done (${Math.round((done / total) * 100)}%).`,
    `${inReview.length} tasks are in review${orphanReview ? `, and ${orphanReview} of them belong to no epic` : ""}.`,
    `${FIXTURE.proposals.length} agent challenges are waiting on you, all on ${FIXTURE.epicKey}.${D}`,
    `${FIXTURE.agentsRunning} agent has been blocked on ${FIXTURE.blockedOn.key} for ${Math.floor(FIXTURE.blockedOn.minutes / 60)} h ${FIXTURE.blockedOn.minutes % 60} min.${D}`,
    `${dirtyWt.length} of ${data.worktrees.length} worktrees ${dirtyWt.length === 1 ? "has" : "have"} uncommitted changes (${dirtyWt.map((w) => esc(w.task_key)).join(", ")}).`,
    `${epicNoCrit} of ${epics.length} epics have no criteria yet.`,
  ];
  return `<section class="says"><h2>What this says</h2><p>${clauses.join(" ")}</p></section>`;
}

// ---------- shell ----------
const count = (n, dag = false) => `<span class="count tnum">${n}${dag ? D : ""}</span>`;

function rail(current) {
  const item = (label, c, key, dim = false) =>
    `<div class="nav-item${dim ? " dim" : ""}"${current === key ? ' aria-current="page"' : ""}><span>${label}</span>${c ?? ""}</div>`;
  const projects = data.projects
    .map((p) => `<div class="nav-item${p.status === "active" ? "" : " dim"}"${p.status === "active" ? ' aria-current="true"' : ""}><span>${esc(p.name)} <span class="key">${esc(p.key_prefix)}</span></span>${p.status === "active" ? "" : '<span class="count">unreachable</span>'}</div>`)
    .join("");
  const inReview = tasks.filter((t) => t.status === "in_review").length;
  return `<nav class="rail" aria-label="Flywheel">
  <div class="brand"><img src="${LOGO}" alt="" width="24" height="24"><span>Flywheel</span></div>
  <div class="nav-group"><div class="nav-label">Projects</div>${projects}</div>
  <div class="nav-group"><div class="nav-label">Fleet</div>
    ${item("Mission Control", "", "mc")}
    ${item("Agents", count(FIXTURE.agentsRunning, true), "agents")}
    ${item("Worktrees", count(data.worktrees.length), "wt")}
  </div>
  <div class="nav-group"><div class="nav-label">Review queue</div>
    ${item("In review", count(inReview), "review")}
    ${item("Challenges", count(FIXTURE.proposals.length, true), "challenges")}
  </div>
</nav>`;
}

const FOOTNOTE = `<p class="note"><span class="dagger">&#8224;</span> Includes FIXTURE values. The real board today has no running agent, no pending proposal and no commit ahead of its integration branch, so each is stood in for by a labelled fixture and nothing else on the page is invented. Every epic, task, key, title, status, priority and criterion shown is exported from a copy of the real board.</p>`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1440">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="comp.css">
</head>
<body>
${body}
</body>
</html>
`;
}

// ---------- mission-control ----------
function missionControl() {
  const sample = (cls, name, note) =>
    `<div class="alt"><div class="alt-name">${esc(name)}</div><div class="sample ${cls}"><span class="key tnum">THRE-38</span>&nbsp;&nbsp;<span>Wire up the filter chips #21</span></div><div class="alt-name">${esc(note)}</div></div>`;
  const sweep = orderTasks(tasks.filter((t) => t.status === "in_review")).slice(0, 4).map((t) => taskRow(t)).join("\n");
  const body = `<div class="app">
${rail("mc")}
<main class="main">
  <h1 class="title">Mission Control</h1>
  <p class="subtitle">${esc(project.name)} · ${epics.length} epics · ${tasks.length} tasks · ${data.worktrees.length} worktrees active</p>
  ${says()}
  <div class="toolbar">
    <div class="lens" role="group" aria-label="Group by"><span aria-pressed="true">Epic</span><span aria-pressed="false">Status</span></div>
    <div class="field"><span>Search the board</span></div>
    <span class="chip" aria-pressed="false">Has worktree</span>
    <span class="grow"></span>
    <span class="muted">${tasks.length} tasks · ${epics.length} epics</span>
  </div>
  ${roster({ expandKey: FIXTURE.epicKey, selectKey: "THRE-38", withFixtureTask: true, withChallenges: true })}
  <h2 class="section-title">The status lens: the same board, grouped by status</h2>
  <ul class="roster">${bandRow("in_review", tasks.filter((t) => t.status === "in_review").length)}
${sweep}</ul>
  <p class="note">All four row kinds are on this page at their contract heights: epic header 64px, challenge 48px (the three fixture rows under ${esc(FIXTURE.epicKey)}), task 32px, band header 28px. The size function is a lookup on row kind.</p>
  <h2 class="section-title">The selection rule: the detector's finding, and what it would accept</h2>
  <div class="alts">
    ${sample("a-contract", "Contract: 2px left rule", "The contract's treatment. craft-floor.md bans a left border above 1px on list items.")}
    ${sample("a-one", "A: 1px left rule", "Passes the ban. Quieter.")}
    ${sample("a-inset", "B: inset bar, drawn as a pseudo-element", "Not a border. Same weight as the contract.")}
    ${sample("a-bg", "C: background shift only", "No rule at all. Relies on the shift alone.")}
  </div>
  ${FOOTNOTE}
</main>
</div>`;
  return page("Mission Control comp", body);
}

// ---------- item detail ----------
const REL = {
  "task.created": "created",
  "task.status_changed": "changed status",
  "worktree.created": "opened a worktree",
  "agent_run.started": "started a run",
  "agent_run.closed": "run ended",
  "permission_request.raised": "asked for permission",
  "permission_request.answered": "answered a permission request",
  "criterion.created": "added a criterion",
  "task.outside_commit_detected": "commit detected outside Flywheel",
  "task.integrated": "integrated into the epic branch",
};
const when = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
};

function trailFor(taskKey, max = 14) {
  const ev = data.activity.filter((a) => a.task_key === taskKey);
  const out = [];
  for (const e of ev) {
    const last = out[out.length - 1];
    if (last && last.event_type === e.event_type) last.n += 1;
    else out.push({ ...e, n: 1 });
  }
  return out.slice(0, max)
    .map((e) => `<li><span>${esc(REL[e.event_type] ?? e.event_type)}${e.n > 1 ? ` <span class="muted tnum">×${e.n}</span>` : ""}</span><span class="who tnum">${esc(e.actor)} · ${esc(when(e.occurred_at))}</span></li>`)
    .join("\n");
}

function itemDetail() {
  const t = tasks.find((x) => x.key === "THRE-58");
  const epic = epicById.get(t.epic_id);
  const w = wtByTask.get(t.id);
  const crit = critByTask.get(t.id) ?? [];
  const body = `<div class="app with-panel">
${rail("mc")}
<main class="main tight">
  <h1 class="title" style="font-size:20px">${esc(epic.title)}</h1>
  <p class="subtitle">${esc(epic.key)} · ${esc(STATUS_LABEL[epic.status].toLowerCase())}</p>
  ${roster({ expandKey: epic.key, selectKey: "THRE-58", only: [epic.key, "THRE-9", "THRE-14"], limit: 14 })}
</main>
<aside class="panel" aria-label="Item detail">
  <div>
    <div class="head-meta"><span class="key tnum">${esc(t.key)}</span><span class="muted">${esc(epic.key)}</span></div>
    <h2>${esc(t.title)}</h2>
  </div>
  <dl class="props">
    <dt>Status</dt><dd>${glyph(t.status)} ${esc(STATUS_LABEL[t.status])}</dd>
    <dt>Priority</dt><dd>${priority(t.priority)} ${["No priority", "Urgent", "High", "Medium", "Low"][t.priority]}</dd>
    <dt>Estimate</dt><dd class="tnum">${t.estimate ?? "None"}</dd>
    <dt>Worktree</dt><dd><span class="tnum">${esc(w.branch)}</span></dd>
    <dt>Changes</dt><dd><span class="tnum">${w.ahead ?? 0} commits ahead</span> ${w.dirty ? `${cueDirty()} uncommitted changes` : ""}</dd>
  </dl>
  <div>
    <h3 class="block-title">Acceptance criteria <span class="muted tnum">${crit.filter((c) => c.checked).length}/${crit.length}</span></h3>
    <ul class="crit-list">${crit.map((c) => `<li><span class="box${c.checked ? " on" : ""}"></span><span>${esc(c.statement)}</span></li>`).join("\n")}</ul>
  </div>
  <div>
    <h3 class="block-title">Activity</h3>
    <ul class="trail">${trailFor(t.key)}</ul>
  </div>
</aside>
</div>`;
  return page("Item detail comp", body);
}

// ---------- review ----------
function parseDiff(patch) {
  const out = [];
  let a = 0;
  let b = 0;
  for (const raw of patch.split("\n")) {
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file)/.test(raw)) continue;
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw);
    if (m) {
      a = +m[1];
      b = +m[2];
      out.push({ k: "hunk", t: raw });
    } else if (raw.startsWith("+")) out.push({ k: "add", a: "", b: b++, t: raw.slice(1) });
    else if (raw.startsWith("-")) out.push({ k: "del", a: a++, b: "", t: raw.slice(1) });
    else if (out.length) out.push({ k: "ctx", a: a++, b: b++, t: raw.slice(1) });
  }
  return out;
}

function review() {
  const t = tasks.find((x) => x.key === "THRE-58");
  const crit = critByTask.get(t.id) ?? [];
  const fx = data.diffs.fixture;
  const lines = parseDiff(fx.patch);
  const adds = lines.map((l, i) => (l.k === "add" ? i : -1)).filter((i) => i >= 0);
  const selStart = adds[Math.floor(adds.length / 2)];
  const sel = new Set([selStart, selStart + 1, selStart + 2]);
  const sign = { add: "+", del: "-", ctx: " ", hunk: "" };
  const diffHtml = lines
    .map((l, i) => `<div class="ln ${l.k}${sel.has(i) && l.k === "add" ? " sel" : ""}"><span class="tnum">${esc(l.a)}</span><span class="tnum">${esc(l.b)}</span><span>${sign[l.k]}</span><span>${esc(l.t)}</span></div>`)
    .join("\n");
  const stat = (p) => {
    const ls = parseDiff(p);
    return `+${ls.filter((l) => l.k === "add").length} −${ls.filter((l) => l.k === "del").length}`;
  };
  const real = data.diffs.real.find((d) => d.task_key === "THRE-58");
  const body = `<div class="review">
<aside class="files" aria-label="Changed files">
  <div class="brand" style="padding-bottom:var(--space-md)"><img src="${LOGO}" alt="" width="24" height="24"><span>Flywheel</span></div>
  <div class="nav-label">THRE-58 · review</div>
  <div class="file"><span>README.md</span><span class="muted tnum">${real ? esc(stat(real.patch)) : ""}</span></div>
  <div class="file" aria-current="true"><span>CriteriaRail.tsx${FX}</span><span class="muted tnum">${esc(stat(fx.patch))}</span></div>
</aside>
<main class="diff-pane">
  <div class="diff-head"><div><h1 class="title" style="font-size:20px">${esc(t.title)}</h1><p class="subtitle">${esc(t.key)} · ${esc(fx.path)}</p></div><span class="muted tnum">${esc(fx.ref)}</span></div>
  <p class="note" style="margin:0 0 var(--space-sm)">FIXTURE diff. THRE-58 has 0 commits ahead of its integration branch today and one uncommitted README change, so commit ${esc(fx.ref)} from this repository stands in for a task with something to review.</p>
  <div class="diff">${diffHtml}</div>
</main>
<aside class="rail-criteria" aria-label="Acceptance criteria">
  <h2 class="block-title">Acceptance criteria <span class="muted tnum">${crit.filter((c) => c.checked).length}/${crit.length}</span></h2>
  <ul class="crit-list">${crit
    .map((c) => `<li><span class="box${c.checked ? " on" : ""}"></span><span>${esc(c.statement)}</span><span class="evidence">${c.checked ? "Evidence attached" : "No evidence yet. Select diff lines, then check this."}</span></li>`)
    .join("\n")}</ul>
  <div class="action-row"><span class="btn">Request changes</span><span class="btn primary">Merge into epic</span></div>
</aside>
</div>`;
  return page("Review comp", body);
}

export function buildAll() {
  const out = {
    "mission-control.html": missionControl(),
    "item-detail.html": itemDetail(),
    "review.html": review(),
  };
  for (const [name, html] of Object.entries(out)) writeFileSync(join(HERE, name), html);
  return Object.keys(out);
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(buildAll().join("\n"));
