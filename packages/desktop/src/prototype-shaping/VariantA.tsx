/**
 * PROTOTYPE — throwaway. Variant A, "Grilling rounds": the session is a thread of agent rounds.
 * Each round asks numbered questions with a recommended answer; the Proposals a round produces
 * land inline right after it. The Epic as it stands on the board sits on the right.
 */
import { useState } from "react";
import { EPIC, PROPOSALS, QUESTIONS, ROUNDS, STAGES, type Proposal, type Question } from "./script";
import { isYes, kindWord, useShaping } from "./useShaping";
import "./VariantA.css";

/** The round whose answers produce a proposal: its feeders' latest round, else its stage's first. */
function roundOf(p: Proposal) {
  const feeders = QUESTIONS.filter((q) => q.feeds?.includes(p.id));
  if (feeders.length && p.kind !== "criterion") return Math.max(...feeders.map((q) => q.round));
  return ROUNDS.find((r) => r.stage === p.stage)!.n;
}

export function VariantA() {
  const s = useShaping();
  return (
    <div className="va-root">
      <StageRail />
      <main className="va-thread">
        <header className="va-thread-head">
          <div className="type-label va-muted">{EPIC.key} · Shaping session {s.session}</div>
          <div className="type-heading">{EPIC.title}</div>
          <div className="type-body va-muted">{EPIC.seed}</div>
        </header>
        <div className="va-scroll">
          {ROUNDS.filter((r) => s.posted.includes(r.n)).map((r) => (
            <RoundBlock key={r.n} n={r.n} />
          ))}
          {s.resumedNote && (
            <div className="va-agent">
              <div className="type-label va-who">Agent · session {s.session}</div>
              <div className="type-body">{s.resumedNote}</div>
            </div>
          )}
          {s.sessionDead && (
            <div className="va-dead type-body">
              <strong>Session {s.session} ended: the model refused the turn.</strong> Everything you answered or accepted is
              already on the board. Start a new session from the bar below; it rebuilds from the board.
            </div>
          )}
          {s.agentBusy && <div className="va-busy type-body">Agent is thinking…</div>}
          {s.stage === "done" && <DoneCard />}
        </div>
        <Footer />
      </main>
      <EpicPanel />
    </div>
  );
}

