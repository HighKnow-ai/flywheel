/**
 * The Settings surface (D-39, 02-UI-SPEC.md "Settings surface" — the product's first Settings
 * surface). Same shell pattern as `session/SessionSurface.tsx`: a full surface that replaces the
 * board's content area, the project rail stays visible, a `← Back` back affordance returns —
 * never a modal, because this holds a form the user may want to leave open and return to
 * (02-UI-SPEC.md Open Decision #1: no unsaved-state warning, because every field here commits on
 * interaction, so there is nothing to lose by navigating away).
 *
 * Reached from exactly three places (plan 02-10 Task 3): the app menu's "Settings…" item, `⌘,`,
 * and the command palette — never an inline settings-adjacent affordance on the board or the
 * launch sheet.
 *
 * Five sections, top to bottom:
 * 1. **Credential path** — a global two-value segmented control (`Local Claude Code Credentials`
 *    default / `API Key`), the write-only Keychain-backed key field (only revealed while the
 *    global mode is `api_key`), and the non-blocking backend-unavailable notice.
 * 2. **Per-project override** — one row per registered project (`useBoardQuery.ts`'s
 *    `useProjects`), each carrying the same segmented control plus a third `Use global default`
 *    option. Absent entirely at zero registered projects (E7 zero-one-many) — an override table
 *    with no rows would be noise, and the global control alone is the honest surface.
 * 3. **Worktree open commands** (D-130, LINK-11, plan 07-04 Task 3) — the two command templates
 *    `item-detail/WorktreeSummary.tsx`'s "Open in editor"/"Open in terminal" actions run,
 *    pre-filled with their current (stored-or-default) value and saved on blur/Enter, following
 *    this file's own "every field commits on interaction" discipline. A rejected save (an empty
 *    or whitespace-only template) surfaces the core's own rejection text rather than storing it.
 * 4. **Notifications** (D-176) — the one global OS-notification switch.
 * 5. **Permission rules** (D-38) — `PermissionRulesTable.tsx`, mounted by plan 02-10 Task 2.
 *
 * `T-02-40`'s mitigation lives here structurally: the API key input is always `type="password"`,
 * there is no unmask affordance anywhere in this file (Task 1's own structural `<verify>` grep
 * gate), and `settings_get`/`SettingsDto` never carries the key value itself — only whether one is
 * configured and when.
 */
import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  backendCapabilityProbe,
  getSettings,
  openCommandTemplate,
  setCredentialMode,
  setOpenCommandTemplate,
  storeApiKey,
  type SettingsDto,
  type WorktreeOpenSurface,
} from "../adapters/tauri";
import { useProjects } from "../board/useBoardQuery";
import { NotificationsControl } from "./NotificationsControl";
import { PermissionRulesTable } from "./PermissionRulesTable";
import "../styles/admin-surfaces.css";

/** The two credential-mode values the schema/commands accept (`commands/settings.rs`'s
 * `validate_mode`) — the exact labels 02-UI-SPEC.md's Copywriting Contract specifies. */
type CredentialMode = "local" | "api_key";

const CREDENTIAL_OPTIONS: readonly { value: CredentialMode; label: string }[] = [
  { value: "local", label: "Local Claude Code Credentials" },
  { value: "api_key", label: "API Key" },
];

/** The per-project row's third option — `"default"` is a renderer-only value (never sent to the
 * command surface as-is); selecting it sends `mode: null`, which `set_project_credential_mode`
 * treats as clearing the override back to "use the global default." */
type ProjectOptionValue = CredentialMode | "default";

const PROJECT_CREDENTIAL_OPTIONS: readonly { value: ProjectOptionValue; label: string }[] = [
  ...CREDENTIAL_OPTIONS,
  { value: "default", label: "Use global default" },
];

const SETTINGS_QUERY_KEY = ["settings"] as const;
const BACKEND_CAPABILITY_QUERY_KEY = ["backend-capability"] as const;

/** The exact copy from 02-UI-SPEC.md's Copywriting Contract ("Settings — CLI not detected
 * notice") — never a hard error, since the API-key path remains fully usable regardless. */
/** T-02-42 clause 1 (D-39). The threat's declared mitigation is conjoined: the API-key override
 * assumption (A1) is measured and its outcome recorded, AND "if the override cannot be confirmed
 * the Settings surface carries a notice rather than the product assuming it worked."
 *
 * A1 was never confirmed — measuring it needs a spend-authorized key alongside a live subscription
 * session, which no environment available to this project has had (02-09-SUMMARY.md "What could
 * NOT be measured"; 02-UAT.md test 3's open_question). The conditional therefore fired, and this
 * string is its consequence.
 *
 * Why it is not cosmetic: clause 2 (error rather than silent fallback, credentials.rs) only covers
 * api_key mode with NO key stored. The harm this threat names is the opposite configuration —
 * BOTH credentials present — where resolve_credential succeeds, ANTHROPIC_API_KEY is set, and the
 * control reads "API Key". If the environment variable does not in fact win over a live
 * `claude login` session, Flywheel bills the subscription while displaying API Key. Saying so is
 * the mitigation; silence is the threat.
 *
 * Delete this only when precedence has been MEASURED, not when it is assumed. */
