/**
 * PROTOTYPE — throwaway (HighKnow-ai/flywheel#11).
 * Three variants of the shaping screen, switchable via `?variant=`, on a throwaway page
 * (/prototype-shaping.html). Sub-shape B: the real app is Tauri-bound and its record domain is
 * being rewritten (ADR 0003), so there's no live page to host this in; it uses the app's tokens
 * and type so density and colour are real.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../styles/type.css";
import "./prototype.css";
import { ShapingProvider } from "./useShaping";
import { PrototypeSwitcher, VARIANTS, useVariant } from "./PrototypeSwitcher";

function Root() {
  const [variant, setVariant] = useVariant();
  const V = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  return (
    // Remounting on switch resets the session, so each variant is judged from the start.
    <ShapingProvider key={V.key}>
      <V.Component />
      <PrototypeSwitcher current={V.key} onChange={setVariant} />
    </ShapingProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