function StageRail() {
  const s = useShaping();
  const order = ["spec", "slice", "criteria", "done"];
  return (
    <nav className="va-rail">
      <div className="type-label va-muted va-rail-title">Stages</div>
      {STAGES.map((st, i) => {
        const pos = order.indexOf(s.stage) - i;
        const state = pos > 0 ? "done" : pos === 0 ? "current" : "next";
        return (
          <div key={st.id} className={`va-step va-step-${state}`}>
            <div className="type-body va-step-name">
              <span className="va-step-mark">{state === "done" ? "✓" : i + 1}</span> {st.label}
            </div>
            <div className="type-label va-muted">Done when: {st.doneWhen}</div>
            {state === "current" && s.blockers.length > 0 && (
              <ul className="type-label va-blockers">
                {s.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {state === "current" && s.blockers.length === 0 && (
              <div className="type-label va-ready">Ready to close</div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function RoundBlock({ n }: { n: number }) {
  const s = useShaping();
  const round = ROUNDS.find((r) => r.n === n)!;
  const qs = QUESTIONS.filter((q) => q.round === n);
  const open = qs.filter((q) => !s.answers[q.id]);
  const props = s.visibleProposals.filter((p) => roundOf(p) === n);
  const live = !s.sessionDead && !s.agentBusy;
  return (
    <section className="va-round">
      <div className="va-agent">
        <div className="type-label va-who">
          Agent · round {n} · {STAGES.find((x) => x.id === round.stage)!.label}
        </div>
        <div className="type-body">{round.agentSays}</div>
      </div>
      {qs.map((q, i) => (
        <QuestionCard key={q.id} q={q} n={i + 1} disabled={!live} />
      ))}
      {open.length > 1 && live && (
        <button className="va-btn va-btn-quiet" onClick={() => open.forEach((q) => s.answer(q, { kind: "recommended", text: q.recommended }))}>
          Accept all {open.length} recommended
        </button>
      )}
      {props.length > 0 && (
        <div className="va-props">
          <div className="type-label va-muted">Proposals from this round ({props.filter((p) => !s.proposals[p.id].decision).length} to decide)</div>
          {props.map((p) => (
            <ProposalCard key={p.id} p={p} disabled={s.sessionDead} />
          ))}
          {props.some((p) => !s.proposals[p.id].decision) && !s.sessionDead && (
            <button
              className="va-btn va-btn-quiet"
              onClick={() => props.filter((p) => !s.proposals[p.id].decision).forEach((p) => s.decide(p.id, "accepted"))}
            >
              Accept all remaining
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function QuestionCard({ q, n, disabled }: { q: Question; n: number; disabled: boolean }) {
  const s = useShaping();
  const a = s.answers[q.id];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(q.recommended);
  if (a)
    return (
      <div className="va-q va-q-answered type-body">
        <span className="va-qn">{n}</span>
        <span className="va-muted">{q.prompt}</span> <span className="va-arrow">→</span>{" "}
        <span>{a.text}</span>
        {a.kind === "own" && <span className="type-label va-tag">your answer</span>}
      </div>
    );
  return (
    <div className="va-q">
      <div className="type-body va-q-prompt">
        <span className="va-qn">{n}</span> {q.prompt}
      </div>
      {q.grounding && <div className="va-mono">{q.grounding}</div>}
      {editing ? (
        <textarea className="va-text type-body" value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
      ) : (
        <div className="va-rec">
          <div className="type-label va-rec-label">Recommended</div>
          <div className="type-body">{q.recommended}</div>
          <div className="type-label va-muted">Because: {q.because}</div>
        </div>
      )}
      <div className="va-actions">
        {editing ? (
          <>
            <button className="va-btn va-btn-primary" disabled={disabled || !text.trim()} onClick={() => s.answer(q, { kind: text === q.recommended ? "recommended" : "own", text })}>
              Send answer
            </button>
            <button className="va-btn" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="va-btn va-btn-primary" disabled={disabled} onClick={() => s.answer(q, { kind: "recommended", text: q.recommended })}>
              Accept
            </button>
            <button className="va-btn" disabled={disabled} onClick={() => setEditing(true)}>Answer differently</button>
          </>
        )}
      </div>
    </div>
  );
}

function ProposalCard({ p, disabled }: { p: Proposal; disabled: boolean }) {
  const s = useShaping();
  const st = s.proposals[p.id];
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(st.title);
  const [body, setBody] = useState(st.body);
  const parent = p.kind === "criterion" ? s.proposals[p.target]?.title : undefined;
  return (
    <div className={`va-prop va-prop-${st.decision ?? "pending"}`}>
      <div className="type-label va-muted">
        {kindWord(p)}
        {parent && <> · for “{parent}”</>}
        {st.decision && <span className={`va-decision va-decision-${st.decision}`}> · {st.decision}</span>}
      </div>
      {editing ? (
        <>
          <input className="va-text type-body" value={title} onChange={(e) => setTitle(e.target.value)} />
          {p.kind !== "criterion" && <textarea className="va-text type-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />}
        </>
      ) : (
        <>
          <div className="type-body va-prop-title">{st.title}</div>
          {st.body && p.kind !== "spec" && <div className="type-body va-muted">{st.body}</div>}
          {p.kind === "spec" && <div className="type-body">{st.body}</div>}
        </>
      )}
      {p.bar && (
        <ul className="type-label va-bar">
          <li><strong>Hard to reverse:</strong> {p.bar.hardToReverse}</li>
          <li><strong>Surprising:</strong> {p.bar.surprising}</li>
          <li><strong>Alternative that lost:</strong> {p.bar.alternativeThatLost}</li>
        </ul>
      )}
      {p.kind === "criterion" && (st.check ? <span className="va-chip">Check: {st.check}</span> : <span className="type-label va-muted">Judged at review</span>)}
      {!st.decision && (
        <div className="va-actions">
          {editing ? (
            <>
              <button className="va-btn va-btn-primary" disabled={disabled} onClick={() => s.decide(p.id, "amended", { title, body })}>Save amended</button>
              <button className="va-btn" onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="va-btn va-btn-primary" disabled={disabled} onClick={() => s.decide(p.id, "accepted")}>Accept</button>
              <button className="va-btn" disabled={disabled} onClick={() => setEditing(true)}>Amend</button>
              <button className="va-btn" disabled={disabled} onClick={() => s.decide(p.id, "rejected")}>Reject</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Footer() {
  const s = useShaping();
  if (s.stage === "done") return null;
  const label = STAGES.find((x) => x.id === s.stage)!.label;
  return (
    <footer className="va-footer">
      <div className="va-footer-state type-body">
        {s.sessionDead ? (
          <span className="va-muted">Session ended</span>
        ) : s.agentBusy ? (
          <span className="va-running">● Agent is thinking…</span>
        ) : s.waitingOnYou ? (
          <span className="va-waiting">● Waiting on you</span>
        ) : null}
        {s.blockers.length > 0 && <span className="type-label va-muted"> · {s.blockers.join(" · ")}</span>}
      </div>
      <button className="va-btn va-btn-primary" disabled={!s.canCloseStage || s.sessionDead} onClick={s.closeStage}>
        Close stage: {label}
      </button>
    </footer>
  );
}

function EpicPanel() {
  const s = useShaping();
  const yes = (id: string) => isYes(s.proposals[id].decision);
  const spec = PROPOSALS.filter((p) => p.kind === "spec" && yes(p.id));
  const extras = PROPOSALS.filter((p) => (p.kind === "adr" || p.kind === "glossary") && yes(p.id));
  const stories = PROPOSALS.filter((p) => p.kind === "story" && yes(p.id));
  return (
    <aside className="va-epic">
      <div className="type-label va-muted">On the board</div>
      <div className="type-label va-muted">{EPIC.milestone}</div>
      <div className="type-heading">
        {EPIC.key} {EPIC.title}
      </div>
      {spec.length === 0 && <div className="type-label va-muted va-empty">No spec sections accepted yet.</div>}
      {spec.map((p) => (
        <div key={p.id} className="va-epic-sec">
          <div className="type-label va-sec-h">{p.target}</div>
          <div className="type-body">{s.proposals[p.id].body}</div>
        </div>
      ))}
      {extras.length > 0 && (
        <div className="va-epic-sec">
          <div className="type-label va-sec-h">Decisions (written by the first Story)</div>
          {extras.map((p) => (
            <div key={p.id} className="type-body">· {s.proposals[p.id].title}</div>
          ))}
        </div>
      )}
      <div className="va-epic-sec">
        <div className="type-label va-sec-h">Stories ({stories.length})</div>
        {stories.length === 0 && <div className="type-label va-muted">None yet.</div>}
        {stories.map((st, i) => {
          const crit = PROPOSALS.filter((c) => c.kind === "criterion" && c.target === st.id && yes(c.id));
          return (
            <div key={st.id} className="va-story">
              <div className="type-body">
                <span className="va-muted tabular-nums">{i + 1}.</span> {s.proposals[st.id].title}
              </div>
              {crit.map((c) => (
                <div key={c.id} className="type-label va-crit">
                  ☐ {s.proposals[c.id].title}
                  {s.proposals[c.id].check ? <span className="va-chip">{s.proposals[c.id].check}</span> : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function DoneCard() {
  const s = useShaping();
  const yes = (id: string) => isYes(s.proposals[id].decision);
  const stories = PROPOSALS.filter((p) => p.kind === "story" && yes(p.id)).length;
  const crit = PROPOSALS.filter((p) => p.kind === "criterion" && yes(p.id));
  const checks = crit.filter((c) => s.proposals[c.id].check).length;
  return (
    <div className="va-done">
      <div className="type-heading">Shaping done</div>
      <div className="type-body">
        {Object.keys(s.answers).length} questions answered · {stories} Stories · {crit.length} criteria ({checks} with a Check) ·{" "}
        {PROPOSALS.filter((p) => (p.kind === "adr" || p.kind === "glossary") && yes(p.id)).length} ADR / glossary Proposals
      </div>
      <button className="va-btn va-btn-primary">Ready to plan the Stories</button>
    </div>
  );
}
