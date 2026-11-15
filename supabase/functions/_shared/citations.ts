/**
 * References and the citations that point at them, in six styles.
 *
 * A source is stored once, as data — who wrote it, what it is called, where it
 * appeared — and every style is a way of printing that data. The prose is
 * written with plain numbered markers, `[1]`, `[2, 5]`, against the list the
 * research found; only at the end are they turned into what the chosen style
 * says a citation looks like, renumbered in the order a numeric style needs,
 * and linked to the entry they name. Choosing APA after the text is written is
 * therefore a reprint, not a rewrite.
 *
 * Nothing is filled in that the source does not say. A missing year prints as
 * the style's own "no date", a missing volume is left out, and a page range is
 * never guessed — a reference that looks complete and is not sends a reader to
 * a page that does not exist.
 *
 * Pure: no provider, no database.
 */

import type { Run } from "./docx.ts";

export type CitationStyle = "apa" | "gost" | "mla" | "chicago" | "ieee" | "vancouver";
export const CITATION_STYLES: CitationStyle[] = ["gost", "apa", "mla", "chicago", "ieee", "vancouver"];

/** Numbered in order of first citation, or sorted by author and year. */
export const NUMERIC: ReadonlySet<CitationStyle> = new Set(["gost", "ieee", "vancouver"]);

export type DocLanguage = "uz" | "ru" | "en" | "tr";

export type SourceType = "article" | "book" | "chapter" | "web" | "report" | "thesis";
export type Person = { family: string; given: string };

export type Source = {
  type: SourceType;
  authors: Person[];
  title: string;
  /** The journal an article is in, the book a chapter is in, the site a page is on. */
  container: string;
  publisher: string;
  place: string;
  year: string;
  volume: string;
  issue: string;
  /** A page or a range. Only when the research established it. */
  pages: string;
  doi: string;
  url: string;
};

const TYPES: ReadonlySet<string> = new Set(["article", "book", "chapter", "web", "report", "thesis"]);

const clean = (value: unknown, max: number): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/* ---------------------------------------------------------------- authors */

/** "A." from "Alisher", "A. A." from "Alisher Akmalovich" or "A.A.", "Yu." kept as written. */
export function initials(given: string): string {
  const parts = given.replace(/\./g, ". ").split(/[\s-]+/).filter(Boolean);
  return parts.map((part) => {
    if (/^[\p{Lu}][\p{Ll}]?\.$/u.test(part)) return part;
    const head = [...part][0] ?? "";
    // Two-letter Cyrillic and Latin digraph initials keep both letters, as a library card does.
    const two = part.slice(0, 2);
    if (/^(Yu|Ya|Yo|Sh|Ch|Ts|Ю|Я|Ё)$/u.test(two) && part.length > 2) return `${two}.`;
    return head ? `${head.toUpperCase()}.` : "";
  }).filter(Boolean).join(" ");
}

const INITIALS = /^(?:[\p{Lu}][\p{Ll}]?\.\s?){1,3}$/u;

/** One name as people write it: "Karimov A. A.", "Karimov, Alisher", "John Smith", or an organisation. */
export function parsePerson(raw: string): Person {
  const name = clean(raw, 160);
  if (!name) return { family: "", given: "" };
  if (name.includes(",")) {
    const [family, given] = name.split(",", 2);
    return { family: family!.trim(), given: (given ?? "").trim() };
  }
  const words = name.split(" ");
  // "Karimov A. A." — the family name first, the initials after it.
  const tail = words.slice(1).join(" ");
  if (words.length > 1 && INITIALS.test(`${tail}${tail.endsWith(".") ? "" : "."}`.replace(/\.\./g, "."))) {
    return { family: words[0]!, given: tail };
  }
  // "A. A. Karimov" — initials first.
  const lead = words.slice(0, -1).join(" ");
  if (words.length > 1 && INITIALS.test(lead)) return { family: words[words.length - 1]!, given: lead };
  // An organisation, or anything longer than a name: printed as written.
  if (words.length > 3 || words.length === 1) return { family: name, given: "" };
  return { family: words[words.length - 1]!, given: words.slice(0, -1).join(" ") };
}

