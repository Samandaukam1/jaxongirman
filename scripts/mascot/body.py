"""The purple armour: a black undersuit with segmented plates layered over it.

The reference sheets show armour built exactly that way - rounded plates
floating a millimetre off a dark flexible suit, the gap between them reading as
the seam - so the model is built the same way instead of drawing seam lines.
"""

import numpy as np

import mkit

# ------------------------------------------------------------- proportions

SHOULDER = np.array([0.215, 0.000, 1.352])
ELBOW = np.array([0.264, 0.006, 1.056])
WRIST = np.array([0.281, 0.012, 0.806])
HIP = np.array([0.098, 0.000, 0.955])
KNEE = np.array([0.112, 0.004, 0.604])
ANKLE = np.array([0.120, 0.012, 0.160])
TOE = np.array([0.120, -0.178, 0.064])

# z, half width, half depth, depth centre
TORSO = [
    (1.452, 0.078, 0.070, 0.010),
    (1.404, 0.135, 0.090, 0.008),
    (1.356, 0.196, 0.104, 0.005),
    (1.300, 0.206, 0.118, 0.000),
    (1.233, 0.198, 0.116, -0.002),
    (1.165, 0.182, 0.108, -0.004),
    (1.108, 0.172, 0.100, -0.004),
    (1.054, 0.178, 0.104, 0.000),
    (1.002, 0.196, 0.114, 0.004),
    (0.959, 0.202, 0.118, 0.008),
    (0.925, 0.190, 0.112, 0.010),
]

PURPLE = (0.176, 0.043, 0.545)
DARK = (0.020, 0.017, 0.030)
SUIT = (0.030, 0.026, 0.042)
SILVER = (0.88, 0.90, 0.95)


# ---------------------------------------------------------------- helpers

