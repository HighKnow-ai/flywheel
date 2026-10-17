/**
 * PROTOTYPE — throwaway (HighKnow-ai/flywheel#11). Variant C: "Story map on the board".
 * Shaping happens on the board structure itself: the Epic card on top, Stories as columns below it
 * in execution order, criteria stacked inside each. Proposals are ghost cards until decided. The
 * agent's questions live in a bottom dock, one card at a time — not a chat.
 */
import React, { useEffect, useState } from "react";
import "./VariantC.css";
import { EPIC, PROPOSALS, ROUNDS, STAGES, type Proposal } from "./script";
import { isYes, useShaping } from "./useShaping";

function Actions({ p, editField }: { p: Proposal; editField: "title" | "body" }) {
  const s = useShaping();
  const st = s.proposals[p.id];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editField === "title" ? st.title : st.body);
  if (s.stage === "done" && !st.decision) return null;
  if (st.decision)
    return <span className={`vc-decision vc-decision-${st.decision}`}>{st.decision}</span>;
  if (editing)
    return (
      <div className="vc-amend">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={editField === "title" ? 2 : 4} />
        <div className="vc-row">
          <button
            className="vc-btn vc-primary"
            onClick={() => {
              s.decide(p.id, "amended", editField === "title" ? { title: draft } : { body: draft });
              setEditing(false);
            }}
          >
            Save amended
          </button>
          <button className="vc-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  return (
    <div className="vc-row vc-actions">
      <button className="vc-btn vc-primary" onClick={() => s.decide(p.id, "accepted")} disabled={s.sessionDead}>
        Accept
      </button>
      <button className="vc-btn" onClick={() => setEditing(true)} disabled={s.sessionDead}>
        Amend
      </button>
      <button className="vc-btn" onClick={() => s.decide(p.id, "rejected")} disabled={s.sessionDead}>
        Reject
      </button>
    </div>
  );
}

function ghostClass(decision?: string) {
  if (!decision) return "vc-ghost";
  if (decision === "rejected") return "vc-rejected";
  return "vc-solid";
}

function SpecField({ target }: { target: string }) {
  const s = useShaping();
  const p = PROPOSALS.find((x) => x.kind === "spec" && x.target === target)!;
  const visible = s.visibleProposals.some((x) => x.id === p.id);
  const st = s.proposals[p.id];
  return (
    <div className={`vc-field ${visible ? ghostClass(st.decision) : "vc-empty"}`}>
      <div className="type-label vc-field-label">
        {target}
        {visible && !st.decision && <span className="vc-tag">Proposal</span>}
      </div>
      {visible ? (
        <>
          <div className="type-body">{st.body}</div>
          <Actions p={p} editField="body" />
        </>
      ) : (
        <div className="type-label vc-muted">Not drafted yet. The agent writes this from your answers.</div>
      )}
    </div>
  );
}

function Chip({ p }: { p: Proposal }) {
  const s = useShaping();
  const st = s.proposals[p.id];
  const [open, setOpen] = useState(!st.decision);
  return (
    <div className={`vc-chip ${ghostClass(st.decision)}`}>
      <button className="vc-chip-head" onClick={() => setOpen((o) => !o)}>
        <span className="vc-tag">{p.kind === "adr" ? "ADR" : "Glossary"}</span> {st.title.replace(/^(ADR|Glossary): /, "")}
        {st.decision && <span className={`vc-decision vc-decision-${st.decision}`}>{st.decision}</span>}
        <span className="vc-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="vc-chip-body">
          <div className="type-body">{st.body}</div>
          {p.bar && (
            <ul className="type-label vc-bar">
              <li>
                <b>Hard to reverse:</b> {p.bar.hardToReverse}
              </li>
              <li>
                <b>Surprising:</b> {p.bar.surprising}
              </li>
              <li>
                <b>Alternative that lost:</b> {p.bar.alternativeThatLost}
              </li>
            </ul>
          )}
          <div className="type-label vc-muted vc-mono">→ {p.target}, written by the Epic's first Story</div>
          <Actions p={p} editField="body" />
        </div>
      )}
    </div>
  );
}

