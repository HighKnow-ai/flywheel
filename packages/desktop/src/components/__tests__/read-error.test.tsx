import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createQueryClient } from "@/adapters/queryClient";
import { ReadError } from "@/components/ReadError";

function StoryTitle({ read }: { read: () => Promise<string> }) {
  const query = useQuery({ queryKey: ["story"], queryFn: read });
  if (query.isError) return <ReadError title="Couldn't load this Story" query={query} />;
  if (query.data === undefined) return <p>Loading</p>;
  return <h1>{query.data}</h1>;
}

describe("ReadError", () => {
  it("shows after a failing local read retries once, and Try again refetches into the content", async () => {
    let fail = true;
    const read = vi.fn(async () => {
      if (fail) throw new Error("ipc: core unreachable (os error 61)");
      return "Write the release notes";
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <StoryTitle read={read} />
      </QueryClientProvider>,
    );

    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    // One try and one retry, on the renderer's own defaults: about a second, not seven.
    expect(read).toHaveBeenCalledTimes(2);
    expect(alert).toHaveTextContent("Couldn't load this Story");
    expect(alert).toHaveTextContent("Flywheel couldn't read this from its local core.");

    // The raw message waits behind Details, in the code face.
    expect(screen.queryByText("ipc: core unreachable (os error 61)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const raw = screen.getByText("ipc: core unreachable (os error 61)");
    expect(raw.tagName).toBe("PRE");
    expect(raw).toHaveClass("font-mono");

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Write the release notes" })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("shows Try again as pending while a refetch runs", () => {
    render(<ReadError title="Couldn't load the board" query={{ error: new Error("x"), refetch: () => {}, isFetching: true }} />);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute("aria-busy", "true");
  });

  it("reads a non-Error rejection (a core error object) as its message", () => {
    render(
      <ReadError title="Couldn't load the board" query={{ error: { kind: "NotFound", message: "no such project" }, refetch: () => {} }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("no such project")).toBeInTheDocument();
  });
});
