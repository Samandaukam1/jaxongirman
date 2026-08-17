import { DiagnosticBag } from "./diagnostics.ts";
import { JSLAYD_HEADER, LIMITS, SUPPORTED_VERSIONS } from "./spec.ts";

/**
 * The JSLAYD Design Prompt reader: text in, block tree out.
 *
 * It is a lexer and nothing more. It does not know what a colour is, which
 * properties exist or what a slide needs — that is the compiler's job. Keeping
 * the two apart is what makes "unknown command" a reliable error (§50): the
 * parser accepts any well-formed `key: value`, and the compiler rejects every
 * key it does not recognise by name.
 *
 * There is no expression syntax, no include, no reference to the filesystem and
 * nothing that could become code. A value is a string until the compiler
 * coerces it (§39).
 */

export type ParseNode = {
  key: string;
  value: string;
  line: number;
  indent: number;
  children: ParseNode[];
};

export type ParseSection = {
  /** `DESIGN`, `COLOR_FAMILY`, `SLIDE`, `ELEMENT`, … — always upper case. */
  name: string;
  /** The bracket argument: `[SLIDE cover_01]` → `cover_01`. Empty when absent. */
  arg: string;
  line: number;
  properties: ParseNode[];
  /** `[ELEMENT …]` blocks that followed this `[SLIDE …]`. */
  sections: ParseSection[];
};

export type ParseResult = {
  header: { version: string; line: number } | null;
  sections: ParseSection[];
};

const SECTION_PATTERN = /^\[([A-Z][A-Z0-9_]*)(?:\s+([^\]]+?))?\]$/;
/** Numeric keys exist so gradient stop offsets (`50: #FFB000`) read naturally. */
const PROPERTY_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*:\s*(.*)$/;

/** Sections that hang off the preceding `[SLIDE …]` rather than the document. */
const SLIDE_CHILD_SECTIONS = new Set(["ELEMENT"]);

/**
 * The one thing that is not JSLAYD-specific about this lexer.
 *
 * A second block language landed in this repo — JElement, which describes
 * reusable visual objects rather than slide compositions — and it is the same
 * shape: a header, `[SECTION arg]` blocks, indented `key: value` trees. Writing
 * a second lexer for it would mean two places to fix an indentation bug.
 *
 * So the vocabulary is a parameter and the lexing is not. The defaults are
 * JSLAYD's, so every existing caller is unchanged.
 */
export type Dialect = {
  /** `JSLAYD-DESIGN 1.0` — matched exactly on the first line. */
  header: string;
  /** The token before the version, used in error messages and the pattern. */
  keyword: string;
  supportedVersions: readonly string[];
  /** Sections that hang off the preceding parent rather than the document. */
  childSections: ReadonlySet<string>;
  /** The section a child attaches to. */
  parentSection: string;
};

type RawLine = { text: string; indent: number; line: number };

/**
 * Drops comments and blank lines, and measures indentation.
 *
 * A comment is a *whole line* beginning with `#`. Trailing comments are not a
 * thing in JSLAYD, and deliberately so: `color: #FF6A00` would be indis-
 * tinguishable from a commented-out value, and a language whose colours can be
 * eaten by its comment rule is not one anybody should have to debug.
 *
 * Tabs are rejected rather than assigned a width: two authors with different
 * tab settings would otherwise write files that nest differently, and JSLAYD
 * has to compile the same way everywhere (§6).
 */
function scan(source: string, bag: DiagnosticBag): RawLine[] {
  const lines: RawLine[] = [];
  const raw = source.split(/\r\n|\r|\n/);
  for (const [index, text] of raw.entries()) {
    const line = index + 1;
    if (!text.trim() || text.trimStart().startsWith("#")) continue;
    const leading = text.length - text.trimStart().length;
    if (text.slice(0, leading).includes("\t")) {
      bag.error("tab_indent", "Chekinish uchun tabulyatsiya ishlatilgan.", line, "Faqat probel ishlating.");
      continue;
    }
    lines.push({ text: text.trim(), indent: leading, line });
  }
  return lines;
}

/**
 * Reads a run of property lines into a tree.
 *
 * A property whose value is empty and which is followed by more-indented lines
 * owns them as children — that is how `gradient:` carries `stops:` carries the
 * offsets (§17). An empty value with nothing indented under it is a bare marker
 * and is handed to the compiler as-is; `[FONTS]` uses those to separate fonts.
 */
