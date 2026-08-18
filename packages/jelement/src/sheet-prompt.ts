import { OBJECT_CLASSES, SLIDE_ROLES } from "./spec.ts";

/**
 * What an admin hands to an image model, and what has to come back with it.
 *
 * The library's elements are rendered CGI, so this asks for a render. It does
 * not ask anybody to describe one — that was tried, twice, and produced twelve
 * unidentifiable piles of rectangles. A lit, shadowed, physically plausible
 * object is not a set of boxes, and no wording makes it one.
 *
 * Two things come back. The sheet, and a JSON manifest naming what is on it.
 * They are separate because they are read by different things: the sheet is cut
 * by a browser, the manifest by a parser, and mixing them would mean neither
 * could be replaced without redoing the other.
 *
 * The grid discipline below is the part that took a failure to learn. An image
 * model composes; it does not lay out to a grid unless told to in the language
 * of margins and gaps, and even then it drifts — so the cutter isolates the
 * largest connected object in each cell rather than trusting the boundary.
 * Both halves are needed: the instruction reduces the drift, the cutter
 * survives what is left.
 */

const list = (values: readonly string[]) => values.join(", ");

export const SHEET_PROMPT = `${"=".repeat(60)}
JAXONGIRMAN — JELEMENT REFERENCE SHEET
${"=".repeat(60)}

You will produce TWO things:

  1. One transparent PNG sheet holding 12 objects on a strict 4x3 grid.
  2. One JSON manifest naming those 12 objects, in the same order.

Both are required. The sheet without the manifest cannot be imported, and the
manifest without the sheet names nothing.

${"-".repeat(60)}
PART 1 — THE SHEET
${"-".repeat(60)}

Subject: [TOPIC — e.g. Adabiyot fani, Konchilik, Tibbiyot]
Produce 12 distinct objects that a presentation about this subject would use.

STYLE
Modern creative-agency visual language, high-end advertising CGI, editorial
design aesthetic, sleek futuristic minimalism, bold and sophisticated.

EACH OBJECT
A single clear hero object. Instantly recognisable silhouette. Realistic
proportions with slightly stylised premium 3D details.

MATERIALS
Matte black, dark graphite and soft-touch surfaces, with selective electric
neon lime / acid green accents. Realistic material response, subtle
reflections, refined surface detail.

LIGHTING
Professional studio lighting, soft directional key light, controlled rim
lighting, realistic contact shadows, subtle ambient reflections, strong depth
and dimensionality.

QUALITY
Ultra-clean commercial CGI render, premium advertising quality, realistic
textures, crisp edges, physically plausible lighting, high detail.

${"-".repeat(60)}
LAYOUT — THE RULE THAT DECIDES WHETHER THIS WORKS
${"-".repeat(60)}

The sheet is cut apart on a 4x3 grid, so each object must live entirely inside
its own cell. This is not a composition instruction. It is a mechanical
requirement, and it is the one thing that has broken before: a fountain pen
laid diagonally reached into the next square, and the book in that square was
imported with a piece of pen attached to it.

  Canvas: 4096 x 3072 pixels, fully transparent background.
  Grid:   4 columns, 3 rows. Every cell is exactly 1024 x 1024.
  Order:  left to right, top to bottom. Cell 1 is top-left, cell 12 is
          bottom-right.

Inside each cell:

  The object is centred in its own cell.
  It occupies about 70% of the cell — roughly 700 of the 1024 pixels across
  its longest side.
  A clear empty margin of at least 120 pixels on all four sides.
  NOTHING crosses a cell boundary. Not a shadow, not a glow, not a ribbon,
  not the tip of a pen.
  No object overlaps, touches or connects to any other object.
  Every object is one connected piece. If it has separable parts — a quill
  and its inkwell — keep them touching, or the cutter will keep only the
  larger one.

Objects should read at a consistent scale. A pen and a bookcase are not the
same size in life; on this sheet they occupy similar space, because each one
will be placed on a slide on its own.

BACKGROUND
Fully transparent. No panel, no card, no gradient, no ground plane, no drop
shadow onto a surface. A contact shadow attached to the object is fine — a
shadow cast onto a background is not, because there is no background.

FORBIDDEN
No text. No letters. No numbers. No logo. No watermark. No UI.
No grid lines, no frames, no dividers, no labels between the cells.
No decorative filler objects.
Do not produce a poster, a slide or a composition. Twelve isolated objects.

OUTPUT
One high-resolution transparent PNG. Clean edges.

${"-".repeat(60)}
PART 2 — THE MANIFEST
${"-".repeat(60)}

Return this as a JSON code block, after the image. It is read by a parser, so
it must be valid JSON — no comments, no trailing commas, no prose around it.

The order matters and is the whole point of it: element with "cell": 1 is the
object in the top-left square, and so on to 12. Get this wrong and every
element in the library is mislabelled.

\`\`\`json
{
  "family": {
    "name": "Adabiyot — Premium CGI",
    "slug": "adabiyot-premium-cgi",
    "category": "Adabiyot",
    "subcategory": "Klassik adabiyot",
    "style": "Premium Editorial CGI",
    "description": "Qora grafit va neon yashil aksentli adabiyot elementlari."
  },
  "grid": { "columns": 4, "rows": 3 },
  "colorTokens": {
    "primary": "#151719",
    "secondary": "#292D2F",
    "accent": "#9BEA00",
    "metal": "#62686A",
    "glass": "#172322"
  },
  "elements": [
    {
      "cell": 1,
      "canonicalName": "open book",
      "displayName": "Ochiq kitob",
      "objectClass": "other",
      "group": "Klassik adabiyot",
      "aliases": ["book", "opened book", "reading book"],
      "uzbekTerms": ["ochiq kitob", "kitob", "mutolaa"],
      "englishTerms": ["open book", "reading"],
      "russianTerms": ["открытая книга", "книга"],
      "concepts": ["reading", "knowledge", "literature", "study"],
      "contexts": ["library", "classroom", "literature lesson"],
      "industries": ["education", "publishing"],
      "slideRoles": ["hero", "supporting"]
    }
  ]
}
\`\`\`

FIELD RULES

  cell           1-12, matching the object's square. Every cell used once.
  canonicalName  English, lowercase, what the object IS. Never how it looks:
                 "open book", not "black and green book".
  displayName    Uzbek, how an admin will recognise it in a list.
  group          The section within the subject, in Uzbek. For medicine:
                 "Kardiologiya", "LOR", "Diagnostika". For literature:
                 "Klassik adabiyot", "Yozuv", "Teatr". A family grows past a
                 hundred objects and a flat list of a hundred is a scroll, not
                 a library — so every element names its section, and somebody
                 searching for the section finds everything in it. Use few
                 sections and spell each one identically across the sheet:
                 "Kardiologiya" and "kardiologiya" are two sections.
  objectClass    One of: ${list(OBJECT_CLASSES)}
  uzbekTerms     REQUIRED. The product is used in Uzbek — an element with no
                 Uzbek name is invisible to the people it exists for. Include
                 the words somebody would actually type, not only the correct
                 term.
  aliases        Other English names for the same object.
  concepts       What it is FOR. This is how it gets found by a presentation
                 about something the object was never called: "literary
                 analysis" should find a quill.
  contexts       Where it appears.
  industries     Where it is used.
  slideRoles     Any of: ${list(SLIDE_ROLES)}
  colorTokens    The hex values actually present in the render. The accent is
                 read from the image anyway, so these are a cross-check rather
                 than the source of truth.

RULES

  1. Exactly 12 elements for a 4x3 sheet. Never pad the list to reach a count,
     and never return more objects than the grid holds. If a cell would be
     empty, make the grid smaller — an empty cell means the sheet and the
     manifest disagree about which object is which.
  2. Names describe the object, never its colour or finish. The family is
     recoloured; a name containing "green" stops being true the first time
     somebody uses it.
  3. Every object on the sheet appears in the manifest, and nothing else does.
  4. No geometry, no coordinates, no component lists, no path data. The render
     is the drawing. Describing it is not needed and not wanted.
`;

