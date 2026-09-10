"""blender -b -P build.py -- <out.glb>

Builds the character, rigs it, authors the Idle and Greet actions and writes a
single GLB. Facial morph targets are exported but left unanimated: the renderer
drives blinks and the smile itself so they can stay irregular.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Matrix, Vector

import bkit
import character
import head
import rig

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = args[0] if args else "/tmp/jx3d/jaxongirman.glb"

IDLE_FRAMES = 192
GREET_FRAMES = 108


# ------------------------------------------------------------------ posing

def aim(arm, name, direction, twist=0.0):
    """Point a bone along a world direction, keeping its roll close to rest."""
    pb = arm.pose.bones.get(name)
    if pb is None:
        return
    bpy.context.view_layer.update()
    y = Vector(direction).normalized()
    rest = pb.bone.matrix_local.to_3x3()
    x = rest.col[0].copy()
    if abs(x.dot(y)) > 0.98:
        x = rest.col[2].copy()
    x = (x - y * x.dot(y)).normalized()
    z = x.cross(y)
    basis = Matrix((x, y, z)).transposed()
    if twist:
        basis = basis @ Matrix.Rotation(twist, 3, "Y")
    loc = pb.matrix.to_translation()
    pb.rotation_mode = "XYZ"
    pb.matrix = Matrix.Translation(loc) @ basis.to_4x4()
    bpy.context.view_layer.update()


ARM_CHAIN = ["shoulder", "upperarm", "forearm", "hand"]


def aim_palm(arm, name, direction, palm_target, rest_palm):
    """Aim a hand bone and roll it so the palm faces `palm_target`."""
    aim(arm, name, direction)
    pb = arm.pose.bones[name]
    rest = pb.bone.matrix_local.to_3x3()
    local_palm = rest.transposed() @ Vector(rest_palm)
    d = Vector(direction).normalized()
    now = (pb.matrix.to_3x3() @ local_palm).normalized()
    want = Vector(palm_target)
    want = (want - d * want.dot(d))
    if want.length < 1e-5:
        return
    want.normalize()
    angle = math.atan2(now.cross(want).dot(d), now.dot(want))
    aim(arm, name, direction, twist=angle)


def key_bones(arm, frame, names):
    for name in names:
        pb = arm.pose.bones.get(name)
        if pb is not None:
            pb.rotation_mode = "XYZ"
            pb.keyframe_insert("rotation_euler", frame=frame)


def rest_dirs(arm, side):
    out = {}
    for part in ARM_CHAIN:
        bone = arm.data.bones["%s.%s" % (part, side)]
        out[part] = (bone.tail_local - bone.head_local).normalized()
    return out


def wave_pose(arm, side, lift, rock, spread=0.0):
    """lift 0 = arm at rest, 1 = raised beside the head; rock swings the wrist."""
    s = 1.0 if side == "L" else -1.0
    rest = rest_dirs(arm, side)
    up_target = Vector((s * 0.80, -0.16, 0.30 + spread)).normalized()
    fore_target = Vector((s * 0.20, -0.30, 0.93)).normalized()
    hand_target = Vector((s * (0.24 + rock * 0.42), -0.30 - rock * 0.06,
                          0.93 - abs(rock) * 0.10)).normalized()
    shoulder_target = rest["shoulder"].lerp(Vector((s * 0.90, -0.12, 0.42)), lift * 0.80)
    aim(arm, "shoulder." + side, shoulder_target)
    aim(arm, "upperarm." + side, rest["upperarm"].lerp(up_target, lift))
    aim(arm, "forearm." + side, rest["forearm"].lerp(fore_target, lift))
    # The open palm has to turn to face the viewer, or the wave reads edge-on.
    hand_dir = rest["hand"].lerp(hand_target, lift)
    palm_rest = Vector((-s, 0.0, 0.0))
    palm_want = Vector((-s * (1.0 - lift), 0.0, 0.0)) + Vector((0.0, -1.0, 0.0)) * lift
    aim_palm(arm, "hand." + side, hand_dir, palm_want.normalized(), palm_rest)


def relaxed_arm(arm, side, amount=1.0):
    s = 1.0 if side == "L" else -1.0
    rest = rest_dirs(arm, side)
    aim(arm, "shoulder." + side, rest["shoulder"])
    aim(arm, "upperarm." + side,
        rest["upperarm"].lerp(Vector((s * 0.22, 0.06, -0.97)).normalized(), amount))
    aim(arm, "forearm." + side,
        rest["forearm"].lerp(Vector((s * 0.20, -0.20, -0.96)).normalized(), amount))
    aim(arm, "hand." + side,
        rest["hand"].lerp(Vector((s * 0.16, -0.26, -0.95)).normalized(), amount))


def spine_pose(arm, chest=0.0, spine=0.0, hips=0.0, neck=0.0,
               head_nod=0.0, head_turn=0.0, head_tilt=0.0):
    for name, angles in (("hips", (hips, 0.0, 0.0)), ("spine", (spine, 0.0, 0.0)),
                         ("chest", (chest, 0.0, 0.0)), ("neck", (neck, 0.0, 0.0)),
                         ("head", (head_nod, head_turn, head_tilt))):
        pb = arm.pose.bones[name]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (math.radians(angles[0]), math.radians(angles[1]),
                             math.radians(angles[2]))


SPINE_BONES = ["hips", "spine", "chest", "neck", "head"]


def arm_bones(side):
    return ["%s.%s" % (p, side) for p in ARM_CHAIN]


def finger_curl(arm, side, amount):
    """Softly close the fingers; 0 leaves the greeting palm wide open."""
    for name in ("index", "middle", "ring", "pinky"):
        for seg in range(3):
            pb = arm.pose.bones.get("%s%d.%s" % (name, seg + 1, side))
            if pb is None:
                continue
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (math.radians(-18.0 * amount * (1.0 + 0.35 * seg)), 0.0, 0.0)
    for seg in range(2):
        pb = arm.pose.bones.get("thumb%d.%s" % (seg + 1, side))
        if pb is not None:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (math.radians(-12.0 * amount), 0.0, 0.0)


def finger_bones(side):
    names = []
    for name in ("index", "middle", "ring", "pinky"):
        names += ["%s%d.%s" % (name, i + 1, side) for i in range(3)]
    names += ["thumb%d.%s" % (i + 1, side) for i in range(2)]
    return names


ALL_BONES = SPINE_BONES + arm_bones("L") + arm_bones("R") + finger_bones("L") + finger_bones("R")


# ------------------------------------------------------------------ actions

def new_action(arm, name):
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot"):
        for slot in action.slots:
            arm.animation_data.action_slot = slot
            break
    return action


def author_idle(arm):
    action = new_action(arm, "Idle")
    n = IDLE_FRAMES
    for frame in range(1, n + 2, 8):
        t = (frame - 1) / float(n)
        breath = math.sin(t * math.tau * 2.0)
        sway = math.sin(t * math.tau)
        drift = math.sin(t * math.tau * 1.0 + 0.9)
        spine_pose(arm,
                   chest=-1.15 * breath, spine=0.55 * breath, hips=0.22 * sway,
                   neck=0.7 * breath,
                   head_nod=-0.9 * breath - 0.6 * drift,
                   head_turn=2.4 * sway, head_tilt=1.1 * drift)
        relaxed_arm(arm, "L", 1.0)
        relaxed_arm(arm, "R", 1.0)
        for side in ("L", "R"):
            pb = arm.pose.bones["upperarm.%s" % side]
            pb.rotation_euler.rotate_axis("X", math.radians(1.5 * breath))
        finger_curl(arm, "L", 0.30 + 0.06 * breath)
        finger_curl(arm, "R", 0.30 - 0.06 * breath)
        key_bones(arm, frame, ALL_BONES)
    rig.ease(action)
    return action


def author_greet(arm):
    action = new_action(arm, "Greet")
    # lift, rock, smile-side spine motion
    beats = [
        (1, 0.0, 0.0), (9, 0.10, 0.0), (20, 0.62, -0.10), (30, 1.00, 0.10),
        (39, 0.99, -0.72), (48, 1.00, 0.72), (57, 0.99, -0.66), (66, 1.00, 0.60),
        (75, 0.98, -0.18), (86, 0.55, 0.0), (97, 0.16, 0.0), (108, 0.0, 0.0),
    ]
    for frame, lift, rock in beats:
        t = (frame - 1) / float(GREET_FRAMES)
        breath = math.sin(t * math.tau * 1.6)
        spine_pose(arm,
                   chest=-1.6 * lift - 0.7 * breath, spine=0.8 * lift,
                   hips=-0.5 * lift, neck=-1.1 * lift,
                   head_nod=-1.9 * lift - 0.5 * breath,
                   head_turn=-2.2 * lift, head_tilt=2.6 * lift)
        wave_pose(arm, "L", lift, rock)
        relaxed_arm(arm, "R", 1.0)
        finger_curl(arm, "L", 0.30 * (1.0 - lift))
        finger_curl(arm, "R", 0.32)
        key_bones(arm, frame, ALL_BONES)
    rig.ease(action)
    return action


def stash(arm, action):
    track = arm.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 1, action)
    strip.name = action.name
    track.mute = True
    arm.animation_data.action = None


# --------------------------------------------------------------------- main

bkit.reset_scene()
mats = character.materials()
builder, face, info = character.assemble(mats)
obj = builder.to_object("Jaxongirman", list(mats.values()))
face_obj = face.to_object("JaxongirmanFace", list(mats.values()))
for name, expr in character.EXPRESSIONS.items():
    bkit.set_shape_key(face_obj, name, character.shape_key_vertices(info, expr))
face_obj.data.shape_keys.name = "Face"

arm = rig.build_armature()
rig.bind(obj, arm)
rig.bind(face_obj, arm)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
idle = author_idle(arm)
stash(arm, idle)
greet = author_greet(arm)
stash(arm, greet)
bpy.ops.object.mode_set(mode="OBJECT")
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (0.0, 0.0, 0.0)

os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=False,
    export_yup=True,
    export_skins=True,
    export_morph=True,
    export_morph_normal=False,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_nla_strips=False,
    export_bake_animation=False,
    export_optimize_animation_size=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_active_vertex_color_when_no_material=True,
    export_normals=True,
    export_tangents=False,
    export_texcoords=False,
    export_image_format="NONE",
)
print("verts", len(obj.data.vertices) + len(face_obj.data.vertices),
      "tris", sum(len(p.vertices) - 2 for p in obj.data.polygons)
      + sum(len(p.vertices) - 2 for p in face_obj.data.polygons))
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
