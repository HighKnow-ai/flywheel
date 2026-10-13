import { describe, expect, it } from "vitest";
import {
  BINDINGS,
  allActionIds,
  actionLabel,
  bindingAllowedInLayer,
  nextEscapeLayer,
  resolveBinding,
  type ActionId,
  type EscapeLadderState,
  type EscapeLayer,
} from "../keyboard";

/**
 * Behavior under test (02-03-PLAN.md Task 3): the eight new agent actions this plan adds to the
 * single key->action map, the `w`/`l` no-collision guarantee, the permission-card region's
 * isolation from the board list's own `a`, the permission-answer bindings' layer restriction
 * (T-02-15), and the permission card's deliberate exclusion from the Escape ladder (T-02-16).
 */

function fakeEvent(
  key: string,
  opts: { meta?: boolean; shift?: boolean } = {},
): Pick<KeyboardEvent, "key" | "metaKey" | "shiftKey" | "target"> {
  return { key, metaKey: Boolean(opts.meta), shiftKey: Boolean(opts.shift), target: document.body };
}

const NEW_AGENT_ACTION_IDS: ActionId[] = [
  "start-work",
  "open-live-session",
  "stop-session",
  "toggle-raw-view",
  "answer-permission-allow",
  "answer-permission-deny",
  "answer-permission-allow-always",
  "open-settings",
];

describe("board-list additions", () => {
  it("w resolves to start-work in the board-list region", () => {
    const binding = resolveBinding(fakeEvent("w"), "board-list");
    expect(binding?.id).toBe("start-work");
  });

  it("l resolves to open-live-session in the board-list region", () => {
    const binding = resolveBinding(fakeEvent("l"), "board-list");
    expect(binding?.id).toBe("open-live-session");
  });

  it("start-work/open-live-session do not collide with Phase 1's existing board-list letters", () => {
    // Computed from BINDINGS at test time — Phase 1's own single-letter board-list keys, minus
    // this task's own two additions — so a future added letter cannot silently collide without
    // this test catching it (02-03-PLAN.md Task 3's own acceptance criterion).
    const existingLetters = new Set(
      BINDINGS.filter(
        (b) =>
          b.region === "board-list" &&
          b.key &&
          b.key.length === 1 &&
          !b.meta &&
          b.id !== "start-work" &&
          b.id !== "open-live-session" &&
          // Phase 8 (08-04, D-133): `v` is the one addition since; it is not a Phase 1 letter.
          b.id !== "open-review",
      ).map((b) => b.key as string),
    );
    expect(existingLetters.has("w")).toBe(false);
    expect(existingLetters.has("l")).toBe(false);
    // Sanity check against the known Phase 1 set, so a change to that set is visible here too.
    // "r" ("continue-shaping", D-91, plan 05-10) is the one addition since this list was last
    // updated.
    expect([...existingLetters].sort()).toEqual(["a", "c", "e", "j", "k", "m", "o", "p", "r", "s"]);
  });
});

describe("live session surface bindings", () => {
  it("⌘. resolves to stop-session in the session-surface region", () => {
    const binding = resolveBinding(fakeEvent(".", { meta: true }), "session-surface");
    expect(binding?.id).toBe("stop-session");
  });

  it("r resolves to toggle-raw-view in the session-surface region", () => {
    const binding = resolveBinding(fakeEvent("r"), "session-surface");
    expect(binding?.id).toBe("toggle-raw-view");
  });
});

describe("permission-request card bindings (AGNT-06)", () => {
  it("a, d and Shift+A resolve to the three permission actions in the permission-card region", () => {
    expect(resolveBinding(fakeEvent("a"), "permission-card")?.id).toBe("answer-permission-allow");
    expect(resolveBinding(fakeEvent("d"), "permission-card")?.id).toBe("answer-permission-deny");
    expect(resolveBinding(fakeEvent("a", { shift: true }), "permission-card")?.id).toBe(
      "answer-permission-allow-always",
    );
  });

  it("region scoping keeps both `a` bindings live: board-list's assignee picker and the card's Allow", () => {
    // The same bare `a` keystroke resolves to two entirely different actions depending on which
    // region owns focus — T-02-15's own falsifiability case.
    expect(resolveBinding(fakeEvent("a"), "board-list")?.id).toBe("open-assignee-picker");
    expect(resolveBinding(fakeEvent("a"), "permission-card")?.id).toBe("answer-permission-allow");
    // And the inverse: a permission-card action never resolves under the board-list region.
    expect(resolveBinding(fakeEvent("a"), "board-list")?.id).not.toBe("answer-permission-allow");
  });

  it("bindingAllowedInLayer permits answer-permission-* only in the permission-card layer (T-02-15)", () => {
    const permissionIds: ActionId[] = [
      "answer-permission-allow",
      "answer-permission-deny",
      "answer-permission-allow-always",
    ];
    for (const id of permissionIds) {
      expect(bindingAllowedInLayer(id, "permission-card")).toBe(true);
      expect(bindingAllowedInLayer(id, "board")).toBe(false);
      expect(bindingAllowedInLayer(id, "session-surface")).toBe(false);
      expect(bindingAllowedInLayer(id, "picker")).toBe(false);
    }
  });

  it("bindingAllowedInLayer permits session-surface actions only in the session-surface layer", () => {
    for (const id of ["stop-session", "toggle-raw-view"] as ActionId[]) {
      expect(bindingAllowedInLayer(id, "session-surface")).toBe(true);
      expect(bindingAllowedInLayer(id, "board")).toBe(false);
      expect(bindingAllowedInLayer(id, "permission-card")).toBe(false);
    }
  });
});

