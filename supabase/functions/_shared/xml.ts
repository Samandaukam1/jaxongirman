/**
 * A small XML reader, sized for OOXML.
 *
 * Office parts are machine-written and narrow: no DTDs, no entity definitions,
 * no processing instructions past the declaration. That makes a real tokenizer
 * cheap enough to hand-roll, and hand-rolling is worth it here — regexes over
 * markup break on the first nested `<a:p>` inside an `<a:p>`, and the input is
 * a file someone uploaded.
 *
 * Element names are stored without their namespace prefix, because the parts we
 * read never reuse a local name across namespaces and `sp` reads better than
 * `p:sp`. Attribute names keep theirs: OOXML really does put `id` and `r:id` on
 * the same element, and collapsing those would merge two different values.
 */

export type XmlNode = {
  /** Local name — `off` for `<a:off>`. */
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Direct text content, with entities resolved. */
  text: string;
};

export class XmlError extends Error {}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(":");
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

/** Parses a document and returns its root element. */
export function parseXml(source: string): XmlNode {
  let at = 0;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  const skipTo = (marker: string) => {
    const end = source.indexOf(marker, at);
    if (end === -1) throw new XmlError("XML tugallanmagan.");
    at = end + marker.length;
  };

  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open === -1) break;

    if (open > at) {
      const text = source.slice(at, open);
      const parent = stack[stack.length - 1];
      // Whitespace between elements is indentation. Whitespace inside `<a:t>`
      // is the space between two words of a sentence — PowerPoint splits a
      // paragraph into runs wherever formatting changes, and the run that
      // carries only a space is how the words stay apart.
      if (parent && (text.trim() || parent.name === "t")) parent.text += decodeEntities(text);
    }
    at = open;

    if (source.startsWith("<!--", at)) { skipTo("-->"); continue; }
    if (source.startsWith("<![CDATA[", at)) {
      const end = source.indexOf("]]>", at);
      if (end === -1) throw new XmlError("CDATA tugallanmagan.");
      const parent = stack[stack.length - 1];
      if (parent) parent.text += source.slice(at + 9, end);
      at = end + 3;
      continue;
    }
    if (source.startsWith("<?", at)) { skipTo("?>"); continue; }
    if (source.startsWith("<!", at)) { skipTo(">"); continue; }

    const close = source.indexOf(">", at);
    if (close === -1) throw new XmlError("Yorliq tugallanmagan.");
    const inner = source.slice(at + 1, close);
    at = close + 1;

    if (inner.startsWith("/")) {
      const finished = stack.pop();
      if (!finished) throw new XmlError("Ortiqcha yopuvchi yorliq.");
      if (finished.name !== localName(inner.slice(1).trim())) throw new XmlError("Yorliqlar mos kelmadi.");
      if (stack.length === 0) root = finished;
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const qualified = space === -1 ? body : body.slice(0, space);
    const node: XmlNode = { name: localName(qualified), attributes: {}, children: [], text: "" };

    if (space !== -1) {
      const attributeSource = body.slice(space);
      const attributePattern = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let match: RegExpExecArray | null;
      while ((match = attributePattern.exec(attributeSource)) !== null) {
        node.attributes[match[1]!] = decodeEntities(match[3] ?? match[4] ?? "");
      }
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);

    if (selfClosing) {
      if (!parent) root = node;
    } else {
      stack.push(node);
    }
  }

  if (stack.length > 0) throw new XmlError("XML tugallanmagan.");
  if (!root) throw new XmlError("XML bo‘sh.");
  return root;
}

/** The first direct child with this local name. */
export function child(node: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!node) return null;
  return node.children.find((candidate) => candidate.name === name) ?? null;
}

/** Every direct child with this local name. */
export function childrenNamed(node: XmlNode | null | undefined, name: string): XmlNode[] {
  if (!node) return [];
  return node.children.filter((candidate) => candidate.name === name);
}

/** Walks a chain of local names, e.g. `path(sp, "spPr", "xfrm", "off")`. */
export function path(node: XmlNode | null | undefined, ...names: readonly string[]): XmlNode | null {
  let current = node ?? null;
  for (const name of names) current = child(current, name);
  return current;
}

/** Every descendant with this local name, in document order. */
export function descendants(node: XmlNode | null | undefined, name: string): XmlNode[] {
  if (!node) return [];
  const found: XmlNode[] = [];
  const visit = (current: XmlNode) => {
    for (const candidate of current.children) {
      if (candidate.name === name) found.push(candidate);
      visit(candidate);
    }
  };
  visit(node);
  return found;
}

/** An attribute by exact name, then by local name if the prefix was unexpected. */
export function attribute(node: XmlNode | null | undefined, name: string): string | null {
  if (!node) return null;
  const exact = node.attributes[name];
  if (exact !== undefined) return exact;
  for (const [key, value] of Object.entries(node.attributes)) {
    if (localName(key) === name) return value;
  }
  return null;
}

/** An integer attribute, or null when absent or unparseable. */
export function integerAttribute(node: XmlNode | null | undefined, name: string): number | null {
  const raw = attribute(node, name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/** All text under a node, in document order. */
export function textOf(node: XmlNode | null | undefined): string {
  if (!node) return "";
  let output = node.text;
  for (const candidate of node.children) output += textOf(candidate);
  return output;
}