const API_KEY_PRECEDENCE_NOTICE =
  "Unverified: if you are also signed in with the claude CLI, we have not confirmed which " +
  "credential the backend actually uses. Sign out of the CLI to be certain this key is the one " +
  "being billed.";

const BACKEND_UNAVAILABLE_NOTICE =
  "Local credentials require the claude CLI, which wasn't found. The API key path still works.";

/** A row-shaped placeholder for the near-instant window between this surface mounting and its
 * reads resolving (E7 loading) — the same minimal, self-contained pattern
 * `launch-sheet/LaunchSheet.tsx`'s `PreviewSkeleton` already established (this codebase has no
 * shared skeleton-row component yet): muted bars, never an empty page and never a spinner. */
function SectionSkeleton() {
  const barStyle = {
    height: 12,
    borderRadius: "var(--radius-chrome)",
    background: "var(--divider)",
  };
  return (
    <div
      aria-hidden="true"
      data-testid="settings-skeleton"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}
    >
      <div style={{ ...barStyle, width: "60%" }} />
      <div style={{ ...barStyle, width: "40%" }} />
    </div>
  );
}

/** The one segmented-control implementation both the global row and every per-project row reuse
 * (the action text's own "literally the same control reused per row, not a second design") —
 * mirrors `launch-sheet/LaunchSheet.tsx`'s permission-mode `role="radiogroup"`/`role="radio"`
 * pattern exactly. Every selection commits immediately via the caller's `onSelect` — there is no
 * local draft state here, which is what makes "no Save button, nothing to lose" true by
 * construction rather than by convention. */
function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onSelect,
}: {
  ariaLabel: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "flex", gap: "var(--space-xs)" }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(option.value)}
            className="type-label control-edge admin-choice"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The write-only API key field (T-02-40): a masked input with no reveal toggle. Saving clears the
 * input and replaces it with `API key configured on {date}.` and a `Replace` action that returns
 * to the masked input — the previously stored value is never rendered, matching D-39's "never in
 * SQLite, never in a config file" discipline extended to "never re-rendered either."
 *
 * Commits on blur or Enter (mirrors `item-detail/ItemDetailPanel.tsx`'s inline-editable title
 * convention: `onBlur={commit}`, Enter blurs to trigger the same commit) rather than a dedicated
 * "Save" button — a typed-but-uncommitted key is the one piece of real draft state this surface
 * has, and committing it on the same interaction that would otherwise abandon it (blur/Enter)
 * keeps "every field commits on interaction" true without a page-level Save affordance.
 */
function ApiKeyField({ settings }: { settings: SettingsDto }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [replacing, setReplacing] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (value: string) => storeApiKey(value),
    onSuccess: () => {
      setDraft("");
      setReplacing(false);
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
  });

  function commit() {
    const value = draft.trim();
    if (!value || saveMutation.isPending) return;
    saveMutation.mutate(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  }

  const showConfigured = settings.apiKeyConfigured && !replacing && !saveMutation.isError;

  if (showConfigured) {
    const configuredDate = settings.apiKeyConfiguredAt
      ? new Date(settings.apiKeyConfiguredAt).toLocaleDateString()
      : "";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
        <span className="type-body">{`API key configured on ${configuredDate}.`}</span>
        <button
          type="button"
          onClick={() => {
            saveMutation.reset();
            setReplacing(true);
          }}
          className="type-label control-edge admin-action"
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", maxWidth: 320 }}>
      <input
        type="password"
        aria-label="API key"
        value={draft}
        disabled={saveMutation.isPending}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder="sk-ant-…"
        className="type-body control-edge admin-field"
      />
      {saveMutation.isError && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {saveMutation.error instanceof Error ? saveMutation.error.message : "Could not save the API key."}
        </p>
      )}
    </div>
  );
}

/** `item-detail/WorktreeSummary.tsx`'s open-command template helper text — stated once here
 * rather than per-field, since both fields carry the identical mechanism. */
const OPEN_COMMAND_HELP_TEXT =
  "Split into arguments and run directly — {worktree_path} is substituted, no shell is involved.";

function openCommandTemplateQueryKey(surface: WorktreeOpenSurface) {
  return ["open-command-template", surface] as const;
}

/**
 * One of the two D-130 worktree-open command template fields (editor/terminal). Reads the
 * current (stored-or-default) value on mount via `openCommandTemplate`, commits an edit on
 * blur/Enter — mirroring `ApiKeyField`'s own commit-on-interaction convention above — and renders
 * the core's own rejection text (`set_open_command_template`'s empty/whitespace-only refusal)
 * inline rather than storing it.
 */