/** "Karimov A. A., Rasulova B." or "Karimov A.; Rasulova B." or "John Smith and Jane Doe" → people. */
export function parseAuthors(raw: string): Person[] {
  const text = clean(raw, 600);
  if (!text) return [];
  let chunks = text.split(/\s*;\s*|\s+(?:va|and|и|ve|&)\s+/u).filter(Boolean);
  // "Karimov A., Rasulova B." — commas between people, each with their initials.
  chunks = chunks.flatMap((chunk) =>
    /^[^,]+\s(?:\p{Lu}\p{Ll}?\.\s?)+(?:,\s*[^,]+\s(?:\p{Lu}\p{Ll}?\.\s?)+)+$/u.test(chunk) ? chunk.split(/\s*,\s*/) : [chunk]);
  return chunks.map(parsePerson).filter((person) => person.family).slice(0, 20);
}

/* ---------------------------------------------------------------- sources */

/**
 * A source as the research returned it, or as an older work stored it
 * (`author`, `publisher`, `page`), made one shape.
 */
export function readSource(entry: unknown): Source | null {
  const raw = (entry ?? {}) as Record<string, unknown>;
  const title = clean(raw.title, 300);
  if (!title) return null;
  const listed = Array.isArray(raw.authors)
    ? (raw.authors as unknown[]).map((person) => {
      if (typeof person === "string") return parsePerson(person);
      const value = (person ?? {}) as Record<string, unknown>;
      return { family: clean(value.family, 120), given: clean(value.given, 120) };
    }).filter((person) => person.family).slice(0, 20)
    : [];
  const authors = listed.length > 0 ? listed : parseAuthors(String(raw.author ?? ""));
  const url = clean(raw.url, 500);
  const container = clean(raw.container ?? raw.journal, 300);
  const type = TYPES.has(String(raw.type)) ? raw.type as SourceType
    : container ? "article" : url && !clean(raw.publisher, 10) ? "web" : "book";
  return {
    type,
    authors,
    title,
    container,
    publisher: clean(raw.publisher, 200),
    place: clean(raw.place, 120),
    year: clean(raw.year, 12),
    volume: clean(raw.volume, 20),
    issue: clean(raw.issue, 20),
    pages: clean(raw.pages ?? raw.page, 40),
    doi: clean(raw.doi, 200).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    url,
  };
}

/* ------------------------------------------------------------ the words */

type Words = { noDate: string; etAl: string; and: string; online: string; available: string; vol: string; no: string; page: string; pages: string; in: string; electronic: string };

const WORDS: Record<DocLanguage, Words> = {
  uz: { noDate: "s.a.", etAl: "va boshq.", and: "va", online: "[Onlayn]", available: "Mavjud", vol: "Jild", no: "№", page: "B.", pages: "B.", in: "In", electronic: "[Elektron resurs]" },
  ru: { noDate: "б.г.", etAl: "и др.", and: "и", online: "[Онлайн]", available: "Доступно", vol: "Т.", no: "№", page: "С.", pages: "С.", in: "В кн.:", electronic: "[Электронный ресурс]" },
  en: { noDate: "n.d.", etAl: "et al.", and: "and", online: "[Online]", available: "Available", vol: "Vol.", no: "No.", page: "P.", pages: "P.", in: "In", electronic: "[Electronic resource]" },
  tr: { noDate: "t.y.", etAl: "vd.", and: "ve", online: "[Çevrimiçi]", available: "Erişim", vol: "Cilt", no: "Sayı", page: "S.", pages: "S.", in: "İçinde", electronic: "[Elektronik kaynak]" },
};

