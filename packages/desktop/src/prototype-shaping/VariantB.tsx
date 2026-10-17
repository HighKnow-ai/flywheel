/**
 * PROTOTYPE — throwaway. Variant B: the Epic spec IS the screen. No chat thread: the agent's
 * questions are margin comments anchored to the section they feed, and its Proposals are
 * tracked-change suggestions inside the document. The document is the board record, so a dead
 * session leaves it intact.
 */
import React, { useState } from "react";
import { EPIC, PROPOSALS, QUESTIONS, ROUNDS, STAGES, type Proposal, type Question } from "./script";
import { isYes, useShaping } from "./useShaping";
import "./VariantB.css";

type SectionId = "problem" | "scope" | "out" | "decisions" | "stories-intro" | `story:${string}`;

/** Where a question's margin comment sits: the section its first fed proposal lives in. */
function anchorOf(q: Question): SectionId {
  if (q.stage === "slice") return "stories-intro";
  const f = q.feeds?.[0];
  if (!f) return "problem";
  const p = PROPOSALS.find((x) => x.id === f)!;
  if (p.kind === "criterion") return `story:${p.target}`;
  if (p.kind === "adr" || p.kind === "glossary") return "decisions";
  return ({ "p-problem": "problem", "p-scope": "scope", "p-out": "out" } as Record<string, SectionId>)[p.id];
}

const qNum = (q: Question) => `Q${q.id.slice(1)}`;
const feedersOf = (pid: string) => QUESTIONS.filter((q) => q.feeds?.includes(pid));

function Inline({ text }: { text: string }) {
  // Just enough markdown for the glossary line: **bold** and _italic_.
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : p,
      )}
    </>
  );
}

function Suggestion({ p, children, editField }: { p: Proposal; children: React.ReactNode; editField: "body" | "title" }) {
  const s = useShaping();
  const st = s.proposals[p.id];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editField === "body" ? st.body : st.title);
  const done = s.stage === "done";

  if (st.decision === "rejected") {
    return done ? null : (
      <div className="vb-rejected type-label">
        Rejected: <s>{st.title}</s>
      </div>
    );
  }
  if (st.decision) {
    return (
      <div className="vb-accepted">
        {children}
        {st.decision === "amended" && !done && <span className="vb-tag type-label">amended by you</span>}
      </div>
    );
  }
  return (
    <div className="vb-suggestion">
      <div className="vb-suggestion-label type-label">Suggested by the agent</div>
      {editing ? (
        <textarea className="vb-textarea type-body" value={draft} onChange={(e) => setDraft(e.target.value)} rows={editField === "body" ? 4 : 2} autoFocus />
      ) : (
        children
      )}
      <div className="vb-actions">
        {editing ? (
          <>
            <button className="vb-btn vb-primary" onClick={() => s.decide(p.id, "amended", editField === "body" ? { body: draft } : { title: draft })}>
              Save amendment
            </button>
            <button className="vb-btn" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="vb-btn vb-primary" onClick={() => s.decide(p.id, "accepted")}>Accept</button>
            <button className="vb-btn" onClick={() => setEditing(true)}>Amend</button>
            <button className="vb-btn" onClick={() => s.decide(p.id, "rejected")}>Reject</button>
          </>
        )}
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <p className="vb-placeholder type-body">{text}</p>;
}

function SpecSection({ pid, heading }: { pid: string; heading: string }) {
  const s = useShaping();
  const p = PROPOSALS.find((x) => x.id === pid)!;
  const visible = s.visibleProposals.some((x) => x.id === pid);
  const st = s.proposals[pid];
  const feeders = feedersOf(pid);
  return (
    <section>
      <h2 className="type-heading vb-h2">{heading}</h2>
      {visible ? (
        <Suggestion p={p} editField="body">
          <p className="type-body vb-p">{st.body}</p>
        </Suggestion>
      ) : (
        <Placeholder text={`The agent will draft this after you answer ${feeders.map(qNum).join(", ")}.`} />
      )}
    </section>
  );
}

