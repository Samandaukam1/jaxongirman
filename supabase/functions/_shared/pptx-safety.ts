/**
 * What a template package is allowed to contain, and what it is.
 *
 * A `.pptx` is a ZIP an administrator uploaded, which makes it untrusted input
 * arriving with a trusted person's credentials — the combination that gets
 * waved through. `unzip.ts` already refuses the two structural attacks it can
 * see from where it sits: too many entries, and too much data once expanded.
 * What it cannot judge is meaning, because it does not know it is reading a
 * presentation.
 *
 * This does. It reads the package's own manifest, refuses the things a design
 * template has no reason to carry, and answers the only other question an
 * importer has: is this the same file somebody already uploaded.
 *
 * Deliberately free of Deno and of the parser: it takes entries and returns
 * findings, so every rule below is covered by `node --test` on a machine with
 * neither.
 */

export type ZipEntryMap = ReadonlyMap<string, Uint8Array>;

export type PackageProblem = {
  /** Stable, so a caller can branch without matching prose. */
  code:
    | "not_a_presentation"
    | "macros"
    | "embedded_object"
    | "external_reference"
    | "path_traversal"
    | "no_slides"
    | "too_many_slides"
    | "oversized_media";
  /** Uzbek, because an admin reads it. */
  message: string;
  /** The entry that caused it, when one did. */
  part?: string;
};

export type PackageReport = {
  ok: boolean;
  problems: PackageProblem[];
  slideParts: string[];
  mediaParts: string[];
  /** Every typeface named anywhere in the package, spelled as it was written. */
  fontNames: string[];
  totalBytes: number;
};

/** A design family is a handful of pages, not a deck somebody presented. */
export const MAX_TEMPLATE_SLIDES = 25;

/** One picture. Past this it is a photograph nobody meant to ship in a template. */
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

const decoder = new TextDecoder();

function text(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : "";
}

/**
 * Whether a stored name would escape the directory it claims to be in.
 *
 * Nothing here writes to a filesystem, so this cannot be exploited today. It is
 * checked anyway because "today" is doing a lot of work in that sentence: the
 * day somebody extracts a template to disk to run a converter over it, the
 * check has to already exist.
 */
export function escapesPackage(name: string): boolean {
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  if (/^[a-zA-Z]:/.test(name)) return true;
  const normalized = name.replace(/\\/g, "/");
  let depth = 0;
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") { depth -= 1; if (depth < 0) return true; continue; }
    depth += 1;
  }
  return false;
}

/**
 * The typefaces a template asks for.
 *
 * Read from the raw XML rather than from the parsed model on purpose: a font
 * can be named in a slide, in a layout, in a master or in the theme, and a
 * template that sets its heading face only in the master would otherwise look
 * like it uses none. Spelling is preserved — matching is somebody else's job
 * and needs the original to work from.
 */
export function fontNamesIn(entries: ZipEntryMap): string[] {
  const found = new Map<string, string>();
  for (const [name, bytes] of entries) {
    if (!/^ppt\/.*\.xml$/.test(name)) continue;
    for (const match of text(bytes).matchAll(/typeface="([^"]+)"/g)) {
      const face = match[1]!.trim();
      // `+mj-lt` and `+mn-lt` are references to the theme's own major and minor
      // faces, not names — following them is the theme's job, not a font's.
      if (!face || face.startsWith("+")) continue;
      const key = face.toLowerCase();
      if (!found.has(key)) found.set(key, face);
    }
  }
  return [...found.values()].sort();
}

/**
 * Reads a package and says whether it may be imported.
 *
 * Every problem is collected rather than thrown on the first one: an admin
 * fixing a template wants the list, and finding out about the macros only after
 * removing the embedded spreadsheet is two round trips for one upload.
 */
