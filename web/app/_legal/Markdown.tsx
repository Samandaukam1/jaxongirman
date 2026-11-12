import type { ReactNode } from "react";

import { parseBlocks, safeHref } from "@/lib/legal-text";

/**
 * The legal pages' text, drawn as React elements — never as HTML.
 *
 * The console writes a small Markdown: `##`/`###` headings, `-` and `1.`
 * lists, `|` tables, `---`, paragraphs, `**bold**` and `[links](/terms)`. That
 * is all this reads; anything else is shown as the words it is. No string from
 * the database becomes markup, so a page cannot carry a script, and a link may
 * only go to this site, http(s), mailto: or tel:.
 */

/** `**bold**` and `[text](href)`, everything else as plain text. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyBase}-${n++}`;
    if (match[1] !== undefined) {
      out.push(<strong key={key}>{inline(match[1], key)}</strong>);
    } else {
      const href = safeHref(match[3]!);
      const external = href !== null && /^https?:/i.test(href);
      out.push(href
        ? <a key={key} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{match[2]}</a>
        : match[2]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((block, at) => {
        const key = `b${at}`;
        switch (block.kind) {
          case "h2": return <h2 key={key}>{inline(block.text, key)}</h2>;
          case "h3": return <h3 key={key}>{inline(block.text, key)}</h3>;
          case "p": return <p key={key}>{inline(block.text, key)}</p>;
          case "hr": return <hr key={key} />;
          case "ul": return <ul key={key}>{block.items.map((item, i) => <li key={i}>{inline(item, `${key}-${i}`)}</li>)}</ul>;
          case "ol": return <ol key={key}>{block.items.map((item, i) => <li key={i}>{inline(item, `${key}-${i}`)}</li>)}</ol>;
          case "table":
            return (
              <div className="legal-table" key={key}>
                <table>
                  <thead><tr>{block.head.map((cell, i) => <th key={i}>{inline(cell, `${key}-h${i}`)}</th>)}</tr></thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell, `${key}-${r}-${c}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}
