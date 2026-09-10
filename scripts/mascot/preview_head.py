"""blender -b -P preview_head.py -- <out.png> [expr]  - head-only contact sheet."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

import bkit
import head
import mkit

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = args[0] if args else "/tmp/jx3d/head.png"
expr_name = args[1] if len(args) > 1 else "neutral"
EXPR = {
    "neutral": {},
    "smile": {"smile": 1.0},
    "blink": {"blink_l": 1.0, "blink_r": 1.0},
    "brow": {"brow": 1.0, "smile": 0.4},
}[expr_name.replace("-nohair", "")]
NO_HAIR = expr_name.endswith("-nohair")

bkit.reset_scene()
mats = {
    "skin": bkit.material("Skin", head.SKIN, 0.0, 0.52, vertex_colors=True),
    "hair": bkit.material("Hair", head.HAIR, 0.0, 0.56, vertex_colors=True),
    "eye": bkit.material("Eye", (1.0, 1.0, 1.0), 0.0, 0.075, vertex_colors=True),
}
builder = bkit.Builder()
ranges = head.build(builder, mats)
if EXPR:
    base = builder.array()
    builder.V = head.expression_vertices(base, ranges, EXPR).tolist()
if NO_HAIR:
    h0, hn = ranges["hair"]
    keep = [f for f, m in zip(builder.F, builder.M) if not (h0 <= f[0] < h0 + hn)]
    builder.M = [m for f, m in zip(builder.F, builder.M) if not (h0 <= f[0] < h0 + hn)]
    builder.F = keep
obj = builder.to_object("Head", list(mats.values()))
obj.location = head.HEAD_ORIGIN

bkit.studio(1.0)
bkit.configure_render((460, 560), samples=24)
target = head.HEAD_ORIGIN + np.array([0.0, 0.0, -0.02])
views = []
for name, ang, elev, dist in (("front", 0.0, 4.0, 1.95), ("three-quarter", 34.0, 6.0, 1.95),
                              ("profile", 90.0, 2.0, 1.95), ("back", 180.0, 6.0, 1.95),
                              ("closeup", 14.0, 3.0, 1.25)):
    a = np.radians(ang)
    e = np.radians(elev)
    loc = target + np.array([np.sin(a) * np.cos(e), -np.cos(a) * np.cos(e), np.sin(e)]) * dist
    cam = bkit.camera("Cam_" + name, loc, target, lens=95.0)
    path = "/tmp/jx3d/_v_%s.png" % name
    bkit.render_to(path, cam)
    views.append(path)
bkit.contact_sheet(out, views, cols=5)
print("wrote", out)
