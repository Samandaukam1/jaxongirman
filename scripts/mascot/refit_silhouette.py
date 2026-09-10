"""Corrective refit: drive FaceBuilder's pins from the reference silhouettes.

    blender -b -P refit_silhouette.py -- [--out DIR] [--rigidity F] [--rounds N]

KeenTools' automatic face detection places about two dozen preset pins. That is
an *initialisation*: solved against it, the head barely leaves the template, so
the cheekbones, jaw width and facial profile stay generic. The identity lives
in exactly those contours.

The reference views were supplied with transparent backgrounds, so their alpha
channel is an exact, hair-free-below-the-ears silhouette of this man's head.
This module measures that silhouette, measures the model's silhouette by
projecting its vertices through the camera FaceBuilder solved, and adds pins
that pull one onto the other - band by band down the face. With a hundred-odd
real constraints instead of twenty-six, the shape rigidity can also come down
without the solve tearing.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import numpy as np

import bkit
import facebuilder_fit as fit_mod

REPO = fit_mod.REPO
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


OUT_DIR = arg("--out", os.path.join(REPO, "output"))
RIGIDITY = float(arg("--rigidity", "0.12"))
ROUNDS = int(arg("--rounds", "3"))
TEX_SIZE = int(arg("--tex", "2048"))
log = fit_mod.log


# ------------------------------------------------------------- projection

def projector(cam, fb, keyframe):
    """Maps model vertices to image pixels (x from left, y from the bottom).

    `pkt.math.proj_mat` is a pinhole matrix already expressed in pixels - fx and
    the principal point sit in it directly - so the perspective divide lands on
    pixel coordinates, with no NDC step in between.
    """
    proj = np.asarray(cam.matrix(keyframe), dtype=float)
    model = np.asarray(fb.model_mat(keyframe), dtype=float)

    def project(points):
        homo = np.concatenate([points, np.ones((len(points), 1))], axis=1)
        clip = homo @ model.T @ proj.T
        w = clip[:, 3]
        # Vertices at or behind the camera plane project to nonsense; drop them
        # rather than let a divide by a tiny w invent a silhouette off-image.
        valid = w > 1e-6
        pixels = np.full((len(points), 2), np.nan)
        pixels[valid] = clip[valid, :2] / w[valid, None]
        return pixels

    return project


def pixel_to_pin(px, py_bottom, width, height):
    """Pin coordinates are plain image pixels with y counted from the bottom.

    Verified against the preset pins the detector places: their `img_pos` reads
    back as e.g. (135.3, 362.3) on a 479x733 frame, and the crown vertex
    projects to y=610 of 733 - near the top, so y runs upwards.
    """
    return (float(px), float(py_bottom))


# -------------------------------------------------------------- silhouettes

def reference_silhouette(rgba, rows):
    """Left and right edge x per row, from the alpha channel (y from bottom)."""
    mask = rgba[..., 3] > 0.5                    # image rows are stored bottom-up
    out = {}
    for row in rows:
        hits = np.flatnonzero(mask[row])
        if len(hits) > 4:
            out[row] = (float(hits[0]), float(hits[-1]))
    return out


def model_silhouette(pixels, rows, band):
    """The same measurement on the projected model, per row band."""
    px, py = pixels[:, 0], pixels[:, 1]
    out = {}
    for row in rows:
        near = np.abs(py - row) < band
        if near.sum() < 6:
            continue
        xs = px[near]
        out[row] = (float(xs.min()), float(xs.max()))
    return out


# --------------------------------------------------------------- refitting

def neck_row(rgba):
    """Row of the narrowest point below the face: the neck.

    Scanning up from the bottom of a portrait crop the silhouette runs
    shoulders (wide), neck (narrow), jaw (widening). Everything at or below
    that minimum is neck and shoulder, which say nothing about the skull and
    will drag the jaw outwards if pinned.
    """
    mask = rgba[..., 3] > 0.5
    widths = mask.sum(axis=1).astype(float)
    filled = np.flatnonzero(widths > widths.max() * 0.08)
    if len(filled) < 20:
        return None
    bottom, top = int(filled[0]), int(filled[-1])
    span = top - bottom
    lower = widths[bottom:bottom + int(span * 0.45)]
    if len(lower) < 5:
        return None
    return bottom + int(np.argmin(lower)), bottom, top


def corrective_pins(fb, cam, images, keyframe, name, keep, inset=6.0, samples=11):
    """Pin the model's jaw and cheek contour onto the photograph's."""
    rgba = images[keyframe]
    height, width = rgba.shape[0], rgba.shape[1]

    found = neck_row(rgba)
    if found is None:
        log("pins", f"{name}: no silhouette")
        return 0
    neck, bottom, top = found

    verts = np.asarray(fb.applied_args_vertices(), dtype=float).reshape(-1, 3)
    project = projector(cam, fb, keyframe)
    pixels = project(verts)
    on_screen = (np.isfinite(pixels).all(axis=1)
                 & (pixels[:, 0] > -width) & (pixels[:, 0] < 2 * width)
                 & (pixels[:, 1] > -height) & (pixels[:, 1] < 2 * height))
    if on_screen.sum() < 200:
        return 0
    verts = verts[on_screen]
    pixels = pixels[on_screen]
    px_all, py_all = pixels[:, 0], pixels[:, 1]

    profile = name == "profile"
    face_height = top - neck
    if profile:
        # The facial profile - brow, nose, lips, chin - is hair-free on the
        # side the nose is on, and is the richest identity contour available.
        lo = neck + face_height * 0.05
        hi = neck + face_height * 0.72
    else:
        # Jaw and lower cheek only: above this the sideburn and hair take over
        # the outline, below it is neck.
        lo = neck + face_height * 0.06
        hi = neck + face_height * 0.46
    rows = sorted({int(np.clip(round(v), 0, height - 1))
                   for v in np.linspace(lo, hi, samples)})

    ref = reference_silhouette(rgba, rows)
    band = max(2.0, face_height / samples * 0.55)
    mod = model_silhouette(pixels, rows, band)

    nose_px = float(px_all[np.argmax(verts[:, 2])])
    face_side = "left" if nose_px < width * 0.5 else "right"

    # Stale pins from an earlier geometry state contradict the current one.
    for index in range(fb.pins_count(keyframe) - 1, keep - 1, -1):
        fb.remove_pin(keyframe, index)

    added, deltas, misses = 0, [], 0
    for row in rows:
        if row not in ref or row not in mod:
            continue
        for side in ("left", "right"):
            if profile and side != face_side:
                continue
            direction = 1.0 if side == "left" else -1.0
            model_x = mod[row][0 if side == "left" else 1] + direction * inset
            ref_x = ref[row][0 if side == "left" else 1] + direction * inset
            if abs(ref_x - model_x) > width * 0.25:
                continue
            before = fb.pins_count(keyframe)
            if fb.add_pin(keyframe, pixel_to_pin(model_x, row, width, height)) is None:
                misses += 1
                continue
            if fb.pins_count(keyframe) <= before:
                misses += 1
                continue
            fb.move_pin(keyframe, before, pixel_to_pin(ref_x, row, width, height))
            added += 1
            deltas.append(abs(ref_x - model_x))
    residual = f" mean |err| {np.mean(deltas):.1f}px" if deltas else ""
    log("pins", f"{name}: +{added} (missed {misses}) neck@{neck}{residual}")
    return added


def run():
    loader = fit_mod.require_core()
    pkt = loader.module()
    os.makedirs(OUT_DIR, exist_ok=True)
    bkit.reset_scene()

    fb, images, placed, cam = fit_mod.fit(loader)
    shape_views = [k for k in placed if fit_mod.VIEWS[k] not in fit_mod.TEXTURE_ONLY]

    fb.set_shape_rigidity(RIGIDITY)
    log("refit", f"rigidity now {fb.shape_rigidity():.4f}")
    # The detector's preset pins are the trustworthy landmarks; keep them and
    # only ever replace the contour pins added on top.
    keep = {k: fb.pins_count(k) for k in shape_views}

    for round_index in range(ROUNDS):
        total = 0
        for keyframe in shape_views:
            total += corrective_pins(fb, cam, images, keyframe,
                                     fit_mod.VIEWS[keyframe], keep[keyframe])
        for _ in range(3):
            for keyframe in shape_views:
                try:
                    fb.solve_for_current_pins(keyframe)
                except Exception as error:
                    log("solve", f"kf {keyframe}: {error}")
            cam.sync_focals(fb, shape_views)
        counts = {fit_mod.VIEWS[k]: fb.pins_count(k) for k in shape_views}
        log("refit", f"round {round_index + 1}/{ROUNDS}: {total} contour pins, total {counts}")

    obj = fit_mod.geo_to_blender(fb)
    log("out", "head dimensions:", [round(v, 4) for v in obj.dimensions])
    fit_mod.add_blendshapes(pkt, obj, fb.current_scale())

    cameras = []
    for keyframe in placed:
        cameras.append({
            "name": fit_mod.VIEWS[keyframe],
            "keyframe": keyframe,
            "width": cam.sizes[keyframe][0],
            "height": cam.sizes[keyframe][1],
            "focal_px": float(fb.focal_length_at(keyframe)),
            "model_mat": np.asarray(fb.model_mat(keyframe), dtype=float).tolist(),
        })
    with open(os.path.join(OUT_DIR, "cameras.json"), "w") as handle:
        json.dump(cameras, handle, indent=1)

    try:
        array = fit_mod.bake_texture(loader, fb, images, placed, cam, TEX_SIZE)
        image = fit_mod.save_texture(np.asarray(array),
                                     os.path.join(OUT_DIR, "head_albedo.png"))
        fit_mod.apply_material(obj, image)
    except Exception as error:
        log("tex", f"texture bake failed: {error}")

    blend = os.path.join(OUT_DIR, "likeness_fit.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    log("out", "wrote", blend)


run()
