"""Isolate what is producing the dark mass over the upper eyelids.

    blender -b -P diagnose_eye.py -- [--blend F] [--out F]

Renders the same close-up of the eye region with one thing removed at a time -
brows, eyeballs, the skin texture - so the cause is identified by elimination
rather than guessed at and then painted over.
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


BLEND = arg("--blend", os.path.join(REPO, "output", "likeness_features.blend"))
OUT = arg("--out", os.path.join(REPO, "output", "validation", "eye_diagnosis.png"))

CASES = [
    ("all", set(), False),
    ("no_brows", {"Brows"}, False),
    ("no_eyes", {"EyeL", "EyeR"}, False),
    ("skin_only", {"Brows", "EyeL", "EyeR", "Hair"}, False),
    ("skin_grey", {"Brows", "EyeL", "EyeR", "Hair"}, True),
]

tiles = []
for name, hidden, grey in CASES:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    head = next((o for o in meshes if o.data.shape_keys), None)
    for other in meshes:
        if other.name in hidden:
            bpy.data.objects.remove(other, do_unlink=True)
    if grey:
        head.data.materials.clear()
        clay = bpy.data.materials.new("Clay")
        clay.use_nodes = True
        bsdf = clay.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (0.58, 0.57, 0.56, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.62
        head.data.materials.append(clay)

    for stale in [o for o in bpy.data.objects if o.type in {"LIGHT", "CAMERA"}]:
        bpy.data.objects.remove(stale, do_unlink=True)
    bkit.studio(0.95)
    bkit.configure_render((620, 460), samples=48)
    scene = bpy.context.scene
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    verts = np.empty(len(head.data.vertices) * 3, dtype=np.float32)
    head.data.vertices.foreach_get("co", verts)
    verts = verts.reshape(-1, 3)
    # Frame on the brow/eye band: the top third of the face, forward of centre.
    z_hi = float(np.percentile(verts[:, 2], 88))
    z_lo = float(np.percentile(verts[:, 2], 62))
    target = np.array([0.0, float(np.percentile(verts[:, 1], 6)), (z_hi + z_lo) * 0.5])
    span = max(z_hi - z_lo, 1e-3)
    distance = span * 3.6

    cam = bkit.camera(f"Cam_{name}", target + np.array([0.25, -1.0, 0.22]) * distance,
                      target, lens=85.0)
    path = os.path.join(REPO, "output", f"_eye_{name}.png")
    bkit.render_to(path, cam)
    tiles.append(path)
    print(f"[diag] {name}: hid {sorted(hidden) or 'nothing'}{' + grey' if grey else ''}",
          flush=True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bkit.contact_sheet(OUT, tiles, cols=len(tiles))
print("[diag] wrote", OUT)
