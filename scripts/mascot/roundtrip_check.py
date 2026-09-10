"""Import the exported GLB back and prove it survived.

    blender -b -P roundtrip_check.py -- [--glb F] [--out DIR]

An export is not finished because the exporter returned without error. This
opens a clean scene, reads the GLB as any glTF runtime would, inventories what
came back, drives every morph target, and renders the validation set from the
imported data rather than from the authoring file.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

import bkit

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg("--glb", os.path.join(REPO, "output", "likeness_final.glb"))
OUT_DIR = arg("--out", os.path.join(REPO, "output", "validation"))

MORPH_SETS = [
    ("neutral", {}),
    ("blink", {"BlinkL": 1.0, "BlinkR": 1.0}),
    ("smile", {"Smile": 1.0}),
    ("brow_raise", {"BrowRaise": 1.0}),
    ("mouth_open", {"MouthOpen": 1.0}),
    ("combined", {"Smile": 0.85, "BlinkL": 0.5, "BlinkR": 0.5, "BrowRaise": 0.4}),
]

VIEWS = [("front", 0.0, 0.0), ("three_quarter_left", -35.0, 0.0),
         ("three_quarter_right", 35.0, 0.0), ("profile_left", -90.0, 0.0),
         ("profile_right", 90.0, 0.0), ("neutral_beauty", -22.0, 8.0)]

# Deliberately unlike any source photograph: if the reconstruction were merely
# tuned to explain one frame, these are the angles where it would fall apart.
FREE_VIEWS = [("free_low_left", -58.0, -22.0), ("free_high_left", -25.0, 30.0),
              ("free_rear_left", -138.0, 12.0), ("free_rear_right", 152.0, -8.0),
              ("free_high_right", 44.0, 26.0), ("free_low_front", 14.0, -28.0)]
if "--free" in argv:
    VIEWS = FREE_VIEWS

failures = []


def check(label, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {label}{': ' + detail if detail else ''}", flush=True)
    if not ok:
        failures.append(label)
    return ok


bkit.reset_scene()
# Diff the scene around the import: anything an addon leaves lying about is not
# part of the asset under test and must not be judged as if it were.
before = {o.name for o in bpy.data.objects}
bpy.ops.import_scene.gltf(filepath=GLB)
imported = [o for o in bpy.data.objects if o.name not in before]
for stray in [o for o in bpy.data.objects if o.name in before]:
    bpy.data.objects.remove(stray, do_unlink=True)

armatures = [o for o in imported if o.type == "ARMATURE"]
all_meshes = [o for o in imported if o.type == "MESH"]
# The asset's meshes are the ones the glTF skin actually drives; the importer
# also leaves an unparented helper object behind, which is not under test.
meshes = [o for o in all_meshes if o.parent in armatures] or all_meshes
extra = [o for o in all_meshes if o not in meshes]
print("[info] imported objects:", ", ".join(o.name for o in imported))
if extra:
    print("[info] ignoring non-asset objects:",
          ", ".join(f"{o.name}({len(o.data.vertices)}v, parent={o.parent})" for o in extra))
    for o in extra:
        bpy.data.objects.remove(o, do_unlink=True)
check("geometry imported", bool(meshes), ", ".join(o.name for o in meshes))
total_verts = sum(len(o.data.vertices) for o in meshes)
check("vertex count sane", total_verts > 20000, f"{total_verts} verts")

head = next((o for o in meshes if o.data.shape_keys), None)
check("morph targets survived", head is not None,
      ", ".join(k.name for k in head.data.shape_keys.key_blocks) if head else "none")

expected = {"BlinkL", "BlinkR", "Smile", "BrowRaise", "MouthOpen"}
if head:
    got = {k.name for k in head.data.shape_keys.key_blocks}
    check("all five morphs present", expected <= got, str(sorted(expected - got)) or "all")

check("armature survived", bool(armatures),
      ", ".join(b.name for a in armatures for b in a.data.bones))
if armatures:
    bones = {b.name for b in armatures[0].data.bones}
    check("rig bones intact", {"neck", "head", "eye.L", "eye.R"} <= bones, str(sorted(bones)))

skinned = [o for o in meshes if any(m.type == "ARMATURE" for m in o.modifiers)]
check("skinning survived", len(skinned) == len(meshes),
      f"{len(skinned)}/{len(meshes)} meshes bound")

images = [i for i in bpy.data.images if i.size[0] > 0]
check("texture survived", bool(images),
      ", ".join(f"{i.name} {i.size[0]}x{i.size[1]}" for i in images))

uv_ok = all(len(o.data.uv_layers) > 0 for o in meshes if o is head)
check("UVs survived", uv_ok)

# Morph targets must actually move geometry, not merely exist by name.
if head:
    base = np.empty(len(head.data.vertices) * 3, dtype=np.float32)
    head.data.shape_keys.key_blocks["Basis"].data.foreach_get("co", base)
    for name in sorted(expected):
        block = head.data.shape_keys.key_blocks.get(name)
        if block is None:
            continue
        other = np.empty_like(base)
        block.data.foreach_get("co", other)
        moved = float(np.abs(other - base).max())
        check(f"morph {name} deforms", moved > 1e-4, f"max delta {moved:.4f}")

# ------------------------------------------------------------------ renders

os.makedirs(OUT_DIR, exist_ok=True)
bkit.studio(0.9)
bkit.configure_render((560, 700), samples=48)
bpy.context.scene.render.film_transparent = True

corners = [m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
xs, ys, zs = ([c[i] for c in corners] for i in range(3))
centre = np.array([(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2])
radius = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) * 0.5
lens = 85.0
distance = radius / math.tan(math.atan(18.0 / lens)) * 1.30

tiles = []
for name, yaw, pitch in VIEWS:
    a, e = math.radians(yaw), math.radians(pitch)
    offset = np.array([math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)])
    cam = bkit.camera(f"Cam_{name}", centre + offset * distance, centre, lens=lens)
    path = os.path.join(OUT_DIR, f"{name}.png")
    bkit.render_to(path, cam)
    tiles.append(path)
sheet_name = "free_angles.png" if "--free" in argv else "roundtrip_views.png"
bkit.contact_sheet(os.path.join(OUT_DIR, sheet_name), list(tiles), cols=6)

if head:
    morph_tiles = []
    cam = bkit.camera("Cam_morph", centre + np.array([0.0, -1.0, 0.05]) * distance,
                      centre, lens=lens)
    for name, values in MORPH_SETS:
        for block in head.data.shape_keys.key_blocks:
            block.value = values.get(block.name, 0.0)
        path = os.path.join(OUT_DIR, f"morph_{name}.png")
        bkit.render_to(path, cam)
        morph_tiles.append(path)
    bkit.contact_sheet(os.path.join(OUT_DIR, "morph_targets.png"),
                       morph_tiles, cols=len(morph_tiles))

print("\n" + ("ROUND TRIP OK" if not failures else f"ROUND TRIP FAILED: {failures}"))
