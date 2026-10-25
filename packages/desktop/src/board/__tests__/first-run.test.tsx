/**
 * Behavior under test (CR-02/IN-01, 01-REVIEW.md): `deriveKeyPrefix` must always emit a prefix
 * `core::domain::project::validate_key_prefix` accepts (2-10 uppercase letters/digits, starting
 * with a letter) — a directory name like `2024-app` or a single-character name used to derive an
 * invalid prefix, which the registration entry points that register immediately had no way to recover from.
 *
 * Issue #210 (critique F4): first run is Empty with a filled primary; Register project is a Dialog with a
 * Field and Input for the key; a failure is an Alert with a human line and the raw detail behind Details.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirstRun, deriveKeyPrefix } from "../FirstRun";

const openFolderMock = vi.fn(() => Promise.resolve<string | null>(null));
const invokeCommandMock = vi.fn((_command: string, _args?: unknown) => Promise.resolve<unknown>(undefined));

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  fleetBlockedQueue: () => Promise.resolve([]),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => openFolderMock(),
}));

beforeEach(() => {
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation(() => Promise.resolve(undefined));
});
afterEach(cleanup);

function withClient(node: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {node}
    </QueryClientProvider>,
  );
}

// The brand mark on this surface and the rail is asserted in theme/__tests__/brand-mark.test.tsx (issue #196).

/** Mirrors `core::domain::project::validate_key_prefix` exactly, so this test proves the same
 * contract the backend enforces, not a looser JS-side approximation of it. */
function isValidKeyPrefix(prefix: string): boolean {
  return /^[A-Z][A-Z0-9]{1,9}$/.test(prefix);
}

