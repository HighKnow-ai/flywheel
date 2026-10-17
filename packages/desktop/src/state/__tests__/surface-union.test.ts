/**
 * Phase 13 plan 13-08 (FNC-06): which surface is showing is one modelled value, resolved in one
 * place beside `topLayer`. These cases pin the precedence order the nested ternary in `App.tsx`
 * encoded, including the two deliberate orderings (fleet and worktree inventory sit BELOW the
 * session so a session opened from either lands back on it). A refactor that silently changes
 * which surface wins would discard work the user cannot see was discarded.
 */
import { describe, expect, it } from "vitest";
import { activeSurface, type SurfaceState } from "../keyboard";

const NONE: SurfaceState = {
  settingsOpen: false,
  sessionOpen: false,
  fleetOpen: false,
  worktreeInventoryOpen: false,
  projectUnreachable: false,
};
const state = (over: Partial<SurfaceState>): SurfaceState => ({ ...NONE, ...over });

describe("activeSurface precedence", () => {
  it("returns board when nothing is open", () => {
    expect(activeSurface(NONE)).toBe("board");
  });
  it("settings wins over a session", () => {
    expect(activeSurface(state({ settingsOpen: true, sessionOpen: true }))).toBe("settings");
  });
  it("the session wins over the fleet", () => {
    expect(activeSurface(state({ sessionOpen: true, fleetOpen: true }))).toBe("session");
  });
  it("fleet shows when there is no session", () => {
    expect(activeSurface(state({ fleetOpen: true }))).toBe("fleet");
  });
  it("worktree inventory shows when there is no session and no fleet", () => {
    expect(activeSurface(state({ worktreeInventoryOpen: true }))).toBe("worktree-inventory");
  });
  it("fleet wins over the worktree inventory", () => {
    expect(activeSurface(state({ fleetOpen: true, worktreeInventoryOpen: true }))).toBe("fleet");
  });
  it("an unreachable project shows project-unreachable when no surface is open", () => {
    expect(activeSurface(state({ projectUnreachable: true }))).toBe("project-unreachable");
  });
  it("a session wins over an unreachable project", () => {
    expect(activeSurface(state({ projectUnreachable: true, sessionOpen: true }))).toBe("session");
  });
  it("is deterministic", () => {
    const s = state({ settingsOpen: true, fleetOpen: true });
    expect(activeSurface(s)).toBe(activeSurface(s));
  });
});