function OpenCommandTemplateField({ surface, label }: { surface: WorktreeOpenSurface; label: string }) {
  const queryClient = useQueryClient();
  const queryKey = openCommandTemplateQueryKey(surface);
  const templateQuery = useQuery({ queryKey, queryFn: () => openCommandTemplate(surface) });
  const [draft, setDraft] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (value: string) => setOpenCommandTemplate(surface, value),
    onSuccess: () => {
      setDraft(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  function commit() {
    if (saveMutation.isPending || draft === null) return;
    saveMutation.mutate(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  }

  // E7 loading: render nothing while the read is in flight — this is a near-instant local read,
  // not worth a dedicated skeleton (and `SectionSkeleton`'s shared `data-testid` would otherwise
  // collide with the Credential Path section's own skeleton above).
  if (templateQuery.isPending) return null;

  const value = draft ?? templateQuery.data ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", maxWidth: 420 }}>
      <label className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        {label}
      </label>
      <input
        type="text"
        aria-label={label}
        value={value}
        disabled={saveMutation.isPending}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="type-body control-edge admin-field"
        style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }}
      />
      <p className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
        {OPEN_COMMAND_HELP_TEXT}
      </p>
      {saveMutation.isError && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {saveMutation.error instanceof Error ? saveMutation.error.message : "Could not save this template."}
        </p>
      )}
    </div>
  );
}

export interface SettingsSurfaceProps {
  onBack: () => void;
}

export function SettingsSurface({ onBack }: SettingsSurfaceProps) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => getSettings() });
  const backendQuery = useQuery({
    queryKey: BACKEND_CAPABILITY_QUERY_KEY,
    queryFn: () => backendCapabilityProbe(),
  });
  const projectsQuery = useProjects();

  const setModeMutation = useMutation({
    mutationFn: (input: { scope: "global" | "project"; mode: CredentialMode | null; projectId?: string }) =>
      setCredentialMode(input.scope, input.mode, input.projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  });

  const loading = settingsQuery.isPending;
  const settings = settingsQuery.data;
  const projects = projectsQuery.data ?? [];
  const backendUnavailable = backendQuery.data ? !backendQuery.data.available : false;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--text-primary-rack)" }}>
      <header className="admin-header">
        <button type="button" onClick={onBack} className="type-label admin-back">
          ← Back
        </button>
        <span className="type-heading">Settings</span>
      </header>

      <div className="admin-body">
        <section className="admin-section">
          <span className="type-body admin-section-label">
            Credential Path
          </span>
          {loading || !settings ? (
            <SectionSkeleton />
          ) : (
            <>
              <SegmentedControl
                ariaLabel="Credential path"
                options={CREDENTIAL_OPTIONS}
                value={settings.globalCredentialMode as CredentialMode}
                onSelect={(mode) => setModeMutation.mutate({ scope: "global", mode })}
              />
              {backendUnavailable && (
                <p role="status" className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
                  {BACKEND_UNAVAILABLE_NOTICE}
                </p>
              )}
              {settings.globalCredentialMode === "api_key" && (
                <p
                  role="status"
                  data-testid="api-key-precedence-notice"
                  className="type-label"
                  style={{ margin: 0, color: "var(--text-muted-rack)" }}
                >
                  {API_KEY_PRECEDENCE_NOTICE}
                </p>
              )}
              {settings.globalCredentialMode === "api_key" && <ApiKeyField settings={settings} />}
            </>
          )}
        </section>

        {!loading && settings && projects.length > 0 && (
          <section className="admin-section">
            <span className="type-body admin-section-label">
              Per-Project Override
            </span>
            <div
              style={{ display: "flex", flexDirection: "column", maxHeight: 240, overflowY: "auto" }}
            >
              {settings.projectOverrides.map((override) => (
                <div key={override.projectId} className="admin-row">
                  <span
                    className="type-body"
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 1,
                      minWidth: 0,
                    }}
                  >
                    {override.projectName}
                  </span>
                  <SegmentedControl
                    ariaLabel={`Credential path for ${override.projectName}`}
                    options={PROJECT_CREDENTIAL_OPTIONS}
                    value={(override.credentialMode ?? "default") as ProjectOptionValue}
                    onSelect={(value) =>
                      setModeMutation.mutate({
                        scope: "project",
                        mode: value === "default" ? null : value,
                        projectId: override.projectId,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && settings && (
          <section className="admin-section">
            <span className="type-body admin-section-label">
              Notifications
            </span>
            <NotificationsControl
              settings={settings}
              onChanged={() => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })}
            />
          </section>
        )}

        <section className="admin-section" style={{ gap: "var(--space-md)" }}>
          <span className="type-body admin-section-label">
            Worktree Open Commands
          </span>
          <OpenCommandTemplateField surface="editor" label="Open in editor" />
          <OpenCommandTemplateField surface="terminal" label="Open in terminal" />
        </section>

        <section className="admin-section">
          <span className="type-body admin-section-label">
            Permission Rules
          </span>
          <PermissionRulesTable projects={projects} loadingProjects={projectsQuery.isPending} />
        </section>
      </div>
    </div>
  );
}
