import { faceFor, fontsByName, slugOf } from "@/lib/fontLibrary";
import { loadFace } from "@/lib/fontCache";

/**
 * Changing every typeface in a deck at once, without breaking a single page.
 *
 * A Liquid Glass deck is set in two families the engine chose for it — one for
 * display (titles, statements, big figures), one for text — and its layout was
 * measured in them. Swapping in a wider face as-is would push every line that
 * filled its box into the next element. So each text row is resized by how
 * much wider or narrower the new face runs (measured average advance, `em`):
 * a row set in a face 10% wider is set 10% smaller, so it breaks onto the same
 * lines it did before and occupies the same height. A narrower face keeps the
 * size it had — growing type is how overlaps start.
 *
 * The faces offered are the ones the generation engine draws from (see
 * `supabase/functions/_shared/glass/dna.ts`; `user/tests/deck-fonts.test.mjs`
 * keeps the two lists in step), each measured from its file.
 */

export type Pick = { family: string; weight: number; em: number };

export type Pairing = {
  key: string;
  label: string;
  display: Pick;
  strong: Pick;
  body: Pick;
};

const p = (family: string, weight: number, em: number): Pick => ({ family, weight, em });

export const PAIRINGS: readonly Pairing[] = [
  { key: "instrument", label: "Instrument + Vietnam", display: p("Instrument Serif", 400, 0.346), strong: p("Be Vietnam Pro", 600, 0.507), body: p("Be Vietnam Pro", 300, 0.483) },
  { key: "dmserif", label: "DM Serif + Poppins", display: p("DM Serif Display", 400, 0.446), strong: p("Poppins", 600, 0.509), body: p("Poppins", 300, 0.482) },
  { key: "gloock", label: "Gloock + Lato", display: p("Gloock", 400, 0.461), strong: p("Lato", 700, 0.448), body: p("Lato", 300, 0.432) },
  { key: "young", label: "Young Serif + Vietnam", display: p("Young Serif", 400, 0.513), strong: p("Be Vietnam Pro", 600, 0.507), body: p("Be Vietnam Pro", 400, 0.494) },
  { key: "prata", label: "Prata + Lato", display: p("Prata", 400, 0.478), strong: p("Lato", 700, 0.448), body: p("Lato", 300, 0.432) },
  { key: "gilda", label: "Gilda + Poppins", display: p("Gilda Display", 400, 0.464), strong: p("Poppins", 600, 0.509), body: p("Poppins", 300, 0.482) },
  { key: "caslon", label: "Caslon + Sarabun", display: p("Libre Caslon Display", 400, 0.375), strong: p("Sarabun", 600, 0.452), body: p("Sarabun", 300, 0.434) },
  { key: "playfair", label: "Playfair SC + PT Serif", display: p("Playfair Display SC", 700, 0.549), strong: p("PT Serif", 700, 0.492), body: p("PT Serif", 400, 0.456) },
  { key: "plex", label: "IBM Plex Serif", display: p("IBM Plex Serif", 600, 0.497), strong: p("IBM Plex Serif", 600, 0.497), body: p("IBM Plex Serif", 400, 0.485) },
  { key: "poppins", label: "Poppins", display: p("Poppins", 700, 0.517), strong: p("Poppins", 600, 0.509), body: p("Poppins", 300, 0.482) },
  { key: "vietnam", label: "Be Vietnam Pro", display: p("Be Vietnam Pro", 700, 0.514), strong: p("Be Vietnam Pro", 600, 0.507), body: p("Be Vietnam Pro", 300, 0.483) },
  { key: "kanit", label: "Kanit", display: p("Kanit", 600, 0.467), strong: p("Kanit", 500, 0.459), body: p("Kanit", 300, 0.445) },
  { key: "fira", label: "Fira Sans", display: p("Fira Sans", 700, 0.458), strong: p("Fira Sans", 600, 0.456), body: p("Fira Sans", 300, 0.443) },
];

/** Every pick the engine may have set a deck in, by face id — for reading a deck back. */
const KNOWN = new Map<string, Pick>();
for (const pairing of PAIRINGS) {
  for (const pick of [pairing.display, pairing.strong, pairing.body]) KNOWN.set(`jx_${slugOf(pick.family)}_${pick.weight}`, pick);
}

