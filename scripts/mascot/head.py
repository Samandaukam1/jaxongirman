"""Jaxongir's head: skull, face, eyelids, eyeballs, ears, brows, hair, neck.

Everything here is geometry. The reference sheet was used to pick the numbers
below - the profile table, the eye almond, the nose and lip landmarks - but no
pixel of it reaches the asset.

Local frame: origin at the head centre, +X is the character's left, -Y is the
direction he faces, +Z is up. HEAD_ORIGIN lifts the result into body space.
"""

import numpy as np

import mkit

HEAD_ORIGIN = np.array([0.0, 0.0, 1.745])

ROWS, COLS = 72, 94

# v, z, forward extent, rearward extent, half width. Read off the profile and
# front reference, then smoothed; v runs from under the jaw to the crown.
PROFILE = [
    (0.000, -0.284, 0.062, 0.080, 0.052),
    (0.045, -0.270, 0.112, 0.094, 0.072),
    (0.090, -0.254, 0.150, 0.106, 0.092),
    (0.150, -0.234, 0.180, 0.122, 0.110),
    (0.215, -0.210, 0.188, 0.140, 0.129),
    (0.285, -0.184, 0.191, 0.160, 0.147),
    (0.355, -0.157, 0.194, 0.177, 0.162),
    (0.425, -0.129, 0.199, 0.191, 0.176),
    (0.495, -0.100, 0.201, 0.201, 0.188),
    (0.565, -0.069, 0.199, 0.210, 0.198),
    (0.635, -0.036, 0.198, 0.218, 0.205),
    (0.705,  0.001, 0.199, 0.225, 0.209),
    (0.775,  0.043, 0.195, 0.229, 0.209),
    (0.845,  0.092, 0.182, 0.228, 0.202),
    (0.905,  0.144, 0.160, 0.218, 0.186),
    (0.955,  0.192, 0.128, 0.196, 0.151),
    (1.000,  0.234, 0.074, 0.145, 0.099),
]
CAP_LO = np.array([0.0, 0.030, -0.292])
CAP_HI = np.array([0.0, -0.012, 0.250])

EYE = np.array([0.0805, -0.140, -0.046])       # centre of the character's left eye
EYE_R = 0.0545
BROW_Z = 0.016
NOSE_BASE_Z = -0.113
MOUTH_Z = -0.168
CHIN_Z = -0.238
EAR = np.array([0.186, 0.030, -0.042])

SKIN = (0.735, 0.392, 0.228)
HAIR = (0.0295, 0.0175, 0.0125)
SCLERA = (0.665, 0.638, 0.612)


# ------------------------------------------------------------------ skull

def _profile_arrays(rows):
    src = np.array(PROFILE)
    v = np.linspace(0.0, 1.0, rows)
    out = [np.interp(v, src[:, 0], src[:, k]) for k in (1, 2, 3, 4)]
    # A light pass along v removes the creases the piecewise table leaves.
    for arr in out:
        for _ in range(14):
            arr[1:-1] = arr[1:-1] * 0.5 + (arr[:-2] + arr[2:]) * 0.25
    return out


def _base_skull():
    z, front, back, width = _profile_arrays(ROWS)
    theta = np.linspace(0.0, mkit.TAU, COLS, endpoint=False)
    P = np.empty((ROWS, COLS, 3))
    for j in range(ROWS):
        # Squarer sections through the face give flat cheeks and a real jaw
        # corner; the crown stays round.
        e = np.interp(z[j], [-0.30, -0.16, 0.02, 0.14, 0.26], [0.95, 0.82, 0.86, 0.95, 1.0])
        cx, sy = np.sign(np.sin(theta)) * np.abs(np.sin(theta)) ** e, \
                 np.sign(np.cos(theta)) * np.abs(np.cos(theta)) ** e
        yr = (front[j] + back[j]) / 2.0
        yo = (back[j] - front[j]) / 2.0
        P[j, :, 0] = width[j] * cx
        P[j, :, 1] = yo + yr * (-sy)
        P[j, :, 2] = z[j]
    return P


# ------------------------------------------------------------------- face

