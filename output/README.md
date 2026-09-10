# Jaxongir — photographic head reconstruction

Reconstruction of the head of the man in `docs/mascot/reference/ref-7.png`,
fitted from the supplied reference sheet with KeenTools FaceBuilder driven
entirely from Python in background Blender.

| File | What it is |
| --- | --- |
| `likeness_master.blend` | Editable master: fitted head, eyes, brows, hair, rig, morph targets |
| `likeness_final.glb` | Production glTF binary, 15.4 MB, 200 211 verts |
| `likeness_fit.blend` | The bare fitted skin, before eyes/brows/hair — the geometry-only diagnostic |
| `head_albedo.png` | 2048×2048 albedo projected from the photographs |
| `cameras.json` | The camera FaceBuilder solved per view, used for matched-camera validation |
| `facebuilder_state.bin` | Serialised FaceBuilder solve, so the fit can be resumed |
| `validation/` | All comparison and diagnostic sheets |

## Reconstruction method

KeenTools FaceBuilder 2026.3.1 with KeenTools Core, driven through
`pykeentools` rather than the viewport. The whole fit runs headless:

```
fb.set_centered_geo_keyframe(k)      register the view
fb.detect_faces(rgba, par)           find the face
fb.detect_face_pose(k, rect)         estimate the camera pose
fb.add_preset_pins_and_solve(k)      place the landmark pins and solve
fb.solve_for_current_pins(k)         re-solve as the shared identity moves
```

Pipeline, in order — each stage is a separate script under `scripts/mascot/`:

1. `facebuilder_fit.py` — multi-view fit, morph targets, texture bake
2. `head_features.py` — eyeballs, eyebrows, hair
3. `head_export.py` — rig, bind, GLB export
4. `roundtrip_check.py` — re-import and verify
5. `compare_head.py` / `validate_head.py` — validation renders
6. `measure_hairline.py` — quantitative hairline comparison

## References used

Two reference sets feed the fit. The original transparent crops
(`reference/views/`) were re-cut from `ref-7.png` using the sheet's own alpha,
with margins - the first cut was flush to each head, which clipped the
silhouette. The later contact sheets (`reference/incoming/`) are split by
`split_sheets.py` into `reference/views2/`.

**22 cameras, 17 of which drive the shape:**

| Source | Views |
| --- | --- |
| `ref-7.png` | `front`, `quarter_a`, `quarter_b`, `profile`, `up` |
| `01_full_face_multiview.png` | `m_front`, `m_q_left`, `m_profile`, `m_q_right`, `m_up` |
| `05_hair_head.png` | `h_front`, `h_q_left`, `h_profile`, `h_q_right`, `h_up`, `h_q_left2`, `h_q_right2` |
| Pose only | `down`, `m_down`, `h_down_a`, `h_down_b` — eyes closed or extreme angle, so they cover pixels but contribute no pins |
| Rejected | `h_back` — no face for the detector to find |

Going from 5 shape views to 17 is the largest single geometry gain in the
project: measured on the grey geometry, it broadened the face, filled the
cheeks and jaw, and improved front, three-quarter and profile *together*.

**Two views cannot be cameras.** The detail sheets (`02_eyes_eyebrows`,
`03_nose_ears`, `04_lips_chin_jaw`) are feature crops, not faces, so the
detector cannot register them. They were used by inspection and to drive the
brow measurement, but they do not constrain the solve.

## Two calibration findings that mattered

**The camera was fighting the solve.** `FaceBuilderCameraInputI.projection()`
is a callback: FaceBuilder asks *you* what lens each view was shot with. The
first implementation always answered "50 mm" while the solver was
simultaneously estimating 1946 px, 8483 px and so on. The shape absorbed the
contradiction by deforming — a narrow, deep skull. The camera input now feeds
the solved focal back each pass.

**One sheet meant one lens - until there were three sheets.** While every view
was a 1:1 crop of a single sheet, one shared focal had to explain them all, and
`set_static_focal_length_estimation` removed a large source of freedom the
solver had been using to explain a wrong skull. Once tiles from three different
sheets at different pixel scales were added that assumption no longer holds, so
the fit is back to per-view estimation with the sanity band and the feedback
loop. `--shared-focal` restores the single-focal mode.

## Rigidity: measured, not guessed

Solving straight at a low rigidity drops the shape into a narrow local minimum;
staying at the default leaves it on the template. Measured against the
reference silhouettes on front and profile together:

