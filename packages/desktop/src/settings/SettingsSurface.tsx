/**
 * The Settings surface (D-39): a full surface that replaces the board's content area, the project rail still
 * visible, Back returning. Never a modal, because this holds a form the user may want to leave open and return
 * to, and there is no unsaved-state warning, because every field here commits on interaction (and says so with
 * a toast, #209), so there is nothing to lose by navigating away.
 *
 * Reached from exactly three places: the app menu's "Settings…" item, `⌘,`, and the command palette.
 *
 * Five Card sections, top to bottom (#209 rebuilt them on the shadcn primitives, now `@highknow/design`):
 * 1. **Credentials**: a Radio Group of the two global paths (local Claude Code credentials, the default, or an
 *    API key), the write-only Keychain-backed key field (only while the global path is the API key), and the
 *    non-blocking backend-unavailable notice.
 * 2. **Per-project credentials**: a Table with one row per registered project and a Select per row carrying the
 *    same two paths plus "Use the default". Absent at zero registered projects (E7 zero-one-many).
 * 3. **Notifications** (D-176): the one global OS-notification Switch.
 * 4. **Open commands** (D-130, LINK-11): the two templates the worktree's "Open in editor" and "Open in
 *    terminal" run, saved on blur or Return. A rejected save surfaces the core's own rejection text.
 * 5. **Permission rules** (D-38): `PermissionRulesTable.tsx`.
 *
 * T-02-40's mitigation lives here structurally: the API key input is always `type="password"`, there is no
 * unmask affordance anywhere in this file, and `SettingsDto` never carries the key itself, only whether one is
 * configured and when.
 */
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Tip } from "@/components/Tip";
import { TruncateTip } from "@/components/TruncateTip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, KeyRound, ShieldAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useLoadingPhase,
  PageBody,
} from "@highknow/design";
import { Button } from "@/components/Button";
import { ReadError } from "@/components/ReadError";
import { formatAbsoluteTime } from "@/lib/format";
import { notify } from "@/lib/notify";
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
import { PageHeader } from "../shell/PageHeader";

/** The two credential-mode values the core accepts (`commands/settings.rs`'s `validate_mode`). */
type CredentialMode = "local" | "api_key";

const CREDENTIAL_OPTIONS: readonly { value: CredentialMode; label: string; description: string }[] = [
  {
    value: "local",
    label: "Local Claude Code credentials",
    description: "The claude CLI's own sign-in, as you use it in a terminal.",
  },
  {
    value: "api_key",
    label: "API key",
    description: "An Anthropic API key, kept in the macOS Keychain and billed per token.",
  },
];

/** The per-project row's third option. `"default"` is renderer-only: choosing it sends `mode: null`, which
 * `set_project_credential_mode` treats as clearing the override back to the global default. */
type ProjectOptionValue = CredentialMode | "default";

const PROJECT_DEFAULT_LABEL = "Use the default";

/** A path as it reads inside a sentence ("Set Acme to the API key"). */
const MODE_PHRASE: Record<CredentialMode, string> = {
  local: "local Claude Code credentials",
  api_key: "the API key",
};

const SETTINGS_QUERY_KEY = ["settings"] as const;
const BACKEND_CAPABILITY_QUERY_KEY = ["backend-capability"] as const;

/** T-02-42 clause 1 (D-39). The threat's declared mitigation is conjoined: the API-key override assumption (A1)
 * is measured and its outcome recorded, AND "if the override cannot be confirmed the Settings surface carries a
 * notice rather than the product assuming it worked."
 *
 * A1 was never confirmed: measuring it needs a spend-authorized key alongside a live subscription session, which
 * no environment available to this project has had (02-09-SUMMARY.md). The conditional therefore fired, and this
 * string is its consequence. With BOTH credentials present, if the environment variable does not in fact win over
 * a live `claude login` session, Flywheel bills the subscription while displaying API key. Saying so is the
 * mitigation; silence is the threat.
 *
 * Delete this only when precedence has been MEASURED, not when it is assumed. */
