/**
 * A small, safe markdown renderer for agent turns (Story #56: "agent turns render as markdown, not
 * one collapsed line"). No markdown library is installed, and this one never sets inner HTML: it
 * parses the text into blocks and inline spans and builds React elements, so whatever the agent
 * writes — including HTML — can only ever be text.
 *
 * Covered: ATX headings, paragraphs, bullet and numbered lists (nested by indentation), fenced code,
 * blockquotes, horizontal rules, pipe tables, and inline code, bold, italic, strikethrough and links.
 * A link is shown as its text with its target beside it, never as an anchor: navigating would leave
 * the app's own window, and a `javascript:` target must never become clickable.
 */
import type { ReactNode } from "react";
import "./session.css";

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "rule" }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "table"; header: string[]; rows: string[][] };

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  return (/^\s*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_DIVIDER.test(next) && next.includes("-"))
  );
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1][0].repeat(3)) && FENCE.test(lines[i]))) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence (or the end of the text)
      blocks.push({ type: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(body) });
      continue;
    }

    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && TABLE_DIVIDER.test(next) && next.includes("-")) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const baseIndent = indentOf(line);
      const ordered = /\d/.test(item[2]);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i];
        const match = LIST_ITEM.exec(current);
        if (match && indentOf(current) === baseIndent && /\d/.test(match[2]) === ordered) {
          items.push([match[3]]);
          i += 1;
          continue;
        }
        if (!current.trim()) {
          // A blank line ends the list unless the next line continues it.
          const after = lines[i + 1];
          if (after !== undefined && after.trim() && (indentOf(after) > baseIndent || (LIST_ITEM.test(after) && indentOf(after) === baseIndent))) {
            items[items.length - 1].push("");
            i += 1;
            continue;
          }
          break;
        }
        if (indentOf(current) > baseIndent) {
          // A nested list or a continuation line belongs to the current item, dedented.
          items[items.length - 1].push(current.slice(Math.min(indentOf(current), baseIndent + 2)));
          i += 1;
          continue;
        }
        if (!startsBlock(current, lines[i + 1])) {
          // A lazy continuation of the item's paragraph.
          items[items.length - 1].push(current.trim());
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({
        type: "list",
        ordered,
        start: ordered ? Number.parseInt(item[2], 10) : 1,
        items: items.map((itemLines) => parseBlocks(itemLines)),
      });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

/** Inline patterns, in tie-break priority order: code spans first, so nothing inside them is parsed. */
const INLINE_PATTERNS: Array<{ kind: "code" | "link" | "strong" | "strike" | "em"; re: RegExp }> = [
  { kind: "code", re: /`([^`]+)`/ },
  { kind: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { kind: "strong", re: /\*\*(?!\s)(.+?)\*\*|__(?!\s)(.+?)__/ },
  { kind: "strike", re: /~~(?!\s)(.+?)~~/ },
  { kind: "em", re: /\*(?![\s*])(.+?)\*|(?<![\p{L}\p{N}_])_(?![\s_])(.+?)_(?![\p{L}\p{N}_])/u },
];

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { kind: string; match: RegExpExecArray } | null = null;
    for (const { kind, re } of INLINE_PATTERNS) {
      const match = re.exec(rest);
      if (match && (best === null || match.index < best.match.index)) best = { kind, match };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { kind, match } = best;
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${n}`;
    const inner = match[1] ?? match[2] ?? "";
    switch (kind) {
      case "code":
        out.push(
          <code key={key} className="feed-md-code">
            {inner}
          </code>,
        );
        break;
      case "link": {
        const target = match[2];
        out.push(
          <span key={key} className="feed-md-link" title={target}>
            {renderInline(match[1], key)}
            {match[1] !== target && <span className="feed-md-link-target"> ({target})</span>}
          </span>,
        );
        break;
      }
      case "strong":
        out.push(<strong key={key}>{renderInline(inner, key)}</strong>);
        break;
      case "strike":
        out.push(<s key={key}>{renderInline(inner, key)}</s>);
        break;
      default:
        out.push(<em key={key}>{renderInline(inner, key)}</em>);
    }
    rest = rest.slice(match.index + match[0].length);
    n += 1;
  }
  return out;
}

function renderBlocks(blocks: Block[], keyPrefix: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (block.type) {
      case "heading": {
        const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={key} className="feed-md-heading">
            {renderInline(block.text, key)}
          </Tag>
        );
      }
      case "paragraph":
        return <p key={key}>{renderInline(block.text, key)}</p>;
      case "code":
        return (
          <pre key={key} className="feed-md-pre" data-lang={block.lang || undefined}>
            <code>{block.text}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote key={key} className="feed-md-quote">
            {renderBlocks(block.blocks, key)}
          </blockquote>
        );
      case "rule":
        return <hr key={key} className="feed-md-rule" />;
      case "list": {
        const items = block.items.map((itemBlocks, itemIndex) => {
          const itemKey = `${key}-${itemIndex}`;
          // A one-paragraph item renders its text directly, not wrapped in <p>, so it sits tight.
          const tight = itemBlocks.length >= 1 && itemBlocks[0].type === "paragraph";
          return (
            <li key={itemKey}>
              {tight
                ? [
                    ...renderInline((itemBlocks[0] as { text: string }).text, `${itemKey}-t`),
                    ...renderBlocks(itemBlocks.slice(1), itemKey),
                  ]
                : renderBlocks(itemBlocks, itemKey)}
            </li>
          );
        });
        return block.ordered ? (
          <ol key={key} start={block.start === 1 ? undefined : block.start} className="feed-md-list">
            {items}
          </ol>
        ) : (
          <ul key={key} className="feed-md-list">
            {items}
          </ul>
        );
      }
      case "table":
        return (
          <div key={key} className="feed-md-table-wrap">
            <table className="feed-md-table">
              <thead>
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c}>{renderInline(cell, `${key}-h${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{renderInline(cell, `${key}-${r}-${c}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default: {
        const exhaustive: never = block;
        return exhaustive;
      }
    }
  });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"));
  return <div className={className ? `feed-md ${className}` : "feed-md"}>{renderBlocks(blocks, "md")}</div>;
}