def _sculpt_face(V):
    """Bumps and creases in head-local space. Order matters: bone first, then
    soft tissue, then the small creases that sit on top of both."""
    for s in (1.0, -1.0):
        sx = s
        # brow ridge and glabella
        w = mkit.bump_seg(V, (sx * 0.018, -0.192, BROW_Z - 0.004),
                          (sx * 0.128, -0.166, BROW_Z + 0.012),
                          (0.072, 0.058, 0.034))
        mkit.push(V, w, (0.0, -1.0, 0.0), 0.0165)
        # temple hollow
        w = mkit.bump(V, (sx * 0.183, -0.062, 0.048), (0.075, 0.10, 0.075))
        mkit.push(V, w, (sx * -1.0, 0.0, 0.0), 0.008)
        # cheekbone
        w = mkit.bump(V, (sx * 0.136, -0.138, -0.058), (0.078, 0.075, 0.058))
        mkit.push(V, w, (sx * 0.60, -0.78, 0.07), 0.0205)
        # cheek fullness towards the mouth
        w = mkit.bump(V, (sx * 0.100, -0.163, -0.120), (0.078, 0.070, 0.062))
        mkit.push(V, w, (sx * 0.28, -0.95, 0.0), 0.0035)
        # slight hollow under the cheekbone
        w = mkit.bump(V, (sx * 0.132, -0.132, -0.126), (0.058, 0.068, 0.055))
        mkit.push(V, w, (sx * -0.45, 1.0, 0.0), 0.0105)
        # the mandible edge, so the jaw reads as a line and not a curve
        w = mkit.bump_seg(V, (sx * 0.040, -0.176, CHIN_Z + 0.006),
                          (sx * 0.152, -0.020, -0.150), (0.030, 0.030, 0.020))
        mkit.push(V, w, (sx * 0.38, -0.28, -0.90), 0.0095)
        # masseter, the jaw corner that keeps the face broad
        w = mkit.bump(V, (sx * 0.152, 0.012, -0.148), (0.070, 0.090, 0.070))
        mkit.push(V, w, (sx * 1.0, 0.1, 0.0), 0.009)
        # nostril wing
        w = mkit.bump(V, (sx * 0.040, -0.202, NOSE_BASE_Z - 0.008), (0.042, 0.048, 0.038))
        mkit.push(V, w, (sx * 0.80, -0.55, 0.0), 0.024)
        w = mkit.bump(V, (sx * 0.022, -0.199, NOSE_BASE_Z - 0.026), (0.018, 0.024, 0.014))
        mkit.push(V, w, (0.0, 1.0, -0.3), 0.011)
        # alar crease
        w = mkit.bump_seg(V, (sx * 0.041, -0.196, NOSE_BASE_Z + 0.020),
                          (sx * 0.034, -0.192, NOSE_BASE_Z - 0.012), (0.016, 0.030, 0.026))
        mkit.push(V, w, (0.0, 1.0, 0.0), 0.011)
        # mouth corner
        w = mkit.bump(V, (sx * 0.056, -0.176, MOUTH_Z + 0.002), (0.028, 0.040, 0.026))
        mkit.push(V, w, (0.0, 1.0, 0.0), 0.006)

    # nasal root, bridge and tip
    w = mkit.bump_seg(V, (0.0, -0.198, BROW_Z - 0.014), (0.0, -0.214, NOSE_BASE_Z + 0.044),
                      (0.038, 0.078, 0.082))
    mkit.push(V, w, (0.0, -1.0, 0.0), 0.032)
    w = mkit.bump(V, (0.0, -0.224, NOSE_BASE_Z + 0.006), (0.036, 0.058, 0.046))
    mkit.push(V, w, (0.0, -1.0, -0.06), 0.047)
    w = mkit.bump(V, (0.0, -0.230, NOSE_BASE_Z - 0.014), (0.031, 0.052, 0.028))
    mkit.push(V, w, (0.0, -1.0, -0.30), 0.014)
    # the small step under the nose
    w = mkit.bump(V, (0.0, -0.198, NOSE_BASE_Z - 0.030), (0.040, 0.040, 0.021))
    mkit.push(V, w, (0.0, 1.0, 0.0), 0.013)
    # philtrum groove between the two ridges
    w = mkit.bump_seg(V, (0.0, -0.190, NOSE_BASE_Z - 0.022), (0.0, -0.187, MOUTH_Z + 0.020),
                      (0.011, 0.028, 0.030))
    mkit.push(V, w, (0.0, 1.0, 0.0), 0.006)

    # lips
    w = mkit.bump_seg(V, (-0.054, -0.186, MOUTH_Z + 0.014), (0.054, -0.186, MOUTH_Z + 0.014),
                      (0.030, 0.030, 0.017))
    mkit.push(V, w, (0.0, -1.0, 0.0), 0.017)
    w = mkit.bump_seg(V, (-0.048, -0.186, MOUTH_Z - 0.021), (0.048, -0.186, MOUTH_Z - 0.021),
                      (0.030, 0.030, 0.021))
    mkit.push(V, w, (0.0, -1.0, 0.0), 0.017)
    w = mkit.bump_seg(V, (-0.055, -0.184, MOUTH_Z), (0.055, -0.184, MOUTH_Z),
                      (0.014, 0.030, 0.0075))
    mkit.push(V, w, (0.0, 1.0, 0.0), 0.010)
    # chin and the crease above it
    w = mkit.bump(V, (0.0, -0.196, CHIN_Z + 0.010), (0.062, 0.060, 0.052))
    mkit.push(V, w, (0.0, -1.0, 0.0), 0.011)
    w = mkit.bump_seg(V, (-0.030, -0.190, MOUTH_Z - 0.038), (0.030, -0.190, MOUTH_Z - 0.038),
                      (0.038, 0.036, 0.014))
    mkit.push(V, w, (0.0, 1.0, 0.0), 0.004)
    return V


