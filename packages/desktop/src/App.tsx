import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./adapters/queryClient";
import "./styles/tokens.css";
import "./styles/type.css";
import "./styles/motion.css";
import "./App.css";

/**
 * The boot mount for the Flight Progress Strips world (01-UI-SPEC.md
 * "Selected Direction", plan 01-02).
 *
 * This plan authors the theme foundation only — the token roles, the type
 * scale, the single easing curve and the marks registry every board surface
 * from plan 01-03 onward consumes. It renders the rack ground so the boot
 * window already reads as the dark chrome frame described in "First
 * viewport," but no board surface (rail, strips, detail panel, palette)
 * lands until 01-03.
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div id="app-root" className="rack-ground" />
    </QueryClientProvider>
  );
}

export default App;