def place(V, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    V = np.asarray(V, float) * np.asarray(scale, float)
    rx, ry, rz = rot
    for axis, ang in ((0, rx), (1, ry), (2, rz)):
        if not ang:
            continue
        c, s = np.cos(ang), np.sin(ang)
        i, j = [(1, 2), (2, 0), (0, 1)][axis]
        a, b = V[..., i].copy(), V[..., j].copy()
        V[..., i] = a * c - b * s
        V[..., j] = a * s + b * c
    return V + np.asarray(loc, float)


def box(size, e_lat=0.34, e_lon=0.34, rows=13, cols=18):
    """A rounded plate; low exponents give the machined look of the armour."""
    return mkit.sphere_grid(rows, cols, size, e_lat=e_lat, e_lon=e_lon)


def add_box(builder, mat, colour, size, loc=(0, 0, 0), rot=(0, 0, 0), group=None,
            e=0.34, rows=13, cols=18, grooves=()):
    """A rounded armour plate, optionally scored with panel lines.

    `grooves` are ((u0, v0), (u1, v1), width) segments in the plate's own
    -1..1 face coordinates. Each one presses a shallow channel into the shell
    and darkens it, which is what reads as a machined seam on a pressed plate
    rather than a line painted on a balloon.
    """
    P = place(box(size, e, e, rows, cols), (0, 0, 0), rot)
    flat = P.reshape(-1, 3)
    colors = None
    if grooves:
        local = flat / np.asarray(size, float)[None, :]
        probe = np.stack([local[:, 0], np.zeros(len(local)), local[:, 2]], axis=-1)
        depth = np.zeros(len(flat))
        for (u0, v0), (u1, v1), width in grooves:
            depth = np.maximum(depth, mkit.bump_seg(probe, (u0, 0.0, v0), (u1, 0.0, v1),
                                                    (width, 4.0, width), power=1.5))
        normal = flat / (np.linalg.norm(flat, axis=-1, keepdims=True) + 1e-9)
        flat = flat - (depth * 0.0045)[:, None] * normal
        colors = np.repeat((1.0 - 0.50 * depth)[:, None], 3, axis=1)
    P = (flat + np.asarray(loc, float)).reshape(P.shape)
    return builder.add_grid(P, mat, colour, cap_lo=P[0].mean(axis=0),
                            cap_hi=P[-1].mean(axis=0), group=group, colors=colors)


def add_tube(builder, mat, colour, path, radii, group=None, cols=16, e=1.0,
             squash=None, shade=None):
    P = mkit.tube(path, radii, cols=cols, e=e, squash=squash)
    return builder.add_grid(P, mat, colour, cap_lo=P[0].mean(axis=0),
                            cap_hi=P[-1].mean(axis=0), group=group, colors=shade)


def torso_sections(z_from, z_to, inflate=0.0, cols=32, rows=10, e=0.72):
    src = np.array(TORSO)
    zs = np.linspace(z_from, z_to, rows)
    out = []
    for z in zs:
        w = np.interp(z, src[::-1, 0], src[::-1, 1]) + inflate
        d = np.interp(z, src[::-1, 0], src[::-1, 2]) + inflate
        c = np.interp(z, src[::-1, 0], src[::-1, 3])
        prof = mkit.ring(cols, w, d, e)
        out.append(np.stack([prof[:, 0], prof[:, 1] + c, np.full(cols, z)], axis=-1))
    return mkit.loft(out)


def prism(outline, depth, bevel=0.004, inset=0.004):
    """Extrude a 2D outline into a bevelled slab lying in the XZ plane."""
    o = np.asarray(outline, float)
    centre = o.mean(axis=0)
    small = centre + (o - centre) * (1.0 - inset / np.abs(o - centre).max())
    rings = [(small, -depth / 2.0), (o, -depth / 2.0 + bevel), (o, depth / 2.0 - bevel),
             (small, depth / 2.0)]
    verts, faces = [], []
    n = len(o)
    for ring, y in rings:
        for px, pz in ring:
            verts.append((px, y, pz))
    for r in range(len(rings) - 1):
        for i in range(n):
            a = r * n + i
            b = r * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    back = len(verts)
    verts.append((centre[0], -depth / 2.0, centre[1]))
    front = len(verts)
    verts.append((centre[0], depth / 2.0, centre[1]))
    for i in range(n):
        faces.append((back, (i + 1) % n, i))
        faces.append((front, 3 * n + i, 3 * n + (i + 1) % n))
    return np.array(verts), faces


def stroke(path, width, cap_start=True, cap_end=True, samples=None):
    """Offset a polyline on both sides into a closed outline."""
    p = np.asarray(path, float)
    left, right = [], []
    for i in range(len(p)):
        if i == 0:
            t = p[1] - p[0]
        elif i == len(p) - 1:
            t = p[-1] - p[-2]
        else:
            t = p[i + 1] - p[i - 1]
        t /= np.linalg.norm(t) + 1e-9
        nrm = np.array([-t[1], t[0]]) * (width / 2.0)
        left.append(p[i] + nrm)
        right.append(p[i] - nrm)
    return np.array(left + right[::-1])


def emblem_outline(scale=1.0):
    """The chest J: a straight stem running into a hook, stroked to an outline."""
    stem = [(0.032, 0.112 - k * 0.0205) for k in range(5)]
    hook = [(0.032 * np.cos(-np.pi * 0.95 * k / 16.0),
             0.010 + 0.032 * np.sin(-np.pi * 0.95 * k / 16.0))
            for k in range(1, 17)]
    return stroke(np.array(stem + hook), 0.030) * scale


def hexagon(radius, rotation=0.0):
    a = np.linspace(0.0, mkit.TAU, 6, endpoint=False) + rotation
    return np.stack([radius * np.cos(a), radius * np.sin(a)], axis=-1)


def _limb_frame(a, b):
    along = np.asarray(b, float) - np.asarray(a, float)
    along /= np.linalg.norm(along)
    spread = np.array([0.0, 1.0, 0.0])
    spread -= along * np.dot(spread, along)
    spread /= np.linalg.norm(spread)
    return along, spread, np.cross(along, spread)


def _lerp(a, b, t):
    return np.asarray(a, float) * (1.0 - t) + np.asarray(b, float) * t


def torso_weights(V):
    z = V[:, 2]
    chest = mkit._smoothstep((z - 1.170) / 0.130)
    hips = mkit._smoothstep((1.030 - z) / 0.110)
    spine = np.clip(1.0 - chest - hips, 0.0, 1.0)
    return [{"chest": float(c), "spine": float(s), "hips": float(h)}
            for c, s, h in zip(chest, spine, hips)]


def build(builder, mats):
    """Adds the whole armoured body; every piece names the bone that drives it."""
    A, D, S, SIL = mats["armor"], mats["dark"], mats["suit"], mats["silver"]
    ranges = {}

    # -- black flexible undersuit -------------------------------------
    tor = torso_sections(1.462, 0.920, inflate=-0.010, rows=16)
    flat = tor.reshape(-1, 3)
    w = torso_weights(flat)
    ranges["torso"] = builder.add_grid(tor, S, SUIT, cap_lo=tor[0].mean(axis=0),
                                       cap_hi=tor[-1].mean(axis=0), weights=w)

    for sign in (1.0, -1.0):
        sh = SHOULDER * [sign, 1, 1]
        el = ELBOW * [sign, 1, 1]
        wr = WRIST * [sign, 1, 1]
        hp = HIP * [sign, 1, 1]
        kn = KNEE * [sign, 1, 1]
        an = ANKLE * [sign, 1, 1]
        toe = TOE * [sign, 1, 1]
        side = "L" if sign > 0 else "R"

        # arm and leg undersuit
        add_tube(builder, S, SUIT, [_lerp(sh, el, t) for t in (0.0, 0.4, 0.8, 1.0)],
                 [0.076, 0.066, 0.058, 0.056], group="upperarm." + side, cols=18)
        add_tube(builder, S, SUIT, [_lerp(el, wr, t) for t in (0.0, 0.45, 1.0)],
                 [0.058, 0.052, 0.045], group="forearm." + side, cols=18)
        add_tube(builder, S, SUIT, [_lerp(hp, kn, t) for t in (0.0, 0.45, 1.0)],
                 [0.104, 0.090, 0.077], group="thigh." + side, cols=20)
        add_tube(builder, S, SUIT, [_lerp(kn, an, t) for t in (0.0, 0.5, 1.0)],
                 [0.077, 0.066, 0.053], group="shin." + side, cols=20)

        # -- shoulder ------------------------------------------------
        add_box(builder, A, PURPLE, (0.126, 0.120, 0.112), sh + [sign * 0.020, 0, 0.010],
                rot=(0, sign * -0.20, 0), group="shoulder." + side, e=0.58, rows=16, cols=22,
                grooves=[((-0.72, -0.50), (0.72, -0.50), 0.062),
                         ((-0.72, 0.32), (0.72, 0.32), 0.062)])
        add_box(builder, A, PURPLE, (0.092, 0.096, 0.048), sh + [sign * 0.014, 0, 0.076],
                rot=(0, sign * -0.18, 0), group="shoulder." + side, e=0.50)
        add_box(builder, D, DARK, (0.062, 0.070, 0.050), sh + [-sign * 0.060, 0, -0.062],
                group="shoulder." + side, e=0.62)

        # -- arm plates ----------------------------------------------
        add_tube(builder, A, PURPLE, [_lerp(sh, el, t) for t in (0.20, 0.55, 0.86)],
                 [0.083, 0.075, 0.066], group="upperarm." + side, cols=22, e=0.56)
        add_box(builder, D, DARK, (0.066, 0.064, 0.062), el, group="forearm." + side, e=0.58)
        add_box(builder, A, PURPLE, (0.024, 0.044, 0.042), el + [sign * 0.048, 0, 0.002],
                rot=(0, sign * 1.5708, 0), group="forearm." + side, e=0.48)
        add_tube(builder, A, PURPLE, [_lerp(el, wr, t) for t in (0.16, 0.55, 0.90)],
                 [0.070, 0.062, 0.053], group="forearm." + side, cols=22, e=0.56)
        add_tube(builder, D, DARK, [_lerp(el, wr, t) for t in (0.93, 1.0)],
                 [0.050, 0.049], group="hand." + side, cols=18, e=0.8)

        # -- hand ----------------------------------------------------
        along, spread, palm_n = _limb_frame(el, wr)
        palm = wr + along * 0.058
        add_box(builder, D, DARK, (0.042, 0.072, 0.070), palm,
                rot=(0, sign * -0.10, 0), group="hand." + side, e=0.50)
        add_box(builder, A, PURPLE, (0.030, 0.068, 0.066), palm + palm_n * sign * 0.030,
                group="hand." + side, e=0.46)
        for off, length, name in ((-0.048, 0.092, "index"), (-0.016, 0.102, "middle"),
                                  (0.016, 0.096, "ring"), (0.047, 0.078, "pinky")):
            root = palm + spread * off + along * 0.056
            for seg in range(3):
                frac = seg / 3.0
                a = root + along * (length * frac)
                b = root + along * (length * (frac + 0.335))
                add_tube(builder, A, PURPLE, [a, _lerp(a, b, 0.5), b],
                         [0.0165 - seg * 0.0016, 0.0161 - seg * 0.0016, 0.0146 - seg * 0.0018],
                         group="%s%d.%s" % (name, seg + 1, side), cols=9, e=0.66)
        thumb_root = palm + spread * -0.056 + palm_n * sign * 0.022 - along * 0.004
        thumb_dir = (-spread * 0.50 + along * 0.68 - palm_n * sign * 0.54)
        thumb_dir /= np.linalg.norm(thumb_dir)
        for seg in range(2):
            a = thumb_root + thumb_dir * (0.042 * seg)
            b = thumb_root + thumb_dir * (0.042 * (seg + 1))
            add_tube(builder, A, PURPLE, [a, _lerp(a, b, 0.5), b],
                     [0.0210 - seg * 0.0028, 0.0203 - seg * 0.0028, 0.0184 - seg * 0.0028],
                     group="thumb%d.%s" % (seg + 1, side), cols=9, e=0.66)

        # -- chest, abdomen, hips ------------------------------------
        add_box(builder, A, PURPLE, (0.092, 0.064, 0.094), (sign * 0.132, -0.070, 1.318),
                rot=(0, 0, sign * 0.28), group="chest", e=0.52, rows=15, cols=20,
                grooves=[((-0.74, -0.43), (0.74, -0.43), 0.058)])
        add_box(builder, A, PURPLE, (0.086, 0.050, 0.046), (sign * 0.116, -0.062, 1.378),
                rot=(0, 0, sign * 0.22), group="chest", e=0.46)
        add_box(builder, A, PURPLE, (0.074, 0.062, 0.070), (sign * 0.170, 0.052, 1.330),
                rot=(0, 0, sign * -0.20), group="chest", e=0.48)
        for k, (z, half, depth) in enumerate(((1.240, 0.098, 0.090), (1.184, 0.092, 0.086),
                                              (1.132, 0.086, 0.080))):
            add_box(builder, A, PURPLE, (half, depth, 0.026),
                    (sign * (half + 0.014), -0.026 + k * 0.002, z),
                    rot=(0, 0, sign * -0.09), group="spine" if k else "chest", e=0.44)
            add_box(builder, A, PURPLE, (0.070, 0.056, 0.024),
                    (0.0, -0.070 + k * 0.004, z - 0.006), group="spine" if k else "chest", e=0.42)
        add_box(builder, A, PURPLE, (0.090, 0.110, 0.082), (sign * 0.148, -0.030, 0.984),
                rot=(0, 0, sign * 0.12), group="hips", e=0.50, rows=16, cols=22,
                grooves=[((-0.66, -0.56), (0.66, -0.56), 0.060),
                         ((-0.66, 0.46), (0.66, 0.46), 0.060)])
        add_box(builder, A, PURPLE, (0.072, 0.090, 0.064), (sign * 0.128, 0.078, 1.000),
                group="hips", e=0.50)

        # -- leg plates ----------------------------------------------
        add_tube(builder, A, PURPLE, [_lerp(hp, kn, t) for t in (0.16, 0.55, 0.88)],
                 [0.110, 0.098, 0.085], group="thigh." + side, cols=24, e=0.54)
        add_box(builder, D, DARK, (0.078, 0.076, 0.070), kn, group="shin." + side, e=0.58)
        add_box(builder, A, PURPLE, (0.058, 0.062, 0.056), kn + [0, -0.030, 0.004],
                group="shin." + side, e=0.44)
        add_tube(builder, A, PURPLE, [_lerp(kn, an, t) for t in (0.18, 0.6, 0.92)],
                 [0.084, 0.072, 0.058], group="shin." + side, cols=22, e=0.54)

        # -- boot ----------------------------------------------------
        boot = [an + [0, 0.036, 0.036], an + [0, 0.014, -0.026],
                _lerp(an, toe, 0.45) + [0, 0, -0.060], toe + [0, 0.014, -0.042],
                toe + [0, -0.030, -0.034]]
        add_tube(builder, A, PURPLE, boot, [0.078, 0.088, 0.086, 0.075, 0.058],
                 group="foot." + side, cols=22, e=0.48,
                 squash=[0.95, 1.06, 1.12, 1.06, 0.92])
        add_box(builder, D, DARK, (0.062, 0.118, 0.016), _lerp(an, toe, 0.42) + [0, 0.012, -0.088],
                group="foot." + side, e=0.35)

    # -- collar, belt, back and the emblem -----------------------------
    add_tube(builder, A, PURPLE, [(0, 0.010, 1.372), (0, 0.008, 1.412), (0, 0.006, 1.448)],
             [0.116, 0.106, 0.096], group="neck", cols=24, e=0.62,
             squash=[0.92, 0.90, 0.88])
    add_box(builder, A, PURPLE, (0.122, 0.062, 0.132), (0, -0.092, 1.300), group="chest",
            e=0.50, rows=18, cols=24,
            grooves=[((-0.62, -0.64), (0.62, -0.64), 0.060),
                     ((-0.62, 0.50), (0.62, 0.50), 0.060),
                     ((-0.70, -0.50), (-0.70, 0.38), 0.058),
                     ((0.70, -0.50), (0.70, 0.38), 0.058)])
    add_box(builder, A, PURPLE, (0.186, 0.070, 0.168), (0, 0.070, 1.292), group="chest",
            e=0.52, rows=17, cols=23,
            grooves=[((-0.76, -0.16), (0.76, -0.16), 0.058),
                     ((-0.46, -0.86), (-0.46, 0.72), 0.056),
                     ((0.46, -0.86), (0.46, 0.72), 0.056)])
    belt = torso_sections(1.062, 1.104, inflate=0.014, rows=4, e=0.70)
    builder.add_grid(belt, A, PURPLE, cap_lo=belt[0].mean(axis=0),
                     cap_hi=belt[-1].mean(axis=0), group="hips")  # belt ring
    add_box(builder, A, PURPLE, (0.084, 0.052, 0.076), (0, -0.104, 0.952), group="hips", e=0.46)
    add_box(builder, A, PURPLE, (0.130, 0.062, 0.070), (0, 0.070, 1.010), group="hips", e=0.50)
    add_box(builder, A, PURPLE, (0.150, 0.066, 0.062), (0, 0.062, 1.176), group="spine", e=0.50)

    # Emblem: a raised hex frame, a recessed dark field, then the J on top -
    # the three-layer badge the chest reference sheet shows.
    ring_o, ring_f = prism(hexagon(0.132), 0.026, bevel=0.006, inset=0.007)
    ring_o = place(ring_o, (0.0, -0.150, 1.288))
    builder.add(ring_o, ring_f, A, PURPLE, group="chest")
    hexo, hexf = prism(hexagon(0.112), 0.024, bevel=0.005, inset=0.009)
    hexo = place(hexo, (0.0, -0.153, 1.288))
    builder.add(hexo, hexf, D, DARK, group="chest")
    out, faces = prism(emblem_outline(0.90), 0.026, bevel=0.006, inset=0.007)
    out = place(out, (0.0, -0.163, 1.278))
    ranges["emblem"] = builder.add(out, faces, SIL, SILVER, group="chest")
    return ranges
