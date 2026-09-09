import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./adapters/queryClient";
import "./App.css";

/**
 * The boot mount for Phase 1, plan 01-01.
 *
 * This plan authors no visual surface: no color, no typeface, no radius and no
 * component chrome. The Flight Progress Strips world (01-UI-SPEC.md "Selected
 * Direction") and every board surface land starting in plan 01-02. This component
 * exists only to prove the renderer boots and the QueryClientProvider wraps the tree.
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div id="app-root" />
    </QueryClientProvider>
  );
}

export default App;