function readProperties(lines: RawLine[], start: number, floor: number, bag: DiagnosticBag): { nodes: ParseNode[]; next: number } {
  const nodes: ParseNode[] = [];
  let cursor = start;
  while (cursor < lines.length) {
    const current = lines[cursor]!;
    if (current.indent < floor) break;
    if (SECTION_PATTERN.test(current.text)) break;

    const match = PROPERTY_PATTERN.exec(current.text);
    if (!match) {
      bag.error(
        "unparsable_line",
        `Qatorni o'qib bo'lmadi: "${truncate(current.text)}".`,
        current.line,
        "Har bir qator `kalit: qiymat` yoki `[BO'LIM]` ko'rinishida bo'lishi kerak.",
      );
      cursor += 1;
      continue;
    }

    const node: ParseNode = { key: match[1]!, value: match[2]!.trim(), line: current.line, indent: current.indent, children: [] };
    cursor += 1;

    const following = lines[cursor];
    if (!node.value && following && following.indent > current.indent && !SECTION_PATTERN.test(following.text)) {
      const nested = readProperties(lines, cursor, following.indent, bag);
      node.children = nested.nodes;
      cursor = nested.next;
    }
    nodes.push(node);
  }
  return { nodes, next: cursor };
}

export function parse(source: string, bag: DiagnosticBag, dialect?: Dialect): ParseResult {
  const lang: Dialect = dialect ?? {
    header: JSLAYD_HEADER,
    keyword: "JSLAYD-DESIGN",
    supportedVersions: SUPPORTED_VERSIONS,
    childSections: SLIDE_CHILD_SECTIONS,
    parentSection: "SLIDE",
  };

  if (source.length > LIMITS.sourceBytes) {
    bag.error(
      "source_too_large",
      `Prompt juda katta (${Math.round(source.length / 1024)} KB).`,
      0,
      `Ruxsat etilgan chegara ${Math.round(LIMITS.sourceBytes / 1024)} KB.`,
    );
    return { header: null, sections: [] };
  }

  const lines = scan(source, bag);
  const result: ParseResult = { header: null, sections: [] };
  if (lines.length === 0) {
    bag.error("empty_source", "Prompt bo'sh.", 0, `Birinchi qator "${lang.header}" bo'lishi kerak.`);
    return result;
  }

  let cursor = 0;
  const first = lines[0]!;
  const headerMatch = new RegExp(`^${lang.keyword}\\s+(\\d+\\.\\d+)$`).exec(first.text);
  if (!headerMatch) {
    bag.error("missing_header", "Hujjat sarlavhasi topilmadi.", first.line, `Birinchi qator aynan "${lang.header}" bo'lishi kerak.`);
  } else {
    const version = headerMatch[1]!;
    if (!lang.supportedVersions.includes(version)) {
      bag.error(
        "unsupported_version",
        `${lang.keyword} ${version} versiyasi qo'llab-quvvatlanmaydi.`,
        first.line,
        `Mavjud versiyalar: ${lang.supportedVersions.join(", ")}.`,
      );
    }
    result.header = { version, line: first.line };
    cursor = 1;
  }

  let currentParent: ParseSection | null = null;
  while (cursor < lines.length) {
    const current = lines[cursor]!;
    const sectionMatch = SECTION_PATTERN.exec(current.text);
    if (!sectionMatch) {
      // Properties before any section have nowhere to belong. Reporting the
      // stray line beats silently folding it into a section it never named.
      bag.error("orphan_property", `"${truncate(current.text)}" hech qaysi bo'limga tegishli emas.`, current.line, "Avval `[BO'LIM]` e'lon qiling.");
      cursor += 1;
      continue;
    }

    const section: ParseSection = {
      name: sectionMatch[1]!,
      arg: (sectionMatch[2] ?? "").trim(),
      line: current.line,
      properties: [],
      sections: [],
    };
    cursor += 1;

    const body = readProperties(lines, cursor, 0, bag);
    section.properties = body.nodes;
    cursor = body.next;

    if (lang.childSections.has(section.name)) {
      if (!currentParent) {
        bag.error(
          "element_without_slide",
          `[${section.name} ${section.arg}] hech qaysi ${lang.parentSection.toLowerCase()}ga tegishli emas.`,
          section.line,
          `Har bir \`[${section.name} …]\` o'zidan oldingi \`[${lang.parentSection} …]\` ichida bo'lishi kerak.`,
        );
        continue;
      }
      currentParent.sections.push(section);
      continue;
    }

    if (section.name === lang.parentSection) currentParent = section;
    result.sections.push(section);
  }

  return result;
}

function truncate(value: string): string {
  return value.length <= 48 ? value : `${value.slice(0, 45)}…`;
}

/** Every property key in a node list, for the compiler's unknown-key sweep. */
export function keysOf(nodes: readonly ParseNode[]): string[] {
  return nodes.map((node) => node.key);
}

/** The first node with `key`, or undefined. Duplicates are the caller's problem. */
export function findNode(nodes: readonly ParseNode[], key: string): ParseNode | undefined {
  return nodes.find((node) => node.key === key);
}
