"""blender -b -P verify_glb.py -- <in.glb> <out.png> [frame] [action]

Re-imports the exported GLB and renders it, so the sheet shows exactly what a
glTF runtime receives: materials, vertex colours, skinning and the actions.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

import bkit

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = args[0]
out = args[1]
frame = int(args[2]) if len(args) > 2 else 0
action_name = args[3] if len(args) > 3 else None
morphs = args[4].split(",") if len(args) > 4 else []

bkit.reset_scene()
bpy.ops.import_scene.gltf(filepath=src)
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("imported meshes", [o.name for o in meshes], "actions", [a.name for a in bpy.data.actions])

if action_name and arm:
    act = next((a for a in bpy.data.actions if a.name.startswith(action_name)), None)
    if act:
        arm.animation_data_create()
        arm.animation_data.action = act
        if hasattr(arm.animation_data, "action_slot"):
            for slot in act.slots:
                arm.animation_data.action_slot = slot
                break
bpy.context.scene.frame_set(frame if frame else 1)

for spec in morphs:
    if not spec:
        continue
    name, _, value = spec.partition("=")
    for o in meshes:
        keys = o.data.shape_keys
        if keys and name in keys.key_blocks:
            keys.key_blocks[name].value = float(value or 1.0)

bkit.studio(1.0)
bkit.configure_render((440, 900), samples=24)
target = np.array([0.0, 0.0, 1.01])
views = []
for name, ang, elev, dist, tgt in (("front", 0.0, 3.0, 5.3, target),
                                   ("three-quarter", 36.0, 5.0, 5.3, target),
                                   ("profile", 90.0, 3.0, 5.3, target),
                                   ("back", 180.0, 5.0, 5.3, target),
                                   ("bust", 18.0, 4.0, 1.75, np.array([0.0, 0.0, 1.62]))):
    a, e = np.radians(ang), np.radians(elev)
    loc = tgt + np.array([np.sin(a) * np.cos(e), -np.cos(a) * np.cos(e), np.sin(e)]) * dist
    cam = bkit.camera("Cam_" + name, loc, tgt, lens=85.0)
    path = "/tmp/jx3d/_g_%s.png" % name
    bkit.render_to(path, cam)
    views.append(path)
bkit.contact_sheet(out, views, cols=5)
print("wrote", out)