/** The international styles keep their own Latin abbreviations whatever the text's language. */
const intl = (language: DocLanguage): Words => (language === "ru" ? WORDS.ru : WORDS.en);

const year = (source: Source, words: Words) => source.year || words.noDate;
const end = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);
const doiLink = (source: Source) => (source.doi ? `https://doi.org/${source.doi}` : source.url);

/** Plain and italic pieces of one entry, joined into runs. */
type Piece = string | { italic: string };
function runs(pieces: readonly (Piece | null | false | undefined)[]): Run[] {
  const out: Run[] = [];
  for (const piece of pieces) {
    if (!piece) continue;
    if (typeof piece === "string") {
      const last = out[out.length - 1];
      if (last && !last.italic) last.text += piece;
      else out.push({ text: piece });
    } else if (piece.italic) {
      out.push({ text: piece.italic, italic: true });
    }
  }
  // Collapse the doubled spaces and orphan punctuation an absent field leaves.
  // The colon is left alone: GOST spaces it on both sides ("Toshkent : Fan") on purpose.
  for (const run of out) run.text = run.text.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1");
  return out.filter((run) => run.text);
}

/* --------------------------------------------------------- author lists */

const isPerson = (person: Person) => Boolean(person.given);

function apaName(person: Person) { return isPerson(person) ? `${person.family}, ${initials(person.given)}` : person.family; }
function gostName(person: Person) { return isPerson(person) ? `${person.family} ${initials(person.given)}` : person.family; }
function ieeeName(person: Person) { return isPerson(person) ? `${initials(person.given)} ${person.family}` : person.family; }
function vancouverName(person: Person) {
  return isPerson(person) ? `${person.family} ${initials(person.given).replace(/[.\s]/g, "")}` : person.family;
}

function apaAuthors(people: readonly Person[]): string {
  const names = people.map(apaName);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
}

function mlaAuthors(people: readonly Person[]): string {
  if (people.length === 0) return "";
  const first = isPerson(people[0]!) ? `${people[0]!.family}, ${people[0]!.given}` : people[0]!.family;
  if (people.length === 1) return first;
  if (people.length === 2) {
    const second = people[1]!;
    return `${first}, and ${isPerson(second) ? `${second.given} ${second.family}` : second.family}`;
  }
  return `${first}, et al`;
}

function chicagoAuthors(people: readonly Person[]): string {
  if (people.length === 0) return "";
  const names = people.map((person, index) =>
    !isPerson(person) ? person.family : index === 0 ? `${person.family}, ${person.given}` : `${person.given} ${person.family}`);
  if (names.length === 1) return names[0]!;
  if (names.length <= 10) return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `${names.slice(0, 7).join(", ")}, et al`;
}