describe("deriveKeyPrefix", () => {
  it("derives the expected prefix for an ordinary directory name", () => {
    expect(deriveKeyPrefix("/repos/my-app")).toBe("MYAP");
  });

  it("hardens a digit-leading directory name into a valid, letter-led prefix (CR-02)", () => {
    const prefix = deriveKeyPrefix("/repos/2024-app");
    expect(prefix).toBe("P202");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("hardens a single-character directory name into a valid, 2+ character prefix", () => {
    const prefix = deriveKeyPrefix("/repos/x");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("hardens a directory name with no alphanumeric characters at all", () => {
    const prefix = deriveKeyPrefix("/repos/___");
    expect(prefix).toBe("PRJ");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("never emits a prefix validate_key_prefix would reject, across a spread of realistic names", () => {
    const names = ["2024-app", "_x", "a", "99bottles", "my-app", "___", "1", "Flywheel", "___2025___"];
    for (const name of names) {
      const prefix = deriveKeyPrefix(`/repos/${name}`);
      expect(isValidKeyPrefix(prefix)).toBe(true);
    }
  });
});

describe("first run (issue #210)", () => {
  it("is Empty on the floor, with a heading, one line and the filled primary", () => {
    withClient(<FirstRun />);
    const heading = screen.getByRole("heading", { level: 1, name: "No projects yet" });
    expect(heading.closest("[data-slot=empty]")).not.toBeNull();
    const register = screen.getByRole("button", { name: "Register project…" });
    // The filled primary (`default`), never an outline with a permanent ring.
    expect(register).toHaveAttribute("data-variant", "default");
  });

  it("names the action in sentence case, as the rail does", () => {
    withClient(<FirstRun />);
    expect(screen.queryByRole("button", { name: "Register Project…" })).toBeNull();
  });
});

/** 08.1 group-six closure, now on a Dialog (#210): the confirm-the-key step says what it asks for, about which folder. */
describe("the register dialog", () => {
  async function reachRegisterStep() {
    openFolderMock.mockResolvedValue("/Users/dev/repos/threadfin");
    withClient(<FirstRun />);
    fireEvent.click(screen.getByRole("button", { name: "Register project…" }));
    return screen.findByRole("dialog", { name: "Register threadfin" });
  }

  it("is the shadcn Dialog, carrying the shared overlay motion in and out", async () => {
    const dialog = await reachRegisterStep();
    expect(dialog).toHaveAttribute("data-slot", "dialog-content");
    expect(dialog.className).toMatch(/data-open:animate-in/);
    expect(dialog.className).toMatch(/data-closed:animate-out/);
  });

  it("asks for the key in a labelled Field, filled with the derived default", async () => {
    const dialog = await reachRegisterStep();
    const input = within(dialog).getByRole("textbox", { name: "Project key" });
    expect(input).toHaveAttribute("data-slot", "input");
    expect(input.closest("[data-slot=field]")).not.toBeNull();
    expect((input as HTMLInputElement).value).toBe("THRE");
    expect(within(dialog).getByText(/Every Story key starts with it/)).toBeInTheDocument();
  });

  it("prints the folder just picked, so the permanent key can be tied to something", async () => {
    const dialog = await reachRegisterStep();
    expect(within(dialog).getByText("/Users/dev/repos/threadfin")).toBeInTheDocument();
  });

  it("registers with the key as typed, upper-cased", async () => {
    const dialog = await reachRegisterStep();
    const input = within(dialog).getByRole("textbox", { name: "Project key" });
    fireEvent.change(input, { target: { value: "tf" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Register project" }));
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("project_register", {
        name: "threadfin",
        repoPath: "/Users/dev/repos/threadfin",
        keyPrefix: "TF",
      }),
    );
  });

  it("Cancel closes the dialog without registering anything", async () => {
    const dialog = await reachRegisterStep();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
    expect(invokeCommandMock).not.toHaveBeenCalledWith("project_register", expect.anything());
  });

  it("says a failure as an Alert: a human line, and the raw message behind Details in the code face", async () => {
    const raw = "/Users/dev/repos/threadfin is not a git repository (git rev-parse --show-toplevel exited 128)";
    invokeCommandMock.mockImplementation((command: string) =>
      command === "project_register" ? Promise.reject(raw) : Promise.resolve(undefined),
    );
    const dialog = await reachRegisterStep();
    fireEvent.click(within(dialog).getByRole("button", { name: "Register project" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveAttribute("data-slot", "action-failure");
    expect(within(alert).getByText("Couldn’t register threadfin")).toBeInTheDocument();
    expect(within(alert).getByText(/isn’t a git repository/)).toBeInTheDocument();
    // The raw command is folded away until asked for.
    expect(within(alert).queryByText(raw)).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Details" }));
    const detail = await within(alert).findByText(raw);
    expect(detail.className).toMatch(/font-mono/);
    // Two hyphens stay two hyphens: the code face, with no ligature to join them into a dash.
    expect(detail.textContent).toContain("--show-toplevel");
    expect(detail.className).toMatch(/font-variant-ligatures:none/);
  });

  it("blames the folder, not the key, when the folder is not a git checkout, and offers another folder", async () => {
    invokeCommandMock.mockImplementation((command: string) =>
      command === "project_register"
        ? Promise.reject("/Users/dev/repos/threadfin is not a git repository")
        : Promise.resolve(undefined),
    );
    const dialog = await reachRegisterStep();
    fireEvent.click(within(dialog).getByRole("button", { name: "Register project" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByRole("textbox", { name: "Project key" })).not.toHaveAttribute("aria-invalid");
    expect(within(dialog).queryByRole("button", { name: "Register project" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Choose another folder…" })).toBeInTheDocument();
  });

  it("marks the key field when the key is what was refused", async () => {
    invokeCommandMock.mockImplementation((command: string) =>
      command === "project_register" ? Promise.reject("invalid key prefix 'x'") : Promise.resolve(undefined),
    );
    const dialog = await reachRegisterStep();
    fireEvent.click(within(dialog).getByRole("button", { name: "Register project" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByRole("textbox", { name: "Project key" })).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("button", { name: "Register project" })).toBeInTheDocument();
  });
});
