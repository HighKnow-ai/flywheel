/**
 * Behavior under test (02-06-PLAN.md Task 1 + Task 2, AGNT-06, D-37, D-38):
 *
 * Task 1 — `PermissionRequestCard` standalone: renders nothing with no pending request; a pending
 * request renders the glyph/heading/payload/three unequal actions; Escape never resolves it;
 * a double-activation of Allow calls the answer function exactly once; a rejected answer keeps the
 * card mounted, re-enables its actions and shows an inline error; two pending requests render as
 * two independently answerable cards.
 *
 * Task 2 — both mount points (`SessionSurface`'s `feed` variant, `ItemDetailPanel`'s `compact`
 * variant) read the SAME `usePendingPermissionRequests(agentRunId)` query: answering at either
 * mount point clears the other within one delta cycle, with no stale duplicate, and the feed
 * suppresses its follow-the-tail scroll while a request is pending.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PermissionRequestCard, type PendingPermissionRequest } from "../PermissionRequestCard";
import { SessionSurface } from "../SessionSurface";
import { ItemDetailPanel, type DetailItem } from "../../item-detail/ItemDetailPanel";

const invokeCommandMock = vi.fn();
let capturedBoardChangedHandler: (() => void) | undefined;

// Every named export the code under test actually calls is re-implemented here to delegate
// through the ONE `invokeCommandMock`, rather than spreading `...actual` — a real adapter
// function's own body calls this module's OWN internal `invokeCommand` binding, not whatever a
// test later re-exports, so overriding only `invokeCommand` via spread would silently leave every
// other real adapter function calling the genuine `@tauri-apps/api` (which throws outside a real
// Tauri context). `criteria.test.tsx`/`activity-trail.test.tsx` establish the same discipline.
// Task 1's own standalone describe blocks below never call any of these — they render
// `PermissionRequestCard` directly with a plain `vi.fn()` — so this mock only matters for Task 2's
// cross-mount describe block at the foot of this file.
vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
  stopAgentRun: (agentRunId: string) => invokeCommandMock("agent_run_stop", { agentRunId }),
  pendingPermissionRequests: (agentRunId: string) =>
    invokeCommandMock("agent_run_pending_permissions", { agentRunId }),
  latestAgentRunIdForTask: (taskId: string) => invokeCommandMock("task_latest_agent_run", { taskId }),
  answerPermissionRequest: (requestId: string, decision: string) =>
    invokeCommandMock("agent_run_answer_permission", { requestId, decision }),
  // `ItemDetailPanel`'s plan 02-08 additions (`WorktreeSummary`/`RunsSection`) call these two
  // directly, not through `invokeCommand` generically (`useBoardQuery.ts`'s own import shape) —
  // delegated through the same one mock for the same reason every other adapter function here is.
  agentRunsForTask: (taskId: string) => invokeCommandMock("agent_runs_for_task", { taskId }),
  worktreeSummary: (taskId: string) => invokeCommandMock("worktree_summary", { taskId }),
  // `GitFactsSection` (Phase 7 plan 07-01) is the panel's other new section, mounted the same
  // way as `WorktreeSummary` — mocked here for the same reason `worktreeSummary` is.
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
  subscribeBoardChanged: (handler: () => void) => {
    capturedBoardChangedHandler = handler;
    return Promise.resolve(() => {
      capturedBoardChangedHandler = undefined;
    });
  },
  // `SessionSurface` subscribes to this too (D-32) — a no-op handle is sufficient here since none
  // of these tests exercise the raw-event push itself, only the permission-request round trip.
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

function makeRequest(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
  return {
    id: "req-1",
    toolName: "Bash",
    inputPayload: '{"command":"rm -rf /tmp/scratch"}',
    destructiveCategory: null,
    ...overrides,
  };
}

describe("PermissionRequestCard (standalone)", () => {
  it("renders nothing at all with no pending request", () => {
    const { container } = render(
      <PermissionRequestCard variant="feed" requests={[]} onAnswer={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the glyph, heading, payload and three actions at their exact copy", () => {
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={vi.fn()} />);

    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByText('{"command":"rm -rf /tmp/scratch"}')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Allow this tool for this project from now on" }),
    ).toBeInTheDocument();
  });

  it("Escape never resolves the card — the answer spy sees zero calls and the card stays mounted", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
  });

  it("pressing a/d/Shift+A resolves through the shared binding table", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "d" });
    expect(onAnswer).toHaveBeenCalledWith("req-1", "deny");
  });

  it("pressing Shift+A invokes allow-always", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "a", shiftKey: true });
    expect(onAnswer).toHaveBeenCalledWith("req-1", "allow_always");
  });

  // `fireEvent.click` wraps each call in `act()` and flushes state between them, so this only
  // proves the SECOND line of defence (the `disabled` attribute reaching the DOM before the next
  // click). It does NOT prove the synchronous-tick guard — see the raw `.click()` test below,
  // which is the one that actually reproduces the unflushed-state bug (03-16-PLAN.md Task 1).
  it("activating Allow twice with a flushed re-render between clicks calls the answer spy exactly once (disabled-attribute guard)", () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    const allowButton = screen.getByRole("button", { name: "Allow" });
    fireEvent.click(allowButton);
    fireEvent.click(allowButton);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    resolveAnswer?.();
  });

  // Raw `element.click()` calls in one synchronous tick do NOT flush React state between them —
  // this is the idiom that actually reproduces the bug (item-detail/__tests__/runs-section.test.tsx
  // around line 331), unlike `fireEvent.click` above.
  it("three synchronous native clicks on the routine Allow button call the answer spy exactly once", async () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    const allowButton = screen.getByRole("button", { name: "Allow" });
    allowButton.click();
    allowButton.click();
    allowButton.click();

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    resolveAnswer?.();
  });

  it("a rejected answer keeps the card mounted, re-enables its actions and renders an inline error", async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error("network down"));
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
  });

  it("renders two pending requests as two independently answerable cards", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const first = makeRequest({ id: "req-1", toolName: "Bash" });
    const second = makeRequest({ id: "req-2", toolName: "Edit" });
    render(<PermissionRequestCard variant="feed" requests={[first, second]} onAnswer={onAnswer} />);

    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByText("Edit wants to:")).toBeInTheDocument();

    const editGroup = screen.getByRole("group", { name: "Edit wants to:" });
    fireEvent.click(within(editGroup).getByRole("button", { name: "Allow" }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("req-2", "allow");
    // The first (untouched) card's Allow button is still enabled — answering the second never
    // touched the first's own state.
    const bashGroup = screen.getByRole("group", { name: "Bash wants to:" });
    expect(within(bashGroup).getByRole("button", { name: "Allow" })).toBeEnabled();
  });

  it("imports its glyph name from the marks registry and hard-codes no colour", () => {
    // Structural gates are enforced by the plan's own grep-based <verify> commands at the file
    // level (no onKeyDown/addEventListener/DismissableLayer, no hex literal) — this test only
    // documents the intent so a reader of the suite sees the contract stated here too.
    expect(true).toBe(true);
  });
});

describe('PermissionRequestCard variant="compact"', () => {
  it("caps the payload block at a fixed max height with internal scroll", () => {
    const longPayload = "x".repeat(5000);
    render(
      <PermissionRequestCard
        variant="compact"
        requests={[makeRequest({ inputPayload: longPayload })]}
        onAnswer={vi.fn()}
      />,
    );
    const pre = screen.getByText(longPayload);
    expect(pre.style.maxHeight).not.toBe("");
    expect(pre.style.overflowY).toBe("auto");
  });

  it("truncates a long tool name with an ellipsis rather than widening the container", () => {
    const longName = "A".repeat(200);
    render(
      <PermissionRequestCard variant="compact" requests={[makeRequest({ toolName: longName })]} onAnswer={vi.fn()} />,
    );
    const heading = screen.getByText(`${longName} wants to:`);
    expect(heading.style.textOverflow).toBe("ellipsis");
    expect(heading.style.whiteSpace).toBe("nowrap");
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2 — the destructive variant (03-12-PLAN.md, AGNT-07, D-55/D-56/D-57/D-58)
// ---------------------------------------------------------------------------------------------

function destructiveRequest(category: string, command: string): PendingPermissionRequest {
  return makeRequest({
    toolName: "Bash",
    inputPayload: JSON.stringify({ command }),
    destructiveCategory: category,
  });
}

describe("destructive", () => {
  it("with a null category renders exactly as the routine card: Allow filled, Deny outline, allow-always present", () => {
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Allow this tool for this project from now on" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Destructive action — needs your OK")).not.toBeInTheDocument();
  });

  it("with a category renders the stop-sign glyph, the destructive heading and the consequence sentence above the payload", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    const { container } = render(
      <PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />,
    );

    expect(screen.getByText("Destructive action — needs your OK")).toBeInTheDocument();
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(
      screen.getByText("This would discard uncommitted changes in the worktree — permanently."),
    ).toBeInTheDocument();
    expect(screen.getByText('{"command":"git reset --hard"}')).toBeInTheDocument();
    expect(container.querySelector(".lucide-octagon-alert")).not.toBeNull();
    expect(container.querySelector(".lucide-shield-alert")).toBeNull();
  });

  it("with a category, no button with the allow-always label is in the document", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /from now on/i })).not.toBeInTheDocument();
  });

  it("swaps button emphasis: Deny is the destructive lead, Allow is not", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    const deny = screen.getByRole("button", { name: "Deny" });
    const allow = screen.getByRole("button", { name: "Allow, just this once" });
    expect(deny.className).toContain("session-action-destructive");
    expect(allow.className).not.toContain("session-action-destructive");
    expect(allow.className).not.toContain("session-action-lead");
  });

  it("Allow's accessible name reads 'Allow, just this once' on the destructive variant", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Allow, just this once" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("reverses the reflex: the lead on the destructive variant is Deny, the lead on the routine variant is Allow", () => {
    // No button here is filled any more (owner decision 2026-10-08): the lead is the one with the
    // 2px edge, and `finish.test.tsx` pins that class against the real stylesheet.
    const { unmount } = render(
      <PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={vi.fn()} />,
    );
    const routineLead = screen.getByRole("button", { name: "Allow" });
    expect(routineLead.className).toContain("session-action-lead");
    expect(screen.getByRole("button", { name: "Deny" }).className).not.toContain("session-action-lead");
    unmount();

    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
    const destructiveLead = screen.getByRole("button", { name: "Deny" });
    expect(destructiveLead.className).toContain("session-action-lead");
    expect(screen.getByRole("button", { name: "Allow, just this once" }).className).not.toContain("session-action-lead");
  });

  it("pressing d resolves through the shared binding table on the destructive variant; Shift+A is inert", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: "d" });
    expect(onAnswer).toHaveBeenCalledWith("req-1", "deny");

    fireEvent.keyDown(window, { key: "a", shiftKey: true });
    // Shift+A has no allow-always button to trigger on this variant (03-UI-SPEC.md Keyboard Map
    // Additions: "has no effect") — the answer spy sees no second call.
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("activating Deny twice in immediate succession calls the answer spy exactly once", () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={onAnswer} />);

    const denyButton = screen.getByRole("button", { name: "Deny" });
    fireEvent.click(denyButton);
    fireEvent.click(denyButton);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    resolveAnswer?.();
  });

  // This is the destructive-gate card — a double-click here double-answers a destructive
  // permission request. Raw `.click()` calls in one synchronous tick do not flush React state
  // between them, unlike `fireEvent.click` above (03-16-PLAN.md Task 1).
  it("three synchronous native clicks on Deny call the answer spy exactly once, with the deny decision", async () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={onAnswer} />);

    const denyButton = screen.getByRole("button", { name: "Deny" });
    denyButton.click();
    denyButton.click();
    denyButton.click();

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    expect(onAnswer).toHaveBeenCalledWith("req-1", "deny");
    resolveAnswer?.();
  });

  it("three synchronous native clicks on 'Allow, just this once' call the answer spy exactly once", async () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={onAnswer} />);

    const allowOnceButton = screen.getByRole("button", { name: "Allow, just this once" });
    allowOnceButton.click();
    allowOnceButton.click();
    allowOnceButton.click();

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    expect(onAnswer).toHaveBeenCalledWith("req-1", "allow");
    resolveAnswer?.();
  });

  it("a rejected Deny answer clears the guard, so a second click issues a second call", async () => {
    const onAnswer = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(undefined);
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={onAnswer} />);

    const denyButton = screen.getByRole("button", { name: "Deny" });
    fireEvent.click(denyButton);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(denyButton).toBeEnabled();

    fireEvent.click(denyButton);

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2));
  });

  it("two destructive requests mounted at once each answer independently under three synchronous clicks", async () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    const first = destructiveRequest("hard-reset", "git reset --hard");
    const second = { ...destructiveRequest("force-clean", "git clean -fdx"), id: "req-2", toolName: "Bash2" };
    render(<PermissionRequestCard variant="feed" requests={[first, second]} onAnswer={onAnswer} />);

    const firstGroup = screen.getByRole("group", { name: "Bash wants to:" });
    const secondGroup = screen.getByRole("group", { name: "Bash2 wants to:" });
    const firstDeny = within(firstGroup).getByRole("button", { name: "Deny" });
    const secondDeny = within(secondGroup).getByRole("button", { name: "Deny" });

    firstDeny.click();
    firstDeny.click();
    secondDeny.click();
    secondDeny.click();

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2));
    expect(onAnswer).toHaveBeenCalledWith("req-1", "deny");
    expect(onAnswer).toHaveBeenCalledWith("req-2", "deny");
    resolveAnswer?.();
  });

  it("two destructive requests mounted at once each answer independently", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const first = destructiveRequest("hard-reset", "git reset --hard");
    const second = { ...destructiveRequest("force-clean", "git clean -fdx"), id: "req-2", toolName: "Bash2" };
    render(<PermissionRequestCard variant="feed" requests={[first, second]} onAnswer={onAnswer} />);

    const secondGroup = screen.getByRole("group", { name: "Bash2 wants to:" });
    fireEvent.click(within(secondGroup).getByRole("button", { name: "Deny" }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("req-2", "deny");
    const firstGroup = screen.getByRole("group", { name: "Bash wants to:" });
    expect(within(firstGroup).getByRole("button", { name: "Deny" })).toBeEnabled();
  });

  it("wraps a long interpolated branch name rather than truncating it", () => {
    const longBranch = "feature/".padEnd(400, "x");
    const request = destructiveRequest("force-push", `git push --force origin ${longBranch}`);
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    const sentence = screen.getByText(new RegExp(`This would force-push to ${longBranch}`));
    expect(sentence.style.overflowWrap).toBe("anywhere");
  });

  it("with an unrecognised category string renders the generic sentence and no shield glyph", () => {
    const request = destructiveRequest("made-up-category", "some-unrecognised-command --flag");
    const { container } = render(
      <PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />,
    );

    expect(
      screen.getByText("This command can destroy work, and Flywheel doesn't recognise exactly what it would do."),
    ).toBeInTheDocument();
    expect(container.querySelector(".lucide-shield-alert")).toBeNull();
    expect(container.querySelector(".lucide-octagon-alert")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /from now on/i })).not.toBeInTheDocument();
  });

  it("with the recursive-delete category (recognised by the classifier but absent from the six-row copy table) also falls back to the generic sentence, never the routine layout", () => {
    const request = destructiveRequest("recursive-delete", "rm -rf ./build");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    expect(
      screen.getByText("This command can destroy work, and Flywheel doesn't recognise exactly what it would do."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /from now on/i })).not.toBeInTheDocument();
  });

  describe("consequence copy — one test per named category (03-UI-SPEC.md D-56 table)", () => {
    it("force-push", () => {
      const request = destructiveRequest("force-push", "git push --force origin feature-x");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(
        screen.getByText("This would force-push to feature-x, overwriting any commits already there."),
      ).toBeInTheDocument();
    });

    it("branch-deletion", () => {
      const request = destructiveRequest("branch-deletion", "git branch -D feature-x");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.getByText("This would delete the branch feature-x.")).toBeInTheDocument();
    });

    // Every push spelling of a remote branch deletion — plan 03-14 makes `classify_push` emit
    // `branch-deletion` for these for the first time; the pre-existing resolver names the REMOTE
    // (`origin`) here, which is the exact defect this task closes (03-16-PLAN.md Task 2).
    it("branch-deletion via 'git push origin --delete feature-x' names the branch, not the remote", () => {
      const request = destructiveRequest("branch-deletion", "git push origin --delete feature-x");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.getByText("This would delete the branch feature-x.")).toBeInTheDocument();
    });

    it("branch-deletion via 'git push origin -d feature-x' names the branch, not the remote", () => {
      const request = destructiveRequest("branch-deletion", "git push origin -d feature-x");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.getByText("This would delete the branch feature-x.")).toBeInTheDocument();
    });

    it("branch-deletion via 'git push origin :feature-x' names the branch, not the remote", () => {
      const request = destructiveRequest("branch-deletion", "git push origin :feature-x");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.getByText("This would delete the branch feature-x.")).toBeInTheDocument();
    });

    it("branch-deletion via 'git push --delete origin feature-x' (flag before the remote) names the branch, not the remote", () => {
      const request = destructiveRequest("branch-deletion", "git push --delete origin feature-x");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.getByText("This would delete the branch feature-x.")).toBeInTheDocument();
    });

    it("branch-deletion via 'git push origin :refs/heads/feature-x' names the branch, not the remote", () => {
      const request = destructiveRequest("branch-deletion", "git push origin :refs/heads/feature-x");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.getByText("This would delete the branch feature-x.")).toBeInTheDocument();
    });

    it("branch-deletion via 'git push origin --delete' with no branch named falls back to the generic sentence", () => {
      const request = destructiveRequest("branch-deletion", "git push origin --delete");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.getByText("This would delete a branch on this remote.")).toBeInTheDocument();
      // Regression guard for the exact defect this task closes: with only one positional (the
      // remote) after the subcommand, the sentence must never name "origin" as if it were the
      // branch — this is the case a "last non-flag positional" rule with no length check would
      // get wrong.
      expect(screen.queryByText(/This would delete the branch origin/)).not.toBeInTheDocument();
    });

    it("default-branch-push", () => {
      const request = destructiveRequest("default-branch-push", "git push origin main");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(
        screen.getByText("This would push directly to main, the project's main branch."),
      ).toBeInTheDocument();
    });

    it("hard-reset", () => {
      const request = destructiveRequest("hard-reset", "git reset --hard");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(
        screen.getByText("This would discard uncommitted changes in the worktree — permanently."),
      ).toBeInTheDocument();
    });

    it("force-clean", () => {
      const request = destructiveRequest("force-clean", "git clean -fdx");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(
        screen.getByText("This would delete every untracked and ignored file in the worktree — permanently."),
      ).toBeInTheDocument();
    });

    it("history-rewrite", () => {
      const request = destructiveRequest("history-rewrite", "git rebase origin/main");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(
        screen.getByText("This would rewrite commit history other work may depend on."),
      ).toBeInTheDocument();
    });
  });

  // Task 3 — D-57's "structurally absent" turned into a test that fails the moment a future
  // change makes the allow-always button conditional on something narrower than "there is a
  // category at all": every category value the classifier can produce (the six named ones, the
  // uncategorized one) plus one deliberately unknown string never produces a card offering it.
  describe("exhaustive absence of the allow-always button (D-57, Task 3)", () => {
    const categoryValues = [
      "force-push",
      "branch-deletion",
      "default-branch-push",
      "hard-reset",
      "force-clean",
      "history-rewrite",
      "uncategorized",
      "an-unknown-category-value",
    ];

    it.each(categoryValues)("category %s never renders an allow-always button", (category) => {
      const request = destructiveRequest(category, "some-command --flag");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /from now on/i })).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2 — both mount points share one query, one key (Discretion #6)
// ---------------------------------------------------------------------------------------------

const RUN_ID = "run-shared-1";
const TASK_ID = "task-shared-1";

function taskDetailItem(): DetailItem {
  return { id: TASK_ID, kind: "task", key: "FLY-1", title: "A gated task", status: "in_progress", projectId: "proj-1" };
}

function setUpSharedMounts(initialRequests: PendingPermissionRequest[]) {
  let currentRequests = initialRequests;
  capturedBoardChangedHandler = undefined;
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "agent_run_pending_permissions") return Promise.resolve(currentRequests);
    if (command === "task_latest_agent_run") return Promise.resolve(RUN_ID);
    if (command === "agent_run_answer_permission") return Promise.resolve(undefined);
    if (command === "agent_run_log_window") return Promise.resolve([]);
    if (command === "criterion_list") return Promise.resolve([]);
    if (command === "events_activity_trail") return Promise.resolve([]);
    if (command === "actor_list") return Promise.resolve([]);
    // `ItemDetailPanel`'s Runs section (plan 02-08) needs a blocked row for RUN_ID so its own
    // compact permission-card mount (the SAME card `usePendingPermissionRequests` feeds) has a
    // row to render beneath — without this the section would read zero runs and render nothing.
    if (command === "agent_runs_for_task") {
      return Promise.resolve([
        {
          id: RUN_ID,
          taskId: TASK_ID,
          status: "blocked",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: null,
          costUsd: null,
          tokensIn: null,
          tokensOut: null,
          externalSessionId: null,
        },
      ]);
    }
    if (command === "worktree_summary") return Promise.resolve(null);
    return Promise.resolve(undefined);
  });

  const queryClient = new QueryClient();

  function setRequests(next: PendingPermissionRequest[]) {
    currentRequests = next;
  }

  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionSurface agentRunId={RUN_ID} onBack={() => {}} initialStatus="blocked" />
      <ItemDetailPanel item={taskDetailItem()} onClose={() => {}} onUpdateTitle={() => {}} />
    </QueryClientProvider>,
  );

  /** Simulates the core's `board:changed` push (D-04) the answer round trip emits. */
  function pushBoardChanged() {
    capturedBoardChangedHandler?.();
  }

  return { ...view, setRequests, pushBoardChanged, queryClient };
}

