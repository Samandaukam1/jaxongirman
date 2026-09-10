"""Assembles the whole character: one mesh, one material set, shape keys ready."""

import numpy as np

import bkit
import body
import head


def materials():
    return {
        "skin": bkit.material("Skin", head.SKIN, 0.0, 0.44, vertex_colors=True),
        "hair": bkit.material("Hair", head.HAIR, 0.0, 0.56, vertex_colors=True),
        "eye": bkit.material("Eye", (1.0, 1.0, 1.0), 0.0, 0.070, vertex_colors=True),
        "armor": bkit.material("Amethyst armour", body.PURPLE, 0.80, 0.255),
        "dark": bkit.material("Joint shell", body.DARK, 0.62, 0.400),
        "suit": bkit.material("Undersuit", body.SUIT, 0.18, 0.560),
        "silver": bkit.material("Platinum emblem", body.SILVER, 0.30, 0.300),
    }


def assemble(mats):
    """Returns (body_builder, face_builder, info).

    The face is a separate mesh so its morph targets cover a few thousand
    vertices instead of the whole character; that alone keeps the GLB small.
    """
    builder = bkit.Builder()
    body.build(builder, mats)

    rest = bkit.Builder()
    face = bkit.Builder()
    ranges = head.build(rest, mats, face=face)
    builder.merge(rest, head.HEAD_ORIGIN)
    face_base = np.asarray(face.V, float)
    face.V = (face_base + head.HEAD_ORIGIN).tolist()
    return builder, face, {"face_base": face_base, "ranges": ranges}


EXPRESSIONS = {
    "BlinkL": {"blink_l": 1.0},
    "BlinkR": {"blink_r": 1.0},
    "Smile": {"smile": 1.0},
    "BrowRaise": {"brow": 1.0},
    "MouthOpen": {"mouth": 1.0},
}


def shape_key_vertices(info, expr):
    """Face-mesh vertex array for one expression, in object space."""
    return head.expression_vertices(info["face_base"], info["ranges"], expr) + head.HEAD_ORIGIN
