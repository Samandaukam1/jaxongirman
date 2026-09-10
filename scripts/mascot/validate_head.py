"""Diagnostic renders of the fitted head.

    blender -b -P validate_head.py -- [--blend F] [--out DIR] [--tag NAME]
            [--flat] [--turn N]

Neutral studio lighting on purpose: dramatic light hides geometry errors, and
the point of these renders is to find them. `--flat` drops the texture so the
shape is judged on its own.
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


BLEND = arg("--blend", os.path.join(REPO, "output", "likeness_master.blend"))
OUT_DIR = arg("--out", os.path.join(REPO, "output", "validation"))
TAG = arg("--tag", "head")
FLAT = "--flat" in argv
TURN = int(arg("--turn", "0"))

bpy.ops.wm.open_mainfile(filepath=BLEND)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit(f"no mesh in {BLEND}")
# The head is the mesh carrying the shape keys; eyes and hair are siblings and
# must stay in frame rather than be mistaken for it.
with_keys = [o for o in meshes if o.data.shape_keys]
obj = (with_keys or meshes)[0] if len(with_keys) == 1 else max(
    with_keys or meshes, key=lambda o: len(o.data.vertices))
print("[val] head:", obj.name, "| meshes:", ", ".join(o.name for o in meshes))

if FLAT:
    for slot in obj.material_slots:
        if slot.material:
            slot.material.node_tree.nodes["Principled BSDF"].inputs["Base Color"] \
                .default_value = (0.62, 0.60, 0.58, 1.0)
            for link in list(slot.material.node_tree.links):
                if link.to_socket.name == "Base Color":
                    slot.material.node_tree.links.remove(link)

# Wipe whatever lighting the fit file carried and light it neutrally.
for other in [o for o in bpy.data.objects if o.type in {"LIGHT", "CAMERA"}]:
    bpy.data.objects.remove(other, do_unlink=True)
bkit.studio(0.9)
bkit.configure_render((560, 700), samples=48)
bpy.context.scene.render.film_transparent = True

corners = [m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
xs = [c.x for c in corners]
ys = [c.y for c in corners]
zs = [c.z for c in corners]
centre = np.array([(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2])
radius = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) * 0.5
print("[val] centre", centre.round(3), "radius", round(radius, 3))

# A portrait lens, ~85mm equivalent, so the validation renders carry the same
# perspective a real portrait would and the shape is judged fairly.
# Frame from the lens rather than a guessed multiplier: the sensor maps to
# whichever render dimension is larger, so this is the honest fit distance.
os.makedirs(OUT_DIR, exist_ok=True)
lens = 85.0
scene = bpy.context.scene
long_side = max(scene.render.resolution_x, scene.render.resolution_y)
short_side = min(scene.render.resolution_x, scene.render.resolution_y)
half_fov = math.atan(18.0 / lens)
distance = radius / math.tan(half_fov) * 1.30
if scene.render.resolution_y > scene.render.resolution_x:
    distance *= max(1.0, radius / (radius * short_side / long_side) * 0.55)

MORPH_SETS = [
    ("neutral", {}),
    ("blink", {"BlinkL": 1.0, "BlinkR": 1.0}),
    ("smile", {"Smile": 1.0}),
    ("brow_raise", {"BrowRaise": 1.0}),
    ("mouth_open", {"MouthOpen": 1.0}),
    ("smile_blink", {"Smile": 0.85, "BlinkL": 0.6, "BlinkR": 0.6, "BrowRaise": 0.35}),
]

if "--morphs" in argv:
    keys = obj.data.shape_keys
    if not keys:
        raise SystemExit("no shape keys on the head")
    print("[val] shape keys:", [k.name for k in keys.key_blocks])
    tiles = []
    for name, values in MORPH_SETS:
        for block in keys.key_blocks:
            block.value = values.get(block.name, 0.0)
        cam = bkit.camera(f"Cam_{name}", centre + np.array([0.0, -1.0, 0.06]) * distance,
                          centre, lens=lens)
        path = os.path.join(OUT_DIR, f"morph_{name}.png")
        bkit.render_to(path, cam)
        tiles.append(path)
        print("[val] morph", name, values)
    sheet = os.path.join(REPO, "output", f"{TAG}_morphs.png")
    bkit.contact_sheet(sheet, tiles, cols=len(tiles))
    print("[val] wrote", sheet)
    raise SystemExit(0)

if TURN:
    views = [(f"turn_{i:02d}", 360.0 * i / TURN, 0.0) for i in range(TURN)]
else:
    views = [("front", 0.0, 0.0), ("three_quarter_left", -35.0, 0.0),
             ("three_quarter_right", 35.0, 0.0), ("profile_left", -90.0, 0.0),
             ("profile_right", 90.0, 0.0), ("neutral_beauty", -22.0, 8.0)]

tiles = []
for name, yaw, pitch in views:
    a, e = math.radians(yaw), math.radians(pitch)
    offset = np.array([math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)])
    cam = bkit.camera(f"Cam_{name}", centre + offset * distance, centre, lens=lens)
    path = os.path.join(OUT_DIR, f"{name}.png")
    bkit.render_to(path, cam)
    tiles.append(path)

sheet = os.path.join(REPO, "output", f"{TAG}_sheet.png")
bkit.contact_sheet(sheet, list(tiles), cols=min(len(tiles), 6))
print("[val] wrote", sheet)
