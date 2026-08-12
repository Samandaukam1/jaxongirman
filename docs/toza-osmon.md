# Toza osmon

A Premium design in the `super_professional` style: an open sky with an editorial
poster laid over it. Source of truth is
[supabase/functions/_shared/templates/toza-osmon.ts](../supabase/functions/_shared/templates/toza-osmon.ts);
the catalogue rows the apps read are generated from it.

## What makes it recognisable

Three properties, and every layout keeps all three:

1. **The type pairing.** A lime handwritten accent word against an ultra-bold
   black headline, overlapping by a tenth of the accent's height. Loose script
   against tight grotesque, acid yellow against black — that contrast is the
   identity, not the blue.
2. **Photographs are printed objects.** White border, deeper bottom border, soft
   shadow, a few degrees of lean. Never a plain image box.
3. **Air.** Most slides are mostly empty, and the clouds sit at the left and
   bottom edges where they never cross the words.

The accent is bound to `subtitle` and the headline to `title`, so a slide with no
accent still composes correctly — the handwriting simply does not render and the
headline keeps its place.

## Fonts

The design uses exactly two faces and nothing else touches a slide:

| Voice | Face | Where |
| --- | --- | --- |
| Handwritten accent | `CaveatBrush_400Regular` | The lime word over every headline |
| Headline | `Inter_900Black` | Every black uppercase title, and the numbers in lime markers |
| Body | `Inter_400Regular` | Micro headers, copy, bullets, captions |

### Why not the faces in the brief

The brief names **Metworkland** and **Helvetica Now Display**. Both are
commercially licensed — Helvetica Now is Monotype, per-weight; Metworkland is a
small-foundry display face — and neither can be committed to a repository or
fetched from a package registry. Downloading them from a free-font aggregator
would be redistributing licensed software.

So the design ships the closest Open Font License equivalents, chosen for shape
rather than convenience:

- **Caveat Brush** for Metworkland. A slanted marker hand with the same loose,
  energetic stroke the accent needs. It is a brush rather than a felt pen, so the
  terminals are softer than the reference.
- **Inter** for Helvetica Now Display. Both are neo-grotesques designed for
  screens; Inter's Black is heavy enough for the ultra-bold uppercase the design
  is built around, and using one family for headline and body mirrors the original
  pairing exactly.

Both are SIL OFL, free for commercial use and redistributable, which is why the
`.ttf` files sit in `web/public/fonts/` rather than being fetched at render time.

### Swapping in the licensed faces

If the real files are bought, it is three edits:

1. Add the `.ttf` files to `web/public/fonts/` with `@font-face` blocks in
   [globals.css](../web/app/globals.css), and load them in
   [user/app/_layout.tsx](../user/app/_layout.tsx).
2. Rename the three values in `blueprint.fonts` in
   [toza-osmon.ts](../supabase/functions/_shared/templates/toza-osmon.ts), and add
   the names to `BUNDLED` in
   [template-engine.ts](../supabase/functions/_shared/template-engine.ts).
3. Add them to `fontFace()` in
   [export-model.ts](../supabase/functions/_shared/export-model.ts) so PowerPoint
   asks for them by name.

Then `npm run templates:build -- --catalogue <YYYYMMDDHHMM>_toza_osmon_fonts` and
push, so the stored previews are regenerated.

### One export gap, and it is not new

PDF export draws everything in a single regular/bold pair — it has no font-role
model, so the handwritten accent and the ultra-bold headline both come out as
Manrope. This predates Toza osmon: Klassik's Pinyon Script eyebrow has always
exported the same way. PowerPoint export and on-screen rendering both use the real
faces. Fixing the PDF means threading a face through its whole text path, which is
a change worth making deliberately rather than as a side effect of adding a design.

## Rotation, and why the polaroids are built the way they are

The slot vocabulary has no rotation. A tilted print is therefore a stack of
frames — shadow, paper, image — each offset a little from the last, with the
offset direction encoding the lean. It reads as hand-placed at a glance and costs
the renderer nothing it cannot already do. If rotation is ever added to
`ShapeSlot` and `ImageSlot`, `polaroid()` is the one function to change.

## The eleven compositions, and the twelve layout names

The brief describes eleven compositions. The pipeline addresses slides by
`LayoutName`, of which there are twelve, so the compositions are mapped onto those
names and the busiest names carry several variants that the engine rotates by
slide position — which is also what stops one composition appearing twice in a
row.

| Brief | Layout name |
| --- | --- |
| 01 Hero cover | `cover` |
| 02 Welcome + photo | `title_body` (variant 1) |
| 03 Centred statement | `title_body` (3), `agenda` (2) |
| 04 Three points | `agenda` (1), `comparison` (2) |
| 05 Text between two photos | `two_columns` (1), `comparison` (1) |
| 06 Foundation list | `title_body` (2), `timeline` (2) |
| 07 Power statement | `quote` (2), `conclusion` (2) |
| 08 Question + notes | `two_columns` (2) |
| 09 Closing thought | `conclusion` (1) |
| 10 Next step | `timeline` (1) |
| 11 End card | `thanks` |

`statistic`, `chart` and `references` are not in the brief but the pipeline can
emit them, so each has a recipe in the same visual language rather than falling
back to another template's.

## Palette

`toza_osmon` in [palettes.ts](../supabase/functions/_shared/palettes.ts). It is
the only family whose `background` is a saturated colour rather than a near-white,
because here the sky *is* the ground.

Templates name colour roles, never hex, so Toza osmon renders with any family —
but it is designed for its own. Choosing another family gives a coherent deck that
is no longer this design.

## What was withdrawn

Four Premium designs were withdrawn on request: **Futuristik limon**, **Kecha
studiyasi**, **Editorial oyna**, **Kinematik qatlam**. Premium now offers
**Klassik** and **Toza osmon**.

Their blueprints stay in
[super-professional.ts](../supabase/functions/_shared/templates/super-professional.ts)
as `retiredSuperProfessionalTemplates`, and their catalogue rows stay with
`is_active = false`. Both are deliberate: a deck generated while a design was live
records its template code, and `resolveTemplate()` needs somewhere to look before
falling back. Deleting the rows would break re-export for those presentations.

Withdrawing another design is two edits: move it out of the active export in
`super-professional.ts`, then regenerate the catalogue. The builder emits the
deactivation from `retiredTemplateCodes` automatically — the upsert alone would
leave the old row active, which is the bug that made this mechanism necessary.