| Setting | Result |
| --- | --- |
| 1.0 (default) | Generic — recognisably FaceBuilder's mean face |
| 0.3 | Better |
| 0.08 single-stage | Broader, closer — best single value |
| 0.03 / 0.012 | Worse again: narrower and longer, ears pulled in |
| **1.0 → 0.4 → 0.15 → 0.08 ladder** | **Best. Broader jaw and fuller cranium than any single value, and it improves front and profile together** |

The ladder is the shipped default (`DEFAULT_SCHEDULE` in `facebuilder_fit.py`).

A silhouette-driven corrective pin pass (`refit_silhouette.py`) was built and
measured: it converges (mean contour error 2–8 px) but did not beat the ladder,
and its early versions pulled the jaw outwards by pinning to the **neck and
shoulders**. It is kept for reference but is not in the shipping path.

## Topology

FaceBuilder high-poly, preserved unmodified: **18 024 vertices, 17 978 quads**.
Quad-dominant with edge loops around the eyes and mouth, which is what lets the
FACS shapes deform cleanly. Mid-poly (4 646) and low-poly (1 497) variants are
available from the same solve via `fb.select_model()` if a lighter asset is
needed.

## Texture workflow

`pkt.texture_builder.build_texture` projects the photographs onto the fitted
UVs (KeenTools "butterfly" layout), **2048×2048**, with brightness and colour
equalisation on — the references were lit separately and without it the seams
between views are visible. UV bleed is raised to 2.0 % to cover the gaps the
reference set leaves.

The projector is given a **curated eight views**, not all twenty-one: handing
it every solved frame deadlocks the bake (the process sits at 0 % CPU
indefinitely). Those eight already see the whole face plus the crown, so the
rest add nothing but risk.

## Hair

A guide-and-child groom, all real geometry:

- 340 guide strands, each integrated across the **real scalp** by ray-casting
  the fitted mesh, following a comb field built from the reference hairstyle
  (short, side-parted, volume on top, sideburn in front of the ear)
- 19 children per guide → **6 460 strands**, scattered around each guide's root
  and pulled back towards it along the strand (clump 0.84), so tips gather
- Strand width 0.0014–0.0023 of head height, about **1.0–1.7 mm** at this
  head's scale. Finer would be more truthful but aliases into sparkle below
  roughly a pixel at render resolution
- Root slightly thicker and darker, tapering to 4 % at the tip — blunt
  cylindrical ends are exactly what reads as tubes
- 3 % flyaways, no more; beyond that it reads as frizz
- A closed dark cap underneath so no scalp shows between strands

**Hairline, measured rather than judged.** `measure_hairline.py` finds the
hair/skin boundary by luminance in both the photograph and a matched-camera
render and reports it as a fraction of head height. Reference **78.3 %**,
model **77.3 %**.

That number is a diagnostic, not an acceptance test: it measures only average
vertical placement. It says nothing about the hairline's *curve*, the temple
recession, the density gradient at the edge, or the sideburn transition — all
of which remain approximations of the reference rather than measurements of
it.

## Eyebrows, and the artifact they caused

The first brow build was a pair of solid ribbons. They rendered as pale slabs
lying across the upper eyelids - the "dark mass between the eyebrows and eyes".
`diagnose_eye.py` identified the cause by elimination: it renders the eye
region five times, hiding brows, eyeballs, hair and the texture in turn. With
`Brows` hidden the artifact disappeared; with the skin alone in grey the eyelid
anatomy was clean. So it was neither eyelashes, normals, nor z-fighting - the
ribbon was simply in the wrong place and the wrong colour.

They are now **4 800 individual tapered strands, 2 400 per side**, and their
placement is *measured* rather than guessed. `sample_albedo` reads the
projected photograph per vertex; the dark band above each eye is this man's
actual eyebrow, so `brow_spine` walks it in x and returns the brow's own centre
line - with his real left/right asymmetry, since each side is measured
separately. The search band starts 1.05 eye-radii above the eye centre: lower
than that and the lash line, which is also dark in the photograph, drags the
measured spine down onto the eyelid - which is exactly what the first strand
groom did.

## Materials

| Material | Setup |
| --- | --- |
| `JaxongirSkin` | Photographic albedo on UVs, roughness 0.52 |
| `Hair`, `Brow` | Near-black vertex-coloured, roughness 0.90, specular level 0.12 — thin overlapping tubes otherwise catch rim light from every angle and read grey |
| `Eye_L`, `Eye_R` | Vertex-coloured sclera / iris / pupil / limbus, roughness 0.075, with a corneal bulge over a shallow iris dish |