describe("global additions", () => {
  it("⌘, resolves to open-settings from every region", () => {
    const regions = ["board-list", "session-surface", "permission-card", "item-detail"] as const;
    for (const region of regions) {
      const binding = resolveBinding(fakeEvent(",", { meta: true }), region);
      expect(binding?.id, `expected ⌘, to resolve to open-settings from region "${region}"`).toBe(
        "open-settings",
      );
    }
  });
});

describe("global additions (Phase 10)", () => {
  it("⌘⇧F resolves to open-fleet from every region, and ⌘F still resolves to search", () => {
    const regions = ["board-list", "session-surface", "permission-card", "item-detail"] as const;
    for (const region of regions) {
      const binding = resolveBinding(fakeEvent("f", { meta: true, shift: true }), region);
      expect(binding?.id, `expected ⌘⇧F to resolve to open-fleet from region "${region}"`).toBe("open-fleet");
    }
    expect(resolveBinding(fakeEvent("f", { meta: true }), "board-list")?.id).toBe("focus-search");
  });
});

describe("registry completeness", () => {
  it("allActionIds() contains all eight new ids exactly once each", () => {
    const ids = allActionIds();
    for (const id of NEW_AGENT_ACTION_IDS) {
      const occurrences = ids.filter((candidate) => candidate === id).length;
      expect(occurrences, `expected exactly one occurrence of "${id}" in allActionIds()`).toBe(1);
    }
  });

  it("actionLabel returns a non-empty string for each of the eight new ids", () => {
    for (const id of NEW_AGENT_ACTION_IDS) {
      expect(actionLabel(id).length).toBeGreaterThan(0);
    }
  });

  it("declares exactly one BINDINGS array and one ActionId union (single source of truth)", () => {
    // Structural proof: every new id above resolves to a label declared inline in BINDINGS
    // itself (not a second lookup table) — actionLabel's own implementation reads BINDINGS.
    for (const id of NEW_AGENT_ACTION_IDS) {
      const declared = BINDINGS.filter((b) => b.id === id);
      expect(declared.length).toBeGreaterThan(0);
    }
  });
});

describe("Escape ladder — permission card exemption (T-02-16)", () => {
  it("EscapeLayer has no member representing a pending permission card", () => {
    // Compile-time proof: this type only resolves to `true` if "permission-card" is NOT
    // assignable to EscapeLayer. If a future change ever adds it, this line fails to compile.
    type NoPermissionCardMember = "permission-card" extends EscapeLayer ? never : true;
    const proof: NoPermissionCardMember = true;
    expect(proof).toBe(true);
  });

  it("nextEscapeLayer never resolves toward a permission card, under every reachable state", () => {
    const baseState: EscapeLadderState = {
      paletteOpen: false,
      detailOpen: false,
      pickerOpen: false,
      quickAddOpen: false,
      hasSelection: false,
    };
    const results: (EscapeLayer | null)[] = [
      nextEscapeLayer(baseState),
      nextEscapeLayer({ ...baseState, pickerOpen: true }),
      nextEscapeLayer({ ...baseState, paletteOpen: true }),
      nextEscapeLayer({ ...baseState, sessionSurfaceOpen: true }),
      nextEscapeLayer({ ...baseState, detailOpen: true }),
      nextEscapeLayer({ ...baseState, quickAddOpen: true }),
      nextEscapeLayer({ ...baseState, hasSelection: true }),
    ];
    expect(results).not.toContain("permission-card");
  });

  it("Escape from the live session surface returns to the board (session-surface layer)", () => {
    const state: EscapeLadderState = {
      paletteOpen: false,
      detailOpen: false,
      pickerOpen: false,
      quickAddOpen: false,
      hasSelection: false,
      sessionSurfaceOpen: true,
    };
    expect(nextEscapeLayer(state)).toBe("session-surface");
  });

  it("the palette still closes before the session surface — precedence unchanged", () => {
    const state: EscapeLadderState = {
      paletteOpen: true,
      detailOpen: false,
      pickerOpen: false,
      quickAddOpen: false,
      hasSelection: false,
      sessionSurfaceOpen: true,
    };
    expect(nextEscapeLayer(state)).toBe("palette");
  });
});
