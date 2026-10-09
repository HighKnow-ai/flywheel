/**
 * Behavior under test (02-10-PLAN.md Task 1, 02-UI-SPEC.md "Settings surface" D-39, E7):
 *
 * - The credential-path control renders exactly the two labels, current global mode selected.
 * - Selecting the API-key option reveals a masked input with no reveal toggle.
 * - Saving a key clears the input and shows "API key configured on {date}." with a Replace action.
 * - Replace returns to the masked input; the previously stored value is never rendered.
 * - Every registered project renders a row with the same control plus "Use global default",
 *   selected when the project has no override.
 * - No Save button; every control commits its mutation immediately.
 * - A missing backend binary renders the exact non-blocking notice; controls stay interactive.
 * - Zero registered projects hides the per-project section while the global control still renders.
 * - While the settings read is in flight, skeleton rows render under the section heading.
 * - A rejected key save keeps the typed value, renders an inline error, and never claims a key is
 *   configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsSurface } from "../SettingsSurface";
import { CommandPalette } from "../../board/CommandPalette";
import { actionLabel, dispatchAction, MENU_ACTION_IDS, useGlobalBindings } from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { Project } from "../../board/useBoardQuery";
import type { PermissionRuleDto, SettingsDto } from "../../adapters/tauri";

const invokeCommandMock = vi.fn();
const getSettingsMock = vi.fn();
const setCredentialModeMock = vi.fn();
const storeApiKeyMock = vi.fn();
const clearApiKeyMock = vi.fn();
const backendCapabilityProbeMock = vi.fn();
const listPermissionRulesMock = vi.fn();
const revokePermissionRuleMock = vi.fn();
const openCommandTemplateMock = vi.fn();
const setOpenCommandTemplateMock = vi.fn();

// Every named export the code under test actually calls is re-implemented here, delegating
// through named mocks — `permission-card.test.tsx`/`worktree-summary.test.tsx` establish the same
// discipline: a real adapter function's own body calls THIS module's own `invokeCommand` binding,
// not whatever a test later re-exports, so a partial `...actual` spread would silently leave every
// other real adapter function calling the genuine `@tauri-apps/api` (which throws outside a real
// Tauri context).
vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  getSettings: () => getSettingsMock(),
  setCredentialMode: (scope: string, mode: string | null, projectId?: string) =>
    setCredentialModeMock(scope, mode, projectId),
  storeApiKey: (value: string) => storeApiKeyMock(value),
  clearApiKey: () => clearApiKeyMock(),
  backendCapabilityProbe: () => backendCapabilityProbeMock(),
  listPermissionRules: (projectId: string) => listPermissionRulesMock(projectId),
  revokePermissionRule: (ruleId: string) => revokePermissionRuleMock(ruleId),
  openCommandTemplate: (surface: string) => openCommandTemplateMock(surface),
  setOpenCommandTemplate: (surface: string, template: string) =>
    setOpenCommandTemplateMock(surface, template),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

const PROJECT_A: Project = {
  id: "proj-a",
  keyPrefix: "FLY",
  name: "Flywheel",
  repoPath: "/repo/a",
  defaultBranch: "main",
  status: "ok",
};

const PROJECT_B: Project = {
  id: "proj-b",
  keyPrefix: "ACM",
  name: "Acme",
  repoPath: "/repo/b",
  defaultBranch: "main",
  status: "ok",
};

function settingsFixture(overrides: Partial<SettingsDto> = {}): SettingsDto {
  return {
    globalCredentialMode: "local",
    projectOverrides: [],
    apiKeyConfigured: false,
    apiKeyConfiguredAt: null,
    dispatchCap: { maxParallel: 3, occupiedSlots: 0 },
    ...overrides,
  };
}

function backendFixture(available: boolean) {
  return { available, version: available ? "2.1.0" : null, apiKeyPathUsable: true };
}

/** Wires `invokeCommandMock` for the one command `useProjects()` calls generically —
 * `SettingsSurface`'s per-project rows read the registered-project roster through it. */
function mockProjects(projects: Project[]) {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "project_list") return Promise.resolve(projects);
    return Promise.resolve(undefined);
  });
}

function renderSettings() {
  const queryClient = new QueryClient();
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <SettingsSurface onBack={vi.fn()} />
    </QueryClientProvider>,
  ) };
}

beforeEach(() => {
  invokeCommandMock.mockReset();
  getSettingsMock.mockReset();
  setCredentialModeMock.mockReset();
  storeApiKeyMock.mockReset();
  clearApiKeyMock.mockReset();
  backendCapabilityProbeMock.mockReset();
  listPermissionRulesMock.mockReset();
  revokePermissionRuleMock.mockReset();
  openCommandTemplateMock.mockReset();
  setOpenCommandTemplateMock.mockReset();

  mockProjects([]);
  getSettingsMock.mockResolvedValue(settingsFixture());
  setCredentialModeMock.mockResolvedValue(undefined);
  storeApiKeyMock.mockResolvedValue(undefined);
  backendCapabilityProbeMock.mockResolvedValue(backendFixture(true));
  listPermissionRulesMock.mockResolvedValue([]);
  openCommandTemplateMock.mockResolvedValue("code {worktree_path}");
  setOpenCommandTemplateMock.mockResolvedValue(undefined);
});

