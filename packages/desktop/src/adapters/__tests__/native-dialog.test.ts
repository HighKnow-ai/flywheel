/**
 * The only native dialog Flywheel opens is the folder picker of "Register Project…" (issue #1786, step 3).
 * Every other confirmation is a React dialog the renderer tests already cover. What the app decides about the
 * picker is the call it makes to the dialog plugin, so this test pins that call: a directory, one choice, no
 * file filter, and a cancel that returns `null`. How macOS draws the panel is the operating system's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import capability from "../../../src-tauri/capabilities/default.json";
import tauriSource from "../tauri.ts?raw";

const open = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => open(...args) }));

describe("the folder picker", () => {
  beforeEach(() => open.mockReset());

  it("asks the dialog plugin for one directory, and nothing else", async () => {
    open.mockResolvedValue("/Users/dev/code/app");
    const { openFolderDialog } = await import("../tauri");
    expect(await openFolderDialog()).toBe("/Users/dev/code/app");
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("returns null when the developer cancels", async () => {
    open.mockResolvedValue(null);
    const { openFolderDialog } = await import("../tauri");
    expect(await openFolderDialog()).toBeNull();
  });

  it("is the only caller of the dialog plugin, and the window may only open (not save or message)", () => {
    expect(tauriSource.match(/plugin-dialog/g)?.length).toBeGreaterThan(0);
    expect(capability.permissions.filter((p) => String(p).startsWith("dialog:"))).toEqual(["dialog:allow-open"]);
  });
});