# -------------------------------------------------------------- eye region

def _eye_frame(sign):
    centre = EYE * np.array([sign, 1.0, 1.0])
    fwd = np.array([sign * 0.20, -1.0, -0.05])
    fwd /= np.linalg.norm(fwd)
    up = np.array([0.0, 0.0, 1.0])
    side = np.cross(up, fwd) * sign
    side -= fwd * np.dot(side, fwd)
    side /= np.linalg.norm(side)
    up = np.cross(fwd, side) * sign
    up /= np.linalg.norm(up)
    return centre, fwd, side, up


def _almond(a, b, up_h, lo_h, tilt=0.115):
    """Signed opening mask in eye-tangent coordinates; >0 inside the fissure."""
    span = np.clip(1.0 - (a / 0.92) ** 2, 0.0, 1.0)
    upper = up_h * span ** 0.62 + tilt * a
    lower = -lo_h * span ** 0.85 + tilt * a
    return np.minimum(upper - b, b - lower)


def shape_eyes(V, up_h=(0.455, 0.455), lo_h=(0.365, 0.365), squint=0.0):
    """Wrap the orbital skin onto a shell around the eyeball and open a fissure.

    Re-running this with a smaller `up_h` is what closes the lids, so blinks are
    a real change of the lid surface rather than a rotated flap.
    """
    for k, sign in enumerate((1.0, -1.0)):
        centre, fwd, side, up = _eye_frame(sign)
        d = V - centre
        dist = np.linalg.norm(d, axis=-1) + 1e-9
        n = d / dist[:, None]
        a = (n @ side) / 0.82
        b = ((n @ up) - squint * 0.10) / 0.62
        front = n @ fwd
        zone = mkit.bump(V, centre, (0.108, 0.108, 0.098)) * (front > -0.15)
        opening = mkit._smoothstep(_almond(a, b, up_h[k], lo_h[k]) / 0.135 + 0.5)
        target = (EYE_R - 0.016) * opening + (EYE_R + 0.0115) * (1.0 - opening)
        blend = zone * np.clip(1.4 - 1.4 * np.abs(dist - EYE_R) / 0.085, 0.0, 1.0)
        V += (blend * (target - dist))[:, None] * n
        # the shallow crease that sits above the lid
        w = mkit.bump_seg(V, centre + side * -0.045 + up * 0.052,
                          centre + side * 0.048 + up * 0.062,
                          (0.052, 0.048, 0.017))
        mkit.push(V, w, -fwd, 0.005)
        # epicanthic fold at the inner corner, as the reference shows
        w = mkit.bump(V, centre - side * 0.055 + up * 0.008, (0.026, 0.028, 0.024))
        mkit.push(V, w, fwd, 0.005)
        # lid thickness: a small lip of skin right along the lash line
        w = mkit.bump_seg(V, centre - side * 0.034 + up * 0.020,
                          centre + side * 0.036 + up * 0.026, (0.040, 0.038, 0.0075))
        mkit.push(V, w, fwd, 0.0028)
    return V


def eyeball(builder, sign, mat_eye):
    """A real eyeball: sclera sphere, iris dish, pupil, all vertex coloured."""
    centre, fwd, side, up = _eye_frame(sign)
    P = mkit.sphere_grid(20, 26, (EYE_R, EYE_R, EYE_R))
    V = P.reshape(-1, 3).copy()
    basis = np.stack([side, up, -fwd], axis=1)
    V = V @ basis.T
    n = V / EYE_R
    ang = np.arccos(np.clip(n @ fwd, -1.0, 1.0))
    iris = mkit._smoothstep((0.620 - ang) / 0.055)
    pupil = mkit._smoothstep((0.250 - ang) / 0.038)
    limbus = np.clip(mkit._smoothstep((0.690 - ang) / 0.070) - iris, 0.0, 1.0)
    col = np.repeat(np.array(SCLERA)[None, :], len(V), axis=0)
    col = col * (1.0 - iris[:, None]) + np.array([[0.140, 0.074, 0.036]]) * iris[:, None]
    col = col * (1.0 - pupil[:, None]) + np.array([[0.008, 0.007, 0.007]]) * pupil[:, None]
    col *= (1.0 - 0.45 * limbus)[:, None]
    col *= (1.0 - 0.22 * mkit._smoothstep((ang - 1.05) / 0.5))[:, None]
    lidshade = mkit._smoothstep(((n @ up) - 0.02) / 0.40) * mkit._smoothstep((0.9 - ang) / 0.7)
    col *= (1.0 - 0.42 * lidshade)[:, None]
    corner = mkit._smoothstep((np.abs(n @ side) - 0.34) / 0.42)
    col *= (1.0 - 0.40 * corner)[:, None]
    V -= (iris * 0.0020)[:, None] * n
    V += centre
    lo = V[:P.shape[1]].mean(axis=0)
    hi = V[-P.shape[1]:].mean(axis=0)
    # `col` already carries the final tone, so the part tone stays neutral.
    builder.add_grid(V.reshape(P.shape), mat_eye, (1.0, 1.0, 1.0), cap_lo=lo, cap_hi=hi,
                     group="head", colors=col)


