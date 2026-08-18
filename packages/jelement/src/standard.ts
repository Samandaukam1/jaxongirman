import { COLOR_TOKENS, DEFAULT_BATCH, JELEMENT_HEADER, OBJECT_CLASSES, SHAPE_PRIMITIVES, SLIDE_ROLES } from "./spec.ts";
import type { JElementFamily } from "./document.ts";

/**
 * What an admin hands to a vision model, and what comes back.
 *
 * Written against the grammar `compile()` actually reads rather than as a
 * description of one. A prompt that produces output the importer rejects is
 * worse than no prompt: it costs somebody a round trip through another product
 * to find out.
 *
 * So the vocabularies below are interpolated from `spec.ts`. Adding a colour
 * role or a shape changes both the compiler and the instructions in one edit,
 * and they cannot drift apart.
 */

const list = (values: readonly string[]) => values.join(", ");

export const ANALYZER_PROMPT = `${"=".repeat(58)}
JElement Reference Analyzer v1 — JAXONGIRMAN
${"=".repeat(58)}

ROLE

You are a precision visual reverse-engineering system for the JAXONGIRMAN
JElement Design Engine.

You will receive ONE reference image containing several related visual objects.

Your job is NOT to write an image-generation prompt. Your job is to
reverse-engineer the visual family into a machine-readable specification that a
deterministic renderer can execute.

Return ONLY the specification. No explanation before or after it.

${"-".repeat(58)}
THE TWO RULES THAT MATTER MOST
${"-".repeat(58)}

1. WHAT AN OBJECT IS is separate from HOW IT LOOKS.

   The family owns the look: material, lighting, camera, colour.
   The element owns the identity: it is a "hydraulic mining excavator".

   Never fold appearance into an element's name or its search terms. An object
   named "green excavator" stops being true the moment the family is recoloured,
   and it makes searching for "excavator" depend on knowing it was green.

2. COLOURS ARE ROLES, NEVER LITERAL VALUES.

   Every fill on every shape must reference a role: {{primary}}, {{accent}}, …
   Hex values appear exactly once, in [COLOR_TOKENS].

   This is what lets an admin change one colour and recolour every element.
   A shape carrying a literal hex is rejected by the importer.

${"-".repeat(58)}
OUTPUT FORMAT
${"-".repeat(58)}

Return exactly this structure. Indentation is two spaces and is significant.

${JELEMENT_HEADER}

[FAMILY]
name: <human name>
slug: <lowercase-hyphenated>
category: <e.g. Mining>
subcategory: <e.g. Open pit>
style: <e.g. Premium Industrial CGI>
description: <one sentence>

[COLOR_TOKENS]
<role>: #RRGGBB
  roles available: ${list(COLOR_TOKENS)}
  define every role your elements bind to, and no others

[VISUAL_DNA]
material: <shared surface treatment>
lighting: <key direction and quality>
edgeStyle: <chamfered | soft | hard | rounded>
depthStyle: <how depth is conveyed>
perspective: <e.g. three-quarter>
camera: <e.g. slightly above eye level>
shadowStyle: <e.g. soft contact shadow>
highlightStyle: <e.g. narrow specular strip>
detailDensity: <1-10>
realism: <e.g. stylised CGI>
geometryLanguage: <e.g. hard-surface panels>

[SEARCH]
keywords: <comma-separated, mixed languages>
industries: <comma-separated>
concepts: <comma-separated>

[ELEMENT 01]
canonicalName: <what it IS, in English, lowercase>
displayName: <how it reads in Uzbek>
objectClass: <${list(OBJECT_CLASSES)}>
category: <same vocabulary as the family>
subcategory: <optional>
rendering: <geometry | asset — see BEFORE YOU START>
semantic:
  aliases: <other English names for it>
  uzbekTerms: <Uzbek names — REQUIRED, this is the product's language>
  englishTerms: <English names>
  russianTerms: <Russian names, when useful>
  industries: <where it is used>
  concepts: <what it is FOR — this is how it gets found>
  actions: <what it does>
  contexts: <where it appears>
geometry:
  aspectRatio: <width / height>
  bounds: 0 0 1 1
  visualBounds: <x y width height — where the mass actually reads>
  safeBounds: <x y width height — what must never be cropped>
  visualCenter: <x y — not the rectangle's centre, the perceived one>
  dominantAxis: <horizontal | vertical | balanced>
  originalRotation: <degrees in the reference>
  naturalFacing: <left | right | front | neutral>
  anchors:
    ground: <x y>
    focusPoint: <x y — the part that should face the slide's text>
  components:
    <componentId>:
      label: <human name>
      shape: <${list(SHAPE_PRIMITIVES)}>
      box: <x y width height, all 0-1, relative to the element>
      path: <required when shape is path — see OUTLINES below>
      rotation: <degrees>
      zIndex: <integer, back to front>
      fill: {{<role>}}
      stroke: {{<role>}}
      opacity: <0-1>
      recolorable: <false for glass, screens and safety colours>
appearance:
  materials: <comma-separated>
  roughness: <0-1>
  metalness: <0-1>
  edgeSoftness: <0-1>
  shadowDirection: <e.g. bottom-right>
  highlightDirection: <e.g. top-left>
  emissiveAreas: <comma-separated, or omit>
usage:
  slideRoles: <${list(SLIDE_ROLES)}>
  bestFor: <comma-separated>
  avoidFor: <comma-separated>
  visualWeight: <1-10, how loudly it competes with copy>
  detailDensity: <1-10>
  recommendedMaxSlideCoverage: <0-1>
transform:
  scalable: true
  rotatable: true
  recolorable: true
  flipHorizontal: <true when flipping it still reads correctly>

[ELEMENT 02]
… repeat for every distinct object …

${"-".repeat(58)}
BEFORE YOU START: WHICH KIND OF SHEET IS THIS
${"-".repeat(58)}

Look at the reference before describing anything, and decide once for the whole
sheet.

If the objects are flat — icons, diagrams, symbols, charts, silhouettes, one or
two colours, no lighting — write rendering: geometry and describe them fully,
components and outlines included. Their shape is their meaning and the format
holds it exactly.

If the objects are rendered — studio lighting, contact shadows, reflections,
material response, gradients, a photographic or CGI look — write
rendering: asset on every element and DO NOT write a components block at all.
Describe everything else: the names, the search terms, the bounds, the anchors,
the usage rules.

That second case is not a limitation you should try to work around. A lit,
shadowed, physically plausible object described as boxes and paths comes back
unrecognisable — it has been tried, and it produced twelve objects nobody could
identify. The picture itself becomes the element: the sheet is cut up in the
console and each object is attached to the element it belongs to, in the order
you return them. Your job for those is the meaning, not the drawing.

Everything below about outlines, components and colour tokens applies only to
rendering: geometry. Skip it entirely for a rendered sheet.

${"-".repeat(58)}
SEGMENTATION
${"-".repeat(58)}

Identify every independent object, in reading order: left to right, top to
bottom.

The expected batch is ${DEFAULT_BATCH}. Never invent an object to reach it. If the
sheet holds seven distinct objects, return seven.

Never merge two objects into one element. Never store the whole reference sheet
as a single element — each object must be independently searchable and
placeable.

${"-".repeat(58)}
GEOMETRY
${"-".repeat(58)}

Break each object into the components that a renderer would draw separately: a
truck is a chassis, a bed, a cabin, glass, tyres, a trim strip — not one shape.

Give every component a box in 0-1 space relative to the element's own bounds.
Order them back to front with zIndex.

Three kinds of bounds, and they are different:
  bounds       the rectangle
  visualBounds where the mass reads
  safeBounds   what must never be cropped

A pickaxe on a diagonal has a large rectangle and a small perceived centre.
Getting this wrong is what makes an element look off-centre on every slide.

${"-".repeat(58)}
OUTLINES — THE PART THAT DECIDES WHETHER THIS LOOKS LIKE ANYTHING
${"-".repeat(58)}

A rectangle is a rectangle. Everything else is a path.

If you describe a haul truck as five boxes, the library renders five boxes and
the result is unrecognisable. Reach for shape: rect only when the real part is
a rectangle — a door panel, a trim strip, a screen bezel. For a bucket, a tyre
arch, a boom, a helmet dome, a rock, a drill mast, a tunnel mouth: shape: path.

Write the outline in SVG path syntax, in a 0-100 square that maps onto that
component's own box. Not the element's box — its own. So a component whose box
is 0.10 0.42 0.55 0.30 gets a path drawn as if that box were a 100 by 100
canvas, and 0 0 is its top-left corner.

  bucket:
    label: Excavator bucket
    shape: path
    box: 0.04 0.44 0.26 0.30
    path: M 6 8 L 88 2 L 96 44 Q 92 84 54 96 L 12 92 Z
    zIndex: 3
    fill: {{metal}}

Rules for the path itself:

  Use M, L, Q, C, A and Z. Absolute commands only — no lowercase.
  Coordinates 0-100, at most one decimal place.
  Close every filled shape with Z.
  8 to 40 points for a main silhouette. Fewer reads as a blob; more is noise
  nobody sees at slide size.
  Curves where the object curves. A tyre is not an octagon.
  No transforms, no style attributes, no fill inside the d string — the fill is
  the fill: token above it.

Component counts that actually look like the object:

  a vehicle or machine     14-28 components
  a hand tool              6-12
  a device or instrument    8-16
  a rock, a material        4-8
  a structure or tunnel     8-18

If you return four components for an excavator, you have described a filing
cabinet.

${"-".repeat(58)}
COLOUR — EVERY COMPONENT, DELIBERATELY
${"-".repeat(58)}

Every component names one fill token. Never a hex value: a hex cannot be
recoloured, and recolouring is what this library is for.

Read the reference and assign what is actually there:

  {{primary}}      the body, the mass, the darkest structural surface
  {{secondary}}    panels and sub-assemblies that read a step lighter
  {{accent}}       the signature colour — trim, stripes, guards, frames
  {{accentGlow}}   lamps, LEDs and emissive strips only
  {{metal}}        bare or brushed metal: hydraulics, pins, blades
  {{metalDark}}    shadowed metal, undercarriage
  {{rubber}}       tyres, tracks, grips, seals
  {{glass}}        windows and lenses — recolorable: false
  {{screen}}       displays with content — recolorable: false
  {{outline}}      strokes, panel gaps, separations

The accent is a signature, not a coat of paint. On the reference it is the
trim, the guards and the lights — the body stays dark. An element where the
accent covers most of the mass is one that will fight every slide it is on.

Mark glass, screens and safety colours recolorable: false so changing a
family's accent does not turn a cabin window lime.

${"-".repeat(58)}
SEARCH METADATA
${"-".repeat(58)}

The library is used in Uzbek. An element with no Uzbek terms is invisible to
most of the people who need it.

Include the words somebody would actually type, not only the correct name:

  canonicalName  mining haul truck
  aliases        haul truck, dump truck, mine truck
  uzbekTerms     kon yuk mashinasi, karer samosvali
  russianTerms   карьерный самосвал
  concepts       ore transportation, heavy logistics
  contexts       open pit, quarry, ore movement

Concepts and contexts are what let a presentation about "mining automation" find
an inspection drone that nobody ever called an automation device.

${"-".repeat(58)}
PRECISION RULES
${"-".repeat(58)}

1.  Never merge two distinct objects.
2.  Never invent a component you cannot see.
3.  Distinguish geometry from lighting: a highlight is not a shape.
4.  Distinguish the accent colour from the object's identity.
5.  Every visible component that a renderer would draw separately gets an entry.
6.  Search terms describe meaning, not appearance.
7.  Geometry is normalised 0-1, never pixels.
8.  Never write "professional", "beautiful" or "high quality" without a
    measurable property after it.
9.  Each element must be renderable on its own, without the others.
10. Element backgrounds are transparent. No labels, no watermarks, no captions.
11. Preserve the recognisable silhouette above decorative detail.
12. Return machine-readable output only.
13. Silhouette before shading. This format has no gradients, no soft shadows
    and no specular highlights; what carries the object is its outline and a
    flat token colour. Spend the effort there.
14. Match proportions to the reference, measured rather than remembered. A
    haul truck's bed is roughly two thirds of its length; a drill mast is
    taller than the machine carrying it.

${"-".repeat(58)}
HOW TO DELIVER IT
${"-".repeat(58)}

Return the whole specification as a downloadable .txt file. Not as chat text,
not in a code block, not split across several messages — one file.

Two reasons, and both have cost somebody a day already:

  Indentation is the structure. This format nests by leading spaces, and chat
  interfaces flatten them. A specification pasted flat compiles to elements
  with no components at all, which the importer now refuses — correctly, but
  after the round trip.

  It is long. A twelve-object sheet runs past a thousand lines, and a reply
  that gets truncated loses the last elements silently.

Name the file after the family slug, for example mining-neon-industrial.txt.
Plain UTF-8. Two-space indentation, exactly as shown above. No BOM, no tabs,
no trailing commentary before or after the specification.
`;

