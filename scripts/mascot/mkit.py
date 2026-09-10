"""Modelling kit for the Jaxongirman character.

Surfaces are generated as numpy arrays and only handed to Blender at the end,
so the anatomy can be sculpted with ordinary vector maths instead of operators.
Every part of the character is built from these primitives; nothing in the
final asset is a photograph or an image texture.
"""

import numpy as np

TAU = np.pi * 2.0


# --------------------------------------------------------------- primitives

def _sq(t, e):
    """Superquadric cosine/sine: `e` below 1 squares the section off."""
    c, s = np.cos(t), np.sin(t)
    return np.sign(c) * np.abs(c) ** e, np.sign(s) * np.abs(s) ** e


def ring(n, rx, ry, e=1.0, phase=0.0):
    """A closed section in the XY plane, counter-clockwise from +X."""
    t = np.linspace(0.0, TAU, n, endpoint=False) + phase
    cx, sy = _sq(t, e)
    return np.stack([cx * rx, sy * ry], axis=-1)


def sphere_grid(rows, cols, radii=(1.0, 1.0, 1.0), e_lat=1.0, e_lon=1.0):
    """Latitude rows of a superellipsoid, excluding the two poles."""
    phi = np.linspace(0.0, np.pi, rows + 2)[1:-1]          # 0 = bottom
    theta = np.linspace(0.0, TAU, cols, endpoint=False)
    rr, cz = _sq(phi - np.pi / 2.0, e_lat)                 # rr outward, cz up
    cx, sy = _sq(theta, e_lon)
    P = np.empty((rows, cols, 3))
    P[..., 0] = rr[:, None] * cx[None, :] * radii[0]
    P[..., 1] = rr[:, None] * sy[None, :] * radii[1]
    P[..., 2] = cz[:, None] * np.ones(cols)[None, :] * radii[2]
    return P


def loft(sections):
    """Stack a list of (cols, 3) sections into a (rows, cols, 3) tube."""
    return np.stack(sections, axis=0)


def section_at(profile2d, origin, x_axis, y_axis):
    """Place a 2D section into 3D on the plane spanned by two axes."""
    o = np.asarray(origin, float)
    xa = np.asarray(x_axis, float)
    ya = np.asarray(y_axis, float)
    return o[None, :] + profile2d[:, 0:1] * xa[None, :] + profile2d[:, 1:2] * ya[None, :]


def tube(path, radii, cols=20, e=1.0, squash=None, up=(0.0, 0.0, 1.0)):
    """Sweep a superellipse along a polyline, radius given per path point."""
    path = np.asarray(path, float)
    radii = np.asarray(radii, float)
    squash = np.ones(len(path)) if squash is None else np.asarray(squash, float)
    up = np.asarray(up, float)
    out = []
    for i, p in enumerate(path):
        if i == 0:
            t = path[1] - path[0]
        elif i == len(path) - 1:
            t = path[-1] - path[-2]
        else:
            t = path[i + 1] - path[i - 1]
        t = t / (np.linalg.norm(t) + 1e-9)
        ref = up if abs(np.dot(t, up)) < 0.95 else np.array([1.0, 0.0, 0.0])
        xa = np.cross(ref, t)
        xa /= np.linalg.norm(xa) + 1e-9
        ya = np.cross(t, xa)
        prof = ring(cols, radii[i], radii[i] * squash[i], e)
        out.append(section_at(prof, p, xa, ya))
    return np.stack(out, axis=0)


# ------------------------------------------------------------------- faces

def grid_faces(rows, cols, wrap=True, base=0):
    f = []
    span = cols if wrap else cols - 1
    for j in range(rows - 1):
        for i in range(span):
            a = base + j * cols + i
            b = base + j * cols + (i + 1) % cols
            f.append((a, b, b + cols, a + cols))
    return f


def fan_faces(cols, apex, first_row, base=0, flip=False):
    f = []
    for i in range(cols):
        a = base + first_row + i
        b = base + first_row + (i + 1) % cols
        f.append((apex, b, a) if flip else (apex, a, b))
    return f


# ------------------------------------------------------------------ sculpt

def _smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def bump(P, center, radii, power=1.0):
    """Compact smooth falloff around a point, 1 at the centre, 0 outside."""
    d = np.linalg.norm((P - np.asarray(center, float)) / np.asarray(radii, float), axis=-1)
    return _smoothstep(1.0 - d) ** power


def bump_seg(P, a, b, radii, power=1.0):
    """Same falloff measured from a line segment, for ridges and creases."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    r = np.asarray(radii, float)
    q = (P - a) / r
    ab = (b - a) / r
    t = np.clip((q * ab).sum(-1) / (ab * ab).sum(), 0.0, 1.0)
    d = np.linalg.norm(q - t[..., None] * ab, axis=-1)
    return _smoothstep(1.0 - d) ** power


def mask_side(P, sign):
    """Restrict an operator to one half of the body (sign = +1 for +X)."""
    return (P[..., 0] * sign > 0.0).astype(float)


def push(P, weight, direction, amount):
    """Move vertices along a fixed direction, scaled by a falloff weight."""
    P += (weight * amount)[..., None] * np.asarray(direction, float)[None, :]
    return P


def push_radial(P, weight, center, amount):
    d = P - np.asarray(center, float)
    n = d / (np.linalg.norm(d, axis=-1, keepdims=True) + 1e-9)
    P += (weight * amount)[..., None] * n
    return P


def rotate_about(P, weight, pivot, axis, angle):
    """Blend a rotation in by weight, used for lids, jaw and shape keys."""
    pivot = np.asarray(pivot, float)
    axis = np.asarray(axis, float)
    axis = axis / (np.linalg.norm(axis) + 1e-9)
    d = P - pivot
    cosa, sina = np.cos(angle), np.sin(angle)
    rot = d * cosa + np.cross(axis[None, :], d) * sina + axis[None, :] * (d @ axis)[..., None] * (1.0 - cosa)
    P += weight[..., None] * (pivot + rot - P)
    return P


def relax(V, faces, iterations=1, strength=0.5, mask=None):
    """Laplacian smoothing over an explicit face list."""
    n = len(V)
    for _ in range(iterations):
        acc = np.zeros_like(V)
        cnt = np.zeros(n)
        for f in faces:
            k = len(f)
            for i in range(k):
                a, b = f[i], f[(i + 1) % k]
                acc[a] += V[b]
                acc[b] += V[a]
                cnt[a] += 1.0
                cnt[b] += 1.0
        cnt[cnt == 0.0] = 1.0
        target = acc / cnt[:, None]
        w = strength if mask is None else (strength * mask)[:, None]
        V += w * (target - V)
    return V


def mirror_x(V, F, colors=None, mats=None):
    """Mirror a half-built part; caller supplies only the +X side."""
    V2 = V.copy()
    V2[:, 0] *= -1.0
    F2 = [tuple(reversed([i + len(V) for i in f])) for f in F]
    out = [np.concatenate([V, V2]), F + F2]
    out.append(None if colors is None else np.concatenate([colors, colors]))
    out.append(None if mats is None else mats + mats)
    return out
