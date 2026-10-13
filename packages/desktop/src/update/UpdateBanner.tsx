import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateInstall } from "../adapters/tauri";
import { useUiStore } from "../state/uiStore";
import { fleetQueryKey } from "../fleet/useFleet";
import { useLiveRunCount, useUpdate } from "./useUpdate";
import "../styles/admin-surfaces.css";
import "./update.css";

function agents(count: number): string {
  return `${count} ${count === 1 ? "agent" : "agents"} running`;
}

/**
 * The in-app update offer (plan 11-06, DIST-02, D-187, D-188): a dismissible banner naming the new version
 * and what changed. Accepting downloads and stages it; a relaunch applies it. Mounted once by `App.tsx`,
 * outside every surface, so it shows whichever one is open.
 *
 * The release notes are untrusted text from a release body (T-11-17): they are only ever a React text
 * child, never HTML, never a link. The accept button is disabled while agents run, but that is display
 * only: Rust refuses independently, and its answer is shown if it disagrees.
 */
export function UpdateBanner() {
  const { data } = useUpdate();
  const liveRuns = useLiveRunCount();
  const dismissed = useUiStore((state) => state.dismissedUpdateVersion);
  const dismiss = useUiStore((state) => state.setDismissedUpdateVersion);
  const queryClient = useQueryClient();
  const install = useMutation({
    mutationFn: () => updateInstall(),
    // A refusal means the fleet read this banner counts from was behind: re-read it.
    onSuccess: (result) => {
      if (result.refused) void queryClient.invalidateQueries({ queryKey: fleetQueryKey() });
    },
  });

  if (!data?.available || !data.version || data.version === dismissed) return null;

  const result = install.data;
  const staged = result?.staged === true;
  // The fleet count drives the button. Rust's own count is shown only when the fleet read shows none,
  // which is how a run the capped fleet read missed still gets named.
  const shownRuns = liveRuns > 0 ? liveRuns : result?.refused ? result.liveRuns : 0;
  const waiting = !staged && shownRuns > 0;
  const error = install.error
    ? `Could not install the update: ${install.error instanceof Error ? install.error.message : String(install.error)}`
    : null;

  return (
    <section className="update-banner" role="region" aria-label="Update available">
      <div className="update-banner-head type-body">
        <strong>Flywheel {data.version} is available</strong>
        <span className="update-banner-current type-label">you have {data.currentVersion}</span>
      </div>
      {data.notes ? <p className="update-banner-notes type-label">{data.notes}</p> : null}
      {waiting ? (
        <p id="update-banner-waiting" className="update-banner-line type-label" role="status">
          {agents(shownRuns)}. The update waits until they finish.
        </p>
      ) : null}
      {staged ? (
        <p className="update-banner-line type-label" role="status">
          {result.message}
        </p>
      ) : null}
      {error ? (
        <p className="update-banner-line update-banner-error type-label" role="alert">
          {error}
        </p>
      ) : null}
      <div className="update-banner-actions">
        {staged ? null : (
          <button
            type="button"
            className="control-edge admin-action admin-action-lead type-label"
            disabled={liveRuns > 0 || install.isPending}
            aria-describedby={liveRuns > 0 ? "update-banner-waiting" : undefined}
            onClick={() => install.mutate()}
          >
            {install.isPending ? "Installing…" : "Install on relaunch"}
          </button>
        )}
        <button
          type="button"
          className="control-edge admin-action type-label"
          onClick={() => dismiss(data.version)}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