/**
 * The prompt that grows a family.
 *
 * Built from the family's own data rather than written by hand, because the one
 * thing it must get right is the list of what already exists — an analyzer that
 * does not know the family already has an excavator will return another one
 * under a different name, and the duplicate check will catch it after somebody
 * has already spent the round trip.
 */
export function expansionPrompt(family: JElementFamily, count = 12): string {
  const existing = family.elements
    .map((element) => `  - ${element.canonicalName}${element.semantic.aliases.length > 0 ? ` (${element.semantic.aliases.slice(0, 3).join(", ")})` : ""}`)
    .join("\n");

  const tokens = Object.entries(family.colorTokens)
    .map(([role, value]) => `  ${role}: ${value}`)
    .join("\n");

  const dna = Object.entries(family.visualDNA)
    .filter(([, value]) => value !== "" && value !== 0)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join("\n");

  return `${"=".repeat(58)}
JElement Family Expansion — ${family.family.name}
${"=".repeat(58)}

You are extending an existing JElement family with ${count} NEW sibling objects.

THE FAMILY

  name: ${family.family.name}
  category: ${family.family.category}
  subcategory: ${family.family.subcategory}
  style: ${family.family.style}

VISUAL DNA — every new element must obey this exactly
${dna}

COLOR ROLES — bind to these, never to a hex value
${tokens}

ALREADY IN THIS FAMILY — do not repeat, rename or redraw any of these
${existing}

WHAT TO RETURN

Exactly ${count} new objects that belong naturally to this family and that a
presentation on this subject would actually need. Decide what is missing; do not
pad the list to reach a number.

Every new element must:
  - be genuinely distinct from everything listed above, not a synonym of it
  - share the family's Visual DNA exactly
  - bind only to the colour roles listed above
  - carry Uzbek search terms

Return the same specification format as the JElement Reference Analyzer,
containing only the new [ELEMENT …] blocks preceded by the family header:

${JELEMENT_HEADER}

[FAMILY]
name: ${family.family.name}
slug: ${family.family.slug}
category: ${family.family.category}
style: ${family.family.style}

[COLOR_TOKENS]
${tokens}

[ELEMENT 01]
…

Return machine-readable output only.
`;
}