## Rig

Four bones: `neck` → `head` → `eye.L`, `eye.R`. Each mesh is bound rigidly to
its bone with an armature modifier, never applied, so shape keys survive.
Eyeballs get their own bones so gaze is independently drivable.

## Morph targets

Derived from KeenTools' fitted **51-shape ARKit FACS rig**
(`pkt.FacsExecutor`), not hand-sculpted. Five are exported, each a sum of the
FACS shapes that compose it — keeping all 51 over 18 k vertices would dwarf the
mesh itself:

| Exported | Composed from |
| --- | --- |
| `BlinkL` / `BlinkR` | `eyeBlinkLeft` / `eyeBlinkRight` |
| `Smile` | `mouthSmileLeft`, `mouthSmileRight`, `cheekSquintLeft`, `cheekSquintRight` |
| `BrowRaise` | `browInnerUp`, `browOuterUpLeft`, `browOuterUpRight` |
| `MouthOpen` | `jawOpen` |

Run `facebuilder_fit.py -- --all-facs` to write all 51 into the master instead.

## Export settings

`export_format=GLB`, `export_apply=False` (applying modifiers would destroy the
shape keys), `export_skins=True`, `export_morph=True`, `export_yup=True`,
`export_vertex_color=ACTIVE`, `export_image_format=JPEG` at quality 90.

## Validation

`validation/` holds, all rendered under flat neutral light with the Standard
view transform — AgX would flatten the render and invent a difference that is
not in the geometry:

| Sheet | What it shows |
| --- | --- |
| `geometry_only.png` | **Reference │ neutral-grey geometry │ overlay** for front, 3/4, profile. No texture, no hair — the shape on its own |
| `final_compare.png` | The same three views with the finished textured model |
| `free_angles.png` | Six angles matching **no** source photograph, from below, above and behind |
| `roundtrip_views.png` | Six views rendered from the re-imported GLB, not the authoring file |
| `morph_targets.png` | Neutral, blink, smile, brow raise, mouth open, combined |

Renders marked "matched camera" are made through the cameras FaceBuilder
solved, so the model lands in the same frame as the photograph it was fitted
to and the overlay is meaningful rather than approximate.

`roundtrip_check.py` re-imports the GLB into a clean scene and asserts 15
checks: geometry, vertex count, morph names, morph *deformation* (not just
presence), armature, bone names, skinning on every mesh, texture and UVs. It
diffs the object list around the import, because the KeenTools addon leaves a
42-vertex helper in the scene that is not part of the asset. **All 15 pass.**

## Limitations

**Evidence not yet available to the fit:** additional reference sheets exist
(bottom-up nose, four-angle ear close-ups, back and top of head, dense
eye/brow detail) but are not on disk, so they could not be added as cameras.
Dropping them into `docs/mascot/reference/incoming/` would let the next fit use
the bottom-up nasal base and the rear skull, neither of which the current
solve has any measurement for.

**Caused by the reference material:**

- The back of the skull is never shown unobscured by hair, so its shape is
  FaceBuilder's prior, not measurement. The same is true of the nape.
- Every view is lit from broadly the same direction, so the projected albedo
  retains some baked shading. Equalisation reduces the seams but cannot
  reconstruct what no view saw.
- The `down` view has the eyes closed, so it cannot contribute to eye shape.
- The detail close-ups (eye, brow, hair, ear) are not full faces, so the face
  detector cannot register them as cameras. They informed parameter choices by
  inspection but do not constrain the solve.

**The ears cannot be fitted per side.** All four ear crops in
`03_nose_ears.png` show the *same* ear from slightly different angles. There is
no photograph of the other ear, so independent left/right ear geometry is not
something the supplied evidence can support — inventing an asymmetry would be
fabrication, not reconstruction. The ears remain close to FaceBuilder's prior,
constrained only by the profile views.

**Caused by the method:**

- The fit is driven by KeenTools' ~24 automatically detected landmarks per
  view. That constrains overall proportion well but leaves internal features —
  brow ridge projection, nasal alar width, cheekbone prominence, the exact eye
  aperture — closer to the template than to this face. Closing that gap needs
  dense per-feature landmark correspondence, which the silhouette pass
  approximated for the outline but cannot reach for interior features.
- Skin is albedo only. No separate roughness, normal or displacement maps are
  generated, and there is no subsurface scattering set up.
- There are no teeth or tongue behind the lips, so `MouthOpen` should be driven
  conservatively.