/**
 * The prompt for adding to a family that already exists.
 *
 * Built from what is there rather than written by hand, because the one thing
 * it must get right is the list of existing names — a model that does not know
 * the family already has an open book will return another one under a slightly
 * different name, and the duplicate is found after the round trip rather than
 * before it.
 */
export function sheetExpansionPrompt(
  family: { name: string; slug: string; category: string; style: string },
  existing: readonly string[],
  count = 12,
): string {
  const columns = count >= 12 ? 4 : count >= 6 ? 3 : 2;
  const rows = Math.ceil(count / columns);

  return `${SHEET_PROMPT}

${"=".repeat(60)}
EXPANDING AN EXISTING FAMILY
${"=".repeat(60)}

Family:   ${family.name} (${family.slug})
Subject:  ${family.category}
Style:    ${family.style}

This sheet extends that family, so it must match it: same materials, same
lighting, same accent colour, same camera treatment. An object that does not
sit beside the existing ones is worse than a missing one.

Grid for this sheet: ${columns} columns x ${rows} rows, ${count} objects.
Use "grid": { "columns": ${columns}, "rows": ${rows} } in the manifest.

ALREADY IN THE FAMILY — do not return any of these again, under any name:

${existing.length > 0 ? existing.map((name) => `  - ${name}`).join("\n") : "  (none yet)"}

Return objects that fill gaps rather than variations of what is listed. A
second book is not an addition; a lectern is.
`;
}
