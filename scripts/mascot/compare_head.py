"""Matched-camera comparison of the fitted head against the reference photos.

    blender -b -P compare_head.py -- [--blend F] [--cameras F] [--out F]
                                     [--views a,b,c]

Renders the head through the very cameras FaceBuilder solved for, so each
render lands in the same frame as the photograph it was fitted to. Every view
produces three tiles - photograph, render, and the two blended - because the
overlay is what actually shows a jaw that is too narrow or a nose that sits too
high, which side-by-side images hide.
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


BLEND = arg("--blend", os.path.join(REPO, "output", "likeness_fit.blend"))
CAMERAS = arg("--cameras", os.path.join(REPO, "output", "cameras.json"))
OUT = arg("--out", os.path.join(REPO, "output", "compare_sheet.png"))
VIEW_DIRS = [os.path.join(REPO, "docs", "mascot", "reference", "views"),
             os.path.join(REPO, "docs", "mascot", "reference", "views2")]


def view_path(name):
    for folder in VIEW_DIRS:
        candidate = os.path.join(folder, f"{name}.png")
        if os.path.exists(candidate):
            return candidate
    return None
ONLY = arg("--views", "").split(",") if "--views" in argv else None

# Undoes the Y-up correction baked into the mesh, so the solved model matrix
# applies to the geometry in the space FaceBuilder solved it in.
UNCORRECT = Matrix.Rotation(math.radians(-90.0), 4, "X")


def read_png(path):
    image = bpy.data.images.load(path)
    w, h = image.size[:2]
    buf = np.empty((h, w, image.channels), dtype=np.float32)
    image.pixels.foreach_get(buf.ravel())
    bpy.data.images.remove(image)
    if buf.shape[2] == 3:
        buf = np.dstack([buf, np.ones((h, w, 1), dtype=np.float32)])
    return buf


def write_png(array, path):
    h, w = array.shape[:2]
    image = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    image.pixels.foreach_set(np.ascontiguousarray(array, dtype=np.float32).ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def over(top, bottom):
    """Alpha-composite `top` onto `bottom`, both float RGBA."""
    a = top[..., 3:4]
    out = bottom.copy()
    out[..., :3] = top[..., :3] * a + bottom[..., :3] * (1.0 - a)
    out[..., 3:4] = np.clip(a + bottom[..., 3:4] * (1.0 - a), 0.0, 1.0)
    return out


GRAY = "--gray" in argv
FULL = "--full" in argv          # keep hair, brows and eyes for the beauty sheet

bpy.ops.wm.open_mainfile(filepath=BLEND)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
head = next((o for o in meshes if o.data.shape_keys), None) or \
    max(meshes, key=lambda o: len(o.data.vertices))
# Skin only by default: hair, brows and eyeballs would let a wrong skull hide
# behind them, which is exactly what the diagnostic exists to prevent. `--full`
# keeps them for the final beauty comparison.
if not FULL:
    for other in meshes:
        if other is not head:
            bpy.data.objects.remove(other, do_unlink=True)
else:
    for other in meshes:
        if other is not head and other.parent is not head:
            other.parent = head
if GRAY:
    head.data.materials.clear()
    clay = bpy.data.materials.new("Clay")
    clay.use_nodes = True
    bsdf = clay.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.55, 0.54, 0.53, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.62
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    head.data.materials.append(clay)
for other in [o for o in bpy.data.objects if o.type in {"LIGHT", "CAMERA"}]:
    bpy.data.objects.remove(other, do_unlink=True)

# Flat ambient light, not a studio rig: the head sits wherever the solve put
# it, metres from the origin, so any placed lamp would fall off unevenly. Even
# illumination is also what a shape comparison wants.
world = bpy.data.worlds.new("Flat")
bpy.context.scene.world = world
world.use_nodes = True
background = world.node_tree.nodes["Background"]
background.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
background.inputs[1].default_value = 1.35
bkit.configure_render((512, 512), samples=32)
scene = bpy.context.scene
scene.render.film_transparent = True
# The references are ordinary sRGB photographs, so the render has to be graded
# the same way. AgX would flatten the render and invent a difference that is
# not in the geometry.
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

with open(CAMERAS) as handle:
    cameras = json.load(handle)
if ONLY:
    cameras = [c for c in cameras if c["name"] in ONLY]

data = bpy.data.cameras.new("Matched")
data.sensor_fit = "HORIZONTAL"
data.sensor_width = 36.0
cam_obj = bpy.data.objects.new("Matched", data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (0.0, 0.0, 0.0)
cam_obj.rotation_euler = (0.0, 0.0, 0.0)   # Blender cameras look down -Z, as OpenGL does
scene.camera = cam_obj

rows = []
for entry in cameras:
    w, h = entry["width"], entry["height"]
    scene.render.resolution_x, scene.render.resolution_y = w, h
    data.lens = entry["focal_px"] * data.sensor_width / w
    head.matrix_world = Matrix(entry["model_mat"]) @ UNCORRECT

    path = os.path.join(REPO, "output", f"_match_{entry['name']}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

    reference = read_png(view_path(entry["name"]))
    render = read_png(path)
    if render.shape[:2] != reference.shape[:2]:
        print("[cmp] size mismatch", entry["name"], render.shape, reference.shape)
        continue

    dark = np.zeros_like(reference)
    dark[..., 3] = 1.0
    ref_tile = over(reference, dark)
    ren_tile = over(render, dark)
    # Reference in red, render in cyan: anywhere they agree reads neutral grey,
    # and any offset shows as a coloured fringe on the feature that moved.
    blend = np.zeros_like(reference)
    blend[..., 0] = reference[..., :3].mean(axis=2) * reference[..., 3]
    blend[..., 1] = render[..., :3].mean(axis=2) * render[..., 3]
    blend[..., 2] = render[..., :3].mean(axis=2) * render[..., 3]
    blend[..., 3] = 1.0
    rows.append((entry["name"], [ref_tile, ren_tile, blend]))
    os.remove(path)

if not rows:
    raise SystemExit("nothing compared")

tile_h = max(r[1][0].shape[0] for r in rows)
tile_w = max(r[1][0].shape[1] for r in rows)
sheet = np.zeros((tile_h * len(rows), tile_w * 3, 4), dtype=np.float32)
sheet[..., 3] = 1.0
for row, (name, tiles) in enumerate(rows):
    for col, tile in enumerate(tiles):
        th, tw = tile.shape[:2]
        top = (len(rows) - 1 - row) * tile_h      # PNG rows run bottom-up
        sheet[top:top + th, col * tile_w:col * tile_w + tw] = tile
    print("[cmp]", name, "ok")

write_png(sheet, OUT)
print("[cmp] wrote", OUT)
