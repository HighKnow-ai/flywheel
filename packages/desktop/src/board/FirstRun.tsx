/**
 * The zero-projects empty state (01-UI-SPEC.md "State Inventory", "Copywriting Contract").
 *
 * Registration is two steps: pick a folder via the native picker, then confirm a project key
 * prefix — pre-filled with a default derived from the repository directory name, editable before
 * the first item exists (01-UI-SPEC.md Open Decisions #11). Once the project is registered and
 * has allocated its first item key, the prefix becomes immutable
 * (`packages/core::domain::project::update_key_prefix` enforces this; no rename affordance ships
 * in Phase 1).
 */
import { useState, type CSSProperties } from "react";
import { openFolderDialog } from "../adapters/tauri";
import { useRegisterProject } from "./useBoardQuery";

/** A short, uppercase, greppable default derived from a repo path's directory name (D-10).
 * Always emits a prefix `domain/project.rs::validate_key_prefix` accepts (2-10 uppercase
 * letters/digits, starting with a letter) — a directory name like `2024-app` or a single-
 * character name used to derive a prefix that failed validation (CR-02/IN-01), leaving three of
 * the four registration entry points (which register immediately, with no confirmation step to
 * edit the prefix the way this component's own two-step flow allows) with nothing to show for a
 * rejected registration. Pad short results and force a leading letter rather than relying on
 * every caller to handle the rejection. */
export function deriveKeyPrefix(pathOrName: string): string {
  const base = pathOrName.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const alnum = base.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const candidate = alnum.slice(0, 4);
  const startsWithLetter = /^[A-Z]/.test(candidate);
  const prefixed = startsWithLetter ? candidate : `P${candidate}`.slice(0, 4);
  return prefixed.length >= 2 ? prefixed : "PRJ";
}

const emptyStateStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-md)",
  background: "var(--surface-dominant)",
  color: "var(--text-primary-rack)",
  padding: "var(--space-xl)",
  textAlign: "center",
};

const buttonStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-lg)",
  borderRadius: "var(--radius-chrome)",
  border: "1px solid var(--divider)",
  background: "var(--surface-secondary)",
  color: "var(--accent-text-rack)",
  cursor: "pointer",
};

export function FirstRun() {
  const [pending, setPending] = useState<{ repoPath: string; name: string } | null>(null);
  const [keyPrefix, setKeyPrefix] = useState("");
  const registerProject = useRegisterProject();

  async function handlePickFolder() {
    const repoPath = await openFolderDialog();
    if (!repoPath) return;
    const name = repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath;
    setPending({ repoPath, name });
    setKeyPrefix(deriveKeyPrefix(name));
  }

  function handleConfirm() {
    if (!pending) return;
    const prefix = keyPrefix.trim().toUpperCase();
    if (!prefix) return;
    registerProject.mutate({ name: pending.name, repoPath: pending.repoPath, keyPrefix: prefix });
  }

  if (pending) {
    return (
      <div className="first-run" style={emptyStateStyle}>
        <h1 className="type-heading">Register {pending.name}</h1>
        <p className="type-body">
          Confirm the project key — it becomes permanent once the first item is created.
        </p>
        <input
          className="type-body tabular-nums"
          value={keyPrefix}
          onChange={(event) => setKeyPrefix(event.target.value.toUpperCase())}
          maxLength={10}
          aria-label="Project key prefix"
          style={{
            padding: "var(--space-sm)",
            borderRadius: "var(--radius-chrome)",
            border: "1px solid var(--divider)",
            background: "var(--surface-secondary)",
            color: "var(--text-primary-rack)",
            textAlign: "center",
          }}
        />
        <button type="button" className="type-body" style={buttonStyle} onClick={handleConfirm} disabled={registerProject.isPending}>
          Register Project
        </button>
        {registerProject.isError && (
          <p className="type-label" style={{ color: "var(--destructive-strip)" }}>
            Couldn't register this project — {(registerProject.error as Error).message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="first-run" style={emptyStateStyle}>
      <h1 className="type-heading">No projects yet</h1>
      <p className="type-body">
        Register a local git repository to see its board. Flywheel never touches board content in
        the repo itself — only a small marker file.
      </p>
      <button type="button" className="type-body" style={buttonStyle} onClick={handlePickFolder}>
        Register Project…
      </button>
    </div>
  );
}