export function inspectPackage(entries: ZipEntryMap): PackageReport {
  const problems: PackageProblem[] = [];
  const slideParts: string[] = [];
  const mediaParts: string[] = [];
  let totalBytes = 0;

  for (const [name, bytes] of entries) {
    totalBytes += bytes.byteLength;

    if (escapesPackage(name)) {
      problems.push({
        code: "path_traversal",
        message: "Arxivdagi fayl nomi paket chegarasidan chiqib ketadi.",
        part: name,
      });
      continue;
    }

    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slideParts.push(name);
    if (/^ppt\/media\//.test(name)) {
      mediaParts.push(name);
      if (bytes.byteLength > MAX_MEDIA_BYTES) {
        problems.push({
          code: "oversized_media",
          message: `«${name.split("/").pop()}» juda katta — dizayn shabloni uchun ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB dan oshmasin.`,
          part: name,
        });
      }
    }

    // A template runs nothing. A macro project in one is either a mistake or
    // the reason the file was sent.
    if (/vbaProject\.bin$/i.test(name) || /\.pptm$/i.test(name)) {
      problems.push({ code: "macros", message: "Paket makros loyihasini o‘z ichiga oladi.", part: name });
    }

    // Embedded workbooks and OLE parts carry their own file formats and their
    // own parsers. A design needs neither.
    if (/^ppt\/embeddings\//.test(name)) {
      problems.push({
        code: "embedded_object",
        message: "Paketda ichki obyekt (OLE) bor — dizayn shablonida bunga ehtiyoj yo‘q.",
        part: name,
      });
    }
  }

  // Relationships that point outside the package. A template that fetches a
  // picture from somebody's server renders differently every time, and stops
  // rendering when that server does.
  for (const [name, bytes] of entries) {
    if (!/_rels\/.*\.rels$/.test(name)) continue;
    for (const match of text(bytes).matchAll(/TargetMode="External"[^>]*Target="([^"]*)"|Target="([^"]*)"[^>]*TargetMode="External"/g)) {
      const target = (match[1] ?? match[2] ?? "").trim();
      // A hyperlink is a link somebody clicks, not content the renderer fetches.
      if (/^(https?:)?\/\//i.test(target) && /hyperlink/i.test(text(bytes))) continue;
      problems.push({
        code: "external_reference",
        message: "Paket tashqi manbaga havola qiladi — dizayn o‘zi bilan to‘liq bo‘lishi kerak.",
        part: name,
      });
      break;
    }
  }

  const contentTypes = text(entries.get("[Content_Types].xml"));
  if (!contentTypes.includes("presentationml")) {
    problems.push({
      code: "not_a_presentation",
      message: "Bu fayl PowerPoint taqdimoti emas.",
    });
  }

  if (slideParts.length === 0) {
    problems.push({ code: "no_slides", message: "Paketda birorta slayd topilmadi." });
  } else if (slideParts.length > MAX_TEMPLATE_SLIDES) {
    problems.push({
      code: "too_many_slides",
      message: `Dizayn oilasida eng ko‘pi ${MAX_TEMPLATE_SLIDES} ta slayd bo‘ladi; bu paketda ${slideParts.length} ta.`,
    });
  }

  return {
    ok: problems.length === 0,
    problems,
    // `slide2` sorts before `slide10` as text and after it as a number, and the
    // order is the deck's order.
    slideParts: slideParts.sort((first, second) => slideNumber(first) - slideNumber(second)),
    mediaParts: mediaParts.sort(),
    fontNames: fontNamesIn(entries),
    totalBytes,
  };
}

function slideNumber(part: string): number {
  return Number(/slide(\d+)\.xml$/.exec(part)?.[1] ?? 0);
}

/**
 * The parts that decide whether two uploads are the same design.
 *
 * Not the whole package. PowerPoint rewrites `docProps/core.xml` on every save
 * — the author, the revision, the moment it was saved — and a thumbnail is
 * regenerated from the first slide. Hashing those would make one template
 * arriving from two machines look like two designs, which is the failure this
 * exists to prevent.
 */
export function hashableParts(entries: ZipEntryMap): string[] {
  return [...entries.keys()]
    .filter((name) => !/^docProps\//.test(name))
    .filter((name) => !/thumbnail\.(jpeg|jpg|png)$/i.test(name))
    .filter((name) => !/^_rels\/\.rels$/.test(name))
    .sort();
}

/**
 * A stable identity for a package, whatever it was named.
 *
 * `template.pptx` and `template-final.pptx` are one design, and checking by
 * filename means finding that out never. The digest covers each significant
 * part's name and bytes in a fixed order, so the same drawing hashes the same
 * from any machine.
 */
export async function packageHash(entries: ZipEntryMap): Promise<string> {
  const parts = hashableParts(entries);
  const encoder = new TextEncoder();

  // Length-prefixed, so a part named `a` holding `bc` cannot hash the same as
  // one named `ab` holding `c`.
  const chunks: Uint8Array[] = [];
  for (const name of parts) {
    const bytes = entries.get(name)!;
    const header = encoder.encode(`${name} ${bytes.byteLength} `);
    chunks.push(header, bytes);
  }

  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }

  const digest = await crypto.subtle.digest("SHA-256", joined);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
