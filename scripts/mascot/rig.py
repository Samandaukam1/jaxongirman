"""Armature, skinning and the two actions the card plays.

Bone names match the vertex groups the mesh builders wrote, so binding is a
plain modifier - no heat-map guessing, and armour plates stay rigid.
"""

import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

import body

# name, head, tail, parent, connected
def _skeleton():
    B = []
    B.append(("root", (0, 0, 0), (0, 0, 0.16), None, False))
    B.append(("hips", (0, 0.004, 0.958), (0, 0.002, 1.062), "root", False))
    B.append(("spine", (0, 0.002, 1.062), (0, -0.002, 1.186), "hips", True))
    B.append(("chest", (0, -0.002, 1.186), (0, 0.002, 1.372), "spine", True))
    B.append(("neck", (0, 0.006, 1.372), (0, 0.010, 1.470), "chest", True))
    B.append(("head", (0, 0.010, 1.470), (0, 0.004, 1.760), "neck", True))
    for side, s in (("L", 1.0), ("R", -1.0)):
        sh = body.SHOULDER * [s, 1, 1]
        el = body.ELBOW * [s, 1, 1]
        wr = body.WRIST * [s, 1, 1]
        hp = body.HIP * [s, 1, 1]
        kn = body.KNEE * [s, 1, 1]
        an = body.ANKLE * [s, 1, 1]
        toe = body.TOE * [s, 1, 1]
        B.append(("shoulder." + side, (s * 0.052, 0.002, 1.336), tuple(sh), "chest", False))
        B.append(("upperarm." + side, tuple(sh), tuple(el), "shoulder." + side, True))
        B.append(("forearm." + side, tuple(el), tuple(wr), "upperarm." + side, True))
        along = (wr - el) / np.linalg.norm(wr - el)
        spread = np.array([0.0, 1.0, 0.0])
        spread -= along * float(np.dot(spread, along))
        spread /= np.linalg.norm(spread)
        palm_n = np.cross(along, spread)
        palm = wr + along * 0.058
        B.append(("hand." + side, tuple(wr), tuple(palm + along * 0.040), "forearm." + side, True))
        for off, length, name in ((-0.048, 0.092, "index"), (-0.016, 0.102, "middle"),
                                  (0.016, 0.096, "ring"), (0.047, 0.078, "pinky")):
            root = palm + spread * off + along * 0.056
            parent = "hand." + side
            for seg in range(3):
                a = root + along * (length * seg / 3.0)
                b = root + along * (length * (seg + 1) / 3.0)
                bone = "%s%d.%s" % (name, seg + 1, side)
                B.append((bone, tuple(a), tuple(b), parent, seg > 0))
                parent = bone
        thumb_root = palm + spread * -0.056 + palm_n * s * 0.022 - along * 0.004
        tdir = (-spread * 0.50 + along * 0.68 - palm_n * s * 0.54)
        tdir /= np.linalg.norm(tdir)
        parent = "hand." + side
        for seg in range(2):
            a = thumb_root + tdir * (0.042 * seg)
            b = thumb_root + tdir * (0.042 * (seg + 1))
            bone = "thumb%d.%s" % (seg + 1, side)
            B.append((bone, tuple(a), tuple(b), parent, seg > 0))
            parent = bone
        B.append(("thigh." + side, tuple(hp), tuple(kn), "hips", False))
        B.append(("shin." + side, tuple(kn), tuple(an), "thigh." + side, True))
        B.append(("foot." + side, tuple(an), tuple(toe + [0, -0.02, -0.06]), "shin." + side, True))
    return B


def build_armature(name="Armature"):
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for bone_name, head, tail, parent, connected in _skeleton():
        eb = data.edit_bones.new(bone_name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        if (eb.tail - eb.head).length < 1e-4:
            eb.tail = eb.head + Vector((0, 0, 0.02))
        if parent:
            eb.parent = made[parent]
            eb.use_connect = bool(connected)
        made[bone_name] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def bind(mesh_obj, arm_obj):
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    mesh_obj.parent = arm_obj
    # Anything the builders left unweighted belongs to the pelvis.
    named = {vg.name for vg in mesh_obj.vertex_groups}
    if "hips" not in named:
        mesh_obj.vertex_groups.new(name="hips")
    weighted = np.zeros(len(mesh_obj.data.vertices))
    for v in mesh_obj.data.vertices:
        weighted[v.index] = sum(g.weight for g in v.groups)
    loose = [int(i) for i in np.where(weighted < 1e-4)[0]]
    if loose:
        mesh_obj.vertex_groups["hips"].add(loose, 1.0, "REPLACE")
    return mod


# ------------------------------------------------------------- animation

def _euler(pb, x=0.0, y=0.0, z=0.0):
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ")


def key(arm, frame, poses, shapes=None, mesh=None):
    for name, angles in poses.items():
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        _euler(pb, *angles)
        pb.keyframe_insert("rotation_euler", frame=frame)
    if shapes and mesh is not None and mesh.data.shape_keys:
        for key_name, value in shapes.items():
            kb = mesh.data.shape_keys.key_blocks.get(key_name)
            if kb is None:
                continue
            kb.value = value
            kb.keyframe_insert("value", frame=frame)


def action_fcurves(action):
    """Blender 4.4+ moved curves into slotted layers; support both shapes."""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                out.extend(bag.fcurves)
    return out


def ease(action, kind="BEZIER", easing="EASE_IN_OUT"):
    for fcurve in action_fcurves(action):
        for kp in fcurve.keyframe_points:
            kp.interpolation = kind
            kp.easing = easing
        fcurve.update()