# ------------------------------------------------------------------- ears

def ear(sign):
    """Helix rim, antihelix, concha bowl, tragus and lobe, all as geometry."""
    P = mkit.sphere_grid(24, 26, (0.030, 0.033, 0.057), e_lat=0.88, e_lon=0.9)
    V = P.reshape(-1, 3).copy()
    zn = V[:, 2] / 0.057
    # Outline: broad and round at the top, narrowing into the lobe.
    V[:, 1] *= np.interp(zn, [-1.0, -0.62, -0.2, 0.3, 0.72, 1.0],
                         [0.60, 0.80, 0.98, 1.06, 1.02, 0.78])
    V[:, 1] += np.interp(zn, [-1.0, -0.35, 0.35, 1.0], [-0.008, -0.005, 0.004, 0.009])
    out = (V[:, 0] > 0.0).astype(float)
    rr = np.sqrt((V[:, 1] / 0.033) ** 2 + (V[:, 2] / 0.057) ** 2)
    # Helix: a rolled rim everywhere but the lobe and the front notch.
    helix = mkit._smoothstep((rr - 0.66) / 0.22) * mkit._smoothstep((zn + 0.55) / 0.35)
    helix *= 1.0 - 0.75 * mkit._smoothstep((-V[:, 1] / 0.033 - 0.35) / 0.45) * mkit._smoothstep((0.15 - zn) / 0.5)
    V[:, 0] += out * helix * 0.0105
    V[:, 1] *= 1.0 - 0.10 * helix
    V[:, 2] *= 1.0 - 0.05 * helix
    # Concha bowl behind the ear canal, and the antihelix that frames it.
    bowl = mkit.bump(V, (0.0, 0.001, -0.004), (0.030, 0.019, 0.030))
    V[:, 0] -= out * bowl * 0.017
    anti = mkit.bump_seg(V, (0.0, -0.007, 0.026), (0.0, -0.001, -0.014), (0.028, 0.0085, 0.026))
    V[:, 0] += out * anti * 0.0075
    tragus = mkit.bump(V, (0.0, -0.019, -0.010), (0.014, 0.010, 0.013))
    V[:, 0] += out * tragus * 0.008
    lobe = mkit.bump(V, (0.0, 0.006, -0.050), (0.026, 0.026, 0.020))
    V[:, 0] += out * lobe * 0.004
    col = np.ones((len(V), 3))
    col *= (1.0 - 0.34 * bowl * out)[:, None]
    col *= (1.0 - 0.12 * lobe)[:, None]
    col = col * (1.0 - 0.25 * helix)[:, None] + np.array([[1.10, 0.86, 0.80]]) * (0.25 * helix)[:, None]
    V[:, 0] = V[:, 0] * sign + EAR[0] * sign
    V[:, 1] += EAR[1]
    V[:, 2] += EAR[2]
    V[:, 1] += (V[:, 2] - EAR[2]) * 0.26
    return V.reshape(P.shape), col.reshape(P.shape[0], P.shape[1], 3)


# ------------------------------------------------------------------ brows

def brow(sign):
    """A flattened strand mass lying on the brow ridge, thick at the inner end."""
    t = np.linspace(0.0, 1.0, 16)
    x = sign * (0.016 + t * 0.126)
    y = -0.206 + 0.050 * (np.abs(x) / 0.142) ** 2.0
    z = BROW_Z - 0.018 + 0.024 * t ** 0.60 - 0.028 * t ** 2.6
    path = np.stack([x, y, z], axis=-1)
    thick = 0.0056 * (1.0 - 0.36 * t ** 2.4) * (0.62 + 0.38 * np.clip(t * 7.0, 0.0, 1.0))
    tall = 0.0118 * (0.72 + 0.42 * np.sin(np.clip(t, 0.03, 0.99) * np.pi) ** 0.35) * (1.0 - 0.34 * t ** 2.6)
    return mkit.tube(path, thick, cols=10, e=0.62, squash=tall / thick)


# ------------------------------------------------------------------- hair

def _hair_shell(V_head, lift):
    """Push the skull outwards from its own centre to sit hair on top of it."""
    n = V_head / (np.linalg.norm(V_head, axis=-1, keepdims=True) + 1e-9)
    return V_head + n * lift


