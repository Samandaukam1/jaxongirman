"""blender -b -P preview_full.py -- <out.png> [expr] - full character sheet."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

import bkit
import character
import head

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = args[0] if args else "/tmp/jx3d/full.png"
expr = character.EXPRESSIONS.get(args[1]) if len(args) > 1 else None

bkit.reset_scene()
mats = character.materials()
builder, face, info = character.assemble(mats)
if expr:
    face.V = character.shape_key_vertices(info, expr).tolist()
obj = builder.to_object("Jaxongirman", list(mats.values()))
face_obj = face.to_object("Face", list(mats.values()))
print("verts", len(builder.V) + len(face.V), "faces", len(builder.F) + len(face.F))

bkit.studio(1.0)
bkit.configure_render((440, 900), samples=24)
target = np.array([0.0, 0.0, 1.01])
views = []
for name, ang, elev, dist, tgt in (("front", 0.0, 3.0, 5.3, target),
                                   ("three-quarter", 36.0, 5.0, 5.3, target),
                                   ("profile", 90.0, 3.0, 5.3, target),
                                   ("back", 180.0, 5.0, 5.3, target),
                                   ("bust", 20.0, 4.0, 1.9, np.array([0.0, 0.0, 1.60]))):
    a, e = np.radians(ang), np.radians(elev)
    loc = tgt + np.array([np.sin(a) * np.cos(e), -np.cos(a) * np.cos(e), np.sin(e)]) * dist
    cam = bkit.camera("Cam_" + name, loc, tgt, lens=85.0)
    path = "/tmp/jx3d/_f_%s.png" % name
    bkit.render_to(path, cam)
    views.append(path)
bkit.contact_sheet(out, views, cols=5)
print("wrote", out)
