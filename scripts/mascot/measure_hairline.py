"""Measure the hairline in the photograph and in the render, and compare.

    blender -b -P measure_hairline.py -- [--blend F] [--view front]

The hairline is an identity feature and it is the one part of the groom that
can be measured rather than judged: hair is far darker than forehead skin, so
scanning down each column for the first bright pixel finds the boundary in both
the reference and a matched-camera render. Reported as a percentage of head
height so the two are directly comparable.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Matrix

import bkit

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


BLEND = arg("--blend", os.path.join(REPO, "output", "likeness_features.blend"))
CAMERAS = arg("--cameras", os.path.join(REPO, "output", "cameras.json"))
VIEW = arg("--view", "front")
VIEW_DIRS = [os.path.join(REPO, "docs", "mascot", "reference", "views"),
             os.path.join(REPO, "docs", "mascot", "reference", "views2")]


def view_path(name):
    for folder in VIEW_DIRS:
        candidate = os.path.join(folder, f"{name}.png")
        if os.path.exists(candidate):
            return candidate
    return None
UNCORRECT = Matrix.Rotation(math.radians(-90.0), 4, "X")


def read_png(path):
    image = bpy.data.images.load(path)
    w, h = image.size[:2]
    channels = image.channels
    buf = np.empty(w * h * channels, dtype=np.float32)
    image.pixels.foreach_get(buf)
    bpy.data.images.remove(image)
    out = buf.reshape(h, w, channels)
    if out.shape[2] == 3:
        out = np.dstack([out, np.ones((h, w, 1), dtype=np.float32)])
    return out


def hairline_profile(rgba, columns=13):
    """For each sampled column, the row where hair gives way to skin.

    Returned bottom-up in pixels alongside the head's own vertical extent, so
    the caller can express it as a fraction of head height.
    """
    alpha = rgba[..., 3] > 0.5
    luma = rgba[..., :3].mean(axis=2)
    rows = np.flatnonzero(alpha.any(axis=1))
    if len(rows) < 20:
        return None
    bottom, top = int(rows[0]), int(rows[-1])
    cols = np.flatnonzero(alpha.any(axis=0))
    left, right = int(cols[0]), int(cols[-1])
    # Only the middle of the head: the temples are where hair wraps round and
    # the boundary stops being a hairline.
    span = right - left
    xs = np.linspace(left + span * 0.34, right - span * 0.34, columns).astype(int)

    skin = np.percentile(luma[alpha], 72)
    hair = np.percentile(luma[alpha], 12)
    threshold = hair + (skin - hair) * 0.55

    out = []
    for x in xs:
        column = luma[:, x]
        inside = alpha[:, x]
        # Walk down from the crown looking for the first sustained bright run.
        found = None
        for y in range(top, bottom, -1):
            if not inside[y]:
                continue
            window = column[max(bottom, y - 6):y + 1]
            if window.size and window.mean() > threshold:
                found = y
                break
        if found is not None:
            out.append((int(x), int(found)))
    return out, bottom, top


with open(CAMERAS) as handle:
    cameras = {c["name"]: c for c in json.load(handle)}
entry = cameras[VIEW]
w, h = entry["width"], entry["height"]

bpy.ops.wm.open_mainfile(filepath=BLEND)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
head = next((o for o in meshes if o.data.shape_keys), None)
for other in meshes:
    if other is not head and other.parent is not head:
        other.parent = head
for other in [o for o in bpy.data.objects if o.type in {"LIGHT", "CAMERA"}]:
    bpy.data.objects.remove(other, do_unlink=True)

world = bpy.data.worlds.new("Flat")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.35
bkit.configure_render((w, h), samples=24)
scene = bpy.context.scene
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

data = bpy.data.cameras.new("Matched")
data.sensor_fit = "HORIZONTAL"
data.sensor_width = 36.0
data.lens = entry["focal_px"] * 36.0 / w
cam = bpy.data.objects.new("Matched", data)
bpy.context.collection.objects.link(cam)
cam.location = (0.0, 0.0, 0.0)
cam.rotation_euler = (0.0, 0.0, 0.0)
scene.camera = cam
head.matrix_world = Matrix(entry["model_mat"]) @ UNCORRECT

path = os.path.join(REPO, "output", f"_hairline_{VIEW}.png")
bkit.render_to(path, cam)

reference = read_png(view_path(VIEW))
render = read_png(path)
os.remove(path)

for label, image in (("reference", reference), ("render", render)):
    result = hairline_profile(image)
    if result is None:
        print(f"[hair] {label}: no silhouette")
        continue
    points, bottom, top = result
    height = max(top - bottom, 1)
    fractions = [(y - bottom) / height for _, y in points]
    print(f"[hair] {label:9s} head rows {bottom}..{top}  hairline "
          f"mean {np.mean(fractions) * 100:5.1f}%  "
          f"min {np.min(fractions) * 100:5.1f}%  max {np.max(fractions) * 100:5.1f}%  "
          f"({len(points)} columns)")