def _scalp_point(row_frac, col_frac, skull, extra=0.0):
    rows, cols = skull.shape[0], skull.shape[1]
    r = np.clip(row_frac * (rows - 1), 0, rows - 1.001)
    c = (col_frac % 1.0) * cols
    r0, c0 = int(r), int(c) % cols
    fr, fc = r - r0, c - int(c)
    p = (skull[r0, c0] * (1 - fr) * (1 - fc) + skull[r0 + 1, c0] * fr * (1 - fc)
         + skull[r0, (c0 + 1) % cols] * (1 - fr) * fc
         + skull[r0 + 1, (c0 + 1) % cols] * fr * fc)
    n = p / (np.linalg.norm(p) + 1e-9)
    return p + n * extra


def _hairline(col_frac):
    """Row fraction where hair starts, as a function of the angle around the head."""
    a = (col_frac % 1.0) * mkit.TAU
    x = np.sin(a)
    front = max(0.0, -np.cos(a))
    # High over the forehead, dropping to sideburns at the temples.
    return 0.845 - 0.100 * front ** 1.5 - 0.055 * abs(x) ** 2 + 0.030 * front * x


CRANIUM_C = np.array([0.0, 0.014, -0.002])
CRANIUM_R = np.array([0.214, 0.226, 0.240])


def _cranium(direction, lift=0.0):
    d = direction / (np.linalg.norm(direction, axis=-1, keepdims=True) + 1e-9)
    rho = 1.0 / np.sqrt(((d / CRANIUM_R) ** 2).sum(-1, keepdims=True))
    return CRANIUM_C + d * (rho + lift)


def _hair_lift(direction):
    d = direction / (np.linalg.norm(direction, axis=-1, keepdims=True) + 1e-9)
    up = np.clip(d[..., 2], 0.0, 1.0)
    side = np.abs(d[..., 0])
    front = np.clip(-d[..., 1], 0.0, 1.0)
    sweep = np.clip(d[..., 0], 0.0, 1.0) * np.clip(d[..., 2], 0.0, 1.0)
    lift = 0.007 + 0.030 * up ** 1.25 - 0.016 * side ** 2.0 * (1.0 - up)
    lift += 0.011 * sweep ** 1.3 + 0.007 * front * up ** 1.5
    return np.clip(lift, 0.004, 0.046)


def _comb(direction):
    """Short side-parted hair: off the part on his right, back over the crown."""
    d = direction / (np.linalg.norm(direction, axis=-1, keepdims=True) + 1e-9)
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    flow = np.stack([
        0.62 * np.clip(z, 0.0, 1.0) + 0.30 * np.sign(x + 0.10) * np.abs(x) - 0.12,
        0.55 + 0.45 * np.clip(-y, 0.0, 1.0),
        -0.45 - 0.55 * np.clip(-z, 0.0, 1.0) - 0.35 * np.abs(x),
    ], axis=-1)
    flow -= d * (flow * d).sum(-1, keepdims=True)
    return flow / (np.linalg.norm(flow, axis=-1, keepdims=True) + 1e-9)


def _above_hairline(direction):
    d = direction / (np.linalg.norm(direction) + 1e-9)
    x, y, z = d
    # Hairline height as a function of the angle round from the face: flat and
    # high over the forehead, receding at the temple, a sideburn in front of
    # the ear, then down to the nape.
    az = np.degrees(np.arctan2(abs(x), y))
    limit = np.interp(az, [0, 26, 44, 58, 70, 82, 90, 112, 142, 180],
                      [-0.560, -0.470, -0.300, -0.120, 0.020, 0.225, 0.340, 0.412, 0.436, 0.442])
    return z > limit


def hair_cap(rows=15):
    """A closed dark shell over the scalp so no skin shows between the cards."""
    theta = np.linspace(0.0, mkit.TAU, COLS, endpoint=False)
    outer, inner = [], []
    for j in range(rows):
        t = j / (rows - 1.0)
        row_o, row_i = [], []
        for th in theta:
            # Walk down from the crown until the hairline for this direction.
            lo, hi = -0.35, 1.0
            for _ in range(22):
                mid = (lo + hi) / 2.0
                d = np.array([np.sin(th) * np.sqrt(max(1e-6, 1.0 - mid ** 2)),
                              -np.cos(th) * np.sqrt(max(1e-6, 1.0 - mid ** 2)), mid])
                if _above_hairline(d):
                    hi = mid
                else:
                    lo = mid
            edge = hi
            zv = 1.0 - (1.0 - edge) * (1.0 - t) ** 1.25
            s = np.sqrt(max(1e-6, 1.0 - zv ** 2))
            d = np.array([np.sin(th) * s, -np.cos(th) * s, zv])
            lift = float(_hair_lift(d[None, :])[0]) * mkit._smoothstep(t * 2.4)
            row_o.append(_cranium(d[None, :], lift)[0])
            row_i.append(_cranium(d[None, :], -0.004)[0])
        outer.append(np.array(row_o))
        inner.append(np.array(row_i))
    grid = np.concatenate([np.array(inner)[::-1], np.array(outer)], axis=0)
    apex_i = np.array(inner[-1]).mean(axis=0)
    apex_o = np.array(outer[-1]).mean(axis=0)
    return grid, apex_i, apex_o


