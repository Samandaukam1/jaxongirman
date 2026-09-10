"""Split the supplied contact sheets into single-head images.

    blender -b -P split_sheets.py -- [--out DIR]

The newer sheets sit on a light background with white gutters between tiles
rather than on transparency, so the tiles are found by looking for the bright
rows and columns that separate them. Each tile is written out only if it is
large enough to be a head rather than a detail crop.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = (argv[argv.index("--out") + 1] if "--out" in argv
       else os.path.join(REPO, "docs", "mascot", "reference", "views2"))
INCOMING = os.path.join(REPO, "docs", "mascot", "reference", "incoming")

# These sheets are regular grids with a detail strip along the bottom. Gutter
# detection is unreliable here because the tiles sit on a light backdrop that
# is nearly as bright as the separators, so the grid is stated explicitly and
# verified by eye from the contact sheet this writes.
SHEETS = {
    "05_hair_head.png": {
        "cols": 5, "rows": 2, "top": 0.006, "bottom": 0.752,
        "left": 0.005, "right": 0.995, "inset": 0.012,
        "names": ["h_front", "h_q_left", "h_profile", "h_q_right", "h_down_a",
                  "h_up", "h_q_left2", "h_down_b", "h_q_right2", "h_back"],
    },
    "01_full_face_multiview.png": {
        "cols": 3, "rows": 2, "top": 0.005, "bottom": 0.735,
        "left": 0.005, "right": 0.995, "inset": 0.012,
        "names": ["m_front", "m_q_left", "m_profile",
                  "m_q_right", "m_down", "m_up"],
    },
}


def load(path):
    image = bpy.data.images.load(path)
    w, h = image.size[:2]
    channels = image.channels
    buf = np.empty(w * h * channels, dtype=np.float32)
    image.pixels.foreach_get(buf)
    bpy.data.images.remove(image)
    out = buf.reshape(h, w, channels)[::-1]          # top-down
    if channels == 3:
        out = np.dstack([out, np.ones((h, w, 1), dtype=np.float32)])
    return out


def save(array, path):
    h, w = array.shape[:2]
    image = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    image.pixels.foreach_set(
        np.ascontiguousarray(array[::-1], dtype=np.float32).ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


os.makedirs(OUT, exist_ok=True)
written = []
for sheet, spec in SHEETS.items():
    path = os.path.join(INCOMING, sheet)
    if not os.path.exists(path):
        print(f"[split] {sheet}: missing")
        continue
    img = load(path)
    h, w = img.shape[:2]
    y0, y1 = int(h * spec["top"]), int(h * spec["bottom"])
    x0, x1 = int(w * spec["left"]), int(w * spec["right"])
    tile_h = (y1 - y0) / spec["rows"]
    tile_w = (x1 - x0) / spec["cols"]
    pad_y = int(tile_h * spec["inset"])
    pad_x = int(tile_w * spec["inset"])
    print(f"[split] {sheet}: {w}x{h} grid {spec['cols']}x{spec['rows']} "
          f"tile {int(tile_w)}x{int(tile_h)}")

    index = 0
    for r in range(spec["rows"]):
        for c in range(spec["cols"]):
            if index >= len(spec["names"]):
                break
            name = spec["names"][index]
            index += 1
            a0 = int(y0 + r * tile_h) + pad_y
            a1 = int(y0 + (r + 1) * tile_h) - pad_y
            b0 = int(x0 + c * tile_w) + pad_x
            b1 = int(x0 + (c + 1) * tile_w) - pad_x
            tile = img[a0:a1, b0:b1]
            save(tile, os.path.join(OUT, f"{name}.png"))
            written.append(name)

print(f"[split] wrote {len(written)} tiles to {OUT}")
