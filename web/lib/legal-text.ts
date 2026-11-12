/**
 * The pure rules of the legal pages, with no imports, so they can be tested
 * outside Next.js (web/tests/legal-pages.test.mjs): which language a reader
 * gets, how a placeholder is filled, how the console's Markdown is read, and
 * which links it may carry.
 */

export type PageLanguage = "uz" | "en" | "ru";

/**
 * `?lang=` first, then the browser's own language; Uzbek otherwise. `chosen`
 * says the reader asked for it, so a guess from the browser can give way to
 * Uzbek where the page has no translation, while an explicit choice is kept.
 */
export function pageLanguage(requested: string | undefined, acceptLanguage: string | null): { language: PageLanguage; chosen: boolean } {
  if (requested === "uz" || requested === "en" || requested === "ru") return { language: requested, chosen: true };
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return { language: first === "en" || first === "ru" ? first : "uz", chosen: false };
}

/**
 * The page's text with its placeholders filled in.
 *
 * A placeholder is filled per line: a line quoting a value that is empty is
 * dropped whole, so the page never says "Telefon: " with nothing after it.
 */
export function fillPlaceholders(body: string, values: Record<string, string>): string {
  return body
    .split("\n")
    .filter((line) => {
      const names = [...line.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]!);
      return names.every((name) => (values[name] ?? "").trim() !== "");
    })
    .map((line) => line.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => values[name] ?? ""))
    .join("\n");
}

export type Block =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" };

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push({ kind: "p", text: paragraph.join(" ") }); paragraph = []; } };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (/^###\s+/.test(trimmed)) { flush(); blocks.push({ kind: "h3", text: trimmed.replace(/^###\s+/, "") }); continue; }
    if (/^##?\s+/.test(trimmed)) { flush(); blocks.push({ kind: "h2", text: trimmed.replace(/^##?\s+/, "") }); continue; }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { flush(); blocks.push({ kind: "hr" }); continue; }
    if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      flush();
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const pattern = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index]!.trim())) {
        items.push(lines[index]!.trim().replace(pattern, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (trimmed.startsWith("|") && /^\|?\s*:?-{2,}/.test(lines[index + 1]?.trim() ?? "")) {
      flush();
      const head = cells(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        rows.push(cells(lines[index]!));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();

  // A heading left with nothing under it — every line of its section quoted a
  // contact that is not set — goes too, rather than announcing an empty part.
  // Repeated, because removing an empty `###` can leave its `##` empty.
  let kept = blocks;
  for (;;) {
    const next = kept.filter((block, at) => {
      const after = kept[at + 1];
      if (block.kind === "h3") return after !== undefined && after.kind !== "h2" && after.kind !== "h3";
      if (block.kind === "h2") return after !== undefined && after.kind !== "h2";
      return true;
    });
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

export function safeHref(href: string): string | null {
  const value = href.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("#")) return value;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  return null;
}