def _hairline_z(th):
    lo, hi = -0.62, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2.0
        s = np.sqrt(max(1e-6, 1.0 - mid ** 2))
        if _above_hairline(np.array([np.sin(th) * s, -np.cos(th) * s, mid])):
            hi = mid
        else:
            lo = mid
    return hi


def hair_cards(count=290, fringe=108, segments=7, seed=7):
    rng = np.random.default_rng(seed)
    strips = []
    tries = 0
    while len(strips) < count + fringe and tries < (count + fringe) * 40:
        tries += 1
        is_fringe = len(strips) >= count
        if is_fringe:
            # Roots just behind the hairline, combed forward and across, so the
            # front edge of the hair breaks up instead of ending on a hard line.
            th = rng.uniform(-1.15, 1.15)
            edge = _hairline_z(th)
            z = edge + rng.uniform(0.02, 0.20)
        else:
            z = rng.uniform(-0.42, 0.99)
            th = rng.uniform(0.0, mkit.TAU)
        s = np.sqrt(max(1e-6, 1.0 - z * z))
        d = np.array([np.sin(th) * s, -np.cos(th) * s, z])
        if not _above_hairline(d):
            continue
        if is_fringe:
            length = 0.036 + rng.uniform(-0.006, 0.016)
            width = 0.0050 + 0.0038 * rng.random()
        else:
            length = 0.044 + 0.038 * np.clip(d[2], 0.0, 1.0) + rng.uniform(-0.008, 0.013)
            width = 0.0050 + 0.0036 * rng.random()
        path, dirs = [], d.copy()
        cur = d.copy()
        for k in range(segments):
            lift = float(_hair_lift(cur[None, :])[0])
            lift *= 0.94 + 0.16 * (k / (segments - 1.0))
            path.append(_cranium(cur[None, :], lift + 0.0035)[0])
            step = _comb(cur[None, :])[0]
            if is_fringe:
                fdir = np.array([0.62, -0.24, -0.72])
                fdir -= cur * np.dot(fdir, cur)
                step = 0.35 * step + 0.65 * fdir / (np.linalg.norm(fdir) + 1e-9)
            step += rng.normal(0.0, 0.115 if not is_fringe else 0.085, 3)
            cur = cur + step * (length / segments) / 0.22
            cur /= np.linalg.norm(cur)
        path = np.array(path)
        sections = []
        for k in range(segments):
            taper = (1.0 - (k / (segments - 1.0)) ** 1.6)
            tangent = (path[min(k + 1, segments - 1)] - path[max(k - 1, 0)])
            tangent /= np.linalg.norm(tangent) + 1e-9
            normal = path[k] - CRANIUM_C
            normal /= np.linalg.norm(normal) + 1e-9
            side = np.cross(tangent, normal)
            side /= np.linalg.norm(side) + 1e-9
            prof = mkit.ring(4, width * (0.32 + 0.72 * taper), 0.0026 * (0.25 + 0.75 * taper), 0.75)
            sections.append(mkit.section_at(prof, path[k], side, normal))
        strips.append((mkit.loft(sections), path[0], path[-1]))
    return strips


# ------------------------------------------------------------------- neck

def neck():
    path = np.array([[0.0, 0.020, -0.30], [0.0, 0.016, -0.36], [0.0, 0.010, -0.44],
                     [0.0, 0.004, -0.52]])
    return mkit.tube(path, [0.086, 0.084, 0.083, 0.085], cols=20, e=0.92,
                     squash=[0.88, 0.88, 0.90, 0.92])


# ---------------------------------------------------------- skin colouring