function Decisions() {
  const s = useShaping();
  const adr = PROPOSALS.find((x) => x.id === "p-adr")!;
  const gloss = PROPOSALS.find((x) => x.id === "p-gloss")!;
  const show = (p: Proposal) => s.visibleProposals.some((x) => x.id === p.id);
  return (
    <section>
      <h2 className="type-heading vb-h2">Decisions</h2>
      {!show(adr) && !show(gloss) && <Placeholder text="ADRs and glossary terms the shaping turns up land here. Nothing yet." />}
      {show(adr) && (
        <Suggestion p={adr} editField="body">
          <div className="vb-record-kind type-label">ADR · {adr.target}</div>
          <p className="type-body vb-p">
            <strong>{s.proposals[adr.id].title}</strong>. {s.proposals[adr.id].body}
          </p>
          <ul className="vb-bar type-label">
            <li>Hard to reverse: {adr.bar!.hardToReverse}</li>
            <li>Surprising: {adr.bar!.surprising}</li>
            <li>Alternative that lost: {adr.bar!.alternativeThatLost}</li>
          </ul>
        </Suggestion>
      )}
      {show(gloss) && (
        <Suggestion p={gloss} editField="body">
          <div className="vb-record-kind type-label">Glossary · {gloss.target}</div>
          <p className="type-body vb-p">
            <Inline text={s.proposals[gloss.id].body} />
          </p>
        </Suggestion>
      )}
    </section>
  );
}

function Story({ p, index }: { p: Proposal; index: number }) {
  const s = useShaping();
  const st = s.proposals[p.id];
  const criteria = s.visibleProposals.filter((c) => c.kind === "criterion" && c.target === p.id);
  return (
    <section className="vb-story">
      <Suggestion p={p} editField="title">
        <h3 className="type-body vb-h3">
          <span className="vb-story-n tabular-nums">Story {index + 1}</span> {st.title}
        </h3>
        <p className="type-body vb-p vb-muted">{st.body}</p>
      </Suggestion>
      {isYes(st.decision) && (
        <div className="vb-criteria">
          {criteria.length === 0 && s.stage === "slice" && <Placeholder text="Acceptance criteria are drafted once the Stories are settled." />}
          {criteria.map((c) => (
            <Suggestion key={c.id} p={c} editField="title">
              <div className="vb-criterion type-body">
                <span className="vb-box" aria-hidden>☐</span>
                <span>{s.proposals[c.id].title}</span>
              </div>
              <div className="vb-check-line">
                {s.proposals[c.id].check ? <code className="vb-chip">{s.proposals[c.id].check}</code> : <span className="type-label vb-muted">judged at review</span>}
              </div>
            </Suggestion>
          ))}
        </div>
      )}
    </section>
  );
}

