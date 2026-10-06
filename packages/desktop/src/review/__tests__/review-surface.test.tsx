/**
 * Behavior under test (08-01-PLAN.md Task 3, REVW-01/REVW-02, D-131/D-135/D-137, Pitfalls 6-8):
 * a row per changed file with no patch requested on mount; one patch request per expanded file;
 * binary and generated rows; the no-integration-branch sentence; the surface's own keys; and the
 * chunk control that tells the reader a long file is only partly shown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewSurface } from "../ReviewSurface";
import { FileDiff, HUNK_CHUNK } from "../FileDiff";
import type { ReviewFileDto, ReviewFilesDto } from "../../adapters/tauri";

const reviewFilesMock = vi.fn();
const reviewFilePatchMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  reviewFiles: (...args: unknown[]) => reviewFilesMock(...args),
  reviewFilePatch: (...args: unknown[]) => reviewFilePatchMock(...args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

const RUST_PATCH = `diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 fn main() {
-    let x = 1;
+    let x = 2;
 }
`;

const BINARY_PATCH = `diff --git a/image.bin b/image.bin
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/image.bin differ
`;

function manyHunkPatch(count: number): string {
  let out = "diff --git a/big.txt b/big.txt\nindex 1111111..2222222 100644\n--- a/big.txt\n+++ b/big.txt\n";
  for (let i = 0; i < count; i += 1) {
    const start = i * 10 + 1;
    out += `@@ -${start},3 +${start},3 @@\n context ${i}\n-old ${i}x\n+new ${i}\n tail ${i}\n`;
  }
  return out;
}

function file(overrides: Partial<ReviewFileDto>): ReviewFileDto {
  return { path: "a.txt", oldPath: null, status: "M", added: 1, removed: 1, binary: false, ...overrides };
}

function resolved(files: ReviewFileDto[]): ReviewFilesDto {
  return {
    target: {
      state: "resolved",
      base: "flywheel/epic",
      head: "flywheel/task",
      projectId: "p1",
      epicId: "e1",
      taskId: "t1",
    },
    files,
  };
}

function renderSurface(onBack = vi.fn(), label = "FLY-3 A task") {
  const queryClient = new QueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ReviewSurface scope="task" itemId="t1" label={label} onBack={onBack} />
    </QueryClientProvider>,
  );
  return { ...result, onBack };
}

beforeEach(() => {
  reviewFilesMock.mockReset();
  reviewFilePatchMock.mockReset();
});

describe("FileDiff", () => {
  it("highlights a rust patch with keyword token spans", () => {
    const { container } = render(<FileDiff patch={RUST_PATCH} path="src/lib.rs" />);
    expect(container.querySelectorAll(".token.keyword").length).toBeGreaterThan(0);
  });

  it("renders a patch with an unregistered extension as plain text without throwing", () => {
    const { container } = render(<FileDiff patch={RUST_PATCH} path="src/lib.zzz" />);
    expect(container.querySelectorAll(".token").length).toBe(0);
    expect(container.textContent).toContain("let x = 2;");
  });

  it("renders a binary patch as one binary line with no token spans", () => {
    const { container } = render(<FileDiff patch={BINARY_PATCH} path="image.rs" />);
    expect(screen.getByText(/Binary file/)).toBeInTheDocument();
    expect(container.querySelectorAll(".token").length).toBe(0);
  });

  it("names how many hunks remain and appends the next chunk on request", () => {
    const total = HUNK_CHUNK + 5;
    const { container } = render(<FileDiff patch={manyHunkPatch(total)} path="big.txt" />);
    expect(container.textContent).toContain("old 0x");
    expect(container.textContent).not.toContain(`old ${total - 1}x`);
    const control = screen.getByRole("button", { name: /5 remaining hunks/ });
    fireEvent.click(control);
    expect(container.textContent).toContain(`old ${total - 1}x`);
    expect(screen.queryByRole("button", { name: /remaining hunks/ })).toBeNull();
  });
});

describe("ReviewSurface", () => {
  it("renders a row per file with status and counts and requests no patch on mount", async () => {
    reviewFilesMock.mockResolvedValue(
      resolved([
        file({ path: "src/lib.rs", added: 3, removed: 2 }),
        file({ path: "new.txt", status: "A", added: 5, removed: 0 }),
      ]),
    );
    renderSurface();

    expect(await screen.findByText("src/lib.rs")).toBeInTheDocument();
    expect(screen.getByText("new.txt")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("−2")).toBeInTheDocument();
    expect(reviewFilePatchMock).not.toHaveBeenCalled();
  });

  it("requests a file's patch exactly once, even after collapsing and re-expanding", async () => {
    reviewFilesMock.mockResolvedValue(resolved([file({ path: "src/lib.rs" })]));
    reviewFilePatchMock.mockResolvedValue(RUST_PATCH);
    const { container } = renderSurface();

    const row = await screen.findByRole("button", { name: /src\/lib\.rs/ });
    fireEvent.click(row);
    await waitFor(() => expect(reviewFilePatchMock).toHaveBeenCalledTimes(1));
    expect(reviewFilePatchMock).toHaveBeenCalledWith("task", "t1", "src/lib.rs", null);
    // Highlighting splits the line across token spans, so assert on the joined text.
    await waitFor(() => expect(container.textContent).toContain("let x = 2;"));

    fireEvent.click(row);
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(reviewFilePatchMock).toHaveBeenCalledTimes(1);
  });

  it("shows no counts for a binary row and renders a binary line when expanded", async () => {
    reviewFilesMock.mockResolvedValue(
      resolved([file({ path: "image.bin", status: "A", added: null, removed: null, binary: true })]),
    );
    reviewFilePatchMock.mockResolvedValue(BINARY_PATCH);
    const { container } = renderSurface();

    const row = await screen.findByRole("button", { name: /image\.bin/ });
    expect(row).toHaveTextContent("binary");
    expect(row).not.toHaveTextContent("+0");
    fireEvent.click(row);
    expect(await screen.findByText(/Binary file/)).toBeInTheDocument();
    expect(container.querySelectorAll(".token").length).toBe(0);
  });

  it("tags a generated file, starts it collapsed, and still lets it expand", async () => {
    reviewFilesMock.mockResolvedValue(resolved([file({ path: "package-lock.json" })]));
    reviewFilePatchMock.mockResolvedValue(RUST_PATCH);
    renderSurface();

    const row = await screen.findByRole("button", { name: /package-lock\.json/ });
    expect(row).toHaveTextContent("generated");
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    await waitFor(() => expect(reviewFilePatchMock).toHaveBeenCalledTimes(1));
    expect(row).toHaveAttribute("aria-expanded", "true");
  });

  it("names the epic and requests nothing when it has no integration branch", async () => {
    reviewFilesMock.mockResolvedValue({
      target: { state: "noIntegrationBranch", base: null, head: null, projectId: null, epicId: null, taskId: null },
      files: [],
    });
    renderSurface(vi.fn(), "FLY-1 The epic");

    expect(await screen.findByText(/FLY-1 The epic has no integration branch yet/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(reviewFilePatchMock).not.toHaveBeenCalled();
  });

  it("moves with j/k, expands with Enter, and pops back on Escape", async () => {
    reviewFilesMock.mockResolvedValue(
      resolved([file({ path: "first.txt" }), file({ path: "second.txt" })]),
    );
    reviewFilePatchMock.mockResolvedValue(RUST_PATCH);
    const { onBack } = renderSurface();
    const second = await screen.findByRole("button", { name: /second\.txt/ });

    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(second).toHaveAttribute("aria-expanded", "true"));
    expect(reviewFilePatchMock).toHaveBeenCalledWith("task", "t1", "second.txt", null);

    fireEvent.keyDown(document.body, { key: "k" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByRole("button", { name: /first\.txt/ })).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("passes a rename's old path through to the patch request", async () => {
    reviewFilesMock.mockResolvedValue(
      resolved([file({ path: "new_name.txt", oldPath: "old_name.txt", status: "R" })]),
    );
    reviewFilePatchMock.mockResolvedValue(RUST_PATCH);
    renderSurface();

    fireEvent.click(await screen.findByRole("button", { name: /new_name\.txt/ }));
    await waitFor(() =>
      expect(reviewFilePatchMock).toHaveBeenCalledWith("task", "t1", "new_name.txt", "old_name.txt"),
    );
  });
});