def skin_colours(V):
    col = np.ones((len(V), 3))
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    # Beard shadow across the jaw, chin and upper lip.
    beard = mkit.bump(V, (0.0, -0.150, MOUTH_Z - 0.030), (0.150, 0.140, 0.078))
    beard += mkit.bump_seg(V, (-0.030, -0.192, NOSE_BASE_Z - 0.026),
                           (0.030, -0.192, NOSE_BASE_Z - 0.026), (0.030, 0.030, 0.020)) * 0.8
    beard = np.clip(beard, 0.0, 1.0) * (y < 0.02)
    col *= (1.0 - 0.16 * beard)[:, None] * np.where(beard[:, None] > 0.0,
                                                    np.array([[1.0, 0.985, 1.005]]), 1.0)
    # Lips.
    lip = mkit.bump_seg(V, (-0.048, -0.190, MOUTH_Z + 0.004), (0.048, -0.190, MOUTH_Z + 0.004),
                        (0.020, 0.026, 0.030), power=1.3)
    col = col * (1.0 - lip[:, None]) + np.array([[0.96, 0.545, 0.505]]) * lip[:, None]
    # Mouth line, nostrils and the socket keep their own shadow.
    dark = mkit.bump_seg(V, (-0.055, -0.186, MOUTH_Z), (0.055, -0.186, MOUTH_Z),
                         (0.010, 0.024, 0.0055), power=1.4)
    for s in (1.0, -1.0):
        dark = np.maximum(dark, mkit.bump(V, (s * 0.020, -0.202, NOSE_BASE_Z - 0.012),
                                          (0.016, 0.022, 0.012), power=1.2))
    col *= (1.0 - 0.62 * dark)[:, None]
    for s in (1.0, -1.0):
        socket = mkit.bump(V, (s * EYE[0], EYE[1] + 0.010, EYE[2] + 0.018), (0.074, 0.062, 0.048))
        col *= (1.0 - 0.13 * socket)[:, None]
        centre, fwd, side, upv = _eye_frame(s)
        lash = mkit.bump_seg(V, centre - side * 0.036 + upv * 0.014,
                             centre + side * 0.038 + upv * 0.020, (0.042, 0.040, 0.0055),
                             power=1.5)
        lash = np.maximum(lash, mkit.bump_seg(V, centre - side * 0.030 - upv * 0.014,
                                              centre + side * 0.032 - upv * 0.010,
                                              (0.036, 0.036, 0.0045), power=1.8) * 0.55)
        col *= (1.0 - 0.60 * lash)[:, None]
        blush = mkit.bump(V, (s * 0.118, -0.158, -0.086), (0.078, 0.070, 0.062))
        col = col * (1.0 - 0.30 * blush)[:, None] + np.array([[1.06, 0.90, 0.86]]) * (0.30 * blush)[:, None]
    nose = mkit.bump(V, (0.0, -0.226, NOSE_BASE_Z + 0.014), (0.045, 0.045, 0.045))
    col = col * (1.0 - 0.18 * nose)[:, None] + np.array([[1.05, 0.92, 0.88]]) * (0.18 * nose)[:, None]
    # Neck and the underside of the jaw sit in shade.
    col *= np.clip(1.0 - 0.30 * mkit._smoothstep((-0.245 - z) / 0.09), 0.62, 1.0)[:, None]
    return col


def _grid_relax(V, iterations=1, strength=0.35, mask=None):
    """Smooth the skull grid in place; columns wrap, rows clamp at the poles.

    The lid margin is where a coarse quad grid shows its staircase, so a couple
    of masked passes there buy far more than extra resolution everywhere."""
    G = V.reshape(ROWS, COLS, 3)
    w = strength if mask is None else (strength * mask.reshape(ROWS, COLS))[..., None]
    for _ in range(iterations):
        up = np.concatenate([G[1:], G[-1:]], axis=0)
        dn = np.concatenate([G[:1], G[:-1]], axis=0)
        avg = (up + dn + np.roll(G, -1, axis=1) + np.roll(G, 1, axis=1)) * 0.25
        G += w * (avg - G)
    return G.reshape(-1, 3)


def _eye_mask(V):
    m = np.zeros(len(V))
    for s in (1.0, -1.0):
        centre = EYE * np.array([s, 1.0, 1.0])
        m = np.maximum(m, mkit.bump(V, centre, (0.088, 0.082, 0.070), power=0.7))
    return m


# ------------------------------------------------------------- expressions

def _expr_face(V, expr):
    """Expression moves that skin and brows share, so they travel together."""
    smile = expr.get("smile", 0.0)
    browup = expr.get("brow", 0.0)
    jaw = expr.get("mouth", 0.0)
    if smile:
        for s in (1.0, -1.0):
            w = mkit.bump(V, (s * 0.050, -0.176, MOUTH_Z), (0.054, 0.050, 0.042))
            mkit.push(V, w, (s * 0.44, -0.08, 0.89), 0.019 * smile)
            w = mkit.bump(V, (s * 0.110, -0.158, -0.098), (0.080, 0.070, 0.064))
            mkit.push(V, w, (s * 0.14, -0.34, 0.93), 0.012 * smile)
            w = mkit.bump_seg(V, (s * 0.036, -0.198, NOSE_BASE_Z + 0.002),
                              (s * 0.064, -0.180, MOUTH_Z - 0.012), (0.013, 0.026, 0.032))
            mkit.push(V, w, (0.0, 1.0, 0.0), 0.005 * smile)
        w = mkit.bump_seg(V, (-0.046, -0.188, MOUTH_Z), (0.046, -0.188, MOUTH_Z),
                          (0.030, 0.034, 0.024))
        mkit.push(V, w, (0.0, 0.86, 0.50), 0.004 * smile)
    if browup:
        w = mkit.bump_seg(V, (-0.132, -0.178, BROW_Z + 0.018), (0.132, -0.178, BROW_Z + 0.018),
                          (0.052, 0.058, 0.050))
        mkit.push(V, w, (0.0, 0.0, 1.0), 0.016 * browup)
    if jaw:
        w = mkit._smoothstep((MOUTH_Z + 0.020 - V[:, 2]) / 0.100)
        mkit.rotate_about(V, w, (0.0, 0.055, -0.150), (1.0, 0.0, 0.0), 0.10 * jaw)
    return V


