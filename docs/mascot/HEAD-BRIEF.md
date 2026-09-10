# Jaxongir head — external modelling brief

The body, armour, rig and animation are generated procedurally from
`scripts/mascot/`. The one part that code cannot reach is a **photoreal likeness
of a specific person's face**, so the head can be sourced externally and dropped
into the same rig.

This file holds the brief to hand to whatever tool produces that head, and the
exact contract the result has to meet for `scripts/mascot/build.py` to accept it.

## What to attach

From `docs/mascot/reference/`:

| File | What it shows |
| --- | --- |
| `ref-7.png` | **The head sheet — the important one.** Front, 3/4, profile, back 3/4, top, up-angle, plus eye / hairline / hair / ear details |
| `face_front.png` | Front crop, forehead to chin |
| `face_profile.png` | Profile crop |
| `face_34.png` | Three-quarter crop |
| `ref-1.png`, `ref-2.png` | Full body front / back, for head-to-body proportion |

## The prompt

> Build a photorealistic 3D model of **the head only** of the man in the
> attached reference sheet, and export it as a glTF 2.0 binary (`.glb`).
>
> **Likeness is the whole point.** Match this specific person: skull shape,
> forehead, face width, cheekbones, jawline, chin, nose length / width / tip,
> eye spacing and shape, eyelid fold, eyebrow thickness and direction, lip
> shape, mouth width, ear shape and placement, hairline, hair volume and
> direction, side profile, back hair silhouette. Use the front, 3/4, profile,
> back, top and up-angle views together. It must not read as a generic Asian
> male — it must read as *this* man, stylised slightly for a premium 3D mascot
> but recognisable.
>
> **Everything must be real geometry.** No flat plane, billboard, sprite, decal
> or camera-facing card standing in for a feature. Specifically required as
> geometry: skull, face, nose, nostrils, lips, philtrum, chin, cheeks, ears
> (helix, concha, lobe), eyelids, and **separate eyeball spheres** set into the
> sockets. Hair must be real geometry — hair cards or strand meshes, not a
> painted-on texture and not one solid helmet-shaped blob.
>
> **Head only**, ending in a short neck stump cut flat just below the collar
> line. No shoulders, no clothing, no glasses, no hat.
>
> **Expression:** neutral. Mouth closed, lips together. Eyes open, gaze straight
> ahead. Symmetrical. Light stubble on the chin and upper lip as in the
> reference.
>
> **Placement and scale, exactly:**
> - `+Y` is up, the face looks down `+Z`.
> - The **chin** sits at the origin `(0, 0, 0)`.
> - The distance from the chin to the top of the skull (measured on the bone,
>   ignoring hair) is exactly **1.0 unit**.
> - The head is centred on `X = 0`.
>
> **Budget:** 10,000–30,000 triangles for the whole head including hair and
> eyes. Quad-dominant topology preferred, with edge loops following the eye and
> mouth openings.
>
> **UVs and textures:** one non-overlapping UV set. Ship a 2048×2048 PNG base
> colour map, plus normal and roughness maps if available. Textures belong on
> UV-mapped geometry — they are not a substitute for the geometry above.
>
> **Blend shapes** (morph targets), if the pipeline supports them, named exactly:
> `eyeBlinkLeft`, `eyeBlinkRight`, `mouthSmile`, `browInnerUp`, `jawOpen`.
>
> Deliver a single `.glb` containing the head mesh, the eyeball meshes, the hair
> mesh, materials and textures embedded.
>
> **Where this head ends up — design for it.** It is bolted onto an existing
> rigged purple-armoured robot body and rendered live in a mobile app, on the
> right-hand side of the account balance card, at roughly **180 CSS pixels tall
> on a phone**. So:
> - The head is deliberately **oversized, mascot proportion** — about a quarter
>   of total body height, as in the full-body reference. Do not "correct" it to
>   realistic human proportion.
> - It must read at small size: strong silhouette, clear hairline, eyes and
>   brows that survive being 6 pixels tall.
> - Keep the whole head under **1.5 MB** inside the GLB, textures included. It
>   is bundled into a phone app next to a 2.7 MB body.
> - Materials must be plain glTF PBR metallic-roughness. No custom shaders, no
>   subsurface extensions, no `KHR_materials_*` beyond `emissive_strength`.
> - Triangles, textures and blend shapes all count against a real-time budget of
>   60 fps on a mid-range phone.

## Where it lands in the app

The head is one asset in a pipeline that is already built; nothing downstream
changes when it is swapped in.

| Stage | File |
| --- | --- |
| Head + body + rig + animation, exported to one GLB | `scripts/mascot/build.py` |
| Bundled asset | `user/assets/mascot/jaxongirman.glb` |
| Live three.js scene, lights, camera, blink/smile driver | `user/src/components/mascot/stage.ts` |
| WebGL surface (expo-gl, native and web) | `user/src/components/mascot/MascotCanvas.tsx` |
| Public component | `user/src/components/AccountMascot.tsx` |
| Placed on the balance card | `user/app/(app)/(tabs)/index.tsx` |

On that card the character occupies its own flex column — 44% of the card width,
capped at 210 px — beside the balance figure and the tariff line, above the two
action buttons. He waves once when the tab is focused, then breathes on an idle
loop, blinking at irregular intervals.

## What to do with the result

Save it as `docs/mascot/head-external.glb`, then tell me. The builder scales it
by `0.47`, seats the chin at `z = 1.515` in body space, binds it rigidly to the
`head` bone and re-maps whatever blend shapes it carries onto the runtime's
`BlinkL` / `BlinkR` / `Smile` / `BrowRaise` / `MouthOpen` names, so nothing
downstream of the GLB changes.

## If the tool cannot output a 3D file

An LLM on its own cannot; it needs an image-to-3D or photogrammetry pipeline
behind it. Two fallbacks that still help:

1. **Multi-view image set.** Ask for clean, consistent renders of the same head
   at 0°, 30°, 60°, 90°, 120°, 150°, 180° yaw plus top and bottom, identical
   lighting and framing. Those feed a photogrammetry or image-to-3D tool.
2. **Keep the procedural head** and use the external result only to correct
   specific landmarks — nose projection, eye spacing, jaw width — which are the
   numbers at the top of `scripts/mascot/head.py`.
