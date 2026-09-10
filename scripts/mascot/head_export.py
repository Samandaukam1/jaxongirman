"""Rig the fitted head and export it as a production glTF binary.

    blender -b -P head_export.py -- [--blend F] [--glb F] [--master F]

A deliberately small rig: neck, head and one bone per eye. Anything heavier
would have to be re-authored the moment the head is bolted onto the mascot
body, and these four bones are what a head actually needs to be posed and to
look around. Shape keys are preserved by binding with a modifier rather than
applying anything.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


BLEND = arg("--blend", os.path.join(REPO, "output", "likeness_features.blend"))
GLB = arg("--glb", os.path.join(REPO, "output", "likeness_final.glb"))
MASTER = arg("--master", os.path.join(REPO, "output", "likeness_master.blend"))


def log(*rest):
    print("[export]", *rest, flush=True)


def centroid(obj):
    data = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", data)
    return np.asarray(obj.matrix_world.to_translation()) + data.reshape(-1, 3).mean(axis=0)


bpy.ops.wm.open_mainfile(filepath=BLEND)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
head = next((o for o in meshes if o.data.shape_keys), None)
if head is None:
    raise SystemExit("no mesh with shape keys; run facebuilder_fit.py first")
eyes = {o.name: o for o in meshes if o.name.startswith("Eye")}
hair = next((o for o in meshes if o.name == "Hair"), None)
log("meshes:", ", ".join(o.name for o in meshes))

# Every mesh needs a colour attribute before exporting with ACTIVE vertex
# colours, or the primitives that lack one come out inconsistent.
for mesh_obj in meshes:
    if not mesh_obj.data.color_attributes:
        attribute = mesh_obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        white = np.ones(len(mesh_obj.data.vertices) * 4, dtype=np.float32)
        attribute.data.foreach_set("color", white)

verts = np.empty(len(head.data.vertices) * 3, dtype=np.float32)
head.data.vertices.foreach_get("co", verts)
verts = verts.reshape(-1, 3)
z_min, z_max = float(verts[:, 2].min()), float(verts[:, 2].max())
y_mid = float(np.median(verts[:, 1]))
height = z_max - z_min

# --------------------------------------------------------------------- rig

for stale in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
    bpy.data.objects.remove(stale, do_unlink=True)

armature = bpy.data.armatures.new("HeadRig")
rig = bpy.data.objects.new("HeadRig", armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")

neck = armature.edit_bones.new("neck")
neck.head = Vector((0.0, y_mid, z_min))
neck.tail = Vector((0.0, y_mid, z_min + height * 0.30))

head_bone = armature.edit_bones.new("head")
head_bone.head = neck.tail.copy()
head_bone.tail = Vector((0.0, y_mid, z_max))
head_bone.parent = neck
head_bone.use_connect = True

eye_bones = {}
for name, obj in eyes.items():
    side = "L" if name.endswith("L") else "R"
    centre = centroid(obj)
    bone = armature.edit_bones.new(f"eye.{side}")
    bone.head = Vector(centre)
    # Pointing the way the head faces, so a local rotation is a gaze change.
    bone.tail = Vector(centre) + Vector((0.0, -height * 0.12, 0.0))
    bone.parent = head_bone
    eye_bones[name] = f"eye.{side}"
bpy.ops.object.mode_set(mode="OBJECT")
log("rig:", ", ".join(b.name for b in armature.bones))

# ------------------------------------------------------------------- bind

def bind(obj, bone_name):
    obj.parent = None
    obj.matrix_world = obj.matrix_world  # keep the placement it already has
    for group in list(obj.vertex_groups):
        obj.vertex_groups.remove(group)
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    obj.parent = rig


# Everything rides the head bone except the eyeballs, which get their own so
# the gaze can be driven independently.
for mesh_obj in meshes:
    bind(mesh_obj, eye_bones.get(mesh_obj.name, "head"))
log("bound:", ", ".join(f"{o.name}->{eye_bones.get(o.name, 'head')}" for o in meshes))

bpy.ops.wm.save_as_mainfile(filepath=MASTER)
log("wrote", MASTER)

# ------------------------------------------------------------------ export

os.makedirs(os.path.dirname(GLB) or ".", exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=GLB,
    export_format="GLB",
    use_selection=False,
    export_apply=False,          # applying modifiers would destroy the shape keys
    export_yup=True,
    export_skins=True,
    export_morph=True,
    export_morph_normal=False,
    export_animations=False,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_normals=True,
    export_tangents=False,
    export_texcoords=True,
    export_image_format="JPEG",
    export_jpeg_quality=90,
)
size = os.path.getsize(GLB)
log(f"wrote {GLB} ({size / 1024 / 1024:.2f} MB)")
log("head verts", len(head.data.vertices),
    "| shape keys", [k.name for k in head.data.shape_keys.key_blocks])