function MarginQuestion({ q }: { q: Question }) {
  const s = useShaping();
  const a = s.answers[q.id];
  const [own, setOwn] = useState<string | null>(null);
  if (a) {
    return (
      <div className="vb-comment vb-resolved type-label">
        <span className="vb-qn">{qNum(q)}</span> {q.prompt}
        <div className="vb-answer">→ {a.kind === "own" ? a.text : q.recommended}</div>
      </div>
    );
  }
  return (
    <div className="vb-comment vb-open">
      <div className="type-body">
        <span className="vb-qn">{qNum(q)}</span> {q.prompt}
      </div>
      {q.grounding && <code className="vb-grounding">{q.grounding}</code>}
      <div className="vb-rec type-body">
        <span className="type-label vb-muted">Recommended</span>
        <div>{q.recommended}</div>
        <div className="type-label vb-muted">{q.because}</div>
      </div>
      {own === null ? (
        <div className="vb-actions">
          <button className="vb-btn vb-primary" disabled={s.sessionDead} onClick={() => s.answer(q, { kind: "recommended", text: q.recommended })}>
            Accept
          </button>
          <button className="vb-btn" disabled={s.sessionDead} onClick={() => setOwn("")}>Answer differently</button>
        </div>
      ) : (
        <>
          <textarea className="vb-textarea type-body" rows={3} value={own} onChange={(e) => setOwn(e.target.value)} autoFocus placeholder="Your answer" />
          <div className="vb-actions">
            <button className="vb-btn vb-primary" disabled={!own.trim()} onClick={() => s.answer(q, { kind: "own", text: own.trim() })}>
              Send
            </button>
            <button className="vb-btn" onClick={() => setOwn(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function Margin({ anchor, children }: { anchor: SectionId; children?: React.ReactNode }) {
  const s = useShaping();
  if (s.stage === "done") return <aside className="vb-margin" />;
  const qs = s.visibleQuestions.filter((q) => anchorOf(q) === anchor);
  return (
    <aside className="vb-margin">
      {children}
      {qs.map((q) => (
        <MarginQuestion key={q.id} q={q} />
      ))}
    </aside>
  );
}

function Row({ anchor, children, marginExtra }: { anchor: SectionId; children: React.ReactNode; marginExtra?: React.ReactNode }) {
  return (
    <div className="vb-row">
      <div className="vb-doc">{children}</div>
      <Margin anchor={anchor}>{marginExtra}</Margin>
    </div>
  );
}

function TopBar() {
  const s = useShaping();
  const waiting = s.openQuestions.length + s.pendingProposals.length;
  const stageIdx = STAGES.findIndex((x) => x.id === s.stage);
  const current = STAGES.find((x) => x.id === s.stage);
  return (
    <header className="vb-top">
      <span className="vb-key type-label type-condensed">{EPIC.key}</span>
      <div className="vb-stages" role="list">
        {STAGES.map((st, i) => (
          <span
            key={st.id}
            role="listitem"
            className={`vb-stage type-label ${i === stageIdx ? "is-current" : ""} ${s.stage === "done" || i < stageIdx ? "is-done" : ""}`}
            title={`Done when: ${st.doneWhen}`}
          >
            {s.stage === "done" || i < stageIdx ? "✓ " : `${i + 1} `}
            {st.label}
          </span>
        ))}
      </div>
      <span className="vb-spacer" />
      {s.agentBusy && <span className="vb-busy type-label">Agent is thinking…</span>}
      {s.stage !== "done" && (
        <span className={`vb-waiting type-label tabular-nums ${waiting ? "is-on" : ""}`}>Waiting on you: {waiting}</span>
      )}
      {current && (
        <div className="vb-close">
          <button className="vb-btn vb-primary" disabled={!s.canCloseStage || s.sessionDead} onClick={s.closeStage} title={`Done when: ${current.doneWhen}`}>
            Close “{current.label}”
          </button>
          <div className="type-label vb-muted vb-blockers">{s.blockers.length ? `Still open: ${s.blockers.join(" · ")}` : "Nothing left to decide here"}</div>
        </div>
      )}
    </header>
  );
}

export function VariantB() {
  const s = useShaping();
  const latest = [...s.posted].sort((a, b) => b - a)[0];
  const round = ROUNDS.find((r) => r.n === latest);
  const done = s.stage === "done";
  const stories = s.visibleProposals.filter((p) => p.kind === "story");
  const storiesOpen = s.stage !== "spec";

  return (
    <div className="vb-root">
      <TopBar />
      {s.sessionDead && (
        <div className="vb-banner vb-banner-dead type-body">
          Session {s.session} ended (model refusal). This document is the board record, so everything you accepted, and every open suggestion, is intact. Start a new session to carry on.
        </div>
      )}
      {done && (
        <div className="vb-banner vb-banner-done type-body">
          Ready to plan. The spec, {s.acceptedStories.size} Stories and their criteria are on the board.
        </div>
      )}
      <main className={`vb-page ${done ? "is-clean" : ""}`}>
        <Row
          anchor="problem"
          marginExtra={
            !done && (
              <>
                {s.resumedNote && <div className="vb-note vb-note-resume type-label">{s.resumedNote}</div>}
                {round && (
                  <div className="vb-note type-label">
                    <strong>Agent · round {round.n}</strong>
                    <div>{s.agentBusy ? "Thinking about your answers…" : round.agentSays}</div>
                  </div>
                )}
              </>
            )
          }
        >
          <div className="vb-titleblock">
            <div className="type-label vb-muted">
              {EPIC.key} · {EPIC.milestone}
            </div>
            <h1 className="vb-h1">{EPIC.title}</h1>
            <p className="type-body vb-muted vb-seed">{EPIC.seed}</p>
          </div>
          <SpecSection pid="p-problem" heading="Problem" />
        </Row>
        <Row anchor="scope">
          <SpecSection pid="p-scope" heading="Scope" />
        </Row>
        <Row anchor="out">
          <SpecSection pid="p-out" heading="Out of scope" />
        </Row>
        <Row anchor="decisions">
          <Decisions />
        </Row>
        <Row anchor="stories-intro">
          <h2 className="type-heading vb-h2">Stories</h2>
          {!storiesOpen && <Placeholder text="Stories are sliced once you close the spec." />}
          {storiesOpen && stories.length === 0 && <Placeholder text="The agent is slicing the Epic…" />}
        </Row>
        {stories.map((p, i) => (
          <Row key={p.id} anchor={`story:${p.id}`}>
            <Story p={p} index={i} />
          </Row>
        ))}
      </main>
    </div>
  );
}