type Style = Record<string, unknown>;
type Row = { id: string; type: string; style: unknown; content: unknown };

const DISPLAY_ROLES = new Set(["title", "statement", "quote", "quote-mark", "statistic", "year"]);

/** Which of the three slots a text row is in, read from the face it is set in. */
function slotOf(style: Style, content: Style, deck: DeckFaces | null): "display" | "strong" | "body" {
  const face = typeof style.fontFamily === "string" ? style.fontFamily : "";
  if (deck) {
    if (face === deck.display) return "display";
    if (face === deck.strong) return "strong";
    if (face === deck.body) return "body";
  }
  const role = typeof content.role === "string" ? content.role : "";
  if (DISPLAY_ROLES.has(role)) return "display";
  return Number(style.fontWeight ?? 400) >= 600 ? "strong" : "body";
}

/** The face ids a deck was generated with, from its stored design. */
export type DeckFaces = { display: string; strong: string; body: string };

export function deckFacesOf(designDna: unknown): DeckFaces | null {
  const fonts = (designDna as { fonts?: Record<string, { family?: string; weight?: number }> } | null)?.fonts;
  const id = (pick?: { family?: string; weight?: number }) => (pick?.family && pick.weight ? `jx_${slugOf(pick.family)}_${pick.weight}` : "");
  if (!fonts?.display || !fonts.body) return null;
  return { display: id(fonts.display), strong: id(fonts.strong), body: id(fonts.body) };
}

/** A face as the style bag stores it, once its file is on the device. */
export type ResolvedFace = { fontFamily: string; fontDisplayName: string; fontAsset: string; fontWeight: string };

/**
 * Downloads and registers the three faces of a pairing.
 *
 * Resolves to null if any of them cannot be had — a deck half in the new
 * faces and half in the fallback would be worse than leaving it alone.
 */
export async function resolvePairing(pairing: Pairing): Promise<Record<"display" | "strong" | "body", ResolvedFace> | null> {
  const families = await fontsByName([...new Set([pairing.display, pairing.strong, pairing.body].map((pick) => slugOf(pick.family)))]);
  const bySlug = new Map(families.map((family) => [family.slug, family]));
  const out: Partial<Record<"display" | "strong" | "body", ResolvedFace>> = {};
  for (const slot of ["display", "strong", "body"] as const) {
    const pick = pairing[slot];
    const family = bySlug.get(slugOf(pick.family));
    const face = family ? faceFor(family, pick.weight, false) : null;
    if (!family || !face || face.weight !== pick.weight) return null;
    const name = await loadFace(family.slug, face);
    if (!name) return null;
    out[slot] = { fontFamily: name, fontDisplayName: family.name, fontAsset: face.storagePath, fontWeight: String(face.weight) };
  }
  return out as Record<"display" | "strong" | "body", ResolvedFace>;
}

/**
 * The new style of every text row, and nothing for any other row.
 *
 * Sizes only ever go down, by exactly how much wider the new face runs, so no
 * line can break later than it did and no box can grow into its neighbour.
 */
export function restyle(rows: readonly Row[], deck: DeckFaces | null, pairing: Pairing, faces: Record<"display" | "strong" | "body", ResolvedFace>): { id: string; style: Style }[] {
  const changes: { id: string; style: Style }[] = [];
  for (const row of rows) {
    if (row.type !== "text") continue;
    const style = (row.style && typeof row.style === "object" ? row.style : {}) as Style;
    const content = (row.content && typeof row.content === "object" ? row.content : {}) as Style;
    const slot = slotOf(style, content, deck);
    const old = KNOWN.get(String(style.fontFamily ?? "")) ?? { em: 0.5 };
    const ratio = Math.min(1, old.em / pairing[slot].em);
    const size = Number(style.fontSize ?? 30);
    const lineHeight = Number(style.lineHeight ?? size * 1.2);
    const next: Style = {
      ...style,
      ...faces[slot],
      fontSize: Math.round(size * ratio * 10) / 10,
      lineHeight: Math.round(lineHeight * ratio * 10) / 10,
    };
    changes.push({ id: row.id, style: next });
  }
  return changes;
}