function EpicCard() {
  const s = useShaping();
  const chips = s.visibleProposals.filter((p) => p.kind === "adr" || p.kind === "glossary");
  return (
    <section className="vc-epic">
      <div className="vc-epic-head">
        <span className="vc-key type-condensed tabular-nums">{EPIC.key}</span>
        <span className="type-label vc-muted">Epic · {EPIC.milestone}</span>
      </div>
      <h1 className="type-heading vc-epic-title">{EPIC.title}</h1>
      <div className="type-label vc-muted vc-seed">Seed: {EPIC.seed}</div>
      <div className="vc-fields">
        <SpecField target="Problem" />
        <SpecField target="Scope" />
        <SpecField target="Out of scope" />
      </div>
      {chips.length > 0 && (
        <div className="vc-chips">
          {chips.map((p) => (
            <Chip key={p.id} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function CriterionCard({ p }: { p: Proposal }) {
  const s = useShaping();
  const st = s.proposals[p.id];
  return (
    <div className={`vc-crit ${ghostClass(st.decision)}`}>
      <div className="type-body">{st.title}</div>
      <div className="vc-row">
        {st.check ? <span className="vc-check">{st.check}</span> : <span className="type-label vc-muted">judged at review</span>}
      </div>
      <Actions p={p} editField="title" />
    </div>
  );
}

function StoryColumn({ p, order }: { p: Proposal; order: number }) {
  const s = useShaping();
  const st = s.proposals[p.id];
  const crits = s.visibleProposals.filter((c) => c.kind === "criterion" && c.target === p.id);
  if (st.decision === "rejected")
    return (
      <div className="vc-col vc-col-rejected">
        <div className="vc-connector" />
        <div className="vc-story vc-rejected">
          <div className="type-label vc-muted">Rejected</div>
          <div className="type-body">{st.title}</div>
        </div>
      </div>
    );
  return (
    <div className="vc-col">
      <div className="vc-connector" />
      <div className={`vc-story ${ghostClass(st.decision)}`}>
        <div className="vc-row vc-story-head">
          <span className="vc-order tabular-nums">{order}</span>
          <span className="type-label vc-muted">Story{!st.decision && <span className="vc-tag">Proposal</span>}</span>
        </div>
        <div className="type-body vc-story-title">{st.title}</div>
        <div className="type-label vc-muted">{st.body}</div>
        <Actions p={p} editField="title" />
      </div>
      {isYes(st.decision) && (
        <div className="vc-crits">
          {crits.length === 0 ? (
            <div className="type-label vc-muted vc-crit-empty">
              {s.stage === "slice" ? "Criteria are drafted once the slicing stage closes." : "No criteria yet."}
            </div>
          ) : (
            crits.map((c) => <CriterionCard key={c.id} p={c} />)
          )}
        </div>
      )}
    </div>
  );
}

function StoryMap() {
  const s = useShaping();
  const stories = s.visibleProposals.filter((p) => p.kind === "story");
  if (stories.length === 0)
    return (
      <section className="vc-map vc-map-empty">
        <div className="vc-trunk" />
        <div className="type-label vc-muted">Stories appear here, attached to the Epic, once the spec stage closes.</div>
      </section>
    );
  const live = stories.filter((p) => s.proposals[p.id].decision !== "rejected").map((p) => p.id);
  let n = 0;
  return (
    <section className="vc-map">
      <div className="vc-trunk" />
      <div className="vc-cols">
        {stories.map((p, i) => {
          const rejected = s.proposals[p.id].decision === "rejected";
          const order = rejected ? 0 : ++n;
          const next = stories[i + 1];
          const showLink = p.id === "s1" && next?.id === "s2" && live.includes("s1") && live.includes("s2");
          return (
            <React.Fragment key={p.id}>
              <StoryColumn p={p} order={order} />
              {showLink && (
                <div className="vc-dep" title="Both rewrite FeedRow.tsx:380–560, so they can't run in parallel">
                  <div className="vc-dep-line" />
                  <div className="vc-dep-badge type-label">
                    shares <span className="vc-mono">FeedRow.tsx</span>
                    <br />→ runs after
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

function StageTrack() {
  const s = useShaping();
  const idx = s.stage === "done" ? STAGES.length : STAGES.findIndex((x) => x.id === s.stage);
  const cur = STAGES[idx];
  return (
    <div className="vc-track">
      <div className="vc-steps">
        {STAGES.map((st, i) => (
          <div key={st.id} className={`vc-step ${i < idx ? "vc-step-done" : i === idx ? "vc-step-cur" : ""}`}>
            <span className="vc-step-dot">{i < idx ? "✓" : i + 1}</span>
            <span className="type-label">{st.label}</span>
          </div>
        ))}
      </div>
      {cur && (
        <div className="vc-close">
          <button className="vc-btn vc-primary" disabled={!s.canCloseStage || s.sessionDead} onClick={s.closeStage}>
            Close stage
          </button>
          <span className="type-label vc-muted">
            {s.agentBusy ? "Agent is still working" : s.blockers.length ? `Still open: ${s.blockers.join(" · ")}` : `Done when: ${cur.doneWhen}`}
          </span>
        </div>
      )}
    </div>
  );
}

function Dock() {
  const s = useShaping();
  const open = s.openQuestions;
  const [i, setI] = useState(0);
  const [own, setOwn] = useState<string | null>(null);
  useEffect(() => {
    if (i >= open.length) setI(Math.max(0, open.length - 1));
  }, [open.length, i]);
  useEffect(() => setOwn(null), [i, open.length]);
  const latest = [...ROUNDS].reverse().find((r) => s.posted.includes(r.n));

  if (s.stage === "done") {
    const stories = PROPOSALS.filter((p) => p.kind === "story" && isYes(s.proposals[p.id].decision));
    const crits = PROPOSALS.filter(
      (p) => p.kind === "criterion" && isYes(s.proposals[p.id].decision) && s.acceptedStories.has(p.target),
    );
    return (
      <div className="vc-dock vc-dock-done">
        <span className="type-heading">
          Ready to plan: {stories.length} Stories, {crits.length} criteria
        </span>
        <span className="type-label vc-muted">Every Story is attached to {EPIC.key} and carries its criteria.</span>
      </div>
    );
  }

  const q = open[Math.min(i, open.length - 1)];
  return (
    <div className={`vc-dock ${s.sessionDead ? "vc-dock-dead" : ""}`}>
      <div className="vc-dock-left">
        <div className="vc-row">
          <span className="type-label vc-muted">Agent · session {s.session}</span>
          {s.agentBusy && <span className="vc-pill vc-pill-running">Agent is thinking…</span>}
          {s.waitingOnYou && <span className="vc-pill vc-pill-you">Waiting on you</span>}
        </div>
        {s.sessionDead ? (
          <div className="type-body">Session ended. The board kept everything.</div>
        ) : (
          <>
            {s.resumedNote && <div className="type-label vc-resumed">{s.resumedNote}</div>}
            {latest && <div className="type-body vc-says">{latest.agentSays}</div>}
          </>
        )}
      </div>
      <div className="vc-dock-right">
        {s.sessionDead ? (
          <div className="type-label vc-muted">Start a new session to continue; it is rebuilt from the board above.</div>
        ) : !q ? (
          <div className="type-label vc-muted">
            {s.agentBusy ? "The agent is preparing its next round." : "No open questions. Decide the ghost cards above, then close the stage."}
          </div>
        ) : (
          <div className="vc-q">
            <div className="vc-row vc-q-head">
              <span className="type-label">
                Q{q.id.slice(1)} · <span className="tabular-nums">{Math.min(i, open.length - 1) + 1} of {open.length} open</span>
              </span>
              <span className="vc-row">
                <button className="vc-btn" disabled={i <= 0} onClick={() => setI(i - 1)}>
                  ‹
                </button>
                <button className="vc-btn" disabled={i >= open.length - 1} onClick={() => setI(i + 1)}>
                  ›
                </button>
              </span>
            </div>
            <div className="type-heading vc-q-prompt">{q.prompt}</div>
            {q.grounding && <div className="type-label vc-mono vc-muted">{q.grounding}</div>}
            <div className="vc-rec">
              <span className="type-label vc-muted">Recommended</span>
              <div className="type-body">{q.recommended}</div>
              <div className="type-label vc-muted">{q.because}</div>
            </div>
            {own === null ? (
              <div className="vc-row">
                <button className="vc-btn vc-primary" onClick={() => s.answer(q, { kind: "recommended", text: q.recommended })}>
                  Accept
                </button>
                <button className="vc-btn" onClick={() => setOwn("")}>
                  Answer differently
                </button>
              </div>
            ) : (
              <div className="vc-amend">
                <textarea autoFocus rows={2} value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Your answer" />
                <div className="vc-row">
                  <button
                    className="vc-btn vc-primary"
                    disabled={!own.trim()}
                    onClick={() => s.answer(q, { kind: "own", text: own.trim() })}
                  >
                    Send answer
                  </button>
                  <button className="vc-btn" onClick={() => setOwn(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function VariantC() {
  return (
    <div className="vc">
      <header className="vc-top">
        <div className="type-label vc-muted">Flywheel · Board · Shaping {EPIC.key}</div>
        <StageTrack />
      </header>
      <main className="vc-main">
        <EpicCard />
        <StoryMap />
      </main>
      <Dock />
    </div>
  );
}
