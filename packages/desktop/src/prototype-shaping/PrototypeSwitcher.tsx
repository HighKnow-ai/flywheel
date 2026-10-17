/**
 * PROTOTYPE — throwaway. The floating variant bar. Also carries the two prototype-only levers:
 * the board-write log (what would be on the board right now) and "kill the session", which
 * simulates the walkthrough's model refusal to show what survives.
 */
import { useCallback, useEffect, useState } from "react";
import { useShaping } from "./useShaping";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";

export const VARIANTS = [
  { key: "A", name: "Grilling rounds", Component: VariantA },
  { key: "B", name: "Spec document, agent in the margin", Component: VariantB },
  { key: "C", name: "Story map on the board", Component: VariantC },
];

export function useVariant(): [string, (v: string) => void] {
  const read = () => new URLSearchParams(location.search).get("variant") ?? "A";
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const set = useCallback((next: string) => {
    const u = new URL(location.href);
    u.searchParams.set("variant", next);
    history.replaceState(null, "", u);
    setV(next);
  }, []);
  return [v, set];
}

export function PrototypeSwitcher({ current, onChange }: { current: string; onChange: (v: string) => void }) {
  const s = useShaping();
  const [showLog, setShowLog] = useState(false);
  const i = VARIANTS.findIndex((v) => v.key === current);
  const go = useCallback(
    (d: number) => onChange(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key),
    [i, onChange],
  );
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [go]);
  return (
    <>
      {showLog && (
        <div className="proto-log">
          <strong>Written to the board</strong>
          {s.log.map((l, k) => (
            <div key={k}>
              <span className="tabular-nums">{l.at}</span> {l.text}
            </div>
          ))}
        </div>
      )}
      <div className="proto-bar">
        <button onClick={() => go(-1)} aria-label="Previous variant">←</button>
        <span>
          {current} ({VARIANTS[i]?.name})
        </span>
        <button onClick={() => go(1)} aria-label="Next variant">→</button>
        <span className="proto-sep" />
        <button onClick={() => setShowLog((x) => !x)}>Board log ({s.log.length})</button>
        {s.sessionDead ? (
          <button onClick={s.resume}>Start a new session</button>
        ) : (
          <button onClick={s.kill} disabled={s.stage === "done"}>Kill session (refusal)</button>
        )}
      </div>
    </>
  );
}