def skull_vertices(expr=None):
    expr = expr or {}
    V = _base_skull().reshape(-1, 3).copy()
    _sculpt_face(V)
    _expr_face(V, expr)
    smile = expr.get("smile", 0.0)
    bl = expr.get("blink_l", 0.0)
    br = expr.get("blink_r", 0.0)
    up = (0.455 - 0.80 * bl - 0.07 * smile, 0.455 - 0.80 * br - 0.07 * smile)
    lo = (0.365 - 0.335 * bl - 0.08 * smile, 0.365 - 0.335 * br - 0.08 * smile)
    shape_eyes(V, up_h=up, lo_h=lo, squint=smile)
    V = _grid_relax(V, iterations=3, strength=0.42, mask=_eye_mask(V))
    V = _grid_relax(V, iterations=1, strength=0.16)
    for k, s in enumerate((1.0, -1.0)):
        closed = (bl, br)[k]
        if closed > 0.02:
            centre, fwd, side, upv = _eye_frame(s)
            w = mkit.bump_seg(V, centre - side * 0.050 + upv * 0.004,
                              centre + side * 0.052 + upv * 0.014, (0.048, 0.044, 0.010))
            mkit.push(V, w, fwd, 0.0035 * closed)
    return V


def expression_vertices(base, ranges, expr):
    """Face-mesh vertices for one expression; skull is rebuilt, brows follow."""
    V = base.copy()
    s0, _ = ranges["skull"]
    V[s0:s0 + ROWS * COLS] = skull_vertices(expr)
    b0, bn = ranges["brows"]
    block = V[b0:b0 + bn].copy()
    _expr_face(block, expr)
    V[b0:b0 + bn] = block
    return V


# ---------------------------------------------------------------- assembly

def build(builder, mats, face=None):
    """Adds every head part; `face` takes the blocks the shape keys touch."""
    face = builder if face is None else face
    ranges = {}
    V = skull_vertices()
    col = skin_colours(V)
    grid = V.reshape(ROWS, COLS, 3)
    cap_col = np.concatenate([col, col[:1] * 0.75, col[-1:]])
    ranges["skull"] = face.add_grid(grid, mats["skin"], SKIN, cap_lo=CAP_LO, cap_hi=CAP_HI,
                                    group="head", colors=cap_col)
    brow_start = len(face.V)
    for s in (1.0, -1.0):
        bg = brow(s)
        face.add_grid(bg, mats["hair"], HAIR, cap_lo=bg[0].mean(axis=0),
                      cap_hi=bg[-1].mean(axis=0), group="head",
                      colors=np.full((bg.shape[0] * bg.shape[1], 3), 1.75))
    ranges["brows"] = (brow_start, len(face.V) - brow_start)

    nk = neck()
    ncol = np.ones((nk.shape[0] * nk.shape[1], 3))
    ncol *= np.clip(0.66 + 0.34 * mkit._smoothstep((nk.reshape(-1, 3)[:, 2] + 0.50) / 0.16), 0, 1)[:, None]
    ranges["neck"] = builder.add_grid(nk, mats["skin"], SKIN, cap_lo=nk[0].mean(axis=0),
                                      cap_hi=nk[-1].mean(axis=0), group="neck", colors=ncol)

    ear_start = len(builder.V)
    for s in (1.0, -1.0):
        eg, ec = ear(s)
        builder.add_grid(eg, mats["skin"], SKIN,
                         cap_lo=eg[0].mean(axis=0), cap_hi=eg[-1].mean(axis=0),
                         group="head", colors=ec.reshape(-1, 3))
    ranges["ears"] = (ear_start, len(builder.V) - ear_start)

    eye_start = len(builder.V)
    for s in (1.0, -1.0):
        eyeball(builder, s, mats["eye"])
    ranges["eyes"] = (eye_start, len(builder.V) - eye_start)

    hair_start = len(builder.V)
    cap, apex_i, apex_o = hair_cap()
    builder.add_grid(cap, mats["hair"], HAIR, cap_lo=apex_i, cap_hi=apex_o, group="head",
                     colors=np.full((cap.shape[0] * cap.shape[1], 3), 0.60))
    for strip, root, tip in hair_cards():
        n = strip.shape[0] * strip.shape[1]
        shade = np.linspace(0.62, 1.30, strip.shape[0])
        cols = np.repeat(shade[:, None], strip.shape[1], axis=1).reshape(-1, 1) * np.ones((1, 3))
        builder.add_grid(strip, mats["hair"], HAIR, cap_lo=strip[0].mean(axis=0),
                         cap_hi=strip[-1].mean(axis=0), group="head",
                         colors=np.concatenate([cols, cols[-1:], cols[-1:]]))
    ranges["hair"] = (hair_start, len(builder.V) - hair_start)
    return ranges
