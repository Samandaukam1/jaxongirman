"""Blender-side helpers: mesh assembly, materials, studio lighting, previews."""

import math
import os

import bpy
import numpy as np

import mkit


# ------------------------------------------------------------------ scene

def reset_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.armatures, bpy.data.actions, bpy.data.images,
                 bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item, do_unlink=True)


# -------------------------------------------------------------- materials

def material(name, color, metallic=0.0, roughness=0.5, vertex_colors=False,
             emission=None, ior=1.45):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = ior
    if emission is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if vertex_colors:
        # COLOR_0 carries the whole tone, so the attribute drives Base Color
        # directly - that is the wiring the glTF exporter looks for.
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    mat.diffuse_color = (*color, 1.0)
    mat["vcol"] = bool(vertex_colors)
    return mat


# ---------------------------------------------------------------- builder

class Builder:
    """Accumulates every part of one character mesh, keeping index ranges so
    shape keys and rigid bone weights can be authored numerically later."""

    def __init__(self):
        self.V = []
        self.F = []
        self.M = []
        self.C = []
        self.W = []

    # -- low level -----------------------------------------------------
    def add(self, verts, faces, mat, color, group=None, weights=None):
        start = len(self.V)
        verts = np.asarray(verts, float).reshape(-1, 3)
        self.V.extend(verts.tolist())
        self.F.extend([tuple(i + start for i in f) for f in faces])
        self.M.extend([mat] * len(faces))
        # Materials that read COLOR_0 keep their tone in the attribute; the
        # rest keep it in the material and store white, so nothing is squared.
        color = np.asarray(color, float) if mat.get("vcol") else np.ones(3)
        if color.ndim == 1:
            color = np.repeat(color[None, :], len(verts), axis=0)
        color = np.clip(color, 0.0, 1.0)
        self.C.extend(color.tolist())
        if weights is not None:
            weights = list(weights)
            while len(weights) < len(verts):
                weights.append(weights[-1] if weights else {})
            self.W.extend(weights[:len(verts)])
        else:
            self.W.extend([{group: 1.0} if group else {}] * len(verts))
        return start, len(verts)

    def add_grid(self, P, mat, color, wrap=True, cap_lo=None, cap_hi=None,
                 group=None, colors=None, weights=None):
        """`color` is the part tone; `colors` modulates it per vertex."""
        """P is (rows, cols, 3); caps are apex points closing the tube ends."""
        rows, cols = P.shape[0], P.shape[1]
        verts = list(P.reshape(-1, 3))
        faces = mkit.grid_faces(rows, cols, wrap)
        if cap_lo is not None:
            apex = len(verts)
            verts.append(np.asarray(cap_lo, float))
            faces += mkit.fan_faces(cols, apex, 0, flip=True)
        if cap_hi is not None:
            apex = len(verts)
            verts.append(np.asarray(cap_hi, float))
            faces += mkit.fan_faces(cols, apex, (rows - 1) * cols)
        if colors is None:
            colors = color
        else:
            colors = np.asarray(colors, float).reshape(-1, 3)
            pad = len(verts) - len(colors)
            if pad > 0:
                colors = np.concatenate([colors, np.repeat(colors[-1:], pad, axis=0)])
            if mat.get("vcol"):
                colors = colors * np.asarray(color, float)[None, :]
            else:
                colors = np.ones_like(colors)
        return self.add(np.array(verts), faces, mat, colors, group, weights)

    def merge(self, other, offset=(0.0, 0.0, 0.0)):
        """Append another builder's parts, returning where they landed."""
        start = len(self.V)
        off = np.asarray(offset, float)
        self.V.extend((np.asarray(other.V, float) + off).tolist())
        self.F.extend([tuple(i + start for i in f) for f in other.F])
        self.M.extend(other.M)
        self.C.extend(other.C)
        self.W.extend(other.W)
        return start

    # -- emit ----------------------------------------------------------
    def to_object(self, name, materials, smooth=True):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in self.V], [], self.F)
        mesh.update()
        for mat in materials:
            mesh.materials.append(mat)
        index = {m.name: i for i, m in enumerate(materials)}
        for poly, mat in zip(mesh.polygons, self.M):
            poly.material_index = index[mat.name]
            poly.use_smooth = smooth
        attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        flat = np.zeros(len(self.V) * 4)
        cols = np.asarray(self.C, float)
        flat[0::4] = cols[:, 0]
        flat[1::4] = cols[:, 1]
        flat[2::4] = cols[:, 2]
        flat[3::4] = 1.0
        attr.data.foreach_set("color", flat)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        names = sorted({k for w in self.W for k in w})
        for name in names:
            vg = obj.vertex_groups.new(name=name)
            buckets = {}
            for i, w in enumerate(self.W):
                v = w.get(name)
                if v:
                    buckets.setdefault(round(float(v), 2), []).append(i)
            for value, indices in buckets.items():
                vg.add(indices, value, "REPLACE")
        return obj

    def array(self):
        return np.asarray(self.V, float)


