import { describe, expect, it } from "vitest";
import {
  BINDINGS,
  MENU_ACTION_IDS,
  actionLabel,
  allActionIds,
  bindingAllowedInLayer,
  resolveBinding,
  type ActionId,
  type UiLayer,
} from "../keyboard";

/**
 * Behavior under test (Phase 10 plan 10-01 Task 3, D-163):
 * - `open-fleet` is one global binding, present in the palette's action list and in the native menu's
 *   forwarded set, so a keystroke, the palette and the menu all reach it through one action id.
 * - No two bindings in the same region share a key-plus-modifier combination — RESEARCH assumed
 *   `⌘⇧F` was free without measuring it; this test is the measurement.
 * - The `fleet-surface` layer admits selection movement only and refuses the three permission-card
 *   ids, so a stray `a`/`d`/`Shift+A` over the fleet can never approve or deny a tool call (the
 *   permission card owns those keys and a later plan mounts it inside the fleet surface).
 */

describe("open-fleet", () => {
  it("is one global binding with a label", () => {
    const bindings = BINDINGS.filter((b) => b.id === "open-fleet");
    expect(bindings).toHaveLength(1);
    expect(bindings[0].region).toBe("global");
    expect(actionLabel("open-fleet")).toBe("Open Fleet");
    expect(allActionIds().filter((id) => id === "open-fleet")).toHaveLength(1);
  });

  it("is forwarded from the native menu through the same action id", () => {
    expect(MENU_ACTION_IDS).toContain("open-fleet");
  });

  it("is permitted on the board layer and nowhere that traps focus", () => {
    expect(bindingAllowedInLayer("open-fleet", "board")).toBe(true);
    expect(bindingAllowedInLayer("open-fleet", "quick-add")).toBe(true);
    expect(bindingAllowedInLayer("open-fleet", "palette")).toBe(false);
    expect(bindingAllowedInLayer("open-fleet", "picker")).toBe(false);
  });
});

describe("accelerator uniqueness", () => {
  it("no two bindings in one region share a key-plus-modifier combination", () => {
    const seen = new Map<string, ActionId>();
    for (const b of BINDINGS) {
      if (!b.key) continue;
      const signature = `${b.region}|${b.key}|meta:${Boolean(b.meta)}|shift:${Boolean(b.shift)}`;
      const previous = seen.get(signature);
      // The same action may be declared twice with identical keys only if it is the same id (none are
      // today); a different id on the same combination is a collision.
      if (previous !== undefined) {
        expect(previous, `${signature} is bound to both "${previous}" and "${b.id}"`).toBe(b.id);
      }
      seen.set(signature, b.id);
    }
  });

  it("⌘⇧F is bound to exactly one action across every region", () => {
    const holders = BINDINGS.filter((b) => b.key === "f" && b.meta && b.shift).map((b) => b.id);
    expect(holders).toEqual(["open-fleet"]);
  });

  it("⌘F still resolves to Search Board", () => {
    const event = { key: "f", metaKey: true, shiftKey: false, target: document.body };
    expect(resolveBinding(event, "board-list")?.id).toBe("focus-search");
  });
});

describe("the fleet-surface layer", () => {
  const layer: UiLayer = "fleet-surface";

  it("refuses the three permission-card ids", () => {
    const permissionIds: ActionId[] = [
      "answer-permission-allow",
      "answer-permission-deny",
      "answer-permission-allow-always",
    ];
    for (const id of permissionIds) {
      expect(bindingAllowedInLayer(id, layer), id).toBe(false);
    }
  });

  it("grants no binding on a, d or Shift+A in the fleet-surface region", () => {
    const clash = BINDINGS.filter(
      (b) => b.region === "fleet-surface" && (b.key === "a" || b.key === "d"),
    );
    expect(clash).toEqual([]);
    const event = (key: string, shift = false) => ({ key, metaKey: false, shiftKey: shift, target: document.body });
    expect(resolveBinding(event("a"), "fleet-surface")).toBeUndefined();
    expect(resolveBinding(event("d"), "fleet-surface")).toBeUndefined();
    expect(resolveBinding(event("a", true), "fleet-surface")).toBeUndefined();
  });

  it("admits selection movement and nothing else", () => {
    expect(bindingAllowedInLayer("move-down", layer)).toBe(true);
    expect(bindingAllowedInLayer("move-up", layer)).toBe(true);
    for (const id of ["stop-session", "accept-proposal", "open-settings", "open-fleet", "start-work"] as ActionId[]) {
      expect(bindingAllowedInLayer(id, layer), id).toBe(false);
    }
  });
});