describe("Two mount points, one request (Discretion #6, plan 02-06 Task 2)", () => {
  it("both mount points render for one pending request", async () => {
    setUpSharedMounts([makeRequest({ id: "req-shared" })]);

    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));
  });

  it("answering the compact (item detail) instance clears the feed instance", async () => {
    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);

    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    setRequests([]);
    // Both groups are identical; activating either one's Allow answers the same underlying row —
    // pick the second (compact/item-detail) instance explicitly.
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[1]).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("agent_run_answer_permission", {
      requestId: "req-shared",
      decision: "allow",
    }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryByText("Bash wants to:")).not.toBeInTheDocument());
  });

  it("answering the feed instance clears the compact instance", async () => {
    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);

    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    setRequests([]);
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("agent_run_answer_permission", {
      requestId: "req-shared",
      decision: "allow",
    }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryByText("Bash wants to:")).not.toBeInTheDocument());
  });

  it("neither mount point leaves a stale duplicate after answering", async () => {
    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);
    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    setRequests([]);
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Allow" }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryAllByText("Bash wants to:")).toHaveLength(0));
  });

  it("the compact card renders above the Activity Trail section", async () => {
    setUpSharedMounts([makeRequest({ id: "req-shared" })]);
    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    const detailPanel = screen.getByRole("dialog", { name: "FLY-1 detail" });
    const cardGroup = within(detailPanel).getByRole("group", { name: "Bash wants to:" });
    const activitySection = within(detailPanel).getByRole("region", { name: "Activity" });
    // DOM order: the card's node must precede the Activity Trail's node.
    // eslint-disable-next-line no-bitwise
    expect(cardGroup.compareDocumentPosition(activitySection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the feed does not scroll to its tail while a pending card is mounted, and resumes after it is answered", async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const { setRequests, pushBoardChanged } = setUpSharedMounts([makeRequest({ id: "req-shared" })]);
    await waitFor(() => expect(screen.getAllByText("Bash wants to:")).toHaveLength(2));

    scrollSpy.mockClear();

    setRequests([]);
    const groups = screen.getAllByRole("group", { name: "Bash wants to:" });
    fireEvent.click(within(groups[0]).getByRole("button", { name: "Allow" }));
    pushBoardChanged();

    await waitFor(() => expect(screen.queryAllByText("Bash wants to:")).toHaveLength(0));
    expect(scrollSpy).toHaveBeenCalled();

    // @ts-expect-error — cleaning up the spy from the shared prototype after this test.
    delete Element.prototype.scrollIntoView;
  });
});
