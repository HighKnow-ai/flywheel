/**
 * Story #56: an agent turn renders as markdown, not as one collapsed line of raw markdown (v0.1
 * walk, 2026-10-16, entry 10). No markdown library is installed, so `Markdown` builds React
 * elements itself: it never sets inner HTML, so text the agent writes can only ever be text.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "../Markdown";

function renderMd(text: string) {
  return render(<Markdown text={text} />).container;
}

describe("Markdown", () => {
  it("renders headings, emphasis, inline code and lists as elements, with no markup characters left", () => {
    const root = renderMd(
      "## The plan\n\nFirst **read** the `adapter`, then *decide*.\n\n- one\n- two\n\n1. alpha\n2. beta",
    );
    expect(root.querySelector("h2")?.textContent).toBe("The plan");
    expect(root.querySelector("strong")?.textContent).toBe("read");
    expect(root.querySelector("code")?.textContent).toBe("adapter");
    expect(root.querySelector("em")?.textContent).toBe("decide");
    expect(Array.from(root.querySelectorAll("ul > li")).map((li) => li.textContent)).toEqual(["one", "two"]);
    expect(Array.from(root.querySelectorAll("ol > li")).map((li) => li.textContent)).toEqual(["alpha", "beta"]);
    expect(root.textContent).not.toContain("**");
    expect(root.textContent).not.toContain("##");
    expect(root.textContent).not.toContain("`");
  });

  it("keeps a fenced code block verbatim, markup inside it untouched", () => {
    const root = renderMd("Run:\n\n```bash\nnpm test -- **not bold**\n```\n");
    const pre = root.querySelector("pre");
    expect(pre?.textContent).toBe("npm test -- **not bold**");
    expect(root.querySelector("strong")).toBeNull();
  });

  it("keeps every paragraph of a long turn, never clipping it to one line", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40)}`);
    const root = renderMd(paragraphs.join("\n\n"));
    expect(root.querySelectorAll("p")).toHaveLength(6);
    expect(root.textContent).toContain("Paragraph 5");
  });

  it("renders a blockquote, a rule and a pipe table", () => {
    const root = renderMd("> quoted\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(root.querySelector("blockquote")?.textContent).toBe("quoted");
    expect(root.querySelector("hr")).not.toBeNull();
    expect(Array.from(root.querySelectorAll("th")).map((th) => th.textContent)).toEqual(["a", "b"]);
    expect(Array.from(root.querySelectorAll("td")).map((td) => td.textContent)).toEqual(["1", "2"]);
  });

  it("nests an indented list under its item", () => {
    const root = renderMd("- parent\n  - child\n- sibling");
    expect(root.querySelector("ul ul > li")?.textContent).toBe("child");
    expect(root.querySelectorAll(".feed-md > ul > li")).toHaveLength(2);
  });

  it("renders HTML the agent writes as text, never as elements", () => {
    const root = renderMd('<script>alert(1)</script> <img src=x onerror="alert(2)">');
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
  });

  it("escapes raw HTML inside emphasis, headings, list items, table cells and code", () => {
    const root = renderMd(
      '# <script>alert(1)</script>\n\n**<img src=x onerror="alert(2)">**\n\n- <iframe src="javascript:alert(3)"></iframe>\n\n| <b>h</b> |\n|---|\n| <svg onload=alert(4)> |\n\n`<script>x</script>`\n\n```\n<script>y</script>\n```',
    );
    for (const tag of ["script", "img", "iframe", "b", "svg"]) expect(root.querySelector(tag)).toBeNull();
    expect(root.querySelectorAll("[onerror], [onload], [src]")).toHaveLength(0);
    expect(root.textContent).toContain('<img src=x onerror="alert(2)">');
    expect(root.textContent).toContain("<script>y</script>");
  });

  it("never renders javascript: or data: targets as links", () => {
    const root = renderMd(
      "[run](javascript:alert(1)) [img](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==) [JS](JaVaScRiPt:alert(2))",
    );
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelectorAll("[href], [src], [onclick]")).toHaveLength(0);
    expect(root.textContent).toContain("run");
    expect(root.textContent).toContain("img");
  });

  it("builds elements rather than injecting HTML: markup in the text stays literal text", () => {
    const text = "<b>bold?</b> &lt;not-an-entity&gt; <p onclick=alert(1)>x</p>";
    const root = renderMd(text);
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector("[onclick]")).toBeNull();
    // A renderer that set inner HTML would decode the entity; built text nodes keep it verbatim.
    expect(root.textContent).toBe(text);
  });

  it("shows a link as its text with the target beside it, and never makes a navigable anchor", () => {
    const root = renderMd("See [the spec](https://example.com/spec) and [bad](javascript:alert(1)).");
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain("the spec");
    expect(root.textContent).toContain("https://example.com/spec");
    expect(root.textContent).not.toContain("](");
  });
});
