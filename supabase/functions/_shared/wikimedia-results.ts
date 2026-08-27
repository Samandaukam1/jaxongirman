import type { PhotoHit } from "./unsplash-results.ts";

/**
 * Reading a Wikimedia Commons search result, without doing the search.
 *
 * The third of three provider readers, split for the same reason as the other
 * two: the fetch needs a network and the decisions — which result is usable,
 * how a licence is spelled, which of ten candidates is the right one — need
 * neither and are the parts worth testing.
 *
 * Commons is what an encyclopaedia has and a stock library does not: Amir
 * Temur, the Registan, a diagram of the heart. It is also messier — a search
 * returns maps, coats of arms, scans of book covers and somebody's holiday
 * photograph of a signpost — so unlike the other two this one ranks rather than
 * taking the first usable answer.
 */

/** One page of a `generator=search` result, in the parts that are read. */
export type WikimediaPage = {
  title?: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width?: number;
    height?: number;
    mime?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: unknown }>;
  }>;
};

export type Orientation = "landscape" | "portrait" | "square" | "any";

/**
 * Formats every renderer in this system can actually draw.
 *
 * A slide is drawn by React Native on a phone, by the DOM on the web, and by
 * PowerPoint after export. Raster is the only thing all three agree on.
 */
const DRAWABLE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/**
 * A vector file is usable through its thumbnail, which MediaWiki renders as a
 * PNG. Taking the `.svg` itself would ship a file the phone cannot draw and
 * PowerPoint draws only in recent versions.
 */
const VECTOR = new Set(["image/svg+xml"]);

/** Below this a picture is a thumbnail, an icon or a scan of a stamp. */
const MIN_WIDTH = 600;

/**
 * Commons metadata arrives as HTML: the artist is a link, the credit is a
 * span. A credits slide shows text.
 */
export function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** `File:Amir Temur yer osti dahmasi 2.jpg` → `Amir Temur yer osti dahmasi 2`. */
export function fileTitle(title: string): string {
  return title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ").trim();
}

const orientationOf = (width: number, height: number): Orientation => {
  if (width <= 0 || height <= 0) return "any";
  const ratio = width / height;
  if (ratio > 1.15) return "landscape";
  if (ratio < 0.87) return "portrait";
  return "square";
};

/** How many of the query's words the title carries. 0–1. */
function titleOverlap(query: string, title: string): number {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  const haystack = title.toLowerCase();
  return words.filter((word) => haystack.includes(word)).length / words.length;
}

export type Ranked = { hit: PhotoHit; score: number; reason: string };

/**
 * Score every candidate and take the best, rather than the first.
 *
 * Commons answers a search for "Amir Temur" with a mausoleum, a banknote, a
 * street sign and a portrait, in whatever order its index likes. The first
 * result is not the right one often enough to take on trust, and picking at
 * random is worse than either.
 *
 * Everything here is deterministic: the same results in the same order always
 * produce the same choice, which is what makes a deck reproducible.
 */
export function rankWikimedia(
  pages: readonly WikimediaPage[],
  query: string,
  wanted: Orientation = "any",
): Ranked[] {
  const ranked: Ranked[] = [];

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;

    const mime = String(info.mime ?? "").toLowerCase();
    const vector = VECTOR.has(mime);
    if (!DRAWABLE.has(mime) && !vector) continue;

    /**
     * The thumbnail is the picture, not a preview of it.
     *
     * A Commons original is routinely 8192px wide — twenty megabytes to put on
     * a slide that is 1920 across. The rendered variant is what belongs in a
     * deck, and for a vector file it is the only form any of the renderers can
     * draw. The original is kept in the metadata so the choice is traceable.
     */
    const url = vector ? info.thumburl : (info.thumburl ?? info.url);
    if (!url) continue;

    const width = (vector ? info.thumbwidth : info.thumbwidth ?? info.width) ?? 0;
    const height = (vector ? info.thumbheight : info.thumbheight ?? info.height) ?? 0;
    // Judged on the file itself, not on the variant we asked for: a thumbnail
    // is 1600 wide because we asked for 1600, whatever the source was.
    const sourceWidth = info.width ?? width;
    if (sourceWidth > 0 && sourceWidth < MIN_WIDTH) continue;

    const meta = info.extmetadata ?? {};
    const creator = plainText(meta.Artist?.value) || plainText(meta.Credit?.value);
    const license = plainText(meta.LicenseShortName?.value) || plainText(meta.UsageTerms?.value);
    const licenseUrl = plainText(meta.LicenseUrl?.value);
    const sourceUrl = info.descriptionurl ?? "";
    const title = plainText(meta.ObjectName?.value) || fileTitle(String(page.title ?? ""));

    // Nobody to credit and nowhere to point is a picture that cannot be
    // published, whatever it shows. The same rule the other two providers use.
    if (!creator || !sourceUrl) continue;

    const overlap = titleOverlap(query, `${title} ${page.title ?? ""}`);
    const shape = orientationOf(width, height);

    let score = 0;
    const reasons: string[] = [];
    // What the picture is of matters most: a big photograph of the wrong thing
    // is still the wrong thing.
    score += overlap * 50;
    if (overlap > 0) reasons.push(`title ${Math.round(overlap * 100)}%`);
    if (wanted === "any" || shape === wanted) { score += 20; reasons.push(shape); }
    else if (shape === "square") { score += 8; reasons.push("square"); }
    // Enough pixels to be sharp on a 16:9 slide, and no credit for more.
    score += Math.min(15, (width / 1200) * 15);
    if (license) { score += 8; reasons.push(license); }
    if (licenseUrl) score += 4;
    // A rendered vector is fine but a photograph is usually what a slide wants.
    if (vector) score -= 6;

    ranked.push({
      score: Math.round(score * 100) / 100,
      reason: reasons.join(", "),
      hit: {
        url,
        width,
        height,
        mimeType: vector ? "image/png" : mime,
        originalUrl: info.url ?? url,
        attribution: {
          title: title || "Untitled",
          creator,
          license: license || "unknown",
          licenseUrl,
          sourceUrl,
          provider: "wikimedia",
        },
      },
    });
  }

  // Score first, then title, so an exact tie is broken the same way every run.
  return ranked.sort((first, second) =>
    second.score - first.score
    || (first.hit.attribution.title < second.hit.attribution.title ? -1 : 1));
}

/**
 * The best candidate, or nothing.
 *
 * `skip` steps past earlier choices for "another picture, same subject", the
 * same as the other two providers.
 */
export function bestWikimedia(
  pages: readonly WikimediaPage[],
  query: string,
  wanted: Orientation = "any",
  skip = 0,
): PhotoHit | null {
  const ranked = rankWikimedia(pages, query, wanted);
  return ranked[skip]?.hit ?? null;
}