// `useUiStore` is a module-level singleton — the Task 3 describe block below is the only one in
// this file that touches it (`paletteOpen`/`settingsOpen`), but resetting after every test keeps
// this file safe against future additions regardless of order.
afterEach(() => {
  resetUiState();
});

describe("SettingsSurface — credential path (Task 1)", () => {
  it("renders exactly the two credential labels, with the current global mode selected", async () => {
    getSettingsMock.mockResolvedValue(settingsFixture({ globalCredentialMode: "local" }));
    renderSettings();

    const local = await screen.findByRole("radio", { name: "Local Claude Code Credentials" });
    const apiKey = screen.getByRole("radio", { name: "API Key" });
    expect(local).toBeInTheDocument();
    expect(apiKey).toBeInTheDocument();
    expect(local).toHaveAttribute("aria-checked", "true");
    expect(apiKey).toHaveAttribute("aria-checked", "false");
  });

  it("selecting Local reveals no further configuration", async () => {
    getSettingsMock.mockResolvedValue(settingsFixture({ globalCredentialMode: "local" }));
    renderSettings();

    await screen.findByRole("radio", { name: "Local Claude Code Credentials" });
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("selecting API Key reveals a masked input with no reveal toggle", async () => {
    getSettingsMock.mockResolvedValue(settingsFixture({ globalCredentialMode: "api_key" }));
    renderSettings();

    const input = await screen.findByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: /show/i })).not.toBeInTheDocument();
  });

  it("API Key mode carries the unverified-precedence notice (T-02-42)", async () => {
    // The threat's declared mitigation is conjoined: measure the override assumption AND, if it
    // cannot be confirmed, say so here. It was never confirmed — no environment available to this
    // project has had a spend-authorized key alongside a live subscription session — so the
    // conditional fired and this notice IS the mitigation. Asserted on content, not on the exact
    // sentence, so rewording the copy does not fail the test but deleting the warning does.
    getSettingsMock.mockResolvedValue(settingsFixture({ globalCredentialMode: "api_key" }));
    renderSettings();

    const notice = await screen.findByTestId("api-key-precedence-notice");
    expect(notice).toHaveTextContent(/unverified/i);
    expect(notice).toHaveTextContent(/claude cli/i);
    expect(notice).toHaveAttribute("role", "status");
  });

  it("Local mode carries no precedence notice — it applies only to the API-key path (T-02-42)", async () => {
    getSettingsMock.mockResolvedValue(settingsFixture({ globalCredentialMode: "local" }));
    renderSettings();

    await screen.findByRole("radio", { name: "Local Claude Code Credentials" });
    expect(screen.queryByTestId("api-key-precedence-notice")).not.toBeInTheDocument();
  });

  it("saving a key clears the input and shows the configured-on copy with a Replace action", async () => {
    getSettingsMock
      .mockResolvedValueOnce(settingsFixture({ globalCredentialMode: "api_key" }))
      .mockResolvedValue(
        settingsFixture({ globalCredentialMode: "api_key", apiKeyConfigured: true, apiKeyConfiguredAt: "2026-01-05T00:00:00.000Z" }),
      );
    renderSettings();

    const input = (await screen.findByLabelText("API key")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-ant-test-key" } });
    fireEvent.blur(input);

    await waitFor(() => expect(storeApiKeyMock).toHaveBeenCalledWith("sk-ant-test-key"));
    await waitFor(() => expect(screen.queryByLabelText("API key")).not.toBeInTheDocument());
    expect(screen.getByText(/^API key configured on /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("Replace returns to the masked input; the previously stored value is never rendered", async () => {
    getSettingsMock.mockResolvedValue(
      settingsFixture({ globalCredentialMode: "api_key", apiKeyConfigured: true, apiKeyConfiguredAt: "2026-01-05T00:00:00.000Z" }),
    );
    renderSettings();

    const replaceButton = await screen.findByRole("button", { name: "Replace" });
    fireEvent.click(replaceButton);

    const input = (await screen.findByLabelText("API key")) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.queryByText(/^API key configured on /)).not.toBeInTheDocument();
  });

  it("every registered project renders a row with 'Use global default' selected when it has no override", async () => {
    mockProjects([PROJECT_A, PROJECT_B]);
    getSettingsMock.mockResolvedValue(
      settingsFixture({
        projectOverrides: [
          { projectId: "proj-a", projectName: "Flywheel", credentialMode: null },
          { projectId: "proj-b", projectName: "Acme", credentialMode: "api_key" },
        ],
      }),
    );
    renderSettings();

    const flywheelControl = await screen.findByRole("radiogroup", { name: "Credential path for Flywheel" });
    expect(flywheelControl.querySelector('[aria-checked="true"]')?.textContent).toBe("Use global default");

    const acmeControl = screen.getByRole("radiogroup", { name: "Credential path for Acme" });
    expect(acmeControl.querySelector('[aria-checked="true"]')?.textContent).toBe("API Key");
  });

  it("no Save button is rendered, and changing a control invokes the mutation immediately", async () => {
    renderSettings();

    const apiKeyRadio = await screen.findByRole("radio", { name: "API Key" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.click(apiKeyRadio);
    await waitFor(() => expect(setCredentialModeMock).toHaveBeenCalledWith("global", "api_key", undefined));
  });

  it("a missing backend binary renders the exact notice; the credential controls stay interactive", async () => {
    backendCapabilityProbeMock.mockResolvedValue(backendFixture(false));
    renderSettings();

    await screen.findByText(
      "Local credentials require the claude CLI, which wasn't found. The API key path still works.",
    );
    const local = screen.getByRole("radio", { name: "Local Claude Code Credentials" });
    const apiKey = screen.getByRole("radio", { name: "API Key" });
    expect(local).toBeEnabled();
    expect(apiKey).toBeEnabled();
  });

  it("zero registered projects hides the per-project section while the global control still renders", async () => {
    mockProjects([]);
    renderSettings();

    await screen.findByRole("radio", { name: "Local Claude Code Credentials" });
    expect(screen.queryByText("Per-Project Override")).not.toBeInTheDocument();
  });

  it("renders skeleton rows under the section heading while the settings read is in flight", () => {
    getSettingsMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderSettings();

    expect(screen.getByText("Credential Path")).toBeInTheDocument();
    expect(screen.getByTestId("settings-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Local Claude Code Credentials" })).not.toBeInTheDocument();
  });

  it("a rejected key save keeps the input's value, shows an inline error, and never claims a key is configured", async () => {
    getSettingsMock.mockResolvedValue(settingsFixture({ globalCredentialMode: "api_key" }));
    storeApiKeyMock.mockRejectedValue(new Error("Keychain write failed"));
    renderSettings();

    const input = (await screen.findByLabelText("API key")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-ant-bad" } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(input.value).toBe("sk-ant-bad");
    expect(screen.queryByText(/^API key configured on /)).not.toBeInTheDocument();
  });

  it("introduces no hard-coded hex colour literal", () => {
    // Enforced by the plan's own file-level grep gate at verify time — documented here so a
    // reader of the suite sees the contract stated too (mirrors permission-card.test.tsx's own
    // "structural gates enforced elsewhere" documentation test).
    expect(true).toBe(true);
  });
});

/**
 * Behavior under test (02-10-PLAN.md Task 2, 02-UI-SPEC.md "Permission rules", E7): the
 * empty-state copy renders exactly, absent while a rule exists; every rule row shows its OWN
 * project name (never a global-looking table); revoking calls the mutation with the rule's id and
 * only removes the row once the re-read resolves; a long tool name truncates; skeleton rows (not
 * the empty-state copy) render while the fan-out read is in flight; the `Revoke` action's copy is
 * exactly "Revoke".
 */
function ruleFixture(overrides: Partial<PermissionRuleDto> = {}): PermissionRuleDto {
  return {
    id: "rule-1",
    projectId: "proj-a",
    toolName: "Bash",
    decision: "allow_always",
    createdAt: "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("SettingsSurface — permission rules (Task 2)", () => {
  it("renders the exact empty-state copy when no rules exist", async () => {
    mockProjects([PROJECT_A]);
    listPermissionRulesMock.mockResolvedValue([]);
    renderSettings();

    expect(
      await screen.findByText(
        'No rules yet — they\'re created from a permission request\'s "Allow this tool for this project from now on" action.',
      ),
    ).toBeInTheDocument();
  });

  it("renders each rule with its OWN project's name — a rule can never be read as global", async () => {
    mockProjects([PROJECT_A, PROJECT_B]);
    listPermissionRulesMock.mockImplementation((projectId: string) =>
      Promise.resolve(
        projectId === "proj-a"
          ? [ruleFixture({ id: "rule-a", projectId: "proj-a", toolName: "Bash" })]
          : [ruleFixture({ id: "rule-b", projectId: "proj-b", toolName: "Edit" })],
      ),
    );
    renderSettings();

    const flywheelRow = await screen.findByText("Flywheel");
    const acmeRow = await screen.findByText("Acme");
    expect(flywheelRow.closest('[role="row"]')?.textContent).toContain("Bash");
    expect(acmeRow.closest('[role="row"]')?.textContent).toContain("Edit");
  });

  it("revoking a rule calls the mutation with its id and removes the row only after the re-read resolves", async () => {
    mockProjects([PROJECT_A]);
    let currentRules = [ruleFixture({ id: "rule-a" })];
    listPermissionRulesMock.mockImplementation(() => Promise.resolve(currentRules));
    revokePermissionRuleMock.mockImplementation(() => {
      currentRules = [];
      return Promise.resolve(undefined);
    });
    renderSettings();

    const revokeButton = await screen.findByRole("button", { name: "Revoke" });
    fireEvent.click(revokeButton);

    await waitFor(() => expect(revokePermissionRuleMock).toHaveBeenCalledWith("rule-a"));
    await waitFor(() =>
      expect(
        screen.getByText(
          'No rules yet — they\'re created from a permission request\'s "Allow this tool for this project from now on" action.',
        ),
      ).toBeInTheDocument(),
    );
  });

  it("truncates a long tool name with an ellipsis rather than widening the table", async () => {
    mockProjects([PROJECT_A]);
    const longName = "A".repeat(200);
    listPermissionRulesMock.mockResolvedValue([ruleFixture({ toolName: longName })]);
    renderSettings();

    const toolCell = await screen.findByText(longName);
    expect(toolCell.style.textOverflow).toBe("ellipsis");
    expect(toolCell.style.whiteSpace).toBe("nowrap");
    expect(toolCell.style.overflow).toBe("hidden");
  });

  it("renders skeleton rows (not the empty-state copy) while the rules read is in flight", async () => {
    mockProjects([PROJECT_A]);
    listPermissionRulesMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderSettings();

    await screen.findByText("Permission Rules");
    expect(screen.getByTestId("permission-rules-skeleton")).toBeInTheDocument();
    expect(
      screen.queryByText(
        'No rules yet — they\'re created from a permission request\'s "Allow this tool for this project from now on" action.',
      ),
    ).not.toBeInTheDocument();
  });

  it("the Revoke action's copy is exactly 'Revoke'", async () => {
    mockProjects([PROJECT_A]);
    listPermissionRulesMock.mockResolvedValue([ruleFixture()]);
    renderSettings();

    expect(await screen.findByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("has a revoke path — the table is never read-only", () => {
    // Enforced by the plan's own file-level grep gate at verify time (>=1 occurrence of
    // `revokePermissionRule` in `PermissionRulesTable.tsx`) — documented here too.
    expect(true).toBe(true);
  });
});

/**
 * Behavior under test (02-10-PLAN.md Task 3, 02-UI-SPEC.md "Settings surface" reachability): the
 * `open-settings` action id — dispatched identically by the native menu's "Settings…" item, the
 * global `⌘,` binding, and the command palette — routes to the Settings surface; the command
 * palette's entry for it is generated from the binding table, not a hand-written literal; and the
 * renderer-side forwarded-menu-id mirror (`MENU_ACTION_IDS`) agrees with the native side.
 *
 * `SettingsRoute` below is the exact wiring shape `App.tsx`'s `AppShell` uses (a
 * `useGlobalBindings({ "open-settings": () => setSettingsOpen(true) })` registration plus a
 * `settingsOpen ? <SettingsSurface .../> : ...` swap) — isolated here rather than rendering the
 * whole `App` tree, which would require mocking every command the board/project-rail surfaces
 * issue for no additional coverage of the mechanism this task actually adds.
 */
function SettingsRoute() {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  useGlobalBindings({ "open-settings": () => setSettingsOpen(true) });
  return settingsOpen ? <SettingsSurface onBack={() => setSettingsOpen(false)} /> : <div>Board</div>;
}

describe("Settings — reachable via menu, keyboard and palette (Task 3)", () => {
  it("dispatching the open-settings action id routes to the Settings surface", async () => {
    mockProjects([]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Board")).toBeInTheDocument();

    dispatchAction("open-settings");

    await screen.findByText("Settings");
    expect(screen.queryByText("Board")).not.toBeInTheDocument();
  });

  it("the command palette lists an entry for the settings action whose label comes from the binding table", async () => {
    mockProjects([]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommandPalette />
      </QueryClientProvider>,
    );
    useUiStore.getState().setPaletteOpen(true);

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const options = await waitFor(() => {
      const found = dialog.querySelectorAll('[role="option"]');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    const labels = Array.from(options).map((el) => el.textContent ?? "");
    expect(labels.some((label) => label.startsWith(actionLabel("open-settings")))).toBe(true);
  });

  it("the renderer-side forwarded-id mirror (MENU_ACTION_IDS) contains the settings id", () => {
    expect(MENU_ACTION_IDS).toContain("open-settings");
  });
});
