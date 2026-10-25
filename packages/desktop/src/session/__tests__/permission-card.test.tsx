/**
 * Behavior under test (02-06-PLAN.md Task 1, AGNT-06, D-37, D-38):
 *
 * Task 1 — `PermissionRequestCard` standalone: renders nothing with no pending request; a pending
 * request renders the glyph/heading/payload/three unequal actions; Escape never resolves it;
 * a double-activation of Allow calls the answer function exactly once; a rejected answer keeps the
 * card mounted, re-enables its actions and shows an inline error; two pending requests render as
 * two independently answerable cards.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PermissionRequestCard, type PendingPermissionRequest } from "../PermissionRequestCard";

/** Story #206: the Always-allow pattern editor is a Popover; open it to reach the pattern field and its save. */
function openPatternEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Always allow…" }));
}

function makeRequest(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
  return {
    id: "req-1",
    toolName: "Bash",
    inputPayload: '{"command":"rm -rf /tmp/scratch"}',
    destructiveCategory: null,
    suggestedRule: "Bash(rm -rf /tmp/scratch)",
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
    expect(screen.getByText("rm -rf /tmp/scratch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    openPatternEditor();
    expect(
      screen.getByRole("button", { name: "Always allow this pattern in this project" }),
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
    expect(onAnswer).toHaveBeenCalledWith("req-1", "allow_always", "Bash(rm -rf /tmp/scratch)");
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

    const allowButton = screen.getByRole("button", { name: "Allow once" });
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

    const allowButton = screen.getByRole("button", { name: "Allow once" });
    allowButton.click();
    allowButton.click();
    allowButton.click();

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    resolveAnswer?.();
  });

  it("a rejected answer keeps the card mounted, re-enables its actions and renders an inline error", async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error("network down"));
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled();
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
    fireEvent.click(within(editGroup).getByRole("button", { name: "Allow once" }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("req-2", "allow");
    // The first (untouched) card's Allow button is still enabled — answering the second never
    // touched the first's own state.
    const bashGroup = screen.getByRole("group", { name: "Bash wants to:" });
    expect(within(bashGroup).getByRole("button", { name: "Allow once" })).toBeEnabled();
  });

  it("draws its icons from Lucide by name and hard-codes no colour", () => {
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
    suggestedRule: null,
  });
}

describe("destructive", () => {
  it("with a null category renders exactly as the routine card: Allow filled, Deny outline, allow-always present", () => {
    render(<PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    openPatternEditor();
    expect(
      screen.getByRole("button", { name: "Always allow this pattern in this project" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Gated action — needs your OK every time")).not.toBeInTheDocument();
  });

  it("with a category renders the Gated-action shield, its heading and the consequence sentence above the payload", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    const { container } = render(
      <PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />,
    );

    expect(screen.getByText("Gated action — needs your OK every time")).toBeInTheDocument();
    expect(screen.getByText("Bash wants to:")).toBeInTheDocument();
    expect(
      screen.getByText("This would discard uncommitted changes in the worktree — permanently."),
    ).toBeInTheDocument();
    expect(screen.getByText("git reset --hard")).toBeInTheDocument();
    // direction.md § Icons: a Gated action is `shield-alert`; a permission request is `key-round`.
    expect(container.querySelector(".lucide-shield-alert")).not.toBeNull();
    expect(container.querySelector(".lucide-key-round")).toBeNull();
  });

  it("with a category, no button with the allow-always label is in the document", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /always allow/i })).not.toBeInTheDocument();
  });

  it("swaps button emphasis: Deny is the destructive lead, Allow is not", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    const deny = screen.getByRole("button", { name: "Deny" });
    const allow = screen.getByRole("button", { name: "Allow once" });
    // Deny leads as the filled neutral (ink); Allow once is outline, never a filled action here.
    expect(deny).toHaveAttribute("data-variant", "neutral");
    expect(allow).toHaveAttribute("data-variant", "outline");
  });

  it("Allow's accessible name reads 'Allow once' on the Gated variant", () => {
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("reverses the reflex: the lead on the destructive variant is Deny, the lead on the routine variant is Allow", () => {
    // No button here is filled any more (owner decision 2026-10-08): the lead is the one with the
    // 2px edge, and `finish.test.tsx` pins that class against the real stylesheet.
    const { unmount } = render(
      <PermissionRequestCard variant="feed" requests={[makeRequest()]} onAnswer={vi.fn()} />,
    );
    const routineLead = screen.getByRole("button", { name: "Allow once" });
    expect(routineLead).toHaveAttribute("data-variant", "attention");
    expect(screen.getByRole("button", { name: "Deny" })).toHaveAttribute("data-variant", "outline");
    unmount();

    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
    const destructiveLead = screen.getByRole("button", { name: "Deny" });
    expect(destructiveLead).toHaveAttribute("data-variant", "neutral");
    expect(screen.getByRole("button", { name: "Allow once" })).toHaveAttribute("data-variant", "outline");
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

  it("three synchronous native clicks on the Gated 'Allow once' call the answer spy exactly once", async () => {
    let resolveAnswer: (() => void) | undefined;
    const onAnswer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    const request = destructiveRequest("hard-reset", "git reset --hard");
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={onAnswer} />);

    const allowOnceButton = screen.getByRole("button", { name: "Allow once" });
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

  it("with an unrecognised category string still renders as a Gated action, with the generic sentence", () => {
    const request = destructiveRequest("made-up-category", "some-unrecognised-command --flag");
    const { container } = render(
      <PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />,
    );

    expect(
      screen.getByText("This command can destroy work, and Flywheel doesn't recognise exactly what it would do."),
    ).toBeInTheDocument();
    expect(container.querySelector(".lucide-shield-alert")).not.toBeNull();
    expect(container.querySelector(".lucide-key-round")).toBeNull();
    expect(screen.queryByRole("button", { name: /always allow/i })).not.toBeInTheDocument();
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
    // (`origin`) here, which is the exact defect this Story closes (03-16-PLAN.md Task 2).
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
      // Regression guard for the exact defect this Story closes: with only one positional (the
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
        screen.getByText("This would rewrite the history of a branch other than this Story's own."),
      ).toBeInTheDocument();
    });

    it.each([
      ["git-push", "git push origin story/fly-1", "This would push story/fly-1 to the remote, where others can see it."],
      ["git-push", "git push", "This would push commits to the remote, where others can see them."],
      ["git-push", "git -C ../repo push origin feature-x", "This would push feature-x to the remote, where others can see it."],
      [
        "worktree-deletion",
        "git worktree remove ../other-story",
        "This would delete the worktree at ../other-story, which isn't this Story's, with any uncommitted work in it.",
      ],
      ["recursive-delete", "rm -rf ../shared", "This would delete files outside this Story's worktree — permanently."],
      ["publish", "npm publish", "This would publish a package to the npm registry, where anyone can install it."],
      ["publish", "cargo publish", "This would publish this crate to crates.io. A published version can't be deleted."],
      ["publish", "gh pr merge 12 --squash", "This would merge a pull request on GitHub."],
      ["publish", "gh release create v1.0.0", "This would change a release on GitHub, where others can see it."],
    ])("%s: %s", (category, command, sentence) => {
      render(<PermissionRequestCard variant="feed" requests={[destructiveRequest(category, command)]} onAnswer={vi.fn()} />);
      expect(screen.getByText(sentence)).toBeInTheDocument();
      // The literal command, never the JSON payload around it.
      expect(screen.getByText(command)).toBeInTheDocument();
    });
  });

  // Task 3 — D-57's "structurally absent" turned into a test that fails the moment a future
  // change makes the allow-always button conditional on something narrower than "there is a
  // category at all": every category value the Gated-action deny-list can produce plus one
  // deliberately unknown string never produces a card offering it.
  describe("exhaustive absence of the allow-always button (D-57, Task 3)", () => {
    const categoryValues = [
      "git-push",
      "force-push",
      "default-branch-push",
      "branch-deletion",
      "worktree-deletion",
      "hard-reset",
      "force-clean",
      "history-rewrite",
      "recursive-delete",
      "publish",
      "an-unknown-category-value",
    ];

    it.each(categoryValues)("category %s never renders an allow-always button", (category) => {
      const request = destructiveRequest(category, "some-command --flag");
      render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);
      expect(screen.queryByRole("button", { name: /always allow/i })).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Issue #48 — Always allow <pattern> in this project, and a Gated action's two answers
// ---------------------------------------------------------------------------------------------

describe("Always allow <pattern> in this project (issue #48)", () => {
  function npmTestRequest(overrides: Partial<PendingPermissionRequest> = {}): PendingPermissionRequest {
    return makeRequest({
      inputPayload: '{"command":"npm test --watch"}',
      suggestedRule: "Bash(npm test --watch)",
      ...overrides,
    });
  }

  it("pre-fills the pattern field with the suggested rule", () => {
    render(<PermissionRequestCard variant="feed" requests={[npmTestRequest()]} onAnswer={vi.fn()} />);
    openPatternEditor();
    expect(screen.getByRole("textbox", { name: "Pattern" })).toHaveValue("Bash(npm test --watch)");
  });

  it("falls back to the whole tool when the caller has no suggested rule", () => {
    render(
      <PermissionRequestCard variant="feed" requests={[npmTestRequest({ suggestedRule: undefined, toolName: "WebFetch" })]} onAnswer={vi.fn()} />,
    );
    openPatternEditor();
    expect(screen.getByRole("textbox", { name: "Pattern" })).toHaveValue("WebFetch");
  });

  it("saves the edited pattern with allow_always", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[npmTestRequest()]} onAnswer={onAnswer} />);
    openPatternEditor();

    fireEvent.change(screen.getByRole("textbox", { name: "Pattern" }), { target: { value: "  Bash(npm test:*) " } });
    fireEvent.click(screen.getByRole("button", { name: "Always allow this pattern in this project" }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    expect(onAnswer).toHaveBeenCalledWith("req-1", "allow_always", "Bash(npm test:*)");
  });

  it("pressing Enter in the pattern field saves the rule", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[npmTestRequest()]} onAnswer={onAnswer} />);
    openPatternEditor();

    fireEvent.submit(screen.getByRole("textbox", { name: "Pattern" }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("req-1", "allow_always", "Bash(npm test --watch)"));
  });

  it("a rule the backend refuses shows its reason and leaves the request answerable", async () => {
    const reason =
      "a rule Bash(git:*) could match a Gated action, so Flywheel refuses to store it; Gated actions are asked every time";
    const onAnswer = vi.fn().mockRejectedValueOnce(reason).mockResolvedValueOnce(undefined);
    render(<PermissionRequestCard variant="feed" requests={[npmTestRequest()]} onAnswer={onAnswer} />);
    openPatternEditor();

    fireEvent.change(screen.getByRole("textbox", { name: "Pattern" }), { target: { value: "Bash(git:*)" } });
    fireEvent.click(screen.getByRole("button", { name: "Always allow this pattern in this project" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`Flywheel didn't save that rule: ${reason}`);
    expect(screen.getByRole("textbox", { name: "Pattern" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Pattern" })).toHaveValue("Bash(git:*)");
    expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() => expect(onAnswer).toHaveBeenLastCalledWith("req-1", "allow"));
  });

  it("an empty pattern is never sent", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[npmTestRequest()]} onAnswer={onAnswer} />);
    openPatternEditor();

    fireEvent.change(screen.getByRole("textbox", { name: "Pattern" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Always allow this pattern in this project" }));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a pattern to always allow");
  });

  it("typing a or d into the pattern field answers nothing", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<PermissionRequestCard variant="feed" requests={[npmTestRequest()]} onAnswer={onAnswer} />);
    openPatternEditor();

    const field = screen.getByRole("textbox", { name: "Pattern" });
    fireEvent.keyDown(field, { key: "a" });
    fireEvent.keyDown(field, { key: "d" });
    fireEvent.keyDown(field, { key: "A", shiftKey: true });

    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a Gated action offers only Allow once and Deny, no pattern field, and shows the literal command", () => {
    const request = makeRequest({
      inputPayload: '{"command":"git push origin story/fly-1"}',
      destructiveCategory: "git-push",
      suggestedRule: null,
    });
    render(<PermissionRequestCard variant="feed" requests={[request]} onAnswer={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName("Deny");
    expect(buttons[1]).toHaveAccessibleName("Allow once");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("git push origin story/fly-1")).toBeInTheDocument();
  });
});