def set_shape_key(obj, name, verts):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    key = obj.shape_key_add(name=name, from_mix=False)
    key.data.foreach_set("co", np.asarray(verts, float).ravel())
    key.value = 0.0
    return key


# -------------------------------------------------------------- lighting

def studio(strength=1.0, backdrop=False):
    world = bpy.data.worlds.new("Studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.045, 0.075, 1.0)
    bg.inputs[1].default_value = 0.6 * strength

    def area(name, loc, rot, size, energy, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, "AREA")
        data.size = size
        data.energy = energy * strength
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = rot
        bpy.context.collection.objects.link(obj)
        return obj

    area("Key", (-2.1, -2.4, 3.3), (math.radians(46), 0, math.radians(-41)), 3.4, 900)
    area("Fill", (2.9, -1.9, 1.5), (math.radians(78), 0, math.radians(56)), 3.6, 260,
         (0.82, 0.86, 1.0))
    area("Rim", (1.4, 3.0, 2.9), (math.radians(126), 0, math.radians(158)), 2.6, 700,
         (0.86, 0.80, 1.0))
    area("Bounce", (0.0, -2.2, -0.6), (math.radians(-28), 0, 0), 3.0, 140,
         (1.0, 0.94, 0.88))

    if backdrop:
        bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 2.6, 1.0),
                                         rotation=(math.radians(90), 0, 0))
        plane = bpy.context.object
        plane.name = "Backdrop"
        plane.data.materials.append(material("Backdrop", (0.035, 0.03, 0.06), 0.0, 0.6))


def camera(name, location, target, lens=85.0):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    bpy.context.collection.objects.link(obj)
    direction = np.asarray(target, float) - np.asarray(location, float)
    rx = math.atan2(math.hypot(direction[0], direction[1]), -direction[2])
    rz = math.atan2(direction[1], direction[0]) - math.pi / 2.0
    obj.rotation_euler = (rx, 0.0, rz)
    return obj


def configure_render(res=(520, 700), samples=32, engine=None):
    scene = bpy.context.scene
    engines = [engine] if engine else ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"]
    for name in engines:
        try:
            scene.render.engine = name
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        if hasattr(eevee, "taa_render_samples"):
            eevee.taa_render_samples = samples
        for flag in ("use_raytracing", "use_shadows", "use_gtao"):
            if hasattr(eevee, flag):
                setattr(eevee, flag, True)
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True


def render_to(path, cam):
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def contact_sheet(out_path, tiles, cols=None):
    """Paste rendered PNGs side by side so one image shows every view."""
    imgs = [bpy.data.images.load(p) for p in tiles]
    w, h = imgs[0].size
    cols = cols or len(imgs)
    rows = (len(imgs) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    sheet[..., :3] = 0.06
    sheet[..., 3] = 1.0
    for k, img in enumerate(imgs):
        buf = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        tile = buf.reshape(h, w, 4)
        alpha = tile[..., 3:4]
        r, c = divmod(k, cols)
        top = (rows - 1 - r) * h
        dst = sheet[top:top + h, c * w:(c + 1) * w]
        dst[..., :3] = tile[..., :3] * alpha + dst[..., :3] * (1.0 - alpha)
        bpy.data.images.remove(img)
    out = bpy.data.images.new("sheet", cols * w, rows * h, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()
    for p in tiles:
        if os.path.exists(p):
            os.remove(p)