const API_KEY_PRECEDENCE_NOTICE =
  "Unverified: if you are also signed in with the claude CLI, we have not confirmed which " +
  "credential the backend actually uses. Sign out of the CLI to be certain this key is the one " +
  "being billed.";

const BACKEND_UNAVAILABLE_NOTICE =
  "Local credentials require the claude CLI, which wasn't found. The API key path still works.";

/** One Settings section: a Card with its heading and one line on what it governs. */
function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId} role="heading" aria-level={2}>
          {title}
        </CardTitle>
        {description && <CardDescription className="text-body">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

/** The Credentials section's shape while the settings read is in flight (E7 loading). */
function CredentialsSkeleton() {
  return (
    <div aria-hidden="true" data-testid="settings-skeleton" className="grid gap-3 md:grid-cols-2">
      {[0, 1].map((card) => (
        <div key={card} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}

/** The global credential path: two choice cards in a Radio Group. Every choice commits immediately; there is no
 * draft state, which is what makes "nothing to lose" true by construction. */
function CredentialChoice({
  value,
  disabled,
  onSelect,
}: {
  value: CredentialMode;
  disabled: boolean;
  onSelect: (mode: CredentialMode) => void;
}) {
  const baseId = useId();
  return (
    <RadioGroup
      aria-label="Credential path"
      value={value}
      onValueChange={(next) => onSelect(next as CredentialMode)}
      disabled={disabled}
      className="grid gap-3 md:grid-cols-2"
    >
      {CREDENTIAL_OPTIONS.map((option) => {
        const id = `${baseId}-${option.value}`;
        return (
          <FieldLabel key={option.value} htmlFor={id}>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle id={`${id}-title`} className="text-body">
                  {option.label}
                </FieldTitle>
                <FieldDescription id={`${id}-description`}>{option.description}</FieldDescription>
              </FieldContent>
              <RadioGroupItem
                id={id}
                value={option.value}
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-description`}
              />
            </Field>
          </FieldLabel>
        );
      })}
    </RadioGroup>
  );
}

/**
 * The write-only API key field (T-02-40): a masked input with no reveal toggle. Saving clears the input and
 * replaces it with "API key configured on {date}." and Replace, which returns to the masked input. The stored
 * value is never rendered.
 *
 * Commits on blur or Return rather than with a Save button: a typed-but-uncommitted key is the one piece of real
 * draft state this surface has, and committing it on the interaction that would otherwise abandon it keeps
 * "every field commits on interaction" true.
 */
function ApiKeyField({ settings }: { settings: SettingsDto }) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [replacing, setReplacing] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (value: string) => storeApiKey(value),
    onSuccess: async () => {
      setDraft("");
      setReplacing(false);
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      notify.success("Saved the API key", { description: "It's in the macOS Keychain and won't be shown again." });
    },
  });

  function commit() {
    const value = draft.trim();
    if (!value || saveMutation.isPending) return;
    saveMutation.mutate(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
  }

  const showConfigured = settings.apiKeyConfigured && !replacing && !saveMutation.isError;

  if (showConfigured) {
    const configuredDate = settings.apiKeyConfiguredAt
      ? new Date(settings.apiKeyConfiguredAt).toLocaleDateString()
      : "";
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Tip content={formatAbsoluteTime(settings.apiKeyConfiguredAt)}>
          <span className="text-body">{`API key configured on ${configuredDate}.`}</span>
        </Tip>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            saveMutation.reset();
            setReplacing(true);
          }}
        >
          <KeyRound aria-hidden="true" />
          Replace
        </Button>
      </div>
    );
  }

  return (
    <Field data-invalid={saveMutation.isError || undefined} className="max-w-sm">
      <FieldLabel htmlFor={inputId}>Anthropic API key</FieldLabel>
      <Input
        id={inputId}
        type="password"
        value={draft}
        disabled={saveMutation.isPending}
        aria-invalid={saveMutation.isError || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder="sk-ant-…"
        autoComplete="off"
        spellCheck={false}
      />
      {saveMutation.isError ? (
        <FieldError>
          {saveMutation.error instanceof Error ? saveMutation.error.message : "Couldn't save the API key."}
        </FieldError>
      ) : (
        <FieldDescription>Saved when you leave the field or press Return.</FieldDescription>
      )}
    </Field>
  );
}

function openCommandTemplateQueryKey(surface: WorktreeOpenSurface) {
  return ["open-command-template", surface] as const;
}

/**
 * One of the two D-130 worktree-open command templates (editor, terminal). Reads the current stored-or-default
 * value, commits an edit on blur or Return, and shows the core's own rejection (an empty or whitespace-only
 * template) under the field rather than storing it.
 */
function OpenCommandTemplateField({
  surface,
  label,
  noun,
}: {
  surface: WorktreeOpenSurface;
  label: string;
  noun: string;
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const queryKey = openCommandTemplateQueryKey(surface);
  const templateQuery = useQuery({ queryKey, queryFn: () => openCommandTemplate(surface) });
  const templatePhase = useLoadingPhase(templateQuery.isPending);
  const [draft, setDraft] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (value: string) => setOpenCommandTemplate(surface, value),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey });
      notify.success(`Saved the ${noun} command`);
    },
  });

  function commit() {
    if (saveMutation.isPending || draft === null) return;
    // Leaving the field untouched is not a save, and says nothing.
    if (draft === templateQuery.data) {
      setDraft(null);
      return;
    }
    saveMutation.mutate(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
  }

  return (
    <Field data-invalid={saveMutation.isError || undefined}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      {templatePhase === "skeleton" ? (
        <Skeleton aria-hidden="true" className="h-8.5 w-full" />
      ) : templateQuery.isPending ? (
        // The field keeps its height for the first 150 ms, so the form does not move when the input lands.
        <div aria-hidden="true" className="h-8.5" />
      ) : (
        <Input
          id={inputId}
          type="text"
          value={draft ?? templateQuery.data ?? ""}
          disabled={saveMutation.isPending}
          aria-invalid={saveMutation.isError || undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-small"
        />
      )}
      {saveMutation.isError && (
        <FieldError>
          {saveMutation.error instanceof Error ? saveMutation.error.message : "Couldn't save this command."}
        </FieldError>
      )}
    </Field>
  );
}

/** The per-project override: a Table with a Select per row. Each choice commits at once; while it is in flight
 * the row shows the value being saved, and a refused save snaps back to what is stored. */
function ProjectOverrides({ settings }: { settings: SettingsDto }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { projectId: string; projectName: string; mode: CredentialMode | null }) =>
      setCredentialMode("project", input.mode, input.projectId),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      notify.success(
        input.mode === null
          ? `Set ${input.projectName} to the default credentials`
          : `Set ${input.projectName} to ${MODE_PHRASE[input.mode]}`,
      );
    },
    onError: (error, input) => notify.error(`Couldn't change ${input.projectName}'s credentials`, { error }),
  });

  return (
    <Table aria-label="Per-project credentials" className="table-fixed text-body">
      <colgroup>
        <col />
        <col className="w-72" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-0 text-small text-muted-foreground">Project</TableHead>
          <TableHead className="pr-0 text-small text-muted-foreground">Credentials</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {settings.projectOverrides.map((override) => {
          const pending = mutation.isPending && mutation.variables?.projectId === override.projectId;
          const stored = (override.credentialMode ?? "default") as ProjectOptionValue;
          const value: ProjectOptionValue = pending ? (mutation.variables?.mode ?? "default") : stored;
          return (
            <TableRow key={override.projectId}>
              <TableCell className="pl-0">
                <TruncateTip text={override.projectName}>
                  <span className="block truncate">{override.projectName}</span>
                </TruncateTip>
              </TableCell>
              <TableCell className="pr-0">
                <Select
                  value={value}
                  disabled={pending}
                  onValueChange={(next) =>
                    mutation.mutate({
                      projectId: override.projectId,
                      projectName: override.projectName,
                      mode: next === "default" ? null : (next as CredentialMode),
                    })
                  }
                >
                  <SelectTrigger aria-label={`Credentials for ${override.projectName}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{PROJECT_DEFAULT_LABEL}</SelectItem>
                    {CREDENTIAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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

  const globalMutation = useMutation({
    mutationFn: (mode: CredentialMode) => setCredentialMode("global", mode, undefined),
    onSuccess: async (_data, mode) => {
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      notify.success(`Switched to ${MODE_PHRASE[mode]}`);
    },
    onError: (error) => notify.error("Couldn't change the credential path", { error }),
  });

  const settings = settingsQuery.data;
  const loading = settingsQuery.isPending;
  // The loading rule (DESIGN.md § Feedback): nothing for 150 ms, then the skeleton, held at least 350 ms.
  const credentialsPhase = useLoadingPhase(loading);
  const projects = projectsQuery.data ?? [];
  const backendUnavailable = backendQuery.data ? !backendQuery.data.available : false;
  const globalMode = (globalMutation.isPending ? globalMutation.variables : settings?.globalCredentialMode) as
    CredentialMode | undefined;

  return (
    <div className="flex h-full flex-col text-foreground">
      <PageHeader onBack={onBack} crumbs={[{ label: "Settings" }]} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageBody width="wide">
          {settingsQuery.isError ? (
            <ReadError title="Couldn't load your settings" query={settingsQuery} />
          ) : (
            <>
              <Section
                title="Credentials"
                description="What Flywheel's agents sign in with, unless a project says otherwise."
              >
                {credentialsPhase === "skeleton" ? (
                  <CredentialsSkeleton />
                ) : loading || !settings || !globalMode ? null : (
                  <>
                    <CredentialChoice
                      value={globalMode}
                      disabled={globalMutation.isPending}
                      onSelect={(mode) => globalMutation.mutate(mode)}
                    />
                    {backendUnavailable && (
                      <Alert role="status">
                        <Info aria-hidden="true" />
                        <AlertDescription className="text-foreground">{BACKEND_UNAVAILABLE_NOTICE}</AlertDescription>
                      </Alert>
                    )}
                    {globalMode === "api_key" && (
                      <>
                        <Alert role="status" data-testid="api-key-precedence-notice">
                          <ShieldAlert aria-hidden="true" />
                          <AlertDescription className="text-foreground">{API_KEY_PRECEDENCE_NOTICE}</AlertDescription>
                        </Alert>
                        <ApiKeyField settings={settings} />
                      </>
                    )}
                  </>
                )}
              </Section>

              {!loading && settings && projects.length > 0 && (
                <Section
                  title="Per-project credentials"
                  description="A project can sign in differently from the default above."
                >
                  <ProjectOverrides settings={settings} />
                </Section>
              )}

              {!loading && settings && (
                <Section title="Notifications">
                  <NotificationsControl
                    settings={settings}
                    onChanged={() => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY })}
                  />
                </Section>
              )}
            </>
          )}

          <Section
            title="Open commands"
            description={
              <>
                What a worktree's Open in editor and Open in terminal run. Each is split into arguments and run
                directly, with <code className="font-mono text-small text-foreground">{"{worktree_path}"}</code>{" "}
                substituted; no shell is involved.
              </>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <OpenCommandTemplateField surface="editor" label="Open in editor" noun="editor" />
              <OpenCommandTemplateField surface="terminal" label="Open in terminal" noun="terminal" />
            </div>
          </Section>

          <Section
            title="Permission rules"
            description="Patterns you chose to always allow. Revoke one and its next request asks you again."
          >
            <PermissionRulesTable projects={projects} loadingProjects={projectsQuery.isPending} />
          </Section>
        </PageBody>
      </div>
    </div>
  );
}
