/**
 * Finding the file a template asked for.
 *
 * An imported design names its typefaces and ships none of them, so it draws in
 * a fallback until somebody supplies the files. Most of the time the typeface
 * is one of the open families anybody can fetch, and making an administrator
 * hunt for `Inter` by hand is asking them to do a machine's errand — and to do
 * it once per design, since nothing would remember the tenth time.
 *
 * What this file is careful about is that "fetch a font" is a request to an
 * outside host, made by a server, with a name that came from a file somebody
 * uploaded. So the host is fixed rather than derived, the name is escaped into
 * a query parameter rather than a path, the response is checked for being an
 * actual font rather than trusted for having the right extension, and there is
 * a ceiling on the bytes.
 *
 * Pure. The fetching itself is the caller's; this decides what to ask for and
 * what came back.
 */

/** The only hosts a font may come from. Not a prefix check — the whole host. */
const STYLESHEET_HOST = "fonts.googleapis.com";
const FILE_HOST = "fonts.gstatic.com";

/** A face file past this is not a text font; it is somebody's mistake. */
export const MAX_FONT_BYTES = 4 * 1024 * 1024;

/** The weights worth carrying: a body face, a bold, and their italics. */
export const WANTED_WEIGHTS = [400, 700] as const;

export type FontRequest = { family: string; weights: readonly number[]; italics: boolean };

/**
 * Where to ask for a family.
 *
 * `URLSearchParams` does the escaping, so a family named `../../etc` is a
 * query value that finds nothing rather than a path that finds something.
 *
 * The user agent is deliberately ancient. Google serves WOFF2 to anything
 * modern, and WOFF2 is exactly what this project cannot use: the PDF exporter
 * embeds faces with `fontkit`, which reads TrueType. Asking as a browser from
 * 2010 is how you are handed a `.ttf`.
 */
export function stylesheetRequest(request: FontRequest): { url: string; headers: Record<string, string> } {
  const weights = [...new Set(request.weights)].sort((first, second) => first - second);
  const axes = request.italics
    ? `ital,wght@${weights.map((weight) => `0,${weight}`).join(";")};${weights.map((weight) => `1,${weight}`).join(";")}`
    : `wght@${weights.join(";")}`;

  const parameters = new URLSearchParams();
  parameters.set("family", `${request.family}:${axes}`);
  parameters.set("display", "swap");

  return {
    url: `https://${STYLESHEET_HOST}/css2?${parameters.toString()}`,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.112 Safari/534.30" },
  };
}

export type DiscoveredFace = { url: string; weight: number; italic: boolean; format: string };

/**
 * The faces a stylesheet offers.
 *
 * Read with a regex rather than a CSS parser because the input is one
 * generator's output in one shape, and a parser would be a dependency bought to
 * be more general than the problem. Anything that does not look like a face is
 * skipped rather than guessed at.
 */
export function readStylesheet(css: string): DiscoveredFace[] {
  const faces: DiscoveredFace[] = [];
  for (const block of css.split("@font-face")) {
    const source = /src:\s*url\(([^)]+)\)\s*format\('([^']+)'\)/.exec(block);
    if (!source) continue;
    const url = source[1]!.replace(/['"]/g, "").trim();
    if (!isFontFile(url)) continue;

    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? 400);
    const italic = /font-style:\s*italic/.test(block);
    const format = source[2] === "truetype" ? "ttf" : source[2] === "opentype" ? "otf" : source[2]!;
    // Only what every consumer reads. `fontkit` in the PDF exporter does not
    // take WOFF2, and a face nobody can embed is worse than a missing one
    // because it looks present.
    if (format !== "ttf" && format !== "otf") continue;
    faces.push({ url, weight, italic, format });
  }

  // One file per weight and slope; a stylesheet that lists a face twice is
  // offering the same file, not two.
  const seen = new Set<string>();
  return faces.filter((face) => {
    const key = `${face.weight}${face.italic ? "i" : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether a URL is a font file on the one host fonts come from. */
export function isFontFile(candidate: string): boolean {
  let url: URL;
  try { url = new URL(candidate); } catch { return false; }
  if (url.protocol !== "https:") return false;
  // Equality, not `endsWith`: `fonts.gstatic.com.example.com` ends with it.
  return url.hostname === FILE_HOST;
}

/**
 * Whether the bytes are a font at all.
 *
 * A download that returns an error page with a 200 is a real thing, and storing
 * it under `.ttf` produces a design that fails to render with no clue why. Four
 * bytes settle it.
 */
export function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === "OTTO" || tag === "true" || tag === "ttcf") return true;
  // TrueType's own version number, 0x00010000.
  return bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;
}

/**
 * One spelling of a family name.
 *
 * `Playfair Display`, `playfair display` and `PlayfairDisplay` are one family
 * and must share one shelf, or the deduplication this exists for never
 * happens.
 */
export function normaliseFamily(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The file name a face is stored under, built here rather than from a URL. */
export function faceFileName(fontId: string, weight: number, italic: boolean, format: string): string {
  return `${fontId}-${weight}${italic ? "i" : ""}.${format}`;
}