function ieeeAuthors(people: readonly Person[]): string {
  const names = people.map(ieeeName);
  if (names.length === 0) return "";
  if (names.length > 6) return `${names[0]} et al.`;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function vancouverAuthors(people: readonly Person[]): string {
  const names = people.map(vancouverName);
  if (names.length === 0) return "";
  return names.length > 6 ? `${names.slice(0, 6).join(", ")}, et al` : names.join(", ");
}

/* ----------------------------------------------------------- the styles */

/**
 * One bibliography entry in a style, as runs — titles in italic where the
 * style sets them so. `number` is the entry's place in the list; numeric
 * styles print it, author-date styles do not.
 */
export function formatReference(source: Source, style: CitationStyle, number: number, language: DocLanguage): Run[] {
  const w = WORDS[language];
  const s = source;
  const link = doiLink(s);
  switch (style) {
    case "apa": {
      const who = apaAuthors(s.authors);
      const lead = who ? `${end(who)} (${year(s, intl(language))}). ` : "";
      if (s.type === "article") {
        return runs([
          who ? lead : "", who ? end(s.title) + " " : { italic: s.title }, who ? "" : ` (${year(s, intl(language))}). `,
          s.container ? { italic: s.container } : "", s.volume ? ", " : "", s.volume ? { italic: s.volume } : "",
          s.issue ? `(${s.issue})` : "", s.pages ? `, ${s.pages}` : "", ". ", link,
        ]);
      }
      if (s.type === "chapter") {
        return runs([lead, `${end(s.title)} `, "In ", { italic: s.container || s.title }, s.pages ? ` (pp. ${s.pages})` : "", ". ",
          s.publisher ? `${end(s.publisher)} ` : "", link]);
      }
      return runs([...(lead ? [lead, { italic: s.title }, ". "] : [{ italic: s.title }, `. (${year(s, intl(language))}). `]),
        s.type === "web" && s.container ? `${end(s.container)} ` : "", s.publisher ? `${end(s.publisher)} ` : "", link]);
    }
    case "mla": {
      const who = mlaAuthors(s.authors);
      const lead = who ? `${end(who)} ` : "";
      if (s.type === "article" || s.type === "chapter" || s.type === "web") {
        const after = [s.volume ? `vol. ${s.volume}` : "", s.issue ? `no. ${s.issue}` : "", s.publisher && s.type !== "article" ? s.publisher : "",
          s.year, s.pages ? `pp. ${s.pages}` : ""].filter(Boolean).join(", ");
        return runs([lead, `“${end(s.title)}” `, s.container ? { italic: s.container } : "", s.container && after ? ", " : "", after,
          s.container || after ? "." : "", link ? ` ${link}.` : ""]);
      }
      return runs([lead, { italic: s.title }, ". ", s.publisher ? `${s.publisher}, ` : "", s.year || "", ".", link ? ` ${link}.` : ""]);
    }
    case "chicago": {
      const who = chicagoAuthors(s.authors);
      const lead = who ? `${end(who)} ${end(year(s, intl(language)))} ` : "";
      if (!who) {
        return runs([s.type === "article" || s.type === "web" ? `“${end(s.title)}” ` : { italic: s.title }, s.type === "article" || s.type === "web" ? "" : ". ",
          `${end(year(s, intl(language)))} `, s.container ? { italic: s.container } : "", s.container ? ". " : "", s.publisher ? `${end(s.publisher)} ` : "", link ? `${link}.` : ""]);
      }
      if (s.type === "article") {
        return runs([lead, `“${end(s.title)}” `, s.container ? { italic: s.container } : "", s.volume ? ` ${s.volume}` : "",
          s.issue ? ` (${s.issue})` : "", s.pages ? `: ${s.pages}` : "", ".", link ? ` ${link}.` : ""]);
      }
      if (s.type === "chapter") {
        return runs([lead, `“${end(s.title)}” In `, { italic: s.container || s.title }, s.pages ? `, ${s.pages}` : "", ". ",
          s.place ? `${s.place}: ` : "", s.publisher ? `${end(s.publisher)}` : "", link ? ` ${link}.` : ""]);
      }
      return runs([s.type === "web" ? `“${end(s.title)}” ` : { italic: s.title }, s.type === "web" ? "" : ". ", lead ? "" : `${end(year(s, intl(language)))} `,
        s.type === "web" && s.container ? `${end(s.container)} ` : "", s.place ? `${s.place}: ` : "", s.publisher ? `${end(s.publisher)}` : "",
        link ? ` ${link}.` : ""]);
    }
    case "gost": {
      // ГОСТ Р 7.0.5–2008: the first author leads, the slash names them all, the dashes separate the areas.
      const lead = s.authors.length > 0 && s.authors.length <= 3 ? `${gostName(s.authors[0]!)} ` : "";
      const all = s.authors.map(ieeeName).join(", ");
      const responsibility = all ? ` / ${all}` : "";
      const electronic = s.type === "web" ? ` ${w.electronic}` : "";
      const online = link ? ` — URL: ${link}` : "";
      if (s.type === "article") {
        return runs([`${number}. `, lead, s.title, electronic, responsibility, s.container ? ` // ${s.container}.` : ".",
          s.year ? ` — ${s.year}.` : "", s.volume ? ` — ${w.vol} ${s.volume}` : "", s.issue ? `${s.volume ? "," : " —"} ${w.no} ${s.issue}.` : s.volume ? "." : "",
          s.pages ? ` — ${w.pages} ${s.pages}.` : "", online ? `${online}.` : ""]);
      }
      const area = [s.place, s.publisher].filter(Boolean).join(" : ");
      const imprint = [area, s.year].filter(Boolean).join(", ");
      return runs([`${number}. `, lead, s.title, electronic, responsibility, ".", imprint ? ` — ${imprint}.` : "",
        s.pages ? ` — ${w.pages} ${s.pages}.` : "", online ? `${online}.` : ""]);
    }
    case "ieee": {
      const who = ieeeAuthors(s.authors);
      const lead = `[${number}] ${who ? `${who}, ` : ""}`;
      if (s.type === "article") {
        return runs([lead, `“${s.title},” `, s.container ? { italic: s.container } : "", s.container ? ", " : "",
          s.volume ? `vol. ${s.volume}, ` : "", s.issue ? `no. ${s.issue}, ` : "", s.pages ? `pp. ${s.pages}, ` : "",
          s.year || intl(language).noDate, s.doi ? `, doi: ${s.doi}.` : ".", !s.doi && s.url ? ` ${intl(language).online}. ${intl(language).available}: ${s.url}` : ""]);
      }
      if (s.type === "web") {
        return runs([lead, `“${s.title},” `, s.container ? `${s.container}. ` : "", s.year ? `${s.year}. ` : "",
          s.url ? `${intl(language).online}. ${intl(language).available}: ${s.url}` : ""]);
      }
      return runs([lead, s.type === "chapter" ? `“${s.title},” in ` : "", { italic: s.type === "chapter" ? s.container || s.title : s.title }, ". ",
        s.place ? `${s.place}: ` : "", s.publisher ? `${s.publisher}, ` : "", s.year || intl(language).noDate, s.pages ? `, pp. ${s.pages}` : "", ".",
        s.url ? ` ${intl(language).online}. ${intl(language).available}: ${s.url}` : ""]);
    }
    case "vancouver": {
      const who = vancouverAuthors(s.authors);
      const lead = `${number}. ${who ? `${end(who)} ` : ""}`;
      if (s.type === "article") {
        return runs([lead, `${end(s.title)} `, s.container ? `${end(s.container)} ` : "", s.year || "", s.volume ? `;${s.volume}` : "",
          s.issue ? `(${s.issue})` : "", s.pages ? `:${s.pages}` : "", ".", s.doi ? ` doi:${s.doi}` : s.url ? ` Available from: ${s.url}` : ""]);
      }
      if (s.type === "web") {
        return runs([lead, `${s.title} [Internet]. `, [s.container, s.year].filter(Boolean).join("; "), s.container || s.year ? ". " : "",
          s.url ? `Available from: ${s.url}` : ""]);
      }
      return runs([lead, `${end(s.title)} `, s.place ? `${s.place}: ` : "", s.publisher ? `${s.publisher}; ` : "", s.year ? `${s.year}.` : "",
        s.url ? ` Available from: ${s.url}` : ""]);
    }
  }
}

/* -------------------------------------------------- the order and links */

const MARKER = /\[(\d{1,3}(?:\s*[-–,;]\s*\d{1,3})*)\]/g;

/** The source numbers inside one marker: "2, 5", "3–6", "1; 4". */
export function markerNumbers(inside: string): number[] {
  const out: number[] = [];
  for (const part of inside.split(/\s*[,;]\s*/)) {
    const range = part.split(/\s*[-–]\s*/).map(Number);
    if (range.length === 2 && range[0]! <= range[1]! && range[1]! - range[0]! <= 30) {
      for (let at = range[0]!; at <= range[1]!; at += 1) out.push(at);
    } else if (Number.isInteger(range[0])) {
      out.push(range[0]!);
    }
  }
  return [...new Set(out)];
}

export type Bibliography = {
  /** Original source indices (0-based) in the order the list prints them. */
  order: number[];
  /** Original source number (1-based) → its number in the printed list (1-based). */
  number: Map<number, number>;
};

/**
 * The order the list prints in. A numeric style numbers by first citation in
 * the text, so the first source the reader meets is [1]; sources the text
 * never cites follow, still listed. An author-date style sorts by the first
 * author's family name, then by year.
 */
export function bibliography(sources: readonly Source[], style: CitationStyle, texts: readonly string[]): Bibliography {
  let order: number[];
  if (NUMERIC.has(style)) {
    const seen: number[] = [];
    for (const text of texts) {
      for (const match of text.matchAll(MARKER)) {
        for (const number of markerNumbers(match[1]!)) {
          if (number >= 1 && number <= sources.length && !seen.includes(number - 1)) seen.push(number - 1);
        }
      }
    }
    order = [...seen, ...sources.map((_, index) => index).filter((index) => !seen.includes(index))];
  } else {
    const key = (source: Source) => (source.authors[0]?.family || source.title).toLocaleLowerCase();
    order = sources.map((_, index) => index).sort((a, b) =>
      key(sources[a]!).localeCompare(key(sources[b]!)) || (sources[a]!.year || "").localeCompare(sources[b]!.year || "") || a - b);
  }
  return { order, number: new Map(order.map((original, at) => [original + 1, at + 1])) };
}

/** The anchor a citation links to and its entry carries. */
export const referenceAnchor = (printed: number) => `ref_${printed}`;

function authorDate(source: Source, style: CitationStyle, language: DocLanguage): string {
  const words = intl(language);
  const names = source.authors.map((person) => person.family);
  const title = source.title.split(" ").slice(0, 4).join(" ");
  const join = style === "apa" ? " & " : " and ";
  const who = names.length === 0 ? `“${title}”`
    : names.length === 1 ? names[0]!
    : names.length === 2 ? `${names[0]}${join}${names[1]}`
    : `${names[0]} ${words.etAl}`;
  if (style === "mla") return who;
  return style === "apa" ? `${who}, ${year(source, words)}` : `${who} ${year(source, words)}`;
}

/**
 * One paragraph of prose with its markers turned into the style's citations,
 * as runs: plain text, and each citation a run that links to its entry.
 * A marker that names no source the work has is dropped, not printed.
 */
export function citationRuns(
  text: string,
  sources: readonly Source[],
  style: CitationStyle,
  list: Bibliography,
  language: DocLanguage,
): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    const start = match.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    at = start + match[0].length;
    const numbers = markerNumbers(match[1]!).filter((number) => number >= 1 && number <= sources.length);
    if (numbers.length === 0) {
      // The space before a dropped marker goes with it.
      const last = out[out.length - 1];
      if (last && !last.link) last.text = last.text.replace(/\s+$/, "");
      continue;
    }
    const printed = numbers.map((number) => list.number.get(number)!).sort((a, b) => a - b);
    const anchor = referenceAnchor(printed[0]!);
    let cite: string;
    if (style === "gost") cite = `[${printed.join(", ")}]`;
    else if (style === "ieee") cite = printed.map((number) => `[${number}]`).join(", ");
    else if (style === "vancouver") cite = `(${printed.join(", ")})`;
    else cite = `(${numbers.map((number) => authorDate(sources[number - 1]!, style, language)).join("; ")})`;
    out.push({ text: cite, link: anchor });
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out.filter((run) => run.text);
}

/** Author-date styles hang each entry; numeric ones lead with their number. */
export const hangs = (style: CitationStyle) => !NUMERIC.has(style);
