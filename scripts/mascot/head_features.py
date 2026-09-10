"""Add the parts FaceBuilder does not model: eyeballs and hair.

    blender -b -P head_features.py -- [--blend F] [--out F]

FaceBuilder returns skin only - the eyes are painted into the texture and the
head is bald. Both have to become geometry.

The eye sockets are located from the blink morph rather than from a hard-coded
vertex list: the vertices that move under `eyeBlinkLeft` *are* the left eyelid,
whatever the topology, so the eyeball can be placed from the data itself.

Hair rides on the real scalp, found by ray-casting the fitted mesh, so it
follows this head rather than an idealised sphere.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import bkit
import mkit

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


BLEND = arg("--blend", os.path.join(REPO, "output", "likeness_fit.blend"))
OUT = arg("--out", BLEND)

SCLERA = (0.30, 0.288, 0.280)
IRIS = (0.048, 0.026, 0.014)
PUPIL = (0.008, 0.007, 0.007)
HAIR = (0.0295, 0.0175, 0.0125)


def log(*rest):
    print("[feat]", *rest, flush=True)


# ------------------------------------------------------------------ helpers

def shape_positions(obj, name):
    keys = obj.data.shape_keys
    block = keys.key_blocks.get(name)
    if block is None:
        return None
    out = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    block.data.foreach_get("co", out)
    return out.reshape(-1, 3)


def base_positions(obj):
    out = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", out)
    return out.reshape(-1, 3)


# --------------------------------------------------------------------- eyes

def eye_from_blink(obj, blink_name):
    """Centre and radius of the eye whose lid the given blink morph moves."""
    base = base_positions(obj)
    blink = shape_positions(obj, blink_name)
    if blink is None:
        return None
    delta = np.linalg.norm(blink - base, axis=1)
    if delta.max() <= 0:
        return None
    # Only the strongly moving vertices: a loose threshold pulls in brow and
    # cheek skin and inflates the apparent eye width.
    lid = delta > delta.max() * 0.55
    points = base[lid]
    width = points[:, 0].max() - points[:, 0].min()
    radius = width * 0.36
    # Depth is what makes or breaks this: the cornea should sit level with the
    # lid margin, so the centre goes a ball-radius behind the most forward lid
    # vertices (this head faces -Y, so "forward" is the low percentile).
    front = float(np.percentile(points[:, 1], 12))
    centre = np.array([points[:, 0].mean(), front + radius * 1.04, points[:, 2].mean()])
    return centre, radius, points


def build_eyeball(centre, radius, name):
    grid = mkit.sphere_grid(28, 36, (radius, radius, radius))
    verts = grid.reshape(-1, 3).copy()
    # Gaze straight down -Y, the direction this head faces.
    direction = verts / (np.linalg.norm(verts, axis=1, keepdims=True) + 1e-9)
    forward = np.array([0.0, -1.0, 0.0])
    angle = np.arccos(np.clip(direction @ forward, -1.0, 1.0))

    # Sized against the visible opening rather than the whole ball: a real iris
    # is about 40% of the palpebral width, and the reference eyes are dark.
    # The reference eyes are dark and narrow: the iris fills most of what the
    # lids leave visible, and very little sclera shows.
    iris = mkit._smoothstep((0.68 - angle) / 0.060)
    pupil = mkit._smoothstep((0.30 - angle) / 0.050)
    limbus = np.clip(mkit._smoothstep((0.74 - angle) / 0.070) - iris, 0.0, 1.0)

    colour = np.repeat(np.array(SCLERA, dtype=float)[None, :], len(verts), axis=0)
    colour = colour * (1 - iris[:, None]) + np.array(IRIS)[None, :] * iris[:, None]
    colour = colour * (1 - pupil[:, None]) + np.array(PUPIL)[None, :] * pupil[:, None]
    colour *= (1.0 - 0.62 * limbus)[:, None]
    # Corner shading so the ball does not read as a bright sphere in the socket.
    shade = mkit._smoothstep((angle - 1.0) / 0.6)
    colour *= (1.0 - 0.68 * shade)[:, None]
    # A shallow iris dish; the cornea bulge over it is what catches the key light.
    verts -= (iris * radius * 0.045)[:, None] * direction
    verts += (mkit._smoothstep((0.5 - angle) / 0.25) * radius * 0.035)[:, None] * direction
    verts += centre

    builder = bkit.Builder()
    material = bkit.material(f"Eye_{name}", (1.0, 1.0, 1.0), 0.0, 0.075, vertex_colors=True)
    lo = verts[:grid.shape[1]].mean(axis=0)
    hi = verts[-grid.shape[1]:].mean(axis=0)
    builder.add_grid(verts.reshape(grid.shape), material, (1.0, 1.0, 1.0),
                     cap_lo=lo, cap_hi=hi, colors=colour)
    obj = builder.to_object(f"Eye{name}", [material])
    return obj


# ------------------------------------------------------------------- brows

def vertex_uvs(mesh):
    """One UV per vertex, taken from any loop that uses it."""
    loops = len(mesh.loops)
    index = np.empty(loops, dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", index)
    uv = np.empty(loops * 2, dtype=np.float32)
    mesh.uv_layers[0].uv.foreach_get("vector", uv)
    out = np.zeros((len(mesh.vertices), 2), dtype=np.float32)
    out[index] = uv.reshape(-1, 2)
    return out


def sample_albedo(head):
    """Per-vertex luminance of the projected photograph.

    The albedo came from the photographs, so darkness in the brow band *is* the
    man's eyebrow - measured, in the right place, with his real asymmetry,
    instead of a curve guessed from the eyelid.
    """
    image = None
    for slot in head.material_slots:
        if not slot.material or not slot.material.use_nodes:
            continue
        for node in slot.material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                image = node.image
                break
    if image is None or not head.data.uv_layers:
        return None
    w, h = image.size[:2]
    channels = image.channels
    buf = np.empty(w * h * channels, dtype=np.float32)
    image.pixels.foreach_get(buf)
    pixels = buf.reshape(h, w, channels)
    uv = vertex_uvs(head.data)
    px = np.clip((uv[:, 0] % 1.0 * w).astype(int), 0, w - 1)
    py = np.clip((uv[:, 1] % 1.0 * h).astype(int), 0, h - 1)
    return pixels[py, px, :3].mean(axis=1)


def brow_spine(head, luma, eye_centre, radius):
    """Ordered 3D points down the middle of one photographed eyebrow."""
    base = base_positions(head)
    # Start well above the lid: the lash line and the crease are dark in the
    # photograph too, and including them drags the measured spine down onto
    # the eyelid - which is exactly what the first strand groom did.
    band = ((np.abs(base[:, 0] - eye_centre[0]) < radius * 2.3)
            & (base[:, 2] > eye_centre[2] + radius * 1.05)
            & (base[:, 2] < eye_centre[2] + radius * 2.45)
            & (base[:, 1] < eye_centre[1] + radius * 0.9))
    if band.sum() < 30:
        return None
    values = luma[band]
    dark = band.copy()
    dark[band] = values < np.percentile(values, 34)
    points = base[dark]
    if len(points) < 20:
        return None

    # Walk across in x and take the darkest column centre at each step.
    order = np.argsort(points[:, 0])
    points = points[order]
    columns = np.array_split(points, 11)
    spine = np.array([c.mean(axis=0) for c in columns if len(c) >= 2])
    if len(spine) < 5:
        return None
    # A light pass along the spine: column means are noisy at the ends.
    for _ in range(3):
        spine[1:-1] = spine[1:-1] * 0.5 + (spine[:-2] + spine[2:]) * 0.25
    return spine


def build_brows(head, tree, centre, reach, eyes_info, per_brow=2400, seed=23):
    """A fine-strand brow groom placed on the photographed eyebrow.

    The previous ribbon sat on the eyelid and rendered as a pale slab - the
    object the eye-region diagnosis identified. This grows individual tapered
    hairs along the brow the texture actually shows, per side, so the real
    left/right asymmetry survives.
    """
    luma = sample_albedo(head)
    if luma is None:
        log("brows: no albedo to measure from, skipped")
        return None

    rng = np.random.default_rng(seed)
    builder = bkit.Builder()
    material = bkit.material("Brow", HAIR, 0.0, 0.88, vertex_colors=True)
    bsdf = material.node_tree.nodes["Principled BSDF"]
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.10

    made = 0
    for side, (eye_centre, radius, points) in eyes_info.items():
        spine = brow_spine(head, luma, eye_centre, radius)
        if spine is None:
            log(f"brow {side}: could not measure a brow band, skipped")
            continue
        length = np.linalg.norm(spine[-1] - spine[0])
        above = (spine[:, 2] - eye_centre[2]) / radius
        log(f"brow {side}: spine {len(spine)} pts, span {length:.3f}, "
            f"{above.min():.2f}..{above.max():.2f} eye-radii above the eye")

        inner_sign = -1.0 if eye_centre[0] > 0 else 1.0
        for _ in range(per_brow):
            t = rng.random()
            k = t * (len(spine) - 1)
            i = int(np.clip(k, 0, len(spine) - 2))
            root = spine[i] + (spine[i + 1] - spine[i]) * (k - i)
            # Brow hair is a band, not a line: scatter across and along it.
            root = root + np.array([0.0, 0.0, rng.normal(0.0, radius * 0.135)])
            root = root + np.array([rng.normal(0.0, radius * 0.05), 0.0, 0.0])
            hit = tree.ray_cast(Vector((root[0], centre[1], root[2])),
                                Vector((0.0, -1.0, 0.0)), reach)
            if hit[0] is None:
                continue
            skin = np.array(hit[0])

            # Grow outward along the brow, angled up at the inner end and
            # sweeping down towards the tail, as the close-up reference shows.
            along = np.array([-inner_sign, 0.0, 0.0])
            rise = 0.55 - 1.15 * t
            direction = along * 0.72 + np.array([0.0, 0.0, rise * 0.5])
            direction += rng.normal(0.0, 0.13, 3)
            direction[1] = 0.0
            direction /= np.linalg.norm(direction) + 1e-9
            out = np.array([0.0, -1.0, 0.0])

            hair_len = radius * (0.38 + 0.30 * rng.random()) * (1.0 - 0.30 * t)
            segments = 4
            path = []
            for seg in range(segments):
                f = seg / (segments - 1.0)
                point = skin + direction * (hair_len * f)
                point = point + out * radius * (0.075 + 0.065 * f)
                path.append(point)
            path = np.array(path)

            width = radius * (0.0105 + 0.0060 * rng.random())
            sections = []
            for seg in range(segments):
                f = seg / (segments - 1.0)
                taper = (1.0 - f ** 1.25) * 0.95 + 0.05
                tangent = path[min(seg + 1, segments - 1)] - path[max(seg - 1, 0)]
                tangent /= np.linalg.norm(tangent) + 1e-9
                nrm = out - tangent * float(out @ tangent)
                nrm /= np.linalg.norm(nrm) + 1e-9
                sidev = np.cross(tangent, nrm)
                sidev /= np.linalg.norm(sidev) + 1e-9
                profile = mkit.ring(3, width * taper, width * taper, 1.0)
                sections.append(mkit.section_at(profile, path[seg], sidev, nrm))
            strip = mkit.loft(sections)
            shade = np.linspace(0.30, 0.95, strip.shape[0])
            colours = (np.repeat(shade[:, None], strip.shape[1], axis=1).reshape(-1, 1)
                       * np.ones((1, 3)))
            builder.add_grid(strip, material, HAIR, cap_lo=strip[0].mean(axis=0),
                             cap_hi=strip[-1].mean(axis=0),
                             colors=np.concatenate([colours, colours[-1:], colours[-1:]]))
            made += 1

    if made == 0:
        return None
    log(f"brows: {made} strands measured from the projected photograph")
    return builder.to_object("Brows", [material])


# --------------------------------------------------------------------- hair

def scalp_caster(obj):
    """Ray-cast the fitted head so hair sits on this skull, not a sphere."""
    tree = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
    return tree


def cranium_frame(obj):
    base = base_positions(obj)
    top = base[:, 2].max()
    bottom = base[:, 2].min()
    height = top - bottom
    # The cranium is the upper part; the jaw and neck would drag the centre down.
    upper = base[base[:, 2] > top - height * 0.42]
    centre = np.array([0.0, upper[:, 1].mean(), upper[:, 2].mean()])
    return centre, height


def hairline_limit(direction):
    """Normalised height where hair starts, as a function of angle round the head."""
    x, y, z = direction
    azimuth = math.degrees(math.atan2(abs(x), y))
    # Measured against the reference: the forehead is high and squared off,
    # with the hairline dropping to a short sideburn in front of the ear.
    return np.interp(azimuth, [0, 26, 44, 58, 70, 82, 90, 112, 142, 180],
                     [-0.560, -0.470, -0.300, -0.120, 0.110, 0.360, 0.490, 0.590, 0.622, 0.630])


def above_hairline(direction):
    return direction[2] > hairline_limit(direction)


def comb(direction):
    """Short side-parted hair: off the part on his right, back over the crown."""
    x, y, z = direction
    flow = np.array([
        0.62 * max(z, 0.0) + 0.30 * math.copysign(abs(x), x + 0.10) - 0.12,
        0.55 + 0.45 * max(-y, 0.0),
        -0.45 - 0.55 * max(-z, 0.0) - 0.35 * abs(x),
    ])
    flow -= direction * float(flow @ direction)
    return flow / (np.linalg.norm(flow) + 1e-9)


def hair_lift(direction, height):
    up = max(direction[2], 0.0)
    side = abs(direction[0])
    front = max(-direction[1], 0.0)
    sweep = max(direction[0], 0.0) * up
    lift = 0.010 + 0.035 * up ** 1.35 - 0.024 * side ** 2.0 * (1.0 - up)
    lift += 0.013 * sweep ** 1.3 + 0.007 * front * up ** 1.6
    return float(np.clip(lift, 0.005, 0.056)) * height


def surface_at(tree, centre, direction, reach):
    """Where the given direction leaves the skull."""
    origin = Vector(centre)
    hit = tree.ray_cast(origin, Vector(direction), reach)
    if hit[0] is None:
        return None
    return np.array(hit[0])


def _scalp_direction(rng, fringe):
    """A root direction on the haired part of the scalp."""
    while True:
        if fringe:
            theta = rng.uniform(-1.15, 1.15)
            lo, hi = -0.62, 1.0
            for _ in range(20):
                mid = (lo + hi) / 2.0
                s = math.sqrt(max(1e-6, 1.0 - mid * mid))
                d = np.array([math.sin(theta) * s, -math.cos(theta) * s, mid])
                if above_hairline(d):
                    hi = mid
                else:
                    lo = mid
            zv = hi + rng.uniform(0.005, 0.32)
        else:
            zv = rng.uniform(-0.42, 0.99)
            theta = rng.uniform(0.0, 2.0 * math.pi)
        s = math.sqrt(max(1e-6, 1.0 - zv * zv))
        d = np.array([math.sin(theta) * s, -math.cos(theta) * s, zv])
        if above_hairline(d):
            return d


def _guide_path(tree, centre, height, reach, direction, rng, segments, fringe):
    """Integrate the comb field across the scalp to make one guide strand."""
    length = (0.075 if fringe else 0.088 + 0.06 * max(direction[2], 0.0)) * height
    # Wider scatter on the fringe: equal-length fringe strands end in a line,
    # which reads as a cut edge rather than as hair.
    spread = 0.030 if fringe else 0.014
    length += rng.uniform(-spread, spread * 1.3) * height
    path, cur = [], direction.copy()
    for k in range(segments):
        point = surface_at(tree, centre, cur, reach)
        if point is None:
            point = centre + cur * height * 0.42
        lift = hair_lift(cur, height) * (0.92 + 0.18 * k / (segments - 1.0))
        path.append(point + cur * (lift + height * 0.004))
        step = comb(cur)
        if fringe:
            fdir = np.array([0.70, -0.30, -0.52])
            fdir -= cur * float(fdir @ cur)
            step = 0.35 * step + 0.65 * fdir / (np.linalg.norm(fdir) + 1e-9)
        step = step + rng.normal(0.0, 0.10 if not fringe else 0.075, 3)
        cur = cur + step * (length / segments) / (height * 0.22)
        cur /= np.linalg.norm(cur)
    return np.array(path)


def build_hair(obj, guides=340, children=19, segments=5, seed=11):
    """A guide-and-child groom rather than a few hundred fat tubes.

    Each guide is integrated across the real scalp; children are scattered
    around its root and pulled back towards it along the strand, so the tips
    gather into clumps the way hair actually does. Strands are thin enough that
    at portrait distance they read as a mass instead of as wires.
    """
    tree = scalp_caster(obj)
    centre, height = cranium_frame(obj)
    reach = height * 1.5
    rng = np.random.default_rng(seed)

    builder = bkit.Builder()
    material = bkit.material("Hair", HAIR, 0.0, 0.90, vertex_colors=True)
    # Thin tubes catch a rim highlight from every direction, and enough of them
    # overlapping turns near-black hair grey. Real hair is dark because the mass
    # absorbs; dropping the specular level is what buys that back.
    bsdf = material.node_tree.nodes["Principled BSDF"]
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.12

    # A closed cap first, so no scalp shows between the strands.
    cols, rows = 96, 16
    outer, inner = [], []
    for j in range(rows):
        t = j / (rows - 1.0)
        row_o, row_i = [], []
        for i in range(cols):
            theta = 2.0 * math.pi * i / cols
            lo, hi = -0.62, 1.0
            for _ in range(22):
                mid = (lo + hi) / 2.0
                s = math.sqrt(max(1e-6, 1.0 - mid * mid))
                d = np.array([math.sin(theta) * s, -math.cos(theta) * s, mid])
                if above_hairline(d):
                    hi = mid
                else:
                    lo = mid
            edge = hi
            zv = 1.0 - (1.0 - edge) * (1.0 - t) ** 1.25
            s = math.sqrt(max(1e-6, 1.0 - zv * zv))
            d = np.array([math.sin(theta) * s, -math.cos(theta) * s, zv])
            point = surface_at(tree, centre, d, reach)
            if point is None:
                point = centre + d * height * 0.42
            lift = hair_lift(d, height) * mkit._smoothstep(t * 2.4) * 0.72
            row_o.append(point + d * lift)
            row_i.append(point - d * height * 0.004)
        outer.append(np.array(row_o))
        inner.append(np.array(row_i))
    grid = np.concatenate([np.array(inner)[::-1], np.array(outer)], axis=0)
    builder.add_grid(grid, material, HAIR,
                     cap_lo=np.array(inner[-1]).mean(axis=0),
                     cap_hi=np.array(outer[-1]).mean(axis=0),
                     colors=np.full((grid.shape[0] * grid.shape[1], 3), 0.38))

    fringe_share = 0.30
    root_radius = height * 0.024
    clump = 0.84
    strands = 0
    for g in range(guides):
        fringe = g >= guides * (1.0 - fringe_share)
        direction = _scalp_direction(rng, fringe)
        guide = _guide_path(tree, centre, height, reach, direction, rng, segments, fringe)
        normal = guide[0] - centre
        normal /= np.linalg.norm(normal) + 1e-9
        basis_a = np.cross(normal, [0.0, 0.0, 1.0])
        if np.linalg.norm(basis_a) < 1e-6:
            basis_a = np.array([1.0, 0.0, 0.0])
        basis_a /= np.linalg.norm(basis_a)
        basis_b = np.cross(normal, basis_a)

        for _ in range(children):
            angle = rng.uniform(0.0, 2.0 * math.pi)
            spread = root_radius * math.sqrt(rng.random())
            offset = (math.cos(angle) * basis_a + math.sin(angle) * basis_b) * spread
            scale = rng.uniform(0.74, 1.18)
            path = guide.copy()
            for k in range(segments):
                t = k / (segments - 1.0)
                # Clumping: children start apart and are drawn back to the
                # guide towards the tip, which is what makes hair read as a
                # mass rather than as separate wires.
                path[k] = guide[0] + (guide[k] - guide[0]) * scale + offset * (1.0 - clump * t)
                path[k] += rng.normal(0.0, height * 0.0010, 3) * t
            if rng.random() < 0.03:
                # A very small number of flyaways; more than this reads as frizz.
                path += rng.normal(0.0, height * 0.004, (segments, 3)) * \
                    np.linspace(0.0, 1.0, segments)[:, None]

            # About 1.0-1.7 mm at this head's scale. Real hair is far finer
            # still, but below roughly a pixel at render resolution strands
            # alias into sparkle rather than reading as hair.
            width = height * (0.0014 + 0.0009 * rng.random())
            sections = []
            for k in range(segments):
                t = k / (segments - 1.0)
                # Slightly thicker at the root, tapering to near nothing at
                # the tip: blunt cylindrical ends are what read as tubes.
                taper = (1.0 - t ** 1.35) * 0.96 + 0.04
                if k == 0:
                    taper *= 1.18
                tangent = path[min(k + 1, segments - 1)] - path[max(k - 1, 0)]
                tangent /= np.linalg.norm(tangent) + 1e-9
                nrm = path[k] - centre
                nrm /= np.linalg.norm(nrm) + 1e-9
                side = np.cross(tangent, nrm)
                side /= np.linalg.norm(side) + 1e-9
                profile = mkit.ring(3, width * taper, width * taper, 1.0)
                sections.append(mkit.section_at(profile, path[k], side, nrm))
            strip = mkit.loft(sections)
            shade = np.linspace(0.20, 0.90, strip.shape[0])
            colours = (np.repeat(shade[:, None], strip.shape[1], axis=1).reshape(-1, 1)
                       * np.ones((1, 3)))
            builder.add_grid(strip, material, HAIR, cap_lo=strip[0].mean(axis=0),
                             cap_hi=strip[-1].mean(axis=0),
                             colors=np.concatenate([colours, colours[-1:], colours[-1:]]))
            strands += 1

    log(f"hair: {guides} guides x {children} children = {strands} strands")
    return builder.to_object("Hair", [material])


# --------------------------------------------------------------------- main

bpy.ops.wm.open_mainfile(filepath=BLEND)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# The head is the mesh carrying the morph targets. Picking by vertex count
# would choose the hair, which has more.
head = next((o for o in meshes if o.data.shape_keys), None)
if head is None:
    raise SystemExit(f"no mesh with shape keys in {BLEND}")
for stale in [o for o in bpy.data.objects if o.name in {"EyeL", "EyeR", "Hair", "Brows"}]:
    bpy.data.objects.remove(stale, do_unlink=True)
log("head:", head.name, len(head.data.vertices), "verts")

eyes_info = {}
for side, morph in (("L", "BlinkL"), ("R", "BlinkR")):
    found = eye_from_blink(head, morph)
    if found is None:
        log(f"eye {side}: {morph} missing, skipped")
        continue
    centre, radius, points = found
    eyes_info[side] = found
    eye = build_eyeball(centre, radius, side)
    eye.parent = head
    log(f"eye {side}: centre {centre.round(3)} radius {radius:.4f} from {len(points)} lid verts")

tree = scalp_caster(head)
cranium, height = cranium_frame(head)
brows = build_brows(head, tree, cranium, height * 1.5, eyes_info)
if brows is not None:
    brows.parent = head

hair = build_hair(head)
hair.parent = head

bpy.ops.wm.save_as_mainfile(filepath=OUT)
log("wrote", OUT)
