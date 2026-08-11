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

## Fonts — one thing is not finished

The design is built for **Metworkland** (the handwritten accent) and **Helvetica
Now Display** (headlines and body). Both are commercially licensed and neither
can be committed here, so the blueprint names them and the renderer substitutes
until the files exist:

| Intended | Substitute now | Why that one |
| --- | --- | --- |
| `Metworkland` | `PinyonScript_400Regular` | The only informal face bundled. It is calligraphic rather than marker-pen, so the accent reads as handwriting but **not yet as the reference.** |
| `HelveticaNowDisplay-Bold` | `LeagueSpartan_800ExtraBold` | The only bundled face heavy enough for an ultra-bold uppercase headline. Close in weight, wider in tracking. |
| `HelveticaNowDisplay` | `Manrope_400Regular` | Neutral grotesque, near enough at body size. |

The substitution lives in `FONT_FALLBACKS` in
[template-engine.ts](../supabase/functions/_shared/template-engine.ts).

### To get the intended faces

1. Add the `.ttf` files to **both**:
   - `user/assets/fonts/` — and register them in the app's font loader
   - `web/public/fonts/` — and add `@font-face` blocks in `web/app/globals.css`

   Name them exactly as the blueprint does: `Metworkland`,
   `HelveticaNowDisplay-Bold`, `HelveticaNowDisplay`.
2. Add those names to `BUNDLED` in `template-engine.ts` and delete their
   `FONT_FALLBACKS` entries.
3. `npm run templates:build -- --catalogue <YYYYMMDDHHMM>_toza_osmon_fonts` and
   push the migration, so the stored previews are regenerated with the real
   faces.
4. PDF export loads its own fonts from a URL
   ([pdf-export.ts](../supabase/functions/_shared/pdf-export.ts)) and still uses
   Manrope. Point it at the new files if exported PDFs must match the deck.

Until step 1, decks render and export correctly — they simply do not have the
reference's handwriting.

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
